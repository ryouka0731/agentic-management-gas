/*
 * 画面の API: 報告とそのやりとり、自分あての知らせ。
 */

/**
 * inquiries の行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {object} [shared] 一覧で1回だけ求めたもの {me, owner, replies}
 * @returns {object}
 */
function inquiryToPlain_(row, shared) {
  // 一覧では管理者かどうかと返信の数を先に1回だけ求めて渡す。1件ごとに求めると
  // 件数のぶん Drive と返信の表を読みに行き、報告が増えるほど遅くなる
  var me = shared ? shared.me : Session.getActiveUser().getEmail();
  var admin = shared ? shared.admin : repoIsAdmin_(me);

  return {
    number: Number(row.number),
    kind: plainText(row.kind),
    kindLabel: INQUIRY_KINDS()[row.kind] || String(row.kind || ''),
    title: String(row.title || inquiryTitleOf_(row.body)),
    body: plainText(row.body),
    by: plainText(row.by),
    state: plainText(row.state),
    context: plainText(row.context),
    answer: plainText(row.answer),
    closedBy: plainText(row.closedBy),
    at: plainDate(row.at),
    answeredAt: plainDate(row.answeredAt),
    shots: inquiryShotLinks_(row),
    issueNumber: row.issueNumber === '' || row.issueNumber == null
      ? '' : Number(row.issueNumber),
    mine: String(row.by) === String(me),
    // 閉じられるかは画面では決められない。ここで決めて渡す
    canClose: String(row.by) === String(me) || admin,
    replyCount: shared
      ? (shared.replies[String(Number(row.number))] || 0)
      : inquiryReplies(row.number).length,
  };
}

/**
 * inquiry_replies の行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {string} me
 * @returns {object}
 */
function inquiryReplyToPlain_(row, me) {
  var out = plainTalk(row, me, 'inquiryNumber');

  // 画像の添えは報告の返信にしか無い
  out.shots = inquiryShotLinks_(row);
  return out;
}

/**
 * 添えられた画像の見せ方を作る。
 *
 * 実体は Drive にある。画面には見るための URL だけを渡す。
 *
 * @param {object} row
 * @returns {Array<{id:string, url:string, thumb:string}>}
 */
function inquiryShotLinks_(row) {
  var ids = inquiryShotsOf(row);
  var out = [];

  for (var i = 0; i < ids.length; i++) {
    out.push({
      id: ids[i],
      url: 'https://drive.google.com/file/d/' + ids[i] + '/view',
      thumb: 'https://drive.google.com/thumbnail?id=' + ids[i] + '&sz=w800',
    });
  }
  return out;
}

/**
 * 報告を送る (Web App API)。
 *
 * @param {string} kind
 * @param {string} body
 * @param {string} context
 * @param {string[]} shots
 * @returns {object}
 */
function apiInquiryCreate(kind, body, context, shots) {
  return inquiryToPlain_(inquiryCreate(kind, body, context, shots));
}

/**
 * 報告を返す (Web App API)。
 *
 * 使う人どうしで話せるように、全員が全部を読める。同じところで
 * つまずいた人が先に答えを知っていることがあり、自分のぶんしか
 * 見えないと誰も助け合えない。
 *
 * @returns {object[]}
 */
function apiInquiryList() {
  var rows = inquiryList(null);
  var out = [];

  var me = Session.getActiveUser().getEmail();
  var shared = {
    me: me,
    admin: repoIsAdmin_(me),
    replies: {},
  };
  var replies = dbReadAll('inquiry_replies');
  for (var r = 0; r < replies.length; r++) {
    var key = String(Number(replies[r].inquiryNumber));
    shared.replies[key] = (shared.replies[key] || 0) + 1;
  }

  for (var i = 0; i < rows.length; i++) out.push(inquiryToPlain_(rows[i], shared));
  return out;
}

/**
 * 報告とそのやりとりを返す (Web App API)。
 *
 * @param {number} number
 * @returns {{inquiry: object, replies: object[]}}
 */
function apiInquiryThread(number) {
  var me = Session.getActiveUser().getEmail();
  var replies = inquiryReplies(number);
  var out = [];

  for (var i = 0; i < replies.length; i++) {
    out.push(inquiryReplyToPlain_(replies[i], me));
  }
  return { inquiry: inquiryToPlain_(inquiryGet(number)), replies: out };
}

/**
 * 報告に返信する (Web App API)。
 *
 * @param {number} number
 * @param {string} body
 * @param {string[]} shots
 * @returns {object}
 */
function apiInquiryReply(number, body, shots) {
  var me = Session.getActiveUser().getEmail();
  return inquiryReplyToPlain_(inquiryReply(number, body, shots), me);
}

/**
 * 返信を書き直す (Web App API)。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function apiInquiryReplyEdit(id, body) {
  var me = Session.getActiveUser().getEmail();
  return inquiryReplyToPlain_(inquiryReplyEdit(id, body), me);
}

/**
 * 返信を消す (Web App API)。
 *
 * @param {number} id
 * @returns {string}
 */
function apiInquiryReplyDelete(id) {
  inquiryReplyDelete(id);
  return '返信を消しました';
}

/**
 * 話を閉じる (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiInquiryClose(number) {
  return inquiryToPlain_(inquiryClose(number));
}

/**
 * 閉じた話を開け直す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiInquiryReopen(number) {
  return inquiryToPlain_(inquiryReopen(number));
}

/**
 * 自分あての知らせを返す (Web App API)。
 *
 * @param {number} [limit]
 * @returns {{items: object[], unread: number}}
 */
function apiNotifications(limit) {
  var me = Session.getActiveUser().getEmail();
  var rows = noticeList(me, limit || 30);
  var items = [];
  var unread = 0;

  for (var i = 0; i < rows.length; i++) {
    var read = rows[i].readAt ? new Date(rows[i].readAt) : null;
    if (!read) unread++;

    items.push({
      id: Number(rows[i].id),
      kind: String(rows[i].kind || ''),
      title: String(rows[i].title || ''),
      body: String(rows[i].body || ''),
      link: String(rows[i].link || ''),
      at: plainDate(rows[i].at),
      read: !!read,
    });
  }
  return { items: items, unread: unread };
}

/**
 * 知らせを読んだことにする (Web App API)。
 *
 * @param {number[]} [ids] 省略すると自分あてを全部
 * @returns {number}
 */
function apiNotificationsRead(ids) {
  return noticeMarkRead(ids || []);
}

/**
 * 報告の種類の一覧を返す (Web App API)。
 *
 * @returns {Array<{value:string, label:string}>}
 */
function apiInquiryKinds() {
  var kinds = INQUIRY_KINDS();
  var out = [];

  for (var key in kinds) {
    if (!Object.prototype.hasOwnProperty.call(kinds, key)) continue;
    out.push({ value: key, label: kinds[key] });
  }
  return out;
}
