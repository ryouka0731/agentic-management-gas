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
  return String(text).replace(/\\([\\*~\[<|#\-.])/g, '$1');
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
    if (r.link) md = '[' + md + '](' + r.link + ')';
    if (r.strike) md = '~~' + md + '~~';
    if (r.underline) md = '<u>' + md + '</u>';
    if (r.italic) md = '*' + md + '*';
    if (r.bold) md = '**' + md + '**';
    out += md;
  }
  return out;
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
 * 先頭の装飾を1つ剥がし、中身を再帰的に解析する。
 *
 * @param {string} rest
 * @returns {{runs: object[], rest: string}|null} 剥がせなければ null
 */
function mdTakeDecorated_(rest) {
  var forms = [
    { open: '**', close: '**', attr: 'bold' },
    { open: '~~', close: '~~', attr: 'strike' },
    { open: '<u>', close: '</u>', attr: 'underline' },
    { open: '*', close: '*', attr: 'italic' },
  ];

  for (var i = 0; i < forms.length; i++) {
    var f = forms[i];
    if (rest.indexOf(f.open) !== 0) continue;

    var end = rest.indexOf(f.close, f.open.length);
    if (end < 0) continue;

    var inner = rest.substring(f.open.length, end);
    var runs = mdToRuns_(inner);
    for (var r = 0; r < runs.length; r++) runs[r][f.attr] = true;
    return { runs: runs, rest: rest.substring(end + f.close.length) };
  }

  var link = /^\[([\s\S]*?)\]\(([^)]*)\)/.exec(rest);
  if (link) {
    var lruns = mdToRuns_(link[1]);
    for (var k = 0; k < lruns.length; k++) lruns[k].link = link[2];
    return { runs: lruns, rest: rest.substring(link[0].length) };
  }
  return null;
}

/**
 * Markdown のインライン記法を Run配列にする。
 *
 * 外側から順に装飾を剥がす。runsToMd_ と対称にすることで往復が成立する。
 *
 * @param {string} md
 * @returns {object[]}
 */
function mdToRuns_(md) {
  var re = /(\*\*|\*|<u>|~~|\[)/;
  var rest = String(md);
  var runs = [];
  var plain = '';

  function flush() {
    if (!plain) return;
    runs.push({ text: unescapeMd_(plain) });
    plain = '';
  }

  while (rest) {
    // エスケープされた文字は記法として解釈しない
    if (rest.charAt(0) === '\\' && rest.length > 1) {
      plain += rest.substring(0, 2);
      rest = rest.substring(2);
      continue;
    }

    var m = re.exec(rest);
    if (!m) { plain += rest; break; }

    if (m.index > 0) {
      plain += rest.substring(0, m.index);
      rest = rest.substring(m.index);
      continue;
    }

    var parsed = mdTakeDecorated_(rest);
    if (!parsed) {
      plain += rest.charAt(0);
      rest = rest.substring(1);
      continue;
    }

    flush();
    for (var i = 0; i < parsed.runs.length; i++) runs.push(parsed.runs[i]);
    rest = parsed.rest;
  }
  flush();
  return runs;
}

/**
 * GFM テーブルの1行をセル配列にする。区切り行なら null を返す。
 *
 * @param {string} line
 * @returns {Array<object[]>|null}
 */
function mdTableRow_(line) {
  var body = line.replace(/^\|/, '').replace(/\|$/, '');
  var parts = body.split('|');
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
