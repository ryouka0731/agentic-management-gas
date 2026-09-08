/**
 * 空白を正規化する。連続する空白文字を1つのスペースにまとめ、前後を削除する。
 * これにより「見た目が同じで空白だけ違う」編集が差分にならない。
 *
 * 注意: JavaScriptの \s は全角スペース(U+3000)にもマッチする。したがって
 * 日本語文書でよく使われる全角スペースによる字下げは正規化で失われる。
 * これは意図的な挙動であり、字下げは書式であって内容ではないという
 * 設計判断 (spec §2.3「装飾は版管理の対象外」) に沿う。
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeSpace(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * テキストノード用のHTMLエスケープ。& を最初に置換して二重エスケープを防ぐ。
 *
 * @param {string} s
 * @returns {string}
 */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 属性値用のHTMLエスケープ。テキスト用に加えて " もエスケープする。
 *
 * @param {string} s
 * @returns {string}
 */
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * Runの装飾属性が同一かどうかを判定する。
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function sameRunAttrs_(a, b) {
  return a.bold === b.bold &&
         a.italic === b.italic &&
         a.underline === b.underline &&
         a.strike === b.strike &&
         a.link === b.link;
}

/**
 * Runを正規形にする。属性は true のときだけ持たせ、値の順序も固定する。
 *
 * リンクに対する下線は落とす。Google Docs はリンクに既定で下線を付けるため、
 * これは著者が指定した書式ではなく表示上の既定にすぎない。落とさないと
 * すべてのリンクに <u> が付き、差分ノイズの原因になる。
 *
 * @param {object} r
 * @returns {object}
 */
function normalizeRun_(r) {
  var copy = { text: r.text };
  if (r.bold) copy.bold = true;
  if (r.italic) copy.italic = true;
  if (r.underline && !r.link) copy.underline = true;
  if (r.strike) copy.strike = true;
  if (r.link) copy.link = r.link;
  return copy;
}

/**
 * Runを正規形にしたうえで、同じ装飾を持つ連続Runを結合し、
 * 空文字のRunを除去する。
 *
 * 決定性を保つために必須の処理。DocumentAppは同じ装飾でもRunを
 * 分割して返すことがあるため、結合しないと差分ノイズになる。
 *
 * @param {object[]} runs
 * @returns {object[]}
 */
