
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
 * その確認依頼が反映しようとしている文書を返す。
 *
 * 確認依頼は**変更の集まり**である。1つの改訂で規程と細則の両方を直したら、
 * 確認も反映も1回で済まなければ、片方だけ反映された状態が作れてしまう。
 *
 * `targetFiles` 列が本体。この列を足す前の依頼は本文の `[target-file:...]`
 * にしか対象を持たないため、そこへ落とす。
 *
 * @param {object} pr pulls 行
 * @returns {string[]} 正式版の側の fileId
 */
function prTargetFiles(pr) {
  var raw = String((pr && pr.targetFiles) || '');
  var out = [];
  var seen = {};
  var parts = raw.split(',');

  for (var i = 0; i < parts.length; i++) {
    var one = parts[i].replace(/^\s+|\s+$/g, '');
    if (!one || seen[one]) continue;

    seen[one] = true;
    out.push(one);
  }
  if (out.length) return out;

  var old = prTargetFileId_(pr && pr.body);
  return old ? [old] : [];
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
function prCreate(title, body, sourceBranch, mainFileId, targetBranch) {
  // 1つでも配列でも受ける。呼ぶ側を一斉に直さなくても変更セットになる
  var wanted = [];
  var raw = Array.isArray(mainFileId) ? mainFileId : [mainFileId];
  var seenWanted = {};

  for (var w = 0; w < raw.length; w++) {
    var one = String(raw[w] || '');
    if (!one || seenWanted[one]) continue;

    seenWanted[one] = true;
    wanted.push(one);
  }
  if (!wanted.length) throw new Error('反映する文書を選んでください');

  if (!/^[\s\S]{1,200}$/.test(String(title || ''))) {
    throw new Error('タイトルを入力してください');
  }

  var branch = dbFindOne('branches', 'name', sourceBranch);
  if (!branch) throw new Error('ブランチが見つかりません: ' + sourceBranch);
  if (String(branch.state) !== 'open') {
    throw new Error('このブランチは既に閉じられています: ' + sourceBranch);
  }

  // 反映先。既定は正式版だが、改訂版どうしでも出せる。長い改訂を
  // 分けて進めるとき、途中の版に先に取り込めないと待ち行列ができる
  var into = String(targetBranch || 'main');
  if (into === String(sourceBranch)) {
    throw new Error('同じ版には反映できません: ' + into);
  }

  var intoRow = dbFindOne('branches', 'name', into);
  if (!intoRow) throw new Error('反映先の版が見つかりません: ' + into);
  if (String(intoRow.state) !== 'open') {
    throw new Error('反映先の版は既に閉じられています: ' + into);
  }

  for (var t = 0; t < wanted.length; t++) {
    var targetRow = dbFindOne('files', 'fileId', wanted[t]);
    if (!targetRow) throw new Error('対象ファイルが管理対象にありません');

    if (branchSplitPath_(targetRow.path).branch !== 'main') {
      throw new Error('正式版の文書を選んでください: ' + targetRow.path);
    }

    // Slides は書き戻せないため、PRを作らせない。閲覧・履歴・diff は使える。
    // fast-forward でコピーを採用する案は fileId が変わるため採らない
    if (String(targetRow.type) === 'slide') {
      throw new Error(
        'Slidesはマージに対応していません。履歴とdiffは見られますが、' +
        '反映はSlides上で直接行ってください'
      );
    }

    // その改訂版に入っていない文書は反映できない。作業コピーが無いと
    // 「何を反映するのか」が無い
    if (!branchWorkingFileId(sourceBranch, wanted[t])) {
      throw new Error(
        'その文書は「' + sourceBranch + '」に入っていません: ' + targetRow.path);
    }

    // 反映先が改訂版なら、そちらにも作業コピーが要る。無いまま作ると、
    // 開くたびに「反映先の版に作業コピーがありません」で落ちる依頼になる
    if (into !== 'main' && !branchWorkingFileId(into, wanted[t])) {
      throw new Error(
        'その文書は反映先の「' + into + '」に入っていません: ' + targetRow.path);
    }
  }

  /*
   * **あるかを見るところから書くまでを、1つの鍵の中で行う。** 分けると、
   * ほぼ同時の2件が「まだ無い」と読んで、同じ組の依頼が2つ開く。
   */
  var row = dbWithLock_(30000, function () {
    // 同じ組み合わせで二重に出さない。反映先が違えば別の依頼として出せる
    var existing = dbReadAll('pulls');
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].sourceBranch) !== String(sourceBranch)) continue;
      if (String(existing[i].targetBranch || 'main') !== into) continue;

      var st = String(existing[i].state);
      if (st === 'open' || st === 'approved') {
        throw new Error('この組み合わせには未クローズのPRがあります: #' + existing[i].number);
      }
    }

    var made = {
      title: title,
      // 対象ファイルを本文の末尾に記録する。pulls シートに列を増やさずに
      // 対象を辿れるようにするための最小限の措置
      body: (body || '') + '\n\n[target-file:' + wanted[0] + ']',
      targetFiles: wanted.join(','),
      sourceBranch: sourceBranch,
      targetBranch: into,
      state: 'open',
      author: Session.getActiveUser().getEmail(),
      createdAt: new Date(),
      mergedAt: '',
    };
    return dbAppendNumbered('pulls', 'number', made);
  });

  // PR本文の closes #N に対応するカードを In Review に動かす。
  // 人が動かさなくても文書の状態変化がボードに反映される (spec §6.2)
  var opened = prClosesIssues_(row.body);
  for (var k = 0; k < opened.length; k++) {
    projectMoveIfExists_(opened[k], 'In Review');
  }

  notifyPrCreated(row);
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
 * PRのapprove数を返す。人ごとに最後の判断が承認のものだけを1件と数える。
 *
 * Main.gs の apiPrPreview からも呼ぶため、末尾アンダースコアを付けない
 * (アンダースコアはファイル内部専用の目印という規約のため)。
 *
 * @param {number} number
 * @returns {number}
 */
