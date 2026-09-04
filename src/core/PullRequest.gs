/**
 * 次のPR番号を採番する。
 *
 * @returns {number}
 */
function prNextNumber_() {
  var rows = dbReadAll('pulls');
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].number);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * PR本文から対象ファイルのfileIdを取り出す。
 *
 * @param {string} body
 * @returns {string|null}
 */
function prTargetFileId_(body) {
  var m = /\[target-file:([A-Za-z0-9_\-]+)\]/.exec(String(body || ''));
  return m ? m[1] : null;
}

/**
 * PRを作成する。
 *
 * @param {string} title
 * @param {string} body
 * @param {string} sourceBranch
 * @param {string} mainFileId 対象ファイルのmain上のfileId
 * @returns {object} 作成された pulls 行
 */
function prCreate(title, body, sourceBranch, mainFileId) {
  if (!/^[\s\S]{1,200}$/.test(String(title || ''))) {
    throw new Error('タイトルを入力してください');
  }

  var branch = dbFindOne('branches', 'name', sourceBranch);
  if (!branch) throw new Error('ブランチが見つかりません: ' + sourceBranch);
  if (String(branch.state) !== 'open') {
    throw new Error('このブランチは既に閉じられています: ' + sourceBranch);
  }
  if (!dbFindOne('files', 'fileId', mainFileId)) {
    throw new Error('対象ファイルが管理対象にありません');
  }

  var existing = dbReadAll('pulls');
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].sourceBranch) !== String(sourceBranch)) continue;
    var st = String(existing[i].state);
    if (st === 'open' || st === 'approved') {
      throw new Error('このブランチには未クローズのPRがあります: #' + existing[i].number);
    }
  }

  var row = {
    number: prNextNumber_(),
    title: title,
    // 対象ファイルを本文の末尾に記録する。pulls シートに列を増やさずに
    // 対象を辿れるようにするための最小限の措置
    body: (body || '') + '\n\n[target-file:' + mainFileId + ']',
    sourceBranch: sourceBranch,
    targetBranch: 'main',
    state: 'open',
    author: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
    mergedAt: '',
  };
  dbAppend('pulls', row);
  return row;
}

/**
 * PR一覧を返す。
 *
 * @returns {object[]}
 */
function prList() {
  return dbReadAll('pulls');
}

/**
 * PRを1件返す。
 *
 * @param {number} number
 * @returns {object}
 */
function prGet(number) {
  var row = dbFindOne('pulls', 'number', number);
  if (!row) throw new Error('PRが見つかりません: #' + number);
  return row;
}

/**
 * PRのapprove数を返す。同一レビュアーの複数承認は1件として数える。
 *
 * Main.gs の apiPrPreview からも呼ぶため、末尾アンダースコアを付けない
 * (アンダースコアはファイル内部専用の目印という規約のため)。
 *
 * @param {number} number
 * @returns {number}
 */
function prApprovalCount(number) {
  var rows = dbReadAll('reviews');
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;
    if (String(rows[i].state) !== 'approve') continue;
    seen[String(rows[i].reviewer)] = true;
  }
  var count = 0;
  for (var k in seen) {
    if (Object.prototype.hasOwnProperty.call(seen, k)) count++;
  }
  return count;
}

/**
 * PRのマージ結果をプレビューする。実際のマージは行わない。
 *
 * base   = ブランチ作成時点の main HEAD (branches.baseSha)
 * ours   = main の現在のHEAD
 * theirs = ブランチの現在のHEAD
 *
 * @param {number} number
 * @returns {{clean:boolean, lines:string[], conflicts:object[], problems:string[], mainFileId:string, oursHtml:string}}
 */
