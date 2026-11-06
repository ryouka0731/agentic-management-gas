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
 * **受け取る人が止めた種類は送らない。** kind は NOTIFY_KINDS() のどれか。宛先の人ごとに
 * 自分の設定 notify.<kind> を見て、止めた人を外す (notifyRecipients_)。kind を渡さない
 * 呼び方は今までどおり送る。画面の中の知らせ (noticeAdd) は止めない。
 *
 * @param {string} to 宛先メールアドレス (カンマで並べてもよい)
 * @param {string} subject
 * @param {string} body
 * @param {string} [kind] 通知の種類
 */
function notify(to, subject, body, kind) {
  if (!to) return;
  try {
    // 止めた人を外せなかった (設定が読めない) ときは、落とさずに元の宛先へ送る
    var send;
    try {
      send = notifyRecipients_(to, kind);
    } catch (e) {
      Logger.log('通知の設定を読めませんでした: ' + e.message);
      send = to;
    }
    if (!send) return;
    GmailApp.sendEmail(send, subject, body);
  } catch (e) {
    Logger.log('通知を送れませんでした: ' + e.message);
  }
}

/**
 * 便りの件名を組む。
 *
 * 名前は10か所に散らさない。散らすと、名前が変わるたびに全部を直す
 * ことになり、直し漏れた1通だけが古い名前で届く。
 *
 * 「何の、どれが、どうなったか」の順に書く。受け取る側は件名だけで
 * 一覧を捌くため、種類と番号が先に来ないと開くまで分からない。
 *
 * @param {string} what 何の ('確認依頼' | '報告' | 'やること')
 * @param {number} number どれが
 * @param {string} happened どうなったか
 * @returns {string}
 */
function notifySubject_(what, number, happened) {
  return '[' + APP_NAME() + '] ' + what + ' #' + number + ' ' + happened;
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
    to: String(to),
    kind: String(kind || ''),
    title: String(title || '').substring(0, 200),
    body: String(body || '').substring(0, 500),
    link: String(link || ''),
    at: new Date(),
    readAt: '',
  };
  /*
   * **知らせを残せなくても、本処理は巻き戻さない。**
   *
   * 番号を振るようになった結果、混み合うと投げるようになった。やりとりは
   * 先に保存され、そのあとで知らせを置くため、ここで投げると「書き込みは
   * 済んでいるのに失敗と出る」。人はもう一度書き込み、同じやりとりが2つ
   * 並ぶ。宛先が何人かいれば、途中までは届いて残りは届かない。
   *
   * すぐ上の `notify` も同じ理由で例外を握っている。
   */
  try {
    dbAppendNumbered('notifications', 'id', row);
  } catch (e) {
    Logger.log('知らせを残せませんでした: ' + e.message);
    return null;
  }
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
  var me = currentEmail_();
  var want = ids || [];

  /*
   * **1回読んで、読んだ印の列だけ書き戻す。** 1件ごとに dbUpdate すると、
   * そのたびに表を丸ごと読み書きする。「全部読んだ」は未読がたまったときに
   * 押すものなので、件数がそのまま待ち時間になる。
   */
  return dbWithLock_(30000, function () {
    var cols = DB_SCHEMA().notifications;
    var sheet = dbSheet_('notifications');
    var last = sheet.getLastRow();
    if (last < 2) return 0;

    var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
    var toCol = cols.indexOf('to');
    var idCol = cols.indexOf('id');
    var readCol = cols.indexOf('readAt');
    var now = new Date();
    var marks = [];
    var done = 0;

    for (var r = 0; r < values.length; r++) {
      var mark = values[r][readCol];
      if (String(values[r][toCol]) === me && !mark &&
          (!want.length || want.indexOf(Number(values[r][idCol])) >= 0)) {
        mark = now;
        done++;
      }
      marks.push([mark]);
    }

    if (done) {
      sheet.getRange(2, readCol + 1, marks.length, 1).setValues(marks);
      // 台帳に直に書いたので、読み取りの覚えを捨てる (Db.gs の dbInvalidate_)
      dbInvalidate_('notifications');
    }
    return done;
  });
}

