import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, snapshotDb, asUser, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: やること・やりとり・下書き・タグ・置き場・ボード (src/api/Issue.gs)。
 */

const ISSUE_KEYS = ['number', 'title', 'body', 'state', 'priority', 'assignee', 'assignees', 'labels',
  'linkedFileIds', 'linkedPr', 'createdAt', 'closedAt', 'dueDate', 'startDate', 'parent', 'estimate',
  'plannedHours', 'actualHours', 'archivedAt', 'daysLeft', 'updatedAt', 'staleDays', 'staleLevel',
  'sprint', 'points', 'acceptance'];

function boardColumnOf(ctx, number) {
  const board = ctx.apiProjectBoard();
  for (const col of Object.keys(board)) {
    if (board[col].some((c) => c.issueNumber === number)) return col;
  }
  return null;
}

describe('apiIssueCreate', () => {
  it('作ったものを画面に渡せる形で返し、ボードの Backlog に置く', () => {
    const { ctx, fileId } = makeEnv();
    const out = expectScreenSafe(ctx.apiIssueCreate('規程を読む', '本文', [fileId], '総務'));
    expect(Object.keys(out).sort()).toEqual([...ISSUE_KEYS].sort());
    expect(out).toMatchObject({ number: 1, title: '規程を読む', body: '本文', state: 'open',
      priority: 'normal', linkedFileIds: fileId, labels: '総務' });
    expect(boardColumnOf(ctx, 1)).toBe('Backlog');
  });

  it('作るときに一緒に入れた値は1件で入る (作ってから直さない)', () => {
    const { ctx } = makeEnv();
    const out = ctx.apiIssueCreate('期限つき', '', [], '', {
      assignee: 'a@example.com, b@example.com', dueDate: '2026-11-30', priority: 'high',
      estimate: 3, title: '無視される', sprint: '',
    });
    expect(out.assignees).toEqual(['a@example.com', 'b@example.com']);
    expect(out.dueDate).toBe('2026-11-30');
    expect(out.priority).toBe('high');
    expect(out.estimate).toBe(3);
    expect(out.title).toBe('期限つき');
    expect(ctx.dbReadAll('issues')).toHaveLength(1);
  });

  it('題名が無ければ断り、何も作らない', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiIssueCreate('', '本文', []), /タイトルを入力してください/);
    expect(ctx.dbReadAll('issues')).toHaveLength(0);
    expect(ctx.dbReadAll('project_items')).toHaveLength(0);
  });

  it('管理対象にない文書を結び付けようとすると断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiIssueCreate('x', '', ['file-nope']), /管理対象にない文書です/);
    expect(ctx.dbReadAll('issues')).toHaveLength(0);
  });

  it('一緒に入れる値が駄目なら、作る前に断る (2つ並ばない)', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiIssueCreate('x', '', [], '', { priority: 'urgent' }), /知らない優先度です/);
    expectRefused(() => ctx.apiIssueCreate('x', '', [], '', { assignee: '名前だけ' }), /メールアドレス/);
    expectRefused(() => ctx.apiIssueCreate('x', '', [], '', { sprint: 'S1' }), /オフです/);
    expect(ctx.dbReadAll('issues')).toHaveLength(0);
    expect(ctx.dbReadAll('project_items')).toHaveLength(0);
  });
});

describe('apiIssueList / apiIssuesForFile / apiIssuePriorities', () => {
  it('状態で絞れ、全件は空文字で返る', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueCreate('B', '', []);
    ctx.apiIssueClose(1);

    expect(expectScreenSafe(ctx.apiIssueList('')).map((r) => r.number).sort()).toEqual([1, 2]);
    expect(ctx.apiIssueList('open').map((r) => r.number)).toEqual([2]);
    expect(ctx.apiIssueList('closed').map((r) => r.number)).toEqual([1]);
    expect(ctx.apiIssueList().length).toBe(2);
  });

  it('台帳に手で読めない日付が書かれても、一覧は落とさない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.dbUpdate('issues', 'number', 1, { createdAt: '昨日あたり', dueDate: 'そのうち' });
    const out = expectScreenSafe(ctx.apiIssueList(''));
    expect(out[0].createdAt).toBe('');
  });

  it('文書に結び付いた、開いているものだけを返す', () => {
    const { ctx, fileId } = makeEnv();
    ctx.apiIssueCreate('結び付き', '', [fileId]);
    ctx.apiIssueCreate('無関係', '', []);
    ctx.apiIssueCreate('閉じた', '', [fileId]);
    ctx.apiIssueClose(3);

    expect(expectScreenSafe(ctx.apiIssuesForFile(fileId)).map((r) => r.number)).toEqual([1]);
  });

  it('優先度の選択肢は ISSUE_PRIORITIES そのもの', () => {
    const { ctx } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiIssuePriorities())).toEqual([['high', '高'], ['normal', 'ふつう'], ['low', '低']]);
  });
});

