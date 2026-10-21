import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

/*
 * 作業部屋の、画面に依らない計算 (js-room)。画面の JS から原文のまま切り出して動かす。
 * 音は jsdom では鳴らせないので、AudioBuffer に描く標本の形をここで確かめる。
 */

const RENDERERS = ['roomRenderRain', 'roomRenderKeys', 'roomRenderFire', 'roomRenderWind', 'roomRenderCafe', 'roomRenderMouse'];
const KINDS = ['red', 'blue', 'membrane', 'laptop'];

const r = ui([
  'ROOM_SOUNDS', 'roomClamp01', 'roomMasterGain', 'roomMixDefault', 'roomMixClean', 'roomPhaseOf', 'roomPhaseLabel',
  'roomNoise', 'roomBiquad', 'roomFilter', 'roomSmoothPoints', 'roomSmoothAt', 'roomPut', 'roomPing', 'roomClick',
  'roomKeyStroke', 'roomRender', 'roomRenderSteps', 'roomRunSteps', 'roomSpan', 'roomStepsRain', 'roomStepsKeys', 'roomStepsFire', 'roomStepsWind', 'roomStepsCafe', 'focusNormalize', 'focusLoopSeam',
  'ROOM_KEYS_KINDS', 'roomKeysKindClean', 'roomKeysTone', 'roomThud', 'roomMousePlan', 'roomStepsMouse',
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
  it('流せる音は6つ。最初は雨だけがオン。キーボードは赤軸、マウスは 0.4', () => {
    expect(r.ROOM_SOUNDS().map((s) => s.label)).toEqual(['雨', 'キーボード', 'たき火', '風', 'カフェのざわめき', 'マウス']);
    const d = r.roomMixDefault();
    expect(Object.keys(d.sounds).filter((k) => d.sounds[k].on)).toEqual(['rain']);
    r.ROOM_SOUNDS().forEach((s) => expect(s.seconds).toBeGreaterThanOrEqual(20));
    // カフェは声らしいものを6つ重ねるので、低い標本の数で描く (描く手間を減らす)
    expect(r.ROOM_SOUNDS().map((s) => s.rate)).toEqual([24000, 24000, 24000, 24000, 12000, 24000]);
    expect(d.keysKind).toBe('red');
    expect(d.sounds.mouse).toEqual({ on: false, volume: 0.4 });
    expect(r.ROOM_KEYS_KINDS().map((k) => k.key)).toEqual(KINDS);
    expect(r.ROOM_KEYS_KINDS().map((k) => k.label)).toEqual(['赤軸 (リニア)', '青軸 (カチカチ)', 'メンブレン', 'ノートパソコン']);
  });

  it('キーボードの種類は覚えたものを使い、知らない種類・無いときは赤軸', () => {
    expect(r.roomMixClean({ keysKind: 'blue' }).keysKind).toBe('blue');
    expect(r.roomMixClean({ keysKind: 'laptop' }).keysKind).toBe('laptop');
    for (const bad of ['brown', '', null, 3, { k: 1 }, undefined]) expect(r.roomMixClean({ keysKind: bad }).keysKind).toBe('red');
    // 種類を持っていなかった以前の覚え方も読める
    expect(r.roomMixClean({ master: 0.3, sounds: { keys: { on: true, volume: 0.2 } } }).keysKind).toBe('red');
  });

  it('覚えた混ぜ方を読める形にそろえる。知らない音は捨て、欠けた音と読めない値は既定', () => {
    const got = r.roomMixClean({ master: 3, sounds: { keys: { on: true, volume: 0.2 }, fire: { on: 'yes', volume: 'x' },
      __proto__: { on: true }, bogus: { on: true } } });
    expect(got.master).toBe(1);
    expect(got.sounds.keys).toEqual({ on: true, volume: 0.2 });
    expect(got.sounds.fire).toEqual({ on: false, volume: 0.5 });
    expect(got.sounds.rain).toEqual({ on: true, volume: 0.6 });
    expect(Object.keys(got.sounds)).toEqual(['rain', 'keys', 'fire', 'wind', 'cafe', 'mouse']);
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

  for (const kind of KINDS) {
    it('キーボード ' + kind + ': 決めた長さ・-1〜1・NaN が無い・同じ乱数なら同じ音', () => {
      const a = r.roomRenderKeys(RATE, 3, seeded(7), kind);
      expect(a.length).toBe(RATE * 3);
      expect(a.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(a)).toBeLessThanOrEqual(0.8 + 1e-6);
      expect(peak(a)).toBeGreaterThan(0.5);
      expect(Array.from(a)).toEqual(Array.from(r.roomRenderKeys(RATE, 3, seeded(7), kind)));
    });
  }

  describe('キーボードの種類ごとに別の音', () => {
    const HI = 24000; // 高い帯を比べるので、画面と同じ標本の数で描く
    const energy = (a) => a.reduce((e, v) => e + v * v, 0);
    /** 2.5kHz より上の成分の割合 */
    const highShare = (a) => energy(r.roomFilter(Float32Array.from(a), r.roomBiquad('highpass', 2500, 0.7, HI))) / energy(a);
    /** 1打だけを描いて、最大の 10% を超えている長さ (ms) */
    const strokeMs = (kind) => {
      const one = new Float32Array(HI / 2);
      r.roomKeyStroke(one, 100, HI, seeded(3), false, kind);
      const p = peak(one);
      let first = -1, last = -1;
      one.forEach((v, i) => { if (Math.abs(v) > p * 0.1) { if (first < 0) first = i; last = i; } });
      return (last - first) / HI * 1000;
    };
    const render = (kind) => r.roomRenderKeys(HI, 4, seeded(7), kind);

    it('同じ乱数でも種類が違えば別の音', () => {
      const all = KINDS.map((k) => Array.from(r.roomRenderKeys(RATE, 2, seeded(5), k)));
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) expect(all[i], KINDS[i] + ' / ' + KINDS[j]).not.toEqual(all[j]);
      }
      // 知らない種類・無しは赤軸と同じ
      expect(Array.from(r.roomRenderKeys(RATE, 2, seeded(5), 'brown'))).toEqual(all[0]);
      expect(Array.from(r.roomRenderKeys(RATE, 2, seeded(5)))).toEqual(all[0]);
      expect(Array.from(r.roomRender('keys', RATE, 2, seeded(5), 'blue'))).toEqual(all[1]);
    });

    it('青軸は高い帯 (2.5kHz より上) の割合が、メンブレン・赤軸よりずっと大きい', () => {
      const blue = highShare(render('blue'));
      expect(blue).toBeGreaterThan(highShare(render('membrane')) * 4);
      expect(blue).toBeGreaterThan(highShare(render('red')) * 4);
    });

    it('メンブレンは赤軸より小さく、青軸がいちばん大きい', () => {
      const p = Object.fromEntries(KINDS.map((k) => [k, peak(render(k))]));
      expect(p.membrane).toBeLessThan(p.red);
      expect(p.laptop).toBeLessThan(p.red);
      expect(p.blue).toBeGreaterThan(p.red);
    });

    it('ノートパソコンの1打は、ほかのどれより短い。メンブレンは離した音が無いので赤軸・青軸より短い', () => {
      const ms = Object.fromEntries(KINDS.map((k) => [k, strokeMs(k)]));
      expect(ms.laptop).toBeLessThan(ms.membrane);
      expect(ms.laptop).toBeLessThan(5);
      expect(ms.membrane).toBeLessThan(ms.red);
      expect(ms.membrane).toBeLessThan(ms.blue);
      // 赤軸・青軸は離した音 (50〜90ms あと) まで届く
      expect(ms.red).toBeGreaterThan(40);
      expect(ms.blue).toBeGreaterThan(40);
    });

    it('ノートパソコンは打つ間隔が少し速い', () => {
      expect(r.roomKeysTone('laptop').gap[0]).toBeLessThan(r.roomKeysTone('red').gap[0]);
      expect(r.roomKeysTone('laptop').gap[1]).toBeLessThan(r.roomKeysTone('red').gap[1]);
    });
  });

  describe('マウス', () => {
    const plan = r.roomMousePlan(120, seeded(4));
    it('クリックは押す・離すの2つで、間は 60〜90ms', () => {
      const presses = plan.filter((e) => e.kind === 'press');
      expect(presses.length).toBeGreaterThan(20);
      for (const p of presses) {
        const rel = plan[plan.indexOf(p) + 1];
        expect(rel.kind).toBe('release');
        expect(rel.at - p.at).toBeGreaterThanOrEqual(0.06);
        expect(rel.at - p.at).toBeLessThanOrEqual(0.09 + 1e-9);
      }
      expect(plan.filter((e) => e.kind === 'release').length).toBe(presses.length);
    });

    it('ときどきダブルクリック、ときどきホイール (30ms おきに3〜8個)。操作の間は 0.6〜4秒', () => {
      // 操作のまとまり: 前の音から 0.5秒より空いたら次のまとまり
      const groups = [];
      plan.forEach((e, i) => {
        if (i === 0 || e.at - plan[i - 1].at > 0.5) groups.push([]);
        groups[groups.length - 1].push(e);
      });
      const doubles = groups.filter((g) => g.filter((e) => e.kind === 'press').length === 2);
      const wheels = groups.filter((g) => g.every((e) => e.kind === 'wheel'));
      expect(doubles.length).toBeGreaterThan(0);
      expect(wheels.length).toBeGreaterThan(0);
      expect(doubles.length + wheels.length).toBeLessThan(groups.length / 2);
      for (const g of wheels) {
        expect(g.length).toBeGreaterThanOrEqual(3);
        expect(g.length).toBeLessThanOrEqual(8);
        for (let i = 1; i < g.length; i++) expect(g[i].at - g[i - 1].at).toBeCloseTo(0.03, 6);
      }
      for (let i = 1; i < groups.length; i++) {
        const gap = groups[i][0].at - groups[i - 1][0].at;
        expect(gap).toBeGreaterThanOrEqual(0.6);
        expect(gap).toBeLessThanOrEqual(4);
      }
      expect(plan.every((e, i) => i === 0 || e.at >= plan[i - 1].at)).toBe(true);
    });

    it('クリックは鋭く短い (鳴っている時間はわずかで、ほとんど静か)', () => {
      const a = r.roomRenderMouse(24000, 10, seeded(6));
      const loud = a.filter((v) => Math.abs(v) > 0.1).length;
      expect(loud / a.length).toBeLessThan(0.01);
      expect(peak(a)).toBeGreaterThan(0.5);
    });
  });

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

  it('描く手順は刻みに分かれていて、順に走らせると一度に描いたものと同じ音になる', () => {
    for (const s of r.ROOM_SOUNDS()) {
      const steps = r.roomRenderSteps(s.key, RATE, 3, seeded(9));
      expect(steps.length, s.key).toBeGreaterThan(3);
      let out;
      steps.forEach((fn) => { out = fn(); });
      expect(Array.from(out), s.key).toEqual(Array.from(r.roomRender(s.key, RATE, 3, seeded(9))));
    }
    expect(r.roomRenderSteps('speech', RATE, 1, seeded(1))).toBe(null);
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
