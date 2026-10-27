/*
 * 改訂の理由と、文書ごとの改訂履歴 (やること #111)。
 *
 * 反映のときに理由を一言もらい (pulls の mergeReason。既定は確認依頼の本文の1行目)、
 * 文書ごとに「日付・反映した人・確認依頼の題名・理由」を並べる。
 *
 * 書き出し (revisionExport) は、正式版の文書の末尾 (Docs) か `改訂履歴` のシート (Sheets) に表を書き、
 * **書いた直後に正式版の記録として残す。** 確認依頼を経ない直接の書き込みだが、中身は台帳から機械的に
 * 作ったものだけで、記録の文にも「改訂履歴の表を書き出しました」と残る。判断の理由は
 * docs/dev/changeset-and-merge.md の「改訂履歴の表の書き出し」。
 */

/** 反映の理由の字数の上限 */
function REVISION_REASON_MAX() {
  return 200;
}

/** 書き出す表の見出しの字 (Docs の見出し・Sheets のシートの名前) */
function REVISION_TABLE_TITLE() {
  return '改訂履歴';
}

/**
 * 反映の理由の既定値。確認依頼の本文の、中身のある最初の1行。
 *
 * 本文の末尾に足している `[target-file:...]` (対象の控え) は人の書いた字ではないので外す。
 *
 * @param {object} pr pulls 行
 * @returns {string}
 */
function prDefaultReason_(pr) {
  var lines = String((pr && pr.body) || '').split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var one = lines[i].replace(/\[target-file:[^\]]*\]/g, '').replace(/^[\s　]+|[\s　]+$/g, '');
    if (one) return one.length > REVISION_REASON_MAX() ? one.substring(0, REVISION_REASON_MAX()) : one;
  }
  return '';
}

/**
 * 反映のときに残す理由を決める。空なら既定値 (本文の1行目)。改行は空白にする (1行の欄なので)。
 *
 * @param {object} pr
 * @param {*} reason
 * @returns {string}
 */
function prMergeReason_(pr, reason) {
  var text = String(reason === undefined || reason === null ? '' : reason)
    .replace(/[\r\n]+/g, ' ').replace(/^[\s　]+|[\s　]+$/g, '');
  if (text.length > REVISION_REASON_MAX()) {
    throw new Error('反映の理由は' + REVISION_REASON_MAX() + '字までにしてください');
  }
  return text || prDefaultReason_(pr);
}

/**
 * 改訂版の文書を渡されたら、正式版の文書の行に読み替える。
 *
 * 文書の頁は版を切り替えても同じ文書なので、どの版から開いても正式版の改訂履歴を出す。
 *
 * @param {string} fileId
 * @returns {object} files 行 (正式版)
 */
function revisionMainFile_(fileId) {
  var row = dbFindOne('files', 'fileId', String(fileId || ''));
  if (!row) throw new Error('管理対象に登録されていません');

  var split = branchSplitPath_(row.path);
  if (split.branch === 'main') return row;

  var main = dbFindOne('files', 'path', split.path);
  if (!main) throw new Error('正式版の文書が見つかりません: ' + split.path);
  return main;
}

/**
 * 文書の改訂履歴。正式版に反映した確認依頼を、反映した順 (古い順) に返す。
 *
 * 反映した人 (`mergedBy`) の列を足す前に反映した依頼は、そのときの反映の記録を書いた人で読む
 * (反映の記録は反映した人が書き、文が `反映: 確認依頼 #N ` で始まる)。理由の列を足す前の依頼は
 * 理由を空のまま読む (あとから本文の1行目で埋めると、その人が言っていない理由が残る)。
 *
 * @param {string} fileId 正式版か、その作業コピー
 * @returns {Array<{number:number, title:string, mergedAt:*, mergedBy:string, reason:string}>}
 */
function revisionHistory(fileId) {
  var main = revisionMainFile_(fileId);
  var mainId = String(main.fileId);
  var pulls = dbReadAll('pulls');
  var out = [];
  var missing = false;

  for (var i = 0; i < pulls.length; i++) {
    var pr = pulls[i];
    if (String(pr.state) !== 'merged') continue;
    if (prTargetBranch(pr) !== 'main') continue;
    if (prTargetFiles(pr).indexOf(mainId) < 0) continue;

    var by = String(pr.mergedBy || '');
    if (!by) missing = true;
    out.push({
      number: Number(pr.number),
      title: String(pr.title || ''),
      mergedAt: pr.mergedAt,
      mergedBy: by,
      reason: String(pr.mergeReason || ''),
    });
  }

  if (missing) revisionFillMergedBy_(out, mainId);

  out.sort(function (a, b) {
    var ta = revisionTime_(a.mergedAt);
    var tb = revisionTime_(b.mergedAt);
    if (ta !== tb) return ta - tb;
    return a.number - b.number;
  });
  return out;
}

