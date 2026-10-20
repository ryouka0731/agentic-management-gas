/*
 * 画面の API: やること・やりとり・下書き・タグ・置き場・ボード。
 */

/**
 * issues の行を、画面に渡せる素の形にする。
 *
 * google.script.run は限られた型しか運べない。DBの行をそのまま返すと
 * 日時が Date のまま混ざり、変換に失敗して画面には null が届く。
 * 動いている apiPrList / apiBranchList と同じく、明示的に文字列へ直す。
 *
 * @param {object} row issues 行
 * @param {number[]} [steps] 「動きなし」の段階。一覧では staleSteps_() を1回だけ読んで渡す
 * @returns {object}
 */
function issueToPlain_(row, steps) {
  var stale = stalenessOf(row, new Date(), steps || staleSteps_());
  return {
    number: plainId(row.number),
    title: plainText(row.title),
    body: plainText(row.body),
    state: plainText(row.state),
    // 空の行も「ふつう」として届く。画面側で空を場合分けしない
    priority: issuePriority(row),
    assignee: plainText(row.assignee),
    assignees: issueAssignees(row),
    labels: plainText(row.labels),
    linkedFileIds: plainText(row.linkedFileIds),
    linkedPr: plainNumber(row.linkedPr),
    createdAt: plainDate(row.createdAt),
    closedAt: plainDate(row.closedAt),
    // 時刻を持たない値。plainDate で ISO にすると、東京の0時が前日になる
    dueDate: plainDay(row.dueDate),
    startDate: plainDay(row.startDate),
    parent: plainNumber(row.parent),
    estimate: plainNumber(row.estimate),
    plannedHours: plainNumber(row.plannedHours),
    actualHours: plainNumber(row.actualHours),
    archivedAt: plainDate(row.archivedAt),
    daysLeft: row.archivedAt ? archiveDaysLeft(row.archivedAt, new Date()) : '',
    updatedAt: plainDate(row.updatedAt),
    staleDays: stale.days,
    staleLevel: stale.level,
    // エージェンティックスクラム (既定はオフ)。オフのときは空のまま届く
    sprint: plainText(row.sprint),
    points: plainNumber(row.points),
    acceptance: plainText(row.acceptance),
  };
}

/**
 * Issue一覧を返す (Web App API)。
 *
 * @param {string} state 'open' | 'closed' | '' (空なら全件)
 * @returns {object[]}
 */
function apiIssueList(state) {
  var rows = issueList(state || null);
  var out = [];
  var steps = staleSteps_();
  for (var i = 0; i < rows.length; i++) out.push(issueToPlain_(rows[i], steps));
  return out;
}

/**
 * Issueを作成し、Backlog に置く (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} linkedFileIds
 * @returns {object}
 */
function apiIssueCreate(title, body, linkedFileIds, labels, patch) {
  // 作ってすぐ直せばよい、では二度手間になる。作るときに入れられる
  // ものは、そのまま入れて1件にする
  var want = {};
  var any = false;

  if (patch && typeof patch === 'object') {
    var keys = ['assignee', 'startDate', 'dueDate', 'estimate',
      'plannedHours', 'actualHours', 'parent', 'priority',
      // エージェンティックスクラム (オンのときだけ通る)
      'sprint', 'points', 'acceptance'];

    for (var k = 0; k < keys.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(patch, keys[k])) continue;
      if (patch[keys[k]] === '' || patch[keys[k]] === null) continue;

      want[keys[k]] = patch[keys[k]];
      any = true;
    }
  }

  // **作る前に確かめる。** 作ってから断ると、作られているのに失敗と出て、
  // 人がもう一度作り、同じものが2つ並ぶ
  if (any) issuePatchCheck(want);

  var issue = issueCreate(title, body, linkedFileIds || [], labels || '');
  projectPlace(issue.number, 'Backlog');

  if (any) issue = issueUpdate(issue.number, want);
  return issueToPlain_(issue);
}

/**
 * Issueを更新する (Web App API)。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object}
 */
function apiIssueUpdate(number, patch) {
  return issueToPlain_(issueUpdate(number, patch || {}));
}

/**
 * 優先度の選択肢を返す (Web App API)。
 *
 * 語彙を画面側に写さない。写すと、足したときにサーバと画面でずれ、
 * 選べるのに保存できない選択肢が出る。
 *
 * @returns {Array<Array<string>>} [値, 見せる字]
 */
function apiIssuePriorities() {
  return ISSUE_PRIORITIES();
}

/**
 * やることを完了にする (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueClose(number) {
  var row = issueClose(number, null);
  projectMoveIfExists_(number, 'Done');
  return issueToPlain_(row);
}

/**
 * issue_comments の行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {string} me
 * @returns {object}
 */
function issueCommentToPlain_(row, me) {
  return plainTalk(row, me, 'issueNumber');
}

/**
 * やることのやりとりを返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiIssueComments(number) {
  var me = Session.getActiveUser().getEmail();
  var rows = issueComments(number);
  var out = [];

  for (var i = 0; i < rows.length; i++) out.push(issueCommentToPlain_(rows[i], me));
  return out;
}

/**
 * やることに書き込む (Web App API)。
 *
 * @param {number} number
 * @param {string} body
 * @returns {object}
 */
