// Web MIDI、ノート→管長、γ 写像、表現ソース切替、QWERTY 代替（§6）。
// noteToLength / computeGammaTarget はブラウザ非依存の純関数として named export する
// （過去に R6・R10 で実際に誤った箇所のため、ここだけ切り出してテストする。§3）。

import { C_SOUND } from './params.js';

const L_MIN = 0.15;
const L_MAX = 1.2;

/**
 * MIDI ノート番号 → 管長 L（m）。§6。
 * f = 440*2^((n-69)/12)、L = c/(4f)。L ∈ [0.15, 1.2] にクランプする。
 */
export function noteToLength(note) {
  const f = 440 * Math.pow(2, (note - 69) / 12);
  const L = C_SOUND / (4 * f);
  return Math.min(Math.max(L, L_MIN), L_MAX);
}

/**
 * ベロシティ・表現ソースから γ_target を計算する（§6）。
 * ソースごとに写像が異なる — 同一写像にすると3択が実質2種に退化し、
 * ブレスの物理的意味（息＝吹圧）が失われる（R26）。
 *
 * @param {number} velocity01 [0,1]
 * @param {number} expr01 [0,1]
 * @param {'breath'|'modulation'|'none'} source
 * @param {{gammaBaseMin:number, gammaBaseMax:number, gammaCeiling:number}} constants
 *   params.js から読む（テスト側にハードコードしない。手順6 で値が変わるため。R62）
 */
export function computeGammaTarget(velocity01, expr01, source, constants) {
  const { gammaBaseMin, gammaBaseMax, gammaCeiling } = constants;
  const gammaBase = gammaBaseMin + velocity01 * (gammaBaseMax - gammaBaseMin);

  if (source === 'breath') {
    // ブレス選択時は velocity01 を使わない（R56）。息のエンベロープがそのまま吹圧。
    return expr01 * gammaCeiling;
  }
  if (source === 'modulation') {
    return gammaBase + expr01 * (gammaCeiling - gammaBase);
  }
  // 'none': gammaBase のみ（expr01 に依存しない）
  return gammaBase;
}

/**
 * MIDI ベロシティ 0 のノートオンはノートオフとして扱う（MIDI の慣例。§6）。
 * @param {number} velocity 0-127
 */
export function isNoteOffVelocity(velocity) {
  return velocity <= 0;
}

// --- ここから下はブラウザ依存（Web MIDI / DOM）。node --test では呼ばれない ---

const CC_BREATH = 2;
const CC_MODULATION = 1;

/**
 * モノフォニック・後着優先のノートコントローラ（§6）。
 * 押している鍵のスタックを持ち、離すと直前の音へ戻る（レガート）。
 * AudioParam のスケジューリングはここで完結させ、main.js は生成した
 * インスタンスに noteOn/noteOff/setExpressionCC/setExpressionSource を渡すだけでよい。
 *
 * @param {AudioWorkletNode} workletNode
 * @param {AudioContext} audioCtx
 * @param {object} opts
 * @param {() => {attackMs:number, releaseMs:number}} opts.getEnvelope
 * @param {{gammaBaseMin:number, gammaBaseMax:number, gammaCeiling:number}} opts.gammaConstants
 * @param {(text:string) => void} [opts.onNoteChange] UI表示用（現在のノート・γ_target等）
 */
