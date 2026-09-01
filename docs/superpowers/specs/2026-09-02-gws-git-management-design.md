# GWS Git-like 文書管理システム 設計仕様 (PoC)

- **日付**: 2026-09-02
- **ステータス**: 設計承認済み / 実装計画待ち
- **スコープ**: PoC (10ファイル / 3ユーザー)
- **関連文書**: [大規模版スケーリング設計構想](./2026-09-02-gws-git-management-scaling.md)

---

## 1. 背景と目的

Google Workspace 上の Google Docs / Sheets / Slides に対して、Git の概念
(コミット / ブランチ / Pull Request / Issue / Projects) を与えて管理する。

### 制約条件

| 項目 | 制約 |
|---|---|
| 外部API | **使用不可**。GitHub / 外部SaaS / 独自バックエンドは一切使わない |
| CI基盤 | **使用不可**。GitHub Actions 等は使えない |
| GAS Advanced Services | **使用不可**。Drive API v3 / Docs API / Sheets API の有効化は不可 |
| 使用可能なもの | GAS 標準サービスのみ (`DriveApp` / `DocumentApp` / `SpreadsheetApp` / `SlidesApp` / `GmailApp` / `HtmlService` / `CacheService` / `PropertiesService` / `LockService` / `ScriptApp` / `Utilities`) |
| デプロイ | `clasp` によるコマンドラインデプロイ |

### この制約から導かれる設計上の必然

1. **Drive のネイティブ版履歴は取得できない**
   `Drive API v3` の `revisions` が使えないため、版管理は**独自スナップショット方式**で行う。
2. **HTML エクスポート機能は使えない**
   `DriveApp.getFileById(id).getBlob()` は Google Docs 形式のファイルに対して PDF しか返さない。
   Drive の export URL を叩くには `UrlFetchApp` が必要で、これは「外部通信」に該当する。
   → **`DocumentApp` / `SpreadsheetApp` / `SlidesApp` で Body を走査し、自前で正規化 HTML を生成する。**

この 2 点目は制約であると同時に本システム最大の利点でもある。出力 HTML を自分で
完全に制御できるため、**差分ノイズがゼロの決定的な HTML** を生成できる。

---

## 2. 中核となる設計思想

### 2.1 「すべてを正規化 HTML に変換する」

Docs / Sheets / Slides という異種のファイル形式を、すべて**同一の正規化 HTML**
に変換する。この HTML が Git における blob に相当する。

```
Google Docs   ─┐
Google Sheets ─┼─→ 正規化HTML (1ブロック = 1行) ─→ 行ベース diff / 3-way merge
Google Slides ─┘
```

正規化のルール:

- **1 ブロック要素 = 1 行**で出力する
- 属性の出現順を固定する (`id` → `class` → `data-*` の辞書順)
- 空白・改行を正規化する (連続空白を 1 つに、行末空白を削除)
- 語彙を意図的に絞る (後述 §2.3)

この結果、**Git と同じ行ベースの diff / 3-way merge アルゴリズムがそのまま適用できる。**
これが本システムを成立させている中心的なアイデアである。

### 2.2 二層構造 — ライブ層とスナップショット層

Git のワーキングツリーとコミットの関係を、そのまま再現する。

| 層 | 実体 | 用途 | 生成タイミング |
|---|---|---|---|
| **ライブ層** | Drive 上の実ファイル | Wiki 閲覧。常に最新が見える | 描画リクエストのたびに変換 (キャッシュあり) |
| **スナップショット層** | `.git/objects/<sha>.html` | 履歴・diff・PR・マージ | コミット実行時に凍結 |

両者を比較することで「未コミットの変更あり」バッジ (= `git status`) が自然に得られる。

### 2.3 正規化 HTML の語彙

**マージ結果を Google Docs に書き戻す必要がある**ため、HTML → Docs の逆変換が
可能な語彙のみに限定する。これは本システム最大の技術的難所への対策である。