function prApprovalCount(number) {
  var latest = prDecisions_(number);
  var count = 0;
  for (var k in latest) {
    if (!Object.prototype.hasOwnProperty.call(latest, k)) continue;
    if (latest[k] === 'approve') count++;
  }
  return count;
}

/**
 * 承認のあとに中身が変わって、数えなくなった承認の数を返す。
 *
 * Main.gs の apiPrPreview から呼ぶ。
 *
 * @param {number} number
 * @returns {number}
 */
function prStaleApprovalCount(number) {
  var latest = prDecisions_(number);
  var count = 0;
  for (var k in latest) {
    if (!Object.prototype.hasOwnProperty.call(latest, k)) continue;
    if (latest[k] === 'stale') count++;
  }
  return count;
}

/**
 * 人ごとの最後の判断 (approve / request_changes) を返す。
 *
 * **過去の承認を全部数えてはいけない。** 承認したあとに差し戻した人の
 * 承認まで数えると、差し戻されたまま反映できてしまう。ただのコメントは
 * 判断ではないので上書きしない。台帳は書いた順に並んでいる。
 *
 * @param {number} number
 * @returns {Object<string, string>} reviewer → 'approve' | 'request_changes' | 'stale'
 */
function prDecisions_(number) {
  var rows = dbReadAll('reviews');
  var stale = Number(prGet(number).staleReviewId) || 0;
  var latest = {};
  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;

    var state = String(rows[i].state);
    if (state !== 'approve' && state !== 'request_changes') continue;

    // 中身が変わる前の承認は、いまの中身を承認したものではない。差し戻しは
    // 古くしない。直したかどうかを決めるのは差し戻した人である
    if (state === 'approve' && Number(rows[i].id) <= stale) state = 'stale';
    latest[String(rows[i].reviewer)] = state;
  }
  return latest;
}

/**
 * 確認依頼の中身が変わったことを記録する。
 *
 * **承認は、承認した時点の中身にだけ効く。** 承認のあとに改訂版を直したり
 * 証跡を差し替えたりしても承認が残ると、読んで決めたものと違うものが
 * 「承認された」として反映され、手元にも取り込みを頼むことになる。
 *
 * 時刻では比べない。同じミリ秒に起きると前後が決まらない。確認の番号は
 * 通し番号なので、「ここまでに出た番号の承認は古い」と覚えておく。
 *
 * @param {object} pr pulls 行
 */
function prMarkChanged_(pr) {
  var state = String(pr.state);
  if (state !== 'open' && state !== 'approved') return;

  dbUpdate('pulls', 'number', pr.number, {
    staleReviewId: dbLastNumber_('reviews', 'id'),
    // 一覧の「承認済み」を残すと、承認し直しが要ることが伝わらない
    state: 'open',
  });
}

/**
 * 改訂版の文書が記録されたとき、それを対象にしている確認依頼を古くする。
 *
 * commitFile から呼ばれる。反映で別の改訂版に取り込んだときも、その版から
 * 出ている依頼の中身は変わるので同じ扱いになる。
 *
 * @param {string} branch
 * @param {string} fileId 記録した作業コピー
 */
