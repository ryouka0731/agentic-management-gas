/**
 * 集中のしかた: 「今から始める」の入口 (Web App API)。本体は src/core/Focus.gs。
 *
 * **どれも開いている本人のぶんだけ。** ほかの人の記録を名指しされても断る (focusOwn_)。
 * アドレスを受ける関数は作らない (受けると、ほかの人の集中の様子を覗ける)。
 */

/**
 * 自分の設定の「今から始める」がオンか。オフなら断る。どの入口も最初に呼ぶ。
 *
 * @returns {string} 開いている本人 (小文字)
 */
function focusAssertOn_() {
  var me = focusMe_();
  if (prefGet_('focus.start', me) !== true) {
    throw new Error('「今から始める」は、設定の「集中のしかた」でオンにしてから使えます');
  }
  return me;
}

/**
 * 「今から始める」を開いた (Web App API)。開いた時刻をサーバの時計で覚える (始めるボーナスと電光石火のため)。
 *
 * @param {number} number やることの番号
 * @returns {boolean}
 */
function apiFocusOpen(number) {
  focusOpen_(focusAssertOn_(), number, new Date());
  return true;
}

/**
 * 始める (Web App API)。自分の設定の「今から始める」がオンのときだけ。
 *
 * @param {number} number やることの番号
 * @param {number} minutes 長さ (分)
 * @param {string} [firstStep] 最初の一手 (空でよい)
 * @returns {object}
 */
function apiFocusStart(number, minutes, firstStep) {
  var me = focusAssertOn_();
  var now = new Date();
  // 開いた時刻はサーバが覚えたものだけを使う (画面の時計は信じない)。古い画面が4つ目に時刻を送ってきても読まない
  var row = focusStart_(me, number, minutes, firstStep, focusTakeOpened_(me, number, now), now);
  var out = focusPlain_(row, issueGet(number));
  // 最初の一手だけの「始めた」はポイントにならないので、始めた返事の点はいつも 0
  out.points = 0;
  return out;
}

/**
 * 始めたことを確かめる (Web App API)。番頭の中で手を動かしたあとに画面が呼ぶ。
 * 台帳に本人の手が見つかったときだけ「始めた」にする (画面の言い分だけでは付けない)。
 *
 * @param {number} id
 * @param {string} [kind] comment / edit / move / record
 * @returns {{session: object, fresh: boolean, credited: boolean, points: number}} fresh は今回「始めた」に
 *   なったか、credited は今回ポイントになる手で確かめたか (最初の一手で始めていたものも、ここで点が付く)
 */
function apiFocusProve(id, kind) {
  var me = focusAssertOn_();
  var got = focusProve_(me, id, kind, new Date());
  return { session: focusPlain_(got.row), fresh: !!got.fresh, credited: !!got.credited,
    points: plainNumber(got.credited ? focusPointsOf_(me, got.row) : 0) };
}

/**
 * 延ばす (Web App API)。「もう少し」。
 *
 * @param {number} id
 * @param {number} [minutes]
 * @returns {object}
 */
function apiFocusExtend(id, minutes) {
  return focusPlain_(focusExtend_(focusAssertOn_(), id, minutes, new Date()));
}

/**
 * 終える (Web App API)。done = 終わった (やることが完了になっているときだけ done で残す)、stopped = やめる。
 *
 * @param {number} id
 * @param {string} result
 * @returns {object}
 */
function apiFocusEnd(id, result) {
  return focusPlain_(focusEnd_(focusAssertOn_(), id, result, new Date()));
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
