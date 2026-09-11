# agentic-management-gas

Google Workspace の文書（Docs / Sheets / Slides）に Git 相当の版管理を与える
Google Apps Script プロジェクト。設計は `docs/superpowers/specs/` を参照。

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
`npm ci` はロックから入れるので問題ない。どうしても作り直すときは
`npm install --legacy-peer-deps` で入れて、ロックを commit すること。

`node:vm` で評価するため、`test/harness.js` は **filename に絶対パスを渡す**。
相対パスだと実行された行が元ファイルに結び付かず、カバレッジが 0% と出る。

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

- 日時は `toISOString()` で文字列にしてから返す
- `test/phase4-edit.test.js` の「画面に渡せる形か」が全 API を走査している。
  **API を足したらそこに足す**
- 画面側の成功ハンドラは `list || []` で受ける

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

`src/kit/*.html` が中身の本体で、`AgentKit.gs` がそれを zip にして配る。
**別のリポジトリに切り出さない。** 配る側が2つのものを version 合わせで
管理することになり、必ずずれる。

中身を変えたら `AGENT_KIT_VERSION()` を上げる。版が同じなら作り直さずに
前の zip を渡すため、上げ忘れると古いものが配られ続ける。

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
