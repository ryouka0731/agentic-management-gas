/**
 * やることを親子の木に組み直す。
 *
 * 親が自分自身や子孫を指していると輪ができ、たどると止まらなくなる。
 * 輪になる親は無かったものとして扱い、根に置く。
 *
 * @param {object[]} issues issues 行 (parent に親の番号)
 * @returns {Array<object>} 根の配列。各要素は children と depth を持つ
 */
function buildIssueTree(issues) {
  var byNumber = {};
  var nodes = [];

  for (var i = 0; i < (issues || []).length; i++) {
    var node = {};
    for (var k in issues[i]) {
      if (Object.prototype.hasOwnProperty.call(issues[i], k)) node[k] = issues[i][k];
    }
    node.children = [];
    node.depth = 0;

    byNumber[String(node.number)] = node;
    nodes.push(node);
  }

  var roots = [];

  for (var n = 0; n < nodes.length; n++) {
    var parent = byNumber[String(nodes[n].parent)];

    if (!parent || parent === nodes[n] || makesCycle_(byNumber, nodes[n], parent)) {
      roots.push(nodes[n]);
      continue;
    }
    parent.children.push(nodes[n]);
  }

  for (var r = 0; r < roots.length; r++) setDepth_(roots[r], 0);
  return roots;
}

/**
 * 親をたどって自分に戻るかを見る。
 *
 * @param {Object<string,object>} byNumber
 * @param {object} node
 * @param {object} parent
 * @returns {boolean}
 */
function makesCycle_(byNumber, node, parent) {
  var seen = {};
  var cur = parent;

  while (cur) {
    if (cur === node) return true;
    if (seen[String(cur.number)]) return true;

    seen[String(cur.number)] = true;
    cur = byNumber[String(cur.parent)];
  }
  return false;
}

/**
 * 深さを入れる。
 *
 * @param {object} node
 * @param {number} depth
 */
function setDepth_(node, depth) {
  node.depth = depth;
  for (var i = 0; i < node.children.length; i++) setDepth_(node.children[i], depth + 1);
}

/**
 * 木を上から順に並べ直す。親のすぐ下に子が来る。
 *
 * @param {object[]} roots
 * @returns {object[]}
 */
function flattenIssueTree(roots) {
  var out = [];

  function walk(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      out.push(nodes[i]);
      walk(nodes[i].children);
    }
  }
  walk(roots || []);
  return out;
}

/**
 * 子の工数を親に足し上げる。
 *
 * 親に直接入れた値と、子の合計の両方を返す。どちらで見たいかは
 * 場面によって違う。
 *
 * @param {object} node
 * @returns {{estimate:number, planned:number, actual:number}}
 */
function rollupEffort(node) {
  var sum = {
    estimate: Number(node.estimate) || 0,
    planned: Number(node.plannedHours) || 0,
    actual: Number(node.actualHours) || 0,
  };

  for (var i = 0; i < node.children.length; i++) {
    var child = rollupEffort(node.children[i]);
    sum.estimate += child.estimate;
    sum.planned += child.planned;
    sum.actual += child.actual;
  }
  return sum;
}

/**
 * その親子関係が輪になるかを調べる。
 *
 * 自分自身や、自分の子孫を親にすると輪ができる。輪ができると木として
 * たどれなくなるため、作る前に断る。
 *
 * @param {object[]} issues issues 行
 * @param {number} child 子にする番号
 * @param {number} parent 親にする番号
 * @returns {boolean} 輪になるなら true
 */
function issueWouldCycle(issues, child, parent) {
  if (String(child) === String(parent)) return true;

  var byNumber = {};
  for (var i = 0; i < (issues || []).length; i++) {
    byNumber[String(issues[i].number)] = issues[i];
  }

  var seen = {};
  var cur = byNumber[String(parent)];

  while (cur) {
    if (String(cur.number) === String(child)) return true;
    if (seen[String(cur.number)]) return true;

    seen[String(cur.number)] = true;
    cur = byNumber[String(cur.parent)];
  }
  return false;
}
