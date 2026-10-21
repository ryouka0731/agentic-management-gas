import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * Claude Code の考え中の字 (spinnerVerbs) を、選んでいる推しのせりふにする。せりふの定義は src/core/Oshi.js
 * (場面 spinner)、置いた人のぶんを返すのは命令 oshiSpinner (src/core/CommandQueue.gs → oshiSpinnerLines_)。
 * settings.json に書くのは手元の道具 (kit/track/spinner.mjs。test/kit-spinner.test.js)。テストの中身は作り話にする。
 */

const pure = loadGas('src/core/Oshi.js');
const ME = 'tester@example.com';
const OTHER = 'b@example.com';
/** いまある口調。ほかの枝で足す口調は spinner を持たなくてよい (既定の言葉に倒れる) */
const TONES_NOW = ['polite', 'genki', 'cool', 'kansai', 'butler', 'gothic', 'buddy'];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

/** その人の自分の設定を置く (画面の apiPrefSet は開いている本人にしか書けない) */
function prefsOf(ctx, email, values) {
  ctx.PropertiesService.getScriptProperties().setProperty('MYPREF:' + email, JSON.stringify(values));
}

describe('考え中のせりふ (場面 spinner)', () => {
  it('場面 spinner は 24 字までの場面で、画面の吹き出しには出さない印がある', () => {
    const e = pure.oshiEventOf('spinner');
    expect(e).toMatchObject({ key: 'spinner', spinner: true, lineMax: 24 });
    expect(pure.oshiLineMaxOf('spinner')).toBe(24);
    expect(pure.oshiLineMaxOf('done')).toBe(pure.OSHI_TEXT_LIMITS().lineMax);
    expect(pure.OSHI_SPINNER_MAX()).toBe(20);
  });

  it('いまの口調はどれも考え中のせりふを5つ以上持ち、どれも24字まで・改行なし', () => {
    for (const t of TONES_NOW) {
      const list = pure.OSHI_LINES()[t].spinner;
      expect(list.length, t).toBeGreaterThanOrEqual(5);
      for (const l of list) {
        expect(l.length, l).toBeLessThanOrEqual(24);
        expect(l, l).not.toMatch(/[\r\n\t]/);
      }
    }
  });

  it('考え中のせりふを持たない口調 (ほかの枝で足す口調) は、既定の言葉に倒れる', () => {
    const lines = pure.OSHI_LINES();
    delete lines.cool.spinner;
    const ctx = loadGas('src/core/Oshi.js');
    ctx.OSHI_LINES = () => ({ ...lines, sunny: { done: ['テスト'] } });
    expect(ctx.oshiToneLines('sunny', 'spinner')).toEqual(ctx.OSHI_SPINNER_DEFAULT());
    expect(ctx.oshiToneLines('cool', 'spinner')).toEqual(ctx.OSHI_SPINNER_DEFAULT());
    expect(ctx.oshiToneLines('sunny', 'done')).toEqual(['テスト']);
    // ほかの場面は既定に倒れない (空のまま)
    expect(ctx.oshiToneLines('sunny', 'night')).toEqual([]);
    expect(ctx.OSHI_SPINNER_DEFAULT().length).toBeGreaterThanOrEqual(5);
    for (const l of ctx.OSHI_SPINNER_DEFAULT()) expect(l.length).toBeLessThanOrEqual(24);
  });

  it('oshiSpinnerPick は字だけ・制御文字と改行を落とし・24字を超えるものと重なりを捨て・20個までにする', () => {
    const many = Array.from({ length: 30 }, (_, i) => 'テスト' + i);
    expect(pure.oshiSpinnerPick(many)).toHaveLength(20);
    expect(pure.oshiSpinnerPick([' テスト ', 'テスト', 5, null, '', 'あ'.repeat(25), 'テ\nスト\u0007', 'x\u202eコード']))
      .toEqual(['テスト', 'xコード']);
  });

  it('画面の場面の一覧に考え中が入り、上限の字数が添えてある (自分のせりふの欄で直せる)', () => {
    const { ctx } = setup();
    const got = ctx.apiOshiGet();
    const sp = got.events.find((e) => e.key === 'spinner');
    expect(sp).toMatchObject({ spinner: true, lineMax: 24 });
    expect(sp.lines).toEqual(pure.OSHI_LINES().buddy.spinner);
  });

  it('自分のせりふの考え中は24字まで (ほかの場面は60字まで)', () => {
    const { ctx } = setup();
    const c = ctx.oshiCharCreate_(ME, 'テストのソラ', 'cool');
    expect(ctx.oshiSetLines_(ME, c.id, 'spinner', ['テストで考え中'])).toEqual(['テストで考え中']);
    expect(() => ctx.oshiSetLines_(ME, c.id, 'spinner', ['あ'.repeat(25)])).toThrow('せりふは1つ24字まで');
    expect(ctx.oshiSetLines_(ME, c.id, 'done', ['あ'.repeat(25)])).toHaveLength(1);
  });
});

