// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture, ACH_EMPTY } from '../dom.js';
import { mount } from './mount.js';

/*
 * 操作の効果音 (js-sound)。自分の設定の sound.effects をオンにした人だけ。鳴らす場面は5つだけ
 * (完了・反映 / 断りの帯 / 実績 / 集中とポモドーロの終わり / 待つあいだに推しをなでた節目。最後のは oshi-wait-pat.test.js)。音源のファイルは持たず、画面の中で作る。
 * オフのあいだは AudioContext を作らない。人が押す前は鳴らさない。同じ音は1秒のうちに2回鳴らさない。
 */

const ON = { 'sound.effects': true, 'oshi.on': false };

/** 音の仕組みの疑似。作った数と、鳴らした音 (高さ・波の形・いちばん大きいところ) を覚える */
class FakeAudio {
  constructor() {
    this.currentTime = 0; this.state = 'running'; this.destination = {}; this.oscs = []; this.gains = [];
    FakeAudio.made.push(this);
  }
  createOscillator() {
    const osc = { type: 'sine', frequency: { setValueAtTime: (v) => { osc.freq = v; } }, connect() {}, disconnect() {},
      start(t) { osc.startAt = t; }, stop() { osc.stopped = true; } };
    this.oscs.push(osc);
    return osc;
  }
  createGain() {
    const p = { setValueAtTime() {}, linearRampToValueAtTime: (v) => { p.peak = v; }, exponentialRampToValueAtTime() {} };
    const g = { gain: p, connect() {}, disconnect() {} };
    this.gains.push(g);
    return g;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

function mountSound(values, over) {
  const v = values || {};
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
  }, over || {}));
}

const q = (sel) => document.querySelector(sel);
const oscs = () => FakeAudio.made.flatMap((c) => c.oscs);
const freqs = () => oscs().map((o) => o.freq);

/** やることの一覧を開いて、最初のやることの「完了にする」を押す (押すこと自体が「人の操作」になる) */
function closeFirst() {
  q('[data-tab="issues"]').click();
  q('#issue-list [aria-label$="を完了にする"]').click();
}

describe('操作の効果音', () => {
  let saved;
  let savedWebkit;
  beforeEach(() => {
    window.localStorage.clear();
    FakeAudio.made = [];
    saved = window.AudioContext;
    savedWebkit = window.webkitAudioContext;
    window.AudioContext = FakeAudio;
  });
  afterEach(() => {
    window.AudioContext = saved;
    window.webkitAudioContext = savedWebkit;
    vi.restoreAllMocks();
  });

  it('設定をオンにすると、やることを完了にしたあとに上がる3音が小さく鳴る', () => {
    const app = mountSound(ON);
    closeFirst();
    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
    expect(FakeAudio.made.length).toBe(1);
    expect(freqs()).toEqual([523.25, 659.25, 783.99]);
    // 上がっていく
    expect(freqs().every((f, i, a) => i === 0 || f > a[i - 1])).toBe(true);
    // 小さく (0.1 まで)
    const peaks = FakeAudio.made[0].gains.map((g) => g.gain.peak);
    expect(peaks.every((p) => p > 0 && p <= 0.1)).toBe(true);
  });

  it('既定 (オフ) では、押しても完了にしても AudioContext を作らない', () => {
    const app = mountSound({ 'oshi.on': false });
    document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    closeFirst();
    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
    expect(FakeAudio.made.length).toBe(0);
  });

  it('設定の画面の「音」の見出しの下に、自分の設定のトグルとして出る (既定はオフ)', () => {
    mountSound({ 'oshi.on': false });
    q('.nav-item[data-tab="settings"]').click();
    const box = q('[data-pref="sound.effects"]');
    expect(box).toBeTruthy();
    expect(box.closest('.settings-section').querySelector('h3').textContent).toBe('音');
    expect(box.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('false');
  });

  it('断られたら (失敗の帯)、低く短い音を1回だけ鳴らす。お祝いの音は鳴らさない', () => {
    mountSound(ON, { apiIssueClose: new Error('混み合っています') });
    closeFirst();
    expect(q('#snackbar')).toBeTruthy();
    expect(oscs().length).toBe(1);
    expect(freqs()[0]).toBeLessThan(300);
  });

  it('黙ってよい失敗 (failQuiet) では鳴らさない', () => {
    // 開いたときの実績の数え直しは failQuiet。押したあとに数え直して断られても鳴らさない
    mountSound(ON, { apiAchievementsCheck: new Error('混み合っています') });
    closeFirst();
    // 完了の3音だけ (断りの低い音は無い)
    expect(freqs()).toEqual([523.25, 659.25, 783.99]);
  });

  it('同じ音は1秒のうちに2回鳴らさない。1秒たてばまた鳴る', () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mountSound(ON, { apiIssueClose: new Error('混み合っています') });
    closeFirst();
    q('#issue-list [aria-label$="を完了にする"]').click();
    expect(oscs().length).toBe(1);
    now += 999;
    q('#issue-list [aria-label$="を完了にする"]').click();
    expect(oscs().length).toBe(1);
    now += 2;
    q('#issue-list [aria-label$="を完了にする"]').click();
    expect(oscs().length).toBe(2);
    // 音の仕組みは1つを使い回す
    expect(FakeAudio.made.length).toBe(1);
  });

  it('人が押す前は鳴らさない (開いたときに取った実績)。押したあとに取った実績は作業部屋の合図の形 (上がる2音) で鳴る', () => {
    const got = Object.assign({}, ACH_EMPTY, { level: 2, got: 1,
      newly: [{ key: 'days-1', title: 'はじめの一日', icon: 'star' }] });
    mountSound(ON, { apiAchievementsCheck: () => got });
    // 開いたときに取った (まだ誰も押していない) ので鳴らさないし、作らない
    expect(document.querySelector('.ach-toast, [class*="ach-toast"]')).toBeTruthy();
    expect(FakeAudio.made.length).toBe(0);
    closeFirst();
    // 完了の3音のあとに、実績の2音 (1046.5 → ではなく 784 → 1046.5 と上がる)
    expect(freqs()).toEqual([523.25, 659.25, 783.99, 784, 1046.5]);
  });

  it('AudioContext が無い環境でも、完了は済み帯も出る', () => {
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
    const app = mountSound(ON);
    closeFirst();
    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
    expect(q('#snackbar').textContent).toContain('を完了にしました');
  });

  it('AudioContext を作ると投げる環境でも、完了は済み帯も出る (二度と作りに行かない)', () => {
    let tried = 0;
    window.AudioContext = function () { tried += 1; throw new Error('not allowed'); };
    const app = mountSound(ON);
    closeFirst();
    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
    expect(q('#snackbar').textContent).toContain('を完了にしました');
    q('#issue-list [aria-label$="を完了にする"]').click();
    expect(tried).toBe(1);
  });

  it('鳴らすときに投げても (音の仕組みが壊れている)、完了は済む', () => {
    window.AudioContext = class extends FakeAudio { createOscillator() { throw new Error('broken'); } };
    const app = mountSound(ON);
    closeFirst();
    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
    expect(q('#snackbar').textContent).toContain('を完了にしました');
  });
});
