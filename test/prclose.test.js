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
  'src/core/Outbox.gs',
  'src/core/Archive.js',
  'src/core/Tag.gs',
  'src/core/Staleness.js',
  'src/core/Issue.gs',
  'src/core/Project.gs',
  'src/core/Brand.js',
  'src/core/Notifier.gs',
  'src/core/Plain.js',
  'src/core/Member.gs',
  'src/Main.gs',
];

/*
 * 'closed' という状態は最初から定義されていて、画面にも「取り下げ」という
 * 言葉と、閉じたものには確認の欄を出さない作りが入っていた。
 * そこへ至る道だけが無かった。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);

  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  const mainFileId = fake._createDoc('就業規則', '<p>第1条</p>\n', config.mainId);
  ctx.repoRegisterFile(mainFileId, '就業規則.doc');
  ctx.commitFile(mainFileId, 'main', '初期状態', null);

  ctx.branchCreate('改訂', mainFileId);
  const workFileId = ctx.branchWorkingFileId('改訂', mainFileId);
  fake._docs.set(workFileId, '<p>第1条</p>\n<p>第2条</p>\n');
  ctx.commitFile(workFileId, '改訂', 'ブランチ側の変更', null);

  return { ctx, fake, mainFileId, workFileId };
}

describe('確認依頼を取り下げる', () => {
  it('取り下げると状態が変わる', () => {
    const { ctx, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    expect(ctx.prClose(pr.number).state).toBe('closed');
    expect(ctx.prGet(pr.number).state).toBe('closed');
  });

  it('改訂版は捨てない', () => {
    const { ctx, mainFileId, workFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);
    ctx.prClose(pr.number);

    // 取り下げるのは「いま反映してよいか尋ねること」であって、
    // 直した中身ではない。捨てるかどうかは別に決める
    expect(ctx.dbFindOne('branches', 'name', '改訂').state).toBe('open');
    expect(ctx.dbFindOne('files', 'fileId', workFileId)).not.toBeNull();
    expect(ctx.commitHistory(workFileId, '改訂').length).toBeGreaterThan(0);
  });

  it('正式版は書き換わらない', () => {
    const { ctx, fake, mainFileId } = setup();
    const before = fake._docs.get(mainFileId);
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);
    ctx.prClose(pr.number);

    expect(fake._docs.get(mainFileId)).toBe(before);
  });

  it('また出せる', () => {
    const { ctx, mainFileId } = setup();
    const first = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);
    ctx.prClose(first.number);

    // 取り下げたものが残って邪魔をすると、やり直せない行き止まりになる
    const again = ctx.prCreate('第2条を追加 (再)', '', '改訂', mainFileId);
    expect(again.number).not.toBe(first.number);
    expect(again.state).toBe('open');
  });

  it('カードを確認中から戻す', () => {
    const { ctx, mainFileId } = setup();
    const issue = ctx.issueCreate('第2条を足す', '', [], '');
    ctx.projectMove(issue.number, 'In Progress', 0);

    const pr = ctx.prCreate('第2条を追加', 'closes #' + issue.number,
      '改訂', mainFileId);
    expect(ctx.dbFindOne('project_items', 'issueNumber', issue.number).column)
      .toBe('In Review');

    // 出すときに動かしているので、戻すときも戻す。片方だけだと
    // 誰も見ていない依頼のカードが確認中に居座る
    ctx.prClose(pr.number);
    expect(ctx.dbFindOne('project_items', 'issueNumber', issue.number).column)
      .toBe('In Progress');
  });

  it('紐づくやることは完了にしない', () => {
    const { ctx, mainFileId } = setup();
    const issue = ctx.issueCreate('第2条を足す', '', [], '');
    const pr = ctx.prCreate('第2条を追加', 'closes #' + issue.number,
      '改訂', mainFileId);

    ctx.prClose(pr.number);
    expect(ctx.issueGet(issue.number).state).toBe('open');
  });

  it('反映済みは取り下げられない', () => {
    const { ctx, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    ctx.dbUpdate('pulls', 'number', pr.number, { state: 'merged' });

    // 書き戻しは終わっている。取り消すには戻す記録を別に作るしかない
    expect(() => ctx.prClose(pr.number)).toThrow('既に反映済み');
  });

  it('二度は取り下げられない', () => {
    const { ctx, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);
    ctx.prClose(pr.number);

    expect(() => ctx.prClose(pr.number)).toThrow('既に取り下げられています');
  });

  it('頼まれた側は取り下げられない', () => {
    const { ctx, fake, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    // 確認を頼まれた側が取り下げられると、頼んだ人の知らないうちに消える
    fake._setUser('reviewer@example.com');
    expect(() => ctx.prClose(pr.number))
      .toThrow('出した本人か、このアプリの持ち主だけ');
    expect(ctx.prGet(pr.number).state).toBe('open');
  });

  it('頼まれた側に知らせる', () => {
    const { ctx, fake, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);
    ctx.prSetReviewers(pr.number, ['reviewer@example.com']);

    const before = fake._sentMails().length;
    ctx.prClose(pr.number);

    // 見ようとしていたものが黙って消えると、次に開いたときに
    // 何が起きたのか分からない
    const sent = fake._sentMails().slice(before);
    expect(sent.map((m) => m.to)).toContain('reviewer@example.com');
    expect(sent.map((m) => m.subject).join('\n'))
      .toContain('取り下げられました');

    const notices = ctx.dbReadAll('notifications')
      .filter((n) => String(n.to) === 'reviewer@example.com');
    expect(notices.map((n) => n.title).join('\n')).toContain('取り下げられました');
  });
});

describe('取り下げられるかを誰が決めるか', () => {
  /*
   * 画面で決めると、他人の依頼を自分のものだと名乗って取り下げられる。
   * 画面側のテストは仕込んだ値を読むだけなので、ここでしか守れない。
   */
  function listed(ctx, number) {
    return ctx.apiPrList().filter((p) => p.number === number)[0];
  }

  it('出した本人には出す', () => {
    const { ctx, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    expect(listed(ctx, pr.number).canClose).toBe(true);
  });

  it('頼まれた側には出さない', () => {
    const { ctx, fake, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    fake._setUser('reviewer@example.com');
    expect(listed(ctx, pr.number).canClose).toBe(false);
  });

  it('反映済みと取り下げ済みには出さない', () => {
    const { ctx, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    // 押せるのに失敗する状態を作らない
    ctx.dbUpdate('pulls', 'number', pr.number, { state: 'merged' });
    expect(listed(ctx, pr.number).canClose).toBe(false);

    ctx.dbUpdate('pulls', 'number', pr.number, { state: 'closed' });
    expect(listed(ctx, pr.number).canClose).toBe(false);
  });

  it('持ち主には出す', () => {
    const { ctx, fake, mainFileId } = setup();
    const pr = ctx.prCreate('第2条を追加', '', '改訂', mainFileId);

    // 出した人が居なくなっても、持ち主が畳めなければ永久に残る
    fake._setUser('owner@example.com');
    ctx.repoOwnerEmail = () => 'owner@example.com';

    expect(listed(ctx, pr.number).canClose).toBe(true);
  });
});
