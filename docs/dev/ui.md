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
`js-issues` / `js-board` / `js-progress` / `js-guide` / `js-reports` / `js-me` / `js-style` /
`js-init` / `js-settings` / `js-scrum` / `js-fun` / `js-oshi` と続き、`js-start` が閉じる)。`wiki.html` の `<script>` の中に
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
  `mentionMatch` / `tagParse` / `issueWouldCycle` / `groupIssues` / `rollupEffort` / `TERMS` / `term` / `termFill` /
  `oshiGreetingOf`
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
- 集中のしかた (`js-focus`) の LET'S GO!! と SUPER COMPLETE!! も `FUN_CHEERS()` の行 (`apiFocusStart` / `apiFocusEnd` の done)。
  お祝いがオフの人には js-focus が落ち着いた帯を出す

## 集中のしかた (`js-focus`)

自分の設定の「集中のしかた」(`focus.start` / `focus.remind` / `focus.sound`) をオンにした人の画面にだけ出す。**既定はオフ。**
項目は `PREFS_SCHEMA()` (`PREF_FOCUS_ITEMS_`) が持ち、画面は `prefs.effective.focus` を `focusOn()` / `focusSoundOn()` /
`focusRemindEvery()` で読むだけ。オフのあいだは入口 (`makeFocusStartButton` / `makeFocusRecordButton`) が null を返し、
`apiFocusMine` も呼ばない。サーバは `src/core/Focus.gs` と `src/api/Focus.gs`、台帳は `focus_sessions`。

- **「始めた」は番頭の中の手で確かめる** (カメラは使わない)。`call()` の成功の枝から `focusAfterCall(name, args)` を呼び、
  集中しているやることへの `apiIssueComment` / `apiIssueUpdate` / `apiProjectMove` (作業中へ) / `apiCommit*` なら
  `apiFocusProve` を呼ぶ (最初の一手だけで「始めた」ものも、台帳の手でポイントが付くので呼ぶ。返事の `credited`)。
  開いた時刻は画面の時計で送らず、開いたときに `apiFocusOpen` を呼んでサーバに覚えてもらう。**本来の返事の扱い (`ok`) のあとに置く** (先に置くと、確かめた帯を本来の帯が上書きする)。
  サーバは台帳に本人の手が始めたあとにあるときだけ付ける (画面の言い分だけでは付けない。ボードの移し替えは履歴に
  残らないので、始めた時点の置き場 `columnAtStart` が作業中でも完了でもなく、いまの置き場が作業中かで見る。
  始める前から作業中だったカードを数えると何もしなくても付く。`columnAtStart` が空の古い行はボードの手を数えない)。そのやることへの `apiIssueClose` は集中を「やりきった」で終える。
  そのときはふつうの完了のお祝い (CLEAR!) を出さない (`focusClosesSession` を `funCheerAfter` が見る。SUPER COMPLETE!! と重ねない)。
  集中の画面は右のペインを隠すので、記録と技の図鑑を開くときは集中の画面を戻す (`openFocusRecord`)
- **残りは時刻の差で数える** (`focusRemainingMs`)。背景のタブでは時計が間引かれるので、刻みを数えない。タブの題名にも
  残りを出し (`focusTitleOf`)、終えたら元に戻す
- **音は押した聞き手の中でだけ作る** (`focusSoundPlay`)。番頭は別の場所の枠の中で動くので、押した中で作らないと鳴らない。
  読み込みや表示では作らない。1小節 (ノイズは4秒) を `AudioBuffer` に描き、`loop` で繰り返す (拍を時計で打たない)。
  音の形は画面に依らない関数 (`focusRenderBar` / `focusRenderNoise` / `focusKickFreq` …) にしてあり、
  `test/focus-ui.test.js` が `test/ui-source.js` の `ui()` で切り出して確かめる。`AudioContext` の無い環境 (jsdom) では
  欄を出さず断りだけ出す。大きさは `FOCUS_GAIN_MAX` を超えない
- **集中の画面は CSS で隠すだけ** (`body.focus-mode`)。右のペインも掴み手も知らせの数も、状態は変えずに見えなくする。
  Esc で戻り、集中を終えたら必ず戻す (`focusClear`)
- 置き場 (`#focus-dock`) は初めて要るときに作る。字は `textContent` だけ。色はトークンだけ
- 「ADHD」など人を分ける言葉は画面に出さない。「集中のしかた」として全員向けに書き、効き目を約束しない
- 試すのは `test/component/focus.test.js` (押して確かめる)・`test/focus-ui.test.js` (計算と音の形)・
  `test/focus.test.js` (サーバ)・`test/e2e/focus.test.js` (通し)

