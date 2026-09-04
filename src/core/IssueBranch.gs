/**
 * Issueからブランチ名を作る。
 *
 * branchNameValid_ が許す文字だけを残し、80文字に収める。
 * 題名が全部落ちた場合は番号だけの名前にする。
 *
 * @param {number} number
 * @param {string} title
 * @returns {string}
 */
function issueBranchName(number, title) {
  var prefix = 'issue-' + Number(number);
  var slug = String(title || '').replace(/[^A-Za-z0-9ぁ-んァ-ヶ一-龠々ー_\-]/g, '');
  if (!slug) return prefix;

  var room = 80 - prefix.length - 1;
  if (slug.length > room) slug = slug.substring(0, room);
  return prefix + '-' + slug;
}

/**
 * Issueに対応するブランチを作る。
 *
 * @param {number} number Issue番号
 * @param {string} fileId main上の対象ファイル
 * @returns {object} 作成された branches 行
 */
function issueCreateBranch(number, fileId) {
  var issue = issueGet(number);
  if (String(issue.state) === 'closed') {
    throw new Error('クローズ済みのIssueからはブランチを作れません: #' + number);
  }
  return branchCreate(issueBranchName(number, issue.title), fileId);
}
