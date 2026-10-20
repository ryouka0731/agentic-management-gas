# 開発

[手引きの目次](README.md)

守るべき決めごとと、それぞれの理由 (実際に踏んだ不具合) は [CLAUDE.md](../../CLAUDE.md) にある。手を入れる前に読むこと。
この頁は構成と手順の地図である。

## 進め方

- `docs/superpowers/specs/` の設計と `docs/superpowers/plans/` の計画に沿って、`feat/<名前>` ブランチで作業する
- テストが通ってから確認依頼 (プルリクエスト) を出し、bot のレビューの指摘を片付けてから main に入れる
- 複数のセッションが並行して触ることがある。作業前に `git rev-parse --abbrev-ref HEAD` と `git status` を確かめる
- `git push origin <名前>` のあとは `git log --oneline -1 origin/<名前>` で着いたことを確かめる
- 確認依頼の本文には「確かめていないこと」の節を置く (疑似GASでは示せない実機の動き・目で見る確認など)

## 約束を止める仕掛け

### Claude Code のフック

`.claude/settings.json` が、Claude Code の道具を使う前 (PreToolUse) に `scripts/guard-hook.mjs` を走らせる。
次のものを止め (exit 2)、理由を返す。テストは `test/guard-hook.test.js`。

| 止めるもの | 理由 |
|---|---|
| `git push origin <名前>` で、<名前> がいま居るブランチ (入力の cwd で見る) でない手元のブランチ | 居るブランチは送られない。`git push -u origin HEAD` を使う |
| `clasp create-deployment` / `clasp deploy` を `-i` / `--deploymentId` 無しで | 新しいデプロイができて URL が変わる。`npm run deploy` を使う |
| `src/KitFiles.gs` / `src/KitSigning.gs` を手で書く (Edit / Write、シェルの `>` / `sed -i` など) | scripts が作るもの。`node scripts/build-kit.mjs` と `npm run deploy` は通る |
| 署名の秘密鍵 (`~/.config/softbanto/kit-signing-key.pem` / `$BANTO_SIGNING_KEY`) を読む・書く | 鍵は `scripts/deploy.mjs` だけが読む |

`&&` / `;` / `|` でつないだ命令は1つずつ見る。push と clasp は、読み取れない形なら通す (止めすぎると使えない)。
生成物と鍵は、迷ったら止める側に倒す。`.claude/settings.local.json` は各自のもので、記録しない。

### 秘密の混入を探す

```bash
npm run secrets
```

`trufflehog git file://. --results=verified --fail` を走らせ、git の履歴全体から**本物と確かめられた**秘密だけを
探す (見つかると 183 で終わる)。trufflehog は入れていない人が多いので、無ければ `brew install trufflehog` を
案内して 0 以外で終わる。公開鍵 `kit/track/kit-key.pem` は確かめられる秘密ではないので、除外の設定は置いていない。
CI には載せていない (手元で、送る前に走らせる)。

## ファイルの構成

```
src/
├── appsscript.json        Web アプリの設定・拡張サービス・oauthScopes
├── Main.gs                doGet・include・エディタで一度だけ実行する setup*・持ち主の確かめ (assertOwner_)・1日1回の片付け (housekeepArchiveDaily_)
├── Debug.gs               エディタ用の確かめ (debug*) とその手伝い
├── api/                   画面から呼ぶ api* (Files / Commit / Pr / Outbox / Issue / Inquiry / People / Home / Settings / Scrum)
├── KitFiles.gs            配る道具の中身 (kit/ から焼き直す。手で直さない)
├── KitSigning.gs          道具の署名 (deploy のときに作る。git に記録しない)
├── core/                  中身の処理
├── render/                Docs / Sheets / Slides と正規化 HTML の行き来
└── ui/                    wiki.html (部品) / app.js.html と js-*.html (動き。1つの関数を場所ごとに分けたもの) / app.css.html (見た目)
kit/                       配る道具の本物 (agent.mjs・説明・track/・スクラムのスキルとひな形)
scripts/                   build-kit.mjs (焼き直し) / deploy.mjs / kit-key.mjs (署名の鍵) / guard-hook.mjs (Claude Code のフック)
test/                      vitest。harness.js・fakegas.js (疑似GAS)・dom.js (jsdom の画面)
docs/manual/               この手引き
docs/superpowers/          設計 (specs) と計画 (plans)
deployment.json            差し替える先のデプロイ ID
```

