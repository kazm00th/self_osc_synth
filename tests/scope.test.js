import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineStandingWave } from '../src/scope.js';

test('test32: z=0(リード端)はpPlus[0]、z=nTube-1(ベル端寄り)はpMinus[0]の寄与を受ける', () => {
  // p⁺ はバッファ先頭(index 0)がリード端寄り、p⁻ は先頭がベル端寄り（§7）。
  // 単一の非ゼロ要素（基底ベクトル）を使い、combineStandingWave が
  // 反転込みで正しい z 位置へ写像することを直接検証する。
  const nTube = 84;

  // p⁺[0]=1（リード端で発生した波）だけを立てる。p⁻=0。
  {
    const pPlus = new Float32Array(256);
    const pMinus = new Float32Array(256);
    pPlus[0] = 1;
    const combined = combineStandingWave(pPlus, pMinus, nTube);
    // z=0（リード端）に現れるはず
    assert.equal(combined[0], 1);
    for (let z = 1; z < nTube; z++) assert.equal(combined[z], 0);
  }

  // p⁻[0]=1（ベル端で今まさに反射した波）だけを立てる。p⁺=0。
  {
    const pPlus = new Float32Array(256);
    const pMinus = new Float32Array(256);
    pMinus[0] = 1;
    const combined = combineStandingWave(pPlus, pMinus, nTube);
    // 反転により z=nTube-1（ベル端側）に現れるはず。
    // 反転しない実装（R53のバグ）だと z=0 に出てしまう。
    assert.equal(combined[nTube - 1], 1);
    for (let z = 0; z < nTube - 1; z++) assert.equal(combined[z], 0);
  }
});

test('test32b: 既知の定在波パターンで振幅プロファイルが物理的に妥当', () => {
  // p⁺, p⁻ とも同じ空間プロファイル sin(2πz/T) を与える
  // （進行波の瞬時空間分布として妥当な形）。合成結果が z に対して
  // 滑らかな定在波状（単調に増減する連続関数）になっていることを確認する
  // （反転漏れがあると不連続な折れ方になり、単調区間の数が変わる）。
  const nTube = 84;
  const T = 4 * nTube;
  const pPlus = new Float32Array(256);
  const pMinus = new Float32Array(256);
  for (let z = 0; z < nTube; z++) {
    pPlus[z] = Math.sin((2 * Math.PI * z) / T);
    pMinus[z] = Math.sin((2 * Math.PI * z) / T);
  }
  const combined = combineStandingWave(pPlus, pMinus, nTube);

  // 解析解: sin(2πz/T) + sin(2π(nTube-1-z)/T)
  //       = 2 sin(π(nTube-1)/T) cos(π(2z-(nTube-1))/T)
  for (let z = 0; z < nTube; z++) {
    const expected =
      2 * Math.sin((Math.PI * (nTube - 1)) / T) * Math.cos((Math.PI * (2 * z - (nTube - 1))) / T);
    // pPlus/pMinus は Float32Array なので float32 精度までの一致を見る
    assert.ok(Math.abs(combined[z] - expected) < 1e-6, `z=${z}: combined=${combined[z]} expected=${expected}`);
  }
});

test('combineStandingWave: pMinus が反転されずに使われるとテストが破れる（回帰確認）', () => {
  const nTube = 84;
  const pPlus = new Float32Array(256);
  const pMinus = new Float32Array(256);
  pMinus[0] = 1;

  const buggy = new Float64Array(nTube);
  for (let z = 0; z < nTube; z++) buggy[z] = pPlus[z] + pMinus[z]; // 反転なし

  const correct = combineStandingWave(pPlus, pMinus, nTube);

  assert.notEqual(buggy[0], correct[0]);
  assert.notEqual(buggy[nTube - 1], correct[nTube - 1]);
});
