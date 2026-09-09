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
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    state: 'open',
    context: String(context || '').substring(0, 500),
    answer: '',
    answeredAt: '',
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
