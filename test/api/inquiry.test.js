import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, snapshotDb, asUser, OWNER, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 報告とそのやりとり、自分あての知らせ (src/api/Inquiry.gs)。
 *
 * 閉じられるのは出した本人と管理者。知らせの宛先は持ち主 (Session ではなく入れ物の持ち主)。
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('apiInquiryKinds', () => {
  it('{value, label} の並びで、INQUIRY_KINDS と揃う', () => {
    const { ctx } = makeEnv({ file: false });
    const out = expectScreenSafe(ctx.apiInquiryKinds());
    expect(out.map((k) => k.value)).toEqual(Object.keys(ctx.INQUIRY_KINDS()));
    expect(out.every((k) => k.label)).toBe(true);
  });
});

describe('apiInquiryCreate', () => {
  it('送った報告を画面に渡せる形で返し、持ち主のやることに積む', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = asUser(fake, OTHER, () => expectScreenSafe(
      ctx.apiInquiryCreate('bug', '棒が伸びない\n2行目', '画面: 工程表')));

    expect(out).toMatchObject({
      number: 1, kind: 'bug', kindLabel: 'うまく動かない', title: '棒が伸びない',
      by: OTHER, state: 'open', context: '画面: 工程表', replyCount: 0, shots: [],
    });
    expect(out.at).toMatch(/T/);
    // 送った本人は自分のものとして見え、閉じられる
    expect(out.mine).toBe(true);
    expect(out.canClose).toBe(true);

    const issue = ctx.dbFindOne('issues', 'number', out.issueNumber);
    expect(String(issue.title)).toContain('[報告 #1]');
    expect(String(issue.assignee)).toBe(OWNER);
  });

  it('送った人は画面から受け取らない (開いている本人になる)', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('question', 'わからない', ''));
    expect(String(ctx.dbFindOne('inquiries', 'number', 1).by)).toBe(OTHER);
  });

  it('持ち主にメールで知らせる (Session ではなく入れ物の持ち主)', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', '困った', ''));
    const mails = fake._sentMails();
    expect(mails.some((m) => m.to === OWNER && /^\[SoftBanto\]/.test(m.subject))).toBe(true);
    expect(mails.some((m) => m.to === OTHER)).toBe(false);
  });

  it('画像を添えると Drive に置き、見るための URL だけを渡す', () => {
    const { ctx } = makeEnv({ file: false });
    const out = expectScreenSafe(ctx.apiInquiryCreate('bug', '画像つき', '', [PNG, PNG]));
    expect(out.shots).toHaveLength(2);
    expect(out.shots[0].url).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/.+\/view$/);
    expect(out.shots[0].thumb).toMatch(/thumbnail\?id=/);
  });

  it.each([
    ['種類が違う', ['nope', '本文'], /種類が正しくありません/],
    ['本文が空', ['bug', '  '], /内容を入力してください/],
    ['本文が長すぎる', ['bug', 'あ'.repeat(2001)], /2000文字まで/],
    ['画像が多すぎる', ['bug', 'x', '', [PNG, PNG, PNG, PNG, PNG]], /4枚まで/],
    ['画像でない', ['bug', 'x', '', ['hello']], /画像として読めませんでした/],
    ['受け取れない形', ['bug', 'x', '', ['data:application/pdf;base64,AAAA']], /受け取れない形式です/],
  ])('%s なら断り、報告もやることも画像も残さない', (_name, args, pattern) => {
    const { ctx, fake } = makeEnv({ file: false });
    const before = snapshotDb(ctx, ['inquiries', 'issues']);
    expectRefused(() => ctx.apiInquiryCreate(...args), pattern);
    expect(snapshotDb(ctx, ['inquiries', 'issues'])).toEqual(before);
    const git = fake.DriveApp.getFolderById(ctx.repoConfig().gitId).getFoldersByName('shots');
    if (git.hasNext()) expect(git.next().getFiles().hasNext()).toBe(false);
  });

  it('種類を省くと「うまく動かない」になる', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiInquiryCreate('', '本文', '').kind).toBe('bug');
  });
});

