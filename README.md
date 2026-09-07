# self_osc_synth

シングルリード（クラリネット）の自励振動 + 円筒管デジタル導波路の、
ブラウザ実時間 MIDI 楽器。

設計の詳細は [`HANDOVER.md`](./HANDOVER.md) と
[`docs/superpowers/specs/2026-09-03-reed-waveguide-synth-design.md`](./docs/superpowers/specs/2026-09-03-reed-waveguide-synth-design.md)
を参照。

## 起動方法

### テスト（ブラウザ不要）

```bash
"D:\node-v24.20.0-win-x64\node.exe" --test
```

### 演奏

```bash
conda activate myenv311
cd D:\claude_code\self_osc_synth
python serve.py            # 既定 http://localhost:8000
```

ブラウザで `http://localhost:8000/` を開く。
**`file://` で直接開かないこと** — Web MIDI API が secure context を要求するため動かない。

## 構成

```
index.html                     本体
serve.py                       no-cache ヘッダ付き http.server（開発用）
worklet/
  reed-tube-processor.js       DSP 全部（ReedTubeModel + AudioWorkletProcessor）
src/
  main.js     起動・AudioContext・worklet ロード・配線
  params.js   パラメータ定義表
  ui.js       スライダー生成
  midi.js     Web MIDI、ノート→管長、γ 写像
  pitch.js    f0 推定器
  scope.js    4パネル描画（Canvas 2D）
tests/
  model.test.js   DSP 単体テスト（node --test）
  midi.test.js
  pitch.test.js
```

## 実装状況

- [x] 手順0: `serve.py` / `README.md`
- [x] 手順1: `ReedTubeModel` + `tests/model.test.js`（テスト1–11, 14–24, 28, 29, 31 + 30 全27本green）
- [x] 手順2: `index.html` + `main.js` + worklet 配線（実機（Chrome）で音声パス確認済み）
- [x] 手順3: `params.js` + `ui.js`（実機でtubeLength/oversample操作を確認済み）
- [x] 手順4: `midi.js` + `pitch.js`（テスト25–27全green、実機でQWERTY演奏・f0推定を確認済み）
- [x] 手順5: `scope.js`（テスト32全green、実機で4パネル描画を確認済み）
- [ ] 手順6: 実測による定数確定

未確定の定数・パラメータは
[`HANDOVER.md`](./HANDOVER.md) 6節を参照。
