import fs from 'node:fs';
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

  it('一度出した番号は二度出さない', () => {
    const { ctx } = setup();
    ctx.issueCreate('a', '', [], '');
    const b = ctx.issueCreate('b', '', [], '');

    /*
     * 行を消しても、それを指しているものは他に残る。確認依頼の本文の
     * `closes #N` がその例で、無関係な新しいやることが同じ番号を受け取ると、
     * その確認依頼を反映した時点で身に覚えのないやることが完了になる。
     */
    ctx.dbDelete('issues', 'number', b.number);
    expect(ctx.dbNextNumber_('issues', 'number')).toBe(Number(b.number) + 1);
  });

  it('表が空になっても戻さない', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('a', '', [], '');
    ctx.dbDelete('issues', 'number', a.number);

    expect(Number(ctx.issueCreate('b', '', [], '').number))
      .toBe(Number(a.number) + 1);
  });

  it('覚え書きが失われても、表の中の最大値より小さくはならない', () => {
    const { ctx, fake } = setup();
    const a = ctx.issueCreate('a', '', [], '');

    // 台帳も覚え書きも人が触れる。壊れても番号がぶつからないようにする
    fake.PropertiesService.getScriptProperties().deleteProperty(
      ctx.dbHighKey_('issues', 'number'));

    expect(ctx.dbNextNumber_('issues', 'number')).toBe(Number(a.number) + 1);
  });

  it('表ごとに別の覚え書きを使う', () => {
    const { ctx } = setup();
    ctx.issueCreate('a', '', [], '');

    // 1つの覚え書きを共用すると、やることを作ると報告の番号まで飛ぶ
    expect(ctx.dbNextNumber_('inquiries', 'number')).toBe(1);
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

  it('消した番号は二度出さない', () => {
    const { ctx } = setup();
    const { old, made } = purgedThenNew(ctx);

    // 指している先は、この道具が知っている表だけとは限らない
    expect(Number(made)).toBeGreaterThan(Number(old));
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

describe('片付けは途中で落ちてもやり直せる', () => {
  it('やることの行は最後に消す', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('消すもの', '', [], '');
    const order = [];

    const real = ctx.dbDelete;
    ctx.dbDelete = function (table, key, value) {
      order.push(table);
      return real(table, key, value);
    };
    ctx.issuePurge(made.number);

    /*
     * 先に消すと、途中で落ちたときぶら下がりだけが残り、issueGet が通らなく
     * なってもう一度片付けることができない。
     */
    expect(order[order.length - 1]).toBe('issues');
  });

  it('途中で落ちてもやることは残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('消すもの', '', [], '');
    ctx.issueCommentAdd(made.number, 'やりとり');

    const real = ctx.dbDelete;
    ctx.dbDelete = function (table, key, value) {
      if (table === 'task_links') throw new Error('表が書けません');
      return real(table, key, value);
    };

    expect(() => ctx.issuePurge(made.number)).toThrow('表が書けません');

    // 残っていれば、直してからもう一度消せる
    expect(ctx.issueGet(made.number)).toBeTruthy();
  });

  it('id が空の知らせがあっても片付けを止めない', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('消すもの', '', [], '');

    ctx.noticeAdd('a@x.com', 'mention', '呼ばれました', '',
      'issue:' + made.number);
    // 手で空にされたセルを模す
    ctx.dbReadAll('notifications').forEach((n) => {
      ctx.dbUpdate('notifications', 'id', n.id, { id: '' });
    });

    expect(() => ctx.issuePurge(made.number)).not.toThrow();
    expect(() => ctx.issueGet(made.number)).toThrow();
  });
});

describe('知らせは本処理を巻き戻さない', () => {
  it('混み合っていても、やりとりは失敗しない', () => {
    const { ctx, fake } = setup();
    const issue = ctx.issueCreate('相談', '', [], '');
    ctx.issueUpdate(issue.number, { assignee: 'a@x.com' });

    /*
     * やりとりは先に保存され、そのあとで知らせを置く。ここで投げると
     * 「書き込みは済んでいるのに失敗と出る」。人はもう一度書き込み、
     * 同じやりとりが2つ並ぶ。
     */
    let writes = 0;
    fake.LockService.getScriptLock = () => ({
      tryLock: () => { writes++; return writes <= 1; },
      releaseLock: () => {},
    });

    expect(() => ctx.issueCommentAdd(issue.number, '書き込み')).not.toThrow();
    expect(ctx.issueComments(issue.number)).toHaveLength(1);
  });

  it('残せなかったら null を返す', () => {
    const { ctx, fake } = setup();
    fake.LockService.getScriptLock = () => ({
      tryLock: () => false, releaseLock: () => {},
    });

    expect(ctx.noticeAdd('a@x.com', 'mention', 'x', '', 'issue:1')).toBeNull();
  });
});

describe('カードは二重に置かない', () => {
  it('置くところまで鍵の中で行う', () => {
    const { ctx, fake } = setup();
    const made = ctx.issueCreate('やること', '', [], '');
    const order = [];

    fake.LockService.getScriptLock = () => ({
      tryLock: () => { order.push('lock'); return true; },
      releaseLock: () => { order.push('unlock'); },
    });

    const real = ctx.dbFindOne;
    ctx.dbFindOne = function (table, key, value) {
      if (table === 'project_items') order.push('look');
      return real(table, key, value);
    };
    const realAppend = ctx.dbAppend;
    ctx.dbAppend = function (table, row) {
      if (table === 'project_items') order.push('append');
      return realAppend(table, row);
    };

    ctx.projectPlace(made.number, 'Backlog');

    // 分けると、ほぼ同時の2件が「まだ無い」と読んで両方置く
    expect(order.indexOf('look')).toBeGreaterThan(order.indexOf('lock'));
    expect(order.indexOf('append')).toBeLessThan(order.lastIndexOf('unlock'));
  });

  it('二度置いても1枚のまま', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('やること', '', [], '');

    ctx.projectPlace(made.number, 'Backlog');
    ctx.projectPlace(made.number, 'In Progress');

    expect(ctx.dbReadAll('project_items')).toHaveLength(1);
  });
});

describe('鍵は1か所でしか取らない', () => {
  it('LockService を直に呼ぶのは Db.gs だけ', () => {
    /*
     * 取り直す作りが散ると、取れるかどうかが LockService の入れ子の扱いに
     * 左右される。深さは Db.gs が数えているので、そこを通らない鍵は
     * その数えに入らない。
     */
    const files = fs.readdirSync('src/core')
      .filter((n) => n.endsWith('.gs'))
      .filter((n) => n !== 'Db.gs');

    files.forEach((name) => {
      const text = fs.readFileSync('src/core/' + name, 'utf8');
      expect(text, name + ' が鍵を直に取っている')
        .not.toContain('LockService.getScriptLock()');
    });
  });

  it('番号を書く所はすべて鍵の中にある', () => {
    // 確認依頼を開くたびに走る埋め直しが、唯一鍵の外に残っていた
    const text = fs.readFileSync('src/core/PullRequest.gs', 'utf8');
    const at = text.indexOf('function reviewBackfillIds_()');

    expect(text.slice(at, text.indexOf('\n}', at))).toContain('dbWithLock_');
  });
});
