// 起動・AudioContext・worklet ロード・配線（2出力 + AnalyserNode）。
// 手順2: 固定パラメータで音が出ることを目標にする。スライダー等は手順3以降。

const warningEl = document.getElementById('warning');
const startBtn = document.getElementById('startBtn');
const noteBtn = document.getElementById('noteBtn');
const statusEl = document.getElementById('status');

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
    } else if (msg.type === 'diverged') {
      console.warn('[reed-tube] diverged: 発散ガードが作動しました');
    }
  };

  startBtn.disabled = true;
  noteBtn.disabled = false;
  setStatus('起動しました。');

  // デバッグ用（開発時のコンソール確認・自動テスト用）
  window.__debug = { audioCtx, workletNode, analyser };
}

// 固定パラメータでのノートオン/オフ（手順2 の動作確認用。実際の MIDI 配線は手順4）
let noteOn = false;
function toggleNote() {
  if (!workletNode) return;
  const now = audioCtx.currentTime;
  const gammaParam = workletNode.parameters.get('gamma');
  const gateParam = workletNode.parameters.get('gate');
  const tubeLengthParam = workletNode.parameters.get('tubeLength');

  if (!noteOn) {
    tubeLengthParam.setValueAtTime(0.6, now); // A2 相当（f0 ≈ 143Hz）
    gammaParam.setTargetAtTime(0.5, now, 20 / 3000);
    gateParam.setTargetAtTime(1.0, now, 20 / 3000); // attack 20ms
    noteBtn.textContent = 'テスト音（ノートオフ）';
    noteOn = true;
  } else {
    gateParam.setTargetAtTime(0.0, now, 80 / 3000); // release 80ms
    noteBtn.textContent = 'テスト音（ノートオン/オフ）';
    noteOn = false;
  }
}

startBtn.addEventListener('click', start);
noteBtn.addEventListener('click', toggleNote);
