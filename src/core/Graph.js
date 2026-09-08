/**
 * コミットをグラフとして描くための行を組み立てる。
 *
 * git log --graph と同じ考え方で、ブランチごとにレーン (縦の列) を割り当て、
 * 分岐点まで線を通す。描画そのものは UI が行い、ここでは位置だけを決める。
 *
 * ブランチの最初のコミットは parentSha が空である (作業コピーは別ファイル
 * として分岐するため、親を辿れない)。代わりに branches.baseSha が分岐点を
 * 指しているので、そこへ線を引く。
 *
 * @param {Array<{name:string, baseSha:string, commits:object[]}>} chains
 *   commits は新しい順。main を先頭に置くこと
 * @returns {Array<object>} 新しい順の行。各行は
 *   {sha, parentSha, branch, lane, activeLanes, fork, forkLane, merge, ...}
 */
function commitGraph(chains) {
  var rows = [];
  var laneOf = {};

  for (var i = 0; i < (chains || []).length; i++) {
    var chain = chains[i];
    laneOf[chain.name] = i;

    for (var j = 0; j < chain.commits.length; j++) {
      var commit = chain.commits[j];
      rows.push({
        sha: String(commit.sha),
        parentSha: String(commit.parentSha || ''),
        branch: chain.name,
        message: commit.message,
        author: commit.author,
        timestamp: commit.timestamp,
        lane: i,
        diffFrom: String(commit.parentSha || ''),
        activeLanes: [],
        fork: false,
        forkLane: -1,
        merge: /^マージ: PR #/.test(String(commit.message || '')),
      });
    }
  }

  // 新しい順に並べる。同時刻はチェーン内の順序を保つ
  rows.sort(function (a, b) {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  var indexOf = {};
  for (var r = 0; r < rows.length; r++) indexOf[rows[r].sha] = r;

  // 各レーンが「どの行からどの行まで走っているか」を決める
  for (var k = 0; k < (chains || []).length; k++) {
    var c = chains[k];
    if (!c.commits.length) continue;

    var lane = laneOf[c.name];
    var first = rows.length;
    var last = -1;

    for (var m = 0; m < c.commits.length; m++) {
      var idx = indexOf[String(c.commits[m].sha)];
      if (idx < first) first = idx;
      if (idx > last) last = idx;
    }

    // 分岐点があれば、そこまで線を伸ばす
    var baseIdx = indexOf[String(c.baseSha || '')];
    if (baseIdx !== undefined && baseIdx > last) last = baseIdx;

    for (var n = first; n <= last; n++) rows[n].activeLanes.push(lane);

    // チェーンの最も古いコミットが分岐の起点になる
    if (c.baseSha && baseIdx !== undefined) {
      var rootIdx = indexOf[String(c.commits[c.commits.length - 1].sha)];
      rows[rootIdx].fork = true;
      rows[rootIdx].forkLane = laneOf['main'] === undefined ? 0 : laneOf['main'];

      // 分岐の最初の記録は親を持たない。そのまま差分を取ると全文が
      // 「追加」になってしまうため、分岐元と比べる
      rows[rootIdx].diffFrom = String(c.baseSha);
    }
  }
  return rows;
}

/**
 * 描画に必要なレーンの数を返す。
 *
 * @param {object[]} rows commitGraph の戻り値
 * @returns {number} 最低でも1
 */
function graphLaneCount(rows) {
  var max = 0;
  for (var i = 0; i < (rows || []).length; i++) {
    for (var j = 0; j < rows[i].activeLanes.length; j++) {
      if (rows[i].activeLanes[j] > max) max = rows[i].activeLanes[j];
    }
    if (rows[i].lane > max) max = rows[i].lane;
  }
  return max + 1;
}
