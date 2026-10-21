// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * 作業部屋 (js-room)。自分の設定の room.on をオンにした人の画面にだけ出す。
 * 音は画面の中で作り、押したときにだけ鳴らす。集中の音・自分の曲とは同時に流さない。
 */

const ON = { 'room.on': true };
const STATES = ['idle', 'praise', 'celebrate', 'cheer', 'worry', 'sleepy', 'surprise', 'grow1', 'grow2', 'grow3', 'work'];
const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');
const OSHI = Object.assign({}, DEFAULTS.apiOshiGet, {
  states: STATES.map((k) => ({ key: k, label: k })),
  // 頭をなでたときのせりふ (場面 pat)
  events: [{ key: 'pat', label: 'なでられた', state: 'praise', lines: ['なでられた！うれしい！'], mine: [] }],
});

/** 音の仕組みの疑似。作った数・描いた長さ・鳴らした・止めたを覚える */
class FakeAudio {
  constructor() {
    this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sources = [];
    FakeAudio.made.push(this);
  }
  createBuffer(ch, len, rate) { const d = new Float32Array(len); return { len, rate, getChannelData: () => d }; }
  createBufferSource() {
    const src = { connect() {}, start(t, off) { src.started = true; src.offset = off; }, stop() { src.stopped = true; } };
    this.sources.push(src);
    this.src = src;
    return src;
  }
  suspend() { this.state = 'suspended'; }
  resume() { this.state = 'running'; }
  close() { this.state = 'closed'; this.closed = true; }
  createGain() {
    const p = { value: 0, setValueAtTime() {}, linearRampToValueAtTime: (v) => { p.last = v; }, cancelScheduledValues() {},
      setTargetAtTime: (v) => { p.last = v; } };
    const g = { gain: p, connect() {}, disconnect() { g.disconnected = true; } };
    (this.gains = this.gains || []).push(g);
    return g;
  }
}

/** 描く手順を最後まで進める (音は刻みに分けて描く) */
const flush = () => vi.advanceTimersByTime(10000);

function mountRoom(values, over) {
  const v = Object.assign({ 'oshi.on': true }, values || {});
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
    apiOshiGet: OSHI,
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state) }),
    apiOshiImage: (charId, state) => ({ charId, state, sha: 's-' + state, dataUrl: 'data:image/png;base64,' + Buffer.from('mine:' + state).toString('base64') }),
  }, over || {}));
}

const q = (sel) => document.querySelector(sel);
const room = () => document.getElementById('room');
const callsOf = (app, name) => app.calls.filter((c) => c.name === name).map((c) => c.args);

/** 自分まわりを開く (開いていれば閉じてから開き直す。開くときに描き直す) */
function openMe() {
  if (!q('#me-panel').hidden) q('#me-btn').click();
  q('#me-btn').click();
}

function openFromMe() {
  openMe();
  q('.room-open-btn').click();
}

