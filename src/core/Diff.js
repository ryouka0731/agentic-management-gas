/**
 * 正規化HTMLを行配列に分割する。
 * serializeBlocks は末尾に改行を付けるため、そのままsplitすると
 * 空の末尾要素ができる。それを除く。
 *
 * @param {string} html
 * @returns {string[]}
 */
function splitLines(html) {
  var s = String(html == null ? '' : html);
  if (s === '') return [];
  var lines = s.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * オブジェクトの浅いコピーを作る。
 * Myersのtrace記録で、その時点のvを保存するために使う。
 *
 * @param {object} obj
 * @returns {object}
 */
function copyMap_(obj) {
  var out = {};
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

/**
 * Myersアルゴリズムの経路を逆向きにたどって編集操作列を復元する。
 *
 * trace[d] は「d回目のラウンドに入る前のv」である。d回目のラウンドで
 * 到達点が決まったとき、trace[d]から前の位置を逆算できる。
 *
 * @param {object[]} trace 各dラウンドに入る前のvのスナップショット
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} d 最終的な編集距離
 * @returns {object[]} {type, line} の配列
 */
function backtrack_(trace, a, b, d) {
  var ops = [];
  var x = a.length;
  var y = b.length;

  for (var dd = d; dd > 0; dd--) {
    var vPrev = trace[dd];
    var k = x - y;

    var prevK;
    if (k === -dd || (k !== dd && vPrev[k - 1] < vPrev[k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    var prevX = vPrev[prevK];
    var prevY = prevX - prevK;

    // 対角線 (一致行) をさかのぼる
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: a[x - 1] });
      x--; y--;
    }

    if (x > prevX) {
      ops.push({ type: 'delete', line: a[x - 1] });
      x--;
    } else if (y > prevY) {
      ops.push({ type: 'insert', line: b[y - 1] });
      y--;
    }
  }

  // d=0 まで戻った残りはすべて一致行
  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', line: a[x - 1] });
    x--; y--;
  }

  ops.reverse();
  return ops;
}

/**
 * 同じ位置の delete と insert の並び順を安定させる。
 * Myersの復元順では insert が先に出ることがあるが、
 * 差分表示では「削除された行 → 追加された行」の順が読みやすい。
 *
 * @param {object[]} ops
 * @returns {object[]}
 */
function stabilizeOps_(ops) {
  var out = [];
  var i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      out.push(ops[i]);
      i++;
      continue;
    }
    // 連続する非equalブロックを集め、delete群 → insert群 の順に並べ直す
    var dels = [];
    var ins = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') dels.push(ops[i]);
      else ins.push(ops[i]);
      i++;
    }
    for (var d = 0; d < dels.length; d++) out.push(dels[d]);
    for (var n = 0; n < ins.length; n++) out.push(ins[n]);
  }
  return out;
}

/**
 * 2つの行配列の差分をMyersアルゴリズムで求める。
 *
 * 計算量は O((N+M)D) で、Dは編集距離。文書の版管理では通常
 * 変更箇所が少ないためDが小さく、実用上は線形に近い。
 *
 * @param {string[]} a 変更前
 * @param {string[]} b 変更後
 * @returns {object[]} {type:'equal'|'delete'|'insert', line:string} の配列
 */
function diffLines(a, b) {
  var N = a.length;
  var M = b.length;

  if (N === 0 && M === 0) return [];
  if (N === 0) {
    var allIns = [];
    for (var bi = 0; bi < M; bi++) allIns.push({ type: 'insert', line: b[bi] });
    return allIns;
  }
  if (M === 0) {
    var allDel = [];
    for (var ai = 0; ai < N; ai++) allDel.push({ type: 'delete', line: a[ai] });
    return allDel;
  }

  var MAX = N + M;
  var v = {};
  v[1] = 0;
  var trace = [];

  for (var d = 0; d <= MAX; d++) {
    // このラウンドに入る前のvを記録する。backtrack_ はこれを使う
    trace.push(copyMap_(v));

    for (var k = -d; k <= d; k += 2) {
      var x;
      if (k === -d || (k !== d && v[k - 1] < v[k + 1])) {
        x = v[k + 1];
      } else {
        x = v[k - 1] + 1;
      }
      var y = x - k;

      while (x < N && y < M && a[x] === b[y]) { x++; y++; }

      v[k] = x;

      if (x >= N && y >= M) {
        return stabilizeOps_(backtrack_(trace, a, b, d));
      }
    }
  }

  return [];
}

/**
 * 正規化HTML同士を行単位で比較する。
 *
 * @param {string} aHtml
 * @param {string} bHtml
 * @returns {object[]}
 */
function diffHtml(aHtml, bHtml) {
  return diffLines(splitLines(aHtml), splitLines(bHtml));
}

/**
 * diff の ops を左右2列の行に組み替える。
 *
 * 連続する delete と insert は同じ行に対応付けて change にする。
 * これをしないと「左が全部消えて右が全部足された」ようにしか見えず、
 * どこが書き換わったのかが読めない。GitHub の split view と同じ挙動。
 *
 * @param {object[]} ops diffHtml が返す配列
 * @returns {Array<{left:string|null, right:string|null, type:string}>}
 */
function diffPairs(ops) {
  var out = [];
  var dels = [];
  var ins = [];

  function flush() {
    var n = Math.max(dels.length, ins.length);
    for (var i = 0; i < n; i++) {
      var left = i < dels.length ? dels[i] : null;
      var right = i < ins.length ? ins[i] : null;
      var type = (left !== null && right !== null)
        ? 'change'
        : (left !== null ? 'delete' : 'insert');
      out.push({ left: left, right: right, type: type });
    }
    dels = [];
    ins = [];
  }

  for (var i = 0; i < (ops || []).length; i++) {
    var op = ops[i];
    if (op.type === 'delete') { dels.push(op.line); continue; }
    if (op.type === 'insert') { ins.push(op.line); continue; }

    flush();
    out.push({ left: op.line, right: op.line, type: 'equal' });
  }
  flush();
  return out;
}
