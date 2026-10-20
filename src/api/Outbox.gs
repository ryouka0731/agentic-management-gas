/*
 * 画面の API: 手元への頼みごと。
 */

/**
 * 手元の Claude に頼みごとを置く (Web App API)。
 *
 * **この道具から手元へ向かう唯一の経路である。** 外部 API は使わないので、
 * Drive の同期に乗せ、手元から取りに来てもらう。押すのではなく取りに来る形
 * なので、寝ている機械は起きない。
 *
 * @param {string} verb
 * @param {object} args
 * @param {object} [extra]
 * @returns {object}
 */
function apiOutboxAdd(verb, args, extra) {
  return outboxToPlain_(outboxAdd(verb, args || {}, extra || {}));
}

/**
 * 置かれている頼みごとを返す (Web App API)。
 *
 * @param {string} [state]
 * @returns {object[]}
 */
function apiOutboxList(state) {
  return outboxList(state || '');
}

/**
 * 頼めることの一覧を返す (Web App API)。
 *
 * 語彙を画面側に写さない。写すと、足したときに選べるのに置けない動詞が出る。
 *
 * @returns {Array<Array<string>>} [動詞, 見せる字]
 */
function apiOutboxVerbs() {
  var verbs = OUTBOX_VERBS();
  var out = [];

  for (var key in verbs) {
    if (!Object.prototype.hasOwnProperty.call(verbs, key)) continue;
    out.push([key, verbs[key].label]);
  }
  return out;
}

/**
 * まだ誰も取っていない頼みごとを取る (Web App API)。
 *
 * 取った印を付けてから返す。付けないと、2つの手元が同じ頼みごとを別々に
 * 進めて、同じ差分が2回添えられる。
 *
 * @param {number} [limit]
 * @returns {object[]}
 */
function apiOutboxTake(limit) {
  outboxReclaim(24, new Date());
  return outboxTake(limit);
}

/**
 * 頼みごとを終わったことにする (Web App API)。
 *
 * @param {number} id
 * @param {string} result
 * @returns {object}
 */
function apiOutboxDone(id, result) {
  return outboxDone(id, result);
}

/**
 * 頼みごとをできなかったことにする (Web App API)。
 *
 * @param {number} id
 * @param {string} reason
 * @returns {object}
 */
function apiOutboxFail(id, reason) {
  return outboxFail(id, reason);
}