/** 反映した人の列を足す前の依頼を、反映の記録を書いた人で埋める (記録は1回だけ読む) */
function revisionFillMergedBy_(items, mainId) {
  var rows = dbReadAll('commits');
  var byNumber = {};
  for (var c = 0; c < rows.length; c++) {
    if (String(rows[c].fileId) !== mainId || String(rows[c].branch) !== 'main') continue;
    var m = /^反映: 確認依頼 #(\d+) /.exec(String(rows[c].message || ''));
    if (m) byNumber[m[1]] = String(rows[c].author || '');
  }
  for (var i = 0; i < items.length; i++) {
    if (!items[i].mergedBy) items[i].mergedBy = byNumber[String(items[i].number)] || '';
  }
}

/** 並べるための時刻。読めなければ 0 (先頭に寄せる) */
function revisionTime_(v) {
  if (!v) return 0;
  var t = (v instanceof Date ? v : new Date(v)).getTime();
  return isNaN(t) ? 0 : t;
}

/** 表に書く日付 (東京の日) */
function revisionDay_(v) {
  var t = revisionTime_(v);
  if (!t) return '—';
  return Utilities.formatDate(new Date(t), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 書き出す表の中身 (見出しの行 + 反映ごとの行)。セルは空にしない (Docs は空の字を入れられない)。
 *
 * @param {object[]} items revisionHistory の返り
 * @returns {string[][]}
 */
function revisionTableRows_(items) {
  var emails = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].mergedBy) emails.push(items[i].mergedBy);
  }
  var names = memberNames(emails);

  var rows = [['日付', '反映した人', '確認依頼', '理由']];
  for (var k = 0; k < items.length; k++) {
    var one = items[k];
    rows.push([
      revisionDay_(one.mergedAt),
      one.mergedBy ? (names[one.mergedBy] || one.mergedBy) : '—',
      '#' + one.number + ' ' + (one.title || ''),
      one.reason || '—',
    ]);
  }
  return rows;
}

/**
 * 書き出せるかと、書き出せない理由。画面のボタンを押せるかはここで決める (画面では決めない)。
 *
 * @param {object} main files 行 (正式版)
 * @returns {string} 書き出せなければ理由。書き出せれば空
 */
function revisionExportBlocked_(main) {
  var type = String(main.type);
  if (type === 'slide') return 'Slides には改訂履歴の表を書き出せません';
  if (type !== 'doc' && type !== 'sheet') return '対応していないファイル種別です: ' + type;
  if (!repoIsAdmin_(currentEmail_())) return '書き出しは、このアプリの管理者だけが行えます';
  return '';
}

/**
 * 正式版の文書に改訂履歴の表を書き出す。
 *
 * - Docs: 本文の末尾に `改訂履歴` の見出しと表を**足す**。既にその見出しと表があれば、表だけを置き換える。
 *   `body.clear()` はしない (反映の書き戻しの道具は使わない)
 * - Sheets: `改訂履歴` のシートを作るか、そのシートだけを書き直す。ほかのシートには触れない
 * - Slides: 断る
 *
 * 書いたら、その中身を正式版の記録として残す。残さないと「記録していない変更あり」になり、
 * 次の反映が止まる。**書く前に記録していない変更があれば断る** (人の直接の編集を、表の書き出しの
 * 記録に紛れ込ませない)。
 *
 * @param {string} fileId 正式版か、その作業コピー
 * @returns {{fileId:string, type:string, rows:number, sha:string, changed:boolean}}
 */
function revisionExport(fileId) {
  var main = revisionMainFile_(fileId);
  var mainId = String(main.fileId);
  var type = String(main.type);

  if (type === 'slide') {
    throw new Error('Slides には改訂履歴の表を書き出せません。Docs か Sheets の文書で使ってください');
  }
  if (type !== 'doc' && type !== 'sheet') {
    throw new Error('対応していないファイル種別です: ' + type);
  }
  repoAssertAdmin_('改訂履歴の表の書き出し');

  return dbWithLock_(60000, function () {
    // 空白の扱いだけの違いは記録し直す (反映と同じ扱い)。それ以外が残っていれば断る
    if (prRecordSpacingOnly_(mainId, 'main')) {
      throw new Error(
        '正式版の ' + branchSplitPath_(main.path).path + ' に記録していない変更があります。' +
        '先に「直接編集を退避」で記録してから書き出してください');
    }

    var rows = revisionTableRows_(revisionHistory(mainId));
    if (type === 'doc') revisionWriteDoc_(mainId, REVISION_TABLE_TITLE(), rows);
    else revisionWriteSheet_(mainId, REVISION_TABLE_TITLE(), rows);
    liveCacheInvalidate(mainId);

    var head = headCommit(mainId, 'main');
    if (head && String(head.blobSha) === sha256Hex(liveHtml(mainId))) {
      // 前に書き出したものと同じ (反映が増えていない)。空の記録は作らない
      return { fileId: mainId, type: type, rows: rows.length - 1, sha: String(head.sha), changed: false };
    }
    var made = commitFile(mainId, 'main', '改訂履歴の表を書き出しました', null);
    return { fileId: mainId, type: type, rows: rows.length - 1, sha: String(made.sha), changed: true };
  });
}
