import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { API_SOURCES, CORE_SOURCES, ISSUE_SOURCES, KIT_SOURCES } from './sources.js';

/*
 * 読み込む並び (sources.js) と、src の実際のファイルが食い違っていないか。
 *
 * GAS は全ファイルを同じグローバルに読む。画面の入口を src/api/ に分けたので、
 * ファイルを足して API_SOURCES に足し忘れると、そのファイルの api* はテストから
 * 見えず、「画面に渡せる形か」の走査からも黙って漏れる。
 */

/** src の下の、GAS が読むファイル (画面の .html を除く) */
function runtimeFiles() {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = dir + '/' + ent.name;
      if (ent.isDirectory()) walk(p);
      else if (/\.(gs|js)$/.test(ent.name)) out.push(p);
    }
  })('src');
  return out.sort();
}

describe('読み込む並び', () => {
  it('並びに書いたファイルはすべて在る', () => {
    const all = new Set(runtimeFiles());
    for (const f of [...ISSUE_SOURCES, ...CORE_SOURCES, ...API_SOURCES, ...KIT_SOURCES]) {
      expect(all.has(f), f).toBe(true);
    }
  });

  it('画面の入口 (src/*.gs と src/api/*.gs) は API_SOURCES に全部ある', () => {
    // KitFiles は KIT_SOURCES、KitSigning は deploy のときに作る (記録しない)
    const entry = runtimeFiles()
      .filter((f) => /^src\/[^/]+\.gs$/.test(f) || /^src\/api\//.test(f))
      .filter((f) => !/\/(KitFiles|KitSigning)\.gs$/.test(f));
    expect([...API_SOURCES].sort()).toEqual(entry);
  });

  it('同じ名前の関数を2つのファイルに書かない', () => {
    // 同じグローバルなので、後に読んだほうが黙って勝つ。どちらが勝つかは読む順で変わる
    const seen = new Map();
    const dup = [];
    for (const f of runtimeFiles()) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/^function ([\w$]+)\s*\(/gm)) {
        if (seen.has(m[1])) dup.push(m[1] + ': ' + seen.get(m[1]) + ' / ' + f);
        else seen.set(m[1], f);
      }
    }
    expect(seen.size).toBeGreaterThan(500);
    expect(dup).toEqual([]);
  });

  it('入口のファイルは関数だけを持つ (読む順に左右されない)', () => {
    // GAS がファイルを読む順は決まっていない。上で値を作ると、別のファイルの関数を
    // まだ無いうちに呼ぶことがある
    for (const f of API_SOURCES) {
      const text = fs.readFileSync(path.resolve(f), 'utf8');
      const top = text.split('\n').filter((l) => /^[^\s/*}]/.test(l) && !/^function /.test(l));
      expect(top, f).toEqual([]);
    }
  });
});
