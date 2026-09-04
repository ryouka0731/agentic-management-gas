# Agentic Management (GAS)

Google Workspace 上の文書に Git の概念（コミット / ブランチ / PR / Issue / Projects）を
与えて管理するシステム。**GAS 標準サービスのみ**で構築され、外部 API を一切使用しない。

## 現在の状態: Phase 2 実装完了 (実機検証待ち)

Google Docs に対して commit / branch / Pull Request / 3-way merge が動作し、
マージ結果を元の Doc に書き戻せる (fileId は維持されるため共有リンクは壊れない)。

### Git 操作の対応状況

| 操作 | 状態 |
|---|---|
| コミット / 履歴 / 差分表示 | 実装済み |
| `git status` 相当 (未コミット検出) | 実装済み |
| ブランチ作成 (Doc の作業コピー) | 実装済み |
| Pull Request / レビュー / 承認 | 実装済み |
| 3-way merge | 実装済み |
| コンフリクト解決 (ours / theirs / both) | 実装済み |
| main への書き戻し | 実装済み |
| 楽観的並行制御 (HEAD 検証) | 実装済み |

### 書き戻しの安全機構

`body.clear()` は破壊的操作であり、失敗すると文書の内容が失われる。
そのため3段の防御を設けている。

1. **事前検証** — `htmlWriterValidate` で復元できない要素を検出し、
   `body.clear()` の前に中断する
2. **取得不能な画像を含むマージは拒否** — `sha='unavailable'` の画像は
   バイト列が存在せず、書き戻すと永久に失われるためマージ自体を止める
3. **マージ前の自動退避コミット** — main の現在の内容を必ずコミットしてから
   書き換える。ただし退避した下書きは 3-way merge には参加しない
   (プレビューはコミット済みの HEAD を ours として先に計算されるため)。
   マージ結果には残らないが、退避コミットから復元できる

なお、ブランチを削除しても `files` 行は残す。行を消すと作業コピーを解決できなくなり、
そのブランチから作られた**マージ済み PR を二度と開けなくなる**ため。
Wiki の一覧からは `filesVisibleInWiki()` で隠す。

加えて、マージには1件以上の承認が必要で、PR作成者は自分のPRを承認できない。
ただし1人で検証する場合は承認者を確保できずマージまで到達できないため、
スクリプトプロパティ `ALLOW_SELF_APPROVE=true`（`debugEnableSelfApprove()` で設定）
のときだけ自己承認を許可する。許可時は警告ログが残る。本番運用では
`debugDisableSelfApprove()` で必ず禁止に戻すこと。

### Phase 1 で実機検証済みの項目

| 項目 | 結果 |
|---|---|
| レンダリングの決定性 | 同一 Doc から常にバイト単位で同一の HTML |
| ラウンドトリップ | 実際の Doc 出力で `parse(serialize(x)) === x` が成立 |
| ライブ同期 | Docs 編集が次回閲覧時に自動反映 (同期ジョブなし) |
| キャッシュ効果 | 4,048ms → 294ms (13.8倍) |
| 壊れた画像への耐性 | 実体を取得できない画像があっても本文は正常にレンダリング |
| XSS 防御 | エスケープ + iframe sandbox の二重防御 |

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
npm test          # ユニットテスト + 疑似GASによる統合テスト (121件)
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
src/core/Diff.js       ★ピュア  → ローカルテスト可 (Myers 行diff)
src/core/Merge.js      ★ピュア  → ローカルテスト可 (3-way merge)
src/core/Db.gs         GAS依存  → 疑似GASで統合テスト可
src/core/Repo.gs       GAS依存  → 疑似GASで統合テスト可
src/core/Commit.gs     GAS依存  → 疑似GASで統合テスト可
src/core/Branch.gs     GAS依存  → 疑似GASで統合テスト可
src/core/PullRequest.gs GAS依存 → 疑似GASで統合テスト可
src/render/*.gs        GAS依存  → 実機で確認 (DocumentApp 依存)
```

diff / 3-way merge / HTML 正規化という、最もバグが出やすく、かつ
システムの正しさを決定づけるロジックがすべてピュア側にある。

### 疑似GASによる統合テスト

`test/fakegas.js` が DriveApp / SpreadsheetApp / PropertiesService /
Session / LockService / Utilities を最小限だけ再現する。これにより
commit → branch → PR → 3-way merge → 書き戻しという**組み立ての層を
ローカルで通しで実行**できる (`test/phase2-integration.test.js`)。

Docs の描画と書き戻しだけは `fileId → 正規化HTML` の写像に差し替える。
描画の忠実さは Phase 1 で実機検証済みで、ここで確かめたいのは
「どの順序で、どの条件を満たしたときに書き戻すか」だから。

このため**書き戻しのラウンドトリップ欠落だけはローカルでは検出できない**。
そこは実機の `debugWriteRoundTrip()` と `test/roundtrip-check.js` が担う。

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
- [Phase 2 実装計画](docs/superpowers/plans/2026-09-02-gws-git-management-phase2.md)

## 制約

- GAS 標準サービスのみ（Advanced Google Services / 外部 API は使用不可）
- Drive のネイティブ版履歴は取得できないため、独自スナップショット方式を採る
- 色・フォント・サイズは版管理の対象外（意図的な割り切り）。
  全角スペースによる字下げも正規化で失われる
- Phase 1 では Google Docs のみ対応（Sheets / Slides は Phase 3）
- Slides はマージ非対応（図形座標を HTML から復元できないため）

## ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | 基盤 + Docs レンダラ + ライブ Wiki | 完了 |
| **2** | commit / branch / PR / merge / 書き戻し | 実装完了・実機検証待ち |
| 3 | Sheets / Slides レンダラ + Issue / Projects | 未着手 |
