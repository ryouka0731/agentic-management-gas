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
`js-issues` / `js-board` / `js-progress` / `js-guide` / `js-reports` / `js-me` / `js-style` / `js-calendar` /
`js-init` / `js-settings` / `js-scrum` / `js-fun` / `js-focus` / `js-room` / `js-oshi` / `js-ach` / `js-goals` / `js-luck` と続き、`js-start` が閉じる)。`wiki.html` の `<script>` の中に
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
- **`include()` は `createTemplateFromFile(f).getRawContent()` で、そのままの字を返す。**
  `createHtmlOutputFromFile(f).getContent()` に戻さない。そちらは部分ファイルを「HTML のファイル」として読み直してから返す。
  2026-10-22 に Google 側のその読み方が変わり、前日まで何も変えていない部分ファイルで本番が2段階に壊れた:
  1. 読むときの検査が厳しくなり、「形式が正しくない HTML コンテンツ」で**画面全体が開けなくなった** (@188)。拒まれたのは、
     タグに見える字 (`<` + 英字) の属性の値に `"` が入る正規表現 (`/<img data-sha="([^"]*)">/` の `[^"]`) と、
     タグに見える字の中にもう1つ `<` や `?` がある説明コメントの型 (`Array<Array<string>>` / `Array<?HTMLElement>`)。
     `[^\x22]` / `string[][]` / `(HTMLElement|null)[]` に直した (@189)
  2. 読み直した字を返すようになり、JS の `<` が `&lt;` に、CSS のコメントが消えて返った (`for (var i = 0; i &lt; n; i++)`)。
     画面の JS 全体が文法エラーになり、**ボタンが押せずアイコンも出ない** (@189)。`include()` を `getRawContent()` にして直した (@190)
  部分ファイルは `<script>` / `<style>` の中身なので、HTML として読ませる理由がそもそも無い。`test/ui-assemble.test.js` は
  `getRawContent` しか無い HtmlService の上で `include()` を動かすので、戻すと落ちる。`test/ui-html-safe.test.js` は 1. の
  書き方を全部の部分ファイルから探す (二重の守り。本番の検査そのものは写せないので、本番で NG / ok と分かった字で探し方を固定してある)。
  本番で確かめるには、`CommandQueue.gs` に一時的な命令を足して `clasp push` し (配信は差し替えない。命令キューは
  送った最新の中身で回る)、部分ファイルごとに `getRawContent()` と `include(f)` を見比べ、`evaluate().getContent()` に
  `i < n; i++` のような字がそのまま残るかを見る。点検の命令はコミットしない

## 断りに「次にすること」を添える

`call()` の失敗の見せ方 (既定の帯・`failSnack` / `failInto` / `failEnable`) は、断りの字の下に1行
「次にすること: …」を出す。**`failQuiet` は出さない** (黙ってよいものに次の一手は要らない)。型と言葉は
`src/core/ErrorKind.js` が唯一の定義で、画面の `errorKindOf` / `nextStepOf` / `errorTextOf` はその写し
(`test/ui-parity.test.js`)。設計は `docs/superpowers/specs/2026-10-21-motivation-review-2.md` の D.1。

- 型は busy / partial / quota / timeout / forbidden / gone / stale / invalid / unknown。**断りの字は変えずに、決まった言い回しから引く。**
  日本語の文は、名前や番号が入る場所 (`ERROR_NAME_SLOTS_`: 最初の「: 」「：」より後・「…」の中・# のあと・文の頭の
  「<名前> さんの」など) を外した字だけを見る。**英語の言い回しもそこにだけ当てる** (英語の名前で型を変えない)
- **busy は `dbWithLock_` の断り (`DB_BUSY_TEXT()`) と同じ字のときだけ。** 同じ実行の中で鍵の中の処理を1つ済ませたあとに
  鍵が取れなければ、`dbWithLock_` は別の字 (`DB_PARTIAL_TEXT()`、型は partial) で断る。やることを作る (番号 → カード → 担当) の
  ように鍵を続けて取る操作では、2つ目で断られたときには1つ目がもう書かれているため。「この実行の中で」は `dbWroteThisRun_`
  (実機は呼び出しごとにグローバルを読み直す。テストは `test/harness.js` が外からの1回ごとに `dbRunBegin_()` で戻す)。
  英語の混み合い・上限 (`Lock timeout` / `Service invoked too many times` など) は操作の途中で起きるので quota (押し直さない)
- **今ある断り文 (new Error の字) は全部どれかの型に当たる** (`test/errorkind.test.js` が `test/naming.test.js` と同じ拾い方で走査する)。
  当たらない断りを足すとそこで落ちる。そのときは断り文ではなく `ERROR_KIND_PHRASES_` の言い回しを足す
- **[もう一度] は busy のときだけ、1回だけ。** 何も書かないうちに断っているので押し直してよい。押すと同じ api を同じ引数で
  呼び直し (`callOnce`)、また失敗しても2回目は出さない。**ほかの型には出さない** (途中まで済んでいることがあり、
  押し直すと同じものが2つできる)。`failEnable` のボタンは押し直すあいだも押せなくする
- **押し直す道は1つだけ使える** (`makeRetry`)。[もう一度]・開き直した入力欄から送る・押せるように戻したボタンを押す、の
  どれかを使ったら、ほかは外す (帯と器のボタンを消し、[もう一度] を押していたら入力欄を閉じる)
- 失敗の見せ方は `err` しか受け取らないので、型と押し直す手立ては `call()` が失敗のハンドラを呼ぶあいだだけ `callFailure` に置く
- **英語の実行時エラーはそのまま出さず日本語に言い換える** (`errorTextOf`)。元の字は `console.warn` に残す
- 時間切れはサーバでは数えられないので、画面が使われ方の場所 `error:timeout` として数える (毎日の成果の数の `timeoutErrors`)
- 帯は文と次の行を `.snackbar-body` にまとめ (ボタンは右のまま)、器は `.fail-text` / `.fail-next` / `.fail-again` に分けて置く
- 試すのは `test/component/error-recovery.test.js` (型ごとの出方・押し直し・1つだけ使える)、`test/api/partial-busy.test.js`
  (途中まで書いてからの断り) と `test/e2e/errors.test.js` (混み合い → もう一度 → 1件だけできる・途中まで済んだら出さない)

## 文書のリンク (文書だけの画面)

`?doc=<fileId>&full=1` で開かれたときは、番頭の画面を出さず文書だけを出す (2026-10-22 の指摘「リンクを踏むとホームに一瞬
飛んでから文書に移り、左の行き先や上の操作も出る」)。

