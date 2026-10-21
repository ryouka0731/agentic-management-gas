/**
 * 画面の API: 目標 (OKR・MBO・KPI)。本体は src/core/Goal.gs、数え方は src/core/GoalScore.js。
 *
 * **既定はオフ。** オフのあいだは apiGoalState のほかは全部断る。どれもアドレスを受けず、
 * 開いている本人として動く。見られるのは本人と、上長の連なり (docs/dev/permissions.md)。
 */

/** 開いている本人 (小文字)。分からなければ断る */
function goalMe_() {
  var me = currentEmailLower_();
  if (!me) throw new Error('誰が開いているか分かりません');
  return me;
}

/**
 * 目標の機能の状態。**オフでも通す** (オンにするよう案内するため)。
 *
 * @returns {{enabled: boolean, period: string, periodLabel: string, unit: string, fyStart: number,
 *   periods: object[], kinds: object[], measures: object[], grades: object[], statuses: object}}
 */
function apiGoalState() {
  var enabled = goalsEnabled_();
  var now = goalCurrentPeriod_();
  var keys = [goalPeriodShift(now, -1), now, goalPeriodShift(now, 1)];
  if (enabled) {
    var me = currentEmailLower_();
    // 前に立てた目標の期も選べるようにする (区切りを変えたあとでも辿れるように)
    dbReadAll('goals').forEach(function (g) {
      var p = String(g.period);
      if (goalLower_(g.who) === me && goalPeriodParse_(p) && keys.indexOf(p) < 0) keys.push(p);
    });
  }
  keys.sort();
  var statuses = GOAL_STATUSES();
  return {
    enabled: enabled,
    period: plainText(now),
    periodLabel: plainText(goalPeriodLabel(now)),
    unit: plainText(prefGet_('goals.period')),
    fyStart: plainNumber(goalFyStartNow_()),
    periods: keys.map(function (k) { return { key: plainText(k), label: plainText(goalPeriodLabel(k)) }; }),
    kinds: GOAL_KINDS().map(function (k) { return { key: k.key, label: k.label, help: k.help }; }),
    measures: GOAL_MEASURES().map(function (m) { return { key: m.key, label: m.label, help: m.help }; }),
    grades: GOAL_GRADES().map(function (g) { return { grade: g.grade, min: g.min }; }),
    statuses: Object.keys(statuses).reduce(function (o, k) { o[k] = statuses[k]; return o; }, {}),
  };
}

/**
 * 自分の目標 (その期) と、つなげられる自分のやること。
 *
 * @param {string} [period] 空ならいまの期
 * @returns {{period: string, periodLabel: string, goals: object[], linkable: object[]}}
 */
function apiGoalMine(period) {
  goalsAssertEnabled_();
  var me = goalMe_();
  var key = goalPeriodClean_(period);
  return {
    period: plainText(key),
    periodLabel: plainText(goalPeriodLabel(key)),
    goals: goalMine_(me, key),
    linkable: goalLinkable_(me),
  };
}

/** 1つの目標を画面の形で返す (見る人として) */
function goalOnePlain_(id) {
  var me = goalMe_();
  return goalPlainList_([goalViewable_(me, id)], me)[0];
}

/**
 * 目標と項目を保存する。id が無ければ新しく立てる。承認済みを直すと、もう一度承認を待つ。
 *
 * @param {object} goal {id?, period?, kind, title, items: [{id?, title, weight, measure, target, unit, filter}]}
 * @returns {object} 保存したあとの目標
 */
function apiGoalSave(goal) {
  goalsAssertEnabled_();
  var saved = goalSave_(goalMe_(), goal);
  return goalOnePlain_(saved.id);
}

/**
 * 下書きか差し戻しの目標を消す。
 *
 * @param {number} id
 * @returns {{id: number}}
 */
function apiGoalDelete(id) {
  goalsAssertEnabled_();
  goalDelete_(goalMe_(), Number(id));
  return { id: plainNumber(id) };
}

