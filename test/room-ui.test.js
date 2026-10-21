import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

/*
 * 作業部屋の、画面に依らない計算 (js-room)。画面の JS から原文のまま切り出して動かす。
 * 音は jsdom では鳴らせないので、AudioBuffer に描く標本の形をここで確かめる。
 */

const RENDERERS = ['roomRenderRain', 'roomRenderKeys', 'roomRenderFire', 'roomRenderWind', 'roomRenderCafe'];

const r = ui([
  'ROOM_SOUNDS', 'roomClamp01', 'roomMasterGain', 'roomMixDefault', 'roomMixClean', 'roomPhaseOf', 'roomPhaseLabel',
  'roomNoise', 'roomBiquad', 'roomFilter', 'roomSmoothPoints', 'roomSmoothAt', 'roomPut', 'roomPing', 'roomClick',
  'roomKeyStroke', 'roomRender', 'focusNormalize', 'focusLoopSeam',
].concat(RENDERERS), { ROOM_GAIN_MAX: 0.5 });

/** 決まった並びの乱数 (確かめるたびに同じ音になる) */
function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a, from, to) => {
  let e = 0;
  for (let i = from; i < to; i++) e += a[i] * a[i];
  return Math.sqrt(e / (to - from));
};
const RATE = 8000;

describe('混ぜ方', () => {
  it('流せる音は5つ。最初は雨だけがオン', () => {
    expect(r.ROOM_SOUNDS().map((s) => s.label)).toEqual(['雨', 'キーボード', 'たき火', '風', 'カフェのざわめき']);
    const d = r.roomMixDefault();
    expect(Object.keys(d.sounds).filter((k) => d.sounds[k].on)).toEqual(['rain']);
    r.ROOM_SOUNDS().forEach((s) => expect(s.seconds).toBeGreaterThanOrEqual(20));
  });

  it('覚えた混ぜ方を読める形にそろえる。知らない音は捨て、欠けた音と読めない値は既定', () => {
    const got = r.roomMixClean({ master: 3, sounds: { keys: { on: true, volume: 0.2 }, fire: { on: 'yes', volume: 'x' },
      __proto__: { on: true }, bogus: { on: true } } });
    expect(got.master).toBe(1);
    expect(got.sounds.keys).toEqual({ on: true, volume: 0.2 });
    expect(got.sounds.fire).toEqual({ on: false, volume: 0.5 });
    expect(got.sounds.rain).toEqual({ on: true, volume: 0.6 });
    expect(Object.keys(got.sounds)).toEqual(['rain', 'keys', 'fire', 'wind', 'cafe']);
    expect(r.roomMixClean(null)).toEqual(r.roomMixDefault());
    expect(r.roomMixClean([1, 2])).toEqual(r.roomMixDefault());
    expect(r.roomMixClean({ master: null }).master).toBe(0.6);
  });

  it('全体の大きさは上限を超えない', () => {
    expect([0, 0.5, 1, 9, -1, 'x'].map(r.roomMasterGain)).toEqual([0, 0.25, 0.5, 0.5, 0, 0]);
  });

  it('窓の外は時刻で朝・昼・夕方・夜', () => {
    expect([4, 5, 9, 10, 15, 16, 18, 19, 23, 0].map(r.roomPhaseOf))
      .toEqual(['night', 'morning', 'morning', 'day', 'day', 'evening', 'evening', 'night', 'night', 'night']);
    expect(r.roomPhaseLabel('evening')).toBe('夕方');
  });
});

describe('音の形', () => {
  for (const name of RENDERERS) {
    it(name + ': 決めた長さ・-1〜1・NaN が無い・同じ乱数なら同じ音・無音ではない', () => {
      const a = r[name](RATE, 3, seeded(7));
      const b = r[name](RATE, 3, seeded(7));
      const c = r[name](RATE, 3, seeded(8));
      expect(a.length).toBe(RATE * 3);
      expect(a.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(a)).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(peak(a)).toBeGreaterThan(0.5);
      expect(Array.from(a)).toEqual(Array.from(b));
      expect(Array.from(a)).not.toEqual(Array.from(c));
    });
  }

  it('繰り返しの継ぎ目で大きく跳ねない (終わりと頭の差が、ふだんの隣どうしの差と同じくらい)', () => {
    for (const name of ['roomRenderRain', 'roomRenderWind', 'roomRenderCafe']) {
      const a = r[name](RATE, 3, seeded(3));
      let typical = 0;
      for (let i = 1; i < a.length; i++) typical = Math.max(typical, Math.abs(a[i] - a[i - 1]));
      expect(Math.abs(a[0] - a[a.length - 1]), name).toBeLessThanOrEqual(typical);
    }
  });

  it('キーボードは打つ・止めるをくり返す (静かなところと打っているところがある)', () => {
    const a = r.roomRenderKeys(RATE, 12, seeded(11));
    const win = RATE / 4;
    const levels = [];
    for (let i = 0; i + win <= a.length; i += win) levels.push(rms(a, i, i + win));
    const loud = Math.max(...levels);
    expect(levels.filter((l) => l < loud * 0.1).length).toBeGreaterThan(2);
    expect(levels.filter((l) => l > loud * 0.3).length).toBeGreaterThan(2);
  });

  it('風は強弱がゆっくり揺れる (いつも同じ大きさではない)', () => {
    const a = r.roomRenderWind(RATE, 10, seeded(5));
    const win = RATE / 2;
    const levels = [];
    for (let i = 0; i + win <= a.length; i += win) levels.push(rms(a, i, i + win));
    expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(1.5);
  });

  it('知らない音は描かない', () => {
    expect(r.roomRender('rain', RATE, 1, seeded(1)).length).toBe(RATE);
    expect(r.roomRender('speech', RATE, 1, seeded(1))).toBe(null);
  });

  it('フィルタは帯の外を下げる (低い帯を通すと、高い音が小さくなる)', () => {
    const tone = (f) => Float32Array.from({ length: RATE }, (_, i) => Math.sin(2 * Math.PI * f * i / RATE));
    const lp = r.roomBiquad('lowpass', 300, 0.7, RATE);
    expect(rms(r.roomFilter(tone(100), lp), 1000, RATE)).toBeGreaterThan(0.6);
    expect(rms(r.roomFilter(tone(3000), r.roomBiquad('lowpass', 300, 0.7, RATE)), 1000, RATE)).toBeLessThan(0.05);
  });

  it('ゆっくり揺れる値は 0〜1 で、一周すると頭に戻る', () => {
    const p = r.roomSmoothPoints(5, seeded(2));
    expect(r.roomSmoothAt(p, 0)).toBeCloseTo(r.roomSmoothAt(p, 1), 10);
    for (let x = 0; x < 1; x += 0.01) {
      const v = r.roomSmoothAt(p, x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('重ねた音ははみ出したぶん頭へ回り込む', () => {
    const out = new Float32Array(10);
    r.roomPut(out, 8, Float32Array.from([1, 2, 3, 4]), 1);
    expect(Array.from(out)).toEqual([3, 4, 0, 0, 0, 0, 0, 0, 1, 2]);
  });
});
