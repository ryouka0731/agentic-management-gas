/*
 * 画面の API: 文書の改訂履歴 (やること #111)。
 */

/**
 * 文書の改訂履歴を返す (Web App API)。新しい順。
 *
 * 書き出せるか (`canExport`) はサーバが決める (管理者で、Docs か Sheets のとき)。
 * 画面で決めると、押せるのに断られるボタンになる。
 *
 * @param {string} fileId 正式版か、その作業コピー
 * @returns {{fileId:string, path:string, type:string, canExport:boolean, exportBlocked:string, items:object[]}}
 */
function apiRevisionHistory(fileId) {
  var main = revisionMainFile_(fileId);
  var items = revisionHistory(main.fileId);

  var emails = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].mergedBy) emails.push(items[i].mergedBy);
  }
  var names = memberNames(emails);

  var out = [];
  for (var k = items.length - 1; k >= 0; k--) {
    var one = items[k];
    out.push({
      number: plainId(one.number),
      title: plainText(one.title),
      mergedAt: plainDate(one.mergedAt),
      mergedBy: plainText(one.mergedBy),
      mergedByName: plainText(one.mergedBy ? (names[one.mergedBy] || one.mergedBy) : ''),
      reason: plainText(one.reason),
    });
  }

  var blocked = revisionExportBlocked_(main);
  return {
    fileId: plainText(main.fileId),
    path: plainText(branchSplitPath_(main.path).path),
    type: plainText(main.type),
    canExport: !blocked,
    exportBlocked: plainText(blocked),
    items: out,
  };
}

/**
 * 正式版の文書に改訂履歴の表を書き出す (Web App API)。管理者だけ。Slides は断る。
 *
 * @param {string} fileId 正式版か、その作業コピー
 * @returns {{fileId:string, type:string, rows:number, sha:string, changed:boolean}}
 */
function apiRevisionExport(fileId) {
  var res = revisionExport(fileId);
  return {
    fileId: plainText(res.fileId),
    type: plainText(res.type),
    rows: plainNumber(res.rows),
    sha: plainText(res.sha),
    changed: !!res.changed,
  };
}