| 許可する要素 | Docs 側の対応 |
|---|---|
| `<h1>` 〜 `<h6>` | `ParagraphHeading.HEADING1` 〜 `HEADING6` |
| `<p>` | `ParagraphHeading.NORMAL` |
| `<ul>` / `<ol>` / `<li>` | `ListItem` + `GlyphType` + ネストレベル |
| `<table>` / `<tr>` / `<td>` | `Table` / `TableRow` / `TableCell` |
| `<strong>` / `<em>` / `<u>` / `<s>` | `setBold` / `setItalic` / `setUnderline` / `setStrikethrough` |
| `<a href>` | `setLinkUrl` |
| `<img data-blob-sha>` | `InlineImage` (Blob は `objects/` に SHA 参照で保存) |
| `<section data-slide>` | Slides のスライド境界 (read-only) |

**これ以外の要素・スタイルは正規化時に落とす。** 色・フォント・サイズ等の
装飾は版管理の対象外とする。これは意図的な割り切りであり、「文書の意味内容を
版管理する」というシステムの目的に沿う。

---

## 3. データモデル

### 3.1 Drive レイアウト

```
/agentic-management/              ← リポジトリのルートフォルダ
├── main/                         ← main ブランチの実ファイル
│   ├── 就業規則.gdoc             ← fileId は永続。共有リンクの正体
│   └── 予算計画.gsheet
├── branches/
│   └── feat-規則改訂/
│       └── 就業規則.gdoc         ← makeCopy したワーキングコピー
└── .git/
    ├── objects/                  ← スナップショット HTML (プレーンテキストファイル)
    │   └── <sha256>.html
    └── repo-db                   ← メタデータDB (スプレッドシート)
```

**重要な不変条件**: `main/` 配下のファイルの `fileId` は絶対に変えない。
マージ時にファイルを差し替えると共有リンク・権限設定・他文書からの埋め込みが
すべて壊れるため、**Body を書き戻す**方式を採る (§5.6)。

### 3.2 メタデータ DB (1 スプレッドシート = DB / 1 シート = 1 テーブル)

#### `files`

| カラム | 型 | 説明 |
|---|---|---|
| `fileId` | string | Drive fileId (main 上の実体) |
| `path` | string | リポジトリ内論理パス (例: `規定/就業規則`) |
| `type` | enum | `doc` / `sheet` / `slide` |
| `registeredAt` | datetime | 管理対象に登録した日時 |
| `registeredBy` | string | 登録者メールアドレス |

#### `commits`

| カラム | 型 | 説明 |
|---|---|---|
| `sha` | string | コミット SHA-256 (hex 64桁) |
| `parentSha` | string | 親コミット SHA。初回は空 |
| `branch` | string | ブランチ名 |
| `fileId` | string | 対象ファイル (main 上の fileId) |
| `blobSha` | string | 内容の SHA。`objects/<blobSha>.html` を指す |
| `author` | string | メールアドレス |
| `message` | string | コミットメッセージ |
| `timestamp` | datetime | コミット日時 |

**コンテンツアドレッシング**: `blobSha` は HTML 内容そのもののハッシュ。
同一内容なら blob を再利用するため、ブランチ間で内容が同じファイルは
ストレージを消費しない。

#### `branches`

| カラム | 型 | 説明 |
|---|---|---|
| `name` | string | ブランチ名 (主キー) |
| `headSha` | string | 最新コミット SHA |
| `baseSha` | string | 分岐時点の main HEAD SHA。**3-way merge の base** |
| `state` | enum | `open` / `merged` / `deleted` |
| `workingFolderId` | string | `branches/<name>/` の folderId |
| `createdBy` | string | 作成者 |
| `createdAt` | datetime | 作成日時 |

#### `pulls`

| カラム | 型 | 説明 |
|---|---|---|
| `number` | number | PR 番号 (連番) |
| `title` | string | タイトル |
| `body` | string | 本文。`closes #12` 記法で Issue と連動 |
| `sourceBranch` | string | マージ元 |
| `targetBranch` | string | マージ先 (PoC では常に `main`) |
| `state` | enum | `open` / `approved` / `merged` / `closed` |
| `author` | string | 作成者 |
| `createdAt` / `mergedAt` | datetime | |

