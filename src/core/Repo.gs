/**
 * リポジトリ設定を保存するPropertiesServiceのキー。
 *
 * @returns {string}
 */
function REPO_CONFIG_KEY() {
  return 'repoConfig';
}

/**
 * リポジトリのDriveレイアウトを作成し、設定をPropertiesServiceに保存する。
 * 初回セットアップ時にGASエディタから手動で1回だけ実行する。
 *
 * 作成される構造 (spec §3.1):
 *   <rootFolderName>/
 *   ├── main/
 *   ├── branches/
 *   └── .git/
 *       ├── objects/
 *       └── repo-db (スプレッドシート)
 *
 * @param {string} rootFolderName ルートフォルダ名
 * @returns {object} 保存された設定
 */
function repoInit(rootFolderName) {
  if (!/^[^\/\\]{1,100}$/.test(String(rootFolderName || ''))) {
    throw new Error('フォルダ名が不正です: ' + rootFolderName);
  }

  var root = repoParentFolder_().createFolder(rootFolderName);
  var main = root.createFolder('main');
  var branches = root.createFolder('branches');
  var git = root.createFolder('.git');
  var objects = git.createFolder('objects');

  var db = SpreadsheetApp.create(rootFolderName + ' repo-db');
  var dbFile = DriveApp.getFileById(db.getId());
  git.addFile(dbFile);
  DriveApp.getRootFolder().removeFile(dbFile);

  var config = {
    rootId: root.getId(),
    mainId: main.getId(),
    branchesId: branches.getId(),
    gitId: git.getId(),
    objectsId: objects.getId(),
    dbId: db.getId(),
  };

  PropertiesService.getScriptProperties()
    .setProperty(REPO_CONFIG_KEY(), JSON.stringify(config));

  // スキーマ定義済みのシートをすべて先に作っておく
  var schema = DB_SCHEMA();
  for (var table in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, table)) dbSheet_(table);
  }
  var sheet1 = db.getSheetByName('シート1') || db.getSheetByName('Sheet1');
  if (sheet1) db.deleteSheet(sheet1);

  // main ブランチをテーブルに登録する。これが無いと commitFile が
  // headSha を更新できない
  dbAppend('branches', {
    name: 'main',
    headSha: '',
    baseSha: '',
    state: 'open',
    workingFolderId: config.mainId,
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  });

  Logger.log('リポジトリを初期化しました: ' + JSON.stringify(config));
  return config;
}

/**
 * リポジトリを作る場所を返す。
 *
 * スクリプトと同じフォルダに作る。マイドライブの直下に作ると、他の
 * 書類に紛れるうえ、フォルダごと配って回すときに持ち出しにくい。
 *
 * スクリプトがどこにあるか分からないことがある (文書に紐づいた
 * スクリプトなど)。その場合はマイドライブの直下に落とす。作れないより
 * 場所が違うほうがまだよい。
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function repoParentFolder_() {
  try {
    var parents = DriveApp.getFileById(ScriptApp.getScriptId()).getParents();
    if (parents.hasNext()) return parents.next();
  } catch (e) {
    Logger.log('スクリプトの場所が分かりませんでした: ' + e.message);
  }
  return DriveApp.getRootFolder();
}

/**
 * 保存済みのリポジトリ設定を返す。未初期化ならエラーを投げる。
 *
 * @returns {{rootId:string, mainId:string, branchesId:string, gitId:string, objectsId:string, dbId:string}}
 */
function repoConfig() {
  var raw = PropertiesService.getScriptProperties().getProperty(REPO_CONFIG_KEY());
  if (!raw) {
    throw new Error('リポジトリが初期化されていません。repoInit() を先に実行してください。');
  }
  return JSON.parse(raw);
}

/**
 * 管理対象ファイルを登録する。
 *
 * @param {string} fileId Drive fileId
 * @param {string} path リポジトリ内論理パス
 * @returns {object} 登録された files 行
 */
function repoRegisterFile(fileId, path) {
  // あるか見てから書くので、鍵の中で行う。分けると、ほぼ同時の2件が
  // 「まだ無い」と読んで両方書き、先の1件しか引けない重なりができる
  return dbWithLock_(30000, function () {
    return repoRegisterFileLocked_(fileId, path);
  });
}

/**
 * repoRegisterFile の本体。鍵を持った状態で呼ばれる。
 */
function repoRegisterFileLocked_(fileId, path) {
  if (!/^[^\\]{1,200}$/.test(String(path || ''))) {
    throw new Error('パスが不正です: ' + path);
  }
  if (dbFindOne('files', 'fileId', fileId)) {
    throw new Error('すでに登録されています: ' + fileId);
  }

  // path は作業コピーを引く鍵である (branchWorkingFileId / branchBaseSha)。
  // Drive は同じ名前を許すので、重なると改訂版が別の文書の作業コピーを
  // 掴み、**依頼を反映した時点で関係のない文書に変更が入る**
  if (dbFindOne('files', 'path', path)) {
    throw new Error(
      '同じ名前の文書が既に登録されています: ' + path +
      '。Drive で名前を変えてから登録してください');
  }

  var mime = DriveApp.getFileById(fileId).getMimeType();
  var type;
  if (mime === MimeType.GOOGLE_DOCS) type = 'doc';
  else if (mime === MimeType.GOOGLE_SHEETS) type = 'sheet';
  else if (mime === MimeType.GOOGLE_SLIDES) type = 'slide';
  else throw new Error('対応していないファイル種別です: ' + mime);

  var row = {
    fileId: fileId,
    path: path,
    type: type,
    registeredAt: new Date(),
    registeredBy: Session.getActiveUser().getEmail(),
  };
  dbAppend('files', row);
  return row;
}