- **印はサーバが付ける。** `Main.gs` の `doGet` が `?doc` と `?full` を読み (`doGetLink_`。id は Drive の id の字だけ通す)、
  `wiki.html` の `<body class="<?= bodyClass ?>" data-link-doc="<?= linkDoc ?>">` に `doc-link doc-full` と id を入れる。
  画面側は iframe の中で URL を同期では読めない (`google.script.url.getLocation` は返事待ち) ので、最初の描画から周りを隠すには
  サーバで付けるしかない。`<?= ?>` は逃がすが、id の字も絞っている
- **`js-start` は印があればホームを出さない。** `enterDocLink` で面を全部隠し「文書を開いています…」を出し、`openFromLink` で
  文書を開く (`switchTab('home')` も `loadHome` も呼ばない)。印が無ければ今までどおり (ホーム → `getLocation` → 古い形の `?doc=` だけのリンク)
- **`body.doc-link` は `doc-full` と同じものを隠し、さらに全画面のボタンとホームの面も隠す。** 全画面を閉じても (Esc) 周りは出ない
  (戻る先が無い)。題名 (`.crumbs h1`) だけ残す
- **開けなければ `leaveDocLink` でふつうの画面に戻して帯で知らせる** (見られない・登録されていない・一覧が取れない・本文が取れない)
- テストは `test/component/doc-link.test.js` (`mountApp(…, { link: { doc } })` が doGet の印を body に付ける) と
  `test/api/main.test.js` (doGet)。`test/ui-assemble.test.js` と `test/dom.js` は `<?= bodyClass ?>` / `<?= linkDoc ?>` を空で埋める

## ホーム (`js-home` / `js-progress`)

- **返事が届くまでは骨組み (スケルトン) を置く** (`homeSkeletonInto(host, title, lines)`。2026-10-22 の依頼)。区画が空のときだけ置き、
  `fillBlock` が届いた中身で置き換える (`aria-busy` も外す)。開き直したときは前の中身を残す (空でないので置かない)。カードの列は
  `loadHomeCards` が1枚ぶん (`.home-skel-card`) 置き、前進が取れなければ外す。読み上げには `.sr-only` の「読み込んでいます」だけ届け、
  棒は `aria-hidden`。棒の明滅は `prefers-reduced-motion` で止める
- **幅の広い画面で右に偏らないように**、ホームの中身は `max-width: 1360px` で真ん中に寄せ、1440px 以上では主と従を半々にして
  右のカード (`.home-cards`) を2列に並べる (縦に積み上がらない)。1024〜1439px は 2fr / 1fr のまま

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
  `oshiGreetingOf` /
  `focusMusicParse_` / `focusMusicPartsValid_` / `focusMusicEmbedUrl_` / `focusMusicLinkOf_` (`src/core/FocusMusic.js`。写しは `js-focus`) /
  `errorKindOf` / `nextStepOf` / `errorTextOf` (`src/core/ErrorKind.js`) /
  `coworkLinkParse_` / `coworkLinkPartsValid_` / `coworkLinkOf_` / `coworkLinkKindLabel_` (`src/core/CoworkLink.js`。写しは `js-cowork`)
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

## 思いがけない当たり・ノリノリタイム・自分へのご褒美 (`js-luck`)

自分の設定の `luck.on` (当たりとノリノリタイム) と `luck.reward` (ご褒美) をオンにした人の画面にだけ出す。**どちらも既定はオフ。**
パチンコの仕組みを頼まれて入れたもので、線は `docs/superpowers/specs/2026-10-21-motivation-review.md` の「不確実な報酬」。

- **確率は見た目の演出だけに使う。** 当たっても機能・情報・ポイントは増えない。当たりは画面の中だけで決め、サーバに何も
  送らない (ポイントは台帳から数えるもので、画面の乱数からは付けない)
- **外れは描かない。** リールは当たったときにだけ作り、回っている帯にも当たりの絵しか並べない (ニアミスを作らない)。
  `test/component/luck.test.js` が、揃わない絵が1つも描かれないことと、外れで何も描かないことを見ている
- 引くのは `call()` の成功の枝から `luckAfter` を呼んだときだけ (失敗の枝からは呼ばない)。集中を始めた (`apiFocusStart`) では
  引かない (始めてすぐやめるのを繰り返せる)。集中しているやることの完了 (`focusClosesSession`) でも引かない (SUPER COMPLETE!! と重ねない)。済ませた手の表は `LUCK_ACTIONS()`、
  引数で当たるかは `FUN_CHEERS()` の `when` で見る (判定を2つ持たない)。当たったら `funCheerAfter` に `lucky` を渡し、いつもの
  お祝いは重ねない。推しがオンなら `luckTakeOshi()` で一度だけ `lucky` の場面にする
- 上限は `LUCK_RULES()` だけ (1/8・1日3回・30分空ける・1時間に3つでノリノリタイム15分)。**上限を先に見て、乱数はそのあと**。
  数は端末 (`localStorage` の `bantoLuck`) に覚え、読めなければその画面の控え (`luckMem`) だけで数える
- **ノリノリタイムは黙って終わる** (「終わりました」も残り時間も出さない)。札は「ノリノリタイム」だけで、× で隠せる (覚える)。
  札は右下 (左下は推しの吹き出し)。集中の置き場 (`#focus-dock`) が出ているあいだは `is-above-dock` でその上に積む (`luckChipPlace`。
  出入りは MutationObserver で見る)。
  枠の光 (`.luck-fever-frame`) は押せず読み上げにも載らない。お祝いの字は `is-fever` で大きくする
- 動きを減らす設定では、当たりは字の札 (`.is-static`) だけ、ノリノリタイムは札だけ (枠を描かない)
- ご褒美は自分まわりの `makeRewardMeButton` から右のペインに開く。足りないご褒美は押せないだけにする (「あと◯で」と近さを見せない)。
  取り消しの帯は `undoUntil` で外す (時計は描き直すたびに1つに戻す)。サーバは `src/core/Reward.gs` / `src/api/Reward.gs`
- 試すのは `test/component/luck.test.js` (押して確かめる)・`test/luck-ui.test.js` (上限の計算)・`test/reward.test.js` (サーバ)・
  `test/e2e/luck.test.js` (通し)

## 集中のしかた (`js-focus`)

