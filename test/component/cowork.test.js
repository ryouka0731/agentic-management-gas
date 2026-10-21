// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { installCoworkCache } from '../cowork-cache.js';

/*
 * 作業雑談部屋 (js-cowork)。左の「作業雑談部屋」・部屋のカード・入る (新しいタブ)・出る・合図の時計・
 * 設定の画面の部屋の欄。返事は本物のサーバ (疑似GAS) から作る。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const plain = (v) => JSON.parse(JSON.stringify(v));

const OWNER = 'tester@example.com';
const MEMBER = 'member@example.com';
const MEET = 'https://meet.google.com/abc-defg-hij';
const HUDDLE = 'https://app.slack.com/huddle/T01ABCDEF/C02GHIJKL';
const APIS = ['apiCoworkRooms', 'apiCoworkEnter', 'apiCoworkLeave', 'apiCoworkBeat', 'apiCoworkRoomSettings', 'apiCoworkSetRooms'];

function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  const clock = installCoworkCache(fake);
  fake._setUser(OWNER);
  ctx.apiPrefSet('cowork.enabled', true);
  ctx.memberSet(MEMBER, '', '山田');
  ctx.memberSet(OWNER, '', '佐藤');
  ctx.apiCoworkSetRooms([{ name: '雑談', link: MEET }, { name: 'もくもく', link: HUDDLE }]);
  return { ctx, fake, clock };
}

function open(srv, who, over) {
  const wire = {};
  APIS.forEach((name) => {
    wire[name] = (...args) => {
      srv.fake._setUser(who);
      try {
        return plain(srv.ctx[name](...args));
      } catch (e) {
        return new Error(e.message);
      }
    };
  });
  return mount(Object.assign({ apiPrefs: prefsFixture({ values: { 'cowork.enabled': true } }) }, wire, over || {}));
}

const go = () => $('.nav-item[data-tab="cowork"]').click();
const room = (name) => $$('.cowork-room').find((c) => c.querySelector('.cowork-room-name').textContent === name);

let opened;
beforeEach(() => {
  window.localStorage.clear();
  opened = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  opened.mockRestore();
  vi.useRealTimers();
});

describe('作業雑談部屋の入口', () => {
  it('オフ (既定) なら左に出ず、部屋の api を呼ばない', () => {
    const app = mount();
    expect($('#nav-cowork').hidden).toBe(true);
    expect(app.calls.some((c) => /^apiCowork(Rooms|Enter|Beat)/.test(c.name))).toBe(false);
  });

  it('オンなら左に出て、開くと部屋と「いまは誰もいません」が出る', () => {
    const srv = server();
    open(srv, MEMBER);
    expect($('#nav-cowork').hidden).toBe(false);
    go();
    expect($('#panel-cowork').hidden).toBe(false);
    expect($$('.cowork-room-name').map((e) => e.textContent)).toEqual(['雑談', 'もくもく']);
    expect(room('雑談').textContent).toContain('Google Meet');
    expect(room('もくもく').textContent).toContain('Slack ハドル');
    expect(room('雑談').querySelector('.cowork-empty').textContent).toBe('いまは誰もいません');
    expect($('#cowork-rooms').textContent).toContain('番頭は誰が入ったかを記録せず');
  });
});

describe('入る・出る', () => {
  it('入ると、組み直したリンクを noopener で新しいタブに開き、名前が出る。ほかの人にも見える', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    room('雑談').querySelector('.cowork-enter').click();
    expect(opened).toHaveBeenCalledWith(MEET, '_blank', 'noopener');
    expect(room('雑談').classList.contains('is-mine')).toBe(true);
    expect(room('雑談').querySelector('.cowork-person-name').textContent).toBe('山田 (あなた)');
    expect(room('雑談').querySelector('.cowork-count').textContent).toBe('いま 1 人');

    open(srv, OWNER);
    go();
    expect(room('雑談').querySelector('.cowork-person-name').textContent).toBe('山田');
    expect(room('雑談').querySelector('.cowork-enter')).not.toBe(null);
    // 画面にアドレスは出ない
    expect($('#cowork-rooms').textContent).not.toContain('@');
  });

  it('出ると名前が消え、合図も止まる', () => {
    vi.useFakeTimers();
    const srv = server();
    const app = open(srv, MEMBER);
    go();
    room('もくもく').querySelector('.cowork-enter').click();
    expect(opened).toHaveBeenCalledWith(HUDDLE, '_blank', 'noopener');
    room('もくもく').querySelector('.cowork-leave').click();
    expect(room('もくもく').querySelector('.cowork-empty')).not.toBe(null);
    expect(srv.ctx.apiCoworkRooms().rooms[1].count).toBe(0);
    // 別の画面へ移ると、時計は止まる (合図を送らない)
    $('.nav-item[data-tab="home"]').click();
    const before = app.calls.length;
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(app.calls.slice(before).filter((c) => /^apiCowork/.test(c.name))).toEqual([]);
  });
});

describe('遅れて届く返事', () => {
  it('出たあとに、出る前に頼んだ様子の返事が届いても、入り直さない', () => {
    const srv = server();
    let held = null;
    const app = open(srv, MEMBER, {
      apiCoworkRooms: () => {
        srv.fake._setUser(MEMBER);
        const res = plain(srv.ctx.apiCoworkRooms());
        return held === false ? res : { later: (ok) => { held = () => ok(res); } };
      },
    });
    held = false;
    go();
    room('雑談').querySelector('.cowork-enter').click();
    held = null;
    $('#cowork-refresh').click();
    room('雑談').querySelector('.cowork-leave').click();
    expect(typeof held).toBe('function');
    held();
    expect(room('雑談').classList.contains('is-mine')).toBe(false);
    expect(room('雑談').querySelector('.cowork-enter')).not.toBe(null);
    expect(app.calls.length).toBeGreaterThan(0);
  });

  it('合図が「別の部屋にいます」と返したら、画面もその部屋にいることにする', () => {
    vi.useFakeTimers();
    const srv = server();
    open(srv, MEMBER);
    go();
    room('雑談').querySelector('.cowork-enter').click();
    // 別のタブで「もくもく」に入った
    srv.fake._setUser(MEMBER);
    srv.ctx.apiCoworkEnter(srv.ctx.coworkRooms_()[1].id);
    $('.nav-item[data-tab="home"]').click();
    go();
    vi.advanceTimersByTime(60 * 1000);
    expect(room('もくもく').classList.contains('is-mine')).toBe(true);
    expect(room('雑談').classList.contains('is-mine')).toBe(false);
  });
});

describe('合図の時計', () => {
  it('入っているあいだ1分ごとに合図を送り、ほかの画面にいても名前は消えない', () => {
    vi.useFakeTimers();
    const srv = server();
    const app = open(srv, MEMBER);
    go();
    room('雑談').querySelector('.cowork-enter').click();
    $('.nav-item[data-tab="home"]').click();
    const beats = () => app.calls.filter((c) => c.name === 'apiCoworkBeat');
    for (let i = 1; i <= 3; i++) {
      srv.clock.advance(60 * 1000);
      vi.advanceTimersByTime(60 * 1000);
      expect(beats()).toHaveLength(i);
    }
    expect(beats()[0].args).toEqual([srv.ctx.coworkRooms_()[0].id]);
    expect(srv.ctx.apiCoworkRooms().rooms[0].count).toBe(1);
  });

  it('タブが裏のまま30分を過ぎると合図を止め、表に戻ったらすぐ送り直す', () => {
    vi.useFakeTimers();
    const srv = server();
    const app = open(srv, MEMBER);
    go();
    room('雑談').querySelector('.cowork-enter').click();
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new window.Event('visibilitychange'));
    const beats = () => app.calls.filter((c) => c.name === 'apiCoworkBeat').length;
    vi.advanceTimersByTime(30 * 60 * 1000);
    const during = beats();
    expect(during).toBeGreaterThanOrEqual(29);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(beats()).toBe(during);
    hidden = false;
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(beats()).toBe(during + 1);
    delete document.hidden;
  });
});

describe('設定の画面: 部屋を決める', () => {
  it('管理者は打ちながらリンクを確かめ、保存すると部屋の一覧が変わる', () => {
    const srv = server();
    open(srv, OWNER);
    $('.nav-item[data-tab="settings"]').click();
    const editor = $('.cowork-editor');
    expect($$('.cowork-editor-row')).toHaveLength(2);
    expect($$('.cowork-link-input').map((e) => e.value)).toEqual([MEET, HUDDLE]);
    editor.querySelector('.cowork-add').click();
    const row = $$('.cowork-editor-row')[2];
    const url = row.querySelector('.cowork-link-input');
    url.value = 'https://meet.google.com.evil.com/abc-defg-hij';
    url.dispatchEvent(new window.Event('input'));
    expect(row.querySelector('.cowork-link-check').classList.contains('is-ng')).toBe(true);
    expect(row.querySelector('.cowork-link-check').textContent).toContain('Google Meet か Slack のリンクだけ');
    editor.querySelector('.cowork-save').click();
    expect(srv.ctx.coworkRooms_()).toHaveLength(2);

    url.value = 'https://team-x.slack.com/archives/C09ZZZZZZ';
    url.dispatchEvent(new window.Event('input'));
    expect(row.querySelector('.cowork-link-check').textContent).toBe('このリンクを使えます: Slack チャンネル');
    row.querySelector('.cowork-name-input').value = '相談';
    $$('.cowork-editor-row')[0].querySelector('.cowork-remove').click();
    editor.querySelector('.cowork-save').click();
    expect(srv.ctx.coworkRooms_().map((r) => r.name)).toEqual(['もくもく', '相談']);
  });

  it('管理者でなければ欄は出ず、部屋の一覧も取りに行かない', () => {
    const srv = server();
    const app = open(srv, MEMBER, { apiPrefs: prefsFixture({ values: { 'cowork.enabled': true }, canEditTeam: false }) });
    $('.nav-item[data-tab="settings"]').click();
    expect($('.cowork-editor').textContent).toContain('部屋は管理者が決めます');
    expect($('.cowork-link-input')).toBe(null);
    expect(app.calls.some((c) => c.name === 'apiCoworkRoomSettings')).toBe(false);
  });
});