#### `reviews`

| カラム | 型 | 説明 |
|---|---|---|
| `prNumber` | number | 対象 PR |
| `reviewer` | string | レビュアーのメールアドレス |
| `state` | enum | `approve` / `request_changes` / `comment` |
| `body` | string | レビューコメント |
| `at` | datetime | |

#### `issues`

| カラム | 型 | 説明 |
|---|---|---|
| `number` | number | Issue 番号 (連番) |
| `title` / `body` | string | |
| `state` | enum | `open` / `closed` |
| `assignee` | string | 担当者メールアドレス |
| `labels` | string | カンマ区切り |
| `linkedFileIds` | string | 紐づく文書の fileId (カンマ区切り) |
| `linkedPr` | number | 紐づく PR 番号 |
| `createdAt` / `closedAt` | datetime | |

#### `project_items`

| カラム | 型 | 説明 |
|---|---|---|
| `issueNumber` | number | カード = Issue |
| `column` | enum | `Backlog` / `In Progress` / `In Review` / `Done` |
| `order` | number | カラム内の並び順 |

### 3.3 SHA の生成

```javascript
// GAS 標準サービスのみで実装可能
function sha256Hex(content) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    content,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('');
}
```

---

## 4. レンダラとライブキャスト

### 4.1 3 つのレンダラ

| 対象 | 使用 API | HTML 出力 |
|---|---|---|
| Docs | `DocumentApp` で Body 走査 | 見出し → `<h1>`〜`<h6>`、リスト → `<ul>/<ol>`、表 → `<table>`、装飾 → `<strong>/<em>/<a>`、画像 → `<img data-blob-sha>` |
| Sheets | `getDisplayValues()` + `getFormulas()` | シートごとに `<table>`。数式は `data-formula` 属性に保持 |
| Slides | `SlidesApp` で Shape / Notes 抽出 | スライドごとに `<section data-slide="N">`。スピーカーノートも含む |

すべてのレンダラは共通インターフェースを実装する:

```javascript
/**
 * @param {string} fileId
 * @returns {string} 正規化HTML (1ブロック=1行、末尾改行あり)
 */
function render(fileId)
```

### 4.2 ライブキャスト (描画時変換)

```
Wiki 表示リクエスト
  │
  ├─ DriveApp.getFileById(id).getLastUpdated() を取得
  │
  ├─ CacheService: key = "live:" + fileId + ":" + lastUpdatedMs
  │     ├─ HIT  → 即座に返す (ミリ秒オーダー)
  │     └─ MISS → render(fileId) → キャッシュに保存 (TTL 6時間)
  │
  └─ HEAD コミットの blob HTML と比較
        ├─ 一致    → 「最新」バッジ
        └─ 不一致  → 「未コミットの変更あり」バッジ + その場で diff 表示
```

**キャッシュキーに `lastUpdatedMs` を含めることが設計の要点。**
誰かが Google Docs を編集した瞬間にキーが変わり、キャッシュが自然に無効化される。
ポーリングも同期ジョブもトリガーも不要で、「常に同期されている」状態が実現される。

#### キャッシュのサイズ制限への対応

`CacheService` は 1 キーあたり 100KB の上限がある。これを超える HTML は
チャンク分割して保存する:

```
live:<fileId>:<ts>:meta   → {"chunks": 3}
live:<fileId>:<ts>:0      → HTML の 0〜100KB
live:<fileId>:<ts>:1      → HTML の 100〜200KB
live:<fileId>:<ts>:2      → HTML の 200KB〜
```

`CacheService.getAll()` で一括取得すれば往復コストは 1 回で済む。

---

## 5. Git 操作のセマンティクス

### 5.1 commit

```
1. ライブ HTML をレンダリング
2. blobSha = sha256(html) を計算
3. 現在の HEAD コミットの blobSha と比較
      └─ 同一なら「変更がありません」で中断 (空コミットを作らない)
4. objects/<blobSha>.html を書き込み (既存なら書き込みをスキップ)
5. commits シートに1行追記
6. branches シートの headSha を更新
```

