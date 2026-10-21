// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * キャラ作成キットの画面 (js-oshi の「AI に作ってもらう」「AI の答えを貼る」「緑の背景を抜く」「1枚の表から切り分ける」)。
 * 返事は本物のサーバ (疑似GAS) が返す。頼み文の字も取り込みの検査もサーバのもので、画面は写しを持たない。
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const ON = { 'oshi.on': true, 'oshi.char': 'mine:1' };

/** 作り話のキャラの答え */
const ANSWER = {
  name: 'テストのミント', tone: 'genki',
  lines: { done: ['テストできたね！', 'テストおつかれ！'] },
  profile: { items: [{ lv: 2, label: 'テストの好物', text: 'テスト用のプリン' }], clearLine: 'テストのお祝い' },
};

/** 本物のサーバ。自分のキャラ「ルナ」(1人目) がいる */
function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  ctx.apiOshiCharCreate('ルナ', 'genki');
  ctx.apiPrefSet('oshi.char', 'mine:1');
  return ctx;
}

/** サーバの api を画面の返事にする。投げたら失敗の返事 (Error) にする */
const live = (ctx, name) => (...args) => {
  try {
    return JSON.parse(JSON.stringify(ctx[name](...args)));
  } catch (e) {
    // 疑似GAS は別の realm で動くので、instanceof では見分けられない
    return new Error(e && e.message ? e.message : String(e));
  }
};

function mountKit(ctx) {
  return mount({
    apiPrefs: prefsFixture({ values: ON }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, ON, { [key]: value }) }),
    apiOshiGet: live(ctx, 'apiOshiGet'),
    apiOshiImage: (charId, state) => ({ charId, state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: PNG_URL }),
    apiOshiCharKitPrompt: live(ctx, 'apiOshiCharKitPrompt'),
    apiOshiCharImport: live(ctx, 'apiOshiCharImport'),
    apiOshiSetImage: live(ctx, 'apiOshiSetImage'),
  });
}

function openPage() {
  document.getElementById('me-btn').click();
  [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
  return document.querySelector('.oshi-page');
}

const names = (app) => app.calls.map((c) => c.name);
const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;
const wait = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };

/**
 * 描ける器と読み込める絵の代わり (jsdom は描けない)。読み込んだ絵は 400 × 300 で、getImageData は
 * 緑一色を返す。putImageData に渡された画素を控える。
 */
