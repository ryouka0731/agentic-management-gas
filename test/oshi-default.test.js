import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { buildOshiDefaultSource, oshiDefaultMap, oshiDefaultTargets, oshiDefaultOut, OSHI_DEFAULT_MAX_BYTES } from '../scripts/build-oshi-default.mjs';
import { OSHI_DEFAULT_SOURCES } from './sources.js';

/*
 * 最初からいるキャラの絵 (焼いたもの)。本物は assets/oshi-default/<キャラ>/、焼くのは scripts/build-oshi-default.mjs。
 * build-kit.mjs → KitFiles.gs と同じく、焼き直し忘れをここで止める。
 */

const pure = loadGas('src/core/Oshi.js');

describe('最初からいるキャラの絵 (焼いたもの)', () => {
  it('どのキャラのどの形にも書き出す先があり、テストの並び (OSHI_DEFAULT_SOURCES) と同じ', () => {
    const want = [];
    for (const c of pure.OSHI_BUILTINS()) for (const st of pure.OSHI_STYLES()) want.push(c.key + '/' + st.key);
    expect(oshiDefaultTargets().map((t) => t.char + '/' + t.style)).toEqual(want);
    expect(oshiDefaultTargets().map((t) => t.file).sort()).toEqual([...OSHI_DEFAULT_SOURCES].sort());
    expect(oshiDefaultOut('taku', 'normal')).toEqual({ file: 'src/core/OshiDefaultTakuNormal.gs', fn: 'OSHI_DEFAULT_TAKU_NORMAL' });
    // 関数の名前は重ならない (同じグローバルなので、後に読んだほうが黙って勝つ)
    const fns = oshiDefaultTargets().map((t) => t.fn);
    expect(new Set(fns).size).toBe(fns.length);
  });

  for (const t of oshiDefaultTargets()) {
    it(t.char + '/' + t.style + ': 焼いたものが assets と一致している (assets を変えたら node scripts/build-oshi-default.mjs)', () => {
      const now = fs.readFileSync(path.resolve(t.file), 'utf8');
      expect(now === buildOshiDefaultSource(t.char, t.style), t.file + ' が古い').toBe(true);
    });

    it(t.char + '/' + t.style + ': 全部の表情があり、1ファイル 600KB まで、手で直さないと書いてある', () => {
      const text = fs.readFileSync(path.resolve(t.file), 'utf8');
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(OSHI_DEFAULT_MAX_BYTES);
      expect(text).toContain('手で直さない');
      const ctx = loadGas(t.file);
      const map = ctx[t.fn]();
      // 絵が無くてもよい表情 (optional) は、assets にあるときだけ焼く
      const has = (s) => fs.existsSync(path.resolve('assets/oshi-default/' + t.char + '/' + t.style + '-' + s.key + '.webp'));
      expect(Object.keys(map)).toEqual(pure.OSHI_STATES().filter((s) => !s.optional || has(s)).map((s) => s.key));
      expect(map).toEqual(oshiDefaultMap(t.char, t.style));
      for (const s of pure.OSHI_STATES()) {
        if (s.optional && !has(s)) continue;
        const file = path.resolve('assets/oshi-default/' + t.char + '/' + t.style + '-' + s.key + '.webp');
        expect(map[s.key]).toBe('data:image/webp;base64,' + fs.readFileSync(file).toString('base64'));
      }
    });
  }

  it('キャラごとに別の絵 (取り違えて同じ絵を焼いていない)', () => {
    expect(oshiDefaultMap('itsuki', 'chibi').idle).not.toBe(oshiDefaultMap('taku', 'chibi').idle);
    expect(oshiDefaultMap('itsuki', 'normal').idle).not.toBe(oshiDefaultMap('taku', 'normal').idle);
  });

  it('絵が無くてもよい表情 (optional) には、絵が無いときに代わりに出す表情 (fallback) があり、それは必ず焼く表情', () => {
    const opt = pure.OSHI_STATES().filter((s) => s.optional);
    expect(opt.map((s) => s.key)).toEqual(['pout']);
    for (const s of opt) {
      const fb = pure.OSHI_STATES().find((x) => x.key === s.fallback);
      expect(fb, s.key).toBeTruthy();
      expect(fb.optional, s.key).toBeFalsy();
    }
  });

  it('知らないキャラ・形は焼かない', () => {
    expect(() => buildOshiDefaultSource('nobody', 'chibi')).toThrow('知らないキャラです: nobody');
    expect(() => buildOshiDefaultSource('taku', 'real')).toThrow('知らない絵の形です: real');
  });

  it('最初のページ (画面の部分ファイルと doGet) には絵を入れない', () => {
    const ui = fs.readdirSync('src/ui').map((n) => fs.readFileSync(path.join('src/ui', n), 'utf8')).join('\n');
    const main = fs.readFileSync('src/Main.gs', 'utf8');
    for (const text of [ui, main]) {
      expect(text).not.toMatch(/OSHI_DEFAULT_[A-Z]+_(NORMAL|CHIBI)/);
      expect(text).not.toContain('data:image/webp;base64,');
    }
  });

  it('deploy は送る前に焼き直す', () => {
    const deploy = fs.readFileSync('scripts/deploy.mjs', 'utf8');
    expect(deploy).toContain('writeOshiDefaultSources()');
    expect(deploy.indexOf('writeOshiDefaultSources()')).toBeLessThan(deploy.indexOf("clasp(['push'"));
  });
});