describe('作業部屋', () => {
  it('推しの頭を左右になでると笑顔になってひとこと言い、しばらくで作業中の顔に戻る', () => {
    // 最初の mount は本物の時計で (test/dom.js が setInterval を包むのは最初の1回だけ)。笑顔の時計だけ偽の時計で進める
    mountRoom(ON);
    openFromMe();
    vi.useFakeTimers();
    const el = room();
    const fig = el.querySelector('.room-oshi');
    expect(fig.dataset.state).toBe('work');
    fig.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200 });
    const move = (x, y) => fig.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    // 下半分 (体) では数えない
    move(20, 150); move(80, 150); move(20, 150); move(80, 150);
    expect(fig.dataset.state).toBe('work');
    // 頭を一往復半
    move(20, 40); move(80, 40); move(20, 40); move(80, 40);
    expect(fig.dataset.state).toBe('praise');
    expect(fig.querySelector('.oshi-img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'praise'));
    const say = el.querySelector('.room-oshi-say');
    expect(OSHI.events.find((e) => e.key === 'pat').lines).toContain(say.textContent);
    // 笑顔のあいだはもう一度なでても変わらない
    move(20, 40); move(80, 40); move(20, 40); move(80, 40);
    expect(el.querySelectorAll('.room-oshi-say').length).toBe(1);
    // 画像のドラッグは始まらない
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    fig.querySelector('.oshi-img').dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(fig.dataset.state).toBe('work');
    expect(el.querySelector('.room-oshi-say')).toBe(null);
  });

  it('なでたときの吹き出しは、絵の実際の箱から頭の右上に置く (絵に重ねない)', () => {
    mountRoom(ON);
    openFromMe();
    const el = room();
    const fig = el.querySelector('.room-oshi');
    const stage = el.querySelector('.room-stage');
    // 舞台 1600×900 の中で、絵は左 496〜896、上 270〜630 (縦に長い絵)
    stage.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1600, height: 900, right: 1600, bottom: 900 });
    fig.getBoundingClientRect = () => ({ top: 270, left: 496, width: 400, height: 360, right: 896, bottom: 630 });
    const move = (x, y) => fig.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    move(520, 300); move(600, 300); move(520, 300); move(600, 300);
    const say = el.querySelector('.room-oshi-say');
    expect(say).toBeTruthy();
    // 右上: 左は絵の右端 (896/1600 = 56%) + 1、下は絵の上端 (900-270 = 630 → 70%) - 6
    expect(say.style.left).toBe('57%');
    expect(say.style.bottom).toBe('64%');
  });

  it('部屋の絵の入れ物は指の動きを受ける (pointer-events: none のままだと、なでても何も起きない。jsdom は CSS を見ないので字で確かめる)', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/ui/app.css.html', 'utf8');
    const rules = [...css.matchAll(/\.room-oshi\s*\{[^}]*\}/g)].map((m) => m[0]);
    const none = rules.findIndex((r) => /pointer-events:\s*none/.test(r));
    const auto = rules.findIndex((r) => /pointer-events:\s*auto/.test(r));
    expect(none).toBeGreaterThanOrEqual(0);
    expect(auto).toBeGreaterThan(none); // 後の規則が勝つ
    // 絵そのものは受けない (入れ物が受ける)
    expect(/\.room-oshi \.oshi-img\s*\{[^}]*pointer-events:\s*none/.test(css)).toBe(true);
  });

  it('推しがオフの人影は、なでても何も起きない', () => {
    mountRoom(Object.assign({ 'oshi.on': false }, ON));
    openFromMe();
    const el = room();
    const fig = el.querySelector('.room-oshi');
    fig.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200 });
    const move = (x, y) => fig.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    move(20, 40); move(80, 40); move(20, 40); move(80, 40);
    expect(fig.dataset.state).toBe('none');
    expect(el.querySelector('.room-oshi-say')).toBe(null);
  });

  let savedAudio;
  beforeEach(() => {
    window.localStorage.clear();
    FakeAudio.made = [];
    savedAudio = window.AudioContext;
  });
  afterEach(() => {
    window.AudioContext = savedAudio;
    delete window.matchMedia;
    delete document.hidden;
    vi.useRealTimers();
  });

  it('既定はオフ。自分まわりに入口が出ず、設定の「作業部屋」でオンにするとその場で出る', () => {
    const app = mountRoom();
    q('#me-btn').click();
    expect(q('.room-open-btn')).toBe(null);
    q('.nav-item[data-tab="settings"]').click();
    const mine = document.getElementById('settings-mine');
    expect(mine.contains(q('[data-pref="room.on"]'))).toBe(true);
    expect([...mine.querySelectorAll('h3')].map((h) => h.textContent)).toContain('作業部屋');
    q('[data-pref="room.on"] button[role="switch"]').click();
    expect(callsOf(app, 'apiPrefSet')).toEqual([['room.on', true]]);
    openMe();
    expect(q('.room-open-btn')).toBeTruthy();
  });

  it('自分まわりから開き、推しが作業中の絵で座る。開いただけでは音を作らない。× で閉じて入口へ焦点を戻す', () => {
    window.AudioContext = FakeAudio;
    const app = mountRoom(ON);
    openFromMe();
    const el = room();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.querySelector('.room-scene title').textContent).toBe('作業部屋');
    expect(['morning', 'day', 'evening', 'night']).toContain(el.dataset.phase);
    const fig = el.querySelector('.room-oshi');
    expect(fig.dataset.state).toBe('work');
    expect(fig.querySelector('.oshi-img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'work'));
    expect(fig.classList.contains('is-breathing')).toBe(true);
    expect(el.classList.contains('is-moving')).toBe(true);
    expect(callsOf(app, 'apiOshiDefaultImage')).toContainEqual(['taku', 'chibi', 'work']);
    expect(FakeAudio.made.length).toBe(0);
    // 雨は最初からオン。窓に雨粒 (上限まで)
    expect(el.querySelector('.room-stage').dataset.rain).toBe('on');
    expect(el.querySelectorAll('.room-drop').length).toBe(60);
    room().querySelector('.room-close').click();
    expect(room()).toBe(null);
    // 自分まわりは閉じているので、その入口 (自分の顔) へ戻す
    expect(q('#me-panel').hidden).toBe(true);
    expect(document.activeElement).toBe(q('#me-btn'));
  });

  it('Esc で閉じる', () => {
    mountRoom(ON);
    openFromMe();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(room()).toBe(null);
  });

  it('全画面にできない画面 (jsdom など) ではボタンを押せなくし、理由を添える。できる画面では押した中で頼む', () => {
    mountRoom(ON);
    openFromMe();
    const full = room().querySelector('.room-full');
    expect(full.disabled).toBe(true);
    expect(full.getAttribute('data-hint')).toContain('全画面にできません');
    room().querySelector('.room-close').click();

    const asked = [];
    window.HTMLElement.prototype.requestFullscreen = function () { asked.push(this.id); return Promise.resolve(); };
    try {
      mountRoom(ON);
      openFromMe();
      const btn = room().querySelector('.room-full');
      expect(btn.disabled).toBe(false);
      btn.click();
      expect(asked).toEqual(['room']);
    } finally {
      delete window.HTMLElement.prototype.requestFullscreen;
    }
  });

  it('動きを減らす設定では、揺れも雨の動きも付けない (止めた雨粒だけ)', () => {
    window.matchMedia = (query) => ({ matches: /reduce/.test(query), addEventListener() {}, removeEventListener() {} });
    vi.useFakeTimers();
    mountRoom(ON);
    openFromMe();
    const el = room();
    expect(el.classList.contains('is-moving')).toBe(false);
    expect(el.querySelector('.room-oshi').classList.contains('is-breathing')).toBe(false);
    expect(el.querySelector('.room-stage').dataset.rain).toBe('still');
    const drops = [...el.querySelectorAll('.room-drop')];
    expect(drops.length).toBeLessThan(60);
    expect(drops.every((d) => !d.style.animationDuration)).toBe(true);
    // 顔を上げる入れ替えもしない
    vi.advanceTimersByTime(120000);
    expect(el.querySelector('.room-oshi').dataset.state).toBe('work');
  });

  it('作業中は 12〜25 秒ごとに様子を変える (向きを変える / 傾く / ずれる / 伸び)。傾き・ずれ・伸びはしばらくで戻り、向きは次まで残る', () => {
    vi.useFakeTimers();
    // Math.random は「次までの間」と「どの動きか」「左右」に使う。0 → 最短 12 秒・向きを変える (開くときの仕掛けから効かせる)
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    mountRoom(ON);
    openFromMe();
    const fig = room().querySelector('.room-oshi');
    try {
      // 次までの間は、仕掛けた時点の Math.random で決まる (前の動きの直後に仕掛ける)
      vi.advanceTimersByTime(11999);
      expect(fig.classList.contains('is-flipped')).toBe(false);
      vi.advanceTimersByTime(2);
      expect(fig.classList.contains('is-flipped')).toBe(true);
      // 次は 0 で仕掛けてあるので 12 秒後。0.3 → 傾く、左
      rnd.mockReturnValue(0.3);
      vi.advanceTimersByTime(12001);
      expect(fig.classList.contains('is-lean-l')).toBe(true);
      expect(fig.classList.contains('is-flipped')).toBe(true); // 向きはそのまま
      vi.advanceTimersByTime(3501);
      expect(fig.classList.contains('is-lean-l')).toBe(false);
      // 次は 0.3 で仕掛けてあるので 15.9 秒後。0.6 → ずれる、右
      rnd.mockReturnValue(0.6);
      vi.advanceTimersByTime(12000 + 13000 * 0.3 + 1);
      expect(fig.classList.contains('is-shift-r')).toBe(true);
      vi.advanceTimersByTime(3501);
      expect(fig.classList.contains('is-shift-r')).toBe(false);
      // 次は 0.6 で仕掛けてあるので 19.8 秒後。0.9 → 伸び = おうえんの絵、しばらくで作業中に戻る
      rnd.mockReturnValue(0.9);
      vi.advanceTimersByTime(12000 + 13000 * 0.6 + 1);
      expect(fig.dataset.state).toBe('cheer');
      vi.advanceTimersByTime(3501);
      expect(fig.dataset.state).toBe('work');
    } finally {
      rnd.mockRestore();
    }
  });

  it('動きを減らす設定では様子を変えない', () => {
    window.matchMedia = (query) => ({ matches: /reduce/.test(query), addEventListener() {}, removeEventListener() {} });
    vi.useFakeTimers();
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    mountRoom(ON);
    openFromMe();
    const fig = room().querySelector('.room-oshi');
    try {
      vi.advanceTimersByTime(60000);
      expect(fig.classList.contains('is-flipped')).toBe(false);
      expect(fig.className).not.toMatch(/is-lean|is-shift/);
      expect(fig.dataset.state).toBe('work');
    } finally {
      rnd.mockRestore();
    }
  });

  it('ときどき顔を上げ (ふつう・ほめる)、しばらくして作業に戻る', () => {
    vi.useFakeTimers();
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      mountRoom(ON);
      openFromMe();
      const fig = room().querySelector('.room-oshi');
      expect(fig.dataset.state).toBe('work');
      vi.advanceTimersByTime(34000);
      expect(fig.dataset.state).toBe('work');
      vi.advanceTimersByTime(1001);
      expect(fig.dataset.state).toBe('idle');
      expect(fig.classList.contains('is-breathing')).toBe(false);
      vi.advanceTimersByTime(4001);
      expect(fig.dataset.state).toBe('work');
      expect(fig.classList.contains('is-breathing')).toBe(true);
    } finally {
      rnd.mockRestore();
    }
  });

  it('推しがオフなら、人影を置く (絵を取りに行かない)', () => {
    const app = mountRoom(Object.assign({ 'oshi.on': false }, ON));
    openFromMe();
    const fig = room().querySelector('.room-oshi');
    expect(fig.dataset.state).toBe('none');
    expect(fig.querySelector('.room-silhouette')).toBeTruthy();
    expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([]);
  });

  describe('自分のキャラ', () => {
    const mine = Object.assign({}, OSHI, { kind: 'mine', charId: 1, builtinKey: '', name: 'ルナ', char: 'mine:1',
      images: [{ state: 'idle', sha: 's-idle' }], mine: [{ charId: 1, name: 'ルナ', images: [{ state: 'idle', sha: 's-idle' }] }] });

    it('作業中の絵が無く、ほかのキャラの絵も出さない設定なら、ふつうの絵で座る', () => {
      mountRoom(Object.assign({ 'oshi.char': 'mine:1', 'oshi.fallback': 'none' }, ON), { apiOshiGet: mine });
      openFromMe();
      const fig = room().querySelector('.room-oshi');
      expect(fig.dataset.state).toBe('idle');
      expect(fig.querySelector('.oshi-img').getAttribute('src')).toContain(Buffer.from('mine:idle').toString('base64'));
    });

    it('絵が無い表情に最初からいるキャラを出す設定なら、そのキャラの作業中の絵', () => {
      const app = mountRoom(Object.assign({ 'oshi.char': 'mine:1', 'oshi.fallback': 'builtin:itsuki' }, ON), { apiOshiGet: mine });
      openFromMe();
      expect(room().querySelector('.room-oshi').dataset.state).toBe('work');
      expect(callsOf(app, 'apiOshiDefaultImage')).toContainEqual(['itsuki', 'chibi', 'work']);
    });
  });

  it('見ていないタブでは窓の雨を止め、戻ったら動かす', () => {
    mountRoom(ON);
    openFromMe();
    const stage = room().querySelector('.room-stage');
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(stage.dataset.rain).toBe('paused');
    expect(room().querySelector('.room-rain').classList.contains('is-paused')).toBe(true);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(stage.dataset.rain).toBe('on');
  });

  describe('まわりの音', () => {
    it('押すと音を作って繰り返す (雨だけ、20秒以上)。全体の大きさは上限を超えない。止めると下げて止める', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      mountRoom(ON);
      openFromMe();
      const play = room().querySelector('.room-play');
      expect(play.textContent).toBe('音を流す');
      play.click();
      expect(FakeAudio.made.length).toBe(1);
      const ctx = FakeAudio.made[0];
      flush();
      expect(ctx.sources.length).toBe(1);
      expect(ctx.sources[0].loop).toBe(true);
      expect(ctx.sources[0].buffer.len).toBe(24 * 24000);
      expect(play.textContent).toBe('音を止める');
      // 鳴らしながら足す
      room().querySelector('[data-sound="keys"] .room-sound-toggle').click();
      flush();
      expect(ctx.sources.length).toBe(2);
      const master = room().querySelector('.room-master');
      master.value = '1';
      master.dispatchEvent(new window.Event('input'));
      play.click();
      expect(ctx.sources.every((s) => s.stopped)).toBe(true);
      expect(play.textContent).toBe('音を流す');
    });

    it('混ぜ方はこの端末に覚え、開き直すと戻る。全部オフで押すと断る', () => {
      window.AudioContext = FakeAudio;
      mountRoom(ON);
      openFromMe();
      room().querySelector('[data-sound="rain"] .room-sound-toggle').click();
      const vol = room().querySelector('[data-sound="cafe"] .room-sound-volume');
      vol.value = '0.15';
      vol.dispatchEvent(new window.Event('input'));
      const saved = JSON.parse(window.localStorage.getItem('roomMix'));
      expect(saved.sounds.rain.on).toBe(false);
      expect(saved.sounds.cafe.volume).toBe(0.15);
      expect(room().querySelector('.room-stage').dataset.rain).toBe('off');
      room().querySelector('.room-play').click();
      expect(FakeAudio.made.length).toBe(0);
      // 断りは部屋の中 (音の欄) に出す。帯は部屋の下に隠れうる
      const note = room().querySelector('.room-mixer .room-mix-note');
      expect(note.hidden).toBe(false);
      expect(note.textContent).toContain('1つ以上オンに');

      mountRoom(ON);
      openFromMe();
      expect(room().querySelector('[data-sound="rain"] .room-sound-toggle').getAttribute('aria-checked')).toBe('false');
      expect(room().querySelector('[data-sound="cafe"] .room-sound-volume').value).toBe('0.15');
    });

    it('閉じると音も止め、音の仕組みを閉じて描いた音を手放す。開き直して流すと作り直す', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      mountRoom(ON);
      openFromMe();
      room().querySelector('.room-play').click();
      flush();
      const first = FakeAudio.made[0];
      room().querySelector('.room-close').click();
      expect(first.sources[0].stopped).toBe(true);
      flush();
      expect(first.closed).toBe(true);
      expect(first.gains.every((g) => g.disconnected)).toBe(true);
      openFromMe();
      room().querySelector('.room-play').click();
      flush();
      expect(FakeAudio.made.length).toBe(2);
      expect(FakeAudio.made[1].sources.length).toBe(1);
      expect(FakeAudio.made[1].sources[0].buffer.len).toBe(24 * 24000);
    });

    it('止めて流し直すと、前の全体の大きさの節は外す', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      mountRoom(ON);
      openFromMe();
      const play = room().querySelector('.room-play');
      play.click();
      flush();
      play.click();
      flush();
      play.click();
      flush();
      expect(FakeAudio.made.length).toBe(1);
      // 最初の流しの全体の節は外れている
      expect(FakeAudio.made[0].gains[0].disconnected).toBe(true);
    });

    it('音は刻みに分けて描く。描いているあいだは「準備中」で、押した中では描かない。その間に止めれば鳴らさない', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      mountRoom(ON);
      openFromMe();
      const play = room().querySelector('.room-play');
      play.click();
      const ctx = FakeAudio.made[0];
      expect(ctx.sources.length).toBe(0);
      expect(play.textContent).toBe('準備中…');
      expect(play.getAttribute('aria-busy')).toBe('true');
      vi.advanceTimersByTime(0);
      // 1刻みでは描き終わらない (何刻みかに分かれている)
      expect(ctx.sources.length).toBe(0);
      flush();
      expect(ctx.sources.length).toBe(1);
      expect(play.textContent).toBe('音を止める');
      expect(play.getAttribute('aria-busy')).toBe('false');

      room().querySelector('[data-sound="cafe"] .room-sound-toggle').click();
      vi.advanceTimersByTime(0);
      play.click();
      flush();
      // 止めたので、描き終わったカフェは鳴らさない
      expect(ctx.sources.length).toBe(1);
    });

    it('カフェは軽く描く (12 kHz)', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      window.localStorage.setItem('roomMix', JSON.stringify({ sounds: { rain: { on: false }, cafe: { on: true, volume: 0.4 } } }));
      mountRoom(ON);
      openFromMe();
      room().querySelector('.room-play').click();
      flush();
      const buf = FakeAudio.made[0].sources[0].buffer;
      expect([buf.len, buf.rate]).toEqual([30 * 12000, 12000]);
    });

    it('音を作れない端末では断りだけ出す', () => {
      delete window.AudioContext;
      mountRoom(ON);
      openFromMe();
      expect(room().querySelector('.room-play')).toBe(null);
      expect(room().querySelector('.room-mixer').textContent).toContain('音を作れません');
    });
  });

  describe('集中のしかたと', () => {
    const FOCUS = Object.assign({ 'focus.start': true, 'focus.sound': true, 'focus.music': 'own' }, ON);
    const session = (n, minutes) => ({ id: 7, issueNumber: n, title: '通勤手当の見直し', plannedMinutes: minutes, extendedMinutes: 0,
      startedAt: new Date().toISOString(), openedAt: '', provedAt: '', endedAt: '', result: '', firstStep: '', proofKind: '', points: 0 });
    const mountFocusRoom = () => mountRoom(FOCUS, {
      apiPrefs: prefsFixture({ values: Object.assign({ 'oshi.on': true }, FOCUS), musicParts: { kind: 'youtube', video: 'dQw4w9WgXcQ' } }),
      apiFocusStart: (n, minutes) => session(n, minutes),
      apiFocusMine: { active: null, week: {}, toStart: [], measured: 0, badges: [] },
    });
    const dock = () => document.getElementById('focus-dock');
    function start() {
      q('.nav-item[data-tab="issues"]').click();
      q('#issue-list [aria-label="#2 を今から始める"]').click();
      dock().querySelector('.seg[data-minutes="25"]').click();
      dock().querySelector('.focus-go').click();
    }

    it('集中しているあいだの窓から開け、隅に残りの輪を出す。部屋は集中を始めない', () => {
      const app = mountFocusRoom();
      q('#me-btn').click();
      q('.room-open-btn').click();
      expect(room().querySelector('.room-focus').hidden).toBe(true);
      room().querySelector('.room-close').click();
      expect(callsOf(app, 'apiFocusStart')).toEqual([]);
      start();
      dock().querySelector('.room-open-btn').click();
      const corner = room().querySelector('.room-focus');
      expect(corner.hidden).toBe(false);
      expect(corner.querySelector('.room-focus-left').textContent).toBe('残り25分');
      expect(corner.querySelector('.room-focus-what').textContent).toBe('#2 通勤手当の見直し');
    });

    it('集中の音とは同時に流さない (片方を始めると、もう片方を止める)', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      mountFocusRoom();
      start();
      const kind = dock().querySelector('.focus-sound-kind');
      kind.value = 'pink';
      const focusPlay = dock().querySelector('.focus-sound-toggle');
      focusPlay.click();
      const focusSrc = FakeAudio.made[0].src;
      expect(focusSrc.started).toBe(true);
      dock().querySelector('.room-open-btn').click();
      const roomPlay = room().querySelector('.room-play');
      roomPlay.click();
      flush();
      expect(focusSrc.stopped).toBe(true);
      expect(focusPlay.textContent).toBe('音を流す');
      const roomCtx = FakeAudio.made[FakeAudio.made.length - 1];
      const roomSrc = roomCtx.sources[0];
      expect(roomSrc.started).toBe(true);
      focusPlay.click();
      expect(roomSrc.stopped).toBe(true);
      expect(roomPlay.textContent).toBe('音を流す');
    });

    it('自分の曲とも同時に流さない', () => {
      window.AudioContext = FakeAudio;
      vi.useFakeTimers();
      mountFocusRoom();
      start();
      const frames = () => [...document.querySelectorAll('iframe')].filter((f) => f.id !== 'viewer');
      dock().querySelector('.focus-music-toggle').click();
      expect(frames().length).toBe(1);
      dock().querySelector('.room-open-btn').click();
      room().querySelector('.room-play').click();
      flush();
      expect(frames()).toEqual([]);
      const roomSrc = FakeAudio.made[0].sources[0];
      dock().querySelector('.focus-music-toggle').click();
      expect(frames().length).toBe(1);
      expect(roomSrc.stopped).toBe(true);
    });

    it('設定で作業部屋をやめると、開いている部屋を閉じ、窓の入口も外す', () => {
      const app = mountFocusRoom();
      start();
      dock().querySelector('.room-open-btn').click();
      expect(room()).toBeTruthy();
      app.respond('apiPrefSet', () => prefsFixture({ values: Object.assign({}, FOCUS, { 'room.on': false }) }));
      room().querySelector('.room-close').click();
      q('.nav-item[data-tab="settings"]').click();
      dock().querySelector('.room-open-btn').click();
      q('[data-pref="room.on"] button[role="switch"]').click();
      expect(room()).toBe(null);
      expect(dock().querySelector('.room-open-btn')).toBe(null);
    });
  });

  describe('焦点と重なり', () => {
    const startReply = (n, minutes) => ({ id: 7, issueNumber: n, title: 'x', plannedMinutes: minutes, extendedMinutes: 0,
      startedAt: new Date().toISOString(), openedAt: '', provedAt: '', endedAt: '', result: '', firstStep: '', proofKind: '', points: 0 });
    function startFocus(over) {
      vi.useFakeTimers();
      const app = mountRoom(Object.assign({ 'focus.start': true }, ON), Object.assign({ apiFocusStart: startReply }, over || {}));
      q('.nav-item[data-tab="issues"]').click();
      q('#issue-list [aria-label="#2 を今から始める"]').click();
      q('#focus-dock .focus-go').click();
      return app;
    }

    it('集中の窓から開いたら、閉じたとき窓の入口へ戻す。入口が描き直されていたら新しい入口へ', () => {
      startFocus();
      const btn = q('#focus-dock .room-open-btn');
      btn.click();
      room().querySelector('.room-close').click();
      expect(document.activeElement).toBe(btn);
      btn.click();
      // 窓が描き直されて入口が別の物になった
      const fresh = btn.cloneNode(true);
      btn.replaceWith(fresh);
      room().querySelector('.room-close').click();
      expect(document.activeElement).toBe(fresh);
    });

    it('開いているあいだ、部屋の外には焦点が行かない (inert)。Tab は部屋の中で回る。閉じると戻す', () => {
      mountRoom(ON);
      const layout = q('.layout');
      openFromMe();
      const others = [...document.body.children].filter((el) => el !== room() && el.tagName !== 'SCRIPT');
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((el) => el.hasAttribute('inert'))).toBe(true);
      expect(room().hasAttribute('inert')).toBe(false);
      const focusables = [...room().querySelectorAll('button:not([disabled]), input')];
      const last = focusables[focusables.length - 1];
      last.focus();
      last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(focusables[0]);
      focusables[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
      expect(document.activeElement).toBe(last);
      room().querySelector('.room-close').click();
      expect(layout.hasAttribute('inert')).toBe(false);
      expect([...document.body.children].some((el) => el.hasAttribute('inert'))).toBe(false);
    });

    it('Esc は部屋だけが受ける (集中の画面も、開いている右のペインもそのまま)', () => {
      startFocus();
      q('#focus-dock .focus-mode-toggle').click();
      expect(document.body.classList.contains('focus-mode')).toBe(true);
      q('#issue-list .row-open').click();
      const side = document.getElementById('side-panel');
      expect(side.hidden).toBe(false);
      q('#focus-dock .room-open-btn').click();
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(room()).toBe(null);
      expect(document.body.classList.contains('focus-mode')).toBe(true);
      expect(side.hidden).toBe(false);
      document.body.classList.remove('focus-mode');
    });

    it('帯と補足の吹き出しは部屋より上に出る。全画面のあいだは部屋の中に置く', async () => {
      const fs = await import('node:fs');
      const css = fs.readFileSync('src/ui/app.css.html', 'utf8');
      const z = (sel) => {
        const at = css.indexOf('\n' + sel + ' {');
        return Number(/z-index: (\d+)/.exec(css.slice(at, css.indexOf('}', at)))[1]);
      };
      expect(z('.snackbar')).toBeGreaterThan(z('.room'));
      expect(z('.hint-bubble')).toBeGreaterThan(z('.room'));

      let fullEl = null;
      Object.defineProperty(document, 'fullscreenElement', { get: () => fullEl, configurable: true });
      window.HTMLElement.prototype.requestFullscreen = function () {
        fullEl = this;
        document.dispatchEvent(new window.Event('fullscreenchange'));
        return Promise.resolve();
      };
      document.exitFullscreen = () => {
        fullEl = null;
        document.dispatchEvent(new window.Event('fullscreenchange'));
        return Promise.resolve();
      };
      try {
        startFocus({ apiFocusEnd: { id: 7, result: 'stopped' } });
        q('#focus-dock .room-open-btn').click();
        room().querySelector('.room-full').click();
        expect(document.fullscreenElement).toBe(room());
        // 全画面のあいだに出た帯は部屋の中
        q('#focus-dock .focus-stop').click();
        expect(room().contains(q('#snackbar'))).toBe(true);
        // 補足の吹き出しも部屋の中
        room().querySelector('.room-full').dispatchEvent(new window.Event('focusin', { bubbles: true }));
        expect(room().contains(document.getElementById('hint-bubble'))).toBe(true);
        // 戻すと外へ戻す
        room().querySelector('.room-full').click();
        expect(document.getElementById('hint-bubble').parentNode).toBe(document.body);
        expect(q('#snackbar').parentNode).toBe(document.body);
      } finally {
        delete window.HTMLElement.prototype.requestFullscreen;
        delete document.exitFullscreen;
        delete document.fullscreenElement;
      }
    });

    it('開いているあいだに動きを減らす設定にしたら、止めた雨粒を見える位置に置き、揺れを外す', () => {
      let reduce = false;
      const listeners = [];
      window.matchMedia = (query) => ({ get matches() { return /reduce/.test(query) && reduce; },
        addEventListener(type, fn) { listeners.push(fn); }, removeEventListener() {} });
      mountRoom(ON);
      openFromMe();
      expect(room().querySelector('.room-stage').dataset.rain).toBe('on');
      reduce = true;
      listeners.forEach((fn) => fn({ matches: true }));
      expect(room().classList.contains('is-moving')).toBe(false);
      expect(room().querySelector('.room-oshi').classList.contains('is-breathing')).toBe(false);
      expect(room().querySelector('.room-stage').dataset.rain).toBe('still');
      const drops = [...room().querySelectorAll('.room-drop')];
      expect(drops.length).toBeGreaterThan(0);
      expect(drops.every((d) => /%$/.test(d.style.top))).toBe(true);
    });
  });
});
