// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountFullstack, createServer, placeDoc, go, click, byText, type, fillSideForm, submitSideForm,
} from './fullstack.js';

/*
 * サーバが断ったとき。帯や欄に理由が出て、書いたものは消えない (formDraftForCall)。
 * 断りの字はサーバの本物の文で、画面に仕込んだものではない。
 */

const $ = (s) => document.querySelector(s);
const LONG = 30000;

/** 鍵を取れない状態にする (ほかの人が長く持っている)。戻す関数を返す */
function busy(e2e) {
  const real = e2e.ctx.LockService;
  e2e.ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
  return () => { e2e.ctx.LockService = real; };
}

describe('サーバに断られたとき', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('混み合っていてやることを作れなければ、理由を帯で出し、書いたまま開き直す。押し直せば1件だけできる', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    go('issues'); await e2e.settle();

    const free = busy(e2e);
    click($('#issue-create-btn')); await e2e.settle();
    fillSideForm({ title: '就業規則の読み合わせ', body: '金曜の午後に' });
    submitSideForm();
    // 入力欄は返事を待たずに閉じる
    expect($('#side-body form.inline-form')).toBe(null);
    await e2e.settle();

    expect(e2e.snacks.join(' ')).toContain('作れませんでした: 混み合っています');
    expect(e2e.rows('issues')).toHaveLength(0);
    const form = $('#side-body form.inline-form');
    expect(form).not.toBe(null);
    expect(form.querySelector('[name="title"]').value).toBe('就業規則の読み合わせ');
    expect(form.querySelector('[name="body"]').value).toBe('金曜の午後に');

    // 空いてから押し直す
    free();
    submitSideForm(); await e2e.settle();
    expect(e2e.rows('issues').map((i) => i.title)).toEqual(['就業規則の読み合わせ']);
    expect($('#issue-list').textContent).toContain('就業規則の読み合わせ');
  }, LONG);

  it('同じ名前の改訂版は作れない。断りを帯で出し、名前を書いたまま開き直す', async () => {
    const server = createServer();
    const docId = placeDoc(server, '就業規則', '<p>第1条</p>\n');
    server.ctx.repoRegisterFile(docId, '就業規則');
    server.ctx.apiBranchCreate('見直し', docId);

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('docs'); await e2e.settle();
    click($('.doc-open')); await e2e.settle();
    click($('.tab[data-tab="drafts"]')); await e2e.settle();
    click($('#draft-create-btn'));
    fillSideForm({ name: '見直し' }); submitSideForm(); await e2e.settle();

    expect(e2e.snacks.join(' ')).toContain('作れませんでした: 同じ名前の改訂版が既にあります: 見直し');
    expect($('#side-body [name="name"]').value).toBe('見直し');
    expect(e2e.rows('branches').filter((b) => b.name === '見直し')).toHaveLength(1);
  }, LONG);

  it('開いたあとで Docs 側が直されていたら、Markdown の保存を断って上書きしない', async () => {
    const server = createServer();
    const docId = placeDoc(server, '就業規則', '<p>第1条</p>\n');
    server.ctx.repoRegisterFile(docId, '就業規則');
    const draft = server.ctx.apiBranchCreate('見直し', docId);
    const workId = server.ctx.branchWorkingFileId(draft.name, docId);

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('branches'); await e2e.settle();
    click(byText('#branch-list .row-open', '見直し')); await e2e.settle();
    click($('#mode-edit')); await e2e.settle();
    expect($('#editor').disabled).toBe(false);

    // 画面で直しているあいだに、誰かが Docs で直接直した
    server.fake._docs.set(workId, '<p>第1条 (Docs で直した)</p>\n');
    type($('#editor'), '第1条 (画面で直した)\n');
    click($('#edit-save-btn')); await e2e.settle();

    expect(e2e.snacks.join(' ')).toContain('開いたあとで、この文書が直されています');
    expect($('#edit-save-btn').disabled).toBe(false);
    expect(server.fake._docs.get(workId)).toContain('Docs で直した');
    // 書いたものは欄に残っている
    expect($('#editor').value).toBe('第1条 (画面で直した)\n');
  }, LONG);

  it('記録が混み合って断られたら、記録のボタンを押せるように戻す', async () => {
    const server = createServer();
    const docId = placeDoc(server, '就業規則', '<p>第1条</p>\n');
    server.ctx.repoRegisterFile(docId, '就業規則');
    const draft = server.ctx.apiBranchCreate('見直し', docId);
    const workId = server.ctx.branchWorkingFileId(draft.name, docId);
    server.fake._docs.set(workId, '<p>第1条 (改訂)</p>\n');

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('branches'); await e2e.settle();
    click(byText('#branch-list .row-open', '見直し')); await e2e.settle();
    expect($('#commit-btn').hidden).toBe(false);

    const free = busy(e2e);
    click($('#commit-btn'));
    fillSideForm({ message: '第1条を改訂' }); submitSideForm(); await e2e.settle();
    free();

    expect(e2e.snacks.join(' ')).toContain('記録できませんでした: 混み合っています');
    expect($('#commit-btn').disabled).toBe(false);
    // 書いた説明は控えから開き直される
    expect($('#side-body [name="message"]').value).toBe('第1条を改訂');
    submitSideForm(); await e2e.settle();
    expect(e2e.snacks).toContain('変更を記録しました閉じる');
    expect(e2e.rows('commits').filter((c) => c.message === '第1条を改訂')).toHaveLength(1);
  }, LONG);
});
