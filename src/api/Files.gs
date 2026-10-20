/*
 * 画面の API: 文書の登録と、道具全体の様子。
 */

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
  var active = currentEmail_();
  var effective = String(Session.getEffectiveUser().getEmail() || '');

  return {
    activeUser: active,
    effectiveUser: effective,
    sameUser: active !== '' && active === effective,
  };
}

/**
 * この Web アプリの URL を返す (Web App API)。全画面のリンクを作るのに使う。
 *
 * 画面は iframe の中で動くため `location` から自分の URL を知れない。
 * リンクに秘密は入れない (開いた人の権限で読むので、見られない人には何も出ない)。
 *
 * @returns {string}
 */
function apiAppUrl() {
  return plainText(ScriptApp.getService().getUrl());
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
    me: currentEmail_(),
    docs: docs,
    branches: openBranches,
    openIssues: openIssues,
    openPrs: openPrs,
    commits: dbReadAll('commits').length,
  };
}
