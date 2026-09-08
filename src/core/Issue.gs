/**
 * 次のIssue番号を返す。
 *
 * @returns {number}
 */
function issueNextNumber_() {
  var rows = dbReadAll('issues');
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].number);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * Issueを作成する。
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} linkedFileIds 紐づく文書のfileId
 * @returns {object} 作成された issues 行
 */
function issueCreate(title, body, linkedFileIds) {
  if (!/^[\s\S]{1,200}$/.test(String(title || ''))) {
    throw new Error('タイトルを入力してください');
  }

  var ids = linkedFileIds || [];
  for (var i = 0; i < ids.length; i++) {
    if (!dbFindOne('files', 'fileId', ids[i])) {
      throw new Error('管理対象にない文書です: ' + ids[i]);
    }
  }

  var row = {
    number: issueNextNumber_(),
    title: title,
    body: body || '',
    state: 'open',
    assignee: '',
    labels: '',
    linkedFileIds: ids.join(','),
    linkedPr: '',
    dueDate: '',
    createdAt: new Date(),
    closedAt: '',
  };
  dbAppend('issues', row);
  return row;
}

/**
 * Issueを1件返す。無ければエラー。
 *
 * @param {number} number
 * @returns {object}
 */
function issueGet(number) {
  var row = dbFindOne('issues', 'number', number);
  if (!row) throw new Error('Issueが見つかりません: #' + number);
  return row;
}

/**
 * Issue一覧を返す。新しい順。
 *
 * @param {string} [state] 'open' | 'closed'。省略時は全件
 * @returns {object[]}
 */
function issueList(state) {
  var rows = dbReadAll('issues');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (state && String(rows[i].state) !== String(state)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(b.number) - Number(a.number); });
  return out;
}

/**
 * 文書に紐づく open Issue を返す。
 *
 * Wikiで文書を開いたときに横に並べるためのもの。
 * これが「文書中心の作業管理」の実感を生む (spec §6.1)。
 *
 * @param {string} fileId
 * @returns {object[]}
 */
function issuesForFile(fileId) {
  var rows = issueList('open');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var ids = String(rows[i].linkedFileIds || '').split(',');
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] !== fileId) continue;
      out.push(rows[i]);
      break;
    }
  }
  return out;
}

/**
 * Issueのタイトル・本文・担当・ラベル・紐づく文書を更新する。
 *
 * state は履歴の意味を持つため、ここでは変更させない。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object} 更新後の行
 */
function issueUpdate(number, patch) {
  issueGet(number);
  if (Object.prototype.hasOwnProperty.call(patch, 'state')) {
    throw new Error('stateはissueCloseで変更してください');
  }

  var allowed = {};
  var keys = ['title', 'body', 'assignee', 'labels', 'linkedFileIds', 'dueDate'];
  for (var i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(patch, keys[i])) {
      allowed[keys[i]] = patch[keys[i]];
    }
  }

  dbUpdate('issues', 'number', number, allowed);
  return issueGet(number);
}

/**
 * Issueをクローズする。既にクローズ済みなら何もしない。
 *
 * @param {number} number
 * @param {number|null} prNumber 紐づくPR番号
 * @returns {object} 更新後の行
 */
function issueClose(number, prNumber) {
  var row = issueGet(number);
  if (String(row.state) === 'closed') return row;

  dbUpdate('issues', 'number', number, {
    state: 'closed',
    closedAt: new Date(),
    linkedPr: prNumber === null || prNumber === undefined ? '' : prNumber,
  });
  return issueGet(number);
}
