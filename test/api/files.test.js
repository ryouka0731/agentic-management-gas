import { describe, it, expect } from 'vitest';
import { makeEnv, withPr, expectScreenSafe, expectRefused, snapshotDb, asUser, OWNER, OTHER } from './setup.js';

/*
 * 画面の API: 文書の登録と、道具全体の様子 (src/api/Files.gs)。
 *
 * 登録も外すのも画面から行う (CLAUDE.md「使う人に GAS を触らせない」)。外すのは
 * 台帳の1行だけなので、持ち主だけに絞っていない。
 */

describe('apiListFiles', () => {
  it('道のり順に {fileId, path, type} を返し、Drive で消された文書は出さない', () => {
    const { ctx, fake, config, fileId } = makeEnv();
    const sheet = ctx.SpreadsheetApp.create('名簿');
    fake.DriveApp.getFileById(sheet.getId()).moveTo(fake.DriveApp.getFolderById(config.mainId));
    ctx.repoRegisterFile(sheet.getId(), 'A名簿.sheet');

    const out = expectScreenSafe(ctx.apiListFiles());
    expect(out.map((f) => f.path)).toEqual(['A名簿.sheet', '就業規則.doc']);
    expect(out[1]).toEqual({ fileId, path: '就業規則.doc', type: 'doc' });

    fake.DriveApp.getFileById(fileId).setTrashed(true);
    expect(ctx.apiListFiles().map((f) => f.path)).toEqual(['A名簿.sheet']);
  });

  it('何も登録していなければ空', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiListFiles()).toEqual([]);
  });
});

describe('apiGetFileHtml', () => {
  it('本文と名前と URL と道のりを返す', () => {
    const { ctx, fileId } = makeEnv();
    const out = expectScreenSafe(ctx.apiGetFileHtml(fileId));
    expect(out).toEqual({
      html: '<p>第1条</p>\n', name: '就業規則', path: '就業規則.doc',
      url: 'https://example.invalid/d/' + fileId,
    });
  });

  it('登録されていない文書は Drive を見に行く前に断る', () => {
    const { ctx, fake, config } = makeEnv();
    const loose = fake._createDoc('未登録', '<p>秘密</p>\n', config.mainId);
    expectRefused(() => ctx.apiGetFileHtml(loose), /管理対象に登録されていません/);
  });
});

describe('apiRegisterFile / apiFoundFiles / apiRegisterFiles', () => {
  it('正式版の入れ物にある、まだ登録していない文書を名前順に挙げる', () => {
    const { ctx, fake, config } = makeEnv();
    fake._createDoc('B規程', '<p>b</p>\n', config.mainId);
    fake._createDoc('A規程', '<p>a</p>\n', config.mainId);
    config.mainId && fake.DriveApp.getFolderById(config.mainId).createFile('メモ.txt', 'x', 'text/plain');

    const out = expectScreenSafe(ctx.apiFoundFiles());
    expect(out.map((f) => f.name)).toEqual(['A規程', 'B規程', 'メモ.txt']);
    expect(out[0]).toMatchObject({ type: 'doc', ok: true, why: '' });
    expect(out[2]).toMatchObject({ type: '', ok: false, why: 'この形のファイルは扱えません' });
  });

  it('まとめて登録し、通ったものと落ちたものを分けて返す', () => {
    const { ctx, fake, config, fileId } = makeEnv();
    const a = fake._createDoc('A規程', '<p>a</p>\n', config.mainId);
    const out = expectScreenSafe(ctx.apiRegisterFiles([a, fileId, 'file-x']));
    expect(out.added).toEqual([{ fileId: a, path: 'A規程' }]);
    expect(out.failed.map((f) => f.fileId)).toEqual([fileId, 'file-x']);
    expect(out.failed[0].error).toMatch(/すでに登録されています/);
    expect(ctx.dbReadAll('files')).toHaveLength(2);
    expect(ctx.apiRegisterFiles()).toEqual({ added: [], failed: [] });
  });

  it('1件ずつの登録は台帳の行を返し、重なり・知らない形・不正な道のりを断る', () => {
    const { ctx, fake, config } = makeEnv();
    const a = fake._createDoc('A規程', '<p>a</p>\n', config.mainId);
    const row = ctx.apiRegisterFile(a, 'A規程.doc');
    expect(row).toMatchObject({ fileId: a, path: 'A規程.doc', type: 'doc' });

    const dup = fake._createDoc('A規程', '<p>a2</p>\n', config.mainId);
    expectRefused(() => ctx.apiRegisterFile(dup, 'A規程.doc'), /同じ名前の文書が既に登録されています/);
    const txt = fake.DriveApp.getFolderById(config.mainId).createFile('メモ.txt', 'x', 'text/plain');
    expectRefused(() => ctx.apiRegisterFile(txt.getId(), 'メモ'), /対応していないファイル種別です/);
    expectRefused(() => ctx.apiRegisterFile(dup, ''), /パスが不正です/);
    expect(ctx.dbReadAll('files')).toHaveLength(2);
  });
});

