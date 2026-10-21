import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

/*
 * 思いがけない当たり・ノリノリタイムの決まり (js-luck)。画面の JS から原文のまま切り出して動かす。
 * 押して確かめるのは test/component/luck.test.js。
 */

// 切り出した関数は別の領域で動くので、乱数は渡した Math で差し替える
const M = Object.create(Math);
M.random = Math.random;
const f = ui(['LUCK_RULES', 'LUCK_ACTIONS', 'FUN_CHEERS', 'luckIsAction', 'luckRoll', 'luckNoteAction', 'luckDay'], { Math: M });
const MIN = 60 * 1000;
const T0 = new Date(2026, 9, 21, 10, 0, 0).getTime();
const fresh = () => ({ day: '', wins: 0, lastWin: 0, acts: [], feverUntil: 0, chipHidden: false });

function withRandom(v, fn) {
  const saved = M.random;
  M.random = () => v;
  try { return fn(); } finally { M.random = saved; }
}

describe('引くのは済ませた手だけ', () => {
  it('完了・反映・承認・記録で引き、作る・頼む・差し戻すでは引かない', () => {
    expect(f.luckIsAction('apiIssueClose', [1])).toBe(true);
    expect(f.luckIsAction('apiPrMerge', [1])).toBe(true);
    expect(f.luckIsAction('apiPrReview', [1, 'approve'])).toBe(true);
    expect(f.luckIsAction('apiPrReview', [1, 'request_changes'])).toBe(false);
    expect(f.luckIsAction('apiProjectMove', [1, 'Done'])).toBe(true);
    expect(f.luckIsAction('apiProjectMove', [1, 'InProgress'])).toBe(false);
    expect(f.luckIsAction('apiCommit', [])).toBe(true);
    // 始めるだけでは引かない (始めてすぐやめるのを繰り返して引けないように)
    expect(f.luckIsAction('apiFocusStart', [1, 25])).toBe(false);
    expect(f.luckIsAction('apiIssueCreate', ['x'])).toBe(false);
    expect(f.luckIsAction('apiPrCreate', [])).toBe(false);
    expect(f.luckIsAction('apiIssueList', [])).toBe(false);
  });
});

describe('当たりの上限', () => {
  it('上限に当たっているときは乱数を引かない', () => {
    const s = fresh();
    let drawn = 0;
    const saved = M.random;
    M.random = () => { drawn++; return 0; };
    try {
      expect(f.luckRoll(s, T0)).toBe(true);
      expect(drawn).toBe(1);
      expect(f.luckRoll(s, T0 + 29 * MIN)).toBe(false);
      expect(drawn).toBe(1);
    } finally { M.random = saved; }
  });

  it('1日3回まで・30分空ける・日が替われば数え直す', () => {
    const s = fresh();
    withRandom(0, () => {
      expect(f.luckRoll(s, T0)).toBe(true);
      expect(f.luckRoll(s, T0 + 30 * MIN)).toBe(true);
      expect(f.luckRoll(s, T0 + 60 * MIN)).toBe(true);
      expect(f.luckRoll(s, T0 + 120 * MIN)).toBe(false);
      expect(f.luckRoll(s, T0 + 24 * 60 * MIN)).toBe(true);
    });
    expect(f.LUCK_RULES()).toMatchObject({ oneIn: 8, dayMax: 3, gapMs: 30 * MIN });
  });
});

describe('ノリノリタイム', () => {
  it('1時間に3つで15分。そのあいだは数えず、終わったらまた3つ要る', () => {
    const s = fresh();
    expect(f.luckNoteAction(s, T0)).toBe(false);
    expect(f.luckNoteAction(s, T0 + 30 * MIN)).toBe(false);
    expect(f.luckNoteAction(s, T0 + 59 * MIN)).toBe(true);
    expect(s.feverUntil).toBe(T0 + 74 * MIN);
    expect(f.luckNoteAction(s, T0 + 60 * MIN)).toBe(false);
    expect(s.acts).toEqual([]);
    expect(f.luckNoteAction(s, T0 + 75 * MIN)).toBe(false);
    expect(f.luckNoteAction(s, T0 + 76 * MIN)).toBe(false);
    expect(f.luckNoteAction(s, T0 + 77 * MIN)).toBe(true);
  });

  it('1時間より前の手は数えない', () => {
    const s = fresh();
    f.luckNoteAction(s, T0);
    f.luckNoteAction(s, T0 + 61 * MIN);
    expect(f.luckNoteAction(s, T0 + 62 * MIN)).toBe(false);
  });
});
