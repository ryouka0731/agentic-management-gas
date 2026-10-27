/**
 * 繰り返しのやること (毎週◯曜 / 毎月◯日 / 毎年◯月◯日) の暦の計算。
 *
 * **台帳に触らない。** 日は東京の暦日の字 'YYYY-MM-DD' で受け渡し、ここは数えるだけにする。
 * 起票する側 (Recurrence.gs) と画面の手引き (docs/manual/tasks.md) が同じ決まりを指すため。
 *
 * - 日の足し引きは UTC の 0 時で数える (夏時間が無いので1日はいつも 86400000 ミリ秒)
 * - **月末は末日扱い**: 毎月31日は、30日までの月は30日、2月は28日 (閏年は29日)。毎年2月29日も平年は28日
 * - 今日は東京の暦日 (`recurrenceTodayOf`)。この道具の時刻帯は Asia/Tokyo で固定してある
 */

/** 周期の種類 */
function RECURRENCE_KINDS() {
  return [['weekly', '毎週'], ['monthly', '毎月'], ['yearly', '毎年']];
}

/** 何日前に起票するかの既定 */
function RECURRENCE_LEAD_DEFAULT() {
  return 3;
}

/** 何日前・期限までの日数の上限 (これより長いと、前の分を作った直後に次の分が出る) */
function RECURRENCE_DAYS_MAX() {
  return 90;
}

/** 曜日の字 (0 = 日曜) */
function RECURRENCE_WEEKDAYS() {
  return ['日', '月', '火', '水', '木', '金', '土'];
}

/**
 * 'YYYY-MM-DD' として読める実在の日か。
 *
 * @param {*} day
 * @returns {boolean}
 */
function recurrenceDayValid(day) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day == null ? '' : day));
  if (!m) return false;
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3]);
}

