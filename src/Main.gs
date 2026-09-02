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

// ===== Phase 2: コミット・ブランチ・PR の API =====

/**
 * 既存リポジトリに main ブランチ行が無い場合に補う (移行用)。
 * repoInit を実行済みの環境で1回だけ実行する。
 *
 * @returns {string} 実行結果
 */
function debugEnsureMainBranch() {
  if (dbFindOne('branches', 'name', 'main')) return 'main ブランチは既に存在します';
  dbAppend('branches', {
    name: 'main',
    headSha: '',
    baseSha: '',
    state: 'open',
    workingFolderId: repoConfig().mainId,
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  });
  return 'main ブランチを追加しました';
}

/**
 * 論理パスからブランチ名を判定する。
 * branches/<name>/... 形式なら <name>、そうでなければ 'main'。
 *
 * @param {string} path
 * @returns {string}
 */
function branchOfPath_(path) {
  var m = /^branches\/([^\/]+)\//.exec(String(path || ''));
  return m ? m[1] : 'main';
}

/**
 * ファイルの状態を返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {{dirty:boolean, headSha:string|null, branch:string}}
 */
function apiFileStatus(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');
  var branch = branchOfPath_(row.path);
  var st = fileStatus(fileId, branch);
  return { dirty: st.dirty, headSha: st.headSha, branch: branch };
}

/**
 * ファイルをコミットする (Web App API)。
 *
 * @param {string} fileId
 * @param {string} message
 * @param {string|null} expectedHeadSha
 * @returns {object}
 */
function apiCommit(fileId, message, expectedHeadSha) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');
  var commit = commitFile(fileId, branchOfPath_(row.path), message, expectedHeadSha);
  return { sha: commit.sha, message: commit.message };
}

/**
 * コミット履歴を返す (Web App API)。
 * Date は google.script.run で扱えないためISO文字列にする。
 *
 * @param {string} fileId
 * @returns {object[]}
 */
function apiCommitHistory(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');

  var rows = commitHistory(fileId, branchOfPath_(row.path));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      sha: rows[i].sha,
      parentSha: rows[i].parentSha,
      author: rows[i].author,
      message: rows[i].message,
      timestamp: new Date(rows[i].timestamp).toISOString(),
    });
  }
  return out;
}

/**
 * 2つのコミット間の差分を返す (Web App API)。
 * fromSha が空文字なら初回コミットとして扱う。
 *
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {object[]} diff ops
 */
function apiCommitDiff(fromSha, toSha) {
  var from = fromSha ? (commitHtml(fromSha) || '') : '';
  var to = commitHtml(toSha);
  if (to === null) throw new Error('コミットが見つかりません');
  return diffHtml(from, to);
}

/**
 * ブランチ一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiBranchList() {
  var rows = branchList();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].state) === 'deleted') continue;
    out.push({
      name: rows[i].name,
      headSha: rows[i].headSha,
      baseSha: rows[i].baseSha,
      state: rows[i].state,
      createdBy: rows[i].createdBy,
      createdAt: rows[i].createdAt ? new Date(rows[i].createdAt).toISOString() : '',
    });
  }
  return out;
}

/**
 * ブランチを作成する (Web App API)。
 *
 * @param {string} name
 * @param {string} fileId
 * @returns {object}
 */
function apiBranchCreate(name, fileId) {
  var row = branchCreate(name, fileId);
  return { name: row.name, baseSha: row.baseSha };
}

/**
 * ブランチを削除する (Web App API)。
 *
 * @param {string} name
 * @returns {string}
 */
function apiBranchDelete(name) {
  branchDelete(name);
  return name;
}

/**
 * PR一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiPrList() {
  var rows = prList();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      number: Number(rows[i].number),
      title: rows[i].title,
      sourceBranch: rows[i].sourceBranch,
      targetBranch: rows[i].targetBranch,
      state: rows[i].state,
      author: rows[i].author,
      createdAt: rows[i].createdAt ? new Date(rows[i].createdAt).toISOString() : '',
    });
  }
  out.sort(function (a, b) { return b.number - a.number; });
  return out;
}

/**
 * PRを作成する (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string} sourceBranch
 * @param {string} mainFileId
 * @returns {object}
 */
function apiPrCreate(title, body, sourceBranch, mainFileId) {
  var row = prCreate(title, body, sourceBranch, mainFileId);
  return { number: row.number, title: row.title };
}

/**
 * PRのマージプレビューを返す (Web App API)。
 * 差分表示のため main HEAD とマージ結果の diff も返す。
 *
 * @param {number} number
 * @returns {object}
 */
function apiPrPreview(number) {
  var preview = prPreviewMerge(number);
  var mergedHtml = linesToHtml_(preview.lines);

  return {
    clean: preview.clean,
    problems: preview.problems,
    conflicts: preview.conflicts,
    approvals: prApprovalCount(number),
    ops: diffHtml(preview.oursHtml, mergedHtml),
  };
}

/**
 * PRにレビューを記録する (Web App API)。
 *
 * @param {number} number
 * @param {string} state
 * @param {string} body
 * @returns {object}
 */
function apiPrReview(number, state, body) {
  var row = prReview(number, state, body);
  return { prNumber: row.prNumber, state: row.state };
}

/**
 * PRをマージする (Web App API)。
 *
 * @param {number} number
 * @param {string[]} choices
 * @returns {object}
 */
function apiPrMerge(number, choices) {
  var row = prMerge(number, choices);
  return { sha: row.sha, message: row.message };
}

/**
 * 書き戻しの往復検証。Phase 2 で最も重要な検証。
 *
 * Doc → HTML → Doc → HTML と往復させ、2つのHTMLが一致すれば
 * 書き戻しが情報を落としていないことになる。
 *
 * 破壊的操作を含むため、必ずブランチの作業コピーに対して実行すること。
 * DEBUG_WRITE_FILE_ID に対象を設定する。
 */
function debugWriteRoundTrip() {
  var fileId = PropertiesService.getScriptProperties()
    .getProperty('DEBUG_WRITE_FILE_ID');
  if (!fileId) {
    throw new Error(
      'スクリプトプロパティ DEBUG_WRITE_FILE_ID に、' +
      '書き戻してよい作業コピーのfileIdを設定してください'
    );
  }

  var before = renderDoc(fileId);
  Logger.log('書き戻し前の長さ: ' + before.length);

  var problems = htmlWriterValidate(parseBlocks(before));
  if (problems.length > 0) {
    Logger.log('検証で問題が見つかりました:\n' + problems.join('\n'));
    return;
  }

  writeHtmlToDoc(fileId, before);
  liveCacheInvalidate(fileId);

  var after = renderDoc(fileId);
  Logger.log('書き戻し後の長さ: ' + after.length);

  if (before === after) {
    Logger.log('往復一致: OK — 書き戻しは情報を落としていません');
    return;
  }

  Logger.log('往復不一致: 差分は以下のとおり');
  var ops = diffHtml(before, after);
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].type === 'equal') continue;
    Logger.log('  ' + (ops[i].type === 'insert' ? '+ ' : '- ') + ops[i].line);
  }
}