describe('apiInquiryList / apiInquiryThread', () => {
  it('全員が全部を読め、返信の数と閉じられるかが人ごとに付く', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', 'ほかの人の報告', ''));
    ctx.apiInquiryCreate('request', '持ち主の要望', '');
    ctx.apiInquiryReply(1, '持ち主から返信');
    ctx.apiInquiryReply(1, 'もう一言');

    const asThird = asUser(fake, 'third@example.com', () => expectScreenSafe(ctx.apiInquiryList()));
    expect(asThird).toHaveLength(2);
    const one = asThird.find((r) => r.number === 1);
    expect(one).toMatchObject({ replyCount: 2, mine: false, canClose: false });

    const asAdmin = asUser(fake, ADMIN, () => ctx.apiInquiryList());
    expect(asAdmin.every((r) => r.canClose)).toBe(true);
  });

  it('やりとりは古い順で、本人の返信だけ直せる印が付く', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiInquiryCreate('bug', '報告', '');
    ctx.apiInquiryReply(1, '持ち主');
    asUser(fake, OTHER, () => ctx.apiInquiryReply(1, 'ほかの人', [PNG]));

    const thread = expectScreenSafe(ctx.apiInquiryThread(1));
    expect(thread.inquiry.number).toBe(1);
    expect(thread.inquiry.replyCount).toBe(2);
    expect(thread.replies.map((r) => r.body)).toEqual(['持ち主', 'ほかの人']);
    expect(thread.replies.map((r) => r.canEdit)).toEqual([true, false]);
    expect(thread.replies[1].shots).toHaveLength(1);
    expect(thread.replies[1].inquiryNumber).toBe(1);
  });

  it('無い番号は断る', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiInquiryThread(5), /受付が見つかりません/);
  });
});

describe('返信 (apiInquiryReply / Edit / Delete)', () => {
  it('返信すると加わっている人に知らせが届く', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', '報告', ''));
    const reply = expectScreenSafe(ctx.apiInquiryReply(1, '見ています'));
    expect(reply).toMatchObject({ id: 1, body: '見ています', by: OWNER, canEdit: true, shots: [] });

    const theirs = asUser(fake, OTHER, () => ctx.apiNotifications());
    expect(theirs.unread).toBeGreaterThan(0);
  });

  it('空・長すぎる・無い報告への返信は断り、何も残さない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiInquiryCreate('bug', '報告', '');
    expectRefused(() => ctx.apiInquiryReply(1, ''), /内容を入力してください/);
    expectRefused(() => ctx.apiInquiryReply(1, 'あ'.repeat(2001)), /2000文字まで/);
    expectRefused(() => ctx.apiInquiryReply(1, 'x', ['bad']), /画像として読めませんでした/);
    expectRefused(() => ctx.apiInquiryReply(9, 'x'), /受付が見つかりません/);
    expect(ctx.dbReadAll('inquiry_replies')).toHaveLength(0);
  });

  it('直すのも消すのも書いた本人だけ', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiInquiryCreate('bug', '報告', '');
    asUser(fake, OTHER, () => ctx.apiInquiryReply(1, 'ほかの人'));
    const before = snapshotDb(ctx, ['inquiry_replies']);

    expectRefused(() => ctx.apiInquiryReplyEdit(1, '書き換え'), /自分が書いたものだけ直せます/);
    expectRefused(() => ctx.apiInquiryReplyDelete(1), /自分が書いたものだけ直せます/);
    asUser(fake, ADMIN, () => expectRefused(() => ctx.apiInquiryReplyDelete(1), /自分が書いたもの/));
    expect(snapshotDb(ctx, ['inquiry_replies'])).toEqual(before);

    asUser(fake, OTHER, () => {
      const edited = expectScreenSafe(ctx.apiInquiryReplyEdit(1, '直した'));
      expect(edited.body).toBe('直した');
      expect(edited.editedAt).toMatch(/T/);
      expect(ctx.apiInquiryReplyDelete(1)).toBe('返信を消しました');
    });
    expect(ctx.dbReadAll('inquiry_replies')).toHaveLength(0);
  });

  it('名指しと中身の検査', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiInquiryCreate('bug', '報告', '');
    ctx.apiInquiryReply(1, 'x');
    expectRefused(() => ctx.apiInquiryReplyEdit('', 'y'), /返信を指定してください/);
    expectRefused(() => ctx.apiInquiryReplyEdit(8, 'y'), /返信が見つかりません/);
    expectRefused(() => ctx.apiInquiryReplyEdit(1, '  '), /内容を入力してください/);
    expectRefused(() => ctx.apiInquiryReplyEdit(1, 'あ'.repeat(2001)), /2000文字まで/);
  });
});

