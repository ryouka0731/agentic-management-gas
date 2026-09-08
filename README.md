# Agentic Management (GAS)

Google Workspace 上の文書に Git の概念（コミット / ブランチ / PR / Issue / Projects）を
与えて管理するシステム。**GAS 標準サービスのみ**で構築され、外部 API を一切使用しない。

## 現在の状態: Phase 2 完了

Google Docs に対して commit / branch / Pull Request / 3-way merge が動作し、
マージ結果を元の Doc に書き戻せる (fileId は維持されるため共有リンクは壊れない)。

### Git 操作の対応状況

| 操作 | 状態 |
|---|---|
| コミット / 履歴 / 差分表示 | 動作 |
| `git status` 相当 (未コミット検出) | 動作 |
| ブランチ作成 (Doc の作業コピー) | 動作 |
| Pull Request / レビュー / 承認 | 動作 |
| 3-way merge | 動作 |
| コンフリクト解決 (ours / theirs / both) | 動作 |
| main への書き戻し | 動作 |
| 楽観的並行制御 (HEAD 検証) | 動作 |

### ローカルからの操作（コマンドキュー）

GCP プロジェクトが使えない環境では `clasp run`（Apps Script API）が使えない。
公開エンドポイントも作らない方針のため、**Drive 上のキューを介した非同期実行**で
ローカルから操作する。

```
.git/
├── queue/          未処理の命令と結果
│   ├── <id>.cmd.json
│   └── <id>.result.json
└── queue-done/     処理済みの命令
```

実機で検証済み（2026-09-08、`debugVerifyCommandQueue()` で6項目すべて PASS）。

セットアップは GAS エディタで **`setupCommandQueue()`** を1回実行するだけ
（1分間隔の時間主導トリガーを設置する。二度実行しても増えない）。

命令ファイル `<id>.cmd.json` を `queue/` に置くと、1分以内に実行されて
`<id>.result.json` が同じフォルダに出る。

```json
{ "op": "commit", "args": { "fileId": "1AbC...", "message": "第3条を改訂" } }
```

```json
{ "ok": true, "op": "commit", "result": { "sha": "9f8e..." }, "at": "2026-09-08T09:00:00.000Z" }
```

| op | args |
|---|---|
| `listFiles` | なし |
| `status` | `fileId` |
| `readMarkdown` / `writeMarkdown` | `fileId` / `fileId`, `markdown` |
| `commit` | `fileId`, `message`, `expectedHeadSha`(任意) |
| `stashMainDrift` | `fileId` |
| `branchCreate` | `name`, `fileId` |
| `issueCreate` / `issueCreateBranch` | `title`,`body`,`linkedFileIds` / `number`,`fileId` |
| `prCreate` / `prPreview` / `prMerge` | PR の作成・下見・マージ |

**ホワイトリストに無い op は実行しない。** キューは Drive の共有相手なら誰でも
書けるため、op を任意の関数名にすると事実上の RPC になる。

**`prReview` は含めない。** トリガーはオーナー権限で走るので、キュー経由の承認は
常に自己承認になる。承認は人が画面で行う操作として残している。

main の保護などの安全機構はキュー経由でも同じように効く。
遅延は最大1分（時間主導トリガーの最小間隔）。

### 社内展開

**リポジトリを配るのではなく、1つのインスタンスを共有して Web App の URL を配る。**
文書・履歴・メタDB はすべて Drive 側にあり、このリポジトリには入らない。
各自が `setupRepo()` を実行すると、それぞれの Drive に別々の空リポジトリができる。

共有するには `src/appsscript.json` の `webapp` を変える。

```json
"webapp": {
  "executeAs": "USER_ACCESSING",
  "access": "MYSELF"
}
```

| | `USER_ACCESSING` | `ME`（オーナー権限で実行） |
|---|---|---|
| 利用者に必要な Drive 権限 | メタDBと全文書への編集権限 | 不要（アプリ経由のみ） |
| main の直接編集 | Docs を開けばできてしまう | できない（権限が無い） |
| Drive のリビジョン履歴 | 実際の編集者が残る | 全部オーナー名になる |
| 実行クォータ | 各自 | オーナーに集中 |

`ME` を推奨する。アプリ側の main 保護は「アプリ経由の操作」しか止められないため、
`USER_ACCESSING` だと Docs を直接開く抜け道が残る。

