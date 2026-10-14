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

/** あなたの番に種類ごとに出す件数 */
function HOME_TURN_MAX() {
  return 5;
}

/** 期限が近いとみなす日数 (今日から) */
function HOME_DUE_DAYS() {
  return 3;
}

/** 最近の動きの件数 */
function HOME_RECENT_MAX() {
  return 10;
}

/**
 * 先頭の HOME_TURN_MAX() 件と総数。
 *
 * @param {object[]} list
 * @returns {{items: object[], total: number}}
 */
function homeCap_(list) {
  return { items: list.slice(0, HOME_TURN_MAX()), total: list.length };
}

/**
 * いま自分を待っているもの。
 *
 * 判断の新旧は prDecisions_ と同じ規則で数える (承認は staleReviewId 以下なら古い。
 * 差し戻しは古くしない)。**依頼ごとに表を読まない** (reviews と pulls を1回ずつ読む)。
 *
 * @param {string} email
 * @param {Date} now
 * @returns {{reviews: {items: object[], total: number}, returned: {items: object[], total: number},
 *   due: {items: object[], total: number}}}
 */
function homeMyTurn_(email, now) {
  var me = String(email || '');
  var today = motivationDay_(now);
  var soon = homeAddDay_(today, HOME_DUE_DAYS());

  var pulls = dbReadAll('pulls');
  var byNumber = {};
  for (var p = 0; p < pulls.length; p++) byNumber[String(pulls[p].number)] = pulls[p];

  // 依頼ごと・人ごとの最後の判断
  var latest = {};
  var reviews = dbReadAll('reviews');
  for (var r = 0; r < reviews.length; r++) {
    var rv = reviews[r];
    var state = String(rv.state);
    if (state !== 'approve' && state !== 'request_changes') continue;
    var pr = byNumber[String(rv.prNumber)];
    if (!pr) continue;
    if (state === 'approve' && Number(rv.id) <= (Number(pr.staleReviewId) || 0)) state = 'stale';
    var key = String(rv.prNumber);
    latest[key] = latest[key] || {};
    latest[key][String(rv.reviewer)] = state;
  }

  var toReview = [];
  var returned = [];
  for (var q = 0; q < pulls.length; q++) {
    var one = pulls[q];
    var st = String(one.state);
    if (st !== 'open' && st !== 'approved') continue;
    var decided = latest[String(one.number)] || {};
    var item = { number: Number(one.number), title: String(one.title || '') };

    if (String(one.author) !== me && prReviewers(one).indexOf(me) >= 0 &&
        (!decided[me] || decided[me] === 'stale')) {
      toReview.push(item);
    }
    if (String(one.author) === me) {
      for (var who in decided) {
        if (decided[who] === 'request_changes') { returned.push(item); break; }
      }
    }
  }

  var due = [];
  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) === 'closed' || row.archivedAt) continue;
    if (issueAssignees(row).indexOf(me) < 0) continue;
    var day = motivationDay_(row.dueDate);
    if (!day || day > soon) continue;
    due.push({ number: Number(row.number), title: String(row.title || ''), due: day, overdue: day < today });
  }
  due.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : a.number - b.number; });

  return { reviews: homeCap_(toReview), returned: homeCap_(returned), due: homeCap_(due) };
}

/**
 * チームで最近起きたこと。**名前もアドレスも持たない** (誰が何をしたかの流れは監視に見える)。
 *
 * 変更の記録は数が多く流れるので出さない。捨てたやることは出さない。
 *
 * @param {Date} now
 * @returns {Array<{kind: string, number: number, fileId: string, title: string, at: Date}>}
 */
function homeRecent_(now) {
  var limit = now.getTime();
  var out = [];

  function push(kind, number, fileId, title, at) {
    var t = motivationTime_(at);
    if (isNaN(t) || t > limit) return;
    out.push({ kind: kind, number: number, fileId: fileId, title: title, at: new Date(t) });
  }

  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    if (String(issues[i].state) !== 'closed' || issues[i].archivedAt) continue;
    push('closed', Number(issues[i].number), '', String(issues[i].title || ''), issues[i].closedAt);
  }

  var pulls = dbReadAll('pulls');
  for (var p = 0; p < pulls.length; p++) {
    var pr = pulls[p];
    push('pull', Number(pr.number), '', String(pr.title || ''), pr.createdAt);
    if (String(pr.state) === 'merged') push('merged', Number(pr.number), '', String(pr.title || ''), pr.mergedAt);
  }

  var files = dbReadAll('files');
  for (var f = 0; f < files.length; f++) {
    if (branchOfPath_(String(files[f].path || '')) !== 'main') continue;
    push('file', 0, String(files[f].fileId || ''), String(files[f].path || ''), files[f].registeredAt);
  }

  // 新しい順。同じ時刻なら反映を先に (依頼を出してすぐ反映した場合の並びを決める)
  var rank = { merged: 0, closed: 1, pull: 2, file: 3 };
  out.sort(function (a, b) {
    return b.at.getTime() - a.at.getTime() || rank[a.kind] - rank[b.kind];
  });
  return out.slice(0, HOME_RECENT_MAX());
}
