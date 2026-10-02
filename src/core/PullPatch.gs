/**
 * コードの変更を、確認依頼に添える。
 *
 * **この道具はコードの版管理をしない。** そこは git がやる。ここが受け持つ
 * のは「何が変わったのかを人が画面で読んで、進めてよいと決める」ところだけ
 * である。git にも GitHub にも無いのはそこだけで、版管理は既にある。
 *
 * だから patch は `files` に入れない。`files` の1行は「管理している Drive の
 * ファイル」であり、改訂版・作業コピー・書き戻しの一式がその前提で組まれて
 * いる。patch にはコピーも編集も書き戻しも無いので、混ぜると
 * `branchAddFile` / `fileStatus` / `writeHtmlToFile` に「patch のときは何も
 * しない」という枝が散る。
 *
 * 中身は `objects/` に置く。差分の本文は長いので、台帳のセルには入れない
 * (スプレッドシートのセルには上限がある)。
 *
 * 手元で `git diff` を走らせて送ってもらう形にしてある。GAS 側では git の
 * オブジェクトを読めない (loose object は raw deflate で、Apps Script には
 * raw inflate が無い。packfile はさらに delta チェーン)。
 */

/**
 * 1つの確認依頼に添えられる数の上限。
 *
 * 際限なく受け取ると、1回のリポジトリ丸ごとの差分で台帳が埋まる。読む人が
 * 追える数でもない。
 *
 * @returns {number}
 */
function PATCH_MAX_FILES() {
  return 200;
}

/**
 * 1つの差分の字数の上限。
 *
 * @returns {number}
 */
function PATCH_MAX_CHARS() {
  return 200000;
}


/**
 * 足した行と消した行を数える。
 *
 * 中身を開かずに大きさが分かるようにしておく。一覧で全部の差分を読み込むと
 * 開くのに待たされる。
 *
 * @param {string} text unified diff
 * @returns {{added:number, removed:number}}
 */
function patchCount_(text) {
  var lines = String(text || '').split('\n');
  var added = 0;
  var removed = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // '+++' / '---' は見出しなので数えない
    if (line.indexOf('+++') === 0 || line.indexOf('---') === 0) continue;
    if (line.charAt(0) === '+') added++;
    else if (line.charAt(0) === '-') removed++;
  }
  return { added: added, removed: removed };
}

/**
 * 確認依頼にコードの変更を添える。
 *
 * 同じ道のりのものが既にあれば置き換える。手元で直してもう一度送る、が
 * ふつうの使い方なので、足すたびに増えると最後がどれか分からなくなる。
 *
 * 反映済み・取り下げ済みの依頼には添えられない。決まったあとに証跡が
 * 変わると、何を承認したのかが分からなくなる。
 *
 * @param {number} prNumber
 * @param {string} path リポジトリの中での道のり
 * @param {string} text unified diff の本文
 * @returns {object} 添えた行 (本文は含まない)
 */
function prPatchAdd(prNumber, path, text) {
  var pr = prGet(prNumber);
  var state = String(pr.state);

  if (state === 'merged' || state === 'closed') {
    throw new Error('この依頼は決まっています。あとから証跡を変えられません');
  }

  var want = String(path || '');
  if (!/^[^\\\0]{1,300}$/.test(want)) {
    throw new Error('道のりが不正です: ' + path);
  }
  if (/(^|\/)\.\.(\/|$)/.test(want)) {
    throw new Error('道のりに .. は使えません: ' + path);
  }

  var body = String(text || '');
  if (!body) throw new Error('差分が空です: ' + want);
  if (body.length > PATCH_MAX_CHARS()) {
    throw new Error(
      '差分が大きすぎます (' + PATCH_MAX_CHARS() + '字まで): ' + want);
  }

  var sha = sha256Hex(body);
  if (!objectExists(sha)) objectPut(sha, body);

  var stat = patchCount_(body);

  /*
   * **「あるかどうか見る」から「書く」までを1つの鍵の中で行う。**
   *
   * 分けると、ほぼ同時の2件が「どちらも無い」と読んで両方追加し、同じ
   * 道のりの証跡が2つ並ぶ。読む人には同じ差分が2回出る。
   */
  return dbWithLock_(30000, function () {
    var mine = prPatchRows(prNumber);
    var found = null;

    for (var i = 0; i < mine.length; i++) {
      if (String(mine[i].path) === want) found = mine[i];
    }
    if (!found && mine.length >= PATCH_MAX_FILES()) {
      throw new Error(
        '1つの依頼に添えられるのは' + PATCH_MAX_FILES() + '件までです');
    }

    var row = {
      prNumber: Number(prNumber),
      path: want,
      blobSha: sha,
      added: stat.added,
      removed: stat.removed,
      at: new Date(),
      by: Session.getActiveUser().getEmail(),
    };

    if (!found) return dbAppendNumbered('pull_patches', 'id', row);

    row.id = Number(found.id);
    dbUpdate('pull_patches', 'id', row.id, row);
    return row;
  });
}

/**
 * その確認依頼に添えられた行を返す。本文は含まない。
 *
 * @param {number} prNumber
 * @returns {object[]}
 */
function prPatchRows(prNumber) {
  var rows = dbReadAll('pull_patches');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(prNumber)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) {
    return String(a.path) < String(b.path) ? -1 : 1;
  });
  return out;
}

/**
 * 本文まで含めて返す。
 *
 * @param {number} prNumber
 * @returns {object[]}
 */
function prPatches(prNumber) {
  var rows = prPatchRows(prNumber);
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var one = rows[i];
    out.push({
      id: Number(one.id),
      path: String(one.path),
      added: Number(one.added) || 0,
      removed: Number(one.removed) || 0,
      by: String(one.by || ''),
      at: one.at,
      text: objectGet(String(one.blobSha)) || '',
    });
  }
  return out;
}

/**
 * コードの変更が添えられているか。
 *
 * @param {number} prNumber
 * @returns {boolean}
 */
function prHasPatches(prNumber) {
  return prPatchRows(prNumber).length > 0;
}

/**
 * 添えたものを外す。
 *
 * 間違って送ったものを消す道が無いと、読む人に関係のない差分を見せ続ける
 * ことになる。
 *
 * @param {number} prNumber
 * @param {number} id
 * @returns {number} 外した数
 */
function prPatchRemove(prNumber, id) {
  var pr = prGet(prNumber);
  var state = String(pr.state);

  if (state === 'merged' || state === 'closed') {
    throw new Error('この依頼は決まっています。あとから証跡を変えられません');
  }

  var rows = prPatchRows(prNumber);
  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].id) !== Number(id)) continue;

    // 中身 (objects/) は消さない。過去の記録が同じ sha を指していることがある
    return dbDelete('pull_patches', 'id', rows[i].id);
  }
  throw new Error('その証跡は見つかりません: ' + id);
}
