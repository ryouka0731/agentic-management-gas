/*
 * エディタで動かす確かめ (debug*) と、その手伝い。
 *
 * **末尾が _ でない関数は画面からも呼べる。** ここの debug* は最初に assertOwner_() を呼ぶ
 * (test/phase4-edit.test.js の「エディタ専用の関数は、持ち主以外には動かない」)。
 */

/**
 * 動作確認用のfileIdをスクリプトプロパティから読む。
 *
 * @returns {string}
 */
function debugFileId_() {
  var fileId = PropertiesService.getScriptProperties().getProperty('DEBUG_FILE_ID');
  if (!fileId) {
    throw new Error(
      'スクリプトプロパティ DEBUG_FILE_ID にテスト用DocのfileIdを設定してください'
    );
  }
  return fileId;
}

/**
 * DEBUG_FILE_ID のファイルを管理対象に登録する (動作確認用)。
 * パスは省略時にファイル名を使う。
 *
 * @returns {object} 登録された files 行
 */
function debugRegisterFile() {
  assertOwner_();
  var fileId = debugFileId_();
  var path = PropertiesService.getScriptProperties().getProperty('DEBUG_FILE_PATH')
    || DriveApp.getFileById(fileId).getName();
  var row = repoRegisterFile(fileId, path);
  Logger.log('登録しました: ' + JSON.stringify(row));
  return row;
}

/**
 * レンダラの動作確認用。GASエディタから実行し、ログで出力を確認する。
 *
 * 使い方: DEBUG_FILE_ID にテスト用DocのfileIdを設定してから実行する。
 *
 * @returns {string} 正規化HTML
 */
function debugRenderDoc() {
  assertOwner_();
  var html = renderDoc(debugFileId_());
  Logger.log(html);
  return html;
}

/**
 * ライブキャッシュの動作確認用。1回目(レンダリング)と2回目(キャッシュ)の
 * 所要時間を比較する。
 */
function debugLiveHtml() {
  assertOwner_();
  var fileId = debugFileId_();

  var t1 = new Date().getTime();
  var a = liveHtml(fileId);
  var t2 = new Date().getTime();
  var b = liveHtml(fileId);
  var t3 = new Date().getTime();

  Logger.log('1回目(レンダリング): ' + (t2 - t1) + 'ms');
  Logger.log('2回目(キャッシュ):   ' + (t3 - t2) + 'ms');
  Logger.log('内容が一致: ' + (a === b));
  Logger.log('長さ: ' + a.length);
  Logger.log('--- HTML ---');
  Logger.log(a);
}

/**
 * 1つのプローブを実行し、成功値かエラーメッセージをログに出す。
 *
 * @param {string} label
 * @param {function} fn
 */
function probe_(label, fn) {
  try {
    Logger.log('    ' + label + ' => OK: ' + fn());
  } catch (e) {
    Logger.log('    ' + label + ' => ERROR: ' + e.message);
  }
}

/**
 * 画像要素の診断。docExtractImages_ の getBlob() が
 * "Invalid argument: imageId" で落ちる原因を切り分けるために使う。
 *
 * メタデータが取れてバイト列だけ取れないのか、要素自体が壊れているのかを
 * 判別する。
 */
function debugInspectImages() {
  assertOwner_();
  var body = DocumentApp.openById(debugFileId_()).getBody();
  var ET = DocumentApp.ElementType;
  var n = body.getNumChildren();
  Logger.log('body の子要素数: ' + n);

  var found = 0;
  for (var i = 0; i < n; i++) {
    var el = body.getChild(i);
    var t = el.getType();
    if (t !== ET.PARAGRAPH && t !== ET.LIST_ITEM) continue;

    var para = (t === ET.PARAGRAPH) ? el.asParagraph() : el.asListItem();

    // 段落に紐づく PositionedImage (テキスト折り返し配置の画像)
    var positioned = para.getPositionedImages();
    if (positioned && positioned.length) {
      found++;
      Logger.log('body[' + i + '] PositionedImage が ' + positioned.length + ' 個');
      var pimg = positioned[0];
      probe_('positioned.getId()', function () { return pimg.getId(); });
      probe_('positioned.getBlob().getContentType()', function () {
        return pimg.getBlob().getContentType();
      });
      probe_('positioned.getBlob().getBytes().length', function () {
        return pimg.getBlob().getBytes().length;
      });
    }

    var cn = para.getNumChildren();
    for (var j = 0; j < cn; j++) {
      var child = para.getChild(j);
      var ct = child.getType();
      if (ct !== ET.INLINE_IMAGE && ct !== ET.INLINE_DRAWING) continue;

      found++;
      Logger.log('body[' + i + '] child[' + j + '] type=' + ct);

      if (ct === ET.INLINE_DRAWING) {
        Logger.log('    → INLINE_DRAWING (図形描画)。getBlob() は存在しない');
        continue;
      }

      var img = child.asInlineImage();
      probe_('getWidth()', function () { return img.getWidth(); });
      probe_('getHeight()', function () { return img.getHeight(); });
      probe_('getAltTitle()', function () { return img.getAltTitle(); });
      probe_('getAltDescription()', function () { return img.getAltDescription(); });
      probe_('getLinkUrl()', function () { return img.getLinkUrl(); });
      probe_('getBlob().getContentType()', function () {
        return img.getBlob().getContentType();
      });
      probe_('getBlob().getBytes().length', function () {
        return img.getBlob().getBytes().length;
      });
    }
  }

  if (found === 0) Logger.log('画像要素が1つも見つかりませんでした');
  Logger.log('--- 診断終了 ---');
}

