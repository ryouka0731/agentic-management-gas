/**
 * DocumentAppのTextから装飾情報付きのRun配列を抽出する。
 *
 * getTextAttributeIndices() は装飾が変わる位置のインデックスを返す。
 * 先頭が0でない場合があるため補う必要がある。
 *
 * @param {GoogleAppsScript.Document.Text} textEl
 * @returns {object[]} Run配列
 */
function docTextToRuns_(textEl) {
  var s = textEl.getText();
  if (!s) return [];

  var bounds = textEl.getTextAttributeIndices().slice();
  if (bounds.length === 0 || bounds[0] !== 0) bounds.unshift(0);

  var runs = [];
  for (var i = 0; i < bounds.length; i++) {
    var start = bounds[i];
    var end = (i + 1 < bounds.length) ? bounds[i + 1] : s.length;
    if (end <= start) continue;

    var run = { text: s.substring(start, end) };
    if (textEl.isBold(start)) run.bold = true;
    if (textEl.isItalic(start)) run.italic = true;
    if (textEl.isUnderline(start)) run.underline = true;
    if (textEl.isStrikethrough(start)) run.strike = true;
    var url = textEl.getLinkUrl(start);
    if (url) run.link = url;

    runs.push(run);
  }
  return mergeRuns(runs);
}

/**
 * ParagraphHeadingをHTMLの見出しレベル(1-6)に変換する。
 * 見出しでない場合は0を返す。
 *
 * @param {GoogleAppsScript.Document.ParagraphHeading} heading
 * @returns {number}
 */
function docHeadingLevel_(heading) {
  var H = DocumentApp.ParagraphHeading;
  if (heading === H.HEADING1 || heading === H.TITLE) return 1;
  if (heading === H.HEADING2 || heading === H.SUBTITLE) return 2;
  if (heading === H.HEADING3) return 3;
  if (heading === H.HEADING4) return 4;
  if (heading === H.HEADING5) return 5;
  if (heading === H.HEADING6) return 6;
  return 0;
}

/**
 * 画像のMIMEタイプから保存用の拡張子を決める。
 *
 * @param {string} contentType
 * @returns {string}
 */
function imageExt_(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/bmp') return 'bmp';
  return 'bin';
}

/**
 * 段落内のInlineImageを抽出し、blobをobjectsに保存してimageブロックを返す。
 *
 * 画像はコンテンツアドレッシングで保存する。同じ画像が複数箇所にあっても
 * 実体は1つしか保存されない。
 *
 * 注意: 画像は必ず objectPutBlob でBlobのまま保存する。文字列化すると
 * バイト列が破壊される。
 *
 * @param {GoogleAppsScript.Document.Paragraph|GoogleAppsScript.Document.ListItem} para
 * @returns {object[]} imageブロックの配列
 */
function docExtractImages_(para) {
  var out = [];
  var n = para.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = para.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.INLINE_IMAGE) continue;

    var img = child.asInlineImage();
    var sha;
    try {
      var blob = img.getBlob();
      sha = sha256HexBytes(blob);
      objectPutBlob(sha, blob, imageExt_(blob.getContentType()));
    } catch (e) {
      // Driveから削除された画像、リンク切れ画像、権限のない画像に対しては
      // getBlob() が "Invalid argument: imageId" を投げる。要素自体は正常で、
      // サイズや代替テキストは取得できるが、バイト列の実体だけが存在しない。
      //
      // 版管理システムとして、画像1つのバイト列が取れないことで文書全体の
      // レンダリングを落としてはならない。本文の差分は取れるべきである。
      //
      // SHAは常に64桁hexなので、'unavailable' が実SHAと衝突することはない。
      // 画像が復活すれば実SHAに変わり、それは正しく差分として現れる。
      sha = 'unavailable';
      Logger.log('画像のバイト列を取得できません (alt=' +
        (img.getAltDescription() || img.getAltTitle() || '') + '): ' + e.message);
    }

    out.push({
      type: 'image',
      sha: sha,
      alt: img.getAltTitle() || img.getAltDescription() || '',
    });
  }
  return out;
}

/**
 * TableCellからRun配列を抽出する。セル内の全段落のテキストを連結する。
 *
 * @param {GoogleAppsScript.Document.TableCell} cell
 * @returns {object[]}
 */
function docCellToRuns_(cell) {
  var runs = [];
  var n = cell.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = cell.getChild(i);
    var t = child.getType();
    if (t === DocumentApp.ElementType.PARAGRAPH) {
      runs = runs.concat(docTextToRuns_(child.asParagraph().editAsText()));
    } else if (t === DocumentApp.ElementType.LIST_ITEM) {
      runs = runs.concat(docTextToRuns_(child.asListItem().editAsText()));
    }
  }
  return mergeRuns(runs);
}

/**
 * Google DocsをBlock配列に変換する。
 *
 * @param {string} fileId
 * @returns {object[]} Block配列
 */
function renderDocBlocks(fileId) {
  var body = DocumentApp.openById(fileId).getBody();
  var blocks = [];
  var ET = DocumentApp.ElementType;

  var n = body.getNumChildren();
  for (var i = 0; i < n; i++) {
    var el = body.getChild(i);
    var type = el.getType();

    if (type === ET.PARAGRAPH) {
      var para = el.asParagraph();
      var images = docExtractImages_(para);
      var runs = docTextToRuns_(para.editAsText());
      var level = docHeadingLevel_(para.getHeading());

      if (runs.length > 0 || images.length === 0) {
        blocks.push(level > 0
          ? { type: 'heading', level: level, runs: runs }
          : { type: 'paragraph', runs: runs });
      }
      for (var im = 0; im < images.length; im++) blocks.push(images[im]);

    } else if (type === ET.LIST_ITEM) {
      var li = el.asListItem();
      var glyph = li.getGlyphType();
      var ordered = (
        glyph === DocumentApp.GlyphType.NUMBER ||
        glyph === DocumentApp.GlyphType.LATIN_UPPER ||
        glyph === DocumentApp.GlyphType.LATIN_LOWER ||
        glyph === DocumentApp.GlyphType.ROMAN_UPPER ||
        glyph === DocumentApp.GlyphType.ROMAN_LOWER
      );
      blocks.push({
        type: 'listItem',
        ordered: ordered,
        depth: li.getNestingLevel(),
        runs: docTextToRuns_(li.editAsText()),
      });

    } else if (type === ET.TABLE) {
      var table = el.asTable();
      var rows = [];
      for (var r = 0; r < table.getNumRows(); r++) {
        var tr = table.getRow(r);
        var cells = [];
        for (var c = 0; c < tr.getNumCells(); c++) {
          cells.push(docCellToRuns_(tr.getCell(c)));
        }
        rows.push(cells);
      }
      blocks.push({ type: 'table', rows: rows });
    }
    // PAGE_BREAK / HORIZONTAL_RULE は版管理の対象外として無視する
  }

  return blocks;
}

/**
 * Google Docsを正規化HTMLに変換する。
 *
 * @param {string} fileId
 * @returns {string}
 */
function renderDoc(fileId) {
  return serializeBlocks(renderDocBlocks(fileId));
}
