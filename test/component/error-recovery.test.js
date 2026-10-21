// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from './mount.js';

/*
 * 断りに「次にすること」を添える (call() の失敗の見せ方)。設計: motivation-review-2.md の D.1。
 *
 * - 帯 (既定・failSnack・failEnable) と器 (failInto) に1行「次にすること: …」を出す。failQuiet は黙ったまま
 * - [もう一度] は混み合い (busy) のときだけ。押すと同じ呼び出しを1回だけやり直す
 * - 時間切れ (timeout) と思いがけない失敗には出さない (途中まで済んでいて、二重に作るため)
 * - 英語の実行時エラーは日本語に言い換え、元の字は console に残す
 */

const $ = (s) => document.querySelector(s);
const snack = () => ($('#snackbar') || { textContent: '' }).textContent;
const againBtn = () => Array.from(document.querySelectorAll('#snackbar button')).find((b) => b.textContent === 'もう一度');

/** やることの一覧で「捨てる」を押す (失敗ハンドラを書いていない呼び出し = 既定の帯) */
function archiveFirst() {
  document.querySelector('#issue-list .row-item .btn-danger').click();
  document.querySelector('#panel-issues .confirm-strip .btn-primary').click();
}

function openIssues(over) {
  const app = mount(over);
  document.querySelector('[data-tab="issues"]').click();
  return app;
}

const KINDS = [
  ['busy', '混み合っています。少し待ってからもう一度お試しください', /少し待ってから、もう一度押して/],
  ['timeout', 'Exceeded maximum execution time', /一覧を開き直して確かめて/],
  ['forbidden', 'この操作は、このアプリの管理者 (持ち主と、入れ物のフォルダを編集できる人) だけが行えます', /頼んでください/],
  ['gone', 'やることが見つかりません: #1', /ゴミ箱/],
  ['stale', '開いたあとで、この文書が直されています。いまの中身を読み込み直してから直してください', /開き直して/],
  ['invalid', '題名を入れてください', /入れ直す/],
  ['unknown', 'TypeError: x is not a function', /要望・不具合/],
];

describe('断りの型ごとに、次にすることを出す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it.each(KINDS)('%s', (kind, message, next) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openIssues({ apiIssueArchive: new Error(message) });
    archiveFirst();
    const line = $('#snackbar .snackbar-next');
    expect(line).not.toBe(null);
    expect(line.textContent).toMatch(/^次にすること: /);
    expect(line.textContent).toMatch(next);
    // [もう一度] は混み合いのときだけ
    expect(!!againBtn()).toBe(kind === 'busy');
    if (/^[\x00-\x7f]+$/.test(message)) {
      // 英語はそのまま出さず、元の字は console に残す
      expect(snack()).not.toContain(message);
      expect(warn.mock.calls.some((c) => String(c[0]).includes(message))).toBe(true);
    } else {
      expect(snack()).toContain(message);
    }
    warn.mockRestore();
  });

  it('時間切れは日本語で言い、押し直しを勧めない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    openIssues({ apiIssueArchive: new Error('Exceeded maximum execution time') });
    archiveFirst();
    expect(snack()).toContain('時間がかかりすぎて、途中で止まりました');
    expect(againBtn()).toBe(undefined);
    vi.restoreAllMocks();
  });

  it('時間切れは使われ方の場所 error:timeout として数える (毎日の成果の数に入る)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = openIssues({ apiIssueArchive: new Error('Exceeded maximum execution time') });
    archiveFirst();
    document.querySelector('[data-tab="usage"]').click();
    const sent = app.calls.filter((c) => c.name === 'apiUsageRecord').flatMap((c) => c.args[0]);
    expect(sent.some((r) => r.target === 'error:timeout' && r.kind === 'action')).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('[もう一度] (混み合いのときだけ)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const busy = () => new Error('混み合っています。少し待ってからもう一度お試しください');

  it('押すと同じ呼び出しを1回やり直し、通ればふつうに済む', () => {
    let n = 0;
    const app = openIssues({ apiIssueArchive: () => (++n === 1 ? busy() : { ok: true }) });
    archiveFirst();
    const first = app.calls.filter((c) => c.name === 'apiIssueArchive');
    expect(first).toHaveLength(1);
    againBtn().click();
    const all = app.calls.filter((c) => c.name === 'apiIssueArchive');
    expect(all).toHaveLength(2);
    expect(all[1].args).toEqual(all[0].args);
    expect(snack()).not.toContain('混み合っています');
  });

  it('やり直しもまた混み合ったら、もう [もう一度] は出さない (押し直しは1回まで)', () => {
    const app = openIssues({ apiIssueArchive: busy() });
    archiveFirst();
    againBtn().click();
    expect(app.calls.filter((c) => c.name === 'apiIssueArchive')).toHaveLength(2);
    expect(snack()).toContain('混み合っています');
    expect(againBtn()).toBe(undefined);
  });

  it('押せなくしたボタン (failEnable) は、やり直すあいだも押せなくし、失敗したら戻す', () => {
    let n = 0;
    let disabledDuring = null;
    const app = mount({
      apiCommit: () => {
        n++;
        if (n === 1) return busy();
        disabledDuring = document.getElementById('commit-btn').disabled;
        return busy();
      },
    });
    const commit = document.getElementById('commit-btn');
    commit.click();
    document.querySelector('#side-body form input').value = '第3条を改訂';
    document.querySelector('#side-body form .btn-primary').click();
    expect(commit.disabled).toBe(false);
    expect(snack()).toContain('記録できませんでした');
    againBtn().click();
    expect(app.calls.filter((c) => c.name === 'apiCommit')).toHaveLength(2);
    expect(disabledDuring).toBe(true);
    expect(commit.disabled).toBe(false);
  });

  it('器に出す断り (failInto) にも [もう一度] を置き、押すと一覧を取り直す', () => {
    let n = 0;
    const app = mount();
    // 起動のときにも一覧を取りに行くので、やることを開く直前から数える
    app.respond('apiIssueList', () => (++n === 1 ? busy() : []));
    document.querySelector('[data-tab="issues"]').click();
    expect($('#issue-list .fail-next').textContent).toMatch(/少し待ってから/);
    const btn = $('#issue-list .fail-again');
    expect(btn.textContent).toBe('もう一度');
    const before = app.calls.filter((c) => c.name === 'apiIssueList').length;
    btn.click();
    expect(app.calls.filter((c) => c.name === 'apiIssueList').length).toBe(before + 1);
    expect($('#issue-list .fail-text')).toBe(null);
  });

  it('時間切れの器には [もう一度] を置かない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    openIssues({ apiIssueList: new Error('Exceeded maximum execution time') });
    expect($('#issue-list .fail-text').textContent).toBe('エラー: 時間がかかりすぎて、途中で止まりました');
    expect($('#issue-list .fail-again')).toBe(null);
    vi.restoreAllMocks();
  });
});
