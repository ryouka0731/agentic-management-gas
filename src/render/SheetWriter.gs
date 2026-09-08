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
    sheet.clear();
    if (block.rows.length === 0) continue;

    var width = 0;
    for (var w = 0; w < block.rows.length; w++) {
      if (block.rows[w].length > width) width = block.rows[w].length;
    }

    var matrix = [];
    for (var r = 0; r < block.rows.length; r++) {
      var line = [];
      for (var c = 0; c < width; c++) {
        var cell = block.rows[r][c];
        // 数式があれば数式を書く。setValues は '=' 始まりを数式として解釈する
        line.push(cell ? (cell.formula || cell.value) : '');
      }
      matrix.push(line);
    }
    sheet.getRange(1, 1, matrix.length, width).setValues(matrix);
  }

  // HTMLに無くなったシートは削除する。ただし最後の1枚は消せない
  var existing = ss.getSheets();
  for (var e = 0; e < existing.length; e++) {
    if (keep[existing[e].getName()]) continue;
    if (ss.getSheets().length <= 1) break;
    ss.deleteSheet(existing[e]);
  }
}
