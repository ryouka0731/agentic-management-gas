# agentic-management-gas

Google Workspace の文書（Docs / Sheets / Slides）に Git 相当の版管理を与える
Google Apps Script プロジェクト。設計は `docs/superpowers/specs/` を参照。

## 触る場所と、先に読むファイル

このファイルには、ほぼ毎回の変更に効く決まりだけを置いてある。場所ごとの決まり (と、それぞれ実際に踏んだ例) は
`docs/dev/` に分けた。**下の場所を直す前に、対応する `docs/dev/` のファイルを必ず読むこと。** 読まずに直すと、
過去に一度踏んで直した不具合をもう一度作る。2つ以上に当たるときは全部読む。

| 触る場所 | 先に読むファイル |
|---|---|
| 番号を振る・鍵を取るところ (`src/core/Db.gs` の `dbAppendNumbered` / `dbWithLock_` / `dbUpdate` / `dbDelete`、`src/core/Issue.gs` の `issuePurge`、`src/core/Project.gs`、`src/core/Notifier.gs` の `noticeAdd`) | `docs/dev/locks-and-numbering.md` |
| 台帳の列 (`DB_SCHEMA()`)・`priority` / `ISSUE_PRIORITIES()`・`src/core/Usage.gs` (`usageRecord`) | `docs/dev/ledger-schema.md` |
| `src/core/PullRequest.gs` / `src/core/Branch.gs` / `src/core/Commit.gs` / `src/core/Merge.js` / `src/api/Pr.gs` / `src/api/Commit.gs` (確認依頼・反映・反映先・main の保護) | `docs/dev/changeset-and-merge.md` |
| `src/core/PullPatch.gs` / `src/core/Outbox.gs` / `src/api/Outbox.gs` | `docs/dev/outbox-and-patches.md` |
| `src/core/CommandQueue.gs` (`processCommandQueue` / `setupCommandQueue`) | `docs/dev/command-queue.md` |
| `kit/` / `scripts/build-kit.mjs` / `scripts/kit-key.mjs` / `scripts/deploy.mjs` の署名 / `src/core/AgentKit.gs` / `src/KitFiles.gs` / `src/KitSigning.gs` | `docs/dev/kit.md` |
| `src/core/Scrum.gs` / `src/core/ScrumView.js` / `src/core/Terms.js` / `src/api/Scrum.gs` / `src/ui/js-scrum.html` | `docs/dev/scrum.md` |
| `src/ui/*.html` の JS (`app.js.html` / `js-*.html` / `wiki.html`)・`src/core/Plain.js`・`api*` の返す形 | `docs/dev/ui.md` |
| `src/ui/app.css.html`・`makePill`・`makeDiagram`・ボタンや一覧の幅 | `docs/dev/design.md` |
| 末尾が `_` でない関数を足す・`src/Main.gs` / `src/Debug.gs`・持ち主と管理者 (`src/core/Repo.gs` / `src/core/CurrentUser.gs` / `src/core/Member.gs`)・人に関わる数 (`src/core/Game.gs` / `src/core/Home.gs` / `src/core/Search.gs` / `src/core/Focus.gs`)・仕事のスタンス診断 (`src/core/WorkStyle.gs` / `src/core/WorkStyleTypes.js` / `src/api/WorkStyle.gs`) | `docs/dev/permissions.md` |
| 目標 (`src/core/Goal.gs` / `src/core/GoalScore.js` / `src/api/Goals.gs` / `src/ui/js-goals.html`) | `docs/dev/permissions.md` と `docs/dev/ledger-schema.md` (画面は `docs/dev/ui.md`) |
| `src/core/Prefs.gs` (`PREFS_SCHEMA()`)・`notify` の kind・`src/api/Settings.gs` | `docs/dev/prefs.md` |
| 登録・外す・取り下げ・消えた文書の扱い (`src/api/Files.gs` / `prClose` / `filesVisibleInWiki` / `prWithdrawOrphans`) | `docs/dev/user-paths.md` |
| `src/render/` の書き戻し・`src/core/Markdown.js`・台帳への書き方 (`dbCell_`)・Drive のファイルを動かすところ・工数の数え方・並び順 | `docs/dev/pitfalls.md` |
| テストの依存 (`package.json` / `package-lock.json`)・カバレッジ・`test/harness.js` / `test/setup.js` / `test/dom.js` / `test/component/` | `docs/dev/testing.md` |
| `debug*` (実機検証の入口) を足す・直す | `docs/dev/verification.md` |

## 名前

