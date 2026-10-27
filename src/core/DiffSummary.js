/*
 * 変わった箇所の要約 (やること #109)。
 *
 * 上長は差分の行を読まない。正規化した HTML の行の差分 (Diff.js) から、
 * 「第3条: 変更 (始業は午前9時 → 始業は午前9時30分)」「表 別表1: 2 行追加」の
 * ような短い箇条書きを**機械的に**作る。AI は使わない。
 *
 * **差分を読むだけで、正規化の出力 (Normalize.js) には触れない。** 場所の手がかりは
 * 直前の見出し (h1〜h3) と、段落の先頭の印 (「第3条」「1.」「（2）」など)。
 *
 * Normalize.js (stripTags_ / serializeBlocks) と Diff.js (diffLines / splitLines) を使う。
 */

/** 箇条書きの本数の上限。超えたぶんは「ほか N か所」にまとめる */
function DIFF_SUMMARY_MAX() {
  return 8;
}

/** 「前 → 後」の字数の上限 */
function DIFF_SUMMARY_CHANGE_MAX() {
  return 40;
}

/** 追加・削除の抜粋の字数の上限 */
function DIFF_SUMMARY_EXCERPT_MAX() {
  return 30;
}

/**
 * 変わった箇所を箇条書きにする。
 *
 * 呼び方は2つ。
 * - `diffSummarize(ops)`: 行の差分 (diffHtml / diffLines の返り) をそのまま渡す
 * - `diffSummarize(前, 後)`: 正規化 HTML の字か、Block の配列を2つ渡す
 *
 * @param {Array|string} a 行の差分、または前の中身
 * @param {Array|string} [b] 後の中身
 * @returns {string[]} 箇条書き (最大 8 本。超えたら最後に「ほか N か所」)
 */
function diffSummarize(a, b) {
  var ops = (b === undefined && Array.isArray(a))
    ? a
    : diffLines(diffSummaryLines_(a), diffSummaryLines_(b));
  return diffSummaryCap_(diffSummaryItems_(ops), DIFF_SUMMARY_MAX());
}

/**
 * 変更セットの何件かの文書をまとめて箇条書きにする。
 *
 * 2件以上あるときは、どの文書のことかを頭に付ける (付けないと読めない)。
 * 上限は全体で 8 本。
 *
 * @param {Array<{path:string, ops:Array}>} list
 * @returns {string[]}
 */
function diffSummaryFiles(list) {
  var all = [];
  var files = list || [];

  for (var i = 0; i < files.length; i++) {
    var items = diffSummaryItems_(files[i].ops || []);
    for (var k = 0; k < items.length; k++) {
      all.push(files.length > 1 ? String(files[i].path) + ' / ' + items[k] : items[k]);
    }
  }
  return diffSummaryCap_(all, DIFF_SUMMARY_MAX());
}

/** 正規化 HTML の字か Block の配列を、行の配列にする */
function diffSummaryLines_(x) {
  if (x === null || x === undefined) return [];
  if (Array.isArray(x)) return splitLines(serializeBlocks(x));
  return splitLines(String(x));
}

/** 上限を超えたぶんを「ほか N か所」にまとめる */
function diffSummaryCap_(items, max) {
  if (items.length <= max) return items.slice();
  var out = items.slice(0, max);
  out.push('ほか ' + (items.length - max) + ' か所');
  return out;
}

/**
 * 1行を読む。
 *
 * @param {string} line
 * @returns {{kind:string, text:string, level?:number, name?:string, index?:number}}
 */