自分の設定の「集中のしかた」(`focus.start` / `focus.remind` / `focus.sound` / `focus.music` / `focus.musicUrl`) をオンにした人の画面にだけ出す。**既定はオフ。**
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
- **自分の曲 (`focus.music` / `focus.musicUrl`) は、この画面が外から取ってくる2つの例外の1つ** (もう1つは推しのクリアの動画。
  同じ決まりで作る。`CLAUDE.md` の「制約」)。
  YouTube / SoundCloud の公式の埋め込みの再生機を `<iframe>` で置く。守ること:
  - **「読み込む」を押すまで何も置かない** (`makeFocusMusicControls` は枠を作らない。`focusMusicLoad` は押した聞き手からだけ呼ぶ)。
    設定の画面でリンクを確かめるときも読み込まない
  - src は `prefs.effective.focus.musicParts` (サーバが読み解いた部品) から `focusMusicEmbedUrl_` で組んだものだけ。
    貼られた URL の字は画面にもサーバにも残さない。YouTube は `www.youtube-nocookie.com`
  - 枠の属性は `allow="autoplay; encrypted-media; fullscreen"`・`referrerpolicy="strict-origin-when-cross-origin"`・
    `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"`。
    再生機は自分の場所のスクリプトと保存 (allow-scripts + allow-same-origin) が要る。YouTube は送り元 (Referer) が無いと
    再生を断る (error 153) ので `no-referrer` にしない。題名や「YouTube で見る」で開く頁は枠の外で開かせる
    (`allow-popups-to-escape-sandbox`。付けないと開いた頁も枠の制限を受けて動かない)。`allow-top-navigation` は付けない
    (番頭の頁を差し替えさせない)
  - 画面の中で作る音とは同時に流さない (`focusSoundPlay` が `focusMusicClose` を呼び、`focusMusicLoad` が `focusSoundStop` を呼ぶ)。
    集中を終える (`focusClear`)・設定でやめる (`focusPrefsChanged`) と枠ごと外す
  - **確かめていないこと**: 番頭は HtmlService の枠 (IFRAME モード、`*.googleusercontent.com`) の中で動き、その枠にも
    sandbox が付いている。入れ子の枠は外の枠の制限を超えられない。全画面は sandbox ではなく `allow` の `fullscreen` で許すもので
    (`allow-presentation` は Presentation API = 別の画面へ映す仕組みのためのもの)、外の枠 (HtmlService) が全画面を許していなければ
    効かない。HtmlService が枠の中の頁に CSP (`frame-src`) を付けて外の枠を止めるかどうか、YouTube / SoundCloud の
    `X-Frame-Options` / `frame-ancestors` が googleusercontent.com の中で許すかは、実機で確かめていない
    (どちらの再生機も埋め込み用なので、ふつうは許す)。職場のネットワークで止められることもある
- 「ADHD」など人を分ける言葉は画面に出さない。「集中のしかた」として全員向けに書き、効き目を約束しない
- 試すのは `test/component/focus.test.js` (押して確かめる)・`test/focus-ui.test.js` (計算と音の形)・
  `test/focus.test.js` (サーバ)・`test/e2e/focus.test.js` (通し)

## 作業部屋 (`js-room`)

自分の設定の「作業部屋を使う」(`room.on`、`PREFS_SCHEMA()` の `room`) をオンにした人の画面にだけ出す。**既定はオフ。**
画面は `prefs.effective.room.on` を `roomOn()` で読むだけ。オフのあいだは入口 (`makeRoomOpenButton`) が null を返し、
`applyPrefs` の `roomPrefsChanged` が開いている部屋を閉じ、集中の窓の入口を外す (`roomSyncDockButton`)。手引きは `docs/manual/focus.md` の「作業部屋」。

- **音は画面の中で作る** (ファイルも外の取得も使わない)。雨・キーボード・たき火・風・カフェ・マウス (`ROOM_SOUNDS()`) を、
  でたらめに起きる音 (雨粒・打鍵・はぜる音・器の音) も含めて 20〜30秒ぶん `AudioBuffer` に描き (1秒の標本の数は
  `ROOM_SOUNDS()` の `rate`。カフェは声らしいものを6つ重ねるので 12000、ほかは 24000)、`loop` で繰り返す (背景のタブでは時計が間引かれるので、時計で鳴らさない)。継ぎ目は、ノイズを少し長く描いて頭に重ね
  (`focusLoopSeam`)、揺れは一周で頭に戻る値 (`roomSmoothAt`)、短い音ははみ出しを頭へ回す (`roomPut`) ことで切れないようにする。
  カフェは帯を絞ったノイズで、**言葉は作らない** (1本のノイズをずらして6つの声に使い回す)
- **描くのは刻みに分ける。** 一度に描くと1〜2秒画面が固まった。描き方は手順の並び (`roomRenderSteps` → `roomSteps*`) で、
  画面は1手順ずつ `setTimeout` で走らせる (`roomRunLater`)。描いているあいだ「音を流す」は「準備中…」(`aria-busy`)。
  途中で止める・外すと残りの手順は捨て、描き終わっても鳴らさない。`roomRender*` は同じ手順を一度に走らせるもの (試す用)
- 音の形は画面に依らない関数 (`roomRender*` / `roomBiquad` / `roomMixClean` …) で、`test/room-ui.test.js` が `ui()` で切り出して
  決まった乱数で確かめる (長さ・範囲・NaN が無い・同じ乱数なら同じ音・継ぎ目)
- **押した聞き手の中でだけ作って鳴らす** (`roomSoundPlay`)。開いただけでは `AudioContext` を作らない。全体の大きさは
  `ROOM_GAIN_MAX` を超えない。始めは `ROOM_FADE_IN`、止めは `ROOM_FADE_OUT` で上げ下げし、止めたら音の仕組みを休ませる
- **集中の音・自分の曲とは同時に流さない。** `roomSoundPlay` が `focusSoundHush` (作る音を止めて窓のボタンの字を戻す) と
  `focusMusicClose` を呼び、`focusSoundPlay` / `focusMusicLoad` が `roomSoundStop` を呼ぶ
- **閉じたら手放す。** 部屋を閉じると下げ終わってから音の仕組みを `close()` し、描いた音 (`roomBuffers`) も捨てる。
  開き直して流すと作り直す。止めて流し直すたびに作る全体の大きさの節は、下げ終わったら `disconnect` する
- 混ぜ方は端末の `localStorage` (`roomMix`) にだけ覚える。読むときは `roomMixClean` で知らない音を捨て、欠けを既定で埋める
- **キーボードの種類** (`roomMix.keysKind`。`ROOM_KEYS_KINDS()` の red 赤軸 / blue 青軸 / membrane メンブレン / laptop ノートパソコン、
  既定 red。知らない値は `roomKeysKindClean` が red にする。2026-10-22 の依頼)。描き方は `roomRenderSteps('keys', …, keysKind)` →
  `roomStepsKeys(rate, seconds, rand, kind)` → `roomKeyStroke(…, kind)` で、打つ間隔と描き終わりの大きさは `roomKeysTone`。
  **描いた音の入れ物 (`roomBuffers`) の鍵は `roomBufferKey` で、キーボードだけ種類を含める (`keys:blue`)。** 種類を鍵に入れないと、
  変えても前の種類の音が鳴り続ける。選ぶ欄 (`makeRoomKeysKind`、キーボードの行の `select.room-sound-kind`) で変えると覚え、鳴っている
  最中なら `roomVoiceStop('keys')` → `roomVoiceStart('keys')` で差し替える (描いてある種類はすぐ、無ければ刻みに分けて描く。
  描いているあいだに種類を変えたら、描き終わった前の種類は鳴らさない)。種類ごとの違いは `test/room-ui.test.js` が数で比べる
  (2.5kHz より上の割合・最大振幅・1打の長さ)
