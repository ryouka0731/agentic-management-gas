# 共有ドライブ対応 設計

2026-10-19。利用者の依頼:「共有ドライブ対応の設計進めて」。**設計のみ。移行の予定は無い。**

## 1. 決めたこと (利用者に確かめた)

| 問い | 決めたこと |
|---|---|
| どこまで共有ドライブに置くか | **スクリプトごと** (Apps Script のプロジェクトも `agentic-management/` も共有ドライブ) |
| 共有ドライブでの「持ち主」 | **共有ドライブの管理者 (`organizer`) 全員** |
| 署名の鍵 | **番頭に置かない。** deploy が手元で署名し、署名だけを送る (マイドライブでも同じにする) |
| 報告から作るやることの担当 | 共有ドライブでは**空** (全員を担当にすると工数が頭数で割られる) |

マイドライブで今動いているものの振る舞いは、①の署名を除いて変えない。

## 2. いま共有ドライブで壊れるところ

| | 起きること | 使っている場所 |
|---|---|---|
| 持ち主がいない | `getOwner()` が null。持ち主が空になり、エディタ専用の関数が誰にも動かず、報告の知らせがどこにも届かない | `repoOwnerEmail` / `assertOwner_` / `inquiryOwner_` / `commandOwner_` |
| 親は1つだけ | `addFile` が例外になる | `commandRetire_` / `setupRepo` (台帳) / `Main.gs` の文書の取り込み2か所 |
| 共有の設定 | 外への共有が組織の設定で断られる | `AgentKit.gs` の zip の `setSharing(ANYONE_WITH_LINK)` |
| ゴミ箱 | 投稿者は消せない | 改訂版を捨てる・古い zip・キューの結果の片付け・検証の後片付け (`debug*`) |
| 署名の鍵 | メンバー全員が `src/KitSigning.gs` の秘密鍵を読める | `KIT_SIGNING_KEY_()` |
| トリガー | 仕掛けた人の権限で走る。その人が抜けると止まる | `setupCommandQueue` |

## 3. 署名の鍵を番頭から出す (①)

**署名する中身は deploy の時点で決まっている** (`KIT_FILES()` は焼き込み、版は `AGENT_KIT_VERSION()`)。
番頭が実行時に署名する必要は無い。

- `scripts/deploy.mjs` が `kitSignedText(version, files)` を手元の秘密鍵で署名し、`src/KitSigning.gs`
  (記録しない) に次を書く:
  ```js
  function KIT_SIGNATURE_() {
    return { version: '1.8.0', filesSha: '<sha256 64字>', signature: '<base64>' };
  }
  ```
- `kitSignature_(version, files)` は、渡された `version` と `sha256Hex(JSON.stringify(files))` が
  記録と**両方**一致するときだけ `signature` を返す。違えば `''` (手元は入れ替えず知らせるだけ。今と同じ)。
  指紋 (`kitPrint_`) の8字では比べない (短すぎる)
- 秘密鍵が無いときに deploy が断るのは今と同じ。`--no-sign` は `src/KitSigning.gs` を消して送る (今と同じ)
- `KIT_SIGNING_KEY_` と `Utilities.computeRsaSha256Signature` の呼び出しは消す
- **信頼の起点が「スクリプトを開ける人」から「秘密鍵を持つ人」に狭まる。** スクリプトを編集できる人が
  `KIT_FILES` を書き換えても、署名が合わないので手元の道具は入れない。CLAUDE.md の
  「秘密鍵を読めるのは『スクリプトを開ける人』全員」の節と、「共有するのは `agentic-management/` だけ」の
  断りは書き直す (共有してよくなる)
- 手元の道具 (`kit/track/update.mjs`) は変えない。署名の式も公開鍵も同じなので、配った道具はそのまま通る

テスト: `test/kit-signing.test.js` に「記録した署名を返す」「中身が1字違えば空」「版が違えば空」
「`KIT_SIGNATURE_` が無ければ空」。deploy が書いたものを `verifyKit` で確かめる。

## 4. 共有ドライブかどうか (②)

- **Drive の拡張サービス (v3) を使う。** `appsscript.json` の `dependencies.enabledAdvancedServices`
  に `{ userSymbol: 'Drive', serviceId: 'drive', version: 'v3' }` を書く。clasp が送るので**利用者は
  エディタを触らない**。CLAUDE.md の制約「拡張サービスは Google ToDo 連携だけの例外」に2つ目として書き足す
- `driveApiAvailable_()` (`tasksAvailable` と同じ形) が無いと答えたら、マイドライブとして扱う
- 入れ物が共有ドライブかは `Drive.Files.get(rootId, { fields: 'driveId', supportsAllDrives: true })`。
  `setupRepo` で `repoConfig().driveId` に書く。この欄が無い既存の設定は、`repoDriveId_()` が初めて
  読んだときに埋める (空文字も「マイドライブ」として覚え、毎回問い合わせない)
- 共有ドライブ・マイドライブの分かれ目は `repoDriveId_()` 1か所に寄せる。`if (driveId)` を散らさない

## 5. 持ち主と管理者 (②)

| | マイドライブ (今まで) | 共有ドライブ |
|---|---|---|
| 持ち主 | 入れ物のフォルダの持ち主1人 | 共有ドライブの `organizer` 全員 |
| 管理者 | 持ち主 + 入れ物のフォルダを編集できる人 | `organizer` / `fileOrganizer` / `writer` |

