/*
 * 画面の API: 確認依頼 (反映・確認・添えたコードの変更)。
 */

/**
 * PR一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiPrList() {
  // 元の文書が Drive で消された依頼を先に取り下げる。取り下げに失敗しても
  // 一覧は出す
  try {
    prWithdrawOrphans();
  } catch (e) {
    Logger.log('消えた文書の確認依頼を取り下げられませんでした: ' + e.message);
  }

  var rows = prList();
  var out = [];

  // 取り下げられるかはサーバが決める。画面で決めると、他人の依頼を
  // 自分のものだと名乗って取り下げられる
  var me = currentEmail_();
  // 一覧の1件ごとに Drive へ問い合わせない。先に1回だけ求める
  var isAdmin = repoIsAdmin_(me);

  for (var i = 0; i < rows.length; i++) {
    out.push({
      number: plainId(rows[i].number),
      title: plainText(rows[i].title),
      sourceBranch: plainText(rows[i].sourceBranch),
      targetBranch: plainText(rows[i].targetBranch),
      state: plainText(rows[i].state),
      author: plainText(rows[i].author),
      createdAt: plainDate(rows[i].createdAt),
      body: plainText(rows[i].body),
      reviewers: prReviewers(rows[i]),
      canClose: (isAdmin || String(rows[i].author) === me) &&
        String(rows[i].state) !== 'merged' &&
        String(rows[i].state) !== 'closed',
    });
  }
  out.sort(function (a, b) { return b.number - a.number; });
  return out;
}

/**
 * PRを作成する (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string} sourceBranch
 * @param {string} mainFileId
 * @returns {object}
 */
function apiPrCreate(title, body, sourceBranch, mainFileId, targetBranch) {
  var row = prCreate(title, body, sourceBranch, mainFileId, targetBranch);
  return { number: row.number, title: row.title, targetBranch: row.targetBranch };
}

/**
 * PRのマージプレビューを返す (Web App API)。
 * 差分表示のため main HEAD とマージ結果の diff も返す。
 *
 * @param {number} number
 * @returns {object}
 */
function apiPrPreview(number) {
  var all = prPreviewAll(number);
  var files = [];
  var changes = [];

  for (var i = 0; i < all.files.length; i++) {
    var one = all.files[i];
    var changeOps = one.changeOps || [];
    changes.push({ path: one.path, ops: changeOps });

    files.push({
      fileId: plainText(one.mainFileId),
      path: plainText(one.path),
      type: plainText(one.type),
      clean: !!one.clean,
      problems: one.problems,
      conflicts: one.conflicts,
      ops: diffHtml(one.oursHtml, linesToHtml_(one.lines)),
      // この文書の変わった箇所 (人の言葉の箇条書き。src/core/DiffSummary.js)
      summary: diffSummarize(changeOps),
    });
  }

  /*
   * 変更セット全体の姿を上に、文書ごとの中身を下に返す。
   *
   * clean と problems は**全体の判断**である。どれか1つでも書き戻せなければ
   * その依頼は反映できないので、画面は文書ごとに押させてはならない。
   *
   * clean / problems / conflicts / ops は1文書だったころの形のまま残して
   * ある。画面を直すまでのあいだ、1つ目のぶんが従来どおり届く
   */
  var head = files.length ? files[0] : {
    clean: true, problems: [], conflicts: [], ops: [],
  };

  return {
    clean: all.clean,
    problems: all.problems,
    conflicts: head.conflicts,
    approvals: prApprovalCount(number),
    // 承認のあとに中身が変わって数えなくなった承認の数。押せない理由を言う
    staleApprovals: prStaleApprovalCount(number),
    ops: head.ops,
    files: files,
    // 証跡の数。中身は重いので、あるかどうかだけ先に渡す
    patchCount: prPatchRows(number).length,
    // 反映のときに添えてもらう。見比べたあとで進んでいないかを見分ける
    previewSha: prPreviewFingerprint(number),
    // 変わった箇所の箇条書き (最大 8 本 + 「ほか N か所」)。画面の先頭と手元の下見に出す
    summary: diffSummaryFiles(changes),
    // 反映の理由の既定値 (確認依頼の本文の1行目)。画面は反映の前の欄に入れておく
    defaultReason: plainText(prDefaultReason_(prGet(number))),
  };
}

/**
 * 確認依頼にコードの変更を添える (Web App API)。
 *
 * **この道具はコードの版管理をしない。** 添えるのは「何が変わったのかを
 * 人が読んで決める」ための証跡である。反映されるのは文書だけで、コードは
 * 手元の git で進める。
 *
 * 手元で `git diff -- <path>` を走らせて送る。GAS 側では git のオブジェクトを
 * 読めない (loose object は raw deflate で、Apps Script には raw inflate が
 * 無い)。
 *
 * @param {number} number
 * @param {string} path リポジトリの中での道のり
 * @param {string} text unified diff の本文
 * @returns {{id:number, path:string, added:number, removed:number}}
 */
