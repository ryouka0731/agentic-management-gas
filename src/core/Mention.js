/**
 * 文中の「@だれか」を見つける。
 *
 * 話に加わっていない人には気づかれない。名前を呼べるようにすると、
 * 見てほしい相手にだけ知らせが届く。
 *
 * 呼び名はメールアドレスに解決する。表示名は重なるうえ変わるため、
 * 誰を指したのかが後から分からなくなる。
 */

/**
 * 呼び出しを拾う正規表現。
 *
 * 「@ユーザ名」と「@ユーザ名@example.com」の両方を拾う。
 *
 * @returns {RegExp} 毎回新しく作る (lastIndex を持ち回らない)
 */
function MENTION_RE() {
  return /@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;
}

/**
 * 呼び名を1つ、名簿の誰かに結び付ける。
 *
 * @param {string} token 「@」を除いた呼び名
 * @param {string[]} known 名簿 (メールアドレス)
 * @returns {string} 見つからなければ空文字
 */
function mentionMatch(token, known) {
  var want = String(token || '').toLowerCase();
  if (!want) return '';

  for (var i = 0; i < (known || []).length; i++) {
    var one = String(known[i] || '');
    var low = one.toLowerCase();

    if (low === want) return one;
    // 「@」を書かずに呼べるようにする。同じ名前が2人いても先勝ちにする
    if (want.indexOf('@') < 0 && low.split('@')[0] === want) return one;
  }
  return '';
}

/**
 * 文中で呼ばれた人を返す。重複は除く。
 *
 * @param {string} text
 * @param {string[]} known 名簿
 * @returns {string[]}
 */
function mentionResolve(text, known) {
  var re = MENTION_RE();
  var seen = {};
  var out = [];
  var m;

  while ((m = re.exec(String(text || ''))) !== null) {
    var who = mentionMatch(m[1], known);
    if (!who || seen[who]) continue;

    seen[who] = true;
    out.push(who);
  }
  return out;
}

/**
 * 文を「ふつうの字」と「呼び出し」に切り分ける。
 *
 * 画面は textContent だけで組み立てる決まりなので、色を付ける場所を
 * ここで決めて渡す。
 *
 * @param {string} text
 * @param {string[]} known 名簿
 * @returns {Array<{text:string, mention:string}>} mention は空なら普通の字
 */
function mentionSegments(text, known) {
  var src = String(text || '');
  var re = MENTION_RE();
  var out = [];
  var at = 0;
  var m;

  while ((m = re.exec(src)) !== null) {
    var who = mentionMatch(m[1], known);
    if (!who) continue;

    if (m.index > at) out.push({ text: src.substring(at, m.index), mention: '' });
    out.push({ text: m[0], mention: who });
    at = m.index + m[0].length;
  }

  if (at < src.length) out.push({ text: src.substring(at), mention: '' });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MENTION_RE: MENTION_RE,
    mentionMatch: mentionMatch,
    mentionResolve: mentionResolve,
    mentionSegments: mentionSegments,
  };
}
