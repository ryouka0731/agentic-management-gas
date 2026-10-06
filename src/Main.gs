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
    .setTitle(APP_NAME())
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
  // 作り直すと、道具が空のリポジトリを指し、これまでの記録が見えなくなる。
  // 画面からも呼べる関数なので、初期化済みなら断る
  if (PropertiesService.getScriptProperties().getProperty(REPO_CONFIG_KEY())) {
    throw new Error('リポジトリは既に初期化されています');
  }
  return repoInit('agentic-management');
}

/**
 * このアプリの持ち主かを確かめる。違えば断る。
 *
 * **末尾が _ でない関数は、画面の google.script.run から直に呼べる。**
 * エディタで動かすつもりの関数 (debug* / setupCommandQueue) も例外ではない。
 * 今は持ち主しか開けない設定だが、executeAs: ME で共有すると、利用者の誰もが
 * 持ち主の権限で呼べる。自己承認の解禁などを塞ぐため、最初にこれを呼ぶ。
 */
function assertOwner_() {
  var me = String(Session.getActiveUser().getEmail() || '');
  var owner = repoOwnerEmail();
  if (!owner || !me || owner !== me) {
    throw new Error('この操作は、このアプリの持ち主だけが行えます');
  }
}

/**
 * 管理対象ファイルの一覧を返す (Web App API)。
 *
 * @returns {object[]} {fileId, path, type} の配列
 */
