# やることを予定に入れる (カレンダー)

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。
対象: `src/core/CalendarPlan.js` / `src/core/CalendarSync.gs` / `src/api/Calendar.gs` / `src/ui/js-calendar.html`。手引きは
`docs/manual/calendar.md`。

## 分け方

- **並べ方はピュア** (`CalendarPlan.js` の `calendarPlanBlocks`)。Calendar に触らず、同じ入力から同じ並びを返す。
  期限の早いもの → 優先度 (`issuePriorityRank_` の値を `rank` で受ける。`ISSUE_PRIORITIES()` を写さない) → 番号の順。
  勤務の時間・今より後・ほかの予定と重ならない・予定どうしのあいだに `CAL_GAP_MIN()` (10分)・先の勤務日まで・
  1回 `CAL_MAX_BLOCKS()` (20) 件まで。会議 (busy) の前後にも `gapMin` 空ける。**late は空きが尽きたときだけ**で、
  上限で止めたときは `capped` を立てる (遅れとは限らない)。`test/calendar-plan.test.js` が、種から作ったでたらめな入力で
  「重ならない・時間の中・並んでいる」を見ている
- **暦日と勤務の時間は東京の時刻** (`CAL_TZ_OFFSET_MIN()` = 540)。appsscript.json の timeZone と同じで、夏時間は無い
- 要る分は `calendarMinutesFor`: (予定 − 実績) × 8 時間 ÷ 担当の頭数 (工数の数え方と同じ)。無い・使い切ったら1つ分
- **読み書きは開いている本人の権限** (`CalendarSync.gs`)。Web アプリは `executeAs: USER_ACCESSING` なので、CalendarApp は
  その人のカレンダーを見る。拡張サービス (Calendar API) は使わない (例外は Tasks と Drive だけ)

## 触るのは番頭が入れた、その人の予定だけ

- 入れた予定に印を3つ付ける (`CALENDAR_TAG_()`): `banto` = `block`、`bantoWho` = 小文字のアドレス、`bantoIssue` = 番号。
  説明の最後の行にも `番頭: <アドレス> #<番号>` (`calendarMarkerLine_`) を書く。作ってから印を付けるまでに打ち切られた予定も、
  次の組み直しで本人のものと分かって消せる。**消すのは `calendarIsMine_` が当たる予定だけ。** 印の無い予定・ほかの人の
  番頭の予定は消さない
- **人が直した番頭の予定は消さない** (`calendarEdited_`: ゲストがいる、または作ってから1分より後に更新された)。組み直しでは
  残して busy に入れ、やめるとき (`calendarClearMine_`) も残す
- **2つの画面で同時に組まない。** `calendarClaim_` が `dbWithLock_` の中で `CAL_PLANNED` に `running` (5分で切れる) を付け、
  付いていれば断る。並べる・書くのは鍵の外 (`calendarPlanClaimed_`)、終わったら `finally` で外す (`calendarRelease_`)。
  自動 (`{auto: true}`) は印の中で「その日に組めたか」を見直す。手で頼むのは `CALENDAR_COOLDOWN_SEC_()` (60) 秒に1回
  (`waitSeconds` を返し、画面はその間ボタンを押せないままにする)。`cooldown: false` はエディタの検証だけが渡す
- 書いている途中で断られたとき、**1件目から権限で断られたときだけ**「見るだけの共有」と返す。それ以外は「混み合っています」で、
  console に残す
- 組み直し (`calendarPlanFor_`) は、**先に新しい予定を全部入れてから**、これから始まる古い予定 (始まり > 今) を消す。
  途中で書けなくなったら入れたぶんを消し、古いものを残す (半端に入れ替わらない)。いま続いている予定 (始まり ≤ 今 < 終わり)
  は残し、ほかの予定と同じく埋まっている時間として扱う
- 埋まっている時間は本人の**既定のカレンダー**と、**共有カレンダーの会議** (番頭の印の無い予定と、ほかの人の番頭の予定のうち
  本人がゲストのもの) から読む (`calendarBusyOf_`)。終日・断った (`GuestStatus.NO`)・空き (`getTransparency()` が
  `TRANSPARENT`。口が無ければ見分けない) を除く。ほかに登録しているカレンダーは見ない
- 「やることを予定に入れる」をオフにすると (`apiPrefSet` が `calendar.plan` を true 以外にしたとき)、`calendarClearMine_` が
  これから先の番頭の予定を1件ずつ消し、消せなかった数を返す (`apiPrefSet` の返事の `calendarLeft`。画面は設定の欄に残す)。
  `CAL_PLANNED` は必ず消す。消せなくても設定は戻さない (通知と同じ扱い。`typeof` で見るのは、Prefs.gs だけを読む
  テストでも動くように)
- **台帳には書かない。** カレンダーが記録。Calendar の読み書きは鍵の外で行う。最後に組んだときだけスクリプトプロパティ
  `CAL_PLANNED:<小文字のアドレス>` (`{day, at, ok, running}`) に覚え、ホームの自動の組み直しは1日1回。**組めた日 (`ok`) だけ**
  数える (`calendarPlannedOn_`。組めなかった日は次に開いたときにもう一度試す)。`running` の印を付け外しする間だけ鍵を取る

## 共有カレンダー

- チームの設定 `calendar.shared` (型 `calendar`。値は ID、`''` は決まっていない)。画面の汎用の欄には出さず、
  `js-calendar` の `makeCalendarTeamField` が組む。**書くのは `apiPrefSet` だけ** のまま (`apiCalendarCreateShared` /
  `apiCalendarSetShared` も最後は `apiPrefSet` を呼ぶ)
- 作るのは押した管理者のカレンダーの中 (`CalendarApp.createCalendar`)。貼るときは押した管理者が開けるかを確かめる
- `getCalendarById` は、共有されていてもまだ登録 (購読) していない人には null を返す。開くときは `subscribeToCalendar`
  してから取り直す (`calendarOpenShared_`)
- 書けるかを尋ねる口は CalendarApp に無い。`apiCalendarStatus().canWrite` は「持ち主か、最後に組んだときに書けたか」
- 共有の相手を足す頁は `calendarSettingsUrl_` (`/calendar/u/0/r/settings/calendar/<ID の web-safe な base64、末尾の = なし>`)。
  実機で形を確かめていないので、`debugVerifyCalendar()` が INFO の行に出す (開いて確かめる)。手引きには開かないときの
  辿り方も書いてある。管理者にだけ返す
- `apiCalendarStatus` は登録 (購読) しに行かない (`calendarOpenShared_(false)`)。開くたびに登録を試さないため。登録は組み直すとき

## 画面

- 自分の設定の「予定に入れる」の節の下に、様子・「予定を組み直す」・最後に組んだ時刻・「カレンダーで開く」
  (`makeCalendarMinePanel`)。チームの設定に作る・貼る・外す・共有の相手を足す (`makeCalendarTeamField`)
- ホームの `#home-calendar` は `prefs.effective.calendar.plan` がオンのときだけ `apiCalendarToday` を呼ぶ。
  その日にまだ組めていなければ (`plannedToday: false`) 1回だけ `apiCalendarPlan({auto: true})` を黙って呼び (`failQuiet`)、
  済んだら `apiCalendarToday` を取り直して描く (続いている予定・直した予定も出すため)。
  画面の側でも日ごとに1回に絞る (`calendarAutoDay`)。**オフのあいだは何も呼ばない**
- 返事は `latest('calendar')` で見分ける (ホームを開き直したときの古い返事で描き直さない)
