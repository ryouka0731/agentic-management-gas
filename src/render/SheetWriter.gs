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
  var now = {
    raw: range.getValues(),
    shown: range.getDisplayValues(),
    formula: range.getFormulas(),
  };

  var height = Math.max(block.rows.length, now.raw.length);
  var width = Math.max(sheetMaxWidth_(block.rows), sheetMaxWidth_(now.raw));
  if (!height || !width) return;

  var matrix = [];
  for (var r = 0; r < height; r++) {
    var line = [];
    for (var c = 0; c < width; c++) {
      line.push(sheetCellToWrite_(now, r, c, sheetWantCell_(block.rows[r], c)));
    }
    matrix.push(line);
  }
  sheet.getRange(1, 1, height, width).setValues(matrix);
}

/** 行の並びのうち、いちばん長い行の長さ */
function sheetMaxWidth_(rows) {
  var width = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].length > width) width = rows[i].length;
  }
  return width;
}

/** 書きたいセルの数式と表示値。セルが無ければ両方とも空 */
function sheetWantCell_(row, c) {
  var want = (row && row[c]) || null;
  if (!want) return { formula: '', value: '' };
  return {
    formula: want.formula ? String(want.formula) : '',
    value: String(want.value == null ? '' : want.value),
  };
}

/**
 * 1つのセルに書くもの。表示値も数式も今と同じなら、いまの生の値 (数式が
 * あれば数式) を書き直す。違えば書きたいものを書く。
 */
function sheetCellToWrite_(now, r, c, want) {
  var had = r < now.raw.length && c < now.raw[r].length;
  var hadFormula = had ? String(now.formula[r][c] || '') : '';
  var same = had && hadFormula === want.formula &&
    (want.formula || String(now.shown[r][c]) === want.value);

  if (same) return hadFormula || now.raw[r][c];
  // 数式があれば数式を書く。setValues は '=' 始まりを数式として解釈する
  return want.formula || want.value;
}
