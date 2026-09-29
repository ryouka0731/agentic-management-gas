/**
 * 手元から動かすための道具を配る。
 *
 * 画面を開かずに操作したい人のために、命令のファイルを置くだけの小さな
 * 道具一式を zip にして渡す。中身はこの Apps Script の中に置いてあるので、
 * 配る側が別のリポジトリを管理しなくてよい。
 */

/**
 * 配るものの版。中身を変えたら上げる。
 *
 * 版が同じなら作り直さず、前に作った zip をそのまま渡す。
 *
 * @returns {string}
 */
function AGENT_KIT_VERSION() {
  return '1.2.0';
}

/**
 * zip の置き場を返す。無ければ作る。
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function agentKitFolder_() {
  var git = DriveApp.getFolderById(repoConfig().gitId);
  var found = git.getFoldersByName('kit');

  return found.hasNext() ? found.next() : git.createFolder('kit');
}

/**
 * 配る zip を作る。
 *
 * @returns {GoogleAppsScript.Drive.File}
 */
function agentKitBuild_() {
  var files = KIT_FILES();
  var blobs = [];

  for (var name0 in files) {
    if (!Object.prototype.hasOwnProperty.call(files, name0)) continue;

    // base64 のまま持っている。中身をそのまま HTML ファイルとして置くと
    // `<id>` がタグと解釈され、`-->` がコメントの終わりと読まれて壊れる
    blobs.push(Utilities.newBlob(
      Utilities.base64Decode(files[name0]), 'text/plain', name0));
  }

  var name = 'softbanto-agent-kit-' + AGENT_KIT_VERSION() + '.zip';
  var zip = Utilities.zip(blobs, name);
  var folder = agentKitFolder_();

  // 古いものは名前が違っても片付ける。残しておくと、前に配ったリンクから
  // 壊れていたころの中身が落ち続ける
  var old = [];
  var it = folder.getFiles();
  while (it.hasNext()) old.push(it.next());

  for (var i = 0; i < old.length; i++) {
    if (old[i].getName() === name) continue;
    if (!/-agent-kit-.*\.zip$/.test(old[i].getName())) continue;

    old[i].setTrashed(true);
  }

  var same = folder.getFilesByName(name);
  while (same.hasNext()) same.next().setTrashed(true);

  var file = folder.createFile(zip);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file;
}

/**
 * 配る zip を返す。無ければ作る。
 *
 * @returns {{name:string, url:string, version:string}}
 */
function agentKitFile() {
  var name = 'softbanto-agent-kit-' + AGENT_KIT_VERSION() + '.zip';
  var found = agentKitFolder_().getFilesByName(name);
  var file = found.hasNext() ? found.next() : agentKitBuild_();
  var queue = commandQueueFolder_();

  return {
    name: name,
    version: AGENT_KIT_VERSION(),
    url: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    // 設定に書く場所を当てさせない。ここがいちばん詰まる
    queuePath: agentKitPathOf_(queue),
    queueUrl: 'https://drive.google.com/drive/folders/' + queue.getId(),
  };
}

/**
 * そのフォルダまでの道のりを、人が読める形で返す。
 *
 * 手元の設定に書くのは「同期したフォルダのどこにあるか」である。
 * 当てさせると必ず詰まるので、画面から見せる。
 *
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @returns {string} 例: マイドライブ/社内システム/agentic-management/.git/queue
 */
function agentKitPathOf_(folder) {
  var parts = [folder.getName()];
  var cur = folder;

  // 深さは知れているが、壊れた木で回り続けないよう上限を置く
  for (var i = 0; i < 12; i++) {
    var parents = cur.getParents();
    if (!parents.hasNext()) break;

    cur = parents.next();
    parts.unshift(cur.getName());
  }
  return parts.join('/');
}
