/**
 * 自分のキャラを「みんなに公開する」。置き場は OshiStore.gs と同じ台帳の `oshi` で、末尾の列 `shared` に印を置く
 * (足す前の行は空 = 公開していない)。
 *
 * - **読む道は公開されたものだけ。** ほかの人が選べるのは、公開されていて本人のものでないキャラだけ
 *   (自分の設定 oshi.char の 'shared:<番号>'。番号は `oshi` の行の通し番号で、人ごとの charId ではない)。
 *   読めるのは絵・名前・口調・せりふ・プロフィール (どこまで分かるかは使う人のなつき度で決まる)
 * - **書く道は作った人だけ。** 絵・名前・せりふ・プロフィール・消す・公開の入り切りは、どれも今までどおり本人のキャラだけ
 *   (OshiStore.gs の oshiAssertMine_)。借りた人は直せない
 * - 公開を止める・キャラを消すと、使っていた人は既定のキャラに戻る (oshi.char の検査 oshiCharKnownFor_ が通らなくなり、
 *   表示の道は既定に倒す)
 * - ほかの人に返すのは作った人の表示名 (members の名前) だけで、アドレスは返さない。名前が無ければ「名前未設定」
 * - なつき度・実績・機嫌は使う人ごと (借りても自分のもの)
 */

/**
 * 行が公開されているか。Sheets は true を真偽で返す。手で書いた 'TRUE' も公開として読む。
 *
 * @param {object} row oshi の行
 * @returns {boolean}
 */
function oshiSharedOn_(row) {
  if (!row) return false;
  return row.shared === true || /^true$/i.test(String(row.shared == null ? '' : row.shared));
}

/**
 * 公開されたキャラを番号 (oshi の行の id) で引く。公開されていなければ null。
 *
 * @param {number} sid
 * @param {object[]} [rows] 読んだ oshi の行
 * @returns {{sid: number, who: string, charId: number, row: object}|null}
 */
function oshiSharedFind_(sid, rows) {
  var n = Number(sid);
  if (!(isFinite(n) && n >= 1)) return null;
  var list = rows || dbReadAll('oshi');
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) !== String(n)) continue;
    if (!oshiSharedOn_(list[i]) || !oshiWho_(list[i].who)) return null;
    return { sid: n, who: oshiWho_(list[i].who), charId: oshiCharIdOf_(list[i]), row: list[i] };
  }
  return null;
}

/**
 * 作った人の表示名。members の名前だけ (アドレスの一部も見せない)。
 *
 * @param {string} who 小文字のアドレス
 * @param {object[]} memberRows 読んだ members の行
 * @returns {string}
 */
function oshiOwnerName_(who, memberRows) {
  for (var i = 0; i < memberRows.length; i++) {
    if (oshiWho_(memberRows[i].email) !== who) continue;
    var name = String(memberRows[i].name || '').replace(/^\s+|\s+$/g, '');
    if (name) return name.substring(0, 40);
  }
  return '名前未設定';
}

/**
 * その人が選べる「みんなのキャラ」(公開されていて、本人のものでないもの)。番号の小さい順。
 *
 * @param {string} email 見る人
 * @param {object[]} [profRows] 読んだ oshi の行
 * @returns {Array<{sid: number, who: string, charId: number, row: object}>}
 */
function oshiSharedFor_(email, profRows) {
  var me = oshiWho_(email);
  return (profRows || dbReadAll('oshi')).filter(function (r) {
    return oshiSharedOn_(r) && oshiWho_(r.who) && oshiWho_(r.who) !== me;
  }).map(function (r) {
    return { sid: Number(r.id), who: oshiWho_(r.who), charId: oshiCharIdOf_(r), row: r };
  }).filter(function (s) { return isFinite(s.sid) && s.sid >= 1; })
    .sort(function (a, b) { return a.sid - b.sid; });
}

/**
 * 自分のキャラの公開を入り切りする。**本人のキャラだけ。** 名前を決めていないキャラは公開できない
 * (名前の行が無い・名前が空)。あるか見てから書くまでを1つの鍵の中で行う。
 *
 * @param {string} email
 * @param {number} id 自分のキャラの番号
 * @param {boolean} on
 * @returns {{id: number, shared: boolean, sid: number}}
 */
function oshiSetShared_(email, id, on) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  var want = on === true;
  return dbWithLock_(30000, function () {
    oshiAssertMine_(who, id);
    var cur = oshiProfile_(who, id);
    if (want && !(cur.row && cur.name)) throw new Error('名前を決めてから公開してください');
    if (!cur.row) return { id: id, shared: false, sid: 0 };
    dbUpdate('oshi', 'id', cur.row.id, { shared: want ? true : '', updatedAt: new Date() });
    return { id: id, shared: want, sid: Number(cur.row.id) };
  });
}
