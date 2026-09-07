import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateF0 } from '../src/pitch.js';

const FS = 48000;

function makeSignal(fs, durationSec, harmonics, dcOffset = 0) {
  const n = Math.floor(fs * durationSec);
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = dcOffset;
    for (const [freq, amp] of harmonics) {
      v += amp * Math.sin((2 * Math.PI * freq * i) / fs);
    }
    buf[i] = v;
  }
  return buf;
}

test('test27a: f + 3f(+6dB) + 5f + DC オフセットで f を返す（R2の失敗モード）', () => {
  const f = 220;
  const amp3f = Math.pow(10, 6 / 20); // +6dB
  const buf = makeSignal(FS, 0.06, [
    [f, 1.0],
    [3 * f, amp3f],
    [5 * f, 0.5],
  ], 0.3);
  const f0 = estimateF0(buf, FS);
  const relErr = Math.abs(f0 - f) / f;
  assert.ok(relErr < 0.02, `f0=${f0} expected=${f} relErr=${relErr}`);
});

test('test27b: 最長管 71Hz と最短管 572Hz の両端で正しく推定できる', () => {
  for (const f of [71, 572]) {
    const buf = makeSignal(FS, 0.06, [[f, 1.0], [3 * f, 0.3]]);
    const f0 = estimateF0(buf, FS);
    const relErr = Math.abs(f0 - f) / f;
    assert.ok(relErr < 0.02, `f=${f} f0=${f0} relErr=${relErr}`);
  }
});

test('test27c: 第2レジスタ相当（3fが新たな基音）で 3f を返す', () => {
  // 注意: 3f, 5f は元の f の奇数倍音なので、その合成波の真の周期は f のまま
  // （GCD(3f,5f)=f）— それは register-jump を表さない。register-jump では
  // リードが 3f 自体に自己共鳴でロックし、3f を新たな基音として
  // その倍音列（3f, 6f, 9f...）を持つ波形になる。
  const f = 143; // 元のノートの基音相当
  const newFundamental = 3 * f;
  const buf = makeSignal(FS, 0.06, [
    [newFundamental, 1.0],
    [2 * newFundamental, 0.4],
  ]);
  const f0 = estimateF0(buf, FS);
  const relErr = Math.abs(f0 - newFundamental) / newFundamental;
  assert.ok(relErr < 0.02, `f0=${f0} expected=${newFundamental} relErr=${relErr}`);
});

test('test27d: 比の判定が1近傍/3近傍で正しく分かれる', () => {
  const fRef = 200;
  const buf1 = makeSignal(FS, 0.06, [[fRef, 1.0], [3 * fRef, 0.3]]);
  const buf3 = makeSignal(FS, 0.06, [[3 * fRef, 1.0], [6 * fRef, 0.3]]);

  const ratio1 = estimateF0(buf1, FS) / fRef;
  const ratio3 = estimateF0(buf3, FS) / fRef;

  assert.ok(Math.abs(ratio1 - 1) < 0.1, `ratio1=${ratio1}`);
  assert.ok(Math.abs(ratio3 - 3) < 0.1, `ratio3=${ratio3}`);
});
