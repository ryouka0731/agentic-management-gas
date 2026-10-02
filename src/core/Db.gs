/**
 * テーブル定義。ヘッダ行のカラム名と順序を決める唯一の情報源。
 *
 * トップレベルのconstではなく関数として公開する。GASはファイルを
 * ファイル名順に読み込むため、トップレベル初期化は順序依存になる。
 *
 * @returns {Object<string, string[]>}
 */
function DB_SCHEMA() {
  // 列を増やすときは必ず**末尾に足す**。途中に挿入すると、既にシートに
  // 書かれている行を新しい順序で読むことになり、値が1つずつずれる。
  // dueDate を createdAt の前に入れて実際に壊した (作成日時が空になり、
  // 工程表が全行を読み飛ばした)。順序は test/schema.test.js で固定している
  return {
    files: ['fileId', 'path', 'type', 'registeredAt', 'registeredBy', 'baseSha'],
    commits: ['sha', 'parentSha', 'branch', 'fileId', 'blobSha', 'author', 'message', 'timestamp'],
    branches: ['name', 'headSha', 'baseSha', 'state', 'workingFolderId', 'createdBy', 'createdAt'],
    pulls: ['number', 'title', 'body', 'sourceBranch', 'targetBranch', 'state', 'author', 'createdAt', 'mergedAt', 'reviewers', 'targetFiles'],
    reviews: ['prNumber', 'reviewer', 'state', 'body', 'at', 'id', 'editedAt'],
    task_links: ['issueNumber', 'user', 'taskId', 'listId', 'syncedAt'],
    issue_comments: ['id', 'issueNumber', 'body', 'by', 'at', 'editedAt'],
    usage: ['day', 'kind', 'target', 'count', 'user'],
    templates: ['name', 'body', 'builtin', 'createdBy', 'createdAt'],
    members: ['email', 'manager', 'note', 'updatedAt', 'name'],
    tags: ['name', 'color', 'builtin', 'createdBy', 'createdAt'],
    notifications: ['id', 'to', 'kind', 'title', 'body', 'link', 'at', 'readAt'],
    inquiries: ['number', 'kind', 'body', 'by', 'at', 'state', 'context',
      'answer', 'answeredAt', 'title', 'closedBy', 'shots', 'issueNumber'],
    inquiry_replies: ['id', 'inquiryNumber', 'body', 'by', 'at', 'editedAt', 'shots'],
    issues: ['number', 'title', 'body', 'state', 'assignee', 'labels', 'linkedFileIds', 'linkedPr', 'createdAt', 'closedAt', 'dueDate', 'startDate', 'parent', 'estimate', 'plannedHours', 'actualHours', 'archivedAt', 'updatedAt', 'priority'],
    // コードの変更を、確認依頼に添える証跡として持つ。版を持つ文書では
    // ないので files には入れない (コピーも編集も書き戻しも無い)
    pull_patches: ['prNumber', 'id', 'path', 'blobSha', 'added', 'removed', 'at', 'by'],
    // 手元の Claude に頼むことの置き場。**この道具から手元へ向かう唯一の
    // 経路である。** 外部 API は使わないので、Drive の同期に乗せる
    outbox: ['id', 'verb', 'args', 'note', 'state', 'prNumber',
      'createdAt', 'createdBy', 'takenAt', 'takenBy', 'doneAt', 'result'],
    project_items: ['issueNumber', 'column', 'order'],
  };
}

/**
 * テーブルに対応するシートを取得する。存在しなければヘッダ付きで作成する。
 *
 * @param {string} table
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function dbSheet_(table) {
  var schema = DB_SCHEMA();
  var cols = schema[table];
  if (!cols) throw new Error('未定義のテーブルです: ' + table);

  var ss = SpreadsheetApp.openById(repoConfig().dbId);
  var sheet = ss.getSheetByName(table);

  if (!sheet) {
    sheet = ss.insertSheet(table);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // 列を増やしたとき、既存シートの見出し行が古いままだと
  // 人が開いたときに何の列か分からなくなる。合わせておく
  var header = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
  var stale = false;
  for (var h = 0; h < cols.length; h++) {
    if (String(header[h]) !== cols[h]) stale = true;
  }
  if (stale) sheet.getRange(1, 1, 1, cols.length).setValues([cols]);

  return sheet;
}

/**
 * テーブルの全行をオブジェクト配列として読む。
 *
 * 注意: 行数に比例して遅くなる。数万行規模ではシャーディングが必要
 * (scaling doc §2.2 を参照)。
 *
 * @param {string} table
 * @returns {object[]}
 */
