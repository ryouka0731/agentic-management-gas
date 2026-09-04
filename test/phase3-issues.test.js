import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/**
 * Phase 3b (Issue / Projects) の統合テスト。
 * Docs の入出力だけ fileId → 正規化HTML の写像に置き換える。
 */

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
  'src/core/PullRequest.gs',
  'src/core/Issue.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  const fileId = fake._createDoc('就業規則', '<p>第1条</p>\n', config.mainId);
  ctx.repoRegisterFile(fileId, '就業規則.doc');
  ctx.commitFile(fileId, 'main', '初期状態', null);
  return { ctx, fake, fileId };
}

describe('Issue の CRUD', () => {
  it('連番が振られ、open で作られる', () => {
    const { ctx, fileId } = setup();
    const a = ctx.issueCreate('在宅勤務規定を改訂', '第7条を見直す', [fileId]);
    const b = ctx.issueCreate('賃金規程を確認', '', []);

    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(a.state).toBe('open');
    expect(a.linkedFileIds).toBe(fileId);
  });

  it('タイトルが空なら作れない', () => {
    const { ctx } = setup();
    expect(() => ctx.issueCreate('', '', [])).toThrow(/タイトルを入力してください/);
  });

  it('管理対象にない文書には紐づけられない', () => {
    const { ctx } = setup();
    expect(() => ctx.issueCreate('改訂', '', ['nonexistent']))
      .toThrow(/管理対象にない文書です/);
  });

  it('文書に紐づく open Issue を引ける', () => {
    const { ctx, fileId } = setup();
    ctx.issueCreate('紐づくもの', '', [fileId]);
    ctx.issueCreate('紐づかないもの', '', []);
    const closed = ctx.issueCreate('閉じたもの', '', [fileId]);
    ctx.issueClose(closed.number, null);

    const list = ctx.issuesForFile(fileId);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('紐づくもの');
  });

  it('クローズすると closedAt と linkedPr が入る', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    const closed = ctx.issueClose(issue.number, 5);

    expect(closed.state).toBe('closed');
    expect(closed.linkedPr).toBe(5);
    expect(String(closed.closedAt)).not.toBe('');
  });

  it('二重クローズしても壊れない', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    ctx.issueClose(issue.number, 5);
    const again = ctx.issueClose(issue.number, 9);

    expect(again.state).toBe('closed');
    expect(again.linkedPr).toBe(5);
  });

  it('存在しない Issue はエラーになる', () => {
    const { ctx } = setup();
    expect(() => ctx.issueGet(99)).toThrow(/Issueが見つかりません/);
  });

  it('ラベルと担当を更新できる', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    const updated = ctx.issueUpdate(issue.number, {
      labels: '規定改訂,P1',
      assignee: 'someone@example.com',
    });
    expect(updated.labels).toBe('規定改訂,P1');
    expect(updated.assignee).toBe('someone@example.com');
  });

  it('state は issueUpdate では変えられない', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    expect(() => ctx.issueUpdate(issue.number, { state: 'closed' }))
      .toThrow(/stateはissueCloseで変更してください/);
  });

  it('一覧は新しい順に並ぶ', () => {
    const { ctx } = setup();
    ctx.issueCreate('古い', '', []);
    ctx.issueCreate('新しい', '', []);
    expect(ctx.issueList('').map((i) => i.title)).toEqual(['新しい', '古い']);
  });
});
