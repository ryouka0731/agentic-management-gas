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
 * @param {string[]} linkedFileIds 紐づく文書のfileId。文書に紐づかない
 *   やることもあるため、空でよい
 * @param {string} [labels] タグ (カンマ区切り)
 * @returns {object} 作成された issues 行
 */
function issueCreate(title, body, linkedFileIds, labels) {
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
    labels: tagsOf(labels).join(','),
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
  tagAdopt(row.labels);
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

  // その場で書いたタグが次から選べないと、同じものを何度も書くことになる
  if (Object.prototype.hasOwnProperty.call(patch, 'labels')) {
    tagAdopt(patch.labels);
  }

  // 担当者は複数入る。前後の空白と重なりを落としてから入れる
  if (Object.prototype.hasOwnProperty.call(patch, 'assignee')) {
    patch.assignee = issueAssigneeClean(patch.assignee);
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
 * 完了を取り消して、やることに戻す。
 *
 * 早合点で完了にしてしまうことがある。取り消せないと、同じ内容の
 * やることをもう1つ作ることになり、履歴が二重になる。
 *
 * カードは「作業中」に戻す。一度は手を付けたものなので、
 * これからの箱に戻すと経緯が消える。
 *
 * @param {number} number
 * @returns {object} 戻した後の行
 */
function issueReopen(number) {
  var row = issueGet(number);
  if (row.archivedAt) throw new Error('先に置き場から元に戻してください: #' + number);
  if (String(row.state) === 'open') return row;

  dbUpdate('issues', 'number', number, {
    state: 'open',
    closedAt: '',
    updatedAt: new Date(),
  });

  if (dbFindOne('project_items', 'issueNumber', number)) {
    projectMove(number, 'In Progress', 0);
  }
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

/**
 * 担当者を配列にする。
 *
 * ひとつの仕事を2人で持つことがある。列は増やさず、カンマ区切りで
 * 並べる (タグと同じ形)。
 *
 * @param {object|string} row issues 行、または assignee の文字列
 * @returns {string[]}
 */
function issueAssignees(row) {
  var raw = (row && typeof row === 'object') ? row.assignee : row;
  var parts = String(raw || '').split(',');
  var seen = {};
  var out = [];

  for (var i = 0; i < parts.length; i++) {
    var one = parts[i].replace(/^\s+|\s+$/g, '');
    if (!one || seen[one]) continue;

    seen[one] = true;
    out.push(one);
  }
  return out;
}

/**
 * 担当者の書き方を整える。
 *
 * 前後の空白と重なりを落とす。形になっていないものは断る。
 *
 * @param {string|string[]} value
 * @returns {string} カンマ区切り
 */
function issueAssigneeClean(value) {
  var list = Array.isArray(value) ? value : issueAssignees(value);
  var out = [];

  for (var i = 0; i < list.length; i++) {
    var one = String(list[i]).replace(/^\s+|\s+$/g, '');
    if (!one) continue;

    if (!/^[^\s,@]+@[^\s,@]+$/.test(one)) {
      throw new Error('担当者はメールアドレスで入れてください: ' + one);
    }
    if (out.indexOf(one) < 0) out.push(one);
  }
  return out.join(',');
}
