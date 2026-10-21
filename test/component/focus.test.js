// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 集中のしかた (js-focus)。自分の設定の focus.start / focus.remind / focus.sound をオンにした人の画面にだけ出す。
 * 始めたことは番頭の中の手で確かめる。記録は本人にだけ見せる。
 */

const ON = { 'focus.start': true };

function session(over) {
  return Object.assign({
    id: 7, issueNumber: 2, title: '通勤手当の見直し', plannedMinutes: 25, extendedMinutes: 0,
    startedAt: new Date().toISOString(), openedAt: new Date().toISOString(), provedAt: '', endedAt: '',
    result: '', firstStep: '', proofKind: '', points: 0,
  }, over || {});
}

/** 始めた返事は、送られた長さと一手から作る (サーバと同じく一手を書けば始めたことになる) */
function startReply(n, minutes, step, opened) {
  const now = new Date().toISOString();
  return session({ issueNumber: n, plannedMinutes: minutes, firstStep: step || '', openedAt: opened,
    startedAt: now, provedAt: step ? now : '', proofKind: step ? 'firstStep' : '' });
}

function mountFocus(values, over) {
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: values || {} }),
    apiFocusStart: startReply,
    apiFocusMine: { active: null, week: { started: 0, proved: 0, finished: 0 }, toStart: [], measured: 0, badges: [] },
    apiFocusEnd: (id, result) => session({ id, result, endedAt: new Date().toISOString() }),
    apiFocusExtend: (id, m) => session({ id, extendedMinutes: m }),
    apiIssueClose: { number: 2, state: 'closed' },
  }, over || {}));
}

const dock = () => document.getElementById('focus-dock');
const q = (sel) => document.querySelector(sel);
const banners = () => {
  const l = document.getElementById('fun-layer');
  return l ? [...l.querySelectorAll('.fun-banner')].map((b) => b.textContent) : [];
};
const callsOf = (app, name) => app.calls.filter((c) => c.name === name).map((c) => c.args);

function openIssues() {
  q('.nav-item[data-tab="issues"]').click();
}

