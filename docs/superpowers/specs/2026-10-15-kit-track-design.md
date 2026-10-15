# 手元の道具: 作業をやることに載せる・更新を知らせて自動で入れ替える 設計

2026-10-15。利用者の依頼:

- 「手元に落とす道具の初期セットアップ時に、Claude Code で行うすべての作業を適宜このアプリの
  やることへ追加・更新・反映できるよう、ユーザの general の .claude にトリガーを仕込む」
- 「道具にアップデートが入ったら、アプリ上に通知バッジを出して更新を促す」
- 「手元の道具を使っているとき、1日1回アップデートが来ていないか調べて自動でできると良い」

## 1. 決めたこと (利用者に確かめた)

| 問い | 決めたこと |
|---|---|
| 何を1件のやることにするか | **作業の依頼ごと** (物を変える依頼を Claude が見分けて1件。質問・調べもの・雑談は載せない) |
| どのフォルダの作業を載せるか | **登録したフォルダ (とその下) だけ**。仕掛けはグローバルの `~/.claude` に入れる |
| 仕組み | **A: フックが合図し、Claude が見分けて起票・更新・完了する** |
| 新しい版を見つけたら | **入れ替えまで完全に自動** |

### 自動で入れ替えることの危険 (利用者が選んだ上で、手当てを入れる)

命令の入れ先 (Drive の `queue/`) は、Drive を共有している人なら誰でも書ける。結果のファイルを
偽って「新しい道具」を置くと、**それを受け取った全員の手元で、その人が書いたプログラムが動く**。
この仕組みの中に、受け取った中身が本物かを確かめる手段は無い (向こう側は GAS で、署名を作れない。
画面の Web アプリは Google のログインが要り、手元の node からは取れない)。

その上で入れる手当て:

- **入れ替えのあいだは何も実行しない** (書き換えるだけ。新しい `agent.mjs` が動くのは次に呼ばれたとき)
- **道具の置き場 (`~/.banto/kit/`) の外には書かない**。名前に `..`・絶対パス・`~/.claude` 以外の
  場所を含むものは捨てる (`~/.claude` へは決まったファイルだけ。§3.4)
- **入れ替える前の中身を控える** (`~/.banto/backup/<日時>/`)。`agent update rollback` で1回で戻せる
- **何が変わったかを記録して、次に Claude Code を開いたときに見せる** (気づけるようにする)
- **切れる**: `~/.banto/config.json` の `autoUpdate: false` で、知らせるだけにできる
- 受け取った中身の指紋が、向こうが名乗った指紋と合わなければ入れない (壊れた・途中で切れたものを防ぐ。
  偽物は防げない)

## 2. 全体の形

```
~/.banto/
  kit/              道具の本体 (agent.mjs ほか。zip の中身と同じ)
  config.json       queueDir / webAppUrl / autoUpdate / lastUpdateCheck / kitPrint
  tracked.json      載せるフォルダの一覧
  sessions/<id>.json  会話ごとのいまのやること
  backup/<日時>/      入れ替える前の控え
  update-log.json   最後の入れ替えで変わったファイル (見せたら消す)
  hooks/track-hook.mjs  フックの本体 (kit から写す)
~/.claude/
  settings.json     hooks に2つ足す (UserPromptSubmit / Stop) — 既存は残す
  skills/banto-track/SKILL.md   起票・更新・完了の手順
```

## 3. 手元の道具 (kit/)

### 3.1 セットアップ (`node agent.mjs setup` の続き)

今までの案内 (要る3つ) のあとに:

1. 「Claude Code の作業を番頭のやることに載せる仕掛けを `~/.claude` に入れますか」と尋ねる
   (`--yes` で尋ねない)。入れるもの (フック2つ・スキル1つ・`~/.banto/`) を先に並べて見せる
2. 入れるとき:
   - `~/.banto/kit/` に道具を写す (`agent.mjs` を含む)。`config.json` に今の設定を写す
   - `~/.claude/settings.json` を `settings.json.banto-backup-<日時>` に控えてから、`hooks` に
     2つを**足す** (同じものが既にあれば足さない。他のフックと設定は触らない)
   - `~/.claude/skills/banto-track/SKILL.md` を置く