### `src/api/`

画面の `google.script.run` から呼ぶ `api*` を、扱うものごとに分けて置いている。中身の処理は `src/core/` に任せ、
ここでは権限の確かめと画面に渡せる形への変換 (`Plain.js`) だけを行う。GAS は全ファイルを同じグローバルに読むので、
ファイルを分けても呼び方は変わらない。**ファイルを足したら `test/sources.js` の `API_SOURCES` にも足す**
(`test/sources.test.js` が src の並びと食い違っていないかを見ている)。

### `src/core/` と `src/render/`

`.js` はピュアな関数 (GAS に依存しない) で、vitest で直接試せる。`.gs` は GAS のサービスに依存し、疑似GASで試す。

| ファイル | 役目 |
|---|---|
| `Hash.js` / `HashGas.gs` | 中身の指紋 (sha) |
| `Normalize.js` | 正規化 HTML とブロックの行き来。**出力を変えると履歴が壊れる** |
| `Diff.js` / `Merge.js` | 行ごとの差分 (Myers) と3つを見比べる反映 |
| `Markdown.js` / `MarkdownView.js` | 正規化 HTML と Markdown の行き来 / やりとりなどの Markdown 表示 |
| `Graph.js` | 記録の系統図 |
| `FileUrl.js` | 元のファイルへのリンク |
| `Plain.js` | 画面に渡す値の変換 (`plainText` / `plainDate` / `plainDay` / `plainNumber` / `plainId` / `plainTalk`) |
| `Brand.js` | 名前 (`APP_NAME()`) |
| `Staleness.js` / `Archive.js` | 「動きなし」の段階 / 捨てたものの保持日数 |
| `IssueTree.js` / `Grouping.js` / `Gantt.js` / `Tally.js` | やることの親子 / まとめ方 / 工程表 / 集計 |
| `Mention.js` | `@名前` |
| `ScrumView.js` | 残りの量の推移・期間ごとに終えた量を台帳から数える |
| `Db.gs` | 台帳 (`DB_SCHEMA()`・鍵・番号) |
| `Repo.gs` / `ObjectStore.gs` | 入れ物・持ち主と管理者・文書の登録 / `objects/` |
| `Commit.gs` / `Branch.gs` / `PullRequest.gs` / `PullPatch.gs` | 記録 / 改訂版 / 確認依頼と反映 / コードの差分 |
| `Issue.gs` / `IssueBranch.gs` / `IssueComment.gs` / `Project.gs` | やること / やることから改訂版 / やりとり / 進捗ボード |
| `Tag.gs` / `Template.gs` / `Member.gs` / `GoogleTasks.gs` | タグ / 下書き / 人と上下関係 / Google ToDo |
| `Inquiry.gs` / `Notifier.gs` | 要望・不具合 / 知らせとメール |
| `Home.gs` / `Motivation.gs` / `Game.gs` / `Search.gs` | ホーム・改善のヒント・日報 / 前進 / ポイント / 横断検索 |
| `Usage.gs` / `Prefs.gs` / `Settings.gs` | 使われ方 / 設定の一覧 / 期間で進めるの設定 |
| `Scrum.gs` | 作業期間・困りごと・変更の履歴 |
| `CommandQueue.gs` / `Outbox.gs` / `AgentKit.gs` | コマンドキュー / 頼みごと / 道具の zip と署名 |
| `render/DocRenderer.gs` / `HtmlWriter.gs` | Docs → 正規化 HTML / 書き戻し |
| `render/SheetRenderer.gs` / `SheetWriter.gs` | Sheets → 正規化 HTML / 書き戻し |
| `render/SlidesRenderer.gs` | Slides → 正規化 HTML (読むだけ) |
| `render/LiveCache.gs` | いまの層のキャッシュ |

#21 が入ると `Terms.js` (スクラムの言葉の対応) が加わる。

## テスト

```bash
npx vitest run --testTimeout=30000   # 全部 (jsdom の画面のテストを含み、数分かかる)
npx vitest run test/merge.test.js    # 1ファイルだけ
npm run test:watch
npm run coverage
```

