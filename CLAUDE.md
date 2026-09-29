# agentic-management-gas

Google Workspace の文書（Docs / Sheets / Slides）に Git 相当の版管理を与える
Google Apps Script プロジェクト。設計は `docs/superpowers/specs/` を参照。

## 名前

人に見せる名前は **SoftBanto（そふと番頭）**、通称 **番頭**。リポジトリ名
`agentic-management-gas` は開発上の呼び名としてそのまま残してある。

**Drive のフォルダ名だけは `agentic-management` のまま**にしてある。既に動いて
いる実体をリネームする必然性がなく、変えると画面やドキュメントが指す先と
食い違う。設定はフォルダ ID で持っているので、名前は表示以外に効かない。

名前はタブ・通知メールの件名・配る道具の3か所に出る。`test/naming.test.js` が
揃っていることを固定している。**片方だけ直すと、食い違ったまま気づかれない。**

## この設計の中核

**すべてを正規化 HTML に変換し、それを blob として扱う。**
同じ内容からは常にバイト単位で同一の HTML が出ることが、行ベース diff と
3-way merge が成立する前提になっている。

### 出力を変えてはいけない

`src/core/Normalize.js` の `serializeBlocks` の出力を変えると、**過去の全コミットの
blob と食い違い、履歴が壊れる**。語彙を増やすときは既存の出力形に触れないこと。

Phase 3a で Sheets を足したときは、Docs の `<table>` は属性なしのまま残し、
Sheets を `<table data-sheet="名前">` という別形にした。

### Block 型と装飾のネスト順

```
run:  {text, bold?, italic?, underline?, strike?, link?}
順序: bold → italic → underline → strike → link (外側から)
```

`Normalize.js` の `serializeRuns_` と `Markdown.js` の `runsToMd_` は
**この順序で対称でなければならない**。崩すと往復が壊れる。

## テストの構成

| 対象 | 方法 |
|---|---|
| ピュアな `.js` (Hash / Normalize / Diff / Merge / Markdown / FileUrl) | vitest で直接 |
| GAS 依存の `.gs` | `test/fakegas.js` の疑似GASで統合テスト |
| DocumentApp / SlidesApp の描画忠実性 | 実機の `debug*` 関数 |

`test/harness.js` の `loadGas` / `loadGasWith` が `node:vm` でソースを評価する。
**ランタイムコードに `import` / `export` / `require` を書かない**（GAS で動かなくなる）。

### GAS は全ファイルを同じグローバルに読む

あるファイルが別のファイルの関数を呼ぶとき、**テストの SOURCES にも同じ集合を
揃える必要がある**。`PullRequest.gs` に通知を足したとき、Phase 2 のテストが
`Notifier.gs` を読んでおらず `notifyPrCreated is not defined` で11件落ちた。

## 破壊的操作の前には必ず検証する

書き戻しは `body.clear()` / `sheet.clear()` を伴う。**検証してから消す**。

- Docs: `htmlWriterValidate(blocks)`
- Sheets: `sheetWriterValidate(blocks)`
- 実体を取得できない画像 (`sha === 'unavailable'`) は書き戻すと永久に失われるため、
  マージ自体を拒否する

## メタDBの列を触るとき

`DB_SCHEMA()` が唯一の列順の定義である。

- **列は必ず末尾に足す。** 途中に挿入すると、既に書かれている行を新しい順序で
  読むことになり、値が1つずつずれる（`dueDate` を途中に入れて実際に踏んだ）
- **列を足したら、既に書かれている行の空欄をどう扱うか決める。** `reviews` に
  `id` を足したとき、それ以前の行は空のままで名指しできず、直そうとすると
  「やりとりを指定してください」で止まった。読むたびに埋める
  (`reviewBackfillIds_`) 形にした
- `test/schema.test.js` が全テーブルの列と順序を固定している

## 反映先は main とは限らない

確認依頼は改訂版どうしでも出せる。`pulls.targetBranch` が反映先を指し、
`prTargetBranchFileId` がその版の作業コピーを返す。

**3つを見比べる起点 (`prMergeBase_`) は、両方の分かれ目のうち古いほうを使う。**
新しいほうを使うと、相手にまだ無い変更まで「相手が消した」と読め、黙って
消える。`test/phase2-integration.test.js` の「分かれ目が違う版どうしを見比べる」
がこれを固定している（起点の選び方を逆にすると、実際に条文が1つ消える）。

## main の保護は API 層で行う

