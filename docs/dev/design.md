# 画面の形の決まり (DESIGN)

画面 (`src/ui/`) の見た目の約束をまとめる。`src/ui/app.css.html` と `makePill` / `makeDiagram` / `setToggle` を
触る前に読むこと。ここに書いたトークンの名前は `test/design-doc.test.js` が CSS と突き合わせている
(ここに書いたものが CSS に無い・CSS の `:root` にあるものがここに無い、のどちらでも落ちる)。

## 何に倣うか

型を選んで当てはめるほうが、場当たりで組むより揃う。次の4つに倣う (色や形は写さず、下のトークンで表す)。

- envydesign のパターン集 (レイアウト・ナビゲーション・カード・フォーム・状態表示・マイクロインタラクション・スペーシング)
- Material Design 3 の部品の型。ボタンは filled / outlined / text の強弱、入力欄はラベルと補足の字を欄の下に、
  カードは elevated / filled / outlined、進み具合は progress indicator
- ソシオメディアのヒューマンインターフェースガイドライン。**オン・オフはボタンではなくトグルスイッチにする**
  (フリップフロップ問題。「オフにする」と書いたボタンは、いまの状態なのか押した結果なのかが読めない)。
  `setToggle(btn, on)` が `role="switch"` と `aria-checked` を付け、`.switch-track` / `.switch-knob` を組む
- かんばん (ボード) の使い勝手は kargulstudio/kanban。列ごとのその場追加、落とす位置の印、カードの札をその場で直す、
  キーボード操作、狭い画面では列を1つずつ横に送る

状態は色だけでなく字と印でも伝える。動きは操作の結果を伝えるためだけに使い、`prefers-reduced-motion` では止める。

## トークン

