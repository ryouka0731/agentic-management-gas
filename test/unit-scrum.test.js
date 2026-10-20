import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { CORE_SOURCES } from './sources.js';

/*
 * Scrum.gs の並べ方・直し方・断り方の枝。通しの流れは test/scrum.test.js にある。
 * 並び順のテストは、作る順を期待する並びの逆にする (偶然一致しないように)。
 *
 * scrum.test.js の setup を import すると、あちらのテストまでこのファイルで走るので写さずに組む。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...CORE_SOURCES);
  ctx.repoInit('agentic-management');
  ctx.scrumSetEnabled_(true);
  return { ctx, fake };
}

describe('sprintList の並び', () => {
  it('始まりの早い順、始まりの無いものは後ろに名前順', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'z-未定' });
    ctx.sprintCreate({ name: 'a-未定' });
    ctx.sprintCreate({ name: '後', startDate: '2026-03-01' });
    ctx.sprintCreate({ name: '先', startDate: '2026-01-01' });
    expect(ctx.sprintList().map((s) => s.name)).toEqual(['先', '後', 'a-未定', 'z-未定']);
  });
});

describe('sprintUpdate', () => {
  it('備考を直せ、片方の日だけ直しても、残った日と見比べて期間を確かめる', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 's1', startDate: '2026-01-10', endDate: '2026-01-20' });
    expect(ctx.sprintUpdate('s1', { notes: 'メモ' }).notes).toBe('メモ');
    expect(ctx.sprintUpdate('s1', { notes: null }).notes).toBe('');
    // 始まりだけを終わりより後へ
    expect(() => ctx.sprintUpdate('s1', { startDate: '2026-01-25' })).toThrow(/終わりの日が始まりの日より前/);
    // 終わりだけを始まりより前へ
    expect(() => ctx.sprintUpdate('s1', { endDate: '2026-01-05' })).toThrow(/終わりの日が始まりの日より前/);
  });

  it('無い作業期間・名前の無い作業期間は断る', () => {
    const { ctx } = setup();
    expect(() => ctx.sprintUpdate('無い', {})).toThrow(/作業期間が見つかりません/);
    expect(() => ctx.sprintCreate(null)).toThrow(/作業期間の名前を入れてください/);
    expect(() => ctx.sprintGet(null)).toThrow(/作業期間が見つかりません/);
  });
});

describe('困りごと', () => {
  it('未解決が先、同じなら新しいものから', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: '一' });
    const b = ctx.impedimentCreate({ title: '二' });
    const c = ctx.impedimentCreate({ title: '三' });
    ctx.impedimentResolve(c.number, '片付けた');
    expect(ctx.impedimentList().map((r) => r.number)).toEqual([b.number, a.number, c.number]);
  });

  it('無い番号は断る', () => {
    const { ctx } = setup();
    expect(() => ctx.impedimentGet(99)).toThrow(/困りごとが見つかりません: #99/);
  });

  it('報告者と作業期間を直せ、無い作業期間は断り、空にすると外れる', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 's1' });
    const r = ctx.impedimentCreate({ title: '一' });
    expect(ctx.impedimentUpdate(r.number, { reportedBy: 'kato@example.com', sprint: 's1' }))
      .toMatchObject({ reportedBy: 'kato@example.com', sprint: 's1' });
    expect(() => ctx.impedimentUpdate(r.number, { sprint: '無い' })).toThrow(/作業期間が見つかりません/);
    expect(ctx.impedimentUpdate(r.number, { sprint: null, reportedBy: null }))
      .toMatchObject({ reportedBy: '', sprint: '' });
  });

  it('解決済みをもう一度解決すると断り、未解決を開き直しても何も変えない', () => {
    const { ctx } = setup();
    const r = ctx.impedimentCreate({ title: '一' });
    const same = ctx.impedimentReopen(r.number);
    expect(same.state).toBe('open');
    ctx.impedimentResolve(r.number, 'やった');
    expect(() => ctx.impedimentResolve(r.number, 'また')).toThrow(/既に解決しています/);
    expect(ctx.impedimentReopen(r.number).state).toBe('open');
  });

  it('やりとりは空と4000字を超えるものを断る', () => {
    const { ctx } = setup();
    const r = ctx.impedimentCreate({ title: '一' });
    expect(() => ctx.impedimentCommentAdd(r.number, '   ')).toThrow(/内容を入力してください/);
    expect(() => ctx.impedimentCommentAdd(r.number, 'あ'.repeat(4001))).toThrow(/4000文字まで/);
    expect(ctx.impedimentCommentAdd(r.number, 'あ'.repeat(4000)).body).toHaveLength(4000);
  });

  it('題名は200字まで', () => {
    const { ctx } = setup();
    expect(() => ctx.impedimentCreate({ title: 'あ'.repeat(201) })).toThrow(/200字まで/);
    expect(ctx.impedimentCreate({ title: 'あ'.repeat(200) }).title).toHaveLength(200);
  });
});

describe('履歴に残す字', () => {
  it('空・日時・読めない日時・長い字', () => {
    const { ctx } = setup();
    expect(ctx.historyText_(null)).toBe('');
    expect(ctx.historyText_(undefined)).toBe('');
    expect(ctx.historyText_(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(ctx.historyText_(new Date('x'))).toBe('');
    const long = ctx.historyText_('😀'.repeat(4001));
    // コードポイントで数えるので、絵文字を半分に割らない
    expect(long.startsWith('😀'.repeat(4000) + '…')).toBe(true);
    expect(long).toMatch(/全 4001 字/);
  });

  it('historyDiff_ は継いだ欄と updatedAt を数えず、同じ日の日付は変わったと見ない', () => {
    const { ctx } = setup();
    const patch = Object.create({ inherited: 'x' });
    patch.title = '新';
    patch.updatedAt = new Date();
    patch.dueDate = '2026-01-02';
    const before = { title: '旧', dueDate: new Date(2026, 0, 2) };
    expect(ctx.historyDiff_(before, patch)).toEqual([{ field: 'title', before: '旧', after: '新' }]);
  });
});
