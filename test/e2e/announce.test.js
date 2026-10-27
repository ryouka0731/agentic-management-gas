// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullstack, createServer, go, click, type, choose, OWNER } from './fullstack.js';

/*
 * お知らせ・1問アンケートを通しで: 管理者が設定の画面で置く → A のホームに出る → 答えると消え、
 * 開き直してももう出ない → B は閉じる → 管理者の一覧に選択肢ごとの数だけが出る (名前は出ない)。
 * 返事は本物のサーバが返す。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const A = 'aoki@example.com';
const B = 'beppu@example.com';

beforeEach(() => { window.localStorage.clear(); });

describe('お知らせとアンケート', () => {
  it('置く → ホームに出る → 答える → もう出ない → 管理者には数だけ', async () => {
    const server = createServer();

    // 1. 管理者 (持ち主) が設定の画面でアンケートを置く
    const admin = mountFullstack({ server, user: OWNER });
    await admin.settle();
    go('settings'); await admin.settle();
    choose($('#announce-kind'), 'poll');
    type($('#announce-title'), '忘年会の日');
    type($('#announce-body'), 'どちらがよいですか\n1つ選んでください');
    type($('#announce-options'), '12/20\n12/27');
    click($('#announce-create')); await admin.settle();
    expect(admin.failures).toEqual([]);
    expect($('[data-announce-item="1"]').textContent).toContain('忘年会の日');

    // 2. A のホームの上に出る。答えるとありがとうの一言で消える
    const a = admin.as(A);
    await a.settle();
    expect($('#home-announce .announce-title').textContent).toBe('忘年会の日');
    expect($('#home-announce .announce-text').textContent).toBe('どちらがよいですか\n1つ選んでください');
    click($$('#home-announce .announce-option').find((b) => b.textContent === '12/27')); await a.settle();
    expect(a.failures).toEqual([]);
    expect($('#home-announce').children).toHaveLength(0);
    expect(a.snacks.some((t) => t.includes('ありがとう'))).toBe(true);

    // 3. 開き直しても、もう出ない
    const a2 = a.as(A);
    await a2.settle();
    expect($('#home-announce').children).toHaveLength(0);

    // 4. B には出る。閉じると消え、開き直しても出ない
    const b = a2.as(B);
    await b.settle();
    click($('#home-announce .announce-close')); await b.settle();
    expect($('#home-announce').children).toHaveLength(0);
    const b2 = b.as(B);
    await b2.settle();
    expect($('#home-announce').children).toHaveLength(0);
    expect(b2.rows('announcement_replies').map((r) => r.answer).sort()).toEqual(['12/27', 'closed']);

    // 5. 管理者の一覧には選択肢ごとの数だけ。誰が答えたかは出ない
    const admin2 = b2.as(OWNER);
    await admin2.settle();
    go('settings'); await admin2.settle();
    const item = $('[data-announce-item="1"]');
    expect(item.textContent).toContain('12/20: 0人');
    expect(item.textContent).toContain('12/27: 1人');
    expect(item.textContent).toContain('閉じた 1');
    expect($('#announce-settings').textContent).not.toMatch(/aoki|beppu|@/);

    // 6. 終えると、まだ片づけていない人にも出なくなる
    click(item.querySelector('.announce-archive')); await admin2.settle();
    expect(admin2.failures).toEqual([]);
    const c = admin2.as('chiba@example.com');
    await c.settle();
    expect($('#home-announce').children).toHaveLength(0);
  });
});