function apiListFiles() {
  var rows = filesVisibleInWiki();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      fileId: plainText(rows[i].fileId),
      path: plainText(rows[i].path),
      type: plainText(rows[i].type),
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
    path: plainText(row.path),
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
 * 正式版の入れ物にあって、まだ登録されていない文書を返す (Web App API)。
 *
 * 画面から登録できるようにするためのもの。ファイルの id を調べて
 * スクリプトプロパティに書かせるのは、この道具を使う人の仕事ではない。
 *
 * @returns {Array<{fileId:string, name:string, type:string, ok:boolean,
 *   why:string}>}
 */
function apiFoundFiles() {
  var known = {};
  var rows = dbReadAll('files');

  for (var i = 0; i < rows.length; i++) known[String(rows[i].fileId)] = true;

  var kinds = {};
  kinds[MimeType.GOOGLE_DOCS] = 'doc';
  kinds[MimeType.GOOGLE_SHEETS] = 'sheet';
  kinds[MimeType.GOOGLE_SLIDES] = 'slide';

  var out = [];
  var it = DriveApp.getFolderById(repoConfig().mainId).getFiles();

  while (it.hasNext() && out.length < 100) {
    var file = it.next();
    var id = file.getId();
    if (known[id]) continue;

    var type = kinds[file.getMimeType()] || '';
    out.push({
      fileId: id,
      name: file.getName(),
      type: type,
      ok: !!type,
      why: type ? '' : 'この形のファイルは扱えません',
    });
  }

  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return out;
}

/**
 * まとめて登録する (Web App API)。
 *
 * 1件ずつ止まると、1つの失敗で残りが登録されない。
 *
 * @param {string[]} fileIds
 * @returns {{added: object[], failed: object[]}}
 */
function apiRegisterFiles(fileIds) {
  var ids = fileIds || [];
  var added = [];
  var failed = [];

  for (var i = 0; i < ids.length; i++) {
    try {
      var file = DriveApp.getFileById(ids[i]);
      var row = repoRegisterFile(ids[i], file.getName());

      added.push({ fileId: String(row.fileId), path: String(row.path) });
    } catch (e) {
      failed.push({ fileId: String(ids[i]), error: e.message });
    }
  }
  return { added: added, failed: failed };
}

/**
 * 文書を管理から外す (Web App API)。
 *
 * **Drive のファイルも、これまでの記録も消さない。** 消すのは台帳の1行
 * だけで、登録し直せば履歴が戻る。だから持ち主だけに絞っていない。
 * 間違って登録した本人が直せないほうが困る。
 *
 * @param {string} fileId
 * @returns {{fileId:string, path:string, type:string}}
 */
function apiUnregisterFile(fileId) {
  return repoUnregisterFile(fileId);
}

/**
 * 正式版の入れ物を Drive で開く場所を返す (Web App API)。
 *
 * @returns {string}
 */
function apiMainFolderUrl() {
  return 'https://drive.google.com/drive/folders/' + repoConfig().mainId;
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
  assertOwner_();
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
  assertOwner_();
  var html = renderDoc(debugFileId_());
  Logger.log(html);
  return html;
}

/**
 * ライブキャッシュの動作確認用。1回目(レンダリング)と2回目(キャッシュ)の
 * 所要時間を比較する。
 */
function debugLiveHtml() {
  assertOwner_();
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
  assertOwner_();
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
  assertOwner_();
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
 * **判定そのものは持たない。** 同じことを2か所で書いていて、語彙が
 * 変わったときに直し漏れる形になっていた。分け方は `branchSplitPath_`
 * が唯一の定義である。
 *
 * @param {string} path
 * @returns {string}
 */
function branchOfPath_(path) {
  return branchSplitPath_(path).branch;
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
  assertNotProtected_(fileId);
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
      sha: plainText(rows[i].sha),
      parentSha: plainText(rows[i].parentSha),
      author: plainText(rows[i].author),
      message: plainText(rows[i].message),
      timestamp: plainDate(rows[i].timestamp),
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
      name: plainText(rows[i].name),
      headSha: plainText(rows[i].headSha),
      baseSha: plainText(rows[i].baseSha),
      state: plainText(rows[i].state),
      createdBy: plainText(rows[i].createdBy),
      createdAt: plainDate(rows[i].createdAt),
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
/**
 * 既にある改訂版に、もう1つ文書を足す (Web App API)。
 *
 * 1つの改訂で規程と細則の両方を直したいとき、別々の改訂版に分けると
 * 確認依頼も別々になり、片方だけ反映されうる。
 *
 * @param {string} name 改訂版の名
 * @param {string} fileId 正式版の側の fileId
 * @returns {{path:string, fileId:string}}
 */
function apiBranchAddFile(name, fileId) {
  var row = branchAddFile(name, fileId);
  return { path: plainText(row.path), fileId: plainText(row.fileId) };
}

/**
 * その改訂版に入っていない正式版の文書を返す (Web App API)。
 *
 * 足せるものだけを選ばせる。入っているものを選べてしまうと、押してから
 * 断られる
 *
 * @param {string} name
 * @returns {Array<{fileId:string, path:string, type:string}>}
 */
function apiBranchAddable(name) {
  var inBranch = {};
  var rows = branchFiles(name);

  for (var i = 0; i < rows.length; i++) {
    inBranch[branchSplitPath_(rows[i].path).path] = true;
  }

  var all = dbReadAll('files');
  var out = [];

  for (var k = 0; k < all.length; k++) {
    var parts = branchSplitPath_(all[k].path);
    if (parts.branch !== 'main') continue;
    if (inBranch[parts.path]) continue;
    // Slides は反映できないので、足しても確認依頼が出せない
    if (String(all[k].type) === 'slide') continue;

    out.push({
      fileId: plainText(all[k].fileId),
      path: plainText(parts.path),
      type: plainText(all[k].type),
    });
  }
  out.sort(function (x, y) { return x.path < y.path ? -1 : 1; });
  return out;
}

function apiBranchDelete(name) {
  // 作業コピーをゴミ箱に入れる。確認依頼の取り下げと同じく、作った本人か
  // 持ち主に絞る。頼まれた側が捨てられると、作った人の知らないうちに消える
  var row = dbFindOne('branches', 'name', name);
  var me = String(Session.getActiveUser().getEmail() || '');
  var owner = repoOwnerEmail();
  if (row && String(row.createdBy) !== me && !(owner && owner === me)) {
    throw new Error('改訂版を捨てられるのは、作った本人か、このアプリの持ち主だけです');
  }

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

  // 取り下げられるかはサーバが決める。画面で決めると、他人の依頼を
  // 自分のものだと名乗って取り下げられる
  var me = String(Session.getActiveUser().getEmail() || '');
  var owner = repoOwnerEmail();
  var isOwner = !!owner && String(owner) === me;

  for (var i = 0; i < rows.length; i++) {
    out.push({
      number: plainId(rows[i].number),
      title: plainText(rows[i].title),
      sourceBranch: plainText(rows[i].sourceBranch),
      targetBranch: plainText(rows[i].targetBranch),
      state: plainText(rows[i].state),
      author: plainText(rows[i].author),
      createdAt: plainDate(rows[i].createdAt),
      body: plainText(rows[i].body),
      reviewers: prReviewers(rows[i]),
      canClose: (isOwner || String(rows[i].author) === me) &&
        String(rows[i].state) !== 'merged' &&
        String(rows[i].state) !== 'closed',
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
function apiPrCreate(title, body, sourceBranch, mainFileId, targetBranch) {
  var row = prCreate(title, body, sourceBranch, mainFileId, targetBranch);
  return { number: row.number, title: row.title, targetBranch: row.targetBranch };
}

/**
 * PRのマージプレビューを返す (Web App API)。
 * 差分表示のため main HEAD とマージ結果の diff も返す。
 *
 * @param {number} number
 * @returns {object}
 */
function apiPrPreview(number) {
  var all = prPreviewAll(number);
  var files = [];

  for (var i = 0; i < all.files.length; i++) {
    var one = all.files[i];

    files.push({
      fileId: plainText(one.mainFileId),
      path: plainText(one.path),
      type: plainText(one.type),
      clean: !!one.clean,
      problems: one.problems,
      conflicts: one.conflicts,
      ops: diffHtml(one.oursHtml, linesToHtml_(one.lines)),
    });
  }

  /*
   * 変更セット全体の姿を上に、文書ごとの中身を下に返す。
   *
   * clean と problems は**全体の判断**である。どれか1つでも書き戻せなければ
   * その依頼は反映できないので、画面は文書ごとに押させてはならない。
   *
   * clean / problems / conflicts / ops は1文書だったころの形のまま残して
   * ある。画面を直すまでのあいだ、1つ目のぶんが従来どおり届く
   */
  var head = files.length ? files[0] : {
    clean: true, problems: [], conflicts: [], ops: [],
  };

  return {
    clean: all.clean,
    problems: all.problems,
    conflicts: head.conflicts,
    approvals: prApprovalCount(number),
    // 承認のあとに中身が変わって数えなくなった承認の数。押せない理由を言う
    staleApprovals: prStaleApprovalCount(number),
    ops: head.ops,
    files: files,
    // 証跡の数。中身は重いので、あるかどうかだけ先に渡す
    patchCount: prPatchRows(number).length,
    // 反映のときに添えてもらう。見比べたあとで進んでいないかを見分ける
    previewSha: prPreviewFingerprint(number),
  };
}

/**
 * 確認依頼にコードの変更を添える (Web App API)。
 *
 * **この道具はコードの版管理をしない。** 添えるのは「何が変わったのかを
 * 人が読んで決める」ための証跡である。反映されるのは文書だけで、コードは
 * 手元の git で進める。
 *
 * 手元で `git diff -- <path>` を走らせて送る。GAS 側では git のオブジェクトを
 * 読めない (loose object は raw deflate で、Apps Script には raw inflate が
 * 無い)。
 *
 * @param {number} number
 * @param {string} path リポジトリの中での道のり
 * @param {string} text unified diff の本文
 * @returns {{id:number, path:string, added:number, removed:number}}
 */
function apiPrPatchAdd(number, path, text) {
  var row = prPatchAdd(number, path, text);

  return {
    id: plainId(row.id),
    path: plainText(row.path),
    added: plainNumber(row.added),
    removed: plainNumber(row.removed),
  };
}

/**
 * 確認依頼に添えられたコードの変更を返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrPatches(number) {
  var rows = prPatches(number);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    out.push({
      id: plainId(rows[i].id),
      path: plainText(rows[i].path),
      added: plainNumber(rows[i].added),
      removed: plainNumber(rows[i].removed),
      by: plainText(rows[i].by),
      at: plainDate(rows[i].at),
      text: plainText(rows[i].text),
    });
  }
  return out;
}

/**
 * 添えたコードの変更を外す (Web App API)。
 *
 * @param {number} number
 * @param {number} id
 * @returns {{removed:number}}
 */
function apiPrPatchRemove(number, id) {
  return { removed: plainNumber(prPatchRemove(number, id)) };
}

/**
 * 手元の Claude に頼みごとを置く (Web App API)。
 *
 * **この道具から手元へ向かう唯一の経路である。** 外部 API は使わないので、
 * Drive の同期に乗せ、手元から取りに来てもらう。押すのではなく取りに来る形
 * なので、寝ている機械は起きない。
 *
 * @param {string} verb
 * @param {object} args
 * @param {object} [extra]
 * @returns {object}
 */
function apiOutboxAdd(verb, args, extra) {
  return outboxToPlain_(outboxAdd(verb, args || {}, extra || {}));
}

/**
 * 置かれている頼みごとを返す (Web App API)。
 *
 * @param {string} [state]
 * @returns {object[]}
 */
function apiOutboxList(state) {
  return outboxList(state || '');
}

/**
 * 頼めることの一覧を返す (Web App API)。
 *
 * 語彙を画面側に写さない。写すと、足したときに選べるのに置けない動詞が出る。
 *
 * @returns {Array<Array<string>>} [動詞, 見せる字]
 */
function apiOutboxVerbs() {
  var verbs = OUTBOX_VERBS();
  var out = [];

  for (var key in verbs) {
    if (!Object.prototype.hasOwnProperty.call(verbs, key)) continue;
    out.push([key, verbs[key].label]);
  }
  return out;
}

/**
 * まだ誰も取っていない頼みごとを取る (Web App API)。
 *
 * 取った印を付けてから返す。付けないと、2つの手元が同じ頼みごとを別々に
 * 進めて、同じ差分が2回添えられる。
 *
 * @param {number} [limit]
 * @returns {object[]}
 */
function apiOutboxTake(limit) {
  outboxReclaim(24, new Date());
  return outboxTake(limit);
}

/**
 * 頼みごとを終わったことにする (Web App API)。
 *
 * @param {number} id
 * @param {string} result
 * @returns {object}
 */
function apiOutboxDone(id, result) {
  return outboxDone(id, result);
}

/**
 * 頼みごとをできなかったことにする (Web App API)。
 *
 * @param {number} id
 * @param {string} reason
 * @returns {object}
 */
function apiOutboxFail(id, reason) {
  return outboxFail(id, reason);
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
 * コメントを書き直す (Web App API)。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function apiReviewEdit(id, body) {
  var row = reviewEdit(id, body);
  return { id: Number(row.id), body: String(row.body) };
}

/**
 * コメントを消す (Web App API)。
 *
 * @param {number} id
 * @returns {string}
 */
function apiReviewDelete(id) {
  reviewDelete(id);
  return 'コメントを消しました';
}

/**
 * 確認してもらう人を決める (Web App API)。
 *
 * @param {number} number
 * @param {string[]} emails
 * @returns {string[]} 決まった宛先
 */
function apiPrSetReviewers(number, emails) {
  return prReviewers(prSetReviewers(number, emails || []));
}

/**
 * 確認依頼を取り下げる (Web App API)。
 *
 * 改訂版は捨てない。取り下げるのは「いま反映してよいか尋ねること」で
 * あって、直した中身ではない。
 *
 * @param {number} number
 * @returns {object}
 */
function apiPrClose(number) {
  var pr = prClose(number);

  return {
    number: plainId(pr.number),
    state: plainText(pr.state),
    title: plainText(pr.title),
  };
}

/**
 * PRをマージする (Web App API)。
 *
 * @param {number} number
 * @param {string[]} choices
 * @returns {object}
 */
function apiPrMerge(number, choices, previewSha) {
  var row = prMerge(number, choices, previewSha || '');
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
  assertOwner_();
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

/**
 * 自己承認の許可を切り替える (検証用)。
 *
 * 1人で PoC を検証するときは承認者を確保できずマージまで到達できないため、
 * スクリプトプロパティ ALLOW_SELF_APPROVE を一時的に立てる。
 * 本番運用に移す前に必ず debugDisableSelfApprove() で戻すこと。
 *
 * @returns {string}
 */
function debugEnableSelfApprove() {
  assertOwner_();
  PropertiesService.getScriptProperties().setProperty('ALLOW_SELF_APPROVE', 'true');
  return '自己承認を許可しました (検証用)。検証後は debugDisableSelfApprove() で戻すこと';
}

/**
 * 自己承認の許可を取り消す。
 *
 * @returns {string}
 */
function debugDisableSelfApprove() {
  assertOwner_();
  PropertiesService.getScriptProperties().deleteProperty('ALLOW_SELF_APPROVE');
  return '自己承認を禁止に戻しました';
}

/**
 * いまどのワークスペースを見ているかを返す (Web App API)。
 *
 * 同じ道具を複数のワークスペースに置くと、画面だけでは見分けが付かず、
 * 別のところの文書を直してしまう。左上に出すために使う。
 *
 * @returns {{name:string, path:string, url:string}}
 */
function apiWorkspace() {
  return repoWorkspace();
}

/**
 * アプリが利用者を誰として認識しているかを返す (Web App API)。
 *
 * webapp.executeAs を ME に切り替える前に、別アカウントでこの値を
 * 確かめる必要がある。activeUser が空になる環境では、コミットの作者と
 * レビュアーがすべて空文字になり、自己承認の禁止が「全員が同一人物」
 * として誤作動する。
 *
 * @returns {{activeUser:string, effectiveUser:string, sameUser:boolean}}
 */
function apiWhoAmI() {
  var active = String(Session.getActiveUser().getEmail() || '');
  var effective = String(Session.getEffectiveUser().getEmail() || '');

  return {
    activeUser: active,
    effectiveUser: effective,
    sameUser: active !== '' && active === effective,
  };
}

/**
 * 文書のコミットをグラフとして返す (Web App API)。
 *
 * ブランチの作業コピーを選んでいても、その文書全体 (main + 全ブランチ) の
 * グラフを返す。ブランチごとの履歴が別々に見えると、どこから分岐して
 * どこで合流したのかが読めないため。
 *
 * @param {string} fileId
 * @returns {{rows: object[], laneCount: number, branches: string[]}}
 */
function apiCommitGraph(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');

  var mainPath = String(row.path).replace(/^branches\/[^\/]+\//, '');
  var mainRow = dbFindOne('files', 'path', mainPath);
  if (!mainRow) throw new Error('mainのファイルが見つかりません: ' + mainPath);

  var chains = [{
    name: 'main',
    baseSha: '',
    commits: commitHistory(mainRow.fileId, 'main'),
  }];

  var branches = dbReadAll('branches');
  for (var i = 0; i < branches.length; i++) {
    var name = String(branches[i].name);
    if (name === 'main') continue;
    if (String(branches[i].state) === 'deleted') continue;

    var workFileId = branchWorkingFileId(name, mainRow.fileId);
    if (!workFileId) continue;

    var commits = commitHistory(workFileId, name);
    if (!commits.length) continue;

    chains.push({
      name: name,
      baseSha: plainText(branches[i].baseSha),
      commits: commits,
    });
  }

  var rows = commitGraph(chains);

  // 画面に渡すため日時を文字列にする。Date のまま混ぜない
  var plain = [];
  for (var p = 0; p < rows.length; p++) {
    var r = rows[p];
    plain.push({
      sha: String(r.sha), parentSha: String(r.parentSha || ''),
      branch: String(r.branch), message: plainText(r.message),
      author: plainText(r.author),
      timestamp: plainDate(r.timestamp),
      lane: r.lane, activeLanes: r.activeLanes,
      fork: r.fork, forkLane: r.forkLane, merge: r.merge,
    });
  }

  var names = [];
  for (var k = 0; k < chains.length; k++) names.push(chains[k].name);

  return { rows: plain, laneCount: graphLaneCount(rows), branches: names };
}

/**
 * ブランチ上の未コミットの文書を返す (Web App API)。
 *
 * 一括コミットの対象を選ぶために使う。ファイルごとにレンダリングが
 * 走るため、対象が多いと時間がかかる。
 *
 * @param {string} branch
 * @returns {Array<{fileId:string, path:string, dirty:boolean}>}
 */
function apiDirtyFiles(branch) {
  var rows = filesVisibleInWiki();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (branchOfPath_(rows[i].path) !== String(branch)) continue;

    var status;
    try {
      status = fileStatus(rows[i].fileId, branch);
    } catch (e) {
      continue;
    }
    if (!status.dirty) continue;

    out.push({ fileId: rows[i].fileId, path: rows[i].path, dirty: true });
  }
  return out;
}

/**
 * 複数の文書を同じメッセージでまとめてコミットする (Web App API)。
 *
 * 1件の失敗で全体を止めない。どれが通ってどれが落ちたかを返す。
 * 途中で止めると「半分だけコミットされたが、どれが済んだのか
 * 分からない」状態になるため。
 *
 * @param {string[]} fileIds
 * @param {string} message
 * @returns {{committed: object[], failed: object[]}}
 */
function apiCommitMany(fileIds, message) {
  var ids = fileIds || [];
  if (!ids.length) throw new Error('対象が選ばれていません');

  var committed = [];
  var failed = [];

  for (var i = 0; i < ids.length; i++) {
    var row = dbFindOne('files', 'fileId', ids[i]);
    var path = row ? row.path : ids[i];

    try {
      assertNotProtected_(ids[i]);
      var commit = commitFile(ids[i], branchOfPath_(path), message, null);
      committed.push({ path: path, sha: commit.sha });
    } catch (e) {
      failed.push({ path: path, error: e.message });
    }
  }
  return { committed: committed, failed: failed };
}

/**
 * リポジトリ全体の状態を1つにまとめて返す (Web App API)。
 *
 * 初めて使う人に「何がいくつあり、どう繋がっているか」を一目で示すため。
 * 個別のAPIを何度も呼ばせない。
 *
 * @returns {{repo:string, docs:number, branches:number, openIssues:number,
 *            openPrs:number, commits:number}}
 */
function apiOverview() {
  var files = filesVisibleInWiki();
  var docs = 0;

  for (var i = 0; i < files.length; i++) {
    if (branchOfPath_(files[i].path) === 'main') docs++;
  }

  var branches = dbReadAll('branches');
  var openBranches = 0;
  for (var b = 0; b < branches.length; b++) {
    if (String(branches[b].name) === 'main') continue;
    if (String(branches[b].state) === 'open') openBranches++;
  }

  var pulls = dbReadAll('pulls');
  var openPrs = 0;
  for (var p = 0; p < pulls.length; p++) {
    var st = String(pulls[p].state);
    if (st === 'open' || st === 'approved') openPrs++;
  }

  var issues = dbReadAll('issues');
  var openIssues = 0;
  for (var q = 0; q < issues.length; q++) {
    if (String(issues[q].state) === 'open') openIssues++;
  }

  return {
    repo: APP_NAME(),
    me: String(Session.getActiveUser().getEmail() || ''),
    docs: docs,
    branches: openBranches,
    openIssues: openIssues,
    openPrs: openPrs,
    commits: dbReadAll('commits').length,
  };
}

// ===== Phase 4b: 編集と main のブランチ保護 =====

/**
 * mainのファイルに対する人間の直接操作を拒否する。
 *
 * PR経由の書き戻しは prMerge が commitFile / writeHtmlToDoc を直接呼ぶため
 * この検査を通らない。人間の操作だけを止める (GitHub の branch protection)。
 *
 * @param {string} fileId
 */
function assertNotProtected_(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');
  if (branchOfPath_(row.path) !== 'main') return;

  throw new Error(
    'mainは保護されています。ブランチを作って変更し、PRでマージしてください'
  );
}

/**
 * ファイルの内容を Markdown で返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {{markdown:string, branch:string, editable:boolean}}
 */
function apiGetMarkdown(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');

  var branch = branchOfPath_(row.path);
  var html = liveHtml(fileId);
  return {
    markdown: blocksToMd(parseBlocks(html)),
    branch: branch,
    editable: branch !== 'main',
    // 保存のときに添えてもらう。開いたあとで文書が直されたかを見分ける
    baseSha: sha256Hex(html),
  };
}

/**
 * Markdown を文書に書き戻す (Web App API)。コミットはしない。
 *
 * 保存後は「未コミットの変更あり」になる。Docsで編集した場合と挙動を揃える。
 *
 * @param {string} fileId
 * @param {string} markdown
 * @returns {{ok:boolean}}
 */
function apiSaveMarkdown(fileId, markdown, baseSha) {
  assertNotProtected_(fileId);

  /*
   * **開いたあとで文書が直されていたら、上書きしない。**
   *
   * 書き戻しは body.clear() で丸ごと置き換える。開いている間に同じ文書が
   * Docs で直されると、その人の編集が黙って消えていた。指紋を持たない
   * 呼び方 (コマンドキューの writeMarkdown など) はこれまでどおり通す。
   */
  if (baseSha && sha256Hex(liveHtml(fileId)) !== String(baseSha)) {
    throw new Error(
      '開いたあとで、この文書が直されています。いまの中身を読み込み直してから直してください');
  }


  var blocks = mdToBlocks(markdown);
  var problems = htmlWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('書き戻せません:\n' + problems.join('\n'));
  }

  writeHtmlToDoc(fileId, serializeBlocks(blocks));
  liveCacheInvalidate(fileId);
  // 続けて保存するときの指紋。書いた字ではなく、読み直した中身から取る
  return { ok: true, baseSha: sha256Hex(liveHtml(fileId)) };
}

/**
 * mainをDocs上で直接編集してしまった分を、専用のコミットとして退避する。
 *
 * mainは保護されているため通常のコミットができない。一方でマージは
 * 未コミットの変更があると拒否される。この2つが噛み合うと行き止まりに
 * なるため、逃げ道をここに1つだけ用意する (spec §5.6)。
 *
 * @param {string} fileId
 * @returns {object} 作成された commits 行
 */
function apiStashMainDrift(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');
  if (branchOfPath_(row.path) !== 'main') {
    throw new Error('mainのファイルにのみ使えます');
  }
  return commitFile(fileId, 'main', 'mainへの直接編集を退避', null);
}

/**
 * PRに付いたレビューとコメントを古い順で返す (Web App API)。
 *
 * reviews テーブルは Phase 2 から state に 'comment' を許している。
 * 会話のために新しいテーブルは要らない。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrReviews(number) {
  // 番号の列を足す前に書かれた行を先に埋める。空のままだと直せない
  reviewBackfillIds_();

  var rows = dbReadAll('reviews');
  var me = Session.getActiveUser().getEmail();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;
    // 日時は文字列にする。Date のまま返すと運べず、画面には null が届く
    out.push({
      id: plainNumber(rows[i].id),
      reviewer: plainText(rows[i].reviewer),
      state: plainText(rows[i].state),
      body: plainText(rows[i].body),
      at: plainDate(rows[i].at),
      editedAt: plainDate(rows[i].editedAt),
      // 直せるかどうかは画面では決められない。書いた本人かをここで見る
      canEdit: String(rows[i].reviewer) === String(me) &&
        String(rows[i].state) === 'comment' &&
        Number(rows[i].id) > 0,
    });
  }
  return out;
}

/**
 * PRのソースブランチのコミットを新しい順で返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrCommits(number) {
  var pr = prGet(number);
  // 変更セットの全部の文書を見る。本文の [target-file] だけを見ていたため、
  // 2つ目以降の文書の記録が出なかった
  var targets = prTargetFiles(pr);
  var out = [];

  for (var t = 0; t < targets.length; t++) {
    var workFileId = branchWorkingFileId(pr.sourceBranch, targets[t]);
    if (!workFileId) continue;

    var mainRow = dbFindOne('files', 'fileId', targets[t]);
    var path = mainRow ? branchSplitPath_(mainRow.path).path : '';
    var commits = commitHistory(workFileId, pr.sourceBranch);

    for (var i = 0; i < commits.length; i++) {
      out.push({
        sha: plainText(commits[i].sha),
        message: plainText(commits[i].message),
        author: plainText(commits[i].author),
        timestamp: plainDate(commits[i].timestamp),
        path: plainText(path),
      });
    }
  }

  // 文書をまたいで新しい順。同じ時刻なら文書ごとの並び (親をたどった順) を保つ
  if (targets.length > 1) {
    out.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0; });
  }
  return out;
}

// ===== Phase 3b: Issue と Projects の API =====

/**
 * issues の行を、画面に渡せる素の形にする。
 *
 * google.script.run は限られた型しか運べない。DBの行をそのまま返すと
 * 日時が Date のまま混ざり、変換に失敗して画面には null が届く。
 * 動いている apiPrList / apiBranchList と同じく、明示的に文字列へ直す。
 *
 * @param {object} row issues 行
 * @returns {object}
 */
function issueToPlain_(row) {
  return {
    number: plainId(row.number),
    title: plainText(row.title),
    body: plainText(row.body),
    state: plainText(row.state),
    // 空の行も「ふつう」として届く。画面側で空を場合分けしない
    priority: issuePriority(row),
    assignee: plainText(row.assignee),
    assignees: issueAssignees(row),
    labels: plainText(row.labels),
    linkedFileIds: plainText(row.linkedFileIds),
    linkedPr: plainNumber(row.linkedPr),
    createdAt: plainDate(row.createdAt),
    closedAt: plainDate(row.closedAt),
    // 時刻を持たない値。plainDate で ISO にすると、東京の0時が前日になる
    dueDate: plainDay(row.dueDate),
    startDate: plainDay(row.startDate),
    parent: plainNumber(row.parent),
    estimate: plainNumber(row.estimate),
    plannedHours: plainNumber(row.plannedHours),
    actualHours: plainNumber(row.actualHours),
    archivedAt: plainDate(row.archivedAt),
    daysLeft: row.archivedAt ? archiveDaysLeft(row.archivedAt, new Date()) : '',
    updatedAt: plainDate(row.updatedAt),
    staleDays: stalenessOf(row, new Date()).days,
    staleLevel: stalenessOf(row, new Date()).level,
  };
}

/**
 * Issue一覧を返す (Web App API)。
 *
 * @param {string} state 'open' | 'closed' | '' (空なら全件)
 * @returns {object[]}
 */
function apiIssueList(state) {
  var rows = issueList(state || null);
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(issueToPlain_(rows[i]));
  return out;
}

/**
 * Issueを作成し、Backlog に置く (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} linkedFileIds
 * @returns {object}
 */
function apiIssueCreate(title, body, linkedFileIds, labels, patch) {
  // 作ってすぐ直せばよい、では二度手間になる。作るときに入れられる
  // ものは、そのまま入れて1件にする
  var want = {};
  var any = false;

  if (patch && typeof patch === 'object') {
    var keys = ['assignee', 'startDate', 'dueDate', 'estimate',
      'plannedHours', 'actualHours', 'parent', 'priority'];

    for (var k = 0; k < keys.length; k++) {
      if (!Object.prototype.hasOwnProperty.call(patch, keys[k])) continue;
      if (patch[keys[k]] === '' || patch[keys[k]] === null) continue;

      want[keys[k]] = patch[keys[k]];
      any = true;
    }
  }

  // **作る前に確かめる。** 作ってから断ると、作られているのに失敗と出て、
  // 人がもう一度作り、同じものが2つ並ぶ
  if (any) issuePatchCheck(want);

  var issue = issueCreate(title, body, linkedFileIds || [], labels || '');
  projectPlace(issue.number, 'Backlog');

  if (any) issue = issueUpdate(issue.number, want);
  return issueToPlain_(issue);
}

/**
 * Issueを更新する (Web App API)。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object}
 */
function apiIssueUpdate(number, patch) {
  return issueToPlain_(issueUpdate(number, patch || {}));
}

/**
 * 優先度の選択肢を返す (Web App API)。
 *
 * 語彙を画面側に写さない。写すと、足したときにサーバと画面でずれ、
 * 選べるのに保存できない選択肢が出る。
 *
 * @returns {Array<Array<string>>} [値, 見せる字]
 */
function apiIssuePriorities() {
  return ISSUE_PRIORITIES();
}

/**
 * やることを完了にする (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueClose(number) {
  var row = issueClose(number, null);
  projectMoveIfExists_(number, 'Done');
  return issueToPlain_(row);
}

/**
 * inquiries の行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {object} [shared] 一覧で1回だけ求めたもの {me, owner, replies}
 * @returns {object}
 */
function inquiryToPlain_(row, shared) {
  // 一覧では持ち主と返信の数を先に1回だけ求めて渡す。1件ごとに求めると
  // 件数のぶん Drive と返信の表を読みに行き、報告が増えるほど遅くなる
  var me = shared ? shared.me : Session.getActiveUser().getEmail();
  var owner = shared ? shared.owner : inquiryOwner_();

  return {
    number: Number(row.number),
    kind: plainText(row.kind),
    kindLabel: INQUIRY_KINDS()[row.kind] || String(row.kind || ''),
    title: String(row.title || inquiryTitleOf_(row.body)),
    body: plainText(row.body),
    by: plainText(row.by),
    state: plainText(row.state),
    context: plainText(row.context),
    answer: plainText(row.answer),
    closedBy: plainText(row.closedBy),
    at: plainDate(row.at),
    answeredAt: plainDate(row.answeredAt),
    shots: inquiryShotLinks_(row),
    issueNumber: row.issueNumber === '' || row.issueNumber == null
      ? '' : Number(row.issueNumber),
    mine: String(row.by) === String(me),
    // 閉じられるかは画面では決められない。ここで決めて渡す
    canClose: String(row.by) === String(me) ||
      (!!owner && String(owner) === String(me)),
    replyCount: shared
      ? (shared.replies[String(Number(row.number))] || 0)
      : inquiryReplies(row.number).length,
  };
}

/**
 * inquiry_replies の行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {string} me
 * @returns {object}
 */
function inquiryReplyToPlain_(row, me) {
  var out = plainTalk(row, me, 'inquiryNumber');

  // 画像の添えは報告の返信にしか無い
  out.shots = inquiryShotLinks_(row);
  return out;
}

/**
 * 添えられた画像の見せ方を作る。
 *
 * 実体は Drive にある。画面には見るための URL だけを渡す。
 *
 * @param {object} row
 * @returns {Array<{id:string, url:string, thumb:string}>}
 */
function inquiryShotLinks_(row) {
  var ids = inquiryShotsOf(row);
  var out = [];

  for (var i = 0; i < ids.length; i++) {
    out.push({
      id: ids[i],
      url: 'https://drive.google.com/file/d/' + ids[i] + '/view',
      thumb: 'https://drive.google.com/thumbnail?id=' + ids[i] + '&sz=w800',
    });
  }
  return out;
}

/**
 * 報告を送る (Web App API)。
 *
 * @param {string} kind
 * @param {string} body
 * @param {string} context
 * @param {string[]} shots
 * @returns {object}
 */
function apiInquiryCreate(kind, body, context, shots) {
  return inquiryToPlain_(inquiryCreate(kind, body, context, shots));
}

/**
 * 報告を返す (Web App API)。
 *
 * 使う人どうしで話せるように、全員が全部を読める。同じところで
 * つまずいた人が先に答えを知っていることがあり、自分のぶんしか
 * 見えないと誰も助け合えない。
 *
 * @returns {object[]}
 */
function apiInquiryList() {
  var rows = inquiryList(null);
  var out = [];

  var shared = {
    me: Session.getActiveUser().getEmail(),
    owner: inquiryOwner_(),
    replies: {},
  };
  var replies = dbReadAll('inquiry_replies');
  for (var r = 0; r < replies.length; r++) {
    var key = String(Number(replies[r].inquiryNumber));
    shared.replies[key] = (shared.replies[key] || 0) + 1;
  }

  for (var i = 0; i < rows.length; i++) out.push(inquiryToPlain_(rows[i], shared));
  return out;
}

/**
 * 報告とそのやりとりを返す (Web App API)。
 *
 * @param {number} number
 * @returns {{inquiry: object, replies: object[]}}
 */
function apiInquiryThread(number) {
  var me = Session.getActiveUser().getEmail();
  var replies = inquiryReplies(number);
  var out = [];

  for (var i = 0; i < replies.length; i++) {
    out.push(inquiryReplyToPlain_(replies[i], me));
  }
  return { inquiry: inquiryToPlain_(inquiryGet(number)), replies: out };
}

/**
 * 報告に返信する (Web App API)。
 *
 * @param {number} number
 * @param {string} body
 * @param {string[]} shots
 * @returns {object}
 */
function apiInquiryReply(number, body, shots) {
  var me = Session.getActiveUser().getEmail();
  return inquiryReplyToPlain_(inquiryReply(number, body, shots), me);
}

/**
 * 返信を書き直す (Web App API)。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function apiInquiryReplyEdit(id, body) {
  var me = Session.getActiveUser().getEmail();
  return inquiryReplyToPlain_(inquiryReplyEdit(id, body), me);
}

/**
 * 返信を消す (Web App API)。
 *
 * @param {number} id
 * @returns {string}
 */
function apiInquiryReplyDelete(id) {
  inquiryReplyDelete(id);
  return '返信を消しました';
}

/**
 * 話を閉じる (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiInquiryClose(number) {
  return inquiryToPlain_(inquiryClose(number));
}

/**
 * 閉じた話を開け直す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiInquiryReopen(number) {
  return inquiryToPlain_(inquiryReopen(number));
}

/**
 * 自分あての知らせを返す (Web App API)。
 *
 * @param {number} [limit]
 * @returns {{items: object[], unread: number}}
 */
function apiNotifications(limit) {
  var me = Session.getActiveUser().getEmail();
  var rows = noticeList(me, limit || 30);
  var items = [];
  var unread = 0;

  for (var i = 0; i < rows.length; i++) {
    var read = rows[i].readAt ? new Date(rows[i].readAt) : null;
    if (!read) unread++;

    items.push({
      id: Number(rows[i].id),
      kind: String(rows[i].kind || ''),
      title: String(rows[i].title || ''),
      body: String(rows[i].body || ''),
      link: String(rows[i].link || ''),
      at: plainDate(rows[i].at),
      read: !!read,
    });
  }
  return { items: items, unread: unread };
}

/**
 * 知らせを読んだことにする (Web App API)。
 *
 * @param {number[]} [ids] 省略すると自分あてを全部
 * @returns {number}
 */
function apiNotificationsRead(ids) {
  return noticeMarkRead(ids || []);
}

/**
 * 報告の種類の一覧を返す (Web App API)。
 *
 * @returns {Array<{value:string, label:string}>}
 */
function apiInquiryKinds() {
  var kinds = INQUIRY_KINDS();
  var out = [];

  for (var key in kinds) {
    if (!Object.prototype.hasOwnProperty.call(kinds, key)) continue;
    out.push({ value: key, label: kinds[key] });
  }
  return out;
}

/**
 * Google ToDo との同期が使えるかを返す (Web App API)。
 *
 * @returns {{available: boolean, listId: string, lists: object[]}}
 */
function apiTasksState() {
  if (!tasksAvailable()) return { available: false, listId: '', lists: [] };

  var lists = [];
  try {
    lists = tasksLists();
  } catch (e) {
    return { available: false, listId: '', lists: [] };
  }
  return { available: true, listId: tasksChosenList(), lists: lists };
}

/**
 * 同期先の ToDo リストを選ぶ (Web App API)。
 *
 * @param {string} listId
 * @returns {string}
 */
function apiTasksChooseList(listId) {
  return tasksChooseList(listId);
}

/**
 * 自分の担当ぶんを ToDo と同期する (Web App API)。
 *
 * @returns {object}
 */
function apiTasksSync() {
  return tasksSyncMine();
}

/**
 * 工数を区切りごとに足し上げて返す (Web App API)。
 *
 * 足し上げはサーバ側で行い、**見てよい人のぶんしか返さない**。画面側で
 * 絞る形にすると、全員のぶんが端末まで届いてしまい、絞っているのは
 * 見た目だけになる。
 *
 * @param {string} unit 'week' | 'month' | 'quarter'
 * @param {string} basis 'due' | 'closed' | 'start'
 * @param {string} who 空なら見てよい人ぜんぶ
 * @returns {object}
 */
function apiTallyEffort(unit, basis, who) {
  var me = Session.getActiveUser().getEmail();
  var allowed = memberVisibleTo(me);

  // 担当が付いていないぶんは誰の数字でもない。全員に見せる
  allowed.push('(担当なし)');

  var target = String(who || '');
  if (target && allowed.indexOf(target) < 0) {
    throw new Error('その人の集計は見られません');
  }

  var rows = issueList(null);
  var plain = [];

  for (var i = 0; i < rows.length; i++) {
    var one = issueToPlain_(rows[i]);
    var who = one.assignees;

    if (!who.length) {
      plain.push(one);
      continue;
    }

    // 2人で持つ仕事は、頭数で割って数える。それぞれに全部を足すと、
    // 人ごとの合計を足しても全体の合計に戻らなくなる
    for (var w = 0; w < who.length; w++) {
      var part = {};
      for (var k in one) {
        if (Object.prototype.hasOwnProperty.call(one, k)) part[k] = one[k];
      }
      part.assignee = who[w];
      part.plannedHours = (Number(one.plannedHours) || 0) / who.length;
      part.actualHours = (Number(one.actualHours) || 0) / who.length;
      plain.push(part);
    }
  }

  // 全体の合計は誰でも見てよい。人ごとの内訳だけを絞る
  var res = tallyEffort(plain, { unit: unit, basis: basis });

  res.people = res.people.filter(function (p) {
    if (allowed.indexOf(p.who) < 0) return false;
    return !target || p.who === target;
  });

  for (var p = 0; p < res.periods.length; p++) {
    var kept = {};

    for (var name in res.periods[p].byPerson) {
      if (!Object.prototype.hasOwnProperty.call(res.periods[p].byPerson, name)) {
        continue;
      }
      if (allowed.indexOf(name) < 0) continue;
      if (target && name !== target) continue;

      kept[name] = res.periods[p].byPerson[name];
    }
    res.periods[p].byPerson = kept;
  }

  res.me = me;
  res.canSee = allowed;
  res.hidden = res.total.count - res.people.reduce(function (n, one) {
    return n + one.total.count;
  }, 0);
  return res;
}

/**
 * 集計で見てよい人を返す (Web App API)。
 *
 * @returns {{me:string, canSee:string[], isManager:boolean, canEdit:boolean}}
 */
function apiTallyScope() {
  var me = Session.getActiveUser().getEmail();
  var allowed = memberVisibleTo(me);

  return {
    me: me,
    canSee: allowed,
    isManager: allowed.length > 1,
    canEdit: !!repoOwnerEmail() && repoOwnerEmail() === me,
  };
}

/**
 * 上下関係の一覧を返す (Web App API)。
 *
 * @returns {Array<{email:string, manager:string}>}
 */
function apiMemberList() {
  var rows = memberList();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    out.push({
      email: String(rows[i].email),
      manager: String(rows[i].manager || ''),
      name: String(rows[i].name || ''),
    });
  }
  return out;
}

/**
 * 知っている人の名前をまとめて返す (Web App API)。
 *
 * @returns {Object<string,string>} メールアドレス → 名前
 */
function apiPeopleNames() {
  return memberNames(apiKnownPeople());
}

/**
 * 名前を覚えさせる (Web App API)。
 *
 * 自分の名前は自分で決められる。他人の名前は持ち主だけが変えられる。
 *
 * @param {string} email
 * @param {string} name
 * @returns {object}
 */
function apiPeopleSetName(email, name) {
  var me = Session.getActiveUser().getEmail();
  var owner = repoOwnerEmail();
  var who = String(email || '');

  if (who !== me && (!owner || owner !== me)) {
    throw new Error('他人の名前を変えられるのは、このアプリの持ち主だけです');
  }

  var row = memberSetName(who, name);
  return { email: String(row.email), name: String(row.name || '') };
}

/**
 * 上下関係を登録する (Web App API)。
 *
 * 誰でも書き換えられると、自分を上長にして他人の数字を覗ける。
 * このアプリの持ち主だけが触れる。
 *
 * @param {string} email
 * @param {string} manager
 * @returns {object}
 */
function apiMemberSet(email, manager, name) {
  var me = Session.getActiveUser().getEmail();
  var owner = repoOwnerEmail();

  if (!owner || owner !== me) {
    throw new Error('上下関係を変えられるのは、このアプリの持ち主だけです');
  }

  var row = memberSet(email, manager, name);
  return {
    email: String(row.email),
    manager: String(row.manager || ''),
    name: String(row.name || ''),
  };
}

/**
 * issue_comments の行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {string} me
 * @returns {object}
 */
function issueCommentToPlain_(row, me) {
  return plainTalk(row, me, 'issueNumber');
}

/**
 * やることのやりとりを返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiIssueComments(number) {
  var me = Session.getActiveUser().getEmail();
  var rows = issueComments(number);
  var out = [];

  for (var i = 0; i < rows.length; i++) out.push(issueCommentToPlain_(rows[i], me));
  return out;
}

/**
 * やることに書き込む (Web App API)。
 *
 * @param {number} number
 * @param {string} body
 * @returns {object}
 */
function apiIssueComment(number, body) {
  var me = Session.getActiveUser().getEmail();
  return issueCommentToPlain_(issueCommentAdd(number, body), me);
}

/**
 * 書き込みを直す (Web App API)。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function apiIssueCommentEdit(id, body) {
  var me = Session.getActiveUser().getEmail();
  return issueCommentToPlain_(issueCommentEdit(id, body), me);
}

/**
 * 書き込みを消す (Web App API)。
 *
 * @param {number} id
 * @returns {string}
 */
function apiIssueCommentDelete(id) {
  issueCommentDelete(id);
  return '書き込みを消しました';
}

/**
 * 下書きの一覧を返す (Web App API)。
 *
 * @returns {Array<{name:string, body:string, builtin:boolean, mine:boolean}>}
 */
function apiTemplateList() {
  var me = Session.getActiveUser().getEmail();
  var rows = templateList();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var builtin = rows[i].builtin === true || String(rows[i].builtin) === 'true';

    out.push({
      name: String(rows[i].name),
      body: String(rows[i].body || ''),
      builtin: builtin,
      mine: !builtin && String(rows[i].createdBy) === String(me),
    });
  }
  return out;
}

/**
 * 下書きを保存する (Web App API)。
 *
 * @param {string} name
 * @param {string} body
 * @returns {object}
 */
function apiTemplateSave(name, body) {
  var row = templateSave(name, body);
  return { name: String(row.name), body: String(row.body) };
}

/**
 * 下書きを消す (Web App API)。
 *
 * @param {string} name
 * @returns {string}
 */
function apiTemplateDelete(name) {
  templateDelete(name);
  return '下書き「' + name + '」を消しました';
}

/**
 * 手元から動かす道具の置き場を返す (Web App API)。
 *
 * @returns {{name:string, url:string, version:string}}
 */
function apiAgentKit() {
  return agentKitFile();
}

/**
 * 使われ方を記録する (Web App API)。
 *
 * 誰が押したかは受け取らないし、残さない。日と場所と回数だけを数える。
 *
 * @param {Array<{kind:string, target:string, count:number}>} rows
 * @returns {number}
 */
function apiUsageRecord(rows) {
  return usageRecord(rows || []);
}

/**
 * 使われ方をまとめて返す (Web App API)。
 *
 * @param {number} days
 * @param {string} [who] 空なら全員ぶん
 * @returns {object}
 */
function apiUsageSummary(days, who) {
  /*
   * 人ごとの数は、本人と部下のぶんだけ (工数の集計と同じ)。誰が何をどれだけ
   * 使ったかは個人の働き方そのものなので、上下関係の外には見せない。場所
   * ごとの合計は個人が写らないので、誰が見ても全員ぶん。
   */
  var me = Session.getActiveUser().getEmail();
  var allowed = memberVisibleTo(me);
  var target = String(who || '');
  if (target && allowed.indexOf(target) < 0) {
    throw new Error('その人の使われ方は見られません');
  }

  var res = usageSummary(days, null, target);
  res.byUser = res.byUser.filter(function (u) { return allowed.indexOf(u.who) >= 0; });
  return res;
}

/**
 * タグの一覧を返す (Web App API)。
 *
 * @returns {Array<{name:string, color:string, builtin:boolean}>}
 */
function apiTagList() {
  var rows = tagList();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    out.push({
      name: String(rows[i].name),
      color: String(rows[i].color || 'ink'),
      builtin: rows[i].builtin === true || String(rows[i].builtin) === 'true',
    });
  }
  return out;
}

/**
 * タグを作る (Web App API)。
 *
 * @param {string} name
 * @param {string} color
 * @returns {object}
 */
function apiTagCreate(name, color) {
  var row = tagCreate(name, color);
  return { name: String(row.name), color: String(row.color), builtin: false };
}

/**
 * タグを消す (Web App API)。
 *
 * @param {string} name
 * @returns {string}
 */
function apiTagDelete(name) {
  tagDelete(name);
  return 'タグ「' + name + '」を消しました';
}

/**
 * 使える色の一覧を返す (Web App API)。
 *
 * @returns {string[]}
 */
function apiTagColors() {
  return TAG_COLORS();
}

/**
 * 完了を取り消す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueReopen(number) {
  return issueToPlain_(issueReopen(number));
}

/**
 * やることを捨てる (Web App API)。
 *
 * すぐには消さず置き場に移す。取り違えても期限までなら戻せる。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueArchive(number) {
  return issueToPlain_(issueArchive(number));
}

/**
 * 捨てたやることを元に戻す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiIssueRestore(number) {
  return issueToPlain_(issueRestore(number));
}

/**
 * 捨てたやることを完全に消す (Web App API)。
 *
 * @param {number} number
 * @returns {string}
 */
function apiIssuePurge(number) {
  var row = issueGet(number);
  if (!row.archivedAt) throw new Error('先に捨ててから消してください: #' + number);

  issuePurge(number);
  return '#' + number + ' を完全に消しました';
}

/**
 * 置き場のやること一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiIssueArchivedList() {
  var rows = issueListArchived();
  var out = [];

  for (var i = 0; i < rows.length; i++) out.push(issueToPlain_(rows[i]));
  return out;
}

/**
 * 置き場を留め置く日数を返す (Web App API)。
 *
 * @returns {number}
 */
function apiArchiveKeepDays() {
  return ARCHIVE_KEEP_DAYS();
}

/**
 * 担当者になりうる人を返す (Web App API)。
 *
 * これまでに記録や確認をした人を集める。名簿を別に持たない。
 *
 * @returns {string[]}
 */
function apiKnownPeople() {
  var seen = {};
  var out = [];

  function add(email) {
    var v = String(email || '');
    if (!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  }

  add(Session.getActiveUser().getEmail());

  var commits = dbReadAll('commits');
  for (var i = 0; i < commits.length; i++) add(commits[i].author);

  var reviews = dbReadAll('reviews');
  for (var r = 0; r < reviews.length; r++) add(reviews[r].reviewer);

  var issues = dbReadAll('issues');
  for (var q = 0; q < issues.length; q++) {
    var who = issueAssignees(issues[q]);
    for (var w = 0; w < who.length; w++) add(who[w]);
  }

  // 名前や上下関係を登録した人は、まだ何もしていなくても名簿に入る
  var known = dbReadAll('members');
  for (var k = 0; k < known.length; k++) add(known[k].email);

  var talked = dbReadAll('issue_comments');
  for (var t = 0; t < talked.length; t++) add(talked[t].by);

  // 報告の場で名前を呼べるように、報告と返信を書いた人も名簿に入れる
  var reports = dbReadAll('inquiries');
  for (var n = 0; n < reports.length; n++) add(reports[n].by);

  var replies = dbReadAll('inquiry_replies');
  for (var m = 0; m < replies.length; m++) add(replies[m].by);

  out.sort();
  return out;
}

/**
 * Issueからブランチを作り、カードを In Progress に動かす (Web App API)。
 *
 * @param {number} number
 * @param {string} fileId
 * @returns {{name:string}}
 */
function apiIssueCreateBranch(number, fileId) {
  var branch = issueCreateBranch(number, fileId);
  projectMoveIfExists_(number, 'In Progress');
  return { name: branch.name };
}

/**
 * 文書に紐づく open Issue を返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {object[]}
 */
function apiIssuesForFile(fileId) {
  var rows = issuesForFile(fileId);
  var out = [];
  for (var i = 0; i < rows.length; i++) out.push(issueToPlain_(rows[i]));
  return out;
}

/**
 * カンバンボードを返す (Web App API)。
 *
 * @returns {Object<string, object[]>}
 */
function apiProjectBoard() {
  return projectBoard();
}

/**
 * カードを動かす (Web App API)。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @param {number} order
 * @returns {object}
 */
function apiProjectMove(issueNumber, column, order) {
  return projectMove(issueNumber, column, order);
}

/**
 * 直近の検証実行の記録を保存するスクリプトプロパティのキー。
 *
 * @returns {string}
 */
function LAST_VERIFY_RUN_KEY() {
  return 'lastVerifyRun';
}

/**
 * 直近の debugVerifyPhase2() が残した検証物を片付ける。
 *
 * 検証が失敗すると調査のために Doc・ブランチ・PR が残る。
 * 末尾アンダースコアの関数は GAS エディタの実行対象に出ないため、
 * 引数なしで呼べる入口をここに用意する。
 *
 * @returns {string}
 */
function debugCleanupLastVerify() {
  assertOwner_();
  var raw = PropertiesService.getScriptProperties().getProperty(LAST_VERIFY_RUN_KEY());
  if (!raw) return '片付ける検証物はありません';

  var run = JSON.parse(raw);
  debugCleanupVerify_(run.tag, run.mainFileId, run.workFileId, run.prNumber, run.issueNumber);
  PropertiesService.getScriptProperties().deleteProperty(LAST_VERIFY_RUN_KEY());
  return '検証物を片付けました: ' + raw;
}

/**
 * 指定した書き出しで始まる段落を探し、本文を置き換える。
 *
 * 検証ハーネスが Doc を機械的に編集するために使う。
 * 段落インデックスではなく本文の先頭一致で探すのは、レンダリング側の
 * 空段落の扱いに依存させないため。
 *
 * @param {string} fileId
 * @param {string} prefix 探す段落の先頭文字列
 * @param {string} newText 置き換える本文
 * @returns {boolean} 置き換えたら true
 */
function debugEditParagraph_(fileId, prefix, newText) {
  var doc = DocumentApp.openById(fileId);
  var paragraphs = doc.getBody().getParagraphs();
  var hit = false;

  for (var i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].getText().indexOf(prefix) !== 0) continue;
    paragraphs[i].setText(newText);
    hit = true;
    break;
  }

  doc.saveAndClose();
  liveCacheInvalidate(fileId);
  return hit;
}

/**
 * 検証で作った Doc・ブランチ・PR・メタDBの行を片付ける。
 *
 * @param {string} tag ブランチ名 兼 検証タグ
 * @param {string|null} mainFileId
 * @param {string|null} workFileId
 * @param {number|null} prNumber
 * @param {number|null} [issueNumber]
 */
function debugCleanupVerify_(tag, mainFileId, workFileId, prNumber, issueNumber) {
  // branchDelete は files 行を prefix で辿って作業コピーをゴミ箱に入れる。
  // workFileId が解決できなかった場合こそ呼ぶ必要があるため、
  // workFileId の有無で条件分岐してはいけない
  if (tag && dbFindOne('branches', 'name', tag)) {
    try {
      branchDelete(tag);
    } catch (e) {
      Logger.log('ブランチを削除できません: ' + e.message);
    }
  }
  if (workFileId) {
    dbDelete('files', 'fileId', workFileId);
    dbDelete('commits', 'fileId', workFileId);
  }
  if (tag) dbDelete('branches', 'name', tag);

  if (prNumber) {
    dbDelete('pulls', 'number', prNumber);
    dbDelete('reviews', 'prNumber', prNumber);
  }

  if (issueNumber) {
    dbDelete('issues', 'number', issueNumber);
    dbDelete('project_items', 'issueNumber', issueNumber);
  }

  if (mainFileId) {
    dbDelete('files', 'fileId', mainFileId);
    dbDelete('commits', 'fileId', mainFileId);
    try {
      DriveApp.getFileById(mainFileId).setTrashed(true);
    } catch (e2) {
      Logger.log('検証用Docを削除できません: ' + e2.message);
    }
  }
}

/**
 * 検証の間だけ自己承認を許し、終わったら元の設定に戻す。
 *
 * 検証ハーネスが「事前に debugEnableSelfApprove() を実行しておくこと」を
 * 人に強いていたが、忘れると承認の手前で必ず落ちて検証物が残る。
 * ハーネス自身が面倒を見る。
 *
 * @param {function} fn 検証本体
 * @returns {*} fn の戻り値
 */
function withSelfApprove_(fn) {
  var props = PropertiesService.getScriptProperties();
  var previous = props.getProperty('ALLOW_SELF_APPROVE');
  props.setProperty('ALLOW_SELF_APPROVE', 'true');

  try {
    return fn();
  } finally {
    if (previous === null) props.deleteProperty('ALLOW_SELF_APPROVE');
    else props.setProperty('ALLOW_SELF_APPROVE', previous);
  }
}

/**
 * Phase 2 の受け入れ検証をサーバ側で通しで実行する (計画書 Task 9 の Step 2/4)。
 *
 * 使い捨ての Doc を1つ作り、コンフリクトの発生 → 解決 → マージ →
 * main への書き戻し → 楽観的並行制御までを一度に確認する。
 * 既存の管理対象ファイルには一切触れない。
 *
 * 自己承認は検証の間だけ自動で許可し、終わったら元の設定に戻す。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyPhase2() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  var tag = 'verify-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  var mainFileId = null;
  var workFileId = null;
  var prNumber = null;

  try {
    // --- 使い捨ての検証用 Doc を作り、main に登録して初期コミットする ---
    var doc = DocumentApp.create('【Phase2検証】' + tag);
    mainFileId = doc.getId();
    var body = doc.getBody();
    body.appendParagraph('第1条 目的');
    body.appendParagraph('この文書は Phase 2 の自動検証のために作られた使い捨ての文書である。');
    body.appendParagraph('第2条 勤務時間');
    body.appendParagraph('始業は9時、終業は18時とする。');
    doc.saveAndClose();

    var file = DriveApp.getFileById(mainFileId);
    DriveApp.getFolderById(repoConfig().mainId).addFile(file);
    DriveApp.getRootFolder().removeFile(file);

    repoRegisterFile(mainFileId, tag + '.doc');
    liveCacheInvalidate(mainFileId);
    commitFile(mainFileId, 'main', '検証用ドキュメントの初期状態', null);
    check('検証用Docをmainに登録して初期コミットできた', !!headCommit(mainFileId, 'main'));

    // --- ブランチを作る (Doc の作業コピーができる) ---
    branchCreate(tag, mainFileId);
    workFileId = branchWorkingFileId(tag, mainFileId);
    check('ブランチの作業コピーが作られた', !!workFileId, String(workFileId));

    // --- 同じ行をブランチ側と main 側で別々に書き換える ---
    check(
      'ブランチ側の同一行を書き換えた',
      debugEditParagraph_(workFileId, '第2条', '第2条 勤務時間 (ブランチ側の変更)')
    );
    commitFile(workFileId, tag, 'ブランチ側で勤務時間を変更', null);

    check(
      'main側の同一行を書き換えた',
      debugEditParagraph_(mainFileId, '第2条', '第2条 勤務時間 (main側の変更)')
    );
    commitFile(mainFileId, 'main', 'main側で勤務時間を変更', null);

    // --- PR を作り、コンフリクトとして検出されることを確認する ---
    var pr = prCreate('検証PR ' + tag, '自動検証で作成', tag, mainFileId);
    prNumber = pr.number;

    var preview = prPreviewMerge(prNumber);
    check(
      '同一行の相反する変更がコンフリクトとして検出された',
      preview.clean === false && preview.conflicts.length >= 1,
      'clean=' + preview.clean + ' conflicts=' + preview.conflicts.length
    );

    // --- 取得不能な画像を含む書き戻しが拒否されることを確認する (Step 3 の中核) ---
    var imgProblems = htmlWriterValidate([{ type: 'image', sha: 'unavailable', alt: 'x' }]);
    check(
      '実体を取得できない画像は書き戻し検証で拒否される',
      imgProblems.length === 1 && imgProblems[0].indexOf('実体を取得できない画像') >= 0,
      imgProblems.join(' / ')
    );

    // --- 承認する (自己承認の許可が要る) ---
    withSelfApprove_(function () {
      prReview(prNumber, 'approve', '自動検証による承認');
    });
    check('承認が記録された', prApprovalCount(prNumber) >= 1);

    // --- ブランチ側を採用してマージする ---
    var shaBeforeMerge = headCommit(mainFileId, 'main').sha;
    var choices = [];
    for (var c = 0; c < preview.conflicts.length; c++) choices.push('theirs');
    prMerge(prNumber, choices);

    liveCacheInvalidate(mainFileId);
    var merged = renderDoc(mainFileId);
    check('mainにブランチ側の内容が書き戻された', merged.indexOf('ブランチ側の変更') >= 0);
    check('main側の内容は採用されていない', merged.indexOf('main側の変更') < 0);
    // getFileById(id).getId() === id は常に真なので検証にならない。
    // 確かめたいのは「別のDocに差し替わっていないこと」なので、
    // files 行が同じ fileId を指したままか、Doc が生きているかを見る
    var fileRow = dbFindOne('files', 'fileId', mainFileId);
    check('mainのファイル行が同じfileIdを指したままである',
      !!fileRow && String(fileRow.path) === tag + '.doc',
      fileRow ? String(fileRow.path) : '行なし');
    check('書き戻し先のDocがゴミ箱に入っていない',
      DriveApp.getFileById(mainFileId).isTrashed() === false);
    check('マージ後もmainの他の行が残っている', merged.indexOf('第1条 目的') >= 0);

    // --- 楽観的並行制御: 古い headSha でのコミットは拒否される ---
    debugEditParagraph_(mainFileId, '第1条', '第1条 目的 (並行制御の検証)');

    var rejected = '';
    try {
      commitFile(mainFileId, 'main', '古いHEADからのコミット', shaBeforeMerge);
    } catch (e3) {
      rejected = e3.message;
    }
    check('古いHEADでのコミットが拒否された',
      rejected.indexOf('HEADが進んでいます') >= 0, rejected);

    var accepted = true;
    var acceptedMsg = '';
    try {
      commitFile(mainFileId, 'main', '最新HEADからのコミット',
        headCommit(mainFileId, 'main').sha);
    } catch (e4) {
      accepted = false;
      acceptedMsg = e4.message;
    }
    check('最新HEADでのコミットは成功する', accepted, acceptedMsg);
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  PropertiesService.getScriptProperties().setProperty(
    LAST_VERIFY_RUN_KEY(),
    JSON.stringify({ tag: tag, mainFileId: mainFileId, workFileId: workFileId, prNumber: prNumber })
  );

  if (failed === 0) {
    debugCleanupVerify_(tag, mainFileId, workFileId, prNumber);
    PropertiesService.getScriptProperties().deleteProperty(LAST_VERIFY_RUN_KEY());
    log.push('検証物を片付けました (Doc・ブランチ・PR・メタDBの行)');
  } else {
    log.push(
      '失敗したため検証物を残しました: doc=' + mainFileId +
      ' branch=' + tag + ' pr=' + prNumber +
      ' — 調査後に debugCleanupLastVerify() を実行して片付けること'
    );
  }

  var summary = (failed === 0)
    ? 'すべて PASS (' + log.length + '行)'
    : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}

/**
 * Phase 3b の受け入れ検証をサーバ側で通しで実行する。
 *
 * 使い捨ての Doc を1つ作り、Issue作成 → ボード配置 → ブランチ作成 →
 * PR作成 → 承認 → マージ までを実行して、Issueのクローズとカードの
 * 自動移動を判定する。既存の管理対象ファイルには触れない。
 *
 * 自己承認は検証の間だけ自動で許可し、終わったら元の設定に戻す。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyPhase3b() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  function columnOf(board, issueNumber) {
    var cols = PROJECT_COLUMNS();
    for (var i = 0; i < cols.length; i++) {
      for (var j = 0; j < board[cols[i]].length; j++) {
        if (Number(board[cols[i]][j].issueNumber) === Number(issueNumber)) return cols[i];
      }
    }
    return '(未配置)';
  }

  var tag = 'verify3b-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  var mainFileId = null;
  var branchName = null;
  var prNumber = null;
  var issueNumber = null;

  try {
    var doc = DocumentApp.create('【Phase3b検証】' + tag);
    mainFileId = doc.getId();
    doc.getBody().appendParagraph('第1条 目的');
    doc.saveAndClose();

    var file = DriveApp.getFileById(mainFileId);
    DriveApp.getFolderById(repoConfig().mainId).addFile(file);
    DriveApp.getRootFolder().removeFile(file);

    repoRegisterFile(mainFileId, tag + '.doc');
    liveCacheInvalidate(mainFileId);
    commitFile(mainFileId, 'main', '検証用ドキュメントの初期状態', null);

    // --- Issue を作ると Backlog に載る ---
    var issue = apiIssueCreate('第3条を追加する', '自動検証', [mainFileId]);
    issueNumber = issue.number;
    check('Issueを作るとBacklogに載る',
      columnOf(apiProjectBoard(), issueNumber) === 'Backlog',
      columnOf(apiProjectBoard(), issueNumber));

    check('文書に紐づくopen Issueとして引ける',
      apiIssuesForFile(mainFileId).length === 1);

    // --- Issue からブランチを作ると In Progress に動く ---
    var branch = apiIssueCreateBranch(issueNumber, mainFileId);
    branchName = branch.name;
    check('ブランチ名がissue-<番号>-<題名>になる',
      branchName === issueBranchName(issueNumber, issue.title), branchName);
    check('ブランチ作成でIn Progressに動く',
      columnOf(apiProjectBoard(), issueNumber) === 'In Progress',
      columnOf(apiProjectBoard(), issueNumber));

    // --- ブランチ側を編集してコミット ---
    var workFileId = branchWorkingFileId(branchName, mainFileId);
    debugEditParagraph_(workFileId, '第1条', '第1条 目的 (改訂)');
    commitFile(workFileId, branchName, 'ブランチ側の変更', null);

    // --- PR を作ると In Review に動く ---
    var pr = prCreate('第3条を追加する', 'closes #' + issueNumber, branchName, mainFileId);
    prNumber = pr.number;
    check('PR作成でIn Reviewに動く',
      columnOf(apiProjectBoard(), issueNumber) === 'In Review',
      columnOf(apiProjectBoard(), issueNumber));

    // --- マージすると Issue が閉じ、Done に動く ---
    withSelfApprove_(function () {
      prReview(prNumber, 'approve', '自動検証による承認');
    });
    prMerge(prNumber, []);

    check('マージでIssueがクローズされる', issueGet(issueNumber).state === 'closed');
    check('IssueにPR番号が記録される',
      Number(issueGet(issueNumber).linkedPr) === Number(prNumber));
    check('マージでDoneに動く',
      columnOf(apiProjectBoard(), issueNumber) === 'Done',
      columnOf(apiProjectBoard(), issueNumber));
    check('クローズ後は文書に紐づくopen Issueから消える',
      apiIssuesForFile(mainFileId).length === 0);
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  PropertiesService.getScriptProperties().setProperty(
    LAST_VERIFY_RUN_KEY(),
    JSON.stringify({
      tag: branchName,
      mainFileId: mainFileId,
      workFileId: branchName ? branchWorkingFileId(branchName, mainFileId) : null,
      prNumber: prNumber,
      issueNumber: issueNumber,
    })
  );

  if (failed === 0) {
    debugCleanupVerify_(
      branchName,
      mainFileId,
      branchName ? branchWorkingFileId(branchName, mainFileId) : null,
      prNumber,
      issueNumber
    );
    PropertiesService.getScriptProperties().deleteProperty(LAST_VERIFY_RUN_KEY());
    log.push('検証物を片付けました (Doc・ブランチ・PR・Issue・カード)');
  } else {
    log.push(
      '失敗したため検証物を残しました: doc=' + mainFileId +
      ' branch=' + branchName + ' pr=' + prNumber + ' issue=' + issueNumber +
      ' — 調査後に debugCleanupLastVerify() を実行して片付けること'
    );
  }

  var summary = (failed === 0) ? 'すべて PASS (' + log.length + '行)' : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}

/**
 * 実際の文書で Markdown の往復を確認する。
 *
 * 編集画面は「HTML → Markdown → 編集 → Markdown → HTML」と流れるため、
 * 何も編集しなければ元の HTML に戻らなければならない。戻らない場合、
 * 開いて保存しただけで差分が出る。
 *
 * DEBUG_FILE_ID に対象の fileId を設定してから実行する。
 *
 * @returns {string} 判定結果
 */
function debugMarkdownRoundTrip() {
  assertOwner_();
  var fileId = debugFileId_();
  var before = liveHtml(fileId);
  var md = blocksToMd(parseBlocks(before));
  var after = serializeBlocks(mdToBlocks(md));

  Logger.log('--- Markdown ---');
  Logger.log(md);

  if (before === after) {
    Logger.log('往復一致: OK — 開いて保存しても差分は出ません');
    return '往復一致: OK (' + before.length + '文字)';
  }

  Logger.log('往復不一致: 差分は以下のとおり');
  var ops = diffHtml(before, after);
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].type === 'equal') continue;
    Logger.log('  ' + (ops[i].type === 'insert' ? '+ ' : '- ') + ops[i].line);
  }
  return '往復不一致 — ログの差分を確認してください';
}

/**
 * コマンドキューの時間主導トリガーを設置する。
 *
 * GASエディタから1回実行する。同名のトリガーを先に消してから作るため、
 * 二度実行しても増えない。
 *
 * @returns {string}
 */
function setupCommandQueue() {
  assertOwner_();
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() !== 'processCommandQueue') continue;
    ScriptApp.deleteTrigger(triggers[i]);
    removed++;
  }

  ScriptApp.newTrigger('processCommandQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  var queueId = commandQueueFolder_().getId();
  Logger.log('キューのフォルダ: ' + queueId);

  return '1分間隔のトリガーを設置しました' +
    (removed ? ' (古いトリガーを' + removed + '件削除)' : '') +
    '。キューのフォルダID: ' + queueId;
}

