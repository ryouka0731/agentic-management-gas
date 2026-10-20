// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountFullstack, createServer, placeDoc, go, click, byText, type, fillSideForm, submitSideForm,
} from './fullstack.js';

/*
 * 確認依頼のまわりで人がすること (話す・頼む相手を決める・取り下げる・手元に頼む) と、
 * 文書のまわり (まとめて記録・正式版を直接直した分の退避・やることとの結び付き・版を捨てる)。
 * どれも本物のサーバが返したもので描かれる。
 */

const $ = (s) => document.querySelector(s);
const REVIEWER = 'reviewer@example.com';
const LONG = 30000;

/** 登録した文書と、直して記録した改訂版と、その確認依頼 #1 を用意する */
function prepared() {
  const server = createServer();
  const { ctx, fake } = server;
  const docId = placeDoc(server, '就業規則', '<p>第1条 目的</p>\n<p>第2条 勤務時間</p>\n');
  ctx.repoRegisterFile(docId, '就業規則');
  ctx.apiBranchCreate('見直し', docId);
  const workId = ctx.branchWorkingFileId('見直し', docId);
  fake._docs.set(workId, '<p>第1条 目的</p>\n<p>第2条 勤務時間 (改訂)</p>\n');
  ctx.apiCommit(workId, '第2条を改訂', null);
  ctx.apiPrCreate('第2条の改訂', '始業を9時にします', '見直し', docId);
  return { server, ctx, fake, docId, workId };
}

function prTab(label) {
  click(byText('#pr-detail .pr-tab', label));
}

describe('確認依頼で話す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('頼む相手を決める → 相手がコメント → 自分のコメントを直す・消す', async () => {
    const { server } = prepared();
    let e2e = mountFullstack({ server });
    await e2e.settle();
    go('pulls'); await e2e.settle();
    expect($('#pr-detail').textContent).toContain('始業を9時にします');
    expect($('#pr-detail').textContent).toContain('まだ誰にも頼んでいません');

    // 確認してもらう人を決める
    click($('#pr-detail .reviewer-row .icon-btn'));
    fillSideForm({ people: REVIEWER }); submitSideForm(); await e2e.settle();
    expect(String(e2e.rows('pulls')[0].reviewers)).toBe(REVIEWER);
    expect($('#pr-detail .reviewer-row').textContent).toContain('reviewer');
    // 頼まれた人に知らせが届く
    expect(server.fake._sentMails().some((m) => m.to === REVIEWER)).toBe(true);

    // 頼まれた人がコメントする
    e2e = e2e.as(REVIEWER); await e2e.settle();
    go('pulls'); await e2e.settle();
    type($('#pr-detail .comment-form textarea'), '9時は早くないですか');
    click(byText('#pr-detail .comment-form .btn', '書き込む')); await e2e.settle();
    expect($('#pr-detail').textContent).toContain('9時は早くないですか');

    // 自分のコメントだけ直せる
    const mine = [...document.querySelectorAll('#pr-detail .comment')]
      .find((c) => c.textContent.indexOf('9時は早くないですか') > -1);
    click(mine.querySelector('.comment-tools .icon-btn'));
    expect($('#side-body textarea').value).toBe('9時は早くないですか');
    fillSideForm({ body: '9時半ではどうですか' }); submitSideForm(); await e2e.settle();
    expect(e2e.snacks).toContain('コメントを直しました閉じる');
    expect($('#pr-detail').textContent).toContain('9時半ではどうですか');
    expect($('#pr-detail').textContent).toContain('直しました');

    // 消す (確かめてから)
    const again = [...document.querySelectorAll('#pr-detail .comment')]
      .find((c) => c.textContent.indexOf('9時半ではどうですか') > -1);
    click(again.querySelector('.comment-tools .btn-danger'));
    click(byText('.confirm-strip .btn', '消す')); await e2e.settle();
    expect($('#pr-detail').textContent).not.toContain('9時半ではどうですか');
    expect(e2e.rows('reviews').filter((r) => r.state === 'comment')).toHaveLength(0);
    expect(e2e.failures).toEqual([]);
  }, LONG);

  it('変更の記録と差分を見て、手元に頼みごとを置き、最後に取り下げる', async () => {
    const { server } = prepared();
    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('pulls'); await e2e.settle();

    prTab('変更の記録'); await e2e.settle();
    expect($('#pr-detail').textContent).toContain('第2条を改訂');

    prTab('差分'); await e2e.settle();
    expect($('#pr-detail').textContent).toContain('第2条 勤務時間 (改訂)');

    prTab('手元への頼みごと'); await e2e.settle();
    click(byText('#pr-detail .btn', '手元に頼む')); await e2e.settle();
    const verbs = [...document.querySelectorAll('#side-body select[name="verb"] option')].map((o) => o.value);
    // 取り込みは承認したときに置かれるので、手では頼ませない
    expect(verbs).not.toContain('merge');
    fillSideForm({ verb: 'diff', note: '差分をください' }); submitSideForm(); await e2e.settle();
    expect(e2e.snacks).toContain('頼みごとを置きました閉じる');
    const out = e2e.rows('outbox');
    expect(out.map((o) => [o.verb, Number(o.prNumber), o.state])).toEqual([['diff', 1, 'open']]);
    expect($('#pr-detail').textContent).toContain('待っています');
    expect($('#pr-detail').textContent).not.toContain('送りました');

    // 出した本人は取り下げられる。改訂版は残る
    click(byText('#pr-detail .btn', '取り下げる'));
    click(byText('.confirm-strip .btn', '取り下げる')); await e2e.settle();
    expect(e2e.snacks).toContain('#1 を取り下げました閉じる');
    expect(e2e.rows('pulls')[0].state).toBe('closed');
    expect(e2e.rows('branches').map((b) => b.name)).toContain('見直し');
    expect($('#pr-list').textContent).toContain('取り下げ');
    expect(e2e.failures).toEqual([]);
  }, LONG);
});

