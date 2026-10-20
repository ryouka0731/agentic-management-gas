import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/*
 * 画面の形の決まり (docs/dev/design.md) が、CSS と食い違っていないかを見る。
 *
 * - design.md に書いたトークンは、どれも app.css.html のどこかで定義されている
 *   (無いものを書くと、それを読んで `var(--無いもの)` を書くことになる)
 * - :root で定義したトークンは、どれも design.md に書いてある
 *   (足したのに書かないと、次に読んだ人が同じものをもう1つ作る)
 *
 * `--sp-1` 〜 `--sp-6` のように範囲で書いたものは、両端の間を全部書いたものとして読む。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function rootBlock(css) {
  const at = css.indexOf(':root {');
  expect(at).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('\n}', at));
}

function definedIn(text) {
  return new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

export function tokensNamedIn(doc) {
  const names = new Set();
  // `--sp-1` 〜 `--sp-6` の形
  for (const m of doc.matchAll(/`--([a-z-]+)(\d+)`\s*〜\s*`--\1(\d+)`/g)) {
    for (let i = Number(m[2]); i <= Number(m[3]); i++) names.add('--' + m[1] + i);
  }
  for (const m of doc.matchAll(/`(--[a-z0-9-]+)`/g)) names.add(m[1]);
  // `var(--foo, #ccc)` のような例は「書かない形」の例なので数えない
  names.delete('--foo');
  return names;
}

describe('画面の形の決まり (docs/dev/design.md)', () => {
  const css = read('src/ui/app.css.html');
  const doc = read('docs/dev/design.md');

  it('書いてあるトークンは、どれも CSS で定義されている', () => {
    const defined = definedIn(css);
    const missing = [...tokensNamedIn(doc)].filter((t) => !defined.has(t));
    expect(missing).toEqual([]);
  });

  it(':root のトークンは、どれも書いてある', () => {
    const named = tokensNamedIn(doc);
    const missing = [...definedIn(rootBlock(css))].filter((t) => !named.has(t));
    expect(missing).toEqual([]);
  });

  it('範囲の書き方を読み違えない', () => {
    expect([...tokensNamedIn('`--sp-1` 〜 `--sp-3`')].sort()).toEqual(['--sp-1', '--sp-2', '--sp-3']);
    expect([...tokensNamedIn('`--nope`')]).toEqual(['--nope']);
  });
});
