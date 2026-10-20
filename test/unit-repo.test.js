import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { CORE_SOURCES } from './sources.js';

/*
 * Repo.gs の断り方と持ち主の見分け方の単体テスト。
 */
function load() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...CORE_SOURCES);
  return { fake, ctx };
}

describe('repoInit / repoConfig', () => {
  it('初期化の前に設定を読むと、何をすればよいかを添えて断る', () => {
    const { ctx } = load();
    expect(() => ctx.repoConfig()).toThrow(/repoInit\(\) を先に実行してください/);
  });

  it('入れ物の名前は 1〜100字で、区切りの記号を含まない', () => {
    const { ctx } = load();
    for (const bad of ['', null, 'a/b', 'a\\b', 'あ'.repeat(101)]) {
      expect(() => ctx.repoInit(bad)).toThrow(/フォルダ名が不正です/);
    }
    // 断ったときは何も作っていない
    expect(() => ctx.repoConfig()).toThrow(/初期化されていません/);
    expect(ctx.repoInit('あ'.repeat(100)).rootId).toBeTruthy();
  });

  it('台帳の既定のシート (シート1) は消し、表ごとのシートだけを残す', () => {
    const { ctx, fake } = load();
    // 実機の SpreadsheetApp.create は「シート1」を1枚持った表を返す (疑似GASは空で返す)
    const create = fake.SpreadsheetApp.create;
    fake.SpreadsheetApp.create = (name) => { const ss = create(name); ss.insertSheet('シート1'); return ss; };
    const config = ctx.repoInit('agentic-management');
    const db = fake.SpreadsheetApp.openById(config.dbId);
    expect(db.getSheetByName('シート1') || db.getSheetByName('Sheet1')).toBeFalsy();
    expect(db.getSheetByName('files')).toBeTruthy();
  });
});

describe('repoRegisterFile', () => {
  function ready() {
    const env = load();
    env.config = env.ctx.repoInit('agentic-management');
    return env;
  }

  it('Docs・Sheets・Slides を種別ごとに登録し、それ以外は断る', () => {
    const { ctx, fake, config } = ready();
    const folder = fake.DriveApp.getFolderById(config.mainId);
    const doc = fake._createDoc('規程', '', config.mainId);
    const sheet = folder.createFile('表', '', fake.MimeType.GOOGLE_SHEETS).getId();
    const slide = fake._createSlides('説明', []);
    const text = folder.createFile('メモ.txt', 'x', 'text/plain').getId();

    expect(ctx.repoRegisterFile(doc, '規程.doc').type).toBe('doc');
    expect(ctx.repoRegisterFile(sheet, '表.sheet').type).toBe('sheet');
    expect(ctx.repoRegisterFile(slide, '説明.slide').type).toBe('slide');
    expect(() => ctx.repoRegisterFile(text, 'メモ.txt')).toThrow(/対応していないファイル種別です: text\/plain/);
    expect(ctx.dbReadAll('files').map((r) => r.path)).toEqual(['規程.doc', '表.sheet', '説明.slide']);
  });

  it('同じ文書を二度、空や逆斜線のパスでは登録しない', () => {
    const { ctx, fake, config } = ready();
    const doc = fake._createDoc('規程', '', config.mainId);
    expect(() => ctx.repoRegisterFile(doc, '')).toThrow(/パスが不正です/);
    expect(() => ctx.repoRegisterFile(doc, 'a\\b.doc')).toThrow(/パスが不正です/);
    expect(() => ctx.repoRegisterFile(doc, 'あ'.repeat(201))).toThrow(/パスが不正です/);
    ctx.repoRegisterFile(doc, '規程.doc');
    expect(() => ctx.repoRegisterFile(doc, '別名.doc')).toThrow(/すでに登録されています/);
  });
});

describe('持ち主の見分け方', () => {
  it('マイドライブでは入れ物の持ち主1人。アドレスの大小は見ない。空は持ち主ではない', () => {
    const { ctx } = load();
    ctx.repoInit('agentic-management');
    expect(ctx.repoOwners_()).toEqual(['tester@example.com']);
    expect(ctx.repoHasOwner_('TESTER@example.com')).toBe(true);
    expect(ctx.repoHasOwner_('kato@example.com')).toBe(false);
    expect(ctx.repoHasOwner_('')).toBe(false);
    expect(ctx.repoHasOwner_(null)).toBe(false);
  });

  it('初期化していなければ持ち主は居ない (投げない)', () => {
    const { ctx } = load();
    expect(ctx.repoOwners_()).toEqual([]);
    expect(ctx.repoHasOwner_('tester@example.com')).toBe(false);
  });

  it('入れ物の持ち主が読めなければ、持ち主は居ない', () => {
    const { ctx, fake } = load();
    const config = ctx.repoInit('agentic-management');
    fake.DriveApp.getFolderById(config.rootId)._setOwner('');
    expect(ctx.repoOwners_()).toEqual([]);
  });
});
