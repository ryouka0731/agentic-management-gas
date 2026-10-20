import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

/*
 * 集中のしかたの、画面に依らない計算 (js-focus)。画面の JS から原文のまま切り出して動かす。
 * 音は jsdom では鳴らせないので、AudioBuffer に描く標本の形をここで確かめる。
 */

const f = ui([
  'focusClampMinutes', 'focusRemainingMs', 'focusMinutesLeft', 'focusRingOffset', 'focusTitleOf',
  'focusRemindMarks', 'focusVolumeGain', 'focusClampBpm', 'focusSamplesPerBeat', 'focusKickFreq',
  'focusKickEnv', 'focusRenderKick', 'focusNormalize', 'focusRenderBar', 'focusLoopSeam', 'focusRenderNoise',
], { FOCUS_GAIN_MAX: 0.5 });

/** 決まった並びの乱数 (確かめるたびに同じ音になる) */
function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const energy = (a, from, to) => {
  let e = 0;
  for (let i = from; i < to; i++) e += a[i] * a[i];
  return e;
};

describe('時間', () => {
  it('長さは1〜180の整数だけ', () => {
    expect([0, 1, 25, 180, 181, 2.5, 'x', '30'].map(f.focusClampMinutes)).toEqual([0, 1, 25, 180, 0, 0, 0, 30]);
  });

  it('残りは時刻の差で数え、延ばしたぶんを足す。分は切り上げ、過ぎたら0', () => {
    const start = 1000000;
    expect(f.focusRemainingMs(start, 25, 0, start + 60000)).toBe(24 * 60000);
    expect(f.focusRemainingMs(start, 25, 10, start + 25 * 60000)).toBe(10 * 60000);
    expect(f.focusMinutesLeft(24 * 60000 + 1)).toBe(25);
    expect(f.focusMinutesLeft(-5)).toBe(0);
  });

  it('輪は残りが減るほど欠ける。始めは欠けず、終わりで一周ぶん', () => {
    expect(f.focusRingOffset(100, 100, 300)).toBe(0);
    expect(f.focusRingOffset(25, 100, 300)).toBe(225);
    expect(f.focusRingOffset(-10, 100, 300)).toBe(300);
    expect(f.focusRingOffset(10, 0, 300)).toBe(300);
  });

  it('タブの題名に残りを前置きする', () => {
    expect(f.focusTitleOf('SoftBanto', 90000)).toBe('残り2分 · SoftBanto');
    expect(f.focusTitleOf('SoftBanto', 0)).toBe('時間です · SoftBanto');
  });

  it('時間の知らせの回数。間隔が無ければ0', () => {
    expect(f.focusRemindMarks(29 * 60000, 30)).toBe(0);
    expect(f.focusRemindMarks(61 * 60000, 30)).toBe(2);
    expect(f.focusRemindMarks(61 * 60000, 0)).toBe(0);
  });
});

