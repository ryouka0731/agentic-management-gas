/**
 * 仕事の前進を見せる (意欲づけ)。
 *
 * 文献の要点 (docs/superpowers/plans/2026-10-07-motivation.md):
 * - 小さな前進を日々実感できることが、仕事の中の気持ちを最も良くする (Amabile & Kramer 2011)
 * - 自律・有能感・関係性が満たされるほど自律的な動機が上がる (Gagné & Deci 2005)
 * - 予告された報酬は内発的動機を下げる (Deci, Koestner & Ryan 1999)。点数は配らない
 * - 職場の個人ランキングは晒しと受け取られる (Jia ら 2017)。人ごとの順位は作らない
 *
 * だから、ここで数えるのは**チームの前進**と、**本人にだけ見える最初の一歩**に限る。
 */

/**
 * チームの毎月の目標 (完了するやることの件数) を置くスクリプトプロパティの鍵。
 *
 * @returns {string}
 */
function TEAM_GOAL_KEY() {
  return 'TEAM_MONTHLY_GOAL';
}

/**
 * 東京の暦日 'YYYY-MM-DD'。読めなければ ''。
 *
 * @param {*} v
 * @returns {string}
 */
function motivationDay_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  var t = Date.parse(String(v));
  if (isNaN(t)) return '';
  return Utilities.formatDate(new Date(t), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 今週 (月曜はじまり) の月曜と、今月の1日を返す。
 *
 * @param {Date} now
 * @returns {{weekStart: string, monthStart: string, today: string}}
 */
function motivationSpan_(now) {
  var today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  var d = new Date(today + 'T00:00:00Z');
  var back = (d.getUTCDay() + 6) % 7; // 月曜からの日数
  d.setUTCDate(d.getUTCDate() - back);
  return {
    weekStart: d.toISOString().substring(0, 10),
    monthStart: today.substring(0, 8) + '01',
    today: today,
  };
}

/**
 * チームの前進。今週終えたやること・今週反映した確認依頼・今月終えたやることと目標。
 *
 * **人ごとには数えない。** チームの数だけを返す。
 *
 * @param {Date} [now]
 * @returns {{weekClosed: number, weekMerged: number, monthClosed: number, goal: number}}
 */
function motivationProgress(now) {
  var span = motivationSpan_(now || new Date());
  var out = { weekClosed: 0, weekMerged: 0, monthClosed: 0, goal: teamGoal() };

  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    // 捨てたものも数える。終えたあとに置き場へ移しただけで前進が減って見えると、
    // 目標の進み具合が後ろへ戻る
    if (String(issues[i].state) !== 'closed') continue;
    var day = motivationDay_(issues[i].closedAt);
    if (!day) continue;
    if (day >= span.weekStart && day <= span.today) out.weekClosed++;
    if (day >= span.monthStart && day <= span.today) out.monthClosed++;
  }

  var pulls = dbReadAll('pulls');
  for (var p = 0; p < pulls.length; p++) {
    if (String(pulls[p].state) !== 'merged') continue;
    var merged = motivationDay_(pulls[p].mergedAt);
    if (merged && merged >= span.weekStart && merged <= span.today) out.weekMerged++;
  }
  return out;
}

/**
 * チームの毎月の目標。決めていなければ 0。
 *
 * @returns {number}
 */
