/**
 * 集中のしかた: 「今から始める」の入口 (Web App API)。本体は src/core/Focus.gs。
 *
 * **どれも開いている本人のぶんだけ。** ほかの人の記録を名指しされても断る (focusOwn_)。
 * アドレスを受ける関数は作らない (受けると、ほかの人の集中の様子を覗ける)。
 */

/**
 * 始める (Web App API)。自分の設定の「今から始める」がオンのときだけ。
 *
 * @param {number} number やることの番号
 * @param {number} minutes 長さ (分)
 * @param {string} [firstStep] 最初の一手 (空でよい)
 * @param {string} [openedAt] 画面が「今から始める」を開いた時刻 (ISO)
 * @returns {object}
 */
function apiFocusStart(number, minutes, firstStep, openedAt) {
  var me = focusMe_();
  if (prefGet_('focus.start', me) !== true) {
    throw new Error('「今から始める」は、設定の「集中のしかた」でオンにしてから使えます');
  }
  var row = focusStart_(me, number, minutes, firstStep, openedAt, new Date());
  var out = focusPlain_(row, issueGet(number));
  out.points = plainNumber(row.provedAt ? focusPointsOf_(me, row) : 0);
  return out;
}

/**
 * 始めたことを確かめる (Web App API)。番頭の中で手を動かしたあとに画面が呼ぶ。
 * 台帳に本人の手が見つかったときだけ「始めた」にする (画面の言い分だけでは付けない)。
 *
 * @param {number} id
 * @param {string} [kind] comment / edit / move / record
 * @returns {{session: object, fresh: boolean, points: number}}
 */
function apiFocusProve(id, kind) {
  var me = focusMe_();
  var got = focusProve_(me, id, kind, new Date());
  return { session: focusPlain_(got.row), fresh: !!got.fresh,
    points: plainNumber(got.fresh ? focusPointsOf_(me, got.row) : 0) };
}

/**
 * 延ばす (Web App API)。「もう少し」。
 *
 * @param {number} id
 * @param {number} [minutes]
 * @returns {object}
 */
function apiFocusExtend(id, minutes) {
  return focusPlain_(focusExtend_(focusMe_(), id, minutes));
}

/**
 * 終える (Web App API)。done = 終わった (やることは画面が先に完了にしてある)、stopped = やめる。
 *
 * @param {number} id
 * @param {string} result
 * @returns {object}
 */
function apiFocusEnd(id, result) {
  return focusPlain_(focusEnd_(focusMe_(), id, result, new Date()));
}

/**
 * 自分の集中の記録 (Web App API)。続いているもの・今週の数・始めるまでの時間・技の図鑑。
 * **本人にだけ返す。連続日数は持たない。** 得ていない技は名前を返さない。
 *
 * @returns {{active: (object|null), week: object, toStart: object[], measured: number, badges: object[]}}
 */
function apiFocusMine() {
  var me = focusMe_();
  var now = new Date();
  var mine = focusRowsOf_(me);
  var active = focusActive_(mine, now);
  var stats = focusStats_(mine, now);
  var issue = null;
  if (active) issue = dbFindOne('issues', 'number', active.issueNumber);
  return {
    active: active ? focusPlain_(active, issue) : null,
    week: { started: plainNumber(stats.week.started), proved: plainNumber(stats.week.proved),
      finished: plainNumber(stats.week.finished) },
    toStart: stats.toStart.map(function (b) { return { label: plainText(b.label), count: plainNumber(b.count) }; }),
    measured: plainNumber(stats.measured),
    badges: focusBadges_(mine).map(function (b) {
      return { key: plainText(b.key), label: plainText(b.label), about: plainText(b.about), done: !!b.done,
        at: plainText(b.at) };
    }),
  };
}
