/**
 * やることを予定に入れる: Google カレンダーの読み書き。並べ方 (ピュア) は CalendarPlan.js。
 *
 * この Web アプリは executeAs: USER_ACCESSING で動くので、CalendarApp は**開いている本人のカレンダー**を見る。
 * 拡張サービス (Calendar API) は使わない (例外は Tasks と Drive だけ)。
 *
 * - 置くのはチームの共有カレンダー (calendar.shared) だけ。本人の既定のカレンダーは**読むだけ** (会議と重ねないため)
 * - 埋まっている時間は、既定のカレンダーと共有カレンダーの会議 (番頭の印の無い予定と、ほかの人の番頭の予定のうち
 *   ゲストになっているもの) から読む。終日・断った・「空き」(透過) の予定は数えない
 * - **触るのは番頭がその人のために入れた予定だけ。** 入れた予定に印 (tag) を3つ付ける:
 *   banto = 'block'、bantoWho = 小文字のアドレス、bantoIssue = やることの番号。説明の最後の行にも「番頭: <アドレス> #<番号>」と
 *   書く (印を付ける前に打ち切られた予定も、次に組み直すときに見つけて消せるように)。印の無い予定・ほかの人の予定は消さない
 * - 組み直すと、その人の**これから始まる**番頭の予定 (始まり > 今) を消して入れ直す。いま続いている予定と、
 *   人が直した予定 (動かした・名前を変えた・ゲストを足した) は残し、埋まっている時間として避ける
 * - 台帳には何も書かない (カレンダーそのものが記録)
 * - 組んだ日はスクリプトプロパティ CAL_PLANNED:<小文字のアドレス> に覚え、自動では1日1回だけ組む (組めた日だけ数える)。
 *   **2つの画面で同時に組まない。** 組み始める前に鍵 (dbWithLock_) の中で「組み直し中」の印 (running。5分で切れる) を付け、
 *   印があれば断る。並べる・カレンダーに書くのは鍵の外、終わったら (落ちても) 印を外す。手で頼むのは60秒に1回まで
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

/** 手で頼むのを待ってもらう秒 */
function CALENDAR_COOLDOWN_SEC_() {
  return 60;
}

