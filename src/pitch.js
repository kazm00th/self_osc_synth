// f0 推定器（正規化自己相関）。純関数、ブラウザ非依存（§3, §6）。
//
// スペクトルのピーク検出は使わない — クラリネット波形は3次が基音より強いことが
// 常で、第1レジスタでも「比≈3」と誤判定する（R2）。自己相関はすべての倍音が
// 真の基音周期で強め合うため、この失敗モードに強い。
//
// 自己相関の前に窓内平均（DC オフセット）を引く（§6）。p̃ は γ に依存した
// 正の DC オフセットを持ち、除かないと相関関数が DC 項に支配される。
//
// 正規化相関係数（[-1,1]）を使い、「グローバル最大」ではなく「最初に十分強い
// （閾値を超える）ピーク」を採る。真の基本周期の整数倍のラグでも相関が高く
// なりうるため（オクターブ下エラー）、素直に最大値を採ると period が
// 2倍・4倍…にずれることがある。最初の強いピークを採ることでこれを避ける。

const DEFAULT_THRESHOLD = 0.7;

/**
 * 自己相関で基本周波数を推定する。
 * @param {Float32Array|Float64Array|number[]} buf 時間領域の波形
 * @param {number} fs サンプルレート
 * @param {object} [opts]
 * @param {number} [opts.minFreq=50] 探索する最低周波数（Hz）
 * @param {number} [opts.maxFreq=1200] 探索する最高周波数（Hz）
 * @param {number} [opts.threshold=0.7] この正規化相関を初めて超えた極大値を採用
 * @returns {number} 推定した基本周波数（Hz）
 */
export function estimateF0(buf, fs, opts = {}) {
  const minFreq = opts.minFreq ?? 50;
  const maxFreq = opts.maxFreq ?? 1200;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const n = buf.length;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;

  const minLag = Math.max(1, Math.floor(fs / maxFreq));
  const maxLag = Math.min(Math.floor(fs / minFreq), n - 2);

  function normCorrAt(lag) {
    let sum = 0;
    let e0 = 0;
    let e1 = 0;
    const len = n - lag;
    for (let i = 0; i < len; i++) {
      const a = buf[i] - mean;
      const b = buf[i + lag] - mean;
      sum += a * b;
      e0 += a * a;
      e1 += b * b;
    }
    const denom = Math.sqrt(e0 * e1);
    return denom > 0 ? sum / denom : 0;
  }

  const lo = Math.max(1, minLag - 1);
  const hi = maxLag + 1;
  const vals = new Float64Array(hi - lo + 1);
  for (let lag = lo; lag <= hi; lag++) {
    vals[lag - lo] = normCorrAt(lag);
  }

  // 最初に閾値を超える極大値を探す
  let chosenIdx = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const idx = lag - lo;
    const v = vals[idx];
    const isLocalMax = v >= vals[idx - 1] && v >= vals[idx + 1];
    if (isLocalMax && v >= threshold) {
      chosenIdx = idx;
      break;
    }
  }

  // 閾値を超える極大が無ければグローバル最大にフォールバック
  if (chosenIdx === -1) {
    let bestVal = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const idx = lag - lo;
      if (vals[idx] > bestVal) {
        bestVal = vals[idx];
        chosenIdx = idx;
      }
    }
  }

  let bestLag = chosenIdx + lo;

  // 放物線補間でサブサンプル精度を上げる
  const cm1 = vals[chosenIdx - 1];
  const c0 = vals[chosenIdx];
  const cp1 = vals[chosenIdx + 1];
  const denom = cm1 - 2 * c0 + cp1;
  let delta = 0;
  if (denom !== 0 && Number.isFinite(cm1) && Number.isFinite(cp1)) {
    delta = (0.5 * (cm1 - cp1)) / denom;
    if (Math.abs(delta) > 1) delta = 0;
  }

  const refinedLag = bestLag + delta;
  return fs / refinedLag;
}
