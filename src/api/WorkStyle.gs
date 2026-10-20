/**
 * 仕事のスタンス診断の入口 (Web App API)。定義は src/core/WorkStyleTypes.js、覚え方は src/core/WorkStyle.gs。
 *
 * どれも開いている本人のぶんだけを読み書きする。ほかの人の結果を名指しで読む入口は作らない
 * (見せてよいものは apiWorkStyleTeam が型の名前だけ返す)。
 */

/**
 * 問いと答えの段、軸の名前、本人の結果 (無ければ null)、チームに見せているか。
 *
 * 問いの向き (sign) と軸 (axis) は渡さない。画面は数えないので要らない。
 *
 * @returns {object}
 */
function apiWorkStyle() {
  var me = currentEmail_();
  var rec = me ? workStyleRead_(me) : null;
  return {
    questions: STYLE_QUESTIONS().map(function (q) {
      return { id: plainText(q.id), text: plainText(q.text) };
    }),
    scale: WORK_STYLE_SCALE().map(function (s) {
      return { value: plainNumber(s.value), label: plainText(s.label) };
    }),
    axes: WORK_STYLE_AXES().map(function (a) {
      return { key: plainText(a.key), label: plainText(a.label),
        left: plainText(a.poles[0].label), right: plainText(a.poles[1].label) };
    }),
    mine: rec ? workStylePlain_(rec) : null,
    share: me ? prefGet_('style.share', me) === true : false,
  };
}

/**
 * 答えて、本人の結果として覚える。何度でも答え直せる (前の結果は上書き)。
 *
 * @param {Object<string, number>} answers 問いの id → 1〜5
 * @returns {object} workStylePlain_ の形
 */
function apiWorkStyleSave(answers) {
  var me = currentEmail_();
  if (!me) throw new Error('誰の診断か分かりません');
  return workStylePlain_(workStyleSave_(me, answers, new Date()));
}

/**
 * 本人の結果を消す。チームに見せる設定も既定 (見せない) に戻す。戻さないと、
 * 次に診断し直したとき、選んだ覚えの無いまま型の名前が見える。
 *
 * @returns {{ok: boolean}}
 */
function apiWorkStyleForget() {
  var me = currentEmail_();
  if (!me) throw new Error('誰の診断か分かりません');
  // 見せる設定を先に戻す。結果を先に消すと、設定を戻すところで混み合って落ちたとき、
  // 「見せる」が残ったまま結果だけ消え、次に診断し直した型が選んだ覚えの無いまま見える
  apiPrefSet('style.share', null);
  workStyleForget_(me);
  return { ok: true };
}

/**
 * チームに見せてよい人の型の名前 (本人が「チームに見せる」をオンにした人だけ)。点数は入れない。
 *
 * @returns {Object<string, {name: string, emoji: string}>} 小文字のアドレス → 型の名前と絵
 */
function apiWorkStyleTeam() {
  return workStyleShared_();
}
