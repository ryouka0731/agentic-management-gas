/**
 * やることをまとめ方に応じて束ねる。
 *
 * 一覧が長くなると、何に対する作業なのかが読めなくなる。
 * 文書・担当者・状態・ラベルのいずれかで束ねて見出しを付ける。
 *
 * @param {object[]} issues
 * @param {string} by 'doc' | 'assignee' | 'state' | 'label' | 'sprint' | 'none'
 * @param {Object<string,string>} docNames fileId → 表示名
 * @returns {Array<{key:string, label:string, issues:object[]}>}
 */
function groupIssues(issues, by, docNames) {
  var names = docNames || {};
  var order = [];
  var buckets = {};

  function put(key, label, issue) {
    // 名前は人が付ける (スプリント・タグ)。'constructor' のような名前が
    // Object の持ち物と重なるので、自分の持ち物かで見る
    if (!Object.prototype.hasOwnProperty.call(buckets, key)) {
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
      // 2人で持つ仕事は、両方の束に出す。画面 (app.js.html) と同じ。以前はここだけ
      // 'a,b' を1つの束にしていた (乱数が偏っていてテストが見落とした)
      var who = issue.assignees || String(issue.assignee || '').split(',')
        .map(function (x) { return x.replace(/^\s+|\s+$/g, ''); })
        .filter(function (x) { return !!x; });
      if (!who.length) {
        put('(未割当)', '担当なし', issue);
        continue;
      }
      for (var w = 0; w < who.length; w++) put(who[w], who[w], issue);
      continue;
    }

    if (by === 'sprint') {
      // 未定の束の鍵は空にする。'(未定)' という名前のスプリントも作れるので、
      // 名前と重なる鍵にすると混ざる
      var sprint = String(issue.sprint || '');
      put(sprint, sprint || 'スプリント未定', issue);
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

  // スプリントは名前の順 (sprint001, sprint002 …) に並べ、未定は最後に置く。
  // 出てきた順だと、優先度で並んだ一覧に引きずられて前後する
  if (by === 'sprint') order.sort(groupSprintOrder_);

  var out = [];
  for (var k = 0; k < order.length; k++) out.push(buckets[order[k]]);
  return out;
}

/**
 * スプリントの束の並べ方。未定は最後。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function groupSprintOrder_(a, b) {
  if (a === b) return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  return a < b ? -1 : 1;
}
