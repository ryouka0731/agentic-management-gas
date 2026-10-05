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
 * `branchPath_` の逆。パスを「どの版の、どの文書か」に分ける。
 *
 * 作業コピーでなければ版の名は 'main' になる。**判定をあちこちで
 * 書き直さないこと。** `indexOf('branches/') === 0` を散らすと、
 * 語彙が変わったときに直し漏れる。
 *
 * @param {string} path
 * @returns {{branch:string, path:string}}
 */
function branchSplitPath_(path) {
  var text = String(path || '');
  if (text.indexOf('branches/') !== 0) return { branch: 'main', path: text };

  var at = text.indexOf('/', 'branches/'.length);
  if (at < 0) return { branch: 'main', path: text };

  return {
    branch: text.substring('branches/'.length, at),
    path: text.substring(at + 1),
  };
}

/**
 * ある文書の作業コピーを持っている版の名を返す。
 *
 * 管理から外すときに要る。作業コピーが残ったまま外すと、その版だけが
 * 宙に浮き、画面のどこからも辿れなくなる。
 *
 * @param {string} mainPath 正式版のパス
 * @returns {string[]} 版の名
 */
function branchesHolding(mainPath) {
  var rows = dbReadAll('files');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var parts = branchSplitPath_(rows[i].path);
    if (parts.branch === 'main') continue;
    if (parts.path !== String(mainPath)) continue;

    out.push(parts.branch);
  }
  return out;
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
/**
 * その改訂版に入っている文書を返す。
 *
 * 改訂版は**複数の文書を持てる**。1つの改訂で規程と細則の両方を直す、
 * というのが現実にあるためで、それを別々の改訂版に分けると確認依頼も
 * 別々になり、片方だけ反映されうる。
 *
 * @param {string} name
 * @returns {object[]} files 行 (作業コピーのほう)
 */
function branchFiles(name) {
  var rows = dbReadAll('files');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (branchSplitPath_(rows[i].path).branch !== String(name)) continue;
    out.push(rows[i]);
  }
  return out;
}

/**
 * その文書がどこから分かれたかを返す。
 *
 * **起点は文書ごとに違う。** 改訂版に2つ目の文書を足したとき、1つ目を
 * 足した時点より正式版が進んでいることがある。ブランチに1つだけ持たせて
 * いると、2つ目の起点が古すぎて「相手が消した」と読め、黙って消える。
 *
 * この列を足す前に作られた作業コピーは空なので、そのときだけ
 * `branches.baseSha` に落とす。
 *
 * @param {string} name 改訂版の名
 * @param {string} mainFileId 正式版の側の fileId
 * @returns {string} 起点のコミット sha
 */
function branchBaseSha(name, mainFileId) {
  var mainRow = dbFindOne('files', 'fileId', mainFileId);
  if (!mainRow) return '';

  var workRow = dbFindOne(
    'files', 'path', branchPath_(name, branchSplitPath_(mainRow.path).path));

  if (workRow && String(workRow.baseSha || '')) return String(workRow.baseSha);

  var branch = dbFindOne('branches', 'name', name);
  return String((branch && branch.baseSha) || '');
}

/**
 * 既にある改訂版に、もう1つ文書を足す。
 *
 * 足した時点の正式版を、その文書の起点として覚える。
 *
 * @param {string} name 改訂版の名
 * @param {string} fileId 正式版の側の fileId
 * @returns {object} 足した作業コピーの files 行
 */
function branchAddFile(name, fileId) {
  // あるか見てから書くので、鍵の中で行う。分けると、ほぼ同時の2件が
  // 「まだ無い」と読んで両方書き、先の1件しか引けない重なりができる
  return dbWithLock_(30000, function () {
    return branchAddFileLocked_(name, fileId);
  });
}

/**
 * branchAddFile の本体。鍵を持った状態で呼ばれる。
 */
function branchAddFileLocked_(name, fileId) {
  var branch = dbFindOne('branches', 'name', name);
  if (!branch) throw new Error('改訂版が見つかりません: ' + name);
  if (String(branch.state) !== 'open') {
    throw new Error('この改訂版は既に閉じられています: ' + name);
  }

  var mainRow = dbFindOne('files', 'fileId', fileId);
  if (!mainRow) throw new Error('管理対象に登録されていません: ' + fileId);
  if (branchSplitPath_(mainRow.path).branch !== 'main') {
    throw new Error('作業コピーは足せません。正式版の文書を選んでください');
  }

  var path = branchPath_(name, mainRow.path);
  if (dbFindOne('files', 'path', path)) {
    throw new Error('その文書はこの改訂版に入っています: ' + mainRow.path);
  }

  // 一度も記録していない文書から分かれると起点が無くなる。main は人の手では
  // 記録できないため、ここで断ると行き止まりになる
  var head = headCommit(fileId, 'main');
  if (!head) head = commitFile(fileId, 'main', '最初の記録', null);

  var workFolder = DriveApp.getFolderById(branch.workingFolderId);
  var srcFile = DriveApp.getFileById(fileId);
  var copy = srcFile.makeCopy(srcFile.getName(), workFolder);

  var row = {
    fileId: copy.getId(),
    path: path,
    type: mainRow.type,
    registeredAt: new Date(),
    registeredBy: Session.getActiveUser().getEmail(),
    baseSha: head.sha,
  };
  dbAppend('files', row);

  // 分かれた直後を最初の記録にする。これで差分の起点が常に存在する
  commitFile(copy.getId(), name, mainRow.path + ' を ' + name + ' に足した', null);
  return row;
}

function branchCreate(name, fileId) {
  // あるか見てから書くので、鍵の中で行う。分けると、ほぼ同時の2件が
  // 「まだ無い」と読んで両方書き、先の1件しか引けない重なりができる
  return dbWithLock_(30000, function () {
    return branchCreateLocked_(name, fileId);
  });
}

/**
 * branchCreate の本体。鍵を持った状態で呼ばれる。
 */
function branchCreateLocked_(name, fileId) {
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
  if (branchSplitPath_(mainRow.path).branch !== 'main') {
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
    // ブランチ側の baseSha は、この列を足す前に作られた改訂版のための
    // 落とし所として残してある。**起点は files.baseSha が本体である**
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
    baseSha: head.sha,
  });

  // 分岐直後の状態を、そのブランチの最初のコミットとして記録する。
  // これによりブランチのHEADが常に存在し、差分計算の起点が明確になる。
  commitFile(copy.getId(), name, '改訂版「' + name + '」を作成', null);

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

  // この版から出ている・この版へ向かう依頼が開いていたら捨てない。捨てても
  // 依頼は開いたまま残り、反映すると状態が deleted から merged に書き換わって
  // ゴミ箱の作業コピーが一覧に戻ってくる
  var pulls = dbReadAll('pulls');
  var open = [];
  for (var p = 0; p < pulls.length; p++) {
    var st = String(pulls[p].state);
    if (st !== 'open' && st !== 'approved') continue;
    if (String(pulls[p].sourceBranch) !== String(name) &&
        String(pulls[p].targetBranch || 'main') !== String(name)) continue;
    open.push('#' + pulls[p].number);
  }
  if (open.length) {
    throw new Error(
      'この改訂版には開いている確認依頼があります (' + open.join('、') + ')。' +
      '先に取り下げるか反映してから捨ててください');
  }

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