/**
 * コマンドキューが実際に動くかを確かめる。
 *
 * 命令を1件置いて processCommandQueue() を呼び、結果を判定して片付ける。
 * トリガーの設置とは独立に、実行経路だけを確かめられる。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyCommandQueue() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
  }

  var id = 'verify-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  var queue = commandQueueFolder_();

  try {
    queue.createFile(
      id + '.cmd.json',
      JSON.stringify({ op: 'listFiles', args: {} }),
      MimeType.PLAIN_TEXT
    );
    check('命令ファイルを置けた', true);

    processCommandQueue();

    var it = queue.getFilesByName(id + '.result.json');
    check('結果ファイルが書き出された', it.hasNext());

    if (it.hasNext()) {
      var resultFile = it.next();
      var res = JSON.parse(resultFile.getBlob().getDataAsString('UTF-8'));
      check('命令が成功した', res.ok === true, res.error || '');
      check('管理対象の一覧が返った', !!res.result && res.result.length >= 0,
        res.result ? res.result.length + '件' : 'なし');
      resultFile.setTrashed(true);
    }

    var doneIt = commandDoneFolder_().getFilesByName(id + '.cmd.json');
    check('処理済みの命令が queue-done に移った', doneIt.hasNext());
    if (doneIt.hasNext()) doneIt.next().setTrashed(true);

    var leftover = queue.getFilesByName(id + '.cmd.json');
    check('未処理のキューに命令が残っていない', !leftover.hasNext());
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
  }

  var summary = (failed === 0) ? 'すべて PASS' : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}

/**
 * 検証ハーネスが残した Issue とカードを片付ける。
 *
 * debugVerifyPhase3b が作る Issue は題名と本文が固定されているため、
 * それで判別できる。issueNumber を記録していなかった時期の実行が
 * 残した分を掃除するために使う。
 *
 * @returns {string} 削除した件数
 */
