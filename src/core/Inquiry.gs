/**
 * 不具合の報告と問い合わせ。
 *
 * 使っていて困ったことを、その場から送れるようにする。口頭やメールで
 * 伝えられた報告は集まらないまま消える。メタDBに貯めれば、誰が何に
 * つまずいたかが残り、直す順番を決められる。
 */

/**
 * 報告の種類。
 *
 * @returns {Object<string,string>} 値 → 画面に出す名前
 */
function INQUIRY_KINDS() {
  return {
    bug: 'うまく動かない',
    request: 'こうしてほしい',
    question: '使い方が分からない',
  };
}

/**
 * 次の受付番号を返す。
 *
 * @returns {number}
 */
function inquiryNextNumber_() {
  var rows = dbReadAll('inquiries');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].number);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * 報告を受け付ける。
 *
 * 送った本人が誰かは画面から受け取らない。名乗りを詐称できてしまう。
 *
 * @param {string} kind INQUIRY_KINDS のいずれか
 * @param {string} body 本文
 * @param {string} [context] どの画面から送られたか
 * @returns {object} inquiries 行
 */
function inquiryCreate(kind, body, context) {
  var kinds = INQUIRY_KINDS();
  var key = String(kind || 'bug');
  if (!kinds[key]) throw new Error('種類が正しくありません: ' + kind);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');
  if (text.length > 2000) throw new Error('内容は2000文字までにしてください');

  var row = {
    number: inquiryNextNumber_(),
    kind: key,
    title: inquiryTitleOf_(text),
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    state: 'open',
    context: String(context || '').substring(0, 500),
    answer: '',
    answeredAt: '',
    closedBy: '',
  };
  dbAppend('inquiries', row);

  notifyInquiry(row);
  return row;
}

/**
 * 報告を返す。新しい順。
 *
 * @param {string} [by] 指定するとその人のぶんだけ
 * @returns {object[]}
 */
function inquiryList(by) {
  var rows = dbReadAll('inquiries');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (by && String(rows[i].by) !== String(by)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(b.number) - Number(a.number); });
  return out;
}

/**
 * 報告に答えて、受付を閉じる。
 *
 * @param {number} number
 * @param {string} answer
 * @returns {object} 更新後の行
 */
function inquiryAnswer(number, answer) {
  var row = dbFindOne('inquiries', 'number', number);
  if (!row) throw new Error('受付が見つかりません: ' + number);

  dbUpdate('inquiries', 'number', number, {
    state: 'done',
    answer: String(answer || ''),
    answeredAt: new Date(),
  });

  var after = dbFindOne('inquiries', 'number', number);
  notifyInquiryAnswered(after);
  return after;
}

/**
 * 本文の1行目を見出しにする。
 *
 * 一覧に本文をそのまま並べると、長いものが場所を食って見比べられない。
 * 見出しを別に入力させると、書く手間が増えて報告が出てこなくなる。
 *
 * @param {string} body
 * @returns {string}
 */
function inquiryTitleOf_(body) {
  var first = String(body || '').split('\n')[0].replace(/^\s+|\s+$/g, '');
  return first.length > 60 ? first.substring(0, 60) + '…' : first;
}

/**
 * 報告を1件返す。無ければエラー。
 *
 * @param {number} number
 * @returns {object} inquiries 行
 */
function inquiryGet(number) {
  var row = dbFindOne('inquiries', 'number', number);
  if (!row) throw new Error('受付が見つかりません: ' + number);
  return row;
}

/**
 * 次の返信の番号を返す。
 *
 * @returns {number}
 */
function inquiryReplyNextId_() {
  var rows = dbReadAll('inquiry_replies');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].id);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * 報告に返信する。
 *
 * 使う人どうしでも話せるようにする。同じところでつまずいた人が
 * 先に答えを知っていることがあり、それを開発者だけが答える形にすると
 * 誰も助け合えない。
 *
 * @param {number} number 受付番号
 * @param {string} body
 * @returns {object} inquiry_replies 行
 */
