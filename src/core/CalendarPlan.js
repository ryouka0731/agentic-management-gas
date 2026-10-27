/**
 * やることを予定に並べる (ピュアな計算)。Calendar には触らない。読み書きは CalendarSync.gs。
 *
 * 並べ方:
 * - **期限の早いものから** (期限の無いものは最後)。同じ期限なら優先度の高いもの、それでも同じなら番号の小さいもの
 * - 1つずつ、空いているいちばん早い枠に、決めた長さ (block) で置く。長い仕事は block ごとに分け、あいだに
 *   gap 分だけ空ける (続けて詰め込まない)
 * - 置けるのは勤務の時間の中だけ・今より後だけ・ほかの予定 (busy) と重ならないところだけ。会議の前後にも gap 分空ける
 *   (会議が終わったその分から始めない)
 * - 先 (days) の勤務日まで。それより先には置かない
 * - 期限までに全部置けなかったものは late に入れる (やさしく知らせるため。責めない)。**空きが尽きたときだけ。**
 *   1回の上限 (maxBlocks) で止めたときは late にせず capped を立てる (空きはあるので、遅れとは限らない)
 *
 * 時刻はすべてミリ秒 (UTC)。暦日と勤務の時間は東京の時刻で数える (appsscript.json の timeZone と同じ。
 * 日本に夏時間は無いので、ずらす分は一定)。同じ入力からは必ず同じ並びが出る。
 */

/** 東京の時刻のずれ (分) */
function CAL_TZ_OFFSET_MIN() {
  return 540;
}

/** 1回に置く予定の上限。Calendar に書く回数がそのまま実行時間になる */
function CAL_MAX_BLOCKS() {
  return 20;
}

/** 予定と予定のあいだに空ける分 */
function CAL_GAP_MIN() {
  return 10;
}

/** 工数 (人日) を時間にする。1人日 = 8時間 */
function CAL_HOURS_PER_DAY() {
  return 8;
}

/**
 * やること1つに要る分。予定 − 実績 (どちらも人日) を担当の頭数で割る (工数の数え方と同じ)。
 * 見積もりが無い・もう使い切ったものは、1つ分 (block) だけ置く。5分単位に切り上げる。
 *
 * @param {{plannedHours?: *, actualHours?: *, heads?: number}} t
 * @param {number} blockMin
 * @returns {number} 分
 */
function calendarMinutesFor(t, blockMin) {
  var heads = Math.max(1, Number(t && t.heads) || 1);
  var planned = Number(t && t.plannedHours) || 0;
  var actual = Number(t && t.actualHours) || 0;
  var left = (planned - Math.max(0, actual)) * CAL_HOURS_PER_DAY() * 60 / heads;
  if (!(left > 0)) return blockMin;
  return Math.ceil(left / 5) * 5;
}

/**
 * 'HH:mm' を0時からの分にする。読めなければ null。
 *
 * @param {string} s
 * @returns {?number}
 */
function calendarClockMin(s) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  var h = Number(m[1]);
  var mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

/**
 * 東京の暦日 ('YYYY-MM-DD') の0時 (ミリ秒)。読めなければ null。
 *
 * @param {string} day
 * @returns {?number}
 */
function calendarDayStart(day) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - CAL_TZ_OFFSET_MIN() * 60000;
}

/**
 * ミリ秒を東京の暦日にする。
 *
 * @param {number} ms
 * @returns {string}
 */
function calendarDayOf(ms) {
  var t = new Date(ms + CAL_TZ_OFFSET_MIN() * 60000);
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
}

/**
 * 重なりを潰して、始まりの順に並べる。
 *
 * @param {Array<{start: number, end: number}>} list
 * @returns {Array<{start: number, end: number}>}
 */
function calendarMerge(list) {
  var src = (list || []).filter(function (b) {
    return b && isFinite(b.start) && isFinite(b.end) && b.end > b.start;
  }).map(function (b) { return { start: Number(b.start), end: Number(b.end) }; });
  src.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
  var out = [];
  src.forEach(function (b) {
    var last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push(b);
  });
  return out;
}

/**
 * 空いている枠。今日 (今より後) から勤務日を days 日ぶん、勤務の時間から busy を引いたもの。
 *
 * @param {object} o calendarPlanBlocks の入力
 * @returns {{free: Array<{start: number, end: number}>, end: number}} end は先の終わり
 */
