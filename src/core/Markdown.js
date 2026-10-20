/**
 * Markdown の記法に使う文字をエスケープする。
 *
 * 対象は parser が意味を持たせる文字だけに絞る。_ は斜体に使わないため
 * エスケープしない。過剰にエスケープすると人が読めなくなる。
 *
 * @param {string} text
 * @returns {string}
 */
function escapeMd_(text) {
  return String(text).replace(/([\\*~\[<|])/g, '\\$1');
}

/**
 * escapeMd_ の逆変換。
 *
 * @param {string} text
 * @returns {string}
 */
function unescapeMd_(text) {
  return String(text).replace(/\\([\\*~\[\]<|#\-.])/g, '$1');
}

/**
 * Run配列を Markdown のインライン記法にする。
 *
 * 装飾のネスト順は Normalize.js の serializeRuns_ と同じ
 * bold → italic → underline → strike → link で固定する。
 * 順序が違うと往復で形が変わる。
 *
 * @param {object[]} runs
 * @returns {string}
 */
function runsToMd_(runs) {
  var out = '';

  for (var i = 0; i < (runs || []).length; i++) {
    var r = runs[i];
    if (!r.text) continue;

    var md = escapeMd_(r.text);
    // リンクの字の中の ]( は逃がす。逃がさないと、字 `a](b` と URL `c` が、字 `a` と
    // URL `b](c` と同じ `[a](b](c)` になり、読む側がどちらとも決められない
    if (r.link) md = '[' + md.replace(/\]\(/g, '\\](') + '](' + escapeMdUrl_(r.link) + ')';
    if (r.strike) md = '~~' + md + '~~';
    if (r.underline) md = '<u>' + md + '</u>';
    if (r.italic) md = '*' + md + '*';
    if (r.bold) md = '**' + md + '**';
    out += md;
  }
  return out;
}

/**
 * リンクの URL を逃がす。
 *
 * 読むときは `)` で URL の終わりとみなすので、URL の中の `)` (例:
 * `…/wiki/X_(Y)`) を逃がさないと URL が途中で切れ、残りが本文に漏れる。
 *
 * @param {string} url
 * @returns {string}
 */
function escapeMdUrl_(url) {
  return String(url).replace(/([\\)])/g, '\\$1');
}

/**
 * 行頭が記法に見える場合にエスケープする。
 *
 * @param {string} line
 * @returns {string}
 */
function escapeLineStart_(line) {
  if (/^#{1,6} /.test(line)) return '\\' + line;
  if (/^- /.test(line)) return '\\' + line;
  if (/^(\d+)\. /.test(line)) return line.replace(/^(\d+)\./, '$1\\.');
  if (/^\| /.test(line)) return '\\' + line;
  return line;
}

/**
 * テーブルの行配列を GFM テーブルにする。先頭行をヘッダとして扱う。
 *
 * @param {Array<Array<object[]>>} rows
 * @returns {string}
 */
function tableToMd_(rows) {
  if (!rows.length) return '';

  var width = 0;
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].length > width) width = rows[r].length;
  }

  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var cells = [];
    for (var c = 0; c < width; c++) cells.push(runsToMd_(rows[i][c] || []));
    lines.push('| ' + cells.join(' | ') + ' |');

    if (i === 0) {
      var seps = [];
      for (var s = 0; s < width; s++) seps.push('---');
      lines.push('| ' + seps.join(' | ') + ' |');
    }
  }
  return lines.join('\n');
}

/**
 * Block配列を Markdown にする。
 *
 * 連続するリスト項目は空行で区切らない。区切ると Markdown として
 * 別のリストになってしまう。
 *
 * @param {object[]} blocks
 * @returns {string} 末尾に改行を持つ Markdown
 */
function blocksToMd(blocks) {
  var chunks = [];

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];

    if (b.type === 'heading') {
      var level = Math.min(6, Math.max(1, b.level));
      chunks.push({
        glue: 'blank',
        text: new Array(level + 1).join('#') + ' ' + runsToMd_(b.runs),
      });
    } else if (b.type === 'paragraph') {
      var line = runsToMd_(b.runs);
      if (!line) continue;
      chunks.push({ glue: 'blank', text: escapeLineStart_(line) });
    } else if (b.type === 'listItem') {
      var indent = new Array((b.depth || 0) + 1).join('  ');
      var marker = b.ordered ? '1. ' : '- ';
      chunks.push({ glue: 'list', text: indent + marker + runsToMd_(b.runs) });
    } else if (b.type === 'table') {
      chunks.push({ glue: 'blank', text: tableToMd_(b.rows) });
    } else if (b.type === 'image') {
      chunks.push({
        glue: 'blank',
        text: '![' + escapeMd_(b.alt || '') + '](sha:' + b.sha + ')',
      });
    }
  }

  var out = '';
  for (var c = 0; c < chunks.length; c++) {
    if (c > 0) {
      var bothList = chunks[c].glue === 'list' && chunks[c - 1].glue === 'list';
      out += bothList ? '\n' : '\n\n';
    }
    out += chunks[c].text;
  }
  return out ? out + '\n' : '';
}