`LockService.getScriptLock()` で 5〜6 を排他する。

### 5.2 branch

```
1. branches シートに同名がないことを確認
2. branches/<name>/ フォルダを作成
3. main/ の対象ファイルを makeCopy でコピー
4. baseSha = 分岐時点の main HEAD コミット SHA を記録
5. branches シートに1行追記
```

ブランチ名の検証は**アンカー付き正規表現**で行う (glob は使わない):

```javascript
if (!/^[A-Za-z0-9ぁ-んァ-ヶ一-龠_\-\/]{1,80}$/.test(name)) throw new Error(...);
```

### 5.3 diff

正規化 HTML の**行ベース diff** (Myers アルゴリズム) を自前実装する。
外部ライブラリは不要。§2.1 の正規化により、1 行が 1 つの意味ブロックに
対応しているため、行 diff がそのまま意味のある diff になる。

出力形式:

```javascript
[
  { type: 'equal',  line: '<h1>就業規則</h1>' },
  { type: 'delete', line: '<p>在宅勤務は認めない。</p>' },
  { type: 'insert', line: '<p>在宅勤務は週3日まで認める。</p>' },
]
```

### 5.4 Pull Request

- source ブランチの HEAD と target ブランチの HEAD の diff を Web App に表示
- レビュアーが `approve` / `request_changes` / `comment` を `reviews` シートに記録
- PoC では**承認 1 件以上でマージ可能**とする (必須レビュアー数は設定値)

### 5.5 merge (3-way)

```
base   = branches[source].baseSha の blob HTML   (分岐点)
ours   = target ブランチ HEAD の blob HTML       (main の現在)
theirs = source ブランチ HEAD の blob HTML       (ブランチの現在)

3-way merge を行単位で実行:
  - base→ours のみ変更   → ours を採用
  - base→theirs のみ変更 → theirs を採用
  - 両方が同じ変更       → その変更を採用
  - 両方が異なる変更     → **コンフリクト**
```

コンフリクト時は PR 画面に衝突ブロックを提示し、人が `ours` / `theirs` /
手動編集 を選択して解決する。GitHub の conflict resolution UI と同じ体験。

### 5.6 main への反映 (書き戻し)

**本システム最大の技術的難所。**

```
1. マージ結果の正規化 HTML を得る
2. HtmlWriter が HTML をパースし、Docs の要素列に変換
3. main の Doc に対して:
      body.clear()
      → 要素を順に append (appendParagraph / appendListItem / appendTable / ...)
4. コミットを作成 (parentSha は ours と theirs の両方を記録 = マージコミット)
5. branches シートの state を 'merged' に更新
6. PR 本文の `closes #N` を解析し、対応する Issue を close
```

`fileId` は変わらないため、共有リンク・権限・埋め込みはすべて維持される。

§2.3 で語彙を絞ってあるため、HTML → Docs の逆変換は完全に実装可能な範囲に
収まる。

### 5.7 ファイル種別ごとのサポート範囲 (PoC)

| ファイル種別 | 閲覧・履歴・diff | ブランチ・PR | マージ書き戻し |
|---|---|---|---|
| **Docs** | ✅ | ✅ | ✅ |
| **Sheets** | ✅ | ✅ | ✅ (`setValues()` なので実装は容易) |
| **Slides** | ✅ | ✅ | ❌ **read-only** |

**Slides をマージ非対応とする理由**: Slides は図形の座標・サイズ・
アニメーション・レイアウトマスタを持ち、テキスト中心の正規化 HTML からの
完全復元が原理的に不可能である。PoC では「履歴と diff は見えるが、
マージはブランチのコピーを直接採用する fast-forward 置き換えのみ」とする。

---

## 6. Issue と Projects

### 6.1 Issue — 文書に紐づく作業管理

```
Issue #12  「就業規則の在宅勤務規定を改訂」
├─ state:        open
├─ assignee:     someone@example.com
├─ labels:       規定改訂, 要法務確認, P1
├─ linkedFiles:  [就業規則.gdoc]        ← 「文書に紐づく」核心
└─ linkedPr:     PR #5                  ← PR マージ時に自動 close
```

- **Issue → ブランチ作成が 1 クリック**。ブランチ名は `issue-12-在宅勤務規定` が自動命名される
- PR 本文に `closes #12` と書いてマージすると Issue が自動 close される
- **Wiki 上で文書を開くと、その文書に紐づく open Issue が横に並ぶ**。
  これが「文書中心の作業管理」の実感を生む

