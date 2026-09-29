# SoftBanto (番頭) を手元から動かす道具

画面 (Web アプリ) を開かずに、やること・改訂版・確認依頼を作れます。
Claude や Codex に作業させるときは、同じフォルダの `AGENTS.md` を読ませて
ください。

## 用意するもの

- Node.js 18 以上
- Google Drive for desktop (この道具のフォルダを同期しておく)

鍵もトークンも要りません。同期したフォルダにファイルを置くだけで動きます。

## 設定 (ここだけ最初にやる)

`agentkit.example.json` を `.agentkit.json` という名前で写し、`queueDir` に
**Drive の `.git/queue` フォルダの、手元でのパス**を書きます。

```json
{
  "queueDir": "<同期しているフォルダ>/agentic-management/.git/queue"
}
```

### 場所が分からないとき

画面の右上にある自分の顔 → **「手元から動かす道具を落とす」** を押すと、
Drive の中での道のりが写せる形で出ます。あとは、手元で同期しているフォルダの
場所に、その道のりを繋ぐだけです。

同期しているフォルダの場所は、たいてい次のどちらかです。

| | よくある場所 |
|---|---|
| macOS | `~/Library/CloudStorage/GoogleDrive-<あなた>@<会社>/マイドライブ` |
| Windows | `G:\マイドライブ` (ドライブ文字は設定による) |

探すのが早いのは、Finder / エクスプローラーで `.git` の付いたフォルダまで
たどり、そこを**ターミナルにドラッグ**して出たパスを写すやり方です。

`--queue <パス>` や環境変数 `AGENTKIT_QUEUE` でも渡せます。

## 通っているかを確かめる

```sh
node agent.mjs files
```

文書の一覧が返れば設定完了です。**返るまで最大1分かかります**。向こう側は
1分ごとにファイルを見に来る仕組みなので、すぐ返らなくても壊れてはいません。

## 使う

```sh
node agent.mjs                 # 使える操作の一覧
node agent.mjs issue "通勤手当の見直し" "4月から改定"
node agent.mjs read <fileId> > body.md
cat body.md | node agent.mjs write <fileId> -
node agent.mjs commit <fileId> "第3条を改訂"
```

`npm link` すると `agent files` のように短く書けます。

## 動かないとき

| 出るもの | 見るところ |
|---|---|
| `設定が見つかりません` | `.agentkit.json` の置き場所。この道具と同じフォルダか、その親にあるか |
| `キューのフォルダがありません` | `queueDir` のパス。Drive の同期が終わっているか |
| `結果が返りませんでした` | 向こう側で `setupCommandQueue()` を実行したか。1分待ったか |
| `実行できない操作です` | その操作はここからは行えない (画面から行う) |

向こう側の設定は、Apps Script のエディタで `setupCommandQueue()` を1回実行する
だけです (1分間隔の見張りを置きます。二度実行しても増えません)。
