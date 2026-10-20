#!/usr/bin/env node
/**
 * コードの測り (行数・関数の長さ・分かれ道の数・入れ子の深さ・重なり) を数える。開発用。
 *
 *   node scripts/metrics.mjs            # 表を出す
 *   node scripts/metrics.mjs --json     # 数をそのまま出す (docs/metrics-report.md を作るとき)
 *
 * 字を読むのは vitest が持っている rolldown の構文解析 (`rolldown/parseAst`)。新しい依存は足さない。
 * 画面の JS は1つの関数を場所ごとのファイルに分けてあり、1つずつでは読めないので、
 * wiki.html の並びどおりにつないで読み、位置から元のファイルへ戻す (test/ui-source.js と同じつなぎ方)。
 *
 * 分かれ道の数 (循環的複雑度) は 1 + if / 三項 / for / while / do / case / catch / && / || / ?? の数。
 * 中の関数は外の関数に数えない (それぞれ1つの関数として数える)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** 測るファイル。焼き直した中身 (KitFiles.gs / KitSigning.gs) は数えない */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (/^(KitFiles|KitSigning)\.gs$/.test(name)) continue;
      if (/\.(gs|js|mjs)$/.test(name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'kit'));
  return out.sort();
}

/** 画面の JS: wiki.html の <script> の中の include の並び */
function uiParts() {
  const wiki = fs.readFileSync(path.join(ROOT, 'src/ui/wiki.html'), 'utf8');
  const at = wiki.indexOf("include('ui/app.js')");
  const body = wiki.slice(wiki.lastIndexOf('<script>', at), wiki.indexOf('</script>', at));
  return [...body.matchAll(/include\('([^']+)'\)/g)].map((m) => 'src/' + m[1] + '.html');
}

const BRANCHES = new Set([
  'IfStatement', 'ConditionalExpression', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'CatchClause',
]);
const NESTS = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement',
  'DoWhileStatement', 'SwitchStatement', 'TryStatement',
]);
const FUNCS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** 関数の名前。宣言・変数・プロパティ・代入から取る */
function nameOf(node, parent) {
  if (node.id && node.id.name) return node.id.name;
  if (!parent) return '';
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if ((parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.key) {
    return parent.key.name || parent.key.value || '';
  }
  if (parent.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression') {
    return parent.left.property.name || '';
  }
  if (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') return parent.left.name;
  return '';
}

/** 1つの関数の本体を歩く。中の関数に出会ったら、そこから先は別の関数として数える */
function measureBody(fn, onFunc, owner = '') {
  let complexity = 1;
  let maxDepth = 0;
  const visit = (node, parent, depth) => {
    if (!node || typeof node.type !== 'string') return;
    if (node !== fn && FUNCS.has(node.type)) { onFunc(node, parent, owner); return; }
    if (BRANCHES.has(node.type)) complexity++;
    if (node.type === 'SwitchCase' && node.test) complexity++;
    if (node.type === 'LogicalExpression') complexity++;
    let d = depth;
    // else if は入れ子を深くしない
    const elseIf = node.type === 'IfStatement' && parent && parent.type === 'IfStatement' && parent.alternate === node;
    if (NESTS.has(node.type) && !elseIf) { d = depth + 1; if (d > maxDepth) maxDepth = d; }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c === 'object' && visit(c, node, d));
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, node, d);
    }
  };
  visit(fn, null, 0);
  return { complexity, maxDepth };
}

/** 字の位置 → 行番号の引き方 */
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** コメントと空行を除いた行の数 */
function codeLines(text) {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  return noComments.split('\n').filter((l) => l.trim()).length;
}

/**
 * 字を読み、関数ごとの数を返す。locate(pos) は位置を {file, line} に戻す
 */
function measureText(text, filename, locate) {
  const ast = parseAst(text, { lang: 'js', sourceType: 'script' }, filename);
  const top = ast.body.length === 1 && ast.body[0].type === 'ExpressionStatement' && ast.body[0].expression;
  const wrapper = top && top.type === 'CallExpression' && FUNCS.has(top.callee.type) ? top.callee : null;
  const line = lineIndex(text);
  const funcs = [];
  const onFunc = (node, parent, owner) => {
    const name = nameOf(node, parent) || (owner ? owner + ' の中の無名' : '(無名)');
    // 画面の JS を包む一番外の関数 (function () { … })() は、ファイルそのものとして扱う
    if (wrapper && node === wrapper) { measureBody(node, onFunc, ''); return; }
    const m = measureBody(node, (n, p, o) => onFunc(n, p, o), nameOf(node, parent) || owner);
    const at = locate(node.start);
    funcs.push({
      name,
      file: at.file,
      line: at.line,
      lines: line(node.end) - line(node.start) + 1,
      params: node.params.length,
      complexity: m.complexity,
      depth: m.maxDepth,
    });
  };
  // 一番外は関数ではないので、全体を1つの「関数」として歩き、外の数は捨てる
  measureBody({ type: 'Program', body: ast.body }, onFunc);
  return funcs;
}

