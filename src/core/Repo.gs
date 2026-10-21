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
  dbFile.moveTo(git);

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
  repoDriveId_(); // 共有ドライブなら覚える

  // スキーマ定義済みのシートをすべて先に作っておく
  var schema = DB_SCHEMA();
  for (var table in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, table)) dbSheet_(table);
  }
  var sheet1 = db.getSheetByName('シート1') || db.getSheetByName('Sheet1');
  if (sheet1) db.deleteSheet(sheet1);
  // 台帳を作り直したので、前の台帳の読み取りの覚えを捨てる (同じ表の名前で前の中身が当たらないように)
  dbInvalidateAll_();

  // main ブランチをテーブルに登録する。これが無いと commitFile が
  // headSha を更新できない
  dbAppend('branches', {
    name: 'main',
    headSha: '',
    baseSha: '',
    state: 'open',
    workingFolderId: config.mainId,
    createdBy: currentEmail_(),
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
 * Drive の拡張サービス (v3) が使えるか。
 *
 * appsscript.json で足してあるが、足す前に作ったデプロイや、組織が止めている環境もある。
 * 使えなければマイドライブとして扱う。
 *
 * @returns {boolean}
 */
function driveApiAvailable_() {
  try {
    return typeof Drive !== 'undefined' && !!Drive.Files && !!Drive.Permissions;
  } catch (e) {
    return false;
  }
}

/**
 * 入れ物が置かれている共有ドライブの id。マイドライブなら空。
 *
 * **共有ドライブとマイドライブの分かれ目はここだけ。** `if (driveId)` を散らさない。
 *
 * 設定 (`repoConfig().driveId`) に覚える。空文字も「マイドライブ」として覚え、毎回
 * 問い合わせない。拡張サービスが無いときと問い合わせに失敗したときは覚えない
 * (あとで足されたら読み直す)。設定が読めなければ投げる (repoConfig と同じ)。
 *
 * @returns {string}
 */
function repoDriveId_() {
  var config = repoConfig();
  if (typeof config.driveId === 'string') return config.driveId;
  if (!driveApiAvailable_()) return '';

  var id;
  try {
    var meta = Drive.Files.get(config.rootId, { fields: 'driveId', supportsAllDrives: true });
    id = String((meta && meta.driveId) || '');
  } catch (e) {
    Logger.log('共有ドライブか分かりませんでした: ' + e.message);
    return '';
  }

  // 設定はキューの置き場を作るときにも書くので、鍵の中で読み直してから書く。
  // 取れなければ覚えずに返す (次に読んだときにまた問い合わせるだけ)。
  // 読むついでに覚えるだけなので待たない (画面からの読み出しを鍵で30秒止めない)
  dbWithLock_(1500, function () {
    var again = repoConfig();
    if (typeof again.driveId === 'string') return;
    again.driveId = id;
    PropertiesService.getScriptProperties().setProperty(REPO_CONFIG_KEY(), JSON.stringify(again));
  }, function () {});
  return id;
}

/**
 * repoDriveId_ を、設定が読めないときに空で返す形。消す・断るの判断に使う。
 *
 * @returns {string}
 */
function repoDriveIdSafe_() {
  try {
    return repoDriveId_();
  } catch (e) {
    return '';
  }
}

/**
 * 1回の実行のあいだだけ覚える共有ドライブの役割 (読めなかったことも含む)。
 *
 * 読めなかったものは CacheService に入れない (10分のあいだ全員が持ち主でなくなる)。
 * ただ何も覚えないと、一覧を1回描くあいだに行の数だけ Drive に問い合わせる。
 * GAS は実行ごとにグローバルを作り直すので、ここは次の実行には残らない。
 * テストでは同じ文脈で読み直すときに `{}` へ戻す。
 */
var DRIVE_MEMBERS_MEMO_ = {};

/**
 * 共有ドライブのメンバーを、持ち主 (organizer) と管理者 (organizer / fileOrganizer / writer) に分ける。
 *
 * **グループは数えない。** 中の人を確かめる手立てが無い。
 * **読めなければ投げずに空。** 誰も持ち主・管理者ではない (安全側)。失敗は CacheService には
 * 覚えない (その実行のあいだだけ DRIVE_MEMBERS_MEMO_ に覚える)。
 * **管理者 (organizer) が1人も居ない読みも失敗として扱う。** 共有ドライブには必ず
 * 1人は居るので、居ないのは読めたのが一部だけということ。覚えると、10分のあいだ
 * 全員が持ち主でなくなる。
 * **アドレスは小文字にそろえて持つ。** Drive が返す字と Session の字は大文字小文字が
 * 違うことがあり、そのまま比べると持ち主が全員締め出される。比べる側も小文字にする。
 * 読めたものは10分覚える。一覧で1行ごとに問い合わせると、行の数だけ待つ。
 *
 * グループ・ドメイン・リンクでの共有があれば wide: true も付く (無ければ付けない)。
 *
 * @param {string} driveId
 * @returns {{owners: string[], admins: string[], wide?: boolean}}
 */
function driveMembers_(driveId) {
  var key = 'driveMembers:' + driveId;
  if (Object.prototype.hasOwnProperty.call(DRIVE_MEMBERS_MEMO_, key)) return DRIVE_MEMBERS_MEMO_[key];
  var got = driveMembersRead_(driveId, key);
  DRIVE_MEMBERS_MEMO_[key] = got;
  return got;
}

/**
 * driveMembers_ の本体。CacheService を見て、無ければ Drive に問い合わせる。
 *
 * @param {string} driveId
 * @param {string} key
 * @returns {{owners: string[], admins: string[]}}
 */
function driveMembersRead_(driveId, key) {
  var cached = driveMembersCacheGet_(key);
  if (cached.hit) return cached.hit;

  var out;
  try {
    out = driveMembersList_(driveId);
  } catch (e) {
    Logger.log('共有ドライブの役割が読めませんでした: ' + e.message);
    return { owners: [], admins: [] };
  }
  if (out.owners.length === 0) {
    Logger.log('共有ドライブの管理者が読めませんでした (一部しか返りませんでした)');
    return { owners: [], admins: [] };
  }

  try {
    if (cached.cache) cached.cache.put(key, JSON.stringify(out), 600);
  } catch (e2) {
    Logger.log('役割を覚えられませんでした: ' + e2.message);
  }
  return out;
}

/**
 * CacheService に覚えた役割を引く。使えなければ cache は null。
 *
 * @returns {{cache: object|null, hit: object|null}}
 */
function driveMembersCacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    return { cache: cache, hit: hit ? JSON.parse(hit) : null };
  } catch (e) {
    return { cache: null, hit: null };
  }
}