| 対象 | 方法 |
|---|---|
| ピュアな `.js` | vitest で直接 |
| GAS に依存する `.gs` | `test/fakegas.js` の疑似GAS (DriveApp / SpreadsheetApp / PropertiesService / Session / LockService / Utilities など) で通しの統合テスト |
| 画面 | `test/dom.js` で jsdom に画面を組み、実際に押す (`test/component/*.test.js` など。組む口は `test/component/mount.js`) |
| Docs / Slides の描画の忠実さ | 実機の `debug*` ([実機で確かめる](verification.md)) |

- ランタイムコードに `import` / `export` / `require` を書かない。`test/harness.js` の `loadGas` / `loadGasWith` が
  `node:vm` でソースを評価し、定義された関数を取り出す (filename は絶対パスで渡す。相対だとカバレッジが 0% になる)
- GAS は全ファイルを同じグローバルに読む。あるファイルが別のファイルの関数を呼ぶなら、テストの `SOURCES` にも足す
- サーバと画面の両方にある関数 (`fileUrlOf` / `diffPairs` / `ganttLayout` など) は `test/ui-parity.test.js` が同じ答えを返すかを見る
- `test/e2e-journey.test.js` は何も仕込まずに人がたどる順で通す。`setup()` を使わない
- 直したら、直す前に戻して落ちることを確かめる (落ちないテストは何も守っていない)
- `test/docs.test.js` がこの手引きの命令の一覧・設定の一覧・リンク切れを見ている。`COMMAND_OPS()` や `PREFS_SCHEMA()`
  を変えたら、[コマンドキュー](command-queue.md) と [設定](settings.md) も直す

依存を入れ直すときは `package-lock.json` を消さない (`npm ci`)。`vitest` と `@vitest/coverage-v8` は `^` 無しの同じ版に揃える。

## 画面を書くときの決まり (抜粋)

- UI は `textContent` だけで組み立てる。`innerHTML` は使わない (他人が書いた文書・やりとりを表示するため)
- サーバを呼ぶのは `call()` だけ。失敗の見せ方は `failSnack` / `failInto` / `failEnable` / `failQuiet` に寄せる
- 画面へ返す値は `plain*` を通す (Date が混ざると画面に `null` が届く)。api を足したら `test/phase4-edit.test.js` の
  「画面に渡せる形か」に足す
- CSS は既存のトークン (`--ink` / `--ink-2` / `--line` / `--bg` / `--bg-2` / `--accent` など) だけを使う
- 図は Mermaid などを持ち込まず `makeDiagram(spec)` でその場で描く。使い方の節の `id` は変えない

詳しくは [CLAUDE.md](../../CLAUDE.md)。

## 配る道具を直す

1. `kit/` の本物を直す (`src/KitFiles.gs` は手で直さない)
2. `src/core/AgentKit.gs` の `AGENT_KIT_VERSION()` と、`kit/track/local.mjs` の `KIT_VERSION` を上げる (2か所)
3. `node scripts/build-kit.mjs` で焼き直す (`npm run deploy` も自動で走らせる)。`test/agentkit.test.js` が `kit/` と
   焼き直したものの一致を見ている
4. `agent.mjs` が読み込むファイルを足したら、自動更新の `REQUIRED_FILES` にも足す
5. スキル (`kit/.claude/skills/`) を直したら、版を上げる前に、何も知らない Claude (別のセッションやサブエージェント) に
   実際にありそうな頼み方で走らせ、思った通りに動くかを確かめる

中身をそのまま GAS の HTML ファイルとして置かない (`<id>` がタグと読まれて壊れる)。base64 にして `KitFiles.gs` に入れている。

## デプロイ

```bash
npm run deploy -- "何を変えたか"
```

焼き直し → 署名 → `clasp push -f` → `deployment.json` の ID へ差し替え、の順。`clasp create-deployment` を直に叩かない
(URL が変わる)。詳しくは [置き方](setup.md#5-デプロイ)。

- 新しい GAS のサービスを使ったら `appsscript.json` の `oauthScopes` に足す (足し忘れると、例外を握ったまま黙って動かない)
- 台帳の列は `DB_SCHEMA()` の末尾に足す。途中に挿むと既存の行が1つずつずれる。既にある行の空欄をどう読むかも決める
