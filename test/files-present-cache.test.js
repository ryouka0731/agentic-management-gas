import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 文書が Drive にあるかの覚え (Branch.gs の filesPresentInDrive_。docs/dev/user-paths.md)。
 * 守ること: 同じ実行の中では Drive を1回しか読まない・ほかの実行とも覚えを共有する・登録・外すなど台帳が変わればすぐ映る・
 * Drive の側だけで消したものは置いた長さ (FILES_PRESENT_CACHE_SEC) までは残り、そのあと消える・鍵の中で台帳を書いた直後は
 * 覚えを見ない。
 *
 * test/harness.js は、テストから呼んだ1回を1回の実行として扱う。同じ実行の中で何度も読むところは withSelfApprove_ の中から呼ぶ。
 */

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  const config = ctx.repoInit('agentic-management');
  // Drive を読んだ回数 (フォルダの一覧と、文書を1つずつ確かめるの両方)
  let reads = 0;
  const folder = fake.DriveApp.getFolderById;
  const file = fake.DriveApp.getFileById;
  fake.DriveApp.getFolderById = (id) => { reads += 1; return folder(id); };
  fake.DriveApp.getFileById = (id) => { reads += 1; return file(id); };
  const place = (name) => {
    const id = fake._createDoc(name, '<p>' + name + '</p>\n', config.mainId);
    ctx.repoRegisterFile(id, name + '.doc');
    return id;
  };
  const visible = () => ctx.filesVisibleInWiki().map((r) => String(r.fileId)).sort();
  return { ctx, fake, config, place, visible, reads: () => reads };
}

describe('文書が Drive にあるかの覚え', () => {
  it('同じ実行の中では Drive を1回しか読まない (文書の一覧・前進の中身・ホームの要約が続けて読む)', () => {
    const { ctx, place, reads } = setup();
    const a = place('就業規則');
    const before = reads();
    ctx.withSelfApprove_(() => {
      expect(ctx.filesVisibleInWiki().map((r) => String(r.fileId))).toEqual([a]);
      ctx.apiOverview();
      ctx.apiHomeSummary();
    });
    // フォルダの一覧の1回だけ
    expect(reads() - before).toBe(1);
  });

  it('ほかの実行でも覚えから引き、登録すればすぐ映る (台帳の版が変わる)', () => {
    const { place, visible, reads } = setup();
    const a = place('就業規則');
    expect(visible()).toEqual([a]);
    const before = reads();
    expect(visible()).toEqual([a]);
    expect(reads() - before).toBe(0);

    const b = place('慶弔規程');
    expect(visible()).toEqual([a, b].sort());
  });

  it('Drive の側だけで消したものは置いた長さまでは残り、そのあと消える。戻せばまた出る', () => {
    const { ctx, fake, place, visible } = setup();
    const a = place('就業規則');
    const b = place('慶弔規程');
    expect(visible()).toEqual([a, b].sort());

    fake.DriveApp.getFileById(a).setTrashed(true);
    expect(visible()).toEqual([a, b].sort());
    fake._cacheAdvance(ctx.FILES_PRESENT_CACHE_SEC() + 1);
    expect(visible()).toEqual([b]);

    fake.DriveApp.getFileById(a).setTrashed(false);
    fake._cacheAdvance(ctx.FILES_PRESENT_CACHE_SEC() + 1);
    expect(visible()).toEqual([a, b].sort());
  });

  it('鍵の中で台帳を書いた直後は覚えを見ず、書いたものが見える', () => {
    const { ctx, fake, config, place, visible } = setup();
    const a = place('就業規則');
    expect(visible()).toEqual([a]);
    const b = fake._createDoc('慶弔規程', '<p>x</p>\n', config.mainId);
    const seen = ctx.dbWithLock_(30000, () => {
      ctx.repoRegisterFile(b, '慶弔規程.doc');
      return ctx.filesVisibleInWiki().map((r) => String(r.fileId)).sort();
    });
    expect(seen).toEqual([a, b].sort());
    expect(visible()).toEqual([a, b].sort());
  });

  it('CacheService が無くても読める', () => {
    const { ctx, fake, place, visible } = setup();
    const a = place('就業規則');
    const keep = fake.CacheService;
    fake.CacheService = undefined;
    try {
      expect(visible()).toEqual([a]);
      expect(ctx.apiListFiles().map((r) => r.fileId)).toEqual([a]);
    } finally {
      fake.CacheService = keep;
    }
  });
});