/**
 * 以前に Sheets が字を日付や数に変えてしまった台帳のセルを、実行ログに出す。
 *
 * 字を ' 付きで書くようにする前 (dbCell_) は、題名や記録の文の '1/2' が日付に、
 * '007' が 7 に変わって台帳に入った。**元の字は残っていないので戻せない。**
 * どこにあるかを挙げるので、直すのは人が台帳を開いて行う。
 *
 * 字の欄かどうかは列の名前で見分ける (dbTextColumn_)。数字だけの題名のように、
 * 元から数だった字も挙がるので、見て判断すること。
 *
 * @returns {string} 実行ログに出したもの
 */
function debugFindConvertedCells() {
  assertOwner_();
  var schema = DB_SCHEMA();
  var lines = ['字の欄に入っている日付・数 (表 / 行 / 列 / いまの値)', ''];
  var count = 0;

  for (var table in schema) {
    if (!Object.prototype.hasOwnProperty.call(schema, table)) continue;
    var cols = schema[table];
    var rows = dbReadAll(table);

    for (var r = 0; r < rows.length; r++) {
      var label = rows[r].number !== undefined && rows[r].number !== ''
        ? '#' + rows[r].number
        : (rows[r].id !== undefined && rows[r].id !== '' ? 'id ' + rows[r].id : (r + 1) + '件目');

      for (var c = 0; c < cols.length; c++) {
        if (!dbTextColumn_(cols[c])) continue;
        var v = rows[r][cols[c]];
        var kind = '';
        if (Object.prototype.toString.call(v) === '[object Date]') kind = '日付になっています';
        else if (typeof v === 'number') kind = '数になっています (元が数字だけの字なら問題ありません)';
        else if (typeof v === 'boolean') kind = '真偽になっています';
        if (!kind) continue;

        lines.push(table + ' / ' + label + ' / ' + cols[c] + ' / ' +
          (kind.charAt(0) === '日' ? plainDay(v) : String(v)) + '  — ' + kind);
        count++;
      }
    }
  }

  if (!count) lines.push('見つかりませんでした');
  var text = lines.join('\n');
  Logger.log(text);
  return text;
}

/**
 * 台帳の列が「字の欄」か。日時・番号・量・真偽の列でなければ字の欄とする。
 *
 * @param {string} name 列の名前
 * @returns {boolean}
 */
function dbTextColumn_(name) {
  if (/At$|^at$|^day$|Date$|^timestamp$/.test(name)) return false;
  if (/^(number|id|count|order|estimate|plannedHours|actualHours|linkedPr|parent|added|removed|staleReviewId|builtin|points)$|Number$/.test(name)) return false;
  // 変更の履歴の前と後は、数だけの字 ('5') が数として残る決まり。化けたのではない
  if (name === 'before' || name === 'after') return false;
  return true;
}

/**
 * 既存リポジトリに main ブランチ行が無い場合に補う (移行用)。
 * repoInit を実行済みの環境で1回だけ実行する。
 *
 * @returns {string} 実行結果
 */
function debugEnsureMainBranch() {
  assertOwner_();
  // 1日1回の片付けでも入るので、通常は実行しなくてよい
  return repoEnsureMainBranch() ? 'main ブランチを追加しました' : 'main ブランチは既に存在します';
}

/**
 * 改訂版の作業コピーを、fileId と一緒に実行ログへ出す。
 *
 * debugWriteRoundTrip は、書き換えてよい作業コピーの fileId をスクリプト
 * プロパティ DEBUG_WRITE_FILE_ID に要る。画面から URL を写す手順は手間が
 * かかるので、エディタから一覧を出せるようにした。**書き換える対象は人が
 * 選ぶ。** 勝手に選ぶと、使っている改訂版を書き換えかねない。
 *
 * @returns {string} 実行ログに出したもの
 */
function debugListWorkingCopies() {
  assertOwner_();
  var rows = dbReadAll('files');
  var present = filesPresentInDrive_(rows);
  var deleted = branchDeletedNames();
  var lines = ['改訂版の作業コピー (改訂版 / 文書 / fileId)', ''];
  var count = 0;

  for (var i = 0; i < rows.length; i++) {
    var parts = branchSplitPath_(rows[i].path);
    if (parts.branch === 'main' || deleted[parts.branch]) continue;

    var id = String(rows[i].fileId);
    lines.push(parts.branch + ' / ' + parts.path + ' / ' + id +
      (present[id] ? '' : '  (Drive に無い)'));
    count++;
  }

  if (!count) lines.push('作業コピーがありません。画面で改訂版を1つ作ってください');
  lines.push('');
  lines.push('書き換えてよいものを1つ選び、プロジェクトの設定 → スクリプト プロパティに');
  lines.push('DEBUG_WRITE_FILE_ID という名前で fileId を入れてから、debugWriteRoundTrip() を');
  lines.push('実行してください。選んだ文書は本当に書き換わります。');

  var text = lines.join('\n');
  Logger.log(text);
  return text;
}

/**
 * 書き戻しの往復検証。Phase 2 で最も重要な検証。
 *
 * Doc → HTML → Doc → HTML と往復させ、2つのHTMLが一致すれば
 * 書き戻しが情報を落としていないことになる。
 *
 * 破壊的操作を含むため、必ずブランチの作業コピーに対して実行すること。
 * DEBUG_WRITE_FILE_ID に対象を設定する。
 */
