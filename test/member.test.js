import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Member.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('上下関係', () => {
  it('登録できる', () => {
    const { ctx } = setup();
    const row = ctx.memberSet('buka@example.com', 'boss@example.com');

    expect(row.email).toBe('buka@example.com');
    expect(row.manager).toBe('boss@example.com');
  });

  it('二度目は書き換える', () => {
    const { ctx } = setup();
    ctx.memberSet('buka@example.com', 'boss@example.com');
    ctx.memberSet('buka@example.com', 'other@example.com');

    expect(ctx.memberList()).toHaveLength(1);
    expect(ctx.memberList()[0].manager).toBe('other@example.com');
  });

  it('空にすると関係が外れる', () => {
    const { ctx } = setup();
    ctx.memberSet('buka@example.com', 'boss@example.com');
    ctx.memberSet('buka@example.com', '');

    expect(ctx.memberSubordinates('boss@example.com')).toEqual([]);
  });

  it('自分を自分の上長にはできない', () => {
    const { ctx } = setup();
    expect(() => ctx.memberSet('a@example.com', 'a@example.com'))
      .toThrow(/自分を自分の上長/);
  });

  it('輪になる登録は断る', () => {
    const { ctx } = setup();
    ctx.memberSet('a@example.com', 'b@example.com');

    // 輪ができると、配下をたどるのが終わらない
    expect(() => ctx.memberSet('b@example.com', 'a@example.com'))
      .toThrow(/輪になります/);
  });

  it('メールの形になっていないものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.memberSet('だれか', '')).toThrow(/メールアドレス/);
    expect(() => ctx.memberSet('a@example.com', 'だれか')).toThrow(/メールアドレス/);
  });
});

describe('見てよい人', () => {
  /**
   *   boss ─ naka ─ buka
   *        └ hira
   */
  function tree() {
    const env = setup();
    env.ctx.memberSet('naka@example.com', 'boss@example.com');
    env.ctx.memberSet('hira@example.com', 'boss@example.com');
    env.ctx.memberSet('buka@example.com', 'naka@example.com');
    return env;
  }

  it('既定は自分だけ', () => {
    const { ctx } = setup();
    expect(ctx.memberVisibleTo('hitori@example.com')).toEqual(['hitori@example.com']);
  });

  it('上長は下を見られる', () => {
    const { ctx } = tree();

    expect(ctx.memberVisibleTo('naka@example.com'))
      .toEqual(['naka@example.com', 'buka@example.com']);
  });

  it('下の下も見られる', () => {
    const { ctx } = tree();
    const seen = ctx.memberVisibleTo('boss@example.com');

    expect(seen).toContain('buka@example.com');
    expect(seen).toHaveLength(4);
  });

  it('下から上は見られない', () => {
    const { ctx } = tree();

    expect(ctx.memberCanSee('buka@example.com', 'naka@example.com')).toBe(false);
    expect(ctx.memberCanSee('naka@example.com', 'buka@example.com')).toBe(true);
  });

  it('横は見られない', () => {
    const { ctx } = tree();

    expect(ctx.memberCanSee('naka@example.com', 'hira@example.com')).toBe(false);
  });

  it('名前が空なら誰も見られない', () => {
    const { ctx } = tree();
    expect(ctx.memberVisibleTo('')).toEqual([]);
  });
});

describe('画面に出す名前', () => {
  it('登録が無ければアドレスの手前を使う', () => {
    const { ctx } = setup();

    // メールアドレスは目で追いにくく、長い並びの中では全部同じに見える
    expect(ctx.memberNameOf('aoki@example.com')).toBe('aoki');
  });

  it('登録された名前があればそれを使う', () => {
    const { ctx } = setup();
    ctx.memberSetName('aoki@example.com', '青木 太郎');

    expect(ctx.memberNameOf('aoki@example.com')).toBe('青木 太郎');
  });

  it('名前を入れても上下関係は変わらない', () => {
    const { ctx } = setup();
    ctx.memberSet('buka@example.com', 'boss@example.com');
    ctx.memberSetName('buka@example.com', '部下 花子');

    expect(ctx.memberNameOf('buka@example.com')).toBe('部下 花子');
    expect(ctx.memberSubordinates('boss@example.com')).toEqual(['buka@example.com']);
  });

  it('上下関係を入れても名前は消えない', () => {
    const { ctx } = setup();
    ctx.memberSetName('buka@example.com', '部下 花子');
    ctx.memberSet('buka@example.com', 'boss@example.com');

    expect(ctx.memberNameOf('buka@example.com')).toBe('部下 花子');
  });

  it('まとめて引ける', () => {
    const { ctx } = setup();
    ctx.memberSetName('aoki@example.com', '青木');

    expect(ctx.memberNames(['aoki@example.com', 'ito@example.com']))
      .toEqual({ 'aoki@example.com': '青木', 'ito@example.com': 'ito' });
  });

  it('空は返さない', () => {
    const { ctx } = setup();
    expect(ctx.memberNameOf('')).toBe('');
    expect(ctx.memberNames([''])).toEqual({});
  });
});
