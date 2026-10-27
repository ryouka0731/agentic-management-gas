/**
 * やることを予定に入れる (Web App API)。中身は src/core/CalendarSync.gs と CalendarPlan.js。
 *
 * - apiCalendarPlan / apiCalendarToday / apiCalendarStatus は開いている本人のぶんだけを扱い、アドレスを受けない
 * - 共有カレンダーを作る・貼るのは管理者だけ (apiCalendarCreateShared / apiCalendarSetShared)。書くのは apiPrefSet
 * - 開けない・書けないときは投げずに {ok: false, reason} を返す (ホームを壊さない)
 */

/**
 * いま組み直す (Web App API)。手で押したときは60秒に1回まで (waitSeconds を添えて断る)。
 * ホームのカードは {auto: true} で呼ぶ。そのときはサーバが組み直し中の印の中で、その日にもう組めたかを見直し、
 * 組めていれば何もしない (skipped)。別の画面が組んでいる最中なら断る。
 *
 * @param {{auto?: boolean}} [opts]
 * @returns {{ok: boolean, reason: string, blocks: object[], late: object[], unplaced: object[],
 *   calendarUrl: string, lastPlanned: string}}
 */
function apiCalendarPlan(opts) {
  var who = currentEmailLower_();
  // 画面から渡せるのは auto だけ (60秒の待ちを外す口は渡さない)
  var out = calendarPlanFor_(who, null, { auto: !!(opts && opts.auto === true) });
  out.calendarUrl = plainText(calendarOpenUrl_(calendarSharedId_()));
  out.lastPlanned = plainText(calendarPlannedOf_(who).at);
  return out;
}

/**
 * 今日の番頭の予定 (Web App API)。ホームのカードが読む。plannedToday が false なら、画面が1回だけ組み直す。
 *
 * @returns {{enabled: boolean, ok: boolean, reason: string, plannedToday: boolean, blocks: object[],
 *   calendarUrl: string}}
 */
function apiCalendarToday() {
  var who = currentEmailLower_();
  var on = calendarSettingsOf_(who).plan;
  var out = { enabled: on, ok: false, reason: '', plannedToday: false, blocks: [],
    calendarUrl: plainText(calendarOpenUrl_(calendarSharedId_())) };
  // オフのあいだはカレンダーを開かない
  if (!on) return out;
  // 組めた日だけ数える (組めなかった日は、次に開いたときにもう一度試す)
  out.plannedToday = calendarPlannedOn_(calendarPlannedOf_(who), calendarNow_().getTime());
  var today = calendarTodayFor_(who);
  out.ok = today.ok;
  out.reason = plainText(today.reason);
  out.blocks = today.blocks;
  return out;
}

/**
 * 会議の時間 (Web App API)。自分まわりの欄を開いたときに、自分の設定 calendar.meetings がオンの人だけが呼ぶ。
 * 本人の既定のカレンダーだけを読み、数と期間だけを返す (題名・相手は返さない)。アドレスは受けない。
 * オフ・読めないときは null (断らない。画面は欄を出さない)。
 *
 * @returns {?{week: number, month: number, half: number, since: string, until: string, count: number}}
 */
function apiMeetingHours() {
  var who = currentEmailLower_();
  if (!who) return null;
  if (prefValueOf_(prefItem_('calendar.meetings'), who, prefReaderLive_()).value !== true) return null;
  var out = meetingHoursOf_(who);
  if (!out) return null;
  return {
    week: plainNumber(out.week),
    month: plainNumber(out.month),
    half: plainNumber(out.half),
    since: plainText(out.since),
    until: plainText(out.until),
    count: plainNumber(out.count),
  };
}

/**
 * 予定に入れる様子 (Web App API)。設定の画面の小さな欄が読む。
 *
 * canWrite は持ち主か、最後に組んだときに書けたか (実機の CalendarApp には「書けるか」を尋ねる口が無い)。
 * settingsUrl (共有の相手を足す頁) は管理者にだけ返す。
 *
 * @returns {object}
 */
function apiCalendarStatus() {
  var who = currentEmailLower_();
  var id = calendarSharedId_();
  var last = calendarPlannedOf_(who);
  var admin = repoIsAdmin_(currentEmail_());
  var out = {
    enabled: calendarSettingsOf_(who).plan,
    sharedSet: !!id,
    sharedName: '',
    canOpen: false,
    canWrite: false,
    reason: '',
    lastPlanned: plainText(last.at),
    lastOk: last.ok,
    calendarUrl: plainText(calendarOpenUrl_(id)),
    settingsUrl: admin ? plainText(calendarSettingsUrl_(id)) : '',
    isAdmin: admin,
  };
  // 様子を見るだけなので登録 (購読) はしに行かない。登録は組み直すときにする
  var opened = calendarOpenShared_(false);
  out.reason = plainText(opened.reason);
  if (!id) return out;
  if (opened.cal) {
    out.canOpen = true;
    out.sharedName = plainText(opened.cal.getName());
    var owned = false;
    try { owned = opened.cal.isOwnedByMe(); } catch (e) { owned = false; }
    out.canWrite = owned || last.ok;
  }
  return out;
}

/**
 * 共有カレンダー「番頭の予定」を作り、チームの設定に入れる (Web App API。管理者だけ)。
 * 作るのは押した管理者のカレンダーの中。ほかの人には、返す settingsUrl の頁で「予定の変更」の権限で共有する。
 *
 * @returns {object} apiCalendarStatus
 */
function apiCalendarCreateShared() {
  repoAssertAdmin_('共有カレンダーを作ること');
  var id = calendarSharedId_();
  if (id && calendarOpenShared_(false).cal) {
    throw new Error('共有カレンダーはもうあります。作り直すときは、先に「外す」を押してください');
  }
  var cal = CalendarApp.createCalendar(CALENDAR_SHARED_NAME(), {
    summary: '番頭が、やることを組んで入れる予定です。組み直すと変わります',
  });
  apiPrefSet('calendar.shared', String(cal.getId()));
  return apiCalendarStatus();
}

/**
 * あるカレンダーを共有カレンダーにする (Web App API。管理者だけ)。空なら外す。
 * 押した管理者がそのカレンダーを開けるかを確かめてから入れる。
 *
 * @param {string} id
 * @returns {object} apiCalendarStatus
 */
function apiCalendarSetShared(id) {
  repoAssertAdmin_('共有カレンダーを決めること');
  var v = String(id || '').replace(/^\s+|\s+$/g, '');
  if (!v) {
    apiPrefSet('calendar.shared', null);
    return apiCalendarStatus();
  }
  if (!prefValid_(prefItem_('calendar.shared'), v, '')) {
    throw new Error('カレンダーの ID の形ではありません (…@group.calendar.google.com の形です)');
  }
  var cal = null;
  try {
    cal = CalendarApp.getCalendarById(v) || CalendarApp.subscribeToCalendar(v);
  } catch (e) {
    cal = null;
  }
  if (!cal) {
    throw new Error('そのカレンダーを開けません。あなたが開けるカレンダーの ID を貼ってください');
  }
  apiPrefSet('calendar.shared', v);
  return apiCalendarStatus();
}
