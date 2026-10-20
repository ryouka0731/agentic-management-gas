import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * 画面 (app.js.html) の関数を原文のまま切り出して動かす。
 *
 * 写しをテストに書くと、写しどうしを比べることになって意味が無い。
 * 切り出し方はここだけに置く (ui-parity.test.js と component/*.test.js が使う)。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** app.js.html の原文。関数でなく変数で持っている値を読むときにも使う */
export const APP = fs.readFileSync(path.join(ROOT, 'src/ui/app.js.html'), 'utf8');

/** app.js.html から function name(...) { ... } を原文のまま切り出す */
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
