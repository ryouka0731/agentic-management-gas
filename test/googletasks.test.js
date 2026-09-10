import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Tag.gs',
  'src/core/Template.gs',
  'src/core/Member.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Issue.gs',
  'src/core/IssueComment.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Notifier.gs',
  'src/core/GoogleTasks.gs',
];

/**
 * @param {boolean} withTasks 拡張サービスを足した環境かどうか
 */
function setup(withTasks) {
  const fake = createFakeGas();
  if (withTasks) fake.Tasks = fake._makeTasks();

  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('拡張サービスが無い環境', () => {
  it('使えないと分かる', () => {
    const { ctx } = setup(false);
    expect(ctx.tasksAvailable()).toBe(false);
  });

  it('入れ先を選ぼうとすると足し方を教える', () => {
    const { ctx } = setup(false);
    expect(() => ctx.tasksChooseList('L1')).toThrow(/サービス \+/);
  });

  it('同期しようとしても他は壊れない', () => {
    const { ctx } = setup(false);
    ctx.issueCreate('文書と関係ない仕事', '', []);

    expect(() => ctx.tasksSyncMine()).toThrow(/使えません/);
    expect(ctx.issueList(null)).toHaveLength(1);
  });
});

describe('入れ先の ToDo リスト', () => {
  it('一覧を返す', () => {
    const { ctx } = setup(true);
    expect(ctx.tasksLists()).toEqual([{ id: 'L1', title: 'マイタスク' }]);
  });

  it('選ぶと覚える', () => {
    const { ctx } = setup(true);
    ctx.tasksChooseList('L1');

    expect(ctx.tasksChosenList()).toBe('L1');
  });

  it('無いリストは選べない', () => {
    const { ctx } = setup(true);
    expect(() => ctx.tasksChooseList('X')).toThrow(/見つかりません/);
  });

  it('選ばずに同期しようとすると断る', () => {
    const { ctx } = setup(true);
    expect(() => ctx.tasksSyncMine()).toThrow(/先に入れ先/);
  });
});

describe('同期', () => {
  function ready() {
    const env = setup(true);
    env.ctx.tasksChooseList('L1');
    return env;
  }

  it('自分の担当だけを送る', () => {
    const { ctx, fake } = ready();
    const mine = ctx.issueCreate('自分のぶん', '', []);
    const other = ctx.issueCreate('他人のぶん', '', []);
    ctx.issueUpdate(mine.number, { assignee: 'tester@example.com' });
    ctx.issueUpdate(other.number, { assignee: 'aoki@example.com' });

    const res = ctx.tasksSyncMine();

    expect(res.pushed).toBe(1);
    const titles = [...fake.Tasks._items.values()].map((t) => t.title);
    expect(titles).toEqual(['#' + mine.number + ' 自分のぶん']);
  });

  it('担当が誰も付いていないものは送らない', () => {
    const { ctx } = ready();
    ctx.issueCreate('担当なし', '', []);

    expect(ctx.tasksSyncMine().pushed).toBe(0);
  });

  it('期限と補足も送る', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('期限あり', 'くわしく', []);
    ctx.issueUpdate(issue.number, {
      assignee: 'tester@example.com', dueDate: '2026-09-30',
    });

    ctx.tasksSyncMine();

    const task = [...fake.Tasks._items.values()][0];
    expect(task.notes).toBe('くわしく');
    expect(task.due).toContain('2026-09-30');
  });

  it('二度同期しても増えない', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('ひとつ', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });

    ctx.tasksSyncMine();
    ctx.tasksSyncMine();

    expect(fake.Tasks._items.size).toBe(1);
  });

  it('題名を直すと ToDo 側も直る', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('まえの題', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });
    ctx.tasksSyncMine();

    ctx.issueUpdate(issue.number, { title: 'あとの題' });
    ctx.tasksSyncMine();

    expect([...fake.Tasks._items.values()][0].title)
      .toBe('#' + issue.number + ' あとの題');
  });

  it('ToDo 側で終わりにするとこちらも完了になる', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('向こうで終える', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });
    ctx.tasksSyncMine();

    const task = [...fake.Tasks._items.values()][0];
    fake.Tasks.Tasks.patch({ status: 'completed' }, 'L1', task.id);

    expect(ctx.tasksSyncMine().closed).toBe(1);
    expect(ctx.issueGet(issue.number).state).toBe('closed');
  });

  it('終わっているものを今さら足さない', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('もう終わり', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });
    ctx.issueClose(issue.number, null);

    ctx.tasksSyncMine();

    expect(fake.Tasks._items.size).toBe(0);
  });

  it('ToDo 側で消されたら結び付きを忘れる', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('消される', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });
    ctx.tasksSyncMine();

    fake.Tasks._items.clear();
    ctx.tasksSyncMine();

    expect(ctx.dbReadAll('task_links')).toEqual([]);
  });

  it('捨てたやることは送らない', () => {
    const { ctx, fake } = ready();
    const issue = ctx.issueCreate('捨てる', '', []);
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });
    ctx.issueArchive(issue.number);

    ctx.tasksSyncMine();

    expect(fake.Tasks._items.size).toBe(0);
  });
});
