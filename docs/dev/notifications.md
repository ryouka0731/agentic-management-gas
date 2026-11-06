# 知らせ (メール・画面の知らせ・タブの数・推しの一言)

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。
設計は `docs/superpowers/specs/2026-11-06-notifications-design.md` (やること #108)。

対象: `src/core/Notifier.gs` の知らせの言い方 (`notify*` / `noticeAdd` の見出し・本文)・`src/ui/js-me.html` の `loadNotices`・
`src/ui/app.js.html` の `titleBase` / `setTitleBadge`・`src/ui/js-focus.html` のタブの名前・`src/core/Oshi.js` の場面 `notice`。

## 言い方の決まり

知らせは「何が起きたか」ではなく「**あなたに何が来たか・次に何をすればいいか**」で書く。

1. **責めない。** 「期限切れ」「滞っている」「未対応」を見出しにしない。期日の話は「◯日までのものが 2 件あります」の形。
   目標の差し戻しも「差し戻されました」ではなく「直してほしいところが返ってきました」と書き、次の一歩を添える
2. **メールの本文の最後は必ず「次にすること: …」の1行。** 付けるのは `notifyBody_(中身, 次にすること)` だけ。次にすることが
   無いとき (反映された・取り下げられた・評価が付いた) は省き、「次にすること: ありません」になる。押すボタンの名前は画面の字に合わせる
   (確認依頼は「承認」「直してほしい」、目標は「承認する」「差し戻す」)
3. **件名の形は変えない。** `[SoftBanto] 何の #番号 どうなったか` を `notifySubject_` だけで組む。受信側の振り分けが接頭辞と
   「何の #番号」を見ているので、言い換えるのは「どうなったか」だけ
4. **画面の知らせ (`noticeAdd`) の見出しは「あなたに何が来たか」。** 本文に次にすることは書かない (開く先 `link` がある)
5. **推しの一言は本人の画面にだけ。** メールには入れない (推しの名前や口調が社内のメールに残る。`docs/dev/permissions.md` の
   「知らせ・メール・使われ方にも出さない」)
6. **Git の言葉を出さない** (`test/naming.test.js`)。「確認依頼」「反映」「正式版」「改訂版」
7. **数は 1 行に 1 つ。** 「3 件増えました」は書く。「増えた 3 件のうち 2 件が…」は書かない

いまの言い方 (件名の「どうなったか」 / 画面の見出し):

| 関数 | 件名の「どうなったか」 | 画面の見出し |
|---|---|---|
| `notifyPrCreated` (出した本人) | を出しました | (出さない) |
| `notifyPrReviewRequested` | があなたを待っています | 確認依頼 #12 があなたを待っています |
| `notifyPrMerged` (出した本人) | が正式版に入りました | (出さない) |
| `notifyPrClosed` (頼まれた人) | は要らなくなりました | 確認依頼 #12 は要らなくなりました (改訂版は残っています) |
| `notifyPrMention` / `notifyInquiryMention` / `notifyIssueCommentMention` | であなたが呼ばれました | ◯◯ #N で <人> があなたを呼んでいます |
| `notifyInquiry` (持ち主) | が届きました | (出さない) |
| `notifyInquiryReply` / `notifyIssueComment` | に返事が来ました | ◯◯ #N に <人> から返事が来ました |
| `notifyGoalSubmitted_` | の承認があなたを待っています (直したときは「の直したところの承認が…」) | <名前> さんの目標 #N の承認があなたを待っています |
| `notifyGoalDecided_` | が承認されました / に直してほしいところが返ってきました | あなたの目標 #N が承認されました / … |
| `notifyGoalGraded_` | に評価が付きました | あなたの目標 #N に評価が付きました |
| `notifyGoalWithdrawn_` | の承認は要らなくなりました | <名前> さんの目標 #N の承認は要らなくなりました |

**知らせの関数を足したら** `test/notifier-wording.test.js` の `CALLS` にも足す (Notifier.gs の `notify*` を全部呼んでいるかを
そのテストが見ていて、足さないと落ちる)。kind を渡すこと (`docs/dev/prefs.md`)。言い方を変えたら上の表と
`test/api/pr.test.js` / `test/api/goals.test.js` / `test/prclose.test.js` などの件名の字も直す (字を緩めない)。

## 知らせが出る場所

| 場所 | 仕組み | 届くとき | 止め方 |
|---|---|---|---|
| 画面の帯と「知らせ」のベル | `noticeAdd` → 台帳 `notifications` → `apiNotifications` (1分ごと) | 画面を開いているあいだ | 止められない (本人あてだけ) |
| タブの名前の数 | `loadNotices` → `setTitleBadge(unread)` | 画面を開いているあいだ (裏のタブでも) | — |
| 推しの一言 | 場面 `notice` (`oshiSayNext`) | 新しい知らせが届いたとき | `oshi.on` |
| デスクトップ通知 | ベルの中の「デスクトップに出す」→ `window.Notification` (`popDesktop`) | **タブを開いているあいだだけ** | ブラウザの許可 |
| メール | `notify(to, subject, body, kind)` → Gmail | いつでも | 設定「通知メール」の種類ごと (`NOTIFY_KINDS`) |
| あなたの番 (ホーム) | `homeMine` | 画面を開いたとき | — |
| VS Code 拡張 | `homeMine` を 15 分ごと | VS Code を開いているあいだ | 拡張の設定 |

## PWA の通知はできない

GAS の web アプリは `script.google.com` の中の `googleusercontent.com` の枠で動く。**manifest も Service Worker も置けない**
(HtmlService は HTML しか返せず、別の origin から script を読めない) ので、ホーム画面に追加しても普通のブックマークで、Push API は
使えない。枠の中からの通知の許可は、ブラウザによっては求められない (いまの `desktopState()` が `unavailable` / `denied` を返す理由)。
画面を閉じていても届く道はメール・Google カレンダーの通知・VS Code 拡張に絞る。**新しい外部のサービスは使わない**
(UrlFetchApp も Chat の webhook も使わない)。カレンダーの通知と VS Code 拡張の知らせは設計の §6 の 2・3 で足す。

## タブの名前の数 (`titleBase` / `setTitleBadge`)

- **元の名前は `app.js` の `titleBase` 1 か所で持つ** (`'SoftBanto'`。`test/naming.test.js` が名前と揃っているかを見る)。
  `document.title` から読み直さない。読み直すと、前に付けた数や集中の残り時間が元の名前に焼き込まれる
  (前の `js-focus` は集中を始めたときの `document.title` を控えていた。そのままだと数が付いたまま「残り25分 · (2) SoftBanto」になり、
  終えたときに古い数へ戻る)
- `loadNotices` が返事のたびに `setTitleBadge(data.unread)` を呼ぶ。0 件なら数を付けない (`SoftBanto`)。読んだら次の返事で消える
- **集中しているあいだ** (`focusSession`) は `setTitleBadge` は数だけ覚え、名前は集中の残り時間 (`focusTitleOf(titleBase, 残り)`) のまま。
  集中を終えたら (`focusClear`) `titleWithBadge()` でいまの数付きの名前に戻す
- テストは `test/component/notices-title.test.js`

## 推しの一言 (場面 `notice`)

- `OSHI_EVENTS()` の `notice` (「知らせが届いた」、表情は `cheer`、`praise` を持たないので当たりには変わらない)。
  `OSHI_LINES()` の **11 の口調すべてに 3 本ずつ** (`test/oshi.test.js`)。せりふは「知らせが届いていますよ」の趣旨だけで、
  **数も中身も言わない** (数は帯とベルが出す。古い数を言わないため)
- 言うのは `loadNotices` の帯を出す回と同じ (1分ごとの頼みで、前に見た番号より新しい未読があるとき。開いたときの前からある
  ぶんでは言わない)。`oshiSayNext('notice')` なので、出ている吹き出し (済ませたときのほめ言葉など) は上書きせず、消えてから言う
- 推しがオフ (`oshi.on`) の人には出ない (`oshiSayNext` が `oshiOn()` を見る。推しも取りに行かない)。集中しているあいだは言わない
- ひょっこり (`oshiPeekPick`) の「知らせが N 件あるよ」とは別の仕組み (あちらは何も操作していないときに未読の数を伝える)
