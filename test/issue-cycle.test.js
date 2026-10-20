import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/ObjectStore.gs',
  'src/core/Normalize.js',
  'src/core/Diff.js',
  'src/core/Merge.js',
  'src/core/Commit.gs',
  'src/core/Branch.gs',
  'src/render/HtmlWriter.gs',
  'src/render/DocRenderer.gs',
  'src/render/LiveCache.gs',
  'src/core/PullRequest.gs',
  'src/core/PullPatch.gs',
  'src/core/Outbox.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Prefs.gs',
  'src/core/Tag.gs',
  'src/core/Member.gs',
  'src/core/Issue.gs', 'src/core/IssueTree.js', 'src/core/Inquiry.gs',
  'src/core/IssueComment.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Brand.js',
  'src/core/Notifier.gs',
  'src/core/Plain.js',
  'src/core/Motivation.gs', 'src/core/Game.gs', 'src/core/Gantt.js', 'src/core/Home.gs', 'src/core/Search.gs', 'src/Main.gs',
];

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
