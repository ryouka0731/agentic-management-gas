import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { API_SOURCES, CORE_SOURCES, ISSUE_SOURCES, KIT_SOURCES, OSHI_DEFAULT_SOURCES, FULL_SOURCES } from './sources.js';

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
    for (const f of [...ISSUE_SOURCES, ...CORE_SOURCES, ...API_SOURCES, ...KIT_SOURCES, ...OSHI_DEFAULT_SOURCES]) {
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

  it('拡張子だけが違う同じ名前のファイルを src に置かない (clasp が送れない)', () => {
    // GAS では .js も .gs も同じ「スクリプト」になり、名前から拡張子が外れる。WorkStyle.js と WorkStyle.gs を
    // 並べたら、テストは全部通ったのに clasp push が「Conflicting files found」で止まり、反映できなかった
    const names = runtimeFiles().filter((f) => /\.(js|gs)$/.test(f)).map((f) => f.replace(/\.(js|gs)$/, ''));
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
  });

  it('src/core のファイルは、どれかの並びにある (通しで動かす FULL_SOURCES に全部ある)', () => {
    // 焼いた絵 (OshiDefault*.gs) のように大きなものは、要るテストだけが足す。足し忘れると、
    // 通しのテストでも呼べずに黙って絵が出ない
    const full = new Set(FULL_SOURCES);
    const missing = runtimeFiles().filter((f) => /^src\/core\//.test(f) && !full.has(f));
    expect(missing).toEqual([]);
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

  it('開いている人のアドレスは currentEmail_ だけが Session から読む', () => {
    // 以前は80か所近くに `|| ''` の有無・小文字化の有無が混ざって写されていて、取れない
    // とき (null) に落ちる所と落ちない所があった。直に書くと、その食い違いがまた生まれる
    const helper = 'src/core/CurrentUser.gs';
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    const direct = /Session\s*\.\s*getActiveUser\s*\(/;
    const found = runtimeFiles()
      .filter((f) => f !== helper && !/\/KitFiles\.gs$/.test(f))
      .filter((f) => direct.test(strip(fs.readFileSync(f, 'utf8'))));
    expect(found).toEqual([]);
    // 見張りそのものが効いていること (helper の中では読んでいる)
    expect(direct.test(strip(fs.readFileSync(helper, 'utf8')))).toBe(true);
  });
});
