// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推しの頁の「プロフィール」(Lv で少しずつ分かる) と「クリア」、自分のキャラのプロフィールの欄、
 * 設定の画面の管理者の欄「最初からいるキャラのプロフィール」。返事は本物のサーバ (疑似GAS) から作る。
 * 中身はどれも作り話。
 */

const ME = 'tester@example.com';
const VIDEO = 'Tst0Vid_e-1';
const SAMPLE = {
  items: [
    { lv: 2, label: 'テストの口ぐせ', text: 'まずは小さく試そう' },
    { lv: 30, label: 'テストのひみつ', text: 'じつは早起きが苦手' },
  ],
  clearLine: 'テストのお祝いの言葉',
  clearVideo: 'https://www.youtube.com/watch?v=' + VIDEO,
};
const wire = (v) => JSON.parse(JSON.stringify(v));
/** サーバの断りは、実物と同じく失敗のハンドラに届ける */
const serve = (fn) => (...args) => {
  try { return wire(fn(...args)); } catch (e) { return new Error(e.message); }
};
/** 動画の再生機 (YouTube) を読み込んでいるか */
const youtubeFrames = () => [...document.querySelectorAll('iframe')].filter((f) => /youtube/.test(f.getAttribute('src') || ''));

/** 本物のサーバ。タク (最初からいるキャラ) に SAMPLE を入れ、実績を n 個 (省けば全部) 取った人 */
function server(n) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  ctx.apiOshiBuiltinProfileSet('taku', SAMPLE);
  const all = ctx.ACHIEVEMENTS().map((a) => a.key);
  const got = {};
  all.slice(0, n === undefined ? all.length : n).forEach((k) => { got[k] = '2026-10-21'; });
  fake.PropertiesService.getScriptProperties().setProperty('ACH:' + ME, JSON.stringify({ days: { n: 1, last: '2026-10-21' }, got }));
  return ctx;
}

function mountOshi(oshi, over) {
  const v = { 'oshi.on': true };
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
    apiOshiGet: oshi,
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: 'data:image/webp;base64,AAAA' }),
  }, over || {}));
}

