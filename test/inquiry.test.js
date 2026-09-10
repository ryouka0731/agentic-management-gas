import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Tag.gs',
  'src/core/Template.gs',
  'src/core/Member.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Issue.gs',
  'src/core/IssueComment.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Inquiry.gs',
  'src/core/Notifier.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('報告を受け付ける', () => {
  it('内容と種類と送り主が残る', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '工程表が伸ばせない', '画面: 工程表');

    expect(row.number).toBe(1);
    expect(row.kind).toBe('bug');
    expect(row.body).toBe('工程表が伸ばせない');
    expect(row.state).toBe('open');
    expect(row.by).toBe('tester@example.com');
    expect(row.context).toBe('画面: 工程表');
  });

  it('番号は増えていく', () => {
    const { ctx } = setup();
    ctx.inquiryCreate('bug', 'ひとつめ');

    expect(ctx.inquiryCreate('bug', 'ふたつめ').number).toBe(2);
  });

  it('空は受け付けない', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryCreate('bug', '   ')).toThrow(/内容を入力/);
  });

  it('長すぎるものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryCreate('bug', 'あ'.repeat(2001)))
      .toThrow(/2000文字/);
  });

  it('知らない種類は断る', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryCreate('なにか', '本文')).toThrow(/種類/);
  });

  it('送り主は画面から受け取らない', () => {
    const { ctx } = setup();
    // 名乗りを詐称できてしまうため、引数では渡せない形にしてある
    expect(ctx.inquiryCreate.length).toBe(4);
    expect(ctx.inquiryCreate('bug', '本文').by).toBe('tester@example.com');
  });

  it('届いたことを持ち主に知らせる', () => {
    const { ctx, fake } = setup();
    ctx.DriveApp.getFolderById(ctx.repoConfig().rootId)._setOwner('owner@example.com');

    ctx.inquiryCreate('bug', '動かない');

    const mail = fake._sentMails().pop();
    expect(mail.to).toBe('owner@example.com');
    expect(mail.subject).toContain('報告 #1');
    expect(mail.body).toContain('うまく動かない');
  });

  it('持ち主が自分で出したときは自分に送らない', () => {
    const { ctx, fake } = setup();
    const before = fake._sentMails().length;

    ctx.inquiryCreate('bug', '動かない');

    expect(fake._sentMails().length).toBe(before);
  });
});

describe('報告を読む', () => {
  it('新しい順に返す', () => {
    const { ctx } = setup();
    ctx.inquiryCreate('bug', 'ひとつめ');
    ctx.inquiryCreate('bug', 'ふたつめ');

    expect(ctx.inquiryList().map((r) => r.number)).toEqual([2, 1]);
  });

  it('人を指定するとその人のぶんだけ', () => {
    const { ctx } = setup();
    ctx.inquiryCreate('bug', 'じぶんの');
    ctx.dbAppend('inquiries', {
      number: 99, kind: 'bug', body: 'ひとの', by: 'other@example.com',
      at: new Date(), state: 'open', context: '', answer: '', answeredAt: '',
    });

    expect(ctx.inquiryList('tester@example.com').map((r) => r.number)).toEqual([1]);
  });
});

describe('報告に答える', () => {
  it('答えると閉じる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '動かない');

    const after = ctx.inquiryAnswer(row.number, '直しました');

    expect(after.state).toBe('done');
    expect(after.answer).toBe('直しました');
    expect(after.answeredAt).not.toBe('');
  });

  it('答えたことを送り主に知らせる', () => {
    const { ctx, fake } = setup();
    const row = ctx.inquiryCreate('bug', '動かない');

    ctx.inquiryAnswer(row.number, '直しました');

    const mail = fake._sentMails().pop();
    expect(mail.to).toBe('tester@example.com');
    expect(mail.body).toContain('直しました');
  });

  it('無い受付には答えられない', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryAnswer(999, 'なにか')).toThrow(/見つかりません/);
  });
});

