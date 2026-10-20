// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountFullstack, createServer, OWNER, go, click, byText, type, fillSideForm, submitSideForm,
} from './fullstack.js';

/*
 * 報告 (開発者に伝える) のやりとりと、管理者だけが変えられる設定。
 */

const $ = (s) => document.querySelector(s);
const STAFF = 'staff@example.com';
const LONG = 30000;

describe('報告を出して、返事をもらい、解決にする', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('職員が報告 → 持ち主が返信 → 職員が解決にする', async () => {
    const server = createServer();
    let e2e = mountFullstack({ server, user: STAFF });
    await e2e.settle();

    // 1. 職員が報告する
    go('report'); await e2e.settle();
    expect($('#report-list').textContent).toContain('まだ何も伝えていません');
    click($('#report-btn'));
    fillSideForm({
      kind: 'bug', summary: '工程表の棒が伸びない',
      steps: '棒の右端を掴んで引いた', actual: '幅が変わらない',
    });
    submitSideForm(); await e2e.settle();

    expect(e2e.snacks).toContain('受付 #1 として送りました閉じる');
    const asked = e2e.rows('inquiries');
    expect(asked).toHaveLength(1);
    expect(asked[0].by).toBe(STAFF);
    expect(String(asked[0].context)).toContain('画面: report');
    expect($('#report-list').textContent).toContain('#1 工程表の棒が伸びない');
    // 持ち主にメールで知らせが届く
    expect(e2e.fake._sentMails().some((m) => m.to === OWNER && /報告/.test(m.subject))).toBe(true);

    // 2. 持ち主が開いて返信する
    e2e = e2e.as(OWNER); await e2e.settle();
    go('report'); await e2e.settle();
    expect($('#report-detail').textContent).toContain('棒の右端を掴んで引いた');
    type($('#report-detail .comment-form textarea'), '直しました。もう一度試してください');
    click($('#report-detail .comment-form .btn-primary')); await e2e.settle();
    expect(e2e.rows('inquiry_replies').map((r) => [r.by, r.body]))
      .toEqual([[OWNER, '直しました。もう一度試してください']]);
    expect($('#report-detail').textContent).toContain('直しました。もう一度試してください');

    // 3. 出した本人が解決にする。解決したものは既定 (未解決だけ) では一覧から隠れる
    e2e = e2e.as(STAFF); await e2e.settle();
    go('report'); await e2e.settle();
    click(byText('#report-detail .pr-actions .btn', '解決した')); await e2e.settle();
    expect(e2e.rows('inquiries')[0].state).toBe('done');
    // 返信をもらった職員にも知らせが届いている
    expect(e2e.fake._sentMails().some((m) => m.to === STAFF && /返信/.test(m.subject))).toBe(true);
    expect($('#count-reports').textContent).toBe('0');
    expect($('#report-list').textContent).not.toContain('工程表の棒が伸びない');
    // 「未解決だけ」を外すと、済んだものとして出る
    click($('#report-open-btn')); await e2e.settle();
    expect($('#report-list').textContent).toContain('工程表の棒が伸びない');
    expect(e2e.failures).toEqual([]);
  }, LONG);
});

describe('設定: 期間で進める (スクラム) の切り替え', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('管理者はオンにでき、左に行き先が出る。オフに戻すと消える', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    expect($('#nav-scrum').hidden).toBe(true);

    go('settings'); await e2e.settle();
    const toggle = $('#scrum-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    click(toggle); await e2e.settle();

    expect(e2e.ctx.PropertiesService.getScriptProperties().getProperty('SCRUM_ENABLED')).toBe('true');
    expect($('#nav-scrum').hidden).toBe(false);
    expect($('#scrum-toggle').getAttribute('aria-checked')).toBe('true');
    expect(e2e.snacks.join(' ')).toContain('オンにしました');

    click($('#scrum-toggle')); await e2e.settle();
    expect(e2e.ctx.PropertiesService.getScriptProperties().getProperty('SCRUM_ENABLED')).not.toBe('true');
    expect($('#nav-scrum').hidden).toBe(true);
    expect(e2e.failures).toEqual([]);
  }, LONG);

  it('管理者でない人には切り替えを出さず、サーバも断る', async () => {
    const e2e = mountFullstack({ user: STAFF });
    await e2e.settle();
    go('settings'); await e2e.settle();

    expect($('#scrum-toggle')).toBe(null);
    expect($('#panel-settings').textContent).toContain('切り替えられるのは、このアプリの管理者');

    // 画面を通らずに呼んでも通らない (画面だけで隠していない)
    e2e.fake._setUser(STAFF);
    expect(() => e2e.ctx.apiSetScrumEnabled(true)).toThrow();
    expect(e2e.ctx.PropertiesService.getScriptProperties().getProperty('SCRUM_ENABLED')).not.toBe('true');
  }, LONG);

  it('フォルダを編集できる人は管理者として切り替えられる', async () => {
    const server = createServer();
    server.fake.DriveApp.getFolderById(server.ctx.repoConfig().rootId)._addEditor(STAFF);
    const e2e = mountFullstack({ server, user: STAFF });
    await e2e.settle();
    go('settings'); await e2e.settle();
    click($('#scrum-toggle')); await e2e.settle();
    expect($('#nav-scrum').hidden).toBe(false);
  }, LONG);
});
