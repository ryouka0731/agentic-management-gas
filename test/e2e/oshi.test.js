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

    // 1. 設定では最初からオン (既定でオン)
    go('settings'); await e2e.settle();
    expect($('[data-pref="oshi.on"] button[role="switch"]').getAttribute('aria-checked')).toBe('true');

    // 2. 自分 → 推し。自分のキャラを作り、名前と口調を決め、使うキャラにする
    click($('#me-btn'));
    click(byText('#me-body button', '推し')); await e2e.settle();
    expect($('.oshi-page').textContent).toContain('まだ自分のキャラはいません');
    click($('.oshi-page .oshi-create')); await e2e.settle();
    $('.oshi-page .oshi-name-input').value = 'ルナ';
    $('.oshi-page .oshi-tone').value = 'kansai';
    click($('.oshi-page .oshi-profile-save')); await e2e.settle();
    expect(e2e.rows('oshi')[0]).toMatchObject({ who: 'tester@example.com', name: 'ルナ', tone: 'kansai', charId: 1 });
    click($('.oshi-page .oshi-use')); await e2e.settle();
    expect($('.oshi-page .oshi-use').textContent).toBe('使っています');

    // 3. 「おいわい」の絵を入れる (縮められない環境なので、そのまま送る)
    const input = $('.oshi-page .oshi-state[data-state="celebrate"] input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new window.File([PNG], 'luna.png', { type: 'image/png' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(e2e, () => e2e.rows('oshi_images').length === 1);
    const row = e2e.rows('oshi_images')[0];
    expect(row).toMatchObject({ who: 'tester@example.com', state: 'celebrate', mime: 'image/png', charId: 1 });
    expect(e2e.ctx.objectsFolder_().getFilesByName(e2e.ctx.oshiObjectName_(row.sha, 'png')).hasNext()).toBe(true);

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
    expect(other.ctx.apiOshiImage(1, 'celebrate')).toBe(null);
    expect(other.ctx.apiOshiGet()).toMatchObject({ name: 'タク', mine: [] });
  });

  it('設定でイツキを選ぶ → 済ませるとイツキがほめる。自分のキャラを作って選び、絵を1枚入れると、ほかの表情は選んだ最初からいるキャラ', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    e2e.ctx.issueCreate('慶弔規程の見直し', '', []);
    e2e.ctx.issueCreate('就業規則の見直し', '', []);

    // 1. 推しは最初からオン。使うキャラでイツキのカードを押す
    go('settings'); await e2e.settle();
    const itsuki = $('[data-pref="oshi.char"] .oshi-choice[data-char="builtin:itsuki"]');
    expect(itsuki).toBeTruthy();
    await waitFor(e2e, () => !!itsuki.querySelector('img'));
    expect(itsuki.querySelector('img').getAttribute('src')).toBe(e2e.ctx.apiOshiDefaultImage('itsuki', 'chibi', 'idle').dataUrl);
    click(itsuki); await e2e.settle();
    expect(itsuki.getAttribute('aria-checked')).toBe('true');
    expect(e2e.ctx.prefGet_('oshi.char', 'tester@example.com')).toBe('builtin:itsuki');
    // 選ぶと、イツキがその口調で礼を言う (絵はイツキのどれかの表情)
    await waitFor(e2e, () => $('#oshi-bubble') && $('#oshi-bubble').dataset.event === 'chosen' && !!$('#oshi-bubble img.oshi-img'));
    expect(e2e.ctx.OSHI_LINES().gothic.chosen).toContain($('#oshi-bubble .oshi-line').textContent);
    const st = $('#oshi-bubble').dataset.state;
    expect($('#oshi-bubble img.oshi-img').getAttribute('src')).toBe(e2e.ctx.apiOshiDefaultImage('itsuki', 'chibi', st).dataUrl);

    // 2. やることを済ませる → イツキの絵と耽美のせりふ
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    let b = $('#oshi-bubble');
    await waitFor(e2e, () => !!b.querySelector('img.oshi-img'));
    expect(b.dataset.char).toBe('builtin:itsuki');
    expect(b.querySelector('.oshi-name').textContent).toBe('イツキ');
    expect(e2e.ctx.OSHI_LINES().gothic.done).toContain(b.querySelector('.oshi-line').textContent);
    expect(b.querySelector('img.oshi-img').getAttribute('src')).toBe(e2e.ctx.apiOshiDefaultImage('itsuki', 'chibi', 'celebrate').dataUrl);

    // 3. 絵が無い表情にはイツキの絵を出す
    go('settings'); await e2e.settle();
    const fb = $('[data-pref="oshi.fallback"] select');
    fb.value = 'builtin:itsuki';
    fb.dispatchEvent(new window.Event('change', { bubbles: true })); await e2e.settle();
    expect(e2e.ctx.prefGet_('oshi.fallback', 'tester@example.com')).toBe('builtin:itsuki');

    // 4. 自分のキャラを作り、使うキャラにして、「ほめる」の絵だけ入れる
    click($('#me-btn'));
    click(byText('#me-body button', '推し')); await e2e.settle();
    click($('.oshi-page .oshi-create')); await e2e.settle();
    $('.oshi-page .oshi-name-input').value = 'ルナ';
    click($('.oshi-page .oshi-profile-save')); await e2e.settle();
    click($('.oshi-page .oshi-use')); await e2e.settle();
    expect(e2e.ctx.prefGet_('oshi.char', 'tester@example.com')).toBe('mine:1');
    const input = $('.oshi-page .oshi-state[data-state="praise"] input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new window.File([PNG], 'luna.png', { type: 'image/png' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(e2e, () => e2e.rows('oshi_images').length === 1);
    // 絵を入れていない「おいわい」の行はイツキの絵
    const celebrate = $('.oshi-page .oshi-state[data-state="celebrate"]');
    expect(celebrate.dataset.picture).toBe('default');

    // 5. 設定の選び方にも、作ったキャラが並ぶ
    go('settings'); await e2e.settle();
    await waitFor(e2e, () => !!$('[data-pref="oshi.char"] .oshi-choice[data-char="mine:1"]'));
    expect($('[data-pref="oshi.char"] .oshi-choice[data-char="mine:1"]').getAttribute('aria-checked')).toBe('true');

    // 6. 済ませる → 名前はルナ、「おいわい」の絵は無いのでイツキの絵
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    b = $('#oshi-bubble');
    await waitFor(e2e, () => !!b.querySelector('img.oshi-img'));
    expect(b.dataset.char).toBe('mine:1');
    expect(b.querySelector('.oshi-name').textContent).toBe('ルナ');
    expect(e2e.ctx.OSHI_LINES().polite.done).toContain(b.querySelector('.oshi-line').textContent);
    expect(b.querySelector('img.oshi-img').getAttribute('src')).toBe(e2e.ctx.apiOshiDefaultImage('itsuki', 'chibi', 'celebrate').dataUrl);
    // 入れた「ほめる」は自分の絵
    expect(e2e.ctx.apiOshiImage(1, 'praise').dataUrl).toBe(PNG_URL);
  });
});
