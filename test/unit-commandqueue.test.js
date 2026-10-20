import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * コマンドキューの命令表 (COMMAND_OPS) と、置いた人の決め方・鍵が取れないときの
 * 単体テスト。通しの流れは test/phase4-queue.test.js にある。
 *
 * 命令表は手元から渡された引数を api* に渡す。**渡されなかった欄に何を入れるか**は
 * ここにしか書いてなく、違えると手元の道具が黙って別のことを頼む。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { fake, ctx };
}

/** api* を差し替えて、渡された引数を覚える */
function spy(ctx, names) {
  const calls = [];
  for (const n of names) ctx[n] = (...args) => { calls.push([n, ...args]); return n; };
  return calls;
}

describe('COMMAND_OPS: 省いた引数の既定', () => {
  it('省いた欄は決めた既定で渡し、渡した欄はそのまま渡す', () => {
    const { ctx } = setup();
    const calls = spy(ctx, [
      'apiSaveMarkdown', 'apiCommit', 'apiIssueCreate', 'apiPrCreate', 'apiOutboxTake', 'apiOutboxDone',
      'apiOutboxFail', 'apiPrMerge', 'apiIssueList', 'apiCommitDiff', 'apiIssueUpdate', 'apiProjectMove',
      'apiSprintCreate', 'apiSprintUpdate', 'apiScrumView', 'apiImpedimentCreate', 'apiImpedimentUpdate',
    ]);
    const ops = ctx.COMMAND_OPS();
    const empty = [
      ['writeMarkdown', { fileId: 'F', markdown: 'm' }], ['commit', { fileId: 'F', message: 'x' }],
      ['issueCreate', { title: 't', body: 'b' }], ['prCreate', { title: 't', body: 'b', sourceBranch: 's', mainFileId: 'F' }],
      ['work', {}], ['workDone', { id: 1 }], ['workFail', { id: 2 }], ['prMerge', { number: 3 }],
      ['issueList', {}], ['commitDiff', { toSha: 'T' }], ['issueUpdate', { number: 4 }],
      ['boardMove', { number: 5, column: '作業中' }], ['sprintCreate', {}], ['sprintUpdate', { name: 'S' }],
      ['scrumView', {}], ['impedimentCreate', {}], ['impedimentUpdate', { number: 6 }],
    ];
    for (const [op, a] of empty) ops[op](a);
    expect(calls).toEqual([
      ['apiSaveMarkdown', 'F', 'm', ''], ['apiCommit', 'F', 'x', null],
      ['apiIssueCreate', 't', 'b', []], ['apiPrCreate', 't', 'b', 's', 'F', 'main'],
      ['apiOutboxTake', 5], ['apiOutboxDone', 1, ''], ['apiOutboxFail', 2, ''], ['apiPrMerge', 3, [], ''],
      ['apiIssueList', ''], ['apiCommitDiff', '', 'T'], ['apiIssueUpdate', 4, {}],
      ['apiProjectMove', 5, '作業中', 0], ['apiSprintCreate', {}], ['apiSprintUpdate', 'S', {}],
      ['apiScrumView', ''], ['apiImpedimentCreate', {}], ['apiImpedimentUpdate', 6, {}],
    ]);

    calls.length = 0;
    ops.work({ limit: 2 });
    ops.workDone({ id: 1, result: 'ok' });
    ops.workFail({ id: 2, reason: 'ng' });
    ops.prMerge({ number: 3, choices: { F: ['ours'] }, previewSha: 'P' });
    ops.issueList({ state: 'closed' });
    ops.commitDiff({ fromSha: 'A', toSha: 'B' });
    ops.boardMove({ number: 5, column: '完了', order: 7 });
    ops.prCreate({ title: 't', body: 'b', sourceBranch: 's', mainFileId: 'F', targetBranch: '改訂' });
    ops.commit({ fileId: 'F', message: 'x', expectedHeadSha: 'H' });
    expect(calls).toEqual([
      ['apiOutboxTake', 2], ['apiOutboxDone', 1, 'ok'], ['apiOutboxFail', 2, 'ng'],
      ['apiPrMerge', 3, { F: ['ours'] }, 'P'], ['apiIssueList', 'closed'], ['apiCommitDiff', 'A', 'B'],
      ['apiProjectMove', 5, '完了', 7], ['apiPrCreate', 't', 'b', 's', 'F', '改訂'], ['apiCommit', 'F', 'x', 'H'],
    ]);
  });

  it('承認 (prReview) は命令表に無い (キュー経由は常に自己承認になるため)', () => {
    const { ctx } = setup();
    expect(Object.keys(ctx.COMMAND_OPS())).not.toContain('prReview');
  });

  it('scrumState はオフのときだけオンにする道を添える', () => {
    const { ctx } = setup();
    ctx.apiSettings = () => ({ scrumEnabled: false, productGoal: 'g', definitionOfDone: 'd' });
    expect(ctx.COMMAND_OPS().scrumState().howToEnable).toMatch(/管理者が画面の「設定」でオン/);
    ctx.apiSettings = () => ({ scrumEnabled: true, productGoal: 'g', definitionOfDone: 'd' });
    expect(ctx.COMMAND_OPS().scrumState()).toEqual({ scrumEnabled: true, productGoal: 'g', definitionOfDone: 'd', howToEnable: '' });
  });

  it('自分の様子を見る命令は、置いた人が分からなければ断る', () => {
    const { ctx } = setup();
    const ops = ctx.COMMAND_OPS();
    for (const op of ctx.COMMAND_PERSONAL_OPS()) {
      expect(() => ops[op]({}, '')).toThrow(/命令を置いた人が分かりません/);
    }
  });
});