- マウス (`mouse`、既定オフ) は、いつ鳴らすかを `roomMousePlan` が先に決める (押す・離すは 60〜90ms、ときどきダブルクリック、
  ときどき 30ms おきのホイール3〜8個、操作の間は 0.6〜4秒)。音は `roomStepsMouse` が重ねる
- 部屋 (`#room`) は開くときに作り、閉じると外す (音・時計・顔の入れ替えも止める)。絵は `makeRoomScene` がその場で SVG に描き、
  色は `--room-*` のトークン (`docs/dev/design.md`)。窓の外は端末の時計 (`roomPhaseOf`) で `data-phase` を変え、CSS が色を当てる
- **部屋は画面の上にかぶせる窓 (`role="dialog"`)。** 開いているあいだ、ほかの body の子を `inert` にし (帯と補足の吹き出しは除く)、
  Tab は部屋の中で回す (`roomKeepTab`)。閉じたら戻し、焦点は開いた入口へ戻す (自分まわりからなら欄が閉じているので `#me-btn`、
  集中の窓からならその入口。外れた・隠れたなら描き直された入口 → `#me-btn`)
- **Esc は部屋だけが受ける。** `document` の捕まえる段 (capture) で受け、`stopImmediatePropagation` する (集中の画面や右のペインまで閉じない)
- **重なり**: 部屋 (`.room`) は 393。帯 (`.snackbar` 395) と補足の吹き出し (`.hint-bubble` 396) はその上。全画面のあいだは
  全画面の要素の中しか見えないので、帯と吹き出しを部屋の中へ置き直す (`roomAdoptOverlays`。`showSnack` / `hintBubble` も
  `document.fullscreenElement` があればその中に作る)。全部オフで流そうとしたときの断りは帯ではなく音の欄の中に出す
- **全画面は押した中で頼む** (`roomToggleFullscreen`)。`requestFullscreen` が無い・`document.fullscreenEnabled` が false の画面
  (jsdom、全画面を許していない枠) ではボタンを押せなくして理由を添える。Esc は全画面ならブラウザが戻し、そうでなければ部屋を閉じる。
  **確かめていないこと**: HtmlService の枠 (IFRAME モード) が全画面を許しているか。許していなければボタンが押せないだけ
- 推しは `oshiFillFigure` で描く。作業中 (`work`) の絵があればそれ (自分のキャラに無ければ `oshi.fallback` の最初からいるキャラの絵)、
  無ければ `oshiPickState('idle')`。推しがオフなら人影 (`makeRoomSilhouette`) で、絵を取りに行かない
- 動き: 作業中だけ息をする揺れ (`.is-breathing`)、35〜70秒ごとに4秒だけふつう・ほめるの顔、窓の雨 (`.room-drop`、`ROOM_DROPS_MAX` まで)。
  **動きを減らす設定では付けない** (`.is-moving` を付けず、雨は止めた粒を少しだけ)。開いているあいだに設定が変わっても
  `matchMedia` の change で合わせ直す (`roomOnMotion`。止めた粒は見える位置に置き直す)。見ていないタブでは雨を止め (`visibilitychange`)、顔も替えない
- 集中しているあいだは隅に残りの輪 (`.room-focus`、`focusRemainingMs` で数える)。**部屋は集中を始めない**
- 試すのは `test/component/room.test.js` (押して確かめる) と `test/room-ui.test.js` (音の形)

- **部屋の推しも頭をなでられる** (`oshiAttachPat(fig, roomPat)`。推しの頁の顔と同じ仕組み。2026-10-22 の依頼)。なでると
  `roomFillCharacter('praise')` にして「なでられた」のせりふを頭の上 (`.room-oshi-say`) に出し、4秒で `work` に戻して
  手を止める時計 (`roomScheduleGlance`) を仕掛け直す。笑顔のあいだは何度なでても変わらない。オフの人影はなでても何も起きない

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

自分の設定の「推し」(`oshi.on`) をオンにした人の画面にだけ出す。**ほかの飾りと違い既定でオン** (利用者が決めた例外。
既定のキャラもタク)。推しの設定 (`oshi.*`) はどれも自分の設定 (scope `'me'`) で、チームの値は読まない
(`test/oshi.test.js` の「推しは既定でオン、選ぶのは自分の設定」)。自分で作ったキャラクターの絵を上げると、
済ませたときに左下の吹き出しでほめ、ホームであいさつし (`oshi.home`)、実績を取るたびに なつき度 (Lv) が上がる (Lv = 1 + 取った実績の数。
段は `OSHI_STAGES()` が Lv で決める)。**人に見せる名前は「なつき度」** (段は よそよそしい・なれてきた・なついた・べったり・家族)。
前の呼び名「育ち」は key と関数名 (`grow*` / `growth` / `oshiGrowth_` / `OSHI_STAGE_MAX`) にだけ残してあり、変えない (台帳と覚えに残る)。手引きは `docs/manual/oshi.md`。

- **表情・口調・場面・せりふ・頼み文・なつき度の段・上限は `src/core/Oshi.js` が唯一の定義。** 画面は `apiOshiGet` の返事を
  使い、写しを持たない (手引きも頼み文を写さない。`test/oshi.test.js` が見ている)。せりふを足すときは `OSHI_LINES()` の
  全部の口調に足す (どの口調も全部の場面を持つことをテストが見ている)
- 画面が持つのは「成功した api の名前 → 場面」の表 `OSHI_CALL_EVENTS()` だけ。`FUN_CHEERS` と同じく `call()` の
  成功の枝から `oshiAfter` を呼ぶ。失敗の枝からは `oshiAfterFail` を呼び、**表に当たる (人が押した) 操作だけ**
  「しんぱい」を出す (裏で取るだけの呼び出しの失敗では出さない)。**キャラクターは叱らない**
- 画像は1枚ずつ `apiOshiImage(charId, state)` で取り、中身の指紋ごとに画面が覚える (`oshiImgs`)。サーバはキャッシュに置かない
  (CacheService は1つ 100KB まで)。絵が無い表情は、なつき度の段の絵 → ふつうの絵 → 名前の頭文字の順に代える。
  **ふつうの顔 (`idle`) を出すところは、いまの段の絵 (`grow*`) があれば先に出す** (`oshiPickState` だけが決める。ホームのあいさつ・
  作業部屋・吹き出し)。場面の表情 (ほめる・おいわい・ねむい・むっ など) は置き換えない。自分のキャラは自分で段の絵を入れたときだけ。
  段の絵が無ければ、その段から下へ絵のある段を探す (`oshiStagePicture`。べったり `grow4`・家族 `grow5` は `optional` で `fallback: 'grow3'`。
  最初からいるキャラはなついたまで)。表情が14になり、1枚の表は 4 × 4 (余った2マスは「使わない」)
