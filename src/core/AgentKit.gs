/**
 * 手元から動かすための道具を配る。
 *
 * 画面を開かずに操作したい人のために、命令のファイルを置くだけの小さな
 * 道具一式を zip にして渡す。中身はこの Apps Script の中に置いてあるので、
 * 配る側が別のリポジトリを管理しなくてよい。
 */

/**
 * 配る中身。GAS 上のファイル名 → zip の中の名前。
 *
 * @returns {Array<Array<string>>}
 */
function AGENT_KIT_FILES() {
  return [
    ['kit/agent.mjs', 'agent.mjs'],
    ['kit/package.json', 'package.json'],
    ['kit/agentkit.example.json', 'agentkit.example.json'],
    ['kit/README.md', 'README.md'],
    ['kit/AGENTS.md', 'AGENTS.md'],
    // Claude も Codex も、同じ内容を別の名前で読みに行く
    ['kit/AGENTS.md', 'CLAUDE.md'],
  ];
}

/**
 * 配るものの版。中身を変えたら上げる。
 *
 * 版が同じなら作り直さず、前に作った zip をそのまま渡す。
 *
 * @returns {string}
 */
function AGENT_KIT_VERSION() {
  return '1.0.0';
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
  var files = AGENT_KIT_FILES();
  var blobs = [];

  for (var i = 0; i < files.length; i++) {
    var text = HtmlService.createHtmlOutputFromFile(files[i][0]).getContent();
    blobs.push(Utilities.newBlob(text, 'text/plain', files[i][1]));
  }

  var name = 'agentic-management-agent-kit-' + AGENT_KIT_VERSION() + '.zip';
  var zip = Utilities.zip(blobs, name);
  var folder = agentKitFolder_();

  // 同じ名前の古いものは片付ける。増え続けると、どれが最新か分からない
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);

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
  var name = 'agentic-management-agent-kit-' + AGENT_KIT_VERSION() + '.zip';
  var found = agentKitFolder_().getFilesByName(name);
  var file = found.hasNext() ? found.next() : agentKitBuild_();

  return {
    name: name,
    version: AGENT_KIT_VERSION(),
    url: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
  };
}