**ただし切り替える前に、別アカウントでヘルプタブを開いて身元表示を確認すること。**
`executeAs: ME` では `Session.getActiveUser().getEmail()` が空文字を返す環境があり、
その場合はコミットの作者とレビュアーがすべて空になって自己承認の禁止が誤作動する。

### 対応するファイル種別

| 種別 | 閲覧・履歴・diff | ブランチ・PR | マージ書き戻し |
|---|---|---|---|
| Docs | 対応 | 対応 | 対応 |
| Sheets | 対応 | 対応 | 対応（`setValues`、数式は `data-formula` で保持） |
| Slides | 対応 | — | **非対応**（PR 作成の時点で拒否） |

Sheets は表示値を内容とし、数式を `data-formula` 属性に退避する。セルの改行は
正規化で潰す（1ブロック = 1行が壊れると行ベース diff が意味を失うため）。

### 画面

GitHub を使ったことがあれば説明なしで操作できることを目標にしている。

- 左ペインで**ブランチを切り替える**と、そのブランチのファイルだけがパスで
  階層化されて並ぶ。各行の `↗` から元ファイル (Docs / Sheets / Slides) を開ける
- 差分は**左右2列**。書き換わった行は左右に並ぶ
- PR は**会話 / コミット / 変更ファイル**の3タブ。会話にコメントを投稿できる。
  承認とマージのボタンはタブの外にあり、どのタブからでも操作できる
- タブ構成は 本文 / 編集 / 履歴 / ブランチ / プルリクエスト / Issue / ボード

### アプリ内での編集と main の保護

- ブランチ上の文書は**アプリ内で Markdown として編集**できる。保存しても
  コミットはされず、「未コミットの変更あり」になる (Docs で編集した場合と同じ)
- 対応する記法は正規化HTMLの語彙に閉じる。下線だけ Markdown に記法がないため
  `<u>` タグを許す
- **main は保護されている。** 編集も直接コミットもできず、変更は必ず PR 経由になる
  (GitHub の branch protection 相当)
- Docs 側で main を直接編集した場合だけは、`apiStashMainDrift` (画面では
  「直接編集を退避」) で専用のコミットとして記録できる。これが無いと、
  未コミットの main はマージも拒否されるため行き止まりになる

### Issue と Projects

- Issue は文書に紐づく。Wiki で文書を開くと、その文書の open Issue が本文の上に並ぶ
- Issue から 1 クリックでブランチを作れる (`issue-<番号>-<題名>` で自動命名)
- PR 本文に `closes #N` と書くと、マージ時に Issue が閉じて PR 番号が記録される
- カンバンは PR の状態変化で自動的に動く
  (Issue作成 → Backlog、ブランチ作成 → In Progress、PR作成 → In Review、マージ → Done)
- カードはドラッグ&ドロップでも動かせる
- 通知は `Notifier.gs` の `notify()` に隔離してある。`UrlFetchApp` が解禁されたら
  Google Chat Webhook に差し替えられる。通知の失敗は本処理を巻き戻さない

### Phase 2 で実機検証済みの項目

GAS エディタから `debugVerifyPhase2()` を実行して確認した (2026-09-04)。
使い捨ての Doc を1つ作り、通しで実行して**15項目すべて PASS**。

| 項目 | 結果 |
|---|---|
| コンフリクト検出 | 同一行の相反する変更を `clean=false conflicts=1` として検出 |
| コンフリクト解決とマージ | ブランチ側を採用してマージし、main に書き戻される |
| fileId の維持 | 書き戻し後も同じ fileId が更新される (共有リンクが壊れない) |
| 書き戻し拒否 | 実体を取得できない画像を含む書き戻しは実行前に拒否される |
| 楽観的並行制御 | 古い headSha でのコミットは拒否され、最新なら通る |

同じシナリオは `test/phase2-integration.test.js` (疑似GAS) にも落としてあり、
以後は `npm test` で回帰を検出できる。

### 書き戻しの安全機構

`body.clear()` は破壊的操作であり、失敗すると文書の内容が失われる。
そのため3段の防御を設けている。

1. **事前検証** — `htmlWriterValidate` で復元できない要素を検出し、
   `body.clear()` の前に中断する
2. **取得不能な画像を含むマージは拒否** — `sha='unavailable'` の画像は
   バイト列が存在せず、書き戻すと永久に失われるためマージ自体を止める
