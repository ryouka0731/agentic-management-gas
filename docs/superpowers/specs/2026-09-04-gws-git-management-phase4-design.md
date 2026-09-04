# GWS Git-like 文書管理システム Phase 4 設計仕様

**日付:** 2026-09-04
**前提:** Phase 1-3b 完了 (Docs のレンダリング / commit / branch / PR / 3-way merge /
書き戻し / Issue / Projects)

## 1. 背景と目的

Phase 3b までで Git 相当の操作は一通り動くようになった。しかし**日常的に使うには
まだ3つの障害**がある。

1. **文書の編集は Google Docs を開いてやるしかない。** アプリは閲覧専用であり、
   「Wiki で見る → Docs を開く → 編集する → Wiki に戻る」という往復が要る
2. **main を人間が直接編集できてしまう。** PR を通さない変更が入り、履歴に
   現れない差分が溜まる
3. **UI が GitHub と違いすぎる。** タブ構成は近いが、差分が1列で、PR に会話が無く、
   ファイル一覧が平坦で、ブランチの切り替えという概念が UI に無い

加えて、ローカルの Claude から文書を操作したいという要求がある。

Phase 4 はこの4点を解消する。

## 2. 制約条件

Phase 1-3 の制約に加えて、**新たに次の制約が判明した**。

| 制約 | 内容 |
|---|---|
| **GCP プロジェクトが使えない** | Apps Script を標準 GCP プロジェクトに紐付けられない。したがって `clasp run` (Apps Script API の `scripts.run`) は使用不可 |
| 公開エンドポイントを作らない | `doPost` を匿名アクセスで公開すると、文書を書き換えられる口をインターネットに晒すことになる。組織のポリシー上も避ける |

この2つから、ローカル連携は**Drive 上のファイルを介した非同期のコマンドキュー**に
なることが必然的に導かれる。

## 3. サブプロジェクトの分解

| | 内容 | 依存 |
|---|---|---|
| 4a | コマンドキュー (ローカル連携) | なし |
| 4b | Markdown 編集 + main のブランチ保護 | なし |
| 4c | GitHub ライクな UI | 4b (編集導線を UI に載せるため) |
| 4d | アプリ内ガイド | 4b / 4c (完成した UI を説明するため) |

実装順は 4b → 4c → 4a → 4d を推奨する。4a を後ろに置くのは、キューが呼ぶ操作
(編集・保護) が 4b で確定してからのほうが op の設計が安定するため。

---

## 4. サブプロジェクト 4a: コマンドキュー

### 4a.1 仕組み

```
ローカルの Claude                    Drive                      GAS
      │                                │                          │
      │ 命令JSONを作成                  │                          │
      ├───────────────────────────────>│ .git/queue/<id>.cmd.json │
      │                                │                          │
      │                                │<─────────────────────────┤ 1分ごとの
      │                                │   拾って実行              │ 時間主導トリガー
      │                                │                          │
      │                                │ .git/queue/<id>.result.json
      │ 結果を読む                      │<─────────────────────────┤
      │<───────────────────────────────┤                          │
```

インターネットに何も公開せず、GCP も要らない。Drive の共有権限を持つ者だけが
キューに書ける。

### 4a.2 Drive レイアウト

```
.git/
├── objects/
├── queue/              ← 未処理の命令と結果
│   ├── <id>.cmd.json
│   └── <id>.result.json
└── queue-done/         ← 処理済みの命令 (再実行を防ぐ)
    └── <id>.cmd.json
```

`repoConfig()` に `queueId` / `queueDoneId` を足す。既存リポジトリには無いため、
**参照時に無ければ作って設定に書き戻す**遅延初期化とする。移行関数を人に実行させない。

### 4a.3 命令と結果の形式

命令 `<id>.cmd.json`:

```json
{ "op": "commit", "args": { "fileId": "1AbC...", "message": "第3条を改訂" } }
```

結果 `<id>.result.json`:

```json
{ "ok": true, "op": "commit", "result": { "sha": "9f8e..." }, "at": "2026-09-04T10:00:00.000Z" }
```

失敗時:

```json
{ "ok": false, "op": "commit", "error": "変更がありません", "at": "..." }
```

`id` はローカル側が決める。衝突を避けるため `<ISO8601>-<英数8文字>` とする。

### 4a.4 許可する op

**ホワイトリストに無い op は実行しない。** キューは Drive 共有相手なら誰でも書けるため、
op を任意の関数名にすると事実上の RPC になってしまう。

