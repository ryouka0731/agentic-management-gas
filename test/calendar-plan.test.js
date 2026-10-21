import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

/*
 * やることを予定に並べる (src/core/CalendarPlan.js)。ピュアな計算なので直接動かす。
 * 時刻は東京。2026-10-19 は月曜。
 */
const gas = loadGas('src/core/CalendarPlan.js');

/** 東京の時刻 (ミリ秒) */
function tokyo(day, hm) {
  return Date.parse(day + 'T' + (hm || '00:00') + ':00+09:00');
}
function hm(ms) {
  const t = new Date(ms + 9 * 3600000);
  return String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0');
}
function dayOf(ms) {
  return new Date(ms + 9 * 3600000).toISOString().substring(0, 10);
}

const BASE = {
  hours: { start: '09:00', end: '18:00' }, blockMin: 45, days: 5,
};

function plan(over) {
  return gas.calendarPlanBlocks(Object.assign({}, BASE, over));
}

describe('要る分', () => {
  it('予定 − 実績 (人日) を時間にし、担当の頭数で割る。5分単位に切り上げる', () => {
    expect(gas.calendarMinutesFor({ plannedHours: 1, actualHours: 0.5 }, 45)).toBe(240);
    expect(gas.calendarMinutesFor({ plannedHours: 1, heads: 2 }, 45)).toBe(240);
    expect(gas.calendarMinutesFor({ plannedHours: 0.1 }, 45)).toBe(50);
  });

  it('見積もりが無い・使い切ったものは1つ分だけ', () => {
    expect(gas.calendarMinutesFor({ plannedHours: '' }, 45)).toBe(45);
    expect(gas.calendarMinutesFor({ plannedHours: 1, actualHours: 2 }, 25)).toBe(25);
  });
});

describe('並べ方', () => {
  it('期限の早いものから。同じ期限なら優先度、それでも同じなら番号', () => {
    // 作る順は期待する並びの逆 (偶然一致しないように)
    const out = plan({
      now: tokyo('2026-10-19', '08:00'),
      tasks: [
        { number: 4, minutes: 45, due: '' },
        { number: 3, minutes: 45, due: '2026-10-21', rank: 1 },
        { number: 2, minutes: 45, due: '2026-10-21', rank: 0 },
        { number: 1, minutes: 45, due: '2026-10-20', rank: 2 },
      ],
    });
    expect(out.blocks.map((b) => b.issueNumber)).toEqual([1, 2, 3, 4]);
    expect(hm(out.blocks[0].start)).toBe('09:00');
    // あいだを10分空ける
    expect(hm(out.blocks[1].start)).toBe('09:55');
  });

  it('長い仕事は1つの長さに分け、あいだを空ける', () => {
    const out = plan({ now: tokyo('2026-10-19', '08:00'), tasks: [{ number: 1, minutes: 100 }] });
    expect(out.blocks.map((b) => [hm(b.start), hm(b.end)])).toEqual([
      ['09:00', '09:45'], ['09:55', '10:40'], ['10:50', '11:00'],
    ]);
  });

  it('今より前には置かない。今は5分単位に切り上げる', () => {
    const out = plan({ now: tokyo('2026-10-19', '13:02'), tasks: [{ number: 1, minutes: 45 }] });
    expect(hm(out.blocks[0].start)).toBe('13:05');
  });

  it('ほかの予定と重ねない', () => {
    const out = plan({
      now: tokyo('2026-10-19', '08:00'),
      busy: [{ start: tokyo('2026-10-19', '09:30'), end: tokyo('2026-10-19', '12:00') }],
      tasks: [{ number: 1, minutes: 90 }],
    });
    // 9:00-9:30 は 45分に足りないので使わない
    expect(out.blocks.map((b) => hm(b.start))).toEqual(['12:00', '12:55']);
  });

  it('土日は入れない (選んだときだけ入れる)', () => {
    const fri = tokyo('2026-10-23', '17:30');
    const out = plan({ now: fri, tasks: [{ number: 1, minutes: 45 }] });
    expect(dayOf(out.blocks[0].start)).toBe('2026-10-26');
    const weekend = plan({ now: fri, weekend: true, tasks: [{ number: 1, minutes: 45 }] });
    expect(dayOf(weekend.blocks[0].start)).toBe('2026-10-24');
  });

  it('先の勤務日までで止め、入りきらないものを返す', () => {
    const out = plan({ now: tokyo('2026-10-19', '08:00'), days: 1, tasks: [{ number: 1, minutes: 9 * 60 }] });
    expect(out.blocks.every((b) => dayOf(b.start) === '2026-10-19')).toBe(true);
    expect(out.unplaced).toEqual([{ issueNumber: 1, minutes: expect.any(Number) }]);
  });

  it('期限までに入りきらないものは late。期限が先なら遅れではない', () => {
    const out = plan({
      now: tokyo('2026-10-19', '17:00'), days: 3,
      tasks: [
        { number: 1, minutes: 120, due: '2026-10-19' },
        { number: 2, minutes: 20 * 60, due: '2026-12-01' },
        { number: 3, minutes: 45, due: '2026-10-01' },
      ],
    });
    expect(out.late.sort()).toEqual([1, 3]);
  });

  it('上限より多くは置かない', () => {
    const out = plan({ now: tokyo('2026-10-19', '08:00'), maxBlocks: 3, tasks: [{ number: 1, minutes: 600 }] });
    expect(out.blocks).toHaveLength(3);
  });

  it('勤務の時間が読めなければ何も置かない', () => {
    expect(plan({ now: 0, hours: { start: 'x', end: '18:00' }, tasks: [{ number: 1, minutes: 45 }] }).blocks).toEqual([]);
  });
});

