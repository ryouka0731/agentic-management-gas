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
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Tag.gs',
  'src/core/Member.gs',
  'src/core/Issue.gs',
  'src/core/IssueBranch.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Inquiry.gs',
  'src/core/Notifier.gs',
  'src/core/Tally.js',
  'src/Main.gs',
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

describe('PRの状態変化がボードとIssueを動かす', () => {
  function prepare() {
    const env = setup();
    const issue = env.ctx.issueCreate('第3条を追加', '', [env.fileId]);
    env.ctx.projectPlace(issue.number, 'Backlog');
    env.ctx.issueCreateBranch(issue.number, env.fileId);

    const branchName = env.ctx.issueBranchName(issue.number, issue.title);
    const workFileId = env.ctx.branchWorkingFileId(branchName, env.fileId);
    env.fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条 休日</p>\n');
    env.ctx.commitFile(workFileId, branchName, '第3条を追加', null);

    return Object.assign(env, { issue: issue, branchName: branchName });
  }

  function approveAndMerge(env, pr) {
    env.fake._setUser('reviewer@example.com');
    env.ctx.prReview(pr.number, 'approve', '');
    env.fake._setUser('tester@example.com');
    env.ctx.prMerge(pr.number, []);
  }

  it('PRを作ると In Review に動く', () => {
    const env = prepare();
    env.ctx.prCreate('第3条を追加', 'closes #' + env.issue.number,
      env.branchName, env.fileId);

    expect(env.ctx.projectBoard()['In Review'].length).toBe(1);
    expect(env.ctx.projectBoard()['Backlog'].length).toBe(0);
  });

  it('マージすると Issue が閉じ、Done に動く', () => {
    const env = prepare();
    const pr = env.ctx.prCreate('第3条を追加', 'closes #' + env.issue.number,
      env.branchName, env.fileId);
    approveAndMerge(env, pr);

    expect(env.ctx.issueGet(env.issue.number).state).toBe('closed');
    expect(env.ctx.issueGet(env.issue.number).linkedPr).toBe(pr.number);
    expect(env.ctx.projectBoard()['Done'].length).toBe(1);
  });

  it('closes 記法が無ければ Issue は閉じない', () => {
    const env = prepare();
    const pr = env.ctx.prCreate('第3条を追加', '', env.branchName, env.fileId);
    approveAndMerge(env, pr);

    expect(env.ctx.issueGet(env.issue.number).state).toBe('open');
    expect(env.ctx.projectBoard()['Backlog'].length).toBe(1);
  });

  it('存在しないIssue番号を closes に書いてもPR作成とマージが失敗しない', () => {
    const env = prepare();
    const pr = env.ctx.prCreate('第3条を追加', 'closes #999',
      env.branchName, env.fileId);
    expect(() => approveAndMerge(env, pr)).not.toThrow();
  });

  it('ボードに未配置のIssueでもマージで Done に載る', () => {
    const env = setup();
    const issue = env.ctx.issueCreate('第3条を追加', '', [env.fileId]);
    env.ctx.issueCreateBranch(issue.number, env.fileId);

    const branchName = env.ctx.issueBranchName(issue.number, issue.title);
    const workFileId = env.ctx.branchWorkingFileId(branchName, env.fileId);
    env.fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条 休日</p>\n');
    env.ctx.commitFile(workFileId, branchName, '第3条を追加', null);

    const pr = env.ctx.prCreate('第3条を追加', 'closes #' + issue.number,
      branchName, env.fileId);
    approveAndMerge(env, pr);

    expect(env.ctx.projectBoard()['Done'].length).toBe(1);
  });
});

describe('通知', () => {
  it('宛先が空なら送らない', () => {
    const { ctx, fake } = setup();
    ctx.notify('', '件名', '本文');
    expect(fake._sentMails().length).toBe(0);
  });

  it('通知に失敗してもエラーを投げない', () => {
    const { ctx } = setup();
    ctx.GmailApp.sendEmail = () => { throw new Error('quota exceeded'); };
    expect(() => ctx.notify('a@example.com', '件名', '本文')).not.toThrow();
  });

  it('PR作成で作成者に通知が飛ぶ', () => {
    const { ctx, fake } = setup();
    ctx.notifyPrCreated({ number: 3, title: '改訂', author: 'a@example.com' });

    const mails = fake._sentMails();
    expect(mails.length).toBe(1);
    expect(mails[0].to).toBe('a@example.com');
    expect(mails[0].subject).toContain('PR #3');
  });

  it('PRマージで通知が飛ぶ', () => {
    const { ctx, fake } = setup();
    ctx.notifyPrMerged({ number: 3, title: '改訂', author: 'a@example.com' });

    const mails = fake._sentMails();
    expect(mails[0].subject).toContain('マージされました');
  });

  it('PR作成とマージの一連の流れで2通届く', () => {
    const env = setup();
    const issue = env.ctx.issueCreate('第3条を追加', '', [env.fileId]);
    env.ctx.issueCreateBranch(issue.number, env.fileId);

    const branchName = env.ctx.issueBranchName(issue.number, issue.title);
    const workFileId = env.ctx.branchWorkingFileId(branchName, env.fileId);
    env.fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条 休日</p>\n');
    env.ctx.commitFile(workFileId, branchName, '第3条を追加', null);

    const pr = env.ctx.prCreate('第3条を追加', '', branchName, env.fileId);
    env.fake._setUser('reviewer@example.com');
    env.ctx.prReview(pr.number, 'approve', '');
    env.fake._setUser('tester@example.com');
    env.ctx.prMerge(pr.number, []);

    expect(env.fake._sentMails().length).toBe(2);
  });
});