describe('commandPersonOf_: 誰のぶんを返すか', () => {
  const file = { getId: () => 'F1' };

  it('置いた人が空なら決めない', () => {
    const { ctx } = setup();
    expect(ctx.commandPersonOf_(file, '')).toBe('');
  });

  it('Drive の拡張サービスが無ければ持ち主で決める', () => {
    const { ctx } = setup();
    ctx.driveApiAvailable_ = () => false;
    expect(ctx.commandPersonOf_(file, 'aoki@example.com')).toBe('aoki@example.com');
  });

  it('最後に書いた人が持ち主と食い違えば決めない (大文字小文字は区別しない)', () => {
    const { ctx, fake } = setup();
    ctx.driveApiAvailable_ = () => true;
    let last = 'AOKI@example.com';
    fake.Drive = { Files: { get: () => ({ lastModifyingUser: { emailAddress: last } }) } };
    expect(ctx.commandPersonOf_(file, 'aoki@example.com')).toBe('aoki@example.com');
    last = 'kato@example.com';
    expect(ctx.commandPersonOf_(file, 'aoki@example.com')).toBe('');
    // 最後に書いた人が読めない (空) なら持ち主で決める
    last = '';
    expect(ctx.commandPersonOf_(file, 'aoki@example.com')).toBe('aoki@example.com');
  });

  it('見比べられなかったときは決めない', () => {
    const { ctx, fake } = setup();
    ctx.driveApiAvailable_ = () => true;
    fake.Drive = { Files: { get: () => { throw new Error('quota'); } } };
    expect(ctx.commandPersonOf_(file, 'aoki@example.com')).toBe('');
  });
});

describe('processCommandQueue: 鍵が取れないとき', () => {
  it('取れなかった命令は残し、次の回に回すと返す', () => {
    const { ctx, fake } = setup();
    const q = ctx.commandQueueFolder_();
    ctx.commandDoneFolder_();
    q.createFile('c1.cmd.json', JSON.stringify({ op: 'listFiles', args: {} }), 'text/plain');
    q.createFile('c2.cmd.json', JSON.stringify({ op: 'listFiles', args: {} }), 'text/plain');
    q.createFile('memo.txt', 'x', 'text/plain');

    // 1件目だけ取れて、2件目で混み合う
    let n = 0;
    fake.LockService.getScriptLock = () => ({ tryLock: () => (++n === 1), releaseLock: () => {} });
    ctx.housekeepArchiveDaily_ = () => {};
    expect(ctx.processCommandQueue()).toBe('1件処理しました (残りは他の処理が実行中のため次の回に)');
    expect(q.getFilesByName('c2.cmd.json').hasNext()).toBe(true);
  });

  it('命令の無い回は鍵を取らない', () => {
    const { ctx, fake } = setup();
    ctx.commandQueueFolder_();
    ctx.commandDoneFolder_();
    let asked = 0;
    fake.LockService.getScriptLock = () => ({ tryLock: () => { asked++; return true; }, releaseLock: () => {} });
    ctx.housekeepArchiveDaily_ = () => {};
    expect(ctx.processCommandQueue()).toBe('0件処理しました');
    expect(asked).toBe(0);
  });

  it('片付けが落ちても、命令の処理の結果は返す', () => {
    const { ctx } = setup();
    ctx.commandQueueFolder_();
    ctx.commandDoneFolder_();
    ctx.housekeepArchiveDaily_ = () => { throw new Error('Drive が混んでいます'); };
    expect(ctx.processCommandQueue()).toBe('0件処理しました');
  });
});

describe('queueFolder_: ゴミ箱と消えたフォルダ', () => {
  it('手で消されたフォルダの ID は使わず作り直す', () => {
    const { ctx, fake } = setup();
    const first = ctx.commandQueueFolder_();
    const id = first.getId();
    // ゴミ箱に入れると次は別のフォルダになる
    first.setTrashed(true);
    const second = ctx.commandQueueFolder_();
    expect(second.getId()).not.toBe(id);
    expect(ctx.queueFolderLive_('')).toBe(null);
    expect(ctx.queueFolderLive_('folder-does-not-exist')).toBe(null);
    expect(ctx.queueFolderLive_(second.getId()).getId()).toBe(second.getId());
  });
});
