// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFullstack, go, click, byText } from './fullstack.js';

/*
 * 思いがけない当たり → ノリノリタイム → 自分へのご褒美を通しで。返事は本物のサーバ (疑似GAS) が返す。
 * 設定でオンにする → やることを3つ済ませる (1つ目で当たり・推しも驚く、3つ目でノリノリタイム) →
 * 自分 → 自分へのご褒美でご褒美を決めて交換する → 取り消す。ほかの人には見えない。
 */

const $ = (s) => document.querySelector(s);

describe('当たりとノリノリタイムと、自分へのご褒美', () => {
  let rnd;
  beforeEach(() => {
    window.localStorage.clear();
    // 当たりは 1/8 (0.1 × 8 < 1 で当たる)。推しのもともとの当たり (1/12) には当たらない値
    rnd = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  });
  afterEach(() => {
    rnd.mockRestore();
    document.body.classList.remove('luck-fever-on');
  });

  it('オンにする → 済ませる → 当たり → ノリノリタイム → ご褒美と交換 → 取り消す', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    ['慶弔規程の見直し', '就業規則の改定', '旅費規程の確認'].forEach((t) => e2e.ctx.issueCreate(t, '', []));

    // 1. 既定はオフ。済ませても何も出ない
    go('settings'); await e2e.settle();
    expect($('[data-pref="luck.on"] button[role="switch"]').getAttribute('aria-checked')).toBe('false');
    expect($('[data-pref="luck.reward"] button[role="switch"]').getAttribute('aria-checked')).toBe('false');
    click($('[data-pref="luck.on"] button[role="switch"]')); await e2e.settle();
    click($('[data-pref="luck.reward"] button[role="switch"]')); await e2e.settle();

    // 2. 1つ目を済ませる → 大当たり (3つとも同じ絵)。推しも「当たり」に驚く
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    const win = $('#fun-layer .luck-win');
    expect(win.querySelector('.luck-win-title').textContent).toBe('大当たり！');
    const cells = [...win.querySelectorAll('.luck-cell')].map((c) => c.textContent);
    expect(new Set(cells).size).toBe(1);
    const bubble = $('#oshi-bubble');
    expect(bubble.dataset.event).toBe('lucky');
    // 当たってもポイントは何も増えない (サーバには何も送っていない)
    expect(e2e.calls.some((c) => /luck/i.test(c.name))).toBe(false);

    // 3. あと2つ済ませると、ノリノリタイム (30分空けていないので、もう当たりは出ない)
    win.remove();
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    expect($('#fun-layer .luck-win')).toBe(null);
    expect($('#luck-fever')).toBe(null);
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    expect($('#luck-fever .luck-fever-label').textContent).toBe('ノリノリタイム');
    expect(document.body.classList.contains('luck-fever-on')).toBe(true);

    // 4. 自分 → 自分へのご褒美。済ませた3件が 3 ポイント (ポイントに参加していないので件数で数える)
    click($('#me-btn'));
    click(byText('#me-body button', '自分へのご褒美')); await e2e.settle();
    const box = () => $('#side-panel .reward-view');
    expect(box().querySelector('.reward-available').textContent).toBe('3');
    box().querySelector('.reward-title-in').value = '好きなコーヒー';
    box().querySelector('.reward-cost-in').value = '2';
    click(box().querySelector('.reward-form button[type="submit"]')); await e2e.settle();
    box().querySelector('.reward-title-in').value = '映画を1本';
    box().querySelector('.reward-cost-in').value = '10';
    click(box().querySelector('.reward-form button[type="submit"]')); await e2e.settle();
    expect([...box().querySelectorAll('.reward-item-title')].map((e) => e.textContent)).toEqual(['好きなコーヒー', '映画を1本']);
    // 足りないものは押せない
    expect(byText('#side-panel .reward-item', '映画を1本').querySelector('.reward-spend').disabled).toBe(true);

    // 5. 交換する → 残りが減り、記録に残る
    click(byText('#side-panel .reward-item', '好きなコーヒー').querySelector('.reward-spend')); await e2e.settle();
    expect(box().querySelector('.reward-available').textContent).toBe('1');
    expect(box().querySelector('.reward-log').textContent).toContain('好きなコーヒー (2 ポイント)');
    // 残り 1 では、もう交換できない
    expect(byText('#side-panel .reward-item', '好きなコーヒー').querySelector('.reward-spend').disabled).toBe(true);

    // 6. 取り消す (5分のあいだ)
    click(box().querySelector('.reward-undo button')); await e2e.settle();
    expect(box().querySelector('.reward-available').textContent).toBe('3');
    expect(box().querySelector('.reward-log')).toBe(null);

    // 7. ほかの人には見えない (台帳にも置いていない)
    const other = e2e.as('b@example.com');
    await other.settle();
    other.fake._setUser('b@example.com');
    other.ctx.apiPrefSet('luck.reward', true);
    expect(other.ctx.apiRewardGet().items).toEqual([]);
    expect(Object.keys(other.ctx.DB_SCHEMA()).some((t) => /reward/.test(t))).toBe(false);
  });
});
