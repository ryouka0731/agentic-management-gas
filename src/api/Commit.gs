/*
 * 画面の API: 変更の記録と改訂版、Markdown での編集と正式版の保護。
 */

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
  if (to === null) throw new Error('変更の記録が見つかりません');
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

  // 中の文書が全部見えなくなった改訂版は出さない (Drive で元の文書か作業
  // コピーが消された)。開いても扱える文書が無い
  var alive = {};
  var visible = filesVisibleInWiki();
  for (var v = 0; v < visible.length; v++) alive[branchOfPath_(visible[v].path)] = true;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].state) === 'deleted') continue;
    if (String(rows[i].name) !== 'main' && !alive[String(rows[i].name)]) continue;
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
  // 管理者に絞る。頼まれた側が捨てられると、作った人の知らないうちに消える
  var row = dbFindOne('branches', 'name', name);
  var me = String(Session.getActiveUser().getEmail() || '');
  if (row && String(row.createdBy) !== me && !repoIsAdmin_(me)) {
    throw new Error('改訂版を捨てられるのは、作った本人か、このアプリの管理者だけです');
  }

  branchDelete(name);
  return name;
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
  if (!mainRow) throw new Error('正式版の文書が見つかりません: ' + mainPath);

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
    '正式版は直接なおせません。改訂版を作って直し、確認依頼を出して反映してください'
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
    throw new Error('正式版の文書にだけ使えます');
  }
  return commitFile(fileId, 'main', '正式版への直接編集を退避', null);
}
