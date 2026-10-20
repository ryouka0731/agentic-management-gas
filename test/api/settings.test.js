import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, asUser, OWNER, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 設定・ポイント・手元の道具の置き場 (src/api/Settings.gs)。
 *
 * 切り替えは管理者だけ。キューの様子は人のアドレスを含むので管理者にだけ返す。
 * 週の上位は既定オフ・参加した人だけ・3位まで・アドレスを返さない。
 */

/** 担当にしたやることを今日閉じる (ポイントが付く) */
function closeOne(ctx, who, title = '片づけた') {
  const n = ctx.apiIssueCreate(title, '', [], '', { assignee: who }).number;
  ctx.issueClose(n, null);
  return n;
}

describe('apiSettings', () => {
  it('既定はスクラムもポイントもオフで、持ち主には変えられると伝える', () => {
    const { ctx } = makeEnv({ file: false });
    const out = expectScreenSafe(ctx.apiSettings());
    expect(out).toMatchObject({ scrumEnabled: false, gameEnabled: false, canEdit: true,
      productGoal: '', definitionOfDone: '' });
    expect(out.queue).toEqual({ runner: '', lastRun: '', stale: false });
    expect(out.glossary).toBeTruthy();
  });

  it('管理者 (フォルダを編集できる人) も変えられ、キューの様子が見える', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = asUser(fake, ADMIN, () => ctx.apiSettings());
    expect(out.canEdit).toBe(true);
    expect(out.queue).not.toBeNull();
  });

  it('管理者でない人にはキューの様子 (人のアドレス) を返さない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.PropertiesService.getScriptProperties().setProperty('QUEUE_RUNNER', OWNER);
    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiSettings()));
    expect(out.canEdit).toBe(false);
    expect(out.queue).toBeNull();
    expect(JSON.stringify(out)).not.toContain(OWNER);
  });
});

describe('切り替え (apiSetScrumEnabled / apiSetGameEnabled / apiSetScrumText)', () => {
  it('管理者が切り替えると、切り替えたあとの設定を返す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    expect(asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiSetScrumEnabled(true))).scrumEnabled).toBe(true);
    expect(ctx.apiSetGameEnabled(1).gameEnabled).toBe(true);
    expect(ctx.apiSetScrumEnabled(false).scrumEnabled).toBe(false);
    expect(ctx.apiSetGameEnabled(0).gameEnabled).toBe(false);
  });

  it('管理者でない人は切り替えられず、設定は変わらない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiSetScrumEnabled(true), /このアプリの管理者/);
      expectRefused(() => ctx.apiSetGameEnabled(true), /このアプリの管理者/);
      expectRefused(() => ctx.apiSetScrumText('productGoal', 'x'), /このアプリの管理者/);
    });
    expect(ctx.apiSettings()).toMatchObject({ scrumEnabled: false, gameEnabled: false, productGoal: '' });
  });

  it('目指すところと完了の条件は、オンのときに管理者が書け、空にすると消える', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiSetScrumText('productGoal', 'x'), /オフです/);
    ctx.apiSetScrumEnabled(true);
    expect(expectScreenSafe(ctx.apiSetScrumText('productGoal', '紙を減らす')).productGoal).toBe('紙を減らす');
    expect(ctx.apiSetScrumText('definitionOfDone', '確認済み').definitionOfDone).toBe('確認済み');
    expect(ctx.apiSetScrumText('productGoal', '').productGoal).toBe('');
  });

  it('知らない種類と長すぎる字は断り、前の値を残す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetScrumEnabled(true);
    ctx.apiSetScrumText('productGoal', '前の値');
    expectRefused(() => ctx.apiSetScrumText('vision', 'x'), /知らない種類です/);
    expectRefused(() => ctx.apiSetScrumText('productGoal', 'あ'.repeat(3000)), /長すぎます/);
    expect(ctx.apiSettings().productGoal).toBe('前の値');
  });
});

