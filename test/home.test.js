import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * ホーム。草は本人とチームの合計だけ。連続日数は数えない。最近の動きに名前を入れない。
 */
const SOURCES = APP_SOURCES;

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

const ME = 'tester@example.com';
const NOW = new Date('2026-10-14T03:00:00Z'); // 水曜 (東京 12:00)

function closed(ctx, title, patch) {
  const i = ctx.issueCreate(title, '', []);
  ctx.issueClose(i.number, null);
  ctx.dbUpdate('issues', 'number', i.number, Object.assign({
    createdAt: new Date('2026-10-13T01:00:00Z'), closedAt: new Date('2026-10-14T02:00:00Z'),
  }, patch || {}));
  return i.number;
}

function cell(act, day) {
  for (const w of act.weeks) for (const c of w) if (c.day === day) return c;
  return null;
}

describe('草', () => {
  it('53週 × 7日。月曜から並び、右端の週に今日がある。今日より後は数を持たない', () => {
    const { ctx } = setup();
    const act = ctx.homeActivity_(ME, NOW);
    expect(act.weeks).toHaveLength(53);
    act.weeks.forEach((w) => expect(w).toHaveLength(7));
    expect(act.weeks[52][0].day).toBe('2026-10-12'); // 今週の月曜
    expect(act.weeks[52][2]).toMatchObject({ day: '2026-10-14', future: false });
    expect(act.weeks[52][3]).toMatchObject({ day: '2026-10-15', future: true, me: 0, team: 0 });
    expect(act.weeks[0][0].day).toBe('2025-10-13');
  });

  it('今日が日曜でも右端が今週 (月曜はじまり)', () => {
    const { ctx } = setup();
    const act = ctx.homeActivity_(ME, new Date('2026-10-18T03:00:00Z'));
    expect(act.weeks[52][6]).toMatchObject({ day: '2026-10-18', future: false });
  });

  it('5つの行いを東京の日付で数える。自分の草は自分のぶんだけ', () => {
    const { ctx } = setup();
    // 記録 (東京では 10/14 の 0:30)
    ctx.dbAppend('commits', { sha: 'a1', author: ME, timestamp: new Date('2026-10-13T15:30:00Z') });
    ctx.dbAppend('commits', { sha: 'a2', author: 'b@example.com', timestamp: new Date('2026-10-14T01:00:00Z') });
    closed(ctx, '自分の', { assignee: ME });
    ctx.dbAppend('pulls', { number: 1, author: ME, state: 'merged',
      createdAt: new Date('2026-10-13T01:00:00Z'), mergedAt: new Date('2026-10-14T01:00:00Z') });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'approve', at: new Date('2026-10-14T01:00:00Z'), id: 1 });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'comment', at: new Date('2026-10-14T01:00:00Z'), id: 2 });

    const act = ctx.homeActivity_(ME, NOW);
    // 10/14: 記録2 + 完了1 + 反映1 + 承認1 (コメントは数えない)
    expect(cell(act, '2026-10-14')).toMatchObject({ me: 3, team: 5 });
    // 10/13: 依頼を出した
    expect(cell(act, '2026-10-13')).toMatchObject({ me: 1, team: 1 });
    expect(act.meTotal).toBe(4);
  });

  it('チームでは担当2人の完了を1と数える。自分の依頼への自分の承認は数えない', () => {
    const { ctx } = setup();
    closed(ctx, '2人', { assignee: ME + ', b@example.com' });
    ctx.dbAppend('pulls', { number: 1, author: ME, state: 'open', createdAt: new Date('2026-10-01T01:00:00Z') });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: ME, state: 'approve', at: new Date('2026-10-14T01:00:00Z'), id: 1 });
    const act = ctx.homeActivity_(ME, NOW);
    expect(cell(act, '2026-10-14')).toMatchObject({ me: 1, team: 1 });
  });

  it('取り消した完了・1年より前・読めない日付は数えず、落ちない', () => {
    const { ctx } = setup();
    const n = closed(ctx, '取り消し', { assignee: ME });
    ctx.issueReopen(n);
    closed(ctx, '古い', { assignee: ME, closedAt: new Date('2025-01-01T01:00:00Z') });
    ctx.dbAppend('commits', { sha: 'x', author: ME, timestamp: 'きのう' });
    const act = ctx.homeActivity_(ME, NOW);
    expect(act.meTotal).toBe(0);
  });

  it('アドレスを受ける関数は画面から直に呼べない。API は本人のぶんだけ返す', () => {
    const { ctx } = setup();
    expect(typeof ctx.homeActivity_).toBe('function');
    expect(ctx.homeActivity).toBeUndefined();
    closed(ctx, 'ほかの人', { assignee: 'b@example.com', closedAt: new Date() });
    const act = ctx.apiHomeActivity();
    const today = act.weeks[52].filter((c) => !c.future).pop();
    expect(today.me).toBe(0);
    expect(today.team).toBe(1);
    expect(Object.keys(act).sort()).toEqual(['meTotal', 'weeks']);
  });
});

