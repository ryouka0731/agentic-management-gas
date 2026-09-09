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
    startDate: '',
    parent: '',
    estimate: '',
    plannedHours: '',
    actualHours: '',
    createdAt: new Date(),
    closedAt: '',
    archivedAt: '',
    updatedAt: new Date(),
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
    if (rows[i].archivedAt) continue;
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
  var keys = ['title', 'body', 'assignee', 'labels', 'linkedFileIds', 'dueDate', 'startDate',
    'parent', 'estimate', 'plannedHours', 'actualHours'];
  allowed.updatedAt = new Date();
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
    updatedAt: new Date(),
    linkedPr: prNumber === null || prNumber === undefined ? '' : prNumber,
  });
  return issueGet(number);
}

/**
 * やることを捨てて、置き場に移す。
 *
 * すぐには消さない。取り違えても ARCHIVE_KEEP_DAYS 日のうちなら戻せる。
 *
 * 子を持つものを捨てると子が宙に浮くため、子は捨てたものの親につなぎ直す。
 * 親がいなければ子は根になる。
 *
 * @param {number} number
 * @returns {object} 捨てた後の行
 */
function issueArchive(number) {
  var row = issueGet(number);
  if (row.archivedAt) return row;

  var all = dbReadAll('issues');
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].parent) !== String(number)) continue;
    dbUpdate('issues', 'number', all[i].number, { parent: row.parent || '' });
  }

  dbUpdate('issues', 'number', number, { archivedAt: new Date(), updatedAt: new Date() });
  return issueGet(number);
}

/**
 * 捨てたやることを元に戻す。
 *
 * 元の親が既に片付いていることがあるため、たどれない親は外して根に戻す。
 *
 * @param {number} number
 * @returns {object} 戻した後の行
 */
function issueRestore(number) {
  var row = issueGet(number);
  if (!row.archivedAt) return row;

  var patch = { archivedAt: '', updatedAt: new Date() };
  if (row.parent) {
    var parent = dbFindOne('issues', 'number', row.parent);
    if (!parent || parent.archivedAt) patch.parent = '';
  }

  dbUpdate('issues', 'number', number, patch);
  return issueGet(number);
}

/**
 * やることを完全に消す。置き場からも消える。
 *
 * @param {number} number
 */
function issuePurge(number) {
  issueGet(number);
  dbDelete('issues', 'number', number);
  dbDelete('project_items', 'issueNumber', number);
}

/**
 * 置き場のやること一覧を返す。新しく捨てた順。
 *
 * @returns {object[]}
 */
function issueListArchived() {
  var rows = dbReadAll('issues');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].archivedAt) out.push(rows[i]);
  }
  out.sort(function (a, b) {
    return new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime();
  });
  return out;
}

/**
 * 期限を過ぎた分を片付ける。
 *
 * @param {Date} [now]
 * @returns {number[]} 片付けた番号
 */
function issueHousekeep(now) {
  var when = now || new Date();
  var gone = archiveExpired(issueListArchived(), when);

  for (var i = 0; i < gone.length; i++) issuePurge(gone[i]);
  return gone;
}
