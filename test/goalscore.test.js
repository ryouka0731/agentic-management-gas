import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

/*
 * 目標の数え方 (src/core/GoalScore.js)。台帳に触らない純粋な関数なので、直に確かめる。
 * 式は docs/manual/goals.md に書いた形と同じであること。
 */
const g = loadGas('src/core/GoalScore.js');

const day = (y, m, d) => new Date(y, m - 1, d);

describe('期', () => {
  it('4月始まりの半期と四半期', () => {
    expect(g.goalPeriodOf(day(2026, 4, 1), 'half', 4).key).toBe('2026H1');
    expect(g.goalPeriodOf(day(2026, 9, 30), 'half', 4).key).toBe('2026H1');
    expect(g.goalPeriodOf(day(2026, 10, 1), 'half', 4).key).toBe('2026H2');
    // 1〜3月は前の年度の下期
    expect(g.goalPeriodOf(day(2027, 3, 31), 'half', 4).key).toBe('2026H2');
    expect(g.goalPeriodOf(day(2026, 10, 21), 'quarter', 4).key).toBe('2026Q3');
    expect(g.goalPeriodOf(day(2027, 1, 5), 'quarter', 4).key).toBe('2026Q4');
    expect(g.goalPeriodOf(day(2026, 10, 21), 'half', 4).label).toBe('2026年度 下期');
    expect(g.goalPeriodLabel('2026Q3')).toBe('2026年度 第3四半期');
  });

  it('年度の始まりの月を変えられる (1月始まり = 暦の年)', () => {
    expect(g.goalPeriodOf(day(2026, 1, 1), 'half', 1).key).toBe('2026H1');
    expect(g.goalPeriodOf(day(2026, 7, 1), 'half', 1).key).toBe('2026H2');
    // 読めない月は4月として扱う
    expect(g.goalPeriodOf(day(2026, 4, 1), 'half', 'x').key).toBe('2026H1');
  });

  it('期の始まりと終わり (終わりは次の期の始まり)', () => {
    const h2 = g.goalPeriodRange('2026H2', 4);
    expect(h2.start.getTime()).toBe(day(2026, 10, 1).getTime());
    expect(h2.end.getTime()).toBe(day(2027, 4, 1).getTime());
    const q4 = g.goalPeriodRange('2026Q4', 4);
    expect(q4.start.getTime()).toBe(day(2027, 1, 1).getTime());
    expect(q4.end.getTime()).toBe(day(2027, 4, 1).getTime());
    expect(g.goalPeriodRange('2026X1', 4)).toBe(null);
  });

  it('となりの期', () => {
    expect(g.goalPeriodShift('2026H2', 1)).toBe('2027H1');
    expect(g.goalPeriodShift('2026H1', -1)).toBe('2025H2');
    expect(g.goalPeriodShift('2026Q4', 1)).toBe('2027Q1');
    expect(g.goalPeriodShift('2026Q1', -1)).toBe('2025Q4');
    expect(g.goalPeriodShift('だめ', 1)).toBe('');
  });

  it('どの日もちょうど1つの期に入り、key の範囲に収まる (性質)', () => {
    for (let fy = 1; fy <= 12; fy++) {
      for (let t = day(2025, 1, 1).getTime(); t < day(2028, 1, 1).getTime(); t += 5 * 86400000) {
        const d = new Date(t);
        ['half', 'quarter'].forEach((unit) => {
          const r = g.goalPeriodRange(g.goalPeriodOf(d, unit, fy).key, fy);
          expect(d.getTime() >= r.start.getTime() && d.getTime() < r.end.getTime()).toBe(true);
        });
      }
    }
  });
});

