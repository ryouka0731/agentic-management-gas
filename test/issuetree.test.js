import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/IssueTree.js');

function issue(number, parent, over) {
  return Object.assign({
    number: number, title: 'やること' + number, parent: parent === undefined ? '' : parent,
    estimate: '', plannedHours: '', actualHours: '',
  }, over || {});
}

describe('buildIssueTree', () => {
  it('親の下に子を入れる', () => {
    const roots = gas.buildIssueTree([issue(1), issue(2, 1), issue(3, 1)]);

    expect(roots.length).toBe(1);
    expect(roots[0].children.map((c) => c.number)).toEqual([2, 3]);
  });

  it('何段でも入れ子にできる', () => {
    const roots = gas.buildIssueTree([
      issue(1), issue(2, 1), issue(3, 2), issue(4, 3),
    ]);

    expect(roots[0].children[0].children[0].children[0].number).toBe(4);
    expect(gas.flattenIssueTree(roots).map((n) => n.depth)).toEqual([0, 1, 2, 3]);
  });

  it('親のすぐ下に子が並ぶ', () => {
    const roots = gas.buildIssueTree([issue(1), issue(2, 1), issue(9)]);
    expect(gas.flattenIssueTree(roots).map((n) => n.number)).toEqual([1, 2, 9]);
  });

  it('居ない親を指していたら根に置く', () => {
    const roots = gas.buildIssueTree([issue(1, 99)]);
    expect(roots.length).toBe(1);
    expect(roots[0].number).toBe(1);
  });

  it('自分を親にしても止まらない', () => {
    const roots = gas.buildIssueTree([issue(1, 1)]);
    expect(roots.length).toBe(1);
    expect(roots[0].children).toEqual([]);
  });

  it('輪になる親は無かったことにする', () => {
    // 1 → 2 → 1 のような指し方
    const roots = gas.buildIssueTree([issue(1, 2), issue(2, 1)]);
    expect(gas.flattenIssueTree(roots).length).toBe(2);
  });

  it('元の行を書き換えない', () => {
    const rows = [issue(1), issue(2, 1)];
    gas.buildIssueTree(rows);
    expect(rows[0].children).toBeUndefined();
  });
});

describe('rollupEffort', () => {
  it('子の工数を親に足し上げる', () => {
    const roots = gas.buildIssueTree([
      issue(1, '', { plannedHours: 2, actualHours: 1 }),
      issue(2, 1, { plannedHours: 3, actualHours: 4 }),
      issue(3, 2, { plannedHours: 5, actualHours: 0 }),
    ]);

    expect(gas.rollupEffort(roots[0])).toEqual({
      estimate: 0, planned: 10, actual: 5,
    });
  });

  it('数字でない値は0として扱う', () => {
    const roots = gas.buildIssueTree([issue(1, '', { plannedHours: '' })]);
    expect(gas.rollupEffort(roots[0]).planned).toBe(0);
  });
});

describe('issueWouldCycle', () => {
  const rows = [issue(1), issue(2, 1), issue(3, 2)];

  it('自分を親にすると輪になる', () => {
    expect(gas.issueWouldCycle(rows, 1, 1)).toBe(true);
  });

  it('自分の子を親にすると輪になる', () => {
    expect(gas.issueWouldCycle(rows, 1, 2)).toBe(true);
  });

  it('自分の孫を親にしても輪になる', () => {
    expect(gas.issueWouldCycle(rows, 1, 3)).toBe(true);
  });

  it('関係のない相手なら輪にならない', () => {
    expect(gas.issueWouldCycle(rows.concat([issue(9)]), 9, 3)).toBe(false);
  });

  it('親を持たない相手なら輪にならない', () => {
    expect(gas.issueWouldCycle(rows, 3, 1)).toBe(false);
  });

  it('すでに輪になっている行を渡しても止まらない', () => {
    const looped = [issue(1, 2), issue(2, 1)];
    expect(gas.issueWouldCycle(looped, 5, 1)).toBe(true);
  });
});