function openPage() {
  document.getElementById('me-btn').click();
  const btn = [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し');
  btn.click();
  return document.querySelector('.oshi-page');
}
const rows = (page) => [...page.querySelectorAll('.oshi-reveal-item')];

describe('推しのプロフィールとクリア', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('Lv が届いた項目は見出しと中身、届いていない項目は ??? と「Lv ◯ で分かる」', () => {
    const ctx = server(1); // Lv 2
    mountOshi(wire(ctx.apiOshiGet()));
    const page = openPage();
    const r = rows(page);
    expect(r.map((li) => [li.dataset.lv, li.dataset.open])).toEqual([['2', 'true'], ['30', 'false']]);
    expect(r[0].textContent).toContain('テストの口ぐせ');
    expect(r[0].textContent).toContain('まずは小さく試そう');
    expect(r[1].querySelector('strong').textContent).toBe('???');
    expect(r[1].textContent).toContain('Lv 30 で分かる');
    expect(page.textContent).not.toContain('テストのひみつ');
    expect(page.querySelector('.oshi-reveal').textContent).toContain('分かったもの 1 / 2');
    // クリアまでは節も動画の入口も無い
    expect(page.querySelector('.oshi-clear')).toBe(null);
    expect(youtubeFrames()).toEqual([]);
  });

  it('クリアしたら全部の項目とお祝いの言葉。動画は「動画を見る」を押すまで読み込まない', () => {
    const ctx = server();
    mountOshi(wire(ctx.apiOshiGet()));
    const page = openPage();
    expect(rows(page).every((li) => li.dataset.open === 'true')).toBe(true);
    const clear = page.querySelector('.oshi-clear');
    expect(clear.querySelector('.oshi-clear-line').textContent).toContain('テストのお祝いの言葉');
    expect(youtubeFrames()).toEqual([]);
    const play = clear.querySelector('.oshi-clear-play');
    expect(play.textContent).toBe('動画を見る');
    play.click();
    const f = clear.querySelector('iframe.oshi-clear-frame');
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/' + VIDEO + '?rel=0&modestbranding=1');
    expect(play.hidden).toBe(true);
    expect(youtubeFrames()).toEqual([f]);
  });

  it('お祝いの言葉が無いキャラは、口調の「実績を全部取った」のせりふを言う。動画が無ければボタンも無い', () => {
    const ctx = server();
    ctx.apiOshiBuiltinProfileSet('taku', { items: SAMPLE.items });
    const d = wire(ctx.apiOshiGet());
    mountOshi(d);
    const clear = openPage().querySelector('.oshi-clear');
    const lines = d.events.find((e) => e.key === 'clear').lines;
    expect(lines.some((l) => clear.textContent.includes(l))).toBe(true);
    expect(clear.querySelector('.oshi-clear-play')).toBe(null);
  });

  it('実績を止めている人には、Lv が上がらないと添える', () => {
    const ctx = server(1);
    ctx.apiPrefSet('ach.on', false);
    mountOshi(wire(ctx.apiOshiGet()));
    expect(openPage().querySelector('.oshi-reveal').textContent).toContain('「実績を集める」が切ってある');
  });

  it('プロフィールが無ければ、最初からいるキャラは管理者が決めると言う', () => {
    const ctx = server(1);
    ctx.apiOshiBuiltinProfileSet('taku', '');
    mountOshi(wire(ctx.apiOshiGet()));
    const sec = openPage().querySelector('.oshi-reveal');
    expect(sec.textContent).toContain('管理者が決めます');
    expect(sec.querySelector('.oshi-reveal-item')).toBe(null);
  });

  it('自分のキャラの「プロフィール (JSON)」を保存すると apiOshiSetCharProfile に送り、頁を取り直す', () => {
    const ctx = server(1);
    const c = ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    let current = wire(ctx.apiOshiGet());
    const app = mountOshi(() => current, {
      apiPrefs: prefsFixture({ values: { 'oshi.on': true, 'oshi.char': 'mine:' + c } }),
      apiOshiSetCharProfile: (id, json) => {
        const out = wire(ctx.apiOshiSetCharProfile(id, json));
        current = wire(ctx.apiOshiGet());
        return out;
      },
    });
    const page = openPage();
    const area = page.querySelector('.oshi-profile-json');
    expect(area.value).toBe('');
    area.value = JSON.stringify({ items: [{ lv: 2, label: 'テストの好物', text: 'テスト用の焼きそば' }] });
    page.querySelector('.oshi-profile-json-save').click();
    const sent = app.calls.find((x) => x.name === 'apiOshiSetCharProfile');
    expect(sent.args).toEqual([c, area.value]);
    const again = document.querySelector('.oshi-page');
    expect(rows(again).map((li) => li.textContent)).toEqual(['テストの好物テスト用の焼きそば']);
    expect(JSON.parse(again.querySelector('.oshi-profile-json').value).items[0].label).toBe('テストの好物');
  });

  it('実績で Lv が上がって新しく分かる項目があれば、知らせに添える', () => {
    const ctx = server(0); // Lv 1
    const oshi = wire(ctx.apiOshiGet());
    // 開いたときの数え直しで「はじめの一日」を取り Lv 2 になる
    const check = wire(ctx.apiAchievementsCheck());
    expect(check.level).toBe(2);
    let first = true;
    mountOshi(() => {
      if (first) { first = false; return oshi; }
      return wire(ctx.apiOshiGet());
    }, { apiAchievementsCheck: check, apiAchievements: wire(ctx.apiAchievements()) });
    const toast = document.getElementById('ach-toast');
    expect(toast.textContent).toContain('推しのプロフィールが 1 つ分かりました');
  });
});

