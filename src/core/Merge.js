/**
 * 差分操作列を、base に対する置換区間 (hunk) のリストに変換する。
 *
 * hunk は {start, end, lines} で、base[start..end) を lines に
 * 置き換えることを意味する。equal が続く区間は hunk にならない。
 *
 * @param {object[]} ops diffLines の出力
 * @returns {object[]} {start:number, end:number, lines:string[]}
 */
function toHunks_(ops) {
  var hunks = [];
  var basePos = 0;
  var i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      basePos++;
      i++;
      continue;
    }

    var start = basePos;
    var replacement = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') {
        basePos++;
      } else {
        replacement.push(ops[i].line);
      }
      i++;
    }
    hunks.push({ start: start, end: basePos, lines: replacement });
  }

  return hunks;
}

/**
 * 2つの文字列配列が等しいか判定する。
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function sameLines_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 2つのhunkが base 上で重なるか判定する。
 *
 * 長さ0の区間 (純粋な挿入) は、同じ位置にある場合のみ重なりとみなす。
 * 挿入位置が同じなら、どちらを先に置くか決められないためコンフリクトになる。
 *
 * @param {object} h1
 * @param {object} h2
 * @returns {boolean}
 */
function hunksOverlap_(h1, h2) {
  if (h1.start === h1.end && h2.start === h2.end) return h1.start === h2.start;
  return h1.start < h2.end && h2.start < h1.end;
}

/**
 * base の [from, to) に、その範囲にある片側の変更を当てた結果を返す。
 *
 * @param {string[]} base
 * @param {object[]} hunks 範囲の中の hunk (start 順)
 * @param {number} from
 * @param {number} to
 * @returns {string[]}
 */
function applyHunks_(base, hunks, from, to) {
  var out = [];
  var pos = from;

  for (var i = 0; i < hunks.length; i++) {
    while (pos < hunks[i].start) out.push(base[pos++]);
    for (var k = 0; k < hunks[i].lines.length; k++) out.push(hunks[i].lines[k]);
    pos = hunks[i].end;
  }
  while (pos < to) out.push(base[pos++]);
  return out;
}

/**
 * base / ours / theirs の3-wayマージを行う。
 *
 * base に対する ours の変更と theirs の変更をそれぞれ hunk に変換し、
 * base 上で重なるかどうかで判定する:
 *   - 重ならない        → 両方適用
 *   - 重なり内容が同じ  → 片方だけ適用
 *   - 重なり内容が違う  → コンフリクト
 *
 * コンフリクトがある場合も lines には ours 側を入れて返す。
 * 未解決のままプレビューできるようにするため。
 *
 * @param {string[]} base 分岐点の内容
 * @param {string[]} ours マージ先 (通常 main) の現在の内容
 * @param {string[]} theirs マージ元 (ブランチ) の現在の内容
 * @returns {{clean:boolean, lines:string[], conflicts:object[]}}
 */