function calendarFreeSlots(o) {
  var startMin = calendarClockMin(o.hours && o.hours.start);
  var endMin = calendarClockMin(o.hours && o.hours.end);
  if (startMin === null || endMin === null || endMin <= startMin) return { free: [], end: o.now };
  // 今の次の5分から (半端な時刻から始めない。ちょうど今に始まる予定は「続いている」と読まれるので、今より後に置く)
  var from = Math.floor(o.now / 300000) * 300000 + 300000;
  var day = calendarDayStart(calendarDayOf(o.now));
  var windows = [];
  var counted = 0;
  var guard = 0;
  while (counted < o.days && guard < 60) {
    guard++;
    var wd = new Date(day + CAL_TZ_OFFSET_MIN() * 60000).getUTCDay();
    var working = o.weekend || (wd !== 0 && wd !== 6);
    if (working) {
      var ws = day + startMin * 60000;
      var we = day + endMin * 60000;
      // 今日がもう終わっていても1日と数える (「今日から5日」と読めるように)
      counted++;
      if (we > from) windows.push({ start: Math.max(ws, from), end: we });
    }
    day += 86400000;
  }
  var horizonEnd = windows.length ? windows[windows.length - 1].end : from;
  var pad = o.gapMin * 60000;
  var busy = calendarMerge((o.busy || []).map(function (b) {
    return b ? { start: Number(b.start) - pad, end: Number(b.end) + pad } : b;
  }));
  var free = [];
  windows.forEach(function (w) {
    var cur = w.start;
    busy.forEach(function (b) {
      if (b.end <= cur || b.start >= w.end) return;
      if (b.start > cur) free.push({ start: cur, end: Math.min(b.start, w.end) });
      cur = Math.max(cur, b.end);
    });
    if (cur < w.end) free.push({ start: cur, end: w.end });
  });
  return { free: free, end: horizonEnd };
}

/**
 * 並べる順。期限の早いもの → 優先度 (rank の小さいもの) → 番号の小さいもの。
 *
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function calendarTaskOrder(a, b) {
  var da = calendarDayStart(a.due);
  var db = calendarDayStart(b.due);
  var fa = da === null ? Infinity : da;
  var fb = db === null ? Infinity : db;
  if (fa !== fb) return fa < fb ? -1 : 1;
  var ra = Number(a.rank) || 0;
  var rb = Number(b.rank) || 0;
  if (ra !== rb) return ra - rb;
  return Number(a.number) - Number(b.number);
}

/**
 * やることを予定に並べる。
 *
 * @param {object} input
 * @param {Array<{number: number, minutes: number, due?: string, rank?: number}>} input.tasks
 *   minutes は calendarMinutesFor で求めたもの。due は東京の暦日 ('YYYY-MM-DD')、その日の終わりまでを期限とする
 * @param {Array<{start: number, end: number}>} [input.busy] ほかの予定
 * @param {number} input.now
 * @param {{start: string, end: string}} input.hours 'HH:mm'
 * @param {boolean} [input.weekend] 土日も入れる
 * @param {number} input.blockMin 1つの予定の長さ (分)
 * @param {number} input.days 先の勤務日の数 (今日を含む)
 * @param {number} [input.gapMin] 予定のあいだ (既定 CAL_GAP_MIN)
 * @param {number} [input.maxBlocks] 上限 (既定 CAL_MAX_BLOCKS)
 * @returns {{blocks: Array<{issueNumber: number, start: number, end: number}>,
 *   late: number[], unplaced: Array<{issueNumber: number, minutes: number}>, capped: boolean, end: number}}
 */