/**
 * 上長に承認を頼む。
 *
 * @param {number} id
 * @returns {object}
 */
function apiGoalSubmit(id) {
  goalsAssertEnabled_();
  goalSubmit_(goalMe_(), Number(id));
  return goalOnePlain_(Number(id));
}

/**
 * 承認する・差し戻す (上長)。
 *
 * @param {number} id
 * @param {string} decision 'approve' | 'return'
 * @param {string} note
 * @returns {object}
 */
function apiGoalDecide(id, decision, note) {
  goalsAssertEnabled_();
  goalDecide_(goalMe_(), Number(id), String(decision || ''), note);
  return goalOnePlain_(Number(id));
}

/**
 * 項目にやることをつなぐ。
 *
 * @param {number} itemId
 * @param {number} issueNumber
 * @returns {object} その項目の目標
 */
function apiGoalLink(itemId, issueNumber) {
  goalsAssertEnabled_();
  goalLink_(goalMe_(), Number(itemId), Number(issueNumber));
  return goalOnePlain_(Number(goalItemGet_(Number(itemId)).goalId));
}

/**
 * 結び付きを外す。
 *
 * @param {number} itemId
 * @param {number} issueNumber
 * @returns {object} その項目の目標
 */
function apiGoalUnlink(itemId, issueNumber) {
  goalsAssertEnabled_();
  goalUnlink_(goalMe_(), Number(itemId), Number(issueNumber));
  return goalOnePlain_(Number(goalItemGet_(Number(itemId)).goalId));
}

/**
 * 項目の今の値を入れる ({actual} か {checked})。承認し直しは要らない。
 *
 * @param {number} itemId
 * @param {object} input
 * @returns {object} その項目の目標
 */
function apiGoalProgressInput(itemId, input) {
  goalsAssertEnabled_();
  var item = goalProgressInput_(goalMe_(), Number(itemId), input);
  return goalOnePlain_(Number(item.goalId));
}

/**
 * 振り返りを書く (本人)。
 *
 * @param {number} id
 * @param {string} text
 * @returns {object}
 */
function apiGoalReview(id, text) {
  goalsAssertEnabled_();
  goalReview_(goalMe_(), Number(id), text);
  return goalOnePlain_(Number(id));
}

/**
 * 期末の評価を付ける (上長)。
 *
 * @param {number} id
 * @param {string} grade
 * @param {string} note
 * @returns {object}
 */
function apiGoalGrade(id, grade, note) {
  goalsAssertEnabled_();
  goalGrade_(goalMe_(), Number(id), grade, note);
  return goalOnePlain_(Number(id));
}

/**
 * 見られるほかの人の目標 (その期) と、承認を待っているもの。
 *
 * @param {string} [period]
 * @returns {{period: string, periodLabel: string, goals: object[], pending: object[]}}
 */
function apiGoalTeam(period) {
  goalsAssertEnabled_();
  var key = goalPeriodClean_(period);
  var out = goalTeam_(goalMe_(), key);
  return { period: plainText(key), periodLabel: plainText(goalPeriodLabel(key)), goals: out.goals, pending: out.pending };
}

/**
 * 期末のまとめ (写して貼る字)。
 *
 * @param {number} id
 * @returns {{title: string, text: string}}
 */
function apiGoalReport(id) {
  goalsAssertEnabled_();
  var out = goalReport_(goalMe_(), Number(id));
  return { title: plainText(out.title), text: plainText(out.text) };
}

/**
 * やることにつながっている目標の項目と、つなげる先 (やることの詳細の「目標」の欄)。
 *
 * @param {number} number
 * @returns {{linked: object[], choices: object[]}}
 */
function apiGoalIssueLinks(number) {
  goalsAssertEnabled_();
  return goalIssueLinks_(goalMe_(), Number(number));
}
