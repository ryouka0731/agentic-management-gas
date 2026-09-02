/**
 * コミットSHAを計算する。内容だけでなく親・作者・時刻も含めることで、
 * 同じ内容の再コミットでも異なるコミットSHAになる。
 *
 * blobSha は内容そのもののハッシュで、これとは別物である。
 *
 * @param {string} parentSha
 * @param {string} blobSha
 * @param {string} author
 * @param {string} message
 * @param {Date} timestamp
 * @returns {string} 64桁hex
 */
function commitSha_(parentSha, blobSha, author, message, timestamp) {
  return sha256Hex([
    'parent:' + (parentSha || ''),
    'blob:' + blobSha,
    'author:' + author,
    'message:' + message,
    'time:' + timestamp.getTime(),
  ].join('\n'));
}

/**
 * ブランチ上のファイルの最新コミットを返す。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {object|null} commits 行
 */
function headCommit(fileId, branch) {
  var rows = dbReadAll('commits');
  var best = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.fileId) !== String(fileId)) continue;
    if (String(r.branch) !== String(branch)) continue;
    if (!best || new Date(r.timestamp) >= new Date(best.timestamp)) best = r;
  }
  return best;
}

/**
 * ブランチ上のファイルのコミット履歴を新しい順で返す。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {object[]}
 */
function commitHistory(fileId, branch) {
  var rows = dbReadAll('commits');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.fileId) !== String(fileId)) continue;
    if (String(r.branch) !== String(branch)) continue;
    out.push(r);
  }
  out.sort(function (x, y) {
    return new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime();
  });
  return out;
}

/**
 * コミットSHAから、その時点の正規化HTMLを取得する。
 *
 * @param {string} sha コミットSHA
 * @returns {string|null}
 */
function commitHtml(sha) {
  var row = dbFindOne('commits', 'sha', sha);
  return row ? objectGet(row.blobSha) : null;
}

/**
 * ファイルの現在の状態を返す。HEADコミットと現在のライブ内容を比較し、
 * 未コミットの変更があるかを判定する (git status 相当)。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {{dirty:boolean, headSha:string|null, ops:object[]}}
 */
function fileStatus(fileId, branch) {
  var head = headCommit(fileId, branch);
  var live = liveHtml(fileId);

  if (!head) {
    return { dirty: true, headSha: null, ops: diffHtml('', live) };
  }

  var committed = objectGet(head.blobSha) || '';
  if (committed === live) {
    return { dirty: false, headSha: head.sha, ops: [] };
  }
  return { dirty: true, headSha: head.sha, ops: diffHtml(committed, live) };
}

/**
 * ファイルの現在の内容をコミットする。
 *
 * 内容がHEADと同一なら空コミットを作らずエラーにする。
 * expectedHeadSha を渡すと楽観的並行制御が働き、その間に他者が
 * コミットしていた場合は拒否される (scaling doc §6.3)。
 *
 * @param {string} fileId
 * @param {string} branch
 * @param {string} message
 * @param {string|null} expectedHeadSha 省略時はチェックしない
 * @returns {object} 作成された commits 行
 */
function commitFile(fileId, branch, message, expectedHeadSha) {
  if (!/^[\s\S]{1,500}$/.test(String(message || ''))) {
    throw new Error('コミットメッセージを入力してください');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('他の処理が実行中です。しばらくしてから再試行してください');
  }

  try {
    var head = headCommit(fileId, branch);
    var headSha = head ? head.sha : null;

    if (expectedHeadSha !== undefined && expectedHeadSha !== null &&
        expectedHeadSha !== '' &&
        String(expectedHeadSha) !== String(headSha)) {
      throw new Error(
        'HEADが進んでいます。画面を再読み込みしてから再度コミットしてください'
      );
    }

    var html = liveHtml(fileId);
    var blobSha = sha256Hex(html);

    if (head && String(head.blobSha) === blobSha) {
      throw new Error('変更がありません');
    }

    objectPut(blobSha, html);

    var author = Session.getActiveUser().getEmail();
    var timestamp = new Date();
    var sha = commitSha_(headSha, blobSha, author, message, timestamp);

    var row = {
      sha: sha,
      parentSha: headSha || '',
      branch: branch,
      fileId: fileId,
      blobSha: blobSha,
      author: author,
      message: message,
      timestamp: timestamp,
    };
    dbAppend('commits', row);

    if (dbFindOne('branches', 'name', branch)) {
      dbUpdate('branches', 'name', branch, { headSha: sha });
    }

    return row;
  } finally {
    lock.releaseLock();
  }
}