describe('音の形', () => {
  it('大きさには上限がある (上げきっても半分まで)', () => {
    expect(f.focusVolumeGain(1)).toBe(0.5);
    expect(f.focusVolumeGain(5)).toBe(0.5);
    expect(f.focusVolumeGain(-1)).toBe(0);
    expect(f.focusVolumeGain('x')).toBe(0);
  });

  it('BPM は 120〜150 に収め、1拍の標本の数にする', () => {
    expect(f.focusClampBpm(100)).toBe(120);
    expect(f.focusClampBpm(200)).toBe(150);
    expect(f.focusClampBpm('x')).toBe(128);
    expect(f.focusSamplesPerBeat(120, 48000)).toBe(24000);
    expect(f.focusSamplesPerBeat(150, 48000)).toBe(19200);
  });

  it('キックは高い音から低い音へすぐ落ちる (低音の重さ)', () => {
    expect(f.focusKickFreq(0)).toBe(150);
    expect(f.focusKickFreq(0.2)).toBeLessThan(46);
    expect(f.focusKickFreq(0.05)).toBeGreaterThan(f.focusKickFreq(0.1));
  });

  it('キックの包みは2ミリ秒で立ち上がり、減っていく', () => {
    expect(f.focusKickEnv(-0.1)).toBe(0);
    expect(f.focusKickEnv(0)).toBe(0);
    expect(f.focusKickEnv(0.002)).toBeCloseTo(Math.exp(-0.014), 6);
    expect(f.focusKickEnv(0.3)).toBeLessThan(f.focusKickEnv(0.05));
  });

  it('1小節は4拍ぶん。拍の頭ごとにキックがあり、割れない (いちばん大きいところが 0.9)', () => {
    const rate = 8000;
    const bar = f.focusRenderBar({ kind: 'beat', bpm: 120, hat: false }, rate, seeded(1));
    const beat = f.focusSamplesPerBeat(120, rate);
    expect(bar.length).toBe(beat * 4);
    expect(peak(bar)).toBeCloseTo(0.9, 5);
    // 拍の頭のすぐあとは強く、拍の終わりは静か
    for (let k = 0; k < 4; k++) {
      const head = energy(bar, k * beat, k * beat + 400);
      const tail = energy(bar, k * beat + beat - 400, k * beat + beat);
      expect(head).toBeGreaterThan(tail * 20);
    }
  });

  it('ハイハットは裏拍に足す。ユーロビート風は裏拍にベースと2・4拍の手拍子も入る', () => {
    const rate = 8000;
    const beat = f.focusSamplesPerBeat(128, rate);
    const half = Math.round(beat / 2);
    const plain = f.focusRenderBar({ kind: 'beat', bpm: 128, hat: false }, rate, seeded(2));
    const hat = f.focusRenderBar({ kind: 'beat', bpm: 128, hat: true }, rate, seeded(2));
    const euro = f.focusRenderBar({ kind: 'euro', bpm: 128, hat: false }, rate, seeded(2));
    const offbeat = (a) => energy(a, half, half + 200) / energy(a, 0, a.length);
    expect(offbeat(hat)).toBeGreaterThan(offbeat(plain));
    expect(offbeat(euro)).toBeGreaterThan(offbeat(plain));
    // 同じ乱数なら同じ音
    expect(Array.from(f.focusRenderBar({ kind: 'euro', bpm: 128 }, rate, seeded(3))))
      .toEqual(Array.from(f.focusRenderBar({ kind: 'euro', bpm: 128 }, rate, seeded(3))));
  });

  it('ノイズは繰り返しの継ぎ目をなめらかにし、割れない。ブラウンはピンクより低い音が多い', () => {
    const rate = 8000;
    const pink = f.focusRenderNoise('pink', rate, 2, seeded(4));
    const brown = f.focusRenderNoise('brown', rate, 2, seeded(4));
    expect(pink.length).toBe(2 * rate - rate * 0.05);
    expect(peak(pink)).toBeCloseTo(0.8, 5);
    expect(peak(brown)).toBeCloseTo(0.8, 5);
    // 隣どうしの差が小さいほど低い音が多い
    const roughness = (a) => {
      let d = 0;
      for (let i = 1; i < a.length; i++) d += Math.abs(a[i] - a[i - 1]);
      return d / a.length;
    };
    expect(roughness(brown)).toBeLessThan(roughness(pink));
    // 継ぎ目 (最後 → 最初) の段差が、ふつうの隣どうしの差の数倍に収まる
    expect(Math.abs(pink[pink.length - 1] - pink[0])).toBeLessThan(roughness(pink) * 8);
  });

  it('継ぎ目を重ねると、重ねたぶん短くなる。重ねる数が0なら変えない', () => {
    const data = new Float32Array([1, 1, 1, 1, 0, 0]);
    const out = f.focusLoopSeam(data, 2);
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1]);
    expect(f.focusLoopSeam(data, 0)).toBe(data);
  });
});