人に見せる名前は **SoftBanto（そふと番頭）**、通称 **番頭**。リポジトリ名
`agentic-management-gas` は開発上の呼び名としてそのまま残してある。

**Drive のフォルダ名だけは `agentic-management` のまま**にしてある。既に動いて
いる実体をリネームする必然性がなく、変えると画面やドキュメントが指す先と
食い違う。設定はフォルダ ID で持っているので、名前は表示以外に効かない。

名前はタブ・通知メールの件名・配る道具の3か所に出る。`test/naming.test.js` が
揃っていることを固定している。**片方だけ直すと、食い違ったまま気づかれない。**

## Git の言葉を人に見せない

| この道具 | Git でいうと |
|---|---|
| 正式版 | main |
| 改訂版 | ブランチ |
| 変更の記録 | コミット |
| 確認依頼 | プルリクエスト |
| 反映 | マージ |
| やること | Issue |

**画面だけ日本語にしても足りない。** メールの件名・画面の中の知らせ・**変更の
記録に残る文**も人が読む。実際に件名10件と記録の文が「PR」「マージ」のままに
なっていた（`'マージ: PR #12 …'` が履歴に残っていた）。

`test/naming.test.js` の「Git の言葉を人に見せない」が、コメントを除いた
`Notifier.gs` の全文と、`src/` のすべての `.gs` と `src/core/*.js` (配る道具の中身
`KitFiles.gs` と、エディタ専用の `debug*` / `setup*` を除く) の断り文 (`new Error`) と
変更の記録の文 (`commitFile` の3つ目) を走査している。**断り文を変数に入れてから
渡すと追えない** (`msg` / `message` / `reason` という名前の変数だけは拾う)。

手元の道具の「よく出る断り」の表は `kit/AGENTS.md` と `docs/manual/agent-kit.md` の
2か所にある。断り文を言い換えたら両方を直す (`test/docs.test.js` が、表の字が実際に
出るかと、2つの表が揃っているかを見ている)。**断り文 (`new Error(...)` の字) も人が読む**
(画面の帯と手元の結果にそのまま出る)。`test/naming.test.js` が `src/` のすべて (`Main.gs` / `src/api/*.gs` / `PullRequest.gs` / `Branch.gs` など) の断り文を、
コメントと `debug*` を除いて走査している。名前そのものを指すときは「main」と括る。

**件名の接頭辞 `[SoftBanto]` は動かさない。** 受信側の振り分けはそこを見ている
ので、言葉を直すときに一緒に動かすと既存のルールが全部外れる。

## この設計の中核

**すべてを正規化 HTML に変換し、それを blob として扱う。**
同じ内容からは常にバイト単位で同一の HTML が出ることが、行ベース diff と
3-way merge が成立する前提になっている。

### 出力を変えてはいけない

`src/core/Normalize.js` の `serializeBlocks` の出力を変えると、**過去の全コミットの
blob と食い違い、履歴が壊れる**。語彙を増やすときは既存の出力形に触れないこと。

Phase 3a で Sheets を足したときは、Docs の `<table>` は属性なしのまま残し、
Sheets を `<table data-sheet="名前">` という別形にした。

**一度だけ、壊れていたので意図して変えた。** 空白の正規化を run ごとに当てて
いたため、装飾の境目の空白が消え、書き戻すと文書から空白が消えていた
（'Hello ' + 太字 'world' → 'Helloworld'）。段落ごとの正規化に改めた。以前の記録
とは中身が同じでも食い違うので、移行の仕掛けを入れてある。**外さないこと。**

- `legacySpacingHtml` が両側を「空白の扱いを比べない形」にそろえる。等しければ
  違いは空白の扱いだけ
- 反映のとき、反映先・改訂版が空白の扱いだけ未記録なら自動で記録し直す
  (`prRecordSpacingOnly_`)。何も編集していない人に退避を押させないため
- その記録では承認を古くしない (`commitOnlySpacing_`)
- 起点が以前の形でも、同じ中身の行に置き換えてから見比べる
  (`prUpgradeBaseSpacing_`)。そのまま見比べると、相手が直した段落が偽の食い違い
  になる

同じく Slides も、グループの中の図形と表の字を拾うように変えた（読むだけで書き
戻さないので、壊れるものは無い。図形しか無いスライドの出力は変わらない）。

**変えるなら、以前の記録との見比べ方を先に決める。** 決めずに変えると、全部の
文書が「記録していない変更あり」になり、反映が止まる。

### Block 型と装飾のネスト順

```
run:  {text, bold?, italic?, underline?, strike?, link?}
順序: bold → italic → underline → strike → link (外側から)
```