### 6.2 Projects (カンバン)

```
[ Backlog ]  [ In Progress ]  [ In Review ]  [ Done ]
```

- カード = Issue。ドラッグ&ドロップで `column` と `order` を更新
- **PR の状態変化が自動でカードを動かす**:
  - PR 作成 → `In Review`
  - PR マージ → `Done`

人が動かさなくても文書の状態変化がボードに反映される。これが
「エージェンティック経営」の実体となる部分である。

### 6.3 通知

`GmailApp` で PR 作成時・レビュー依頼時・マージ時にメール通知を送る。
GAS 標準サービスのみで完結する。

将来 `UrlFetchApp` が解禁された場合に Google Chat Webhook へ差し替えられるよう、
`Notifier` を単一のアダプタに隔離する。

---

## 7. Web App UI

`HtmlService` による単一の Web App。GitHub の画面構成を素直に写す。

| ルート | 画面 | 内容 |
|---|---|---|
| `?p=wiki` | **Wiki (トップ)** | ファイルツリー + HTML 本文をライブレンダリング表示。「未コミットの変更あり」バッジ、Docs を開くボタン |
| `?p=history&f=<id>` | **履歴** | コミット一覧、任意の 2 点間の diff |
| `?p=branches` | **ブランチ** | 一覧・作成・削除・ahead/behind 表示 |
| `?p=pulls` | **PR** | 一覧 / 詳細。diff、レビュー、承認、コンフリクト解決、マージ実行 |
| `?p=issues` | **Issue** | 一覧 / 詳細。作成、ラベル、担当、文書リンク |
| `?p=board` | **Projects** | カンバンボード |

### 実装上の要点

- 通信は `google.script.run` のみ。外部通信は一切行わない
- diff は**サイド・バイ・サイド表示** (GitHub の split view 相当)。
  追加 = 緑 / 削除 = 赤 / コンフリクト = 黄
- **文書 HTML は `<iframe sandbox>` 内にレンダリングする。**
  他人が編集した文書の内容を表示するため、XSS 遮断は必須要件である
- CSS 変数によるデザイントークンを `app.css.html` に定義し、
  未定義変数 + フォールバックの形は使わない

---

## 8. プロジェクト構成とテスト戦略

### 8.1 ディレクトリ構成

```
agentic-management-gas/
├── .clasp.json / .claspignore
├── appsscript.json            ← webapp設定、タイムゾーン、V8ランタイム
├── package.json               ← vitest のみ (デプロイには不要)
├── docs/superpowers/specs/    ← 本設計書
├── src/
│   ├── Main.gs                ← doGet / ルーティング / google.script.run API
│   ├── core/
│   │   ├── Repo.gs            ← Drive レイアウト初期化
│   │   ├── Db.gs              ← スプレッドシートDB アクセス層
│   │   ├── ObjectStore.gs     ← blob 保存 / 取得
│   │   ├── Commit.gs
│   │   ├── Branch.gs
│   │   ├── PullRequest.gs
│   │   ├── Hash.js            ★ ピュア
│   │   ├── Diff.js            ★ ピュア (Myers 差分)
│   │   └── Merge.js           ★ ピュア (3-way merge)
│   ├── render/
│   │   ├── DocRenderer.gs
│   │   ├── SheetRenderer.gs
│   │   ├── SlidesRenderer.gs
│   │   ├── HtmlWriter.gs      ← HTML → Docs 逆変換
│   │   ├── Normalize.js       ★ ピュア (HTML 正規化・シリアライズ)
│   │   └── LiveCache.gs
│   ├── work/
│   │   ├── Issue.gs
│   │   ├── Project.gs
│   │   └── Notifier.gs
│   └── ui/
│       ├── wiki.html / pulls.html / board.html / diff.html
│       └── app.css.html / app.js.html
└── test/                      ← ★印のピュアロジックの vitest テスト
```

