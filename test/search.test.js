import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 横断検索の一覧。題名・番号・状態だけ。人の名前とアドレスは入れない。
 */
const SOURCES = APP_SOURCES;

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  const config = ctx.repoInit('agentic-management');
  return { ctx, fake, config };
}

describe('検索の一覧', () => {
  it('種類ごとに題名・番号・状態を返す', () => {
    const { ctx, fake, config } = setup();
    const doc = fake._createDoc('就業規則', '<p>第1条</p>\n', config.mainId);
    ctx.repoRegisterFile(doc, '就業規則.doc');
    const n = ctx.issueCreate('就業規則の改定', '', []).number;
    ctx.dbAppend('pulls', { number: 3, title: '第3条の改定', state: 'merged', author: 'a@example.com' });
    ctx.dbAppend('branches', { name: '見直し', state: 'open', createdBy: 'a@example.com' });
    ctx.dbAppend('branches', { name: '古い', state: 'deleted' });
    ctx.dbAppend('inquiries', { number: 5, kind: 'bug', body: '棒が伸びない\n詳しく', by: 'a@example.com', state: 'open', title: '' });

    const all = ctx.searchIndex_();
    const by = (k) => all.filter((x) => x.kind === k);
    expect(by('doc')).toEqual([{ kind: 'doc', number: 0, key: doc, title: '就業規則.doc', state: '', archived: false }]);
    expect(by('issue')[0]).toMatchObject({ number: n, title: '就業規則の改定', state: 'open', archived: false });
    expect(by('pull')[0]).toMatchObject({ number: 3, title: '第3条の改定', state: 'merged' });
    expect(by('branch').map((x) => x.key)).toEqual(['見直し']);
    expect(by('inquiry')[0]).toMatchObject({ number: 5, title: '棒が伸びない', state: 'open' });
  });

  it('置き場のやることは archived。Drive で消した文書と作業コピーは入らない', () => {
    const { ctx, fake, config } = setup();
    const gone = fake._createDoc('消した', '<p>x</p>\n', config.mainId);
    ctx.repoRegisterFile(gone, '消した.doc');
    fake.DriveApp.getFileById(gone).setTrashed(true);
    ctx.dbAppend('files', { fileId: 'W1', path: 'branches/見直し/就業規則.doc' });
    const n = ctx.issueCreate('しまった', '', []).number;
    ctx.dbUpdate('issues', 'number', n, { archivedAt: new Date() });

    const all = ctx.searchIndex_();
    expect(all.filter((x) => x.kind === 'doc')).toEqual([]);
    expect(all.find((x) => x.kind === 'issue')).toMatchObject({ archived: true });
  });

  it('障害物はスクラムがオンのときだけ', () => {
    const { ctx } = setup();
    ctx.dbAppend('impediments', { number: 1, title: '仕様が決まらない', reportedBy: 'a@example.com', state: 'open' });
    expect(ctx.searchIndex_().filter((x) => x.kind === 'impediment')).toEqual([]);
    ctx.scrumSetEnabled_(true);
    expect(ctx.searchIndex_().filter((x) => x.kind === 'impediment')[0]).toMatchObject({ number: 1, title: '仕様が決まらない' });
  });

  it('人の名前とアドレスは入らない。API は同じ形を返す', () => {
    const { ctx } = setup();
    const n = ctx.issueCreate('x', '', []).number;
    ctx.dbUpdate('issues', 'number', n, { assignee: 'secret@example.com' });
    ctx.dbAppend('pulls', { number: 1, title: 'y', state: 'open', author: 'secret@example.com', reviewers: 'secret@example.com' });
    const out = ctx.apiSearchIndex();
    expect(JSON.stringify(out)).not.toMatch(/secret|@/);
    out.forEach((x) => expect(Object.keys(x).sort()).toEqual(['archived', 'key', 'kind', 'number', 'state', 'title']));
    expect(ctx.searchIndex).toBeUndefined();
  });
});
