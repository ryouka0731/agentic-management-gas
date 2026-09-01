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
 * 同じ装飾を持つ連続Runを結合し、空文字のRunを除去する。
 * 決定性を保つために必須の処理。DocumentAppは同じ装飾でもRunを
 * 分割して返すことがあるため、結合しないと差分ノイズになる。
 *
 * @param {object[]} runs
 * @returns {object[]}
 */
function mergeRuns(runs) {
  var out = [];
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (!r.text) continue;
    var last = out.length ? out[out.length - 1] : null;
    if (last && sameRunAttrs_(last, r)) {
      last.text += r.text;
    } else {
      var copy = { text: r.text };
      if (r.bold) copy.bold = true;
      if (r.italic) copy.italic = true;
      if (r.underline) copy.underline = true;
      if (r.strike) copy.strike = true;
      if (r.link) copy.link = r.link;
      out.push(copy);
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
      lines.push('<p>' + serializeRuns_(b.runs) + '</p>');
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
    }
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