function mergeRuns(runs) {
  var out = [];
  for (var i = 0; i < runs.length; i++) {
    if (!runs[i].text) continue;
    var r = normalizeRun_(runs[i]);
    var last = out.length ? out[out.length - 1] : null;
    if (last && sameRunAttrs_(last, r)) {
      last.text += r.text;
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * Run配列をインラインHTMLに変換する。
 * 装飾のネスト順は bold → italic → underline → strike → link で固定。
 * この順序を固定しないと、同じ内容から異なるHTMLが出て差分ノイズになる。
 *
 * @param {object[]} runs
 * @returns {string}
 */
function serializeRuns_(runs) {
  var merged = mergeRuns(runs || []);
  var out = '';
  for (var i = 0; i < merged.length; i++) {
    var r = merged[i];
    var html = escapeText(normalizeSpace(r.text));
    if (r.link) html = '<a href="' + escapeAttr(r.link) + '">' + html + '</a>';
    if (r.strike) html = '<s>' + html + '</s>';
    if (r.underline) html = '<u>' + html + '</u>';
    if (r.italic) html = '<em>' + html + '</em>';
    if (r.bold) html = '<strong>' + html + '</strong>';
    out += html;
  }
  return out;
}

/**
 * Block配列を正規化HTML文字列に変換する。
 *
 * 出力は決定的である: 同じBlock配列からは常にバイト単位で同一の文字列が出る。
 * 1ブロック=1行 (tableのみ複数行) とすることで、行ベースdiffが
 * そのまま意味のある差分になる。
 *
 * @param {object[]} blocks
 * @returns {string} 各行が改行で終わるHTML文字列
 */
function serializeBlocks(blocks) {
  var lines = [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.type === 'heading') {
      var lv = Math.min(6, Math.max(1, b.level));
      lines.push('<h' + lv + '>' + serializeRuns_(b.runs) + '</h' + lv + '>');
    } else if (b.type === 'paragraph') {
      var inner = serializeRuns_(b.runs);
      // 空段落は出力しない。Docs上の空行は書式であって内容ではないため、
      // 空行を1つ足しただけで差分が出るのを防ぐ。
      if (inner) lines.push('<p>' + inner + '</p>');
    } else if (b.type === 'listItem') {
      lines.push(
        '<li data-list="' + (b.ordered ? 'ol' : 'ul') + '"' +
        ' data-depth="' + (b.depth || 0) + '">' +
        serializeRuns_(b.runs) + '</li>'
      );
    } else if (b.type === 'table') {
      lines.push('<table>');
      for (var r = 0; r < b.rows.length; r++) {
        var cells = '';
        for (var c = 0; c < b.rows[r].length; c++) {
          cells += '<td>' + serializeRuns_(b.rows[r][c]) + '</td>';
        }
        lines.push('<tr>' + cells + '</tr>');
      }
      lines.push('</table>');
    } else if (b.type === 'image') {
      lines.push(
        '<img data-sha="' + escapeAttr(b.sha) + '"' +
        ' alt="' + escapeAttr(b.alt || '') + '">'
      );
    } else if (b.type === 'sheet') {
      lines.push('<table data-sheet="' + escapeAttr(normalizeSpace(b.name || '')) + '">');

      for (var sr = 0; sr < b.rows.length; sr++) {
        var scells = '';
        for (var sc = 0; sc < b.rows[sr].length; sc++) {
          var cell = b.rows[sr][sc] || {};
          // Sheets のセルは Alt+Enter で改行を含められる。そのまま出すと
          // <tr> が複数行に割れ、1ブロック=1行が壊れて行ベースdiffが
          // 意味を失う
          var open = cell.formula
            ? '<td data-formula="' + escapeAttr(normalizeSpace(cell.formula)) + '">'
            : '<td>';
          scells += open + escapeText(normalizeSpace(cell.value || '')) + '</td>';
        }
        lines.push('<tr>' + scells + '</tr>');
      }
      lines.push('</table>');
    } else if (b.type === 'slide') {
      lines.push('<section data-slide="' + Number(b.index) + '">');
    }
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

/**
 * escapeText の逆変換。&amp; を最後に戻して二重デコードを防ぐ。
 *
 * @param {string} s
 * @returns {string}
 */
function unescapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * インラインHTMLをRun配列にパースする。
 * serializeRuns_ が出力する形式 (固定ネスト順) のみを対象とする。
 *
 * @param {string} inner
 * @returns {object[]}
 */
function parseRuns_(inner) {
  var runs = [];
  var re = /<(strong|em|u|s|a)\b([^>]*)>|<\/(strong|em|u|s|a)>|([^<]+)/g;
  var stack = [];
  var m;
  while ((m = re.exec(inner)) !== null) {
    if (m[1]) {
      var frame = { tag: m[1] };
      if (m[1] === 'a') {
        var href = /href="([^"]*)"/.exec(m[2] || '');
        frame.link = href ? unescapeText(href[1]) : '';
      }
      stack.push(frame);
    } else if (m[3]) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === m[3]) { stack.splice(i, 1); break; }
      }
    } else if (m[4]) {
      var run = { text: unescapeText(m[4]) };
      for (var j = 0; j < stack.length; j++) {
        var t = stack[j].tag;
        if (t === 'strong') run.bold = true;
        else if (t === 'em') run.italic = true;
        else if (t === 'u') run.underline = true;
        else if (t === 's') run.strike = true;
        else if (t === 'a') run.link = stack[j].link;
      }
      runs.push(run);
    }
  }
  return mergeRuns(runs);
}

/**
 * <tr>...</tr> の1行をセルのRun配列の配列にパースする。
 *
 * @param {string} line
 * @returns {object[][]}
 */
function parseTableRow_(line) {
  var cells = [];
  var re = /<td>([\s\S]*?)<\/td>/g;
  var m;
  while ((m = re.exec(line)) !== null) {
    cells.push(parseRuns_(m[1]));
  }
  return cells;
}

/**
 * シート行をセル配列にパースする。
 *
 * Docsの表と違い、セルは装飾を持たない素の文字列と数式である。
 *
 * @param {string} line
 * @returns {Array<{value:string, formula?:string}>}
 */
function parseSheetRow_(line) {
  var cells = [];
  var re = /<td(?: data-formula="([^"]*)")?>([\s\S]*?)<\/td>/g;
  var m;

  while ((m = re.exec(line)) !== null) {
    var cell = { value: unescapeText(m[2]) };
    if (m[1] !== undefined) cell.formula = unescapeText(m[1]);
    cells.push(cell);
  }
  return cells;
}

/**
 * 正規化HTML文字列をBlock配列にパースする。
 *
 * serializeBlocks が出力した形式のみを対象とする限定パーサである。
 * 汎用HTMLは扱えないが、その必要はない。
 *
 * @param {string} html
 * @returns {object[]}
 */
