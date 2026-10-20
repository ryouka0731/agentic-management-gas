// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountFullstack, createServer, placeDoc, OWNER,
  go, click, byText, type, fillSideForm, submitSideForm,
} from './fullstack.js';

/*
 * 総務の人が文書を登録してから、確認を経て正式版に反映するまで。
 * 押すのは画面だけ。確かめるのは画面に出た字と、台帳・文書の中身。
 */

const $ = (s) => document.querySelector(s);
const REVIEWER = 'reviewer@example.com';
const LONG = 30000;

/** 文書を画面から登録して開く */
async function registerAndOpen(e2e) {
  go('docs'); await e2e.settle();
  click($('#doc-add-btn')); await e2e.settle();
  click(byText('#side-body .btn', '登録する')); await e2e.settle();
  click($('.doc-open')); await e2e.settle();
}

/** 開いている文書の改訂版を作り、その版を開いて第2条を直して記録する */
async function draftAndCommit(e2e, name, from, to) {
  click($('.tab[data-tab="drafts"]')); await e2e.settle();
  click($('#draft-create-btn'));
  fillSideForm({ name }); submitSideForm(); await e2e.settle();

  click(byText('#draft-list .row-open', name)); await e2e.settle();
  click($('#mode-edit')); await e2e.settle();
  type($('#editor'), $('#editor').value.replace(from, to));
  click($('#edit-save-btn')); await e2e.settle();

  click($('#commit-btn'));
  fillSideForm({ message: name + 'を記録' }); submitSideForm(); await e2e.settle();
}

/** 改訂中の版から確認を依頼する */
async function requestReview(e2e, branch, title, body) {
  go('branches'); await e2e.settle();
  const row = byText('#branch-list .row-item, #branch-list > div', branch);
  click(byText('.btn', '確認を依頼する', row));
  fillSideForm(body ? { title, body } : { title }); submitSideForm(); await e2e.settle();
}