3. 「いまのフォルダを番頭に載せますか」と尋ねる (`tracked.json` に足す)

`agent track install` / `agent track uninstall` (足したフック・スキルだけを外す。`~/.banto/` は残す) /
`agent track add [フォルダ]` / `agent track remove [フォルダ]` / `agent track list` も置く。
**何度実行しても同じ結果** (二重に足さない・無いものを外そうとして落ちない)。

### 3.2 フック (`~/.banto/hooks/track-hook.mjs`)

`settings.json` に足すもの (コマンドは `node ~/.banto/hooks/track-hook.mjs prompt|stop`):

- **UserPromptSubmit**: 入力の `cwd` が登録したフォルダ (またはその下) なら、`additionalContext` で
  次を渡す。登録外なら何も出さない
  - 「このフォルダの作業は番頭に載せる。物を変える依頼なら banto-track スキルに従って起票する」
  - 会話のいまのやること (`sessions/<session_id>.json`) があれば「いまのやることは #N (題名)」
  - 1日1回の更新確認の結果と、前回の自動入れ替えで変わったファイル (`update-log.json`。見せたら消す)
- **Stop**: 登録したフォルダで、この会話のいまのやることがあり、この返事のあいだに更新の印
  (`sessions/<id>.json` の `touchedAt`) が付いていなければ、**1回だけ** `decision: "block"` で
  「番頭のやること #N を更新するか完了にしてください (済んでいれば `agent track touch` で印を付ける)」
  と返す。同じ返事でもう一度止めない (`stop_hook_active` が true なら止めない)
- フックは**待たない** (番頭への問い合わせはしない)。ファイルを読んで字を返すだけ。2秒以内に返す
- 何か失敗しても**作業を止めない** (例外は握って何も出さない)

### 3.3 スキル (`~/.claude/skills/banto-track/SKILL.md`)

- **起票する依頼**: ファイル・設定・文書を作る・直す・消す依頼。**しない**: 質問・説明・調べもの・
  雑談・確認だけの依頼
- 起票: `node ~/.banto/kit/agent.mjs issue "<題名>" "<本文>"` を**バックグラウンドで**走らせ
  (返事に最大1分かかる)、番号が返ったら `agent track set <番号> "<題名>"` で会話に結び付ける
  - 題名は依頼を40字以内でまとめたもの。本文は依頼の要約・フォルダ名・関係するリンク (PR など)
- 着手したら `agent board <番号> "In Progress"`、PR などを出したら `"In Review"` とリンクを
  `agent issue-say <番号> "<一言>"` で書き足す
- **完了**: 依頼が終わったと言えるとき (反映・公開まで要る作業ならそこまで) に `agent issue-close <番号>`。
  途中で止めるときは開いたまま、どこまでやったかを `issue-say` で残す
- どの操作のあとも `agent track touch` で印を付ける (Stop フックが促さなくなる)
- 番頭に届かない (命令の入れ先が無い・1分で返らない) ときは、作業を止めず「番頭に載せられませんでした」と
  1行だけ利用者に伝える

### 3.4 1日1回の更新確認と自動入れ替え

- **いつ**: `agent` のどの命令でも、`config.json` の `lastUpdateCheck` が24時間より前なら、
  本来の命令のあとで確認する (UserPromptSubmit フックでは確認しない。待つから)
- **どう**: 命令 `kitVersion` (新しい op) で向こうの `{version, print}` を取る。手元の `kitPrint` と
  違えば命令 `kitFiles` (新しい op) で `{print, files: {名前: base64}}` を取る
- 受け取った `files` の指紋 (`sha256(JSON.stringify(files))` の先頭8字。`agentKitName_` と同じ作り方) が
  `print` と合わなければ入れない