function fakeCanvas() {
  const put = [];
  const ctx2d = {
    drawImage: vi.fn(),
    getImageData: (x, y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) { data[i + 1] = 255; data[i + 3] = 255; }
      return { data, width: w, height: h };
    },
    putImageData: (px) => put.push(px),
  };
  vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d);
  vi.spyOn(window.HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG_URL);
  const RealImage = window.Image;
  window.Image = class {
    set src(v) {
      this._src = v;
      setTimeout(() => { this.naturalWidth = 400; this.naturalHeight = 300; if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  };
  return { ctx2d, put, restore: () => { window.Image = RealImage; } };
}

function pickFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

describe('キャラ作成キット', () => {
  let ctx;
  beforeEach(() => {
    window.localStorage.clear();
    ctx = server();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.execCommand;
  });

  it('「AI に作ってもらう」: 道具はサーバの一覧から並び、「コピー」で選んだ道具の頼み文をサーバから取って写す', () => {
    const app = mountKit(ctx);
    const page = openPage();
    const sec = page.querySelector('.oshi-kit');
    expect(sec).toBeTruthy();
    const pick = sec.querySelector('select.oshi-kit-tool');
    expect([...pick.options].map((o) => o.value)).toEqual(['chatgpt', 'gemini', 'claude', 'codex']);
    expect(pick.closest('label').textContent).toContain('道具');
    // 開いただけでは頼み文を取りに行かない
    expect(names(app)).not.toContain('apiOshiCharKitPrompt');

    let copied = null;
    document.execCommand = vi.fn(() => { copied = document.querySelector('textarea[readonly]').value; return true; });
    pick.value = 'gemini';
    pick.dispatchEvent(new window.Event('change', { bubbles: true }));
    sec.querySelector('button.oshi-kit-copy').click();
    expect(copied).toBe(ctx.apiOshiCharKitPrompt('gemini').prompt);
    expect(copied).toContain('#00FF00');
    expect(snack()).toContain('写しました。Geminiに');
    expect(sec.querySelector('.oshi-kit-prompt pre').textContent).toBe(copied);

    // 2回目は覚えた字を押した中で写す (取り直さない)
    const before = names(app).filter((n) => n === 'apiOshiCharKitPrompt').length;
    sec.querySelector('button.oshi-kit-copy').click();
    expect(names(app).filter((n) => n === 'apiOshiCharKitPrompt').length).toBe(before);
    expect(document.execCommand).toHaveBeenCalledTimes(2);
  });

  it('「AI の答えを貼る」: 囲みと説明ごと貼って「取り込む」と、新しいキャラができ、そのキャラを開く', async () => {
    const app = mountKit(ctx);
    const page = openPage();
    const sec = page.querySelector('.oshi-import');
    const target = sec.querySelector('select.oshi-import-target');
    expect([...target.options].map((o) => o.textContent)).toEqual(['新しいキャラとして作る', 'ルナ を直す']);
    expect(target.value).toBe('0');
    sec.querySelector('textarea.oshi-import-text').value = 'できました！\n```json\n' + JSON.stringify(ANSWER) + '\n```\nどうですか？';
    sec.querySelector('button.oshi-import-go').click();
    const sent = app.calls.find((c) => c.name === 'apiOshiCharImport');
    expect(sent.args[0]).toBe(0);
    expect(sent.args[1]).toContain('```json');
    expect(snack()).toContain('「テストのミント」を作りました (せりふ 1 場面・プロフィール 1 項目)');
    await wait(() => document.querySelector('.oshi-profile[data-char-id="2"]'));
    const again = document.querySelector('.oshi-page');
    expect(again.querySelector('.oshi-name-input').value).toBe('テストのミント');
    expect(ctx.apiOshiGet().mine.map((m) => m.name)).toEqual(['ルナ', 'テストのミント']);
  });

  it('作ってあるキャラを選べば、そのキャラを直す', () => {
    const app = mountKit(ctx);
    const sec = openPage().querySelector('.oshi-import');
    sec.querySelector('select.oshi-import-target').value = '1';
    sec.querySelector('textarea.oshi-import-text').value = JSON.stringify(ANSWER);
    sec.querySelector('button.oshi-import-go').click();
    expect(app.calls.find((c) => c.name === 'apiOshiCharImport').args[0]).toBe(1);
    expect(snack()).toContain('を直しました');
    expect(ctx.apiOshiGet().mine.map((m) => m.name)).toEqual(['テストのミント']);
  });

  it('サーバが断ったら、理由を出し、ボタンを押せるように戻す (画面では確かめない)', () => {
    mountKit(ctx);
    const sec = openPage().querySelector('.oshi-import');
    sec.querySelector('textarea.oshi-import-text').value = JSON.stringify({ ...ANSWER, tone: 'tsundere' });
    const go = sec.querySelector('button.oshi-import-go');
    go.click();
    expect(snack()).toContain('取り込めませんでした: 知らない口調です: tsundere');
    expect(go.disabled).toBe(false);
    expect(ctx.apiOshiGet().mine.length).toBe(1);
  });

  it('5人いれば「新しいキャラとして作る」は選べず、直すキャラが選んである', () => {
    for (let i = 0; i < 4; i++) ctx.apiOshiCharCreate('テスト' + i, 'polite');
    mountKit(ctx);
    const target = openPage().querySelector('select.oshi-import-target');
    expect(target.options[0].disabled).toBe(true);
    expect(target.value).not.toBe('0');
  });

  it('「緑の背景を抜く」は切り替えで、オンにすると緑を透明にしてから送る', async () => {
    const canvas = fakeCanvas();
    try {
      const app = mountKit(ctx);
      const page = openPage();
      const toggle = page.querySelector('.oshi-green');
      expect(toggle.getAttribute('role')).toBe('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      toggle.click();
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      pickFile(page.querySelector('.oshi-state[data-state="praise"] input[type="file"]'),
        new window.File([PNG], 'a.png', { type: 'image/png' }));
      await wait(() => names(app).includes('apiOshiSetImage'));
      const sent = app.calls.find((c) => c.name === 'apiOshiSetImage');
      expect(sent.args.slice(0, 2)).toEqual([1, 'praise']);
      // 緑一色の画素が全部透明になって書き戻された
      expect(canvas.put.length).toBe(1);
      const data = canvas.put[0].data;
      expect(data.filter((v, i) => i % 4 === 3).every((a) => a === 0)).toBe(true);
    } finally {
      canvas.restore();
    }
  });

  it('描けない画面で「緑の背景を抜く」がオンなら、送らずに理由を出す', async () => {
    const app = mountKit(ctx);
    const page = openPage();
    page.querySelector('.oshi-green').click();
    pickFile(page.querySelector('.oshi-state[data-state="praise"] input[type="file"]'),
      new window.File([PNG], 'a.png', { type: 'image/png' }));
    await wait(() => snack().includes('緑の背景を抜けません'));
    expect(snack()).toContain('緑の背景を抜けませんでした');
    expect(names(app)).not.toContain('apiOshiSetImage');
  });

  it('「1枚の表から切り分ける」: 行と列でマスが出て、マスごとに表情を選び、選んだマスだけを順に入れる', async () => {
    const canvas = fakeCanvas();
    try {
      const app = mountKit(ctx);
      const page = openPage();
      const sheet = page.querySelector('.oshi-sheet');
      expect(sheet.querySelector('summary').textContent).toBe('1枚の表から切り分ける');
      expect(sheet.querySelector('.oshi-sheet-rows').value).toBe('3');
      expect(sheet.querySelector('.oshi-sheet-cols').value).toBe('4');
      expect(sheet.querySelector('.oshi-sheet-go').disabled).toBe(true);
      pickFile(sheet.querySelector('input.oshi-sheet-file'), new window.File([PNG], 'sheet.png', { type: 'image/png' }));
      await wait(() => sheet.querySelectorAll('.oshi-sheet-cell').length);
      const cells = [...sheet.querySelectorAll('.oshi-sheet-cell')];
      expect(cells.length).toBe(12);
      // 最初は表情の並びの順。余ったマスは「使わない」
      const states = ctx.apiOshiGet().states.map((s) => s.key);
      expect(cells.map((c) => c.querySelector('select').value)).toEqual(states.concat(['']));
      expect(cells[5].querySelector('label').textContent).toContain('2行目・2列目');
      expect(cells[0].querySelector('img').alt).toBe('1行目・1列目の見本');

      // 行と列を変えると、マスを組み直す
      const rows = sheet.querySelector('.oshi-sheet-rows');
      rows.value = '1';
      rows.dispatchEvent(new window.Event('change', { bubbles: true }));
      const two = [...sheet.querySelectorAll('.oshi-sheet-cell')];
      expect(two.length).toBe(4);
      // 2つ目は使わない・3つ目は作業中にする
      two[1].querySelector('select').value = '';
      two[1].querySelector('select').dispatchEvent(new window.Event('change', { bubbles: true }));
      two[2].querySelector('select').value = 'work';
      two[2].querySelector('select').dispatchEvent(new window.Event('change', { bubbles: true }));
      canvas.ctx2d.drawImage.mockClear();
      sheet.querySelector('.oshi-sheet-go').click();
      await wait(() => sheet.querySelector('.oshi-sheet-status').textContent.includes('枚入れました'));
      const sent = app.calls.filter((c) => c.name === 'apiOshiSetImage').map((c) => c.args.slice(0, 2));
      expect(sent).toEqual([[1, 'idle'], [1, 'work'], [1, 'cheer']]);
      expect(sheet.querySelector('.oshi-sheet-status').textContent).toBe('3 枚入れました');
      // マスの場所 (400 × 300 を 1 行 × 4 列) から切り出した
      const from = canvas.ctx2d.drawImage.mock.calls.map((c) => c.slice(1, 5));
      expect(from).toEqual([[0, 0, 100, 300], [200, 0, 100, 300], [300, 0, 100, 300]]);
      // 入れた表情の行は「差し替える」になる
      expect(page.querySelector('.oshi-state[data-state="work"] .oshi-pick').textContent).toContain('差し替える');
      expect(ctx.apiOshiGet().mine[0].images.map((i) => i.state).sort()).toEqual(['cheer', 'idle', 'work']);
    } finally {
      canvas.restore();
    }
  });
});

describe('キャラ作成キット (描けない画面)', () => {
  it('表の画像を選んでも、描けなければ読まずに断る', () => {
    const ctx = server();
    const app = mountKit(ctx);
    const sheet = openPage().querySelector('.oshi-sheet');
    pickFile(sheet.querySelector('input.oshi-sheet-file'), new window.File([PNG], 'sheet.png', { type: 'image/png' }));
    expect(snack()).toContain('この画面では表を切り分けられません');
    expect(sheet.querySelectorAll('.oshi-sheet-cell').length).toBe(0);
    pickFile(sheet.querySelector('input.oshi-sheet-file'), new window.File(['GIF89a'], 'a.gif', { type: 'image/gif' }));
    expect(snack()).toContain('PNG・JPEG・WebP');
    expect(names(app)).not.toContain('apiOshiSetImage');
  });
});