function prSourceChanged_(branch, fileId) {
  if (String(branch) === 'main') return;

  var pulls = dbReadAll('pulls');
  for (var i = 0; i < pulls.length; i++) {
    if (String(pulls[i].sourceBranch) !== String(branch)) continue;

    var targets = prTargetFiles(pulls[i]);
    for (var t = 0; t < targets.length; t++) {
      if (String(branchWorkingFileId(branch, targets[t])) !== String(fileId)) continue;

      prMarkChanged_(pulls[i]);
      break;
    }
  }
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
function prPreviewMerge(number, wantFileId) {
  var pr = prGet(number);
  var branch = dbFindOne('branches', 'name', pr.sourceBranch);
  if (!branch) throw new Error('ブランチが見つかりません: ' + pr.sourceBranch);

  // 対象を指定しなければ1つ目を見る。変更セットの全件は prPreviewAll
  var mainFileId = String(wantFileId || '') || prTargetFiles(pr)[0];
  if (!mainFileId) throw new Error('PRの対象ファイルを特定できません');

  var into = prTargetBranch(pr);
  var intoFileId = prTargetBranchFileId(pr, mainFileId);

  var baseHtml = commitHtml(prMergeBase_(branch, into, mainFileId)) || '';

  var intoHead = headCommit(intoFileId, into);
  var oursHtml = intoHead ? (objectGet(intoHead.blobSha) || '') : '';

  var workFileId = branchWorkingFileId(pr.sourceBranch, mainFileId);
  if (!workFileId) throw new Error('ブランチの作業コピーが見つかりません');
  var branchHead = headCommit(workFileId, pr.sourceBranch);
  var theirsHtml = branchHead ? (objectGet(branchHead.blobSha) || '') : '';

  // 起点が空白の扱いを改める前の形でも、空白だけの違いを変更と読まない
  var result = merge3Html(
    prUpgradeBaseSpacing_(baseHtml, oursHtml, theirsHtml), oursHtml, theirsHtml);

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
    intoFileId: intoFileId,
    targetBranch: into,
    oursHtml: oursHtml,
  };
}

/**
 * 見比べに使う中身の指紋を返す。
 *
 * 反映先と改訂版の、それぞれの最後の記録の中身から取る。中身は空白の扱いを
 * そろえてから見るので、反映の直前に空白の扱いだけを記録し直しても変わらない。
 *
 * Main.gs の apiPrPreview からも呼ぶ。
 *
 * @param {number} number
 * @returns {string}
 */
function prPreviewFingerprint(number) {
  var pr = prGet(number);
  var into = prTargetBranch(pr);
  var targets = prTargetFiles(pr);
  var parts = [];

  function canon(head) {
    if (!head) return '';
    return sha256Hex(legacySpacingHtml(objectGet(head.blobSha) || ''));
  }

  for (var i = 0; i < targets.length; i++) {
    var intoHead = headCommit(prTargetBranchFileId(pr, targets[i]), into);
    var work = branchWorkingFileId(pr.sourceBranch, targets[i]);
    var workHead = work ? headCommit(work, pr.sourceBranch) : null;
    parts.push(targets[i] + ':' + canon(intoHead) + ':' + canon(workHead));
  }
  return sha256Hex(parts.join('\n'));
}

/**
 * 未記録の違いが空白の扱いだけなら、いまの形で記録し直す。
 *
 * @param {string|null} fileId
 * @param {string} branch
 * @returns {boolean} 記録していない変更が (空白の扱い以外に) 残っているか
 */
function prRecordSpacingOnly_(fileId, branch) {
  if (!fileId) return false;

  var status = fileStatus(fileId, branch);
  if (!status.dirty) return false;

  var head = headCommit(fileId, branch);
  if (!head || !commitOnlySpacing_(head, liveHtml(fileId))) return true;

  commitFile(fileId, branch, '空白の扱いを改めた記録 (中身は変わっていません)', null);
  return false;
}

/**
 * 起点の行を、空白の扱いをそろえた形に置き換える。
 *
 * 装飾の境目の空白を残すように改める前の記録は、空白が消えた形で残って
 * いる。起点がその形のまま見比べると、空白だけの違いが「こちらが変えた」
 * と読まれ、相手が直した段落が偽の食い違いになる。
 *
 * こちら (先に) か相手に、空白の扱い以外で同じ中身の行があれば、その行の
 * 形を起点の行として使う。同じ中身なので、見比べの結果は変わらない。
 *
 * @param {string} baseHtml
 * @param {string} oursHtml
 * @param {string} theirsHtml
 * @returns {string}
 */
function prUpgradeBaseSpacing_(baseHtml, oursHtml, theirsHtml) {
  var base = splitLines(baseHtml);
  var sides = splitLines(oursHtml).concat(splitLines(theirsHtml));
  var raw = {};
  var byCanon = {};

  for (var i = 0; i < sides.length; i++) {
    raw[sides[i]] = true;
    var key = prLineCanon_(sides[i]);
    if (!Object.prototype.hasOwnProperty.call(byCanon, key)) byCanon[key] = sides[i];
  }

  var out = [];
  for (var b = 0; b < base.length; b++) {
    var line = base[b];
    if (!raw[line]) {
      var k = prLineCanon_(line);
      if (Object.prototype.hasOwnProperty.call(byCanon, k)) line = byCanon[k];
    }
    out.push(line);
  }
  return linesToHtml_(out);
}

/**
 * 1行を、空白の扱いを比べない形にする。表の行は表として読む。
 *
 * @param {string} line
 * @returns {string}
 */
