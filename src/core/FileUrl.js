/**
 * ファイル種別と fileId から元ファイルの URL を作る。
 *
 * DriveApp を呼ばずに済ませるための関数である。一覧の各行で
 * getUrl() を呼ぶと、ファイル数だけ Drive へのアクセスが発生する。
 *
 * @param {string} type 'doc' | 'sheet' | 'slide'
 * @param {string} fileId
 * @returns {string} URL。fileId が無ければ空文字
 */
function fileUrlOf(type, fileId) {
  if (!fileId) return '';

  var base = {
    doc: 'https://docs.google.com/document/d/',
    sheet: 'https://docs.google.com/spreadsheets/d/',
    slide: 'https://docs.google.com/presentation/d/',
  }[String(type)];

  if (!base) return 'https://drive.google.com/file/d/' + fileId + '/view';
  return base + fileId + '/edit';
}