function debugWriteRoundTrip() {
  assertOwner_();
  var fileId = PropertiesService.getScriptProperties()
    .getProperty('DEBUG_WRITE_FILE_ID');
  if (!fileId) {
    throw new Error(
      'スクリプトプロパティ DEBUG_WRITE_FILE_ID に、' +
      '書き戻してよい作業コピーのfileIdを設定してください。' +
      '候補は debugListWorkingCopies() で出せます'
    );
  }

  var before = renderDoc(fileId);
  Logger.log('書き戻し前の長さ: ' + before.length);

  var problems = htmlWriterValidate(parseBlocks(before));
  if (problems.length > 0) {
    Logger.log('検証で問題が見つかりました:\n' + problems.join('\n'));
    return;
  }

  writeHtmlToDoc(fileId, before);
  liveCacheInvalidate(fileId);

  var after = renderDoc(fileId);
  Logger.log('書き戻し後の長さ: ' + after.length);

  if (before === after) {
    Logger.log('往復一致: OK — 書き戻しは情報を落としていません');
    return;
  }

  Logger.log('往復不一致: 差分は以下のとおり');
  var ops = diffHtml(before, after);
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].type === 'equal') continue;
    Logger.log('  ' + (ops[i].type === 'insert' ? '+ ' : '- ') + ops[i].line);
  }
}

/**
 * 自己承認の許可を切り替える (検証用)。
 *
 * 1人で PoC を検証するときは承認者を確保できずマージまで到達できないため、
 * スクリプトプロパティ ALLOW_SELF_APPROVE を一時的に立てる。
 * 本番運用に移す前に必ず debugDisableSelfApprove() で戻すこと。
 *
 * @returns {string}
 */
function debugEnableSelfApprove() {
  assertOwner_();
  PropertiesService.getScriptProperties().setProperty('ALLOW_SELF_APPROVE', 'true');
  return '自己承認を許可しました (検証用)。検証後は debugDisableSelfApprove() で戻すこと';
}

/**
 * 自己承認の許可を取り消す。
 *
 * @returns {string}
 */
function debugDisableSelfApprove() {
  assertOwner_();
  PropertiesService.getScriptProperties().deleteProperty('ALLOW_SELF_APPROVE');
  return '自己承認を禁止に戻しました';
}

/**
 * 直近の検証実行の記録を保存するスクリプトプロパティのキー。
 *
 * @returns {string}
 */
function LAST_VERIFY_RUN_KEY() {
  return 'lastVerifyRun';
}

/**
 * 直近の debugVerifyPhase2() が残した検証物を片付ける。
 *
 * 検証が失敗すると調査のために Doc・ブランチ・PR が残る。
 * 末尾アンダースコアの関数は GAS エディタの実行対象に出ないため、
 * 引数なしで呼べる入口をここに用意する。
 *
 * @returns {string}
 */
function debugCleanupLastVerify() {
  assertOwner_();
  var raw = PropertiesService.getScriptProperties().getProperty(LAST_VERIFY_RUN_KEY());
  if (!raw) return '片付ける検証物はありません';

  var run = JSON.parse(raw);
  debugCleanupVerify_(run.tag, run.mainFileId, run.workFileId, run.prNumber, run.issueNumber);
  PropertiesService.getScriptProperties().deleteProperty(LAST_VERIFY_RUN_KEY());
  return '検証物を片付けました: ' + raw;
}

/**
 * 指定した書き出しで始まる段落を探し、本文を置き換える。
 *
 * 検証ハーネスが Doc を機械的に編集するために使う。
 * 段落インデックスではなく本文の先頭一致で探すのは、レンダリング側の
 * 空段落の扱いに依存させないため。
 *
 * @param {string} fileId
 * @param {string} prefix 探す段落の先頭文字列
 * @param {string} newText 置き換える本文
 * @returns {boolean} 置き換えたら true
 */
function debugEditParagraph_(fileId, prefix, newText) {
  var doc = DocumentApp.openById(fileId);
  var paragraphs = doc.getBody().getParagraphs();
  var hit = false;

  for (var i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].getText().indexOf(prefix) !== 0) continue;
    paragraphs[i].setText(newText);
    hit = true;
    break;
  }

  doc.saveAndClose();
  liveCacheInvalidate(fileId);
  return hit;
}

/**
 * 検証で作った Doc・ブランチ・PR・メタDBの行を片付ける。
 *
 * @param {string} tag ブランチ名 兼 検証タグ
 * @param {string|null} mainFileId
 * @param {string|null} workFileId
 * @param {number|null} prNumber
 * @param {number|null} [issueNumber]
 */
function debugCleanupVerify_(tag, mainFileId, workFileId, prNumber, issueNumber) {
  // 確認依頼を先に消す。開いた依頼が残っていると branchDelete が断り、作業
  // コピーがゴミ箱に入らないまま、下で台帳の行だけ消えて Drive に置き去りになる
  if (prNumber) {
    dbDelete('pulls', 'number', prNumber);
    dbDelete('reviews', 'prNumber', prNumber);
  }

  // branchDelete は files 行を prefix で辿って作業コピーをゴミ箱に入れる。
  // workFileId が解決できなかった場合こそ呼ぶ必要があるため、
  // workFileId の有無で条件分岐してはいけない
  if (tag && dbFindOne('branches', 'name', tag)) {
    try {
      branchDelete(tag);
    } catch (e) {
      Logger.log('ブランチを削除できません: ' + e.message);
    }
  }
  if (workFileId) {
    dbDelete('files', 'fileId', workFileId);
    dbDelete('commits', 'fileId', workFileId);
  }
  if (tag) dbDelete('branches', 'name', tag);

  if (issueNumber) {
    dbDelete('issues', 'number', issueNumber);
    dbDelete('project_items', 'issueNumber', issueNumber);
  }

  if (mainFileId) {
    dbDelete('files', 'fileId', mainFileId);
    dbDelete('commits', 'fileId', mainFileId);
    try {
      DriveApp.getFileById(mainFileId).setTrashed(true);
    } catch (e2) {
      Logger.log('検証用Docを削除できません: ' + e2.message);
    }
  }
}

