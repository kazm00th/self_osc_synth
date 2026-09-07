// 起動・AudioContext・worklet ロード・配線（2出力 + AnalyserNode）。
// 手順4: MIDI / QWERTY 配線、裏返りインジケータ（f0 推定）。

import { manualParams, GAMMA_BASE_MIN, GAMMA_BASE_MAX, GAMMA_CEILING, C_SOUND } from './params.js';
import {
  buildParamSliders,
  buildEnvelopeControls,
  buildOversampleControl,
  buildExpressionSourceControl,
} from './ui.js';
import { createMidiController, connectWebMidi, attachQwertyFallback } from './midi.js';
import { estimateF0 } from './pitch.js';
import { drawReedPhase, drawNonlinearCharacteristic, drawStandingWave, drawSpectrumAndWaveform } from './scope.js';

const panel1 = document.getElementById('panel1');
const panel2 = document.getElementById('panel2');
const panel3 = document.getElementById('panel3');
const panel4 = document.getElementById('panel4');
const ctx1 = panel1.getContext('2d');
const ctx2 = panel2.getContext('2d');
const ctx3 = panel3.getContext('2d');
const ctx4 = panel4.getContext('2d');

const paramRateById = new Map(manualParams().map((p) => [p.id, p.rate]));
const controlsEl = document.getElementById('controls');

const envelope = { attack: 20, release: 80 };

const warningEl = document.getElementById('warning');
const startBtn = document.getElementById('startBtn');
const noteBtn = document.getElementById('noteBtn');
const statusEl = document.getElementById('status');
const noteStatusEl = document.getElementById('noteStatus');
const pitchIndicatorEl = document.getElementById('pitchIndicator');

function setStatus(text) {
  statusEl.textContent = text;
}

// §8: file:// で開かれたら Web MIDI 等が動かないので警告する
if (location.protocol === 'file:') {
  warningEl.hidden = false;
  warningEl.textContent =
    'file:// で開いています。serve.py 経由（http://localhost:8000/）で開いてください。' +
    'Web MIDI や AudioWorklet の一部機能は secure context が必要です。';
}

let audioCtx = null;
let workletNode = null;
let analyser = null;
let midiController = null;
let currentTubeLength = 0.6; // f0 期待値の計算用（スライダー/ノートで更新）
let currentZeta = 0.25; // パネル2の準静的特性曲線の描画に使う

async function start() {
  if (audioCtx) return;

  if (!window.AudioWorkletNode) {
    setStatus('AudioWorklet 非対応のブラウザです。');
    return;
  }

  audioCtx = new AudioContext();
  try {
    await audioCtx.audioWorklet.addModule('worklet/reed-tube-processor.js');
  } catch (err) {
    setStatus('worklet の読み込みに失敗しました: ' + err.message);
    return;
  }

  workletNode = new AudioWorkletNode(audioCtx, 'reed-tube', {
    numberOfInputs: 0,
    numberOfOutputs: 2,
    outputChannelCount: [1, 1],
  });

  // out[0] = 放射音 → destination
  workletNode.connect(audioCtx.destination, 0);

  // out[1] = p̃（内部量） → AnalyserNode のみ。destination へは繋がない（§3）
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048; // R60: 最短管 71.5Hz の自己相関に必要な最小長
  workletNode.connect(analyser, 1);

  workletNode.port.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'snapshot') {
      setStatus(
        `fsInternal=${msg.fsInternal} cpu=${(msg.cpu * 100).toFixed(1)}% ` +
          `perfAvailable=${msg.perfAvailable}`
      );
      drawReedPhase(ctx1, panel1.width, panel1.height, msg);
      drawNonlinearCharacteristic(ctx2, panel2.width, panel2.height, msg, currentZeta);
      drawStandingWave(ctx3, panel3.width, panel3.height, msg);
    } else if (msg.type === 'diverged') {
      console.warn('[reed-tube] diverged: 発散ガードが作動しました');
    }
  };

  buildParamSliders(controlsEl, (id, value) => {
    const param = workletNode.parameters.get(id);
    const rate = paramRateById.get(id);
    const now = audioCtx.currentTime;
    if (rate === 'a-rate') {
      // tubeLength は worklet 内部で τ_D=15ms グライドするので即値でよい（§4.5）
      param.setValueAtTime(value, now);
      if (id === 'tubeLength') currentTubeLength = value;
    } else {
      // k-rate: ジッパーノイズを避けるため短い時定数で滑らかに
      param.setTargetAtTime(value, now, 0.01);
      if (id === 'zeta') currentZeta = value;
    }
  });

  buildEnvelopeControls(controlsEl, (id, ms) => {
    envelope[id] = ms;
  });

  buildOversampleControl(controlsEl, (factor) => {
    workletNode.port.postMessage({ type: 'setOversample', factor });
  });

  buildExpressionSourceControl(controlsEl, (id) => {
    midiController.setExpressionSource(id);
  });

  midiController = createMidiController(workletNode, audioCtx, {
    getEnvelope: () => ({ attackMs: envelope.attack, releaseMs: envelope.release }),
    gammaConstants: { gammaBaseMin: GAMMA_BASE_MIN, gammaBaseMax: GAMMA_BASE_MAX, gammaCeiling: GAMMA_CEILING },
    onNoteChange: (text) => {
      noteStatusEl.textContent = text;
      const m = /L=([\d.]+)m/.exec(text);
      if (m) currentTubeLength = Number(m[1]);
    },
  });

  const midiAccess = await connectWebMidi(midiController);
  if (!midiAccess) {
    noteStatusEl.textContent += '（Web MIDI 非対応/拒否。QWERTY代替: z s x d c v g b h n j m ...）';
  }
  attachQwertyFallback(midiController, document);

  startVisualLoop();

  startBtn.disabled = true;
  noteBtn.disabled = false;
  setStatus('起動しました。');

  // デバッグ用（開発時のコンソール確認・自動テスト用）
  window.__debug = { audioCtx, workletNode, analyser, envelope, midiController };
}

// 裏返りインジケータ（§6: 管の f0（=c/4L）/ 実際に鳴っている f0 / 比）+ パネル4（30fps 目安）
function startVisualLoop() {
  const buf = new Float32Array(analyser.fftSize);
  function tick() {
    if (analyser) {
      analyser.getFloatTimeDomainData(buf);
      const measured = estimateF0(buf, audioCtx.sampleRate);
      const expected = C_SOUND / (4 * currentTubeLength);
      const ratio = measured / expected;
      pitchIndicatorEl.textContent = `管f0=${expected.toFixed(1)}Hz 実f0=${measured.toFixed(1)}Hz 比=${ratio.toFixed(2)}`;
      drawSpectrumAndWaveform(ctx4, panel4.width, panel4.height, analyser);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// 固定パラメータでのノートオン/オフ（動作確認用ボタン）
let noteBtnOn = false;
function toggleNote() {
  if (!midiController) return;
  if (!noteBtnOn) {
    midiController.noteOn(69, 100); // A4
    noteBtn.textContent = 'テスト音（ノートオフ）';
    noteBtnOn = true;
  } else {
    midiController.noteOff(69);
    noteBtn.textContent = 'テスト音（ノートオン/オフ）';
    noteBtnOn = false;
  }
}

startBtn.addEventListener('click', start);
noteBtn.addEventListener('click', toggleNote);