- `repoOwners_()` が持ち主の一覧を返す。マイドライブでは `[repoOwnerEmail()]` (空なら `[]`)。
  共有ドライブでは `Drive.Permissions.list(driveId, { supportsAllDrives: true, fields:
  'permissions(emailAddress,role,type)', pageSize: 100 })` を全頁読み、`type === 'user'` の行を役割で分ける。
  **グループ (`type === 'group'`) は数えない** (中の人を DriveApp では展開できない)。設計の断りに書く
- 読んだ結果は `CacheService.getScriptCache()` に10分置く (一覧で行ごとに問い合わせない)
- **読めないときは投げずに `[]`** (誰も持ち主ではない)。今の「分からないときは管理者ではない」と同じく安全側
- 呼ぶ側の置き換え:
  - `assertOwner_`: `repoOwners_()` に本人が入っているか
  - `repoIsAdmin_`: 共有ドライブでは管理者の役割表で見る。マイドライブは今のまま
  - `inquiryOwner_` (1人を返す) は `inquiryOwners_` (一覧) にする。知らせは**全員に**送る
    (`Notifier.gs`・`Inquiry.gs` の宛先)。報告から作るやることの担当は、持ち主が1人のときはその人、
    複数なら空
  - `setupRepo` の台帳の `createdBy` は、実行した本人 (`Session.getActiveUser()`)
  - `repoOwnerEmail()` は残す (マイドライブの持ち主)。共有ドライブでは `''` を返すので、呼ぶ場所が
    上のどれかに置き換わっていることをテストで確かめる
- 画面の「持ち主だけ」という言葉は「持ち主 (共有ドライブでは管理者)」にする

## 6. 共有ドライブで使えない Drive の操作 (③)

- **`addFile` + `removeFile` は `file.moveTo(folder)` に置き換える。** マイドライブでも同じに動くので
  分けない。対象: `commandRetire_` / `setupRepo` の台帳 / `Main.gs` の文書の取り込み2か所。
  CLAUDE.md の「`addFile` と `removeFile` は両方呼ぶ」は「`moveTo` を使う。`addFile` は共有ドライブで
  例外になる」に書き換える
- `test/fakegas.js` に `moveTo` を足し、**共有ドライブの印を付けたフォルダへの `addFile` は投げる**
  ようにする (今の疑似GASは `addFile` が親を移すので、片方だけの書き方が通ってしまう)。
  `test/shared-drive.test.js` で上の4か所を共有ドライブの入れ物で通す
- zip の `setSharing`: 投げたら `console.warn` して続ける。メンバーはそのまま落とせる
- ゴミ箱へ移す操作が権限で断られたら、`'共有ドライブで消すには「コンテンツ管理者」以上の役割が要ります'`
  を添えて投げ直す (`driveTrash_(file)` に寄せる)。消せないまま黙って続けると、捨てた改訂版が残り続ける。
  ただし**片付けのついで** (古い zip・キューの結果) は握って続ける (本処理を止めない。知らせと同じ扱い)
- 命令を置いた人 (`commandOwner_`): `getOwner()` が null なら
  `Drive.Files.get(id, { fields: 'lastModifyingUser(emailAddress)', supportsAllDrives: true })`。
  使い道は「誰の道具が古いか」(`kitRemember_`) だけで、権限の判断には使わない (書き換えられる)

## 7. トリガーを誰が持つか (④)

- 1分ごとのキューと1日1回の片付けは、`setupCommandQueue()` を実行した人の権限で走る。
  `setupCommandQueue` はその人のアドレスと、キューが最後に回った時刻をスクリプトプロパティに書く
  (`QUEUE_RUNNER` / `QUEUE_LAST_RUN`。最後に回った時刻は `processCommandQueue` が書く。
  命令が無くても書くが、鍵は取らない)
- 設定の画面に「キューを動かしている人」「最後に動いた時刻」を出す。**1時間以上動いていなければ**
  「管理者が GAS エディタで `setupCommandQueue()` を実行すると引き継げます」と出す
- 引き継ぐと、自分のトリガーを作る。**前の人のトリガーは消せない** (他人のトリガーは見えない)。
  二重に走っても、命令1件ごとの鍵と `commandAlreadyRan_` で同じ命令は二度走らない。
  1日1回の片付けも受け持つ印で1回に絞られている

## 8. 実機で確かめる

`debugVerifySharedDrive()` (持ち主専用、後片付けまでする):
入れ物が共有ドライブか / `repoOwners_` と管理者の一覧 / キューに置いた命令が片付けまで通る /
台帳の行の移動 / zip の共有が断られても配れる / 投稿者で消したときの言葉。
疑似GASで再現できない「権限で断られる」形はここでしか見られない。

## 9. やらないこと

- マイドライブから共有ドライブへの移行手順 (予定が無い)
- グループで与えた役割の展開
- 持ち主が複数いるときの知らせの宛先の調整 (全員に送る)
- 前の人のトリガーを自動で止める仕掛け

## 10. 進める順

1. ① 署名の鍵を出す (単独で出せる。マイドライブの今の運用でも効く)
2. ③ の `moveTo` への置き換えと疑似GAS (単独で出せる。振る舞いは変わらない)
3. ② 判定・持ち主・管理者
4. ④ トリガーの表示と引き継ぎ
5. `debugVerifySharedDrive`