function apiPrPatchAdd(number, path, text) {
  var row = prPatchAdd(number, path, text);

  return {
    id: plainId(row.id),
    path: plainText(row.path),
    added: plainNumber(row.added),
    removed: plainNumber(row.removed),
  };
}

/**
 * 確認依頼に添えられたコードの変更を返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrPatches(number) {
  var rows = prPatches(number);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    out.push({
      id: plainId(rows[i].id),
      path: plainText(rows[i].path),
      added: plainNumber(rows[i].added),
      removed: plainNumber(rows[i].removed),
      by: plainText(rows[i].by),
      at: plainDate(rows[i].at),
      text: plainText(rows[i].text),
    });
  }
  return out;
}

/**
 * 添えたコードの変更を外す (Web App API)。
 *
 * @param {number} number
 * @param {number} id
 * @returns {{removed:number}}
 */
function apiPrPatchRemove(number, id) {
  return { removed: plainNumber(prPatchRemove(number, id)) };
}

/**
 * PRにレビューを記録する (Web App API)。
 *
 * @param {number} number
 * @param {string} state
 * @param {string} body
 * @returns {object}
 */
function apiPrReview(number, state, body) {
  var row = prReview(number, state, body);
  return { prNumber: row.prNumber, state: row.state };
}

/**
 * コメントを書き直す (Web App API)。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function apiReviewEdit(id, body) {
  var row = reviewEdit(id, body);
  return { id: Number(row.id), body: String(row.body) };
}

/**
 * コメントを消す (Web App API)。
 *
 * @param {number} id
 * @returns {string}
 */
function apiReviewDelete(id) {
  reviewDelete(id);
  return 'コメントを消しました';
}

/**
 * 確認してもらう人を決める (Web App API)。
 *
 * @param {number} number
 * @param {string[]} emails
 * @returns {string[]} 決まった宛先
 */
function apiPrSetReviewers(number, emails) {
  return prReviewers(prSetReviewers(number, emails || []));
}

/**
 * 確認依頼を取り下げる (Web App API)。
 *
 * 改訂版は捨てない。取り下げるのは「いま反映してよいか尋ねること」で
 * あって、直した中身ではない。
 *
 * @param {number} number
 * @returns {object}
 */
function apiPrClose(number) {
  var pr = prClose(number);

  return {
    number: plainId(pr.number),
    state: plainText(pr.state),
    title: plainText(pr.title),
  };
}

/**
 * PRをマージする (Web App API)。
 *
 * @param {number} number
 * @param {string[]} choices
 * @param {string} [previewSha]
 * @param {string} [reason] 反映の理由 (200字まで。空なら確認依頼の本文の1行目)
 * @returns {object}
 */
function apiPrMerge(number, choices, previewSha, reason) {
  var row = prMerge(number, choices, previewSha || '', reason);
  return { sha: row.sha, message: row.message };
}

/**
 * PRに付いたレビューとコメントを古い順で返す (Web App API)。
 *
 * reviews テーブルは Phase 2 から state に 'comment' を許している。
 * 会話のために新しいテーブルは要らない。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrReviews(number) {
  // 番号の列を足す前に書かれた行を先に埋める。空のままだと直せない
  reviewBackfillIds_();

  var rows = dbReadAll('reviews');
  var me = currentEmail_();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;
    // 日時は文字列にする。Date のまま返すと運べず、画面には null が届く
    out.push({
      id: plainNumber(rows[i].id),
      reviewer: plainText(rows[i].reviewer),
      state: plainText(rows[i].state),
      body: plainText(rows[i].body),
      at: plainDate(rows[i].at),
      editedAt: plainDate(rows[i].editedAt),
      // 直せるかどうかは画面では決められない。書いた本人かをここで見る
      canEdit: String(rows[i].reviewer) === String(me) &&
        String(rows[i].state) === 'comment' &&
        Number(rows[i].id) > 0,
    });
  }
  return out;
}

/**
 * PRのソースブランチのコミットを新しい順で返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrCommits(number) {
  var pr = prGet(number);
  // 変更セットの全部の文書を見る。本文の [target-file] だけを見ていたため、
  // 2つ目以降の文書の記録が出なかった
  var targets = prTargetFiles(pr);
  var out = [];

  for (var t = 0; t < targets.length; t++) {
    var workFileId = branchWorkingFileId(pr.sourceBranch, targets[t]);
    if (!workFileId) continue;

    var mainRow = dbFindOne('files', 'fileId', targets[t]);
    var path = mainRow ? branchSplitPath_(mainRow.path).path : '';
    var commits = commitHistory(workFileId, pr.sourceBranch);

    for (var i = 0; i < commits.length; i++) {
      out.push({
        sha: plainText(commits[i].sha),
        message: plainText(commits[i].message),
        author: plainText(commits[i].author),
        timestamp: plainDate(commits[i].timestamp),
        path: plainText(path),
      });
    }
  }

  // 文書をまたいで新しい順。同じ時刻なら文書ごとの並び (親をたどった順) を保つ
  if (targets.length > 1) {
    out.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0; });
  }
  return out;
}
