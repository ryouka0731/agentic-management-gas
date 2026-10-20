# 画面の JS と、画面に渡す形

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。

## 画面に渡せる形か

`google.script.run` は限られた型しか運べない。**DBの行をそのまま返すと、Date が
混ざった時点で画面には `null` が届く**。`apiIssueList` と `apiPrReviews` で
2度踏んだ（後者は「コメントを書いても反映されない」に化けた）。

**変換は `src/core/Plain.js` の `plainText` / `plainDate` / `plainNumber` /
`plainId` だけを通す。** api 関数の中に同じ変換を書き直さないこと。以前は
同じ `iso` が4か所に写され、そのうち画面に直に書かれた8か所は
`new Date(v).toISOString()` を裸で呼んでいた。台帳は人が手で書き換えられる
表なので、日付に見えない字が1つ入るだけで `RangeError: Invalid time value`
になり、一覧まるごとが出なくなる。`plainDate` は読めない値を例外にせず
空文字で返す。

**やりとりは `plainTalk(row, me, numberKey)` を通す。** 「番号の付いたものに
誰かが書き足す」形は報告 (`inquiries`) とやること (`issues`) の両方にあり、
違うのは親を指す欄の名前だけである。画像の添えのように片方にしか無いものは
呼ぶ側で足す。`plainTalk` に `if` を増やすと、どちらの形なのかが読めなくなる。

**名前は `src/core/Brand.js` の `APP_NAME()` から引く。** 字で書かない。
以前は `Notifier.gs` の件名10か所に写されていて、名前を改めるときに1つずつ
置き換えることになった。件名は `notifySubject_()` で組む。配る道具
（`kit/*`）は静の字なので関数を呼べず、`test/naming.test.js` が揃っているかを
見ている。

- 日時は `toISOString()` で文字列にしてから返す
- `test/phase4-edit.test.js` の「画面に渡せる形か」が全 API を走査している。
  **API を足したらそこに足す。** 消す側 (`apiPrClose` / `apiUnregisterFile`) も
  走査する。返す形を間違えても、操作は成功しているので気づかれない
- **`canClose` のようにサーバが決める値は、サーバ側のテストで守る。**
  `test/component/` のテストは `test/dom.js` に仕込んだ値を読むだけなので、
  サーバ側の判定を壊しても落ちない（実際に落ちないことを確かめた）。
  `test/prclose.test.js` の「取り下げられるかを誰が決めるか」が本体を見ている
- 画面側の成功ハンドラは `list || []` で受ける

## 画面の JS は1つの関数を分けて置いてある

画面の JS は1つの `(function () { … })()` で、場所ごとのファイルに分けてある
(`src/ui/app.js.html` が開いて共通の状態と道具を持ち、`js-home` / `js-docs` / `js-pulls` /
`js-issues` / `js-board` / `js-progress` / `js-guide` / `js-reports` / `js-me` / `js-init` /
`js-settings` / `js-scrum` / `js-fun` と続き、`js-start` が閉じる)。`wiki.html` の `<script>` の中に
include を並べてつなぐので、**スコープは1つのまま**で、関数は別のファイルからそのまま呼べる。

- **並びは読み込んだときに走る文の順そのもの。** `var` の初期化や聞き手の取り付けは
  その順で走る。関数の宣言は巻き上がるのでどこに置いてもよいが、`var` と文は動かさない
- **部分ファイルに `<script>` を書かない。** タグは `wiki.html` の側にある。書くとその先が
  script の外に出て、ページ本文としてそのまま出る
- **`js-*.html` を足したら `wiki.html` に並べる。** 並べ忘れると本番にもテストにも入らない
  (`test/ui-assemble.test.js` が止める)。`include()` は `createHtmlOutputFromFile(...).getContent()`
  なので、部分ファイルの中の `<? ?>` は評価されない。入れ子の include は書けない
- **テストは `test/ui-source.js` の `APP` だけを読む。** `wiki.html` の include を読んで
  本番と同じ順につなぐ。テストに並びを写さない。`test/ui-assemble.test.js` が、`Main.gs` の
  `include()` でテンプレートを評価したものと同じ字になるかを見ている

## 画面の落とし穴

(元は「落とし穴」の項目)

- **画面の返事のハンドラでは、返事の時点で同じものを開いているかを見る。**
  版を切り替えた直後に前の返事が届くと、前の版の本文や headSha で上書きされる。
  `test/dom.js` の疑似 run は `{ later: (ok, ng) => ... }` を返すと返事を遅らせられる
- **「最後に頼んだぶんの返事か」は `latest(key)` だけで見分ける** (頼み直さずに見張るのは
  `latestSoFar(key)`)。以前は画面ごとに `usageGen` / `pullsSeq` / `ganttLoadSeq` … と数え方を
  書いていて、書き忘れたやること・ボード・報告などの一覧だけが古い返事で描き直されていた。
  **取り直す一覧を足したら `latest` を通す** (`test/component/stale-replies.test.js` に足す。
  新しいほうを先に返さないと、見分けていなくても通ってしまう)。開いている id が同じか・
  まだその画面かは別の見方なので、置き換えずに並べて書く
- **入力欄 (`openInlineForm`) は返事を待たずに閉じる。** 送った内容は控えてあり、
  そこから呼んだ `call()` が失敗すると書いたまま開き直す (`formDraftForCall`)。
  入力欄から `google.script.run` を直に呼ぶと、この控えが効かない
- **両方にある関数は `test/ui-parity.test.js` が同じ答えを返すかを見ている。** 画面の
  関数は画面の JS (`test/ui-source.js` の `APP`) から原文のまま切り出して動かす。足したらここにも足す