function prPreviewMerge(number) {
  var pr = prGet(number);
  var branch = dbFindOne('branches', 'name', pr.sourceBranch);
  if (!branch) throw new Error('ブランチが見つかりません: ' + pr.sourceBranch);

  var mainFileId = prTargetFileId_(pr.body);
  if (!mainFileId) throw new Error('PRの対象ファイルを特定できません');

  var baseHtml = commitHtml(branch.baseSha) || '';

  var mainHead = headCommit(mainFileId, 'main');
  var oursHtml = mainHead ? (objectGet(mainHead.blobSha) || '') : '';

  var workFileId = branchWorkingFileId(pr.sourceBranch, mainFileId);
  if (!workFileId) throw new Error('ブランチの作業コピーが見つかりません');
  var branchHead = headCommit(workFileId, pr.sourceBranch);
  var theirsHtml = branchHead ? (objectGet(branchHead.blobSha) || '') : '';

  var result = merge3Html(baseHtml, oursHtml, theirsHtml);

  var problems = [];
  if (result.clean) {
    problems = htmlWriterValidate(parseBlocks(linesToHtml_(result.lines)));
  } else {
    // コンフリクトがあると解決後の内容が確定しないが、どちら側にも
    // 実体を取得できない画像が無いことは今の時点で分かる。
    // ここを空にすると UI がマージ可能に見えてしまい、押した瞬間に
    // サーバ側の検証で落ちる。選択に依存しない問題だけ先に出す
    problems = htmlWriterProblemsEitherSide_(oursHtml, theirsHtml);
  }

  return {
    clean: result.clean,
    lines: result.lines,
    conflicts: result.conflicts,
    problems: problems,
    mainFileId: mainFileId,
    oursHtml: oursHtml,
  };
}

/**
 * ours / theirs のどちらかに含まれる、選択に依存しない書き戻しの問題を返す。
 *
 * 実体を取得できない画像は、どちらを採用しても結果に残りうるうえ、
 * 残った時点で書き戻しが拒否される。コンフリクトの解決前でも
 * 判定できるため、先に出しておく。
 *
 * @param {string} oursHtml
 * @param {string} theirsHtml
 * @returns {string[]}
 */
function htmlWriterProblemsEitherSide_(oursHtml, theirsHtml) {
  var all = htmlWriterValidate(parseBlocks(oursHtml))
    .concat(htmlWriterValidate(parseBlocks(theirsHtml)));
  var out = [];
  var seen = {};

  for (var i = 0; i < all.length; i++) {
    if (all[i].indexOf('実体を取得できない画像') < 0) continue;
    if (seen[all[i]]) continue;
    seen[all[i]] = true;
    out.push(all[i]);
  }
  return out;
}

/**
 * 行配列を正規化HTML文字列に戻す。
 *
 * @param {string[]} lines
 * @returns {string}
 */
function linesToHtml_(lines) {
  return lines.length ? lines.join('\n') + '\n' : '';
}

/**
 * PRにレビューを記録する。
 *
 * @param {number} number
 * @param {string} state 'approve' | 'request_changes' | 'comment'
 * @param {string} body
 * @returns {object}
 */
function prReview(number, state, body) {
  if (!/^(approve|request_changes|comment)$/.test(String(state))) {
    throw new Error('不正なレビュー種別です: ' + state);
  }
  var pr = prGet(number);
  if (String(pr.state) === 'merged') throw new Error('このPRは既にマージ済みです');

  var reviewer = Session.getActiveUser().getEmail();
  if (state === 'approve' && String(pr.author) === reviewer) {
    // 自己承認は既定で禁止する。ただし1人でのPoC検証ではマージまで
    // 到達できなくなるため、スクリプトプロパティで一時的に緩められる。
    // 本番運用では必ず未設定 (禁止) のままにすること
    var allow = PropertiesService.getScriptProperties()
      .getProperty('ALLOW_SELF_APPROVE');
    if (String(allow) !== 'true') {
      throw new Error(
        '自分が作成したPRは承認できません。' +
        '1人で検証する場合はスクリプトプロパティ ALLOW_SELF_APPROVE を true にしてください'
      );
    }
    Logger.log('警告: 自己承認が許可されています (PR #' + number + ')');
  }

  var row = {
    prNumber: number,
    reviewer: reviewer,
    state: state,
    body: body || '',
    at: new Date(),
  };
  dbAppend('reviews', row);

  if (state === 'approve') {
    dbUpdate('pulls', 'number', number, { state: 'approved' });
  } else if (state === 'request_changes') {
    dbUpdate('pulls', 'number', number, { state: 'open' });
  }
  return row;
}