describe('見直しで直したところ (推しの頁)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /** 開いたときの数え直し (Lv1 → Lv2) を、頁を開いたあとに届ける */
  function delayedCheck() {
    const ctx = server(0);
    const before = wire(ctx.apiOshiGet());
    const check = wire(ctx.apiAchievementsCheck());
    let deliver = null;
    return { ctx, before, check, later: { later: (ok) => { deliver = () => ok(check); } }, deliver: () => deliver() };
  }

  it('推しの頁を開いているときも、新しく分かった項目の数を知らせに添え、頁も描き直す', () => {
    const t = delayedCheck();
    let calls = 0;
    mountOshi(() => (calls++ === 0 ? t.before : wire(t.ctx.apiOshiGet())),
      { apiAchievementsCheck: t.later, apiAchievements: wire(t.ctx.apiAchievements()) });
    // 最初の返事 (Lv1) で頁を描く
    calls = 0;
    const page = openPage();
    expect(rows(page)[0].dataset.open).toBe('false');
    t.deliver();
    expect(document.getElementById('ach-toast').textContent).toContain('推しのプロフィールが 1 つ分かりました');
    expect(rows(document.querySelector('.oshi-page'))[0].dataset.open).toBe('true');
  });

  it('取りに行っている最中に Lv が変わったら、届いた (古い) 返事のあとに取り直す', () => {
    const t = delayedCheck();
    const pend = [];
    let hold = false;
    const app = mountOshi(() => {
      if (!hold) return t.before;
      return { later: (ok) => pend.push(ok) };
    }, { apiAchievementsCheck: t.later, apiAchievements: wire(t.ctx.apiAchievements()) });
    hold = true;
    openPage();
    expect(pend.length).toBe(1);
    // 頼んだ返事が届く前に、実績で Lv が上がる
    t.deliver();
    const asked = app.calls.filter((c) => c.name === 'apiOshiGet').length;
    pend.shift()(t.before);
    // 古い返事で描いたあと、もう一度頼む
    expect(app.calls.filter((c) => c.name === 'apiOshiGet').length).toBe(asked + 1);
    pend.shift()(wire(t.ctx.apiOshiGet()));
    expect(rows(document.querySelector('.oshi-page'))[0].dataset.open).toBe('true');
  });

  it('「動画を見る」を押したら、焦点を再生機に移す (ボタンが消えても body に落とさない)', () => {
    const ctx = server();
    mountOshi(wire(ctx.apiOshiGet()));
    const clear = openPage().querySelector('.oshi-clear');
    clear.querySelector('.oshi-clear-play').focus();
    clear.querySelector('.oshi-clear-play').click();
    expect(document.activeElement).toBe(clear.querySelector('iframe.oshi-clear-frame'));
  });
});

describe('設定の画面の「最初からいるキャラのプロフィール」(管理者だけ)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('管理者には最初からいるキャラごとの欄を出し、保存で apiOshiBuiltinProfileSet に送る', () => {
    const ctx = server(0);
    const app = mount({
      apiOshiBuiltinProfiles: wire(ctx.apiOshiBuiltinProfiles()),
      apiOshiBuiltinProfileSet: serve((key, json) => ctx.apiOshiBuiltinProfileSet(key, json)),
    });
    document.querySelector('[data-tab="settings"]').click();
    const box = document.querySelector('#settings-team .oshi-builtin-profiles');
    expect(box.textContent).toContain('管理者だけ');
    const fields = [...box.querySelectorAll('.oshi-builtin-profile')];
    expect(fields.map((f) => f.dataset.char)).toEqual(['taku', 'itsuki']);
    expect(fields[0].textContent).toContain('タク (2 項目)');
    const area = fields[1].querySelector('textarea');
    const text = JSON.stringify({ items: [{ lv: 3, label: 'テストの趣味', text: 'テスト' }] });
    area.value = text;
    fields[1].querySelector('.oshi-builtin-profile-save').click();
    expect(app.calls.find((c) => c.name === 'apiOshiBuiltinProfileSet').args).toEqual(['itsuki', text]);
    // 保存したものを整えた形で出し直す
    expect(JSON.parse(area.value).items[0].label).toBe('テストの趣味');
    expect(fields[1].textContent).toContain('イツキ (1 項目)');
  });

  it('検査に通らなければ、ふつうの言葉で断り、ボタンを押せるように戻す', () => {
    const ctx = server(0);
    mount({
      apiOshiBuiltinProfiles: wire(ctx.apiOshiBuiltinProfiles()),
      apiOshiBuiltinProfileSet: serve((key, json) => ctx.apiOshiBuiltinProfileSet(key, json)),
    });
    document.querySelector('[data-tab="settings"]').click();
    const field = document.querySelector('.oshi-builtin-profile[data-char="taku"]');
    field.querySelector('textarea').value = '{"items": [{"lv": 1, "label": "a", "text": "b"}]}';
    const save = field.querySelector('.oshi-builtin-profile-save');
    save.click();
    expect(document.getElementById('snackbar').textContent).toContain('2 から 99 までの整数');
    expect(save.disabled).toBe(false);
  });

  it('管理者でなければ節を出さず、尋ねもしない', () => {
    const app = mount({ apiSettings: Object.assign({}, DEFAULTS.apiSettings, { canEdit: false }) });
    document.querySelector('[data-tab="settings"]').click();
    expect(document.querySelector('.oshi-builtin-profiles')).toBe(null);
    expect(app.calls.some((c) => c.name === 'apiOshiBuiltinProfiles')).toBe(false);
  });
});
