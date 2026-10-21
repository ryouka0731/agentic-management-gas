# 管理

[手引きの目次](README.md)

## 持ち主と管理者

| | 誰か | できること |
|---|---|---|
| 持ち主 | 入れ物のフォルダの持ち主。共有ドライブでは、共有ドライブの管理者 (`organizer`) 全員 | エディタで動かす関数 (`setupCommandQueue` / `debug*`)。報告の知らせを受け取る。報告から積まれるやることの担当になる (持ち主が複数のとき・分からないときは担当なし) |
| 管理者 | 持ち主 + 入れ物のフォルダを編集できる人。共有ドライブでは `organizer` / `fileOrganizer` / `writer` の役割の人 | チームの設定 (目標・期間で進める・ポイント・改善のヒントなど)、上下関係と他人の表示名、他人の改訂版を捨てる・確認依頼を取り下げる・報告を閉じる・下書きを消す |

- 持ち主1人だけだと、休んだときに誰も設定を直せない。フォルダを編集できる人は台帳も直接書き換えられるので、画面の操作でも同じ扱いにしている
- 持ち主は `repoOwners_()`、管理者は `repoIsAdmin_()` が決める。Web アプリは開いている本人の権限で動くので、
  `Session.getEffectiveUser()` を持ち主の判定に使ってはならない (誰もが持ち主になる)