- 上げる前に画面で長い辺 512px に縮める (canvas が使えるときだけ。GIF は縮めない)。上限・形式はサーバの値で見て、
  サーバも同じ値で断る (先頭のバイトで中身の形式も見る)
- **推しの頁の顔 (`makeOshiHero`)。** いま使うキャラの絵を大きく出し、絵の上半分で指が左右に往復 (向きが2回変わる) したら
  「なでた」と数え、笑顔 (`praise` を `oshiPickState` に通した絵) にして、場面 `pat` (なでられた) のせりふを絵の下の
  `aria-live` の字に言う (吹き出しは使わない。見ている目の前で言う)。指を動かせない人は「なでる」ボタン。4秒で戻り、
  そのあいだは何度なでても取り直さない。粒は `funBurst` (減らす設定なら出ない)。`touch-action: pan-y` で縦の
  スクロールは残す。オフの人には出さない (絵を取らない)。なつき度・実績・機嫌には何もしない (遊びの演出)
- **絵は要るときに取るが、読み込んでから少し待って、いま使うキャラの絵を全部の表情ぶん裏で取っておく** (`oshiWarmImages`。
  `apiOshiGet` が届いて 1.5 秒後から 150ms ずつ)。そのままだと場面が来た瞬間 (済ませた・実績を取った) に、せりふの後から
  絵が遅れて出ていた (2026-10-22 の指摘「ワンテンポ遅れて反映される」)。`oshiImage` を通すので、オフの人・絵を出さない設定の人は
  裏でも取らず、届く前にキャラや形を変えていたら古い読み込みのぶんは捨てる。最初の画面の呼び出しと重ねないための間なので、
  `test/component/oshi.test.js` は偽の時計で 1499ms までは取らないことも見ている
- **推しの画像の中身は `objects/oshi-<sha>.<ext>` に置く** (`oshiObjectName_`)。文書の履歴の画像も `<sha>.<ext>` で置かれるので、
  同じ名前だと推しの画像を外したとき、同じバイトの履歴の画像までゴミ箱へ移していた。この形にする前の行の中身
  (`<sha>.<ext>`) は読めるが、どちらのものか見分けられないので**外しても消してもゴミ箱へ移さない**
- **Drive のファイルは鍵の外で触る。** 鍵の中では台帳の行を書き、片付ける中身の指紋を集めるだけ。置くのは行を書いた
  あと、ゴミ箱へ移すのは読み直してどの行からも指されていないと確かめてから (`oshiDropObjects_`。`test/oshi.test.js` の
  「鍵の中で Drive を触らない」)
- **使うキャラを選んだら (設定のカード・推しの頁の「このキャラを使う」)、選んだキャラがあいさつする** (`oshiSayChosen`)。
  場面は `chosen` (「選んでもらった」。口調ごとに 3〜4 つ、`OSHI_LINES()`)。表情は `randomState` で、出すときに
  そのキャラの絵からでたらめに選ぶ (`oshiChosenState`。最初からいるキャラはどの表情からでも、自分のキャラは絵を入れた表情から、
  1枚も無ければ絵が無い表情に出す最初からいるキャラの表情から)。オフなら何も取らない。吹き出しは焦点を奪わない
- 吹き出しはマウスが乗っているあいだとキーボードで中に入っているあいだは消さない。使うキャラのカードは矢印で選び直せ、
  Tab で入れるのは選んでいる1枚だけ
- 吹き出しは1つ (`#oshi-bubble`)。字は `textContent`、絵は自分の推しの data URL だけ。押せば閉じ、6秒で消える。
  動きを減らす設定では CSS がふわっと出る動きを止める。「久しぶり」は端末に最後に開いた日 (`oshiLastSeen`) だけを覚え、
  連続日数は数えない