3. **main が未コミットのときはマージしない** — マージ結果はコミット済みの
   HEAD を ours として計算されるため、未コミットの編集はマージに参加できず、
   書き戻しで黙って上書きされてしまう。git が dirty な作業ツリーでの
   マージを拒むのと同じ理由で、先に main をコミットさせる。
   検査から書き戻しまでの間に編集が入った場合に備え、書き戻し直前にも
   う一度見て、変更があれば自動退避コミットを作る

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
npm test          # ユニットテスト + 疑似GASによる統合テスト (241件)
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
src/core/Markdown.js   ★ピュア  → ローカルテスト可 (Markdown変換)
src/core/FileUrl.js    ★ピュア  → ローカルテスト可 (元ファイルURL)
src/core/Db.gs         GAS依存  → 疑似GASで統合テスト可
src/core/Repo.gs       GAS依存  → 疑似GASで統合テスト可
src/core/Commit.gs     GAS依存  → 疑似GASで統合テスト可
src/core/Branch.gs     GAS依存  → 疑似GASで統合テスト可
src/core/PullRequest.gs GAS依存 → 疑似GASで統合テスト可
src/core/Issue.gs      GAS依存  → 疑似GASで統合テスト可
src/core/Project.gs    GAS依存  → 疑似GASで統合テスト可
src/core/Notifier.gs   GAS依存  → 疑似GASで統合テスト可
src/render/SheetRenderer.gs  GAS依存 → 疑似GASで統合テスト可
src/render/SheetWriter.gs    GAS依存 → 疑似GASで統合テスト可
src/render/SlidesRenderer.gs GAS依存 → 疑似GASで統合テスト可
src/render/DocRenderer.gs    GAS依存 → 実機で確認 (DocumentApp 依存)
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
- [Phase 3a 実装計画 (Sheets / Slides レンダラ)](docs/superpowers/plans/2026-09-04-gws-git-management-phase3a-sheets-slides.md)
- [Phase 3b 実装計画 (Issue / Projects)](docs/superpowers/plans/2026-09-04-gws-git-management-phase3b-issues-projects.md)
- [Phase 3a 実装計画 (Sheets / Slides レンダラ)](docs/superpowers/plans/2026-09-04-gws-git-management-phase3a-sheets-slides.md)
- [Phase 4 設計仕様](docs/superpowers/specs/2026-09-04-gws-git-management-phase4-design.md)
- [Phase 4b 実装計画 (Markdown編集 + main保護)](docs/superpowers/plans/2026-09-04-gws-git-management-phase4b-markdown-edit.md)
- [Phase 4c 実装計画 (GitHub ライクな UI)](docs/superpowers/plans/2026-09-04-gws-git-management-phase4c-github-ui.md)
- [Phase 4d 実装計画 (アプリ内ガイド)](docs/superpowers/plans/2026-09-04-gws-git-management-phase4d-guide.md)
- [Phase 4a 実装計画 (コマンドキュー)](docs/superpowers/plans/2026-09-08-gws-git-management-phase4a-command-queue.md)

## 制約

- GAS 標準サービスのみ（Advanced Google Services / 外部 API は使用不可）
- Drive のネイティブ版履歴は取得できないため、独自スナップショット方式を採る
- 色・フォント・サイズは版管理の対象外（意図的な割り切り）。
  全角スペースによる字下げも正規化で失われる
- Google Docs / Sheets に対応。Slides は閲覧・履歴・diff のみ（マージ非対応）
- Slides はマージ非対応（図形座標を HTML から復元できないため）。
  PR 作成の時点で拒否する。spec の「ブランチのコピーを採用する fast-forward」案は
  fileId が変わるため採らない

## ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 1 | 基盤 + Docs レンダラ + ライブ Wiki | 完了 |
| 2 | commit / branch / PR / merge / 書き戻し | 完了 |
| **3a** | Sheets / Slides レンダラ | 計画済み |
| **3a** | Sheets / Slides レンダラ | 実装完了・実機検証待ち |
| 3b | Issue / Projects | 実装完了・実機検証待ち |
| **4b** | Markdown編集 + main のブランチ保護 | 実装完了・実機検証待ち |
| **4c** | GitHub ライクな UI | 実装完了・実機検証待ち |
| **4a** | コマンドキュー (ローカル連携) | **完了（実機検証済み）** |
| **4d** | アプリ内ガイド | 実装完了・実機検証待ち |