export function createMidiController(workletNode, audioCtx, opts) {
  const { getEnvelope, gammaConstants } = opts;
  const onNoteChange = opts.onNoteChange ?? (() => {});

  const heldNotes = []; // 後ろが最新（後着優先）
  let expressionSource = 'none';
  let expr01 = 0; // CC / 127

  const gammaParam = () => workletNode.parameters.get('gamma');
  const gateParam = () => workletNode.parameters.get('gate');
  const tubeLengthParam = () => workletNode.parameters.get('tubeLength');

  function currentSoundingNote() {
    return heldNotes.length > 0 ? heldNotes[heldNotes.length - 1] : null;
  }

  function applyGammaTarget(velocity01) {
    const now = audioCtx.currentTime;
    const g = computeGammaTarget(velocity01, expr01, expressionSource, gammaConstants);
    // §5: gamma の τ=20ms は CC の128段量子化を均す役。過渡は gate 側が作る（R57）
    gammaParam().setTargetAtTime(g, now, 20 / 3000);
    return g;
  }

  function applyGate(target, timeConstantMs) {
    const now = audioCtx.currentTime;
    gateParam().setTargetAtTime(target, now, timeConstantMs / 3000);
  }

  function retune(note) {
    tubeLengthParam().setValueAtTime(noteToLength(note), audioCtx.currentTime);
  }

  /** @param {number} note @param {number} velocity 0-127 */
  function noteOn(note, velocity) {
    if (isNoteOffVelocity(velocity)) {
      noteOff(note);
      return;
    }
    const wasSilent = heldNotes.length === 0;
    const idx = heldNotes.indexOf(note);
    if (idx !== -1) heldNotes.splice(idx, 1);
    heldNotes.push(note);

    const velocity01 = velocity / 127;
    retune(note);
    const g = applyGammaTarget(velocity01);

    if (expressionSource === 'breath') {
      // §6: gate はノート在否のマスク（0/1、2msランプ）。attack/release は使わない
      applyGate(1, 2);
    } else {
      const { attackMs, releaseMs } = getEnvelope();
      applyGate(1, wasSilent ? attackMs : Math.min(attackMs, 5)); // レガートは短めで滑らかに繋ぐ
      void releaseMs;
    }

    onNoteChange(`note=${note} L=${noteToLength(note).toFixed(4)}m gamma=${g.toFixed(3)} legato=${!wasSilent}`);
  }

  /** @param {number} note */
  function noteOff(note) {
    const idx = heldNotes.indexOf(note);
    if (idx !== -1) heldNotes.splice(idx, 1);

    const next = currentSoundingNote();
    if (next != null) {
      // レガート: 直前の音へ戻る。ゲートは維持したまま管長だけ切替える
      retune(next);
      onNoteChange(`note=${next} L=${noteToLength(next).toFixed(4)}m（レガート復帰）`);
      return;
    }

    if (expressionSource === 'breath') {
      applyGate(0, 2);
    } else {
      const { releaseMs } = getEnvelope();
      applyGate(0, releaseMs);
    }
    onNoteChange('（無音）');
  }

  function setExpressionSource(source) {
    expressionSource = source;
  }

  /** @param {number} ccNumber @param {number} value 0-127 */
  function setExpressionCC(ccNumber, value) {
    if (
      (expressionSource === 'breath' && ccNumber !== CC_BREATH) ||
      (expressionSource === 'modulation' && ccNumber !== CC_MODULATION)
    ) {
      return;
    }
    expr01 = value / 127;
    const note = currentSoundingNote();
    if (note != null) {
      const velocity01 = 0; // 直近ベロシティは保持していない簡易実装。§6 のブレス経路では未使用
      applyGammaTarget(velocity01);
    }
  }

  return { noteOn, noteOff, setExpressionSource, setExpressionCC, heldNotes };
}

/**
 * Web MIDI アクセスを要求し、onmidimessage を controller に配線する。
 * 非対応/拒否時は null を返す（呼び出し側で QWERTY フォールバックへ）。
 * @param {ReturnType<typeof createMidiController>} controller
 */
export async function connectWebMidi(controller) {
  if (!navigator.requestMIDIAccess) return null;
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return null;
  }

  function bind(input) {
    input.onmidimessage = (event) => {
      const [status, d1, d2] = event.data;
      const type = status & 0xf0;
      if (type === 0x90) {
        controller.noteOn(d1, d2);
      } else if (type === 0x80) {
        controller.noteOff(d1);
      } else if (type === 0xb0) {
        controller.setExpressionCC(d1, d2);
      }
    };
  }

  for (const input of access.inputs.values()) bind(input);
  access.onstatechange = () => {
    for (const input of access.inputs.values()) bind(input);
  };

  return access;
}

// QWERTY 代替（z s x d c ... の半音配列。C4=60 起点）
const QWERTY_KEY_TO_NOTE = {
  z: 60, s: 61, x: 62, d: 63, c: 64, v: 65, g: 66, b: 67, h: 68, n: 69, j: 70, m: 71,
  q: 72, 2: 73, w: 74, 3: 75, e: 76, r: 77, 5: 78, t: 79, 6: 80, y: 81, 7: 82, u: 83,
};

/**
 * QWERTY キーボードを鍵盤の代わりに使う（§6 フォールバック）。
 * @param {ReturnType<typeof createMidiController>} controller
 * @param {Document} doc
 */
export function attachQwertyFallback(controller, doc) {
  const DEFAULT_VELOCITY = 100;
  const down = new Set();
  doc.addEventListener('keydown', (e) => {
    const note = QWERTY_KEY_TO_NOTE[e.key.toLowerCase()];
    if (note == null || down.has(note) || e.repeat) return;
    down.add(note);
    controller.noteOn(note, DEFAULT_VELOCITY);
  });
  doc.addEventListener('keyup', (e) => {
    const note = QWERTY_KEY_TO_NOTE[e.key.toLowerCase()];
    if (note == null) return;
    down.delete(note);
    controller.noteOff(note);
  });
}