- 入れ替え:
  1. `~/.banto/kit/` の今の中身を `~/.banto/backup/<日時>/` に写す (控えは新しい3つだけ残す)
  2. `files` を `~/.banto/kit/` に書く。名前は正規化して `kit/` の外に出るものは捨てる
  3. `~/.claude/skills/banto-track/SKILL.md` と `~/.banto/hooks/track-hook.mjs` を kit の中の同名から写す
     (**`~/.claude` に書くのはこの1つだけ**。settings.json は自動では触らない)
  4. `config.json` の `kitPrint` / `lastUpdateCheck` を書き、変わったファイルを `update-log.json` に書く
- `autoUpdate: false` のときは手順 1–4 をせず、`update-log.json` に「更新があります (`agent update` で入れる)」
  とだけ書く
- `agent update` (今すぐ確認して入れる)・`agent update rollback` (最後の控えに戻す) を置く
- 確認や入れ替えが失敗しても本来の命令の結果は変えない

## 4. 番頭 (GAS)

- 命令 `kitVersion` → `{version: AGENT_KIT_VERSION(), print: 指紋}`、`kitFiles` → `{print, files: KIT_FILES()}`
  を `COMMAND_OPS()` に足す (`OUTBOX_VERBS` ではない。読むだけ)
- **画面の札**:
  - 道具を落とすとき (`apiAgentKit`) に、その人の UserProperties に今の指紋を `KIT_PRINT:<email>` で覚える
  - 命令 `kitVersion` を置いた人 (命令ファイルの持ち主) が分かれば、その人にも覚え直す
    (入れ替えたあとに札を消すため)。分からなければ何もしない
  - `apiKitStatus()` → `{print, mine, outdated}`。`mine` が空 (まだ落としていない) なら `outdated: false`
  - 画面: `outdated` なら右上の自分の顔に小さな点、自分まわりの「手元から動かす道具を落とす」に
    「更新あり」の札。落とし直したら消える
- `AGENT_KIT_VERSION()` を上げる (中身を変えたので)

## 5. テスト

- `test/agentkit.test.js` (手元の道具):
  - `track install` が settings.json を控えてから hooks を**足す** (既存のフック・他の設定が残る)。
    2回実行しても二重にならない。`uninstall` で足したものだけが消える
  - `track add/remove/list`。登録の下のフォルダは載る、外は載らない
  - フック prompt: 登録内なら合図 (いまのやること・更新の知らせを含む)、登録外なら空。2秒以内・例外で落ちない
  - フック stop: 印が無ければ1回だけ block、`stop_hook_active` なら block しない、印があれば block しない
  - 更新: 24時間以内は確認しない / 指紋が同じなら取らない / 指紋が合わなければ入れない /
    `..` や絶対パスの名前は捨てる / 控えを取ってから入れる / `rollback` で戻る / `autoUpdate:false` は知らせるだけ /
    失敗しても本来の命令の結果は変わらない
  - 疑似の queue (一時フォルダ) と、結果のファイルを置く偽の向こう側で動かす (今の agentkit テストのやり方)
- `test/` (GAS): `kitVersion` / `kitFiles` の op、`apiAgentKit` で指紋を覚える、`apiKitStatus` の outdated、
  `phase4-edit` の「画面に渡せる形か」に `apiKitStatus`
- `test/component.test.js`: outdated なら自分の顔に点と「更新あり」、落とし直すと消える
- `test/agentkit.test.js` の「この道具は頼みごとを実行しない」(`execFileSync` の数) を崩さない。**更新は書き換えるだけで実行しない**

## 6. 文書

- `kit/AGENTS.md` (zip の中で CLAUDE.md にもなる) に、番頭に載せる仕組み・`track`・`update` の使い方と、
  自動入れ替えの危険と切り方を書く
- CLAUDE.md (このリポジトリ) に「手元の道具は1日1回自分を更新する。入れ替えは書き換えるだけで実行しない。
  `~/.claude` に自動で書くのは banto-track のスキルだけ」を書く

## 7. やらないこと

- 登録外のフォルダの作業を載せる
- フックの中で番頭に問い合わせる (待たせない)
- settings.json の自動書き換え (入れるのはセットアップのときだけ、人が ok したとき)
- 受け取った中身の本物確認 (この仕組みではできない。§1 の手当てで代える)