describe('報告で話す', () => {
  it('返信が古い順に並ぶ', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '棒が伸びない');

    ctx.inquiryReply(row.number, 'こちらでも起きます');
    ctx.inquiryReply(row.number, '直しました');

    expect(ctx.inquiryReplies(row.number).map((r) => r.body))
      .toEqual(['こちらでも起きます', '直しました']);
  });

  it('無い受付には返信できない', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryReply(999, 'なにか')).toThrow(/見つかりません/);
  });

  it('空の返信は受け付けない', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    expect(() => ctx.inquiryReply(row.number, '  ')).toThrow(/内容を入力/);
  });

  it('自分の返信は直せる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    const reply = ctx.inquiryReply(row.number, 'まえ');

    const after = ctx.inquiryReplyEdit(reply.id, 'あと');

    expect(after.body).toBe('あと');
    expect(after.editedAt).not.toBe('');
  });

  it('他人の返信は直せない', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    const reply = ctx.inquiryReply(row.number, 'ひとの');
    ctx.dbUpdate('inquiry_replies', 'id', reply.id, { by: 'other@example.com' });

    expect(() => ctx.inquiryReplyEdit(reply.id, 'x')).toThrow(/自分が書いたもの/);
    expect(() => ctx.inquiryReplyDelete(reply.id)).toThrow(/自分が書いたもの/);
  });

  it('自分の返信は消せる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    const reply = ctx.inquiryReply(row.number, '消す');

    ctx.inquiryReplyDelete(reply.id);

    expect(ctx.inquiryReplies(row.number)).toEqual([]);
  });

  it('話に加わっている人を集める', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    const reply = ctx.inquiryReply(row.number, 'べつの人');
    ctx.dbUpdate('inquiry_replies', 'id', reply.id, { by: 'other@example.com' });

    expect(ctx.inquiryTalkers(row.number))
      .toEqual(['tester@example.com', 'other@example.com']);
  });

  it('返信を書いた本人には通知しない', () => {
    const { ctx, fake } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    const before = fake._sentMails().length;
    ctx.inquiryReply(row.number, 'じぶんで返信');

    // 自分の発言で自分に通知が来ると、通知そのものが読まれなくなる
    expect(fake._sentMails().length).toBe(before);
  });

  it('ほかの人には通知する', () => {
    const { ctx, fake } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.dbUpdate('inquiries', 'number', row.number, { by: 'other@example.com' });

    const before = fake._sentMails().length;
    ctx.inquiryReply(row.number, 'かえします');

    expect(fake._sentMails().slice(before).map((m) => m.to))
      .toEqual(['other@example.com']);
  });
});

describe('話を閉じる', () => {
  it('出した本人は閉じられる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    expect(ctx.inquiryClose(row.number).state).toBe('done');
  });

  it('閉じた人が残る', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    expect(ctx.inquiryClose(row.number).closedBy).toBe('tester@example.com');
  });

  it('開け直せる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.inquiryClose(row.number);

    const after = ctx.inquiryReopen(row.number);

    expect(after.state).toBe('open');
    expect(after.closedBy).toBe('');
  });

  it('関係ない人は閉じられない', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.dbUpdate('inquiries', 'number', row.number, { by: 'other@example.com' });

    // まだ困っている人の話を横から畳ませない
    ctx.DriveApp.getFolderById(ctx.repoConfig().rootId)._setOwner('owner@example.com');
    expect(() => ctx.inquiryClose(row.number)).toThrow(/持ち主だけ/);
  });

  it('持ち主は他人の話も閉じられる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.dbUpdate('inquiries', 'number', row.number, { by: 'other@example.com' });

    expect(ctx.inquiryClose(row.number).state).toBe('done');
  });
});

describe('見出し', () => {
  it('本文の1行目を見出しにする', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '棒が伸びない\n右端を掴んだ');

    expect(row.title).toBe('棒が伸びない');
  });

  it('長い1行目は切り詰める', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', 'あ'.repeat(80));

    expect(row.title.length).toBe(61);
    expect(row.title.slice(-1)).toBe('…');
  });
});

describe('画像を添える', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('置き場に入れて id を残す', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文', '', [PNG]);

    expect(ctx.inquiryShotsOf(row)).toHaveLength(1);
  });

  it('置き場は無ければ作る', () => {
    const { ctx } = setup();
    ctx.inquiryCreate('bug', '本文', '', [PNG]);

    // 初期化のときの設定には入っていない。名前で探して作る
    expect(() => ctx.inquiryShotsFolder_()).not.toThrow();
    expect(ctx.inquiryShotsFolder_().getName()).toBe('shots');
  });

  it('二度目も同じ置き場を使う', () => {
    const { ctx } = setup();
    ctx.inquiryCreate('bug', 'ひとつめ', '', [PNG]);
    ctx.inquiryCreate('bug', 'ふたつめ', '', [PNG]);

    expect(ctx.inquiryShotsFolder_().getId())
      .toBe(ctx.inquiryShotsFolder_().getId());
  });

  it('返信にも添えられる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    const reply = ctx.inquiryReply(row.number, 'これです', [PNG]);

    expect(ctx.inquiryShotsOf(reply)).toHaveLength(1);
  });

  it('画像でないものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryCreate('bug', '本文', '', ['data:text/html;base64,PHA+']))
      .toThrow(/受け取れない形式/);
  });

  it('data URL の形でないものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.inquiryCreate('bug', '本文', '', ['https://example.invalid/a.png']))
      .toThrow(/画像として読めません/);
  });

  it('枚数の上限を超えたら断る', () => {
    const { ctx } = setup();
    const many = [PNG, PNG, PNG, PNG, PNG];

    expect(() => ctx.inquiryCreate('bug', '本文', '', many)).toThrow(/4枚まで/);
  });

  it('大きすぎる画像は復号する前に断る', () => {
    const { ctx } = setup();
    const huge = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);

    expect(() => ctx.inquiryCreate('bug', '本文', '', [huge])).toThrow(/5MB/);
  });

  it('添えなくても送れる', () => {
    const { ctx } = setup();
    expect(ctx.inquiryShotsOf(ctx.inquiryCreate('bug', '本文'))).toEqual([]);
  });
});

