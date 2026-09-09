/**
 * 通知を送る。
 *
 * 通知はこの1関数に隔離する。将来 UrlFetchApp が解禁されたときに
 * Google Chat Webhook へ差し替える箇所をここだけにするため (spec §6.3)。
 *
 * 通知の失敗で本処理を巻き戻してはならないため、例外は握って記録する。
 * マージが成功したのにメールが送れなかっただけで書き戻しが無かったことに
 * なる、という事態を避ける。
 *
 * @param {string} to 宛先メールアドレス
 * @param {string} subject
 * @param {string} body
 */
function notify(to, subject, body) {
  if (!to) return;
  try {
    GmailApp.sendEmail(to, subject, body);
  } catch (e) {
    Logger.log('通知を送れませんでした: ' + e.message);
  }
}

/**
 * 次の知らせの番号を返す。
 *
 * @returns {number}
 */
function noticeNextId_() {
  var rows = dbReadAll('notifications');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].id);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * 画面の中に知らせを残す。
 *
 * メールは他の便りに埋もれるし、社外の端末では読めないことがある。
 * 開いている画面にも同じことを出せるよう、残しておく。
 *
 * @param {string} to 宛先 (メールアドレス)
 * @param {string} kind 種類 ('mention' | 'reply' | 'review')
 * @param {string} title 一行の見出し
 * @param {string} body 中身
 * @param {string} link 開く先 (例: 'report:12')
 * @returns {object|null} 残した行。宛先が無ければ null
 */
function noticeAdd(to, kind, title, body, link) {
  if (!to) return null;

  var row = {
    id: noticeNextId_(),
    to: String(to),
    kind: String(kind || ''),
    title: String(title || '').substring(0, 200),
    body: String(body || '').substring(0, 500),
    link: String(link || ''),
    at: new Date(),
    readAt: '',
  };
  dbAppend('notifications', row);
  return row;
}

/**
 * 自分あての知らせを新しい順に返す。
 *
 * @param {string} to
 * @param {number} [limit]
 * @returns {object[]}
 */
function noticeList(to, limit) {
  var rows = dbReadAll('notifications');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].to) !== String(to)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(b.id) - Number(a.id); });
  return out.slice(0, limit || 50);
}

/**
 * 知らせを読んだことにする。
 *
 * 他人あてのものは触らない。読んだかどうかは本人にしか決められない。
 *
 * @param {number[]} ids 空なら自分あてを全部
 * @returns {number} 読んだことにした件数
 */
function noticeMarkRead(ids) {
  var me = Session.getActiveUser().getEmail();
  var rows = noticeList(me, 1000);
  var want = ids || [];
  var done = 0;

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].readAt) continue;
    if (want.length && want.indexOf(Number(rows[i].id)) < 0) continue;

    dbUpdate('notifications', 'id', rows[i].id, { readAt: new Date() });
    done++;
  }
  return done;
}

/**
 * PR作成を通知する。
 *
 * @param {object} pr pulls 行
 */
function notifyPrCreated(pr) {
  notify(
    pr.author,
    '[agentic-management] PR #' + pr.number + ' が作成されました',
    pr.title + '\n\nWiki のプルリクエストタブから確認してください。'
  );
}

/**
 * PRマージを通知する。
 *
 * @param {object} pr pulls 行
 */
function notifyPrMerged(pr) {
  notify(
    pr.author,
    '[agentic-management] PR #' + pr.number + ' がマージされました',
    pr.title + '\n\nmain の文書が更新されました。'
  );
}

/**
 * 確認を頼んだことを本人に知らせる。
 *
 * @param {object} pr pulls 行
 * @param {string} to
 */
function notifyPrReviewRequested(pr, to) {
  noticeAdd(to, 'review',
    'PR #' + pr.number + ' の確認を頼まれました', pr.title, 'pull:' + pr.number);

  notify(
    to,
    '[agentic-management] PR #' + pr.number + ' の確認を頼まれました',
    pr.title + '\n\n確認依頼のタブから中身を見て、承認するか直してほしいかを返してください。'
  );
}

/**
 * 報告が届いたことを、このアプリを持っている人に知らせる。
 *
 * 貯めるだけでは誰も気づかない。開いている本人ではなく、入れ物の
 * 持ち主に送る。書いた本人が持ち主なら送らない。
 *
 * @param {object} row inquiries 行
 */
function notifyInquiry(row) {
  var owner = inquiryOwner_();
  if (!owner || String(owner) === String(row.by)) return;

  notify(
    owner,
    '[agentic-management] 報告 #' + row.number + ' が届きました',
    INQUIRY_KINDS()[row.kind] + ' / ' + row.by + '\n\n' +
    row.body + '\n\n' + (row.context || '')
  );
}

/**
 * 報告に答えたことを、送った本人に知らせる。
 *
 * @param {object} row inquiries 行
 */
function notifyInquiryAnswered(row) {
  notify(
    row.by,
    '[agentic-management] 報告 #' + row.number + ' に返事がありました',
    row.body + '\n\n--- 返事 ---\n' + row.answer
  );
}

/**
 * 返信があったことを、その話に加わっている人に知らせる。
 *
 * 書いた本人には送らない。自分の発言で自分に通知が来ると、
 * 通知そのものが読まれなくなる。
 *
 * @param {object} inquiry inquiries 行
 * @param {object} reply inquiry_replies 行
 * @param {string[]} talkers
 */
function notifyInquiryReply(inquiry, reply, talkers) {
  for (var i = 0; i < (talkers || []).length; i++) {
    if (String(talkers[i]) === String(reply.by)) continue;

    notify(
      talkers[i],
      '[agentic-management] 報告 #' + inquiry.number + ' に返信がありました',
      (inquiry.title || inquiry.body) + '\n\n' +
      reply.by + ':\n' + reply.body
    );
    noticeAdd(talkers[i], 'reply',
      reply.by + ' が #' + inquiry.number + ' に返信しました',
      reply.body, 'report:' + inquiry.number);
  }
}

/**
 * 名前を呼ばれたことを知らせる。
 *
 * 話に加わっていない人には気づかれない。呼ばれた本人にだけ届ける。
 *
 * @param {object} inquiry inquiries 行
 * @param {object} post 呼んだ発言 (inquiries か inquiry_replies の行)
 * @param {string[]} people
 */
function notifyInquiryMention(inquiry, post, people) {
  for (var i = 0; i < (people || []).length; i++) {
    notify(
      people[i],
      '[agentic-management] 報告 #' + inquiry.number + ' であなたが呼ばれました',
      (inquiry.title || inquiry.body) + '\n\n' +
      post.by + ':\n' + post.body
    );
    noticeAdd(people[i], 'mention',
      post.by + ' があなたを呼びました',
      post.body, 'report:' + inquiry.number);
  }
}

/**
 * 確認依頼で名前を呼ばれたことを知らせる。
 *
 * @param {object} pr pulls 行
 * @param {object} review reviews 行
 * @param {string} to
 */
function notifyPrMention(pr, review, to) {
  noticeAdd(to, 'mention',
    review.reviewer + ' があなたを呼びました',
    review.body, 'pull:' + pr.number);

  notify(
    to,
    '[agentic-management] PR #' + pr.number + ' であなたが呼ばれました',
    pr.title + '\n\n' + review.reviewer + ':\n' + review.body
  );
}
