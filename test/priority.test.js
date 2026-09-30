import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/ObjectStore.gs',
  'src/core/Normalize.js',
  'src/core/Diff.js',
  'src/core/Merge.js',
  'src/core/Commit.gs',
  'src/core/Branch.gs',
  'src/render/HtmlWriter.gs',
  'src/render/DocRenderer.gs',
  'src/render/LiveCache.gs',
  'src/core/PullRequest.gs',
  'src/core/PullPatch.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Tag.gs',
  'src/core/Member.gs',
  'src/core/Issue.gs',
  'src/core/IssueComment.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Brand.js',
  'src/core/Notifier.gs',
  'src/core/Plain.js',
  'src/Main.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);

  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('優先度の語彙', () => {
  it('3つに留めてある', () => {
    const { ctx } = setup();

    // 4つ以上あると「どれにするか」を決められず、どれかに寄って差が
    // 付かなくなる
    expect(ctx.ISSUE_PRIORITIES().map((one) => one[0]))
      .toEqual(['high', 'normal', 'low']);
  });

  it('高いものから順に並んでいる', () => {
    const { ctx } = setup();

    // この並びを選択肢と並べ替えの重みの両方が使っている
    expect(ctx.ISSUE_PRIORITIES()[0][1]).toBe('高');
    expect(ctx.ISSUE_PRIORITIES()[2][1]).toBe('低');
  });

  it('画面にも同じものを渡す', () => {
    const { ctx } = setup();

    // 写すと、足したときに選べるのに保存できない選択肢になる
    expect(ctx.apiIssuePriorities()).toEqual(ctx.ISSUE_PRIORITIES());
  });
});

describe('優先度の読み方', () => {
  it('付けていない行はふつうとして扱う', () => {
    const { ctx } = setup();

    // この列を足す前に書かれた行は空のままである。埋め直さない
    expect(ctx.issuePriority({ priority: '' })).toBe('normal');
    expect(ctx.issuePriority({})).toBe('normal');
    expect(ctx.issuePriority(null)).toBe('normal');
  });

  it('知らない値もふつうにする', () => {
    const { ctx } = setup();

    // 台帳は人が手で書き換えられる表。書き間違い1つで一覧が出なくなって
    // はならない
    expect(ctx.issuePriority({ priority: '最優先' })).toBe('normal');
  });

  it('付けた値はそのまま返す', () => {
    const { ctx } = setup();

    expect(ctx.issuePriority({ priority: 'high' })).toBe('high');
    expect(ctx.issuePriority({ priority: 'low' })).toBe('low');
  });
});

describe('優先度を付ける', () => {
  it('作るときに入れられる', () => {
    const { ctx } = setup();
    const made = ctx.apiIssueCreate('棚卸し', '', [], '', { priority: 'high' });

    // 作ってすぐ直せばよい、では二度手間になる
    expect(made.priority).toBe('high');
  });

  it('あとから直せる', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('棚卸し', '', [], '');

    expect(ctx.issueUpdate(made.number, { priority: 'low' }).priority)
      .toBe('low');
  });

  it('既定はふつう', () => {
    const { ctx } = setup();

    expect(ctx.issueCreate('棚卸し', '', [], '').priority).toBe('normal');
  });

  it('知らない値は受け取らない', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('棚卸し', '', [], '');

    // 通すと台帳に残り、読むたびにふつうへ倒れるので、直したつもりが
    // 直っていない状態になる
    expect(() => ctx.issueUpdate(made.number, { priority: '最優先' }))
      .toThrow('知らない優先度です');
    expect(ctx.issueGet(made.number).priority).toBe('normal');
  });

  it('画面に渡せる形で返る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('棚卸し', '', [], '');
    ctx.issueUpdate(made.number, { priority: 'high' });

    const listed = ctx.apiIssueList('').filter((i) => i.number === made.number)[0];
    expect(listed.priority).toBe('high');
    expect(typeof listed.priority).toBe('string');
  });
});

describe('優先度で並ぶ', () => {
  /**
   * 3件作り、優先度を付ける。
   *
   * **作る順を優先度の逆にする。** 同じ向きに作ると、優先度で並べなくても
   * 「新しい順」が偶然同じ並びになり、テストが何も守らなくなる（実際に
   * 一度そうなっていた）。
   */
  function three(ctx) {
    const high = ctx.issueCreate('急ぎ', '', [], '');
    const normal = ctx.issueCreate('ふつうの件', '', [], '');
    const low = ctx.issueCreate('あとで', '', [], '');

    ctx.issueUpdate(high.number, { priority: 'high' });
    ctx.issueUpdate(low.number, { priority: 'low' });
    return { low, normal, high };
  }

  it('高いものが先に出る', () => {
    const { ctx } = setup();
    const { low, normal, high } = three(ctx);

    // 付けても並びが変わらなければ、優先度は見た目の飾りになる
    expect(ctx.issueList('').map((i) => Number(i.number)))
      .toEqual([high.number, normal.number, low.number]);
  });

  it('同じ優先度のうちでは新しいものから', () => {
    const { ctx } = setup();
    const first = ctx.issueCreate('先に作った', '', [], '');
    const second = ctx.issueCreate('後に作った', '', [], '');

    ctx.issueUpdate(first.number, { priority: 'high' });
    ctx.issueUpdate(second.number, { priority: 'high' });

    expect(ctx.issueList('').map((i) => Number(i.number)))
      .toEqual([second.number, first.number]);
  });

  it('付けていない行も混ぜて並べられる', () => {
    const { ctx } = setup();

    // 急ぎを先に作る。新しい順でも同じ並びになる形にしない
    const high = ctx.issueCreate('急ぎ', '', [], '');
    ctx.issueUpdate(high.number, { priority: 'high' });

    const older = ctx.issueCreate('古い件', '', [], '');
    // 列を足す前に書かれた行を模す
    ctx.dbUpdate('issues', 'number', older.number, { priority: '' });

    expect(ctx.issueList('').map((i) => Number(i.number)))
      .toEqual([high.number, older.number]);
  });

  it('ボードの並びは人が決めたままにする', () => {
    const { ctx } = setup();
    const { low, high } = three(ctx);

    ctx.projectPlace(low.number, 'In Progress');
    ctx.projectPlace(high.number, 'In Progress');

    // ボードは掴んで並べ替えられる。優先度で勝手に動くと、並べた意図が消える
    expect(ctx.projectBoard()['In Progress'].map((c) => c.issueNumber))
      .toEqual([low.number, high.number]);
  });

  it('ボードのカードも優先度を持つ', () => {
    const { ctx } = setup();
    const { high } = three(ctx);
    ctx.projectPlace(high.number, 'In Progress');

    // 一覧にだけ出ると、ボードで見ている人には何が急ぎなのか伝わらない
    expect(ctx.projectBoard()['In Progress'][0].priority).toBe('high');
  });
});
