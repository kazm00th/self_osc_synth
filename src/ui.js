// スライダー生成とラベル更新（§7 レイアウト: 吹圧・アンブシュア / リード / 管 の3グループ）。
// params.js の表からDOMを組み立てる。パラメータ追加は params.js に1行足すだけで反映される。

import {
  paramsByGroup,
  ATTACK_PARAM,
  RELEASE_PARAM,
  OVERSAMPLE_OPTIONS,
  OVERSAMPLE_DEFAULT,
  EXPRESSION_SOURCES,
  EXPRESSION_SOURCE_DEFAULT,
} from './params.js';

function formatValue(p, v) {
  const unit = p.unit ? ` ${p.unit}` : '';
  const n = Number(v);
  const text = Number.isInteger(n) ? String(n) : n.toPrecision(4);
  return `${text}${unit}`;
}

function makeSliderRow(p, onChange) {
  const row = document.createElement('div');
  row.className = 'param-row';

  const label = document.createElement('label');
  label.textContent = p.label;
  label.htmlFor = `param-${p.id}`;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = `param-${p.id}`;
  input.min = String(p.min);
  input.max = String(p.max);
  input.step = String(p.step ?? (p.max - p.min) / 100);
  input.value = String(p.default);

  const valueEl = document.createElement('span');
  valueEl.className = 'param-value';
  valueEl.textContent = formatValue(p, p.default);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueEl.textContent = formatValue(p, v);
    onChange(p.id, v);
  });

  row.append(label, input, valueEl);
  return row;
}

/**
 * params.js の manualUI パラメータをグループ分けしてスライダーを生成する。
 * @param {HTMLElement} container
 * @param {(id: string, value: number) => void} onChange
 */
export function buildParamSliders(container, onChange) {
  const groups = paramsByGroup();
  for (const [groupName, params] of groups) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'param-group';
    const legend = document.createElement('legend');
    legend.textContent = groupName;
    fieldset.appendChild(legend);
    for (const p of params) {
      fieldset.appendChild(makeSliderRow(p, onChange));
    }
    container.appendChild(fieldset);
  }
}

/**
 * attack/release（UI のみ。AudioParam ではなく midi.js の setTargetAtTime に使う）。
 * @param {HTMLElement} container
 * @param {(id: 'attack'|'release', ms: number) => void} onChange
 */
export function buildEnvelopeControls(container, onChange) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'param-group';
  const legend = document.createElement('legend');
  legend.textContent = 'エンベロープ';
  fieldset.appendChild(legend);
  fieldset.appendChild(makeSliderRow(ATTACK_PARAM, onChange));
  fieldset.appendChild(makeSliderRow(RELEASE_PARAM, onChange));
  container.appendChild(fieldset);
}

/**
 * oversample トグル（1x/2x）。port.postMessage の setOversample に使う。
 * @param {HTMLElement} container
 * @param {(factor: number) => void} onChange
 */
export function buildOversampleControl(container, onChange) {
  const row = document.createElement('div');
  row.className = 'param-row';
  const label = document.createElement('label');
  label.textContent = 'オーバーサンプリング';
  const select = document.createElement('select');
  for (const factor of OVERSAMPLE_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(factor);
    opt.textContent = `${factor}×`;
    if (factor === OVERSAMPLE_DEFAULT) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(Number(select.value)));
  row.append(label, select);
  container.appendChild(row);
  return select;
}

/**
 * 表現ソース選択（ブレス CC2 / モジュレーション CC1 / なし）。§6。
 * @param {HTMLElement} container
 * @param {(id: string) => void} onChange
 */
export function buildExpressionSourceControl(container, onChange) {
  const row = document.createElement('div');
  row.className = 'param-row';
  const label = document.createElement('label');
  label.textContent = '表現ソース';
  const select = document.createElement('select');
  for (const src of EXPRESSION_SOURCES) {
    const opt = document.createElement('option');
    opt.value = src.id;
    opt.textContent = src.label;
    if (src.id === EXPRESSION_SOURCE_DEFAULT) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  row.append(label, select);
  container.appendChild(row);
  return select;
}