function prLineCanon_(line) {
  if (line.indexOf('<tr>') === 0) return legacySpacingHtml('<table>\n' + line + '\n</table>\n');
  if (line.indexOf('<table') === 0 || line === '</table>') return line;
  return legacySpacingHtml(line + '\n');
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
  prAssertReviewLength_(body);

  var pr = prGet(number);
  if (String(pr.state) === 'merged') throw new Error('このPRは既にマージ済みです');
  // 下で状態を書き換えるため、取り下げたものに通すと open / approved に
  // 生き返り、同じ組の依頼が2つ開く
  if (String(pr.state) === 'closed') throw new Error('この確認依頼は取り下げられています');

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
    // 後から直したり消したりするには、1件を名指しできる必要がある
    editedAt: '',
  };
  dbAppendNumbered('reviews', 'id', row);

  // 確認依頼のやりとりでも名前を呼べるようにする。報告の場だけ呼べても、
  // 話しているのが別の場所ならすれ違う
  var called = mentionResolve(row.body, prRoster_(pr));
  for (var c = 0; c < called.length; c++) {
    if (String(called[c]) === String(reviewer)) continue;
    notifyPrMention(pr, row, called[c]);
  }

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
  // 語の途中は拾わない。'discloses #3' で #3 を閉じると、身に覚えのない
  // やることが完了になる
  var re = /(^|[^A-Za-z0-9_])closes\s+#(\d+)/gi;
  var m;
  while ((m = re.exec(String(body || ''))) !== null) out.push(Number(m[2]));
  return out;
}

/**
 * Issueが存在すればカードを動かす。存在しなければ何もしない。
 *
 * PR本文の closes #N は人が手で書くため、番号が間違っていることがある。
 * 間違いでPR作成やマージを失敗させない。
 *
 * @param {number} issueNumber
 * @param {string} column
 */
function projectMoveIfExists_(issueNumber, column) {
  if (!dbFindOne('issues', 'number', issueNumber)) return;
  var item = dbFindOne('project_items', 'issueNumber', issueNumber);
  projectMove(issueNumber, column, item ? Number(item.order) : 0);
}

/**
 * 確認依頼を取り下げる。
 *
 * 出したあとに取り下げる道が無く、思い直したものや間違って出したものが
 * 開いたまま残り続けていた。左の帯の件数にも数えられるため、
 * 「見なければならないもの」が減らない。
 *
 * `closed` という状態は最初から定義されていて、画面にも「取り下げ」という
 * 言葉と、閉じたものには確認の欄を出さない作りが入っていた。**そこへ至る
 * 道だけが無かった。**
 *
 * **改訂版は捨てない。** 取り下げるのは「いま反映してよいか尋ねること」で
 * あって、直した中身ではない。捨てるかどうかは別に決める。
 *
 * **出すときにカードを「確認中」へ動かしているので、戻すときも戻す。**
 * 片方だけだと、誰も見ていない依頼のカードが確認中に居座る。戻す先は
 * 「作業中」にしてある。直したものは既にあるので、最初の列ではない。
 *
 * 反映済みのものは取り下げられない。書き戻しは終わっていて、取り消すには
 * 元に戻す記録を別に作るしかない。
 *
 * @param {number} number
 * @returns {object} 取り下げた pulls 行
 */
function prClose(number) {
  var pr = prGet(number);
  var state = String(pr.state);

  if (state === 'merged') {
    throw new Error(
      'これは既に反映済みです。取り消すには、戻す変更を新しく記録してください');
  }
  if (state === 'closed') throw new Error('これは既に取り下げられています');

  prAssertCanClose_(pr);

  dbUpdate('pulls', 'number', number, { state: 'closed' });

  // 出すときに動かしたぶんを戻す。片方だけだと確認中に居座る
  var linked = prClosesIssues_(pr.body);
  for (var i = 0; i < linked.length; i++) {
    projectMoveIfExists_(linked[i], 'In Progress');
  }

  notifyPrClosed(prGet(number));
  return prGet(number);
}

/**
 * 取り下げられる人かを確かめる。
 *
 * 出した本人と、このアプリを持っている人だけが取り下げられる。確認を
 * 頼まれた側が取り下げられると、頼んだ人の知らないうちに話が消える。
 *
 * @param {object} pr
 */
function prAssertCanClose_(pr) {
  var me = String(Session.getActiveUser().getEmail() || '');
  var owner = repoOwnerEmail();

  if (String(pr.author) === me) return;
  if (owner && String(owner) === me) return;

  throw new Error('出した本人か、このアプリの持ち主だけが取り下げられます');
}

/**
 * 食い違いの選択を、文書ごとに引ける形にする。
 *
 * 1ファイルだったころは配列1本で渡していた。変更セットでは文書ごとに
 * 分かれるため `{fileId: [...]}` で受ける。**古い形も通す。** 通さないと、
 * 画面を直すまでのあいだ解決した選択が届かず、選んだのに反映されない。
 *
 * @param {Array|Object} choices
 * @param {string[]} targets
 * @returns {Object<string, Array>}
 */
