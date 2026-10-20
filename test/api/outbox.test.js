import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, snapshotDb, OTHER } from './setup.js';

/*
 * 画面の API: 手元への頼みごと (src/api/Outbox.gs)。
 *
 * 頼みごとは台帳にあり Drive を共有している人なら書けるので、動詞は列挙、
 * 引数は字を検査し、決めた欄以外は捨てる (CLAUDE.md「頼めることは列挙する」)。
 */

describe('apiOutboxVerbs', () => {
  it('[動詞, 見せる字] の組を、OUTBOX_VERBS と同じ並びで返す (手で頼ませない merge は除く)', () => {
    const { ctx } = makeEnv({ file: false });
    const out = expectScreenSafe(ctx.apiOutboxVerbs());
    const verbs = ctx.OUTBOX_VERBS();
    expect(out.map((v) => v[0])).toEqual(Object.keys(verbs).filter((k) => k !== 'merge'));
    for (const [key, label] of out) expect(label).toBe(verbs[key].label);
  });
});

describe('apiOutboxAdd', () => {
  it('置いた行を画面に渡せる形で返し、台帳に open で残す', () => {
    const { ctx } = makeEnv({ file: false });
    const out = expectScreenSafe(ctx.apiOutboxAdd('diff', { branch: '見直し', against: 'main' },
      { note: '差分をお願いします', prNumber: 3 }));

    expect(out).toMatchObject({
      id: 1, verb: 'diff', label: '差分を出して添える', state: 'open',
      note: '差分をお願いします', prNumber: 3, createdBy: 'tester@example.com',
      takenAt: '', takenBy: '', doneAt: '', result: '',
    });
    expect({ ...out.args }).toEqual({ branch: '見直し', against: 'main' });
    expect(out.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rows = ctx.dbReadAll('outbox');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].state)).toBe('open');
  });

  it('引数と一言を省いても置ける (空の引数は持たない)', () => {
    const { ctx } = makeEnv({ file: false });
    const out = ctx.apiOutboxAdd('review');
    expect({ ...out.args }).toEqual({});
    expect(out.note).toBe('');
    expect(out.prNumber).toBe('');
  });

  it('決めた欄以外の引数は捨てる', () => {
    const { ctx } = makeEnv({ file: false });
    const out = ctx.apiOutboxAdd('diff', { branch: '改訂', cmd: 'rm -rf /', against: 'main' });
    expect(Object.keys(out.args).sort()).toEqual(['against', 'branch']);
  });

  it('id は通し番号', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiOutboxAdd('diff', {}).id).toBe(1);
    expect(ctx.apiOutboxAdd('review', {}).id).toBe(2);
  });

  it('取り込み (merge) は手では頼ませない (承認したときに自動で置かれる)', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiOutboxAdd('merge', { branch: '改訂', into: 'main' }),
      /取り込みは、承認したときに自動で頼みます/);
    expect(ctx.dbReadAll('outbox')).toHaveLength(0);
  });

  it('知らない動詞は断り、何も置かない', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiOutboxAdd('exec', { branch: 'x' }), /頼めない動詞です/);
    expectRefused(() => ctx.apiOutboxAdd('', {}), /頼めない動詞です/);
    expect(ctx.dbReadAll('outbox')).toHaveLength(0);
  });

  it.each([
    ['シェルの記号', '改訂; rm -rf ~'],
    ['空白', '改 訂'],
    ['上に抜ける道のり', '../secret'],
    ['- 始まり (git のオプションとして読まれる)', '--output=/tmp/x'],
    ['長すぎる字', 'あ'.repeat(201)],
  ])('引数に %s があれば断り、何も置かない', (_name, value) => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiOutboxAdd('diff', { branch: value }), /引数に使えない字があります/);
    expect(ctx.dbReadAll('outbox')).toHaveLength(0);
  });

  it('日本語の改訂版の名前は通す', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiOutboxAdd('diff', { branch: '見直し/第2条', against: '土台' }).args.branch)
      .toBe('見直し/第2条');
  });

  it('頼んだ人が分からなければ断る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    fake._setUser('');
    expectRefused(() => ctx.apiOutboxAdd('diff', {}), /頼んだ人が分からない/);
    expect(ctx.dbReadAll('outbox')).toHaveLength(0);
  });

  it('1人1日の上限を超えると断る (ほかの人の枠は使わない)', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const limit = ctx.OUTBOX_DAILY_LIMIT();
    for (let i = 0; i < limit; i++) ctx.apiOutboxAdd('diff', {});
    expectRefused(() => ctx.apiOutboxAdd('diff', {}), /きょう頼める数/);
    expect(ctx.dbReadAll('outbox')).toHaveLength(limit);

    fake._setUser(OTHER);
    expect(ctx.apiOutboxAdd('diff', {}).createdBy).toBe(OTHER);
  });

  it('一言は500字で切る', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiOutboxAdd('diff', {}, { note: 'あ'.repeat(600) }).note).toHaveLength(500);
  });
});