`Normalize.js` の `serializeRuns_` と `Markdown.js` の `runsToMd_` は
**この順序で対称でなければならない**。崩すと往復が壊れる。

## テストの構成

| 対象 | 方法 |
|---|---|
| ピュアな `.js` (Hash / Normalize / Diff / Merge / Markdown / FileUrl) | vitest で直接 |
| GAS 依存の `.gs` | `test/fakegas.js` の疑似GASで統合テスト |
| 画面 → api* → 台帳 → 画面 の通し | `test/e2e/fullstack.js` (画面は `test/dom.js` で組み、返事は本物のサーバが返す) |
| DocumentApp / SlidesApp の描画忠実性 | 実機の `debug*` 関数 |

`test/harness.js` の `loadGas` / `loadGasWith` が `node:vm` でソースを評価する。
**ランタイムコードに `import` / `export` / `require` を書かない**（GAS で動かなくなる）。

### GAS は全ファイルを同じグローバルに読む

あるファイルが別のファイルの関数を呼ぶとき、**テストの SOURCES にも同じ集合を
揃える必要がある**。`PullRequest.gs` に通知を足したとき、Phase 2 のテストが
`Notifier.gs` を読んでおらず `notifyPrCreated is not defined` で11件落ちた。

**読み込む並びは `test/sources.js` にだけ置く** (`ISSUE_SOURCES` / `CORE_SOURCES` /
`API_SOURCES` / `APP_SOURCES` / `KIT_SOURCES`)。テストに並びを手で写さない。以前は
30〜40件の並びが10か所以上に写されていて、ファイルを足すたびに直し漏れた。
`test/sources.test.js` が、`src/*.gs` と `src/api/*.gs` が `API_SOURCES` に全部あるか、
同じ名前の関数が2つのファイルに無いか (後に読んだほうが黙って勝つ) を見ている。

画面から呼ぶ `api*` は `src/api/<扱うもの>.gs`、エディタ用の `debug*` は `src/Debug.gs`、
`doGet` / `include` / `setup*` / `assertOwner_` / `housekeepArchiveDaily_` は `src/Main.gs` に置く。

### 落ちることを確かめる

**直したら、直す前に戻して落ちることを必ず確かめる。** 落ちないテストは
何も守っていない。この方法で「空の状態のボタンで落ちる」「起点の選び方を
逆にすると条文が消える」「一覧の幅が 320px 固定」を実際に捕まえている。

## 破壊的操作の前には必ず検証する

書き戻しは `body.clear()` / `sheet.clear()` を伴う。**検証してから消す**。

- Docs: `htmlWriterValidate(blocks)`
- Sheets: `sheetWriterValidate(blocks)`
- 実体を取得できない画像 (`sha === 'unavailable'`) は書き戻すと永久に失われるため、
  マージ自体を拒否する

## 番号と鍵 (要点)

番号を決めることと書くこと、「あるか見てから書く」、`dbUpdate` / `dbDelete` は、どれも1つの鍵の中で行い、
鍵は `dbWithLock_` 以外で取らない (`LockService` を直に呼ぶのはそこだけ)。鍵は短く持ち、関係の無い Drive の一覧や
時間のかかる処理を相乗りさせない。一度出した番号は二度出さず、消すときはぶら下がっているものも全部消す。
知らせは本処理を巻き戻さない。理由と実際に踏んだ例は `docs/dev/locks-and-numbering.md` にある。

## サーバを呼ぶのは `call()` だけ

**`google.script.run` を直に書かない。** 失敗ハンドラを付け忘れると失敗が
完全に黙り、その画面だけが「押しても何も起きない」になる。`call(name, args,
onOk, onFail)` は `onFail` を省くと短い帯で知らせる。

失敗の見せ方は4つに寄せてある。**新しい見せ方を増やす前に、既にあるもので
足りないかを考えること。**

| | いつ使うか |
|---|---|
| （省略） | 既定。短い帯で知らせる |
| `failSnack('◯できませんでした: ')` | 押した操作と結び付けたいとき |
| `failInto(el)` | 一覧そのものが出ないとき。帯は数秒で消えるため後から見た人に伝わらない |
| `failEnable(btn, prefix?)` | 押した間は押せなくしてあるとき。**戻さないと二度と押せない** |
| `failQuiet('理由')` | 出なくても操作は続けられるとき。**理由を必ず書く**。画面には出さないが console には残す |

個別の後始末がある5か所だけは `google.script.run` の連なりのまま残してある。
定型でないものを `call()` に押し込まないこと。

## 画面を組むときの約束

