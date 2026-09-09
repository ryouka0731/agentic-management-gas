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
  notify(
    to,
    '[agentic-management] PR #' + pr.number + ' の確認を頼まれました',
    pr.title + '\n\n確認依頼のタブから中身を見て、承認するか直してほしいかを返してください。'
  );
}
