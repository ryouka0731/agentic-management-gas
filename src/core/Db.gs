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
    files: ['fileId', 'path', 'type', 'registeredAt', 'registeredBy'],
    commits: ['sha', 'parentSha', 'branch', 'fileId', 'blobSha', 'author', 'message', 'timestamp'],
    branches: ['name', 'headSha', 'baseSha', 'state', 'workingFolderId', 'createdBy', 'createdAt'],
    pulls: ['number', 'title', 'body', 'sourceBranch', 'targetBranch', 'state', 'author', 'createdAt', 'mergedAt'],
    reviews: ['prNumber', 'reviewer', 'state', 'body', 'at'],
    issues: ['number', 'title', 'body', 'state', 'assignee', 'labels', 'linkedFileIds', 'linkedPr', 'createdAt', 'closedAt', 'dueDate'],
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