### 8.2 テスト戦略

**★印のファイルは GAS のグローバル API を一切参照しない。**

diff / 3-way merge / HTML 正規化という、最もバグが出やすく、かつシステムの
正しさを決定づけるロジックを、**ローカル Node 上で高速に TDD できる構造**にする。
GAS API 依存部分は薄いアダプタに隔離し、Web App 上での手動確認に回す。

```bash
npm test          # ピュアロジックのユニットテスト (ローカル、1秒)
clasp push        # GAS へ反映
clasp deploy      # Web App としてデプロイ
```

`.claspignore` で `test/`, `node_modules/`, `package.json`, `docs/` を除外し、
GAS 側にはランタイムに必要なファイルのみを送る。

### 8.3 テスト対象の具体例

| 対象 | テストする性質 |
|---|---|
| `Normalize.js` | 同じ内容の文書からは常に同一の HTML が出る (決定性) |
| `Normalize.js` | 装飾のみの変更では HTML が変わらない (ノイズ耐性) |
| `Diff.js` | 挿入・削除・移動が正しく検出される |
| `Merge.js` | 非衝突の並行変更が両方とも保持される |
| `Merge.js` | 同一行への異なる変更がコンフリクトとして検出される |
| `Merge.js` | base = ours の場合は fast-forward になる |
| `Hash.js` | 同一入力から同一 SHA が出る |

---

## 9. 実装順序

1. **Repo 初期化 + Db 層 + ObjectStore** — 土台
2. **Normalize / Diff / Merge を TDD で実装** — 心臓部。ローカルテストのみで完結
3. **DocRenderer + LiveCache + Wiki 画面** — ここで初めて「動くもの」が見せられる
4. **Commit + 履歴画面**
5. **Branch + PR + Merge + 書き戻し**
6. **Sheets / Slides レンダラ**
7. **Issue + Projects**

**ステップ 3 の時点で一度デモが可能**な構成にしてある。

---

## 10. 既知の制約と割り切り

| 制約 | 内容 | 判断 |
|---|---|---|
| Slides のマージ | 図形座標・アニメーションを HTML から復元できない | PoC では read-only |
| 書式の版管理 | 色・フォント・サイズは正規化時に落とす | 「意味内容を版管理する」目的に沿う意図的な割り切り |
| 画像 | Blob を `objects/` に SHA 保存するが、差分は「変わった / 変わらない」のみ | 画像内容の diff は対象外 |
| Docs のコメント | `DocumentApp` からコメントを取得できない | 版管理の対象外。Google のコメント機能をそのまま使う |
| 同時編集の競合 | 同一ブランチを 2 人が同時にコミットした場合 | `LockService` で直列化。後発は「HEAD が進んでいます」エラー |
| GAS 6 分制限 | PoC 規模 (10ファイル) では 1 ファイル数秒のため問題にならない | 大規模化時に継続トリガーで分割 (別文書参照) |

---

## 11. セキュリティ上の考慮

| 項目 | 対策 |
|---|---|
| XSS | 文書 HTML は `<iframe sandbox>` 内でレンダリング。`srcdoc` に流し込み、`allow-scripts` は付与しない |
| 入力検証 | ブランチ名・ファイルパスは**アンカー付き正規表現**で検証する。glob によるホワイトリストは使わない |
| 権限 | PoC では Web App を「アクセスしているユーザーとして実行」で公開し、Drive の権限をそのまま活かす |
| 監査 | すべての破壊的操作 (merge / branch 削除) は `commits` / `branches` シートに実行者と日時を残す |

なお PoC で採用する「アクセスユーザーとして実行」は、メタ DB スプレッドシートへの
書き込み権限を全ユーザーに与える必要がある。これは PoC 規模では許容するが、
大規模展開時には根本的な見直しが必要になる (別文書 §4 参照)。
