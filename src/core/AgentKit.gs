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
  return '1.8.1';
}

/**
 * 配る中身の指紋。zip の名前と、手元の道具が古いかの判定に使う。
 *
 * **手元の道具 (kit/track/update.mjs の kitPrintOf) と同じ式でなければならない。**
 * 式が食い違うと、手元は毎日「新しい版がある」と読み、入れ替えを繰り返す。
 *
 * @returns {string} 16進8字
 */
function kitPrint_() {
  return sha256Hex(JSON.stringify(KIT_FILES())).substring(0, 8);
}

/**
 * 署名する文。**手元の道具 (kit/track/update.mjs の kitSignedText) と同じ字でなければならない。**
 *
 * 指紋は8字しか無いので、中身の sha256 を64字まるごと入れる。頭の
 * 'softbanto-kit/1' は、同じ鍵で別の物に付けた署名を流用させないため。
 *
 * @param {string} version
 * @param {Object<string,string>} files
 * @returns {string}
 */
function kitSignedText_(version, files) {
  return 'softbanto-kit/1\n' + String(version) + '\n' + sha256Hex(JSON.stringify(files));
}

/**
 * 配る中身の署名を返す。
 *
 * **番頭は署名を計算しない。** 秘密鍵は deploy する人の手元にだけあり、scripts/deploy.mjs が
 * 送る直前に署名して src/KitSigning.gs (KIT_SIGNATURE_。記録しない) に書く。スクリプトを開ける人
 * (共有ドライブならメンバー全員) が KIT_FILES を書き換えても、署名は合わない。
 *
 * 記録した版と中身の指紋が、いまの版と中身に**両方**合うときだけ返す。合わなければ空
 * (版を上げて署名し直さずに送ったとき)。手元の道具は、空の署名を自動では入れない。
 * 指紋は64字で比べる (kitPrint_ の8字では短すぎる)。
 *
 * @param {string} version
 * @param {Object<string,string>} files
 * @returns {string} base64
 */
function kitSignature_(version, files) {
  if (typeof KIT_SIGNATURE_ !== 'function') return '';
  var rec = KIT_SIGNATURE_() || {};
  if (String(rec.version) !== String(version)) return '';
  if (String(rec.filesSha) !== sha256Hex(JSON.stringify(files))) return '';
  return String(rec.signature || '');
}

/**
 * その人が持っている道具の指紋を覚える。
 *
 * **スクリプトプロパティに置く。** 手元の道具からの命令は持ち主のトリガーで
 * 走るため、そこから利用者本人の UserProperties には書けない。
 *
 * @param {string} email
 * @param {string} print
 */
function kitRemember_(email, print) {
  var who = String(email || '').toLowerCase();
  if (!who || !/^[0-9a-f]{8}$/.test(String(print || ''))) return;
  PropertiesService.getScriptProperties().setProperty('KIT_PRINT:' + who, String(print));
}

/**
 * その人の道具が古いか。
 *
 * まだ一度も落としていない人は古いことにしない (札を出しても落とす理由が分からない)。
 *
 * @param {string} email
 * @returns {{print:string, mine:string, outdated:boolean}}
 */
function kitStatus_(email) {
  var print = kitPrint_();
  var who = String(email || '').toLowerCase();
  var mine = who
    ? String(PropertiesService.getScriptProperties().getProperty('KIT_PRINT:' + who) || '')
    : '';
  return { print: print, mine: mine, outdated: mine !== '' && mine !== print };
}

/**
 * 配る zip の名前。
 *
 * **中身の指紋を名前に入れる。** 版だけで名前を決めていたため、kit/ を直して
 * AGENT_KIT_VERSION() を上げ忘れると、同じ名前の前の zip がそのまま配られ
 * 続けた。指紋が入っていれば、上げ忘れても中身が変われば作り直される。
 * 版は人が読むために残す。
 *
 * @returns {string}
 */
function agentKitName_() {
  var print = kitPrint_();
  return 'softbanto-agent-kit-' + AGENT_KIT_VERSION() + '-' + print + '.zip';
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

  var name = agentKitName_();
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
  var name = agentKitName_();
  var found = agentKitFolder_().getFilesByName(name);
  var file = found.hasNext() ? found.next() : agentKitBuild_();
  var queue = commandQueueFolder_();

  return {
    name: name,
    version: AGENT_KIT_VERSION(),
    url: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    // 設定に書く場所を当てさせない。ここがいちばん詰まる
    queuePath: repoFolderPath_(queue),
    queueUrl: 'https://drive.google.com/drive/folders/' + queue.getId(),
  };
}

