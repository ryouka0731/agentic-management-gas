# Agentic Management (GAS)

Google Workspace 上の文書に Git の概念（コミット / ブランチ / PR / Issue / Projects）を
与えて管理するシステム。**GAS 標準サービスのみ**で構築され、外部 API を一切使用しない。

## 現在の状態: Phase 1（実装完了・動作確認待ち）

Google Docs を正規化 HTML に変換し、ブラウザ上でライブ表示する Wiki。

## 設計の中核

### すべてを正規化 HTML に変換する

Docs / Sheets / Slides という異種のファイルを、すべて**同一の正規化 HTML**に変換する。
この HTML が Git における blob に相当する。

```
Google Docs   ─┐
Google Sheets ─┼─→ 正規化HTML (1ブロック = 1行) ─→ 行ベース diff / 3-way merge
Google Slides ─┘
```

1 ブロック = 1 行、属性順と空白を固定、装飾のネスト順を固定することで、
**同じ内容からは常にバイト単位で同一の HTML** が出る。差分ノイズがゼロになるため、
Git と同じ行ベースのアルゴリズムがそのまま適用できる。

### 二層構造（ライブ層とスナップショット層）

| 層 | 実体 | 用途 |
|---|---|---|
| ライブ層 | Drive 上の実ファイル | Wiki 閲覧。常に最新が見える |
| スナップショット層 | `.git/objects/<sha>.html` | 履歴・diff・PR・マージ |

ライブ層のキャッシュキーにファイルの `lastUpdated` を含めるため、
**編集された瞬間にキャッシュが無効化される**。同期ジョブもトリガーも不要。

## セットアップ

### 1. 依存のインストール

```bash
npm install
```

### 2. GAS プロジェクトへの接続

```bash
clasp login
clasp create-script --type standalone --title "Agentic Management" --rootDir src
clasp push --force
```

> **clasp 3.x の注意点**
> - `--type webapp` は `Invalid container file type` で失敗する。`standalone` で作成し、
>   Web App 化は `appsscript.json` の `webapp` 設定とデプロイで行う
> - `clasp create-script` は `src/appsscript.json` を上書きするため、作成後に書き戻すこと
> - `.claspignore` のパターンは `rootDir`（= `src`）相対で評価される。
>   `!src/**` のような書き方は機能しない
> - マニフェスト変更を含む push には `--force` が必要（非対話では確認プロンプトが
>   否定され `Skipping push.` になる）

### 3. リポジトリの初期化

GAS エディタ（`clasp open-script`）で **`setupRepo()`** を 1 回だけ実行する。
Drive に `agentic-management/` フォルダとメタ DB スプレッドシートが作られる。

### 4. デプロイ

```bash
clasp create-deployment --description "Phase 1"
clasp open-web-app
```

### 5. 文書の登録

対象の Google Doc を `agentic-management/main/` に置き、GAS エディタの
**プロジェクトの設定 → スクリプト プロパティ**で `DEBUG_FILE_ID` にその fileId を
設定してから、**`debugRegisterFile()`** を実行する。

## 開発

```bash
npm test          # ピュアロジックのユニットテスト
npm run test:watch
clasp push --force
```

### テストの仕組み

ランタイムコードには `import` / `export` / `require` を**書かない**
（GAS で動かなくなるため）。テストは `test/harness.js` が `node:vm` で
ソースを評価し、定義された関数を取り出す方式を採る。

これにより、diff / 3-way merge / HTML 正規化という最も重要なロジックを、
**GAS に一切依存せずローカルで TDD** できる。

```
src/core/Hash.js       ★ピュア  → ローカルテスト可
src/core/Normalize.js  ★ピュア  → ローカルテスト可
src/core/Db.gs         GAS依存  → Web App 上で確認
src/render/*.gs        GAS依存  → Web App 上で確認
```

### 実際のDocでラウンドトリップを検証する

```bash
node test/roundtrip-check.js <レンダリング結果を保存したhtmlファイル>
```

`parse(serialize(x)) === x` が成立することは、Phase 2 のマージ書き戻し
（HTML → Google Docs）が実装可能であることの証明になる。

## ドキュメント

- [設計仕様](docs/superpowers/specs/2026-09-02-gws-git-management-design.md)
- [大規模版スケーリング構想](docs/superpowers/specs/2026-09-02-gws-git-management-scaling.md)
- [Phase 1 実装計画](docs/superpowers/plans/2026-09-02-gws-git-management-phase1.md)

## 制約

- GAS 標準サービスのみ（Advanced Google Services / 外部 API は使用不可）
- Drive のネイティブ版履歴は取得できないため、独自スナップショット方式を採る
- 色・フォント・サイズは版管理の対象外（意図的な割り切り）。
  全角スペースによる字下げも正規化で失われる
- Phase 1 では Google Docs のみ対応（Sheets / Slides は Phase 3）
- Slides はマージ非対応（図形座標を HTML から復元できないため）

## ロードマップ

| Phase | 内容 |
|---|---|
| **1** | 基盤 + Docs レンダラ + ライブ Wiki |
| 2 | commit / branch / PR / merge / 書き戻し |
| 3 | Sheets / Slides レンダラ + Issue / Projects |