/*
 * ===== 言い方の決まり (docs/dev/notifications.md) =====
 *
 * - 「何が起きたか」ではなく「あなたに何が来たか」で書く。責める言葉 (期限切れ・滞っている・未対応) を見出しにしない
 * - **メールの本文の最後は必ず「次にすること: …」の1行** (notifyBody_ が付ける)。無いときは「次にすること: ありません」
 * - 件名の形 `[SoftBanto] 何の #番号 どうなったか` は notifySubject_ だけで組み、「どうなったか」だけを言い換える
 * - 画面の知らせ (noticeAdd) は開く先があるので、本文に次にすることを書かない
 * - 推しの一言はメールに入れない (本人の画面にだけ出す)
 */

/**
 * メールの本文を組む。中身のあとに、必ず「次にすること: …」の1行で終える。
 *
 * 次にすることをメールごとに書くと、書き忘れた1通だけが「で、どうすれば？」になる。
 * 末尾の1行はここでだけ付ける (test/notifier-wording.test.js が全部の知らせで見ている)。
 *
 * @param {string} text 中身 (空でもよい)
 * @param {string} [next] 次にすること。省けば「ありません」
 * @returns {string}
 */
function notifyBody_(text, next) {
  var head = String(text || '').replace(/\s+$/, '');
  var tail = '次にすること: ' + (next || 'ありません');
  return head ? head + '\n\n' + tail : tail;
}

/**
 * 変わった箇所の箇条書きを、知らせの本文の先頭に置く形にする (やること #109)。
 *
 * 上長は差分の行を読まない。メールを開いた時点で何が変わったのかが分かるようにする。
 * 箇条書きは PullRequest.gs の prChangeSummary_ が作る (ここでは差分を読まない。
 * 知らせだけを読むテストに差分の道具を足させないため)。
 *
 * @param {string[]} [lines]
 * @returns {string} 無ければ空
 */
function notifySummaryText_(lines) {
  var list = lines || [];
  if (!list.length) return '';
  var out = ['変わった箇所'];
  for (var i = 0; i < list.length; i++) out.push('・' + list[i]);
  return out.join('\n') + '\n\n';
}

/**
 * 確認依頼を出したことを、出した本人に知らせる。
 *
 * @param {object} pr pulls 行
 * @param {string[]} [summary] 変わった箇所の箇条書き
 */
function notifyPrCreated(pr, summary) {
  notify(
    pr.author,
    notifySubject_('確認依頼', pr.number, 'を出しました'),
    notifyBody_(notifySummaryText_(summary) + pr.title,
      '確認する人の返事を待ってください。返事が来たら、またお知らせします'),
    'review'
  );
}

/**
 * 確認依頼が反映されたことを、出した本人に知らせる。
 *
 * @param {object} pr pulls 行
 */
function notifyPrMerged(pr) {
  notify(
    pr.author,
    notifySubject_('確認依頼', pr.number, 'が正式版に入りました'),
    notifyBody_(pr.title + '\n\n正式版の文書が書き換わりました。'),
    'result'
  );
}

/**
 * 確認依頼が取り下げられたことを知らせる。
 *
 * 知らせるのは頼まれた側である。出した本人は自分で取り下げたので要らない。
 * 見ようとしていたものが黙って消えると、次に開いたときに何が起きたのか
 * 分からない。
 *
 * @param {object} pr
 */
function notifyPrClosed(pr, reason) {
  var why = reason ? '\n\n' + reason : '';
  var list = String(pr.reviewers || '').split(',');

  for (var i = 0; i < list.length; i++) {
    var to = list[i].replace(/^\s+|\s+$/g, '');
    if (!to) continue;

    noticeAdd(to, 'review',
      '確認依頼 #' + pr.number + ' は要らなくなりました (改訂版は残っています)', pr.title + why,
      'pull:' + pr.number);

    notify(
      to,
      notifySubject_('確認依頼', pr.number, 'は要らなくなりました'),
      notifyBody_(pr.title + '\n\n確認は要らなくなりました。改訂版そのものは残っています。' + why),
      'result'
    );
  }
}

