/**
 * 画面の API: 成果の数 (src/core/Outcomes.gs)。
 *
 * **管理者だけが見る。** 人の名前もアドレスも返さない。記録した人が3人より少ない週は数を null にする
 * (1人の分が引き算で見えるため。gameTeam_ と同じ守り)。終わった週だけを返す。
 */

/**
 * 週ごとの成果の数。
 *
 * @param {number} [weeks] 何週ぶん (1〜26。既定 8)
 * @returns {{weeks: object[], minPeople: number, since: string}}
 */
function apiOutcomes(weeks) {
  repoAssertAdmin_('成果の数を見ること');
  var n = Math.round(Number(weeks));
  if (!(n >= 1 && n <= 26)) n = 8;
  var rows = dbReadAll('outcomes_daily');
  var since = '';
  rows.forEach(function (r) {
    var d = usageDayOf_(r.day);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!since || d < since)) since = d;
  });
  return { weeks: outcomesWeeks_(rows, n, new Date()), minPeople: OUTCOMES_MIN_PEOPLE(), since: since };
}
