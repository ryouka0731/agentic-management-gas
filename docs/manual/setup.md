# 置き方

[手引きの目次](README.md)

番頭は「1つの Apps Script を置き、Web アプリの URL を配る」形で使う。リポジトリを配るのではない。
文書・履歴・台帳はすべて Drive 側にあり、各自が `setupRepo()` を実行するとそれぞれの Drive に別々の空の
入れ物ができてしまう。**ここに書く手順は最初の一人だけが行う。** 二人目からは配られた URL を開くだけでよい。

## 1. 手元の用意

- Node.js (テストと deploy に使う) と [clasp](https://github.com/google/clasp) 3.x
- このリポジトリを clone し、依存を入れる

```bash
npm ci
```

`package-lock.json` を消して `npm install` し直さないこと。npm 10.9 には vitest 4 の peer 解決で落ちる不具合がある
(詳しくは [docs/dev/testing.md](../dev/testing.md) の「テストの測り方と、測れないもの」)。

## 2. Apps Script のプロジェクトを作って送る

```bash
clasp login
clasp create-script --type standalone --title "SoftBanto" --rootDir src
clasp push --force
```

clasp 3.x の注意点:

- `--type webapp` は `Invalid container file type` で失敗する。`standalone` で作り、Web アプリにするのは
  `src/appsscript.json` の `webapp` とデプロイで行う
- `clasp create-script` は `src/appsscript.json` を上書きするので、作ったあと git で元に戻す
- `.claspignore` のパターンは `rootDir` (= `src`) から見た相対で評価される。`!src/**` のような書き方は効かない
- マニフェストの変更を含む push には `--force` が要る (対話でないと確認が否定され `Skipping push.` になる)

`src/appsscript.json` には、Drive の拡張サービス (v3) と、使う全サービスの `oauthScopes` (Docs / Sheets / Slides /
Drive / メールアドレス / トリガー / メール送信 / ToDo) が入っている。

## 3. 入れ物を作る (`setupRepo`)

GAS エディタ (`clasp open-script`) で関数の一覧から **`setupRepo`** を選び、一度だけ実行する。

- 初回は Google の「アクセスを承認」が出る。文書・表・スライド・Drive・メールに触るための許可
- **スクリプトと同じフォルダに** 入れ物 `agentic-management/` (`main/` `branches/` `.git/objects/`) ができ、
  台帳のスプレッドシート `agentic-management repo-db` はその `.git/` の中に置かれる。スクリプトの置き場が分からないときだけマイドライブの直下に落ちる
- 二度目の実行は「リポジトリは既に初期化されています」で断る (作り直すと、これまでの記録が見えなくなるため)

## 4. 手元から動かすなら (`setupCommandQueue`)

手元の Claude / Codex から動かす、または1日1回の片付け (捨てたやることの整理・元の文書が消えた確認依頼の
取り下げ) を回すなら、エディタで **`setupCommandQueue`** を一度だけ実行する。1分ごとの時間主導トリガーが
置かれる。二度実行しても増えない (同じ名前のトリガーを先に消してから作る)。

- トリガーは**実行した人の権限で回る**。設定の画面に「誰が動かしているか・最後に回った時刻」が出て、
  1時間より前に止まっていれば引き継ぎ方が出る
- 共有ドライブでは、その人が抜けるとキューが止まる。持ち主 (共有ドライブでは管理者の役割の人) が
  もう一度 `setupCommandQueue()` を実行して引き継ぐ

仕組みは [コマンドキュー](command-queue.md) にある。

## 5. デプロイ

### 署名の鍵を作る (最初に一度)

```bash
node scripts/kit-key.mjs
```

手元の道具 (`agent.mjs`) は1日1回自分を新しくする。そのとき**番頭の署名が合う中身しか入れない**。
この署名の秘密鍵を作るのが上のコマンドで、置き場は `$BANTO_SIGNING_KEY` か
`~/.config/softbanto/kit-signing-key.pem`。**リポジトリにも Drive にも置かない。控えを取っておく。**
公開鍵は `kit/track/kit-key.pem` に書かれ、道具と一緒に配られる。

| | |
|---|---|
| `node scripts/kit-key.mjs` | 鍵が無ければ作る。あれば断る |
| `node scripts/kit-key.mjs --rotate` | 作り直す。今の利用者は道具の zip を落とし直すまで自動で新しくならない |

秘密鍵を失ったときも `--rotate` で作り直す。

### 初回のデプロイと `deployment.json`

最初の一回だけ、Web アプリのデプロイを作る。

```bash
clasp create-deployment --description "初回"
clasp list-deployments
```

出た ID (`AKfycb…`) を `deployment.json` の `deploymentId` に書く。このリポジトリに入っている
`deployment.json` は既存の置き場のものなので、別の場所に置くなら自分の ID に書き換える。

### 2回目から

```bash
npm run deploy -- "何を変えたか"
```

`scripts/deploy.mjs` が次の順で行う。

1. `kit/` を `src/KitFiles.gs` に焼き直す (配る道具の本体は `kit/`)
2. 道具の中身に手元で署名し、署名と版と指紋だけを `src/KitSigning.gs` に書く (秘密鍵は入れない。このファイルは git に記録しない)
3. `clasp push -f`
4. `deployment.json` の ID に対して `clasp create-deployment -i <ID>` で差し替える。**URL は変わらない**

- **`clasp create-deployment` を `-i` なしで直に叩かない。** 新しいデプロイが作られて URL が変わり、
  利用者のブックマークも配ったリンクも使えなくなる
- 秘密鍵が無いと deploy は断る。承知のうえで署名せずに送るなら `npm run deploy -- --no-sign "…"`。
  そのあいだ手元の道具は自動では入れ替わらず、新しい版があることを知らせるだけになる
- 公開鍵 (`kit/track/kit-key.pem`) と秘密鍵の組が合わないときも断る

## 6. 文書を登録する

1. 管理したい文書 (Docs / Sheets / Slides) を、Drive で `agentic-management/main/` にドラッグして入れる
2. 画面の **「文書」→「文書を登録する」** を押す。入れ物の中にあってまだ登録していないものが一覧に出るので、選んで登録する

- スクリプトプロパティも fileId も触らない (`debugRegisterFile()` は開発時の入口として残してあるだけ)
- 同じ道のり (名前) の文書は2つ登録できない。改訂版が別の文書の作業コピーを掴むのを防ぐため
- 間違って登録したものは、文書の行から外せる。外すのは台帳の1行だけで、Drive の文書も記録も消えない。
  改訂版が残っている文書は外せない

## 7. 使う人に配る

`src/appsscript.json` の `webapp` は既定で `"access": "MYSELF"` (持ち主だけが開ける)。ほかの人に使って
もらうには公開範囲を広げてからデプロイする。どう広げるかで何が変わるかは [管理](admin.md#web-アプリの公開範囲) にある。

## 共有ドライブに置くとき

入れ物は共有ドライブにも置ける。マイドライブとの違い:

- **持ち主が無いので**、共有ドライブの「管理者」(`organizer`) 全員を持ち主として扱う。管理者 (= 番頭の
  管理者) は `organizer` / `fileOrganizer` / `writer` の役割の人
- **共有ドライブの管理者は個人のアカウントで付ける。** グループで付けた役割は数えない (中の人を確かめられない)。
  グループだけで付けると持ち主が0人になり、`setupCommandQueue()` も `debug*` も誰も実行できない
- 共有ドライブでゴミ箱へ移せるのはコンテンツ管理者から。役割が足りないときは要る役割を添えて断る
- 命令ファイルには持ち主が無いので、最後に書いた人を「置いた人」として読む
- 置いたら GAS エディタで **`debugVerifySharedDrive()`** を実行して確かめる (役割が読めるか → 命令の移動 →
  回った時刻 → 道具の zip。マイドライブなら何もせずにそう言う)

設計は [共有ドライブ対応](../superpowers/specs/2026-10-19-shared-drive-design.md) にある。

## Google ToDo と同期するなら

エディタの「サービス +」から **Tasks** を足すと、「やること」の上に「Google ToDo」の入口が出る。足していない
環境では入口自体が出ず、ほかの機能には影響しない。詳しくは [やること](tasks.md#google-todo)。
