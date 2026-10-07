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
    ['apiProjectBoard', (ctx) => ctx.apiProjectBoard()],
    // 作る・直す・書く側も見る。返す形を間違えても操作は成功するので気づかれない
    ['apiSetScrumEnabled', (ctx) => ctx.apiSetScrumEnabled(true)],
    ['apiSetScrumText', (ctx) => ctx.apiSetScrumText('productGoal', '紙をなくす')],
    ['apiSprintCreate', (ctx) => ctx.apiSprintCreate({ name: 'sprint002', startDate: '2026-10-15', endDate: '2026-10-28' })],
    ['apiSprintUpdate', (ctx) => ctx.apiSprintUpdate('sprint001', { goal: '申請と承認', endDate: '2026-10-15' })],
    ['apiImpedimentCreate', (ctx) => ctx.apiImpedimentCreate({ title: '名簿が古い', sprint: 'sprint001' })],
    ['apiImpedimentUpdate', (ctx, env) => ctx.apiImpedimentUpdate(env.imp.number, { body: '詳しく' })],
    ['apiImpedimentComment', (ctx, env) => ctx.apiImpedimentComment(env.imp.number, '頼みました')],
    ['apiHistory (sprint)', (ctx) => ctx.apiHistory('sprint:sprint001')],
  ];

  // 書く側は、画面が読む欄が入っているかも見る。{} を返しても Date が無いので
  // 上の検査は通ってしまう
  const SHAPES = {
    apiSetScrumEnabled: { scrumEnabled: true },
    apiSetScrumText: { productGoal: '紙をなくす' },
    apiSprintCreate: { name: 'sprint002', startDate: '2026-10-15', endDate: '2026-10-28' },
    apiSprintUpdate: { name: 'sprint001', goal: '申請と承認', endDate: '2026-10-15' },
    apiImpedimentCreate: { title: '名簿が古い', sprint: 'sprint001', state: 'open' },
    apiImpedimentUpdate: { body: '詳しく', state: 'open' },
    apiImpedimentComment: { body: '頼みました' },
    apiImpedimentResolve: { state: 'resolved', resolution: '代理が承認' },
    apiImpedimentReopen: { state: 'open' },
    // ボードのカードにもスプリントとポイントを渡す (一覧で積んだ量を見比べる)
    apiProjectBoard: { Backlog: [{ sprint: 'sprint001', points: 3 }] },
  };

  CASES.forEach(([name, call]) => {
    it(name + ' は画面に渡せる形', () => {
      const env = prepared();
      const value = call(env.ctx, env);
      expect(unserializable(value, name)).toEqual([]);
      if (SHAPES[name]) expect(value).toMatchObject(SHAPES[name]);
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

describe('変更の履歴の差分', () => {
  it('複数行の値には行ごとの差分を添え、1行の値には添えない', () => {
    const { ctx } = setup();
    const made = ctx.apiIssueCreate('題', '一行目\n二行目', [], '', {});
    ctx.apiIssueUpdate(made.number, { title: '題2', body: '一行目\n直した二行目\n三行目' });

    const rows = ctx.apiHistory('issue:' + made.number);
    expect(rows.find((r) => r.field === 'title').lines).toBeNull();
    expect(rows.find((r) => r.field === 'body').lines).toEqual([
      { op: 'same', text: '一行目' },
      { op: 'del', text: '二行目' },
      { op: 'add', text: '直した二行目' },
      { op: 'add', text: '三行目' },
    ]);
  });
});

describe('持ち越し', () => {
  it('終わらなかったやることを次へ移しても、前のスプリントの持ち越しに残る', () => {
    const { ctx } = setup();
    ctx.apiSetScrumEnabled(true);
    const day = (o) => new Date(Date.now() + 9 * 3600e3 + o * 864e5).toISOString().substring(0, 10);
    ctx.apiSprintCreate({ name: 's1', goal: 'g', startDate: day(-20), endDate: day(-7) });
    ctx.apiSprintCreate({ name: 's2', goal: 'g', startDate: day(-6), endDate: day(7) });
    const a = ctx.apiIssueCreate('終えた', '', [], '', { sprint: 's1', points: 5 });
    const b = ctx.apiIssueCreate('終わらなかった', '', [], '', { sprint: 's1', points: 3 });
    ctx.apiIssueClose(a.number);
    ctx.dbUpdate('issues', 'number', a.number, { closedAt: new Date(Date.now() - 10 * 864e5) });
    // 変更の履歴は「いま」で残るので、作った時点を期間の前へずらす
    ctx.dbReadAll('change_log').forEach((row) => {
      if (row.field === 'sprint') ctx.dbUpdate('change_log', 'id', row.id, { at: new Date(Date.now() - 21 * 864e5) });
    });

    ctx.apiIssueUpdate(b.number, { sprint: 's2' });
    const vel = ctx.apiScrumView('s1').velocity;
    expect(vel.find((x) => x.name === 's1')).toMatchObject({ planned: 8, completed: 5, carriedOver: 3 });
    expect(vel.find((x) => x.name === 's2')).toMatchObject({ planned: 3 });
  });
});

describe('実機確認の入口 (debugVerifyScrum)', () => {
  const TABLES = ['issues', 'project_items', 'sprints', 'impediments', 'impediment_comments', 'change_log'];

  function counts(ctx) {
    return Object.fromEntries(TABLES.map((t) => [t, ctx.dbReadAll(t).length]));
  }

  it('通しで PASS し、作ったものを残さず、オフに戻す', () => {
    const { ctx } = setup();
    const before = counts(ctx);

    expect(ctx.debugVerifyScrum()).toMatch(/すべて PASS/);
    expect(counts(ctx)).toEqual(before);
    // 使っていないチームの設定を、確かめただけで変えない
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('もともとオンなら、オンのまま残す', () => {
    const { ctx } = setup();
    ctx.apiSetScrumEnabled(true);

    expect(ctx.debugVerifyScrum()).toMatch(/すべて PASS/);
    expect(ctx.scrumEnabled()).toBe(true);
  });

  it('片付けに失敗したら PASS と言わない', () => {
    const { ctx } = setup();
    ctx.issuePurge = () => { throw new Error('表に書けない'); };

    // 検証物が残っているのに「すべて PASS」と出ると、残ったことに誰も気づかない
    expect(ctx.debugVerifyScrum()).toMatch(/FAIL/);
  });

  it('台帳が読めなくても、オン・オフは戻す', () => {
    const { ctx } = setup();
    const original = ctx.dbReadAll;
    ctx.dbReadAll = (table) => {
      if (table === 'impediments') throw new Error('読めない');
      return original(table);
    };

    expect(ctx.debugVerifyScrum()).toMatch(/FAIL/);
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('作った直後に落ちても、作ったものを残さない', () => {
    const { ctx } = setup();
    const before = counts(ctx);
    const original = ctx.apiIssueCreate;
    // 台帳には書けたが、番号が呼び出し元に返る前に落ちた形
    ctx.apiIssueCreate = (...args) => { original(...args); throw new Error('知らせで落ちた'); };

    expect(ctx.debugVerifyScrum()).toMatch(/FAIL/);
    expect(counts(ctx)).toEqual(before);
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('持ち主以外には動かない', () => {
    const { ctx, fake } = setup();
    fake._setUser('someone@example.com');

    expect(() => ctx.debugVerifyScrum()).toThrow(/持ち主だけ/);
  });
});