- **キャラは2種類。** 最初からいるキャラ (`OSHI_BUILTINS()` が唯一の表。タク = 明るい相棒 (先頭 = 既定)、イツキ = 耽美、つじっぴ = まっすぐ前向き、いっくん = じっくり寄り添う、りょうか = 結論から、さと美 = ゆるふわ。名前・口調・絵は
  決まっていて変えられない) と、本人が作る自分のキャラ (`OSHI_MINE_MAX()` = 5人まで。番号 `charId` で名指す)。どれを使うかは
  自分の設定 `oshi.char` (`'builtin:<key>'` / `'mine:<charId>'`、既定は `'builtin:taku'`)。`apiOshiGet` はいま使うキャラ
  (`kind` / `builtinKey` / `charId` / `name` / `tone` / `events` / `images`) と、頁で直すための自分のキャラ全部 (`mine`) を返す
  - **`oshi.char` は人ごとに選べるものが違う** (type `'char'`)。`prefValid_(item, v, email)` が `oshiCharKnownFor_` で、
    最初からいるキャラか、その人が持っている自分のキャラかを見る (自分のキャラのときだけ台帳を読む)。無い・消したキャラを
    指していても表示の道では断らず既定に倒し (`prefValueOf_`)、`apiPrefSet` だけがふつうの言葉で断る。選んでいた自分のキャラを
    消すと `apiOshiCharDelete` が既定に戻す。画面の選び方は `makeOshiCharPicker` (設定の一覧で `type === 'char'` の欄だけ
    js-oshi が組む)。最初からいるキャラは設定の `options`、自分のキャラは `apiOshiGet` の `mine` から並べ、ふつうの顔の絵を
    添える (**推しがオンのときだけ絵を取る**)。押したら `apiPrefSet` で書く (書くのはここだけ、のまま)
  - 自分のキャラの絵が無い表情には `oshi.fallback` (`'builtin:<key>'` / `'none'`、既定はタク) の絵を出す。最初からいるキャラを
    使っているときは、そのキャラの絵だけ。形は `oshi.style` = `chibi` / `normal`、既定は 2頭身
  - 前の `oshi.useDefault` (最初からいるキャラを使う) は `oshi.char` / `oshi.fallback` に置き換えた (出す前だったので移行は無い)
  - 絵の本物は `assets/oshi-default/<キャラ>/<形>-<表情>.webp` (透明な WebP)。`scripts/build-oshi-default.mjs` が base64 の
    data URL にして、キャラ×形ごとに `src/ui/oshi-default/<キャラ>-<形>.html` に焼く。中身は 表情 → data URL の JSON の字だけ
    (1行。タグもコメントも無い)。**焼いたものは手で直さない** (配る道具の `src/ui/kit-files.html` と違いフックでは止めていない)。1つ 600KB まで。
    `npm run deploy` が送る前に焼き直し、`test/oshi-default.test.js` が assets と一致しているか・JSON として読めるか・
    スクリプトに絵が無いかを見ている。キャラ・表情・形の並びは `Oshi.js` から読むので、キャラを足してもサーバとテストの並びは直さない
  - **絵をスクリプト (.gs / .js) に焼かない。** GAS はどの呼び出しでも全部のスクリプトを読み込む。以前は
    `src/core/OshiDefault<キャラ><形>.gs` に焼いていて、合わせて 3.3MB が画面のどの api* も遅くしていた (2026-10-22 の指摘
    「全体的に読み込みが遅い」)。HTML のファイルは読むときだけ読まれるので、そちらに移した。サーバは `OshiStore.gs` の
    `oshiDefaultPictures_` が `HtmlService.createTemplateFromFile('ui/oshi-default/<キャラ>-<形>').getRawContent()` を
    `JSON.parse` し、同じ実行の中では1回だけ読む。`createHtmlOutputFromFile` は HTML として読み直して中身を変えることがあるので
    使わない (`include()` と同じ理由)。ファイル名はキャラと形の定義の key からだけ作り、無い・壊れたファイルは絵が無い扱い (null)。
    疑似GAS の `createTemplateFromFile` は、`_setKitFile` で置いたものが無ければ `src/<name>.html` を実ファイルから読む
  - **最初のページには入れない。** 1人の2つの形で 1MB 近くあるので、吹き出し・カード・頁・設定の選び方が要るときに
    `apiOshiDefaultImage(char, style, state)` で1枚ずつ取り、画面が `'キャラ:形:表情'` ごとに覚える (`oshiDefaultImgs`。
    取りに行っている最中の同じ絵は待ち合わせる)。オフの人・絵を出さない設定の人は1度も取らない。キャラ・形・表情は定義に
    あるものだけを通す
  - 表情 `work` (作業中) は作業部屋 (`js-room`) のために末尾に足した。最初からいるキャラの絵も焼いてある。
    決まった場面でだけ出す表情なので `scene: true` を持ち (`apiOshiGet` の states にも渡す)、でたらめに選ぶ表情
    (`oshiChosenState`) には入れない
  - 最初からいるキャラの名前は呼び名だけ。**実在の人の名前・所属・出身・勤め先・肩書きを、コード・コメント・テスト・手引き・記録の文・ファイル名に書かない**
    (性格は自分の言葉で書く)。絵は利用者が用意したもの (2026-10-21)
  - **キャラを足す手順。** 利用者の絵が「いくつもの絵が並んだ1枚」のときは、`assets/oshi-sheets/<key>/<形>.webp` (透明な
    WebP。`cwebp -lossless -exact` で可逆に縮める) に置く。**この元の絵はリポジトリに入れない** (`.gitignore`。2026-10-22 の見直しで、
    使っていない予備の枠にユニフォームの字・背番号・製品のロゴなど、実在の人に結び付きうるものが残っていると分かった。
    リポジトリは公開なので、切り出した絵 `assets/oshi-default` と切り出し表 `cells.json` だけを置く)。元の絵は手元に置き、
    `node scripts/cut-oshi-sheet.mjs <key> --detect <形>` で透けていない
    画素の塊を一覧して `cells.json` の枠 (`cells`) を書く。隣の絵とくっついた塊は `{box, cut}` で切る線を分ける。
    `--all <出す先>` で予備も含めて全部を書き出し、一覧の絵にして**目で見て**枠を直す (はみ出した隣の手足・欠けた飾りは数では
    分からない)。等身と2頭身が1枚に混ざった絵は、塊ごとに上下で2つの .webp に分けて置く (りょうか)。1枚ずつの絵があるときは、並んだ絵の下に並べて1つの .webp にしてよい (さと美)。表情ごとの絵 (`states`) を決めたらフラグなしで `node scripts/cut-oshi-sheet.mjs <key>` を走らせ、`assets/oshi-default/<key>/` に書く。**ポーズが表情より少ない絵では、段の絵 (`grow1`〜`3`。待機の顔は段の絵に代わるので、ずっと出る) を一時の表情 (ほめる・おいわい・おうえん・びっくり など) と同じ絵にしない**。重ねるなら一時の表情どうしにする (さと美の2頭身は8ポーズで、ほめる と おいわい、びっくり と 作業中 が同じポーズ)。1つの枠を2つの表情に使うと、表情ごとに別の絵かを見るテストが落ちる (同じポーズの別の大きさの枠を使う)。並べて目で見るには `--all <出す先>`。使わない絵は
    `spare_*` として枠だけ残す。そのあと `OSHI_BUILTINS` と口調 (`OSHI_TONES` / `OSHI_LINES` の全場面) を足し、
    `node scripts/build-oshi-default.mjs` で焼く (`src/ui/oshi-default/` に2つ増える。サーバは直さない)。`test/oshi-sheet.test.js` が、切り出し表から
    切り直した絵と置いてある絵が同じかを見る (libwebp か手元の元の絵が無ければ飛ばす)。プロフィールの中身はリポジトリに書かない (管理者が設定の画面かコマンドキューで入れる)
  - むっ (`pout`) は optional。最初からいるキャラも、合う絵があるときだけ焼く (無ければ しんぱい の絵に代わる)
- **プロフィール (`.oshi-reveal`) とクリア (`.oshi-clear`) は返事を描くだけ。** どこまで分かるかは `apiOshiGet` の `reveal`
  (サーバが Lv で決める。届いていない項目は Lv だけ届くので ??? と「Lv ◯ で分かる」)、クリアは `cleared` / `clear`。
  お祝いの言葉が無いキャラは場面 `clear` (実績を全部取った) のせりふ。**動画は「動画を見る」を押した聞き手の中でだけ iframe を作る**
  (URL は `focusMusicEmbedUrl_` (js-focus の写し) で id から組み直す。youtube-nocookie。押すまで何も読み込まない)。
  実績で Lv が変わったら `achSyncOshi` が `oshiRevealRefresh` で取り直し、知らせには `oshiProfileOpening` の数を添える
- 自分のキャラのプロフィールは JSON の欄 (`makeOshiCharProfileEditor` → `apiOshiSetCharProfile`)。最初からいるキャラのぶんは設定の
  画面の管理者の節 (`makeOshiBuiltinProfileSettings`。`settings.canEdit` のときだけ組み、`apiOshiBuiltinProfiles` を取る)
