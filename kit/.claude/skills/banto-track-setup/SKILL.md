---
name: banto-track-setup
description: この道具 (SoftBanto / 番頭) に Claude Code の作業を載せる仕掛けを入れる・外すとき (`node agent.mjs track ...`)、道具の自動更新・`update`・`update rollback` を扱うときに読む。`track install --yes` を実行する前に必ず読む。
---

# 番頭に作業を載せる (Claude Code を使う人だけ)

`node agent.mjs track install` で、Claude Code の作業を番頭のやることに載せる仕掛けを入れられます。
**入れる前に利用者に確かめ、ok をもらってから `--yes` を付けて実行してください。**
`--yes` を付ける前に、次の2行を必ず利用者に伝えてください:
「道具は1日1回自動で新しくなり、そのたびにフックも入れ替わって次の依頼から自動で動きます。入れるのは番頭の
署名が合うものだけですが、秘密鍵を持つ人 (deploy する人) を信頼することになります」「切るには
`~/.banto/config.json` に `"autoUpdate": false` と書きます」

- 入るもの: `~/.claude/settings.json` の hooks に2つ (今の設定は `settings.json.banto-backup-<日時>` に控える)・
  `~/.claude/skills/banto-track/SKILL.md`・`~/.banto/` (道具の本体と設定)
- 設定が読めない形のとき (JSON として壊れている・hooks の形が違う) は、何も書かずに断ります
- 載せるのは**登録したフォルダ (とその下) だけ**: `node agent.mjs track add <フォルダ>` / `track remove` / `track list`
- 外す: `node agent.mjs track uninstall` (足したフックとスキルだけを外す。`~/.banto/` は残る)
- 会話とやることの結び付け (スキルが使う): `track set <会話id> <番号> <題名>` / `track touch <会話id>` / `track clear <会話id>`

## 道具の自動更新

`~/.banto/kit/agent.mjs` は、1日1回、命令のついでに番頭へ新しい版を尋ね、あれば**自動で入れ替えます**
(尋ねる命令を置いて帰り、返事は次に呼ばれたときに拾います。命令を待たせません)。

- 入れ替えると、道具の本体だけでなく `~/.banto/hooks/track-hook.mjs` と `~/.claude/skills/banto-track` も
  新しくなります。**Claude Code はそのフックを次の依頼から (どのフォルダでも) 自動で動かします**
- **自動で入れるのは、番頭の署名が合うものだけです。** 命令の入れ先 (Drive の queue/) は Drive を共有している
  人なら誰でも書けますが、偽の返事には正しい署名を付けられないので、入れずに断ります。確かめる鍵は今入っている
  道具の `track/kit-key.pem` (最初は Web アプリから落とした zip のもの) で、届いた中身の鍵は使いません
- **残る危険**: 署名できるのは秘密鍵を持つ人 (deploy する人) だけです。その人を信頼することになります
- 自動では今より古い版には戻しません (前に配った本物の返事を流し直されても入れない)。戻すのは `update rollback` で
- 鍵を持たない古い道具は自動では入れ替えず、新しい版があることだけを知らせます。そのときは**番頭の画面から
  道具の zip を落とし直し、その中の `agent.mjs` で `track install` を実行する**よう利用者に伝えてください
  (落とした zip の鍵で確かめて入れます。`node agent.mjs update` だと置き場に鍵が無いので確かめずに入ります)
- 控えと戻し (`node agent.mjs update rollback`) で1つ前に戻せます
- 切る: `~/.banto/config.json` に `"autoUpdate": false` と書くと、新しい版があることを知らせるだけになります
- 入れ替えたら、次に Claude Code を開いたときに何が変わったかが合図に出ます。利用者に1行だけ伝えてください
- 戻した版は自動では入れ直しません。今すぐ確かめる: `node agent.mjs update` (手で頼んだときは、飛ばしている版でも入れます)
- `node agent.mjs update` は番頭の返事を待つので数分かかることがあります。**バックグラウンドで実行してください**
  (Claude Code の Bash は2分で打ち切ります)
