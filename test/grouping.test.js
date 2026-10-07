import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/Grouping.js');

function issue(number, over) {
  return Object.assign({
    number: number, title: 'やること' + number, state: 'open',
    assignee: '', labels: '', linkedFileIds: '',
  }, over || {});
}

describe('groupIssues', () => {
  const names = { F1: '就業規則.doc', F2: '賃金規程.doc' };

  it('文書ごとに束ねる', () => {
    const g = gas.groupIssues([
      issue(1, { linkedFileIds: 'F1' }),
      issue(2, { linkedFileIds: 'F2' }),
      issue(3, { linkedFileIds: 'F1' }),
    ], 'doc', names);

    expect(g.map((x) => x.label)).toEqual(['就業規則.doc', '賃金規程.doc']);
    expect(g[0].issues.length).toBe(2);
  });

  it('紐づいていないものを分けて出す', () => {
    const g = gas.groupIssues([issue(1)], 'doc', names);
    expect(g[0].label).toBe('文書に紐づいていない');
  });

  it('複数の文書に紐づくものは両方に出る', () => {
    const g = gas.groupIssues([issue(1, { linkedFileIds: 'F1,F2' })], 'doc', names);
    expect(g.length).toBe(2);
    expect(g[0].issues[0].number).toBe(1);
    expect(g[1].issues[0].number).toBe(1);
  });

  it('担当者ごとに束ねる', () => {
    const g = gas.groupIssues([
      issue(1, { assignee: 'a@example.com' }),
      issue(2, {}),
    ], 'assignee', names);

    expect(g.map((x) => x.label)).toEqual(['a@example.com', '担当なし']);
  });

  it('状態ごとに束ねる', () => {
    const g = gas.groupIssues([
      issue(1), issue(2, { state: 'closed' }),
    ], 'state', names);

    expect(g.map((x) => x.label)).toEqual(['未完了', '完了']);
  });

  it('ラベルごとに束ね、空白を落とす', () => {
    const g = gas.groupIssues([
      issue(1, { labels: '規定改訂, P1' }),
      issue(2, { labels: '' }),
    ], 'label', names);

    expect(g.map((x) => x.label)).toEqual(['規定改訂', 'P1', 'ラベルなし']);
  });

  it('束ねない指定ではひとまとめにする', () => {
    const g = gas.groupIssues([issue(1), issue(2)], 'none', names);
    expect(g.length).toBe(1);
    expect(g[0].issues.length).toBe(2);
  });

  it('空でも落ちない', () => {
    expect(gas.groupIssues([], 'doc', names)).toEqual([]);
  });
});

describe('スプリントごとに束ねる', () => {
  it('名前の順に並べ、未定は最後。名前が Object の持ち物や未定の印と重なっても混ざらない', () => {
    const issues = [
      { number: 1, sprint: 'sprint002' }, { number: 2, sprint: '' },
      { number: 3, sprint: 'constructor' }, { number: 4, sprint: '(未定)' }, { number: 5, sprint: 'sprint001' },
      { number: 6, sprint: '__proto__' }, { number: 7, sprint: '__proto__' },
    ];
    const groups = gas.groupIssues(issues, 'sprint', {});
    expect(groups.map((g) => g.label)).toEqual(['(未定)', '__proto__', 'constructor', 'sprint001', 'sprint002', 'スプリント未定']);
    expect(groups.map((g) => g.issues.map((i) => i.number))).toEqual([[4], [6, 7], [3], [5], [1], [2]]);
  });
});