function parseBlocks(html) {
  var blocks = [];
  var lines = String(html == null ? '' : html).split('\n');
  var table = null;
  var sheet = null;
  var sheetName = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;

    if (sheet !== null) {
      if (line === '</table>') {
        blocks.push({ type: 'sheet', name: sheetName, rows: sheet });
        sheet = null;
      } else if (line.indexOf('<tr>') === 0) {
        sheet.push(parseSheetRow_(line));
      }
      continue;
    }

    if (table !== null) {
      if (line === '</table>') {
        blocks.push({ type: 'table', rows: table });
        table = null;
      } else if (line.indexOf('<tr>') === 0) {
        table.push(parseTableRow_(line));
      }
      continue;
    }

    var ms = /^<table data-sheet="([^"]*)">$/.exec(line);
    if (ms) { sheet = []; sheetName = unescapeText(ms[1]); continue; }

    if (line === '<table>') { table = []; continue; }

    var mh = /^<h([1-6])>([\s\S]*)<\/h\1>$/.exec(line);
    if (mh) {
      blocks.push({
        type: 'heading',
        level: Number(mh[1]),
        runs: parseRuns_(mh[2]),
      });
      continue;
    }

    var mp = /^<p>([\s\S]*)<\/p>$/.exec(line);
    if (mp) {
      blocks.push({ type: 'paragraph', runs: parseRuns_(mp[1]) });
      continue;
    }

    var ml = /^<li data-list="(ul|ol)" data-depth="(\d+)">([\s\S]*)<\/li>$/.exec(line);
    if (ml) {
      blocks.push({
        type: 'listItem',
        ordered: ml[1] === 'ol',
        depth: Number(ml[2]),
        runs: parseRuns_(ml[3]),
      });
      continue;
    }

    var msl = /^<section data-slide="(\d+)">$/.exec(line);
    if (msl) {
      blocks.push({ type: 'slide', index: Number(msl[1]) });
      continue;
    }

    var mi = /^<img data-sha="([^"]*)" alt="([^"]*)">$/.exec(line);
    if (mi) {
      blocks.push({
        type: 'image',
        sha: unescapeText(mi[1]),
        alt: unescapeText(mi[2]),
      });
      continue;
    }
  }

  // <table> が閉じられずに終わった場合も取りこぼさない
  if (table !== null) blocks.push({ type: 'table', rows: table });
  if (sheet !== null) blocks.push({ type: 'sheet', name: sheetName, rows: sheet });

  return blocks;
}

/**
 * 正規化HTMLの1行を、人が読める形に直す。
 *
 * 差分をタグのまま見せると、何が変わったのかを読むのに知識が要る。
 * 種別と本文に分けて示す。
 *
 * @param {string} line
 * @returns {{kind:string, text:string}}
 */
function describeLine(line) {
  var raw = String(line == null ? '' : line);

  var mh = /^<h([1-6])>([\s\S]*)<\/h\1>$/.exec(raw);
  if (mh) return { kind: '見出し' + mh[1], text: stripTags_(mh[2]) };

  var mp = /^<p>([\s\S]*)<\/p>$/.exec(raw);
  if (mp) return { kind: '段落', text: stripTags_(mp[1]) };

  var ml = /^<li data-list="(ul|ol)" data-depth="(\d+)">([\s\S]*)<\/li>$/.exec(raw);
  if (ml) {
    return {
      kind: (ml[1] === 'ol' ? '番号' : '箇条') + '書き',
      text: new Array(Number(ml[2]) + 1).join('  ') + stripTags_(ml[3]),
    };
  }

  var mi = /^<img data-sha="([^"]*)" alt="([^"]*)">$/.exec(raw);
  if (mi) return { kind: '画像', text: unescapeText(mi[2]) || '(説明なし)' };

  var ms = /^<table data-sheet="([^"]*)">$/.exec(raw);
  if (ms) return { kind: 'シート', text: unescapeText(ms[1]) };

  var msl = /^<section data-slide="(\d+)">$/.exec(raw);
  if (msl) return { kind: 'スライド', text: msl[1] + '枚目' };

  if (raw === '<table>') return { kind: '表', text: '開始' };
  if (raw === '</table>') return { kind: '表', text: '終わり' };

  if (raw.indexOf('<tr>') === 0) {
    var cells = [];
    var re = /<td(?: data-formula="[^"]*")?>([\s\S]*?)<\/td>/g;
    var m;
    while ((m = re.exec(raw)) !== null) cells.push(stripTags_(m[1]));
    return { kind: '行', text: cells.join(' | ') };
  }

  return { kind: '', text: stripTags_(raw) };
}

/**
 * タグを外して本文だけにする。
 *
 * @param {string} html
 * @returns {string}
 */
function stripTags_(html) {
  return unescapeText(String(html == null ? '' : html).replace(/<[^>]*>/g, ''));
}
