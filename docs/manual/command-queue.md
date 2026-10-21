# コマンドキュー

[手引きの目次](README.md)

GCP プロジェクトが使えない環境では `clasp run` (Apps Script API) が使えない。公開エンドポイントも作らない方針なので、
手元からは **Drive 上のフォルダに命令のファイルを置き、1分ごとのトリガーが拾って実行する**形で操作する。
実装は `src/core/CommandQueue.gs`。ふだんは命令のファイルを手で書かず、[手元の道具](agent-kit.md) を使う。

```
手元 --(<id>.cmd.json)--> .git/queue/ --(1分以内)--> 番頭が実行
手元 <--(<id>.result.json)-- .git/queue/ <-----------+
                             .git/queue-done/   処理済みの命令
```

## 用意

GAS エディタで **`setupCommandQueue()`** を一度だけ実行する ([置き方](setup.md#4-手元から動かすなら-setupcommandqueue))。
`queue/` と `queue-done/` は初めて使うときに作られる (ゴミ箱に入っていたら作り直す)。

## 命令と結果の形

`queue/` に `<id>.cmd.json` を置く。

```json
{ "op": "commit", "args": { "fileId": "1AbC...", "message": "第3条を改訂" } }
```

1分以内に、同じフォルダに `<id>.result.json` が出る。

```json
{ "ok": true, "op": "commit", "result": { "sha": "9f8e..." }, "at": "2026-09-08T09:00:00.000Z" }
```

`ok` が `false` なら `error` に理由が入る。

## 動き方

- 1回の起動で処理するのは10件まで (6分の実行時間の上限があるため)。残りは次の回に回る
- 鍵は命令1件ごとに取る。命令が無いときは取らない (画面からの操作を待たせないため)
- **一度実行した命令は二度実行しない。** `queue-done/` に同じ名前があれば実行せずに片付ける (Drive の同期の都合で、
  手元に残った命令が `queue/` に戻ってくることがあるため)
- 処理済みへ移してから結果を書く (逆だと、書いた直後に打ち切られたとき命令が残ってもう一度走る)
- 1件が失敗してもキュー全体は止めない (その命令の結果が `ok: false` になる)
- 正式版の保護など、画面と同じ守りがキュー経由でも効く。開いたときの指紋を渡さない呼び方 (`writeMarkdown` の
  `baseSha` を省く・`prMerge` の `previewSha` を省く) は、指紋の照合を飛ばす
- 1日1回の片付け (捨てたやることの整理・元の文書が消えた確認依頼の取り下げ・古いリポジトリへの正式版の行の補い) も
  このトリガーに載っている
- 回った時刻を `QUEUE_LAST_RUN` に残し、設定の画面で「止まっていないか」を見せる

## 命令の一覧

**ここに無い命令は実行しない。** キューは Drive の共有相手なら誰でも書けるため、任意の関数名を受け付けると事実上の
遠隔呼び出しになる。一覧の唯一の定義は `COMMAND_OPS()` で、`test/docs.test.js` がこの表と食い違っていないかを見ている。

**確認依頼の承認 (`prReview`) は入れていない。** トリガーは持ち主の権限で走るので、キュー経由の承認は常に自己承認に
なる。承認は人が画面で行う。期間で進める (スクラム) のオン・オフを切り替える命令も無い。

### 文書

| op | args | 内容 |
|---|---|---|
| `listFiles` | なし | 登録した文書の一覧 |
| `status` | `fileId` | 記録していない変更があるか |
| `readMarkdown` | `fileId` | 中身を Markdown で読む (`baseSha` も返る) |
| `writeMarkdown` | `fileId`, `markdown`, `baseSha` (任意) | Markdown で書き換える。正式版は断る |
| `commit` | `fileId`, `message`, `expectedHeadSha` (任意) | 変更を記録する。`expectedHeadSha` が今と違えば断る |
| `stashMainDrift` | `fileId` | 正式版の直接編集を退避の記録にする |
| `commitHistory` | `fileId` | 記録の一覧 (読むだけ) |
| `commitDiff` | `fromSha` (任意), `toSha` | 2つの記録の差分 (読むだけ) |

### 改訂版と確認依頼

| op | args | 内容 |
|---|---|---|
| `branchCreate` | `name`, `fileId` | 改訂版を作る |
| `prCreate` | `title`, `body`, `sourceBranch`, `mainFileId`, `targetBranch` (任意、既定 `main`) | 確認依頼を出す。`mainFileId` は1つでも配列でもよい |
| `prPreview` | `number` | 反映の下見 (食い違いの一覧と `previewSha`) |
| `prMerge` | `number`, `choices` (任意), `previewSha` (任意) | 反映する。承認が要る。`choices` は食い違いごとの `ours` / `theirs` / `both` |
| `prList` | なし | 確認依頼の一覧 (読むだけ) |
| `patchAdd` | `number`, `path`, `text` | コードの差分を証跡として添える (反映も承認もしない) |
| `patchRemove` | `number`, `id` | 添えた差分を外す |
| `patches` | `number` | 添えた差分の一覧 |

### やること

| op | args | 内容 |
|---|---|---|
| `issueList` | `state` (任意: `open` / `closed` / 空で全件) | やることの一覧 |
| `issueCreate` | `title`, `body`, `linkedFileIds` (任意) | やることを作る |
| `issueUpdate` | `number`, `patch` | 欄を直す。直せる欄は title / body / assignee / labels / linkedFileIds / dueDate / startDate / parent / estimate / plannedHours / actualHours / priority / sprint / points / acceptance |
| `issueClose` | `number` | 完了にする |
| `issueComment` | `number`, `body` | やりとりを書く |
| `issueCreateBranch` | `number`, `fileId` | やることから改訂版を作る |
| `boardMove` | `number`, `column`, `order` (任意、既定 0 = 先頭) | 進捗ボードの列を動かす (`Backlog` / `In Progress` / `In Review` / `Done`) |
| `history` | `target` (`issue:N` / `impediment:N` / `sprint:名前`) | 欄の変更の履歴 |

### 期間で進める (スクラム。既定オフ)

オフのあいだは `scrumState` 以外を断る。

| op | args | 内容 |
|---|---|---|
| `scrumState` | なし | オンか・目指すところ・終わったと言える条件。オフなら案内も返す |
| `sprintList` | なし | 作業期間の一覧 |
| `sprintCreate` | `fields` (`name`, `goal`, `startDate`, `endDate` など) | 作業期間を作る |
| `sprintUpdate` | `name`, `patch` | 作業期間を直す |
| `scrumView` | `sprint` (任意) | 残りの量の推移・期間ごとに終えた量など |
| `impedimentList` | なし | 困りごとの一覧 |
| `impedimentCreate` | `fields` (`title`, `body` など) | 困りごとを書き出す |
| `impedimentUpdate` | `number`, `patch` | 困りごとを直す |
| `impedimentResolve` | `number`, `resolution` | 解決策を書いて解決にする |
| `impedimentComment` | `number`, `body` | 困りごとにやりとりを書く |

### 自分の様子を見る

| op | args | 内容 |
|---|---|---|
| `homeMine` | なし | あなたの番 (待っている確認・戻ってきたもの・期限) |
| `homeAdvice` | なし | 改善のヒント |
| `workStyle` | なし | 仕事のスタンス診断の型・ひとこと・強み・気をつけたいこと・軸ごとの手伝い方 (点数は入れない)。診断していなければ `taken: false` と、診断の仕方 |
| `reportDraft` | `kind` (任意: `three` / `today` / `plain` / `custom`) | 今日の日報の下書きの中身と形 |
| `searchIndex` | なし | 横断検索の一覧 (題名・番号・状態だけ。絞るのは手元) |
| `oshiPrompt` | `tool` (`chatgpt` / `gemini` / `claude` / `codex`) | 推しのキャラ作成キットの頼み文 (`{tool, label, prompt}`)。読むだけ。中身は番頭の定義の字で、人の字を含まない |
| `oshiSpinner` | なし | 置いた人がいま使う推しの考え中のせりふ (`{on, char, name, lines, reason}`。`lines` は24字まで・20個まで)。読むだけ。見るのは置いた人の自分の設定で、推しがオフなら `on: false`・空の `lines` と理由。手元の `oshi-spinner` が Claude Code の `spinnerVerbs` に書く |

### 管理者だけ

置いた人が管理者 (持ち主と、入れ物のフォルダを編集できる人) でなければ断る。

| op | args | 内容 |
|---|---|---|
| `oshiProfileSet` | `key` (`taku` / `itsuki` / `tsujippi` / `ikkun` / `ryoka` / `satomi`), `profile` (`{items: [{lv, label, text}], clearLine, clearVideo}`。JSON の字でもよい。空の字で外す) | 最初からいるキャラのプロフィールを入れる。返事は項目の数と、お祝いの言葉・動画があるかだけ (中身は返さない) |

### 手元への頼みごと (outbox)

| op | args | 内容 |
|---|---|---|
| `work` | `limit` (任意、既定5) | 頼みごとを取る。取った印を付けてから返す |
| `workDone` | `id`, `result` (任意) | 終わったと返す |
| `workFail` | `id`, `reason` (任意) | できなかったと返す |

### 手元の道具の更新

| op | args | 内容 |
|---|---|---|
| `kitVersion` | `mine` (任意: 手元の指紋) | 配っている道具の版と指紋。誰の道具が古いかを覚える |
| `kitFiles` | なし | 道具の中身一式と署名 |

## 「置いた人」の扱い

命令ファイルを置いた人を `by` として読む (マイドライブではファイルの持ち主、共有ドライブでは最後に書いた人)。

- **自分の様子を見る命令 (`homeMine` / `homeAdvice` / `reportDraft` / `workStyle` / `oshiSpinner`、`COMMAND_PERSONAL_OPS()`) は、置いた人から見た様子を返す。**
  置いた人が分からなければ「命令を置いた人が分かりません」で断る。マイドライブで命令ファイルの持ち主が移されて
  最後に書いた人と食い違うときも断る
- **管理者だけの命令 (`oshiProfileSet`、`COMMAND_ADMIN_OPS()`) は、置いた人が管理者のときだけ走る。** 置いた人は上と同じく
  持ち主と最後に書いた人を見比べて決め、**見比べられない (Drive の拡張サービスが使えない) ときは決めずに断る**。
  Drive が最後に書いた人を返さないときも断る。処理したあと、`queue-done/` に移した命令ファイルの中身は `{id, op}` だけに
  書き換える (プロフィールの中身を、共有している人に残さない)。手元に残した命令ファイルは自分で消す
- **`by` は誰の見え方を返すかを決めるだけで、権限の仕組みではない (管理者だけの命令を除く)。** 結果は `queue/` に置かれ、共有している人なら
  誰でも読める (中身は台帳を読める人に見えているものと同じ)
- これらの命令は画面の `api*` を呼ばない。トリガーは持ち主の権限で走るので、呼ぶと持ち主のぶんが返るため
- `reportDraft` で本人が選んだ形 (自分の形を含む) を使えるのは、キューを仕掛けた人だけ (形はその人の UserProperties にある)。
  ほかの人はチームの既定の形になる。`kind` を渡せばその形になる
- `kitVersion` / `kitFiles` は、置いた人ごとに道具の指紋を覚える (スクリプトプロパティ `KIT_PRINT:<アドレス>`)。
  画面の自分の顔に「道具の更新あり」を出すため

## 番頭から手元へ (頼みごと)

逆向きの経路は台帳の `outbox` 表で、**手元が取りに来る**。押すのではないので、寝ている機械は起きない。時計として
使ってはならない。

| 動詞 | 意味 | 引数 |
|---|---|---|
| diff | 差分を出して添える | `branch`, `against` |
| merge | 承認されたので取り込む | `branch`, `into` |
| review | 中身を読んで意見をもらう | `branch`, `against` |

- 動詞は `OUTBOX_VERBS()` に列挙する。決めた欄以外の引数は捨てる
- 引数は空白・制御文字・シェルの記号・`..`・`-` 始まりを断る。日本語の改訂版の名前は通す
- 状態は `open` → `taken` → `done` / `failed`。取ったまま24時間動かないものは `open` に戻す
- `merge` は、コードの差分が添えられた確認依頼を反映したときに自動で置かれる (画面から手では置けない)。置けなくても反映は巻き戻さない
- 手元の道具は頼みごとを**実行しない**。中身を Claude に見せるところまでで止める ([手元の道具](agent-kit.md#頼みごとを取りに来る))