function prChoiceMap_(choices, targets) {
  if (!choices) return {};
  if (!Array.isArray(choices)) return choices;

  // 配列のときは1つ目の文書ぶんとして扱う
  var out = {};
  if (targets.length) out[targets[0]] = choices;
  return out;
}

/**
 * 変更セットの全件を見比べる。
 *
 * **1件ずつ押させない。** 確認する人は「この依頼を反映してよいか」を
 * 決めるのであって、ファイルごとに判断するわけではない。どれか1つでも
 * 書き戻せなければ、その依頼は反映できない。
 *
 * @param {number} number
 * @returns {{files:object[], clean:boolean, problems:string[]}}
 */
function prPreviewAll(number) {
  var pr = prGet(number);
  var targets = prTargetFiles(pr);

  // 文書が無く、コードの証跡だけの依頼もある。そこで投げると画面が開かない
  if (!targets.length && prHasPatches(number)) {
    return { files: [], clean: true, problems: [] };
  }
  if (!targets.length) throw new Error('PRの対象ファイルを特定できません');

  var out = [];
  var clean = true;
  var problems = [];

  for (var i = 0; i < targets.length; i++) {
    var row = dbFindOne('files', 'fileId', targets[i]);
    var one = prPreviewMerge(number, targets[i]);

    one.path = row ? branchSplitPath_(row.path).path : targets[i];
    one.type = row ? String(row.type) : 'doc';
    out.push(one);

    if (!one.clean) clean = false;
    for (var p = 0; p < one.problems.length; p++) {
      problems.push(one.path + ': ' + one.problems[p]);
    }
  }
  return { files: out, clean: clean, problems: problems };
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
function prMerge(number, choices, previewSha) {
  return dbWithLock_(60000, function () {
        var pr = prGet(number);
        if (String(pr.state) === 'merged') throw new Error('このPRは既にマージ済みです');
        if (String(pr.state) === 'closed') throw new Error('このPRは閉じられています');

        /*
         * **見比べたものを反映する。** 見比べてから押すまでに反映先か改訂版が
         * 進むと、食い違いが変わる。数がずれれば下で断られるが、数が同じで
         * 中身が違うと、選んだ「こちら/相手」が別の食い違いに当てはまり、
         * 見ていない結果で反映される。指紋を持たない呼び方は通す
         */
        if (previewSha && prPreviewFingerprint(number) !== String(previewSha)) {
          throw new Error(
            '見比べたあとで、反映先か改訂版が進みました。見比べ直してから反映してください');
        }

        var decisions = prDecisions_(number);
        if (prApprovalCount(number) < 1) {
          // 承認はあったが、そのあとに中身が変わった。黙って「承認が無い」と
          // 言うと、承認したはずの人が首をかしげる
          for (var sw in decisions) {
            if (!Object.prototype.hasOwnProperty.call(decisions, sw)) continue;
            if (decisions[sw] === 'stale') {
              throw new Error('承認のあとに中身が変わっています。もう一度確認して承認してもらってください');
            }
          }
          throw new Error('反映には1件以上の承認が必要です');
        }

        // 誰かが差し戻したままなら反映しない。別の人の承認で押し切れると、
        // 差し戻しが意味を持たない
        for (var who in decisions) {
          if (!Object.prototype.hasOwnProperty.call(decisions, who)) continue;
          if (decisions[who] === 'request_changes') {
            throw new Error(who + ' さんの差し戻しが残っています。直してもらうか、承認し直してもらってください');
          }
        }

        // main に未コミットの変更があるうちはマージしない。
        // マージ結果はコミット済みのHEADを ours として計算されるため、
        // 未コミットの編集はマージに参加できず、書き戻しで黙って
        // 上書きされてしまう。git が dirty な作業ツリーでのマージを
        // 拒むのと同じ理由による
        var targets = prTargetFiles(pr);

        /*
         * 文書が無く、コードの証跡だけの依頼もある。
         *
         * **その場合に断ってはいけない。** 断ると承認を記録する道が無くなり、
         * 「読んで納得したのにどこにも残らない」ことになる。書き戻すものが
         * 無いだけで、決めたこと自体は残す。
         */
        if (!targets.length && !prHasPatches(number)) {
          throw new Error('PRの対象ファイルを特定できません');
        }

        var into = prTargetBranch(pr);
        var choiceMap = prChoiceMap_(choices, targets);

        /*
         * ここから先の順序を崩してはならない。
         *
         *   1. 全件のマージ結果を作り、全件が書き戻せることを確かめる
         *   2. どれか1つでも駄目なら、何も変えずに中断する
         *   3. そのあとで、まとめて書き戻す
         *
         * **1件ずつ「検証して書く」を繰り返してはいけない。** 3件目で落ちた
         * とき、1件目と2件目だけ反映された状態が残り、確認を経ていない
         * 中途半端な正式版ができる。戻す手立ても無い。
         */
        var plan = [];

        for (var t = 0; t < targets.length; t++) {
          var mainRow = dbFindOne('files', 'fileId', targets[t]);
          var path = mainRow ? branchSplitPath_(mainRow.path).path : targets[t];
          var type = mainRow ? String(mainRow.type) : 'doc';
          var intoFileId = prTargetBranchFileId(pr, targets[t]);

          // 空白の扱いを改める前の記録のままなら、いまの形で記録し直す。
          // 中身は同じなので、何も編集していない人に退避を押させない
          prRecordSpacingOnly_(branchWorkingFileId(pr.sourceBranch, targets[t]),
            pr.sourceBranch);

          if (prRecordSpacingOnly_(intoFileId, into)) {
            throw new Error(
              '「' + (into === 'main' ? '正式版' : into) + '」の ' + path +
              ' に記録していない変更があります。先にそちらを記録してから' +
              '反映してください'
            );
          }

          var preview = prPreviewMerge(number, targets[t]);
          var lines = preview.clean
            ? preview.lines
            : resolveConflicts(
                { lines: preview.lines, conflicts: preview.conflicts },
                choiceMap[targets[t]] || []
              );

          var mergedHtml = linesToHtml_(lines);

          // 書き戻せるかを破壊的操作の前に必ず検証する。検証は種別ごとに違う
          var mergedBlocks = parseBlocks(mergedHtml);
          var problems = (type === 'sheet')
            ? sheetWriterValidate(mergedBlocks)
            : htmlWriterValidate(mergedBlocks);

          if (problems.length > 0) {
            throw new Error(
              path + ' のマージ結果を書き戻せません:\n' + problems.join('\n'));
          }

          plan.push({
            fileId: preview.intoFileId, html: mergedHtml, type: type, path: path,
            // 反映先と同じなら書き戻さない。変更セットには直していない文書も
            // 入りうる。書き戻すと記録が空になって commitFile が断り、前の
            // 文書だけ書き戻したところで止まる (やり直しても同じ所で落ちる)
            same: mergedHtml === preview.oursHtml,
          });
        }

        var mergeCommit = null;

        for (var k = 0; k < plan.length; k++) {
          var step = plan[k];
          if (step.same) continue;

          // 最後の砦。上の検査から書き戻しまでの間に誰かが Doc を編集した
          // 場合に備え、書き戻す直前にもう一度見て、変更があれば退避する。
          // 通常は上の検査で弾かれるためここは通らない
          if (fileStatus(step.fileId, into).dirty) {
            commitFile(step.fileId, into, '確認依頼 #' + number + ' を反映する前の退避', null);
          }

          writeHtmlToFile(step.fileId, step.html, step.type);
          liveCacheInvalidate(step.fileId);

          mergeCommit = commitFile(
            step.fileId,
            into,
            '反映: 確認依頼 #' + number + ' ' + pr.title,
            null
          );
        }

        dbUpdate('pulls', 'number', number, {
          state: 'merged',
          mergedAt: new Date(),
        });
        dbUpdate('branches', 'name', pr.sourceBranch, { state: 'merged' });

        /*
         * **コードの証跡は書き戻さない。** この道具はコードの版管理をしない。
         * ここで残るのは「読んで、進めてよいと決めた」記録だけで、実際に
         * 入れるのは手元の git である。
         *
         * 押したら入っていると思わせないよう、画面の断りにもそう書いてある。
         */

        // closes #N のIssueを閉じ、カードを Done に動かす
        var issues = prClosesIssues_(pr.body);
        for (var i = 0; i < issues.length; i++) {
          if (!dbFindOne('issues', 'number', issues[i])) continue;
          issueClose(issues[i], number);
          projectMoveIfExists_(issues[i], 'Done');
        }

        /*
         * コードの証跡が添えられていたなら、手元に取り込みを頼む。
         *
         * **ここで自動的に取り込んではいけない。** この道具はコードを書き換え
         * ないと決めてあるので、頼むところまでで止める。手元で人と Claude が
         * 見て進める。
         *
         * 頼めなくてもマージは成立している。通知と同じく、失敗で巻き戻さない
         */
        if (prHasPatches(number)) {
          try {
            outboxAdd('merge',
              { branch: String(pr.sourceBranch), into: String(into) },
              {
                prNumber: number,
                note: '確認依頼 #' + number + '「' + pr.title +
                  '」が承認されました。コードの変更を取り込んでください。',
              });
          } catch (e) {
            Logger.log('取り込みを頼めませんでした: ' + e.message);
          }
        }

        notifyPrMerged(pr);

        // 文書が無い依頼では書き戻しが無いので記録も無い。呼ぶ側が形で
        // 場合分けしないよう、何をしたのかを添えて返す
        return mergeCommit || {
          sha: '',
          message: '承認を記録しました (コードの変更は手元で進めてください)',
        };
  });
}

/**
 * 番号を持たないやりとりに番号を振る。
 *
 * 番号の列を足す前に書かれた行は空のままで、名指しできない。直そうと
 * すると「やりとりを指定してください」で止まる。読むたびに埋めておく。
 *
 * @returns {number} 埋めた件数
 */
function reviewBackfillIds_() {
  /*
   * **読んで決めて書くので、鍵の中で行う。**
   *
   * これは確認依頼を開くたびに走る。2人が同じ依頼を同時に開くと、どちらも
   * 同じ `max` を読んで、別の空欄に同じ番号を振る。あとから書いたほうが
   * 先のぶんを上書きするため、やりとりを1つ直したつもりで別のものが変わり、
   * 1つ消したつもりで2つ消える。
   */
  return dbWithLock_(30000, reviewBackfillIdsLocked_, function () { return 0; });
}

/**
 * 空欄の id を埋める本体。鍵を持った状態で呼ばれる。
 *
 * @returns {number} 埋めた数
 */
function reviewBackfillIdsLocked_() {
  var cols = DB_SCHEMA().reviews;
  var sheet = dbSheet_('reviews');
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var idCol = cols.indexOf('id') + 1;
  var values = sheet.getRange(2, idCol, last - 1, 1).getValues();

  var max = 0;
  for (var i = 0; i < values.length; i++) {
    var n = Number(values[i][0]);
    if (!isNaN(n) && n > max) max = n;
  }

  var filled = 0;
  for (var r = 0; r < values.length; r++) {
    if (values[r][0] !== '' && values[r][0] !== null && values[r][0] !== undefined) {
      continue;
    }
    values[r][0] = ++max;
    filled++;
  }

  if (filled) sheet.getRange(2, idCol, last - 1, 1).setValues(values);
  return filled;
}


/**
 * やりとりを1件返す。無ければエラー。
 *
 * @param {number} id
 * @returns {object} reviews 行
 */
function reviewGet(id) {
  if (id === '' || id === null || id === undefined) {
    throw new Error('やりとりを指定してください');
  }
  var row = dbFindOne('reviews', 'id', id);
  if (!row) throw new Error('やりとりが見つかりません: ' + id);
  return row;
}

/**
 * やりとりの長さを確かめる。
 *
 * 台帳のセルは5万字までで、超えると書き込みそのものが落ちる。差分を貼った
 * 長い指摘もあるので、やることの書き込み (4000字) より広く取ってある。
 *
 * @param {string} body
 */
function prAssertReviewLength_(body) {
  if (String(body || '').length > 20000) {
    throw new Error('内容は20000文字までにしてください');
  }
}

/**
 * 書いた本人かどうかを確かめる。
 *
 * 他人の発言を書き換えられると、やりとりの記録が信じられなくなる。
 *
 * @param {object} row reviews 行
 */
function reviewAssertOwn_(row) {
  var me = Session.getActiveUser().getEmail();
  if (String(row.reviewer) !== String(me)) {
    throw new Error('自分が書いたものだけ直せます');
  }
}

/**
 * 承認や差し戻しではなく、ただのコメントかを確かめる。
 *
 * 承認は判断であって発言ではない。消せてしまうと、承認が無かったことに
 * なったまま反映できてしまう。
 *
 * @param {object} row reviews 行
 */
function reviewAssertComment_(row) {
  if (String(row.state) !== 'comment') {
    throw new Error('承認や差し戻しの記録は直せません');
  }
}

/**
 * コメントを書き直す。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object} 直した後の行
 */
function reviewEdit(id, body) {
  var row = reviewGet(id);
  reviewAssertOwn_(row);
  reviewAssertComment_(row);

  if (!String(body || '').replace(/^\s+|\s+$/g, '')) {
    throw new Error('中身を入力してください');
  }
  prAssertReviewLength_(body);

  dbUpdate('reviews', 'id', id, { body: body, editedAt: new Date() });
  return reviewGet(id);
}

/**
 * コメントを消す。
 *
 * @param {number} id
 */
function reviewDelete(id) {
  var row = reviewGet(id);
  reviewAssertOwn_(row);
  reviewAssertComment_(row);

  dbDelete('reviews', 'id', id);
}

/**
 * 確認してもらう人を決める。
 *
 * 誰に頼んだのかが残らないと、依頼が宙に浮いたまま誰も見ない。
 *
 * @param {number} number PR番号
 * @param {string[]} emails
 * @returns {object} 更新後の pulls 行
 */
function prSetReviewers(number, emails) {
  var pr = prGet(number);
  if (String(pr.state) === 'merged') throw new Error('このPRは既に反映済みです');

  var seen = {};
  var list = [];

  for (var i = 0; i < (emails || []).length; i++) {
    var one = String(emails[i] || '').replace(/^\s+|\s+$/g, '');
    if (!one) continue;
    if (!/^[^\s,@]+@[^\s,@]+$/.test(one)) {
      throw new Error('メールアドレスの形になっていません: ' + one);
    }
    if (seen[one]) continue;
    seen[one] = true;
    list.push(one);
  }

  var before = prReviewers(pr);
  dbUpdate('pulls', 'number', number, { reviewers: list.join(',') });

  // 新しく頼んだ人にだけ知らせる。既に頼んである人に再送しない
  for (var j = 0; j < list.length; j++) {
    if (before.indexOf(list[j]) >= 0) continue;
    notifyPrReviewRequested(prGet(number), list[j]);
  }
  return prGet(number);
}

/**
 * 確認してもらう人の一覧を返す。
 *
 * @param {object} pr pulls 行
 * @returns {string[]}
 */
function prReviewers(pr) {
  var raw = String((pr && pr.reviewers) || '');
  var out = [];

  var parts = raw.split(',');
  for (var i = 0; i < parts.length; i++) {
    var one = parts[i].replace(/^\s+|\s+$/g, '');
    if (one) out.push(one);
  }
  return out;
}

/**
 * 確認依頼で名前を呼べる人の名簿。
 *
 * 誰でも呼べると、関わりのない人に知らせが飛ぶ。この道具に名前が
 * 出ている人だけにする。
 *
 * @param {object} pr pulls 行
 * @returns {string[]}
 */
function prRoster_(pr) {
  var seen = {};
  var out = [];

  function add(who) {
    var one = String(who || '');
    if (!one || seen[one]) return;
    seen[one] = true;
    out.push(one);
  }

  add(pr && pr.author);

  var reviewers = prReviewers(pr);
  for (var r = 0; r < reviewers.length; r++) add(reviewers[r]);

  var tables = [['commits', 'author'], ['reviews', 'reviewer'], ['issues', 'assignee']];
  for (var t = 0; t < tables.length; t++) {
    var rows = dbReadAll(tables[t][0]);
    for (var i = 0; i < rows.length; i++) add(rows[i][tables[t][1]]);
  }
  return out;
}

/**
 * 反映先の版の名前を返す。
 *
 * 反映先の列を足す前に作られた依頼は空なので、正式版と見なす。
 *
 * @param {object} pr pulls 行
 * @returns {string}
 */
function prTargetBranch(pr) {
  return String((pr && pr.targetBranch) || 'main');
}

/**
 * 反映先のファイルを返す。
 *
 * 正式版なら元のファイル、改訂版ならその版の作業コピー。
 *
 * @param {object} pr pulls 行
 * @param {string} mainFileId
 * @returns {string} fileId
 */
function prTargetBranchFileId(pr, mainFileId) {
  var into = prTargetBranch(pr);
  if (into === 'main') return mainFileId;

  var fileId = branchWorkingFileId(into, mainFileId);
  if (!fileId) throw new Error('反映先の版に作業コピーがありません: ' + into);

  return fileId;
}

/**
 * 3つを見比べるときの起点を返す。
 *
 * 版はそれぞれ正式版のどこかから分かれている。改訂版どうしを見比べる
 * ときは、両方の分かれ目のうち古いほうが共通の起点になる。新しいほうを
 * 使うと、片方にしか無い変更まで「相手が消した」と読めてしまう。
 *
 * @param {object} branch 出どころの branches 行
 * @param {string} into 反映先の版の名前
 * @returns {string} コミットの sha
 */
function prMergeBase_(branch, into, mainFileId) {
  // 起点は文書ごとに違う。改訂版に2つ目の文書を足したとき、1つ目を
  // 足した時点より正式版が進んでいることがある
  var mine = mainFileId
    ? branchBaseSha(branch.name, mainFileId) : String(branch.baseSha || '');

  if (String(into) === 'main') return mine;

  var yours = mainFileId
    ? branchBaseSha(into, mainFileId)
    : String((dbFindOne('branches', 'name', into) || {}).baseSha || '');

  if (!mine || !yours || mine === yours) return mine || yours;

  // 正式版の並びで後ろに出てくるほう (古いほう) が共通の起点。
  // 新しいほうを使うと、相手にまだ無い変更まで「相手が消した」と読め、
  // 黙って消える
  var chains = [];
  if (mainFileId) chains.push(commitHistory(mainFileId, 'main'));

  // 対象が分からない古い呼び出しのために、正式版の全文書を当たる形も残す
  var files = dbReadAll('files');
  for (var i = 0; i < files.length && !mainFileId; i++) {
    if (branchSplitPath_(files[i].path).branch !== 'main') continue;
    chains.push(commitHistory(files[i].fileId, 'main'));
  }

  for (var k = 0; k < chains.length; k++) {
    var chain = chains[k];
    var mineAt = -1;
    var yoursAt = -1;

    for (var c = 0; c < chain.length; c++) {
      if (String(chain[c].sha) === mine) mineAt = c;
      if (String(chain[c].sha) === yours) yoursAt = c;
    }
    if (mineAt < 0 || yoursAt < 0) continue;

    return mineAt > yoursAt ? mine : yours;
  }
  return mine;
}
