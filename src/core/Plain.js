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

/**
 * やりとりの1件を、画面に渡せる素の形にする。
 *
 * 「番号の付いたものに、誰かが何かを書き足す」という形は、報告
 * (`inquiries`) とやること (`issues`) の両方にある。**同じ形を2か所に
 * 書くと、片方だけ直したときに画面の片側だけ振る舞いが変わる。**
 * 実際に `id` を足したあと、返信では名指しできるのにやりとりでは
 * できない、という食い違いが起きかけた。
 *
 * 親を指す欄の名前だけが違う (`inquiryNumber` / `issueNumber`) ので、
 * それを引数で受ける。画像の添えのように片方にしか無いものは、呼ぶ側で
 * 足す。ここに `if` を増やすと、どちらの形なのかが読めなくなる。
 *
 * **書き換えてよいかはサーバ側で決める。** 画面から受け取ると、他人の
 * 書き込みを自分のものだと名乗って直せる。
 *
 * @param {object} row
 * @param {string} me いま開いている人
 * @param {string} numberKey 親を指す欄の名前
 * @returns {object}
 */
function plainTalk(row, me, numberKey) {
  var out = {
    id: plainId(row.id),
    body: plainText(row.body),
    by: plainText(row.by),
    at: plainDate(row.at),
    editedAt: plainDate(row.editedAt),
    canEdit: plainText(row.by) === plainText(me) && plainId(row.id) > 0,
  };

  out[numberKey] = plainId(row[numberKey]);
  return out;
}