describe('apiIssueUpdate', () => {
  it('直した値を返し、台帳と更新の跡が動く', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    const out = expectScreenSafe(ctx.apiIssueUpdate(1, { title: 'A2', priority: 'low', labels: '急ぎ,総務' }));
    expect(out).toMatchObject({ title: 'A2', priority: 'low', labels: '急ぎ,総務' });
    // その場で書いたタグは次から選べる
    expect(ctx.apiTagList().map((t) => t.name)).toEqual(expect.arrayContaining(['急ぎ', '総務']));
  });

  it('知らない欄は書かない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueUpdate(1, { createdBy: 'evil@example.com', number: 99 });
    expect(ctx.dbFindOne('issues', 'number', 1)).toBeTruthy();
    expect(ctx.dbFindOne('issues', 'number', 99)).toBeNull();
  });

  it('状態は直せない (完了は apiIssueClose)', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    expect(() => ctx.apiIssueUpdate(1, { state: 'closed' })).toThrow();
    expect(String(ctx.dbFindOne('issues', 'number', 1).state)).toBe('open');
  });

  it('無い番号・知らない優先度・輪になる親は断り、書き換えない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('親', '', []);
    ctx.apiIssueCreate('子', '', []);
    ctx.apiIssueUpdate(2, { parent: 1 });
    const before = snapshotDb(ctx, ['issues']);

    expectRefused(() => ctx.apiIssueUpdate(9, { title: 'x' }), /やることが見つかりません: #9/);
    expectRefused(() => ctx.apiIssueUpdate(1, { priority: 'urgent' }), /知らない優先度です/);
    expectRefused(() => ctx.apiIssueUpdate(1, { parent: 2 }), /輪になります/);
    expectRefused(() => ctx.apiIssueUpdate(1, { linkedFileIds: 'file-nope' }), /管理対象にない文書です/);
    expect(snapshotDb(ctx, ['issues'])).toEqual(before);
  });

  it('patch を省いても落ちない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    expect(ctx.apiIssueUpdate(1).title).toBe('A');
  });

  it.todo('題名を空に直せてしまう (作るときは「タイトルを入力してください」で断るのに、直すときは通る)');
});

describe('apiIssueClose / apiIssueReopen', () => {
  it('完了にするとカードが Done へ動き、取り消すと作業中へ戻る', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    const closed = expectScreenSafe(ctx.apiIssueClose(1));
    expect(closed.state).toBe('closed');
    expect(closed.closedAt).toMatch(/T/);
    expect(boardColumnOf(ctx, 1)).toBe('Done');

    const back = expectScreenSafe(ctx.apiIssueReopen(1));
    expect(back.state).toBe('open');
    expect(back.closedAt).toBe('');
    expect(boardColumnOf(ctx, 1)).toBe('In Progress');
  });

  it('二度閉じても、開いているものを開け直しても変わらない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    expect(ctx.apiIssueReopen(1).state).toBe('open');
    const first = ctx.apiIssueClose(1);
    expect(ctx.apiIssueClose(1).closedAt).toBe(first.closedAt);
  });

  it('ボードに置かれていないものも閉じられ、Done に置かれる', () => {
    const { ctx } = makeEnv();
    ctx.issueCreate('板の外', '', [], '');
    expect(boardColumnOf(ctx, 1)).toBeNull();
    expect(ctx.apiIssueClose(1).state).toBe('closed');
    expect(boardColumnOf(ctx, 1)).toBe('Done');
  });

  it('無い番号は断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiIssueClose(5), /やることが見つかりません/);
    expectRefused(() => ctx.apiIssueReopen(5), /やることが見つかりません/);
  });

  it('捨てたものは置き場から戻すまで開け直せない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueClose(1);
    ctx.apiIssueArchive(1);
    expectRefused(() => ctx.apiIssueReopen(1), /先に置き場から元に戻してください/);
  });
});