/**
 * 検証の間だけ自己承認を許し、終わったら元の設定に戻す。
 *
 * 検証ハーネスが「事前に debugEnableSelfApprove() を実行しておくこと」を
 * 人に強いていたが、忘れると承認の手前で必ず落ちて検証物が残る。
 * ハーネス自身が面倒を見る。
 *
 * @param {function} fn 検証本体
 * @returns {*} fn の戻り値
 */
function withSelfApprove_(fn) {
  var props = PropertiesService.getScriptProperties();
  var previous = props.getProperty('ALLOW_SELF_APPROVE');
  props.setProperty('ALLOW_SELF_APPROVE', 'true');

  try {
    return fn();
  } finally {
    if (previous === null) props.deleteProperty('ALLOW_SELF_APPROVE');
    else props.setProperty('ALLOW_SELF_APPROVE', previous);
  }
}

/**
 * Phase 2 の受け入れ検証をサーバ側で通しで実行する (計画書 Task 9 の Step 2/4)。
 *
 * 使い捨ての Doc を1つ作り、コンフリクトの発生 → 解決 → マージ →
 * main への書き戻し → 楽観的並行制御までを一度に確認する。
 * 既存の管理対象ファイルには一切触れない。
 *
 * 自己承認は検証の間だけ自動で許可し、終わったら元の設定に戻す。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyPhase2() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  var tag = 'verify-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  var mainFileId = null;
  var workFileId = null;
  var prNumber = null;

  try {
    // --- 使い捨ての検証用 Doc を作り、main に登録して初期コミットする ---
    var doc = DocumentApp.create('【Phase2検証】' + tag);
    mainFileId = doc.getId();
    var body = doc.getBody();
    body.appendParagraph('第1条 目的');
    body.appendParagraph('この文書は Phase 2 の自動検証のために作られた使い捨ての文書である。');
    body.appendParagraph('第2条 勤務時間');
    body.appendParagraph('始業は9時、終業は18時とする。');
    doc.saveAndClose();

    var file = DriveApp.getFileById(mainFileId);
    file.moveTo(DriveApp.getFolderById(repoConfig().mainId));

    repoRegisterFile(mainFileId, tag + '.doc');
    liveCacheInvalidate(mainFileId);
    commitFile(mainFileId, 'main', '検証用ドキュメントの初期状態', null);
    check('検証用Docをmainに登録して初期コミットできた', !!headCommit(mainFileId, 'main'));

    // --- ブランチを作る (Doc の作業コピーができる) ---
    branchCreate(tag, mainFileId);
    workFileId = branchWorkingFileId(tag, mainFileId);
    check('ブランチの作業コピーが作られた', !!workFileId, String(workFileId));

    // --- 同じ行をブランチ側と main 側で別々に書き換える ---
    check(
      'ブランチ側の同一行を書き換えた',
      debugEditParagraph_(workFileId, '第2条', '第2条 勤務時間 (ブランチ側の変更)')
    );
    commitFile(workFileId, tag, 'ブランチ側で勤務時間を変更', null);

    check(
      'main側の同一行を書き換えた',
      debugEditParagraph_(mainFileId, '第2条', '第2条 勤務時間 (main側の変更)')
    );
    commitFile(mainFileId, 'main', 'main側で勤務時間を変更', null);

    // --- PR を作り、コンフリクトとして検出されることを確認する ---
    var pr = prCreate('検証PR ' + tag, '自動検証で作成', tag, mainFileId);
    prNumber = pr.number;

    var preview = prPreviewMerge(prNumber);
    check(
      '同一行の相反する変更がコンフリクトとして検出された',
      preview.clean === false && preview.conflicts.length >= 1,
      'clean=' + preview.clean + ' conflicts=' + preview.conflicts.length
    );

    // --- 取得不能な画像を含む書き戻しが拒否されることを確認する (Step 3 の中核) ---
    var imgProblems = htmlWriterValidate([{ type: 'image', sha: 'unavailable', alt: 'x' }]);
    check(
      '実体を取得できない画像は書き戻し検証で拒否される',
      imgProblems.length === 1 && imgProblems[0].indexOf('実体を取得できない画像') >= 0,
      imgProblems.join(' / ')
    );

    // --- 承認する (自己承認の許可が要る) ---
    withSelfApprove_(function () {
      prReview(prNumber, 'approve', '自動検証による承認');
    });
    check('承認が記録された', prApprovalCount(prNumber) >= 1);

    // --- ブランチ側を採用してマージする ---
    var shaBeforeMerge = headCommit(mainFileId, 'main').sha;
    var choices = [];
    for (var c = 0; c < preview.conflicts.length; c++) choices.push('theirs');
    prMerge(prNumber, choices);

    liveCacheInvalidate(mainFileId);
    var merged = renderDoc(mainFileId);
    check('mainにブランチ側の内容が書き戻された', merged.indexOf('ブランチ側の変更') >= 0);
    check('main側の内容は採用されていない', merged.indexOf('main側の変更') < 0);
    // getFileById(id).getId() === id は常に真なので検証にならない。
    // 確かめたいのは「別のDocに差し替わっていないこと」なので、
    // files 行が同じ fileId を指したままか、Doc が生きているかを見る
    var fileRow = dbFindOne('files', 'fileId', mainFileId);
    check('mainのファイル行が同じfileIdを指したままである',
      !!fileRow && String(fileRow.path) === tag + '.doc',
      fileRow ? String(fileRow.path) : '行なし');
    check('書き戻し先のDocがゴミ箱に入っていない',
      DriveApp.getFileById(mainFileId).isTrashed() === false);
    check('マージ後もmainの他の行が残っている', merged.indexOf('第1条 目的') >= 0);

    // --- 楽観的並行制御: 古い headSha でのコミットは拒否される ---
    debugEditParagraph_(mainFileId, '第1条', '第1条 目的 (並行制御の検証)');

    var rejected = '';
    try {
      commitFile(mainFileId, 'main', '古いHEADからのコミット', shaBeforeMerge);
    } catch (e3) {
      rejected = e3.message;
    }
    check('古いHEADでのコミットが拒否された',
      rejected.indexOf('ほかの記録が先に入りました') >= 0, rejected);

    var accepted = true;
    var acceptedMsg = '';
    try {
      commitFile(mainFileId, 'main', '最新HEADからのコミット',
        headCommit(mainFileId, 'main').sha);
    } catch (e4) {
      accepted = false;
      acceptedMsg = e4.message;
    }
    check('最新HEADでのコミットは成功する', accepted, acceptedMsg);
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  PropertiesService.getScriptProperties().setProperty(
    LAST_VERIFY_RUN_KEY(),
    JSON.stringify({ tag: tag, mainFileId: mainFileId, workFileId: workFileId, prNumber: prNumber })
  );

  if (failed === 0) {
    debugCleanupVerify_(tag, mainFileId, workFileId, prNumber);
    PropertiesService.getScriptProperties().deleteProperty(LAST_VERIFY_RUN_KEY());
    log.push('検証物を片付けました (Doc・ブランチ・PR・メタDBの行)');
  } else {
    log.push(
      '失敗したため検証物を残しました: doc=' + mainFileId +
      ' branch=' + tag + ' pr=' + prNumber +
      ' — 調査後に debugCleanupLastVerify() を実行して片付けること'
    );
  }

  var summary = (failed === 0)
    ? 'すべて PASS (' + log.length + '行)'
    : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}

/**
 * Phase 3b の受け入れ検証をサーバ側で通しで実行する。
 *
 * 使い捨ての Doc を1つ作り、Issue作成 → ボード配置 → ブランチ作成 →
 * PR作成 → 承認 → マージ までを実行して、Issueのクローズとカードの
 * 自動移動を判定する。既存の管理対象ファイルには触れない。
 *
 * 自己承認は検証の間だけ自動で許可し、終わったら元の設定に戻す。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyPhase3b() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  function columnOf(board, issueNumber) {
    var cols = PROJECT_COLUMNS();
    for (var i = 0; i < cols.length; i++) {
      for (var j = 0; j < board[cols[i]].length; j++) {
        if (Number(board[cols[i]][j].issueNumber) === Number(issueNumber)) return cols[i];
      }
    }
    return '(未配置)';
  }

  var tag = 'verify3b-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  var mainFileId = null;
  var branchName = null;
  var prNumber = null;
  var issueNumber = null;

  try {
    var doc = DocumentApp.create('【Phase3b検証】' + tag);
    mainFileId = doc.getId();
    doc.getBody().appendParagraph('第1条 目的');
    doc.saveAndClose();

    var file = DriveApp.getFileById(mainFileId);
    file.moveTo(DriveApp.getFolderById(repoConfig().mainId));

    repoRegisterFile(mainFileId, tag + '.doc');
    liveCacheInvalidate(mainFileId);
    commitFile(mainFileId, 'main', '検証用ドキュメントの初期状態', null);

    // --- Issue を作ると Backlog に載る ---
    var issue = apiIssueCreate('第3条を追加する', '自動検証', [mainFileId]);
    issueNumber = issue.number;
    check('Issueを作るとBacklogに載る',
      columnOf(apiProjectBoard(), issueNumber) === 'Backlog',
      columnOf(apiProjectBoard(), issueNumber));

    check('文書に紐づくopen Issueとして引ける',
      apiIssuesForFile(mainFileId).length === 1);

    // --- Issue からブランチを作ると In Progress に動く ---
    var branch = apiIssueCreateBranch(issueNumber, mainFileId);
    branchName = branch.name;
    check('ブランチ名がissue-<番号>-<題名>になる',
      branchName === issueBranchName(issueNumber, issue.title), branchName);
    check('ブランチ作成でIn Progressに動く',
      columnOf(apiProjectBoard(), issueNumber) === 'In Progress',
      columnOf(apiProjectBoard(), issueNumber));

    // --- ブランチ側を編集してコミット ---
    var workFileId = branchWorkingFileId(branchName, mainFileId);
    debugEditParagraph_(workFileId, '第1条', '第1条 目的 (改訂)');
    commitFile(workFileId, branchName, 'ブランチ側の変更', null);

    // --- PR を作ると In Review に動く ---
    var pr = prCreate('第3条を追加する', 'closes #' + issueNumber, branchName, mainFileId);
    prNumber = pr.number;
    check('PR作成でIn Reviewに動く',
      columnOf(apiProjectBoard(), issueNumber) === 'In Review',
      columnOf(apiProjectBoard(), issueNumber));

    // --- マージすると Issue が閉じ、Done に動く ---
    withSelfApprove_(function () {
      prReview(prNumber, 'approve', '自動検証による承認');
    });
    prMerge(prNumber, []);

    check('マージでIssueがクローズされる', issueGet(issueNumber).state === 'closed');
    check('IssueにPR番号が記録される',
      Number(issueGet(issueNumber).linkedPr) === Number(prNumber));
    check('マージでDoneに動く',
      columnOf(apiProjectBoard(), issueNumber) === 'Done',
      columnOf(apiProjectBoard(), issueNumber));
    check('クローズ後は文書に紐づくopen Issueから消える',
      apiIssuesForFile(mainFileId).length === 0);
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  PropertiesService.getScriptProperties().setProperty(
    LAST_VERIFY_RUN_KEY(),
    JSON.stringify({
      tag: branchName,
      mainFileId: mainFileId,
      workFileId: branchName ? branchWorkingFileId(branchName, mainFileId) : null,
      prNumber: prNumber,
      issueNumber: issueNumber,
    })
  );

  if (failed === 0) {
    debugCleanupVerify_(
      branchName,
      mainFileId,
      branchName ? branchWorkingFileId(branchName, mainFileId) : null,
      prNumber,
      issueNumber
    );
    PropertiesService.getScriptProperties().deleteProperty(LAST_VERIFY_RUN_KEY());
    log.push('検証物を片付けました (Doc・ブランチ・PR・Issue・カード)');
  } else {
    log.push(
      '失敗したため検証物を残しました: doc=' + mainFileId +
      ' branch=' + branchName + ' pr=' + prNumber + ' issue=' + issueNumber +
      ' — 調査後に debugCleanupLastVerify() を実行して片付けること'
    );
  }

  var summary = (failed === 0) ? 'すべて PASS (' + log.length + '行)' : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}

/**
 * 実際の文書で Markdown の往復を確認する。
 *
 * 編集画面は「HTML → Markdown → 編集 → Markdown → HTML」と流れるため、
 * 何も編集しなければ元の HTML に戻らなければならない。戻らない場合、
 * 開いて保存しただけで差分が出る。
 *
 * DEBUG_FILE_ID に対象の fileId を設定してから実行する。
 *
 * @returns {string} 判定結果
 */
