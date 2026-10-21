/**
 * やることを予定に入れる: Google カレンダーの読み書き。並べ方 (ピュア) は CalendarPlan.js。
 *
 * この Web アプリは executeAs: USER_ACCESSING で動くので、CalendarApp は**開いている本人のカレンダー**を見る。
 * 拡張サービス (Calendar API) は使わない (例外は Tasks と Drive だけ)。
 *
 * - 置くのはチームの共有カレンダー (calendar.shared) だけ。本人の既定のカレンダーは**読むだけ** (会議と重ねないため)
 * - **触るのは番頭がその人のために入れた予定だけ。** 入れた予定に印 (tag) を3つ付ける:
 *   banto = 'block'、bantoWho = 小文字のアドレス、bantoIssue = やることの番号。印の無い予定・ほかの人の予定は消さない
 * - 組み直すと、その人の**これから始まる**番頭の予定 (始まり > 今) を消して入れ直す。いま続いている予定は残す
 * - 台帳には何も書かない (カレンダーそのものが記録)。鍵 (dbWithLock_) も取らない
 * - 組んだ日はスクリプトプロパティ CAL_PLANNED:<小文字のアドレス> に覚え、自動では1日1回だけ組む
 * - 開けない・書けないときは、何をすればよいかを添えた理由を返す (投げない。ホームを壊さない)
 */

/** 作る共有カレンダーの名前 */
function CALENDAR_SHARED_NAME() {
  return '番頭の予定';
}

/** 番頭が入れた予定の印 */
function CALENDAR_TAG_() {
  return { kind: 'banto', kindValue: 'block', who: 'bantoWho', issue: 'bantoIssue' };
}

/** 番頭の予定を探す範囲 (今より前・後の日数)。並べる先 (最大10勤務日) を覆う */
function CALENDAR_SCAN_DAYS_() {
  return { back: 1, ahead: 21 };
}

/** 今。通しのテストが差し替える (時刻で入る予定が変わるため) */
function calendarNow_() {
  return new Date();
}

/** 共有カレンダーの id。決まっていなければ '' */
function calendarSharedId_() {
  return String(prefGet_('calendar.shared') || '');
}

/**
 * カレンダーの設定の頁 (共有の相手を足すところ)。id を base64 にした形 (末尾の = は付けない)。
 *
 * @param {string} id
 * @returns {string}
 */
function calendarSettingsUrl_(id) {
  if (!id) return '';
  var b64 = String(Utilities.base64Encode(String(id))).replace(/=+$/, '');
  return 'https://calendar.google.com/calendar/r/settings/calendar/' + b64;
}

/**
 * カレンダーを開く頁。cid を付けると、まだ登録していない人には登録 (購読) を勧める画面が出る。
 *
 * @param {string} id
 * @returns {string}
 */
function calendarOpenUrl_(id) {
  if (!id) return '';
  return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(id);
}

/**
 * 共有カレンダーを開く。まだ登録していない人は登録する (getCalendarById は登録していないと null を返す)。
 *
 * @returns {{cal: ?object, id: string, reason: string}}
 */
function calendarOpenShared_() {
  var id = calendarSharedId_();
  if (!id) {
    return { cal: null, id: '', reason: '予定を入れる共有カレンダーがまだ決まっていません。' +
      '管理者に、設定の「チームの設定」→「予定に入れる」で共有カレンダーを作ってもらってください' };
  }
  var cal = null;
  try {
    cal = CalendarApp.getCalendarById(id);
    if (!cal) {
      CalendarApp.subscribeToCalendar(id);
      cal = CalendarApp.getCalendarById(id);
    }
  } catch (e) {
    cal = null;
  }
  if (!cal) {
    return { cal: null, id: id, reason: '共有カレンダー「' + CALENDAR_SHARED_NAME() + '」を開けません。' +
      '管理者に、あなたのアドレスを「予定の変更」の権限で共有してもらってください' };
  }
  return { cal: cal, id: id, reason: '' };
}