function inquiryReply(number, body) {
  inquiryGet(number);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');
  if (text.length > 2000) throw new Error('内容は2000文字までにしてください');

  var row = {
    id: inquiryReplyNextId_(),
    inquiryNumber: Number(number),
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    editedAt: '',
  };
  dbAppend('inquiry_replies', row);

  notifyInquiryReply(inquiryGet(number), row, inquiryTalkers(number));
  return row;
}

/**
 * 返信を古い順に返す。
 *
 * @param {number} number
 * @returns {object[]}
 */
function inquiryReplies(number) {
  var rows = dbReadAll('inquiry_replies');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].inquiryNumber) !== Number(number)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return out;
}

/**
 * その話に加わっている人を返す。
 *
 * @param {number} number
 * @returns {string[]}
 */
function inquiryTalkers(number) {
  var seen = {};
  var out = [];

  function add(who) {
    var one = String(who || '');
    if (!one || seen[one]) return;
    seen[one] = true;
    out.push(one);
  }

  add(inquiryGet(number).by);

  var replies = inquiryReplies(number);
  for (var i = 0; i < replies.length; i++) add(replies[i].by);
  return out;
}

/**
 * 返信を1件返す。無ければエラー。
 *
 * @param {number} id
 * @returns {object}
 */
function inquiryReplyGet(id) {
  if (id === '' || id === null || id === undefined) {
    throw new Error('返信を指定してください');
  }
  var row = dbFindOne('inquiry_replies', 'id', id);
  if (!row) throw new Error('返信が見つかりません: ' + id);
  return row;
}

/**
 * 書いた本人かを確かめる。
 *
 * @param {object} row
 */
function inquiryAssertOwn_(row) {
  var me = Session.getActiveUser().getEmail();
  if (String(row.by) !== String(me)) {
    throw new Error('自分が書いたものだけ直せます');
  }
}

/**
 * 返信を書き直す。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function inquiryReplyEdit(id, body) {
  var row = inquiryReplyGet(id);
  inquiryAssertOwn_(row);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');

  dbUpdate('inquiry_replies', 'id', id, { body: text, editedAt: new Date() });
  return inquiryReplyGet(id);
}

/**
 * 返信を消す。
 *
 * @param {number} id
 */
function inquiryReplyDelete(id) {
  var row = inquiryReplyGet(id);
  inquiryAssertOwn_(row);
  dbDelete('inquiry_replies', 'id', id);
}

/**
 * 話を閉じられる人かを確かめる。
 *
 * 出した本人と、このアプリを持っている人だけが閉じられる。誰でも
 * 閉じられると、まだ困っている人の話が横から畳まれてしまう。
 *
 * @param {object} row inquiries 行
 */
function inquiryAssertCanClose_(row) {
  var me = Session.getActiveUser().getEmail();
  var owner = Session.getEffectiveUser().getEmail();

  if (String(row.by) !== String(me) && String(owner) !== String(me)) {
    throw new Error('出した本人か、このアプリの持ち主だけが閉じられます');
  }
}

/**
 * 話を閉じる。
 *
 * @param {number} number
 * @returns {object}
 */
function inquiryClose(number) {
  var row = inquiryGet(number);
  inquiryAssertCanClose_(row);
  if (String(row.state) === 'done') return row;

  dbUpdate('inquiries', 'number', number, {
    state: 'done',
    answeredAt: new Date(),
    closedBy: Session.getActiveUser().getEmail(),
  });
  return inquiryGet(number);
}

/**
 * 閉じた話を開け直す。
 *
 * @param {number} number
 * @returns {object}
 */
function inquiryReopen(number) {
  var row = inquiryGet(number);
  inquiryAssertCanClose_(row);
  if (String(row.state) !== 'done') return row;

  dbUpdate('inquiries', 'number', number, {
    state: 'open',
    answeredAt: '',
    closedBy: '',
  });
  return inquiryGet(number);
}
