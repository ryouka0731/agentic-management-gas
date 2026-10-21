import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 自分のキャラを「みんなに公開する」(src/core/OshiShare.gs)。
 * 守ること: 読む道は公開されたものだけ・書く道は作った人だけ・止めたら使っていた人は既定に戻る・
 * なつき度は使う人ごと・作った人のアドレスを返さない。
 */

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const url = (mime, buf) => 'data:' + mime + ';base64,' + buf.toString('base64');

/** a がキャラを1人作って絵とせりふとプロフィールを入れ、公開する。公開の番号 ('shared:<n>') を返す */
function aShares(ctx, fake, opts) {
  fake._setUser('a@example.com');
  ctx.memberSet('a@example.com', '', 'テストのエー');
  const id = ctx.apiOshiCharCreate('ルナ', 'cool').charId;
  ctx.apiOshiSetImage(id, 'idle', url('image/png', PNG));
  ctx.apiOshiSetLines(id, 'done', ['テストできたね']);
  ctx.apiOshiSetCharProfile(id, JSON.stringify({ items: [{ lv: 2, label: 'テストの好物', text: 'テストのパン' },
    { lv: 99, label: 'テストのひみつ', text: 'テストの奥' }], clearLine: 'テストのお祝い', clearVideo: '' }));
  if (!(opts && opts.keepPrivate)) ctx.apiOshiSetShared(id, true);
  const got = ctx.apiOshiGet();
  const mineRow = ctx.dbReadAll('oshi').find((r) => String(r.who) === 'a@example.com');
  return { id, char: 'shared:' + mineRow.id, got };
}

describe('公開の入り切り', () => {
  it('既定は公開していない。オンにすると mine に印が付き、オフで外れる', () => {
    const { ctx, fake } = setup();
    const { id } = aShares(ctx, fake, { keepPrivate: true });
    expect(ctx.apiOshiGet().mine[0].shared).toBe(false);
    expect(ctx.apiOshiSetShared(id, true)).toEqual({ charId: id, shared: true });
    expect(ctx.apiOshiGet().mine[0].shared).toBe(true);
    // 名前や口調を直しても、公開の印は残る (dbUpdate は直す欄だけを書く)
    ctx.apiOshiSetProfile(id, 'ルナ2', 'cool');
    expect(ctx.apiOshiGet().mine[0].shared).toBe(true);
    expect(ctx.apiOshiSetShared(id, false)).toEqual({ charId: id, shared: false });
    expect(ctx.apiOshiGet().mine[0].shared).toBe(false);
  });

  it('名前の無いキャラは公開できない', () => {
    const { ctx, fake } = setup();
    fake._setUser('a@example.com');
    const id = ctx.apiOshiCharCreate('', 'polite').charId;
    expect(() => ctx.apiOshiSetShared(id, true)).toThrow('名前を決めてから公開してください');
  });

  it('列を足す前の行 (shared が空) は公開していないものとして読む', () => {
    const { ctx, fake } = setup();
    fake._setUser('a@example.com');
    ctx.apiOshiCharCreate('ルナ', 'polite');
    expect(ctx.dbReadAll('oshi')[0].shared).toBe('');
    fake._setUser('b@example.com');
    expect(ctx.apiOshiGet().shared).toEqual([]);
  });
});

