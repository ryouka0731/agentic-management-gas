// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullstack, createServer, OWNER, click } from './fullstack.js';

/*
 * 仕事のスタンス診断を、画面 → api → スクリプトプロパティ → 画面 で通す。
 * 職員が診断して型を見る → 既定ではほかの人に見えない → 「チームに見せる」をオンにすると、
 * 持ち主の画面で職員の顔に型の名前 (だけ) が添えられる → 結果を消すと見えなくなる。
 */

const $ = (s) => document.querySelector(s);
const STAFF = 'staff@example.com';
const LONG = 30000;

/** 職員が担当のやることの顔の読み上げ */
async function staffAvatarLabel(e2e) {
  click($('.nav-item[data-tab="issues"]'));
  await e2e.settle();
  const el = [...document.querySelectorAll('#panel-issues .avatar')]
    .find((a) => (a.getAttribute('aria-label') || '').includes(STAFF));
  if (!el) throw new Error('職員の顔がありません');
  return el.getAttribute('aria-label');
}

describe('診断して、選んだときだけチームに型の名前を見せる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('職員が診断 → 見せない → 見せる → 消す', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    const n = server.ctx.apiIssueCreate('届け出の様式を直す', '', []).number;
    server.ctx.apiIssueUpdate(n, { assignee: STAFF });

    // 1. 職員が自分まわりから診断を開き、20問に答える
    let e2e = mountFullstack({ server, user: STAFF });
    await e2e.settle();
    click($('#me-btn'));
    click($('#me-style'));
    await e2e.settle();
    expect($('#side-body').textContent).toContain('遊びの診断です');
    const qs = server.ctx.STYLE_QUESTIONS();
    qs.forEach((q) => {
      // 全部の軸で右の極に寄せる
      const input = document.querySelector('input[name="style-' + q.id + '"][value="' + (q.sign > 0 ? 1 : 5) + '"]');
      input.checked = true;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    click($('#style-submit'));
    await e2e.settle();
    expect($('#side-body .style-name').textContent).toBe('みんなの縁の下');
    // 本人のぶんとしてスクリプトプロパティに残る (台帳には置かない)
    const stored = JSON.parse(server.fake.PropertiesService.getScriptProperties().getProperty('STYLE:' + STAFF));
    expect(stored.code).toBe('plan-team-steady-craft');
    expect(e2e.failures).toEqual([]);

    // 2. 既定では、持ち主の画面に型は出ない
    e2e = e2e.as(OWNER);
    await e2e.settle();
    expect(await staffAvatarLabel(e2e)).not.toContain('みんなの縁の下');
    server.fake._setUser(OWNER);
    expect(server.ctx.apiWorkStyle().mine).toBeNull();

    // 3. 職員が「チームに見せる」をオンにする
    e2e = e2e.as(STAFF);
    await e2e.settle();
    click($('#me-btn'));
    click($('#me-style'));
    await e2e.settle();
    click($('#style-share'));
    await e2e.settle();
    expect($('#style-share').getAttribute('aria-checked')).toBe('true');

    // 4. 持ち主の画面で、職員の顔に型の名前だけが添えられる
    e2e = e2e.as(OWNER);
    await e2e.settle();
    expect(await staffAvatarLabel(e2e)).toContain('· 🌱 みんなの縁の下');
    const team = JSON.parse(JSON.stringify(server.ctx.apiWorkStyleTeam()));
    expect(team).toEqual({ [STAFF]: { name: 'みんなの縁の下', emoji: '🌱' } });

    // 5. 職員が結果を消すと、見えなくなる
    e2e = e2e.as(STAFF);
    await e2e.settle();
    click($('#me-btn'));
    click($('#me-style'));
    await e2e.settle();
    click($('#style-forget'));
    click($('#side-body .confirm-strip .btn-primary'));
    await e2e.settle();
    expect($('#side-body').querySelectorAll('.style-q').length).toBe(qs.length);

    e2e = e2e.as(OWNER);
    await e2e.settle();
    expect(await staffAvatarLabel(e2e)).not.toContain('みんなの縁の下');
    expect(e2e.failures).toEqual([]);
  }, LONG);
});
