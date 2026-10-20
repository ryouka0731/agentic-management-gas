# SoftBanto（そふと番頭） / 通称 番頭

主に代わって帳面をつけ、段取りをし、確認を取り次ぐ——番頭の役どころから名前を取っている。
リポジトリ名 `agentic-management-gas` は開発上の呼び名としてそのまま残してある。

Google Workspace の文書（Docs / Sheets / Slides）に、Git 相当の版管理を与える Google Apps Script
の Web アプリ。文書を直接なおさず、コピー（改訂版）で直し、確認を経て正式版に反映する。誰がいつ
何を変えたかが残り、いつでも前の状態と見比べられる。やること（タスク）・進捗ボード・工程表・
報告の相談板も同じ画面にある。

- **誰のためのものか** — 規程や手順書を扱う総務・人事など、Git を知らない人。画面に Git の言葉は出さない
- **どこで動くか** — 1つの Apps Script を置き、Web アプリの URL を配る。文書・履歴・台帳はすべて Drive 側にあり、
  このリポジトリには入らない
- **外に出ない** — 外部 API も公開エンドポイントも使わない。手元（Claude / Codex）からの操作も Drive の同期に乗せる

詳しい説明は **[使い方の手引き (docs/manual/)](docs/manual/README.md)** にある。

## できること

| | 内容 | 手引き |
|---|---|---|
| 文書の版管理 | 変更の記録・履歴・左右2列の差分・改訂版・3つを見比べる反映・Docs への書き戻し | [文書と確認依頼](docs/manual/documents-and-reviews.md) |
| 確認依頼 | 複数の文書とコードの差分を1つにまとめて承認・反映。正式版は直接なおせない | [文書と確認依頼](docs/manual/documents-and-reviews.md) |
| やること | 一覧・進捗ボード・工程表・集計・親子・工数・タグ・下書き・Google ToDo | [やること](docs/manual/tasks.md) |
| ホーム | あなたの番・改善のヒント・草・最近の動き・チームの前進・ポイントとレベル (既定オフ) | [ホームとポイント](docs/manual/home-and-game.md) |
| 要望・不具合 | 誰でも読めて返信できる相談板。持ち主のやることに自動で積まれる | [要望・不具合](docs/manual/inquiries.md) |
| 期間で進める | スプリント・バーンダウン・ベロシティ・困りごと (既定オフ) | [期間で進める](docs/manual/scrum.md) |
| 人と工数 | 上下関係・表示名・頭数で割る工数 | [人と工数](docs/manual/people-and-effort.md) |
| 使われ方 | どこが押され、どの画面が開かれたか。前の期間との比較・曜日・CSV | [使われ方](docs/manual/usage.md) |
| 設定 | 自分の設定とチームの設定 (`PREFS_SCHEMA()` の全項目) | [設定](docs/manual/settings.md) |
| 手元から動かす | Drive 上のコマンドキューと、配る道具 (`agent.mjs`) | [コマンドキュー](docs/manual/command-queue.md) / [手元の道具](docs/manual/agent-kit.md) |

対応するファイル: Docs と Sheets は閲覧・履歴・差分・改訂版・反映まで。Slides は閲覧・履歴・差分のみで、
反映は確認依頼を出す時点で断る。

## 言葉の対応

画面とメールと記録に残る文は、右の Git の言葉を使わない。このリポジトリのコードとこの README には
Git の言葉が出てくるので、読み替えに使ってほしい。

| 画面の言葉 | Git でいうと | 意味 |
|---|---|---|
| 正式版 | main | いま効力を持つ版。直接なおせない |
| 改訂版 (改訂中の版) | ブランチ | 正式版をコピーして直している途中の版 |
| 変更の記録 | コミット | ある時点の中身を丸ごと残したもの |
| 確認依頼 | プルリクエスト | ある版を別の版に反映してよいか尋ねるもの |
| 反映 | マージ | 承認された中身を反映先へ書き戻すこと |
| やること | Issue | 誰かがやるべき作業 |
| 進捗ボード | Projects (カンバン) | やることの列 (これから / 作業中 / 確認中 / 完了) |

スクラムまわりの言葉 (作業期間 = スプリント など) は [期間で進める](docs/manual/scrum.md) にある。

## はじめに

最初の一人だけが行う。二人目からは配られた URL を開くだけ。詳しくは [置き方](docs/manual/setup.md)。

```bash
npm ci                                   # テストの依存 (package-lock.json は消さない)
clasp login
clasp create-script --type standalone --title "SoftBanto" --rootDir src
clasp push --force
```

1. GAS エディタで **`setupRepo()`** を一度だけ実行する。スクリプトと同じフォルダに入れ物
   `agentic-management/` (`main/` `branches/` `.git/`) と台帳のスプレッドシートができる
2. 手元から動かすなら **`setupCommandQueue()`** も一度だけ実行する (1分ごとのトリガー。1日1回の片付けも載っている)
3. 初回のデプロイを作り、その ID を `deployment.json` に書く。以後は **`npm run deploy -- "何を変えたか"`**
   だけを使う (`clasp create-deployment` を直に叩くと URL が変わる)。先に一度 `node scripts/kit-key.mjs` で
   道具に付ける署名の鍵を作る。**署名の秘密鍵は deploy する人の手元にだけある** (リポジトリにも Drive にも
   番頭にも置かない)。失ったときや、古い版のスクリプトを人と共有する前は `--rotate` で作り直す
   ([管理](docs/manual/admin.md#道具の署名の鍵))
4. 管理したい文書を Drive で `agentic-management/main/` に入れ、画面の **「文書」→「文書を登録する」** で選ぶ

スクリプトプロパティや fileId を人に触らせることはない。

## 開発

```bash
npx vitest run --testTimeout=30000   # 全テスト (疑似GAS・jsdom を含む。数分かかる)
npm run test:watch
npm run coverage
npm run deploy -- "何を変えたか"     # kit/ の焼き直し → 署名 → clasp push → 同じ ID へ差し替え
```

- ランタイムコードに `import` / `export` / `require` を書かない (GAS で動かなくなる)。テストは
  `test/harness.js` が `node:vm` でソースを評価する
- 配る道具の本体は `kit/`。`src/KitFiles.gs` は手で直さない
- 守るべき決めごととその理由は **[CLAUDE.md](CLAUDE.md)** にまとめてある。構成とテストの詳細は
  [開発の手引き](docs/manual/development.md)

## 制約

- GCP プロジェクトは使えないので `clasp run` (Apps Script API) は使わない。手元からの操作はコマンドキュー経由
- 外部 API・公開エンドポイントは使わない。Drive の拡張サービス (v3) は `appsscript.json` で足してある。
  Google ToDo 連携だけは、エディタで Tasks の拡張サービスを足したときに入口が出る
- 色・フォント・文字サイズは版管理の対象外 (意図的な割り切り)。全角スペースによる字下げも正規化で失われる
- Drive のネイティブな版の履歴は取れないので、独自の記録 (`.git/objects/`) を持つ
- 手元からの命令は最大1分遅れる (時間主導トリガーの最小間隔)

設計の経緯は [これまでとこれから](docs/manual/roadmap.md) と `docs/superpowers/` にある。
