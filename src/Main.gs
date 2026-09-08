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
  var rows = filesVisibleInWiki();
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
  PropertiesService.getScriptProperties().setProperty('ALLOW_SELF_APPROVE', 'true');
  return '自己承認を許可しました (検証用)。検証後は debugDisableSelfApprove() で戻すこと';
}

/**
 * 自己承認の許可を取り消す。
 *
 * @returns {string}
 */
function debugDisableSelfApprove() {
  PropertiesService.getScriptProperties().deleteProperty('ALLOW_SELF_APPROVE');
  return '自己承認を禁止に戻しました';
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
  return {
    markdown: blocksToMd(parseBlocks(liveHtml(fileId))),
    branch: branch,
    editable: branch !== 'main',
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
function apiSaveMarkdown(fileId, markdown) {
  assertNotProtected_(fileId);

  var blocks = mdToBlocks(markdown);
  var problems = htmlWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('書き戻せません:\n' + problems.join('\n'));
  }

  writeHtmlToDoc(fileId, serializeBlocks(blocks));
  liveCacheInvalidate(fileId);
  return { ok: true };
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
  var rows = dbReadAll('reviews');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;
    out.push({
      reviewer: rows[i].reviewer,
      state: rows[i].state,
      body: rows[i].body,
      at: rows[i].at,
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
  var mainFileId = prTargetFileId_(pr.body);
  if (!mainFileId) return [];

  var workFileId = branchWorkingFileId(pr.sourceBranch, mainFileId);
  if (!workFileId) return [];

  var commits = commitHistory(workFileId, pr.sourceBranch);
  var out = [];
  for (var i = 0; i < commits.length; i++) {
    out.push({
      sha: commits[i].sha,
      message: commits[i].message,
      author: commits[i].author,
      timestamp: commits[i].timestamp,
    });
  }
  return out;
}

// ===== Phase 3b: Issue と Projects の API =====

/**
 * Issue一覧を返す (Web App API)。
 *
 * @param {string} state 'open' | 'closed' | '' (空なら全件)
 * @returns {object[]}
 */
function apiIssueList(state) {
  return issueList(state || null);
}

/**
 * Issueを作成し、Backlog に置く (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} linkedFileIds
 * @returns {object}
 */
function apiIssueCreate(title, body, linkedFileIds) {
  var issue = issueCreate(title, body, linkedFileIds || []);
  projectPlace(issue.number, 'Backlog');
  return issue;
}

/**
 * Issueを更新する (Web App API)。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object}
 */
function apiIssueUpdate(number, patch) {
  return issueUpdate(number, patch || {});
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
  return issuesForFile(fileId);
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