function diffSummaryRead_(line) {
  var raw = String(line == null ? '' : line);

  var mh = /^<h([1-6])>([\s\S]*)<\/h\1>$/.exec(raw);
  if (mh) return { kind: 'heading', level: Number(mh[1]), text: diffSummaryText_(mh[2]) };

  var mp = /^<p>([\s\S]*)<\/p>$/.exec(raw);
  if (mp) return { kind: 'para', text: diffSummaryText_(mp[1]) };

  var ml = /^<li data-list="(?:ul|ol)" data-depth="\d+">([\s\S]*)<\/li>$/.exec(raw);
  if (ml) return { kind: 'para', text: diffSummaryText_(ml[1]) };

  var mi = /^<img data-sha="[^\x22]*" alt="([^\x22]*)">$/.exec(raw);
  if (mi) {
    var alt = diffSummaryText_(mi[1]);
    return { kind: 'image', text: alt ? '画像「' + alt + '」' : '画像' };
  }

  var ms = /^<table data-sheet="([^\x22]*)">$/.exec(raw);
  if (ms) return { kind: 'tableOpen', sheet: true, name: diffSummaryText_(ms[1]), text: '' };
  if (raw === '<table>') return { kind: 'tableOpen', sheet: false, name: '', text: '' };
  if (raw === '</table>') return { kind: 'tableClose', text: '' };
  if (raw.indexOf('<tr>') === 0) return { kind: 'row', text: raw };

  var msl = /^<section data-slide="(\d+)">$/.exec(raw);
  if (msl) return { kind: 'slide', index: Number(msl[1]), text: '' };

  return { kind: 'para', text: diffSummaryText_(raw) };
}

/** タグを外し、空白を1つに詰めた本文 */
function diffSummaryText_(html) {
  return stripTags_(html).replace(/[\s　]+/g, ' ').replace(/^ | $/g, '');
}

/** 「第3条」「第十二条の2」のような条の印 */
function diffSummaryArticle_(text) {
  var m = /^(第[0-9０-９一二三四五六七八九十百千]+条(?:の[0-9０-９一二三四五六七八九十]+)?)/.exec(text);
  return m ? m[1] : '';
}

/** 「1.」「2 」「（2）」「③」「一、」のような項の印 */
function diffSummaryItemMark_(text) {
  var m = /^([0-9０-９]{1,3}[.．)）]|[0-9０-９]{1,3}(?=[ 　])|[（(][0-9０-９一二三四五六七八九十]{1,3}[)）]|[①-⑳]|[一二三四五六七八九十]{1,3}[、.．])/
    .exec(text);
  return m ? m[1] : '';
}

/** 表の名前になる印 (「別表1」「表2」) */
function diffSummaryTableMark_(text) {
  var m = /^(別表[0-9０-９一二三四五六七八九十]*|表[0-9０-９]+)/.exec(String(text || ''));
  return m ? m[1] : '';
}

/** 字を max 字までに切る。切ったら「…」を付ける (付けた字も数に入れる) */
function diffSummaryClip_(text, max) {
  var s = String(text || '');
  if (s.length <= max) return s;
  return s.substring(0, Math.max(0, max - 1)) + '…';
}

/** 片側の読みの状態 */
function diffSummaryState_() {
  return { heading: '', article: '', item: '', slide: '', table: null, lastText: '' };
}

/** 状態を1行ぶん進める */
function diffSummaryApply_(st, info, group) {
  if (info.kind === 'slide') {
    st.slide = 'スライド ' + info.index;
    st.heading = '';
    st.article = '';
    st.item = '';
    return;
  }
  if (info.kind === 'tableOpen') {
    st.table = group;
    return;
  }
  if (info.kind === 'tableClose') {
    st.table = null;
    return;
  }
  if (info.kind === 'row') return;

  var text = info.text;
  if (info.kind === 'heading' && info.level <= 3) {
    st.heading = diffSummaryClip_(text, 20);
    st.article = diffSummaryArticle_(text);
    st.item = '';
  } else if (info.kind !== 'image') {
    var article = diffSummaryArticle_(text);
    var mark = article ? '' : diffSummaryItemMark_(text);
    if (article) {
      st.article = article;
      st.item = '';
    } else if (mark) {
      st.item = mark;
    }
  }
  st.lastText = text;
}

/** いまの場所の名前 */
function diffSummaryLabel_(st, info) {
  if (st.slide) return st.slide;
  // 見出しそのものが変わったときは、見出しの中で言い表せる印が無ければ「見出し」
  if (info && info.kind === 'heading' && info.level <= 3 && !st.article) return '見出し';

  var place = st.article || st.heading;
  if (st.item) place = place ? place + ' ' + st.item : st.item;
  return place || '冒頭';
}

/** 場所の印と重なる頭を抜粋から外す (「第3条: 第3条 始業は…」にしない) */
function diffSummaryBody_(text, st) {
  var s = String(text || '');
  if (st.article && s.indexOf(st.article) === 0) {
    s = s.substring(st.article.length).replace(/^[ 　:：、.．]+/, '');
  }
  return s;
}