/**
 * 装飾の形。開きと閉じと、付ける属性。** は * より先に試す。
 *
 * @returns {object[]}
 */
function mdForms_() {
  return [
    { open: '**', close: '**', attr: 'bold' },
    { open: '~~', close: '~~', attr: 'strike' },
    { open: '<u>', close: '</u>', attr: 'underline' },
    { open: '*', close: '*', attr: 'italic' },
  ];
}

/** 入れ子をこれより深く試さない。書く側の入れ子は最大5段 (太字〜リンク) */
function MD_MAX_DEPTH_() { return 32; }

/**
 * run を写す。覚えておいた読みの結果を、別の場所で使い回しても書き換わらないように。
 *
 * @param {object} run
 * @returns {object}
 */
function mdCopyRun_(run) {
  var out = {};
  for (var k in run) if (Object.prototype.hasOwnProperty.call(run, k)) out[k] = run[k];
  return out;
}

/**
 * pos から始まる装飾を1つ剥がし、中身を再帰的に解析する。
 *
 * 閉じは indexOf で探さない。中身を頭から読み、逃がした字 (\\*) と内側の装飾を
 * 飛ばしたうえで、最初に現れた自分の閉じで閉じる。indexOf だと `***x***` の閉じを
 * 内側の ** と取り違え、`**a\\***` の \\* を閉じと読んでいた。
 *
 * @param {string} src
 * @param {number} pos
 * @param {object} memo
 * @param {number} depth
 * @returns {{runs: object[], end: number}|null} 剥がせなければ null
 */
function mdTakeDecorated_(src, pos, memo, depth) {
  // 試せる手間を使い切ったら、それ以上は装飾を開かない (字として残す)
  if (memo.budget <= 0) return null;
  var forms = memo.forms;

  for (var i = 0; i < forms.length; i++) {
    var f = forms[i];
    if (src.substr(pos, f.open.length) !== f.open) continue;

    var inner = mdParseInline_(src, pos + f.open.length, f.close, memo, depth + 1);
    if (!inner) continue;

    var runs = [];
    for (var r = 0; r < inner.runs.length; r++) {
      var run = mdCopyRun_(inner.runs[r]);
      run[f.attr] = true;
      runs.push(run);
    }
    return { runs: runs, end: inner.end + f.close.length };
  }

  if (src.charAt(pos) === '[') {
    // リンクの字は最初の逃がしていない ]( で終わる (書く側は字の中の ]( を逃がす)
    var text = mdParseInline_(src, pos + 1, '](', memo, depth + 1);
    if (!text) return null;

    var j = text.end + 2;
    var url = '';
    while (j < src.length && src.charAt(j) !== ')') {
      if (src.charAt(j) === '\\' && j + 1 < src.length) {
        var next = src.charAt(j + 1);
        url += (next === '\\' || next === ')') ? next : '\\' + next;
        j += 2;
      } else {
        url += src.charAt(j);
        j++;
      }
    }
    if (j >= src.length) return null;

    var lruns = [];
    for (var k = 0; k < text.runs.length; k++) {
      var lrun = mdCopyRun_(text.runs[k]);
      lrun.link = url;
      lruns.push(lrun);
    }
    return { runs: lruns, end: j + 1 };
  }
  return null;
}

/**
 * pos から読み、closer が現れたところで止める。closer が空なら最後まで読む。
 *
 * 中身の無い装飾は装飾と読まない (書く側は空の run を出さない)。読むと、閉じの
 * 無い `a **b` の ** を「中身の無い斜体」として2字とも消していた。開けなかった
 * `*` / `~` だけの中身も中身と数えない (書く側は字の中の * と ~ を逃がすので、
 * そういう中身は出さない。数えると `***` が斜体の `*` になる)。閉じが
 * 見つからなければ null を返し、呼んだ側は開きの字をそのまま字として残す。
 *
 * 結果は (pos, closer) だけで決まるので覚えておく。覚えないと、閉じの無い記号が
 * 並んだときに試し直しが指数的に増える。
 *
 * @param {string} src
 * @param {number} pos
 * @param {string} closer
 * @param {object} memo
 * @param {number} depth
 * @returns {{runs: object[], end: number}|null}
 */