describe('ほかの人が選ぶ', () => {
  it('公開されたキャラは、ほかの人の選び方に作った人の表示名つきで並び、選ぶと絵・名前・せりふ・プロフィールが届く', () => {
    const { ctx, fake } = setup();
    const { char } = aShares(ctx, fake);
    fake._setUser('b@example.com');
    const list = ctx.apiOshiGet().shared;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ char, name: 'ルナ', tone: 'cool', owner: 'テストのエー' });
    expect(list[0].images.map((i) => i.state)).toEqual(['idle']);
    // アドレスは返さない
    expect(JSON.stringify(ctx.apiOshiGet())).not.toContain('a@example.com');

    ctx.apiPrefSet('oshi.char', char);
    const got = ctx.apiOshiGet();
    expect(got).toMatchObject({ char, kind: 'shared', name: 'ルナ', tone: 'cool', owner: 'テストのエー', charId: 0, mine: [] });
    expect(got.images.map((i) => i.state)).toEqual(['idle']);
    expect(got.events.find((e) => e.key === 'done').mine).toEqual(['テストできたね']);
    // 絵の無い表情に出すのは、借りた人の自分の設定 (oshi.fallback。既定はタク)
    expect(got.fallback).toBe('taku');
    expect(ctx.apiOshiImage(char, 'idle').dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiImage(char, 'praise')).toBe(null);
  });

  it('なつき度は使う人ごと。プロフィールは借りた人の Lv で開き、クリアの言葉は借りた人がクリアするまで返さない', () => {
    const { ctx, fake } = setup();
    const { char } = aShares(ctx, fake);
    // a は実績を全部取った (a のなつき度は高い)
    const got = {};
    ctx.ACHIEVEMENTS().forEach((x) => { got[x.key] = '2026-10-21'; });
    ctx.PropertiesService.getScriptProperties().setProperty('ACH:a@example.com',
      JSON.stringify({ days: { n: 1, last: '2026-10-21' }, got }));
    fake._setUser('b@example.com');
    ctx.apiPrefSet('oshi.char', char);
    const b = ctx.apiOshiGet();
    expect(b.growth.level).toBe(1);
    expect(b.reveal.items.every((it) => !it.open)).toBe(true);
    expect(b.reveal.items[0].text).toBe('');
    expect(b.cleared).toBe(false);
    expect(b.clear).toBe(null);
    // b が Lv2 になれば、Lv2 の項目だけ開く
    const one = ctx.ACHIEVEMENTS()[0].key;
    ctx.PropertiesService.getScriptProperties().setProperty('ACH:b@example.com',
      JSON.stringify({ days: { n: 1, last: '2026-10-21' }, got: { [one]: '2026-10-21' } }));
    const b2 = ctx.apiOshiGet();
    expect(b2.growth.level).toBe(2);
    expect(b2.reveal.items.filter((it) => it.open).map((it) => it.text)).toEqual(['テストのパン']);
  });

  it('作った人は自分のキャラを shared: で選べない (mine: で選ぶ)。名前が無ければ「名前未設定」', () => {
    const { ctx, fake } = setup();
    fake._setUser('a@example.com');
    const id = ctx.apiOshiCharCreate('ルナ', 'cool').charId;
    ctx.apiOshiSetShared(id, true);
    const sid = ctx.dbReadAll('oshi')[0].id;
    expect(() => ctx.apiPrefSet('oshi.char', 'shared:' + sid)).toThrow('そのキャラは選べません');
    expect(ctx.apiOshiGet().shared).toEqual([]);
    fake._setUser('b@example.com');
    expect(ctx.apiOshiGet().shared[0].owner).toBe('名前未設定');
  });

  it('公開されていないキャラは選べず、絵も読めない (番号を知っていても)', () => {
    const { ctx, fake } = setup();
    const { char } = aShares(ctx, fake, { keepPrivate: true });
    fake._setUser('b@example.com');
    expect(ctx.apiOshiGet().shared).toEqual([]);
    expect(() => ctx.apiPrefSet('oshi.char', char)).toThrow('そのキャラは選べません');
    expect(ctx.apiOshiImage(char, 'idle')).toBe(null);
    // 無い番号・知らない表情
    expect(ctx.apiOshiImage('shared:999', 'idle')).toBe(null);
    expect(() => ctx.apiOshiImage(char, 'nope')).toThrow('知らない表情です');
  });

  it('止めたら、使っていた人は既定 (タク) に戻り、絵も読めなくなる。消したときも同じ', () => {
    const { ctx, fake } = setup();
    const { id, char } = aShares(ctx, fake);
    fake._setUser('b@example.com');
    ctx.apiPrefSet('oshi.char', char);
    expect(ctx.apiOshiGet().kind).toBe('shared');
    fake._setUser('a@example.com');
    ctx.apiOshiSetShared(id, false);
    fake._setUser('b@example.com');
    expect(ctx.apiOshiGet()).toMatchObject({ kind: 'builtin', builtinKey: 'taku', name: 'タク', owner: '' });
    expect(ctx.apiOshiImage(char, 'idle')).toBe(null);
    expect(ctx.oshiSpinnerLines_('b@example.com').char).toBe('builtin:taku');
    // もう一度公開すると、同じ番号で戻る (b の設定は残っている)
    fake._setUser('a@example.com');
    ctx.apiOshiSetShared(id, true);
    fake._setUser('b@example.com');
    expect(ctx.apiOshiGet().kind).toBe('shared');
    fake._setUser('a@example.com');
    ctx.apiOshiCharDelete(id);
    fake._setUser('b@example.com');
    expect(ctx.apiOshiGet()).toMatchObject({ kind: 'builtin', builtinKey: 'taku' });
    expect(ctx.apiOshiGet().shared).toEqual([]);
  });

  it('機嫌と考え中のせりふも、借りたキャラ (作った人が書いたせりふ) で返す', () => {
    const { ctx, fake } = setup();
    const { id, char } = aShares(ctx, fake);
    ctx.apiOshiSetLines(id, 'spinner', ['テスト中だよ']);
    fake._setUser('b@example.com');
    ctx.apiPrefSet('oshi.char', char);
    const sp = ctx.oshiSpinnerLines_('b@example.com');
    expect(sp).toMatchObject({ on: true, char, name: 'ルナ' });
    expect(sp.lines[0]).toBe('テスト中だよ');
  });
});

