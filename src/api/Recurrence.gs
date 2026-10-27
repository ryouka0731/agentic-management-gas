/*
 * 画面の API: 繰り返しのやること (やること #110。src/core/Recurrence.gs)。
 *
 * 作れるのは誰でも。直す・止める・消すのは作った人と管理者 (recurrenceAssertCanEdit_)。
 */

/**
 * 繰り返しの一覧 (Web App API)。
 *
 * @returns {object[]}
 */
function apiRecurrenceList() {
  return recurrenceList_(currentEmail_());
}

/**
 * 繰り返しを作る (Web App API)。
 *
 * @param {object} fields title / body / assignee / kind / weekday / day / month / dueDays / leadDays
 * @returns {object}
 */
function apiRecurrenceCreate(fields) {
  return recurrenceCreate_(fields || {}, currentEmail_());
}

/**
 * 繰り返しを直す・止める・動かし直す (Web App API)。止めるのは patch に active: false。
 *
 * @param {number} id
 * @param {object} patch
 * @returns {object}
 */
function apiRecurrenceUpdate(id, patch) {
  return recurrenceUpdate_(id, patch || {}, currentEmail_());
}

/**
 * 繰り返しを消す (Web App API)。これまでに作ったやることは残る。
 *
 * @param {number} id
 * @returns {boolean}
 */
function apiRecurrenceDelete(id) {
  return !!recurrenceDelete_(id, currentEmail_());
}
