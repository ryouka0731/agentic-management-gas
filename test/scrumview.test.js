import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

/*
 * バーンダウン・ベロシティ・ロードマップ・要約・用語の説明。
 *
 * ai-scrum-gas では velocity.csv や sprint_backlog.md に人やエージェントが数を
 * 書いていた。手で書いた数は必ずずれるので、ここではやることのポイントと
 * 完了日から数える。
 */
const v = loadGas('src/core/ScrumView.js');

const SPRINTS = [
  { name: 'sprint001', goal: '申請の流れ', startDate: '2026-10-01', endDate: '2026-10-05' },
  { name: 'sprint002', goal: '承認の流れ', startDate: '2026-10-06', endDate: '2026-10-10' },
];

function issue(number, sprint, points, closedAt, extra) {
  return Object.assign({
    number, title: 't' + number, sprint, points, state: closedAt ? 'closed' : 'open',
    closedAt: closedAt || '', archivedAt: '',
  }, extra || {});
}

describe('ベロシティ', () => {
  it('計画・終えた・持ち越しをスプリントごとに数える', () => {
    const issues = [
      issue(1, 'sprint001', 3, '2026-10-03'),
      issue(2, 'sprint001', 5, '2026-10-07'),   // 終わりの日を過ぎてから完了 → 持ち越し
      issue(3, 'sprint001', 2, ''),
      issue(4, 'sprint002', 8, '2026-10-08'),
    ];
    const rows = v.scrumVelocity(SPRINTS, issues, '2026-10-12');

    expect(rows[0]).toMatchObject({ name: 'sprint001', planned: 10, completed: 3, carriedOver: 7 });
    expect(rows[1]).toMatchObject({ name: 'sprint002', planned: 8, completed: 8, carriedOver: 0 });
  });

  it('まだ終わっていないスプリントは、持ち越しを数えない', () => {
    const rows = v.scrumVelocity(SPRINTS, [issue(1, 'sprint002', 3, '')], '2026-10-08');
    expect(rows[1].carriedOver).toBe('');
  });

  it('捨てたやることと、ポイントの無いやることは数えない', () => {
    const issues = [
      issue(1, 'sprint001', 3, '', { archivedAt: '2026-10-02' }),
      issue(2, 'sprint001', '', ''),
      issue(3, 'sprint001', 2, ''),
    ];
    expect(v.scrumVelocity(SPRINTS, issues, '2026-10-12')[0].planned).toBe(2);
  });

  it('終えたスプリントの平均を出す (直近3つまで)', () => {
    const issues = [issue(1, 'sprint001', 4, '2026-10-02'), issue(2, 'sprint002', 6, '2026-10-07')];
    expect(v.scrumAverageVelocity(v.scrumVelocity(SPRINTS, issues, '2026-10-12'))).toBe(5);
  });

  it('日付は Date でも受ける (台帳は日付の字を Date で返す)', () => {
    const issues = [issue(1, 'sprint001', 3, new Date('2026-10-03T10:00:00+09:00'))];
    const sprints = [{ name: 'sprint001', startDate: new Date('2026-10-01T00:00:00+09:00'),
      endDate: new Date('2026-10-05T00:00:00+09:00') }];
    expect(v.scrumVelocity(sprints, issues, '2026-10-12')[0].completed).toBe(3);
  });
});

describe('バーンダウン', () => {
  it('毎日の終わりに残っているポイントと、理想の線', () => {
    const issues = [
      issue(1, 'sprint001', 4, '2026-10-02'),
      issue(2, 'sprint001', 6, '2026-10-04'),
    ];
    const b = v.scrumBurndown(SPRINTS[0], issues, '2026-10-05');

    expect(b.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(b.remaining).toEqual([10, 6, 6, 0, 0]);
    expect(b.ideal).toEqual([10, 7.5, 5, 2.5, 0]);
  });

  it('まだ来ていない日は空にする', () => {
    const b = v.scrumBurndown(SPRINTS[0], [issue(1, 'sprint001', 4, '')], '2026-10-02');
    expect(b.remaining).toEqual([4, 4, null, null, null]);
  });

  it('期間が決まっていなければ、理由を添えて返す', () => {
    const b = v.scrumBurndown({ name: 's', startDate: '', endDate: '' }, [], '2026-10-02');
    expect(b.days).toEqual([]);
    expect(b.notice).toContain('期間');
  });
});

describe('ロードマップ', () => {
  it('どのやることがどのスプリントに入っているか', () => {
    const issues = [issue(1, 'sprint002', 3, ''), issue(2, 'sprint001', 2, ''), issue(3, '', 1, '')];
    const r = v.scrumRoadmap(SPRINTS, issues);

    expect(r.sprints).toEqual(['sprint001', 'sprint002']);
    expect(r.rows.map((x) => [x.number, x.col])).toEqual([[2, 0], [1, 1]]);
    expect(r.unplanned).toBe(1);
  });

  it('無いスプリントを指すやることは、理由を添えて別に出す', () => {
    const r = v.scrumRoadmap(SPRINTS, [issue(1, 'sprint999', 3, '')]);
    expect(r.rows).toEqual([]);
    expect(r.unknown.map((x) => x.number)).toEqual([1]);
  });

  it('スプリントが1つも無ければ、理由を添える', () => {
    const r = v.scrumRoadmap([], [issue(1, '', 3, '')]);
    expect(r.notice).toContain('スプリント');
  });
});

describe('要約', () => {
  it('今のスプリントと、そのゴール・進み・未解決の障害物', () => {
    const issues = [issue(1, 'sprint002', 3, '2026-10-07'), issue(2, 'sprint002', 5, '')];
    const s = v.scrumSummary(SPRINTS, issues, [{ state: 'open' }, { state: 'resolved' }], '2026-10-08');

    expect(s.current).toBe('sprint002');
    expect(s.goal).toBe('承認の流れ');
    expect(s.planned).toBe(8);
    expect(s.completed).toBe(3);
    expect(s.openImpediments).toBe(1);
  });

  it('今のスプリントが無ければ空', () => {
    expect(v.scrumSummary(SPRINTS, [], [], '2026-12-01').current).toBe('');
  });
});

describe('用語の説明', () => {
  it('知っている語の説明を返す', () => {
    expect(v.scrumGlossaryOf('ベロシティ')).toContain('スプリント');
    expect(v.scrumGlossaryOf('ポイント')).toBe(v.scrumGlossaryOf('ストーリーポイント'));
    expect(v.scrumGlossaryOf('知らない語')).toBe('');
  });
});
