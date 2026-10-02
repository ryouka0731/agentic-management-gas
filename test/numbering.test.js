import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/Plain.js', 'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Issue.gs',
  'src/core/IssueComment.gs', 'src/core/Project.gs', 'src/core/Mention.js',
  'src/core/Member.gs', 'src/core/Brand.js', 'src/core/Inquiry.gs',
  'src/core/Notifier.gs',
];

/*
 * Web アプリと1分ごとのトリガーが同じ表に書く。読んで決めて書く形は鍵なしでは
 * 成立せず、ほぼ同時の2件が同じ番号を取る。そうなると一覧に同じ番号のものが
 * 2つ並び、dbFindOne は先の1件しか返さないので、もう1件は見えるのに開けない
 * 幽霊になる。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('番号を決めることと書くことは、ひとまとまり', () => {
  it('番号は鍵の中で決める', () => {
    const { ctx, fake } = setup();
    const order = [];

    // 鍵を取ったあと・外す前の出来事を見る
    fake.LockService.getScriptLock = () => ({
      tryLock: () => { order.push('lock'); return true; },
      releaseLock: () => { order.push('unlock'); },
    });

    const realAppend = ctx.dbAppend;
    ctx.dbAppend = function (table, row) {
      order.push('append:' + table);
      return realAppend(table, row);
    };
    const realNext = ctx.dbNextNumber_;
    ctx.dbNextNumber_ = function (table, col) {
      order.push('number:' + table);
      return realNext(table, col);
    };

    ctx.issueCreate('棚卸しをする', '', [], '');

    // 読んで決めて書く、の全部が鍵の中に入っていなければならない
    expect(order).toEqual(['lock', 'number:issues', 'append:issues', 'unlock']);
  });

  it('鍵が取れなければ書かない', () => {
    const { ctx, fake } = setup();
    fake.LockService.getScriptLock = () => ({
      tryLock: () => false, releaseLock: () => {},
    });

    expect(() => ctx.issueCreate('棚卸しをする', '', [], ''))
      .toThrow('混み合っています');
    expect(ctx.dbReadAll('issues')).toEqual([]);
  });

  it('入れ子では鍵を取り直さない', () => {
    const { ctx, fake } = setup();
    let taken = 0;

    fake.LockService.getScriptLock = () => ({
      tryLock: () => { taken++; return true; },
      releaseLock: () => {},
    });

    /*
     * コマンドキューは鍵を持ったまま命令を実行し、その中で番号を採る。
     * 取り直す作りだと、取れるかどうかが LockService の入れ子の扱いに
     * 左右される。自分で数えて、持っているなら取りに行かない。
     */
    ctx.dbWithLock_(1000, function () {
      ctx.issueCreate('外側から作る', '', [], '');
    });

    expect(taken).toBe(1);
    expect(ctx.dbReadAll('issues')).toHaveLength(1);
  });

  it('入れ子の内側で落ちても鍵を外す', () => {
    const { ctx, fake } = setup();
    let freed = 0;

    fake.LockService.getScriptLock = () => ({
      tryLock: () => true, releaseLock: () => { freed++; },
    });

    expect(() => ctx.dbWithLock_(1000, function () {
      ctx.dbWithLock_(1000, function () { throw new Error('中で失敗'); });
    })).toThrow('中で失敗');

    // 外さないと、以後すべての書き込みが待たされる
    expect(freed).toBe(1);
  });

  it('続けて作れば番号は増える', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('1件目', '', [], '');
    const b = ctx.issueCreate('2件目', '', [], '');

    expect(Number(b.number)).toBe(Number(a.number) + 1);
  });
});

describe('番号は表ごとの通し番号', () => {
  it('空の表からは1で始まる', () => {
    const { ctx } = setup();

    expect(ctx.dbNextNumber_('issues', 'number')).toBe(1);
  });

  it('いまある中のいちばん大きい番号の次を返す', () => {
    const { ctx } = setup();
    ctx.issueCreate('a', '', [], '');
    const b = ctx.issueCreate('b', '', [], '');

    /*
     * **消した番号は使い回される。** だから消すときは、ぶら下がっている
     * ものも全部消さなければならない (issuePurge)。残すと、新しいやることを
     * 開いたときに前のやることのやりとりが付いてくる。
     */
    ctx.dbDelete('issues', 'number', b.number);
    expect(ctx.dbNextNumber_('issues', 'number')).toBe(Number(b.number));
  });

  it('数として読めない行は飛ばす', () => {
    const { ctx } = setup();
    ctx.issueCreate('a', '', [], '');

    // 手で書き換えられる表なので、数に見えない字が入りうる
    ctx.dbAppend('issues', { number: 'あとで', title: 'x', state: 'open' });
    expect(ctx.dbNextNumber_('issues', 'number')).toBe(2);
  });
});

describe('消したやることの跡を残さない', () => {
  /*
   * 番号は「いま残っている中のいちばん大きい番号 + 1」で決まるので、消した
   * 番号は次のやることに使い回される。ぶら下がっているものを残すと、新しい
   * やることを開いたときに前のやることのやりとりが付いてくる。
   */
  function purgedThenNew(ctx) {
    const old = ctx.issueCreate('前のやること', '', [], '');
    ctx.issueCommentAdd(old.number, '前のやりとり');
    ctx.projectPlace(old.number, 'Backlog');
    ctx.dbAppend('task_links', {
      issueNumber: old.number, user: 'a@x.com', taskId: 't1',
      listId: 'l1', syncedAt: new Date(),
    });
    ctx.noticeAdd('a@x.com', 'mention', '呼ばれました', '',
      'issue:' + old.number);

    ctx.issuePurge(old.number);

    const made = ctx.issueCreate('新しいやること', '', [], '');
    return { old: old.number, made: made.number };
  }

  it('番号は使い回される', () => {
    const { ctx } = setup();
    const { old, made } = purgedThenNew(ctx);

    // だから跡を全部消さなければならない
    expect(Number(made)).toBe(Number(old));
  });

  it('前のやりとりが付いてこない', () => {
    const { ctx } = setup();
    const { made } = purgedThenNew(ctx);

    expect(ctx.issueComments(made)).toEqual([]);
  });

  it('ToDo の結び付きも残らない', () => {
    const { ctx } = setup();
    purgedThenNew(ctx);

    expect(ctx.dbReadAll('task_links')).toEqual([]);
  });

  it('知らせの行き先も残らない', () => {
    const { ctx } = setup();
    purgedThenNew(ctx);

    // 残すと、押した人が別のやることに連れて行かれる
    expect(ctx.dbReadAll('notifications')).toEqual([]);
  });

  it('カードも残らない', () => {
    const { ctx } = setup();
    const { made } = purgedThenNew(ctx);

    expect(ctx.dbFindOne('project_items', 'issueNumber', made)).toBeNull();
  });

  it('報告そのものは消さず、結び付きだけ外す', () => {
    const { ctx } = setup();
    const old = ctx.issueCreate('報告から作られた', '', [], '');

    ctx.dbAppend('inquiries', {
      number: 1, kind: 'bug', title: '棒が伸びない', body: 'x',
      by: 'a@x.com', state: 'open', at: new Date(), issueNumber: old.number,
    });
    ctx.issuePurge(old.number);

    // 報告は人が出したもので、やることの後始末で消えてよいものではない
    const left = ctx.dbReadAll('inquiries');
    expect(left).toHaveLength(1);
    expect(String(left[0].issueNumber)).toBe('');
  });
});
