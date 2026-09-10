import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/Tally.js');
const { tallyPeriodOf, tallyDateOf, tallyEffort } = gas;

/**
 * @param {object} over
 * @returns {object} issues 行 (画面に渡せる形)
 */
function issue(over) {
  return Object.assign({
    number: 1, title: 'x', state: 'open', assignee: 'aoki@example.com',
    plannedHours: 0, actualHours: 0, dueDate: '', closedAt: '', startDate: '',
    archivedAt: '',
  }, over);
}

describe('区切り', () => {
  it('月で切る', () => {
    expect(tallyPeriodOf(new Date(2026, 8, 15), 'month'))
      .toEqual({ key: '2026-09', label: '2026年9月' });
  });

  it('四半期は年度で切る', () => {
    // 4月始まりなので 4-6月 が第1四半期
    expect(tallyPeriodOf(new Date(2026, 3, 1), 'quarter'))
      .toEqual({ key: '2026-Q1', label: '2026年度 第1四半期' });
    expect(tallyPeriodOf(new Date(2026, 8, 15), 'quarter').key).toBe('2026-Q2');
    expect(tallyPeriodOf(new Date(2026, 11, 31), 'quarter').key).toBe('2026-Q3');
    // 1〜3月は前の年度の第4四半期
    expect(tallyPeriodOf(new Date(2027, 0, 1), 'quarter').key).toBe('2026-Q4');
  });

  it('半期で切る', () => {
    expect(tallyPeriodOf(new Date(2026, 3, 1), 'half'))
      .toEqual({ key: '2026-H1', label: '2026年度 上期' });
    expect(tallyPeriodOf(new Date(2026, 8, 30), 'half').key).toBe('2026-H1');
    expect(tallyPeriodOf(new Date(2026, 9, 1), 'half'))
      .toEqual({ key: '2026-H2', label: '2026年度 下期' });
    // 年をまたいでも同じ年度の下期
    expect(tallyPeriodOf(new Date(2027, 2, 31), 'half').key).toBe('2026-H2');
  });

  it('年度で切る', () => {
    expect(tallyPeriodOf(new Date(2026, 3, 1), 'year'))
      .toEqual({ key: '2026', label: '2026年度' });
    expect(tallyPeriodOf(new Date(2027, 2, 31), 'year').key).toBe('2026');
    expect(tallyPeriodOf(new Date(2027, 3, 1), 'year').key).toBe('2027');
  });

  it('半期も年度も並べ替えずに時の順になる', () => {
    const keys = [
      tallyPeriodOf(new Date(2027, 4, 1), 'half').key,
      tallyPeriodOf(new Date(2026, 10, 1), 'half').key,
      tallyPeriodOf(new Date(2026, 4, 1), 'half').key,
    ];
    expect(keys.slice().sort()).toEqual(['2026-H1', '2026-H2', '2027-H1']);
  });

  it('週は月曜から始める', () => {
    // 2026-09-10 は木曜。その週の月曜は 09-07
    expect(tallyPeriodOf(new Date(2026, 8, 10), 'week').key).toBe('2026-09-07');
    // 日曜は前の週に入れる。週末が2つの週に割れると読みにくい
    expect(tallyPeriodOf(new Date(2026, 8, 13), 'week').key).toBe('2026-09-07');
    expect(tallyPeriodOf(new Date(2026, 8, 14), 'week').key).toBe('2026-09-14');
  });

  it('月をまたぐ週も繋がったまま', () => {
    expect(tallyPeriodOf(new Date(2026, 9, 1), 'week').key).toBe('2026-09-28');
  });

  it('並べ替えずに時の順になる', () => {
    const keys = [
      tallyPeriodOf(new Date(2026, 11, 1), 'month').key,
      tallyPeriodOf(new Date(2026, 0, 1), 'month').key,
      tallyPeriodOf(new Date(2025, 5, 1), 'month').key,
    ];
    expect(keys.slice().sort()).toEqual(['2025-06', '2026-01', '2026-12']);
  });
});