/**
 * 「前 → 後」を 40 字以内にする。
 *
 * 収まればそのまま。収まらなければ、同じ頭と同じ尻を外して、違うところの前後を少し残す。
 */
function diffSummaryChange_(before, after) {
  var max = DIFF_SUMMARY_CHANGE_MAX();
  var arrow = ' → ';
  if (before.length + after.length + arrow.length <= max) return before + arrow + after;

  var p = 0;
  while (p < before.length && p < after.length && before.charAt(p) === after.charAt(p)) p++;
  var s = 0;
  while (s < before.length - p && s < after.length - p &&
    before.charAt(before.length - 1 - s) === after.charAt(after.length - 1 - s)) s++;

  var side = Math.floor((max - arrow.length) / 2);
  function cut(text) {
    var mid = text.substring(p, text.length - s);
    var room = side - mid.length;
    // 前後に残す字。違うところが長ければ残さない
    var ctx = Math.max(0, Math.min(6, Math.floor(room / 2)));
    var head = text.substring(Math.max(0, p - ctx), p);
    var tail = text.substring(text.length - s, Math.min(text.length, text.length - s + ctx));
    var open = p - ctx > 0 ? '…' : '';
    var close = text.length - s + ctx < text.length ? '…' : '';
    var all = open + head + mid + tail + close;
    return all.length <= side ? all : diffSummaryClip_(open + head + mid, side);
  }
  return cut(before) + arrow + cut(after);
}

/** 表の1行のセルを、比べられる字の並びにする */
function diffSummaryCells_(line) {
  var cells = [];
  var re = /<td(?: data-formula="[^\x22]*")?>[\s\S]*?<\/td>/g;
  var m;
  while ((m = re.exec(String(line))) !== null) cells.push(m[0]);
  return cells;
}

/** 2つの行で違うセルの数 */
function diffSummaryCellDiff_(a, b) {
  var x = diffSummaryCells_(a);
  var y = diffSummaryCells_(b);
  var n = Math.max(x.length, y.length);
  var count = 0;
  for (var i = 0; i < n; i++) {
    if (x[i] !== y[i]) count++;
  }
  return count;
}

/**
 * 行の差分から、箇条書きの項目を (上限をかけずに) 作る。
 *
 * @param {Array<{type:string, line:string}>} ops
 * @returns {string[]}
 */