describe('やることの更新と担当', () => {
  it('担当とラベルを更新できる', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('在宅勤務規定の見直し', '', []);

    const updated = ctx.apiIssueUpdate(issue.number, {
      assignee: 'someone@example.com',
      labels: '規定改訂,要法務確認',
      title: '在宅勤務規定の見直し (第7条)',
    });

    expect(updated.assignee).toBe('someone@example.com');
    expect(updated.labels).toBe('規定改訂,要法務確認');
    expect(updated.title).toBe('在宅勤務規定の見直し (第7条)');
  });

  it('完了にするとカードもDoneに動く', () => {
    const { ctx } = setup();
    const issue = ctx.apiIssueCreate('やること', '', []);
    expect(ctx.projectBoard()['Backlog'].length).toBe(1);

    ctx.apiIssueClose(issue.number);

    expect(ctx.issueGet(issue.number).state).toBe('closed');
    expect(ctx.projectBoard()['Done'].length).toBe(1);
    expect(ctx.projectBoard()['Backlog'].length).toBe(0);
  });

  it('担当者の候補にこれまで関わった人が並ぶ', () => {
    const { ctx, fake, fileId } = setup();
    fake._setUser('me@example.com');

    fake._docs.set(fileId, '<p>変更</p>\n');
    ctx.commitFile(fileId, 'main', '記録', null);

    const issue = ctx.issueCreate('やること', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'other@example.com' });

    const people = ctx.apiKnownPeople();
    expect(people).toContain('me@example.com');
    expect(people).toContain('other@example.com');
  });
});

describe('やることを捨てる', () => {
  it('捨てると一覧から消え、置き場に入る', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('捨てる方', '', []);
    ctx.issueCreate('残る方', '', []);

    ctx.issueArchive(a.number);

    expect(ctx.issueList(null).map((i) => i.title)).toEqual(['残る方']);
    expect(ctx.issueListArchived().map((i) => i.title)).toEqual(['捨てる方']);
  });

  it('捨てても行は残っていて元に戻せる', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('もどす', '', []);

    ctx.issueArchive(a.number);
    ctx.issueRestore(a.number);

    expect(ctx.issueList(null).map((i) => i.number)).toContain(a.number);
    expect(ctx.issueListArchived()).toEqual([]);
  });

  it('二度捨てても壊れない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('二度', '', []);

    ctx.issueArchive(a.number);
    const at = ctx.issueGet(a.number).archivedAt;
    ctx.issueArchive(a.number);

    expect(ctx.issueGet(a.number).archivedAt).toEqual(at);
  });

  it('親を捨てると子は捨てた親の親につながる', () => {
    const { ctx } = setup();
    const gp = ctx.issueCreate('祖', '', []);
    const p = ctx.issueCreate('親', '', []);
    const c = ctx.issueCreate('子', '', []);
    ctx.issueUpdate(p.number, { parent: gp.number });
    ctx.issueUpdate(c.number, { parent: p.number });

    ctx.issueArchive(p.number);

    expect(Number(ctx.issueGet(c.number).parent)).toBe(gp.number);
  });

  it('親がいない親を捨てると子は根になる', () => {
    const { ctx } = setup();
    const p = ctx.issueCreate('親', '', []);
    const c = ctx.issueCreate('子', '', []);
    ctx.issueUpdate(c.number, { parent: p.number });

    ctx.issueArchive(p.number);

    expect(ctx.issueGet(c.number).parent).toBe('');
  });

  it('親が既に片付いていたら戻したものは根になる', () => {
    const { ctx } = setup();
    const p = ctx.issueCreate('親', '', []);
    const c = ctx.issueCreate('子', '', []);
    ctx.issueUpdate(c.number, { parent: p.number });

    ctx.issueArchive(c.number);
    ctx.issuePurge(p.number);
    ctx.issueRestore(c.number);

    expect(ctx.issueGet(c.number).parent).toBe('');
  });

  it('捨てたものは進捗ボードに出ない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('板から消える', '', []);
    ctx.projectPlace(a.number, 'Backlog');

    ctx.issueArchive(a.number);

    const board = ctx.projectBoard();
    const all = Object.keys(board).reduce((acc, k) => acc.concat(board[k]), []);
    expect(all.map((c) => c.number)).not.toContain(a.number);
  });

  it('期限を過ぎたものだけ片付ける', () => {
    const { ctx } = setup();
    const old = ctx.issueCreate('古い', '', []);
    const fresh = ctx.issueCreate('新しい', '', []);
    ctx.issueArchive(old.number);
    ctx.issueArchive(fresh.number);

    const day = 24 * 60 * 60 * 1000;
    ctx.dbUpdate('issues', 'number', old.number, {
      archivedAt: new Date(Date.now() - 40 * day),
    });

    expect(ctx.issueHousekeep(new Date())).toEqual([old.number]);
    expect(ctx.issueListArchived().map((i) => i.number)).toEqual([fresh.number]);
    expect(() => ctx.issueGet(old.number)).toThrow();
  });

  it('捨てていないものは完全に消せない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('まだ生きてる', '', []);

    expect(() => ctx.apiIssuePurge(a.number)).toThrow(/先に捨てて/);
  });

  it('画面に渡す形に残り日数が入る', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('残り日数', '', []);
    ctx.issueArchive(a.number);

    const [row] = ctx.apiIssueArchivedList();
    expect(row.daysLeft).toBe(ctx.apiArchiveKeepDays());
    expect(typeof row.archivedAt).toBe('string');
  });
});

