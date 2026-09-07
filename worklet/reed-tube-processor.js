// シングルリード自励振動 + 円筒管デジタル導波路 DSP コア。
// 設計書: docs/superpowers/specs/2026-09-03-reed-waveguide-synth-design.md
//
// AudioWorklet に依存しない純粋な DSP（ReedTubeModel）と、
// AudioWorkletProcessor 登録部（ブラウザでのみ評価される）に分かれる。
// import 文は使わない（ブラウザ差を避けるため。§3）。

const C_SOUND = 343; // m/s, 20°C
const DELAY_BUF_SIZE = 512; // §4.5: D は 1x で21-168, 2xで42-336。補間マージン込みで512

/**
 * 閉形式 Bernoulli 流量ソルバ（§4.3）。
 * X = max(x, 0), b = γ - 2p⁻ に対し ũ を解析的に解く。
 * s = 0（ビーティング中）なら ũ = 0。
 * b >= 0 側は桁落ちを避けた安定形 2sb/(s+√(s²+4sb)) を使う（§4.3 数値の節）。
 */
function solveBernoulli(zeta, X, b) {
  const s = zeta * zeta * X * X;
  if (s === 0) return 0;
  if (b >= 0) {
    return (2 * s * b) / (s + Math.sqrt(s * s + 4 * s * b));
  }
  return (s - Math.sqrt(s * s - 4 * s * b)) / 2;
}

// --- 決定的な擬似乱数（mulberry32）。noise 注入用。§3: 乱数シードを注入可能 ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readParam(arrOrScalar, i) {
  if (typeof arrOrScalar === 'number') return arrOrScalar;
  return arrOrScalar.length === 1 ? arrOrScalar[0] : arrOrScalar[i];
}

/** 循環バッファからの線形補間読み出し（§4.5）。テストのため module 関数として切り出す。 */
function interpRead(buf, idx) {
  const n = buf.length;
  let i = idx % n;
  if (i < 0) i += n;
  const i0 = Math.floor(i);
  const frac = i - i0;
  const i1 = (i0 + 1) % n;
  return buf[i0] * (1 - frac) + buf[i1] * frac;
}

/** TPT SVF の1サンプル更新（純関数版。テスト用に切り出す）。§4.1 */
function reedStep(s1, s2, u, coeff) {
  const { a1, a2, a3 } = coeff;
  const v3 = u - s2;
  const v1 = a1 * s1 + a2 * v3;
  const v2 = s2 + a2 * s1 + a3 * v3;
  return { s1: 2 * v1 - s1, s2: 2 * v2 - s2, x: v2, v1 };
}

// --- オーバーサンプリング用ハーフバンド FIR（§4.6）---
// 15 タップの窓関数（ハミング）付き sinc。DC 利得 1 に正規化。
const HB_NUM_TAPS = 15;

function sinc(x) {
  if (x === 0) return 1;
  return Math.sin(Math.PI * x) / (Math.PI * x);
}

function makeHalfbandFIR(numTaps) {
  const c = (numTaps - 1) / 2;
  const h = new Float64Array(numTaps);
  for (let n = 0; n < numTaps; n++) {
    const k = n - c;
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (numTaps - 1)); // Hamming
    h[n] = sinc(0.5 * k) * w;
  }
  let sum = 0;
  for (let i = 0; i < h.length; i++) sum += h[i];
  for (let i = 0; i < h.length; i++) h[i] /= sum;
  return h;
}

const HB_COEFFS = makeHalfbandFIR(HB_NUM_TAPS);

/**
 * ハーフバンド FIR フィルタ + 2:1 間引き。状態（過去サンプル）を呼び出しをまたいで保持する。
 * §4.6: out[0] と out[1] それぞれに独立したインスタンスを持たせる。
 */
class HalfbandDecimator {
  constructor(coeffs = HB_COEFFS) {
    this.coeffs = coeffs;
    this.buf = new Float64Array(coeffs.length); // buf[0]が最新
  }

  /** 長さ偶数の入力を受け、長さ半分の出力を返す。 */
  processBlock(input) {
    const n = input.length;
    const out = new Float64Array(n >> 1);
    const taps = this.coeffs.length;
    let oi = 0;
    for (let i = 0; i < n; i++) {
      for (let j = taps - 1; j > 0; j--) this.buf[j] = this.buf[j - 1];
      this.buf[0] = input[i];
      if (i % 2 === 1) {
        let acc = 0;
        for (let k = 0; k < taps; k++) acc += this.coeffs[k] * this.buf[k];
        out[oi++] = acc;
      }
    }
    return out;
  }
}

