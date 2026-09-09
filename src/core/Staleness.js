/**
 * やることの「動きのなさ」を測る。
 *
 * 放っておかれたものほど見た目を傷ませて、目に留まるようにする。
 * 完了したものは動かなくて当たり前なので数えない。
 */

/**
 * 段階の境目 (日数)。小さい順。
 *
 * @returns {number[]}
 */
function STALE_STEPS() {
  return [7, 14, 30];
}

/**
 * 最後に動いた日時を返す。
 *
 * updatedAt を入れる前に作られた行があるため、無ければ作った日に落とす。
 *
 * @param {object} issue
 * @returns {Date|null}
 */
function staleLastMoved(issue) {
  var raw = (issue && issue.updatedAt) || (issue && issue.createdAt) || null;
  if (!raw) return null;

  var d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 動きのなさを段階で返す。
 *
 * @param {object} issue
 * @param {Date} now
 * @param {number[]} [steps]
 * @returns {{days: number, level: number}} level は 0 (新しい) 〜 3 (腐りきり)
 */
function stalenessOf(issue, now, steps) {
  var edges = steps || STALE_STEPS();
  var moved = staleLastMoved(issue);

  if (!moved || !issue || String(issue.state) !== 'open' || issue.archivedAt) {
    return { days: 0, level: 0 };
  }

  var day = 24 * 60 * 60 * 1000;
  var days = Math.floor((new Date(now).getTime() - moved.getTime()) / day);
  if (days < 0) days = 0;

  var level = 0;
  for (var i = 0; i < edges.length; i++) {
    if (days >= edges[i]) level = i + 1;
  }
  return { days: days, level: level };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STALE_STEPS: STALE_STEPS, staleLastMoved: staleLastMoved, stalenessOf: stalenessOf };
}
