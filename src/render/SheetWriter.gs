/**
 * Sheets に書き戻せるかを検証する。問題があれば説明文の配列を返す。
 *
 * 書き戻しは sheet.clear() を伴う破壊的操作であるため、1つでも
 * 問題があれば実行前に中断する。Docs 側の htmlWriterValidate と同じ考え方。
 *
 * @param {object[]} blocks
 * @returns {string[]}
 */
function sheetWriterValidate(blocks) {
  var problems = [];
  var names = {};

  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'sheet') {
      problems.push(
        (i + 1) + '行目: Sheetsに書き戻せないブロックです (' + blocks[i].type + ')'
      );
      continue;
    }

    var name = String(blocks[i].name || '');
    if (!name) {
      problems.push((i + 1) + '行目: シート名が空です');
      continue;
    }
    if (names[name]) {
      problems.push((i + 1) + '行目: シート名が重複しています: ' + name);
    }
    names[name] = true;
  }
  return problems;
}

/**
 * 正規化HTMLを Google Sheets に書き戻す。
 *
 * fileId は変えない。シートは名前で対応付け、HTMLに無いシートは削除する。
 *
 * @param {string} fileId
 * @param {string} html
 */
function writeHtmlToSheet(fileId, html) {
  var blocks = parseBlocks(html);
  var problems = sheetWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('Sheetsに書き戻せません:\n' + problems.join('\n'));
  }

  var ss = SpreadsheetApp.openById(fileId);
  var keep = {};

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    keep[block.name] = true;

    var sheet = ss.getSheetByName(block.name) || ss.insertSheet(block.name);
    sheetWriteBlock_(sheet, block);
  }

  // HTMLに無くなったシートは削除する。ただし最後の1枚は消せない
  var existing = ss.getSheets();
  for (var e = 0; e < existing.length; e++) {
    if (keep[existing[e].getName()]) continue;
    if (ss.getSheets().length <= 1) break;
    ss.deleteSheet(existing[e]);
  }
}

/**
 * 1枚のシートに書き戻す。
 *
 * **変わったセルだけを書く。** 読むのは表示値 (getDisplayValues) なので、
 * 表示値をそのまま書き戻すと、反映で触っていないセルまで丸めた値に置き
 * 換わる (3.14159 → 3.14、書式で付けた先頭の0 '0123' → 123)。表示値も数式も
 * 今と同じセルは、いまの生の値 (数式があれば数式) を書き直すだけにする。
 *
 * **clear() しない。** 表示の書式まで消え、残したはずの値も違って見える。
 * はみ出したぶんは空を書いて消す。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {object} block sheet ブロック
 */
function sheetWriteBlock_(sheet, block) {
  var range = sheet.getDataRange();
  var rawNow = range.getValues();
  var shownNow = range.getDisplayValues();
  var formulaNow = range.getFormulas();

  var height = Math.max(block.rows.length, rawNow.length);
  var width = 0;
  for (var w = 0; w < block.rows.length; w++) {
    if (block.rows[w].length > width) width = block.rows[w].length;
  }
  for (var x = 0; x < rawNow.length; x++) {
    if (rawNow[x].length > width) width = rawNow[x].length;
  }
  if (!height || !width) return;

  var matrix = [];
  for (var r = 0; r < height; r++) {
    var line = [];
    for (var c = 0; c < width; c++) {
      var want = (block.rows[r] && block.rows[r][c]) || null;
      var wantFormula = want && want.formula ? String(want.formula) : '';
      var wantValue = want ? String(want.value == null ? '' : want.value) : '';

      var had = r < rawNow.length && c < rawNow[r].length;
      var hadFormula = had ? String(formulaNow[r][c] || '') : '';
      var same = had && hadFormula === wantFormula &&
        (wantFormula || String(shownNow[r][c]) === wantValue);

      if (same) line.push(hadFormula || rawNow[r][c]);
      // 数式があれば数式を書く。setValues は '=' 始まりを数式として解釈する
      else line.push(wantFormula || wantValue);
    }
    matrix.push(line);
  }
  sheet.getRange(1, 1, height, width).setValues(matrix);
}