describe('キャラ作成キットの考え中のせりふ', () => {
  it('頼み文は考え中のせりふも頼み、24字までと書いてある', () => {
    for (const t of pure.OSHI_CHARKIT_TOOLS()) {
      const p = pure.oshiCharKitPrompt(t.key, 37);
      expect(p, t.key).toContain('  - spinner: ' + pure.oshiEventOf('spinner').label);
      expect(p, t.key).toContain('1つ24字まで');
    }
  });

  it('取り込むと考え中のせりふも入る。24字を超えれば断る', () => {
    const { ctx } = setup();
    const answer = { name: 'テストのミント', tone: 'genki', lines: { done: ['テストできた！'], spinner: ['テストを考え中！', 'テストをまとめ中！'] } };
    const got = ctx.oshiCharImportValid_(JSON.stringify(answer));
    expect(got.lines.spinner).toEqual(['テストを考え中！', 'テストをまとめ中！']);
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...answer, lines: { spinner: ['あ'.repeat(25)] } })))
      .toThrow('「' + pure.oshiEventOf('spinner').label + '」のせりふを直してください。せりふは1つ24字まで');
    const made = ctx.oshiCharImport_(ME, 0, JSON.stringify(answer));
    expect(ctx.oshiProfile_(ME, made.id).lines.spinner).toEqual(['テストを考え中！', 'テストをまとめ中！']);
  });
});

describe('命令 oshiSpinner (置いた人の考え中のせりふ)', () => {
  it('置いた人が分からなければ断る。自分の様子を見る命令に入っている', () => {
    const { ctx } = setup();
    expect(() => ctx.runCommand_({ op: 'oshiSpinner', args: {} }, '')).toThrow('命令を置いた人が分かりません');
    expect(ctx.COMMAND_PERSONAL_OPS()).toContain('oshiSpinner');
    expect(ctx.COMMAND_ADMIN_OPS()).not.toContain('oshiSpinner');
  });

  it('既定 (推しはオン・タク) なら、タクの考え中のせりふを返す', () => {
    const { ctx } = setup();
    const r = ctx.runCommand_({ op: 'oshiSpinner', args: {} }, OTHER);
    expect(r).toEqual({ on: true, char: 'builtin:taku', name: 'タク', lines: pure.OSHI_LINES().buddy.spinner, reason: '' });
  });

  it('置いた人の設定のキャラを返す (開いている人・ほかの人の設定は見ない)', () => {
    const { ctx } = setup();
    prefsOf(ctx, OTHER, { 'oshi.char': 'builtin:itsuki' });
    prefsOf(ctx, ME, { 'oshi.char': 'builtin:taku' });
    const r = ctx.runCommand_({ op: 'oshiSpinner', args: {} }, OTHER);
    expect(r).toMatchObject({ on: true, char: 'builtin:itsuki', name: 'イツキ' });
    expect(r.lines).toEqual(pure.OSHI_LINES().gothic.spinner);
    expect(ctx.runCommand_({ op: 'oshiSpinner', args: {} }, ME).name).toBe('タク');
  });

  it('自分のキャラなら、そのキャラの考え中のせりふを先に、口調のせりふを後に (20個まで)', () => {
    const { ctx } = setup();
    const c = ctx.oshiCharCreate_(OTHER, 'テストのソラ', 'kansai');
    ctx.oshiSetLines_(OTHER, c.id, 'spinner', ['テストを考えとるで', 'テストを練っとるで']);
    prefsOf(ctx, OTHER, { 'oshi.char': 'mine:' + c.id });
    const r = ctx.runCommand_({ op: 'oshiSpinner', args: {} }, OTHER);
    expect(r).toMatchObject({ on: true, char: 'mine:' + c.id, name: 'テストのソラ', reason: '' });
    expect(r.lines.slice(0, 2)).toEqual(['テストを考えとるで', 'テストを練っとるで']);
    expect(r.lines.slice(2)).toEqual(pure.OSHI_LINES().kansai.spinner.slice(0, 18));
    expect(r.lines.length).toBeLessThanOrEqual(20);
    // ほかの人が同じ番号を名指しても、その人の設定には入らない (自分のキャラは人ごと)
    prefsOf(ctx, ME, { 'oshi.char': 'mine:' + c.id });
    expect(ctx.runCommand_({ op: 'oshiSpinner', args: {} }, ME)).toMatchObject({ char: 'builtin:taku', name: 'タク' });
  });

  it('推しがオフなら空の並びと理由を返す', () => {
    const { ctx } = setup();
    prefsOf(ctx, OTHER, { 'oshi.on': false, 'oshi.char': 'builtin:itsuki' });
    const r = ctx.runCommand_({ op: 'oshiSpinner', args: {} }, OTHER);
    expect(r.on).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.reason).toContain('推しがオフです');
    expect(r.name).toBe('');
  });
});