/** Drive に役割を全頁ぶん問い合わせる。読めなければ投げる */
function driveMembersList_(driveId) {
  var out = { owners: [], admins: [] };
  var token = '';
  do {
    var res = Drive.Permissions.list(driveId, {
      supportsAllDrives: true, pageSize: 100, pageToken: token || undefined,
      fields: 'nextPageToken,permissions(emailAddress,role,type)',
    });
    driveMembersAddPage_(out, (res && res.permissions) || []);
    token = (res && res.nextPageToken) || '';
  } while (token);
  return out;
}

/**
 * 1頁ぶんの役割を足す。グループ・ドメイン・リンクとアドレスの無いものは数えない。
 * グループ・ドメイン・リンクでの共有があれば wide を立てる (何人いるか分からない。実績の「1人かどうか」が見る)
 */
function driveMembersAddPage_(out, list) {
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.type && p.type !== 'user') out.wide = true;
    if (p.type !== 'user' || !p.emailAddress) continue;
    var email = String(p.emailAddress).toLowerCase();
    if (p.role === 'organizer') out.owners.push(email);
    if (p.role === 'organizer' || p.role === 'fileOrganizer' || p.role === 'writer') out.admins.push(email);
  }
}

/**
 * このアプリの持ち主。マイドライブでは入れ物の持ち主1人、共有ドライブでは管理者 (organizer) 全員。
 *
 * エディタ専用の関数・報告の知らせ・報告から作るやることの担当が見る。
 *
 * @returns {string[]} 分からなければ空
 */
function repoOwners_() {
  var driveId;
  try {
    driveId = repoDriveId_();
  } catch (e) {
    return [];
  }
  if (driveId) return driveMembers_(driveId).owners;
  var owner = repoOwnerEmail();
  return owner ? [owner] : [];
}