describe('やりとり (apiIssueComment*)', () => {
  it('書き込みを返し、一覧は古い順で本人のものに印が付く', () => {
    const { ctx, fake } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    const mine = expectScreenSafe(ctx.apiIssueComment(1, '  一言  '));
    expect(mine).toMatchObject({ id: 1, issueNumber: 1, body: '一言', by: 'tester@example.com', canEdit: true });
    asUser(fake, OTHER, () => ctx.apiIssueComment(1, 'ほかの人'));

    const list = expectScreenSafe(ctx.apiIssueComments(1));
    expect(list.map((c) => c.id)).toEqual([1, 2]);
    expect(list.map((c) => c.canEdit)).toEqual([true, false]);
    expect(ctx.apiIssueComments(99)).toEqual([]);
  });

  it('空・長すぎる・無いやることへの書き込みは断り、何も残さない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    expectRefused(() => ctx.apiIssueComment(1, '   '), /内容を入力してください/);
    expectRefused(() => ctx.apiIssueComment(1, 'あ'.repeat(4001)), /4000文字まで/);
    expectRefused(() => ctx.apiIssueComment(9, 'x'), /やることが見つかりません/);
    expect(ctx.dbReadAll('issue_comments')).toHaveLength(0);
  });

  it('直すのも消すのも書いた本人だけ (管理者でも他人のものは直せない)', () => {
    const { ctx, fake } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    asUser(fake, OTHER, () => ctx.apiIssueComment(1, 'ほかの人'));
    const before = snapshotDb(ctx, ['issue_comments']);

    expectRefused(() => ctx.apiIssueCommentEdit(1, '書き換え'), /自分が書いたものだけ直せます/);
    expectRefused(() => ctx.apiIssueCommentDelete(1), /自分が書いたものだけ直せます/);
    asUser(fake, ADMIN, () => {
      expectRefused(() => ctx.apiIssueCommentEdit(1, '書き換え'), /自分が書いたものだけ/);
    });
    expect(snapshotDb(ctx, ['issue_comments'])).toEqual(before);

    asUser(fake, OTHER, () => {
      const edited = expectScreenSafe(ctx.apiIssueCommentEdit(1, '直した'));
      expect(edited.body).toBe('直した');
      expect(edited.editedAt).toMatch(/T/);
      expect(ctx.apiIssueCommentDelete(1)).toBe('書き込みを消しました');
    });
    expect(ctx.dbReadAll('issue_comments')).toHaveLength(0);
  });

  it('名指しが無い・空の直しは断る', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueComment(1, 'x');
    expectRefused(() => ctx.apiIssueCommentEdit('', 'y'), /やりとりを指定してください/);
    expectRefused(() => ctx.apiIssueCommentEdit(7, 'y'), /やりとりが見つかりません/);
    expectRefused(() => ctx.apiIssueCommentEdit(1, ''), /内容を入力してください/);
    expectRefused(() => ctx.apiIssueCommentEdit(1, 'あ'.repeat(4001)), /4000文字まで/);
    expectRefused(() => ctx.apiIssueCommentDelete(7), /やりとりが見つかりません/);
  });
});

