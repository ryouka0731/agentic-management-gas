/**
 * 文書の見直しの期日 (やること #112)。就業規則・個人情報の規程・委託契約のように定期に見直す文書に「次の見直し」の
 * 期日と担当を持たせ、期日の N 日前 (既定 30日) に「◯◯ の見直し」のやることを1つだけ作る (1日1回の回。recurrenceDailyOnce_ が呼ぶ)。
 *
 * - 期日・担当・何日前は台帳の `files` の末尾の列 (reviewDue / reviewAssignee / reviewNoticeDays)
 * - **二度作らない印は `reviewIssuedFor` (作った期日)。** 鍵の中で見てから作り、作った直後に書く。期日を変えれば印と
 *   食い違うので、新しい期日のぶんを1つ作る。期日が過ぎても、作ったあとは印で止まる
 * - 付けられるのは正式版の文書だけ。付けるのは誰でもできる (文書の登録・外すと同じ扱い。docs/dev/user-paths.md)
 */

/** 何日前の上限 */
function REVIEW_NOTICE_MAX() {
  return 365;
}

/**
 * files の行の見直しの欄を、画面に渡せる形にする。
 *
 * @param {object} row files 行
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{reviewDue: string, reviewAssignee: string, reviewNoticeDays: number, reviewIssuedFor: string,
 *   reviewDaysLeft: (number|string)}}
 */
function fileReviewPlain_(row, today) {
  var due = plainDay(row.reviewDue);
  var n = plainNumber(row.reviewNoticeDays);
  return {
    reviewDue: due,
    reviewAssignee: due ? plainText(row.reviewAssignee) : '',
    reviewNoticeDays: n === '' ? REVIEW_NOTICE_DEFAULT() : n,
    reviewIssuedFor: plainDay(row.reviewIssuedFor),
    // 期日まであと何日か (過ぎていれば負)。期日が無ければ ''
    reviewDaysLeft: due ? recurrenceDaysBetween(today, due) : '',
  };
}

/**
 * 見直しの期日・担当・何日前を決める。期日を空にすると外す。
 *
 * @param {string} fileId 正式版の文書
 * @param {string} due 'YYYY-MM-DD' か ''
 * @param {string} assignee 担当 (カンマ区切りのアドレス。空でよい)
 * @param {*} noticeDays 何日前に作るか (空は既定の30)
 * @returns {object} files 行の見直しの欄 (fileReviewPlain_)
 */
function fileReviewSet_(fileId, due, assignee, noticeDays) {
  var day = String(due == null ? '' : due).replace(/^\s+|\s+$/g, '');
  if (day && !recurrenceDayValid(day)) throw new Error('見直しの期日は日付で入れてください');
  var who = issueAssigneeClean(assignee || '');
  var n = REVIEW_NOTICE_DEFAULT();
  if (noticeDays !== '' && noticeDays !== null && noticeDays !== undefined) {
    n = Number(noticeDays);
    if (Math.floor(n) !== n || n < 0 || n > REVIEW_NOTICE_MAX()) {
      throw new Error('何日前に作るかは 0〜' + REVIEW_NOTICE_MAX() + ' の日数で入れてください');
    }
  }

  var after;
  dbWithLock_(30000, function () {
    var row = dbFindOne('files', 'fileId', fileId);
    if (!row) throw new Error('管理対象に登録されていません');
    if (branchOfPath_(row.path) !== 'main') throw new Error('見直しの期日は正式版の文書に付けてください');
    dbUpdate('files', 'fileId', fileId, {
      reviewDue: day,
      reviewAssignee: day ? who : '',
      reviewNoticeDays: n,
    });
    after = dbFindOne('files', 'fileId', fileId);
  });
  return fileReviewPlain_(after, recurrenceTodayOf(Date.now()));
}

/**
 * 1つの文書の見直しのやることを作る。**印を見てから作って印を書くまでを1つの鍵の中で行う。**
 *
 * @param {string} fileId
 * @param {string} today
 * @returns {number|null|boolean} 作ったやることの番号。作らなければ null。鍵が取れなければ false
 */
function fileReviewIssueOne_(fileId, today) {
  return dbWithLock_(10000, function () {
    var row = dbFindOne('files', 'fileId', fileId);
    if (!row || branchOfPath_(row.path) !== 'main') return null;
    var due = plainDay(row.reviewDue);
    if (!reviewIssueDue(due, row.reviewNoticeDays, plainDay(row.reviewIssuedFor), today)) return null;

    var name = branchSplitPath_(row.path).path;
    var label = recurrenceDayLabel(due);
    var issue = issueCreate(
      name + ' の見直し (期日 ' + label + ')',
      '「' + name + '」の見直しの期日 (' + label + ') が近づいています。中身を確かめ、直すところがあれば改訂版を作ってください。\n' +
        '次の見直しの期日は、文書の画面の「見直しの期日」で決め直せます。',
      [fileId], '',
      { assignee: plainText(row.reviewAssignee), dueDate: due, auto: true });
    // 印は作った直後に書く。ボードに置くところで落ちても、次の回に同じものをもう一度作らない
    dbUpdate('files', 'fileId', fileId, { reviewIssuedFor: due });
    try {
      if (typeof projectPlace === 'function') projectPlace(issue.number, 'Backlog');
    } catch (e) {
      Logger.log('見直しのやること #' + issue.number + ' をボードに置けませんでした: ' + e.message);
    }
    return issue.number;
  }, function () { return false; });
}

/**
 * 今日作る見直しのやることを全部作る。読んで選ぶのは鍵の外、作るところは1つずつ短い鍵の中。
 *
 * @param {Date} [now]
 * @returns {{created: number[], busy: number}}
 */
function fileReviewIssueDue_(now) {
  var today = recurrenceTodayOf((now || new Date()).getTime());
  var out = { created: [], busy: 0 };
  dbReadAll('files').forEach(function (r) {
    if (branchOfPath_(r.path) !== 'main') return;
    if (!reviewIssueDue(plainDay(r.reviewDue), r.reviewNoticeDays, plainDay(r.reviewIssuedFor), today)) return;
    try {
      var n = fileReviewIssueOne_(r.fileId, today);
      if (n === false) out.busy++;
      else if (n) out.created.push(n);
    } catch (e) {
      Logger.log('文書 ' + r.fileId + ' の見直しのやることを作れませんでした: ' + e.message);
    }
  });
  return out;
}