| op | args | 対応する既存関数 |
|---|---|---|
| `listFiles` | なし | `apiListFiles()` |
| `status` | `fileId` | `apiFileStatus()` |
| `readMarkdown` | `fileId` | `apiGetMarkdown()` (4b) |
| `writeMarkdown` | `fileId`, `markdown` | `apiSaveMarkdown()` (4b) |
| `commit` | `fileId`, `message` | `apiCommit()` |
| `stashMainDrift` | `fileId` | `apiStashMainDrift()` (4b) |
| `branchCreate` | `name`, `fileId` | `apiBranchCreate()` |
| `issueCreate` | `title`, `body`, `linkedFileIds` | `apiIssueCreate()` |
| `issueCreateBranch` | `number`, `fileId` | `apiIssueCreateBranch()` |
| `prCreate` | `title`, `body`, `sourceBranch`, `mainFileId` | `apiPrCreate()` |
| `prPreview` | `number` | `apiPrPreview()` |
| `prMerge` | `number`, `choices` | `apiPrMerge()` |

**`prReview` は含めない。** トリガーはオーナー権限で走るため、キュー経由の承認は
常に自己承認になる。承認は人が UI で行う操作として残す。

### 4a.5 実行の性質

- **トリガー**: `setupCommandQueue()` を1回実行すると、`processCommandQueue` の
  1分間隔トリガーを作る。既存の同名トリガーは先に削除して二重登録を防ぐ
- **排他**: `LockService.getScriptLock()` で囲む。前回の実行が長引いた場合に
  同じ命令を二重に処理しない
- **冪等性**: 実行が終わった命令は `queue-done/` に移す。結果ファイルは `queue/` に残す
- **上限**: 1回の起動で処理するのは最大10件。GAS の実行時間上限 (6分) に当てない
- **失敗の扱い**: 例外は握って `ok:false` の結果ファイルにする。1件の失敗で
  キュー全体を止めない

### 4a.6 セキュリティ上の考慮

- 命令ファイルの内容は**信頼しない**。op はホワイトリスト照合、args は各 API の
  既存バリデーションを通す
- `queue/` に置かれた JSON が壊れていても例外を握って `ok:false` にする
- 破壊的操作 (`prMerge`) はキューから呼べるが、承認が1件以上ないと既存の
  `prMerge` が拒否する。安全機構はそのまま効く

---

## 5. サブプロジェクト 4b: Markdown 編集と main のブランチ保護

### 5.1 Markdown ⇄ 正規化HTML

新しいピュアモジュール `src/core/Markdown.js` が2つの関数だけを公開する。

```javascript
function mdToBlocks(markdown)  // -> Block[]
function blocksToMd(blocks)    // -> string
```

**既存の Block 型を挟むため、Diff / Merge / 書き戻しは一切変更しない。**
編集は「Markdown → Block[] → 正規化HTML → Docs」と流れ、表示は逆をたどる。

### 5.2 記法の対応

正規化HTMLの語彙と1対1で対応させる。**対応の無い記法は受け付けない。**

| Markdown | Block | 備考 |
|---|---|---|
| `# ` 〜 `###### ` | `heading` (level 1-6) | |
| 空行区切りの行 | `paragraph` | |
| `- ` / `1. ` | `listItem` | ネストは半角2スペース = depth 1 |
| GFM テーブル | `table` | 区切り行 (`---`) は読み飛ばす |
| `**強調**` | run.bold | |
| `*斜体*` | run.italic | |
| `~~打消し~~` | run.strike | |
| `<u>下線</u>` | run.underline | **Markdown に記法が無いため HTML タグを許す** |
| `[文字](URL)` | run.link | |
| `![alt](sha:<sha>)` | `image` | `data-sha` を保持する独自形式 |

### 5.3 画像の扱い

編集画面から**新しい画像は追加できない**。`objects/` に実体が無い SHA を書かれても
書き戻しで拒否されるだけだからである。既存の画像を保持したまま前後の文章を編集する
用途に限る。画像の追加は Docs 側で行う。

### 5.4 編集の流れ

```
apiGetMarkdown(fileId)
  → liveHtml(fileId) → parseBlocks() → blocksToMd() → Markdown

apiSaveMarkdown(fileId, markdown)
  → mdToBlocks() → htmlWriterValidate() → 問題があれば中断
  → serializeBlocks() → writeHtmlToDoc() → liveCacheInvalidate()
```

**保存はコミットしない。** 保存後は「未コミットの変更あり」の状態になり、
コミットは従来どおり明示的な操作とする。Docs で編集した場合と挙動を揃える。

### 5.5 main のブランチ保護

**API 層で拒否する。** `commitFile` そのものは変えない。

| 関数 | 追加する挙動 |
|---|---|
| `apiCommit(fileId, ...)` | 対象が main のファイルなら拒否 |
| `apiSaveMarkdown(fileId, ...)` | 同上 |

マージ時の書き戻しは `prMerge` が `commitFile` / `writeHtmlToDoc` を直接呼ぶため
影響を受けない。**人間の操作だけが止まり、PR 経由の変更は通る。** GitHub の
branch protection と同じ形である。

拒否のメッセージは次のとおりとする。

> mainは保護されています。ブランチを作って変更し、PRでマージしてください

### 5.6 直接編集の退避 (保護と dirty 拒否の両立)

