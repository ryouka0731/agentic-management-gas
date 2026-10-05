/**
 * シェイプのテキストを取り出す。取れない種類は空文字を返す。
 *
 * @param {GoogleAppsScript.Slides.Shape} shape
 * @returns {string}
 */
function slideShapeText_(shape) {
  try {
    return normalizeSpace(shape.getText().asString());
  } catch (e) {
    return '';
  }
}

/**
 * スピーカーノートを取り出す。無ければ空文字を返す。
 *
 * @param {GoogleAppsScript.Slides.Slide} slide
 * @returns {string}
 */
function slideNotes_(slide) {
  try {
    var shape = slide.getNotesPage().getSpeakerNotesShape();
    return shape ? normalizeSpace(shape.getText().asString()) : '';
  } catch (e) {
    return '';
  }
}

/**
 * スライドの要素を、置いた順でブロックにする。
 *
 * **getShapes を使わない。** いちばん上の図形しか返さないため、グループに
 * まとめた図形と表の中の字が版管理に入らず、変えても差分に出なかった。
 * グループは中へ辿り、表は表として出す。画像や線など字の無いものは飛ばす。
 *
 * @param {GoogleAppsScript.Slides.PageElement[]} elements
 * @param {object[]} blocks 足していく先
 */
function slideElementsToBlocks_(elements, blocks) {
  var T = SlidesApp.PageElementType;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var type = el.getPageElementType();

    if (type === T.SHAPE) {
      var text = slideShapeText_(el.asShape());
      if (text) blocks.push({ type: 'paragraph', runs: [{ text: text }] });
    } else if (type === T.GROUP) {
      slideElementsToBlocks_(el.asGroup().getChildren(), blocks);
    } else if (type === T.TABLE) {
      var table = slideTableBlock_(el.asTable());
      if (table) blocks.push(table);
    }
  }
}

/**
 * Slides の表を table ブロックにする。字が1つも無ければ null。
 *
 * @param {GoogleAppsScript.Slides.Table} table
 * @returns {object|null}
 */
function slideTableBlock_(table) {
  var rows = [];
  var any = false;

  for (var r = 0; r < table.getNumRows(); r++) {
    var cells = [];
    for (var c = 0; c < table.getNumColumns(); c++) {
      // 結合したセルは、結合の頭以外から字を読めないことがある
      var text = '';
      try {
        text = slideShapeText_(table.getCell(r, c));
      } catch (e) {
        text = '';
      }
      if (text) any = true;
      cells.push(text ? [{ text: text }] : []);
    }
    rows.push(cells);
  }
  return any ? { type: 'table', rows: rows } : null;
}

/**
 * Google Slides を正規化HTMLにする (読み取り専用)。
 *
 * 図形の座標・サイズ・レイアウトマスタは HTML から復元できないため、
 * テキストとスピーカーノートだけを版管理の対象とする。
 * 書き戻しは提供しない (spec §5.7)。
 *
 * @param {string} fileId
 * @returns {string} 正規化HTML
 */
function renderSlides(fileId) {
  var slides = SlidesApp.openById(fileId).getSlides();
  var blocks = [];

  for (var i = 0; i < slides.length; i++) {
    blocks.push({ type: 'slide', index: i + 1 });

    slideElementsToBlocks_(slides[i].getPageElements(), blocks);

    var notes = slideNotes_(slides[i]);
    if (notes) {
      blocks.push({ type: 'paragraph', runs: [{ text: 'ノート: ' + notes }] });
    }
  }
  return serializeBlocks(blocks);
}