/** 似た行の重なり。字下げと空白をそろえた6行の窓が、別の場所にもう一度出たら重なりとして数える */
function duplication(files) {
  const WINDOW = 6;
  const seen = new Map();
  let total = 0;
  const dup = new Set();
  for (const { file, text } of files) {
    const lines = text.split('\n').map((l) => l.trim().replace(/\s+/g, ' '))
      .map((l, i) => ({ l, i })).filter(({ l }) => l && !/^(\/\/|\*|\/\*|\*\/|[{}();,\]]+$)/.test(l));
    total += lines.length;
    for (let i = 0; i + WINDOW <= lines.length; i++) {
      const key = lines.slice(i, i + WINDOW).map((x) => x.l).join('\n');
      if (key.length < 120) continue; // 短い決まり文句は数えない
      const prev = seen.get(key);
      if (prev && !(prev.file === file && Math.abs(prev.i - i) < WINDOW)) {
        for (let k = 0; k < WINDOW; k++) dup.add(file + ':' + lines[i + k].i);
      } else if (!prev) seen.set(key, { file, i });
    }
  }
  return { lines: total, duplicated: dup.size, ratio: total ? dup.size / total : 0 };
}

export function collect() {
  const files = [];
  const funcs = [];

  for (const p of sourceFiles()) {
    const text = fs.readFileSync(p, 'utf8');
    const file = rel(p);
    const line = lineIndex(text);
    files.push({ file, text, code: codeLines(text) });
    const mjs = p.endsWith('.mjs');
    const parsed = mjs
      ? measureModule(text, file, line)
      : measureText(text, file, (pos) => ({ file, line: line(pos) }));
    funcs.push(...parsed);
  }

  // 画面の JS はつないでから読む
  const parts = uiParts();
  let joined = '';
  const offsets = [];
  for (const f of parts) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    offsets.push({ file: f, start: joined.length, line: lineIndex(text) });
    files.push({ file: f, text, code: codeLines(text) });
    joined += text + '\n';
  }
  const locate = (pos) => {
    let o = offsets[0];
    for (const x of offsets) if (x.start <= pos) o = x;
    return { file: o.file, line: o.line(pos - o.start) };
  };
  funcs.push(...measureText(joined, 'ui.js', locate));

  return { files, funcs, dup: duplication(files) };
}

function measureModule(text, file, line) {
  const ast = parseAst(text, { lang: 'js', sourceType: 'module' }, file);
  const out = [];
  const onFunc = (node, parent, owner) => {
    const m = measureBody(node, onFunc, nameOf(node, parent) || owner);
    out.push({
      name: nameOf(node, parent) || (owner ? owner + ' の中の無名' : '(無名)'), file, line: line(node.start),
      lines: line(node.end) - line(node.start) + 1, params: node.params.length,
      complexity: m.complexity, depth: m.maxDepth,
    });
  };
  measureBody({ type: 'Program', body: ast.body }, onFunc);
  return out;
}

/** まとめの数 */
export function summarize({ files, funcs, dup }) {
  const sorted = (key) => funcs.map((f) => f[key]).sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;
  const cx = sorted('complexity');
  const ln = sorted('lines');
  const bands = (arr, cuts) => cuts.map((c, i) => {
    const lo = i ? cuts[i - 1] : -Infinity;
    return arr.filter((v) => v > lo && v <= c).length;
  }).concat([arr.filter((v) => v > cuts[cuts.length - 1]).length]);
  return {
    files: files.length,
    codeLines: files.reduce((s, f) => s + f.code, 0),
    functions: funcs.length,
    complexity: { median: pct(cx, 0.5), p90: pct(cx, 0.9), max: cx[cx.length - 1] || 0,
      bands: bands(cx, [5, 10, 20, 50]) },
    length: { median: pct(ln, 0.5), p90: pct(ln, 0.9), max: ln[ln.length - 1] || 0,
      bands: bands(ln, [20, 50, 100, 200]) },
    deepNesting: funcs.filter((f) => f.depth >= 5).length,
    manyParams: funcs.filter((f) => f.params >= 5).length,
    duplication: dup,
  };
}

function main() {
  const data = collect();
  const sum = summarize(data);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      summary: sum,
      worst: [...data.funcs].sort((a, b) => b.complexity - a.complexity).slice(0, 40),
      longest: [...data.funcs].sort((a, b) => b.lines - a.lines).slice(0, 40),
      files: data.files.map((f) => ({ file: f.file, code: f.code })).sort((a, b) => b.code - a.code),
    }, null, 2) + '\n');
    return;
  }
  const s = sum;
  console.log('ファイル ' + s.files + ' / コード行 ' + s.codeLines + ' / 関数 ' + s.functions);
  console.log('分かれ道: 中央 ' + s.complexity.median + ' / 上位10% ' + s.complexity.p90 + ' / 最大 ' + s.complexity.max +
    ' (≤5,≤10,≤20,≤50,>50 = ' + s.complexity.bands.join(', ') + ')');
  console.log('関数の長さ: 中央 ' + s.length.median + ' / 上位10% ' + s.length.p90 + ' / 最大 ' + s.length.max +
    ' (≤20,≤50,≤100,≤200,>200 = ' + s.length.bands.join(', ') + ')');
  console.log('入れ子5段以上 ' + s.deepNesting + ' / 引数5つ以上 ' + s.manyParams);
  console.log('重なり ' + s.duplication.duplicated + ' / ' + s.duplication.lines + ' 行 (' +
    (s.duplication.ratio * 100).toFixed(1) + '%)');
  console.log('\n分かれ道の多い関数');
  for (const f of [...data.funcs].sort((a, b) => b.complexity - a.complexity).slice(0, 25)) {
    console.log('  ' + String(f.complexity).padStart(4) + '  ' + String(f.lines).padStart(4) + '行  ' +
      f.name + '  ' + f.file + ':' + f.line);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
