import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs', 'src/core/Repo.gs',
  'src/core/ObjectStore.gs', 'src/core/Normalize.js', 'src/core/Markdown.js',
  'src/core/Graph.js', 'src/core/Diff.js', 'src/core/Merge.js', 'src/core/Commit.gs',
  'src/core/Branch.gs', 'src/render/HtmlWriter.gs', 'src/core/PullRequest.gs',
  'src/core/PullPatch.gs', 'src/core/Outbox.gs', 'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Template.gs', 'src/core/Member.gs',
  'src/core/Usage.gs', 'src/core/Issue.gs', 'src/core/IssueComment.gs',
  'src/core/Project.gs', 'src/core/Mention.js', 'src/core/Inquiry.gs', 'src/core/Brand.js',
  'src/core/Notifier.gs', 'src/core/Tally.js', 'src/core/Plain.js',
  'src/core/Settings.gs', 'src/core/Scrum.gs', 'src/core/ScrumView.js',
  'src/core/CommandQueue.gs', 'src/Main.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

/** google.script.run が運べない値 (Date・関数) を探す */
function unserializable(value, path) {
  if (value === null || value === undefined) return [];
  if (Object.prototype.toString.call(value) === '[object Date]') return [path + ' が Date のまま'];
  if (Array.isArray(value)) return value.flatMap((v, i) => unserializable(v, path + '[' + i + ']'));
  if (typeof value === 'object') {
    return Object.keys(value).flatMap((k) => unserializable(value[k], path + '.' + k));
  }
  if (typeof value === 'function') return [path + ' が関数'];
  return [];
}

describe('設定の入口', () => {
  it('既定はオフで、持ち主には切り替えられると伝える', () => {
    const { ctx } = setup();
    expect(ctx.apiSettings()).toMatchObject({ scrumEnabled: false, canEdit: true });
  });

  it('持ち主だけが切り替えられる', () => {
    const { ctx, fake } = setup();
    fake._setUser('someone@example.com');
    expect(ctx.apiSettings().canEdit).toBe(false);
    expect(() => ctx.apiSetScrumEnabled(true)).toThrow(/持ち主だけ/);

    fake._setUser('tester@example.com');
    expect(ctx.apiSetScrumEnabled(true).scrumEnabled).toBe(true);
  });

  it('プロダクトゴールと完了の定義を、持ち主が書ける', () => {
    const { ctx, fake } = setup();
    ctx.apiSetScrumEnabled(true);
    ctx.apiSetScrumText('productGoal', '紙の稟議をなくす');
    expect(ctx.apiSettings().productGoal).toBe('紙の稟議をなくす');

    fake._setUser('someone@example.com');
    expect(() => ctx.apiSetScrumText('productGoal', 'x')).toThrow(/持ち主だけ/);
  });
});

