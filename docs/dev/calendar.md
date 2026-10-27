# やることを予定に入れる (カレンダー)

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。
対象: `src/core/CalendarPlan.js` / `src/core/CalendarSync.gs` / `src/core/MeetingNotes.js` / `src/core/MeetingNotesImport.gs` /
`src/api/Calendar.gs` / `src/ui/js-calendar.html`。手引きは
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

## 会議の時間 (自分まわりの欄)

やること #100。自分の設定 `calendar.meetings` (既定オフ) の人に、本人の既定のカレンダーの会議の時間を今週・今月・今半期で出す。

- **期間の切り方と足し方はピュア** (`CalendarPlan.js` の `meetingPeriodsOf` / `meetingMinutesIn` / `meetingHoursOfMinutes`)。
  始まりは東京の暦日の0時 (週は月曜、月は1日、半期は 4/1 か 10/1。1〜3月は前の年の 10/1)、**終わりは今** (済んだぶんだけ。
  これからの会議は入れない)。重なりは `calendarMerge` で潰してから期間で切って足す (同じ時間の会議が2つなら1つ分)
- **会議の決まり** (`meetingCounts_`): 終日でない・`getMyStatus()` が `NO` でない・**本人が予定に居る**・参加者が本人を含めて2人以上。
  参加者は `getGuestList(true)` (主催者も入れる。実機の `getGuestList()` は主催者を入れないので、人から呼ばれた会議が「ゲストは自分だけ」に
  見える) を小文字のアドレスで数える。本人はそこに居るか、作った人 (`getCreators()`) のときだけ数える (取り込んだ・写した予定で
  相手だけが居るものを会議にしない。以前は本人を無条件に足していた)。「空き」(透過) は見ない (埋まっている時間の `calendarCountsAsBusy_` とは別)
- **読むのは本人の既定のカレンダーだけ** (`meetingHoursOf_`)。共有カレンダー・ほかの人のカレンダーは読まない。返すのは
  `{week, month, half, since, until, count}` (時間は小数1桁、since / until は東京の暦日、count は半期の会議の数) だけで、
  題名・相手・時刻は返さず、台帳にもスクリプトプロパティにも書かない
- **読み始めは週と半期の早いほう** (`Math.min(p.week, p.half)`)。4/1 が木曜なら週は 3/29 から始まり、半期から読むと週の合計が
  足りなくなる。半期の数 (`count`) には、半期の始まりより前に終わった会議を入れない
- 半期ぶんを読むので重い。スクリプトのキャッシュに `MEETING:<東京の暦日>:<アドレスの SHA-256 の16進>` (`meetingCacheKey_`) で
  `MEETING_CACHE_SEC_()` (1800秒) 覚える (中身は数だけ。暦日を鍵に入れて、日が変われば期間ごと取り直す。アドレスを指紋にするのは、
  長いアドレスで鍵の上限 250 字を超えると覚えが効かなくなるため)。**書く前にもう一度見て、別の実行が先に覚えていれば上書きしない**
  (同じ人の2つの実行が並んだとき、後から終わった古い読みで戻さない。台帳の鍵 `dbWithLock_` には相乗りしない)。
  **読めない (権限・エラー) ときは覚えず null** を返し、断らない
- 口は `apiMeetingHours` (アドレスを受けない)。設定がオフなら**カレンダーを開かずに** null。画面 (`js-calendar` の
  `makeMeetingHoursBox`、置くのは `js-me` の `drawMe`) は**自分まわりの欄を開いたときだけ**呼び (開いた直後には呼ばない)、
  オフなら呼ばない。null なら欄を隠したまま。設定が届く前に欄を開いたときは、届いたとき (`calendarPrefsChanged` →
  `meetingHoursPrefsChanged`) に会議の欄だけを足す (欄の全体は描き直さない。描くたびに `apiGameState` を取るため)。テストは `test/meeting-hours.test.js` と `test/component/meeting-hours.test.js`

## Gemini のメモの取り込み

やること #97。会議の Gemini のメモ (Drive に置かれる Google ドキュメント) から、決まったこと (次のステップ) をやることにする。
読み方 (ピュア) は `src/core/MeetingNotes.js`、探す・開く・作るのは `src/core/MeetingNotesImport.gs`、口は `apiMeetingNotesImport(days, opts)`
(`src/api/Calendar.gs`) と命令 `meetingNotesImport`。テストは `test/meeting-notes.test.js` と `test/component/meeting-notes.test.js`。

- **外の API は使わない。** 標準の DriveApp (`searchFiles`)・DocumentApp (`openById(id).getBody()`)・CalendarApp (既定のカレンダー) だけ。
  どれも**開いている本人の権限**で見る (本人が開けるメモ = 本人のものと共有されたもの、と本人の既定のカレンダー)
