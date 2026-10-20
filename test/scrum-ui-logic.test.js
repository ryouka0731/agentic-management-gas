import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

/*
 * スクラムの画面が状態だけから決めること (次の一手・次の作業期間の案・入力の確かめ)。
 *
 * どれも画面の部品に触らないので、画面の JS から原文のまま切り出して直に呼ぶ。
 * 画面を組んで押すテスト (test/component/scrum.test.js) は通り道の一部しか踏まないため、
 * 分かれ道ごとの答えをここで固定する。言葉の差し込み (termIn) は {key} のまま返す。
 */
const view = ui(['sprintFormProblems', 'sprintNameProblem', 'sprintDayProblems', 'sprintOverlapNote',
  'scrumNextStep', 'scrumByName', 'scrumAverageOf', 'scrumStepUnready', 'scrumStepByDay', 'scrumStepRunning',
  'scrumSuggestSprint', 'scrumLatestSprint', 'scrumPadNumber', 'scrumNextName', 'scrumSprintLength',
  'scrumAddDays', 'scrumDaysBetween', 'tokyoDay'], { termIn: (t) => t });
const plain = (v) => JSON.parse(JSON.stringify(v));

describe('scrumNextStep (次の一手)', () => {
  const sp = { name: 's1', startDate: '2026-10-01', endDate: '2026-10-14', goal: '申請を速く' };
  const base = (over) => Object.assign({ sprints: [sp], sprint: 's1',
    velocity: [{ name: 's1', planned: 8, completed: 3 }], summary: { average: 6, openImpediments: 0 } }, over);
  const step = (v, today) => plain(view.scrumNextStep(v, today || '2026-10-07'));

  it('作業期間が無ければ作る', () => {
    expect(step({ sprints: [] })).toEqual({ phase: 'plan', title: 'まず、{sprint}を1つ作りましょう',
      why: '{sprint}は区切った作業の期間です。はじめは2週間くらいがおすすめです。',
      action: 'create', label: '{sprint}を作る' });
    expect(step({}).action).toBe('create');
  });

  it('選んでいなければ選ぶ', () => {
    expect(step(base({ sprint: 'nai' }))).toEqual({ phase: 'plan', title: '見る{sprint}を選びましょう',
      why: '上の「{sprint}」から選ぶと、進み具合が出ます。', action: '', label: '' });
  });

  it('期間と目標が無ければ直す', () => {
    const noDay = step(base({ sprints: [Object.assign({}, sp, { endDate: '2026-02-30' })] }));
    expect(noDay.title).toBe('始まりと終わりの日を決めましょう');
    expect(noDay.action).toBe('edit');
    const noGoal = step(base({ sprints: [Object.assign({}, sp, { goal: '' })] }));
    expect(noGoal.title).toBe('{sprintGoal}を一言で書きましょう');
    expect(noGoal.label).toBe('この{sprint}を直す');
  });

  it('終わったら振り返って次を作る', () => {
    expect(step(base(), '2026-10-15')).toEqual({ phase: 'review', title: '{sprint}が終わりました',
      why: 'できたもの ({points} 3 / 8) を見せ合い、次に良くすることを1つ決めてから、次の{sprint}を作りましょう。',
      action: 'create', label: '次の{sprint}を作る' });
  });

  it('積んでいなければ積む。平均が無ければ平均を言わない', () => {
    const none = base({ velocity: [] });
    expect(step(none)).toEqual({ phase: 'plan', title: 'やることを積みましょう',
      why: 'やることを開いて「直す」から、この{sprint}と{points} (ほかのやることと比べた大きさ) を入れます。これまでの平均は{points} 6 です。',
      action: 'issues', label: 'やることを開く' });
    expect(step(base({ velocity: [], summary: { average: '' } })).why).not.toContain('平均');
    expect(step(base({ velocity: [], summary: undefined })).why).not.toContain('平均');
  });

  it('始まる前は量を見直す', () => {
    expect(step(base(), '2026-09-30')).toEqual({ phase: 'plan', title: '2026-10-01 に始まります',
      why: '始まるまでに、積んだ量 ({points} 8) が多すぎないか見直しましょう。これまでの平均は{points} 6 です。',
      action: 'issues', label: 'やることを開く' });
    expect(step(base({ summary: {} }), '2026-09-30').why).toBe('始まるまでに、積んだ量 ({points} 8) が多すぎないか見直しましょう。');
  });

  it('困りごと・残り・全部終わり', () => {
    const imp = step(base({ summary: { average: 6, openImpediments: 2 } }));
    expect(imp.title).toBe('{impediment}が 2件あります');
    expect(imp.action).toBe('impediments');
    expect(step(base())).toEqual({ phase: 'run', title: '進めましょう (残りの{points} 5)',
      why: '手を付けたら進捗ボードで「In Progress」へ、終わったら完了にします。進みを妨げるものは「{impediment}」に書きます。',
      action: 'board', label: '進捗ボードを開く' });
    expect(step(base({ velocity: [{ name: 's1', planned: 8, completed: 8 }] }))).toEqual({ phase: 'review',
      title: '積んだやることは全部終わりました', why: '終わりの日を待たずに、できたものを見せ合ってもかまいません。',
      action: '', label: '' });
  });
});