describe('項目の進み具合', () => {
  const end = day(2027, 4, 1);

  it('つないだやること: 予定の工数の重さで数え、期の終わりより後に済ませたものは数えない', () => {
    const linked = [
      { state: 'closed', closedAt: day(2026, 11, 1), plannedHours: 3 },
      { state: 'open', closedAt: '', plannedHours: 1 },
      { state: 'closed', closedAt: day(2027, 5, 1), plannedHours: '' }, // 期のあと: 済んでいない
      { state: 'closed', closedAt: day(2026, 12, 1), plannedHours: 2, archivedAt: day(2026, 12, 2) }, // 捨てた: 数えない
    ];
    const p = g.goalItemProgress({ measure: 'issues' }, { linked, end }, 'mbo');
    expect(p.progress).toBeCloseTo(3 / 5);
    expect(p.done).toBe(1);
    expect(p.total).toBe(3);
    expect(p.remaining).toBe(2);
    expect(g.goalRemainingText({ measure: 'issues' }, p)).toBe('あと2件');
  });

  it('つないだやることが無ければ 0、全部済んでも 1 を超えない', () => {
    expect(g.goalItemProgress({ measure: 'issues' }, { linked: [], end }, 'kpi').progress).toBe(0);
    const all = g.goalItemProgress({ measure: 'issues' },
      { linked: [{ state: 'closed', closedAt: day(2026, 10, 2) }], end }, 'kpi');
    expect(all.progress).toBe(1);
    expect(g.goalRemainingText({ measure: 'issues' }, all)).toBe('');
  });

  it('タグの数: 目標の数と比べ、MBO・KPI は 150% まで、OKR は 1.0 まで', () => {
    const item = { measure: 'label', target: 4 };
    expect(g.goalItemProgress(item, { counted: 1 }, 'mbo').progress).toBe(0.25);
    expect(g.goalItemProgress(item, { counted: 10 }, 'mbo').progress).toBe(1.5);
    expect(g.goalItemProgress(item, { counted: 10 }, 'okr').progress).toBe(1);
    expect(g.goalRemainingText(item, g.goalItemProgress(item, { counted: 1 }, 'mbo'))).toBe('あと3件');
  });

  it('数を入れる: 今の値 ÷ 目標の値 (150% まで、負は 0)', () => {
    const item = { measure: 'number', target: 200, actual: 50, unit: '万円' };
    const p = g.goalItemProgress(item, {}, 'kpi');
    expect(p.progress).toBe(0.25);
    expect(g.goalRemainingText(item, p)).toBe('あと 150 万円');
    expect(g.goalItemProgress({ measure: 'number', target: 100, actual: 400 }, {}, 'kpi').progress).toBe(1.5);
    expect(g.goalItemProgress({ measure: 'number', target: 100, actual: -5 }, {}, 'kpi').progress).toBe(0);
    expect(g.goalItemProgress({ measure: 'number', target: 0, actual: 5 }, {}, 'kpi').progress).toBe(0);
  });

  it('できた・まだ: 台帳の TRUE も字の true も読む', () => {
    expect(g.goalItemProgress({ measure: 'check', checked: true }, {}, 'mbo').progress).toBe(1);
    expect(g.goalItemProgress({ measure: 'check', checked: 'TRUE' }, {}, 'mbo').progress).toBe(1);
    expect(g.goalItemProgress({ measure: 'check', checked: false }, {}, 'mbo').progress).toBe(0);
    expect(g.goalItemProgress({ measure: 'check', checked: '' }, {}, 'mbo').progress).toBe(0);
  });
});

describe('重みと全体', () => {
  it('重みが無ければ等しく、あれば書いたものだけで分ける', () => {
    expect(g.goalWeights([{}, {}, {}, {}])).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(g.goalWeights([{ weight: 60 }, { weight: 40 }])).toEqual([0.6, 0.4]);
    expect(g.goalWeights([{ weight: 30 }, { weight: '' }])).toEqual([1, 0]);
    expect(g.goalWeights([])).toEqual([]);
  });

  it('全体 = 項目の進み具合の重み付きの平均', () => {
    const items = [
      { id: 1, measure: 'number', target: 100, actual: 50, weight: 60 },
      { id: 2, measure: 'check', checked: true, weight: 40 },
    ];
    const out = g.goalProgress('mbo', items, {});
    expect(out.progress).toBeCloseTo(0.6 * 0.5 + 0.4 * 1);
    expect(out.items.map((p) => p.share)).toEqual([0.6, 0.4]);
  });

  it('全体は 0 以上、項目の上限 (OKR 1.0 / ほか 1.5) を超えない (性質)', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let n = 0; n < 300; n++) {
      const kind = ['okr', 'mbo', 'kpi'][n % 3];
      const items = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => ({
        id: i, measure: 'number', target: Math.floor(rand() * 50), actual: Math.floor(rand() * 200) - 20,
        weight: rand() < 0.3 ? '' : Math.floor(rand() * 100),
      }));
      const p = g.goalProgress(kind, items, {}).progress;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual((kind === 'okr' ? 1 : 1.5) + 1e-9);
    }
  });
});

