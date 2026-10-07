# エージェンティックスクラム (使う人だけ)

AI のチームメンバー (この手元の Claude Code) と一緒に、スクラムで進めるための機能です。
`ai-scrum-gas` から取り入れました。**既定ではオフ**です。

## まず、オンかを確かめる

```
node agent.mjs scrum
```

- `scrumEnabled: false` なら **進めない**。利用者に「管理者 (持ち主かフォルダの編集者) が画面の『設定』で
  エージェンティックスクラムをオンにすると使えます」と伝える。手元からは切り替えられない
- `true` なら、プロダクトゴールと完了の定義も一緒に返る

## 置き場所

- **台帳に置くもの** (人が画面で見て操作するもの): PBI・スプリント・障害物・やりとり・
  変更の履歴。CSV は無い。下の命令で読み書きする
- **手元の `scrum/` に書くもの** (文章の成果物): スプリントバックログの説明・デイリー
  スクラム・レビュー・振り返りの記録 (`scrum/sprintXXX/*.md`)、依頼書 (`scrum/order/`)、
  仕様 (`scrum/specs/`)、チームの決めごと
- **ひな形**は `scrum-templates/` にある。`scrum/` に同じ名前のファイルが無ければ写して
  使う (`scrum/` を丸ごと上書きしない。チームが書き足したものが消える)
- `.claude/skills/` がスクラムのイベント、`.claude/agents/` がチームの役割

## ai-scrum-gas との読み替え

| ai-scrum-gas | この道具 | 命令 |
|---|---|---|
| `product_backlog.csv` を読む | やること (PBI) の一覧 | `node agent.mjs issues open` |
| PBI を作る | やることを作る | `node agent.mjs issue "題" "説明 (ユーザーストーリー)"` |
| `size` | ストーリーポイント | `node agent.mjs issue-update <番号> '{"points": 3}'` |
| `acceptance_criteria` | 受入基準 (1行に1つ) | `node agent.mjs issue-update <番号> '{"acceptance": "…"}'` |
| `sprint` | スプリント | `node agent.mjs issue-update <番号> '{"sprint": "sprint001"}'` |
| `priority` Critical / High | 優先度 high | `issue-update <番号> '{"priority": "high"}'` |
| `priority` Medium / Low | 優先度 normal / low | 同上 |
| `status` New / Ready | 進捗ボードの Backlog (スプリントに入れたものが Ready) | `node agent.mjs board <番号> Backlog` |
| `status` In Progress | In Progress | `node agent.mjs board <番号> "In Progress"` |
| `status` Review | In Review | `node agent.mjs board <番号> "In Review"` |
| `status` Done | 完了 | `node agent.mjs issue-close <番号>` |
| `product_backlog_done.csv` | 完了したやること | `node agent.mjs issues closed` |
| `velocity.csv` | スプリント (計画・終えた・持ち越しは自動で数える) | `node agent.mjs sprints` / `scrum-view [名前]` |
| スプリントを足す | スプリントを作る | `node agent.mjs sprint-add <名前> "ゴール" <始まり> <終わり>` |
| スプリントのゴール・期間を直す | 同左 | `node agent.mjs sprint-edit <名前> '{"goal": "…"}'` |
| `impediment_log.csv` | 障害物 | `node agent.mjs impediments` / `impediment "題" "詳しく"` |
| 障害物を解決 (`_resolved.csv` へ移す) | 解決する | `node agent.mjs impediment-resolve <番号> "解決策"` |
| `comments.csv` | やりとり | `node agent.mjs issue-say <番号> "…"` / `impediment-say <番号> "…"` |
| `change_log.csv` | 変更の履歴 (自動で残る) | `node agent.mjs changes issue:<番号>` |
| `product_goal.md` / `definition_of_done.md` | 設定 (管理者が画面で直す) | `node agent.mjs scrum` (読むだけ) |
| `sprint_backlog.md` の残作業 | バーンダウン (自動で数える) | `node agent.mjs scrum-view [名前]` |

**数を手で書かない。** ベロシティもバーンダウンも、やることのポイントと完了日から
数える。ai-scrum-gas で `velocity.csv` に書いていた数は、ここでは書く場所が無い。

**終わらなかったやることは、次のスプリントへ移してよい** (`issue-update <番号>
'{"sprint": "sprint002"}'`)。終わったスプリントは終わりの日の時点の中身で数えるので、
移しても前のスプリントの計画と持ち越しに残る。過去のスプリントへ後から入れた
ものは、そのスプリントの始まりから入っていたものとして数える。

**終わったやることは消さない。** 完了にする (`issue-close`)。

## 人にしかできないこと

- エージェンティックスクラムのオン・オフ、プロダクトゴールと完了の定義を直すこと
  (管理者が画面の「設定」で)
- 確認依頼の承認 (画面で)