export class ReedTubeModel {
  /**
   * @param {object} opts
   * @param {number} [opts.fsInternal=48000] 内部サンプルレート（1x 相当。oversample=2 で ×2 される）
   * @param {number} [opts.tauD=0.015] D_eff グライドの時定数（秒）。§4.5: 3ms 未満不可
   * @param {number} [opts.seed=1] noise 用 PRNG シード
   * @param {number} [opts.delaySamples] 与えると tubeLength を無視し D を直接指定（テスト用）
   */
  constructor(opts = {}) {
    this.baseFs = opts.fsInternal ?? 48000;
    this.oversample = opts.oversample ?? 1; // 1x/2x が製品仕様。4x はテスト専用参照レート
    this.fsInternal = this.baseFs * this.oversample;
    // decimator: oversample=2^stages を、ハーフバンド段を stages 回カスケードして 1x へ戻す
    const stages = Math.round(Math.log2(this.oversample));
    if (2 ** stages !== this.oversample) {
      throw new Error(`oversample は 2 のべき乗のみ対応: ${this.oversample}`);
    }
    this._out0Dec = Array.from({ length: stages }, () => new HalfbandDecimator());
    this._out1Dec = Array.from({ length: stages }, () => new HalfbandDecimator());
    this.tauD = opts.tauD ?? 0.015;
    this.seed = opts.seed ?? 1;
    this._rng = mulberry32(this.seed);

    // k-rate パラメータ（§5 既定値）
    this.zeta = opts.zeta ?? 0.25;
    this.reedFreq = opts.reedFreq ?? 2200;
    this.reedQ = opts.reedQ ?? 3;
    this.contactQ = opts.contactQ ?? 4;
    this.bellCutoff = opts.bellCutoff ?? 1500;
    this.wallLoss = opts.wallLoss ?? 0.995;
    this.noise = opts.noise ?? 0.008;

    // DC ブロッカ（tanh の後。R50）。カットオフ ~20Hz 相当の1極。
    this.dcBlockR = 1 - (2 * Math.PI * 20) / this.fsInternal;
    this._dcX1 = 0;
    this._dcY1 = 0;

    // 発散ガード復帰時のフェードイン（§8: 5ms）
    this._fadeRemaining = 0;
    this._fadeTotal = 0;

    // リード状態（TPT SVF）: s1 ≈ x'/ω_warped, s2 ≈ x
    this.s1 = 0;
    this.s2 = 0;
    this.x = 0; // 前サンプルの x（係数選択・X=max(x,0) に使う）
    this.xd = 0; // x'（snapshot 用）

    // 導波路遅延線
    this.pPlusBuf = new Float64Array(DELAY_BUF_SIZE);
    this.pMinusBuf = new Float64Array(DELAY_BUF_SIZE);
    this.pos = 0;
    this.bellFilterState = 0;

    // tubeLength → D の初期化
    this.delaySamplesOverride = opts.delaySamples ?? null;
    if (this.delaySamplesOverride != null) {
      this.D = this.delaySamplesOverride;
    } else {
      const tubeLength = opts.tubeLength ?? 0.6;
      this.D = (tubeLength * this.fsInternal) / C_SOUND;
    }
    this.D_eff = this.D;

    this._updateReedCoeffs();
    this._updateBellCoeff();
  }

  static solveBernoulli(zeta, X, b) {
    return solveBernoulli(zeta, X, b);
  }

  static interpRead(buf, idx) {
    return interpRead(buf, idx);
  }

  static reedStep(s1, s2, u, coeff) {
    return reedStep(s1, s2, u, coeff);
  }

  static halfbandCoeffs() {
    return HB_COEFFS;
  }

  _updateReedCoeffs() {
    const g = Math.tan((Math.PI * this.reedFreq) / this.fsInternal);
    this.omegaWarped = 2 * this.fsInternal * g;
    this._g = g;
    const kOpen = this.reedQ > 0 ? 1 / this.reedQ : 0;
    const kContact = kOpen * this.contactQ;
    this._coeffOpen = this._reedCoeffFor(g, kOpen);
    this._coeffContact = this._reedCoeffFor(g, kContact);
  }

  _reedCoeffFor(g, k) {
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    return { a1, a2, a3 };
  }

  _updateBellCoeff() {
    this._bellA = Math.exp((-2 * Math.PI * this.bellCutoff) / this.fsInternal);
  }

  /** リード状態を1サンプル進める（§4.1）。前サンプルの x で開放/接触を選択。 */
  _stepReed(u) {
    const coeff = this.x < 0 ? this._coeffContact : this._coeffOpen;
    const r = reedStep(this.s1, this.s2, u, coeff);
    this.s1 = r.s1;
    this.s2 = r.s2;
    this.x = r.x;
    this.xd = this.omegaWarped * r.v1;
  }

  _interpRead(buf, idx) {
    return interpRead(buf, idx);
  }

