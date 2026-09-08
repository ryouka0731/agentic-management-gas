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

    var shapes = slides[i].getShapes();
    for (var s = 0; s < shapes.length; s++) {
      var text = slideShapeText_(shapes[s]);
      if (text) blocks.push({ type: 'paragraph', runs: [{ text: text }] });
    }

    var notes = slideNotes_(slides[i]);
    if (notes) {
      blocks.push({ type: 'paragraph', runs: [{ text: 'ノート: ' + notes }] });
    }
  }
  return serializeBlocks(blocks);
}