describe('ポイント (apiGameState / apiGameJoin / apiGameTop / apiGameLevelSeen)', () => {
  it('オフのあいだは何も数えず、参加もできない', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiGameState()).toEqual({ enabled: false });
    expect(ctx.apiGameTop()).toEqual([]);
    expect(ctx.apiGameLevelSeen(3)).toBeNull();
    expectRefused(() => ctx.apiGameJoin(true), /ポイントとレベルはオフです/);
  });

  it('本人のぶんだけを、順位を持たずに返す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetGameEnabled(true);
    closeOne(ctx, OWNER);
    const out = expectScreenSafe(ctx.apiGameState());
    expect(out).toMatchObject({ enabled: true, playing: false });
    expect(out.total).toBeGreaterThan(0);
    expect(out.week).toBeGreaterThan(0);
    expect(out).not.toHaveProperty('rank');
    expect(Array.isArray(out.badges)).toBe(true);
  });

  it('上位は参加した人だけ・3位まで・アドレスを返さない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiSetGameEnabled(true);
    const people = ['p1@example.com', 'p2@example.com', 'p3@example.com', 'p4@example.com', 'shy@example.com'];
    people.forEach((who, i) => {
      for (let k = 0; k <= i; k++) closeOne(ctx, who, who + k);
      if (who !== 'shy@example.com') asUser(fake, who, () => ctx.apiGameJoin(true));
    });

    const top = asUser(fake, 'p4@example.com', () => expectScreenSafe(ctx.apiGameTop()));
    expect(top.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(top.map((r) => r.name)).toEqual(['p4', 'p3', 'p2']);
    expect(top.map((r) => r.me)).toEqual([true, false, false]);
    expect(JSON.stringify(top)).not.toMatch(/@/);
  });

  it('参加をやめると上位から外れる', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetGameEnabled(true);
    closeOne(ctx, OWNER);
    expect(expectScreenSafe(ctx.apiGameJoin(true)).playing).toBe(true);
    expect(ctx.apiGameTop()).toHaveLength(1);
    expect(ctx.apiGameJoin(false).playing).toBe(false);
    expect(ctx.apiGameTop()).toHaveLength(0);
  });

  it('見せたレベルは、届いているレベルより上を覚えず、下げもしない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetGameEnabled(true);
    closeOne(ctx, OWNER);
    const level = ctx.apiGameState().level;
    expect(expectScreenSafe(ctx.apiGameLevelSeen(99))).toEqual({ level });
    expect(ctx.apiGameLevelSeen(0)).toEqual({ level });
    expect(ctx.apiGameLevelSeen('x')).toEqual({ level });
  });

  it('開いている本人が分からなければ参加を断る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiSetGameEnabled(true);
    fake._setUser('');
    expectRefused(() => ctx.apiGameJoin(true), /誰か分かりません/);
  });
});

describe('手元の道具 (apiAgentKit / apiKitStatus)', () => {
  it('一度も落としていない人は古いことにしない', () => {
    const { ctx } = makeEnv({ file: false, kit: true });
    const out = expectScreenSafe(ctx.apiKitStatus());
    expect(out.outdated).toBe(false);
    expect(out.mine).toBe('');
    expect(out.print).toMatch(/^[0-9a-f]{8}$/);
  });

  it('落とすと置き場を返し、その人の道具は最新になる', () => {
    const { ctx, fake } = makeEnv({ file: false, kit: true });
    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiAgentKit()));
    expect(out.name).toMatch(/^softbanto-agent-kit-.+\.zip$/);
    expect(out.version).toBe(ctx.AGENT_KIT_VERSION());
    expect(out.url).toMatch(/^https:\/\/drive\.google\.com\/uc\?export=download&id=/);
    expect(out.queuePath).toMatch(/queue$/);
    expect(out.queueUrl).toMatch(/^https:\/\/drive\.google\.com\/drive\/folders\//);

    const st = asUser(fake, OTHER, () => ctx.apiKitStatus());
    expect(st).toMatchObject({ outdated: false, mine: st.print });
    // ほかの人のぶんは覚えていない
    expect(ctx.apiKitStatus().mine).toBe('');
  });

  it('前の版を持っている人は古いと出る', () => {
    const { ctx, fake } = makeEnv({ file: false, kit: true });
    ctx.kitRemember_(OTHER, '00000000');
    expect(asUser(fake, OTHER, () => ctx.apiKitStatus().outdated)).toBe(true);
  });

  it('二度落としても zip を作り直さない', () => {
    const { ctx } = makeEnv({ file: false, kit: true });
    expect(ctx.apiAgentKit().url).toBe(ctx.apiAgentKit().url);
  });
});
