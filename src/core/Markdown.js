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
