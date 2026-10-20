import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

const SOURCES = APP_SOURCES;

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);

  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  ctx.repoInit('agentic-management');
  return { ctx, fake };
}


function chain(ctx, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(ctx.issueCreate('やること' + i, '', [], ''));
  return out.map((r) => r.number);
}

describe('親が輪になるのを、サーバでも断る', () => {
  it('自分を親にできない', () => {
    const { ctx } = setup();
    const [a] = chain(ctx, 1);
    expect(() => ctx.issueUpdate(a, { parent: a })).toThrow('親にすると輪になります: #' + a);
  });

  it('2つの輪を作れない', () => {
    const { ctx } = setup();
    const [a, b] = chain(ctx, 2);
    ctx.issueUpdate(b, { parent: a });
    expect(() => ctx.issueUpdate(a, { parent: b })).toThrow('親にすると輪になります: #' + b);
    expect(String(ctx.issueGet(a).parent || '')).toBe('');
  });

  it('3つの輪を作れない', () => {
    const { ctx } = setup();
    const [a, b, c] = chain(ctx, 3);
    ctx.issueUpdate(b, { parent: a });
    ctx.issueUpdate(c, { parent: b });
    expect(() => ctx.issueUpdate(a, { parent: c })).toThrow('輪になります');
  });

  it('輪にならない付け替えは通る', () => {
    const { ctx } = setup();
    const [a, b, c] = chain(ctx, 3);
    ctx.issueUpdate(b, { parent: a });
    ctx.issueUpdate(c, { parent: b });
    expect(String(ctx.issueUpdate(c, { parent: a }).parent)).toBe(String(a));
  });

  it('親を外せる', () => {
    const { ctx } = setup();
    const [a, b] = chain(ctx, 2);
    ctx.issueUpdate(b, { parent: a });
    expect(String(ctx.issueUpdate(b, { parent: '' }).parent || '')).toBe('');
  });
});