/** 一覧の #2 から始める */
function startFromRow(app, minutes, step) {
  openIssues();
  q('#issue-list [aria-label="#2 を今から始める"]').click();
  if (minutes) {
    const seg = dock().querySelector('.seg[data-minutes="' + minutes + '"]');
    if (seg) seg.click();
    else {
      const custom = dock().querySelector('.focus-custom');
      custom.value = String(minutes);
      custom.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
  }
  if (step) dock().querySelector('.focus-step-field input').value = step;
  dock().querySelector('.focus-go').click();
  return app;
}

describe('集中のしかた', () => {
  let savedAudio;
  beforeEach(() => {
    window.localStorage.clear();
    savedAudio = window.AudioContext;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
  });
  afterEach(() => {
    window.AudioContext = savedAudio;
    vi.useRealTimers();
    document.body.classList.remove('focus-mode');
  });

  it('既定はオフ。一覧にも詳細にも自分まわりにも入口が出ず、記録も取りに行かない', () => {
    const app = mountFocus();
    openIssues();
    expect(q('.focus-start-btn')).toBe(null);
    q('#issue-list .row-open').click();
    expect(document.querySelector('#side-panel .focus-start-btn')).toBe(null);
    q('#me-btn').click();
    expect(q('.focus-record-btn')).toBe(null);
    expect(dock()).toBe(null);
    expect(callsOf(app, 'apiFocusMine')).toEqual([]);
  });

  it('設定の「集中のしかた」に3つが自分の設定として並び、オンにするとその場で入口が出る', () => {
    const app = mountFocus();
    app.respond('apiPrefSet', () => prefsFixture({ values: ON }));
    q('.nav-item[data-tab="settings"]').click();
    const mine = document.getElementById('settings-mine');
    ['focus.start', 'focus.remind', 'focus.sound'].forEach((k) => {
      expect(mine.contains(q('[data-pref="' + k + '"]'))).toBe(true);
    });
    expect([...mine.querySelectorAll('h3')].map((h) => h.textContent)).toContain('集中のしかた');
    q('[data-pref="focus.start"] button[role="switch"]').click();
    expect(callsOf(app, 'apiPrefSet')).toEqual([['focus.start', true]]);
    openIssues();
    expect(q('#issue-list [aria-label="#2 を今から始める"]')).toBeTruthy();
  });

  it('完了したやることには入口を出さない。詳細にも「今から始める」が出る', () => {
    mountFocus(ON);
    openIssues();
    expect(document.querySelectorAll('#issue-list .focus-start-btn').length).toBeGreaterThan(0);
    q('#issue-list .row-open').click();
    expect([...document.querySelectorAll('#side-panel .focus-start-btn')].map((b) => b.textContent)).toEqual(['今から始める']);
  });

  it('長さを選び、最初の一手を書いて始める。開いた時刻はサーバに覚えてもらい、画面の時計は送らない', () => {
    const app = mountFocus(ON);
    openIssues();
    q('#issue-list [aria-label="#2 を今から始める"]').click();
    expect(dock().querySelector('.focus-what').textContent).toBe('#2 通勤手当の見直し');
    // 決まった刻みは無い: 4つから選ぶか、数を書く
    expect([...dock().querySelectorAll('.seg')].map((s) => s.textContent)).toEqual(['15分', '25分', '45分', '60分']);
    expect(dock().querySelector('.focus-step-field input').placeholder).toContain('たら');
    vi.advanceTimersByTime(20000);
    dock().querySelector('.seg[data-minutes="45"]').click();
    dock().querySelector('.focus-step-field input').value = '席に戻ったら第3条を開く';
    dock().querySelector('.focus-go').click();
    const args = callsOf(app, 'apiFocusStart')[0];
    expect(args).toEqual([2, 45, '席に戻ったら第3条を開く']);
    // 開いたときに1回だけ知らせる (時刻はサーバの時計で決まる)
    expect(callsOf(app, 'apiFocusOpen')).toEqual([[2]]);
    expect(dock().classList.contains('is-running')).toBe(true);
    expect(dock().querySelector('.focus-first').textContent).toBe('最初の一手: 席に戻ったら第3条を開く');
    // 一手を書いたので、その場で「始めた」
    expect(dock().querySelector('.focus-proved').textContent).toBe('始めた');
  });

  it('輪は減っていき、残りの分はタブの題名にも出る (時刻の差で数える)', () => {
    mountFocus(ON);
    const base = document.title;
    startFromRow(null, 25);
    expect(dock().querySelector('.focus-left').textContent).toBe('25');
    const titled = (head) => (base ? head + ' · ' + base : head);
    expect(document.title).toBe(titled('残り25分'));
    const bar = dock().querySelector('.focus-ring-bar');
    const before = Number(bar.getAttribute('stroke-dashoffset'));
    vi.advanceTimersByTime(10 * 60000);
    expect(dock().querySelector('.focus-left').textContent).toBe('15');
    expect(Number(bar.getAttribute('stroke-dashoffset'))).toBeGreaterThan(before);
    expect(document.title).toBe(titled('残り15分'));
  });

  it('お祝いがオンなら LET\'S GO!!、オフなら落ち着いた帯', () => {
    mountFocus(Object.assign({ 'fun.cheer': true }, ON));
    startFromRow(null, 15);
    expect(banners()).toContain("LET'S GO!!");

    mountFocus(ON);
    startFromRow(null, 15);
    expect(banners()).toEqual([]);
    expect(q('#snackbar').textContent).toContain('始めました。15分');
  });

  it('やりとりを書くと確かめに行き、確かめられたら「始めた」の印が出る', () => {
    const app = mountFocus(ON, {
      apiIssueComment: { id: 1, issueNumber: 2, body: 'x', by: 'me@example.com', at: new Date().toISOString() },
      apiFocusProve: (id, kind) => ({ session: session({ id, provedAt: new Date().toISOString(), proofKind: kind }),
        fresh: true, points: 2 }),
    });
    startFromRow(null, 25);
    expect(dock().querySelector('.focus-proved')).toBe(null);
    expect(dock().querySelector('.focus-proof').textContent).toContain('やりとりを書く');
    q('#issue-list .row-open').click();
    const talk = document.querySelector('#side-panel .comment-form textarea');
    talk.value = 'まず第3条から読む';
    document.querySelector('#side-panel .comment-form .btn-primary').click();
    expect(callsOf(app, 'apiFocusProve')).toEqual([[7, 'comment']]);
    expect(dock().querySelector('.focus-proved').textContent).toBe('始めた');
    expect(q('#snackbar').textContent).toContain('(+2)');
  });

  it('最初の一手で始めたあとも、やりとりを書くと確かめに行く (ポイントは台帳の手で付く)。二度目は行かない', () => {
    const app = mountFocus(ON, {
      apiIssueComment: { id: 1, issueNumber: 2, body: 'x', by: 'me@example.com', at: new Date().toISOString() },
      apiFocusProve: (id, kind) => ({ session: session({ id, provedAt: new Date().toISOString(), proofKind: kind }),
        fresh: false, credited: true, points: 1 }),
    });
    startFromRow(null, 25, '第3条を開く');
    expect(dock().querySelector('.focus-proved').textContent).toBe('始めた');
    const say = () => {
      q('#issue-list .row-open').click();
      document.querySelector('#side-panel .comment-form textarea').value = '読んだ';
      document.querySelector('#side-panel .comment-form .btn-primary').click();
    };
    say();
    expect(callsOf(app, 'apiFocusProve')).toEqual([[7, 'comment']]);
    expect(q('#snackbar').textContent).toContain('(+1)');
    say();
    expect(callsOf(app, 'apiFocusProve').length).toBe(1);
  });

  it('別のやることへの手では確かめに行かない。確かめられなければ印は出ない', () => {
    const app = mountFocus(ON, {
      apiIssueUpdate: { number: 1 },
      apiFocusProve: { session: session(), fresh: false, points: 0 },
    });
    startFromRow(null, 25);
    window.google.script.run.withSuccessHandler(() => {}).apiIssueUpdate(1, { title: 'x' });
    expect(callsOf(app, 'apiFocusProve')).toEqual([]);
  });

  it('時間になると控えめな帯。「もう少し」で10分延び、「終わった」で完了にして SUPER COMPLETE!!', () => {
    const app = mountFocus(Object.assign({ 'fun.cheer': true }, ON));
    const base = document.title;
    startFromRow(null, 15);
    vi.advanceTimersByTime(15 * 60000 + 1000);
    const up = dock().querySelector('.focus-timeup');
    expect(up.hidden).toBe(false);
    expect(up.textContent).toContain('15分たちました');
    expect(document.title).toBe(base ? '時間です · ' + base : '時間です');
    up.querySelector('.focus-more').click();
    expect(callsOf(app, 'apiFocusExtend')).toEqual([[7, 10]]);
    expect(up.hidden).toBe(true);
    expect(dock().querySelector('.focus-left').textContent).toBe('10');

    vi.advanceTimersByTime(10 * 60000);
    expect(up.hidden).toBe(false);
    // 大きな字は後のものが前のものを消すので、出たものを全部拾う
    const seen = new window.MutationObserver(() => {});
    seen.observe(document.body, { childList: true, subtree: true });
    up.querySelector('.focus-done').click();
    const shown = seen.takeRecords().flatMap((r) => [...r.addedNodes])
      .filter((el) => el.classList && el.classList.contains('fun-banner')).map((el) => el.textContent);
    seen.disconnect();
    expect(callsOf(app, 'apiIssueClose')).toEqual([[2]]);
    expect(callsOf(app, 'apiFocusEnd')).toEqual([[7, 'done']]);
    expect(banners()).toContain('SUPER COMPLETE!!');
    // お祝いは1つだけ (ふつうの完了の CLEAR! を重ねない)
    expect(shown).toEqual(['SUPER COMPLETE!!']);
    expect(dock()).toBe(null);
    expect(document.title).toBe(base);
  });

  it('一覧の完了からそのやることを済ませても、集中を「やりきった」で終える', () => {
    const app = mountFocus(ON);
    startFromRow(null, 25);
    q('#issue-list [aria-label="#2 を完了にする"]').click();
    expect(callsOf(app, 'apiFocusEnd')).toEqual([[7, 'done']]);
    expect(dock()).toBe(null);
  });

  it('「やめる」は責めずに終える', () => {
    const app = mountFocus(ON);
    startFromRow(null, 25);
    dock().querySelector('.focus-stop').click();
    expect(callsOf(app, 'apiFocusEnd')).toEqual([[7, 'stopped']]);
    expect(dock()).toBe(null);
    expect(q('#snackbar').textContent).toContain('おつかれさまでした');
  });

  it('時間の知らせ: 30分ごとを選ぶと、30分で画面の隅に出る (音は鳴らさない)', () => {
    mountFocus(Object.assign({ 'focus.remind': '30' }, ON));
    startFromRow(null, 60);
    const note = dock().querySelector('.focus-note');
    vi.advanceTimersByTime(29 * 60000);
    expect(note.hidden).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('30分たちました');
    vi.advanceTimersByTime(16000);
    expect(note.hidden).toBe(true);
  });

  it('集中の画面: 横の帯と知らせの数を隠し、Esc で戻る。終えたら必ず戻る', () => {
    mountFocus(ON);
    startFromRow(null, 25);
    const toggle = dock().querySelector('.focus-mode-toggle');
    expect(toggle.getAttribute('role')).toBe('switch');
    toggle.click();
    expect(document.body.classList.contains('focus-mode')).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    // 知らせの数は消さずに隠すだけ
    expect(q('#bell-count')).toBeTruthy();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.classList.contains('focus-mode')).toBe(false);
    toggle.click();
    dock().querySelector('.focus-stop').click();
    expect(document.body.classList.contains('focus-mode')).toBe(false);
  });

  it('集中の画面のまま記録と技の図鑑を開くと、集中の画面を戻す (右のペインが隠れたままにしない)', () => {
    mountFocus(ON);
    startFromRow(null, 25);
    dock().querySelector('.focus-mode-toggle').click();
    expect(document.body.classList.contains('focus-mode')).toBe(true);
    q('#me-btn').click();
    q('.focus-record-btn').click();
    expect(document.body.classList.contains('focus-mode')).toBe(false);
    expect(document.querySelector('#side-panel .focus-record')).toBeTruthy();
    expect(document.getElementById('side-panel').hidden).toBe(false);
  });

  it('集中の画面は CSS で横の帯・右のペイン・知らせの数を隠す', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/ui/app.css.html', 'utf8');
    ['.sidebar', '#side-panel', '.bell-count', '.nav-count'].forEach((sel) => {
      expect(css).toContain('body.focus-mode ' + sel);
    });
  });

  it('続いている集中があれば、開き直した画面に輪を描き直す', () => {
    const startedAt = new Date(Date.now() - 5 * 60000).toISOString();
    mountFocus(ON, {
      apiFocusMine: { active: session({ startedAt, plannedMinutes: 25, title: '第2条の改訂', issueNumber: 1 }),
        week: {}, toStart: [], measured: 0, badges: [] },
    });
    expect(dock().querySelector('.focus-what').textContent).toBe('#1 第2条の改訂');
    expect(dock().querySelector('.focus-left').textContent).toBe('20');
  });

  it('集中しているあいだは、別のやることを始めない', () => {
    mountFocus(ON);
    startFromRow(null, 25);
    q('#issue-list [aria-label="#1 を今から始める"]').click();
    expect(q('#snackbar').textContent).toContain('#2 に集中しています');
    expect(dock().classList.contains('is-running')).toBe(true);
  });

  it('始められなかったら、ボタンを戻して知らせる', () => {
    mountFocus(ON, { apiFocusStart: new Error('混み合っています') });
    openIssues();
    q('#issue-list [aria-label="#2 を今から始める"]').click();
    const go = dock().querySelector('.focus-go');
    go.click();
    expect(go.disabled).toBe(false);
    expect(q('#snackbar').textContent).toContain('始められませんでした: 混み合っています');
  });

  it('自分まわりから、集中の記録と技の図鑑を開く。まだの技は ??? と出す', () => {
    const app = mountFocus(ON, {
      apiFocusMine: {
        active: null, week: { started: 3, proved: 2, finished: 1 }, measured: 4,
        toStart: [{ label: '1分以内', count: 3 }, { label: '5分以内', count: 1 },
          { label: '15分以内', count: 0 }, { label: 'それより長く', count: 0 }],
        badges: [
          { key: 'lightning', label: '電光石火', about: '開いてから1分のうちに始めた', done: true, at: '2026-10-20' },
          { key: 'early', label: '', about: '', done: false, at: '' },
        ],
      },
    });
    q('#me-btn').click();
    q('.focus-record-btn').click();
    const box = document.querySelector('#side-panel .focus-record');
    expect(box.querySelector('.focus-week').textContent).toContain('3');
    expect([...box.querySelectorAll('.focus-bar-count')].map((c) => c.textContent)).toEqual(['3', '1', '0', '0']);
    const names = [...box.querySelectorAll('.focus-badge-name')].map((n) => n.textContent);
    expect(names).toEqual(['電光石火', '???']);
    expect(box.textContent).toContain('技の図鑑 1 / 2');
    expect(box.textContent).toContain('あなたにだけ見えます');
    expect(box.textContent).not.toMatch(/連続\d|日連続/);
    expect(callsOf(app, 'apiFocusMine').length).toBeGreaterThan(0);
  });

  it('集中の音: 音を作れない端末では欄を出さず断りだけ出す', () => {
    delete window.AudioContext;
    mountFocus(Object.assign({ 'focus.sound': true }, ON));
    openIssues();
    q('#issue-list [aria-label="#2 を今から始める"]').click();
    expect(dock().querySelector('.focus-sound').textContent).toContain('この端末では集中の音を作れません');
    expect(dock().querySelector('.focus-sound-kind')).toBe(null);
    // それでも始められる
    dock().querySelector('.focus-go').click();
    expect(dock().classList.contains('is-running')).toBe(true);
  });

  it('集中の音: 押したときにだけ作り、1つの小節を繰り返す。終えたら止める。オフなら欄を出さない', () => {
    const made = [];
    class FakeAudio {
      constructor() {
        this.sampleRate = 8000; this.currentTime = 0; this.state = 'running'; this.destination = {};
        made.push(this);
      }
      createBuffer(ch, len, rate) { const d = new Float32Array(len); this.buf = { len, rate, getChannelData: () => d }; return this.buf; }
      createBufferSource() {
        const src = { connect() {}, start: () => { src.started = true; }, stop: () => { src.stopped = true; } };
        this.src = src;
        return src;
      }
      suspend() { this.state = 'suspended'; this.suspended = (this.suspended || 0) + 1; }
      resume() { this.state = 'running'; }
      createGain() {
        const p = { value: 0, setValueAtTime() {}, linearRampToValueAtTime: (v) => { p.last = v; }, cancelScheduledValues() {}, setTargetAtTime() {} };
        return { gain: p, connect() {} };
      }
    }
    window.AudioContext = FakeAudio;

    mountFocus(ON);
    openIssues();
    q('#issue-list [aria-label="#2 を今から始める"]').click();
    expect(dock().querySelector('.focus-sound')).toBe(null);

    mountFocus(Object.assign({ 'focus.sound': true }, ON));
    openIssues();
    q('#issue-list [aria-label="#2 を今から始める"]').click();
    // 開いただけでは作らない (読み込みや表示で鳴らさない)
    expect(made.length).toBe(0);
    expect(dock().querySelector('.focus-ear').textContent).toContain('イヤホン');
    const kind = dock().querySelector('.focus-sound-kind');
    expect([...kind.options].map((o) => o.textContent)).toEqual(['無音', 'ピンクノイズ', 'ブラウンノイズ', '4つ打ちビート', 'ユーロビート風']);
    expect(kind.value).toBe('none');
    kind.value = 'euro';
    kind.dispatchEvent(new window.Event('change'));
    const bpm = dock().querySelector('.focus-bpm');
    expect([bpm.min, bpm.max]).toEqual(['120', '150']);
    bpm.value = '150';
    dock().querySelector('.focus-go').click();
    expect(made.length).toBe(1);
    const ctx = made[0];
    expect(ctx.src.loop).toBe(true);
    expect(ctx.src.started).toBe(true);
    // 150 BPM の1小節 = 4拍 = 1.6秒
    expect(ctx.buf.len).toBe(Math.round(8000 * 60 / 150) * 4);
    dock().querySelector('.focus-stop').click();
    expect(ctx.src.stopped).toBe(true);
    // 下げ終わったら音の仕組みを休ませる (動いたままにしない)
    expect(ctx.suspended || 0).toBe(0);
    vi.advanceTimersByTime(3000);
    expect(ctx.suspended).toBe(1);
  });

  describe('自分の曲 (YouTube / SoundCloud の埋め込み)', () => {
    const VID = 'dQw4w9WgXcQ';
    const LIST = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
    const OWN = Object.assign({ 'focus.music': 'own' }, ON);
    const mountMusic = (values, parts, over) => mountFocus(values, Object.assign({
      apiPrefs: prefsFixture({ values, musicParts: parts }),
    }, over || {}));
    const frames = () => [...document.querySelectorAll('iframe')].filter((f) => f.id !== 'viewer');
    const outside = () => /youtube-nocookie|w\.soundcloud\.com/.test(document.documentElement.outerHTML);
    class FakeAudio {
      constructor() { this.sampleRate = 8000; this.currentTime = 0; this.state = 'running'; this.destination = {}; FakeAudio.made.push(this); }
      createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
      createBufferSource() { const src = { connect() {}, start() { src.started = true; }, stop() { src.stopped = true; } }; this.src = src; return src; }
      suspend() { this.state = 'suspended'; }
      resume() { this.state = 'running'; }
      createGain() {
        const p = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} };
        return { gain: p, connect() {} };
      }
    }

    it('使わない設定なら、集中していても欄を出さない。リンクが無くても出さない', () => {
      const app = mountMusic(ON, { kind: 'youtube', list: LIST });
      startFromRow(app, 25);
      expect(dock().classList.contains('is-running')).toBe(true);
      expect(dock().querySelector('.focus-music')).toBe(null);
      const app2 = mountMusic(OWN, null);
      startFromRow(app2, 25);
      expect(dock().querySelector('.focus-music')).toBe(null);
      expect(frames()).toEqual([]);
    });

    it('押すまで何も読み込まない。押すと部品から組んだ URL だけを枠に入れ、止めて閉じると外す', () => {
      const app = mountMusic(OWN, { kind: 'youtube', list: LIST });
      startFromRow(app, 25);
      const box = dock().querySelector('.focus-music');
      expect(box.textContent).toContain('自分の曲');
      expect(box.textContent).toContain('イヤホンで聞いてください。歌の無い曲のほうが読み書きの邪魔になりにくいです');
      expect(box.textContent).toContain('職場のネットワークによっては開けないことがあります。そのときは中の音 (ノイズ・ビート) を使ってください');
      // 読み込む前: 枠も外の場所の字も無い
      expect(frames()).toEqual([]);
      expect(outside()).toBe(false);
      const btn = box.querySelector('.focus-music-toggle');
      expect(btn.textContent).toBe('読み込む');
      btn.click();
      const f = frames();
      expect(f.length).toBe(1);
      expect(f[0].getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=' + LIST + '&rel=0');
      expect(f[0].getAttribute('allow')).toBe('autoplay; encrypted-media');
      expect(f[0].getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
      expect(f[0].getAttribute('sandbox').split(' ')).toEqual(expect.arrayContaining(
        ['allow-scripts', 'allow-same-origin', 'allow-popups', 'allow-presentation']));
      expect(f[0].getAttribute('sandbox')).not.toContain('allow-top-navigation');
      expect(f[0].title).toContain('YouTube');
      expect(btn.textContent).toBe('止めて閉じる');
      btn.click();
      expect(frames()).toEqual([]);
      expect(btn.textContent).toBe('読み込む');
    });

    it('SoundCloud も決めた形の URL を入れる', () => {
      const app = mountMusic(OWN, { kind: 'soundcloud', path: 'lofi/sets/rain' });
      startFromRow(app, 25);
      dock().querySelector('.focus-music-toggle').click();
      expect(frames()[0].getAttribute('src')).toBe('https://w.soundcloud.com/player/?url=' +
        encodeURIComponent('https://soundcloud.com/lofi/sets/rain') + '&auto_play=false&visual=false&hide_related=true');
    });

    it('崩れた部品が届いても枠を作らない', () => {
      const app = mountMusic(OWN, { kind: 'youtube', video: VID + '"><img>' });
      startFromRow(app, 25);
      expect(dock().querySelector('.focus-music')).toBe(null);
      expect(frames()).toEqual([]);
    });

    it('集中を終えると外す', () => {
      const app = mountMusic(OWN, { kind: 'youtube', video: VID });
      startFromRow(app, 25);
      dock().querySelector('.focus-music-toggle').click();
      expect(frames()[0].getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/' + VID + '?rel=0&modestbranding=1');
      dock().querySelector('.focus-stop').click();
      expect(frames()).toEqual([]);
      expect(dock()).toBe(null);
    });

    it('画面の中で作る音とは同時に流さない (片方を始めると、もう片方を止める)', () => {
      FakeAudio.made = [];
      window.AudioContext = FakeAudio;
      const app = mountMusic(Object.assign({ 'focus.sound': true }, OWN), { kind: 'youtube', video: VID });
      startFromRow(app, 25);
      const kind = dock().querySelector('.focus-sound-kind');
      kind.value = 'pink';
      const play = dock().querySelector('.focus-sound-toggle');
      play.click();
      expect(play.textContent).toBe('音を止める');
      const first = FakeAudio.made[0].src;
      expect(first.started).toBe(true);
      dock().querySelector('.focus-music-toggle').click();
      expect(first.stopped).toBe(true);
      expect(play.textContent).toBe('音を流す');
      expect(frames().length).toBe(1);
      play.click();
      expect(frames()).toEqual([]);
      expect(dock().querySelector('.focus-music-toggle').textContent).toBe('読み込む');
    });

    it('設定の画面: リンクの欄は打つたびに確かめ、使えるときだけ送る', () => {
      const app = mountMusic(OWN, null);
      app.respond('apiPrefSet', () => prefsFixture({ values: OWN, musicParts: { kind: 'youtube', list: LIST } }));
      q('.nav-item[data-tab="settings"]').click();
      const field = q('[data-pref="focus.musicUrl"]');
      expect(document.getElementById('settings-mine').contains(field)).toBe(true);
      const input = field.querySelector('input.pref-music-url');
      const check = field.querySelector('.pref-music-check');
      input.value = 'https://www.youtube.com.evil.com/watch?v=' + VID;
      input.dispatchEvent(new window.Event('input'));
      expect(check.textContent).toBe('YouTube か SoundCloud のリンクだけ使えます');
      expect(check.classList.contains('is-ng')).toBe(true);
      input.dispatchEvent(new window.Event('change'));
      expect(callsOf(app, 'apiPrefSet')).toEqual([]);
      input.value = 'https://www.youtube.com/playlist?list=' + LIST;
      input.dispatchEvent(new window.Event('input'));
      expect(check.textContent).toBe('このリンクを使えます: YouTube の再生リスト');
      input.dispatchEvent(new window.Event('change'));
      expect(callsOf(app, 'apiPrefSet')).toEqual([['focus.musicUrl', 'https://www.youtube.com/playlist?list=' + LIST]]);
      // 設定の画面を開いても、外のものは読み込まない
      expect(outside()).toBe(false);
    });
  });
});
