/**
 * やることをまとめ方に応じて束ねる。
 *
 * 一覧が長くなると、何に対する作業なのかが読めなくなる。
 * 文書・担当者・状態・ラベルのいずれかで束ねて見出しを付ける。
 *
 * @param {object[]} issues
 * @param {string} by 'doc' | 'assignee' | 'state' | 'label' | 'none'
 * @param {Object<string,string>} docNames fileId → 表示名
 * @returns {Array<{key:string, label:string, issues:object[]}>}
 */
function groupIssues(issues, by, docNames) {
  var names = docNames || {};
  var order = [];
  var buckets = {};

  function put(key, label, issue) {
    if (!buckets[key]) {
      buckets[key] = { key: key, label: label, issues: [] };
      order.push(key);
    }
    buckets[key].issues.push(issue);
  }

  for (var i = 0; i < (issues || []).length; i++) {
    var issue = issues[i];

    if (by === 'none') {
      put('all', 'すべて', issue);
      continue;
    }

    if (by === 'assignee') {
      var who = String(issue.assignee || '');
      put(who || '(未割当)', who || '担当なし', issue);
      continue;
    }

    if (by === 'state') {
      var open = String(issue.state) === 'open';
      put(open ? 'open' : 'closed', open ? '未完了' : '完了', issue);
      continue;
    }

    if (by === 'label') {
      var labels = String(issue.labels || '').split(',');
      var added = false;

      for (var l = 0; l < labels.length; l++) {
        var label = labels[l].replace(/^\s+|\s+$/g, '');
        if (!label) continue;
        put(label, label, issue);
        added = true;
      }
      if (!added) put('(ラベルなし)', 'ラベルなし', issue);
      continue;
    }

    // 既定は文書ごと。やることは文書に紐づくため、これが最も自然
    var ids = String(issue.linkedFileIds || '').split(',');
    var linked = false;

    for (var f = 0; f < ids.length; f++) {
      var id = ids[f].replace(/^\s+|\s+$/g, '');
      if (!id) continue;
      put(id, names[id] || id, issue);
      linked = true;
    }
    if (!linked) put('(未紐付け)', '文書に紐づいていない', issue);
  }

  var out = [];
  for (var k = 0; k < order.length; k++) out.push(buckets[order[k]]);
  return out;
}