## 仕事のスタンス診断 (`js-style`)

自分まわりの「仕事のスタンス診断」から右のパネルで開く。問い・軸・型・おすすめは `src/core/WorkStyleTypes.js` が唯一の定義で、
画面は `apiWorkStyle` で受け取って描く。**画面は数えない** (答えを `apiWorkStyleSave` に送り、型はサーバが決める)。

- **`js-init` より前に読む** (`wiki.html` の並び)。`peopleStyles` の初期化 (`var … = {}`) が `js-init` の `apiWorkStyleTeam` の
  返事より後に走ると、テストの疑似 run (返事がその場で届く) で空に戻る
- 顔 (`makeAvatar`) の読み上げと吹き出しに、本人が「チームに見せる」を選んだ人だけ型の名前を添える (`personStyleText`)。点数は出さない
- おすすめの設定は `openPrefAt(key)` で設定の画面を開き、その項目 (`data-pref`) に `.pref-focus` の印を付けて送るだけ。
  **切り替えない**。画面の行き先 (`board` / `gantt` / `list` / `help`) はサーバの `WORK_STYLE_VIEWS_()` と同じ key を `styleGo` が知っている
- 札を写すのは `copyPlainText` (execCommand。`makeCopyRow` と共用)。写せなければ札の字を選んだままにする。画像は canvas に
  トークンの色で描き、その場に `<img>` で出してから保存を試みる (枠の中では保存が黙って断られることがある)。描けない環境 (jsdom) ではそう言う
- 断り書き (遊びの診断・評価や配置には使わない・医学的なものではない) は、問いと結果の両方に出す
- 試すのは `test/component/style.test.js` (返事は本物の api で作る) と `test/e2e/work-style.test.js`

## 推し (`js-oshi`)

自分の設定の「推し」(`oshi.on`、既定はオフ) をオンにした人の画面にだけ出す。自分で作ったキャラクターの絵を上げると、
済ませたときに左下の吹き出しでほめ、ホームであいさつし (`oshi.home`)、活動に合わせて育つ。手引きは `docs/manual/oshi.md`。

- **表情・口調・場面・せりふ・頼み文・育ちの段・上限は `src/core/Oshi.js` が唯一の定義。** 画面は `apiOshiGet` の返事を
  使い、写しを持たない (手引きも頼み文を写さない。`test/oshi.test.js` が見ている)。せりふを足すときは `OSHI_LINES()` の
  全部の口調に足す (どの口調も全部の場面を持つことをテストが見ている)
- 画面が持つのは「成功した api の名前 → 場面」の表 `OSHI_CALL_EVENTS()` だけ。`FUN_CHEERS` と同じく `call()` の
  成功の枝から `oshiAfter` を呼ぶ。失敗の枝からは `oshiAfterFail` を呼び、**表に当たる (人が押した) 操作だけ**
  「しんぱい」を出す (裏で取るだけの呼び出しの失敗では出さない)。**キャラクターは叱らない**
- 画像は1枚ずつ `apiOshiImage(charId, state)` で取り、中身の指紋ごとに画面が覚える (`oshiImgs`)。サーバはキャッシュに置かない
  (CacheService は1つ 100KB まで)。絵が無い表情は、育ちの段の絵 → ふつうの絵 → 名前の頭文字の順に代える
- 上げる前に画面で長い辺 512px に縮める (canvas が使えるときだけ。GIF は縮めない)。上限・形式はサーバの値で見て、
  サーバも同じ値で断る (先頭のバイトで中身の形式も見る)
- **推しの画像の中身は `objects/oshi-<sha>.<ext>` に置く** (`oshiObjectName_`)。文書の履歴の画像も `<sha>.<ext>` で置かれるので、
  同じ名前だと推しの画像を外したとき、同じバイトの履歴の画像までゴミ箱へ移していた。この形にする前の行の中身
  (`<sha>.<ext>`) は読めるが、どちらのものか見分けられないので**外しても消してもゴミ箱へ移さない**
- **Drive のファイルは鍵の外で触る。** 鍵の中では台帳の行を書き、片付ける中身の指紋を集めるだけ。置くのは行を書いた
  あと、ゴミ箱へ移すのは読み直してどの行からも指されていないと確かめてから (`oshiDropObjects_`。`test/oshi.test.js` の
  「鍵の中で Drive を触らない」)
- 吹き出しはマウスが乗っているあいだとキーボードで中に入っているあいだは消さない。使うキャラのカードは矢印で選び直せ、
  Tab で入れるのは選んでいる1枚だけ