/** 書けなかったときの理由 */
function calendarNoWriteReason_() {
  return '共有カレンダー「' + CALENDAR_SHARED_NAME() + '」に予定を入れられません (見るだけの共有になっています)。' +
    '管理者に、あなたのアドレスを「予定の変更」の権限で共有し直してもらってください';
}

/**
 * その人の、予定に入れる設定。
 *
 * @param {string} who 小文字のアドレス
 * @returns {{plan: boolean, hours: {start: string, end: string}, weekend: boolean, blockMin: number,
 *   days: number, title: string}}
 */
function calendarSettingsOf_(who) {
  var read = prefReaderLive_();
  function get(key) { return prefValueOf_(prefItem_(key), who, read).value; }
  var hours = String(get('calendar.hours')).split('-');
  return {
    plan: get('calendar.plan') === true,
    hours: { start: hours[0], end: hours[1] },
    weekend: get('calendar.weekend') === true,
    blockMin: Number(get('calendar.block')) || 45,
    days: Number(get('calendar.days')) || 5,
    title: String(get('calendar.title')),
  };
}

/**
 * 予定の印がその人の番頭の予定か。
 *
 * @param {object} ev CalendarEvent
 * @param {string} who 小文字のアドレス
 * @returns {boolean}
 */
function calendarIsMine_(ev, who) {
  var tag = CALENDAR_TAG_();
  try {
    return ev.getTag(tag.kind) === tag.kindValue && String(ev.getTag(tag.who) || '') === who;
  } catch (e) {
    return false;
  }
}

/**
 * 共有カレンダーにある、その人の番頭の予定。
 *
 * @param {object} cal
 * @param {string} who
 * @param {number} from ミリ秒
 * @param {number} to ミリ秒
 * @returns {object[]} CalendarEvent
 */
function calendarMineIn_(cal, who, from, to) {
  return cal.getEvents(new Date(from), new Date(to)).filter(function (ev) { return calendarIsMine_(ev, who); });
}

/**
 * 本人の既定のカレンダーの埋まっている時間。終日の予定と、断った予定は数えない。
 *
 * @param {number} from
 * @param {number} to
 * @returns {Array<{start: number, end: number}>}
 */
function calendarBusyOf_(from, to) {
  var events;
  try {
    events = CalendarApp.getDefaultCalendar().getEvents(new Date(from), new Date(to));
  } catch (e) {
    return [];
  }
  var no = CalendarApp.GuestStatus && CalendarApp.GuestStatus.NO;
  var out = [];
  events.forEach(function (ev) {
    if (ev.isAllDayEvent()) return;
    try {
      if (no && ev.getMyStatus() === no) return;
    } catch (e) { /* 分からなければ埋まっているものとする */ }
    out.push({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() });
  });
  return out;
}

/**
 * その人が担当のやること (開いているもの・捨てていないもの) を、並べる形にする。
 *
 * @param {string} who
 * @param {number} blockMin
 * @returns {Array<{number: number, title: string, minutes: number, due: string, rank: number}>}
 */
function calendarTasksOf_(who, blockMin) {
  var out = [];
  issueList('open').forEach(function (row) {
    var heads = issueAssignees(row).map(function (a) { return a.toLowerCase(); });
    if (heads.indexOf(who) < 0) return;
    out.push({
      number: Number(row.number),
      title: String(row.title || ''),
      minutes: calendarMinutesFor({ plannedHours: row.plannedHours, actualHours: row.actualHours, heads: heads.length },
        blockMin),
      due: plainDay(row.dueDate),
      rank: issuePriorityRank_(row),
    });
  });
  return out;
}

/** 組んだ日の覚え書きの鍵 */
function calendarPlannedKey_(who) {
  return 'CAL_PLANNED:' + String(who || '').toLowerCase();
}