/** 組み直し中の印が切れるまでの分 (落ちても、この分が過ぎれば組める) */
function CALENDAR_CLAIM_MIN_() {
  return 5;
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
 * カレンダーの設定の頁 (共有の相手を足すところ)。id を web-safe な base64 にした形 (末尾の = は付けない)。
 *
 * @param {string} id
 * @returns {string}
 */
function calendarSettingsUrl_(id) {
  if (!id) return '';
  var b64 = String(Utilities.base64EncodeWebSafe(String(id))).replace(/=+$/, '');
  return 'https://calendar.google.com/calendar/u/0/r/settings/calendar/' + b64;
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
 * 共有カレンダーを開く。getCalendarById は、共有されていてもまだ登録 (購読) していない人には null を返すので、
 * subscribe のときは登録してから取り直す。様子を見るだけ (apiCalendarStatus) なら登録しない (開くたびに試さない)。
 *
 * @param {boolean} [subscribe] 既定 true
 * @returns {{cal: ?object, id: string, reason: string}}
 */
function calendarOpenShared_(subscribe) {
  var id = calendarSharedId_();
  if (!id) {
    return { cal: null, id: '', reason: '予定を入れる共有カレンダーがまだ決まっていません。' +
      '管理者に、設定の「チームの設定」→「予定に入れる」で共有カレンダーを作ってもらってください' };
  }
  var join = subscribe !== false;
  var cal = null;
  try {
    cal = CalendarApp.getCalendarById(id);
    if (!cal && join) {
      CalendarApp.subscribeToCalendar(id);
      cal = CalendarApp.getCalendarById(id);
    }
  } catch (e) {
    cal = null;
  }
  if (!cal && !join) {
    return { cal: null, id: id, reason: '共有カレンダー「' + CALENDAR_SHARED_NAME() + '」はまだあなたのカレンダーに' +
      '入っていません。「予定を組み直す」を押すと入れます。入れられないときは、管理者に、あなたのアドレスを' +
      '「予定の変更」の権限で共有してもらってください' };
  }
  if (!cal) {
    return { cal: null, id: id, reason: '共有カレンダー「' + CALENDAR_SHARED_NAME() + '」を開けません。' +
      '管理者に、あなたのアドレスを「予定の変更」の権限で共有してもらってください' };
  }
  return { cal: cal, id: id, reason: '' };
}

/** 書けなかったときの理由 (1件目から権限で断られたとき) */
function calendarNoWriteReason_() {
  return '共有カレンダー「' + CALENDAR_SHARED_NAME() + '」に予定を入れられません (見るだけの共有になっています)。' +
    '管理者に、あなたのアドレスを「予定の変更」の権限で共有し直してもらってください';
}

/** 書いている途中で断られたときの理由 (権限ではなさそうなとき) */
function calendarBusyReason_() {
  return 'カレンダーが混み合っています。あとでもう一度組み直してください';
}

/**
 * 権限で断られたように見えるか。
 *
 * @param {*} e
 * @returns {boolean}
 */
function calendarLooksDenied_(e) {
  return /not allowed|permission|denied|forbidden|insufficient|権限/i.test(String((e && e.message) || e));
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
 * 説明の最後の行に書く印。
 *
 * @param {string} who
 * @param {number} n
 * @returns {string}
 */
function calendarMarkerLine_(who, n) {
  return '番頭: ' + who + ' #' + n;
}

/**
 * 説明の最後の行の印を読む。無ければ null。
 *
 * @param {object} ev CalendarEvent
 * @returns {?{who: string, issue: number}}
 */
function calendarMarkerOf_(ev) {
  var text = '';
  try {
    text = String(ev.getDescription() || '');
  } catch (e) {
    return null;
  }
  var lines = text.split('\n');
  var m = /^番頭: (\S+@\S+) #(\d+)$/.exec(lines[lines.length - 1]);
  return m ? { who: m[1], issue: Number(m[2]) } : null;
}

/**
 * 番頭の予定なら、誰のものか (印か、説明の最後の行)。番頭の予定でなければ ''。
 *
 * @param {object} ev
 * @returns {string}
 */
function calendarBantoOwner_(ev) {
  var tag = CALENDAR_TAG_();
  try {
    if (ev.getTag(tag.kind) === tag.kindValue) return String(ev.getTag(tag.who) || '') || '?';
  } catch (e) { /* 印が読めなければ説明を見る */ }
  var mark = calendarMarkerOf_(ev);
  return mark ? mark.who : '';
}

/**
 * 予定がその人の番頭の予定か。印 (tag) か、説明の最後の行の印で見る。
 *
 * @param {object} ev CalendarEvent
 * @param {string} who 小文字のアドレス
 * @returns {boolean}
 */
function calendarIsMine_(ev, who) {
  return !!who && calendarBantoOwner_(ev) === who;
}

/**
 * 番頭の予定のやることの番号。
 *
 * @param {object} ev
 * @returns {number}
 */
function calendarIssueOf_(ev) {
  var n = 0;
  try {
    n = Number(ev.getTag(CALENDAR_TAG_().issue)) || 0;
  } catch (e) {
    n = 0;
  }
  if (n) return n;
  var mark = calendarMarkerOf_(ev);
  return mark ? mark.issue : 0;
}

/**
 * 人が直した番頭の予定か (動かした・名前を変えた・ゲストを足した)。直したものは組み直しでも消さない。
 * 作った直後に印を付けるぶん更新の時刻は動くので、作ってから1分より後に更新されたものを「直した」とする。
 *
 * @param {object} ev
 * @returns {boolean}
 */
function calendarEdited_(ev) {
  try {
    if ((ev.getGuestList() || []).length > 0) return true;
  } catch (e) { /* 読めなければ次を見る */ }
  try {
    return ev.getLastUpdated().getTime() > ev.getDateCreated().getTime() + 60000;
  } catch (e) {
    return false;
  }
}

/**
 * 「空き」(透過) の予定か。CalendarEvent.getTransparency が使えるときだけ見る (使えなければ埋まっているものとする)。
 *
 * @param {object} ev
 * @returns {boolean}
 */
function calendarTransparent_(ev) {
  if (typeof ev.getTransparency !== 'function') return false;
  try {
    var t = ev.getTransparency();
    var free = CalendarApp.EventTransparency && CalendarApp.EventTransparency.TRANSPARENT;
    return (free !== undefined && t === free) || String(t).toUpperCase() === 'TRANSPARENT';
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
 * 会議として数える予定か。終日・断った・空き (透過) の予定は数えない。
 *
 * @param {object} ev
 * @returns {boolean}
 */
function calendarCountsAsBusy_(ev) {
  if (ev.isAllDayEvent()) return false;
  if (calendarTransparent_(ev)) return false;
  var no = CalendarApp.GuestStatus && CalendarApp.GuestStatus.NO;
  try {
    if (no && ev.getMyStatus() === no) return false;
  } catch (e) { /* 分からなければ埋まっているものとする */ }
  return true;
}

/**
 * 埋まっている時間。本人の既定のカレンダーの予定と、共有カレンダーの会議 (番頭の印の無い予定と、
 * ほかの人の番頭の予定のうち本人がゲストのもの)。本人の番頭の予定は呼ぶ側が扱う。
 *
 * @param {number} from
 * @param {number} to
 * @param {object} [shared] 共有カレンダー
 * @param {string} [who]
 * @returns {Array<{start: number, end: number}>}
 */
function calendarBusyOf_(from, to, shared, who) {
  var out = [];
  function add(ev) {
    out.push({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() });
  }
  try {
    CalendarApp.getDefaultCalendar().getEvents(new Date(from), new Date(to)).forEach(function (ev) {
      if (calendarCountsAsBusy_(ev)) add(ev);
    });
  } catch (e) { /* 読めなければ既定のカレンダーの会議は避けられない */ }
  if (!shared) return out;
  shared.getEvents(new Date(from), new Date(to)).forEach(function (ev) {
    var owner = calendarBantoOwner_(ev);
    if (owner && owner === who) return;
    if (owner) {
      var guest = null;
      try {
        guest = ev.getGuestByEmail(who);
      } catch (e) {
        guest = null;
      }
      if (!guest) return;
    }
    if (calendarCountsAsBusy_(ev)) add(ev);
  });
  return out;
}

/**
 * その人が担当のやること (開いているもの・捨てていないもの) を、並べる形にする。
 *
 * @param {string} who
 * @param {number} blockMin
 * @returns {Array<{number: number, title: string, minutes: number, due: string, rank: number, who: string}>}
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
      who: who,
    });
  });
  return out;
}

/** 組んだ日の覚え書きの鍵 */
function calendarPlannedKey_(who) {
  return 'CAL_PLANNED:' + String(who || '').toLowerCase();
}

/**
 * 最後に組んだとき。running は組み直し中の印 (切れる時刻)。
 *
 * @param {string} who
 * @returns {{day: string, at: string, ok: boolean, running: string}}
 */
function calendarPlannedOf_(who) {
  var raw = PropertiesService.getScriptProperties().getProperty(calendarPlannedKey_(who));
  var v = prefParse_(raw);
  if (!v || typeof v !== 'object') return { day: '', at: '', ok: false, running: '' };
  return { day: String(v.day || ''), at: String(v.at || ''), ok: v.ok === true, running: String(v.running || '') };
}

/**
 * その日にもう組めたか (組めなかった日は数えない。次に開いたときにもう一度試す)。
 *
 * @param {{day: string, ok: boolean}} st
 * @param {number} nowMs
 * @returns {boolean}
 */
function calendarPlannedOn_(st, nowMs) {
  return st.ok && st.day === calendarDayOf(nowMs);
}

/** 別の画面が組んでいるときの断り */
function calendarClaimedReason_() {
  return '別の画面で組み直しています。少し待ってから開き直してください';
}

/**
 * 組み直し中の印を付ける。**鍵の中で、見ることと付けることを1つにする** (分けると2つの画面が両方付ける)。
 *
 * @param {string} who
 * @param {number} nowMs
 * @param {{auto?: boolean, cooldown?: boolean}} opts
 * @returns {{claimed: boolean, prev: ?object, skipped?: boolean, reason?: string, waitSeconds?: number}}
 */
function calendarClaim_(who, nowMs, opts) {
  var props = PropertiesService.getScriptProperties();
  return dbWithLock_(10000, function () {
    var st = calendarPlannedOf_(who);
    var running = Date.parse(st.running);
    if (!isNaN(running) && running > nowMs) return { claimed: false, prev: st, reason: calendarClaimedReason_() };
    // 自動の組み直しは、印の中で「今日もう組めたか」を見直す (画面が見たあとに別の画面が組んでいることがある)
    if (opts.auto && calendarPlannedOn_(st, nowMs)) return { claimed: false, prev: st, skipped: true };
    var last = Date.parse(st.at);
    var limit = CALENDAR_COOLDOWN_SEC_() * 1000;
    if (!opts.auto && opts.cooldown !== false && !isNaN(last) && nowMs >= last && nowMs - last < limit) {
      var wait = Math.ceil((limit - (nowMs - last)) / 1000);
      return { claimed: false, prev: st, waitSeconds: wait,
        reason: 'さっき組み直したところです。あと' + wait + '秒待ってから押してください' };
    }
    props.setProperty(calendarPlannedKey_(who), JSON.stringify({ day: st.day, at: st.at, ok: st.ok,
      running: new Date(nowMs + CALENDAR_CLAIM_MIN_() * 60000).toISOString() }));
    return { claimed: true, prev: st };
  }, function () {
    return { claimed: false, prev: null, reason: calendarClaimedReason_() };
  });
}

/**
 * 組み直し中の印を外し、結果を覚える。result が null なら前の記録に戻す (途中で落ちたとき)。
 *
 * @param {string} who
 * @param {object} prev calendarClaim_ の prev
 * @param {?{at: Date, ok: boolean}} result
 */
function calendarRelease_(who, prev, result) {
  var props = PropertiesService.getScriptProperties();
  var rec = result
    ? { day: calendarDayOf(result.at.getTime()), at: result.at.toISOString(), ok: !!result.ok, running: '' }
    : { day: prev.day, at: prev.at, ok: prev.ok, running: '' };
  dbWithLock_(10000, function () {
    props.setProperty(calendarPlannedKey_(who), JSON.stringify(rec));
  });
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
 * 予定の説明。最後の行は機械が読む印 (calendarMarkerOf_)。
 *
 * @param {object} task
 * @returns {string}
 */
function calendarDescriptionOf_(task) {
  var url = '';
  try {
    url = String(ScriptApp.getService().getUrl() || '');
  } catch (e) { /* 分からなければ書かない */ }
  return 'やること #' + task.number + (url ? '\n' + url : '') + '\n\n番頭が組んだ予定です。組み直すと変わります\n' +
    calendarMarkerLine_(task.who, task.number);
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

/** 何も入れなかったときの返事の形 */
function calendarEmptyResult_() {
  return { ok: false, reason: '', blocks: [], late: [], unplaced: [], capped: false };
}

/**
 * その人のやることを組み直す。
 *
 * 2つの画面で同時に組まないよう、組み直し中の印 (calendarClaim_) を取ってから組み、終わったら (落ちても) 外す。
 *
 * @param {string} who 小文字のアドレス
 * @param {Date} [now]
 * @param {{auto?: boolean, cooldown?: boolean}} [opts] auto: ホームが1日1回組むとき (その日に組めていれば何もしない)。
 *   cooldown: false で60秒の待ちを見ない (エディタの検証だけ。画面からは渡せない)
 * @returns {{ok: boolean, reason: string, blocks: object[], late: object[], unplaced: object[], capped: boolean,
 *   skipped?: boolean, waitSeconds?: number}}
 */
function calendarPlanFor_(who, now, opts) {
  var at = now || calendarNow_();
  var o = opts || {};
  var empty = calendarEmptyResult_();
  if (!who) { empty.reason = '誰の予定か分かりません'; return empty; }
  var set = calendarSettingsOf_(who);
  if (!set.plan) {
    empty.reason = '「やることを予定に入れる」がオフです。設定の「自分の設定」→「予定に入れる」でオンにしてください';
    return empty;
  }
  var opened = calendarOpenShared_();
  if (!opened.cal) { empty.reason = opened.reason; return empty; }

  var claim = calendarClaim_(who, at.getTime(), o);
  if (claim.skipped) {
    empty.ok = true;
    empty.skipped = true;
    return empty;
  }
  if (!claim.claimed) {
    empty.reason = claim.reason;
    if (claim.waitSeconds) empty.waitSeconds = claim.waitSeconds;
    return empty;
  }
  var result = null;
  var out;
  try {
    out = calendarPlanClaimed_(who, at, set, opened.cal);
    result = { at: at, ok: out.ok };
  } finally {
    calendarRelease_(who, claim.prev, result);
  }
  return out;
}

/**
 * 印を取ったあとの組み直しの本体 (鍵の外)。
 *
 * 先に新しい予定を全部入れ、入れ終わってから古い (これから始まる) 予定を消す。途中で書けなくなったら、
 * 入れたぶんを消して古いものを残す (半端に入れ替わった予定を作らない)。
 *
 * @param {string} who
 * @param {Date} at
 * @param {object} set calendarSettingsOf_
 * @param {object} cal 共有カレンダー
 * @returns {object} calendarPlanFor_ と同じ形
 */
function calendarPlanClaimed_(who, at, set, cal) {
  var empty = calendarEmptyResult_();
  var nowMs = at.getTime();
  var scan = CALENDAR_SCAN_DAYS_();
  var from = nowMs - scan.back * 86400000;
  var to = nowMs + scan.ahead * 86400000;

  var keep = [];
  var old = [];
  calendarMineIn_(cal, who, from, to).forEach(function (ev) {
    var s = ev.getStartTime().getTime();
    var e = ev.getEndTime().getTime();
    // これから始まる予定でも、人が直したものは残して避ける
    if (s > nowMs && !calendarEdited_(ev)) old.push(ev);
    else if (e > nowMs) keep.push({ start: s, end: e });
  });

  var tasks = calendarTasksOf_(who, set.blockMin);
  var titles = {};
  var byNumber = {};
  tasks.forEach(function (t) { titles[t.number] = t.title; byNumber[t.number] = t; });

  var plan = calendarPlanBlocks({
    tasks: tasks, busy: calendarBusyOf_(nowMs, to, cal, who).concat(keep), now: nowMs, hours: set.hours,
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
    // 1件目から権限で断られたときだけ「見るだけ」。途中で断られた・回数の上限などは混み合っているとする
    var denied = made.length === 0 && calendarLooksDenied_(e);
    if (!denied) console.warn('予定を入れられませんでした: ' + (e && e.message));
    made.forEach(function (ev) {
      try {
        ev.deleteEvent();
      } catch (e2) { /* 消せなければ残る。次に組み直すと説明の印で見つかる */ }
    });
    empty.reason = denied ? calendarNoWriteReason_() : calendarBusyReason_();
    return empty;
  }
  old.forEach(function (ev) {
    try {
      ev.deleteEvent();
    } catch (e) { /* 消せなかった古い予定は次に組み直すときに消す */ }
  });

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
    capped: !!plan.capped,
  };
}

/**
 * その人の、これから始まる番頭の予定を消す (予定に入れるのをやめたとき)。1件ずつ消し、消せなかったものは数えて返す。
 * 人が直した予定 (calendarEdited_) は消さない (ゲストのいる会議になっていることがある)。組んだ日の覚え書きは必ず消す。
 *
 * @param {string} who
 * @param {Date} [now]
 * @returns {number} 消せずに残った数
 */
function calendarClearMine_(who, now) {
  var me = String(who || '').toLowerCase();
  if (!me) return 0;
  var left = 0;
  try {
    if (!calendarSharedId_()) return 0;
    var opened = calendarOpenShared_();
    if (!opened.cal) return 0;
    var nowMs = (now || calendarNow_()).getTime();
    calendarMineIn_(opened.cal, me, nowMs, nowMs + CALENDAR_SCAN_DAYS_().ahead * 86400000).forEach(function (ev) {
      if (ev.getStartTime().getTime() <= nowMs || calendarEdited_(ev)) return;
      try {
        ev.deleteEvent();
      } catch (e) {
        left++;
      }
    });
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(calendarPlannedKey_(me));
  }
  return left;
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
  var titles = {};
  issueList('').forEach(function (row) { titles[Number(row.number)] = String(row.title || ''); });
  var blocks = calendarMineIn_(opened.cal, who, start, start + 86400000).map(function (ev) {
    return {
      issueNumber: calendarIssueOf_(ev),
      start: ev.getStartTime().getTime(),
      end: ev.getEndTime().getTime(),
    };
  });
  blocks.sort(function (a, b) { return a.start - b.start; });
  return { ok: true, reason: '', blocks: blocks.map(function (b) { return calendarPlainBlock_(b, titles); }) };
}

// ===== 会議の時間 (自分まわりの欄) =====
//
// 本人の既定のカレンダーだけを読み、会議の時間を数だけ返す。題名・相手・時刻は返さず、どこにも書かない。
// 半期ぶんの予定を読むので重い。CacheService に本人ごと・東京の暦日ごとに MEETING_CACHE_SEC_() 覚える
// (中身は数だけ。日が変われば期間も変わるので、鍵に暦日を入れて取り直す)。

/** 会議の時間を覚えておく秒 */
function MEETING_CACHE_SEC_() {
  return 1800;
}

/**
 * 会議として数える予定か。本人が予定に居て (ゲストか作った人)、参加者が本人を含めて2人以上・本人が断っていない・終日でない。
 * 取り込んだ・写した予定で本人がどこにも居ないもの (相手だけが居る) は数えない。
 * 「空き」(透過) の予定も、相手がいて断っていなければ会議として数える (埋まっている時間の calendarCountsAsBusy_ とは別)。
 *
 * @param {object} ev
 * @param {string} who 小文字のアドレス
 * @returns {boolean}
 */
function meetingCounts_(ev, who) {
  if (ev.isAllDayEvent()) return false;
  var no = CalendarApp.GuestStatus && CalendarApp.GuestStatus.NO;
  try {
    if (no && ev.getMyStatus() === no) return false;
  } catch (e) { /* 分からなければ断っていないものとする */ }
  var people = {};
  // true で主催者も入れる (実機の getGuestList() は主催者を入れない)
  (ev.getGuestList(true) || []).forEach(function (g) {
    var mail = String((g && g.getEmail && g.getEmail()) || '').toLowerCase();
    if (mail) people[mail] = true;
  });
  if (!people[who]) {
    // ゲストに居なくても、作った人なら本人が居る (自分で入れた相手つきの予定)
    var made = [];
    try { made = ev.getCreators() || []; } catch (e) { made = []; }
    var mine = made.some(function (m) { return String(m || '').toLowerCase() === who; });
    if (!mine) return false;
    people[who] = true;
  }
  return Object.keys(people).length >= 2;
}

/**
 * 会議の時間を覚える鍵。アドレスは指紋にする (長いアドレスで CacheService の鍵の上限 250 字を超えないように)。
 *
 * @param {string} who 小文字のアドレス
 * @param {number} nowMs
 * @returns {string}
 */
function meetingCacheKey_(who, nowMs) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(who), Utilities.Charset.UTF_8);
  return 'MEETING:' + calendarDayOf(nowMs) + ':' + bytesToHex(digest);
}

/**
 * 本人の会議の時間 (今週・今月・今半期の、今までのぶん)。読めない (権限が無い・エラー) ときは null。
 *
 * @param {string} who 小文字のアドレス
 * @param {Date} [now]
 * @returns {?{week: number, month: number, half: number, since: string, until: string, count: number}}
 *   時間 (小数1桁)。since / until は東京の暦日 ('YYYY-MM-DD')。count は半期の会議の数
 */
function meetingHoursOf_(who, now) {
  var nowMs = (now || calendarNow_()).getTime();
  var key = meetingCacheKey_(who, nowMs);
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    cache = null;
  }
  var p = meetingPeriodsOf(nowMs);
  var list = [];
  // 週の始まりが半期の始まりより前のこともある (4/1 が木曜なら週は 3/29 から)。早いほうから読む
  var from = Math.min(p.week, p.half);
  try {
    CalendarApp.getDefaultCalendar().getEvents(new Date(from), new Date(nowMs)).forEach(function (ev) {
      if (!meetingCounts_(ev, who)) return;
      list.push({ start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() });
    });
  } catch (e) {
    // 読めなければ欄を出さない (覚えない。次に開いたときにもう一度読む)
    Logger.log('会議の時間を読めませんでした: ' + e.message);
    return null;
  }
  var out = {
    week: meetingHoursOfMinutes(meetingMinutesIn(list, p.week, nowMs)),
    month: meetingHoursOfMinutes(meetingMinutesIn(list, p.month, nowMs)),
    half: meetingHoursOfMinutes(meetingMinutesIn(list, p.half, nowMs)),
    since: calendarDayOf(p.half),
    until: calendarDayOf(nowMs),
    // 半期の会議の数 (週のために前の半期から読んだぶんは入れない)
    count: list.filter(function (b) { return b.end > p.half; }).length,
  };
  if (cache) {
    try {
      // 同じ人の別の実行が読んでいるあいだに先に覚えていれば、上書きしない (後から終わった古い読みで戻さない)
      if (!cache.get(key)) cache.put(key, JSON.stringify(out), MEETING_CACHE_SEC_());
    } catch (e) {
      Logger.log('会議の時間を覚えられませんでした: ' + e.message);
    }
  }
  return out;
}

// ===== 今日の予定 (手元の道具が会議の始まりを知らせる。命令 calendarToday、やること #99) =====
//
// 置いた人の今日 (東京の暦日) の予定を、始まり・終わり・題名・会議の URL・予定の URL で返す。台帳には書かない。
// キューは仕掛けた人の権限で回るので、CalendarApp の既定のカレンダーはその人のもの。**置いた人が仕掛けた人なら既定の
// カレンダー、ほかの人なら、仕掛けた人に共有されて登録 (購読) されているその人のカレンダー (id = アドレス) だけを読む**
// (無ければ断る)。返事は queue に置かれ、手元が受け取るまで共有している人なら読める (題名と会議の URL を含む)。

/** 会議の URL (Google Meet) の形。後ろの引用符・括弧・句読点は含まない */
function CALENDAR_MEET_RE_() {
  return /https:\/\/meet\.google\.com\/(?:lookup\/)?[a-z0-9][a-z0-9-]*/i;
}

/**
 * 字の中の Google Meet の URL。無ければ null。
 *
 * @param {string} text
 * @returns {?string}
 */
function calendarMeetUrlIn_(text) {
  var m = CALENDAR_MEET_RE_().exec(String(text || ''));
  return m ? m[0] : null;
}

/**
 * 予定の会議の URL。場所を先に見て、無ければ説明を見る。
 *
 * @param {object} ev
 * @returns {?string}
 */
function calendarMeetUrlOf_(ev) {
  var where = '';
  var about = '';
  try { where = String(ev.getLocation() || ''); } catch (e) { where = ''; }
  try { about = String(ev.getDescription() || ''); } catch (e2) { about = ''; }
  return calendarMeetUrlIn_(where) || calendarMeetUrlIn_(about);
}

/**
 * 予定をカレンダーで開く URL。繰り返しの予定は回ごとの id を CalendarApp から取れないので null。
 *
 * @param {object} ev
 * @param {string} calId
 * @returns {?string}
 */
function calendarEventUrlOf_(ev, calId) {
  try {
    if (ev.isRecurringEvent()) return null;
    var id = String(ev.getId() || '').replace(/@google\.com$/, '');
    if (!id || !calId) return null;
    var eid = String(Utilities.base64EncodeWebSafe(id + ' ' + calId)).replace(/=+$/, '');
    return 'https://calendar.google.com/calendar/event?eid=' + eid;
  } catch (e) {
    return null;
  }
}

/**
 * 置いた人の今日の予定 (東京の暦日に始まるもの)。終日の予定と、断った予定は除く。始まりの順。
 *
 * @param {string} who 置いた人のアドレス (commandBy_)
 * @param {Date} [now]
 * @returns {{day: string, events: Array<{start: string, end: string, title: string, meetUrl: ?string, eventUrl: ?string}>}}
 */
function calendarTodayOf_(who, now) {
  var me = String(who || '').toLowerCase();
  var runner = '';
  try { runner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) { runner = ''; }
  var cal = null;
  try {
    cal = me && me === runner ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(me);
  } catch (e2) {
    cal = null;
  }
  if (!cal) {
    throw new Error('あなたの予定を読めません。読めるのは、命令の入れ先を動かしている人のカレンダーと、' +
      'その人に共有されて登録されているカレンダーだけです');
  }
  var nowMs = (now || calendarNow_()).getTime();
  var day = calendarDayOf(nowMs);
  var from = calendarDayStart(day);
  var to = from + 86400000;
  var no = CalendarApp.GuestStatus && CalendarApp.GuestStatus.NO;
  var calId = String(cal.getId() || '');
  var events = [];
  cal.getEvents(new Date(from), new Date(to)).forEach(function (ev) {
    if (ev.isAllDayEvent()) return;
    var start = ev.getStartTime().getTime();
    if (start < from || start >= to) return;
    try {
      if (no && ev.getMyStatus() === no) return;
    } catch (e3) { /* 分からなければ断っていないものとする */ }
    events.push({
      start: plainDate(new Date(start)),
      end: plainDate(ev.getEndTime()),
      title: plainText(ev.getTitle()),
      meetUrl: calendarMeetUrlOf_(ev),
      eventUrl: calendarEventUrlOf_(ev, calId),
    });
  });
  events.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return { day: day, events: events };
}
