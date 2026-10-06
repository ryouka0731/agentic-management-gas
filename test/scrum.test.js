import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

export const SCRUM_SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/Plain.js', 'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Issue.gs',
  'src/core/IssueComment.gs', 'src/core/Project.gs', 'src/core/Mention.js',
  'src/core/Member.gs', 'src/core/Brand.js', 'src/core/Inquiry.gs',
  'src/core/Notifier.gs', 'src/core/Settings.gs', 'src/core/Scrum.gs',
];

/*
 * エージェンティックスクラム (ai-scrum-gas から取り入れたもの)。
 *
 * 使わない人のほうが多いので、既定はオフにしてある。オンにできるのは持ち主
 * だけで、オフのあいだはスクラムの操作をすべて断る。
 */
export function setup(on) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SCRUM_SOURCES);
  ctx.repoInit('agentic-management');
  if (on !== false) ctx.scrumSetEnabled(true);
  return { ctx, fake };
}

describe('既定はオフ', () => {
  it('何もしなければオフ', () => {
    const { ctx } = setup(false);
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('オフのあいだは、スクラムの操作を断る', () => {
    const { ctx } = setup(false);
    expect(() => ctx.sprintCreate({ name: 'sprint001' })).toThrow(/オフ/);
    expect(() => ctx.impedimentCreate({ title: 'x' })).toThrow(/オフ/);
    expect(() => ctx.sprintList()).toThrow(/オフ/);
  });

  it('オンにすると使え、オフに戻せる', () => {
    const { ctx } = setup(false);
    ctx.scrumSetEnabled(true);
    expect(ctx.scrumEnabled()).toBe(true);
    expect(ctx.sprintList()).toEqual([]);

    ctx.scrumSetEnabled(false);
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('オフに戻しても、書いたものは消さない', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    ctx.scrumSetEnabled(false);
    ctx.scrumSetEnabled(true);
    expect(ctx.sprintList().map((s) => s.name)).toEqual(['sprint001']);
  });
});

describe('プロダクトゴールと完了の定義', () => {
  it('書いて読める', () => {
    const { ctx } = setup();
    ctx.scrumSetText('productGoal', '紙の稟議をなくす');
    ctx.scrumSetText('definitionOfDone', '- 受入基準を満たす\n- レビュー済み');

    expect(ctx.scrumTexts()).toEqual({
      productGoal: '紙の稟議をなくす',
      definitionOfDone: '- 受入基準を満たす\n- レビュー済み',
    });
  });

  it('知らない種類と長すぎるものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.scrumSetText('other', 'x')).toThrow(/知らない/);
    expect(() => ctx.scrumSetText('productGoal', 'あ'.repeat(5001))).toThrow(/5000/);
  });
});

describe('スプリント', () => {
  it('作って、開始日の順に並ぶ', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint002', startDate: '2026-10-15', endDate: '2026-10-28' });
    ctx.sprintCreate({ name: 'sprint001', goal: '申請の流れを決める',
      startDate: '2026-10-01', endDate: '2026-10-14' });

    expect(ctx.sprintList().map((s) => s.name)).toEqual(['sprint001', 'sprint002']);
    expect(ctx.sprintGet('sprint001').goal).toBe('申請の流れを決める');
  });

  it('同じ名前、空の名前、終わりが始まりより前のものは断る', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    expect(() => ctx.sprintCreate({ name: 'sprint001' })).toThrow(/既に/);
    expect(() => ctx.sprintCreate({ name: '  ' })).toThrow(/名前/);
    expect(() => ctx.sprintCreate({ name: 's2', startDate: '2026-10-10', endDate: '2026-10-01' }))
      .toThrow(/終わり/);
  });

  it('ゴールや期間を直せる', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    ctx.sprintUpdate('sprint001', { goal: '承認の流れを作る', endDate: '2026-10-14' });

    expect(ctx.sprintGet('sprint001').goal).toBe('承認の流れを作る');
  });
});

