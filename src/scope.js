// 4パネル描画（Canvas 2D）。§7。
//
// combineStandingWave は純関数として切り出し、node --test で検証する（テスト32）。
// それ以外の描画関数はブラウザの Canvas API に依存する。

/**
 * パネル3（管内の定在波）用: p⁺ と p⁻ を同じ z 軸（z=0 リード端, z=nTube ベル端）へ
 * 揃えて和を取る。
 *
 * p⁺ はバッファ先頭（index 0）がリード端寄り、p⁻ は先頭がベル端寄り
 * （波が逆向きに走るため。§7）。反転せずに単純に足すと節・腹の位置が
 * 物理と一致しない（R53）。
 *
 * @param {Float32Array|number[]} pPlus 長さ >= nTube。index 0 がリード端寄り
 * @param {Float32Array|number[]} pMinus 長さ >= nTube。index 0 がベル端寄り
 * @param {number} nTube 有効長
 * @returns {Float64Array} 長さ nTube。index 0 = リード端(z=0)、index nTube-1 = ベル端寄り
 */
export function combineStandingWave(pPlus, pMinus, nTube) {
  const out = new Float64Array(nTube);
  for (let z = 0; z < nTube; z++) {
    out[z] = pPlus[z] + pMinus[nTube - 1 - z];
  }
  return out;
}

// --- ここから下は Canvas 2D 依存。node --test では呼ばれない ---

function clearPanel(ctx, w, h) {
  ctx.fillStyle = '#0c0e12';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#333';
  ctx.strokeRect(0, 0, w, h);
}

/** パネル1: リード相図 (x, x')。x=0 線（ビーティング境界）を引く。 */
export function drawReedPhase(ctx, w, h, snap) {
  clearPanel(ctx, w, h);
  const { x, xd } = snap;
  let maxX = 1e-6;
  let maxXd = 1e-6;
  for (let i = 0; i < x.length; i++) {
    maxX = Math.max(maxX, Math.abs(x[i]));
    maxXd = Math.max(maxXd, Math.abs(xd[i]));
  }
  const toPx = (v) => w / 2 + (v / maxX) * (w / 2 - 4);
  const toPy = (v) => h / 2 - (v / maxXd) * (h / 2 - 4);

  // x=0 線
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(toPx(0), 0);
  ctx.lineTo(toPx(0), h);
  ctx.stroke();

  ctx.strokeStyle = '#7cf';
  ctx.beginPath();
  for (let i = 0; i < x.length; i++) {
    const px = toPx(x[i]);
    const py = toPy(xd[i]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** パネル2: 非線形特性 ũ(Δp̃) の準静的曲線 + 動作点の軌跡。 */
export function drawNonlinearCharacteristic(ctx, w, h, snap, zeta) {
  clearPanel(ctx, w, h);
  const { dp, u } = snap;
  let maxDp = 1e-6;
  let maxU = 1e-6;
  for (let i = 0; i < dp.length; i++) {
    maxDp = Math.max(maxDp, Math.abs(dp[i]));
    maxU = Math.max(maxU, Math.abs(u[i]));
  }
  const toPx = (v) => w / 2 + (v / maxDp) * (w / 2 - 4);
  const toPy = (v) => h / 2 - (v / maxU) * (h / 2 - 4);

  // 準静的特性曲線: x = 1 - Δp̃ を代入した ũ = ζ*max(1-Δp̃,0)*sign(Δp̃)*sqrt(|Δp̃|)
  ctx.strokeStyle = '#666';
  ctx.beginPath();
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const dpv = -maxDp + (2 * maxDp * i) / steps;
    const xq = Math.max(1 - dpv, 0);
    const uq = zeta * xq * Math.sign(dpv) * Math.sqrt(Math.abs(dpv));
    const px = toPx(dpv);
    const py = toPy(uq);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // 動作点の軌跡
  ctx.strokeStyle = '#fc7';
  ctx.beginPath();
  for (let i = 0; i < dp.length; i++) {
    const px = toPx(dp[i]);
    const py = toPy(u[i]);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** パネル3: 管内の定在波。 */
export function drawStandingWave(ctx, w, h, snap) {
  clearPanel(ctx, w, h);
  const { pPlus, pMinus, nTube } = snap;
  if (nTube < 2) return;
  const combined = combineStandingWave(pPlus, pMinus, nTube);
  let maxAmp = 1e-6;
  for (let i = 0; i < nTube; i++) maxAmp = Math.max(maxAmp, Math.abs(combined[i]));

  const toPx = (z) => (z / (nTube - 1)) * w;
  const toPy = (v) => h / 2 - (v / maxAmp) * (h / 2 - 4);

  ctx.strokeStyle = '#7f7';
  ctx.beginPath();
  for (let z = 0; z < nTube; z++) {
    const px = toPx(z);
    const py = toPy(combined[z]);
    if (z === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** パネル4: p̃ の波形 + スペクトル（AnalyserNode を main.js 側で用意し渡す）。 */
export function drawSpectrumAndWaveform(ctx, w, h, analyser) {
  clearPanel(ctx, w, h);
  const timeBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(timeBuf);
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqBuf);

  const halfH = h / 2;

  // 上半分: 波形
  ctx.strokeStyle = '#7cf';
  ctx.beginPath();
  const showN = Math.min(timeBuf.length, 2048);
  for (let i = 0; i < showN; i++) {
    const px = (i / showN) * w;
    const py = halfH / 2 - timeBuf[i] * (halfH / 2 - 4);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // 下半分: スペクトル（バー）
  ctx.fillStyle = '#f96';
  const nBins = Math.min(freqBuf.length, 512);
  const barW = w / nBins;
  for (let i = 0; i < nBins; i++) {
    const v = freqBuf[i] / 255;
    const barH = v * (halfH - 4);
    ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 1), barH);
  }
}