function merge3(base, ours, theirs) {
  var oursHunks = toHunks_(diffLines(base, ours));
  var theirsHunks = toHunks_(diffLines(base, theirs));

  var lines = [];
  var conflicts = [];
  var basePos = 0;
  var oi = 0;
  var ti = 0;

  while (oi < oursHunks.length || ti < theirsHunks.length) {
    var oh = oi < oursHunks.length ? oursHunks[oi] : null;
    var th = ti < theirsHunks.length ? theirsHunks[ti] : null;

    // 次に処理すべきhunkの開始位置
    var nextStart;
    if (oh && th) nextStart = Math.min(oh.start, th.start);
    else if (oh) nextStart = oh.start;
    else nextStart = th.start;

    // hunkの手前までのbase行をそのまま出力
    while (basePos < nextStart) {
      lines.push(base[basePos]);
      basePos++;
    }

    if (oh && th && hunksOverlap_(oh, th)) {
      /*
       * **重なる変更を、つながる限りまとめて1つの食い違いにする。**
       *
       * 1つずつしか突き合わせないと、片側の1つの変更が相手の2つにまたがる
       * とき、相手の2つ目が食い違いから漏れる。こちらを選ぶと消したはずの
       * 行が戻り、相手を選ぶと相手が残していた行が消えていた。
       */
      var from = Math.min(oh.start, th.start);
      var to = Math.max(oh.end, th.end);
      var mine = [oh];
      var yours = [th];
      oi++;
      ti++;

      var grew = true;
      while (grew) {
        grew = false;
        while (oi < oursHunks.length &&
               hunksOverlap_(oursHunks[oi], { start: from, end: to })) {
          mine.push(oursHunks[oi]);
          to = Math.max(to, oursHunks[oi].end);
          oi++;
          grew = true;
        }
        while (ti < theirsHunks.length &&
               hunksOverlap_(theirsHunks[ti], { start: from, end: to })) {
          yours.push(theirsHunks[ti]);
          to = Math.max(to, theirsHunks[ti].end);
          ti++;
          grew = true;
        }
      }

      var oursPart = applyHunks_(base, mine, from, to);
      var theirsPart = applyHunks_(base, yours, from, to);

      if (sameLines_(oursPart, theirsPart)) {
        for (var s = 0; s < oursPart.length; s++) lines.push(oursPart[s]);
      } else {
        conflicts.push({
          index: lines.length,
          base: base.slice(from, to),
          ours: oursPart,
          theirs: theirsPart,
        });
        // 未解決の間は ours 側を入れておく
        for (var c = 0; c < oursPart.length; c++) lines.push(oursPart[c]);
      }
      basePos = to;

    } else if (oh && (!th || oh.start < th.start ||
               (oh.start === th.start && oh.start === oh.end))) {
      // 同じ位置で重ならないのは、片方が挿入のとき。挿入を先に置く。
      // 削除を先に処理すると、読み進めた位置が後ろへ戻り、消した行を
      // もう一度写してしまう
      for (var o = 0; o < oh.lines.length; o++) lines.push(oh.lines[o]);
      basePos = Math.max(basePos, oh.end);
      oi++;

    } else {
      for (var t = 0; t < th.lines.length; t++) lines.push(th.lines[t]);
      basePos = Math.max(basePos, th.end);
      ti++;
    }
  }

  // 残りのbase行を出力
  while (basePos < base.length) {
    lines.push(base[basePos]);
    basePos++;
  }

  return { clean: conflicts.length === 0, lines: lines, conflicts: conflicts };
}

/**
 * 正規化HTML同士を3-wayマージする。
 *
 * @param {string} baseHtml
 * @param {string} oursHtml
 * @param {string} theirsHtml
 * @returns {{clean:boolean, lines:string[], conflicts:object[]}}
 */
function merge3Html(baseHtml, oursHtml, theirsHtml) {
  return merge3(splitLines(baseHtml), splitLines(oursHtml), splitLines(theirsHtml));
}

/**
 * コンフリクトに対する選択を適用して最終的な行配列を作る。
 *
 * merge3 の lines には ours 側が入っているため、'ours' 以外を選んだ
 * コンフリクトだけを置き換える。後ろのコンフリクトから処理することで
 * インデックスのずれを避ける。
 *
 * @param {object} result merge3 の戻り値
 * @param {string[]} choices 各コンフリクトに対する 'ours'|'theirs'|'both'
 * @returns {string[]}
 */
function resolveConflicts(result, choices) {
  if (result.conflicts.length !== choices.length) {
    throw new Error(
      '選択の数がコンフリクトの数と一致しません: ' +
      choices.length + ' / ' + result.conflicts.length
    );
  }

  var lines = result.lines.slice();

  for (var i = result.conflicts.length - 1; i >= 0; i--) {
    var conf = result.conflicts[i];
    var choice = choices[i];
    var replacement;

    if (choice === 'ours') {
      continue;
    } else if (choice === 'theirs') {
      replacement = conf.theirs;
    } else if (choice === 'both') {
      replacement = conf.ours.concat(conf.theirs);
    } else {
      throw new Error('不正な選択です: ' + choice);
    }

    var args = [conf.index, conf.ours.length].concat(replacement);
    Array.prototype.splice.apply(lines, args);
  }

  return lines;
}