function apiIssueComment(number, body) {
  var me = Session.getActiveUser().getEmail();
  return issueCommentToPlain_(issueCommentAdd(number, body), me);
}

/**
 * 書き込みを直す (Web App API)。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function apiIssueCommentEdit(id, body) {
  var me = Session.getActiveUser().getEmail();
  return issueCommentToPlain_(issueCommentEdit(id, body), me);
}

/**
 * 書き込みを消す (Web App API)。
 *
 * @param {number} id
 * @returns {string}
 */
function apiIssueCommentDelete(id) {
  issueCommentDelete(id);
  return '書き込みを消しました';
}

/**
 * 下書きの一覧を返す (Web App API)。
 *
 * @returns {Array<{name:string, body:string, builtin:boolean, mine:boolean}>}
 */
function apiTemplateList() {
  var me = Session.getActiveUser().getEmail();
  var rows = templateList();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var builtin = rows[i].builtin === true || String(rows[i].builtin) === 'true';

    out.push({
      name: String(rows[i].name),
      body: String(rows[i].body || ''),
      builtin: builtin,
      mine: !builtin && String(rows[i].createdBy) === String(me),
    });
  }
  return out;
}

/**
 * 下書きを保存する (Web App API)。
 *
 * @param {string} name
 * @param {string} body
 * @returns {object}
 */
function apiTemplateSave(name, body) {
  var row = templateSave(name, body);
  return { name: String(row.name), body: String(row.body) };
}

/**
 * 下書きを消す (Web App API)。
 *
 * @param {string} name
 * @returns {string}
 */
function apiTemplateDelete(name) {
  templateDelete(name);
  return '下書き「' + name + '」を消しました';
}

/**
 * タグの一覧を返す (Web App API)。
 *
 * @returns {Array<{name:string, color:string, builtin:boolean}>}
 */
function apiTagList() {
  var rows = tagList();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    out.push({
      name: String(rows[i].name),
      color: String(rows[i].color || 'ink'),
      builtin: rows[i].builtin === true || String(rows[i].builtin) === 'true',
    });
  }
  return out;
}

/**
 * タグを作る (Web App API)。
 *
 * @param {string} name
 * @param {string} color
 * @returns {object}
 */
function apiTagCreate(name, color) {
  var row = tagCreate(name, color);
  return { name: String(row.name), color: String(row.color), builtin: false };
}

/**
 * タグを消す (Web App API)。
 *
 * @param {string} name
 * @returns {string}
 */
function apiTagDelete(name) {
  tagDelete(name);
  return 'タグ「' + name + '」を消しました';
}

/**
 * 使える色の一覧を返す (Web App API)。
 *
 * @returns {string[]}
 */
function apiTagColors() {
  return TAG_COLORS();
}

/**
 * 完了を取り消す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueReopen(number) {
  return issueToPlain_(issueReopen(number));
}

/**
 * やることを捨てる (Web App API)。
 *
 * すぐには消さず置き場に移す。取り違えても期限までなら戻せる。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueArchive(number) {
  return issueToPlain_(issueArchive(number));
}

/**
 * 捨てたやることを元に戻す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueRestore(number) {
  return issueToPlain_(issueRestore(number));
}

/**
 * 捨てたやることを完全に消す (Web App API)。
 *
 * @param {number} number
 * @returns {string}
 */
function apiIssuePurge(number) {
  var row = issueGet(number);
  if (!row.archivedAt) throw new Error('先に捨ててから消してください: #' + number);

  issuePurge(number);
  return '#' + number + ' を完全に消しました';
}

/**
 * 置き場のやること一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiIssueArchivedList() {
  var rows = issueListArchived();
  var out = [];
  var steps = staleSteps_();

  for (var i = 0; i < rows.length; i++) out.push(issueToPlain_(rows[i], steps));
  return out;
}

/**
 * 置き場を留め置く日数を返す (Web App API)。
 *
 * @returns {number}
 */
function apiArchiveKeepDays() {
  return ARCHIVE_KEEP_DAYS();
}

/**
 * Issueからブランチを作り、カードを In Progress に動かす (Web App API)。
 *
 * @param {number} number
 * @param {string} fileId
 * @returns {{name:string}}
 */
function apiIssueCreateBranch(number, fileId) {
  var branch = issueCreateBranch(number, fileId);
  projectMoveIfExists_(number, 'In Progress');
  return { name: branch.name };
}

/**
 * 文書に紐づく open Issue を返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {object[]}
 */
function apiIssuesForFile(fileId) {
  var rows = issuesForFile(fileId);
  var out = [];
  var steps = staleSteps_();
  for (var i = 0; i < rows.length; i++) out.push(issueToPlain_(rows[i], steps));
  return out;
}

/**
 * カンバンボードを返す (Web App API)。
 *
 * @returns {Object<string, object[]>}
 */
function apiProjectBoard() {
  return projectBoard();
}

/**
 * カードを動かす (Web App API)。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @param {number} order
 * @returns {object}
 */
function apiProjectMove(issueNumber, column, order) {
  return projectMove(issueNumber, column, order);
}