/**
 * 確認を頼んだことを本人に知らせる。
 *
 * @param {object} pr pulls 行
 * @param {string} to
 * @param {string[]} [summary] 変わった箇所の箇条書き (本文の先頭に置く。件名は変えない)
 */
function notifyPrReviewRequested(pr, to, summary) {
  noticeAdd(to, 'review',
    '確認依頼 #' + pr.number + ' があなたを待っています', pr.title, 'pull:' + pr.number);

  notify(
    to,
    notifySubject_('確認依頼', pr.number, 'があなたを待っています'),
    notifyBody_(notifySummaryText_(summary) + pr.title,
      '「確認依頼」で中身を見て、「承認」か「直してほしい」を返してください'),
    'review'
  );
}

/**
 * 報告が届いたことを、このアプリを持っている人に知らせる。
 *
 * 貯めるだけでは誰も気づかない。開いている本人ではなく、入れ物の
 * 持ち主に送る。共有ドライブでは管理者全員に送る。書いた本人が持ち主なら送らない。
 *
 * @param {object} row inquiries 行
 */
function notifyInquiry(row) {
  var owners = inquiryOwners_();
  for (var i = 0; i < owners.length; i++) {
    // 大文字小文字は見ない。違うだけで、書いた本人にも知らせが届く
    if (String(owners[i]).toLowerCase() === String(row.by).toLowerCase()) continue;
    notify(
      owners[i],
      notifySubject_('報告', row.number, 'が届きました'),
      notifyBody_(INQUIRY_KINDS()[row.kind] + ' / ' + row.by + '\n\n' +
        row.body + (row.context ? '\n\n' + row.context : ''),
        '「報告」#' + row.number + ' を開いて、返事を書いてください'),
      'inquiry'
    );
  }
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
      notifySubject_('報告', inquiry.number, 'に返事が来ました'),
      notifyBody_((inquiry.title || inquiry.body) + '\n\n' + reply.by + ':\n' + reply.body,
        '「報告」#' + inquiry.number + ' を開いて、続きを書いてください'),
      'inquiry'
    );
    noticeAdd(talkers[i], 'reply',
      '報告 #' + inquiry.number + ' に ' + reply.by + ' から返事が来ました',
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
      notifySubject_('報告', inquiry.number, 'であなたが呼ばれました'),
      notifyBody_((inquiry.title || inquiry.body) + '\n\n' + post.by + ':\n' + post.body,
        '「報告」#' + inquiry.number + ' を開いて、返事を書いてください'),
      'mention'
    );
    noticeAdd(people[i], 'mention',
      '報告 #' + inquiry.number + ' で ' + post.by + ' があなたを呼んでいます',
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
    '確認依頼 #' + pr.number + ' で ' + review.reviewer + ' があなたを呼んでいます',
    review.body, 'pull:' + pr.number);

  notify(
    to,
    notifySubject_('確認依頼', pr.number, 'であなたが呼ばれました'),
    notifyBody_(pr.title + '\n\n' + review.reviewer + ':\n' + review.body,
      '「確認依頼」#' + pr.number + ' を開いて、返事を書いてください'),
    'mention'
  );
}

/**
 * やることに書き込みがあったことを知らせる。
 *
 * @param {object} issue issues 行
 * @param {object} row issue_comments 行
 * @param {string[]} people
 */
function notifyIssueComment(issue, row, people) {
  for (var i = 0; i < (people || []).length; i++) {
    noticeAdd(people[i], 'reply',
      'やること #' + issue.number + ' に ' + row.by + ' から返事が来ました',
      row.body, 'issue:' + issue.number);

    notify(
      people[i],
      notifySubject_('やること', issue.number, 'に返事が来ました'),
      notifyBody_(issue.title + '\n\n' + row.by + ':\n' + row.body,
        '「やること」#' + issue.number + ' を開いて、続きを書いてください'),
      'comment'
    );
  }
}

/**
 * やることで名前を呼ばれたことを知らせる。
 *
 * @param {object} issue issues 行
 * @param {object} row issue_comments 行
 * @param {string[]} people
 */
