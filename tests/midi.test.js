import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteToLength, computeGammaTarget, isNoteOffVelocity, createMidiController } from '../src/midi.js';
import { GAMMA_BASE_MIN, GAMMA_BASE_MAX, GAMMA_CEILING } from '../src/params.js';

// createMidiController はブラウザ依存（AudioParam/AudioContext）だが、
// ロジック自体は薄いモックで node --test から検証できる。
function makeFakeParam() {
  return {
    value: 0,
    setValueAtTime(v) { this.value = v; },
    setTargetAtTime(v) { this.value = v; },
  };
}
function makeFakeWorkletNode() {
  const params = new Map([
    ['gamma', makeFakeParam()],
    ['gate', makeFakeParam()],
    ['tubeLength', makeFakeParam()],
  ]);
  return { parameters: { get: (id) => params.get(id) } };
}
function makeFakeAudioCtx() {
  return { currentTime: 0 };
}
function makeGammaConstants() {
  return { gammaBaseMin: GAMMA_BASE_MIN, gammaBaseMax: GAMMA_BASE_MAX, gammaCeiling: GAMMA_CEILING };
}

const C_SOUND = 343;

test('test25: noteToLength — クランプ境界と L=c/(4f) の正しさ', () => {
  // クランプが効かない範囲での式の正しさ（A4=69, 440Hz）
  const expectedA4 = C_SOUND / (4 * 440);
  assert.ok(Math.abs(noteToLength(69) - expectedA4) < 1e-9);

  // 37: L(37) > 1.2m のはずなのでクランプされ、ちょうど 1.2 になる
  assert.equal(noteToLength(37), 1.2);
  // 38: クランプされない（L(38) < 1.2）
  assert.ok(noteToLength(38) < 1.2);

  // 74: L(74) < 0.15m のはずなのでクランプされ、ちょうど 0.15 になる
  assert.equal(noteToLength(74), 0.15);
  // 73: クランプされない（L(73) > 0.15）
  assert.ok(noteToLength(73) > 0.15);

  // さらに外側でも同じ値にクランプされたまま
  assert.equal(noteToLength(0), 1.2);
  assert.equal(noteToLength(127), 0.15);
});

test('test26: computeGammaTarget — 不変条件・ソース別写像・単調性・velocity=0扱い', () => {
  const constants = { gammaBaseMin: GAMMA_BASE_MIN, gammaBaseMax: GAMMA_BASE_MAX, gammaCeiling: GAMMA_CEILING };

  // 順序不変条件（R48）
  assert.ok(GAMMA_BASE_MIN < GAMMA_BASE_MAX);
  assert.ok(GAMMA_BASE_MAX < GAMMA_CEILING);
  assert.ok(GAMMA_CEILING <= 0.95);

  // 不変条件: γ_target <= γ_ceiling < 1.0（全ソース・全入力で）
  for (const source of ['breath', 'modulation', 'none']) {
    for (const v of [0, 0.5, 1]) {
      for (const e of [0, 0.5, 1]) {
        const g = computeGammaTarget(v, e, source, constants);
        assert.ok(g <= GAMMA_CEILING + 1e-12, `source=${source} v=${v} e=${e} g=${g}`);
        assert.ok(g < 1.0);
      }
    }
  }

  // ブレス: expr01=0 → 0、単調増加、上限 gammaCeiling
  assert.equal(computeGammaTarget(0.5, 0, 'breath', constants), 0);
  assert.ok(
    computeGammaTarget(0.5, 0.5, 'breath', constants) < computeGammaTarget(0.5, 1.0, 'breath', constants)
  );
  assert.ok(Math.abs(computeGammaTarget(0.5, 1.0, 'breath', constants) - GAMMA_CEILING) < 1e-9);
  // ブレスは velocity01 に依存しない
  assert.equal(
    computeGammaTarget(0.1, 0.7, 'breath', constants),
    computeGammaTarget(0.9, 0.7, 'breath', constants)
  );

  // モジュレーション: expr01=0 → gammaBase、単調増加
  const gammaBaseAtV = (v) => GAMMA_BASE_MIN + v * (GAMMA_BASE_MAX - GAMMA_BASE_MIN);
  assert.ok(Math.abs(computeGammaTarget(0.5, 0, 'modulation', constants) - gammaBaseAtV(0.5)) < 1e-9);
  assert.ok(
    computeGammaTarget(0.5, 0.3, 'modulation', constants) < computeGammaTarget(0.5, 0.7, 'modulation', constants)
  );

  // なし: gammaBase のみ（expr01 に依存しない）
  assert.ok(Math.abs(computeGammaTarget(0.5, 0, 'none', constants) - gammaBaseAtV(0.5)) < 1e-9);
  assert.equal(
    computeGammaTarget(0.5, 0.2, 'none', constants),
    computeGammaTarget(0.5, 0.9, 'none', constants)
  );

  // velocity01 に対する単調性（modulation/none）
  assert.ok(
    computeGammaTarget(0.2, 0, 'none', constants) < computeGammaTarget(0.8, 0, 'none', constants)
  );

  // velocity=0 はノートオフ扱い（MIDI の慣例）
  assert.equal(isNoteOffVelocity(0), true);
  assert.equal(isNoteOffVelocity(1), false);
  assert.equal(isNoteOffVelocity(127), false);
});