- **探し方**: 直近 `days` 日 (既定7・上限14。`MEETING_NOTES_DAYS_()`) に更新された Google ドキュメントのうち、題名に `Gemini` を含むものを
  Drive で探し (`modifiedDate >` と `title contains 'Gemini'`)、題名の印で絞る (`meetingNoteIsGemini`)。1回に読むのは
  `MEETING_NOTES_MAX_DOCS_()` (20) 件まで。**Gemini のメモは Workspace の機能**なので、個人の Gmail では1つも見つからず何も起きない
- 題名の印 (`MEETING_NOTE_TITLE_MARKS()`。Workspace の言語の設定で変わる): `Notes by Gemini` / `Gemini によるメモ` / `Gemini のメモ` /
  `Gemini メモ` / `Notas de Gemini` / `Notizen von Gemini` / `Notes de Gemini`
- 見出しの印 (`MEETING_NOTE_STEP_HEADS()`): `Suggested next steps` / `Next steps` / `Action items` / `推奨される次のステップ` /
  `次のステップ` / `アクション アイテム` / `アクションアイテム` / `次にやること`。節を閉じる見出し (`MEETING_NOTE_OTHER_HEADS()`):
  `Summary` / `Details` / `Transcript` / `まとめ` / `概要` / `詳細` / `文字起こし`。**印を足すのは MeetingNotes.js の表だけ**で、ここも直す
- 字の比べ方は `meetingNoteNorm` (NFKC・小文字・空白と記号を落とす) だけを通す
- **結び付け** (`meetingNoteMatchEvent`): 本人の既定のカレンダーの、探す日数 + 1日ぶんの終日でない予定から、題名に予定の名前
  (2字以上) が入っていて、題名の日 (`2026/10/27` の形。`meetingNoteDayOf`) に始まった予定 (題名に日が無ければ、メモを作った時刻が
  始まりの2時間前〜終わりの24時間後に入る予定) のうち、メモの時刻に終わりがいちばん近いもの。**結び付かなければ会議不明**
  (やることは作るが、`meeting_notes` の会議名・始まり・長さは空)
- **読み取り** (`meetingNoteSteps`): 見出しの印の段落の次から、見出しの書式の段落か閉じる印までの段落を1行ずつ。箇条書きを拾ったあとに
  箇条書きでない段落が来たらそこで閉じる (節の終わりの添え書きを拾わない)。「Gemini」を含む行 (Gemini 自身の添え書き) と同じ行は
  拾わない。1つのメモから `MEETING_NOTE_MAX_STEPS()` (20) 行まで。題名は `MEETING_NOTE_TITLE_MAX()` (120) 字で切り、元の行は本文に入れる
- **担当** (`meetingNoteAssigneeNames` → `meetingNoteAssigneeOf`): 「@名前」「名前:」「[名前]」「名前さんが / は」「Name will」から
  候補を拾い、台帳の members の名前 (空白を見ない) に当てる。同じ名前の人が1人か、名前が候補で始まる人が1人のときだけ当てる。
  当たらなければ取り込んだ本人
- やることの本文: 会議名・日時 (東京)・長さ・メモの URL・元の行。作り方は画面と同じ (作る → ボードの未着手 → 担当)
- **二度取り込まない**: 台帳 `meeting_notes` (文書の id ごとに1行)。先に覚えから見て取り込み済みのメモは開かず、
  **鍵 (`dbWithLock_`) の中で「あるか見てから書く」**(`meetingNotesClaim_`) で印の行を足してから、鍵の外でやることを作り、
  作り終えたら番号を書き足す (何件も作るので、鍵を長く持たない)。途中で落ちても同じメモからは二度作らない (作れなかった行は残らない)。
  ほかの人が取り込んだメモも取り込み済み。**開けないメモは印を付けずに飛ばす** (開けるようになれば次に取り込む)
- 既にあるやること (捨てたもの・済んだものも) と題名が同じ (`meetingNoteNorm` で比べる) 行は作らず、取り込み済みに数える
- 返事は `{ok, reason, skipped, found, notes, created, already, unmatched, items}`。`found` は見つけたメモ、`notes` はこの回に取り込んだ
  メモ、`already` は取り込み済みのメモと同じ題名の行の合計。Drive を探せないときは断らずに `ok: false`
