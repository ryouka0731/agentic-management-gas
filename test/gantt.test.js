import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/Gantt.js');

function issue(number, createdAt, dueDate, state) {
  return {
    number: number, title: 'やること' + number, state: state || 'open',
    assignee: '', createdAt: createdAt, dueDate: dueDate || '',
  };
}

describe('ganttLayout', () => {
  it('作成日から期限までを棒にする', () => {
    const g = gas.ganttLayout(
      [issue(1, '2026-09-01', '2026-09-05')], '2026-09-01');

    expect(g.days).toBe(5);
    expect(g.rows[0].offset).toBe(0);
    expect(g.rows[0].span).toBe(5);
    expect(g.rows[0].hasDue).toBe(true);
  });

  it('時刻があっても日単位に丸める', () => {
    const g = gas.ganttLayout(
      [issue(1, '2026-09-01T23:59:00', '2026-09-02T00:01:00')], '2026-09-01');
    expect(g.rows[0].span).toBe(2);
  });

  it('期限が無いものは1日分の棒にする', () => {
    const g = gas.ganttLayout([issue(1, '2026-09-03')], '2026-09-03');
    expect(g.rows[0].hasDue).toBe(false);
    expect(g.rows[0].span).toBe(1);
  });

  it('複数のやることで全体の幅を決める', () => {
    const g = gas.ganttLayout([
      issue(1, '2026-09-01', '2026-09-03'),
      issue(2, '2026-09-05', '2026-09-10'),
    ], '2026-09-01');

    expect(g.days).toBe(10);
    expect(g.rows[1].offset).toBe(4);
    expect(g.rows[1].span).toBe(6);
  });

  it('期限を過ぎた未完了に印をつける', () => {
    const g = gas.ganttLayout([
      issue(1, '2026-09-01', '2026-09-03', 'open'),
      issue(2, '2026-09-01', '2026-09-03', 'closed'),
    ], '2026-09-08');

    expect(g.rows[0].overdue).toBe(true);
    expect(g.rows[1].overdue).toBe(false);
  });

  it('今日が範囲の外でも線を引ける位置を返す', () => {
    const g = gas.ganttLayout([issue(1, '2026-09-01', '2026-09-03')], '2026-09-10');

    expect(g.todayOffset).toBe(9);
    expect(g.days).toBe(10);
  });

  it('期限が作成日より前でも棒が消えない', () => {
    const g = gas.ganttLayout([issue(1, '2026-09-05', '2026-09-01')], '2026-09-05');
    expect(g.rows[0].span).toBe(1);
  });

  it('空なら空を返す', () => {
    expect(gas.ganttLayout([], '2026-09-01').rows).toEqual([]);
    expect(gas.ganttLayout([], '2026-09-01').days).toBe(1);
  });
});
