// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';
import { mount } from './mount.js';

/*
 * 仕事のスタンス診断 (js-style)。自分まわりから開き、20問に答えると型が出る。
 * 返事はサーバの定義 (src/core/WorkStyle.js) から本物の api で作る (画面に写しを持たせない)。
 */

const $ = (s) => document.querySelector(s);
const plain = (v) => JSON.parse(JSON.stringify(v));

/** 本物のサーバ。返事の形を写さずに済ませる */
function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return ctx;
}

/** 診断の口をサーバにつなぐ。呼ばれた答えも控える */
function wired(over) {
  const srv = server();
  const saved = [];
  return {
    srv,
    saved,
    app: mount(Object.assign({
      apiWorkStyle: () => plain(srv.apiWorkStyle()),
      apiWorkStyleSave: (answers) => { saved.push(answers); return plain(srv.apiWorkStyleSave(answers)); },
      apiWorkStyleForget: () => plain(srv.apiWorkStyleForget()),
    }, over || {})),
  };
}

function openStyle() {
  $('#me-btn').click();
  $('#me-style').click();
  return $('#side-body');
}

/** どの問いも、そう思うほど左に寄る問いは 5、右に寄る問いは 1 (= 全部の軸で左の極) */
function answerAll(srv, pick) {
  const qs = srv.STYLE_QUESTIONS();
  qs.forEach((q) => {
    const v = pick ? pick(q) : 3;
    const input = document.querySelector('input[name="style-' + q.id + '"][value="' + v + '"]');
    input.checked = true;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

describe('仕事のスタンス診断', () => {
  let hadExec;
  beforeEach(() => {
    window.localStorage.clear();
    hadExec = Object.prototype.hasOwnProperty.call(document, 'execCommand');
  });
  afterEach(() => {
    if (!hadExec) delete document.execCommand;
  });

  it('自分まわりから開くと、断り書きと20問が出て、全部答えるまで結果を見られない', () => {
    const { srv } = wired();
    const body = openStyle();
    expect($('#side-title').textContent).toBe('仕事のスタンス診断');
    expect(body.textContent).toContain('遊びの診断です');
    expect(body.textContent).toContain('人の評価や配置には使いません');
    expect(body.textContent).toContain('医学的');
    expect(body.querySelectorAll('.style-q').length).toBe(20);
    expect(body.querySelectorAll('.style-q')[0].textContent).toContain(srv.STYLE_QUESTIONS()[0].text);
    expect($('#style-submit').disabled).toBe(true);
    expect(body.textContent).toContain('あと 20 問');

    answerAll(srv);
    expect($('#style-submit').disabled).toBe(false);
    expect(body.textContent).toContain('20 / 20 問に答えました');
  });

  it('答えを送ると型が出る。型を決めるのはサーバ', () => {
    const { srv, saved } = wired();
    const body = openStyle();
    // 全部の軸で右の極 (段取りから・声をかけ合う・コツコツ毎日・決まった型を磨く)
    answerAll(srv, (q) => (q.sign > 0 ? 1 : 5));
    $('#style-submit').click();
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0])).toHaveLength(20);
    expect(body.querySelector('.style-name').textContent).toBe('みんなの縁の下');
    expect(body.textContent).toContain('強み');
    expect(body.textContent).toContain('気をつけたいこと');
    expect(body.textContent).toContain('番頭の使い方のおすすめ');
    expect(body.querySelectorAll('.style-axis').length).toBe(4);
    expect(body.textContent).toContain('遊びの診断です');
    expect($('#snackbar').textContent).toContain('「みんなの縁の下」');
  });

  it('前に診断していれば結果から出す。もう一度診断できる', () => {
    const { srv } = wired();
    srv.apiWorkStyleSave(Object.fromEntries(srv.STYLE_QUESTIONS().map((q) => [q.id, 3])));
    const body = openStyle();
    expect(body.querySelector('.style-name').textContent).toBe('一番乗りの開拓者');
    // ちょうど真ん中は左の極で、そう添える
    expect(body.textContent).toContain('すぐ動く (どちらとも言えない)');
    $('#style-again').click();
    expect(body.querySelectorAll('.style-q').length).toBe(20);
    expect($('#style-submit').disabled).toBe(true);
  });

  it('共有用の札を写す。型の名前と強みが入り、点数は入らない', () => {
    const { srv } = wired();
    openStyle();
    answerAll(srv);
    $('#style-submit').click();
    let copied = null;
    document.execCommand = () => {
      copied = document.querySelector('textarea[readonly]').value;
      return true;
    };
    $('#style-copy').click();
    expect(copied).toContain('わたしの仕事のスタンスは「一番乗りの開拓者」');
    expect(copied).toContain('強み:');
    expect(copied).not.toMatch(/\d/);
    expect($('#snackbar').textContent).toContain('札を写しました');

    // 写せなければ、札の字を選んだままにする
    document.execCommand = () => false;
    $('#style-copy').click();
    expect($('#snackbar').textContent).toContain('写せませんでした');
    expect(String(window.getSelection())).toBe($('#style-card-text').textContent);
  });

  it('画像にできない環境では、そう言って字の札を勧める', () => {
    const { srv } = wired();
    openStyle();
    answerAll(srv);
    $('#style-submit').click();
    $('#style-image').click();
    expect($('#snackbar').textContent).toContain('札の字を写してください');
  });

  it('「チームに見せる」は既定でオフ。押すと自分の設定に保存する', () => {
    const { srv, app } = wired();
    openStyle();
    answerAll(srv);
    $('#style-submit').click();
    const toggle = $('#style-share');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args)).toEqual([['style.share', true]]);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('おすすめの設定は開いて印を付けるだけで、切り替えない', () => {
    const { srv, app } = wired();
    const body = openStyle();
    answerAll(srv);
    $('#style-submit').click();
    const row = [...body.querySelectorAll('.style-use')].find((r) => r.textContent.includes('あなたの番'));
    row.querySelector('button').click();
    expect($('#panel-settings').hidden).toBe(false);
    const field = $('#settings [data-pref="home.cards.turn"]');
    expect(field.classList.contains('pref-focus')).toBe(true);
    expect(app.calls.some((c) => c.name === 'apiPrefSet')).toBe(false);
  });

  it('おすすめの画面は、その見え方で開く', () => {
    const { srv } = wired();
    const body = openStyle();
    // 右の極 (段取りから) なら工程表を勧める
    answerAll(srv, (q) => (q.sign > 0 ? 1 : 5));
    $('#style-submit').click();
    const row = [...body.querySelectorAll('.style-use')].find((r) => r.textContent.includes('工程表'));
    row.querySelector('button').click();
    expect($('#panel-issues').hidden).toBe(false);
    expect($('#gantt').hidden).toBe(false);
  });

  it('結果を消すと、問いに戻る', () => {
    const { srv, app } = wired();
    const body = openStyle();
    answerAll(srv);
    $('#style-submit').click();
    $('#style-forget').click();
    body.querySelector('.confirm-strip .btn-primary').click();
    expect(app.calls.some((c) => c.name === 'apiWorkStyleForget')).toBe(true);
    expect(body.querySelectorAll('.style-q').length).toBe(20);
    expect(srv.apiWorkStyle().mine).toBeNull();
  });
});

describe('顔に添える型の名前', () => {
  function issueAvatarLabel() {
    $('.nav-item[data-tab="issues"]').click();
    const el = [...document.querySelectorAll('#panel-issues .avatar')].find((a) =>
      (a.getAttribute('aria-label') || '').includes('me@example.com'));
    return el.getAttribute('aria-label');
  }

  it('チームに見せていない人には添えない', () => {
    mount();
    expect(issueAvatarLabel()).toBe('山田 太郎 (me@example.com)');
  });

  it('見せている人には型の名前だけを添える', () => {
    mount({ apiWorkStyleTeam: { 'me@example.com': { name: '段取りの匠', emoji: '📐' } } });
    expect(issueAvatarLabel()).toBe('山田 太郎 (me@example.com) · 📐 段取りの匠');
  });
});