describe('自動の見立て', () => {
  it('OKR は 0.0〜1.0 の点。0.7 前後が狙いどおり、1.0 は目標が低かったかも', () => {
    expect(g.goalAutoScore('okr', 0.7).text).toBe('0.7');
    expect(g.goalAutoScore('okr', 0.7).note).toMatch(/狙いどおり/);
    expect(g.goalAutoScore('okr', 1).note).toMatch(/低め/);
    expect(g.goalAutoScore('okr', 1.4).score).toBe(1);
    expect(g.goalAutoScore('okr', 0.1).text).toBe('0.1');
    expect(g.goalAutoScore('okr', 0.1).grade).toBe('');
  });

  it('MBO・KPI は達成率と段 (S ≥120 / A ≥100 / B ≥80 / C ≥60 / D)', () => {
    const at = (p) => g.goalAutoScore('mbo', p).grade;
    expect(at(1.2)).toBe('S');
    expect(at(1.19)).toBe('A');
    expect(at(1)).toBe('A');
    expect(at(0.8)).toBe('B');
    expect(at(0.79)).toBe('C');
    expect(at(0.6)).toBe('C');
    expect(at(0.59)).toBe('D');
    expect(at(0)).toBe('D');
    expect(g.goalAutoScore('kpi', 2).percent).toBe(150);
    expect(g.goalAutoScore('kpi', 0.5).note).toMatch(/評価を決めるのは上長/);
  });

  it('段は GOAL_GRADES() の1か所で決まる', () => {
    const grades = g.GOAL_GRADES();
    expect(grades.map((x) => x.grade)).toEqual(['S', 'A', 'B', 'C', 'D']);
    grades.forEach((x) => expect(g.goalAutoScore('mbo', x.min / 100).grade).toBe(x.grade));
  });
});

describe('期の中での進み方', () => {
  const range = { start: day(2026, 10, 1), end: day(2027, 4, 1) };
  const mid = new Date((range.start.getTime() + range.end.getTime()) / 2);

  it('経った割合と比べて、順調・少し遅れ気味・遅れ', () => {
    expect(g.goalPace(0.5, range, mid).key).toBe('ok');
    expect(g.goalPace(0.45, range, mid).key).toBe('ok');
    expect(g.goalPace(0.3, range, mid).key).toBe('slight');
    expect(g.goalPace(0.1, range, mid).key).toBe('behind');
    expect(g.goalPace(0.1, range, mid).label).not.toMatch(/失敗|ダメ|だめ/);
  });

  it('期の前とあと', () => {
    expect(g.goalPace(0, range, day(2026, 9, 1)).key).toBe('before');
    expect(g.goalPace(0, range, day(2027, 4, 1)).key).toBe('ended');
  });
});

describe('状態の移り方', () => {
  const cases = [
    ['draft', 'submit', 'submitted'], ['returned', 'submit', 'submitted'],
    ['submitted', 'approve', 'approved'], ['submitted', 'return', 'returned'],
    ['approved', 'edit', 'submitted'], ['approved', 'grade', 'closed'],
  ];
  it.each(cases)('%s で %s すると %s', (from, act, to) => {
    expect(g.goalNext(from, act)).toBe(to);
  });

  it('表に無い移り方は無い', () => {
    const acts = ['submit', 'approve', 'return', 'edit', 'grade', 'toString'];
    const ok = new Set(cases.map((c) => c[0] + ':' + c[1]));
    ['draft', 'submitted', 'approved', 'returned', 'closed', '__proto__', 'x'].forEach((from) => {
      acts.forEach((act) => {
        if (!ok.has(from + ':' + act)) expect(g.goalNext(from, act)).toBe(null);
      });
    });
  });
});