function calendarPlanBlocks(input) {
  var o = {
    tasks: (input && input.tasks) || [],
    busy: (input && input.busy) || [],
    now: Number(input && input.now) || 0,
    hours: (input && input.hours) || {},
    weekend: !!(input && input.weekend),
    blockMin: Math.max(5, Number(input && input.blockMin) || 45),
    days: Math.max(1, Math.min(31, Number(input && input.days) || 5)),
    gapMin: input && isFinite(input.gapMin) ? Math.max(0, Number(input.gapMin)) : CAL_GAP_MIN(),
    maxBlocks: input && isFinite(input.maxBlocks) ? Math.max(0, Number(input.maxBlocks)) : CAL_MAX_BLOCKS(),
  };
  var slots = calendarFreeSlots(o);
  var free = slots.free;
  var tasks = o.tasks.filter(function (t) { return t && Number(t.minutes) > 0; }).slice();
  tasks.sort(calendarTaskOrder);

  var blocks = [];
  var late = [];
  var capped = false;
  var unplaced = [];
  var gap = o.gapMin * 60000;

  tasks.forEach(function (t) {
    var left = Math.ceil(Number(t.minutes) / 5) * 5;
    var lastEnd = null;
    var full = false;
    while (left > 0) {
      if (blocks.length >= o.maxBlocks) { capped = true; break; }
      var len = Math.min(o.blockMin, left) * 60000;
      var hit = -1;
      for (var i = 0; i < free.length; i++) {
        if (free[i].end - free[i].start >= len) { hit = i; break; }
      }
      if (hit < 0) { full = true; break; }
      var at = free[hit].start;
      blocks.push({ issueNumber: Number(t.number), start: at, end: at + len });
      lastEnd = at + len;
      // 置いたぶんと、あとの間 (gap) を枠から削る
      free[hit].start = at + len + gap;
      if (free[hit].start >= free[hit].end) free.splice(hit, 1);
      left -= len / 60000;
    }
    var dueStart = calendarDayStart(t.due);
    if (left > 0) unplaced.push({ issueNumber: Number(t.number), minutes: left });
    if (dueStart !== null) {
      var deadline = dueStart + 86400000;
      // 期限が先 (並べる範囲の外) で置ききれなかっただけなら、まだ遅れではない
      var short = left > 0 && full && deadline <= slots.end;
      if (short || deadline <= o.now || (lastEnd !== null && lastEnd > deadline)) late.push(Number(t.number));
    }
  });

  blocks.sort(function (a, b) { return a.start - b.start || a.issueNumber - b.issueNumber; });
  return { blocks: blocks, late: late, unplaced: unplaced, capped: capped, end: slots.end };
}

// ===== 会議の時間 (自分まわりの欄。カレンダーを読むのは CalendarSync.gs の meetingHoursOf_) =====

/**
 * 会議の時間を数える期間の始まり。どれも東京の暦日の0時。終わりは今 (済んだぶんだけ数える)。
 * 週は月曜から、月は1日から、半期は4月1日 (4〜9月) か10月1日 (10〜3月) から。
 *
 * @param {number} nowMs
 * @returns {{now: number, week: number, month: number, half: number}} ミリ秒
 */
function meetingPeriodsOf(nowMs) {
  var day = calendarDayOf(nowMs);
  var y = Number(day.substring(0, 4));
  var m = Number(day.substring(5, 7));
  var today = calendarDayStart(day);
  // 東京の曜日 (0 = 日曜)。月曜を週の始まりにする
  var wd = new Date(today + CAL_TZ_OFFSET_MIN() * 60000).getUTCDay();
  var week = today - ((wd + 6) % 7) * 86400000;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var month = calendarDayStart(y + '-' + pad(m) + '-01');
  // 1〜3月は前の年の10月から
  var half = m >= 4 && m <= 9 ? calendarDayStart(y + '-04-01')
    : calendarDayStart((m <= 3 ? y - 1 : y) + '-10-01');
  return { now: nowMs, week: week, month: month, half: half };
}

/**
 * 会議の時間 (分) を期間で切って足す。重なった時間は1つ分だけ数える (calendarMerge で潰してから足す)。
 *
 * @param {Array<{start: number, end: number}>} list
 * @param {number} from
 * @param {number} to
 * @returns {number} 分
 */
function meetingMinutesIn(list, from, to) {
  var total = 0;
  calendarMerge(list).forEach(function (b) {
    var s = Math.max(b.start, from);
    var e = Math.min(b.end, to);
    if (e > s) total += (e - s) / 60000;
  });
  return total;
}

/**
 * 分を時間にする (小数1桁に四捨五入)。
 *
 * @param {number} min
 * @returns {number}
 */
function meetingHoursOfMinutes(min) {
  return Math.round((Number(min) || 0) / 6) / 10;
}