/** 'YYYY-MM-DD' → その日の UTC 0 時のミリ秒 */
function recurrenceDayMs_(day) {
  var p = String(day).split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** UTC のミリ秒 → 'YYYY-MM-DD' */
function recurrenceDayOfMs_(ms) {
  return new Date(ms).toISOString().substring(0, 10);
}

/**
 * 東京の今日。
 *
 * @param {number} ms いまの時刻 (ミリ秒)
 * @returns {string} 'YYYY-MM-DD'
 */
function recurrenceTodayOf(ms) {
  return recurrenceDayOfMs_(Number(ms) + 9 * 3600 * 1000);
}

/**
 * 日を n 日ずらす。
 *
 * @param {string} day
 * @param {number} n
 * @returns {string}
 */
function recurrenceShift(day, n) {
  return recurrenceDayOfMs_(recurrenceDayMs_(day) + Number(n) * 86400000);
}

/**
 * b - a の日数。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function recurrenceDaysBetween(a, b) {
  return Math.round((recurrenceDayMs_(b) - recurrenceDayMs_(a)) / 86400000);
}

/** その月の末日 (month は 1〜12) */
function recurrenceLastDay_(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 年・月・日 (日は末日で丸める) → 'YYYY-MM-DD' */
function recurrenceYmd_(year, month, day) {
  var d = Math.min(day, recurrenceLastDay_(year, month));
  return recurrenceDayOfMs_(Date.UTC(year, month - 1, d));
}

/** 0 以上の整数か (字の '3' も読む) */
function recurrenceInt_(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  var n = Number(v);
  return Math.floor(n) === n ? n : NaN;
}

/**
 * 周期の決まりを確かめる。
 *
 * @param {{kind: string, weekday?: *, day?: *, month?: *}} rule
 * @returns {string} 断る理由。良ければ ''
 */
function recurrenceRuleCheck(rule) {
  var r = rule || {};
  var kind = String(r.kind || '');
  if (kind === 'weekly') {
    var w = recurrenceInt_(r.weekday);
    return w >= 0 && w <= 6 ? '' : '曜日を選んでください';
  }
  if (kind === 'monthly') {
    var d = recurrenceInt_(r.day);
    return d >= 1 && d <= 31 ? '' : '日は 1〜31 で入れてください (31 は月末になります)';
  }
  if (kind === 'yearly') {
    var m = recurrenceInt_(r.month);
    if (!(m >= 1 && m <= 12)) return '月は 1〜12 で入れてください';
    var yd = recurrenceInt_(r.day);
    // 2月29日は閏年でない年は28日になる。それより大きい日は無い
    var max = m === 2 ? 29 : recurrenceLastDay_(2001, m);
    return yd >= 1 && yd <= max ? '' : m + '月の日は 1〜' + max + ' で入れてください';
  }
  return '繰り返し方 (毎週・毎月・毎年) を選んでください';
}

/**
 * fromDay 以後 (その日を含む) で、決まりに当たる最初の日。
 *
 * @param {{kind: string, weekday?: *, day?: *, month?: *}} rule recurrenceRuleCheck を通ったもの
 * @param {string} fromDay 'YYYY-MM-DD'
 * @returns {string} 'YYYY-MM-DD'
 */
function recurrenceNextOn(rule, fromDay) {
  var kind = String(rule.kind);
  var from = String(fromDay);
  if (kind === 'weekly') {
    var wd = new Date(recurrenceDayMs_(from)).getUTCDay();
    return recurrenceShift(from, (Number(rule.weekday) - wd + 7) % 7);
  }
  var y = Number(from.substring(0, 4));
  var mo = Number(from.substring(5, 7));
  if (kind === 'monthly') {
    // その月で当たる日が過ぎていれば次の月。丸めても過ぎるのは同じ月の中だけなので、2か月見れば足りる
    for (var i = 0; i < 2; i++) {
      var c = recurrenceYmd_(y, mo, Number(rule.day));
      if (c >= from) return c;
      mo++;
      if (mo > 12) { mo = 1; y++; }
    }
    return recurrenceYmd_(y, mo, Number(rule.day));
  }
  var c1 = recurrenceYmd_(y, Number(rule.month), Number(rule.day));
  return c1 >= from ? c1 : recurrenceYmd_(y + 1, Number(rule.month), Number(rule.day));
}

/**
 * 今日起票する分の対象日。無ければ ''。
 *
 * 対象日は「今日か、前に起票した対象日の翌日」の遅いほう以後で決まりに当たる最初の日。そこから
 * 何日前 (leadDays) に入っていれば起票する。**前に起票した対象日より後しか見ないので、同じ分は二度出ない。**
 * 起票し損ねた日 (止まっていた日) が過ぎたぶんは作らない (古い期限のやることが溜まらない)。
 *
 * @param {object} rule recurrenceRuleCheck を通ったもの。leadDays は何日前 (空は既定)
 * @param {string} today 'YYYY-MM-DD'
 * @param {string} [lastFor] 前に起票した対象日 'YYYY-MM-DD'
 * @returns {string}
 */
function recurrenceDueFor(rule, today, lastFor) {
  var from = today;
  if (recurrenceDayValid(lastFor)) {
    var after = recurrenceShift(lastFor, 1);
    if (after > from) from = after;
  }
  var target = recurrenceNextOn(rule, from);
  var lead = recurrenceInt_(rule.leadDays);
  if (!(lead >= 0)) lead = RECURRENCE_LEAD_DEFAULT();
  return recurrenceShift(target, -lead) <= today ? target : '';
}

/**
 * 周期を人の字にする。
 *
 * @param {object} rule
 * @returns {string} 例 '毎週月曜' / '毎月31日 (無い月は末日)' / '毎年3月31日'
 */
function recurrenceRuleText(rule) {
  var r = rule || {};
  if (recurrenceRuleCheck(r)) return '';
  if (r.kind === 'weekly') return '毎週' + RECURRENCE_WEEKDAYS()[Number(r.weekday)] + '曜';
  if (r.kind === 'monthly') {
    return '毎月' + Number(r.day) + '日' + (Number(r.day) > 28 ? ' (無い月は末日)' : '');
  }
  return '毎年' + Number(r.month) + '月' + Number(r.day) + '日' +
    (Number(r.month) === 2 && Number(r.day) === 29 ? ' (平年は28日)' : '');
}

/**
 * 'YYYY-MM-DD' を「11月30日」にする。
 *
 * @param {string} day
 * @returns {string}
 */
function recurrenceDayLabel(day) {
  if (!recurrenceDayValid(day)) return '';
  return Number(day.substring(5, 7)) + '月' + Number(day.substring(8, 10)) + '日';
}
