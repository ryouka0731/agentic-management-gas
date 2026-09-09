import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
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
    expect(ctx.inquiryCreate.length).toBe(3);
    expect(ctx.inquiryCreate('bug', '本文').by).toBe('tester@example.com');
  });

  it('届いたことを持ち主に知らせる', () => {
    const { ctx, fake } = setup();
    ctx.inquiryCreate('bug', '動かない');

    const mail = fake._sentMails().pop();
    expect(mail.subject).toContain('報告 #1');
    expect(mail.body).toContain('うまく動かない');
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