- **サーバ側と UI 側の両方にある関数がある**。`google.script.run` の往復を
  減らすための意図的な重複。**片方だけ直すと表示と実体がずれる**:
  `fileUrlOf` / `diffPairs` / `ganttLayout` / `ganttDaysForEffort` /
  `mentionMatch` / `tagParse` / `issueWouldCycle` / `groupIssues` / `rollupEffort` / `TERMS` / `term` / `termFill`
- **使い方の図は全部の節に置く。** 図だけ見て帰れる状態にしてある。
  `figures` のキーは `GUIDE` の見出しと一字一句同じでなければ、その節だけ
  図が消える。図の座標は手で置いているため、`test/component/settings-usage-guide.test.js` の
  「描いたものが枠から出ない」「箱どうしが重ならない」が枠外と重なりを見ている。
  狭い画面では縮めずに横へ流す（`min-width: 680px`）。縮めると字が潰れて
  読めない図になる
- **使い方の節の `id` は変えない。** 使われ方の場所の名前 (`guide-<id>`) と、画面の
  見出しの「?」(`guideIdOf`) がそれを指す。変えると過去の数が別の場所に分かれ、「?」が
  何も開かなくなる。数えるのは節を開いたとき (目次・絞り込みで1件・「?」・探す) だけで、
  送って通り過ぎたもの・見出しを押したもの (`data-guide-head`) は数えない。見出しの要素の id は
  `guide-sec-<id>` で、数える場所の名前 (`guide-<id>`) や画面の部品 (`guide-filter` など) と分けてある。
  探す (Ctrl+K) の使い方の節は `guideSearchGroup` が余った枠 (全体20件) にだけ足し、一覧を取って
  いるあいだ・取れなかったときも出す。**`searchFilter` に種類を足さない** (手元の道具の写しと食い違う)
- **幅を掴んで変えるペインには `min-width: 0` を書く。** flex の既定
  (`min-width: auto`) は中身より小さくならず、「広げられるのに縮まない」になる
- **掴み手 (`.resizer`) はペインと同時に出し入れする。** 片方だけ触ると、
  閉じているのに分け目の線だけが宙に残る。右のペインは `setSideOpen()` に
  寄せてある（以前は3か所で `sidePanel.hidden` を直に触っていた）
- **右端のペインの幅は `window.innerWidth - e.clientX` で測る。** 左端の
  ペインと同じ `e.clientX` にすると、引く向きと広がる向きが逆になる
- **掴む操作は `pointerup` だけに頼らない。** 枠の外で離すと届かず、掴んだまま
  張り付く。`pointercancel` と `window` 側でも外す
- **使い方の目次は本文の右に出す** (`#guide-toc`)。本文は 760px で止まるので、
  その右は空いている。左の帯に出していたときは、道具そのものの行き先と混ざって
  何の目次か分からず、開くたびに左の並びが動いていた。`figures` と同じく `GUIDE`
  の見出しから組むので、節を足せば自動で並ぶ。送っても残し (sticky)、狭い画面では
  隠す（見出しは本文の中にあるので無くても辿れる）
- **一覧の器 (`.history-list`) は確認依頼と共用している。** あちらの 320px 固定を
  被ると、見出しだけが広がって列がずれる

## 楽しい演出 (`js-fun`)

自分の設定の「楽しい演出」(`fun.combo` / `fun.words` / `fun.cheer`) をオンにした人の画面にだけ出す。**3つとも既定はオフ。**
項目の定義は `PREFS_SCHEMA()` (`PREF_FUN_KINDS_`) が持ち、画面は `prefs.effective.fun` を `funOn(kind)` で読むだけ。

- **何に反応するかの表はそれぞれ1つ。** 言葉は `FUN_KEYWORDS()`、済ませた操作のお祝いは `FUN_CHEERS()`
  (成功した api の名前で引く。`call()` の成功の枝から `funCheerAfter` を呼ぶ。`searchIndexChangedBy` と同じ形で、
  呼ぶ場所ごとに書かない。失敗の枝からは呼ばない)、節目は `FUN_MILESTONES()`、段は `FUN_GRADES()`。
  どれも関数にしてある (`call()` が読み込みの途中で呼ばれても引けるように。`var` は並び順で初期化される)
- 聞き手は `document` に1つ (`input` / `compositionend` を捕まえる段で聞く)。対象は `textarea` と `type=text` だけで、
  探す欄・絞り込み (`type=search`)・合言葉・数の欄では出さない。変換中 (`isComposing` と `insertCompositionText`) は
  数えず、`compositionend` で字数ぶん数える。`deleteContent*` で途切れる (5回以上続けていたら COMBO BREAK)。1.5秒で数え直す
- **打った字・カーソル・フォーカスに触らない。** 欄の値を書き換えず、`preventDefault` もしない
- 重ね (`#fun-layer`) は初めて要るときに1枚だけ作る。`pointer-events: none`・`aria-hidden`・`inert`。字は `textContent`
  だけ。粒は canvas に描き、上限 150、粒が無くなったら rAF を止める。描けない環境 (jsdom) では粒を出さない
- `prefers-reduced-motion: reduce` では短い字の札 (`.fun-badge`) だけ。粒・枠の光・跳ねる動きは出さない。音は無い
- 色はトークンだけ (`.fun-tone-<accent|success|warn|danger|merged>` が `color` を置き、影や枠は `currentColor`)。
  粒の色も `getComputedStyle` でトークンから読む
- 試すのは `test/component/fun.test.js`