function notifyIssueCommentMention(issue, row, people) {
  for (var i = 0; i < (people || []).length; i++) {
    noticeAdd(people[i], 'mention',
      'やること #' + issue.number + ' で ' + row.by + ' があなたを呼んでいます',
      row.body, 'issue:' + issue.number);

    notify(
      people[i],
      notifySubject_('やること', issue.number, 'であなたが呼ばれました'),
      notifyBody_(issue.title + '\n\n' + row.by + ':\n' + row.body,
        '「やること」#' + issue.number + ' を開いて、返事を書いてください'),
      'mention'
    );
  }
}

/**
 * 目標の承認を頼まれたことを、承認する人に知らせる。
 *
 * 承認のあとに本人が直したときも、もう一度頼まれたものとして知らせる (直した中身を
 * 承認し直してもらうため)。
 *
 * @param {object} goal goals 行
 * @param {string[]} to 承認する人
 * @param {string} name 本人の名前
 * @param {boolean} changed 承認のあとに直したか
 */
function notifyGoalSubmitted_(goal, to, name, changed) {
  var what = changed ? 'の直したところの承認があなたを待っています' : 'の承認があなたを待っています';
  for (var i = 0; i < (to || []).length; i++) {
    noticeAdd(to[i], 'goal', name + ' さんの目標 #' + goal.id + ' ' + what, goal.title, 'goal:' + goal.id);
    notify(
      to[i],
      notifySubject_('目標', goal.id, what),
      notifyBody_(name + ' さんの目標: ' + goal.title,
        '「目標」の「承認を待つもの」で中身を見て、「承認する」か「差し戻す」を押してください'),
      'goal'
    );
  }
}

/**
 * 目標が承認された・差し戻されたことを本人に知らせる。
 *
 * 差し戻しは責める言い方にしない。「直してほしいところが返ってきた」と書き、次の一歩を添える。
 *
 * @param {object} goal goals 行
 * @param {string} decision 'approve' | 'return'
 */
function notifyGoalDecided_(goal, decision) {
  var ok = decision === 'approve';
  var happened = ok ? 'が承認されました' : 'に直してほしいところが返ってきました';
  var note = goal.managerNote ? '\n\n上長のひとこと:\n' + goal.managerNote : '';
  var next = ok ? '' : '「目標」で上長のひとことを見て、直してから承認を頼み直してください';
  noticeAdd(goal.who, 'goal', 'あなたの目標 #' + goal.id + ' ' + happened, goal.title + note, 'goal:' + goal.id);
  notify(goal.who, notifySubject_('目標', goal.id, happened), notifyBody_(goal.title + note, next), 'goal');
}

/**
 * 期末の評価が付いたことを本人に知らせる。
 *
 * @param {object} goal goals 行
 */
function notifyGoalGraded_(goal) {
  var body = goal.title + '\n\n評価: ' + goal.finalGrade + '\n上長のひとこと:\n' + goal.managerNote;
  noticeAdd(goal.who, 'goal', 'あなたの目標 #' + goal.id + ' に評価が付きました', body, 'goal:' + goal.id);
  notify(goal.who, notifySubject_('目標', goal.id, 'に評価が付きました'), notifyBody_(body), 'goal');
}

/**
 * 目標の承認を頼んだのを本人が取り下げたことを、承認する人に知らせる (見ようとしていたものが黙って消えないように)。
 *
 * @param {object} goal goals 行
 * @param {string[]} to 承認する人
 * @param {string} name 本人の名前
 */
function notifyGoalWithdrawn_(goal, to, name) {
  for (var i = 0; i < (to || []).length; i++) {
    noticeAdd(to[i], 'goal', name + ' さんの目標 #' + goal.id + ' の承認は要らなくなりました', goal.title, 'goal:' + goal.id);
    notify(to[i], notifySubject_('目標', goal.id, 'の承認は要らなくなりました'),
      notifyBody_(name + ' さんの目標: ' + goal.title +
        '\n\n本人が承認の頼みを取り下げました。直して頼み直すと、また届きます。'), 'goal');
  }
}
