/**
 * 捨てたやることの置き場と、片付けの期限。
 *
 * 捨てた瞬間に消すと取り違えを取り返せないため、いったん置き場に移し、
 * 期限を過ぎたものだけを片付ける。
 */

/**
 * 置き場に留め置く日数。
 *
 * @returns {number}
 */
function ARCHIVE_KEEP_DAYS() {
  return 30;
}

/**
 * 片付けまでの残り日数を返す。
 *
 * 端数は切り上げる。今日片付く分は 0 になる。
 *
 * @param {Date|string} archivedAt 捨てた日時
 * @param {Date} now
 * @param {number} [keepDays]
 * @returns {number|null} 捨てていなければ null
 */
function archiveDaysLeft(archivedAt, now, keepDays) {
  if (!archivedAt) return null;

  var keep = keepDays === undefined ? ARCHIVE_KEEP_DAYS() : keepDays;
  var at = new Date(archivedAt).getTime();
  if (isNaN(at)) return null;

  var day = 24 * 60 * 60 * 1000;
  var left = (at + keep * day - new Date(now).getTime()) / day;
  return left <= 0 ? 0 : Math.ceil(left);
}

/**
 * 期限を過ぎたやることの番号を返す。
 *
 * @param {object[]} rows issues 行
 * @param {Date} now
 * @param {number} [keepDays]
 * @returns {number[]}
 */
function archiveExpired(rows, now, keepDays) {
  var out = [];

  for (var i = 0; i < (rows || []).length; i++) {
    var left = archiveDaysLeft(rows[i].archivedAt, now, keepDays);
    if (left === 0) out.push(Number(rows[i].number));
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ARCHIVE_KEEP_DAYS: ARCHIVE_KEEP_DAYS, archiveDaysLeft: archiveDaysLeft, archiveExpired: archiveExpired };
}