describe('数える日', () => {
  it('既定は期限', () => {
    expect(tallyDateOf(issue({ dueDate: '2026-09-30' }), 'due').getDate()).toBe(30);
  });

  it('完了日でも数えられる', () => {
    const row = issue({ dueDate: '2026-09-30', closedAt: '2026-10-05' });
    expect(tallyDateOf(row, 'closed').getMonth()).toBe(9);
  });

  it('開始日でも数えられる', () => {
    const row = issue({ startDate: '2026-08-01' });
    expect(tallyDateOf(row, 'start').getMonth()).toBe(7);
  });

  it('選んだ基準が空なら日が無い', () => {
    // 無い日を作って数えると、どの区切りに入れても嘘になる
    expect(tallyDateOf(issue({ dueDate: '2026-09-30' }), 'closed')).toBe(null);
  });
});

describe('足し上げ', () => {
  it('区切りごとに足す', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-09-10', plannedHours: 3, actualHours: 4 }),
      issue({ dueDate: '2026-09-20', plannedHours: 2, actualHours: 1 }),
      issue({ dueDate: '2026-10-01', plannedHours: 5, actualHours: 5 }),
    ], { unit: 'month' });

    expect(res.periods.map((p) => p.key)).toEqual(['2026-09', '2026-10']);
    expect(res.periods[0].sum).toEqual({ planned: 5, actual: 5, diff: 0, count: 2 });
    expect(res.periods[1].sum.planned).toBe(5);
  });

  it('差は実績から予定を引く', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-09-10', plannedHours: 3, actualHours: 5 }),
    ], { unit: 'month' });

    expect(res.periods[0].sum.diff).toBe(2);
  });

  it('累計は古いほうから積む', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-09-10', plannedHours: 3, actualHours: 4 }),
      issue({ dueDate: '2026-10-01', plannedHours: 5, actualHours: 5 }),
      issue({ dueDate: '2026-11-01', plannedHours: 2, actualHours: 0 }),
    ], { unit: 'month' });

    expect(res.periods.map((p) => p.cumulative.planned)).toEqual([3, 8, 10]);
    expect(res.periods.map((p) => p.cumulative.actual)).toEqual([4, 9, 9]);
  });

  it('人ごとにも足す', () => {
    const res = tallyEffort([
      issue({ assignee: 'aoki@example.com', dueDate: '2026-09-10', plannedHours: 3 }),
      issue({ assignee: 'ito@example.com', dueDate: '2026-09-11', plannedHours: 2 }),
      issue({ assignee: 'aoki@example.com', dueDate: '2026-10-01', plannedHours: 1 }),
    ], { unit: 'month' });

    expect(res.people.map((p) => p.who))
      .toEqual(['aoki@example.com', 'ito@example.com']);
    expect(res.people[0].total.planned).toBe(4);
    expect(res.periods[0].byPerson['ito@example.com'].planned).toBe(2);
  });

  it('その人のぶんだけに絞れる', () => {
    const res = tallyEffort([
      issue({ assignee: 'aoki@example.com', dueDate: '2026-09-10', plannedHours: 3 }),
      issue({ assignee: 'ito@example.com', dueDate: '2026-09-11', plannedHours: 2 }),
    ], { unit: 'month', who: 'aoki@example.com' });

    expect(res.total.planned).toBe(3);
    expect(res.people).toHaveLength(1);
  });

  it('担当が付いていないものもまとめる', () => {
    const res = tallyEffort([
      issue({ assignee: '', dueDate: '2026-09-10', plannedHours: 3 }),
    ], { unit: 'month' });

    expect(res.people[0].who).toBe('(担当なし)');
  });

  it('工数が空のものは数えない', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-09-10' }),
      issue({ dueDate: '2026-09-10', plannedHours: 1 }),
    ], { unit: 'month' });

    expect(res.total.count).toBe(1);
  });

  it('捨てたものは数えない', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-09-10', plannedHours: 3, archivedAt: '2026-09-01' }),
    ], { unit: 'month' });

    expect(res.total.count).toBe(0);
  });

  it('数える日が無いものは別に数える', () => {
    const res = tallyEffort([
      issue({ plannedHours: 3 }),
      issue({ dueDate: '2026-09-10', plannedHours: 1 }),
    ], { unit: 'month' });

    // 黙って落とすと、合計が合わない理由が分からない
    expect(res.skipped).toBe(1);
    expect(res.total.planned).toBe(1);
  });

  it('半日きざみでも端数が出ない', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-09-10', plannedHours: 0.1 }),
      issue({ dueDate: '2026-09-11', plannedHours: 0.2 }),
    ], { unit: 'month' });

    expect(res.total.planned).toBe(0.3);
  });

  it('何も無くても落ちない', () => {
    expect(tallyEffort([], {}).periods).toEqual([]);
    expect(tallyEffort(null, {}).total.count).toBe(0);
  });

  it('週でも四半期でも足せる', () => {
    const rows = [
      issue({ dueDate: '2026-09-10', plannedHours: 1 }),
      issue({ dueDate: '2026-09-14', plannedHours: 2 }),
    ];

    expect(tallyEffort(rows, { unit: 'week' }).periods).toHaveLength(2);
    expect(tallyEffort(rows, { unit: 'quarter' }).periods).toHaveLength(1);
  });
});

