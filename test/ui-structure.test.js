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