Docs 側での main の直接編集までは止められない (オーナーの権限は剥がせない)。
ここで**保護と Phase 2 の dirty 拒否が噛み合うと行き止まりになる**。

- Phase 2: main に未コミットの変更があるとマージを拒否し、「先に main をコミット
  してください」と言う
- Phase 4 の保護: main へのコミットを禁止する

この2つをそのまま入れると、**Docs で main を1文字でも触った瞬間、二度とマージ
できなくなる。** 逃げ道が必要である。

`apiStashMainDrift(fileId)` を1つだけ用意する。これは main の現在の内容を
**「main への直接編集を退避」という固定のメッセージでコミットする専用の操作**で
あり、通常のコミット導線とは分ける。

- UI では「未コミットの変更あり」バッジの隣に「直接編集を退避」ボタンとして出す
- 押すと履歴に退避コミットが残り、main は clean になってマージできる
- 通常の `apiCommit` は main に対して拒否されたままである

**保証されるのは「PR を通さない変更が、通常のコミットとして紛れ込まないこと」**で
あって、「main の履歴に一切入らないこと」ではない。直接編集はどこかに記録しなければ
失われるため、専用の名前をつけて明示的に残す。

---

## 6. サブプロジェクト 4c: GitHub ライクな UI

### 6.1 目標

**GitHub を使ったことがある人が、説明なしで操作できること。** 個々の機能追加ではなく、
情報の並べ方を GitHub に寄せる。

### 6.2 変更点

| 箇所 | 現在 | Phase 4 |
|---|---|---|
| 左ペイン | 平坦なファイル一覧 | **ブランチ切替** + パスで階層化したファイルツリー |
| 差分 | 1列 (追加=緑 / 削除=赤) | **左右2列** (split view)。spec §7 の要求 |
| PR 詳細 | 1画面に差分と操作 | **3タブ** (会話 / コミット / 変更ファイル) |
| PR の会話 | 無し | レビュー本文を時系列で表示し、コメントを投稿できる |
| 元ファイルへのリンク | ツールバーに1箇所 | ファイル一覧の各行・履歴・PR・Issue チップにも |
| main の未コミット変更 | コミットボタンが出る | **「直接編集を退避」ボタン**に変わる (5.6) |

### 6.3 ブランチ切替

左ペイン上部にブランチのセレクタを置く。選ぶと、そのブランチに存在するファイルだけを
ツリーに出す。`branches/<name>/<path>` という論理パスから `<path>` を取り出して
**main と同じ見た目の階層**で並べる。これにより「同じ文書をブランチ間で行き来する」
という GitHub の感覚が出る。

### 6.4 左右2列の差分

既存の `diffHtml()` が返す ops (`equal` / `insert` / `delete`) から、左右の行を
組み立てる。`delete` は左だけ、`insert` は右だけ、`equal` は両方に置き、
**行の高さを揃えるために空セルを入れる**。

### 6.5 PR のコメント

`reviews` テーブルは `state` に `comment` を既に許している (Phase 2)。UI から
`apiPrReview(number, 'comment', body)` を呼べるようにし、会話タブに時系列で並べる。
**新しいテーブルは要らない。**

---

## 7. サブプロジェクト 4d: アプリ内ガイド

「ヘルプ」タブを追加する。内容は次の3つ。

1. **用語の対応表** — GitHub の概念とこのアプリの対応 (リポジトリ = Drive フォルダ、
   blob = 正規化HTML、など)
2. **基本の流れ** — Issue を作る → ブランチを作る → 編集する → コミット →
   PR → レビュー → マージ
3. **つまずきやすい点** — main が保護されている理由、コンフリクトの解決方法、
   「書き戻せません」と出たときの対処、色やフォントが版管理されないこと

静的な HTML とし、`app.js.html` から状態を持たない。

---

## 8. テスト戦略

| 対象 | 方法 |
|---|---|
| `Markdown.js` | **vitest でピュアにテスト**。往復 (`mdToBlocks(blocksToMd(x)) === x`) を語彙ごとに固定 |
| コマンドキュー | 疑似GAS に `ScriptApp` のフェイクを足し、命令ファイル → 実行 → 結果ファイルまでを統合テスト |
| main 保護 | 疑似GAS で `apiCommit` / `apiSaveMarkdown` が拒否し、`prMerge` は通ることを固定 |
| 直接編集の退避 | 疑似GAS で「main を直接編集 → 退避 → マージできる」が通ることを固定。この経路が壊れるとマージが永久にできなくなるため必須 |
| UI | 目視。ロジックを含む差分の組み立てだけは純関数に切り出してテストする |

## 9. 既知の割り切り

- **キューの遅延は最大1分。** 時間主導トリガーの最小間隔である
- **編集画面から画像は追加できない** (5.3)
- **Docs 側での main 直接編集は止められない。** 履歴に入らないことは保証する (5.5)
- **Markdown の語彙は正規化HTMLの語彙に閉じる。** 脚注・引用・コードブロックなどは
  Block 型に対応が無いため受け付けない
