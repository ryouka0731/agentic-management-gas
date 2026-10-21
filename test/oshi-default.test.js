import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { buildOshiDefaultSource, oshiDefaultMap, oshiDefaultTargets, oshiDefaultOut, OSHI_DEFAULT_MAX_BYTES } from '../scripts/build-oshi-default.mjs';

/*
 * 最初からいるキャラの絵 (焼いたもの)。本物は assets/oshi-default/<キャラ>/、焼くのは scripts/build-oshi-default.mjs。
 * 書き出す先は src/ui/oshi-default/<キャラ>-<形>.html (表情 → data URL の JSON の字だけ)。
 * build-kit.mjs → src/ui/kit-files.html と同じく、焼き直し忘れをここで止める。
 */

const pure = loadGas('src/core/Oshi.js');

describe('最初からいるキャラの絵 (焼いたもの)', () => {
  it('どのキャラのどの形にも書き出す先があり、スクリプト (.gs / .js) ではなく src/ui/oshi-default/ の HTML', () => {
    const want = [];
    for (const c of pure.OSHI_BUILTINS()) for (const st of pure.OSHI_STYLES()) want.push(c.key + '/' + st.key);
    expect(oshiDefaultTargets().map((t) => t.char + '/' + t.style)).toEqual(want);
    expect(oshiDefaultOut('taku', 'normal')).toEqual({ file: 'src/ui/oshi-default/taku-normal.html', name: 'ui/oshi-default/taku-normal' });
    for (const t of oshiDefaultTargets()) {
      expect(t.file).toBe('src/' + t.name + '.html');
      expect(t.file).toMatch(/^src\/ui\/oshi-default\/[a-z]+-[a-z]+\.html$/);
    }
    // 焼いたものを置く場所に、作らないファイルが残っていない (キャラを外したときの消し忘れ)
    expect(fs.readdirSync('src/ui/oshi-default').map((n) => 'src/ui/oshi-default/' + n).sort())
      .toEqual(oshiDefaultTargets().map((t) => t.file).sort());
  });

  it('絵をスクリプトに焼いていない (GAS はどの呼び出しでも全部のスクリプトを読む)', () => {
    const scripts = [];
    (function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = dir + '/' + ent.name;
        if (ent.isDirectory()) walk(p);
        else if (/\.(gs|js)$/.test(ent.name)) scripts.push(p);
      }
    })('src');
    const baked = scripts.filter((f) => fs.readFileSync(f, 'utf8').includes('data:image/webp;base64,'));
    expect(baked).toEqual([]);
  });

  for (const t of oshiDefaultTargets()) {
    it(t.char + '/' + t.style + ': 焼いたものが assets と一致している (assets を変えたら node scripts/build-oshi-default.mjs)', () => {
      const now = fs.readFileSync(path.resolve(t.file), 'utf8');
      expect(now === buildOshiDefaultSource(t.char, t.style), t.file + ' が古い').toBe(true);
    });

    it(t.char + '/' + t.style + ': JSON として読め、全部の表情があり、1ファイル 600KB まで', () => {
      const text = fs.readFileSync(path.resolve(t.file), 'utf8');
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(OSHI_DEFAULT_MAX_BYTES);
      const map = JSON.parse(text);
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
    expect(opt.map((s) => s.key)).toEqual(['pout', 'grow4', 'grow5']);
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
    const ui = fs.readdirSync('src/ui', { withFileTypes: true }).filter((e) => e.isFile())
      .map((e) => fs.readFileSync(path.join('src/ui', e.name), 'utf8')).join('\n');
    const main = fs.readFileSync('src/Main.gs', 'utf8');
    for (const text of [ui, main]) {
      expect(text).not.toContain('oshi-default/');
      expect(text).not.toContain('data:image/webp;base64,');
    }
  });

  it('deploy は送る前に焼き直す', () => {
    const deploy = fs.readFileSync('scripts/deploy.mjs', 'utf8');
    expect(deploy).toContain('writeOshiDefaultSources()');
    expect(deploy.indexOf('writeOshiDefaultSources()')).toBeLessThan(deploy.indexOf("clasp(['push'"));
  });
});