describe('あなたの番', () => {
  function pr(ctx, number, patch) {
    ctx.dbAppend('pulls', Object.assign({ number, title: '依頼' + number, state: 'open',
      author: 'b@example.com', reviewers: ME, createdAt: new Date('2026-10-10T01:00:00Z') }, patch || {}));
  }

  it('確かめてほしい依頼: 自分が確認者で、判断が無いか古い。判断済み・閉じた依頼は出ない', () => {
    const { ctx } = setup();
    pr(ctx, 1);
    pr(ctx, 2, { staleReviewId: 1 });
    ctx.dbAppend('reviews', { prNumber: 2, reviewer: ME, state: 'approve', at: new Date(), id: 1 }); // 古くなった
    pr(ctx, 3);
    ctx.dbAppend('reviews', { prNumber: 3, reviewer: ME, state: 'approve', at: new Date(), id: 2 }); // 済み
    pr(ctx, 4, { state: 'merged' });
    pr(ctx, 5, { reviewers: 'c@example.com' });
    const t = ctx.homeMyTurn_(ME, NOW);
    expect(t.reviews.items.map((x) => x.number)).toEqual([1, 2]);
    expect(t.reviews.total).toBe(2);
  });

  it('戻ってきた依頼: 自分が出したもので、差し戻しが残っている', () => {
    const { ctx } = setup();
    pr(ctx, 1, { author: ME, reviewers: 'b@example.com' });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'request_changes', at: new Date(), id: 1 });
    pr(ctx, 2, { author: ME, reviewers: 'b@example.com' });
    ctx.dbAppend('reviews', { prNumber: 2, reviewer: 'b@example.com', state: 'request_changes', at: new Date(), id: 2 });
    ctx.dbAppend('reviews', { prNumber: 2, reviewer: 'b@example.com', state: 'approve', at: new Date(), id: 3 });
    expect(ctx.homeMyTurn_(ME, NOW).returned.items.map((x) => x.number)).toEqual([1]);
  });

  it('差し戻したあとで中身が変わった依頼は、差し戻した人の「確かめてほしい」に戻る', () => {
    const { ctx } = setup();
    // 差し戻したまま中身は変わっていない: まだ相手の番
    pr(ctx, 1);
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: ME, state: 'request_changes', at: new Date(), id: 1 });
    // 差し戻したあとで直された (差し戻しの番号が staleReviewId 以下)
    pr(ctx, 2, { staleReviewId: 2 });
    ctx.dbAppend('reviews', { prNumber: 2, reviewer: ME, state: 'request_changes', at: new Date(), id: 2 });
    const t = ctx.homeMyTurn_(ME, NOW);
    expect(t.reviews.items.map((x) => x.number)).toEqual([2]);
    // 書いた人の「戻ってきた」は差し戻しが残る限りそのまま
    pr(ctx, 3, { author: ME, reviewers: 'b@example.com', staleReviewId: 3 });
    ctx.dbAppend('reviews', { prNumber: 3, reviewer: 'b@example.com', state: 'request_changes', at: new Date(), id: 3 });
    expect(ctx.homeMyTurn_(ME, NOW).returned.items.map((x) => x.number)).toEqual([3]);
  });

  it('期限のやること: 自分の担当の未完了で、期限切れか3日以内。期限の早い順。今日は期限切れではない', () => {
    const { ctx } = setup();
    const mk = (title, due, patch) => {
      const n = ctx.issueCreate(title, '', []).number;
      ctx.dbUpdate('issues', 'number', n, Object.assign({ assignee: ME, dueDate: due }, patch || {}));
      return n;
    };
    const late = mk('遅れ', new Date('2026-10-10T15:00:00Z'));   // 東京 10/11
    const today = mk('今日', new Date('2026-10-13T15:00:00Z'));  // 東京 10/14
    const soon = mk('3日後', new Date('2026-10-16T15:00:00Z'));  // 東京 10/17
    mk('4日後', new Date('2026-10-17T15:00:00Z'));
    mk('期限なし', '');
    mk('ほかの人', new Date('2026-10-10T15:00:00Z'), { assignee: 'b@example.com' });
    mk('捨てた', new Date('2026-10-10T15:00:00Z'), { archivedAt: new Date() });
    const done = mk('済み', new Date('2026-10-10T15:00:00Z'));
    ctx.issueClose(done, null);

    const due = ctx.homeMyTurn_(ME, NOW).due;
    expect(due.items.map((x) => x.number)).toEqual([late, today, soon]);
    expect(due.items[0]).toMatchObject({ due: '2026-10-11', overdue: true });
    expect(due.items[1]).toMatchObject({ due: '2026-10-14', overdue: false });
  });

  it('種類ごとに5件まで。総数は別に返す', () => {
    const { ctx } = setup();
    for (let n = 1; n <= 7; n++) pr(ctx, n);
    const t = ctx.homeMyTurn_(ME, NOW);
    expect(t.reviews.items).toHaveLength(5);
    expect(t.reviews.total).toBe(7);
  });
});

