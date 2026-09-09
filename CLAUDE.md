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
- **`fileUrlOf` と `diffPairs` はサーバ側と UI 側の両方にある**。`google.script.run`
  の往復を減らすための意図的な重複。**片方だけ直すと表示と実体がずれる**
- **イテレータを回しながら Drive のファイルを移動しない**。先に対象を集める

## デプロイ

```bash
npx clasp push -f     # マニフェスト変更を含む push には -f が要る
npx clasp create-deployment -i <デプロイID> -d "説明"
```

**`-i` を省くと新しいデプロイが作られ URL が変わる。** デプロイIDはリポジトリに
入っていないので、`npx clasp list-deployments` で調べる。

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
- Advanced Google Services / 外部 API / 公開エンドポイントは使わない
- 色・フォント・サイズは版管理の対象外（意図的な割り切り）
- Slides はマージ非対応。PR 作成の時点で拒否する

## 作業の進め方

`docs/superpowers/plans/` の実装計画に沿って、`feat/<phase名>` ブランチで作業し、
テストが通ってから main にマージする。

**このリポジトリは複数のセッションが並行して触ることがある。** 作業前に
`git rev-parse --abbrev-ref HEAD` と `git status` を確認し、身に覚えのない
未コミット変更があれば `git add -A` で巻き込まず、ユーザーに確認すること。
