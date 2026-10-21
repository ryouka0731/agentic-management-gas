import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * README と手引き (docs/manual/) が、コードと食い違っていないかを見る。
 *
 * 手引きは「何ができるか」を人の言葉で書くので、機械で全部は確かめられない。
 * ここでは、食い違うと黙って嘘になる3つだけを見る:
 * - 命令の一覧 (COMMAND_OPS) と command-queue.md の表
 * - 設定の一覧 (PREFS_SCHEMA) と settings.md の表
 * - README と手引きの中の相対リンク (`#見出し` の部分まで)
 * - 手元の道具の「よく出る断り」の表と、実際に出る字
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL = path.join(ROOT, 'docs', 'manual');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** 表の1列目に `名前` と書いた行の名前 */
function tableNames(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^\|\s*`([A-Za-z][A-Za-z0-9.]*)`\s*\|/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

describe('手引きの命令の一覧', () => {
  const ops = Object.keys(loadGas('src/core/CommandQueue.gs').COMMAND_OPS()).sort();
  const listed = tableNames(read('docs/manual/command-queue.md'));

  it('COMMAND_OPS の命令がすべて command-queue.md の表にある', () => {
    expect(ops.filter((op) => !listed.includes(op))).toEqual([]);
  });

  it('command-queue.md の表に、COMMAND_OPS に無い命令を書いていない', () => {
    // 書いてあるのに受け付けない命令は、手元で「実行できない操作です」になる
    expect(listed.filter((op) => !ops.includes(op))).toEqual([]);
  });

  it('同じ命令を二度書いていない', () => {
    expect(listed.length).toBe(new Set(listed).size);
  });

  it('自分の様子を見る命令 (COMMAND_PERSONAL_OPS) を挙げている', () => {
    const personal = loadGas('src/core/CommandQueue.gs').COMMAND_PERSONAL_OPS();
    const text = read('docs/manual/command-queue.md');
    for (const op of personal) expect(text).toContain('`' + op + '`');
  });
});

describe('手引きの設定の一覧', () => {
  // PREFS_SCHEMA は改善のヒントの規則などから組むので、API を動かすテストと同じ集合を読む
  const SOURCES = APP_SOURCES;

  function schemaKeys(scrumOn) {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    ctx.scrumEnabled = () => scrumOn;
    return ctx.PREFS_SCHEMA().map((p) => p.key);
  }

  it('PREFS_SCHEMA の項目がすべて settings.md にある', () => {
    const text = read('docs/manual/settings.md');
    const keys = [...new Set([...schemaKeys(false), ...schemaKeys(true)])];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !text.includes('`' + k + '`'))).toEqual([]);
  });
});

/**
 * GitHub が見出しに付ける名前 (github-slugger と同じ規則)。
 * 小文字にし、字・数・`-`・`_`・空白以外を落とし、空白を `-` にする。日本語は残る。
 * 同じ名前が2つ目からは `-1`, `-2` が付く。
 */
function headingSlugs(text) {
  const seen = new Map();
  const out = new Set();
  const body = text.replace(/```[\s\S]*?```/g, '');
  for (const m of body.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const plain = m[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '');
    const base = plain.toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? base + '-' + n : base);
  }
  return out;
}