**値を直に書かず、`:root` のトークンを使う。** ライトの値は `:root`、ダークの値は
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` と `:root[data-theme="dark"]` の2か所に
同じものを書く (`test/ui-structure.test.js` が2つのブロックが同じかを見ている)。ダークで値が変わるのは面・文字・
意味を持つ色・影の類で、余白や幅は変わらない。新しいトークンを足したら、ここにも書く。

### 面と線

| トークン | 何に使うか |
|---|---|
| `--bg` | 地の色。本文の面 |
| `--bg-2` | 一段沈んだ面 (左の帯・一覧の地) |
| `--bg-3` | さらに一段の面 (札 `.chip` の地など) |
| `--surface-raised` | 浮いて見せる面 (ボタン・カード・浮く窓)。ライトでは白、ダークでは地より明るい |
| `--line` | 区切りの線 |
| `--line-strong` | 強い線 (触れたときの下線、切り替えの溝) |

### 文字

| トークン | 何に使うか |
|---|---|
| `--ink` | 本文の字 |
| `--ink-2` | 添えの字 (補足・日付・札の字) |
| `--mono` | 等幅の書体 (コード・差分・番号) |

### 意味を持つ色

色と、その色の札や帯の地 (`-bg`) を対で持つ。

| トークン | 何に使うか |
|---|---|
| `--accent` / `--accent-bg` | 主の操作・選んでいるもの・オンの切り替え |
| `--on-accent` | `--accent` の上に載る字。地の明るさが逆転するため対で持つ |
| `--success` / `--success-bg` | 済んだ・通った |
| `--danger` / `--danger-bg` | 食い違い・断り・消す操作の字 |
| `--danger-solid` / `--on-danger` | 塗りつぶしの危険のボタン (`.btn-danger`) と、その上の字 |
| `--warn` / `--warn-bg` | 注意 (`.badge` など) |
| `--merged` / `--merged-bg` | 反映済み (`.state-merged`・系統図の反映の点) |

### 余白・角・影・動き

| トークン | 何に使うか |
|---|---|
| `--sp-1` 〜 `--sp-6` | 余白の段 (4pt の段: `--sp-1` 4px / `--sp-2` 8px / `--sp-3` 12px / `--sp-4` 16px / `--sp-5` 24px / `--sp-6` 32px)。内側は padding、外側は margin、並びは gap で考える |
| `--radius` / `--radius-sm` | 角の丸み (箱・ボタン / 小さな部品)。札だけは 999px |
| `--shadow` | ふつうの影 |
| `--elev-1` / `--elev-2` | 押せることを示す影。段が上がるほど手前に見える (Material の elevation)。触れると `--elev-2` に上がる |
| `--hairline` | 影で描く縁。ダークでは影が見えないので明るい縁で段を表す |
| `--motion` | 動きの長さ |

### 幅と、画面側が書き換えるもの

| トークン | 何に使うか |
|---|---|
| `--sidebar-w` | 左の帯の幅 |
| `--side-pane-w` | 右のペインの幅 (掴んで変えられる) |
| `--graph-pane-w` | 履歴と差分の分け目 (掴んで変えられる) |
| `--pr-pane-w` | 確認依頼の一覧と中身の分け目 |
| `--report-pane-w` | 報告の一覧と話の分け目 |
| `--graph-w` | 系統の列の幅。枝の本数に応じて画面側が書き換える |
| `--gantt-name-w` | 工程表の名前の列の幅。目盛りの下敷きの左端と揃える |
| `--week-offset` | 工程表の週の区切りの位置。画面側が入れる |

### 作業部屋の絵 (`js-room`)

部屋は明暗のテーマに依らず、ランプの灯った夕暮れの色で描く (ダークの2か所では上書きしない)。絵の中だけで使い、
画面の部品には使わない。本の背は意味を持つ色 (`--accent` など) を借りる。

| トークン | 何に使うか |
|---|---|
| `--room-wall` / `--room-wall-2` / `--room-floor` / `--room-rug` | 壁・腰壁・床・敷物 |
| `--room-wood` / `--room-wood-2` | 机・窓枠・棚 (明るい木 / 暗い木) |
| `--room-curtain` / `--room-plant` / `--room-pot` | カーテンとマグ・葉・鉢 |
| `--room-lamp` / `--room-lamp-shade` / `--room-metal` | ランプの灯り (太陽と街の灯りにも)・笠・金具 |
| `--room-glow` / `--room-glow-0` | ランプの明かりの輪 (中心 / 外側の透明) |
| `--room-steam` / `--room-silhouette` | 湯気・推しがオフのときの人影 |
| `--room-city` / `--room-star` / `--room-rain` | 窓の外の街・月と星・窓の雨粒 |
| `--room-sky-morning` / `--room-sky-morning-2` | 朝の空 (下 / 上) |
| `--room-sky-day` / `--room-sky-day-2` | 昼の空 (上 / 下) |
| `--room-sky-evening` / `--room-sky-evening-2` | 夕方の空 (上 / 下) |
| `--room-sky-night` / `--room-sky-night-2` | 夜の空 (上 / 下) |

工程表の中だけで使うもの (`--gantt-days` / `--gantt-col` / `--weeks` / `--cell`) は、その要素の上で決めて画面側が
書き換える。`:root` には置かない。

**未定義の変数 + フォールバックの形 (`var(--foo, #ccc)`) は書かない。** 足りないときは `:root` とダークの2か所に
トークンを足し、上の表にも書く。

## 札の形

小さな札 (`.badge` / `.chip` / `.state` / `.label-pill` / `.stale-badge` / `.rel-chip` / `.patch-stat`) の形は
`app.css.html` の1つの規則で決まる (高さ 20px・左右 `--sp-2`・角 999px・字 11px)。各クラスが持つのは色 (と印・押せる)
だけ。組み立ては `makePill(text, kind, icon)` を通し、span を自分で作らない。字は `textContent` で置く。

## ボタン

- 枠線は「境界」の記号で、「押せる」の記号ではない。`.btn` は面を一段持ち上げて影を落とし (`--hairline` +
  `--elev-1`)、触れると浮き (`--elev-2`)、押すと沈む
- 強弱は Material 3 に寄せる。主の操作は `.btn-primary` (`--accent` の地に `--on-accent` の字)、消す操作は
  `.btn-danger` (`--danger-solid`)、それ以外は `.btn`
- オン・オフはボタンにせず `setToggle` の切り替えにする (上の「何に倣うか」)
- 押せないボタンには、押せない理由を添える

## プルダウン (select)

形は `app.css.html` の `select` の1つの規則だけで決める。既定の見た目 (`appearance`) を外し、枠は面と影
(`--hairline`)、角は `--radius-sm`、矢印は文字の色 (`--ink-2`) で2本の線を描く (外の画像は使わない)。高さは 32px が
下限で、ボタンと並べても段違いにならない。フォーカスは `--accent` の輪、使えないときは薄くする。開いた一覧は
OS が描くので、`option` の字と地だけテーマに合わせる。

**各クラスで余白・枠・角・地を書き直さない** (幅と字の大きさだけ書いてよい)。以前は版の切り替え・まとめ方・
集計・設定の欄がそれぞれ別の余白と枠を持ち、何も当てていないものは OS の見た目のままだった。
`test/ui-structure.test.js` の「プルダウンの形」が固定している。

## 和文の折り返し

`body` に `word-break: auto-phrase` と `overflow-wrap: break-word` を当てている。日本語を語の切れ目で折り返す
(「確認依頼」が「確認依」「頼」に割れない)。効くのは `lang="ja"` の和文だけで、対応していないブラウザではふつうの
割り方になる。1語が器より長いときだけ語の中で割る。コードと差分は等幅で `break-all` のまま。

## 図

説明の図は `makeDiagram(spec)` でその場で描く (下の「図はその場で描く」)。箱・線・帯・点・字の座標を spec に書き、
色はトークンで当てる。

## 札・ボタン・幅の落とし穴

(元は `CLAUDE.md` の「落とし穴」の項目)

- **小さな札 (`.chip` / `.state` / `.stale-badge` / `.label-pill` / `.badge` /
  `.rel-chip` / `.patch-stat`) の形は1つの規則で決まっている。** 字の大きさ・
  余白・角の丸み・背の高さをクラスごとに書き直さない。以前は7種類が別々に
  10/11/12px、上下 0/1/2/3px、角 10px/999px を持っていて、同じ行に並ぶと
  段違いになっていた。組み立ても `makePill(text, kind, icon)` に寄せてある
  (以前は17か所がそれぞれ span を作っていた)。`test/ui-structure.test.js` の
  「札の形は1か所で決まっている」「札ごとに形を書き直さない」が固定している
- **`button` は地の色も枠も継がない。** 既定の `color: buttontext` は OS の設定で
  決まるため、暗い OS で明るいテーマを選ぶと白い面に白い文字が乗って消える
  (確認依頼の題名だけが見えなかった)。既定の `border` も面と影で段を表す設計を
  壊す。基礎で `button { color: inherit; border: 0 }` を当てている
- **`display: flex` の行に `width: 100%` を足さない。** 左右に margin があると
  その分はみ出す（実際に右端が見切れた）
- **`button` は `display: flex` にしても幅が伸びない。** form の部品は
  `width: auto` が shrink-to-fit になるため、行が `<div>` の一覧（やること・
  改訂版・下書き）は器いっぱいに伸びるのに、`<button>` の一覧（確認依頼・
  要望・使われ方）だけ題の長さで幅が変わる。`width: stretch` と
  `-webkit-fill-available` / `-moz-available` を並べて当てる。`100%` は
  上のとおり使えない

## 図はその場で描く

説明の図に Mermaid や draw.io を持ち込まない。読み込みが1つ増えるうえ、
この画面は外から何も取ってこない作りにしてある。地の色に合わせるのも、
その場で描いたほうが確実。(ただ1つの例外は集中のしかたの「自分の曲」で、押したときにだけ YouTube /
SoundCloud の再生機を置く。`docs/dev/ui.md` の「集中のしかた」)

自分の曲の再生機の枠 (`.focus-music-frame`) は置き場の幅に合わせ (`width: 100%`、横にはみ出させない)、YouTube は 16:9、
SoundCloud は字だけの形 (`visual=false`) の 166px にする。読み込むまで枠は無い (`.focus-music-holder:empty` は隠す)。

`makeDiagram(spec)` が、箱と矢印の座標を書いた spec から SVG を組み立てる。
矢印の先は図ごとに名前を分ける（同じ頁に2つ並ぶため）。`role="img"` と
`<title>` / `<desc>` を必ず入れる。