describe('最近の動き', () => {
  it('反映・完了・依頼・登録を新しい順に10件。名前もアドレスも入らない', () => {
    const { ctx } = setup();
    for (let k = 0; k < 12; k++) {
      closed(ctx, '完了' + k, { assignee: ME, closedAt: new Date(Date.UTC(2026, 9, 1 + k)) });
    }
    ctx.dbAppend('pulls', { number: 1, title: '反映した', author: ME, state: 'merged',
      createdAt: new Date('2026-10-13T00:00:00Z'), mergedAt: new Date('2026-10-14T00:00:00Z') });
    const recent = ctx.homeRecent_(NOW);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toMatchObject({ kind: 'merged', number: 1, title: '反映した' });
    expect(recent[1]).toMatchObject({ kind: 'pull', number: 1 });
    expect(JSON.stringify(recent)).not.toMatch(/@/);
  });

  it('捨てたやることと、日付の読めない行は出さない', () => {
    const { ctx } = setup();
    closed(ctx, '捨てた', { archivedAt: new Date() });
    closed(ctx, '読めない', { closedAt: 'きのう' });
    expect(ctx.homeRecent_(NOW)).toEqual([]);
  });

  describe('文書の登録', () => {
    function reg(ctx, fake, name) {
      const id = fake._createDoc(name, '<p>x</p>', ctx.repoConfig().mainId);
      ctx.repoRegisterFile(id, name);
      return id;
    }

    it('登録した正式版の文書は file として出る。作業コピーは出ない', () => {
      const { ctx, fake } = setup();
      const id = reg(ctx, fake, '就業規則.doc');
      const wc = fake._createDoc('copy', '<p>x</p>', ctx.repoConfig().mainId);
      ctx.dbAppend('files', { fileId: wc, path: 'branches/改訂/就業規則.doc', type: 'doc',
        registeredAt: new Date('2026-10-13T00:00:00Z'), registeredBy: ME });
      const recent = ctx.homeRecent_(new Date(Date.now() + 60000));
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({ kind: 'file', fileId: id, title: '就業規則.doc', number: 0 });
    });

    it('ゴミ箱に入れた文書は出さない', () => {
      const { ctx, fake } = setup();
      const id = reg(ctx, fake, '就業規則.doc');
      fake.DriveApp.getFileById(id).setTrashed(true);
      expect(ctx.homeRecent_(new Date(Date.now() + 60000))).toEqual([]);
    });
  });
});