`assertNotProtected_` は `apiCommit` / `apiSaveMarkdown` から呼ぶ。
**`commitFile` そのものは変えない。** PR のマージは `commitFile` を直接呼ぶため、
人間の操作だけが止まる。

main を Docs で直接編集された場合の逃げ道が `apiStashMainDrift` である。
これが無いと「未コミットの main はマージも拒否される」ため行き止まりになる。

## テストの測り方と、測れないもの

```bash
npm run coverage
```

テスト回りの依存を入れ直すときは、**package-lock.json を消さない**。npm 10.9 には
vitest 4 の peer 解決で落ちる不具合があり (`Cannot read properties of null
(reading 'edgesOut')`)、ロックが無い状態からだと `npm install` が通らない。
`npm ci` はロックから入れるので問題ない。

どうしても作り直すときは `npm install --legacy-peer-deps` で入れるが、この形は
peer の検査そのものを止める。**入れたあと `npm ls vitest @vitest/coverage-v8` で
2つの版が揃っていることを確かめてから commit すること。**
`@vitest/coverage-v8` は vitest に「ちょうどこの版」を求めるため、片方だけ上がった
木でも黙って入り、`npm run coverage` を叩いたときに初めて落ちる。

そのため `devDependencies` では両方を **`^` 無しの厳密な版**で書いている。上げる
ときは2つ同時に上げる。

`node:vm` で評価するため、`test/harness.js` は **filename に絶対パスを渡す**。
相対パスだと実行された行が元ファイルに結び付かず、カバレッジが 0% と出る。

`test/setup.js` は、無いものを補うだけにしてある。Node 26 では起動時に
`--localstorage-file` を渡さないと `window.localStorage` が undefined になり、
幅や見え方の覚え書きを使う jsdom のテストが総崩れになる。**あるものは
置き換えない。** 置き換えると、本物との違いをテストが見なくなる。

カバレッジの数字は **vitest 4 から測り方が変わっている** (AST を見て戻す形に
なった)。3系で記録した値と直接は比べられないので、下がって見えても、それが
測り方の違いなのか実際の後退なのかを先に確かめること。

**行が覆えていても、状態が覆えているとは限らない。** 実際に次の2件を
高いカバレッジのまま見逃した。

- 「登録しただけで一度も記録していない文書」から分岐できなかった。
  どのテストも `setup()` で先に記録していたため、その状態が現れなかった
- 名前の検査が厳しすぎて空白入りの名前を弾いていた。その行は100%
  覆えていたが、テストが古い仕様のほうを固定していた

`test/e2e-journey.test.js` は**何も仕込まずに**人がたどる順序で通す。
仕込みで隠れる状態を見つけるためのものなので、`setup()` を使わないこと。

`test/component.test.js` は jsdom に画面を組んで**実際に押す**。ソースを
文字列で検査するだけでは、描画も応答も確かめられない。

**直したら、直す前に戻して落ちることを必ず確かめる。** 落ちないテストは
何も守っていない。この方法で「空の状態のボタンで落ちる」「起点の選び方を
逆にすると条文が消える」「一覧の幅が 320px 固定」を実際に捕まえている。

`test/dom.js` の `DEFAULTS` に**同じキーを二度書かない**。後のものが勝つため、
足したはずの応答が空のまま届き、原因の分からない空表示になる（実際に踏んだ）。

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
  **API を足したらそこに足す**
- 画面側の成功ハンドラは `list || []` で受ける

## サーバを呼ぶのは `call()` だけ

**`google.script.run` を直に書かない。** 失敗ハンドラを付け忘れると失敗が
完全に黙り、その画面だけが「押しても何も起きない」になる。`call(name, args,
onOk, onFail)` は `onFail` を省くと短い帯で知らせる。

失敗の見せ方は4つに寄せてある。**新しい見せ方を増やす前に、既にあるもので
足りないかを考えること。**

| | いつ使うか |
|---|---|
| （省略） | 既定。短い帯で知らせる |
| `failSnack('◯できませんでした: ')` | 押した操作と結び付けたいとき |
| `failInto(el)` | 一覧そのものが出ないとき。帯は数秒で消えるため後から見た人に伝わらない |
| `failEnable(btn, prefix?)` | 押した間は押せなくしてあるとき。**戻さないと二度と押せない** |
| `failQuiet('理由')` | 出なくても操作は続けられるとき。**理由を必ず書く**。画面には出さないが console には残す |

個別の後始末がある5か所だけは `google.script.run` の連なりのまま残してある。
定型でないものを `call()` に押し込まないこと。

