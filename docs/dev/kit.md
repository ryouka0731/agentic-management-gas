# 手元から動かす道具 (配る道具と署名)

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。

## 手元から動かす道具は GAS の中に置く

**`kit/AGENTS.md` は zip の中で `CLAUDE.md` にもなる**（`scripts/build-kit.mjs`
の `FILES` が同じ元から2つ配る）。片方だけ直すことはできない造りにしてある。

初めて動くときの案内は `node agent.mjs setup` にある。**設定が読めない状態で
こそ要るものなので、`findConfig()` は投げずに `null` を返す。** `loadConfig()`
だけが投げる。手元から触れない場所（Drive / Apps Script）のパスは当てさせず、
取り方を伝える形にしてある。


`kit/` にある**本物のファイル**が中身の本体で、`scripts/build-kit.mjs` が
それを base64 にして `src/KitFiles.gs` に焼き直し、`AgentKit.gs` が zip にして
配る。**別のリポジトリに切り出さない。** 配る側が2つのものを version 合わせで
管理することになり、必ずずれる。

**中身をそのまま GAS の HTML ファイルとして置いてはいけない。** `<id>` や
`<mainFileId>` がタグと解釈され、`-->` がコメントの終わりと読まれて壊れる。
実際に `agent.mjs` と `AGENTS.md` が壊れて配られていた。base64 なら何が
書いてあっても解釈されようがない。

- 直すのは `kit/` のほう。`src/KitFiles.gs` は**手で直さない**
- 焼き直しは `npm run deploy` が自動で走らせる
- `test/agentkit.test.js` が、焼き直したものと `kit/` の中身が一致している
  ことを見ている。忘れるとテストで止まる
- 中身を変えたら `AGENT_KIT_VERSION()` を上げる（人が読むための版）。zip の名前には
  中身の指紋も入れてある (`agentKitName_`) ので、上げ忘れても古い中身は配られない。
  以前は版だけで名前を決めていて、上げ忘れると前の zip が配られ続けた
- **頼みごとの引数を手元の git に渡すときは、`-` 始まりを断る。** オプションとして
  読まれ、`git diff --output=<ファイル>` で手元のファイルを書き換えられた。手元
  (`agent.mjs` の `gitDiff`) とサーバ (`outboxArgValid_`) の両方で断っている

- **手元の道具は1日1回自分を新しくする** (`kit/track/update.mjs`)。入れ替えるのは道具の本体だけでなく
  `~/.banto/hooks/track-hook.mjs` と banto-track のスキルもで、**Claude Code はそのフックを次の依頼から
  (どのフォルダでも) 自動で動かします**。`settings.json` は人が ok した `track install` / `uninstall` のときしか書かない。
  命令の入れ先は Drive を共有している人なら書けるが、**番頭の署名が合うものしか自動では入れない**
  (下の「道具の署名」)。残る信頼の先は秘密鍵を持つ人 (= deploy する人)。止め方は
  `~/.banto/config.json` の `"autoUpdate": false`。`track install` は `--yes` でもこの危険と切り方を必ず出す
- **中身が届いたときにも入れてよいかを決め直す** (`tickUpdate`)。頼んでから届くまで何時間も空くので、その間に
  `autoUpdate: false` にした・戻した人の道具を入れ替えない。`rollback` は置いたままの確認を捨てる
- **命令のついでの確認は待たない** (`tickUpdate`)。Claude Code の Bash は2分で打ち切るので、版を尋ねる命令を
  置いて `config.json` の `pendingUpdate` に覚え、返事は次に呼ばれたときに拾う。24時間返らなければ捨てる。
  待つのは人が頼んだ `agent update` だけ
- **届いた中身は書く前に丸ごと確かめる** (`checkFiles`)。外を指す名前・字でない中身・`agent.mjs` /
  `track/hook.mjs` / `track/update.mjs` / `track/track.mjs` / `track/local.mjs` (`REQUIRED_FILES`) の欠けが1つでも
  あれば、控えも取らずに全体を断る。名乗った指紋と合っていても通さない (空の中身でも指紋は合う)。
  **`agent.mjs` が読み込むファイルを足したら `REQUIRED_FILES` にも足す** (欠けると起動時に落ち、`update rollback` もできない)