function mdParseInline_(src, pos, closer, memo, depth) {
  var key = pos + '|' + closer;
  if (key in memo) return memo[key];
  // 深すぎる入れ子は装飾と読まない (呼び出しの深さで落ちないように)。書く側の
  // 入れ子は5段まで。閉じの無い記号が 32 以上続く所では、その先の装飾を字の
  // まま読むことがあるが、字は落とさない
  if (depth > MD_MAX_DEPTH_()) return null;

  var runs = [];
  var plain = '';
  var real = false;
  var i = pos;
  var result = null;

  function flush() {
    if (!plain) return;
    runs.push({ text: unescapeMd_(plain) });
    plain = '';
  }

  while (i < src.length) {
    memo.budget--;
    if (closer && real && src.substr(i, closer.length) === closer) {
      flush();
      result = { runs: runs, end: i };
      break;
    }

    // エスケープされた文字は記法として解釈しない
    var ch = src.charAt(i);
    if (ch === '\\' && i + 1 < src.length) {
      plain += src.substr(i, 2);
      real = true;
      i += 2;
      continue;
    }

    var taken = (ch === '*' || ch === '~' || ch === '<' || ch === '[')
      ? mdTakeDecorated_(src, i, memo, depth)
      : null;
    if (taken) {
      flush();
      for (var r = 0; r < taken.runs.length; r++) runs.push(taken.runs[r]);
      real = true;
      i = taken.end;
      continue;
    }

    plain += ch;
    if (ch !== '*' && ch !== '~') real = true;
    i++;
  }

  if (!result && !closer) {
    flush();
    result = { runs: runs, end: i };
  }
  memo[key] = result;
  return result;
}

/**
 * Markdown のインライン記法を Run配列にする。
 *
 * 外側から順に装飾を剥がす。runsToMd_ と対称にすることで往復が成立する。
 * 閉じの見つからない記号は字のまま残す。
 *
 * @param {string} md
 * @returns {object[]}
 */
function mdToRuns_(md) {
  var src = String(md);
  // 閉じの無い記号を試すたびに最後まで読むので、記号が多いと手間が字数の2乗で
  // 増える。書く側の出力は試し損ねないので字数ほどで済む。手間を字数の 16 倍に
  // 抑え、超えた先の記号は字のまま読む (字は落とさない)
  var memo = Object.create(null);
  memo.forms = mdForms_();
  memo.budget = 16 * src.length + 4096;
  return mdParseInline_(src, 0, '', memo, 0).runs;
}

/**
 * GFM テーブルの1行をセル配列にする。区切り行なら null を返す。
 *
 * @param {string} line
 * @returns {Array<object[]>|null}
 */
function mdTableRow_(line) {
  // 逃がした縦棒 (\\|) では割らない。書くときはセルの中の | を逃がしている
  var parts = [];
  var cur = '';
  var body = line.replace(/^\|/, '');

  for (var p = 0; p < body.length; p++) {
    var ch = body.charAt(p);
    if (ch === '\\' && p + 1 < body.length) {
      cur += body.substring(p, p + 2);
      p++;
    } else if (ch === '|') {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  // 行末の | のあとは空。それ以外の字が残っていればセルとして扱う
  if (cur.replace(/^\s+|\s+$/g, '') !== '' || !parts.length) parts.push(cur);

  var cells = [];
  var separator = true;

  for (var i = 0; i < parts.length; i++) {
    var text = parts[i].replace(/^ /, '').replace(/ $/, '');
    if (!/^-{3,}$/.test(text)) separator = false;
    cells.push(mdToRuns_(text));
  }
  return separator ? null : cells;
}

/**
 * Markdown を Block配列にする。
 *
 * blocksToMd が出力した形式を対象とする限定パーサである。
 * 汎用の Markdown は扱えないが、その必要はない。
 *
 * @param {string} markdown
 * @returns {object[]}
 */
function mdToBlocks(markdown) {
  var lines = String(markdown == null ? '' : markdown).split('\n');
  var blocks = [];
  var para = [];

  function flushPara() {
    if (!para.length) return;
    blocks.push({ type: 'paragraph', runs: mdToRuns_(para.join(' ')) });
    para = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.replace(/^\s+|\s+$/g, '')) { flushPara(); continue; }

    var mh = /^(#{1,6}) ([\s\S]*)$/.exec(line);
    if (mh) {
      flushPara();
      blocks.push({ type: 'heading', level: mh[1].length, runs: mdToRuns_(mh[2]) });
      continue;
    }

    var mi = /^!\[([\s\S]*)\]\(sha:([0-9a-f]{64}|unavailable)\)$/.exec(line);
    if (mi) {
      flushPara();
      blocks.push({ type: 'image', sha: mi[2], alt: unescapeMd_(mi[1]) });
      continue;
    }

    var ml = /^( *)(- |\d+\. )([\s\S]*)$/.exec(line);
    if (ml) {
      flushPara();
      blocks.push({
        type: 'listItem',
        ordered: ml[2] !== '- ',
        depth: Math.floor(ml[1].length / 2),
        runs: mdToRuns_(ml[3]),
      });
      continue;
    }

    if (line.indexOf('|') === 0) {
      flushPara();
      var rows = [];
      while (i < lines.length && lines[i].indexOf('|') === 0) {
        var cells = mdTableRow_(lines[i]);
        if (cells !== null) rows.push(cells);
        i++;
      }
      i--;
      blocks.push({ type: 'table', rows: rows });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}
