# やることを予定に入れる (カレンダー)

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。
対象: `src/core/CalendarPlan.js` / `src/core/CalendarSync.gs` / `src/api/Calendar.gs` / `src/ui/js-calendar.html`。手引きは
`docs/manual/calendar.md`。

## 分け方

- **並べ方はピュア** (`CalendarPlan.js` の `calendarPlanBlocks`)。Calendar に触らず、同じ入力から同じ並びを返す。
  期限の早いもの → 優先度 (`issuePriorityRank_` の値を `rank` で受ける。`ISSUE_PRIORITIES()` を写さない) → 番号の順。
  勤務の時間・今より後・ほかの予定と重ならない・予定どうしのあいだに `CAL_GAP_MIN()` (10分)・先の勤務日まで・
  1回 `CAL_MAX_BLOCKS()` (40) 件まで。`test/calendar-plan.test.js` が、種から作ったでたらめな入力で
  「重ならない・時間の中・並んでいる」を見ている
- **暦日と勤務の時間は東京の時刻** (`CAL_TZ_OFFSET_MIN()` = 540)。appsscript.json の timeZone と同じで、夏時間は無い
- 要る分は `calendarMinutesFor`: (予定 − 実績) × 8 時間 ÷ 担当の頭数 (工数の数え方と同じ)。無い・使い切ったら1つ分
- **読み書きは開いている本人の権限** (`CalendarSync.gs`)。Web アプリは `executeAs: USER_ACCESSING` なので、CalendarApp は
  その人のカレンダーを見る。拡張サービス (Calendar API) は使わない (例外は Tasks と Drive だけ)

## 触るのは番頭が入れた、その人の予定だけ

- 入れた予定に印を3つ付ける (`CALENDAR_TAG_()`): `banto` = `block`、`bantoWho` = 小文字のアドレス、`bantoIssue` = 番号。
  **消すのは `calendarIsMine_` が当たる予定だけ。** 印の無い予定・ほかの人の番頭の予定は消さない
- 組み直し (`calendarPlanFor_`) は、**先に新しい予定を全部入れてから**、これから始まる古い予定 (始まり > 今) を消す。
  途中で書けなくなったら入れたぶんを消し、古いものを残す (半端に入れ替わらない)。いま続いている予定 (始まり ≤ 今 < 終わり)
  は残し、ほかの予定と同じく埋まっている時間として扱う
- 埋まっている時間は本人の**既定のカレンダー**から読む (終日と、断った `GuestStatus.NO` を除く)。共有カレンダーのほかの人の
  予定は見ない (人の予定は人のカレンダーにあるので)
- 「やることを予定に入れる」をオフにすると (`apiPrefSet` が `calendar.plan` を true 以外にしたとき)、`calendarClearMine_` が
  これから先の番頭の予定を消す。消せなくても設定は戻さない (通知と同じ扱い。`typeof` で見るのは、Prefs.gs だけを読む
  テストでも動くように)
- **台帳には書かない。鍵 (`dbWithLock_`) も取らない。** カレンダーが記録。最後に組んだときだけスクリプトプロパティ
  `CAL_PLANNED:<小文字のアドレス>` (`{day, at, ok}`) に覚え、ホームの自動の組み直しは1日1回 (`plannedToday`)

## 共有カレンダー

- チームの設定 `calendar.shared` (型 `calendar`。値は ID、`''` は決まっていない)。画面の汎用の欄には出さず、
  `js-calendar` の `makeCalendarTeamField` が組む。**書くのは `apiPrefSet` だけ** のまま (`apiCalendarCreateShared` /
  `apiCalendarSetShared` も最後は `apiPrefSet` を呼ぶ)
- 作るのは押した管理者のカレンダーの中 (`CalendarApp.createCalendar`)。貼るときは押した管理者が開けるかを確かめる
- `getCalendarById` は、共有されていてもまだ登録 (購読) していない人には null を返す。開くときは `subscribeToCalendar`
  してから取り直す (`calendarOpenShared_`)
- 書けるかを尋ねる口は CalendarApp に無い。`apiCalendarStatus().canWrite` は「持ち主か、最後に組んだときに書けたか」
- 共有の相手を足す頁は `calendarSettingsUrl_` (`/calendar/r/settings/calendar/<ID の base64、末尾の = なし>`)。実機で形を
  確かめていないので、手引きには開かないときの辿り方も書いてある。管理者にだけ返す

## 画面

- 自分の設定の「予定に入れる」の節の下に、様子・「予定を組み直す」・最後に組んだ時刻・「カレンダーで開く」
  (`makeCalendarMinePanel`)。チームの設定に作る・貼る・外す・共有の相手を足す (`makeCalendarTeamField`)
- ホームの `#home-calendar` は `prefs.effective.calendar.plan` がオンのときだけ `apiCalendarToday` を呼ぶ。
  その日にまだ組んでいなければ (`plannedToday: false`) 1回だけ `apiCalendarPlan` を黙って呼ぶ (`failQuiet`)。
  画面の側でも日ごとに1回に絞る (`calendarAutoDay`)。**オフのあいだは何も呼ばない**
- 返事は `latest('calendar')` で見分ける (ホームを開き直したときの古い返事で描き直さない)