describe('完了を差し戻す', () => {
  it('完了にしたものをやることに戻せる', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('戻す', '', []);
    ctx.issueClose(a.number, null);

    const back = ctx.issueReopen(a.number);

    expect(back.state).toBe('open');
    expect(back.closedAt).toBe('');
  });

  it('カードは作業中に戻る', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('板から戻す', '', []);
    ctx.projectPlace(a.number, 'Backlog');
    ctx.projectMove(a.number, 'Done', 0);
    ctx.issueClose(a.number, null);

    ctx.issueReopen(a.number);

    expect(ctx.dbFindOne('project_items', 'issueNumber', a.number).column)
      .toBe('In Progress');
  });

  it('板に無いものを戻しても落ちない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('板に無い', '', []);
    ctx.issueClose(a.number, null);

    expect(() => ctx.issueReopen(a.number)).not.toThrow();
  });

  it('もともと開いているものは変わらない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('開いたまま', '', []);

    expect(ctx.issueReopen(a.number).state).toBe('open');
  });

  it('捨てたものは先に戻してからでないと開けない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('捨てた', '', []);
    ctx.issueClose(a.number, null);
    ctx.issueArchive(a.number);

    expect(() => ctx.issueReopen(a.number)).toThrow(/置き場から/);
  });

  it('差し戻すと動きのなさも数え直される', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('数え直し', '', []);
    ctx.dbUpdate('issues', 'number', a.number, {
      updatedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    });
    ctx.issueClose(a.number, null);
    ctx.issueReopen(a.number);

    expect(ctx.stalenessOf(ctx.issueGet(a.number), new Date()).level).toBe(0);
  });
});

describe('担当者を複数割り当てる', () => {
  it('カンマ区切りで持つ', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('ふたりで', '', []);

    ctx.issueUpdate(a.number, { assignee: 'x@example.com,y@example.com' });

    expect(ctx.issueAssignees(ctx.issueGet(a.number)))
      .toEqual(['x@example.com', 'y@example.com']);
  });

  it('配列でも渡せる', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('ふたりで', '', []);

    ctx.issueUpdate(a.number, { assignee: ['x@example.com', 'y@example.com'] });

    expect(ctx.issueGet(a.number).assignee).toBe('x@example.com,y@example.com');
  });

  it('前後の空白と重なりを落とす', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('そろえる', '', []);

    ctx.issueUpdate(a.number, { assignee: ' x@example.com , x@example.com ' });

    expect(ctx.issueGet(a.number).assignee).toBe('x@example.com');
  });

  it('メールの形になっていないものは断る', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('だめなの', '', []);

    expect(() => ctx.issueUpdate(a.number, { assignee: 'だれか' }))
      .toThrow(/メールアドレスで入れて/);
  });

  it('空にできる', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('担当なしに戻す', '', []);
    ctx.issueUpdate(a.number, { assignee: 'x@example.com' });

    ctx.issueUpdate(a.number, { assignee: '' });

    expect(ctx.issueAssignees(ctx.issueGet(a.number))).toEqual([]);
  });
});