- 吹き出しは1つ (`#oshi-bubble`)。字は `textContent`、絵は自分の推しの data URL だけ。押せば閉じ、6秒で消える。
  動きを減らす設定では CSS がふわっと出る動きを止める。「久しぶり」は端末に最後に開いた日 (`oshiLastSeen`) だけを覚え、
  連続日数は数えない
- **キャラは2種類。** 最初からいるキャラ (`OSHI_BUILTINS()` が唯一の表。イツキ = 耽美、タク = 明るい相棒。名前・口調・絵は
  決まっていて変えられない) と、本人が作る自分のキャラ (`OSHI_MINE_MAX()` = 5人まで。番号 `charId` で名指す)。どれを使うかは
  自分の設定 `oshi.char` (`'builtin:<key>'` / `'mine:<charId>'`、既定は `'builtin:itsuki'`)。`apiOshiGet` はいま使うキャラ
  (`kind` / `builtinKey` / `charId` / `name` / `tone` / `events` / `images`) と、頁で直すための自分のキャラ全部 (`mine`) を返す
  - **`oshi.char` は人ごとに選べるものが違う** (type `'char'`)。`prefValid_(item, v, email)` が `oshiCharKnownFor_` で、
    最初からいるキャラか、その人が持っている自分のキャラかを見る (自分のキャラのときだけ台帳を読む)。無い・消したキャラを
    指していても表示の道では断らず既定に倒し (`prefValueOf_`)、`apiPrefSet` だけがふつうの言葉で断る。選んでいた自分のキャラを
    消すと `apiOshiCharDelete` が既定に戻す。画面の選び方は `makeOshiCharPicker` (設定の一覧で `type === 'char'` の欄だけ
    js-oshi が組む)。最初からいるキャラは設定の `options`、自分のキャラは `apiOshiGet` の `mine` から並べ、ふつうの顔の絵を
    添える (**推しがオンのときだけ絵を取る**)。押したら `apiPrefSet` で書く (書くのはここだけ、のまま)
  - 自分のキャラの絵が無い表情には `oshi.fallback` (`'builtin:<key>'` / `'none'`、既定はイツキ) の絵を出す。最初からいるキャラを
    使っているときは、そのキャラの絵だけ。形は `oshi.style` = `chibi` / `normal`、既定は 2頭身
  - 前の `oshi.useDefault` (最初からいるキャラを使う) は `oshi.char` / `oshi.fallback` に置き換えた (出す前だったので移行は無い)
  - 絵の本物は `assets/oshi-default/<キャラ>/<形>-<表情>.webp` (透明な WebP)。`scripts/build-oshi-default.mjs` が base64 の
    data URL にして、キャラ×形ごとに `src/core/OshiDefault<キャラ><形>.gs` (関数は `OSHI_DEFAULT_<キャラ>_<形>`) に焼く
    (`build-kit.mjs` → `KitFiles.gs` と同じ形。**焼いたものは手で直さない**。1つ 600KB まで)。`npm run deploy` が送る前に
    焼き直し、`test/oshi-default.test.js` が assets と一致しているかを見ている。キャラ・表情・形の並びは `Oshi.js` から読む。
    **キャラを足したら** `OshiStore.gs` の `oshiDefaultPictures_` と `OSHI_DEFAULT_SOURCES` (`test/sources.js`) にも足す
    (ファイル名は src の中で他と重ならないこと。同じ名前の .js と .gs は clasp で1つになる。`test/sources.test.js` が見ている)
  - **最初のページには入れない。** 1人の2つの形で 1MB 近くあるので、吹き出し・カード・頁・設定の選び方が要るときに
    `apiOshiDefaultImage(char, style, state)` で1枚ずつ取り、画面が `'キャラ:形:表情'` ごとに覚える (`oshiDefaultImgs`。
    取りに行っている最中の同じ絵は待ち合わせる)。オフの人・絵を出さない設定の人は1度も取らない。キャラ・形・表情は定義に
    あるものだけを通す
  - テストで読むときは `OSHI_DEFAULT_SOURCES` (`test/sources.js`) を足す。大きいので `APP_SOURCES` には入れていない
  - 最初からいるキャラは架空のもの。**実在の人の名前・所属を、コード・コメント・テスト・手引き・記録の文に書かない**
    (性格は自分の言葉で書く)。絵は利用者が用意したもの (2026-10-21)
- 試すのは `test/component/oshi.test.js` (返事はサーバの `apiOshiGet` から作る)、通しは `test/e2e/oshi.test.js`
