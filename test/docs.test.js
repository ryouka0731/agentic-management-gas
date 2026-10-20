import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * README と手引き (docs/manual/) が、コードと食い違っていないかを見る。
 *
 * 手引きは「何ができるか」を人の言葉で書くので、機械で全部は確かめられない。
 * ここでは、食い違うと黙って嘘になる3つだけを見る:
 * - 命令の一覧 (COMMAND_OPS) と command-queue.md の表
 * - 設定の一覧 (PREFS_SCHEMA) と settings.md の表
 * - README と手引きの中の相対リンク
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
  // PREFS_SCHEMA は改善のヒントの規則などから組むので、prefs.test.js と同じ集合を読む
  const SOURCES = (() => {
    const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
    return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]);
  })();

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
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
      const target = decodeURI(href.split('#')[0]);
      const abs = path.resolve(path.dirname(path.join(ROOT, rel)), target);
      if (!fs.existsSync(abs)) broken.push(href);
    }
    expect(broken).toEqual([]);
  });

  it('手引きの頁はすべて目次から辿れる', () => {
    const index = read('docs/manual/README.md');
    const pages = fs.readdirSync(MANUAL).filter((n) => n.endsWith('.md') && n !== 'README.md');
    expect(pages.filter((n) => !index.includes('](' + n + ')'))).toEqual([]);
  });
});