describe('下書き (apiTemplate*)', () => {
  it('保存・一覧・消すが通る。用意されたものと自分のものを見分ける', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiTemplateList(); // 最初に開いたときに、用意した下書きが入る
    const saved = expectScreenSafe(ctx.apiTemplateSave(' 議事録 ', '## 決めたこと'));
    expect(saved).toEqual({ name: '議事録', body: '## 決めたこと' });

    const list = expectScreenSafe(ctx.apiTemplateList());
    const mine = list.find((t) => t.name === '議事録');
    expect(mine).toMatchObject({ builtin: false, mine: true });
    const builtin = list.filter((t) => t.builtin);
    expect(builtin.length).toBeGreaterThan(0);
    expect(builtin.every((t) => t.mine === false)).toBe(true);

    asUser(fake, OTHER, () => {
      expect(ctx.apiTemplateList().find((t) => t.name === '議事録').mine).toBe(false);
    });
    expect(ctx.apiTemplateDelete('議事録')).toBe('下書き「議事録」を消しました');
    expect(ctx.apiTemplateList().some((t) => t.name === '議事録')).toBe(false);
  });

  it('用意された下書きは書き換えも消すこともできない', () => {
    const { ctx } = makeEnv({ file: false });
    const builtin = ctx.apiTemplateList().find((t) => t.builtin);
    const before = snapshotDb(ctx, ['templates']);
    expectRefused(() => ctx.apiTemplateSave(builtin.name, '上書き'), /用意されている下書きは書き換えられません/);
    expectRefused(() => ctx.apiTemplateDelete(builtin.name), /用意されている下書きは消せません/);
    expect(snapshotDb(ctx, ['templates'])).toEqual(before);
  });

  it('名前・中身の検査', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiTemplateSave('', 'x'), /下書きの名前が正しくありません/);
    expectRefused(() => ctx.apiTemplateSave('名前', '  '), /中身を入力してください/);
    expectRefused(() => ctx.apiTemplateSave('名前', 'あ'.repeat(4001)), /4000文字まで/);
    expectRefused(() => ctx.apiTemplateDelete('無い'), /下書きが見つかりません/);
  });

  it('他人の下書きを消せるのは管理者だけ', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiTemplateSave('ほかの人の', '中身'));
    expectRefused(() => asUser(fake, 'third@example.com', () => ctx.apiTemplateDelete('ほかの人の')),
      /自分が作った下書きだけ消せます/);
    expect(ctx.dbFindOne('templates', 'name', 'ほかの人の')).toBeTruthy();
    asUser(fake, ADMIN, () => ctx.apiTemplateDelete('ほかの人の'));
    expect(ctx.dbFindOne('templates', 'name', 'ほかの人の')).toBeNull();
  });

  it.todo('一覧を一度も開かないうちに保存すると、用意した下書きが入らない (templateList は表が空のときだけ入れる。用意したものと同じ名前で先に保存すると、書き換えられない守りも外れる)');

  it.todo('他人の下書きを上書き保存できてしまう (消すのは作った本人か管理者だけなのに、同じ名前で保存すると誰でも中身を書き換えられる)');
});

describe('タグ (apiTag*)', () => {
  it('作る・一覧・消す。知らない色は ink に倒す', () => {
    const { ctx } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiTagColors())).toContain('ink');
    expect(expectScreenSafe(ctx.apiTagCreate('総務', 'no-such-color'))).toEqual({ name: '総務', color: 'ink', builtin: false });
    const list = expectScreenSafe(ctx.apiTagList());
    expect(list.find((t) => t.name === '総務')).toEqual({ name: '総務', color: 'ink', builtin: false });
    expect(ctx.apiTagDelete('総務')).toBe('タグ「総務」を消しました');
    expect(ctx.apiTagList().some((t) => t.name === '総務')).toBe(false);
  });

  it('同じ名前は2つにならない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiTagCreate('総務', 'ink');
    ctx.apiTagCreate('総務', 'ink');
    expect(ctx.dbReadAll('tags').filter((t) => String(t.name) === '総務')).toHaveLength(1);
  });

  it('名前の検査・用意されたタグは消せない・無いタグ', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiTagCreate('', 'ink'), /タグの名前が正しくありません/);
    expectRefused(() => ctx.apiTagDelete('無いタグ'), /タグが見つかりません/);
    const builtin = ctx.apiTagList().find((t) => t.builtin);
    if (builtin) expectRefused(() => ctx.apiTagDelete(builtin.name), /用意されているタグは消せません/);
  });
});

describe('置き場 (apiIssueArchive / Restore / Purge / ArchivedList / ArchiveKeepDays)', () => {
  it('捨てると一覧から外れて置き場に入り、残りの日数が付く', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    const out = expectScreenSafe(ctx.apiIssueArchive(1));
    expect(out.archivedAt).toMatch(/T/);
    expect(out.daysLeft).toBe(ctx.apiArchiveKeepDays());
    expect(boardColumnOf(ctx, 1)).toBeNull();
    expect(expectScreenSafe(ctx.apiIssueArchivedList()).map((r) => r.number)).toEqual([1]);

    const back = expectScreenSafe(ctx.apiIssueRestore(1));
    expect(back.archivedAt).toBe('');
    expect(back.daysLeft).toBe('');
    expect(ctx.apiIssueArchivedList()).toHaveLength(0);
  });

  it('捨てた子は親につなぎ直し、戻すときに消えた親は外す', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('祖', '', []);
    ctx.apiIssueCreate('親', '', [], '', { parent: 1 });
    ctx.apiIssueCreate('子', '', [], '', { parent: 2 });
    ctx.apiIssueArchive(2);
    expect(ctx.apiIssueList('').find((r) => r.number === 3).parent).toBe(1);

    ctx.apiIssueArchive(1);
    ctx.apiIssuePurge(1);
    expect(ctx.apiIssueRestore(2).parent).toBe('');
  });

  it('捨てていないものは完全に消せない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    const before = snapshotDb(ctx, ['issues', 'project_items']);
    expectRefused(() => ctx.apiIssuePurge(1), /先に捨ててから消してください/);
    expect(snapshotDb(ctx, ['issues', 'project_items'])).toEqual(before);
  });

  it('完全に消すとぶら下がりも消え、番号は二度出ない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueComment(1, '一言');
    ctx.apiIssueArchive(1);
    expect(ctx.apiIssuePurge(1)).toBe('#1 を完全に消しました');

    expect(ctx.dbReadAll('issues')).toHaveLength(0);
    expect(ctx.dbReadAll('issue_comments')).toHaveLength(0);
    expect(ctx.dbReadAll('project_items')).toHaveLength(0);
    expect(ctx.apiIssueCreate('B', '', []).number).toBe(2);
  });

  it('無い番号は断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiIssueArchive(3), /やることが見つかりません/);
    expectRefused(() => ctx.apiIssueRestore(3), /やることが見つかりません/);
    expectRefused(() => ctx.apiIssuePurge(3), /やることが見つかりません/);
  });
});

