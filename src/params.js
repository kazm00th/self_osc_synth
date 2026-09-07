// パラメータ定義表（設計書 §5）。UI（ui.js）はここから生成する。
// パラメータ追加 = この配列に1行足すだけでよい。
//
// manualUI: false の項目（gamma, gate）は worklet の AudioParam としては存在するが、
// §6 の設計どおり MIDI ノート・ベロシティ・表現ソースから midi.js が計算して書き込む
// 値であり、スライダーとしては生成しない（§7 のレイアウトに γ スライダーの記載はない）。

export const PARAMS = [
  {
    id: 'gamma',
    label: '吹圧 γ（目標値）',
    min: 0,
    max: 1.0,
    default: 0,
    rate: 'a-rate',
    group: '吹圧・アンブシュア',
    manualUI: false,
  },
  {
    id: 'gate',
    label: 'ノート包絡',
    min: 0,
    max: 1.0,
    default: 0,
    rate: 'a-rate',
    group: '吹圧・アンブシュア',
    manualUI: false,
  },
  {
    id: 'zeta',
    label: 'リード開口 ζ（アンブシュア）',
    min: 0.05,
    max: 0.8,
    default: 0.25,
    step: 0.01,
    rate: 'k-rate',
    group: '吹圧・アンブシュア',
    manualUI: true,
  },
  {
    id: 'tubeLength',
    label: '管長 L',
    min: 0.15,
    max: 1.2,
    default: 0.6,
    step: 0.001,
    unit: 'm',
    rate: 'a-rate',
    group: '管',
    manualUI: true,
  },
  {
    id: 'reedFreq',
    label: 'リード共鳴 f_r',
    min: 300,
    max: 5000,
    default: 2200,
    step: 1,
    unit: 'Hz',
    rate: 'k-rate',
    group: 'リード',
    manualUI: true,
  },
  {
    id: 'reedQ',
    label: 'リード Q',
    min: 0.5,
    max: 20,
    default: 3,
    step: 0.1,
    rate: 'k-rate',
    group: 'リード',
    manualUI: true,
  },
  {
    id: 'contactQ',
    label: '接触時の減衰倍率',
    min: 1,
    max: 20,
    default: 4,
    step: 0.1,
    unit: '×',
    rate: 'k-rate',
    group: 'リード',
    manualUI: true,
  },
  {
    id: 'bellCutoff',
    label: 'ベル反射カットオフ',
    min: 200,
    max: 5000,
    default: 1500,
    step: 1,
    unit: 'Hz',
    rate: 'k-rate',
    group: '管',
    manualUI: true,
  },
  {
    id: 'wallLoss',
    label: '管壁損失（1往復ゲイン）',
    min: 0.9,
    max: 1.0,
    default: 0.995,
    step: 0.001,
    rate: 'k-rate',
    group: '管',
    manualUI: true,
  },
  {
    id: 'noise',
    label: '乱流ノイズ',
    min: 0,
    max: 0.05,
    default: 0.008,
    step: 0.001,
    rate: 'k-rate',
    group: '吹圧・アンブシュア',
    manualUI: true,
  },
];

/** manualUI な（スライダーを生成する）パラメータだけを返す。 */
export function manualParams() {
  return PARAMS.filter((p) => p.manualUI);
}

/** グループ名 → パラメータ配列。ui.js のレイアウト（§7: 吹圧・アンブシュア/リード/管）用。 */
export function paramsByGroup() {
  const groups = new Map();
  for (const p of manualParams()) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  return groups;
}

// UI のみ（AudioParam ではない）。§5。
export const ATTACK_PARAM = { id: 'attack', label: 'アタック', min: 1, max: 500, default: 20, unit: 'ms' };
export const RELEASE_PARAM = { id: 'release', label: 'リリース', min: 1, max: 1000, default: 80, unit: 'ms' };

export const OVERSAMPLE_OPTIONS = [1, 2];
export const OVERSAMPLE_DEFAULT = 1; // 暫定。手順6のCPU実測で確定する（§4.6, HANDOVER §6）

export const EXPRESSION_SOURCES = [
  { id: 'breath', label: 'ブレス (CC2)' },
  { id: 'modulation', label: 'モジュレーション (CC1)' },
  { id: 'none', label: 'なし' },
];
export const EXPRESSION_SOURCE_DEFAULT = 'none';

// 物理単位の目安換算（§5: 較正された測定値ではない）。
export const P_M_KPA = 5; // p_M ≈ 5 kPa 仮定
export const C_SOUND = 343; // m/s, 20°C

// γ 定数（§5, §6）。手順6 の実測（発振閾値 γ_th_osc・跳躍閾値 γ_th_jump）で確定する
// までは暫定値。**測定前にこれらを「正しい」と扱わない**（HANDOVER §6）。
// 順序不変条件: γ_th_osc < GAMMA_BASE_MIN < GAMMA_BASE_MAX < γ_th_jump < GAMMA_CEILING ≤ 0.95（R48）。
// GAMMA_BASE_MIN は既定パラメータでのみ校正される（R49）。
export const GAMMA_BASE_MIN = 0.4; // 暫定。実測発振閾値 + マージンで確定する
export const GAMMA_BASE_MAX = 0.6; // 暫定。第1レジスタを維持できる上限（跳躍閾値未満）
export const GAMMA_CEILING = 0.95; // 暫定。跳躍閾値より上である必要がある