describe('年度の区切り', () => {
  const { tallyFiscal, TALLY_FISCAL_START } = gas;

  it('4月から始まる', () => {
    expect(TALLY_FISCAL_START()).toBe(4);
    expect(tallyFiscal(new Date(2026, 3, 1))).toEqual({ year: 2026, index: 0 });
  });

  it('3月は前の年度の最後の月', () => {
    expect(tallyFiscal(new Date(2027, 2, 31))).toEqual({ year: 2026, index: 11 });
  });

  it('1月と2月も前の年度', () => {
    expect(tallyFiscal(new Date(2027, 0, 1)).year).toBe(2026);
    expect(tallyFiscal(new Date(2027, 1, 1)).year).toBe(2026);
  });

  it('12月は同じ年度', () => {
    expect(tallyFiscal(new Date(2026, 11, 31)).year).toBe(2026);
  });
});

describe('半期で足し上げる', () => {
  function issue(over) {
    return Object.assign({
      number: 1, title: 'x', state: 'open', assignee: 'a@example.com',
      plannedHours: 0, actualHours: 0, dueDate: '', closedAt: '',
      startDate: '', archivedAt: '',
    }, over);
  }

  it('上期と下期に分かれる', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-05-01', plannedHours: 3 }),
      issue({ dueDate: '2026-09-30', plannedHours: 2 }),
      issue({ dueDate: '2026-10-01', plannedHours: 5 }),
      issue({ dueDate: '2027-03-31', plannedHours: 1 }),
    ], { unit: 'half' });

    expect(res.periods.map((p) => p.key)).toEqual(['2026-H1', '2026-H2']);
    expect(res.periods[0].sum.planned).toBe(5);
    expect(res.periods[1].sum.planned).toBe(6);
  });

  it('年度をまたぐと別の区切りになる', () => {
    const res = tallyEffort([
      issue({ dueDate: '2027-03-31', plannedHours: 1 }),
      issue({ dueDate: '2027-04-01', plannedHours: 2 }),
    ], { unit: 'half' });

    expect(res.periods.map((p) => p.key)).toEqual(['2026-H2', '2027-H1']);
  });

  it('累計は年度をまたいでも積む', () => {
    const res = tallyEffort([
      issue({ dueDate: '2026-05-01', plannedHours: 3 }),
      issue({ dueDate: '2026-11-01', plannedHours: 2 }),
      issue({ dueDate: '2027-05-01', plannedHours: 1 }),
    ], { unit: 'half' });

    expect(res.periods.map((p) => p.cumulative.planned)).toEqual([3, 5, 6]);
  });
});
