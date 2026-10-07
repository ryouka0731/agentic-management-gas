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