describe('文書を登録して、確認を経て正式版に反映する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('登録 → 改訂版 → 記録 → 確認依頼 → 別の人が承認 → 反映 → 履歴に残る', async () => {
    const server = createServer();
    const docId = placeDoc(server, '就業規則', '<p>第1条 目的</p>\n<p>第2条 勤務時間</p>\n');
    let e2e = mountFullstack({ server });
    await e2e.settle();

    // 1. 入れ物にある文書を画面から登録する (id を調べさせない)
    await registerAndOpen(e2e);
    expect(e2e.snacks).toContain('1件を登録しました閉じる');
    expect(e2e.rows('files').map((f) => f.path)).toEqual(['就業規則']);
    expect($('#doc-title').textContent).toBe('就業規則');

    // 2. 正式版は直接なおせない
    click($('#mode-edit')); await e2e.settle();
    expect($('#editor').disabled).toBe(true);
    expect($('#mode-hint').textContent).toContain('直接なおせません');
    click($('#mode-view'));

    // 3. 改訂版を作って直し、記録する
    await draftAndCommit(e2e, '第2条の見直し', '第2条 勤務時間', '第2条 勤務時間 (改訂)');
    expect(e2e.snacks).toContain('改訂版「第2条の見直し」を作りました閉じる');
    expect(e2e.snacks).toContain('変更を記録しました閉じる');
    expect(e2e.rows('branches').map((b) => b.name)).toContain('第2条の見直し');
    // 正式版の文書はまだ変わっていない
    expect(server.fake._docs.get(docId)).not.toContain('(改訂)');

    // 4. 確認を依頼する。依頼すると確認依頼の画面に移る
    await requestReview(e2e, '第2条の見直し', '第2条の改訂');
    expect(e2e.snacks).toContain('確認を依頼しました閉じる');
    expect($('#pr-list').textContent).toContain('#1 第2条の改訂');
    expect($('#pr-detail').textContent).toContain('承認 0件');
    // 出した本人は承認できず、承認が無いうちは反映できない
    expect(byText('#pr-detail .btn', '承認する').disabled).toBe(true);
    expect(byText('#pr-detail .btn', '正式版に反映する').disabled).toBe(true);
    // 本文に補足を書かなければ「補足なし」と出る。サーバが末尾に足す印は人に見せない
    expect($('#pr-detail').textContent).toContain('(補足なし)');
    expect($('#pr-detail').textContent).not.toContain('[target-file:');

    // 5. 別の人が開いて承認する
    e2e = e2e.as(REVIEWER);
    await e2e.settle();
    go('pulls'); await e2e.settle();
    click(byText('#pr-detail .btn', '承認する')); await e2e.settle();
    expect($('#pr-detail').textContent).toContain('承認 1件');
    expect(e2e.rows('reviews').map((r) => [r.reviewer, r.state])).toEqual([[REVIEWER, 'approve']]);

    // 6. 出した人が反映する。確かめてから書き換える
    e2e = e2e.as(OWNER);
    await e2e.settle();
    go('pulls'); await e2e.settle();
    click(byText('#pr-detail .btn', '正式版に反映する'));
    expect(server.fake._docs.get(docId)).not.toContain('(改訂)');
    click(byText('.confirm-strip .btn', '反映する')); await e2e.settle();

    expect(server.fake._docs.get(docId)).toContain('第2条 勤務時間 (改訂)');
    expect(e2e.rows('pulls')[0].state).toBe('merged');
    expect($('#pr-list').textContent).toContain('反映済み');
    expect(e2e.failures).toEqual([]);

    // 7. 正式版の履歴に、反映したことが人の言葉で残っている
    go('docs'); await e2e.settle();
    click($('.doc-open')); await e2e.settle();
    click($('.tab[data-tab="history"]')); await e2e.settle();
    const history = $('#panel-history').textContent;
    expect(history).toMatch(/反映/);
    expect(history).not.toMatch(/マージ|PR #/);
  }, LONG);

  it('やることから改訂版を作り、closes で反映するとカードが「完了」へ動く', async () => {
    const server = createServer();
    placeDoc(server, '賃金規程', '<p>第1条 通勤手当</p>\n');
    let e2e = mountFullstack({ server });
    await e2e.settle();
    await registerAndOpen(e2e);

    // 文書を開いたままやることを作ると、その文書の作業になる
    go('issues'); await e2e.settle();
    click($('#issue-create-btn'));
    fillSideForm({ title: '通勤手当の見直し' }); submitSideForm(); await e2e.settle();
    expect(e2e.rows('issues').map((i) => i.title)).toEqual(['通勤手当の見直し']);

    // やることから改訂版を作る
    click(byText('#issue-list .btn', 'この作業の改訂版を作る')); await e2e.settle();
    const draft = e2e.rows('branches').filter((b) => b.name !== 'main')[0];
    expect(draft).toBeTruthy();
    const card = () => {
      const board = e2e.ctx.apiProjectBoard();
      return Object.keys(board).filter((c) => board[c].some((x) => Number(x.issueNumber) === 1))[0];
    };
    expect(card()).toBe('In Progress');

    // 作業コピーを直して記録し、closes #1 を書いて依頼する
    go('docs'); await e2e.settle();
    click($('.doc-open')); await e2e.settle();
    click($('.tab[data-tab="drafts"]')); await e2e.settle();
    click(byText('#draft-list .row-open', draft.name)); await e2e.settle();
    click($('#mode-edit')); await e2e.settle();
    type($('#editor'), $('#editor').value.replace('通勤手当', '通勤手当 (月額)'));
    click($('#edit-save-btn')); await e2e.settle();
    click($('#commit-btn'));
    fillSideForm({ message: '月額にする' }); submitSideForm(); await e2e.settle();

    await requestReview(e2e, draft.name, '通勤手当を月額に', 'closes #1');
    expect(card()).toBe('In Review');

    e2e = e2e.as(REVIEWER); await e2e.settle();
    go('pulls'); await e2e.settle();
    click(byText('#pr-detail .btn', '承認する')); await e2e.settle();

    e2e = e2e.as(OWNER); await e2e.settle();
    go('pulls'); await e2e.settle();
    click(byText('#pr-detail .btn', '正式版に反映する'));
    click(byText('.confirm-strip .btn', '反映する')); await e2e.settle();

    // やることが閉じ、ボードの「完了」の列にカードが居る
    expect(e2e.rows('issues')[0].state).toBe('closed');
    expect(card()).toBe('Done');
    go('issues'); await e2e.settle();
    click($('#view-board')); await e2e.settle();
    const done = [...document.querySelectorAll('.board-column')]
      .find((c) => /完了/.test(c.querySelector('h3').textContent));
    expect(done.textContent).toContain('通勤手当の見直し');
    expect(e2e.failures).toEqual([]);
  }, LONG);

  it('同じ条を2つの改訂版で直したら、食い違いを画面で選んで反映できる', async () => {
    const server = createServer();
    const { ctx, fake } = server;
    const docId = placeDoc(server, '就業規則', '<p>第1条 目的</p>\n<p>第2条 勤務時間</p>\n');
    ctx.repoRegisterFile(docId, '就業規則');
    // 2つの改訂版が同じ第2条を別々に直す (ここまではサーバで用意する。画面の道は上で通した)
    ['甲案', '乙案'].forEach((name) => {
      ctx.apiBranchCreate(name, docId);
      const work = ctx.branchWorkingFileId(name, docId);
      fake._docs.set(work, '<p>第1条 目的</p>\n<p>第2条 勤務時間 (' + name + ')</p>\n');
      ctx.apiCommit(work, name + 'で直す', null);
      ctx.apiPrCreate(name, '', name, docId);
    });
    fake._setUser(REVIEWER);
    ctx.apiPrReview(1, 'approve', '');
    ctx.apiPrReview(2, 'approve', '');
    fake._setUser(OWNER);
    ctx.apiPrMerge(1, []);
    expect(fake._docs.get(docId)).toContain('(甲案)');

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('pulls'); await e2e.settle();
    click(byText('#pr-list .row-item', '#2 乙案')); await e2e.settle();

    const detail = $('#pr-detail');
    expect(detail.textContent).toContain('同じ場所が両方で変わっています 1 / 1');
    const block = detail.querySelector('.conflict-block');
    expect(block.textContent).toContain('(甲案)');
    expect(block.textContent).toContain('(乙案)');

    // 改訂版側を採って反映する
    const sel = block.querySelector('select');
    sel.value = 'theirs';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    click(byText('#pr-detail .btn', '正式版に反映する'));
    click(byText('.confirm-strip .btn', '反映する')); await e2e.settle();

    expect(e2e.failures).toEqual([]);
    expect(fake._docs.get(docId)).toContain('第2条 勤務時間 (乙案)');
    expect(fake._docs.get(docId)).not.toContain('(甲案)');
    expect(e2e.rows('pulls').map((p) => p.state)).toEqual(['merged', 'merged']);
  }, LONG);
});