- 編集権限の無い人が Drive の編集者を尋ねると空が返る。分からないときは「管理者ではない」と答える
- 共有ドライブの役割は10分覚える。グループで付けた役割は数えない。**共有ドライブの管理者は個人で付ける** ([置き方](setup.md#共有ドライブに置くとき))

画面の「使い方」の管理者向けの節には「管理者」の札が付く。

## Web アプリの公開範囲

`src/appsscript.json` の `webapp`:

```json
"webapp": {
  "executeAs": "USER_ACCESSING",
  "access": "MYSELF"
}
```

今は `access: MYSELF` (持ち主だけが開ける)。ほかの人に配るときは `access` を広げる (`DOMAIN` など)。`executeAs` を
どちらにするかで、次が変わる。

| | `USER_ACCESSING` (今) | `ME` (持ち主の権限で実行) |
|---|---|---|
| 利用者に要る Drive の権限 | 台帳と全文書への編集権限 | 要らない (アプリ経由だけ) |
| 正式版の直接編集 | Docs を開けばできてしまう | できない (権限が無い) |
| Drive の版の履歴 | 実際に編集した人が残る | 全部持ち主の名前になる |
| 実行の上限 (クォータ) | 各自 | 持ち主に集中 |

アプリの側の正式版の保護は「アプリ経由の操作」しか止められないので、`USER_ACCESSING` では Docs を直接開く抜け道が残る。
`ME` ならその抜け道は塞がるが、**切り替える前に次を片付けること。**

- **末尾が `_` でない関数は、すべて画面の `google.script.run` から呼べる。** `ME` では利用者の誰もが、それを持ち主の権限で
  呼べることになる。エディタ専用の関数 (`debug*` / `setupCommandQueue`) は持ち主以外を断り、`setupRepo` は初期化済みなら断るが、`dbUpdate`
  などの中の関数は塞いでいない。中の関数を画面から呼べない形に組み替える計画を先に立てる
- `executeAs: ME` では `Session.getActiveUser().getEmail()` が空を返す環境がある。そうなると記録の作者と確認した人が
  空になり、自己承認の禁止が誤作動する。**別のアカウントで開き、自分の顔に「利用者を特定できていません」と出ないか確かめる**

## 自己承認

確認依頼を出した本人は承認できない。1人で試すときは承認する人がいないので、スクリプトプロパティ
`ALLOW_SELF_APPROVE=true` のときだけ自己承認を許す (許しているあいだは警告のログが残る)。

| 関数 | 内容 |
|---|---|
| `debugEnableSelfApprove()` | 自己承認を許す |
| `debugDisableSelfApprove()` | 禁止に戻す。**本番で使う前に必ず戻す** |

検証の入口 (`debugVerify*`) は、自分で許して終わったら元に戻すので、事前の準備は要らない。

## 道具の署名の鍵

手元の道具の自動更新を信頼できるのは、**秘密鍵を持つ人 (= deploy する人)** を信頼する限りにおいてである。

- 秘密鍵は `$BANTO_SIGNING_KEY` か `~/.config/softbanto/kit-signing-key.pem` にだけ置く。リポジトリにも Drive にも番頭にも置かない
- 番頭 (`src/KitSigning.gs`) が持つのは署名と、署名した版・中身の指紋だけ。スクリプトを開ける人が中身を書き換えても、署名は合わない
- **道具の版 1.8.0 を配ったデプロイ (@151) までは、番頭が秘密鍵を持って署名していた。** それより前の版のスクリプトには
  古い秘密鍵が版の履歴に残っている。Apps Script のプロジェクトをほかの人と共有する前に `node scripts/kit-key.mjs --rotate`
  で作り直すことを考える (作り直すと、利用者は道具の zip を落とし直す)

## エディタで動かす関数

末尾が `_` でない関数のうち、GAS エディタから引数なしで動かすためのもの。`setup*` と `debug*` は、`setupRepo` (初期化済みなら断る) を除いて最初に持ち主かを確かめる (`assertOwner_`)。

### 置くとき

| 関数 | 内容 |
|---|---|
| `setupRepo()` | 入れ物と台帳を作る。初期化済みなら断る |
| `setupCommandQueue()` | 1分ごとのトリガーを置く。二度実行しても増えない。キューを引き継ぐときも実行する |
| `processCommandQueue()` | キューを1回処理する (トリガーが呼ぶもの。手で呼んでもよい) |

### 確かめる

[実機で確かめる](verification.md) にまとめた: `debugVerifyPhase2` / `debugVerifyPhase3b` / `debugVerifyCommandQueue` /
`debugVerifySharedDrive` / `debugVerifyScrum` / `debugVerifyCalendar` / `debugMarkdownRoundTrip` / `debugWriteRoundTrip`。

### 調べる・直す

| 関数 | 内容 |
|---|---|
| `debugCleanupLastVerify()` | 直近の `debugVerifyPhase2()` が失敗して残した Doc・改訂版・確認依頼・台帳の行を片付ける |
| `debugCleanupVerifyIssues()` | 検証が残したやることとカードを片付ける (題名と本文で見分ける) |
| `debugDumpIssues()` | やることの保存状態をログに出す (「作ったのに出ない」の切り分け) |
| `debugFindConvertedCells()` | 台帳で、字として書いたはずが数や日付に化けたセルを挙げる (`'007'` → 7 など)。元の字は残っていないので、直すのは人 |
| `debugEnsureMainBranch()` | 台帳に正式版の行が無い古いリポジトリに補う (1日1回の片付けでも自動で行う) |
| `debugListWorkingCopies()` | 改訂版の作業コピーの一覧 (`debugWriteRoundTrip` の対象を人が選ぶため) |
| `debugInspectImages()` | 画像の取り出しが失敗する原因の切り分け |
| `debugRenderDoc()` / `debugLiveHtml()` | 描画とキャッシュの確かめ (`DEBUG_FILE_ID` の文書で) |
| `debugRegisterFile()` | `DEBUG_FILE_ID` の文書を登録する (開発時の入口。ふだんは画面から登録する) |
| `debugEnableSelfApprove()` / `debugDisableSelfApprove()` | 上の「自己承認」 |
| `memberSet(email, manager, name)` / `memberSetName(email, name)` | 上下関係と表示名 ([人と工数](people-and-effort.md)) |

エディタ用の関数を足したら、最初に `assertOwner_()` を呼び、`test/phase4-edit.test.js` の「エディタ専用の関数は、
持ち主以外には動かない」に名前を足す。

## スクリプトプロパティ

人が手で書くものは `DEBUG_FILE_ID` / `DEBUG_FILE_PATH` (`debugRegisterFile` の道のり。省くと文書の名前) / `DEBUG_WRITE_FILE_ID` (確かめるときだけ) と `ALLOW_SELF_APPROVE` だけ。ほかは番頭が書く。

| 鍵 | 内容 |
|---|---|
| `repoConfig` | 入れ物・台帳・キューなどの ID |
| `PREF:<key>` / `MYPREF:<アドレス>` | チームの設定 / 自分の設定 ([設定](settings.md)) |
| `SCRUM_ENABLED` / `SCRUM_PRODUCT_GOAL` / `SCRUM_DEFINITION_OF_DONE` | 期間で進める |
| `GAME_ENABLED` / `GAME_PLAYERS` | ポイントとレベルのオン・オフと、週の上位に参加している人 |
| `TEAM_MONTHLY_GOAL` | チームの毎月の目標 |
| `QUEUE_RUNNER` / `QUEUE_RUNNER_AT` / `QUEUE_LAST_RUN` | キューを動かしている人・仕掛けた時刻・最後に回った時刻 |
| `KIT_PRINT:<アドレス>` | その人の道具の指紋 (画面に「道具の更新あり」を出すため) |
| `ARCHIVE_HOUSEKEPT_ON` / `ARCHIVE_HOUSEKEPT_RUNNING` | 1日1回の片付けの印 |

一度出した番号 (やること・確認依頼など) も覚えていて、表が空になっても戻さない。

本人の UserProperties に置くものもある: 日報の形と自分の形 (`REPORT_KIND:` / `REPORT_CUSTOM:`)、ポイントのいちばん高かったレベル (`GAME_LEVEL_MAX:`)、Google ToDo の送り先のリスト (`GOOGLE_TASKS_LIST_ID`)。
