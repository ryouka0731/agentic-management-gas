import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 管理者 = このアプリの持ち主 + 入れ物のフォルダを編集できる人。
 *
 * 以前は持ち主1人だけが設定や他人の依頼の取り下げを行えた。持ち主が休むと
 * 誰も直せなくなる。フォルダを編集できる人は台帳も直接書き換えられるので、
 * 画面の操作でも同じ扱いにする。
 *
 * エディタ専用の関数 (debug* / setupCommandQueue / 自己承認の解禁) は持ち主の
 * まま。GAS エディタで持ち主が動かす前提のもので、広げる理由が無い。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]);
})();

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  const root = fake.DriveApp.getFolderById(ctx.repoConfig().rootId);
  return { ctx, fake, root };
}

describe('誰が管理者か', () => {
  it('持ち主と、入れ物のフォルダを編集できる人は管理者。見るだけの人は違う', () => {
    const { ctx, fake, root } = setup();
    root._addEditor('editor@example.com');

    expect(ctx.repoIsAdmin_('tester@example.com')).toBe(true);
    fake._setUser('editor@example.com');
    expect(ctx.repoIsAdmin_('editor@example.com')).toBe(true);
    fake._setUser('viewer@example.com');
    expect(ctx.repoIsAdmin_('viewer@example.com')).toBe(false);
    expect(ctx.repoIsAdmin_('')).toBe(false);
  });

  it('Drive が読めなくても、投げずに管理者ではないと答える', () => {
    const { ctx, fake } = setup();
    fake._setUser('editor@example.com');
    ctx.repoConfig = () => { throw new Error('初期化されていません'); };
    expect(ctx.repoIsAdmin_('editor@example.com')).toBe(false);
  });
});

describe('編集者もできること', () => {
  function asEditor() {
    const env = setup();
    env.root._addEditor('editor@example.com');
    env.fake._setUser('editor@example.com');
    return env;
  }

  it('スクラムの設定を切り替え、ゴールを書ける。設定画面にも入口が出る', () => {
    const { ctx } = asEditor();
    expect(ctx.apiSettings().canEdit).toBe(true);
    expect(ctx.apiSetScrumEnabled(true).scrumEnabled).toBe(true);
    expect(ctx.apiSetScrumText('productGoal', '紙をなくす').productGoal).toBe('紙をなくす');
  });

  it('上下関係と、他人の表示名を変えられる', () => {
    const { ctx } = asEditor();
    expect(ctx.apiTallyScope().canEdit).toBe(true);
    expect(ctx.apiMemberSet('a@example.com', 'b@example.com', '').email).toBe('a@example.com');
    expect(ctx.apiPeopleSetName('a@example.com', '青木').name).toBe('青木');
  });

  it('見るだけの人は、これまでどおり断る (理由に管理者を挙げる)', () => {
    const { ctx, fake } = setup();
    fake._setUser('viewer@example.com');
    expect(ctx.apiSettings().canEdit).toBe(false);
    expect(() => ctx.apiSetScrumEnabled(true)).toThrow(/管理者/);
    expect(() => ctx.apiMemberSet('a@example.com', '', '')).toThrow(/管理者/);
  });

  it('他人の報告を閉じ、他人の下書きを消し、他人の確認依頼を取り下げられる', () => {
    const { ctx, fake } = asEditor();
    fake._setUser('someone@example.com');
    const report = ctx.inquiryCreate('bug', '本文');
    ctx.templateSave('他人の下書き', '## x');
    fake._setUser('editor@example.com');

    expect(ctx.inquiryClose(report.number).state).toBe('done');
    ctx.templateDelete('他人の下書き');
    expect(ctx.dbFindOne('templates', 'name', '他人の下書き')).toBeNull();
    // 取り下げは、出した本人か管理者かだけで決まる
    expect(() => ctx.prAssertCanClose_({ author: 'someone@example.com' })).not.toThrow();
  });

  it('報告の知らせは、これまでどおり持ち主1人に送る (管理者が増えても何通も届かない)', () => {
    const { ctx, fake } = asEditor();
    fake._setUser('someone@example.com');
    const before = fake._sentMails().length;
    ctx.inquiryCreate('bug', '本文');
    expect(fake._sentMails().slice(before).map((m) => m.to)).toEqual(['tester@example.com']);
  });

  it('エディタ専用の関数は、編集者にも動かさない (持ち主だけのまま)', () => {
    const { ctx } = asEditor();
    expect(() => ctx.debugEnableSelfApprove()).toThrow(/持ち主だけ/);
  });
});
