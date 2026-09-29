/**
 * 台帳の行を、画面に渡せる素の形にする。
 *
 * `google.script.run` は限られた型しか運べない。台帳の行をそのまま返すと
 * Date が混ざった時点で画面には null が届く (apiIssueList と apiPrReviews で
 * 2度踏んだ。後者は「コメントを書いても反映されない」に化けた)。
 *
 * ここは台帳と画面の境目である。台帳側は人が手で書き換えられる表なので、
 * 空欄・全角の数字・日付に見えない字が入り得る。**入り得る形はすべて
 * ここで受け止めて、画面には決まった形だけを渡す。**
 *
 * 各 api 関数の中で同じ変換を書き直さないこと。以前は `iso` という同じ
 * 内部関数が4か所に写されていて、そのうち画面に直に書かれた8か所は
 * `new Date(v).toISOString()` を裸で呼んでいた。日付に見えない字が
 * 1つ入るだけで `RangeError: Invalid time value` になり、一覧まるごとが
 * 出なくなる。
 */

/**
 * 字にする。空欄は空文字にする。
 *
 * `String(v)` を直に呼んではいけない。空欄が 'null' や 'undefined' という
 * 字になって画面に出る。
 *
 * @param {*} v
 * @returns {string}
 */
function plainText(v) {
  return String(v == null ? '' : v);
}

/**
 * 日時を字にする。空欄と、日付に見えないものは空文字にする。
 *
 * 画面側は `String(x).substring(0, 10)` のように扱うため、読めない値は
 * 例外にせず空文字で返す。1件の書き間違いで一覧まるごとを落とさない。
 *
 * @param {*} v
 * @returns {string} ISO 8601 の字、または ''
 */
function plainDate(v) {
  if (!v) return '';

  var d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * 数にする。空欄と、数に見えないものは空文字にする。
 *
 * 0 を空欄と混同しないため、空欄は 0 ではなく '' で返す。工数の欄では
 * 「入れていない」と「0人日」を区別する必要がある。
 *
 * @param {*} v
 * @returns {number|string}
 */
function plainNumber(v) {
  if (v === '' || v === null || v === undefined) return '';

  var n = Number(v);
  return isNaN(n) ? '' : n;
}

/**
 * 番号にする。読めないものは 0 にする。
 *
 * 番号は必ず数として届かなければ、画面側の `#' + number` が 'NaN' になる。
 *
 * @param {*} v
 * @returns {number}
 */
function plainId(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}
