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