describe('scrumSuggestSprint (次の作業期間の案)', () => {
  const s = (sprints, today) => plain(view.scrumSuggestSprint(sprints, today || '2026-10-20'));

  it('何も無ければ sprint001 を今日から2週間', () => {
    expect(s([])).toEqual({ name: 'sprint001', startDate: '2026-10-20', endDate: '2026-11-02', days: 14,
      basis: 'はじめは2週間を入れてあります' });
    expect(s(undefined).name).toBe('sprint001');
  });

  it('いちばん遅く終わるものの続き番号・翌日から・同じ長さ', () => {
    expect(s([{ name: 'sprint009', startDate: '2026-10-01', endDate: '2026-10-10' },
      { name: 'sprint003', startDate: '2026-09-01', endDate: '2026-09-14' }], '2026-10-12')).toEqual({
      name: 'sprint010', startDate: '2026-10-11', endDate: '2026-10-20', days: 10,
      basis: 'sprint009 と同じ 10日間を入れてあります' });
  });

  it('続き番号が埋まっていれば飛ばす。桁はそろえ、あふれたら伸ばす', () => {
    expect(s([{ name: 'a09', startDate: '2026-10-01', endDate: '2026-10-14' }, { name: 'a10' }]).name).toBe('a11');
    expect(s([{ name: 'x99', startDate: '2026-10-01', endDate: '2026-10-14' }]).name).toBe('x100');
  });

  it('終わりの日が読めなければ最後のものの名前を使い、今日から始める', () => {
    expect(s([{ name: 'b7' }, { name: 'b2' }])).toEqual({ name: 'b3', startDate: '2026-10-20',
      endDate: '2026-11-02', days: 14, basis: 'はじめは2週間を入れてあります' });
  });

  it('番号で終わらない名前しか無ければ sprintNNN の空き', () => {
    expect(s([{ name: 'まえ', startDate: '2026-10-01', endDate: '2026-10-14' }, { name: 'sprint001' }]).name)
      .toBe('sprint002');
  });

  it('長さが読めない・長すぎれば2週間。ずっと前に終わっていれば今日から', () => {
    const noStart = s([{ name: 'c1', endDate: '2026-10-14' }]);
    expect(noStart.days).toBe(14);
    expect(noStart.startDate).toBe('2026-10-15');
    expect(s([{ name: 'c1', startDate: '2026-01-01', endDate: '2026-10-14' }]).basis).toBe('はじめは2週間を入れてあります');
    expect(s([{ name: 'c1', startDate: '2026-01-01', endDate: '2026-01-14' }]).startDate).toBe('2026-10-20');
    // 7日以内の遅れなら前の終わりの翌日のまま
    expect(s([{ name: 'c1', startDate: '2026-09-30', endDate: '2026-10-13' }]).startDate).toBe('2026-10-14');
  });
});

describe('sprintFormProblems (入力の確かめ)', () => {
  const sprints = [{ name: 's1', startDate: '2026-10-01', endDate: '2026-10-14' },
    { name: 's2', startDate: '2026-10-15', endDate: '2026-10-28' }, { name: 's3' }];
  const p = (v, editing) => plain(view.sprintFormProblems(v, sprints, editing || ''));
  const ok = { name: '', startDate: '', endDate: '', overlap: '' };

  it('名前', () => {
    expect(p({ name: '  ' }).name).toBe('名前を入れてください');
    expect(p({ name: 'a'.repeat(41) }).name).toBe('名前は40字までにしてください');
    expect(p({ name: 'a/b' }).name).toBe('/ \\ , は名前に使えません');
    expect(p({ name: ' s1 ' }).name).toBe('「s1」は既にあります。別の名前にしてください');
    expect(p({ name: 'new' })).toEqual(ok);
    // 直すときは名前を見ない
    expect(p({ name: '' }, 's1')).toEqual(ok);
    expect(view.sprintFormProblems({ name: 'x' }, undefined, '').name).toBe('');
  });

  it('日付', () => {
    expect(p({ name: 'n', startDate: '2026-02-30', endDate: '2026-13-01' })).toEqual(Object.assign({}, ok,
      { startDate: '暦にある日を選んでください', endDate: '暦にある日を選んでください' }));
    expect(p({ name: 'n', endDate: '2026-10-01' }).startDate).toBe('終わりの日を入れるなら、始まりの日も入れてください');
    expect(p({ name: 'n', startDate: '2026-11-10', endDate: '2026-11-01' })).toEqual(Object.assign({}, ok,
      { endDate: '終わりの日は、始まりの日 (2026-11-10) と同じか後にしてください' }));
    expect(p({ name: 'n', startDate: '2026-11-10' })).toEqual(ok);
  });

  it('期間の重なりは注意だけ。直しているものとは比べない', () => {
    expect(p({ name: 'n', startDate: '2026-10-10', endDate: '2026-10-20' }).overlap).toBe(
      's1 (2026-10-01 〜 2026-10-14)、s2 (2026-10-15 〜 2026-10-28) と期間が重なっています。同じやることを2つに積まないよう気を付けてください');
    expect(p({ startDate: '2026-10-02', endDate: '2026-10-03' }, 's1')).toEqual(ok);
    expect(p({ name: 'n', startDate: '2026-11-10', endDate: '2026-11-11' }).overlap).toBe('');
  });
});
