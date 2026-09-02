/**
 * Web Appのエントリポイント。
 *
 * @param {object} e イベントオブジェクト
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.p) || 'wiki';
  if (!/^[a-z]{1,20}$/.test(page)) page = 'wiki';

  var template = HtmlService.createTemplateFromFile('ui/wiki');
  return template.evaluate()
    .setTitle('Agentic Management')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTMLテンプレートから別のHTMLファイルを取り込むためのヘルパー。
 * wiki.html 内で <?!= include('ui/app.css') ?> のように使う。
 *
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * リポジトリの初期セットアップ。GASエディタから1回だけ手動実行する。
 *
 * @returns {object} 作成されたリポジトリ設定
 */
function setupRepo() {
  return repoInit('agentic-management');
}

/**
 * 管理対象ファイルの一覧を返す (Web App API)。
 *
 * @returns {object[]} {fileId, path, type} の配列
 */
function apiListFiles() {
  var rows = dbReadAll('files');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      fileId: rows[i].fileId,
      path: rows[i].path,
      type: rows[i].type,
    });
  }
  out.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
  return out;
}

/**
 * ファイルのライブHTMLとメタ情報を返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {{html:string, name:string, url:string, path:string}}
 */
function apiGetFileHtml(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');

  var file = DriveApp.getFileById(fileId);
  return {
    html: liveHtml(fileId),
    name: file.getName(),
    url: file.getUrl(),
    path: row.path,
  };
}

/**
 * ファイルを管理対象に登録する (Web App API)。
 *
 * @param {string} fileId
 * @param {string} path
 * @returns {object}
 */
function apiRegisterFile(fileId, path) {
  return repoRegisterFile(fileId, path);
}

/**
 * 動作確認用のfileIdをスクリプトプロパティから読む。
 *
 * @returns {string}
 */
function debugFileId_() {
  var fileId = PropertiesService.getScriptProperties().getProperty('DEBUG_FILE_ID');
  if (!fileId) {
    throw new Error(
      'スクリプトプロパティ DEBUG_FILE_ID にテスト用DocのfileIdを設定してください'
    );
  }
  return fileId;
}

/**
 * DEBUG_FILE_ID のファイルを管理対象に登録する (動作確認用)。
 * パスは省略時にファイル名を使う。
 *
 * @returns {object} 登録された files 行
 */
function debugRegisterFile() {
  var fileId = debugFileId_();
  var path = PropertiesService.getScriptProperties().getProperty('DEBUG_FILE_PATH')
    || DriveApp.getFileById(fileId).getName();
  var row = repoRegisterFile(fileId, path);
  Logger.log('登録しました: ' + JSON.stringify(row));
  return row;
}

/**
 * レンダラの動作確認用。GASエディタから実行し、ログで出力を確認する。
 *
 * 使い方: DEBUG_FILE_ID にテスト用DocのfileIdを設定してから実行する。
 *
 * @returns {string} 正規化HTML
 */
function debugRenderDoc() {
  var html = renderDoc(debugFileId_());
  Logger.log(html);
  return html;
}

/**
 * ライブキャッシュの動作確認用。1回目(レンダリング)と2回目(キャッシュ)の
 * 所要時間を比較する。
 */
function debugLiveHtml() {
  var fileId = debugFileId_();

  var t1 = new Date().getTime();
  var a = liveHtml(fileId);
  var t2 = new Date().getTime();
  var b = liveHtml(fileId);
  var t3 = new Date().getTime();

  Logger.log('1回目(レンダリング): ' + (t2 - t1) + 'ms');
  Logger.log('2回目(キャッシュ):   ' + (t3 - t2) + 'ms');
  Logger.log('内容が一致: ' + (a === b));
  Logger.log('長さ: ' + a.length);
  Logger.log('--- HTML ---');
  Logger.log(a);
}

/**
 * 1つのプローブを実行し、成功値かエラーメッセージをログに出す。
 *
 * @param {string} label
 * @param {function} fn
 */
function probe_(label, fn) {
  try {
    Logger.log('    ' + label + ' => OK: ' + fn());
  } catch (e) {
    Logger.log('    ' + label + ' => ERROR: ' + e.message);
  }
}

/**
 * 画像要素の診断。docExtractImages_ の getBlob() が
 * "Invalid argument: imageId" で落ちる原因を切り分けるために使う。
 *
 * メタデータが取れてバイト列だけ取れないのか、要素自体が壊れているのかを
 * 判別する。
 */
function debugInspectImages() {
  var body = DocumentApp.openById(debugFileId_()).getBody();
  var ET = DocumentApp.ElementType;
  var n = body.getNumChildren();
  Logger.log('body の子要素数: ' + n);

  var found = 0;
  for (var i = 0; i < n; i++) {
    var el = body.getChild(i);
    var t = el.getType();
    if (t !== ET.PARAGRAPH && t !== ET.LIST_ITEM) continue;

    var para = (t === ET.PARAGRAPH) ? el.asParagraph() : el.asListItem();

    // 段落に紐づく PositionedImage (テキスト折り返し配置の画像)
    var positioned = para.getPositionedImages();
    if (positioned && positioned.length) {
      found++;
      Logger.log('body[' + i + '] PositionedImage が ' + positioned.length + ' 個');
      var pimg = positioned[0];
      probe_('positioned.getId()', function () { return pimg.getId(); });
      probe_('positioned.getBlob().getContentType()', function () {
        return pimg.getBlob().getContentType();
      });
      probe_('positioned.getBlob().getBytes().length', function () {
        return pimg.getBlob().getBytes().length;
      });
    }

    var cn = para.getNumChildren();
    for (var j = 0; j < cn; j++) {
      var child = para.getChild(j);
      var ct = child.getType();
      if (ct !== ET.INLINE_IMAGE && ct !== ET.INLINE_DRAWING) continue;

      found++;
      Logger.log('body[' + i + '] child[' + j + '] type=' + ct);

      if (ct === ET.INLINE_DRAWING) {
        Logger.log('    → INLINE_DRAWING (図形描画)。getBlob() は存在しない');
        continue;
      }

      var img = child.asInlineImage();
      probe_('getWidth()', function () { return img.getWidth(); });
      probe_('getHeight()', function () { return img.getHeight(); });
      probe_('getAltTitle()', function () { return img.getAltTitle(); });
      probe_('getAltDescription()', function () { return img.getAltDescription(); });
      probe_('getLinkUrl()', function () { return img.getLinkUrl(); });
      probe_('getBlob().getContentType()', function () {
        return img.getBlob().getContentType();
      });
      probe_('getBlob().getBytes().length', function () {
        return img.getBlob().getBytes().length;
      });
    }
  }

  if (found === 0) Logger.log('画像要素が1つも見つかりませんでした');
  Logger.log('--- 診断終了 ---');
}