describe('やることを PBI として扱う', () => {
  it('スプリント・ポイント・受入基準を入れられる', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    const made = ctx.issueCreate('申請画面を作る', '', []);

    ctx.issueUpdate(made.number, { sprint: 'sprint001', points: 3, acceptance: '申請できる' });

    const row = ctx.issueGet(made.number);
    expect(row.sprint).toBe('sprint001');
    expect(Number(row.points)).toBe(3);
    expect(row.acceptance).toBe('申請できる');
  });

  it('無いスプリントと、数でないポイントは断る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('x', '', []);

    expect(() => ctx.issueUpdate(made.number, { sprint: 'nai' })).toThrow(/スプリント/);
    expect(() => ctx.issueUpdate(made.number, { points: -1 })).toThrow(/ポイント/);
    expect(() => ctx.issueUpdate(made.number, { points: 'たくさん' })).toThrow(/ポイント/);
  });

  it('オフのあいだは、スクラムの欄を直させない', () => {
    const { ctx } = setup(false);
    const made = ctx.issueCreate('x', '', []);
    expect(() => ctx.issueUpdate(made.number, { points: 3 })).toThrow(/オフ/);
    // ほかの欄はこれまでどおり直せる
    expect(ctx.issueUpdate(made.number, { title: 'y' }).title).toBe('y');
  });
});

describe('障害物', () => {
  it('記録すると番号が付き、未解決として並ぶ', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: '承認者が決まらない', body: '部長が不在' });

    expect(a.number).toBe(1);
    expect(a.state).toBe('open');
    expect(a.reportedBy).toBe('tester@example.com');
    expect(ctx.impedimentList().map((i) => i.number)).toEqual([1]);
  });

  it('題名が無いものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.impedimentCreate({ title: '' })).toThrow(/題名/);
  });

  it('直せる', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    ctx.impedimentUpdate(a.number, { title: '承認者が決まらない', body: '詳しく' });

    expect(ctx.impedimentGet(a.number).title).toBe('承認者が決まらない');
  });

  it('解決策を書いて解決し、取り消せる', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });

    expect(() => ctx.impedimentResolve(a.number, '')).toThrow(/解決策/);
    ctx.impedimentResolve(a.number, '課長が代わりに承認する');
    expect(ctx.impedimentGet(a.number).state).toBe('resolved');
    expect(ctx.impedimentGet(a.number).resolution).toBe('課長が代わりに承認する');

    ctx.impedimentReopen(a.number);
    expect(ctx.impedimentGet(a.number).state).toBe('open');
  });

  it('やりとりを書ける', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    ctx.impedimentCommentAdd(a.number, '来週には戻ります');

    expect(ctx.impedimentComments(a.number).map((c) => c.body)).toEqual(['来週には戻ります']);
  });
});

describe('変更の履歴', () => {
  /*
   * ai-scrum-gas では、画面からの変更を change_log に残し、項目ごとに前と後を
   * 見せていた。誰がいつ何を変えたかが分からないと、変わった理由を辿れない。
   */
  it('やることの欄を直すと、前と後が残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('はじめの題', '', []);
    ctx.issueUpdate(made.number, { title: '直した題', points: 5 });

    const log = ctx.historyOf('issue:' + made.number);
    const title = log.find((h) => h.field === 'title');
    expect(title.before).toBe('はじめの題');
    expect(title.after).toBe('直した題');
    expect(title.actor).toBe('tester@example.com');
    expect(log.find((h) => h.field === 'points').after).toBe('5');
  });

  it('変わらなかった欄は残さない', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    ctx.issueUpdate(made.number, { title: '題' });

    expect(ctx.historyOf('issue:' + made.number).filter((h) => h.field === 'title')).toEqual([]);
  });

  it('完了・差し戻し・作成も残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    ctx.issueClose(made.number, null);
    ctx.issueReopen(made.number);

    const actions = ctx.historyOf('issue:' + made.number).map((h) => h.action);
    expect(actions).toContain('create');
    expect(actions).toContain('close');
    expect(actions).toContain('reopen');
  });

  it('障害物の解決も残る', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    ctx.impedimentResolve(a.number, '片付いた');

    expect(ctx.historyOf('impediment:' + a.number).map((h) => h.action)).toContain('resolve');
  });

  it('新しい順に並ぶ', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('a', '', []);
    ctx.issueUpdate(made.number, { title: 'b' });
    ctx.issueUpdate(made.number, { title: 'c' });

    const titles = ctx.historyOf('issue:' + made.number)
      .filter((h) => h.field === 'title').map((h) => h.after);
    expect(titles).toEqual(['c', 'b']);
  });
});