- **道具の署名** (`kitSignature_` / `verifyKit`)。秘密鍵は `$BANTO_SIGNING_KEY` か
  `~/.config/softbanto/kit-signing-key.pem` にだけ置き、**リポジトリにも Drive にも番頭にも置かない**。
  `npm run deploy` が送る直前に手元で中身に署名し、**署名と、署名した版・中身の指紋だけ**を
  `src/KitSigning.gs` (`KIT_SIGNATURE_`。記録しない) に書く。番頭は記録が今の版と中身に合うときだけ返す
  (版を上げて送り直さなければ空になり、手元の道具は知らせるだけになる)。
  作るのは `node scripts/kit-key.mjs` (公開鍵は `kit/track/kit-key.pem`)。
  **鍵が無いと deploy は断る。** 承知で送るなら `--no-sign`。公開鍵と組が合わないときも断る。
  **秘密鍵を失うと**、利用者は zip を落とし直すまで自動で新しくならない。作り直しは `--rotate`。
  確かめる鍵は必ず今入っている道具のもの (最初は落とした zip のもの)。届いた中身の鍵では確かめない
- **信頼の起点は「秘密鍵を持つ人 (deploy する人)」。** スクリプトを開ける人が `KIT_FILES` を書き換えても
  署名は合わない。以前 (1.8.0 を配った @151 まで) は番頭が秘密鍵を持って署名していたので、**それより前の
  版のスクリプトには秘密鍵が残っている**。スクリプトを他の人と共有する前に `--rotate` を検討する
- **自動では古い版に戻さない** (`compareVersions`)。署名が本物でも、前に配った返事を流し直されうる。
  `config.kitVersion` より古いものは自動では断る。戻すのは人が頼む `update rollback` だけ
- **版の字は Claude が読む。** `kitVersion` の返事には署名が無いので、記録 (`update-log.json`) と合図
  (`hook.mjs` の `describeLog`) には `^[0-9A-Za-z.+-]{1,32}$` に合う字だけを出す。変わったファイルの名前も
  同じく絞り、20件までにする
- **記録が無い・合わないときも `kitFiles` は落とさない** (`kitSignature_` は空を返す)。落とすと全員が
  中身を受け取れなくなる
- **署名する文の式も2か所にある** (`kitSignedText_` と `kitSignedText`)。`test/kit-signing.test.js` が揃っているかを見ている
- **指紋の式は2か所にある** (`kitPrint_` と `kitPrintOf`)。片方だけ変えると、手元が毎日入れ替えを繰り返す。
  `test/kit-update.test.js` の「番頭の kitPrint_ と同じ値になる」が見ている
- 誰の道具が古いかは**スクリプトプロパティ** (`KIT_PRINT:<email>`) に覚える。手元からの命令は持ち主の
  トリガーで走るので、利用者本人の UserProperties には書けない
- `kit/track/hook.mjs` は ~/.banto/hooks に写して単体で動かす。**ほかのファイルを import しない**
- **自分の様子を見る命令 (`homeMine` / `homeAdvice` / `reportDraft` / `workStyle`) は、命令を置いた人 (`by`) から見た様子を返す**
  (`commandBy_`。分からなければ断る。持ち主と最後に書いた人が食い違えば断る `commandPersonOf_`)。**`by` は誰の
  見え方かを決めるだけで、権限の仕組みではない。** 結果は queue に置かれ、共有している人なら誰でも読める (台帳と
  同じ中身)。画面の `api*` を呼ばない (トリガーは持ち主の権限で走るので、持ち主のぶんが返る)
- **`kit/track/local.mjs` の `searchFilter` / `reportFill` は画面の写し**、`KIT_VERSION` は `AGENT_KIT_VERSION()` の写し。
  `test/kit-commands.test.js` が揃っているかを見ている (版を上げるときは2か所)。`doctor` は番頭に何も頼まない
- **`style` (命令 `workStyle`) の手伝い方の言葉は番頭の `WORK_STYLE_AXES()` の `support` が本体。** スキル `banto-style` の表は
  それを具体的な動きにしたもので、食い違ったら返事の行に従うと書いてある。極を足したら表にも足す
  (`test/kit-commands.test.js` の「番頭の軸と極を全部挙げている」が見ている)。返事は囲いに入れて出す (VIEWS)