describe('でたらめな入力でも崩れない', () => {
  // 種から作る (落ちたときに同じ入力で再現できるように)
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  for (let seed = 1; seed <= 60; seed++) {
    it('種 ' + seed, () => {
      const r = rng(seed);
      const hoursList = [['08:00', '17:00'], ['09:00', '18:00'], ['10:00', '19:00'], ['09:30', '18:30']];
      const h = hoursList[Math.floor(r() * hoursList.length)];
      const now = tokyo('2026-10-19', '07:00') + Math.floor(r() * 7 * 24 * 60) * 60000;
      const busy = [];
      for (let i = 0; i < Math.floor(r() * 12); i++) {
        const s = now + Math.floor(r() * 6 * 24 * 60) * 60000;
        busy.push({ start: s, end: s + (15 + Math.floor(r() * 180)) * 60000 });
      }
      const tasks = [];
      for (let i = 0; i < 1 + Math.floor(r() * 8); i++) {
        const dueIn = Math.floor(r() * 10) - 2;
        tasks.push({ number: i + 1, minutes: 5 + Math.floor(r() * 400), rank: Math.floor(r() * 3),
          due: r() < 0.3 ? '' : dayOf(now + dueIn * 86400000) });
      }
      const blockMin = [25, 45, 60, 90][Math.floor(r() * 4)];
      const out = gas.calendarPlanBlocks({ tasks, busy, now, hours: { start: h[0], end: h[1] },
        weekend: r() < 0.3, blockMin, days: 1 + Math.floor(r() * 10) });
      const blocks = out.blocks;

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        expect(b.end).toBeGreaterThan(b.start);
        expect(b.end - b.start).toBeLessThanOrEqual(blockMin * 60000);
        expect(b.start).toBeGreaterThan(now);
        expect(hm(b.start) >= h[0]).toBe(true);
        expect(hm(b.end) <= h[1] || hm(b.end) === '00:00').toBe(true);
        expect(dayOf(b.start)).toBe(dayOf(b.end - 1));
        // 並んでいて重ならない。あいだにほかの予定が無ければ10分空けている
        if (i > 0) {
          const prev = blocks[i - 1];
          expect(b.start).toBeGreaterThanOrEqual(prev.end);
          const between = busy.some((x) => x.start < b.start && x.end > prev.end);
          if (!between && dayOf(prev.start) === dayOf(b.start)) {
            expect(b.start).toBeGreaterThanOrEqual(prev.end + 10 * 60000);
          }
        }
        for (const x of busy) expect(b.start < x.end && x.start < b.end).toBe(false);
      }
      expect(blocks.length).toBeLessThanOrEqual(40);
      // 同じ入力からは同じ並び
      expect(gas.calendarPlanBlocks({ tasks, busy, now, hours: { start: h[0], end: h[1] },
        weekend: false, blockMin, days: 3 }))
        .toEqual(gas.calendarPlanBlocks({ tasks, busy, now, hours: { start: h[0], end: h[1] },
          weekend: false, blockMin, days: 3 }));
      // 1つのやることの分は要る分を超えない
      tasks.forEach((t) => {
        const sum = blocks.filter((b) => b.issueNumber === t.number).reduce((n, b) => n + (b.end - b.start), 0);
        expect(sum).toBeLessThanOrEqual(Math.ceil(t.minutes / 5) * 5 * 60000);
      });
    });
  }
});