function dbReadAll(table) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < cols.length; c++) {
      obj[cols[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

/**
 * いま鍵を持っている深さ。
 *
 * **入れ子で二度取りに行かないため。** コマンドキューは鍵を持ったまま命令を
 * 実行し、その中で番号を採る。鍵を取り直す作りだと、取れるかどうかが
 * LockService の入れ子の扱いに左右される。自分で数えて、持っているなら
 * 取りに行かない。
 */
var dbLockDepth_ = 0;

/**
 * 台帳を書き換えるあいだ、他を待たせる。
 *
 * Web アプリと1分ごとのトリガーが同じ表に書くため、読んで決めて書く形は
 * 鍵なしでは成立しない。
 *
 * @param {number} waitMs 待つ上限
 * @param {function} fn 鍵を持って行うこと
 * @param {function} [onBusy] 取れなかったときの返し。省略すると投げる
 * @returns {*} fn の戻り
 */
function dbWithLock_(waitMs, fn, onBusy) {
  if (dbLockDepth_ > 0) {
    dbLockDepth_++;
    try {
      return fn();
    } finally {
      dbLockDepth_--;
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) {
    if (onBusy) return onBusy();
    throw new Error('混み合っています。少し待ってからもう一度お試しください');
  }

  dbLockDepth_++;
  try {
    return fn();
  } finally {
    dbLockDepth_--;
    lock.releaseLock();
  }
}

/**
 * その列の次の番号を返す。
 *
 * **単独で呼ばない。** 読んだあと書くまでに他が割り込むと同じ番号になる。
 * `dbAppendNumbered` から鍵の中で呼ぶ。
 *
 * @param {string} table
 * @param {string} column
 * @returns {number}
 */
function dbNextNumber_(table, column) {
  var rows = dbReadAll(table);
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i][column]);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * 番号を振って1行追記する。
 *
 * **番号を決めることと書くことを、1つの鍵の中で行う。** 分けると、ほぼ同時の
 * 2件が同じ番号を取る。そうなると一覧に同じ番号のものが2つ並び、`dbFindOne`
 * は先の1件しか返さないので、もう1件は見えるのに開けない幽霊になる。
 *
 * **番号は表ごとの通し番号にする。** 親ごとに振ると番号がかぶり、
 * `dbUpdate` / `dbDelete` は列の値だけで行を探すため、関係のない親の行を
 * 書き換えたり一緒に消したりする (実際に `pull_patches` で踏んだ)。
 *
 * @param {string} table
 * @param {string} column 番号の列
 * @param {object} row 番号以外を埋めた行
 * @returns {object} 番号の入った行
 */
function dbAppendNumbered(table, column, row) {
  return dbWithLock_(30000, function () {
    row[column] = dbNextNumber_(table, column);
    dbAppend(table, row);
    return row;
  });
}

/**
 * テーブルに1行追記する。スキーマに無いキーは無視される。
 *
 * @param {string} table
 * @param {object} obj
 */
function dbAppend(table, obj) {
  var cols = DB_SCHEMA()[table];
  var row = [];
  for (var i = 0; i < cols.length; i++) {
    var v = obj[cols[i]];
    row.push(v === undefined || v === null ? '' : v);
  }
  dbSheet_(table).appendRow(row);
}

/**
 * key === value を満たす最初の行を返す。見つからなければ null。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @returns {object|null}
 */
function dbFindOne(table, key, value) {
  var rows = dbReadAll(table);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key]) === String(value)) return rows[i];
  }
  return null;
}

/**
 * key === value を満たす最初の行に patch を適用する。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @param {object} patch
 * @returns {boolean} 更新した行があれば true
 */
function dbUpdate(table, key, value, patch) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return false;

  var keyCol = cols.indexOf(key);
  if (keyCol < 0) throw new Error('未定義のカラムです: ' + key);

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][keyCol]) !== String(value)) continue;
    for (var c = 0; c < cols.length; c++) {
      if (Object.prototype.hasOwnProperty.call(patch, cols[c])) {
        values[r][c] = patch[cols[c]];
      }
    }
    sheet.getRange(r + 2, 1, 1, cols.length).setValues([values[r]]);
    return true;
  }
  return false;
}

/**
 * 条件に一致する行をすべて削除する。
 *
 * 行番号は削除のたびにずれるため、必ず下から消す。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @returns {number} 削除した行数
 */
function dbDelete(table, key, value) {
  // 空の値を許すと「キー列が空の行」をまとめて消してしまう。
  // メタDBは人が直接編集できるスプレッドシートであり、手で消された
  // セルが1つあるだけで無関係な行まで巻き添えになる
  if (value === '' || value === null || value === undefined) {
    throw new Error('削除条件の値が空です: ' + table + '.' + key);
  }

  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var keyCol = cols.indexOf(key);
  if (keyCol < 0) throw new Error('未定義のカラムです: ' + key);

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  var deleted = 0;
  for (var r = values.length - 1; r >= 0; r--) {
    if (String(values[r][keyCol]) !== String(value)) continue;
    sheet.deleteRow(r + 2);
    deleted++;
  }
  return deleted;
}