describe('文書のまわり', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('改訂版で直したまま記録していないものを、まとめて記録する', async () => {
    const server = createServer();
    const { ctx, fake } = server;
    ['就業規則', '賃金規程'].forEach((name) => {
      const id = placeDoc(server, name, '<p>第1条</p>\n');
      ctx.repoRegisterFile(id, name);
      ctx.apiBranchCreate(name + 'の見直し', id);
      fake._docs.set(ctx.branchWorkingFileId(name + 'の見直し', id), '<p>第1条 (改訂)</p>\n');
    });

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('branches'); await e2e.settle();
    click($('#bulk-commit-btn')); await e2e.settle();
    expect([...document.querySelectorAll('#side-body .bulk-row')].map((r) => r.textContent).sort())
      .toEqual(['branches/就業規則の見直し/就業規則', 'branches/賃金規程の見直し/賃金規程']);
    fillSideForm({ message: '第1条をそろえる' }); submitSideForm(); await e2e.settle();

    expect(e2e.snacks).toContain('2件記録しました閉じる');
    expect(e2e.rows('commits').filter((c) => c.message === '第1条をそろえる')).toHaveLength(2);

    // もう一度押すと、残っていないことを言う
    click($('#bulk-commit-btn')); await e2e.settle();
    expect(e2e.snacks).toContain('記録していない変更はありません閉じる');
  }, LONG);

  it('正式版を Docs で直接直してしまったら、退避して記録に残す', async () => {
    const server = createServer();
    const { ctx, fake } = server;
    const docId = placeDoc(server, '就業規則', '<p>第1条</p>\n');
    ctx.repoRegisterFile(docId, '就業規則');
    // 登録しただけで記録の無い正式版を、Docs で直接直してしまった
    fake._docs.set(docId, '<p>第1条 (直接直した)</p>\n');

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('docs'); await e2e.settle();
    click($('.doc-open')); await e2e.settle();
    expect($('#commit-btn').hidden).toBe(true);
    expect($('#stash-btn').hidden).toBe(false);

    click($('#stash-btn'));
    click(byText('.confirm-strip .btn', '退避する')); await e2e.settle();
    expect(e2e.snacks).toContain('直接編集を退避しました閉じる');
    expect($('#stash-btn').hidden).toBe(true);
    expect(e2e.failures).toEqual([]);
  }, LONG);

  it('文書に結び付いたやることが本文の上に出る。版を捨てると一覧から消える', async () => {
    const server = createServer();
    const { ctx } = server;
    const docId = placeDoc(server, '就業規則', '<p>第1条</p>\n');
    ctx.repoRegisterFile(docId, '就業規則');
    ctx.apiIssueCreate('第1条を直す', '', [docId]);
    ctx.apiBranchCreate('捨てる版', docId);

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('docs'); await e2e.settle();
    click($('.doc-open')); await e2e.settle();
    expect($('#linked-issues').hidden).toBe(false);
    expect($('#linked-issues').textContent).toContain('やること #1 第1条を直す');

    go('branches'); await e2e.settle();
    const row = byText('#branch-list .row-item', '捨てる版');
    click(row.querySelector('.btn-danger'));
    click(byText('.confirm-strip .btn', '捨てる')); await e2e.settle();
    expect($('#branch-list').textContent).not.toContain('捨てる版');
    expect(e2e.rows('branches').filter((b) => b.name === '捨てる版' && b.state === 'open')).toHaveLength(0);
    expect(e2e.failures).toEqual([]);
  }, LONG);

  it('改訂版に別の文書を足すと、確認依頼には2件とも入る', async () => {
    const server = createServer();
    const { ctx } = server;
    const a = placeDoc(server, '就業規則', '<p>第1条</p>\n');
    const b = placeDoc(server, '賃金規程', '<p>第1条</p>\n');
    ctx.repoRegisterFile(a, '就業規則');
    ctx.repoRegisterFile(b, '賃金規程');
    ctx.apiBranchCreate('一緒に直す', a);

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('branches'); await e2e.settle();
    const row = () => byText('#branch-list .row-item', '一緒に直す');
    click(byText('.btn', '文書を足す', row())); await e2e.settle();
    fillSideForm({ fileId: b }); submitSideForm(); await e2e.settle();
    expect(e2e.rows('files').map((f) => f.path)).toContain('branches/一緒に直す/賃金規程');

    click(byText('.btn', '確認を依頼する', row()));
    expect($('#side-body').textContent).toContain('2件の文書が入ります');
    fillSideForm({ title: '2つ一緒に' }); submitSideForm(); await e2e.settle();
    expect(String(e2e.rows('pulls')[0].targetFiles).split(',').sort()).toEqual([a, b].sort());
    expect(e2e.failures).toEqual([]);
  }, LONG);
});