function teamGoal() {
  var n = Number(PropertiesService.getScriptProperties().getProperty(TEAM_GOAL_KEY()));
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * チームの毎月の目標を決める。0 で消す。
 *
 * **チームに1つだけ。** 個人に割り振ると、目標が人を比べる物差しになる。
 *
 * @param {number} n
 * @returns {number}
 */
function teamGoalSet_(n) {
  var v = Number(n);
  if (!isFinite(v) || v < 0 || v > 9999) throw new Error('目標は 0〜9999 の数で入れてください');
  var props = PropertiesService.getScriptProperties();
  if (v === 0) props.deleteProperty(TEAM_GOAL_KEY());
  else props.setProperty(TEAM_GOAL_KEY(), String(Math.floor(v)));
  return teamGoal();
}

/**
 * はじめの5歩。本人がそれぞれを一度でもしたか。**本人にだけ見せる**
 * (人に見せると、数を集めさせる印になる)。
 *
 * **画面から直に呼べない名前にする (末尾 _)。** アドレスを受け取るので、呼べると
 * ほかの人のアドレスを渡してその人の行いを覗ける。apiMyMilestones が開いている
 * 本人のアドレスだけを渡す。
 *
 * @param {string} email
 * @returns {Array<{key: string, label: string, hint: string, tab: string, done: boolean}>}
 */
function motivationMilestones_(email) {
  var me = String(email || '');
  function any(table, test) {
    var rows = dbReadAll(table);
    for (var i = 0; i < rows.length; i++) if (test(rows[i])) return true;
    return false;
  }
  var pulls = dbReadAll('pulls');
  function mine(pr) { return String(pr.author) === me; }

  return [
    { key: 'branch', label: '改訂版を作る', tab: 'docs',
      hint: '文書を開いて「この文書の改訂版」から。正式版はそのままで、写しを直せます',
      done: any('branches', function (b) { return String(b.name) !== 'main' && String(b.createdBy) === me; }) },
    { key: 'commit', label: '変更を記録する', tab: 'branches',
      hint: '直したら「変更を記録」。その時点がいつでも見比べられるようになります',
      done: any('commits', function (c) { return String(c.branch) !== 'main' && String(c.author) === me; }) },
    { key: 'pull', label: '確認を依頼する', tab: 'branches',
      hint: '改訂中の版から、正式版に反映してよいかを尋ねます',
      done: pulls.some(mine) },
    { key: 'review', label: 'ほかの人の依頼を確かめる', tab: 'pulls',
      hint: '確認依頼を開いて、承認するか意見を書きます',
      done: any('reviews', function (r) { return String(r.reviewer) === me; }) },
    { key: 'merge', label: '正式版に反映する', tab: 'pulls',
      hint: '承認された依頼を「正式版に反映する」。誰がいつ何を変えたかが残ります',
      done: pulls.some(function (pr) { return mine(pr) && String(pr.state) === 'merged'; }) },
  ];
}

/**
 * 作ってからこの日数以上たって片づいたものを「長く止まっていたもの」とする。
 * 入れたあと4週で見直す。
 *
 * @returns {number}
 */
function CLOSE_LONG_DAYS() {
  return 14;
}

/** @returns {number} これ以上のポイントを「重いもの」とする */
function CLOSE_HEAVY_POINTS() {
  return 5;
}

/** @returns {number} これ以上の予定時間を「重いもの」とする */
function CLOSE_HEAVY_HOURS() {
  return 4;
}

/**
 * ミリ秒。読めなければ NaN。台帳からは Date でも字でも返ってくる。
 *
 * @param {*} v
 * @returns {number}
 */
function motivationTime_(v) {
  if (!v) return NaN;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  return Date.parse(String(v));
}

/**
 * 重いものか。件数だけをほめると簡単なものから手を付けるようになる (KC ら 2020)
 * ので、重さにも同じ手応えを返す。
 *
 * @param {object} row issues の行
 * @returns {boolean}
 */
function motivationIsHeavy_(row) {
  var p = Number(row.points);
  var h = Number(row.plannedHours);
  return (isFinite(p) && p >= CLOSE_HEAVY_POINTS()) || (isFinite(h) && h >= CLOSE_HEAVY_HOURS());
}

/**
 * 作ってから閉じるまでの日数 (東京の暦日で数える)。読めなければ 0。
 *
 * @param {object} row issues の行
 * @returns {number}
 */
function motivationWaitedDays_(row) {
  var from = motivationDay_(row.createdAt);
  var to = motivationDay_(row.closedAt);
  if (!from || !to) return 0;
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

/**
 * 親ごとの子。**捨てた子は入れない。** 残りとして居座ると親が永遠に終わらない。
 *
 * @param {object[]} issues
 * @returns {Object<string, object[]>}
 */
function motivationChildren_(issues) {
  var kids = {};
  for (var i = 0; i < issues.length; i++) {
    var p = issues[i].parent;
    if (!p || issues[i].archivedAt) continue;
    var key = String(p);
    (kids[key] = kids[key] || []).push(issues[i]);
  }
  return kids;
}

/**
 * 完了にしたやることについて、何が起きたかを**1つだけ**選んで返す。
 * 重ねると派手になり、どれも残らない。
 *
 * くじで驚かせず、本当に起きたことで驚かせる。ドーパミンは予想との差に反応する
 * (Schultz ら 1997) が、確率で変わる報酬は職場ではギャンブルと同じ形になる。
 *
 * @param {number} number
 * @param {Date} now
 * @returns {object}
 */
function closeFeedback_(number, now) {
  var issues = dbReadAll('issues');
  var byNo = {};
  for (var i = 0; i < issues.length; i++) byNo[String(issues[i].number)] = issues[i];

  var row = byNo[String(number)];
  if (!row) throw new Error('やること #' + number + ' が見つかりません');

  var team = motivationProgress(now);
  var out = {
    kind: 'team',
    number: Number(row.number),
    title: String(row.title || ''),
    weekClosed: team.weekClosed,
    monthClosed: team.monthClosed,
    goal: team.goal,
  };

  var parent = row.parent ? byNo[String(row.parent)] : null;
  if (parent && String(parent.state) !== 'closed' && !parent.archivedAt) {
    var kids = motivationChildren_(issues)[String(parent.number)] || [];
    var done = 0;
    for (var k = 0; k < kids.length; k++) if (String(kids[k].state) === 'closed') done++;
    // 子が全部捨てられていると 0/0 になる。それを「全部終わった」と読まない
    if (kids.length) {
      out.parent = { number: Number(parent.number), title: String(parent.title || ''),
        done: done, total: kids.length };
      out.kind = done === kids.length ? 'parentDone' : 'parentStep';
      return out;
    }
  }

  var days = motivationWaitedDays_(row);
  if (days >= CLOSE_LONG_DAYS()) {
    out.kind = 'longAwaited';
    out.days = days;
    return out;
  }
  if (motivationIsHeavy_(row)) out.kind = 'heavy';
  return out;
}