describe('書けるのは作った人だけ', () => {
  it('借りた人は、絵・名前・せりふ・プロフィール・公開・消すのどれも直せない', () => {
    const { ctx, fake } = setup();
    const { id, char } = aShares(ctx, fake);
    const sid = Number(char.split(':')[1]);
    fake._setUser('b@example.com');
    ctx.apiPrefSet('oshi.char', char);
    for (const n of [id, sid]) {
      expect(() => ctx.apiOshiSetImage(n, 'praise', url('image/jpeg', JPG))).toThrow('そのキャラは見つかりません');
      expect(() => ctx.apiOshiClearImage(n, 'idle')).not.toThrow();
      expect(() => ctx.apiOshiSetProfile(n, 'のっとり', 'polite')).toThrow('そのキャラは見つかりません');
      expect(() => ctx.apiOshiSetLines(n, 'done', ['のっとり'])).toThrow('そのキャラは見つかりません');
      expect(() => ctx.apiOshiSetCharProfile(n, '')).toThrow('そのキャラは見つかりません');
      expect(() => ctx.apiOshiSetShared(n, false)).toThrow('そのキャラは見つかりません');
      expect(() => ctx.apiOshiCharDelete(n)).toThrow('そのキャラは見つかりません');
    }
    // 'shared:' の字を書く道に渡しても、番号として読めずに断る
    expect(() => ctx.apiOshiSetImage(char, 'praise', url('image/jpeg', JPG))).toThrow('知らないキャラです');
    expect(() => ctx.apiOshiSetShared(char, false)).toThrow('知らないキャラです');
    // b の「まとめて消す」も a のキャラには触らない
    ctx.apiOshiForget();
    fake._setUser('a@example.com');
    const a = ctx.apiOshiGet().mine[0];
    expect(a).toMatchObject({ name: 'ルナ', shared: true });
    expect(a.images.map((i) => i.state)).toEqual(['idle']);
    expect(a.events.find((e) => e.key === 'done').mine).toEqual(['テストできたね']);
  });
});