describe('apiUnregisterFile', () => {
  it('台帳の1行だけを外し、Drive の文書と記録は残す。誰でも外せる', () => {
    const { ctx, fake, config } = makeEnv();
    const a = fake._createDoc('A規程', '<p>a</p>\n', config.mainId);
    ctx.repoRegisterFile(a, 'A規程.doc');
    ctx.commitFile(a, 'main', '初期', null);
    const commits = ctx.dbReadAll('commits').length;

    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiUnregisterFile(a)));
    expect(out).toEqual({ fileId: a, path: 'A規程.doc', type: 'doc' });
    expect(ctx.dbFindOne('files', 'fileId', a)).toBeNull();
    expect(fake.DriveApp.getFileById(a).isTrashed()).toBe(false);
    expect(ctx.dbReadAll('commits')).toHaveLength(commits);
  });

  it('改訂版が残っている文書・作業コピー・登録外は断り、台帳を変えない', () => {
    const env = withPr(makeEnv());
    const { ctx, fileId, work } = env;
    const before = snapshotDb(ctx, ['files']);
    expectRefused(() => ctx.apiUnregisterFile(fileId), /改訂版が1件あります/);
    expectRefused(() => ctx.apiUnregisterFile(work), /作業コピーです/);
    expectRefused(() => ctx.apiUnregisterFile('file-x'), /登録されていません/);
    expect(snapshotDb(ctx, ['files'])).toEqual(before);
  });
});

describe('道具全体の様子 (apiMainFolderUrl / apiWorkspace / apiWhoAmI / apiAppUrl / apiOverview)', () => {
  it('正式版の入れ物の URL', () => {
    const { ctx, config } = makeEnv({ file: false });
    expect(ctx.apiMainFolderUrl()).toBe('https://drive.google.com/drive/folders/' + config.mainId);
  });

  it('いまのワークスペースを、置き場の名前と上からの道のりで返す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = expectScreenSafe(ctx.apiWorkspace());
    expect(out.name).toBe('マイドライブ');
    expect(out.path).toBe('マイドライブ/agentic-management');
    expect(out.url).toBe('https://drive.google.com/drive/folders/' + fake.DriveApp.getRootFolder().getId());
  });

  it('入れ物が開けないときは空で返す (落とさない)', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(),
      JSON.stringify(Object.assign({}, ctx.repoConfig(), { rootId: 'folder-gone' })));
    expect(expectScreenSafe(ctx.apiWorkspace())).toEqual({ name: '', path: '', url: '' });
  });

  it('開いている本人と実行している人が同じかを返す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiWhoAmI())).toEqual({ activeUser: OWNER, effectiveUser: OWNER, sameUser: true });
    fake._setEffectiveUser('runner@example.com');
    expect(ctx.apiWhoAmI().sameUser).toBe(false);
    fake._setUser('');
    expect(ctx.apiWhoAmI()).toMatchObject({ activeUser: '', sameUser: false });
  });

  it('Web アプリの URL を字で返す', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiAppUrl()).toBe('https://script.google.com/macros/s/FAKE/exec');
  });

  it('文書・改訂版・開いたやることと確認依頼・記録の数を1つにまとめる', () => {
    const env = withPr(makeEnv());
    const { ctx } = env;
    ctx.apiIssueCreate('開いた', '', []);
    ctx.apiIssueCreate('閉じた', '', []);
    ctx.apiIssueClose(2);

    const out = expectScreenSafe(ctx.apiOverview());
    expect(out).toMatchObject({ repo: 'SoftBanto', me: OWNER, docs: 1, branches: 1, openIssues: 1, openPrs: 1 });
    expect(out.commits).toBe(ctx.dbReadAll('commits').length);

    asUser(env.fake, OTHER, () => ctx.apiPrReview(1, 'approve', ''));
    expect(ctx.apiOverview().openPrs).toBe(1); // 承認済みもまだ開いている
    ctx.apiPrClose(1);
    expect(ctx.apiOverview().openPrs).toBe(0);
  });
});