/** text の中に、頁 n へのリンク (n / ./n / n#節) があるか */
function linksTo(text, n) {
  const name = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\]\\((?:\\./)?' + name + '(?:#[^)]*)?\\)').test(text);
}

describe('見出しの名前', () => {
  it('GitHub と同じ規則で名前を付ける', () => {
    const slugs = headingSlugs([
      '## 署名の鍵を作る (最初に一度)', '## `stash` の使い方', '## Hello, World!',
      '## 同じ', '## 同じ', '## [リンク](x.md) の節', '## よく出る断り',
    ].join('\n'));
    expect([...slugs]).toEqual([
      '署名の鍵を作る-最初に一度', 'stash-の使い方', 'hello-world',
      '同じ', '同じ-1', 'リンク-の節', 'よく出る断り',
    ]);
  });
});

describe('README と手引きのリンク', () => {
  const files = ['README.md', ...fs.readdirSync(MANUAL)
    .filter((n) => n.endsWith('.md')).map((n) => path.join('docs', 'manual', n))];

  it('手引きの頁がある', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s の相対リンクが、ある場所を指す', (rel) => {
    // コードの中の `[名前](URL)` は書き方の例であってリンクではない
    const text = read(rel).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const broken = [];
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      const [file, anchor] = href.split('#');
      const abs = file
        ? path.resolve(path.dirname(path.join(ROOT, rel)), decodeURI(file))
        : path.join(ROOT, rel);
      if (!fs.existsSync(abs)) { broken.push(href); continue; }
      // 頁はあっても、見出しが無ければ頁の先頭に着くだけで、人は目当ての節を探し回る
      if (anchor && abs.endsWith('.md')
        && !headingSlugs(fs.readFileSync(abs, 'utf8')).has(decodeURIComponent(anchor))) {
        broken.push(href);
      }
    }
    expect(broken).toEqual([]);
  });

  it('手引きの頁はすべて目次から辿れる', () => {
    const index = read('docs/manual/README.md');
    const pages = fs.readdirSync(MANUAL).filter((n) => n.endsWith('.md') && n !== 'README.md');
    // 節を指すリンク (page.md#…) や ./page.md の形でも辿れる
    expect(pages.filter((n) => !linksTo(index, n))).toEqual([]);
  });

  it('目次の判定は節へのリンクも受ける', () => {
    expect(linksTo('[a](./x.md)', 'x.md')).toBe(true);
    expect(linksTo('[a](x.md#節)', 'x.md')).toBe(true);
    expect(linksTo('[a](xx.md)', 'x.md')).toBe(false);
    expect(linksTo('[a](x.mdx)', 'x.md')).toBe(false);
  });
});

/**
 * 手元の道具の「よく出る断り」。kit/AGENTS.md (配る道具の中。手元の Claude が読む) と
 * 手引きの agent-kit.md (人が読む) の2か所に表がある。
 *
 * 断り文を言い換えたのに表を直さないと、表は出ない字を挙げ、出た字は表に無い。
 * 手引きの表は AGENTS.md の行をすべて同じ字で持ち、そのうえで道具そのものの断り
 * (設定が見つからない など) を足してよい。
 */
describe('よく出る断りの表', () => {
  /** 見出し heading の下の、最初の表の行 */
  function tableUnder(text, heading) {
    const lines = text.split('\n');
    let i = lines.findIndex((l) => l.trim() === heading);
    expect(i, heading + ' が無い').toBeGreaterThanOrEqual(0);
    while (i < lines.length && !lines[i].startsWith('|')) i++;
    const rows = [];
    for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i]);
    return rows.slice(2);
  }

  /** 1列目に `字` と書いた行の字 */
  const shownOf = (rows) => rows.map((r) => /^\|\s*`([^`]+)`\s*\|/.exec(r)).filter(Boolean)
    .map((m) => m[1]);

  const kitRows = tableUnder(read('kit/AGENTS.md'), '## 結果の読み方');
  const manualRows = tableUnder(read('docs/manual/agent-kit.md'), '## よく出る断り');

  function sources() {
    const out = [];
    (function walk(dir) {
      for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir + '/' + ent.name;
        if (ent.isDirectory()) { if (rel !== 'src/ui/oshi-default') walk(rel); } // 焼いた絵は読まない
        else if (/\.(gs|js|mjs|html)$/.test(ent.name) && rel !== 'src/ui/kit-files.html') out.push(rel);
      }
    })('src');
    out.push('kit/agent.mjs');
    fs.readdirSync(path.join(ROOT, 'kit/track')).filter((n) => n.endsWith('.mjs'))
      .forEach((n) => out.push('kit/track/' + n));
    return out.map(read).join('\n');
  }

  it('表を読める', () => {
    expect(shownOf(kitRows).length).toBeGreaterThan(3);
    expect(shownOf(manualRows).length).toBeGreaterThan(3);
  });

  it('表に挙げた字は、実際に出る', () => {
    const all = sources();
    const listed = [...new Set([...shownOf(kitRows), ...shownOf(manualRows)])];
    expect(listed.filter((t) => !all.includes(t))).toEqual([]);
  });

  it('手引きの表は、配る道具の表の行をすべて同じ字で持つ', () => {
    expect(kitRows.filter((r) => !manualRows.includes(r))).toEqual([]);
  });
});
