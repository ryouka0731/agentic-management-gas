import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * UI の部分HTMLが壊れていないかを見る。
 *
 * app.css.html は <style> だけ、app.js.html は <script> だけを含む
 * 部分ファイルである。末尾に追記すると閉じタグの外に出てしまい、
 * CSS や JS がページ本文としてそのまま表示される。実際に踏んだ。
 */
describe('UI 部分HTMLの構造', () => {
  const cases = [
    ['src/ui/app.css.html', 'style'],
    ['src/ui/app.js.html', 'script'],
  ];

  cases.forEach(([file, tag]) => {
    it(file + ' は <' + tag + '> の内側だけで完結している', () => {
      const src = read(file).trim();

      expect(src.startsWith('<' + tag + '>')).toBe(true);
      expect(src.endsWith('</' + tag + '>')).toBe(true);

      // 開閉は1組だけ
      expect(src.split('<' + tag + '>').length - 1).toBe(1);
      expect(src.split('</' + tag + '>').length - 1).toBe(1);

      // 閉じタグより後ろに中身が無い
      expect(src.slice(src.lastIndexOf('</' + tag + '>') + tag.length + 3).trim())
        .toBe('');
    });
  });

  it('app.css.html が参照するトークンはすべて定義されている', () => {
    const css = read('src/ui/app.css.html');

    const defined = new Set();
    const defRe = /^\s*(--[a-z0-9-]+):/gm;
    let m;
    while ((m = defRe.exec(css)) !== null) defined.add(m[1]);

    const used = new Set();
    const useRe = /var\((--[a-z0-9-]+)/g;
    while ((m = useRe.exec(css)) !== null) used.add(m[1]);

    const missing = [...used].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it('wiki.html は CSS と JS を取り込んでいる', () => {
    const html = read('src/ui/wiki.html');
    expect(html).toContain("include('ui/app.css')");
    expect(html).toContain("include('ui/app.js')");
  });
});

/**
 * CSS のトークン定義ブロックを取り出す。
 *
 * @param {string} css
 * @param {string} selector
 * @returns {Object<string,string>}
 */
function tokensOf(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error('セレクタが見つかりません: ' + selector);

  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);

  const out = {};
  const re = /(--[a-z0-9-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].trim();
  return out;
}

/** @param {string} hex @returns {number} 相対輝度 (WCAG 2.1) */
function luminance(hex) {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(v.substring(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** @returns {number} コントラスト比 */
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('テーマのトークン', () => {
  const css = read('src/ui/app.css.html');

  it('ダークの2つのブロックが同じ内容を持つ', () => {
    // 片方だけ直すと「システムはダークなのに手動ダークが古い」等が起きる
    const bySystem = tokensOf(css, ':root:not([data-theme="light"])');
    const byAttr = tokensOf(css, ':root[data-theme="dark"]');
    expect(byAttr).toEqual(bySystem);
  });

  it('ライトとダークが同じトークンを定義している', () => {
    const light = tokensOf(css, ':root {');
    const dark = tokensOf(css, ':root[data-theme="dark"]');

    // ダークは面と色だけを上書きする。余白や角丸は共通
    const missing = Object.keys(dark).filter((k) => !(k in light));
    expect(missing).toEqual([]);
  });

  const THEMES = [
    ['ライト', ':root {'],
    ['ダーク', ':root[data-theme="dark"]'],
  ];

  THEMES.forEach(([name, selector]) => {
    const t = () => {
      const light = tokensOf(css, ':root {');
      return Object.assign({}, light, tokensOf(css, selector));
    };

    it(name + ': 本文と補助テキストが 4.5:1 以上ある', () => {
      const c = t();
      const pairs = [
        ['--ink', '--bg'], ['--ink', '--bg-2'], ['--ink', '--bg-3'],
        ['--ink-2', '--bg'], ['--ink-2', '--bg-2'],
      ];
      pairs.forEach(([fg, bg]) => {
        expect({ pair: fg + ' on ' + bg, ratio: +contrast(c[fg], c[bg]).toFixed(2) })
          .toEqual({ pair: fg + ' on ' + bg, ratio: expect.any(Number) });
        expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': 意味を持つ色が地の上で 4.5:1 以上ある', () => {
      const c = t();
      ['--accent', '--success', '--danger', '--warn', '--merged'].forEach((fg) => {
        expect(contrast(c[fg], c['--bg'])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': 差分とコンフリクトの塗りの上でも本文が読める', () => {
      const c = t();
      [['--ink', '--success-bg'], ['--ink', '--danger-bg'],
       ['--danger', '--danger-bg']].forEach(([fg, bg]) => {
        expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': グラフのレーンが地に対して 3:1 以上ある', () => {
      const c = t();
      ['--ink-2', '--accent', '--success', '--warn'].forEach((stroke) => {
        expect(contrast(c[stroke], c['--bg'])).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