describe('名前を呼ぶ', () => {
  /** 名簿に載る人を1人増やす */
  function addPerson(ctx, email) {
    ctx.dbAppend('issues', {
      number: 1, title: 'x', body: '', state: 'open', assignee: email,
      labels: '', linkedFileIds: '', linkedPr: '', createdAt: new Date(),
      closedAt: '', dueDate: '', startDate: '', parent: '', estimate: '',
      plannedHours: '', actualHours: '', archivedAt: '', updatedAt: new Date(),
    });
  }

  it('呼ばれた人に知らせる', () => {
    const { ctx, fake } = setup();
    addPerson(ctx, 'aoki@example.com');
    const row = ctx.inquiryCreate('bug', '本文');

    const before = fake._sentMails().length;
    ctx.inquiryReply(row.number, '@aoki これ見て');

    expect(fake._sentMails().slice(before).map((m) => m.to))
      .toContain('aoki@example.com');
  });

  it('名簿に無い人は呼べない', () => {
    const { ctx, fake } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    const before = fake._sentMails().length;
    ctx.inquiryReply(row.number, '@dareka みてください');

    // 関わりのない人に知らせが飛ばないようにする
    expect(fake._sentMails().length).toBe(before);
  });

  it('自分を呼んでも自分には送らない', () => {
    const { ctx, fake } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    const before = fake._sentMails().length;
    ctx.inquiryReply(row.number, '@tester おぼえがき');

    expect(fake._sentMails().length).toBe(before);
  });

  it('既に話に加わっている人には二重に送らない', () => {
    const { ctx, fake } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.dbUpdate('inquiries', 'number', row.number, { by: 'aoki@example.com' });
    addPerson(ctx, 'aoki@example.com');

    const before = fake._sentMails().length;
    ctx.inquiryReply(row.number, '@aoki どうでしょう');

    // 返信の知らせが既に届く。同じことで二度呼ぶと通知が読まれなくなる
    expect(fake._sentMails().slice(before)
      .filter((m) => m.to === 'aoki@example.com')).toHaveLength(1);
  });

  it('起票のときにも呼べる', () => {
    const { ctx, fake } = setup();
    addPerson(ctx, 'aoki@example.com');

    const before = fake._sentMails().length;
    ctx.inquiryCreate('bug', '@aoki 見てほしい');

    expect(fake._sentMails().slice(before).map((m) => m.to))
      .toContain('aoki@example.com');
  });

  it('呼び出しの知らせには発言がそのまま入る', () => {
    const { ctx, fake } = setup();
    addPerson(ctx, 'aoki@example.com');
    const row = ctx.inquiryCreate('bug', '本文');

    ctx.inquiryReply(row.number, '@aoki ここが変です');

    const mail = fake._sentMails()
      .filter((m) => m.to === 'aoki@example.com').pop();
    expect(mail.subject).toContain('呼ばれました');
    expect(mail.body).toContain('ここが変です');
  });
});

