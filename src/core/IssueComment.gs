/**
 * やることの中でのやりとり。
 *
 * 決めた結果だけが残って、なぜそう決めたのかが残らないと、同じ議論を
 * また一からやることになる。作業の場でそのまま話せるようにする。
 */

/**
 * 次の番号を返す。
 *
 * @returns {number}
 */
function issueCommentNextId_() {
  var rows = dbReadAll('issue_comments');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].id);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * やりとりを1件返す。無ければエラー。
 *
 * @param {number} id
 * @returns {object}
 */
function issueCommentGet(id) {
  if (id === '' || id === null || id === undefined) {
    throw new Error('やりとりを指定してください');
  }
  var row = dbFindOne('issue_comments', 'id', id);
  if (!row) throw new Error('やりとりが見つかりません: ' + id);

  return row;
}

/**
 * 書き込む。
 *
 * @param {number} number やることの番号
 * @param {string} body
 * @returns {object} issue_comments 行
 */
function issueCommentAdd(number, body) {
  var issue = issueGet(number);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');
  if (text.length > 4000) throw new Error('内容は4000文字までにしてください');

  var row = {
    id: issueCommentNextId_(),
    issueNumber: Number(number),
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    editedAt: '',
  };
  dbAppend('issue_comments', row);

  notifyIssueComment(issue, row, issueCommentAudience_(issue, row));
  notifyIssueCommentMention(issue, row, issueCommentCalled_(issue, text, row.by));
  return row;
}

/**
 * 知らせる相手を返す。
 *
 * 担当者と、これまで書き込んだ人。書いた本人には送らない。
 *
 * @param {object} issue
 * @param {object} row いま書いたもの
 * @returns {string[]}
 */
function issueCommentAudience_(issue, row) {
  var seen = {};
  var out = [];

  function add(who) {
    var one = String(who || '');
    if (!one || one === String(row.by) || seen[one]) return;

    seen[one] = true;
    out.push(one);
  }

  var assignees = issueAssignees(issue);
  for (var a = 0; a < assignees.length; a++) add(assignees[a]);

  var talked = issueComments(issue.number);
  for (var i = 0; i < talked.length; i++) add(talked[i].by);

  return out;
}

/**
 * 名前を呼ばれた人のうち、まだ知らせていない人を返す。
 *
 * @param {object} issue
 * @param {string} text
 * @param {string} me 書いた人
 * @returns {string[]}
 */
function issueCommentCalled_(issue, text, me) {
  var already = issueCommentAudience_(issue, { by: me });
  var called = mentionResolve(text, inquiryRoster_());
  var out = [];

  for (var i = 0; i < called.length; i++) {
    if (String(called[i]) === String(me)) continue;
    if (already.indexOf(called[i]) >= 0) continue;

    out.push(called[i]);
  }
  return out;
}

/**
 * やりとりを古い順に返す。
 *
 * @param {number} number
 * @returns {object[]}
 */
function issueComments(number) {
  var rows = dbReadAll('issue_comments');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].issueNumber) !== Number(number)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return out;
}

/**
 * 書いた本人かを確かめる。
 *
 * @param {object} row
 */
function issueCommentAssertOwn_(row) {
  var me = Session.getActiveUser().getEmail();
  if (String(row.by) !== String(me)) {
    throw new Error('自分が書いたものだけ直せます');
  }
}

/**
 * 書き直す。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function issueCommentEdit(id, body) {
  var row = issueCommentGet(id);
  issueCommentAssertOwn_(row);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');

  dbUpdate('issue_comments', 'id', id, { body: text, editedAt: new Date() });
  return issueCommentGet(id);
}

/**
 * 消す。
 *
 * @param {number} id
 */
function issueCommentDelete(id) {
  var row = issueCommentGet(id);
  issueCommentAssertOwn_(row);

  dbDelete('issue_comments', 'id', id);
}