## 誰が持ち主かは Session からは分からない

この Web アプリは `executeAs: USER_ACCESSING` で動くため、
**`Session.getEffectiveUser()` は常に開いている本人になる**。持ち主として扱うと
誰もが持ち主になる。`inquiryOwner_()` はリポジトリのフォルダの持ち主を見る。

## 数え方を決めたら、数字を見せる場所すべてに書く

やることの担当者は複数入る (`issues.assignee` はカンマ区切り)。工数は
**集計のときに頭数で割って**数える。それぞれに全部を足すと、人ごとの合計を
足しても全体の合計に戻らない。

この手の「そう決めた」だけの規則は、決めた場所にしか無いと誰にも伝わらない。
割り当てる欄・集計の表・使い方の3か所に同じことを書いてある。**片方だけ
直すと食い違う。**

## 手元から動かす道具は GAS の中に置く

**`kit/AGENTS.md` は zip の中で `CLAUDE.md` にもなる**（`scripts/build-kit.mjs`
の `FILES` が同じ元から2つ配る）。片方だけ直すことはできない造りにしてある。

初めて動くときの案内は `node agent.mjs setup` にある。**設定が読めない状態で
こそ要るものなので、`findConfig()` は投げずに `null` を返す。** `loadConfig()`
だけが投げる。手元から触れない場所（Drive / Apps Script）のパスは当てさせず、
取り方を伝える形にしてある。


`kit/` にある**本物のファイル**が中身の本体で、`scripts/build-kit.mjs` が
それを base64 にして `src/KitFiles.gs` に焼き直し、`AgentKit.gs` が zip にして
配る。**別のリポジトリに切り出さない。** 配る側が2つのものを version 合わせで
管理することになり、必ずずれる。

**中身をそのまま GAS の HTML ファイルとして置いてはいけない。** `<id>` や
`<mainFileId>` がタグと解釈され、`-->` がコメントの終わりと読まれて壊れる。
実際に `agent.mjs` と `AGENTS.md` が壊れて配られていた。base64 なら何が
書いてあっても解釈されようがない。

- 直すのは `kit/` のほう。`src/KitFiles.gs` は**手で直さない**
- 焼き直しは `npm run deploy` が自動で走らせる
- `test/agentkit.test.js` が、焼き直したものと `kit/` の中身が一致している
  ことを見ている。忘れるとテストで止まる
- 中身を変えたら `AGENT_KIT_VERSION()` を上げる。版が同じなら作り直さずに
  前の zip を渡すため、上げ忘れると古いものが配られ続ける

## 図はその場で描く

説明の図に Mermaid や draw.io を持ち込まない。読み込みが1つ増えるうえ、
この画面は外から何も取ってこない作りにしてある。地の色に合わせるのも、
その場で描いたほうが確実。

`makeDiagram(spec)` が、箱と矢印の座標を書いた spec から SVG を組み立てる。
矢印の先は図ごとに名前を分ける（同じ頁に2つ並ぶため）。`role="img"` と
`<title>` / `<desc>` を必ず入れる。

## 落とし穴

- **`commitHistory` は親チェーン順**。timestamp だけで並べると同一ミリ秒で
  順序が不定になる（実際に踏んだ）
- **新しい GAS サービスを使ったら `appsscript.json` の `oauthScopes` に足す**。
  `GmailApp` を使ったのに足し忘れ、`notify()` の try/catch が例外を握ったまま
  通知が一度も届いていなかった
- **UI は `textContent` のみで組み立てる。`innerHTML` は使わない**。他人が書いた
  文書・コメント・Issue 題名を表示するため
- **CSS は既存トークンのみ** (`--ink` / `--ink-2` / `--line` / `--bg` / `--bg-2` /
  `--accent`)。未定義変数 + フォールバックの形は使わない。
  `[hidden] { display: none !important; }` は定義済み（`display` を持つクラスに
  `hidden` を付けても隠れる）
- **サーバ側と UI 側の両方にある関数がある**。`google.script.run` の往復を
  減らすための意図的な重複。**片方だけ直すと表示と実体がずれる**:
  `fileUrlOf` / `diffPairs` / `ganttLayout` / `ganttDaysForEffort` /
  `mentionMatch` / `tagParse` / `issueWouldCycle` / `groupIssues` / `rollupEffort`
