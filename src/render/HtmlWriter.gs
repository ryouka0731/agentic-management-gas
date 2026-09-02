/**
 * Block配列が Google Docs に書き戻せるかを検証する。
 *
 * body.clear() は破壊的操作であり、途中で失敗すると内容が失われる。
 * そのため書き戻しの前に必ずこの検証を通す。
 *
 * @param {object[]} blocks
 * @returns {string[]} 問題の説明。空配列なら書き戻し可能
 */
function htmlWriterValidate(blocks) {
  var problems = [];
  var known = { heading: 1, paragraph: 1, listItem: 1, table: 1, image: 1 };

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];

    if (!known[b.type]) {
      problems.push((i + 1) + '行目: 未対応のブロック種別です (' + b.type + ')');
      continue;
    }

    if (b.type === 'image') {
      if (b.sha === 'unavailable') {
        problems.push(
          (i + 1) + '行目: 実体を取得できない画像が含まれています (alt=' +
          (b.alt || '') + ')。書き戻すとこの画像は失われます。' +
          'Docs上で画像を貼り直してからやり直してください'
        );
      } else if (!objectFindBlob(b.sha)) {
        problems.push(
          (i + 1) + '行目: 画像の実体がobjectsに見つかりません (sha=' +
          String(b.sha).substring(0, 7) + ')'
        );
      }
    }

    if (b.type === 'table') {
      if (!b.rows || b.rows.length === 0) {
        problems.push((i + 1) + '行目: 空のテーブルは書き戻せません');
      } else if (!b.rows[0] || b.rows[0].length === 0) {
        problems.push((i + 1) + '行目: 列が0のテーブルは書き戻せません');
      }
    }
  }

  return problems;
}

/**
 * Run配列を Text 要素に書き込み、装飾を適用する。
 *
 * appendText で追加した範囲に対して、開始位置と終了位置を指定して
 * 装飾を設定する。Docsの装飾APIは [start, end] の閉区間を取るため、
 * end は「追加後の長さ - 1」になる。
 *
 * @param {GoogleAppsScript.Document.Text} text
 * @param {object[]} runs
 */
function writeRuns_(text, runs) {
  if (!runs) return;
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (!r.text) continue;

    var start = text.getText().length;
    text.appendText(r.text);
    var end = text.getText().length - 1;
    if (end < start) continue;

    if (r.bold) text.setBold(start, end, true);
    if (r.italic) text.setItalic(start, end, true);
    if (r.underline) text.setUnderline(start, end, true);
    if (r.strike) text.setStrikethrough(start, end, true);
    if (r.link) text.setLinkUrl(start, end, r.link);
  }
}

/**
 * 見出しレベルを ParagraphHeading に変換する。
 *
 * @param {number} level 1-6
 * @returns {GoogleAppsScript.Document.ParagraphHeading}
 */
function headingFromLevel_(level) {
  var H = DocumentApp.ParagraphHeading;
  if (level === 1) return H.HEADING1;
  if (level === 2) return H.HEADING2;
  if (level === 3) return H.HEADING3;
  if (level === 4) return H.HEADING4;
  if (level === 5) return H.HEADING5;
  return H.HEADING6;
}

/**
 * Block配列を Google Docs の body に書き込む。
 *
 * 破壊的操作である。必ず htmlWriterValidate を通してから呼ぶこと。
 * fileId は変わらないため、共有リンク・権限・埋め込みは維持される。
 *
 * @param {string} fileId
 * @param {object[]} blocks
 */
function writeBlocksToDoc(fileId, blocks) {
  var problems = htmlWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('書き戻せません:\n' + problems.join('\n'));
  }
  if (blocks.length === 0) {
    throw new Error('書き戻す内容が空です。文書全体が消えるため中断しました');
  }

  var doc = DocumentApp.openById(fileId);
  var body = doc.getBody();

  // body.clear() は末尾に空の段落を1つ残す。後で削除するために
  // 事前の子要素数を控えておく必要はなく、書き込み後に判定する
  body.clear();

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];

    if (b.type === 'heading') {
      var h = body.appendParagraph('');
      h.setHeading(headingFromLevel_(b.level));
      writeRuns_(h.editAsText(), b.runs);

    } else if (b.type === 'paragraph') {
      var p = body.appendParagraph('');
      p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      writeRuns_(p.editAsText(), b.runs);

    } else if (b.type === 'listItem') {
      var li = body.appendListItem('');
      // ネストレベルを先に設定する。glyphType を先に設定すると
      // ネスト変更時に既定のグリフへ戻ることがある
      li.setNestingLevel(b.depth || 0);
      li.setGlyphType(b.ordered
        ? DocumentApp.GlyphType.NUMBER
        : DocumentApp.GlyphType.BULLET);
      writeRuns_(li.editAsText(), b.runs);

    } else if (b.type === 'table') {
      // appendTable は文字列の2次元配列を取る。装飾はセルごとに後から適用する
      var plain = [];
      for (var r = 0; r < b.rows.length; r++) {
        var row = [];
        for (var c = 0; c < b.rows[r].length; c++) {
          var cellText = '';
          for (var k = 0; k < b.rows[r][c].length; k++) {
            cellText += b.rows[r][c][k].text;
          }
          // 空文字のセルはDocsが行を潰すことがあるため半角スペースを置く
          row.push(cellText === '' ? ' ' : cellText);
        }
        plain.push(row);
      }
      var table = body.appendTable(plain);

      for (var tr = 0; tr < b.rows.length; tr++) {
        for (var tc = 0; tc < b.rows[tr].length; tc++) {
          var runs = b.rows[tr][tc];
          if (!runs || runs.length === 0) continue;
          // セル内の最初の段落に直接書く。cell.clear() は段落構造を
          // 壊すことがあるため使わない
          var cellPara = table.getRow(tr).getCell(tc).getChild(0).asParagraph();
          cellPara.setText('');
          writeRuns_(cellPara.editAsText(), runs);
        }
      }

    } else if (b.type === 'image') {
      var blob = objectFindBlob(b.sha);
      var imgPara = body.appendParagraph('');
      var inserted = imgPara.appendInlineImage(blob);
      if (b.alt) inserted.setAltDescription(b.alt);
    }
  }

  // body.clear() が残した空段落が先頭にあれば削除する。
  // 内容を書き込んだ後なので、body に2つ以上の子要素がある場合のみ実施する
  if (body.getNumChildren() > 1) {
    var first = body.getChild(0);
    if (first.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var fp = first.asParagraph();
      if (fp.getText() === '' && fp.getNumChildren() === 0) {
        body.removeChild(first);
      }
    }
  }

  doc.saveAndClose();
}

/**
 * 正規化HTMLを Google Docs に書き戻す。
 *
 * @param {string} fileId
 * @param {string} html
 */
function writeHtmlToDoc(fileId, html) {
  writeBlocksToDoc(fileId, parseBlocks(html));
}
