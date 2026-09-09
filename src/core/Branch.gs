/**
 * ブランチ名を検証する。
 *
 * shell の glob ではなくアンカー付き正規表現を使う。日本語も許可するが、
 * Drive のフォルダ名として使えない文字とパス区切りは禁止する。
 *
 * @param {string} name
 * @returns {boolean}
 */
function branchNameValid_(name) {
  // 区切り文字と制御文字だけを断る。空白や括弧まで断ると、人が普通に
  // 付けたい名前 (「第7条の見直し (法務確認あり)」など) が通らない
  return /^[^\/\\\n\r\t]{1,80}$/.test(String(name || ''));
}

/**
 * ブランチ上での作業コピーの論理パスを作る。
 *
 * @param {string} name ブランチ名
 * @param {string} mainPath main上の論理パス
 * @returns {string}
 */
function branchPath_(name, mainPath) {
  return 'branches/' + name + '/' + mainPath;
}

/**
 * ブランチ一覧を返す。
 *
 * @returns {object[]} branches 行
 */
function branchList() {
  return dbReadAll('branches');
}

/**
 * ブランチ上の作業コピーの fileId を返す。
 *
 * @param {string} name ブランチ名
 * @param {string} mainFileId main上の fileId
 * @returns {string|null}
 */
function branchWorkingFileId(name, mainFileId) {
  var mainRow = dbFindOne('files', 'fileId', mainFileId);
  if (!mainRow) return null;
  var row = dbFindOne('files', 'path', branchPath_(name, mainRow.path));
  return row ? row.fileId : null;
}

/**
 * ブランチを作成し、対象ファイルの作業コピーを作る。
 *
 * baseSha には分岐時点の main HEAD を記録する。これが3-way merge の
 * base になるため、正確に記録することが最も重要である。
 *
 * @param {string} name ブランチ名
 * @param {string} fileId main上の対象ファイル
 * @returns {object} 作成された branches 行
 */
function branchCreate(name, fileId) {
  if (!branchNameValid_(name)) {
    throw new Error(
      '名前に使えない文字が含まれています (/ と \\ は使えません): ' + name
    );
  }
  if (dbFindOne('branches', 'name', name)) {
    throw new Error('同名のブランチが既に存在します: ' + name);
  }

  var mainRow = dbFindOne('files', 'fileId', fileId);
  if (!mainRow) throw new Error('管理対象に登録されていません: ' + fileId);
  if (String(mainRow.path).indexOf('branches/') === 0) {
    throw new Error('ブランチの作業コピーからは分岐できません。mainのファイルを選んでください');
  }

  var head = headCommit(fileId, 'main');

  if (!head) {
    /*
     * 一度も記録していない文書から分岐しようとしている。
     *
     * main は保護されていて人の手では記録できないため、ここで断ると
     * 行き止まりになる (登録したばかりの文書は必ずこの状態になる)。
     * 分岐の基準として、いまの内容を最初の記録として残す。
     */
    head = commitFile(fileId, 'main', '最初の記録', null);
  }

  var branchesFolder = DriveApp.getFolderById(repoConfig().branchesId);
  var workFolder = branchesFolder.createFolder(name);

  var srcFile = DriveApp.getFileById(fileId);
  var copy = srcFile.makeCopy(srcFile.getName(), workFolder);

  var row = {
    name: name,
    headSha: head.sha,
    baseSha: head.sha,
    state: 'open',
    workingFolderId: workFolder.getId(),
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  };
  dbAppend('branches', row);

  // 作業コピーを管理対象に登録する。Wikiの一覧に現れ、閲覧・コミットできる
  dbAppend('files', {
    fileId: copy.getId(),
    path: branchPath_(name, mainRow.path),
    type: mainRow.type,
    registeredAt: new Date(),
    registeredBy: Session.getActiveUser().getEmail(),
  });

  // 分岐直後の状態を、そのブランチの最初のコミットとして記録する。
  // これによりブランチのHEADが常に存在し、差分計算の起点が明確になる。
  commitFile(copy.getId(), name, 'ブランチ ' + name + ' を作成', null);

  return row;
}

/**
 * ブランチを削除する。作業コピーのDocとフォルダはゴミ箱に入れる。
 *
 * main は削除できない。
 *
 * @param {string} name
 */
function branchDelete(name) {
  if (name === 'main') throw new Error('main ブランチは削除できません');

  var row = dbFindOne('branches', 'name', name);
  if (!row) throw new Error('ブランチが見つかりません: ' + name);

  var files = dbReadAll('files');
  var prefix = 'branches/' + name + '/';
  for (var i = 0; i < files.length; i++) {
    if (String(files[i].path).indexOf(prefix) !== 0) continue;
    try {
      DriveApp.getFileById(files[i].fileId).setTrashed(true);
    } catch (e) {
      Logger.log('作業コピーを削除できません: ' + e.message);
    }
  }

  try {
    DriveApp.getFolderById(row.workingFolderId).setTrashed(true);
  } catch (e2) {
    Logger.log('作業フォルダを削除できません: ' + e2.message);
  }

  dbUpdate('branches', 'name', name, { state: 'deleted' });
}

/**
 * 削除済みブランチ名の集合を返す。
 *
 * @returns {Object<string, boolean>}
 */
function branchDeletedNames() {
  var rows = dbReadAll('branches');
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].state) === 'deleted') out[String(rows[i].name)] = true;
  }
  return out;
}

/**
 * Wiki の一覧に出すファイル行を返す。
 *
 * 削除済みブランチの作業コピーは Drive 上ではゴミ箱に入っているため、
 * 一覧から隠す。ただし files 行そのものは消さない。消すと
 * branchWorkingFileId が解決できなくなり、そのブランチから作られた
 * マージ済み PR を二度と開けなくなる (prPreviewMerge が作業コピーを
 * 必要とするため)。
 *
 * @returns {object[]} files 行
 */
function filesVisibleInWiki() {
  var deleted = branchDeletedNames();
  var rows = dbReadAll('files');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var m = /^branches\/([^\/]+)\//.exec(String(rows[i].path || ''));
    if (m && deleted[m[1]]) continue;
    out.push(rows[i]);
  }
  return out;
}