describe('apiInquiryClose / apiInquiryReopen', () => {
  it('出した本人が閉じると、積んだやることも完了になり、開け直すと戻る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const made = asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', '報告', ''));

    const closed = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiInquiryClose(1)));
    expect(closed).toMatchObject({ state: 'done', closedBy: OTHER });
    expect(closed.answeredAt).toMatch(/T/);
    expect(String(ctx.dbFindOne('issues', 'number', made.issueNumber).state)).toBe('closed');

    const back = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiInquiryReopen(1)));
    expect(back).toMatchObject({ state: 'open', closedBy: '', answeredAt: '' });
    expect(String(ctx.dbFindOne('issues', 'number', made.issueNumber).state)).toBe('open');
  });

  it('管理者は他人の報告も閉じられる', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', '報告', ''));
    expect(asUser(fake, ADMIN, () => ctx.apiInquiryClose(1)).closedBy).toBe(ADMIN);
  });

  it('本人でも管理者でもない人は閉じられず、開け直せない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', '報告', ''));
    const before = snapshotDb(ctx, ['inquiries', 'issues']);
    asUser(fake, 'third@example.com', () => {
      expectRefused(() => ctx.apiInquiryClose(1), /出した本人か、このアプリの管理者だけが閉じられます/);
      expectRefused(() => ctx.apiInquiryReopen(1), /出した本人か/);
    });
    expect(snapshotDb(ctx, ['inquiries', 'issues'])).toEqual(before);
  });

  it('二度閉じても、開いているものを開け直しても変わらない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiInquiryCreate('bug', '報告', '');
    expect(ctx.apiInquiryReopen(1).state).toBe('open');
    const first = ctx.apiInquiryClose(1);
    expect(ctx.apiInquiryClose(1).answeredAt).toBe(first.answeredAt);
  });

  it('無い番号は断る', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiInquiryClose(4), /受付が見つかりません/);
    expectRefused(() => ctx.apiInquiryReopen(4), /受付が見つかりません/);
  });
});

describe('知らせ (apiNotifications / apiNotificationsRead)', () => {
  /** OTHER の報告に持ち主が返信を重ねる。知らせは OTHER に届く */
  function threeNotices() {
    const env = makeEnv({ file: false });
    const { ctx, fake } = env;
    asUser(fake, OTHER, () => ctx.apiInquiryCreate('bug', '報告', ''));
    for (let i = 0; i < 3; i++) ctx.apiInquiryReply(1, '持ち主から' + i);
    return env;
  }

  it('自分あてだけを新しい順に返し、読んだ印は本人のぶんだけ付く', () => {
    const { ctx, fake } = threeNotices();
    expect(ctx.apiNotifications().items).toHaveLength(0); // 持ち主あては無い

    asUser(fake, OTHER, () => {
      const mine = expectScreenSafe(ctx.apiNotifications());
      expect(mine.items).toHaveLength(3);
      expect(mine.unread).toBe(3);
      const ids = mine.items.map((n) => n.id);
      expect([...ids].sort((a, b) => b - a)).toEqual(ids);
      expect(mine.items[0]).toMatchObject({ kind: 'reply', link: 'report:1', read: false });

      expect(ctx.apiNotificationsRead([ids[0]])).toBe(1);
      expect(ctx.apiNotifications().unread).toBe(2);
      expect(ctx.apiNotificationsRead([ids[0]])).toBe(0); // 読んだものは数えない
      expect(ctx.apiNotificationsRead()).toBe(2);
      const after = ctx.apiNotifications();
      expect(after.unread).toBe(0);
      expect(after.items.every((n) => n.read)).toBe(true);
    });
  });

  it('他人あての知らせは読んだことにできない', () => {
    const { ctx, fake } = threeNotices();
    const ids = asUser(fake, OTHER, () => ctx.apiNotifications().items.map((n) => n.id));
    expect(ctx.apiNotificationsRead(ids)).toBe(0);
    expect(asUser(fake, OTHER, () => ctx.apiNotifications().unread)).toBe(3);
  });

  it('件数で切れる', () => {
    const { ctx, fake } = threeNotices();
    expect(asUser(fake, OTHER, () => ctx.apiNotifications(1).items)).toHaveLength(1);
  });

  it('知らせが無ければ空、読むものが無ければ0', () => {
    const { ctx } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiNotifications())).toEqual({ items: [], unread: 0 });
    expect(ctx.apiNotificationsRead()).toBe(0);
  });
});