function debugMarkdownRoundTrip() {
  assertOwner_();
  var fileId = debugFileId_();
  var before = liveHtml(fileId);
  var md = blocksToMd(parseBlocks(before));
  var after = serializeBlocks(mdToBlocks(md));

  Logger.log('--- Markdown ---');
  Logger.log(md);

  if (before === after) {
    Logger.log('往復一致: OK — 開いて保存しても差分は出ません');
    return '往復一致: OK (' + before.length + '文字)';
  }

  Logger.log('往復不一致: 差分は以下のとおり');
  var ops = diffHtml(before, after);
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].type === 'equal') continue;
    Logger.log('  ' + (ops[i].type === 'insert' ? '+ ' : '- ') + ops[i].line);
  }
  return '往復不一致 — ログの差分を確認してください';
}

/**
 * コマンドキューが実際に動くかを確かめる。
 *
 * 命令を1件置いて processCommandQueue() を呼び、結果を判定して片付ける。
 * トリガーの設置とは独立に、実行経路だけを確かめられる。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyCommandQueue() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
  }

  var id = 'verify-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  var queue = commandQueueFolder_();
  // 手で回すと回った時刻が今になる。終わったら戻す (止まったトリガーを隠さない)
  var lastRunBefore = PropertiesService.getScriptProperties().getProperty('QUEUE_LAST_RUN');

  try {
    queue.createFile(
      id + '.cmd.json',
      JSON.stringify({ op: 'listFiles', args: {} }),
      MimeType.PLAIN_TEXT
    );
    check('命令ファイルを置けた', true);

    processCommandQueue();

    var it = queue.getFilesByName(id + '.result.json');
    check('結果ファイルが書き出された', it.hasNext());

    if (it.hasNext()) {
      var resultFile = it.next();
      var res = JSON.parse(resultFile.getBlob().getDataAsString('UTF-8'));
      check('命令が成功した', res.ok === true, res.error || '');
      check('管理対象の一覧が返った', !!res.result && res.result.length >= 0,
        res.result ? res.result.length + '件' : 'なし');
      resultFile.setTrashed(true);
    }

    var doneIt = commandDoneFolder_().getFilesByName(id + '.cmd.json');
    check('処理済みの命令が queue-done に移った', doneIt.hasNext());
    if (doneIt.hasNext()) doneIt.next().setTrashed(true);

    var leftover = queue.getFilesByName(id + '.cmd.json');
    check('未処理のキューに命令が残っていない', !leftover.hasNext());
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
  } finally {
    queueLastRunRestore_(lastRunBefore);
  }

  var summary = (failed === 0) ? 'すべて PASS' : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}

/**
 * 共有ドライブに置いたときに動くかを、実機で確かめる。持ち主専用。置いた命令は片付ける。
 *
 * 疑似GASでは「権限で断られる」形を再現しきれない。役割の読み方・親が1つの移動・
 * 外への共有の拒否はここで見る。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifySharedDrive() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  var driveId = repoDriveId_();
  if (!driveId) {
    return '共有ドライブではありません (入れ物はマイドライブにあるか、Drive の拡張サービスが使えません)';
  }
  check('入れ物は共有ドライブにある', true, driveId);

  var members = driveMembers_(driveId);
  check('持ち主 (organizer) が読めた', members.owners.length > 0, members.owners.join(', '));
  check('自分が持ち主に入っている',
    members.owners.indexOf(currentEmailLower_()) >= 0);

  var queue = commandQueueFolder_();
  // 名前は毎回変える。同じ名前だと、打ち切られて残った処理済みの命令を commandAlreadyRan_ が
  // 見て、次の実行で命令が走らず、何度やっても「結果を書いた」が通らない
  var id = 'verify-shared-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  // 手で回すと回った時刻が今になり、止まったトリガーが1時間「動いています」に見える。
  // 終わったら戻す
  var lastRunBefore = PropertiesService.getScriptProperties().getProperty('QUEUE_LAST_RUN');
  try {
    queue.createFile(id + '.cmd.json', JSON.stringify({ op: 'listFiles', args: {} }), MimeType.PLAIN_TEXT);
    processCommandQueue();
    var res = queue.getFilesByName(id + '.result.json');
    check('命令を処理して結果を書いた (親が1つの移動が通った)', res.hasNext());
    check('命令は queue-done へ移った', commandDoneFolder_().getFilesByName(id + '.cmd.json').hasNext());
  } catch (e) {
    check('命令を通す', false, e.message);
  } finally {
    queueLastRunRestore_(lastRunBefore);
    var leftovers = [queue.getFilesByName(id + '.cmd.json'), queue.getFilesByName(id + '.result.json'),
      commandDoneFolder_().getFilesByName(id + '.cmd.json')];
    for (var i = 0; i < leftovers.length; i++) {
      while (leftovers[i].hasNext()) {
        try { leftovers[i].next().setTrashed(true); } catch (e2) { Logger.log('片付けられません: ' + e2.message); }
      }
    }
  }

  try {
    check('道具の zip を作れた (外への共有を断られても)', !!agentKitBuild_().getId());
  } catch (e3) {
    check('道具の zip を作る', false, e3.message);
  }

  log.push(failed ? '失敗: ' + failed + '件' : 'すべて通りました');
  var out = log.join('\n');
  Logger.log(out);
  return out;
}

/**
 * 検証ハーネスが残した Issue とカードを片付ける。
 *
 * debugVerifyPhase3b が作る Issue は題名と本文が固定されているため、
 * それで判別できる。issueNumber を記録していなかった時期の実行が
 * 残した分を掃除するために使う。
 *
 * @returns {string} 削除した件数
 */
