/**
 * 末尾の空行を落とす。
 *
 * getDataRange は書式だけ残った行も返すことがある。落とさないと、
 * 内容が変わっていないのに行数の増減で差分が出る。
 *
 * @param {Array<Array<object>>} rows
 * @returns {Array<Array<object>>}
 */
function trimTrailingEmptyRows_(rows) {
  var end = rows.length;

  while (end > 0) {
    var empty = true;
    for (var c = 0; c < rows[end - 1].length; c++) {
      if (rows[end - 1][c].value !== '' || rows[end - 1][c].formula) empty = false;
    }
    if (!empty) break;
    end--;
  }
  return rows.slice(0, end);
}

/**
 * 1シートを sheet ブロックにする。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {object} sheet ブロック
 */
function sheetBlock_(sheet) {
  var range = sheet.getDataRange();
  var values = range.getDisplayValues();
  var formulas = range.getFormulas();
  var rows = [];

  for (var r = 0; r < values.length; r++) {
    var row = [];
    for (var c = 0; c < values[r].length; c++) {
      var cell = { value: String(values[r][c] == null ? '' : values[r][c]) };
      if (formulas[r] && formulas[r][c]) cell.formula = String(formulas[r][c]);
      row.push(cell);
    }
    rows.push(row);
  }

  return { type: 'sheet', name: sheet.getName(), rows: trimTrailingEmptyRows_(rows) };
}

/**
 * Google Sheets を正規化HTMLにする。
 *
 * 表示値 (getDisplayValues) を内容とし、数式は data-formula に退避する。
 * 表示値を使うのは「人が見ている値」を版管理の対象にするためである。
 *
 * @param {string} fileId
 * @returns {string} 正規化HTML
 */
function renderSheet(fileId) {
  var sheets = SpreadsheetApp.openById(fileId).getSheets();
  var blocks = [];

  for (var i = 0; i < sheets.length; i++) {
    blocks.push(sheetBlock_(sheets[i]));
  }
  return serializeBlocks(blocks);
}
