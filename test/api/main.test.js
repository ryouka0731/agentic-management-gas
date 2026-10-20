import { describe, it, expect } from 'vitest';
import { makeEnv, withPr, expectRefused, asUser, OWNER, ADMIN, OTHER } from './setup.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 入口 (src/Main.gs): doGet / include / setupRepo / setupCommandQueue / housekeepArchiveDaily_。
 *
 * 末尾が _ でない関数は画面から呼べる。エディタ用の setup* は初期化済みなら断るか、
 * 持ち主 (Session ではなく入れ物の持ち主) だけに絞る。
 */

/** doGet が作るページを写し取る疑似のテンプレート */
function stubTemplate(ctx) {
  const seen = { file: null, title: null, meta: [] };
  const out = {
    setTitle: (t) => { seen.title = t; return out; },
    addMetaTag: (k, v) => { seen.meta.push([k, v]); return out; },
  };
  ctx.HtmlService.createTemplateFromFile = (f) => { seen.file = f; return { evaluate: () => out }; };
  return seen;
}

describe('doGet / include', () => {
  it('どの p を渡しても画面は1つで、名前と viewport を付ける', () => {
    const { ctx } = makeEnv({ file: false });
    for (const e of [undefined, {}, { parameter: {} }, { parameter: { p: 'wiki' } },
      { parameter: { p: '../../etc' } }, { parameter: { p: 'x'.repeat(30) } }]) {
      const seen = stubTemplate(ctx);
      ctx.doGet(e);
      expect(seen.file).toBe('ui/wiki');
      expect(seen.title).toBe(ctx.APP_NAME());
      expect(seen.meta).toEqual([['viewport', 'width=device-width, initial-scale=1']]);
    }
  });

  it('include は HTML ファイルの中身を字のまま返す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    fake._setKitFile('ui/app.css', '<style>a{}</style>');
    expect(ctx.include('ui/app.css')).toBe('<style>a{}</style>');
    expect(() => ctx.include('ui/nope')).toThrow();
  });
});

describe('setupRepo', () => {
  it('まだ初期化していなければ作り、二度目は断る (作り直すと記録が見えなくなる)', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    const config = ctx.setupRepo();
    expect(config.rootId).toBeTruthy();
    expectRefused(() => ctx.setupRepo(), /リポジトリは既に初期化されています/);
    expect(ctx.repoConfig().rootId).toBe(config.rootId);
  });
});

describe('assertOwner_ / setupCommandQueue', () => {
  it('持ち主はキューを仕掛けられ、仕掛けた人と時刻が残る', () => {
    const { ctx } = makeEnv({ file: false });
    const msg = ctx.setupCommandQueue();
    expect(msg).toMatch(/^1分間隔のトリガーを設置しました。キューのフォルダID: /);
    const props = ctx.PropertiesService.getScriptProperties();
    expect(props.getProperty('QUEUE_RUNNER')).toBe(OWNER);
    expect(props.getProperty('QUEUE_RUNNER_AT')).toMatch(/T/);
  });

  it('前の同名トリガーは消してから作る (二度実行しても増えない)', () => {
    const { ctx } = makeEnv({ file: false });
    const deleted = [];
    const made = [];
    ctx.ScriptApp.getProjectTriggers = () => [
      { getHandlerFunction: () => 'processCommandQueue' },
      { getHandlerFunction: () => 'otherJob' },
      { getHandlerFunction: () => 'processCommandQueue' },
    ];
    ctx.ScriptApp.deleteTrigger = (t) => deleted.push(t.getHandlerFunction());
    ctx.ScriptApp.newTrigger = (name) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => made.push([name, n]) }) }) });

    expect(ctx.setupCommandQueue()).toContain('(古いトリガーを2件削除)');
    expect(deleted).toEqual(['processCommandQueue', 'processCommandQueue']);
    expect(made).toEqual([['processCommandQueue', 1]]);
  });

  it('管理者 (持ち主でない) やほかの人には動かない。大文字小文字は見ない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    for (const who of [ADMIN, OTHER, '']) {
      asUser(fake, who, () => {
        expectRefused(() => ctx.setupCommandQueue(), /このアプリの持ち主だけが行えます/);
      });
    }
    expect(ctx.PropertiesService.getScriptProperties().getProperty('QUEUE_RUNNER')).toBeNull();
    asUser(fake, OWNER.toUpperCase(), () => expect(() => ctx.assertOwner_()).not.toThrow());
  });
});

describe('housekeepArchiveDaily_', () => {
  function today(ctx) {
    return ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  it('1日1回だけ走り、済みの印を付けて受け持ちの印を外す', () => {
    const { ctx } = makeEnv({ file: false });
    const props = ctx.PropertiesService.getScriptProperties();
    expect(Array.isArray(ctx.housekeepArchiveDaily_())).toBe(true);
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBe(today(ctx));
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_RUNNING')).toBeNull();
    expect([...ctx.housekeepArchiveDaily_()]).toEqual([]);
  });

  it('期限を過ぎた捨てたやることを片付け、その番号を返す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiIssueCreate('古い', '', []);
    ctx.apiIssueArchive(1);
    ctx.dbUpdate('issues', 'number', 1, { archivedAt: new Date(Date.now() - 400 * 86400000) });
    expect([...ctx.housekeepArchiveDaily_()]).toEqual([1]);
    expect(ctx.dbReadAll('issues')).toHaveLength(0);
  });

  it('ほかの起動が受け持って30分たたないうちは走らせない', () => {
    const { ctx } = makeEnv({ file: false });
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('ARCHIVE_HOUSEKEPT_RUNNING', today(ctx) + '|' + Date.now());
    expect([...ctx.housekeepArchiveDaily_()]).toEqual([]);
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBeNull();

    // 落ちた起動の受け持ちは30分で取り直す
    props.setProperty('ARCHIVE_HOUSEKEPT_RUNNING', today(ctx) + '|' + (Date.now() - 31 * 60 * 1000));
    ctx.housekeepArchiveDaily_();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBe(today(ctx));
  });

  it('鍵が取れなければ走らせない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock: () => {} });
    expect([...ctx.housekeepArchiveDaily_()]).toEqual([]);
    expect(ctx.PropertiesService.getScriptProperties().getProperty('ARCHIVE_HOUSEKEPT_ON')).toBeNull();
  });

  it('main の行を入れる・消えた文書の依頼を取り下げる、が落ちても片付けは続ける', () => {
    const env = withPr(makeEnv());
    const { ctx } = env;
    ctx.repoEnsureMainBranch = () => { throw new Error('boom'); };
    ctx.prWithdrawOrphans = () => { throw new Error('boom'); };
    ctx.housekeepArchiveDaily_();
    expect(ctx.PropertiesService.getScriptProperties().getProperty('ARCHIVE_HOUSEKEPT_ON')).toBe(today(ctx));
  });

  it('元の文書が消えた確認依頼は、誰も一覧を開かなくても取り下げる', () => {
    const env = withPr(makeEnv());
    env.fake.DriveApp.getFileById(env.fileId).setTrashed(true);
    env.ctx.housekeepArchiveDaily_();
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).state)).toBe('closed');
  });

  it('片付けが落ちたら済みの印を付けず、受け持ちの印は外す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.issueHousekeep = () => { throw new Error('boom'); };
    expect(() => ctx.housekeepArchiveDaily_()).toThrow('boom');
    const props = ctx.PropertiesService.getScriptProperties();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBeNull();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_RUNNING')).toBeNull();
  });
});
