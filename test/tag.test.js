import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Tag.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('用意されたタグ', () => {
  it('最初に開いたときに入る', () => {
    const { ctx } = setup();

    // 空の一覧から作らせると、何をタグにすればよいのか分からない
    expect(ctx.tagList().map((t) => t.name))
      .toEqual(ctx.TAG_TEMPLATES().map((t) => t.name));
  });

  it('二度目に増えない', () => {
    const { ctx } = setup();
    ctx.tagList();

    expect(ctx.tagList()).toHaveLength(ctx.TAG_TEMPLATES().length);
  });

  it('用意されたものは消せない', () => {
    const { ctx } = setup();
    ctx.tagList();

    expect(() => ctx.tagDelete('文書改訂')).toThrow(/用意されている/);
  });
});

describe('自分で作るタグ', () => {
  it('作れる', () => {
    const { ctx } = setup();
    const row = ctx.tagCreate('棚卸し', 'success');

    expect(row.name).toBe('棚卸し');
    expect(row.color).toBe('success');
    expect(row.builtin).toBe(false);
  });

  it('同じ名前は増やさない', () => {
    const { ctx } = setup();
    ctx.tagCreate('棚卸し');
    ctx.tagCreate('棚卸し');

    expect(ctx.tagList().filter((t) => t.name === '棚卸し')).toHaveLength(1);
  });

  it('前後の空白は落とす', () => {
    const { ctx } = setup();
    expect(ctx.tagCreate('  棚卸し  ').name).toBe('棚卸し');
  });

  it('カンマや空白やシャープは入れられない', () => {
    const { ctx } = setup();
    // 空白は区切りに、カンマとシャープは書き方に使っている
    expect(() => ctx.tagCreate('あ,い')).toThrow(/正しくありません/);
    expect(() => ctx.tagCreate('あ い')).toThrow(/正しくありません/);
    expect(() => ctx.tagCreate('あ#い')).toThrow(/正しくありません/);
  });

  it('空は作れない', () => {
    const { ctx } = setup();
    expect(() => ctx.tagCreate('   ')).toThrow(/正しくありません/);
  });

  it('知らない色は既定に倒す', () => {
    const { ctx } = setup();
    expect(ctx.tagCreate('虹色', 'rainbow').color).toBe('ink');
  });

  it('自分で作ったものは消せる', () => {
    const { ctx } = setup();
    ctx.tagCreate('棚卸し');
    ctx.tagDelete('棚卸し');

    expect(ctx.tagList().filter((t) => t.name === '棚卸し')).toEqual([]);
  });

  it('用意されたものが先に並ぶ', () => {
    const { ctx } = setup();
    ctx.tagList();
    ctx.tagCreate('あ');

    const names = ctx.tagList().map((t) => t.name);
    expect(names[names.length - 1]).toBe('あ');
  });
});

describe('その場で書いたタグ', () => {
  it('次から選べるように取り込む', () => {
    const { ctx } = setup();
    ctx.tagList();

    expect(ctx.tagAdopt('棚卸し, 会議')).toEqual(['棚卸し']);
    expect(ctx.tagList().map((t) => t.name)).toContain('棚卸し');
  });

  it('区切りだけの文字列は何も足さない', () => {
    const { ctx } = setup();
    expect(ctx.tagAdopt(' , , ')).toEqual([]);
  });

  it('同じものが2つあっても1つにする', () => {
    const { ctx } = setup();
    expect(ctx.tagsOf('会議, 会議 ,調査')).toEqual(['会議', '調査']);
  });
});

describe('「#タグ」の書き方', () => {
  it('空白で区切って読み取る', () => {
    const { ctx } = setup();
    expect(ctx.tagParse('#会議 #調査')).toEqual(['会議', '調査']);
  });

  it('文に混ざっていても拾う', () => {
    const { ctx } = setup();
    expect(ctx.tagParse('#定例業務 まとめ')).toEqual(['定例業務']);
  });

  it('同じものは1つにする', () => {
    const { ctx } = setup();
    expect(ctx.tagParse('#会議 #会議')).toEqual(['会議']);
  });

  it('シャープだけなら何も取らない', () => {
    const { ctx } = setup();
    expect(ctx.tagParse('# #')).toEqual([]);
    expect(ctx.tagParse('')).toEqual([]);
  });

  it('続けて書いても分けて読む', () => {
    const { ctx } = setup();
    expect(ctx.tagParse('#会議#調査')).toEqual(['会議', '調査']);
  });
});