describe('スクラムの入口', () => {
  function prepared() {
    const env = setup();
    const { ctx } = env;
    ctx.apiSetScrumEnabled(true);
    ctx.apiSprintCreate({ name: 'sprint001', goal: '申請', startDate: '2026-10-01', endDate: '2026-10-14' });
    const issue = ctx.apiIssueCreate('申請画面', '', [], '', {});
    ctx.apiIssueUpdate(issue.number, { sprint: 'sprint001', points: 3, acceptance: '申請できる' });
    const imp = ctx.apiImpedimentCreate({ title: '承認者が不在' });
    ctx.apiImpedimentComment(imp.number, '来週戻る');
    env.issue = issue;
    env.imp = imp;
    return env;
  }

  const CASES = [
    ['apiSettings', (ctx) => ctx.apiSettings()],
    ['apiSprintList', (ctx) => ctx.apiSprintList()],
    ['apiScrumView', (ctx) => ctx.apiScrumView('sprint001')],
    ['apiImpedimentList', (ctx) => ctx.apiImpedimentList()],
    ['apiImpedimentComments', (ctx, env) => ctx.apiImpedimentComments(env.imp.number)],
    ['apiHistory', (ctx, env) => ctx.apiHistory('issue:' + env.issue.number)],
    ['apiImpedimentResolve', (ctx, env) => ctx.apiImpedimentResolve(env.imp.number, '代理が承認')],
    ['apiImpedimentReopen', (ctx, env) => {
      ctx.apiImpedimentResolve(env.imp.number, '代理が承認');
      return ctx.apiImpedimentReopen(env.imp.number);
    }],
    ['apiIssueList', (ctx) => ctx.apiIssueList('')],
  ];

  CASES.forEach(([name, call]) => {
    it(name + ' は画面に渡せる形', () => {
      const env = prepared();
      expect(unserializable(call(env.ctx, env), name)).toEqual([]);
    });
  });

  it('やることにスクラムの欄が載る', () => {
    const { ctx, issue } = prepared();
    const row = ctx.apiIssueList('').find((i) => i.number === issue.number);
    expect(row).toMatchObject({ sprint: 'sprint001', points: 3, acceptance: '申請できる' });
  });

  it('見え方に要約・ベロシティ・バーンダウン・ロードマップが入る', () => {
    const { ctx } = prepared();
    const v = ctx.apiScrumView('sprint001');
    expect(v.velocity[0]).toMatchObject({ name: 'sprint001', planned: 3 });
    expect(v.burndown.days[0]).toBe('2026-10-01');
    expect(v.roadmap.sprints).toEqual(['sprint001']);
    expect(v.sprint).toBe('sprint001');
    expect(typeof v.summary.openImpediments).toBe('number');
  });

  it('障害物の一覧に、やりとりの数が載る', () => {
    const { ctx, imp } = prepared();
    expect(ctx.apiImpedimentList().find((i) => i.number === imp.number).commentCount).toBe(1);
  });

  it('オフにすると、スクラムの入口は断る', () => {
    const { ctx } = prepared();
    ctx.apiSetScrumEnabled(false);
    expect(() => ctx.apiSprintList()).toThrow(/オフ/);
    expect(() => ctx.apiImpedimentList()).toThrow(/オフ/);
    expect(() => ctx.apiScrumView('')).toThrow(/オフ/);
  });
});

describe('手元の道具から使う命令', () => {
  /*
   * エージェンティックスクラムでは、手元の Claude Code がスクラムチームとして
   * 動く。ai-scrum-gas では scrum/ の CSV を直に読み書きしていたが、この道具では
   * コマンドキューの命令で台帳を触る。
   */
  it('状態を見る命令は、オフでも使える (オンにするよう案内するため)', () => {
    const { ctx } = setup();
    expect(ctx.runCommand_({ op: 'scrumState', args: {} })).toMatchObject({ scrumEnabled: false });
  });

  it('スプリントと障害物を命令で扱える', () => {
    const { ctx } = setup();
    ctx.apiSetScrumEnabled(true);
    ctx.runCommand_({ op: 'sprintCreate', args: { fields: { name: 'sprint001' } } });
    ctx.runCommand_({ op: 'impedimentCreate', args: { fields: { title: '詰まり' } } });
    ctx.runCommand_({ op: 'impedimentResolve', args: { number: 1, resolution: '片付いた' } });

    expect(ctx.runCommand_({ op: 'sprintList', args: {} }).map((s) => s.name)).toEqual(['sprint001']);
    expect(ctx.runCommand_({ op: 'impedimentList', args: {} })[0].state).toBe('resolved');
    expect(ctx.runCommand_({ op: 'scrumView', args: { sprint: 'sprint001' } }).sprint).toBe('sprint001');
  });

  it('進捗ボードの列を命令で動かせる (PBI のステータスに当たる)', () => {
    const { ctx } = setup();
    ctx.apiSetScrumEnabled(true);
    const made = ctx.apiIssueCreate('申請画面', '', [], '', {});
    ctx.runCommand_({ op: 'boardMove', args: { number: made.number, column: 'In Progress' } });

    expect(ctx.apiProjectBoard()['In Progress'].map((c) => c.issueNumber)).toEqual([made.number]);
    expect(() => ctx.runCommand_({ op: 'boardMove', args: { number: made.number, column: 'Ready' } }))
      .toThrow(/列/);
  });

  it('切り替える命令は無い (人が画面で決める)', () => {
    const { ctx } = setup();
    expect(() => ctx.runCommand_({ op: 'scrumSetEnabled', args: { on: true } })).toThrow(/実行できない/);
  });
});