- **イテレータを回しながら Drive のファイルを移動しない**。先に対象を集める
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
- **使い方の図は全部の節に置く。** 図だけ見て帰れる状態にしてある。
  `figures` のキーは `GUIDE` の見出しと一字一句同じでなければ、その節だけ
  図が消える。図の座標は手で置いているため、`test/component.test.js` の
  「描いたものが枠から出ない」「箱どうしが重ならない」が枠外と重なりを見ている。
  狭い画面では縮めずに横へ流す（`min-width: 680px`）。縮めると字が潰れて
  読めない図になる
- **幅を掴んで変えるペインには `min-width: 0` を書く。** flex の既定
  (`min-width: auto`) は中身より小さくならず、「広げられるのに縮まない」になる
- **掴む操作は `pointerup` だけに頼らない。** 枠の外で離すと届かず、掴んだまま
  張り付く。`pointercancel` と `window` 側でも外す
- **一覧の器 (`.history-list`) は確認依頼と共用している。** あちらの 320px 固定を
  被ると、見出しだけが広がって列がずれる

## デプロイ

```bash
npm run deploy -- "何を変えたか"
```

これは `clasp push -f` してから、**`deployment.json` の ID に対して**差し替える。

**`clasp create-deployment` を直接叩かない。** `-i` を省くと新しいデプロイが
作られて URL が変わり、利用者のブックマークも配ったリンクも死ぬ。差し替える先は
`deployment.json` に入れてあり、手元の記憶に頼らない。

送る前に差し替えると、前の中身のまま版だけが上がる。順番は push → deploy。

## 使う人に GAS を触らせない

**ファイルの id を調べてスクリプトプロパティに書かせない。** この道具を使うのは
総務・人事であって、GAS を知っている人ではない。実際に「スクリプトプロパティに
ファイル ID を渡す、が分からない」という声が来た。

文書の登録は画面から行う (`apiFoundFiles` が入れ物を覗き、`apiRegisterFiles` が
まとめて登録する)。`debugRegisterFile()` は開発時の入口として残してあるだけ。

エディタで実行させてよいのは、**最初の一人が一度だけ実行するもの**に限る
(`setupRepo` / `setupCommandQueue`)。それ以外を手順に書いたら、その時点で
設計が間違っている。

## 実機検証の入口

すべて GAS エディタから引数なしで実行でき、後片付けまでする。

| 関数 | 内容 |
|---|---|
| `debugVerifyPhase2()` | コンフリクト → 解決 → マージ → 書き戻し → 楽観的並行制御 |
| `debugVerifyPhase3b()` | Issue → ブランチ → PR → マージとカンバンの自動移動 |
| `debugVerifyCommandQueue()` | コマンドキューの実行経路 |
| `debugMarkdownRoundTrip()` | 実文書で HTML → Markdown → HTML がバイト一致するか |
| `debugWriteRoundTrip()` | 実文書で書き戻しが情報を落としていないか |
| `debugCleanupLastVerify()` | 失敗して残った検証物の片付け |

検証ハーネスは `ALLOW_SELF_APPROVE` を自分で立てて元に戻すため、事前準備は要らない。

## 制約

- **GAS 標準サービスのみ。GCP プロジェクトは使えない**ため `clasp run` は使用不可。
  ローカルからの操作は `.git/queue/` のコマンドキュー経由（README 参照）
- 外部 API / 公開エンドポイントは使わない
- **拡張サービスは Google ToDo 連携 (`src/core/GoogleTasks.gs`) だけの例外。**
  エディタの「サービス +」から Tasks を足していない環境でも他が壊れないよう、
  `tasksAvailable()` が false のときは画面に入口すら出さない
- 色・フォント・サイズは版管理の対象外（意図的な割り切り）
- Slides はマージ非対応。PR 作成の時点で拒否する

## 作業の進め方

`docs/superpowers/plans/` の実装計画に沿って、`feat/<phase名>` ブランチで作業し、
テストが通ってから main にマージする。

**このリポジトリは複数のセッションが並行して触ることがある。** 作業前に
`git rev-parse --abbrev-ref HEAD` と `git status` を確認し、身に覚えのない
未コミット変更があれば `git add -A` で巻き込まず、ユーザーに確認すること。

**`git push origin <名前>` は、いま居るブランチではなく、その名前のブランチを
送る。** 居るのが main なのに `git push origin feat/…` と書くと、毎回成功して
何も送られない。実際に45コミットぶん、送ったつもりで送れていなかった。
**送ったあとは `git log --oneline -1 origin/<名前>` で着いたことを確かめる。**
