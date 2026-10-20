// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullstack, createServer, placeDoc, go, click } from './fullstack.js';

/*
 * どの画面を開いても、本物のサーバの返事で落ちないか。
 *
 * 画面の部品のテストは仕込んだ返事を読むので、サーバが返す形とずれても通る。
 * ここでは中身のある台帳で全部の行き先を開き、サーバの断り・画面側のエラー・
 * 「サーバに無い関数」が1つも出ないことを見る。
 */

const $ = (s) => document.querySelector(s);
const LONG = 60000;

function seeded() {
  const server = createServer();
  const { ctx, fake } = server;
  const docId = placeDoc(server, '就業規則', '<p>第1条</p>\n');
  ctx.repoRegisterFile(docId, '就業規則');
  ctx.apiBranchCreate('見直し', docId);
  const work = ctx.branchWorkingFileId('見直し', docId);
  fake._docs.set(work, '<p>第1条 (改訂)</p>\n');
  ctx.apiCommit(work, '第1条を改訂', null);
  ctx.apiPrCreate('第1条の改訂', '', '見直し', docId);
  ctx.apiIssueCreate('第1条を直す', '本文', [docId], '会議', { priority: 'high', dueDate: '2026-10-30' });
  ctx.apiIssueComment(1, '確認します');
  ctx.apiInquiryCreate('bug', '棒が伸びない', '画面: issues', []);
  return { server, docId };
}

describe('全部の行き先を、本物の返事で開く', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('持ち主が、期間で進めるをオンにして全部の画面を回る', async () => {
    const { server } = seeded();
    const e2e = mountFullstack({ server });
    await e2e.settle();

    go('settings'); await e2e.settle();
    click($('#scrum-toggle')); await e2e.settle();

    const tabs = ['home', 'docs', 'issues', 'branches', 'pulls', 'sprint', 'impediments',
      'help', 'usage', 'report', 'settings'];
    for (const tab of tabs) {
      go(tab); await e2e.settle();
      expect($('#panel-' + tab).hidden).toBe(false);
    }

    go('issues'); await e2e.settle();
    for (const view of ['board', 'gantt', 'tally', 'trash', 'list']) {
      click($('#view-' + view)); await e2e.settle();
    }

    go('docs'); await e2e.settle();
    click($('.doc-open')); await e2e.settle();
    for (const t of ['history', 'drafts', 'content']) {
      click($('.tab[data-tab="' + t + '"]')); await e2e.settle();
    }

    click($('#me-btn')); await e2e.settle();
    click($('#bell-btn')); await e2e.settle();

    expect(e2e.failures).toEqual([]);
    expect($('#fatal-error')).toBe(null);
  }, LONG);
});