function debugCleanupVerifyIssues() {
  assertOwner_();
  var rows = dbReadAll('issues');
  var removed = [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].title) !== '第3条を追加する') continue;
    if (String(rows[i].body) !== '自動検証') continue;

    var number = rows[i].number;
    dbDelete('issues', 'number', number);
    dbDelete('project_items', 'issueNumber', number);
    removed.push('#' + number);
  }

  if (!removed.length) return '片付ける検証用Issueはありません';
  return '検証用Issueを削除しました: ' + removed.join(', ');
}

/**
 * やることの保存状態を実測する。
 *
 * 「作ったのに一覧に出ない」が、保存されていないのか、読み出せて
 * いないのか、画面に描けていないのかを切り分けるために使う。
 *
 * @returns {string} 判定サマリ
 */
function debugDumpIssues() {
  assertOwner_();
  var log = [];

  try {
    var sheet = dbSheet_('issues');
    var cols = DB_SCHEMA().issues;

    log.push('スキーマの列数: ' + cols.length + ' [' + cols.join(', ') + ']');
    log.push('シートの最終行: ' + sheet.getLastRow() +
      ' / 列数: ' + sheet.getMaxColumns());

    var header = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
    log.push('見出し行: [' + header.join(', ') + ']');

    var raw = dbReadAll('issues');
    log.push('dbReadAll の件数: ' + raw.length);
    for (var i = 0; i < raw.length; i++) {
      log.push('  #' + raw[i].number + ' state=' + raw[i].state +
        ' title=' + raw[i].title +
        ' assignee=' + raw[i].assignee + ' due=' + raw[i].dueDate);
    }

    var listed = issueList(null);
    log.push('issueList(null) の件数: ' + listed.length);

    var api = apiIssueList('');
    log.push('apiIssueList("") の件数: ' + api.length);
    log.push('画面に渡る形: ' + JSON.stringify(api).substring(0, 400));

    var items = dbReadAll('project_items');
    log.push('カードの件数: ' + items.length);

    // 列がずれていないかを、値の形で確かめる
    var bad = [];
    for (var k = 0; k < raw.length; k++) {
      if (raw[k].createdAt === '' || raw[k].createdAt === null) {
        bad.push('#' + raw[k].number + ' の作成日時が空');
      }
      if (raw[k].dueDate && !/^\d{4}-\d{2}-\d{2}/.test(String(raw[k].dueDate)) &&
          Object.prototype.toString.call(raw[k].dueDate) !== '[object Date]') {
        bad.push('#' + raw[k].number + ' の期限が日付として読めない');
      }
    }
    log.push(bad.length ? '列のずれ: ' + bad.join(' / ') : '列のずれ: なし');
  } catch (e) {
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  Logger.log(log.join('\n'));
  return log.length + '行をログに出しました';
}

/**
 * 1日1回だけ置き場を片付ける。
 *
 * 命令キューの分刻みトリガーに相乗りする。トリガーを増やすと
 * 導入時にもう一度 setup を回してもらう必要が出るため、
 * 既に動いているものに載せて、日付でせき止める。
 *
 * @returns {number[]} 片付けた番号
 */
function housekeepArchiveDaily_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  if (props.getProperty('ARCHIVE_HOUSEKEPT_ON') === today) return [];

  props.setProperty('ARCHIVE_HOUSEKEPT_ON', today);
  return issueHousekeep(new Date());
}