describe('画面の中の知らせ', () => {
  function addPerson(ctx, email) {
    ctx.dbAppend('issues', {
      number: 1, title: 'x', body: '', state: 'open', assignee: email,
      labels: '', linkedFileIds: '', linkedPr: '', createdAt: new Date(),
      closedAt: '', dueDate: '', startDate: '', parent: '', estimate: '',
      plannedHours: '', actualHours: '', archivedAt: '', updatedAt: new Date(),
    });
  }

  it('呼ばれたら知らせが残る', () => {
    const { ctx } = setup();
    addPerson(ctx, 'aoki@example.com');
    const row = ctx.inquiryCreate('bug', '本文');

    ctx.inquiryReply(row.number, '@aoki みて');

    const list = ctx.noticeList('aoki@example.com');
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe('mention');
    expect(list[0].link).toBe('report:' + row.number);
  });

  it('返信でも知らせが残る', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.dbUpdate('inquiries', 'number', row.number, { by: 'aoki@example.com' });

    ctx.inquiryReply(row.number, 'こうしたら直りました');

    expect(ctx.noticeList('aoki@example.com')[0].kind).toBe('reply');
  });

  it('宛先が無ければ残さない', () => {
    const { ctx } = setup();
    expect(ctx.noticeAdd('', 'mention', 'x', 'y', '')).toBe(null);
  });

  it('自分あてだけが返る', () => {
    const { ctx } = setup();
    ctx.noticeAdd('aoki@example.com', 'mention', 'あおき宛', '', '');
    ctx.noticeAdd('ito@example.com', 'mention', 'いとう宛', '', '');

    expect(ctx.noticeList('aoki@example.com').map((n) => n.title))
      .toEqual(['あおき宛']);
  });

  it('新しい順に返る', () => {
    const { ctx } = setup();
    ctx.noticeAdd('tester@example.com', 'mention', 'ひとつめ', '', '');
    ctx.noticeAdd('tester@example.com', 'mention', 'ふたつめ', '', '');

    expect(ctx.noticeList('tester@example.com').map((n) => n.title))
      .toEqual(['ふたつめ', 'ひとつめ']);
  });

  it('読んだことにできる', () => {
    const { ctx } = setup();
    ctx.noticeAdd('tester@example.com', 'mention', 'x', '', '');

    expect(ctx.noticeMarkRead([])).toBe(1);
    expect(ctx.noticeList('tester@example.com')[0].readAt).not.toBe('');
  });

  it('他人あては読んだことにできない', () => {
    const { ctx } = setup();
    ctx.noticeAdd('aoki@example.com', 'mention', 'x', '', '');

    // 読んだかどうかは本人にしか決められない
    expect(ctx.noticeMarkRead([])).toBe(0);
    expect(ctx.noticeList('aoki@example.com')[0].readAt).toBe('');
  });

  it('番号を選んで読んだことにできる', () => {
    const { ctx } = setup();
    const a = ctx.noticeAdd('tester@example.com', 'mention', 'a', '', '');
    ctx.noticeAdd('tester@example.com', 'mention', 'b', '', '');

    expect(ctx.noticeMarkRead([a.id])).toBe(1);

    const left = ctx.noticeList('tester@example.com')
      .filter((n) => !n.readAt);
    expect(left.map((n) => n.title)).toEqual(['b']);
  });

  it('二度読んでも数は増えない', () => {
    const { ctx } = setup();
    ctx.noticeAdd('tester@example.com', 'mention', 'x', '', '');
    ctx.noticeMarkRead([]);

    expect(ctx.noticeMarkRead([])).toBe(0);
  });
});

describe('報告から開発者のやることを作る', () => {
  it('積まれる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '棒が伸びない', '画面: 工程表');

    expect(row.issueNumber).toBe(1);

    const issue = ctx.issueGet(row.issueNumber);
    expect(issue.title).toBe('[報告 #1] 棒が伸びない');
    expect(issue.body).toContain('受付 #1');
    expect(issue.body).toContain('画面: 工程表');
  });

  it('持ち主が担当になる', () => {
    const { ctx } = setup();
    ctx.DriveApp.getFolderById(ctx.repoConfig().rootId)._setOwner('owner@example.com');

    const row = ctx.inquiryCreate('bug', '本文');

    expect(ctx.issueGet(row.issueNumber).assignee).toBe('owner@example.com');
  });

  it('種類がタグになる', () => {
    const { ctx } = setup();

    expect(ctx.issueGet(ctx.inquiryCreate('bug', 'a').issueNumber).labels)
      .toBe('不具合');
    expect(ctx.issueGet(ctx.inquiryCreate('request', 'b').issueNumber).labels)
      .toBe('要望');
  });

  it('進捗ボードにも並ぶ', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    expect(ctx.dbFindOne('project_items', 'issueNumber', row.issueNumber).column)
      .toBe('Backlog');
  });

  it('解決にするとやることも完了になる', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');

    ctx.inquiryClose(row.number);

    expect(ctx.issueGet(row.issueNumber).state).toBe('closed');
  });

  it('開け直すとやることも戻る', () => {
    const { ctx } = setup();
    const row = ctx.inquiryCreate('bug', '本文');
    ctx.inquiryClose(row.number);

    ctx.inquiryReopen(row.number);

    expect(ctx.issueGet(row.issueNumber).state).toBe('open');
  });

  it('やることを作れなくても報告は受け付ける', () => {
    const { ctx } = setup();
    const original = ctx.issueCreate;
    ctx.issueCreate = () => { throw new Error('わざと失敗'); };

    const row = ctx.inquiryCreate('bug', '本文');

    // ここで投げると、送ったのに何も残らないことになる
    expect(row.number).toBe(1);
    expect(row.issueNumber).toBe('');
    ctx.issueCreate = original;
  });

  it('機能の要望も受け付ける', () => {
    const { ctx } = setup();

    expect(ctx.INQUIRY_KINDS().request).toContain('機能の要望');
    expect(() => ctx.inquiryCreate('other', 'その他の相談')).not.toThrow();
  });
});