/**
 * 最後に組んだとき。
 *
 * @param {string} who
 * @returns {{day: string, at: string, ok: boolean}}
 */
function calendarPlannedOf_(who) {
  var raw = PropertiesService.getScriptProperties().getProperty(calendarPlannedKey_(who));
  var v = prefParse_(raw);
  if (!v || typeof v !== 'object') return { day: '', at: '', ok: false };
  return { day: String(v.day || ''), at: String(v.at || ''), ok: v.ok === true };
}

/**
 * 予定の名前。
 *
 * @param {object} task
 * @param {string} style 'task' | 'generic'
 * @returns {string}
 */
function calendarTitleOf_(task, style) {
  if (style === 'generic') return '集中 (番頭)';
  return '#' + task.number + ' ' + task.title;
}

/**
 * 予定の説明。
 *
 * @param {object} task
 * @returns {string}
 */
function calendarDescriptionOf_(task) {
  var url = '';
  try {
    url = String(ScriptApp.getService().getUrl() || '');
  } catch (e) { /* 分からなければ書かない */ }
  return 'やること #' + task.number + (url ? '\n' + url : '') + '\n\n番頭が組んだ予定です。組み直すと変わります';
}

/**
 * 画面に渡す1件。
 *
 * @param {{issueNumber: number, start: number, end: number}} b
 * @param {Object<number, string>} titles
 * @returns {{issueNumber: number, title: string, start: string, end: string}}
 */
function calendarPlainBlock_(b, titles) {
  return {
    issueNumber: plainNumber(b.issueNumber),
    title: plainText(titles[b.issueNumber] || ''),
    start: plainDate(new Date(b.start)),
    end: plainDate(new Date(b.end)),
  };
}

/**
 * その人のやることを組み直す。
 *
 * 先に新しい予定を全部入れ、入れ終わってから古い (これから始まる) 予定を消す。途中で書けなくなったら、
 * 入れたぶんを消して古いものを残す (半端に入れ替わった予定を作らない)。
 *
 * @param {string} who 小文字のアドレス
 * @param {Date} [now]
 * @returns {{ok: boolean, reason: string, blocks: object[], late: object[], unplaced: object[]}}
 */
function calendarPlanFor_(who, now) {
  var at = now || calendarNow_();
  var empty = { ok: false, reason: '', blocks: [], late: [], unplaced: [] };
  if (!who) { empty.reason = '誰の予定か分かりません'; return empty; }
  var set = calendarSettingsOf_(who);
  if (!set.plan) {
    empty.reason = '「やることを予定に入れる」がオフです。設定の「自分の設定」→「予定に入れる」でオンにしてください';
    return empty;
  }
  var opened = calendarOpenShared_();
  if (!opened.cal) { empty.reason = opened.reason; return empty; }
  var cal = opened.cal;

  var nowMs = at.getTime();
  var scan = CALENDAR_SCAN_DAYS_();
  var from = nowMs - scan.back * 86400000;
  var to = nowMs + scan.ahead * 86400000;

  var mine = calendarMineIn_(cal, who, from, to);
  var keep = [];
  var old = [];
  mine.forEach(function (ev) {
    var s = ev.getStartTime().getTime();
    var e = ev.getEndTime().getTime();
    if (s > nowMs) old.push(ev);
    else if (e > nowMs) keep.push({ start: s, end: e });
  });

  var tasks = calendarTasksOf_(who, set.blockMin);
  var titles = {};
  var byNumber = {};
  tasks.forEach(function (t) { titles[t.number] = t.title; byNumber[t.number] = t; });

  var plan = calendarPlanBlocks({
    tasks: tasks, busy: calendarBusyOf_(nowMs, to).concat(keep), now: nowMs, hours: set.hours,
    weekend: set.weekend, blockMin: set.blockMin, days: set.days,
  });

  var tag = CALENDAR_TAG_();
  var made = [];
  try {
    plan.blocks.forEach(function (b) {
      var task = byNumber[b.issueNumber];
      var ev = cal.createEvent(calendarTitleOf_(task, set.title), new Date(b.start), new Date(b.end),
        { description: calendarDescriptionOf_(task) });
      made.push(ev);
      ev.setTag(tag.kind, tag.kindValue);
      ev.setTag(tag.who, who);
      ev.setTag(tag.issue, String(b.issueNumber));
    });
  } catch (e) {
    made.forEach(function (ev) {
      try { ev.deleteEvent(); } catch (e2) { /* 消せなければ残る。次に組み直すと印で見つかる */ }
    });
    calendarPlannedWrite_(who, at, false);
    empty.reason = calendarNoWriteReason_();
    return empty;
  }
  old.forEach(function (ev) {
    try { ev.deleteEvent(); } catch (e) { /* 消せなかった古い予定は次に組み直すときに消す */ }
  });
  calendarPlannedWrite_(who, at, true);

  return {
    ok: true,
    reason: '',
    blocks: plan.blocks.map(function (b) { return calendarPlainBlock_(b, titles); }),
    late: plan.late.map(function (n) {
      return { number: plainNumber(n), title: plainText(titles[n] || ''), due: plainText(byNumber[n].due) };
    }),
    unplaced: plan.unplaced.map(function (u) {
      return { number: plainNumber(u.issueNumber), title: plainText(titles[u.issueNumber] || ''),
        minutes: plainNumber(u.minutes) };
    }),
  };
}

