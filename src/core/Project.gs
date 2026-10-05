/**
 * カンバンの列。順序がそのまま表示順になる。
 *
 * トップレベルのconstではなく関数として公開する。GASはファイルを
 * ファイル名順に読み込むため、トップレベル初期化は順序依存になる。
 *
 * @returns {string[]}
 */
function PROJECT_COLUMNS() {
  return ['Backlog', 'In Progress', 'In Review', 'Done'];
}

/**
 * 列名が定義済みかを確かめる。
 *
 * @param {string} column
 */
function projectAssertColumn_(column) {
  var cols = PROJECT_COLUMNS();
  for (var i = 0; i < cols.length; i++) {
    if (cols[i] === column) return;
  }
  throw new Error('列が不正です: ' + column);
}

/**
 * ボード全体を返す。列名をキーに、order 昇順のカード配列を持つ。
 *
 * カードにIssueの題名と状態を載せるのは、UI側で1件ずつ問い合わせ直す
 * のを避けるため。
 *
 * @returns {Object<string, object[]>}
 */
function projectBoard() {
  var cols = PROJECT_COLUMNS();
  var board = {};
  for (var i = 0; i < cols.length; i++) board[cols[i]] = [];

  // やることは1回だけ読んで番号で引く。カードごとに dbFindOne を呼ぶと
  // 1枚ごとに表を丸ごと読むことになり、カード数に比例して遅くなる
  // (projectPlace は鍵を持ったままここを通る)。先の1件を採るのは
  // dbFindOne と同じ
  var issues = dbReadAll('issues');
  var byNumber = {};
  for (var n = 0; n < issues.length; n++) {
    var key = String(issues[n].number);
    if (!Object.prototype.hasOwnProperty.call(byNumber, key)) byNumber[key] = issues[n];
  }

  var now = new Date();
  var items = dbReadAll('project_items');
  for (var j = 0; j < items.length; j++) {
    var column = String(items[j].column);
    if (!board[column]) continue;

    var issue = byNumber[String(items[j].issueNumber)];
    if (!issue || issue.archivedAt) continue;

    // 画面に渡すため、日時は文字列にして素の形にする
    var due = issue.dueDate ? new Date(issue.dueDate) : null;
    var stale = stalenessOf(issue, now);

    board[column].push({
      issueNumber: Number(items[j].issueNumber),
      order: Number(items[j].order),
      title: String(issue.title == null ? '' : issue.title),
      state: String(issue.state == null ? '' : issue.state),
      assignee: String(issue.assignee == null ? '' : issue.assignee),
      assignees: issueAssignees(issue),
      labels: String(issue.labels == null ? '' : issue.labels),
      // カードにも優先度を持たせる。一覧にだけ出ると、ボードで見て
      // いる人には何が急ぎなのか伝わらない
      priority: issuePriority(issue),
      dueDate: (due && !isNaN(due.getTime())) ? due.toISOString() : '',
      staleDays: stale.days,
      staleLevel: stale.level,
    });
  }

  for (var k = 0; k < cols.length; k++) {
    board[cols[k]].sort(function (a, b) { return a.order - b.order; });
  }
  return board;
}

/**
 * カードを列の末尾に置く。既に配置済みなら何もしない。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @returns {object} project_items 行
 */
function projectPlace(issueNumber, column) {
  projectAssertColumn_(column);
  issueGet(issueNumber);

  /*
   * **あるかどうか見るところから書くまでを、1つの鍵の中で行う。**
   *
   * 分けると、ほぼ同時の2件が「まだ無い」と読んで両方置く。板に同じカードが
   * 2枚並び、`projectMove` は `issueNumber` で探して先の1枚だけ動かすので、
   * もう1枚は元の列に残って画面から外す道が無くなる。
   */
  return dbWithLock_(30000, function () {
    var existing = dbFindOne('project_items', 'issueNumber', issueNumber);
    if (existing) return existing;

    var board = projectBoard();
    var row = {
      issueNumber: issueNumber,
      column: column,
      order: board[column].length,
    };
    dbAppend('project_items', row);
    return row;
  });
}

/**
 * カードを別の列・別の位置に移す。未配置なら先に置く。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @param {number} order
 * @returns {object} 更新後の行
 */
function projectMove(issueNumber, column, order) {
  projectAssertColumn_(column);
  if (!dbFindOne('project_items', 'issueNumber', issueNumber)) {
    projectPlace(issueNumber, column);
  }
  dbUpdate('project_items', 'issueNumber', issueNumber, {
    column: column,
    order: Number(order),
  });
  return dbFindOne('project_items', 'issueNumber', issueNumber);
}
