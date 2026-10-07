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

describe('終わったスプリントは、終わりの日の時点の中身で数える', () => {
  /*
   * 終わらなかったやることは次のスプリントへ移すのが普通である。いまの所属で
   * 数えると、移した時点で前のスプリントの計画から消え、持ち越しが常に0になる。
   * 移したことは変更の履歴 (field: sprint) に前と後で残っているので、そこから
   * 終わりの日にどこに入っていたかを求める。
   */
  const moves = (list) => ({ 2: list });
  const S = [
    { name: 'sprint001', startDate: '2026-10-01', endDate: '2026-10-05' },
    { name: 'sprint002', startDate: '2026-10-06', endDate: '2026-10-10' },
  ];

  it('終わったあとに次へ移したものは、前のスプリントの計画と持ち越しに残る', () => {
    const issues = [issue(1, 'sprint001', 5, '2026-10-03'), issue(2, 'sprint002', 3)];
    const m = moves([{ at: '2026-10-06T01:00:00.000Z', before: 'sprint001', after: 'sprint002' }]);
    const vel = v.scrumVelocity(S, issues, '2026-10-08', m);

    expect(vel[0]).toMatchObject({ name: 'sprint001', planned: 8, completed: 5, carriedOver: 3 });
    // 移した先でも計画に入る (いまのスプリントは、いまの中身で数える)
    expect(vel[1]).toMatchObject({ name: 'sprint002', planned: 3 });
  });

  it('期間の途中で外したものは、終わりの日には入っていない', () => {
    const issues = [issue(1, 'sprint001', 5, '2026-10-03'), issue(2, '', 3)];
    const m = moves([{ at: '2026-10-02T01:00:00.000Z', before: 'sprint001', after: '' }]);
    expect(v.scrumVelocity(S, issues, '2026-10-08', m)[0]).toMatchObject({ planned: 5, carriedOver: 0 });
  });

  it('終わったスプリントのバーンダウンも、終わりの日の中身で描く', () => {
    const issues = [issue(1, 'sprint001', 5, '2026-10-03'), issue(2, 'sprint002', 3)];
    const m = moves([{ at: '2026-10-06T01:00:00.000Z', before: 'sprint001', after: 'sprint002' }]);
    const b = v.scrumBurndown(S[0], issues, '2026-10-08', m);
    expect(b.remaining[0]).toBe(8);
    expect(b.remaining[b.remaining.length - 1]).toBe(3);
  });

  it('期間の途中で足したやることは、足した日からバーンダウンに入る', () => {
    // 初日から残っていたように描くと、計画が甘かったのか途中で増えたのかが見分けられない
    const issues = [issue(1, 'sprint001', 5), issue(2, 'sprint001', 3)];
    const m = moves([{ at: '2026-10-03T01:00:00.000Z', before: '', after: 'sprint001' }]);
    const b = v.scrumBurndown(S[0], issues, '2026-10-04', m);
    expect(b.remaining.slice(0, 4)).toEqual([5, 5, 8, 8]);
    // 理想の線は、初日に積んであった量から引く
    expect(b.ideal[0]).toBe(5);
  });

  it('初日にまだ積んでいなければ、理想の線はいまの量から引く', () => {
    const issues = [issue(1, 'sprint001', 5)];
    const m = { 1: [{ at: '2026-10-02T01:00:00.000Z', before: '', after: 'sprint001' }] };
    const b = v.scrumBurndown(S[0], issues, '2026-10-04', m);
    expect(b.ideal[0]).toBe(5);
    expect(b.remaining[0]).toBe(0);
  });

  it('終わったスプリントへ後から入れた記録は、始まりから入っていたものとして読む', () => {
    // ai-scrum-gas から移ってきたときなど、過去のスプリントを後から書き入れる
    const rows = [{ id: 1, target: 'issue:1', field: 'sprint', at: '2026-10-20T01:00:00.000Z',
      before: '', after: 'sprint001' }];
    const m = v.scrumSprintMoves(rows, S);
    const issues = [issue(1, 'sprint001', 5, '2026-10-03')];
    expect(v.scrumVelocity(S, issues, '2026-10-21', m)[0]).toMatchObject({ planned: 5, completed: 5 });
  });

  it('移した記録が無ければ、いまの所属で数える (記録を残す前のやること)', () => {
    const issues = [issue(1, 'sprint001', 5, '2026-10-03'), issue(2, 'sprint001', 3)];
    expect(v.scrumVelocity(S, issues, '2026-10-08', {})[0]).toMatchObject({ planned: 8, carriedOver: 3 });
  });

  it('変更の履歴の行から、やることごとの移動を拾う', () => {
    const rows = [
      { id: 3, target: 'issue:2', field: 'sprint', at: '2026-10-06T01:00:00.000Z', before: 'sprint001', after: 'sprint002' },
      { id: 1, target: 'issue:2', field: 'sprint', at: '2026-10-01T01:00:00.000Z', before: '', after: 'sprint001' },
      { id: 2, target: 'issue:2', field: 'title', at: '2026-10-02T01:00:00.000Z', before: 'a', after: 'b' },
      { id: 4, target: 'impediment:2', field: 'sprint', at: '2026-10-02T01:00:00.000Z', before: '', after: 'x' },
    ];
    const m = v.scrumSprintMoves(rows);
    expect(Object.keys(m)).toEqual(['2']);
    expect(m[2].map((x) => x.after)).toEqual(['sprint001', 'sprint002']);
  });
});

describe('台帳に暦に無い日付が手で書かれていても', () => {
  it('バーンダウンは投げずに「期間が決まっていない」として返す', () => {
    const b = v.scrumBurndown({ name: 's', startDate: '2026-13-01', endDate: '2026-13-05' }, [], '2026-10-07');
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