/**
 * PR本文の closes #N 記法から Issue 番号を取り出す。
 * Phase 3 で issues テーブルと連動させるための準備。
 *
 * @param {string} body
 * @returns {number[]}
 */
function prClosesIssues_(body) {
  var out = [];
  var re = /closes\s+#(\d+)/gi;
  var m;
  while ((m = re.exec(String(body || ''))) !== null) out.push(Number(m[1]));
  return out;
}

/**
 * PRをマージし、結果を main の Doc に書き戻す。
 *
 * 書き戻しは破壊的操作であるため、以下の順序を厳守する:
 *   1. マージ結果を計算し、書き戻せるか検証する
 *   2. 検証に通らなければ、何も変更せずに中断する
 *   3. main の現在の内容をコミットして退避する
 *   4. 書き戻す
 *   5. 書き戻し結果をコミットする
 *
 * @param {number} number
 * @param {string[]} choices コンフリクトへの選択 ('ours'|'theirs'|'both')
 * @returns {object} マージコミット行
 */
function prMerge(number, choices) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    throw new Error('他の処理が実行中です。しばらくしてから再試行してください');
  }

  try {
    var pr = prGet(number);
    if (String(pr.state) === 'merged') throw new Error('このPRは既にマージ済みです');
    if (String(pr.state) === 'closed') throw new Error('このPRは閉じられています');

    if (prApprovalCount(number) < 1) {
      throw new Error('マージには1件以上の承認が必要です');
    }

    // main に未コミットの変更があるうちはマージしない。
    // マージ結果はコミット済みのHEADを ours として計算されるため、
    // 未コミットの編集はマージに参加できず、書き戻しで黙って
    // 上書きされてしまう。git が dirty な作業ツリーでのマージを
    // 拒むのと同じ理由による
    var targetFileId = prTargetFileId_(pr.body);
    if (!targetFileId) throw new Error('PRの対象ファイルを特定できません');
    if (fileStatus(targetFileId, 'main').dirty) {
      throw new Error(
        'mainに未コミットの変更があります。' +
        '先にmainをコミットしてからマージしてください'
      );
    }

    var preview = prPreviewMerge(number);
    var mainFileId = preview.mainFileId;

    var lines = preview.clean
      ? preview.lines
      : resolveConflicts(
          { lines: preview.lines, conflicts: preview.conflicts },
          choices || []
        );

    var mergedHtml = linesToHtml_(lines);

    // 書き戻せるかを body.clear() の前に必ず検証する
    var problems = htmlWriterValidate(parseBlocks(mergedHtml));
    if (problems.length > 0) {
      throw new Error('マージ結果を書き戻せません:\n' + problems.join('\n'));
    }

    // 最後の砦。上の検査から書き戻しまでの間に誰かが Doc を編集した
    // 場合に備え、書き戻す直前にもう一度見て、変更があれば退避する。
    // 通常は上の検査で弾かれるためここは通らない
    var status = fileStatus(mainFileId, 'main');
    if (status.dirty) {
      commitFile(mainFileId, 'main', 'PR #' + number + ' マージ前の自動退避', null);
    }

    writeHtmlToDoc(mainFileId, mergedHtml);
    liveCacheInvalidate(mainFileId);

    var mergeCommit = commitFile(
      mainFileId,
      'main',
      'マージ: PR #' + number + ' ' + pr.title,
      null
    );

    dbUpdate('pulls', 'number', number, {
      state: 'merged',
      mergedAt: new Date(),
    });
    dbUpdate('branches', 'name', pr.sourceBranch, { state: 'merged' });

    var issues = prClosesIssues_(pr.body);
    for (var i = 0; i < issues.length; i++) {
      if (dbFindOne('issues', 'number', issues[i])) {
        dbUpdate('issues', 'number', issues[i], {
          state: 'closed',
          closedAt: new Date(),
        });
      }
    }

    return mergeCommit;
  } finally {
    lock.releaseLock();
  }
}