/**
 * 文書を管理から外す。
 *
 * 間違って登録したものを戻す道が、画面にもコマンドキューにも無かった。
 * 台帳を手で直すしかなく、それは「使う人に GAS を触らせない」に反する。
 *
 * **Drive のファイルも、これまでの記録も消さない。** 消すのは台帳の
 * 1行だけである。外したあとに登録し直すと、同じ fileId の記録が
 * そのまま繋がって履歴が戻る。だから「外す」は取り返しがつく。
 *
 * 断るのは次の2つだけにしてある。
 *
 * - 作業コピー (`branches/…`) そのものを名指しされたとき。あれを外すと
 *   版だけが宙に浮く。捨てるのは改訂版のほうである
 * - その文書の改訂版が残っているとき。同じ理由
 *
 * 未コミットの変更は理由にしない。何も壊れないうえ、外せない状態が
 * 増えると「どうすれば外せるのか」が分からなくなる。
 *
 * @param {string} fileId
 * @returns {{fileId:string, path:string, type:string}} 外したもの
 */
function repoUnregisterFile(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('登録されていません: ' + fileId);

  var parts = branchSplitPath_(row.path);
  if (parts.branch !== 'main') {
    throw new Error(
      'これは「' + parts.branch + '」の作業コピーです。' +
      '外すのではなく、改訂版そのものを捨ててください');
  }

  var holders = branchesHolding(parts.path);
  if (holders.length) {
    throw new Error(
      '改訂版が' + holders.length + '件あります (' + holders.join('、') + ')。' +
      '先にそれらを捨ててから外してください');
  }

  dbDelete('files', 'fileId', fileId);
  return {
    fileId: String(row.fileId),
    path: parts.path,
    type: String(row.type),
  };
}

/**
 * このアプリを持っている人を返す。
 *
 * この Web アプリは開いた人の権限で動く (executeAs: USER_ACCESSING) ため、
 * Session.getEffectiveUser() は常に開いている本人になる。それを持ち主と
 * 見なすと誰もが持ち主になるので、入れ物の持ち主を見る。
 *
 * @returns {string} 分からなければ空文字
 */
function repoOwnerEmail() {
  try {
    return String(DriveApp.getFolderById(repoConfig().rootId)
      .getOwner().getEmail() || '');
  } catch (e) {
    return '';
  }
}

/**
 * フォルダの場所を「上から下へ」の字で言い表す。
 *
 * Drive はフォルダ ID で物を指すが、人に伝えるには名前の連なりが要る。
 * 手元から動かすときの入れ先を伝える場面と、いまどのワークスペースを
 * 見ているかを示す場面で同じものが要るので、ここに1つ置く。
 *
 * 壊れた木で回り続けないよう、上へ辿る回数に上限を置く。
 *
 * @param {Folder} folder
 * @returns {string} 例 '総務共有/agentic-management/.git/queue'
 */
function repoFolderPath_(folder) {
  var parts = [folder.getName()];
  var cur = folder;

  for (var i = 0; i < 12; i++) {
    var parents = cur.getParents();
    if (!parents.hasNext()) break;

    cur = parents.next();
    parts.unshift(cur.getName());
  }
  return parts.join('/');
}

/**
 * いまどのワークスペースを見ているかを返す。
 *
 * 同じ道具を複数のワークスペースに置くと、画面だけでは見分けが付かず、
 * 別のところの文書を直してしまう。入れ物を置いている親フォルダの名前が
 * いちばん見分けに効くので、それを返す。
 *
 * 初期化前でも画面は開けなければならないため、分からないときは空で返す。
 * ここで投げると左上が出ない。
 *
 * @returns {{name:string, path:string, url:string}}
 */
function repoWorkspace() {
  try {
    var root = DriveApp.getFolderById(repoConfig().rootId);
    var parents = root.getParents();
    var place = parents.hasNext() ? parents.next() : null;

    return {
      name: place ? String(place.getName() || '') : 'マイドライブ',
      path: repoFolderPath_(root),
      url: place
        ? 'https://drive.google.com/drive/folders/' + place.getId() : '',
    };
  } catch (e) {
    Logger.log('置き場所が分かりませんでした: ' + e.message);
    return { name: '', path: '', url: '' };
  }
}

/**
 * 台帳の改訂版の表に main の行が無ければ入れる。あれば何もしない。
 *
 * main の行を台帳に入れるようになる前のリポジトリには、行が無い。無くても
 * 動くようにしてあるが (prCreate は正式版を探さない)、形が新しいリポジトリと
 * 食い違ったままになる。人にエディタで実行させずに、1日1回の片付けで入れる。
 *
 * @returns {boolean} 入れたら true
 */
function repoEnsureMainBranch() {
  // あるか見てから書くので鍵の中で行う。分けると main の行が2つ並ぶ
  return dbWithLock_(30000, function () {
    if (dbFindOne('branches', 'name', 'main')) return false;

    dbAppend('branches', {
      name: 'main',
      headSha: '',
      baseSha: '',
      state: 'open',
      workingFolderId: repoConfig().mainId,
      createdBy: repoOwnerEmail(),
      createdAt: new Date(),
    });
    return true;
  });
}
