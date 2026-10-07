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
      // 時刻を持たない値。ISO にすると、東京の0時が前日になる
      dueDate: plainDay(issue.dueDate),
      // エージェンティックスクラム。オフなら画面は使わない
      sprint: String(issue.sprint == null ? '' : issue.sprint),
      points: plainNumber(issue.points),
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
 * **order は列の中の位置 (0 から)。** その位置に差し込み、列のほかのカードの
 * 番号を振り直す。以前は渡した数をその1枚に書くだけで、ほかの番号をずらさな
 * かったため、同じ番号が並ぶと前後が決まらず、「この間に入れる」ができなかった。
 * 数でないものや列より大きい数は末尾に付ける。
 *
 * 読んでから書き直すので、鍵の中で行う。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @param {number} order 列の中の位置
 * @returns {object} 更新後の行
 */
function projectMove(issueNumber, column, order) {
  projectAssertColumn_(column);
  return dbWithLock_(30000, function () {
    if (!dbFindOne('project_items', 'issueNumber', issueNumber)) {
      projectPlace(issueNumber, column);
    }

    var rows = dbReadAll('project_items').filter(function (r) {
      return String(r.column) === String(column) && Number(r.issueNumber) !== Number(issueNumber);
    });
    rows.sort(function (a, b) { return Number(a.order) - Number(b.order); });

    var n = Number(order);
    var at = isFinite(n) ? Math.max(0, Math.min(rows.length, Math.floor(n))) : rows.length;
    rows.splice(at, 0, { issueNumber: issueNumber, moved: true });

    for (var i = 0; i < rows.length; i++) {
      if (rows[i].moved) {
        dbUpdate('project_items', 'issueNumber', issueNumber, { column: column, order: i });
      } else if (Number(rows[i].order) !== i) {
        // 番号が変わるものだけ書く (1枚ごとに表を読むので、書かずに済むものは書かない)
        dbUpdate('project_items', 'issueNumber', rows[i].issueNumber, { order: i });
      }
    }
    return dbFindOne('project_items', 'issueNumber', issueNumber);
  });
}
