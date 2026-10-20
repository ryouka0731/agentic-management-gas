import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { buildOshiDefaultSource, oshiDefaultMap, OSHI_DEFAULT_OUT, OSHI_DEFAULT_MAX_BYTES } from '../scripts/build-oshi-default.mjs';

/*
 * 最初からいるキャラの絵 (焼いたもの)。本物は assets/oshi-default/、焼くのは scripts/build-oshi-default.mjs。
 * build-kit.mjs → KitFiles.gs と同じく、焼き直し忘れをここで止める。
 */

const pure = loadGas('src/core/Oshi.js');

describe('最初からいるキャラの絵 (焼いたもの)', () => {
  it('どの形にも書き出す先がある', () => {
    expect(Object.keys(OSHI_DEFAULT_OUT).sort()).toEqual(pure.OSHI_STYLES().map((s) => s.key).sort());
  });

  for (const st of ['normal', 'chibi']) {
    it(st + ': 焼いたものが assets と一致している (assets を変えたら node scripts/build-oshi-default.mjs)', () => {
      const out = OSHI_DEFAULT_OUT[st];
      const now = fs.readFileSync(path.resolve(out.file), 'utf8');
      expect(now === buildOshiDefaultSource(st), out.file + ' が古い').toBe(true);
    });

    it(st + ': 全部の表情があり、1ファイル 600KB まで、手で直さないと書いてある', () => {
      const out = OSHI_DEFAULT_OUT[st];
      const text = fs.readFileSync(path.resolve(out.file), 'utf8');
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(OSHI_DEFAULT_MAX_BYTES);
      expect(text).toContain('手で直さない');
      const ctx = loadGas(out.file);
      const map = ctx[out.fn]();
      expect(Object.keys(map)).toEqual(pure.OSHI_STATES().map((s) => s.key));
      expect(map).toEqual(oshiDefaultMap(st));
      for (const s of pure.OSHI_STATES()) {
        const file = path.resolve('assets/oshi-default/' + st + '-' + s.key + '.webp');
        expect(map[s.key]).toBe('data:image/webp;base64,' + fs.readFileSync(file).toString('base64'));
      }
    });
  }

  it('最初のページ (画面の部分ファイルと doGet) には絵を入れない', () => {
    const ui = fs.readdirSync('src/ui').map((n) => fs.readFileSync(path.join('src/ui', n), 'utf8')).join('\n');
    const main = fs.readFileSync('src/Main.gs', 'utf8');
    for (const text of [ui, main]) {
      expect(text).not.toMatch(/OSHI_DEFAULT_(NORMAL|CHIBI)/);
      expect(text).not.toContain('data:image/webp;base64,');
    }
  });

  it('deploy は送る前に焼き直す', () => {
    const deploy = fs.readFileSync('scripts/deploy.mjs', 'utf8');
    expect(deploy).toContain('writeOshiDefaultSources()');
    expect(deploy.indexOf('writeOshiDefaultSources()')).toBeLessThan(deploy.indexOf("clasp(['push'"));
  });
});