  /**
   * blockLen サンプル（base rate 換算）処理する。oversample>1 なら内部で
   * blockLen*oversample サンプル計算してから out[1] 同様にハーフバンド FIR で間引く。
   * @param {number} blockLen
   * @param {object} params a-rate: gamma, gate, tubeLength または delaySamples
   *   （各 Float32Array 長 blockLen または長さ1。base rate 基準。§4.6: 入力側の補間は不要、保持でよい）
   * @returns {{out0: Float64Array, out1: Float64Array, diverged: boolean, nonFiniteCount: number}}
   */
  process(blockLen, params = {}) {
    const oversample = this.oversample;
    const internalLen = blockLen * oversample;
    const raw0 = new Float64Array(internalLen);
    const raw1 = new Float64Array(internalLen);

    const gammaArr = params.gamma ?? [0];
    const gateArr = params.gate ?? [1];
    const tubeLengthArr = params.tubeLength ?? null;
    const delaySamplesArr = params.delaySamples ?? null;

    const glideCoeff = 1 - Math.exp(-1 / (this.tauD * this.fsInternal));
    const bufN = this.pPlusBuf.length;
    let nonFiniteCount = 0;

    for (let j = 0; j < internalLen; j++) {
      const i = Math.floor(j / oversample); // base-rate インデックス（保持でよい。§4.6）
      const gammaTarget = readParam(gammaArr, i);
      const gate = readParam(gateArr, i);
      const gamma = gammaTarget * gate;

      // D グライド（a-rate: tubeLength / delaySamples）
      let dTarget = this.D;
      if (delaySamplesArr != null) {
        dTarget = readParam(delaySamplesArr, i);
      } else if (tubeLengthArr != null) {
        const L = readParam(tubeLengthArr, i);
        dTarget = (L * this.fsInternal) / C_SOUND;
      }
      this.D = dTarget;
      this.D_eff += (dTarget - this.D_eff) * glideCoeff;
      const D = Math.max(this.D_eff, 2);

      // 手順1: p⁻ を読む
      const pMinus = this._interpRead(this.pMinusBuf, this.pos - D);

      // 手順2-3: X, ũ
      const X = Math.max(this.x, 0);
      const b = gamma - 2 * pMinus;
      let u = solveBernoulli(this.zeta, X, b);

      // 手順4: 乱流ノイズ
      const noiseSample = this._rng() * 2 - 1;
      u += this.noise * (Math.abs(u) + 0.02) * noiseSample;

      // 手順5: p⁺, p̃
      const pPlus = u + pMinus;
      const pTilde = pPlus + pMinus;

      // 手順6: リード→ベル線へ書き込み
      this.pPlusBuf[this.pos % bufN] = pPlus;

      // 手順7: リード状態を進める
      const dp = gamma - pTilde;
      this._stepReed(1 - dp);

      // 手順8: ベル端
      const bellIn = this._interpRead(this.pPlusBuf, this.pos - D);
      const rOut = this._bellA * this.bellFilterState - (1 - this._bellA) * bellIn;
      this.bellFilterState = rOut;
      const reflected = this.wallLoss * rOut;
      this.pMinusBuf[this.pos % bufN] = reflected;

      // 手順9: 出力チェーン
      const transmitted = bellIn + rOut; // (1+R)·p⁺_bell。wallLoss は掛けない（意図的。R33）
      const limited = Math.tanh(transmitted);
      // DC ブロッカ（tanh の後。R50）
      const dcOut = limited - this._dcX1 + this.dcBlockR * this._dcY1;
      this._dcX1 = limited;
      this._dcY1 = dcOut;

      // 発散ガード復帰後のフェードイン（out0 のみ。§8）
      let out0Sample = Number.isFinite(dcOut) ? dcOut : 0;
      if (!Number.isFinite(dcOut)) nonFiniteCount++;
      if (this._fadeRemaining > 0) {
        const gain = 1 - this._fadeRemaining / this._fadeTotal;
        out0Sample *= gain;
        this._fadeRemaining--;
      }
      raw0[j] = out0Sample;
      if (!Number.isFinite(pTilde)) nonFiniteCount++;
      raw1[j] = Number.isFinite(pTilde) ? pTilde : 0;

      this.pos = (this.pos + 1) % bufN;
    }

    // §4.6: out[0] と out[1] の両方に同じデシメーションを掛ける（R27）
    let out0 = raw0;
    let out1 = raw1;
    for (const dec of this._out0Dec) out0 = dec.processBlock(out0);
    for (const dec of this._out1Dec) out1 = dec.processBlock(out1);

    // ブロック末の発散ガード（§8）
    let diverged = false;
    if (!Number.isFinite(this.s1) || !Number.isFinite(this.s2) || Math.abs(this.s2) > 1e3) {
      diverged = true;
    }
    if (diverged) {
      this.s1 = 0;
      this.s2 = 0;
      this.x = 0;
      this.xd = 0;
      this.pPlusBuf.fill(0);
      this.pMinusBuf.fill(0);
      this.bellFilterState = 0;
      this._dcX1 = 0;
      this._dcY1 = 0;
      this._fadeTotal = Math.max(1, Math.round(0.005 * this.fsInternal));
      this._fadeRemaining = this._fadeTotal;
    }

    return { out0, out1, diverged, nonFiniteCount };
  }
}

if (typeof registerProcessor !== 'undefined') {
  class ReedTubeProcessor extends AudioWorkletProcessor {
    // worklet 配線は手順2 で実装する。
  }
  registerProcessor('reed-tube', ReedTubeProcessor);
}