- **入口**: 設定の「予定に入れる」の節の「Gemini のメモを取り込む」(`makeMeetingNotesPanel`。予定に入れるがオフでも出す)。
  開いたときの急がない波 (`bootLater(meetingNotesAuto)`) で `{auto: true}`。自動は本人の UserProperties の `MNOTES_AUTO:<アドレス>`
  (東京の暦日) で1日1回 (探す前に印を付ける。落ちてもその日は探し直さない)。**自分の設定 `calendar.meetingNotes` (既定オン) がオフなら
  自動は走らない** (画面は呼ばず、サーバも `{auto: true}` なら Drive を探さずに `skipped`)。切り替えはボタンの隣 (`docs/dev/prefs.md`)。
  自動でやることを1つ以上作ったときだけ短い帯 (「Gemini のメモから N 個のやることを作りました」) で知らせ、0個なら何も出さない。
  失敗は `failQuiet`。文書のリンクで開いたときはしない
- **命令 `meetingNotesImport`** (`args.days`) は、キューが仕掛けた人の権限で回り見える Drive と予定がその人のものなので、
  **置いた人が仕掛けた人のときだけ**取り込む (`meetingNotesForQueue_`。`COMMAND_PERSONAL_OPS()` に入れて、持ち主と最後に書いた人も
  見比べる)。ほかの人は画面のボタンを使う
- **会議の時間**: 結び付いた会議は `meeting_notes` に名前・始まり・長さ (分) が残る。会議の時間の欄 (`apiMeetingHours`) の `noted` は、
  今半期の会議のうち `meeting_notes` に同じ名前と始まりがある会議 (議事録のある会議) の時間 (`meetingNotesNotedKeys_`)。
  取り込んだら本人の会議の時間の覚え (`meetingCacheKey_`) を捨てる

## 画面

- 自分の設定の「予定に入れる」の節の下に、様子・「予定を組み直す」・最後に組んだ時刻・「カレンダーで開く」
  (`makeCalendarMinePanel`)。チームの設定に作る・貼る・外す・共有の相手を足す (`makeCalendarTeamField`)
- ホームの `#home-calendar` は `prefs.effective.calendar.plan` がオンのときだけ `apiCalendarToday` を呼ぶ。
  その日にまだ組めていなければ (`plannedToday: false`) 1回だけ `apiCalendarPlan({auto: true})` を黙って呼び (`failQuiet`)、
  済んだら `apiCalendarToday` を取り直して描く (続いている予定・直した予定も出すため)。
  画面の側でも日ごとに1回に絞る (`calendarAutoDay`)。**オフのあいだは何も呼ばない**
- 返事は `latest('calendar')` で見分ける (ホームを開き直したときの古い返事で描き直さない)

## 今日の予定を手元に渡す (命令 `calendarToday`)

やること #99「時間になったら会議に自動で入る」。GAS の画面からはタブを開く以外にできないので、知らせて開くのは手元の
VS Code 拡張 (`kit-vscode/`。`docs/dev/kit.md`) の役目で、番頭は今日の予定を渡すだけ。テストは `test/calendar-today.test.js`。

- `calendarTodayOf_(who)`: 東京の暦日に**始まる**予定を始まりの順に `{day, events: [{start, end, title, meetUrl, eventUrl}]}` で返す
  (始まり・終わりは ISO の字)。終日と、断った (`GuestStatus.NO`) 予定は除く。台帳にもプロパティにも書かない
- **キューは仕掛けた人の権限で回る** (画面の `executeAs: USER_ACCESSING` とは違う)。CalendarApp の既定のカレンダーは仕掛けた人のもの。
  置いた人 (`by`) が仕掛けた人 (`Session.getEffectiveUser()`) なら既定のカレンダー、ほかの人なら `getCalendarById(<置いた人のアドレス>)`
  (仕掛けた人に共有されて登録されているときだけ開ける) を読む。開けなければ断る。**仕掛けた人の予定をほかの人に返さない**
- 置いた人で決めるので `COMMAND_PERSONAL_OPS()` に入れてある (持ち主と最後に書いた人を見比べる)
- 会議の URL (`calendarMeetUrlOf_`) は場所を先に、無ければ説明から `https://meet.google.com/(lookup/)?<コード>` を拾う。拡張サービスの
  Calendar API は使わないので、**Meet の会議情報 (conferenceData) は読めない**。場所か説明に URL が書いてある予定だけ拾える
- 予定の URL (`calendarEventUrlOf_`) は `https://calendar.google.com/calendar/event?eid=<base64(id から @google.com を除いたもの + ' ' + カレンダーの id)>`。
  繰り返しの予定は回ごとの id が取れないので null。実機で開くかは確かめていない
- **返事は台帳に無い中身 (今日の題名と会議の URL) を含む。** 手元が受け取って消すまで `queue/` を共有している人に見える
  (手引きの `docs/manual/command-queue.md` にも書いた)