形・色・札・ボタンの決まりは `docs/dev/design.md`。

- **UI は `textContent` のみで組み立てる。`innerHTML` は使わない**。他人が書いた
  文書・コメント・Issue 題名を表示するため
- **CSS は既存トークンのみ** (`--ink` / `--ink-2` / `--line` / `--bg` / `--bg-2` /
  `--accent`)。未定義変数 + フォールバックの形は使わない。
  `[hidden] { display: none !important; }` は定義済み（`display` を持つクラスに
  `hidden` を付けても隠れる）

## デプロイ

```bash
npm run deploy -- "何を変えたか"
```

これは `clasp push -f` してから、**`deployment.json` の ID に対して**差し替える。

**`clasp create-deployment` を直接叩かない。** `-i` を省くと新しいデプロイが
作られて URL が変わり、利用者のブックマークも配ったリンクも死ぬ。差し替える先は
`deployment.json` に入れてあり、手元の記憶に頼らない。

送る前に差し替えると、前の中身のまま版だけが上がる。順番は push → deploy。

**Claude Code のフックが止める** (`.claude/settings.json` → `scripts/guard-hook.mjs`、
テストは `test/guard-hook.test.js`)。`-i` / `--deploymentId` 無しの `clasp create-deployment` /
`clasp deploy`、居るブランチに送っていない記録があるのに別の手元のブランチを名指しした
`git push origin <名前>` (居る場所は入力の cwd で見るので worktree ごとに正しく決まる。わざと送るなら `<名前>:<名前>`)、`src/KitFiles.gs` / `src/KitSigning.gs` を
手で書くこと (シェルはよくある書き方だけを見る)、署名の秘密鍵を読むこと。push と clasp は読み取れない形なら通し、生成物と鍵は
迷ったら止める。止められたら回り道を探さず、理由に書いてある正しい道を使う。

秘密の混入は `npm run secrets` (trufflehog。入っていなければ入れ方を出して止まる) で探す。

## 制約

- **GAS 標準サービスのみ。GCP プロジェクトは使えない**ため `clasp run` は使用不可。
  ローカルからの操作は `.git/queue/` のコマンドキュー経由（`docs/manual/command-queue.md` 参照）
- 外部 API / 公開エンドポイントは使わない
- **拡張サービスは2つだけの例外**: Google ToDo 連携 (`src/core/GoogleTasks.gs`) と
  Drive (v3。共有ドライブの役割を読む `driveMembers_` と、入れ物が共有ドライブかを見る
  `repoDriveId_`)。Drive は `appsscript.json` で足してあるので利用者は何もしない。
  使えないときはマイドライブとして扱う。Tasks は、エディタの「サービス +」から Tasks を足していない環境でも他が壊れないよう、
  `tasksAvailable()` が false のときは画面に入口すら出さない
- 色・フォント・サイズは版管理の対象外（意図的な割り切り）
- Slides はマージ非対応。PR 作成の時点で拒否する

## 作業の進め方

`docs/superpowers/plans/` の実装計画に沿って、`feat/<phase名>` ブランチで作業し、
テストが通ってから main にマージする。

**確認依頼の本文には「確かめていないこと」の節を必ず置く。** 疑似GASでは示せない
実機の動き (Drive・Sheets・Docs の書き戻し、権限、トリガー)、目で見る確認 (画面の
並び・色・狭い画面) など、テストが通っても言えないことを書く。書かないと、通った
テストが「全部確かめた」と読まれる。`.github/pull_request_template.md` にその節がある
(`.github/` は autofix の類が書けないので、整形の対象から外すこと)。

**配る道具のスキル (`kit/.claude/`) を直したら、`AGENT_KIT_VERSION()` を上げる前に
試す。** 何も知らない Claude (新しいセッションかサブエージェント) に、実際にありそうな
頼み方で走らせ、読んだとおりに動くかを見る。書いた本人が読むと、書いていない前提を
補って読んでしまう。

## 並行するセッションと送り方

**このリポジトリは複数のセッションが並行して触ることがある。** 作業前に
`git rev-parse --abbrev-ref HEAD` と `git status` を確認し、身に覚えのない
未コミット変更があれば `git add -A` で巻き込まず、ユーザーに確認すること。

**`git push origin <名前>` は、いま居るブランチではなく、その名前のブランチを
送る。** 居るのが main なのに `git push origin feat/…` と書くと、毎回成功して
何も送られない。実際に45コミットぶん、送ったつもりで送れていなかった。
**送ったあとは `git log --oneline -1 origin/<名前>` で着いたことを確かめる。**
