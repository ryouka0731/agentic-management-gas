// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * 画面の中だけで起きること (作業部屋を開いた・音を流した・推しの頭をなでた・下書きを差し込んだ・ボードで動かした) を、
 * 既にある使われ方の記録 (usageCount → apiUsageRecord) に乗せて数え、送ったあとに実績を数え直す。
 * 実績のための api は呼ばない。
 */

const STATES = ['idle', 'praise', 'celebrate', 'cheer', 'worry', 'sleepy', 'surprise', 'grow1', 'grow2', 'grow3', 'work'];
const OSHI = Object.assign({}, DEFAULTS.apiOshiGet, {
  states: STATES.map((k) => ({ key: k, label: k })),
  events: [{ key: 'pat', label: 'なでられた', state: 'praise', lines: ['うれしい！'], mine: [] }],
});
const img = (a, b, c) => 'data:image/webp;base64,' + Buffer.from(a + ':' + b + ':' + c).toString('base64');

class FakeAudio {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  createBuffer(ch, len) { const d = new Float32Array(len); return { len, getChannelData: () => d }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
  createGain() {
    const p = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} };
    return { gain: p, connect() {}, disconnect() {} };
  }
  resume() {} suspend() {} close() {}
}

function mountWith(values, over) {
  const v = Object.assign({ 'oshi.on': true, 'room.on': true }, values || {});
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
    apiOshiGet: OSHI,
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: img(char, style, state) }),
  }, over || {}));
}

/** 溜めた使われ方を送らせ、送った行 (kind:target → 回数) を返す */
function flushUsage(app) {
  window.dispatchEvent(new window.Event('pagehide'));
  const sent = {};
  app.calls.filter((c) => c.name === 'apiUsageRecord').forEach((c) => {
    c.args[0].forEach((r) => { sent[r.kind + ':' + r.target] = (sent[r.kind + ':' + r.target] || 0) + r.count; });
  });
  return sent;
}
const rechecked = (app) => app.calls.filter((c) => c.name === 'apiAchievementsCheck' && c.args[0])
  .flatMap((c) => c.args[0].metrics);

function stroke(fig) {
  fig.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200 });
  const move = (x, y) => fig.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  move(20, 40); move(80, 40); move(20, 40); move(80, 40);
}

describe('画面の中だけで起きることを、使われ方として数える', () => {
  let saved;
  beforeEach(() => {
    window.localStorage.clear();
    saved = window.AudioContext;
  });
  afterEach(() => {
    window.AudioContext = saved;
    vi.useRealTimers();
  });

  it('作業部屋: 開いた・音を流した・頭をなでた を数え、送ったあとに部屋と推しの実績を数え直す', () => {
    window.AudioContext = FakeAudio;
    const app = mountWith();
    document.getElementById('me-btn').click();
    document.querySelector('.room-open-btn').click();
    const room = document.getElementById('room');
    vi.useFakeTimers();
    stroke(room.querySelector('.room-oshi'));
    // 笑顔のあいだになでても数えない
    stroke(room.querySelector('.room-oshi'));
    room.querySelector('.room-play').click();
    const sent = flushUsage(app);
    expect(sent['action:room-open']).toBe(1);
    expect(sent['action:oshi-pat']).toBe(1);
    expect(sent['action:room-sound']).toBe(1);
    expect(rechecked(app)).toEqual(expect.arrayContaining(['room', 'rooms', 'pat', 'pats', 'roomSound']));
  });

  it('作業部屋: 推しがオフの人影はなでても数えない', () => {
    const app = mountWith({ 'oshi.on': false });
    document.getElementById('me-btn').click();
    document.querySelector('.room-open-btn').click();
    stroke(document.getElementById('room').querySelector('.room-oshi'));
    expect(flushUsage(app)['action:oshi-pat']).toBeUndefined();
  });

  it('推しの頁: 「なでる」でも頭をなでても数える', () => {
    const app = mountWith();
    document.getElementById('me-btn').click();
    [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
    vi.useFakeTimers();
    document.querySelector('.oshi-pat').click();
    vi.advanceTimersByTime(5000);
    stroke(document.querySelector('.oshi-hero-figure'));
    expect(flushUsage(app)['action:oshi-pat']).toBe(2);
  });

  it('下書き (ひな形) を差し込むと template-use と数える (押した場所の data-track)', () => {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    document.querySelector('.template-use').click();
    expect(flushUsage(app)['action:template-use']).toBe(1);
    expect(rechecked(app)).toContain('template');
  });

  it('進捗ボードでカードを動かせたら board-move と数える (動かせなかったら数えない)', () => {
    const BOARD = { Backlog: [], 'In Progress': [], 'In Review': [], Done: [] };
    const ok = mount({ apiProjectBoard: BOARD, apiIssueCreate: { number: 9, title: 'x' } });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    const add = (title) => {
      const col = document.querySelectorAll('.board-column')[1];
      col.querySelector('.board-add').click();
      const form = col.querySelector('.board-composer');
      form.querySelector('input').value = title;
      form.querySelector('input').dispatchEvent(new window.Event('input'));
      form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    };
    add('思い付き');
    expect(flushUsage(ok)['action:board-move']).toBe(1);
    const ng = mount({ apiProjectBoard: BOARD, apiIssueCreate: { number: 9, title: 'x' }, apiProjectMove: new Error('混み合っています') });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    add('思い付き');
    expect(flushUsage(ng)['action:board-move']).toBeUndefined();
  });
});
