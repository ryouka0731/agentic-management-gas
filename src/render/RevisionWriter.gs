/*
 * 改訂履歴の表を文書に書く (src/core/Revision.gs の revisionExport から呼ぶ)。
 *
 * **反映の書き戻し (writeBlocksToDoc / writeHtmlToSheet) は使わない。** あちらは本文を丸ごと消して
 * 書き直す (Docs は body.clear()、Sheets は HTML に無いシートを消す)。ここで要るのは末尾への追記と、
 * 自分が前に書いた表の置き換えだけなので、そこだけを触る。
 *
 * どちらも書く前に確かめる (CLAUDE.md の「破壊的操作の前には必ず検証する」)。
 */

/**
 * 書く表として正しいかを確かめる。
 *
 * - 見出しの行と、ほかの行が同じ列数
 * - 空のセルが無い (実機の Docs は空の字を入れる操作を断る。docs/dev/pitfalls.md)
 * - Docs の書き戻しで書ける形 (htmlWriterValidate)
 *
 * @param {string} title
 * @param {string[][]} rows
 * @returns {string[]} 問題の説明。空なら書ける
 */
function revisionTableProblems_(title, rows) {
  var problems = [];
  if (!title) problems.push('見出しが空です');
  if (!rows || !rows.length || !rows[0].length) {
    problems.push('表が空です');
    return problems;
  }
  var width = rows[0].length;
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].length !== width) problems.push((r + 1) + '行目: 列の数が見出しと違います');
    for (var c = 0; c < rows[r].length; c++) {
      if (!String(rows[r][c] == null ? '' : rows[r][c]).replace(/^\s+|\s+$/g, '')) {
        problems.push((r + 1) + '行目 ' + (c + 1) + '列目: 空のセルは書けません');
      }
    }
  }
  if (problems.length) return problems;

  var cells = [];
  for (var k = 0; k < rows.length; k++) {
    var line = [];
    for (var j = 0; j < rows[k].length; j++) line.push([{ text: String(rows[k][j]) }]);
    cells.push(line);
  }
  return htmlWriterValidate([
    { type: 'heading', level: 2, runs: [{ text: title }] },
    { type: 'table', rows: cells },
  ]);
}

/** 書く前に確かめ、駄目なら何も書かずに断る */
function revisionAssertTable_(title, rows) {
  var problems = revisionTableProblems_(title, rows);
  if (problems.length) {
    throw new Error('改訂履歴の表として正しくありません:\n' + problems.join('\n'));
  }
}

/**
 * Docs の本文から、前に書き出した「見出し + 表」を探す。後ろから探し、最後のものを返す。
 *
 * 見出しの字が同じでも、表の1行目が書き出した見出しの行と違えば、人が書いた別の表として扱う。
 *
 * @param {GoogleAppsScript.Document.Body} body
 * @param {string} title
 * @param {string[]} header
 * @returns {number} 見出しの位置。無ければ -1。人が書いた同じ名前の表なら -2
 */
function revisionDocFind_(body, title, header) {
  var T = DocumentApp.ElementType;
  var n = body.getNumChildren();
  for (var i = n - 2; i >= 0; i--) {
    var el = body.getChild(i);
    if (el.getType() !== T.PARAGRAPH) continue;

    var p = el.asParagraph();
    if (p.getHeading() === DocumentApp.ParagraphHeading.NORMAL) continue;
    if (String(p.getText()).replace(/^\s+|\s+$/g, '') !== title) continue;

    var next = body.getChild(i + 1);
    if (next.getType() !== T.TABLE) continue;
    return revisionDocHeaderIs_(next.asTable(), header) ? i : -2;
  }
  return -1;
}

/** 表の1行目が、書き出した見出しの行と同じか */
function revisionDocHeaderIs_(table, header) {
  if (table.getNumRows() < 1) return false;
  var row = table.getRow(0);
  if (row.getNumCells() !== header.length) return false;
  for (var c = 0; c < header.length; c++) {
    if (String(row.getCell(c).getText()).replace(/^\s+|\s+$/g, '') !== header[c]) return false;
  }
  return true;
}

/**
 * Docs の末尾に改訂履歴の表を書く。前に書き出した表があれば、その表だけを置き換える。
 *
 * **body.clear() をしない。** 本文のほかの場所には触れない。
 *
 * @param {string} fileId
 * @param {string} title 見出しの字
 * @param {string[][]} rows 見出しの行 + 中身
 */
function revisionWriteDoc_(fileId, title, rows) {
  revisionAssertTable_(title, rows);

  var doc = DocumentApp.openById(fileId);
  var body = doc.getBody();
  var at = revisionDocFind_(body, title, rows[0]);

  if (at === -2) {
    throw new Error(
      '本文に「' + title + '」という見出しの表が既にあり、書き出したものではないため置き換えられません。' +
      '見出しの名前を変えてから書き出してください');
  }

  if (at >= 0) {
    body.removeChild(body.getChild(at + 1));
    body.insertTable(at + 1, rows);
  } else {
    var head = body.appendParagraph(title);
    head.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendTable(rows);
  }
  doc.saveAndClose();
}

/** Sheets のセルに字として書く (先頭に ' を付けて、日付や数式として読ませない) */
function revisionSheetCell_(v) {
  return "'" + String(v == null ? '' : v);
}

/**
 * Sheets に `改訂履歴` のシートを作るか、そのシートだけを書き直す。
 *
 * 同じ名前のシートがあって1行目が書き出した見出しの行と違えば、人が作ったシートとして断る。
 *
 * @param {string} fileId
 * @param {string} title シートの名前
 * @param {string[][]} rows 見出しの行 + 中身
 */
function revisionWriteSheet_(fileId, title, rows) {
  revisionAssertTable_(title, rows);

  var ss = SpreadsheetApp.openById(fileId);
  var sheet = ss.getSheetByName(title);

  if (sheet) {
    var first = sheet.getDataRange().getDisplayValues()[0] || [];
    var ours = first.length === rows[0].length;
    for (var c = 0; ours && c < rows[0].length; c++) {
      if (String(first[c]) !== rows[0][c]) ours = false;
    }
    if (!ours && sheet.getLastRow() > 0) {
      throw new Error(
        '「' + title + '」という名前のシートが既にあり、書き出したものではないため置き換えられません。' +
        'シートの名前を変えてから書き出してください');
    }
    // 書き出し専用のシートなので、前の中身ごと書き直す (行が減ったときに古い行を残さない)
    sheet.clear();
  } else {
    sheet = ss.insertSheet(title);
  }

  var values = [];
  for (var r = 0; r < rows.length; r++) {
    var line = [];
    for (var k = 0; k < rows[r].length; k++) line.push(revisionSheetCell_(rows[r][k]));
    values.push(line);
  }
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
}
