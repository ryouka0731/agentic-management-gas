import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * 画面の JS を、本番と同じ順につないで読む。画面の関数は原文のまま切り出して動かす。
 *
 * 画面の JS は1つの (function () { … })() を場所ごとのファイル (src/ui/app.js.html と
 * src/ui/js-*.html) に分けて置き、wiki.html の <script> の中で include を並べてつないでいる。
 * **並びは wiki.html の include から読む。** テストに並びを写すと、ファイルを足したときに
 * 本番とテストで別のものを走らせることになる。つなぎ方はここだけに置く
 * (dom.js / ui-parity / ui-structure / terms / naming / ui-assemble が使う)。
 *
 * 写しをテストに書くと、写しどうしを比べることになって意味が無い。
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** wiki.html の <?!= include('ui/x') ?> */
export const INCLUDE_RE = /<\?!=\s*include\('([^']+)'\)\s*\?>/g;

/** 画面の HTML の元 (include を展開する前) */
export const WIKI = read('src/ui/wiki.html');

/**
 * include を、Main.gs の include() と同じく src/<名前>.html の中身そのものに置き換える。
 * 前後の字 (字下げ・改行) はテンプレートと同じく残す。
 */
export function expandIncludes(text) {
  return text.replace(INCLUDE_RE, (_, name) => read('src/' + name + '.html'));
}

/** text の中の include の名前を、書いてある順に */
export function includesIn(text) {
  return [...text.matchAll(INCLUDE_RE)].map((m) => m[1]);
}

/** wiki.html の中で、画面の JS をつなぐ <script> … </script> の位置 (タグを含む) */
function appScriptRange() {
  const at = WIKI.indexOf("include('ui/app.js')");
  if (at < 0) throw new Error("wiki.html に include('ui/app.js') がありません");
  const start = WIKI.lastIndexOf('<script>', at);
  const end = WIKI.indexOf('</script>', at);
  if (start < 0 || end < 0) throw new Error('画面の JS が <script> の中にありません');
  return { start, end: end + '</script>'.length };
}

const RANGE = appScriptRange();

/** 画面の JS をつなぐ include の名前。wiki.html に書いてある順 */
export const APP_PARTS = includesIn(WIKI.substring(RANGE.start, RANGE.end));

/** 画面の JS をつなぐ <script> の中身 (include を展開する前) */
export const APP_TEMPLATE = WIKI.substring(RANGE.start + '<script>'.length, RANGE.end - '</script>'.length);

/** 画面の JS。本番のテンプレートが <script> の中に出すものと同じ字。関数でなく変数で持っている値を読むときにも使う */
export const APP = expandIncludes(APP_TEMPLATE);

/** 画面の JS を除いた wiki.html (CSS などの include は展開済み)。jsdom に組む本文 */
export const PAGE_WITHOUT_APP = expandIncludes(WIKI.substring(0, RANGE.start) + WIKI.substring(RANGE.end));

/** 画面の JS から function name(...) { ... } を原文のまま切り出す */
export function extract(name) {
  const start = APP.indexOf('  function ' + name + '(');
  if (start < 0) throw new Error('画面に ' + name + ' がありません');

  let i = APP.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for (; i < APP.length; i++) {
    const ch = APP[i];
    const next = APP[i + 1];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { i = APP.indexOf('\n', i); continue; }
    if (ch === '/' && next === '*') { i = APP.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return APP.substring(start, i + 1);
}

/** 画面の関数を、外側の変数を差し込んだ箱の中で動かす */
export function ui(names, globals) {
  const ctx = Object.assign({}, globals || {});
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}

const VLQ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(n) {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v) digit |= 32;
    out += VLQ[digit];
  } while (v);
  return out;
}

/**
 * 画面の JS (APP) の各行が、どのファイルの何行目から来たかを表す source map。
 *
 * テストは APP を1つの字として走らせるので、そのままではカバレッジが app.js.html にも
 * js-*.html にも結び付かず、画面の部分ファイルが全部 0% と出ていた。行ごとに元のファイルの
 * 行へ戻す地図を添えると、走った行がそれぞれのファイルに数えられる。
 */
export function appSourceMap() {
  const sources = ['src/ui/wiki.html'];
  const wikiLine0 = WIKI.substring(0, RANGE.start + '<script>'.length).split('\n').length - 1;
  const lines = [];        // 生成した行ごとの区切り [[genCol, src, line, col], ...]
  let cur = [];
  const newline = () => { lines.push(cur); cur = []; };
  let gcol = 0;
  // テンプレートの字 (include の外) は wiki.html の行へ、include の中身は部分ファイルの行へ
  let wikiLine = wikiLine0;
  let wikiCol = '<script>'.length;
  const emitText = (text, src, startLine, startCol) => {
    let line = startLine, col = startCol;
    for (let i = 0; i <= text.length; i++) {
      if (i === 0 || text[i - 1] === '\n') cur.push([gcol, src, line, col]);
      if (i === text.length) break;
      if (text[i] === '\n') { newline(); gcol = 0; line++; col = 0; } else { gcol++; col++; }
    }
    return { line, col };
  };
  let last = 0;
  for (const m of APP_TEMPLATE.matchAll(INCLUDE_RE)) {
    const glue = APP_TEMPLATE.substring(last, m.index);
    ({ line: wikiLine, col: wikiCol } = emitText(glue, 0, wikiLine, wikiCol));
    const file = 'src/' + m[1] + '.html';
    let src = sources.indexOf(file);
    if (src < 0) { sources.push(file); src = sources.length - 1; }
    emitText(read(file), src, 0, 0);
    wikiCol += m[0].length;
    last = m.index + m[0].length;
  }
  emitText(APP_TEMPLATE.substring(last), 0, wikiLine, wikiCol);
  newline();

  let prev = [0, 0, 0];
  const mappings = lines.map((segs) => {
    let prevCol = 0;
    return segs.map(([g, s, l, c]) => {
      const out = vlq(g - prevCol) + vlq(s - prev[0]) + vlq(l - prev[1]) + vlq(c - prev[2]);
      prevCol = g; prev = [s, l, c];
      return out;
    }).join(',');
  }).join(';');
  return {
    version: 3,
    sources: sources.map((f) => path.join(ROOT, f)),
    sourcesContent: sources.map((f) => read(f)),
    mappings,
  };
}