/**
 * 組んだ日を覚える。
 *
 * @param {string} who
 * @param {Date} at
 * @param {boolean} ok
 */
function calendarPlannedWrite_(who, at, ok) {
  PropertiesService.getScriptProperties().setProperty(calendarPlannedKey_(who), JSON.stringify({
    day: calendarDayOf(at.getTime()), at: at.toISOString(), ok: !!ok,
  }));
}

/**
 * その人の、これから始まる番頭の予定を消す (予定に入れるのをやめたとき)。
 *
 * @param {string} who
 * @param {Date} [now]
 * @returns {number} 消した数
 */
function calendarClearMine_(who, now) {
  var me = String(who || '').toLowerCase();
  if (!me || !calendarSharedId_()) return 0;
  var opened = calendarOpenShared_();
  if (!opened.cal) return 0;
  var nowMs = (now || calendarNow_()).getTime();
  var n = 0;
  calendarMineIn_(opened.cal, me, nowMs, nowMs + CALENDAR_SCAN_DAYS_().ahead * 86400000).forEach(function (ev) {
    if (ev.getStartTime().getTime() <= nowMs) return;
    ev.deleteEvent();
    n++;
  });
  PropertiesService.getScriptProperties().deleteProperty(calendarPlannedKey_(me));
  return n;
}

/**
 * その人の今日の番頭の予定 (東京の暦日)。
 *
 * @param {string} who
 * @param {Date} [now]
 * @returns {{ok: boolean, reason: string, blocks: object[]}}
 */
function calendarTodayFor_(who, now) {
  var opened = calendarOpenShared_();
  if (!opened.cal) return { ok: false, reason: opened.reason, blocks: [] };
  var nowMs = (now || calendarNow_()).getTime();
  var start = calendarDayStart(calendarDayOf(nowMs));
  var tag = CALENDAR_TAG_();
  var titles = {};
  issueList('').forEach(function (row) { titles[Number(row.number)] = String(row.title || ''); });
  var blocks = calendarMineIn_(opened.cal, who, start, start + 86400000).map(function (ev) {
    return {
      issueNumber: Number(ev.getTag(tag.issue)) || 0,
      start: ev.getStartTime().getTime(),
      end: ev.getEndTime().getTime(),
    };
  });
  blocks.sort(function (a, b) { return a.start - b.start; });
  return { ok: true, reason: '', blocks: blocks.map(function (b) { return calendarPlainBlock_(b, titles); }) };
}