describe('apiOutboxList', () => {
  it('新しい順に返し、状態で絞れる', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxAdd('review', {});
    ctx.apiOutboxDone(1, '済み');

    const all = expectScreenSafe(ctx.apiOutboxList());
    expect(all.map((r) => r.id)).toEqual([2, 1]);
    expect(ctx.apiOutboxList('open').map((r) => r.id)).toEqual([2]);
    expect(ctx.apiOutboxList('done').map((r) => r.id)).toEqual([1]);
  });

  it('台帳に読めない引数が手で書かれても、一覧は落とさない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', { branch: 'a' });
    ctx.dbUpdate('outbox', 'id', 1, { args: '{壊れた' });
    const out = expectScreenSafe(ctx.apiOutboxList());
    expect({ ...out[0].args }).toEqual({});
  });

  it('空なら空の配列', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiOutboxList()).toHaveLength(0);
  });
});

describe('apiOutboxTake', () => {
  it('取った印を付けてから返し、二度は配らない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxAdd('review', {});

    const first = expectScreenSafe(ctx.apiOutboxTake());
    expect(first.map((r) => r.id)).toEqual([1, 2]);
    expect(first.every((r) => r.state === 'taken' && r.takenBy === 'tester@example.com' && r.takenAt)).toBe(true);
    expect(ctx.apiOutboxTake()).toHaveLength(0);
  });

  it('上限の数だけ取る (1〜20 に収める)', () => {
    const { ctx } = makeEnv({ file: false });
    for (let i = 0; i < 25; i++) ctx.apiOutboxAdd('diff', {});
    expect(ctx.apiOutboxTake(2)).toHaveLength(2);
    expect(ctx.apiOutboxTake(0)).toHaveLength(5); // 0 は既定の5
    expect(ctx.apiOutboxTake(100)).toHaveLength(18); // 残り18 (上限20)
  });

  it('取ったまま24時間動かないものは戻してから配る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxTake();
    ctx.dbUpdate('outbox', 'id', 1, { takenAt: new Date(Date.now() - 25 * 3600 * 1000) });

    const again = ctx.apiOutboxTake();
    expect(again.map((r) => r.id)).toEqual([1]);
  });

  it('取って間もないものは戻さない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxTake();
    ctx.dbUpdate('outbox', 'id', 1, { takenAt: new Date(Date.now() - 3600 * 1000) });
    expect(ctx.apiOutboxTake()).toHaveLength(0);
  });
});

describe('apiOutboxDone / apiOutboxFail', () => {
  it('終わったことにすると状態と結果が残る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxTake();
    const out = expectScreenSafe(ctx.apiOutboxDone(1, '差分を添えました'));
    expect(out).toMatchObject({ id: 1, state: 'done', result: '差分を添えました' });
    expect(out.doneAt).toMatch(/T/);
  });

  it('できなかったことにすると failed で理由が残る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    const out = expectScreenSafe(ctx.apiOutboxFail(1, '改訂版が手元にありません'));
    expect(out).toMatchObject({ state: 'failed', result: '改訂版が手元にありません' });
  });

  it('結果は2000字で切る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    expect(ctx.apiOutboxDone(1, 'x'.repeat(3000)).result).toHaveLength(2000);
  });

  it('無い番号は断る', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiOutboxDone(9, ''), /見つかりません/);
    expectRefused(() => ctx.apiOutboxFail(9, ''), /見つかりません/);
  });

  it('終わったものはもう一度終えられず、元の結果を書き換えない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxDone(1, '最初');
    const before = snapshotDb(ctx, ['outbox']);

    expectRefused(() => ctx.apiOutboxDone(1, '二度目'), /既に終わっています/);
    expectRefused(() => ctx.apiOutboxFail(1, '取り消し'), /既に終わっています/);
    expect(snapshotDb(ctx, ['outbox'])).toEqual(before);
  });

  it('終えたものは戻されない (24時間たっても配り直さない)', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiOutboxAdd('diff', {});
    ctx.apiOutboxTake();
    ctx.dbUpdate('outbox', 'id', 1, { takenAt: new Date(Date.now() - 48 * 3600 * 1000) });
    ctx.apiOutboxDone(1, '済み');
    expect(ctx.apiOutboxTake()).toHaveLength(0);
  });
});
