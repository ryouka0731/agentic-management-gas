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
  'src/core/IssueBranch.gs',
  'src/core/Project.gs',
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

describe('Issue からのブランチ作成', () => {
  it('issue-<番号>-<題名> の形で命名する', () => {
    const { ctx } = setup();
    expect(ctx.issueBranchName(12, '在宅勤務規定')).toBe('issue-12-在宅勤務規定');
  });

  it('ブランチ名に使えない文字を落とす', () => {
    const { ctx } = setup();
    expect(ctx.issueBranchName(3, '就業規則/第7条を「改訂」する!'))
      .toBe('issue-3-就業規則第7条を改訂する');
  });

  it('長い題名は切り詰めて80文字以内にする', () => {
    const { ctx } = setup();
    const name = ctx.issueBranchName(1, 'あ'.repeat(200));
    expect(name.length).toBeLessThanOrEqual(80);
    expect(ctx.branchNameValid_(name)).toBe(true);
  });

  it('題名が全部落ちたら番号だけで名前を作る', () => {
    const { ctx } = setup();
    expect(ctx.issueBranchName(7, '!!!')).toBe('issue-7');
  });

  it('Issueからブランチを作ると作業コピーができる', () => {
    const { ctx, fileId } = setup();
    const issue = ctx.issueCreate('在宅勤務規定', '', [fileId]);
    const branch = ctx.issueCreateBranch(issue.number, fileId);

    expect(branch.name).toBe('issue-1-在宅勤務規定');
    expect(ctx.branchWorkingFileId(branch.name, fileId)).toBeTruthy();
  });

  it('クローズ済みのIssueからはブランチを作れない', () => {
    const { ctx, fileId } = setup();
    const issue = ctx.issueCreate('改訂', '', [fileId]);
    ctx.issueClose(issue.number, null);
    expect(() => ctx.issueCreateBranch(issue.number, fileId))
      .toThrow(/クローズ済みのIssueからはブランチを作れません/);
  });
});

describe('カンバンボード', () => {
  it('置いたカードが Backlog に並ぶ', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');

    const board = ctx.projectBoard();
    expect(board['Backlog'].length).toBe(1);
    expect(board['Backlog'][0].issueNumber).toBe(issue.number);
    expect(board['In Progress'].length).toBe(0);
  });

  it('列を移すと元の列から消える', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');
    ctx.projectMove(issue.number, 'In Progress', 0);

    const board = ctx.projectBoard();
    expect(board['Backlog'].length).toBe(0);
    expect(board['In Progress'].length).toBe(1);
  });

  it('order の昇順で並ぶ', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('A', '', []);
    const b = ctx.issueCreate('B', '', []);
    ctx.projectPlace(a.number, 'Backlog');
    ctx.projectPlace(b.number, 'Backlog');
    ctx.projectMove(b.number, 'Backlog', 0);
    ctx.projectMove(a.number, 'Backlog', 1);

    expect(ctx.projectBoard()['Backlog'].map((c) => c.issueNumber))
      .toEqual([b.number, a.number]);
  });

  it('定義されていない列には置けない', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    expect(() => ctx.projectPlace(issue.number, 'Someday')).toThrow(/列が不正です/);
    expect(() => ctx.projectMove(issue.number, 'Someday', 0)).toThrow(/列が不正です/);
  });

  it('存在しないIssueは置けない', () => {
    const { ctx } = setup();
    expect(() => ctx.projectPlace(99, 'Backlog')).toThrow(/Issueが見つかりません/);
  });

  it('二重に置いても増えない', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');
    ctx.projectPlace(issue.number, 'In Progress');

    expect(ctx.projectBoard()['Backlog'].length).toBe(1);
    expect(ctx.projectBoard()['In Progress'].length).toBe(0);
  });

  it('カードにはIssueの題名と状態が載る', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('在宅勤務規定を改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');

    const card = ctx.projectBoard()['Backlog'][0];
    expect(card.title).toBe('在宅勤務規定を改訂');
    expect(card.state).toBe('open');
  });
});
