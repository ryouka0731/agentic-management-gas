// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFullstack, createServer, go, click, type, OWNER } from './fullstack.js';
import { installCoworkCache } from '../cowork-cache.js';

/*
 * 作業雑談部屋を通しで: 管理者がオンにして部屋を決める → A が入る → B の画面に A が見える →
 * A が出ると消える → もう一度入って合図が止まると2分で消える。返事は本物のサーバが返す。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const A = 'aoki@example.com';
const B = 'beppu@example.com';
const MEET = 'https://meet.google.com/abc-defg-hij';

const card = (name) => $$('.cowork-room').find((c) => c.querySelector('.cowork-room-name').textContent === name);

let opened;
beforeEach(() => {
  window.localStorage.clear();
  opened = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => opened.mockRestore());

describe('作業雑談部屋', () => {
  it('部屋を決める → 入る → ほかの人に見える → 出る → 合図が止まれば2分で消える', async () => {
    const server = createServer();
    const clock = installCoworkCache(server.fake);
    server.fake._setUser(OWNER);
    server.ctx.memberSet(A, '', '青木');
    server.ctx.memberSet(B, '', '別府');

    // 1. 管理者がオンにして、設定の画面で部屋を足す (既定はオフで、左に出ない)
    const admin = mountFullstack({ server });
    await admin.settle();
    expect($('#nav-cowork').hidden).toBe(true);
    go('settings'); await admin.settle();
    click($('[data-pref="cowork.enabled"] button[role="switch"]'));
    await admin.settle();
    expect($('#nav-cowork').hidden).toBe(false);
    click($('.cowork-add'));
    type($('.cowork-editor-row .cowork-name-input'), 'もくもく雑談');
    type($('.cowork-editor-row .cowork-link-input'), '  ' + MEET + '?authuser=0 ');
    expect($('.cowork-link-check').textContent).toBe('このリンクを使えます: Google Meet');
    click($('.cowork-save')); await admin.settle();
    expect(admin.failures).toEqual([]);

    // 2. A が入る: 部屋が新しいタブで開き、名前が出る
    const a = admin.as(A);
    await a.settle();
    go('cowork'); await a.settle();
    click(card('もくもく雑談').querySelector('.cowork-enter')); await a.settle();
    expect(opened).toHaveBeenCalledWith(MEET, '_blank', 'noopener');
    expect(card('もくもく雑談').textContent).toContain('青木 (あなた)');

    // 3. B の画面に A が見える (アドレスは出ない)
    const b = a.as(B);
    await b.settle();
    go('cowork'); await b.settle();
    expect(card('もくもく雑談').querySelector('.cowork-person-name').textContent).toBe('青木');
    expect($('#cowork-rooms').textContent).not.toContain('@');

    // 4. A が出ると、B が見直したときには消えている
    const a2 = b.as(A);
    await a2.settle();
    go('cowork'); await a2.settle();
    click(card('もくもく雑談').querySelector('.cowork-leave')); await a2.settle();
    const b2 = a2.as(B);
    await b2.settle();
    go('cowork'); await b2.settle();
    expect(card('もくもく雑談').querySelector('.cowork-empty').textContent).toBe('いまは誰もいません');

    // 5. A がもう一度入り、画面を閉じた (合図が止まった) ことにする。2分を過ぎると消える
    server.fake._setUser(A);
    server.ctx.apiCoworkEnter(server.ctx.coworkRooms_()[0].id);
    clock.advance(100 * 1000);
    const b3 = b2.as(B);
    await b3.settle();
    go('cowork'); await b3.settle();
    expect(card('もくもく雑談').textContent).toContain('青木');
    clock.advance(30 * 1000);
    click($('#cowork-refresh')); await b3.settle();
    expect(card('もくもく雑談').querySelector('.cowork-empty')).not.toBe(null);

    // 台帳には誰が入ったかが残らない
    expect(JSON.stringify(b3.rows('change_log'))).not.toContain(A);
    // 実績 (ACH:) は開いた日を本人の行に数えるもので、部屋に入ったこととは別
    const props = server.fake.PropertiesService.getScriptProperties().getProperties();
    const roomProps = Object.keys(props).filter((k) => k.indexOf('ACH:') !== 0).map((k) => [k, props[k]]);
    expect(JSON.stringify(roomProps)).not.toContain(A);
    expect(String(props['ACH:' + A] || '')).not.toMatch(/cowork|もくもく/);
  }, 60000);
});
