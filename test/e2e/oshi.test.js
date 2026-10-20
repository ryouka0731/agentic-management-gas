// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountFullstack, go, click, byText } from './fullstack.js';

/*
 * 推しを通しで: 設定でオンにする → 自分 → 推しで名前と絵を入れる → やることを済ませる → 隅で推しがほめる。
 * 返事は本物のサーバ (疑似GAS) が返す。画像は台帳ではなく objects/ に置かれ、本人にしか返らない。
 */

const $ = (s) => document.querySelector(s);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');

async function waitFor(e2e, fn) {
  for (let i = 0; i < 100; i++) {
    await e2e.settle();
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('待ちきれませんでした');
}

describe('推しにほめてもらう', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('オンにして絵を入れ、やることを済ませると、その絵とせりふで吹き出しが出る', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    e2e.ctx.issueCreate('慶弔規程の見直し', '', []);

    // 1. 設定でオンにする (既定はオフ)
    go('settings'); await e2e.settle();
    click($('[data-pref="oshi.on"] button[role="switch"]')); await e2e.settle();
    expect($('[data-pref="oshi.on"] button[role="switch"]').getAttribute('aria-checked')).toBe('true');

    // 2. 自分 → 推し。名前と口調を決める
    click($('#me-btn'));
    click(byText('#me-body button', '推し')); await e2e.settle();
    $('.oshi-page .oshi-name-input').value = 'ルナ';
    $('.oshi-page .oshi-tone').value = 'kansai';
    click($('.oshi-page .oshi-profile-save')); await e2e.settle();
    expect(e2e.rows('oshi')[0]).toMatchObject({ who: 'tester@example.com', name: 'ルナ', tone: 'kansai' });

    // 3. 「おいわい」の絵を入れる (縮められない環境なので、そのまま送る)
    const input = $('.oshi-page .oshi-state[data-state="celebrate"] input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new window.File([PNG], 'luna.png', { type: 'image/png' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(e2e, () => e2e.rows('oshi_images').length === 1);
    const row = e2e.rows('oshi_images')[0];
    expect(row).toMatchObject({ who: 'tester@example.com', state: 'celebrate', mime: 'image/png' });
    expect(e2e.ctx.objectExists(row.sha, 'png')).toBe(true);

    // 4. やることを済ませる → 推しがほめる
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    const b = $('#oshi-bubble');
    expect(b.hidden).toBe(false);
    expect(b.dataset.event).toBe('done');
    expect(b.querySelector('.oshi-name').textContent).toBe('ルナ');
    expect(e2e.ctx.OSHI_LINES().kansai.done).toContain(b.querySelector('.oshi-line').textContent);
    expect(b.querySelector('img.oshi-img').getAttribute('src')).toBe(PNG_URL);

    // 5. ほかの人の画面には出ない (その人の推しは空)
    const other = e2e.as('b@example.com');
    await other.settle();
    other.fake._setUser('b@example.com');
    expect(other.ctx.apiOshiImage('celebrate')).toBe(null);
  });
});