describe('日報', () => {
  it('ひな形は3つ。既定は3節', () => {
    const { ctx } = setup();
    expect(ctx.REPORT_TEMPLATES().map((t) => t.key)).toEqual(['three', 'today', 'plain']);
    expect(ctx.REPORT_TEMPLATES()[0].body).toBe('✅今日やったこと\n{今日}\n\n📅明日やること\n{明日}\n\n⛔️困っていること\n{困りごと}');
    expect(ctx.reportKind_(ME)).toBe('three');
  });

  it('選んだ形と自分の形を人ごとに覚える。知らない形と2000字超は断る', () => {
    const { ctx } = setup();
    ctx.reportSetCustom_(ME, '【本日】{今日}');
    ctx.reportSetKind_(ME, 'today');
    expect(ctx.reportKind_(ME)).toBe('today');
    expect(ctx.reportKind_('b@example.com')).toBe('three');
    expect(ctx.reportCustom_(ME)).toBe('【本日】{今日}');
    expect(() => ctx.reportSetKind_(ME, 'weekly')).toThrow(/形/);
    expect(() => ctx.reportSetCustom_(ME, 'あ'.repeat(2001))).toThrow(/2000/);
    ctx.reportSetKind_(ME, 'custom');
    expect(ctx.reportKind_(ME)).toBe('custom');
  });

  it('自分の形を書くと、1回で「自分の形」を選んだことにもなる。空なら選ばない', () => {
    const { ctx } = setup();
    ctx.reportSetKind_(ME, 'today');
    ctx.reportSetCustom_(ME, '');
    expect(ctx.reportKind_(ME)).toBe('today');
    ctx.reportSetCustom_(ME, '【本日】{今日}');
    expect(ctx.reportKind_(ME)).toBe('custom');
    expect(ctx.apiSetReportCustom('{今日}')).toEqual({ custom: '{今日}', kind: 'custom' });
  });

  it('自分の形を選んだまま空にすると、選んだ形も 3節 に戻す (空の自分の形は 3節 で写る)', () => {
    const { ctx } = setup();
    ctx.reportSetCustom_(ME, '【本日】{今日}');
    expect(ctx.reportKind_(ME)).toBe('custom');
    expect(ctx.apiSetReportCustom('')).toEqual({ custom: '', kind: 'three' });
    expect(ctx.reportKind_(ME)).toBe('three');
    // ほかの形を選んでいたら、空にしてもそのまま
    ctx.reportSetKind_(ME, 'today');
    ctx.reportSetCustom_(ME, '');
    expect(ctx.reportKind_(ME)).toBe('today');
  });

  it('明日: 自分の担当の未完了で、期限か開始日が明日以前。困りごと: 自分の未解決の障害物 (スクラムがオンのときだけ)', () => {
    const { ctx } = setup();
    const mk = (title, patch) => {
      const n = ctx.issueCreate(title, '', []).number;
      ctx.dbUpdate('issues', 'number', n, Object.assign({ assignee: ME }, patch));
      return n;
    };
    const a = mk('期限が明日', { dueDate: new Date('2026-10-14T15:00:00Z') });
    const b = mk('明日から', { startDate: new Date('2026-10-14T15:00:00Z') });
    mk('明後日', { dueDate: new Date('2026-10-15T15:00:00Z') });
    mk('日付なし', {});
    ctx.dbAppend('impediments', { number: 1, title: '仕様が決まらない', reportedBy: ME, state: 'open' });
    ctx.dbAppend('impediments', { number: 2, title: '解決済み', reportedBy: ME, state: 'resolved' });

    let parts = ctx.reportParts_(ME, NOW);
    expect(parts.tomorrow.map((x) => x.number)).toEqual([a, b]);
    expect(parts.troubles).toEqual([]);
    expect(parts.date).toBe('10/14 (水)');

    ctx.scrumSetEnabled_(true);
    parts = ctx.reportParts_(ME, NOW);
    expect(parts.troubles.map((x) => x.title)).toEqual(['仕様が決まらない']);
  });

  it('API は本人のぶんだけを読み書きする', () => {
    const { ctx } = setup();
    ctx.apiSetReportCustom('{今日}');
    ctx.apiSetReportKind('plain');
    const out = ctx.apiReportParts();
    expect(out.kind).toBe('plain');
    expect(out.custom).toBe('{今日}');
    expect(out.templates).toHaveLength(3);
    expect(Object.keys(out.parts).sort()).toEqual(['date', 'name', 'today', 'tomorrow', 'troubles']);
  });
});