function debugCleanupVerifyIssues() {
  assertOwner_();
  var rows = dbReadAll('issues');
  var removed = [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].title) !== '第3条を追加する') continue;
    if (String(rows[i].body) !== '自動検証') continue;

    var number = rows[i].number;
    dbDelete('issues', 'number', number);
    dbDelete('project_items', 'issueNumber', number);
    removed.push('#' + number);
  }

  if (!removed.length) return '片付ける検証用Issueはありません';
  return '検証用Issueを削除しました: ' + removed.join(', ');
}

/**
 * やることの保存状態を実測する。
 *
 * 「作ったのに一覧に出ない」が、保存されていないのか、読み出せて
 * いないのか、画面に描けていないのかを切り分けるために使う。
 *
 * @returns {string} 判定サマリ
 */
function debugDumpIssues() {
  assertOwner_();
  var log = [];

  try {
    var sheet = dbSheet_('issues');
    var cols = DB_SCHEMA().issues;

    log.push('スキーマの列数: ' + cols.length + ' [' + cols.join(', ') + ']');
    log.push('シートの最終行: ' + sheet.getLastRow() +
      ' / 列数: ' + sheet.getMaxColumns());

    var header = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
    log.push('見出し行: [' + header.join(', ') + ']');

    var raw = dbReadAll('issues');
    log.push('dbReadAll の件数: ' + raw.length);
    for (var i = 0; i < raw.length; i++) {
      log.push('  #' + raw[i].number + ' state=' + raw[i].state +
        ' title=' + raw[i].title +
        ' assignee=' + raw[i].assignee + ' due=' + raw[i].dueDate);
    }

    var listed = issueList(null);
    log.push('issueList(null) の件数: ' + listed.length);

    var api = apiIssueList('');
    log.push('apiIssueList("") の件数: ' + api.length);
    log.push('画面に渡る形: ' + JSON.stringify(api).substring(0, 400));

    var items = dbReadAll('project_items');
    log.push('カードの件数: ' + items.length);

    // 列がずれていないかを、値の形で確かめる
    var bad = [];
    for (var k = 0; k < raw.length; k++) {
      if (raw[k].createdAt === '' || raw[k].createdAt === null) {
        bad.push('#' + raw[k].number + ' の作成日時が空');
      }
      if (raw[k].dueDate && !/^\d{4}-\d{2}-\d{2}/.test(String(raw[k].dueDate)) &&
          Object.prototype.toString.call(raw[k].dueDate) !== '[object Date]') {
        bad.push('#' + raw[k].number + ' の期限が日付として読めない');
      }
    }
    log.push(bad.length ? '列のずれ: ' + bad.join(' / ') : '列のずれ: なし');
  } catch (e) {
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  Logger.log(log.join('\n'));
  return log.length + '行をログに出しました';
}

/**
 * エージェンティックスクラムを実機で通しで確かめる。エディタから引数なしで実行する。
 *
 * 疑似GASでは出ないもの (台帳に書いた日付が Date で返る、数の字が数で返る) が
 * 数え方を狂わせていないかを見る。スプリントを作り、やることにポイントを付けて
 * 1つ完了にし、ベロシティ・バーンダウン・要約の数と、障害物の解決と履歴を確かめる。
 *
 * **作ったものは成否にかかわらず片付け、オン・オフも元に戻す。** 台帳の行だけで
 * Drive には何も作らないので、残して調べる意味が薄い。使っていないチームの
 * 設定を、確かめただけで変えてはならない。やることの番号は2つ進む
 * (一度出した番号は二度出さないため)。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifyScrum() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail !== undefined ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  function day(offset) {
    return Utilities.formatDate(
      new Date(Date.now() + offset * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  var wasOn = scrumEnabled();
  var name = 'verify-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmmss');
  // 片付けは番号ではなくこの印で探す。作った直後に落ちると番号が手元に返らず、
  // 番号で控える形だと台帳に書けたぶんが残る
  var mark = '自動検証 ' + name;

  try {
    scrumSetEnabled_(true);

    var sprint = apiSprintCreate({ name: name, goal: '自動検証', startDate: day(-1), endDate: day(5) });
    check('スプリントの日付が字のまま返る',
      sprint.startDate === day(-1) && sprint.endDate === day(5),
      sprint.startDate + ' 〜 ' + sprint.endDate);

    var done = apiIssueCreate('スクラム検証 (終える)', mark, []);
    var left = apiIssueCreate('スクラム検証 (残す)', mark, []);

    apiIssueUpdate(done.number, { sprint: name, points: 3, acceptance: '検証が通る' });
    apiIssueUpdate(left.number, { sprint: name, points: 2 });
    var got = issueToPlain_(issueGet(done.number));
    check('やることにスプリントとポイントが残る',
      got.sprint === name && Number(got.points) === 3, got.sprint + ' / ' + got.points);

    apiIssueClose(done.number);

    var view = apiScrumView(name);
    var v = null;
    for (var i = 0; i < view.velocity.length; i++) {
      if (view.velocity[i].name === name) v = view.velocity[i];
    }
    check('ベロシティの計画が 5', !!v && v.planned === 5, v && v.planned);
    check('ベロシティの終えたが 3', !!v && v.completed === 3, v && v.completed);
    check('要約の今のスプリントになる', view.summary.current === name, view.summary.current);

    var at = view.burndown.days.indexOf(day(0));
    check('バーンダウンに今日がある', at >= 0, view.burndown.days.join(','));
    check('今日の残りが 2', at >= 0 && view.burndown.remaining[at] === 2,
      at >= 0 ? view.burndown.remaining[at] : '');

    var history = apiHistory('issue:' + done.number);
    var pointsLogged = history.some(function (h) {
      return h.field === 'points' && String(h.after) === '3';
    });
    check('ポイントの変更が履歴に残る', pointsLogged, history.length + '件');

    var impediment = apiImpedimentCreate({ title: 'スクラム検証の障害物', body: mark }).number;
    apiImpedimentComment(impediment, '自動検証のやりとり');
    var solved = apiImpedimentResolve(impediment, '自動検証で解決');
    check('障害物を解決できる', solved.state === 'resolved', solved.state);
    check('障害物のやりとりが読める', apiImpedimentComments(impediment).length === 1);
  } catch (e) {
    failed++;
    log.push('EXCEPTION ' + e.message);
    log.push(String(e.stack || ''));
  }

  // 片付け。1つ落ちても残りは続ける。落ちたら FAIL に数える (残ったまま
  // 「すべて PASS」と出ると、残ったことに誰も気づかない)
  var tidyFailed = failed;
  function tidy(label, fn) {
    try {
      fn();
    } catch (e) {
      failed++;
      log.push('FAIL 片付け (' + label + '): ' + e.message);
    }
  }
  // 読むところも tidy の中に置く。外で投げると、オン・オフを戻す前に止まる
  tidy('やることを探す', function () {
    dbReadAll('issues').forEach(function (row) {
      if (String(row.body) !== mark) return;
      var n = row.number;
      tidy('やること #' + n, function () {
        issuePurge(n);
        dbDelete('change_log', 'target', 'issue:' + n);
      });
    });
  });
  tidy('障害物を探す', function () {
    dbReadAll('impediments').forEach(function (row) {
      if (String(row.body) !== mark) return;
      var n = row.number;
      tidy('障害物 #' + n, function () {
        dbDelete('impediment_comments', 'impedimentNumber', n);
        dbDelete('impediments', 'number', n);
        dbDelete('change_log', 'target', 'impediment:' + n);
      });
    });
  });
  tidy('スプリント ' + name, function () {
    dbDelete('sprints', 'name', name);
    dbDelete('change_log', 'target', 'sprint:' + name);
  });
  tidy('オン・オフ', function () { scrumSetEnabled_(wasOn); });
  log.push(failed === tidyFailed
    ? '検証物を片付け、エージェンティックスクラムを' + (wasOn ? 'オン' : 'オフ') + 'に戻しました'
    : '片付けきれませんでした。本文が「' + mark + '」のものを台帳から消してください');

  var summary = (failed === 0) ? 'すべて PASS (' + log.length + '行)' : failed + ' 件 FAIL';
  Logger.log(log.join('\n') + '\n--- ' + summary + ' ---');
  return summary;
}