function diffSummaryItems_(ops) {
  var olds = diffSummaryState_();
  var news = diffSummaryState_();
  var items = [];
  var hunk = [];

  function touch(group) {
    if (!group.listed) {
      group.listed = true;
      items.push({ group: group });
    }
  }

  function flushRows(group) {
    if (!group) return;
    var n = Math.min(group.dels.length, group.ins.length);
    for (var i = 0; i < n; i++) {
      var cells = diffSummaryCellDiff_(group.dels[i], group.ins[i]);
      if (cells) group.changed += cells;
    }
    group.added += group.ins.length - n;
    group.removed += group.dels.length - n;
    if (group.dels.length || group.ins.length) touch(group);
    group.dels = [];
    group.ins = [];
  }

  function push(item) {
    var last = items.length ? items[items.length - 1] : null;
    // 同じ場所で同じ種類が続けば1本にまとめる
    if (last && !last.group && last.label === item.label &&
      last.kind === item.kind && item.kind !== 'change') {
      if (!item.structural) last.count += 1;
      if (!last.text && item.text) last.text = item.text;
      return;
    }
    item.count = item.structural ? 0 : 1;
    items.push(item);
  }

  function flushText() {
    var dels = [];
    var ins = [];
    for (var h = 0; h < hunk.length; h++) {
      if (hunk[h].type === 'delete') dels.push(hunk[h]);
      else ins.push(hunk[h]);
    }
    var n = Math.min(dels.length, ins.length);
    for (var i = 0; i < n; i++) {
      var rawFrom = dels[i].info.text;
      var rawTo = ins[i].info.text;
      var from = diffSummaryBody_(rawFrom, dels[i].st);
      var to = diffSummaryBody_(rawTo, ins[i].st);
      // 印だけが変わった (第3条 → 第4条)・片方が印だけ、なら印ごと見せる
      if (from === to || !from || !to) {
        from = rawFrom;
        to = rawTo;
      }
      push({
        label: ins[i].label, kind: 'change',
        text: rawFrom === rawTo ? '装飾だけ' : diffSummaryChange_(from, to),
      });
    }
    for (var a = n; a < ins.length; a++) {
      push({
        label: ins[a].label, kind: 'add', structural: ins[a].info.kind === 'slide',
        text: diffSummaryClip_(diffSummaryBody_(ins[a].info.text, ins[a].st), DIFF_SUMMARY_EXCERPT_MAX()),
      });
    }
    for (var d = n; d < dels.length; d++) {
      push({
        label: dels[d].label, kind: 'delete', structural: dels[d].info.kind === 'slide',
        text: diffSummaryClip_(diffSummaryBody_(dels[d].info.text, dels[d].st), DIFF_SUMMARY_EXCERPT_MAX()),
      });
    }
    hunk = [];
  }

  function tableName(st, info) {
    if (info.sheet) return { name: info.name, marked: true };
    var mark = diffSummaryTableMark_(st.lastText);
    if (mark) return { name: mark, marked: true };
    return { name: diffSummaryLabel_(st, null), marked: false };
  }

  function newGroup(st, info, whole) {
    var named = tableName(st, info);
    return {
      name: named.name, marked: named.marked, whole: whole, rows: 0,
      added: 0, removed: 0, changed: 0, dels: [], ins: [], listed: false,
    };
  }

  for (var i = 0; i < (ops || []).length; i++) {
    var op = ops[i];
    var info = diffSummaryRead_(op.line);
    var type = op.type;

    if (info.kind === 'row' && (type === 'equal' ? news.table : (type === 'delete' ? olds.table : news.table))) {
      flushText();
      var g = type === 'delete' ? olds.table : news.table;
      if (type === 'equal') {
        flushRows(news.table);
        if (olds.table && olds.table !== news.table) flushRows(olds.table);
      } else if (g.whole) {
        g.rows += 1;
      } else if (type === 'delete') {
        g.dels.push(op.line);
      } else {
        g.ins.push(op.line);
      }
      continue;
    }

    if (info.kind === 'tableOpen') {
      flushText();
      if (type === 'equal') {
        var shared = newGroup(news, info, '');
        olds.table = shared;
        news.table = shared;
      } else if (type === 'insert') {
        var added = newGroup(news, info, 'add');
        news.table = added;
        touch(added);
      } else {
        var gone = newGroup(olds, info, 'delete');
        olds.table = gone;
        touch(gone);
      }
      continue;
    }

    if (info.kind === 'tableClose') {
      flushText();
      if (type !== 'delete') {
        flushRows(news.table);
        news.table = null;
      }
      if (type !== 'insert') {
        flushRows(olds.table);
        olds.table = null;
      }
      continue;
    }

    if (type === 'equal') {
      flushText();
      diffSummaryApply_(olds, info, null);
      diffSummaryApply_(news, info, null);
      continue;
    }

    var st = type === 'delete' ? olds : news;
    diffSummaryApply_(st, info, null);
    hunk.push({
      type: type, info: info, label: diffSummaryLabel_(st, info),
      st: { article: st.article },
    });
  }
  flushText();
  flushRows(news.table);
  if (olds.table !== news.table) flushRows(olds.table);

  var out = [];
  for (var k = 0; k < items.length; k++) out.push(diffSummaryFormat_(items[k]));
  return out;
}

/** 1つの項目を字にする */
function diffSummaryFormat_(item) {
  if (item.group) {
    var g = item.group;
    var head = g.marked ? '表 ' + g.name : g.name + ' の表';
    if (g.whole === 'add') return head + ': 追加 (' + g.rows + ' 行)';
    if (g.whole === 'delete') return head + ': 削除 (' + g.rows + ' 行)';

    var parts = [];
    if (g.added) parts.push(g.added + ' 行追加');
    if (g.removed) parts.push(g.removed + ' 行削除');
    if (g.changed) parts.push(g.changed + ' セル変更');
    return head + ': ' + (parts.length ? parts.join(' / ') : '変更');
  }

  var word = item.kind === 'add' ? '追加' : (item.kind === 'delete' ? '削除' : '変更');
  var text = item.text;
  if (item.count > 1) text = (text ? text + ' ' : '') + 'ほか ' + (item.count - 1) + ' 段落';
  return item.label + ': ' + word + (text ? ' (' + text + ')' : '');
}