test('createMidiController: 表現ソース=なし の状態で CC を送っても gamma が変化しない（回帰）', () => {
  const workletNode = makeFakeWorkletNode();
  const audioCtx = makeFakeAudioCtx();
  const controller = createMidiController(workletNode, audioCtx, {
    getEnvelope: () => ({ attackMs: 20, releaseMs: 80 }),
    gammaConstants: makeGammaConstants(),
  });

  controller.setExpressionSource('none');
  controller.noteOn(60, 100); // velocity01 = 100/127
  const gammaAfterNoteOn = workletNode.parameters.get('gamma').value;

  controller.setExpressionCC(1, 64); // モジュレーションホイールを動かす（source は 'none'）
  const gammaAfterCC = workletNode.parameters.get('gamma').value;

  assert.equal(gammaAfterCC, gammaAfterNoteOn, `CCで変化してはいけない: before=${gammaAfterNoteOn} after=${gammaAfterCC}`);
});

test('createMidiController: モジュレーションモードでCCを送ってもベロシティ由来のgammaBaseは保持される（回帰）', () => {
  const workletNode = makeFakeWorkletNode();
  const audioCtx = makeFakeAudioCtx();
  const controller = createMidiController(workletNode, audioCtx, {
    getEnvelope: () => ({ attackMs: 20, releaseMs: 80 }),
    gammaConstants: makeGammaConstants(),
  });

  controller.setExpressionSource('modulation');
  controller.noteOn(60, 127); // velocity01 = 1（最大）

  controller.setExpressionCC(1, 0); // ホイール最小 = expr01=0 → gammaBase のはず
  const g = workletNode.parameters.get('gamma').value;
  const expectedGammaBase = GAMMA_BASE_MIN + 1 * (GAMMA_BASE_MAX - GAMMA_BASE_MIN); // velocity01=1
  assert.ok(
    Math.abs(g - expectedGammaBase) < 1e-9,
    `velocity由来のgammaBaseが失われている: g=${g} expected=${expectedGammaBase}`
  );
});

test('createMidiController: ブレスモードは velocity に関係なく CC2 の値がそのまま反映される', () => {
  const workletNode = makeFakeWorkletNode();
  const audioCtx = makeFakeAudioCtx();
  const controller = createMidiController(workletNode, audioCtx, {
    getEnvelope: () => ({ attackMs: 20, releaseMs: 80 }),
    gammaConstants: makeGammaConstants(),
  });

  controller.setExpressionSource('breath');
  controller.noteOn(60, 1); // velocity01 は breath では無視されるはず（最小ベロシティで弾く）

  controller.setExpressionCC(2, 64); // CC2（ブレス）
  const g1 = workletNode.parameters.get('gamma').value;
  const expected1 = (64 / 127) * GAMMA_CEILING;
  assert.ok(Math.abs(g1 - expected1) < 1e-9, `g1=${g1} expected=${expected1}`);

  // 別ノートを最大velocityで弾き直しても、breathではvelocityの影響を受けない
  controller.noteOff(60);
  controller.noteOn(62, 127);
  controller.setExpressionCC(2, 64); // 同じCC値
  const g2 = workletNode.parameters.get('gamma').value;
  assert.ok(Math.abs(g2 - expected1) < 1e-9, `velocityの影響を受けてしまっている: g2=${g2}`);
});

test('createMidiController: CC1/CC2 のクロス混入がない（modulation中のCC2、breath中のCC1は無視）', () => {
  const workletNode = makeFakeWorkletNode();
  const audioCtx = makeFakeAudioCtx();
  const controller = createMidiController(workletNode, audioCtx, {
    getEnvelope: () => ({ attackMs: 20, releaseMs: 80 }),
    gammaConstants: makeGammaConstants(),
  });

  controller.setExpressionSource('modulation');
  controller.noteOn(60, 100);
  const gBefore = workletNode.parameters.get('gamma').value;
  controller.setExpressionCC(2, 100); // CC2はmodulationモードでは無関係のはず
  assert.equal(workletNode.parameters.get('gamma').value, gBefore, 'modulation中にCC2で変化してしまった');

  controller.setExpressionSource('breath');
  const gBefore2 = workletNode.parameters.get('gamma').value;
  controller.setExpressionCC(1, 100); // CC1はbreathモードでは無関係のはず
  assert.equal(workletNode.parameters.get('gamma').value, gBefore2, 'breath中にCC1で変化してしまった');
});
