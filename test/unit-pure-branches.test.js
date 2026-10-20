import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

/*
 * src/core のピュアな .js で、既存のテストが通っていなかった枝。
 * 読めない値・空の入力・輪のような「人が台帳を手で直したときに起きる形」が中心。
 */
const g = loadGas('src/core/Gantt.js', 'src/core/Graph.js', 'src/core/IssueTree.js', 'src/core/Mention.js',
  'src/core/Staleness.js', 'src/core/Terms.js', 'src/core/Tally.js');

describe('Gantt', () => {
  it('読めない日付は null、空の入力は今日だけの目盛り', () => {
    expect(g.ganttStartOfDay('いつか')).toBe(null);
    expect(g.ganttStartOfDay('')).toBe(null);
    const today = g.ganttStartOfDay(new Date());
    expect(g.ganttLayout(null)).toEqual({ from: today, to: today, days: 1, todayOffset: 0, rows: [] });
  });

  it('始まりも作った日も読めないやることは棒にしない', () => {
    const out = g.ganttLayout([
      { number: 1, title: 'a', createdAt: '壊れた日付', dueDate: '2026-01-10' },
      { number: 2, title: 'b', createdAt: '2026-01-05', dueDate: '2026-01-03', state: 'open' },
    ], '2026-01-01');
    expect(out.rows.map((r) => r.number)).toEqual([2]);
    // 期限が始まりより前なら1日分の棒
    expect(out.rows[0].span).toBe(1);
    expect(out.rows[0].overdue).toBe(false);
  });
});

describe('Graph', () => {
  it('空の入力でも落ちず、レーンは最低1本', () => {
    expect(g.commitGraph(null)).toEqual([]);
    expect(g.graphLaneCount(null)).toBe(1);
    expect(g.graphLaneCount([])).toBe(1);
  });

  it('記録の文が無くても反映の印は付けず、レーンの数は行の lane も数える', () => {
    const rows = g.commitGraph([
      { name: 'main', commits: [{ sha: 'm1', timestamp: '2026-01-01T00:00:00Z' }] },
      { name: '改訂', baseSha: 'none', commits: [{ sha: 'b1', message: 'マージ: PR #3 x', timestamp: '2026-01-02T00:00:00Z' }] },
    ]);
    expect(rows.map((r) => [r.sha, r.lane, r.merge])).toEqual([['b1', 1, true], ['m1', 0, false]]);
    // activeLanes が空でも lane は数える
    expect(g.graphLaneCount([{ lane: 3, activeLanes: [] }])).toBe(4);
  });
});

describe('IssueTree', () => {
  it('空の入力は空の木', () => {
    expect(g.buildIssueTree(null)).toEqual([]);
    expect(g.flattenIssueTree(null)).toEqual([]);
  });

  it('祖先に輪があっても止まり、どのやることも1回だけ並ぶ', () => {
    // 2 → 3 → 2 の輪。1 は輪の外から 2 にぶら下がる
    const issues = [
      { number: 1, parent: 2 }, { number: 2, parent: 3 }, { number: 3, parent: 2 }, { number: 4, parent: 4 },
    ];
    const flat = g.flattenIssueTree(g.buildIssueTree(issues)).map((n) => n.number).sort();
    expect(flat).toEqual([1, 2, 3, 4]);
  });
});

describe('Mention', () => {
  it('名簿が無い・名簿に空の行があっても落ちない', () => {
    expect(g.mentionMatch('aoki', null)).toBe('');
    expect(g.mentionMatch('aoki', [null, '', 'Aoki@example.com'])).toBe('Aoki@example.com');
    expect(g.mentionMatch('', ['aoki@example.com'])).toBe('');
  });
});

describe('Staleness', () => {
  it('読めない日付は「動いた日が分からない」として段階0', () => {
    expect(g.staleLastMoved({ updatedAt: 'きのう' })).toBe(null);
    expect(g.stalenessOf({ state: 'open', updatedAt: 'きのう' }, new Date())).toEqual({ days: 0, level: 0 });
    expect(g.staleLastMoved(null)).toBe(null);
  });
});

describe('Terms', () => {
  it('null の key は空字のまま返す (知らない key と同じ)', () => {
    expect(g.term(null)).toBe('');
    expect(g.term(undefined, 'scrum')).toBe('');
  });
});

describe('Tally', () => {
  it('選べる区切りと数える日は、それぞれ実際に違う結果を出す', () => {
    const d = new Date(2026, 4, 20); // 2026-05-20 (水)
    const keys = g.TALLY_UNITS().map((u) => g.tallyPeriodOf(d, u.value).key);
    expect(keys).toEqual(['2026-05-18', '2026-05', '2026-Q1', '2026-H1', '2026']);
    expect(new Set(keys).size).toBe(keys.length);

    const issue = { dueDate: '2026-01-01', closedAt: '2026-02-01', startDate: '2026-03-01' };
    const days = g.TALLY_BASES().map((b) => g.tallyDateOf(issue, b.value).getMonth());
    expect(days).toEqual([0, 1, 2]);
  });

  it('読めない日付は数えず、skipped に数える', () => {
    expect(g.tallyDay('いつか')).toBe(null);
    const res = g.tallyEffort([
      { assignee: 'a', plannedHours: 1, dueDate: 'いつか' },
      { assignee: 'a', plannedHours: 2, dueDate: '2026-05-01' },
    ]);
    expect(res.unit).toBe('month');
    expect(res.basis).toBe('due');
    expect(res.skipped).toBe(1);
    expect(res.total.planned).toBe(2);
  });
});