describe('apiIssueCreateBranch', () => {
  it('やることから改訂版を作り、カードを作業中へ動かす', () => {
    const { ctx, fileId } = makeEnv();
    ctx.apiIssueCreate('第2条の見直し', '', [fileId]);
    const out = expectScreenSafe(ctx.apiIssueCreateBranch(1, fileId));
    expect(out).toEqual({ name: 'issue-1-第2条の見直し' });
    expect(ctx.dbFindOne('branches', 'name', out.name)).toBeTruthy();
    expect(boardColumnOf(ctx, 1)).toBe('In Progress');
  });

  it('完了したやることからは作らない', () => {
    const { ctx, fileId } = makeEnv();
    ctx.apiIssueCreate('済んだ', '', []);
    ctx.apiIssueClose(1);
    const before = snapshotDb(ctx, ['branches', 'files']);
    expectRefused(() => ctx.apiIssueCreateBranch(1, fileId), /完了したやることからは改訂版を作れません/);
    expect(snapshotDb(ctx, ['branches', 'files'])).toEqual(before);
    expect(boardColumnOf(ctx, 1)).toBe('Done');
  });

  it('無いやることは断る', () => {
    const { ctx, fileId } = makeEnv();
    expectRefused(() => ctx.apiIssueCreateBranch(9, fileId), /やることが見つかりません/);
  });
});

describe('ボード (apiProjectBoard / apiProjectMove)', () => {
  it('列が揃っていて、カードは画面に渡せる形', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', [], '', { dueDate: '2026-11-01', assignee: 'a@example.com' });
    const board = expectScreenSafe(ctx.apiProjectBoard());
    expect(Object.keys(board)).toEqual(['Backlog', 'In Progress', 'In Review', 'Done']);
    expect(board.Backlog[0]).toMatchObject({ issueNumber: 1, order: 0, title: 'A', dueDate: '2026-11-01',
      assignees: ['a@example.com'], priority: 'normal' });
  });

  it('動かすとその列のその位置に入り、ほかの番号を振り直す', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueCreate('B', '', []);
    ctx.apiIssueCreate('C', '', []);
    expectScreenSafe(ctx.apiProjectMove(3, 'Backlog', 0));
    expect(ctx.apiProjectBoard().Backlog.map((c) => c.issueNumber)).toEqual([3, 1, 2]);

    ctx.apiProjectMove(1, 'In Review', 0);
    const board = ctx.apiProjectBoard();
    expect(board['In Review'].map((c) => c.issueNumber)).toEqual([1]);
    expect(board.Backlog.map((c) => c.order)).toEqual([0, 1]);
  });

  it('知らない列は断り、カードは動かない', () => {
    const { ctx } = makeEnv();
    ctx.apiIssueCreate('A', '', []);
    const before = snapshotDb(ctx, ['project_items']);
    expectRefused(() => ctx.apiProjectMove(1, 'Archive', 0), /列が不正です/);
    expect(snapshotDb(ctx, ['project_items'])).toEqual(before);
  });

  it('無いやることは動かせない', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiProjectMove(9, 'Done', 0), /やることが見つかりません/);
    expect(ctx.dbReadAll('project_items')).toHaveLength(0);
  });
});
