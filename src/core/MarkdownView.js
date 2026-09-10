/**
 * 補足を読む形に組み直す。
 *
 * 画面は textContent だけで組み立てる決まりなので、HTML の文字列は
 * 作らない。ここでは「どういう塊で、どこが強いか」までを決め、
 * 実際の組み立ては画面に任せる。
 *
 * 対応するのは、書く人がふだん使うものだけに絞る。見出し・箇条書き・
 * 番号付き・引用・区切り線・コード・強調・リンク。
 */

/**
 * 一行の中の飾りを切り分ける。
 *
 * 入れ子は見ない。「**強い `字`**」のような重ね方は、書くほうも読むほうも
 * 迷うため、外側だけを取る。
 *
 * @param {string} text
 * @returns {Array<{text:string, bold?:boolean, italic?:boolean, code?:boolean,
 *   link?:string}>}
 */
function mdRuns(text) {
  var src = String(text || '');
  var re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  var out = [];
  var at = 0;
  var m;

  function plain(part) {
    if (part) out.push({ text: part });
  }

  while ((m = re.exec(src)) !== null) {
    plain(src.substring(at, m.index));

    if (m[1]) {
      out.push({ text: m[1].substring(1, m[1].length - 1), code: true });
    } else if (m[2]) {
      out.push({ text: m[2].substring(2, m[2].length - 2), bold: true });
    } else if (m[3]) {
      out.push({ text: m[3].substring(1, m[3].length - 1), italic: true });
    } else {
      var link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(m[4]);
      out.push({ text: link[1], link: link[2] });
    }
    at = m.index + m[0].length;
  }

  plain(src.substring(at));
  return out.length ? out : [{ text: '' }];
}

/**
 * 補足を塊に分ける。
 *
 * @param {string} text
 * @returns {Array<object>} {type, level?, runs?, items?}
 */
function mdBlocks(text) {
  var lines = String(text || '').split('\n');
  var out = [];
  var para = [];
  var list = null;

  function flushPara() {
    if (!para.length) return;

    out.push({ type: 'p', runs: mdRuns(para.join('\n')) });
    para = [];
  }

  function flushList() {
    if (!list) return;

    out.push(list);
    list = null;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.replace(/\s+$/, '');

    if (!trimmed.replace(/^\s+/, '')) {
      flushPara();
      flushList();
      continue;
    }

    var head = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (head) {
      flushPara();
      flushList();
      out.push({ type: 'h', level: head[1].length, runs: mdRuns(head[2]) });
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushPara();
      flushList();
      out.push({ type: 'hr' });
      continue;
    }

    var quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushPara();
      flushList();
      out.push({ type: 'quote', runs: mdRuns(quote[1]) });
      continue;
    }

    // 手を付けたかどうかの印。順番の無い箇条書きより先に見る
    var task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (task) {
      flushPara();
      if (!list || list.type !== 'tasks') {
        flushList();
        list = { type: 'tasks', items: [] };
      }
      list.items.push({
        done: task[1].toLowerCase() === 'x',
        runs: mdRuns(task[2]),
      });
      continue;
    }

    var bullet = /^\s*[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushPara();
      if (!list || list.type !== 'ul') {
        flushList();
        list = { type: 'ul', items: [] };
      }
      list.items.push({ runs: mdRuns(bullet[1]) });
      continue;
    }

    var numbered = /^\s*\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushPara();
      if (!list || list.type !== 'ol') {
        flushList();
        list = { type: 'ol', items: [] };
      }
      list.items.push({ runs: mdRuns(numbered[1]) });
      continue;
    }

    flushList();
    para.push(trimmed);
  }

  flushPara();
  flushList();
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mdRuns: mdRuns, mdBlocks: mdBlocks };
}
