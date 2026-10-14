/**
 * ホーム (トップページ)。設計: docs/superpowers/specs/2026-10-14-home-design.md
 *
 * - 草は**本人のぶんとチームの合計だけ**。部下を含めて他人の草は返さない
 *   (人に関わる数は本人と部下だけ、の決まりより狭くしてある。人ごとの草は監視に見える)
 * - **連続日数・最長記録は数えない。** 途切れたときに意欲が下がる (Silverman & Barasch 2022)
 * - 数は台帳から数え、保存しない。表は1回ずつ読む
 */

/** 草の週の数 (GitHub と同じく約1年) */
function HOME_WEEKS() {
  return 53;
}

/**
 * 'YYYY-MM-DD' を n 日ずらす。
 *
 * @param {string} day
 * @param {number} n
 * @returns {string}
 */
function homeAddDay_(day, n) {
  var d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

/**
 * 草。前に進めた行い (記録・完了・依頼・承認や差し戻し・反映) を日ごとに数える。
 *
 * **チームは1つの行いを1回。** 担当が2人のやることを完了しても1。自分の草は、
 * その行いを自分のものとして数えるとき (完了は担当、空なら閉じた人) に1。
 *
 * @param {string} email 開いている本人
 * @param {Date} now
 * @returns {{weeks: Array<Array<{day: string, me: number, team: number, future: boolean}>>, meTotal: number}}
 */
function homeActivity_(email, now) {
  var me = String(email || '');
  var span = motivationSpan_(now);
  var first = homeAddDay_(span.weekStart, -7 * (HOME_WEEKS() - 1));
  var mine = {};
  var team = {};

  function add(v, who) {
    var day = motivationDay_(v);
    if (!day || day < first || day > span.today) return;
    team[day] = (team[day] || 0) + 1;
    if (me && who.indexOf(me) >= 0) mine[day] = (mine[day] || 0) + 1;
  }

  var commits = dbReadAll('commits');
  for (var c = 0; c < commits.length; c++) {
    add(commits[c].timestamp, [String(commits[c].author || '')]);
  }

  var closers = motivationClosers_();
  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    if (String(issues[i].state) !== 'closed') continue;
    add(issues[i].closedAt, motivationCredited_(issues[i], closers));
  }

  var pulls = dbReadAll('pulls');
  var authors = {};
  for (var p = 0; p < pulls.length; p++) {
    var author = String(pulls[p].author || '');
    authors[String(pulls[p].number)] = author;
    add(pulls[p].createdAt, [author]);
    if (String(pulls[p].state) === 'merged') add(pulls[p].mergedAt, [author]);
  }

  var reviews = dbReadAll('reviews');
  for (var r = 0; r < reviews.length; r++) {
    var state = String(reviews[r].state);
    if (state !== 'approve' && state !== 'request_changes') continue;
    var reviewer = String(reviews[r].reviewer || '');
    // 自分の依頼への自分の判断は行いに数えない
    if (!reviewer || reviewer === authors[String(reviews[r].prNumber)]) continue;
    add(reviews[r].at, [reviewer]);
  }

  var weeks = [];
  var meTotal = 0;
  for (var w = 0; w < HOME_WEEKS(); w++) {
    var days = [];
    for (var d = 0; d < 7; d++) {
      var day = homeAddDay_(first, w * 7 + d);
      var future = day > span.today;
      var m = future ? 0 : (mine[day] || 0);
      meTotal += m;
      days.push({ day: day, me: m, team: future ? 0 : (team[day] || 0), future: future });
    }
    weeks.push(days);
  }
  return { weeks: weeks, meTotal: meTotal };
}