/**
 * その人が持ち主か。大文字小文字は見ない。
 *
 * Drive が返すアドレスと Session のアドレスは字の大小が違うことがある。そのまま
 * 比べると、共有ドライブの管理者が全員エディタ専用の関数から締め出される。
 *
 * @param {string} email
 * @returns {boolean}
 */
function repoHasOwner_(email) {
  var who = String(email || '').toLowerCase();
  if (!who) return false;
  var owners = repoOwners_();
  for (var i = 0; i < owners.length; i++) {
    if (String(owners[i]).toLowerCase() === who) return true;
  }
  return false;
}

/**
 * ゴミ箱へ移す。
 *
 * **共有ドライブでは、投稿者の役割では消せない。** 黙って続けると、捨てたはずの改訂版が
 * 残り続ける。何が要るかを添えて投げる。マイドライブでは今までどおり記録して続ける
 * (持ち主でない編集者は他人のファイルを消せないが、それで止めたことはない)。
 *
 * @param {GoogleAppsScript.Drive.File|GoogleAppsScript.Drive.Folder} item
 * @returns {boolean} 消せたら true
 */
function driveTrash_(item) {
  try {
    item.setTrashed(true);
    return true;
  } catch (e) {
    if (repoDriveIdSafe_()) {
      throw new Error('ゴミ箱へ移せませんでした。共有ドライブで消すには「コンテンツ管理者」以上の' +
        '役割が要ります (' + e.message + ')');
    }
    Logger.log('ゴミ箱へ移せませんでした: ' + e.message);
    return false;
  }
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
    registeredBy: currentEmail_(),
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
 * その人がこのアプリの管理者か。
 *
 * **共有ドライブでは** organizer / fileOrganizer / writer (driveMembers_)。
 *
 * **管理者 = 持ち主 + 入れ物のフォルダを編集できる人。** 以前は持ち主1人だけが
 * 設定や他人の依頼の取り下げを行えたため、持ち主が休むと誰も直せなかった。
 * フォルダを編集できる人は台帳も直接書き換えられるので、画面の操作でも同じ
 * 扱いにする。
 *
 * 持ち主1人に宛てるもの (報告の知らせ・報告から作るやることの担当) と、
 * エディタ専用の関数 (assertOwner_) は、これまでどおり持ち主だけを見る。
 *
 * Drive の getEditors は、編集権限の無い人が呼ぶと空を返す。分からないときは
 * 投げずに「管理者ではない」と答える (画面が開けなくなるより安全側に倒す)。
 *
 * @param {string} email
 * @returns {boolean}
 */
function repoIsAdmin_(email) {
  var who = String(email || '');
  if (!who) return false;

  var driveId;
  try {
    driveId = repoDriveId_();
  } catch (e) {
    return false;
  }
  // 共有ドライブでは、台帳を書き換えられる役割 (投稿者まで) を管理者とする。フォルダの持ち主は無い
  if (driveId) return driveMembers_(driveId).admins.indexOf(who.toLowerCase()) >= 0;

  // 大文字小文字は見ない (repoHasOwner_ と同じ)。Drive と Session で字の大小が違うことがある
  var me = who.toLowerCase();
  var owner = String(repoOwnerEmail() || '').toLowerCase();
  if (owner && owner === me) return true;

  try {
    var editors = DriveApp.getFolderById(repoConfig().rootId).getEditors();
    for (var i = 0; i < editors.length; i++) {
      if (String(editors[i].getEmail() || '').toLowerCase() === me) return true;
    }
  } catch (e) {
    Logger.log('編集者が分かりませんでした: ' + e.message);
  }
  return false;
}

/**
 * 管理者でなければ断る。
 *
 * @param {string} [what] 何ができないのか (断るときの言葉に入れる)
 * @param {string} [who] 誰か。省くと開いている本人。手元からの命令 (oshiProfileSet) は置いた人を渡す
 */
function repoAssertAdmin_(what, who) {
  var me = who === undefined ? currentEmail_() : String(who || '');
  if (!repoIsAdmin_(me)) {
    throw new Error((what || 'この操作') + 'は、このアプリの管理者 (持ち主と、入れ物のフォルダを' +
      '編集できる人) だけが行えます');
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
      createdBy: repoOwners_()[0] || '',
      createdAt: new Date(),
    });
    return true;
  });
}