- **キャラ作成キット (やること #50)。** 頼み文は `oshiCharKitPrompt` (`src/core/Oshi.js`) が唯一の定義で、道具 (`OSHI_CHARKIT_TOOLS()`) の
  一覧だけを `apiOshiGet` の `kitTools` で渡し、中身は「コピー」を押したときに `apiOshiCharKitPrompt` で取る (画面は写しを持たない)。
  一度取った字は `oshiKitPrompts` に覚え、2回目からは押した中で写す (返事を待ってから写すと、写せない画面がある。そのときは字を選んだままにする)。
  プロフィールの項目の Lv は `oshiCharKitLevels(1 + 実績の数)` (2 から 2 ずつ)。表情の絵の決まりは `OSHI_PROMPT_LOOK_RULES()` を
  表情ごとの頼み文と共用し、「参考画像と同じキャラクター」は入れない (写真の人をそのまま描かせない)
  - 「AI の答えを貼る」(`makeOshiImport`) は字をそのまま `apiOshiCharImport(charId | 0, text)` に送る。**取り出し (`oshiExtractJson`) と検査
    (`oshiCharImportValid_`) はサーバだけ**。知らない欄は捨て、口調・長さは断る。書き直すときは答えにある場面だけ置き換え、動画は残す
  - 「緑の背景を抜く」(`oshiGreenOn`) は切り替え (`setToggle`)。`oshiKeyGreen` が ImageData の data を書き換える (画面に依らない関数。
    `test/oshi-charkit-ui.test.js`)。描けない画面 (jsdom) では、絵を読み込む前に断る (`oshiCanvas(1, 1)` が null)。GIF は抜かない
  - 「1枚の表から切り分ける」(`makeOshiSheet`) はマスを `oshiSheetCells` で決め (端数は丸め、隙間も重なりも作らない)、既定の行と列は
    サーバの `oshiSheetGrid` (`apiOshiGet` の `sheet`)。選んだマスを `oshiCutPng` で切り、いつもの `apiOshiSetImage` で1枚ずつ順に送る
    (上限もいつもどおり。失敗したらそこで止め、入れた枚数を出す)。入れているあいだは表・行・列・マスの表情を押せなくする (`lock`)。
    表は 10MB まで (読む前)・縦横 4096px まで (読んだあと)。マスは画像の幅と高さより多く分けない。「緑の背景を抜く」を切り替えると
    見本を描き直す (選んだ表情は残す)
  - 取り出し (`oshiExtractJson`) は ```json の囲み → ほかの囲み → 全体の順で、最初の { から1回だけなめる。**最初の物が読めなければ断る**
    (内側や後ろの物に逃げない)。貼った字は 60000 字まで (`OSHI_CHARKIT_TEXT_MAX`)。名前・せりふ・プロフィールの字から制御文字と
    字の向きを変える印を落とし (`oshiCharKitText_`)、せりふの JSON の長さ (`OSHI_LINES_JSON_MAX`) は鍵を取る前に見る (直すときは残す場面と合わせて)
  - 「コピー」は開いたときに選んである道具の字を先に取る。写せなかったときは、閉じた「頼み文を見る」を開いてから字を選ぶ
    (`oshiCopyByHand`。表情ごとの頼み文も同じ)
  - 試すのは `test/component/oshi-charkit.test.js` (返事は本物のサーバ。描く器と絵は疑似)・`test/oshi-charkit.test.js` (サーバ)
- 試すのは `test/component/oshi.test.js` (返事はサーバの `apiOshiGet` から作る)、通しは `test/e2e/oshi.test.js`。
  プロフィールとクリアは `test/component/oshi-profile.test.js` と `test/oshi-profile.test.js`
- **機嫌 (`oshi.mood`、既定オフ) は返事を描くだけ。** 決めるのはサーバ (`OSHI_MOOD_RULES()` / `oshiMoodOf` は `Oshi.js`、数えるのは
  `src/core/OshiMood.gs` の `oshiMood_`)。`apiOshiGet` の `mood` (オフなら null) を、しょんぼり・むっ・直ったばかりのときだけ
  ホームのカード (あいさつの代わり) と推しの頁の「機嫌」の節 (`makeOshiMood`) に出す。「どうして？」(`makeOshiMoodWhy`) はわけを数だけで
  出し、期限切れには改善のヒントと同じ `adviceGo({kind: 'issues-overdue'})` の「見る」を付ける (ほかのわけには合う絞り込みが無いので付けない)。
  機嫌が変わりうる操作 (`OSHI_MOOD_CALLS()`: 済ませた・取り消した・直した・捨てた・戻した・ボードで動かした・反映した) のあと
  (`oshiMoodAfter`) に `apiOshiMood` で取り直し、直っていたら `oshiSayNext('mood_recover')` (済ませたほめ言葉に重ねない)。
  返事は `latest('oshiMood')` の `.only` で受け、取りに行っている間に推しを取り直していた (`oshiData` が替わった) ら捨てる。
  サーバの覚えは Issue.gs の `issueMoodForget_` が消す (`projectMove` は「完了」の列に出入りしたときだけ、鍵の外で呼ぶ)。
  機嫌の場面 (`events[].mood`) は、機嫌を見ていない人の自分のキャラのせりふの欄に出さない。**変わるのは表情とせりふだけで、何も取り上げない・知らせない**
- 表情 `pout` (むっ) は `optional` (絵が無くてもよい) で `fallback: 'worry'`。最初からいるキャラにはまだ絵が無いので、
  `build-oshi-default.mjs` は optional の表情の絵が無ければ焼かず、`apiOshiDefaultImage` は null を返す。画面は `oshiPickState` が
  `fallback` を先に試し (自分のキャラに むっ が無く代わりの表情の絵があれば、最初からいるキャラより自分の絵を先に)、最初からいるキャラの絵が null なら `oshiDefaultMissing` に覚えて代わりの表情の絵を出す (2回取りに行かない)。
  代わりの絵を出したときは、`img.alt` も出した絵の表情の名前にする (`oshiImage` の cb の2つ目)。
  `scene: true` なので、でたらめに選ぶ表情には入れない。キャラ作成キットの頼み文は むっ を「無くてもよい」、機嫌の場面を
  「機嫌がオンのときだけ」と書く (むっ を足して表情が12、のちになつき度4・5 を足して14。1枚の表は 4 × 4)。試すのは `test/component/oshi-mood.test.js` と `test/oshi-mood.test.js`

## 実績 (`js-ach`)

自分の設定の「実績を集める」(`ach.on`) がオンの人に出す (**既定でオン**)。何を・いくつで取れるかは `src/core/Achievements.js` の
`ACHIEVEMENTS()` が唯一の定義で、画面は `apiAchievements` / `apiAchievementsCheck` の返事を描くだけ。手引きは `docs/manual/achievements.md`。

- この環境で取れない実績 (items の `off` / `reason`) は札「この環境では取れません」と理由を出す (`.is-off`)。残りが3つ以下なら
  サーバが名前と説明を入れる (`near`、`.is-near`)。クリアは返事の `cleared` (一度届けば消えない)、お祝いは `clearedNow` のときだけ (画面で数え直さない)
  (お祝いは実績を取った知らせ `achCelebrate` の中でだけ言う。**新しい実績を取らずにクリアに届いたとき (取れない実績が増えたなど) は、推しの
  「実績を全部取った」のせりふは出ない**。推しの頁のクリアの節は出る。仕様としてそのままにしてある)

- **開いたときの数え直しは js-init が `achOpenCheck()` で1回だけ頼む** (開いた日もこのときだけ数える)。設定が届くまで待ち、
  `settlePrefs` が呼び直す。js-init は js-ach より前に読まれるので、**js-ach の状態の `var` に初期値を書かない** (`var x = false;` と
  書くと、js-init が付けた印がその行で消える。`var x;` は値を消さない)
- 画面が持つのは「成功した api の名前 → 数え直すか」の表 `ACH_CALL_EVENTS()` だけ。`call()` の成功の枝から `achAfterCall` を呼ぶ
  (`FUN_CHEERS` / `OSHI_CALL_EVENTS` と同じ形)。表の値はその操作で変わりうる数えるもので、数え直しは
  `apiAchievementsCheck({metrics})` (開いた日は数えず、名指したものだけ)。返事を待つあいだに頼まれたものは、返事のあとにまとめて1回だけ頼み直す。
  絞った返事 (`partial`) では頁を描き直さない
- 使われ方で確かめる実績 (Markdown で保存 `md-save`・日報をコピー `report-copy`・探す `search-open`・推しを選ぶ `oshi-choose`) は、
  その場で `usageCount('action', …)` を数え、`apiUsageRecord` を送ったあとに数え直す。場所の名前は `ACH_USAGE_TARGETS()` で、
  サーバの `ACH_USAGE_PLACES()` と同じ (`test/achievements.test.js`)
- 取ったときは隅の小さな知らせ (`#ach-toast`。`role="status"`・焦点を奪わない・帯 `#snackbar` とは別に出すので「取り消す」を消さない)。
  器は読み込んだときに空で置く (字を入れる前から在る器でないと、最初の知らせを読み上げない)。上の帯の下 (56px + `--sp-2`) に、
  自分まわり・知らせの欄 (160) より手前に出す。
  大きな字 (`funBanner`) は楽しい演出の `fun.cheer` もオンのときだけ。推しは「実績を取った」(`badge`)、段が上がったら
  「なつき度の段が上がった」(`levelup`) を上がった段の表情 (`grow1`〜`5`) で言う。**済ませたときのほめ言葉が出ていれば、消えてから言う**
  (`oshiSayNext`。待てるのは1つ)。`ach.cheer` を切ると全部出さない
- 推しのなつき度は返事で揃える (`achSyncOshi`。Lv が違うときだけ、出ている `.oshi-growth` を描き直す)。取り直さない
- 頁 (自分 → 実績、`.ach-page`) は `latest('ach')` を通す。まだのものは ??? で、名前は出さない。ホームの「最近の実績」(`.ach-card`) は
  `home.cards.ach` で止められる
- 試すのは `test/component/achievements.test.js` (返事は本物のサーバから作る)・`test/achievements.test.js` (サーバ)・
  `test/e2e/achievements.test.js` (通し)

## 目標 (`js-goals`)

チームの設定 `goals.enabled` (既定オフ) がオンのときだけ、左に「目標」(`#nav-goals`) を出す。オンかは `prefs.effective.goals.enabled`
を `goalsOn()` で読み、`applyPrefs` から `goalsPrefsChanged()` で出し入れする (設定で切り替えると、その場で出る)。

- **数え方は画面に写さない。** 進み具合・自動の見立て・期の中での進み方・「あと◯件」はサーバ (`src/core/GoalScore.js`) が返した字を描くだけ。
  押せるものも、サーバが決めた `canEdit` / `canSubmit` / `canInput` / `canDecide` / `canGrade` などだけで出す
- 見方は4つ (自分の目標 / 承認を待つもの / チーム / 期末のまとめ)。取り直す一覧は `latest('goals')` を通す (`test/component/stale-replies.test.js`)
- 届いていない数は赤くしない (帯は `--accent`、超えた分は字だけ)。チームの表は名前 → 状態の順 (サーバが並べる。進み具合で並べ替えない)
- 「承認を待つもの」の「期末の評価を付けるもの」には、期が終わったか本人が振り返りを書いたものだけを出す (期の途中から急かさない)
- やることの詳細の「目標」(`makeIssueGoalBox`) は `apiGoalIssueLinks` で、見られる結び付きと、自分の評価前の項目 (つなぐ先) を取る
- 試すのは `test/component/goals.test.js` (返事は本物のサーバから作る)・`test/e2e/goals.test.js` (通し)

## 作業雑談部屋 (`js-cowork`)

チームの設定 `cowork.enabled` (既定オフ) がオンのときだけ、左に「作業雑談部屋」(`#nav-cowork`) を出す (`coworkPrefsChanged` を `applyPrefs` から呼ぶ)。

- **部屋は押した聞き手の中で開く** (`coworkOpen`)。返事を待ってから開くとブラウザが窓を止める。URL はサーバが読み解いた部品から
  `coworkLinkOf_` で組み、`window.open(url, '_blank', 'noopener')`。番頭は Meet / Slack に何も頼まず、何も取ってこない
- 顔は名前の頭文字だけ (`makeCoworkAvatar`。アドレスを受け取らないので `makeAvatar` は使えない。形は `.avatar` のまま)
- 合図は入っているあいだ 60 秒ごと (`apiCoworkBeat`、`failQuiet`)。番頭のタブが裏でも30分 (`COWORK_HIDDEN_GRACE_MS`) は送り続ける
  (Meet の画面を見ているあいだに名前が消えないように)。それを過ぎたら止め、表に戻ったらすぐ送る。閉じたときは何も送らず2分で消えるのに任せる。
  部屋の画面を見ているあいだは、入っていなくても同じ時計で様子を取り直す。どちらでもなくなったら時計を止める
- 取り直す返事は `latest('cowork')` を通す (入る・出るも頼み直しとして数え、前に頼んだ様子・合図の返事を捨てる)。サーバに残った印から入っている部屋を
  戻すのは、その画面で最初に様子が届いたときだけ (出たあとに届いた古い返事で入り直さない。`test/component/cowork.test.js` の「遅れて届く返事」)
- 試すのは `test/component/cowork.test.js`・`test/e2e/cowork.test.js` (返事は本物のサーバ。キャッシュと時計は `test/cowork-cache.js`)
