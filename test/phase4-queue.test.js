import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES, KIT_SOURCES } from './sources.js';

/**
 * Phase 4a (コマンドキュー) の統合テスト。
 */

const SOURCES = APP_SOURCES.concat(KIT_SOURCES);

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  const fileId = fake._createDoc('就業規則', '<p>第1条</p>\n', config.mainId);
  ctx.repoRegisterFile(fileId, '就業規則.doc');
  ctx.commitFile(fileId, 'main', '初期状態', null);
  return { ctx, fake, fileId };
}

function enqueue(ctx, id, cmd) {
  ctx.commandQueueFolder_().createFile(
    id + '.cmd.json', JSON.stringify(cmd), 'text/plain');
}

function readResult(ctx, id) {
  const it = ctx.commandQueueFolder_().getFilesByName(id + '.result.json');
  return it.hasNext()
    ? JSON.parse(it.next().getBlob().getDataAsString('UTF-8'))
    : null;
}

describe('コマンドキュー', () => {
  it('命令を実行して結果を書き出す', () => {
    const { ctx, fileId } = setup();
    enqueue(ctx, 'cmd1', { op: 'status', args: { fileId: fileId } });

    ctx.processCommandQueue();

    const res = readResult(ctx, 'cmd1');
    expect(res.ok).toBe(true);
    expect(res.op).toBe('status');
    expect(res.result.branch).toBe('main');
  });

  it('処理済みの命令は二度実行されない', () => {
    const { ctx } = setup();
    enqueue(ctx, 'cmd1', { op: 'listFiles', args: {} });

    ctx.processCommandQueue();
    const first = readResult(ctx, 'cmd1');

    ctx.processCommandQueue();
    expect(readResult(ctx, 'cmd1').at).toBe(first.at);
  });

  it('ホワイトリストにない op は実行しない', () => {
    const { ctx } = setup();
    enqueue(ctx, 'cmd1', { op: 'repoInit', args: { rootFolderName: '乗っ取り' } });

    ctx.processCommandQueue();

    const res = readResult(ctx, 'cmd1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('実行できない操作です');
  });

  it('prReview は op に無い', () => {
    const { ctx } = setup();
    expect(ctx.COMMAND_OPS().prReview).toBeUndefined();
  });

  it('壊れたJSONでも他の命令を止めない', () => {
    const { ctx } = setup();
    ctx.commandQueueFolder_().createFile('bad.cmd.json', '{壊れている', 'text/plain');
    enqueue(ctx, 'good', { op: 'listFiles', args: {} });

    expect(() => ctx.processCommandQueue()).not.toThrow();
    expect(readResult(ctx, 'bad').ok).toBe(false);
    expect(readResult(ctx, 'good').ok).toBe(true);
  });

  it('失敗した命令はエラーを結果に書く', () => {
    const { ctx } = setup();
    enqueue(ctx, 'cmd1', { op: 'status', args: { fileId: '存在しない' } });

    ctx.processCommandQueue();
    const res = readResult(ctx, 'cmd1');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('管理対象に登録されていません');
  });

  it('1回の起動で処理するのは10件まで', () => {
    const { ctx } = setup();
    for (let i = 0; i < 12; i++) {
      enqueue(ctx, 'cmd' + i, { op: 'listFiles', args: {} });
    }

    ctx.processCommandQueue();

    let done = 0;
    for (let i = 0; i < 12; i++) if (readResult(ctx, 'cmd' + i)) done++;
    expect(done).toBe(10);
  });

  it('mainへのコミットはキュー経由でも拒否される', () => {
    const { ctx, fake, fileId } = setup();
    fake._docs.set(fileId, '<p>直接編集</p>\n');
    enqueue(ctx, 'cmd1', { op: 'commit', args: { fileId: fileId, message: 'x' } });

    ctx.processCommandQueue();
    expect(readResult(ctx, 'cmd1').error).toContain('正式版は直接なおせません');
  });

  it('ブランチのファイルはキュー経由で編集できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    enqueue(ctx, 'cmd1', {
      op: 'writeMarkdown',
      args: { fileId: workFileId, markdown: '# 第1条\n\n改訂しました\n' },
    });
    ctx.processCommandQueue();

    expect(readResult(ctx, 'cmd1').ok).toBe(true);
    expect(fake._docs.get(workFileId)).toContain('改訂しました');
  });
});

describe('同じ命令を二度実行しない', () => {
  /*
   * 「処理済みへ移す」だけでは足りなかった。命令は手元が Drive の同期
   * フォルダに置いたもので、手元にはその実体が残り続けていた (道具が
   * 消していなかった)。同期の都合で queue に戻ってくると、次の起動で
   * もう一度実行される。
   *
   * 実際に「やることを1つ作ったのに、同じものが番号違いで複数できた」と
   * いう形で現れた。作る命令なので、走った回数だけ増える。
   */
  function makeIssue(ctx, id) {
    enqueue(ctx, id, {
      op: 'issueCreate', args: { title: '棚卸しをする', body: '' },
    });
  }

  it('戻ってきた命令は実行しない', () => {
    const { ctx } = setup();
    makeIssue(ctx, 'cmd-dup');
    ctx.processCommandQueue();

    expect(ctx.issueList('')).toHaveLength(1);

    // 同期で戻ってきた状況を作る
    makeIssue(ctx, 'cmd-dup');
    ctx.processCommandQueue();

    expect(ctx.issueList('')).toHaveLength(1);
  });

  it('戻ってきたものは queue から外す', () => {
    const { ctx } = setup();
    makeIssue(ctx, 'cmd-dup');
    ctx.processCommandQueue();

    makeIssue(ctx, 'cmd-dup');
    ctx.processCommandQueue();

    // 外さないと、毎回の起動で見に来ることになる
    const left = [];
    const it = ctx.commandQueueFolder_().getFiles();
    while (it.hasNext()) left.push(it.next().getName());

    expect(left.filter((n) => n === 'cmd-dup.cmd.json')).toEqual([]);
  });

  it('番号が違うものは別の命令として実行する', () => {
    const { ctx } = setup();
    makeIssue(ctx, 'cmd-a');
    makeIssue(ctx, 'cmd-b');
    ctx.processCommandQueue();

    // 二度実行を止めたつもりで、別の命令まで止めてはいけない
    expect(ctx.issueList('')).toHaveLength(2);
  });

  it('結果を書く前に処理済みへ移す', () => {
    const { ctx } = setup();
    makeIssue(ctx, 'cmd-order');

    /*
     * 逆にすると、結果を書いた直後に実行が打ち切られた場合 (6分の上限など)
     * 命令が queue に残り、次の起動でもう一度走る。
     */
    const done = ctx.commandDoneFolder_();
    const realCreate = ctx.commandQueueFolder_().createFile;
    let movedFirst = false;

    const queue = ctx.commandQueueFolder_();
    queue.createFile = function (...a) {
      movedFirst = done.getFilesByName('cmd-order.cmd.json').hasNext();
      return realCreate.apply(queue, a);
    };
    ctx.commandQueueFolder_ = () => queue;

    ctx.processCommandQueue();
    expect(movedFirst).toBe(true);
  });
});

describe('鍵を長く持たない (画面からの登録を「混み合っています」で止めない)', () => {
  /*
   * 1分ごとの処理が、命令が無くても鍵を取り、鍵を持ったまま Drive のフォルダを
   * 覗き、命令をまとめて1つの鍵で走らせ、1日1回の片付けまで相乗りさせていた。
   * 画面からの登録は鍵を30秒まで待つので、そのあいだ「混み合っています」になり、
   * スプリントを作れなかった (実機で報告があった)。
   */
  function watchLocks(ctx) {
    // 置き場のフォルダは先に用意しておく (無いときに作る鍵は、ここで見たいものではない)
    ctx.commandQueueFolder_();
    ctx.commandDoneFolder_();
    const seen = { top: 0, housekeepDepth: null };
    const lock = ctx.dbWithLock_;
    ctx.dbWithLock_ = (ms, fn, busy) => {
      if (ctx.dbLockDepth_ === 0) seen.top++;
      return lock(ms, fn, busy);
    };
    const hk = ctx.housekeepArchiveDaily_;
    ctx.housekeepArchiveDaily_ = () => { seen.housekeepDepth = ctx.dbLockDepth_; return hk(); };
    return seen;
  }

  it('命令が無いときは鍵を取らない', () => {
    const { ctx } = setup();
    ctx.PropertiesService.getScriptProperties().setProperty('ARCHIVE_HOUSEKEPT_ON',
      ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    // 成果の数も1日1回の別の印で走る (Outcomes.gs)。済んだことにしておく
    ctx.PropertiesService.getScriptProperties().setProperty('OUTCOMES_ON',
      ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    const seen = watchLocks(ctx);
    ctx.processCommandQueue();
    expect(seen.top).toBe(0);
  });

  it('命令は1件ずつ鍵を取る (まとめて持たない)', () => {
    const { ctx } = setup();
    // 片付けの鍵を数えないよう、今日の分は済んだことにしておく
    ctx.PropertiesService.getScriptProperties().setProperty('ARCHIVE_HOUSEKEPT_ON',
      ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    // 成果の数も1日1回の別の印で走る (Outcomes.gs)。済んだことにしておく
    ctx.PropertiesService.getScriptProperties().setProperty('OUTCOMES_ON',
      ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    enqueue(ctx, 'a', { op: 'listFiles', args: {} });
    enqueue(ctx, 'b', { op: 'listFiles', args: {} });
    const seen = watchLocks(ctx);
    ctx.processCommandQueue();
    expect(seen.top).toBe(2);
    expect(readResult(ctx, 'a').ok).toBe(true);
    expect(readResult(ctx, 'b').ok).toBe(true);
  });

  it('1日1回の片付けは鍵の外で走らせる', () => {
    const { ctx } = setup();
    const seen = watchLocks(ctx);
    ctx.processCommandQueue();
    expect(seen.housekeepDepth).toBe(0);
  });

  it('同じ命令を、重なった2回の起動が両方走らせることはない', () => {
    const { ctx } = setup();
    enqueue(ctx, 'once', { op: 'issueCreate', args: { title: '一度だけ', body: '' } });
    // 1回目の起動が命令を数えたあと、走らせる前に2回目の起動が割り込む形
    const files = [];
    const it = ctx.commandQueueFolder_().getFiles();
    while (it.hasNext()) files.push(it.next());
    ctx.processCommandQueue();
    ctx.runCommandFileLocked_(files[0], ctx.commandQueueFolder_(), ctx.commandDoneFolder_());
    expect(ctx.issueList(null).filter((i) => i.title === '一度だけ')).toHaveLength(1);
  });
});

describe('鍵の外に出した処理の重なり', () => {
  it('置き場のフォルダを作るのは鍵の中で、確かめ直してから', () => {
    const { ctx } = setup();
    const config = ctx.repoConfig();
    delete config.queueDoneId;
    ctx.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(), JSON.stringify(config));
    const git = ctx.DriveApp.getFolderById(config.gitId);
    const create = git.createFolder;
    const depths = [];
    git.createFolder = (n) => { depths.push(ctx.dbLockDepth_); return create(n); };

    const a = ctx.commandDoneFolder_();
    const b = ctx.commandDoneFolder_();
    expect(depths).toEqual([1]);
    expect(a.getId()).toBe(b.getId());
  });

  it('ゴミ箱に入った置き場は使わず、作り直す', () => {
    /*
     * 覚えている ID で開けるかだけを見ていたため、ゴミ箱の中のフォルダを返していた
     * (Apps Script はゴミ箱の中も開ける)。命令はゴミ箱に置かれて誰も拾わず、
     * setupCommandQueue() も同じフォルダの ID を返し続けた (実機で踏んだ)。
     */
    const { ctx } = setup();
    const oldQueue = ctx.commandQueueFolder_();
    const oldDone = ctx.commandDoneFolder_();
    oldQueue.setTrashed(true);
    oldDone.setTrashed(true);

    const queue = ctx.commandQueueFolder_();
    const done = ctx.commandDoneFolder_();
    expect(queue.getId()).not.toBe(oldQueue.getId());
    expect(done.getId()).not.toBe(oldDone.getId());
    expect(queue.isTrashed()).toBe(false);
    expect(ctx.repoConfig().queueId).toBe(queue.getId());
    expect(ctx.commandQueueFolder_().getId()).toBe(queue.getId());
  });

  it('ゴミ箱か確かめられなかったときは、作り直さずに投げる', () => {
    // 一時的な失敗で作り直すと、まだ使える置き場の命令が拾われなくなる
    const { ctx } = setup();
    const queue = ctx.commandQueueFolder_();
    queue.isTrashed = () => { throw new Error('一時的な失敗'); };

    expect(() => ctx.commandQueueFolder_()).toThrow('一時的な失敗');
    expect(ctx.repoConfig().queueId).toBe(queue.getId());
  });

  it('期限切れの捨てたものは、消す直前に戻されていたら消さない', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('戻すもの', '', []);
    ctx.issueArchive(made.number);
    ctx.dbUpdate('issues', 'number', made.number, { archivedAt: new Date(Date.now() - 400 * 864e5) });
    const list = ctx.issueListArchived;
    // 期限切れを選んだあと、消す前に人が戻した形
    ctx.issueListArchived = () => { const rows = list(); ctx.issueRestore(made.number); return rows; };

    ctx.issueHousekeep(new Date());
    expect(ctx.issueGet(made.number).title).toBe('戻すもの');
  });

  it('1日1回の片付けは、ほかの起動が受け持っている間は走らせない', () => {
    const { ctx } = setup();
    const props = ctx.PropertiesService.getScriptProperties();
    const today = ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    props.setProperty('ARCHIVE_HOUSEKEPT_RUNNING', today + '|' + Date.now());
    let ran = 0;
    const orig = ctx.prWithdrawOrphans;
    ctx.prWithdrawOrphans = () => { ran++; return orig(); };

    ctx.housekeepArchiveDaily_();
    expect(ran).toBe(0);
  });

  it('片付けが途中で落ちたら、その日の済みの印を付けず、次の回にやり直す', () => {
    const { ctx } = setup();
    const props = ctx.PropertiesService.getScriptProperties();
    const orig = ctx.issueHousekeep;
    ctx.issueHousekeep = () => { throw new Error('混み合っています'); };
    expect(() => ctx.housekeepArchiveDaily_()).toThrow();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBeNull();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_RUNNING')).toBeNull();

    ctx.issueHousekeep = orig;
    ctx.housekeepArchiveDaily_();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBe(
      ctx.Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
  });
});

describe('命令を置いた人', () => {
  it('kitVersion を置いた人の指紋を覚える', () => {
    const { ctx, fake } = setup();
    fake._setUser('b@example.com');
    enqueue(ctx, 'k1', { op: 'kitVersion', args: { mine: '1234abcd' } });
    fake._setUser('tester@example.com');

    ctx.processCommandQueue();

    expect(readResult(ctx, 'k1').ok).toBe(true);
    expect(ctx.kitStatus_('b@example.com').mine).toBe('1234abcd');
  });

  it('持ち主の無いファイル (共有ドライブ) でも命令は通る', () => {
    const { ctx } = setup();
    enqueue(ctx, 'k2', { op: 'kitVersion', args: { mine: '1234abcd' } });
    const it = ctx.commandQueueFolder_().getFilesByName('k2.cmd.json');
    it.next()._setOwner('');

    ctx.processCommandQueue();

    expect(readResult(ctx, 'k2').ok).toBe(true);
  });
});

describe('キューを動かしている人', () => {
  // apiSettings はスクラムの設定も読むので、API を動かすテストと同じ読み込み集合 (sources.js) を使う
  function setup() {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    return { ctx, fake };
  }

  it('setupCommandQueue が実行した人を覚え、processCommandQueue が回った時刻を書く', () => {
    const { ctx } = setup();
    ctx.setupCommandQueue();
    ctx.processCommandQueue();
    const st = ctx.queueStatus_();
    expect(st.runner).toBe('tester@example.com');
    expect(st.lastRun).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(st.stale).toBe(false);
  });

  it('1時間より前に止まっていれば stale', () => {
    const { ctx } = setup();
    ctx.setupCommandQueue();
    ctx.processCommandQueue();
    const later = new Date(Date.now() + 61 * 60 * 1000);
    expect(ctx.queueStatus_(later).stale).toBe(true);
  });

  it('何も仕掛けていなければ stale ではない (未設定)', () => {
    const { ctx } = setup();
    expect(ctx.queueStatus_().stale).toBe(false);
  });

  it('仕掛けた直後 (まだ一度も回っていない) は stale ではない', () => {
    const { ctx } = setup();
    ctx.setupCommandQueue();
    expect(ctx.queueStatus_().lastRun).toBe('');
    expect(ctx.queueStatus_().stale).toBe(false);
  });

  it('仕掛けてから2時間、一度も回っていなければ stale', () => {
    const { ctx, fake } = setup();
    ctx.setupCommandQueue();
    const props = fake.PropertiesService.getScriptProperties();
    props.setProperty('QUEUE_RUNNER_AT', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    expect(ctx.queueStatus_().stale).toBe(true);
  });

  it('回った時刻が古くても、仕掛け直した直後なら stale ではない', () => {
    const { ctx, fake } = setup();
    const props = fake.PropertiesService.getScriptProperties();
    props.setProperty('QUEUE_RUNNER', 'tester@example.com');
    props.setProperty('QUEUE_LAST_RUN', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    props.setProperty('QUEUE_RUNNER_AT', new Date(Date.now() - 10 * 60 * 1000).toISOString());
    expect(ctx.queueStatus_().stale).toBe(false);
    // 仕掛けた時刻も古ければ stale
    props.setProperty('QUEUE_RUNNER_AT', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());
    expect(ctx.queueStatus_().stale).toBe(true);
  });

  it('置き場を開けなければ回った時刻を書かない (Drive に入れないトリガーを「動いています」と見せない)', () => {
    const { ctx, fake } = setup();
    const props = fake.PropertiesService.getScriptProperties();
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    props.setProperty('QUEUE_LAST_RUN', old);
    ctx.commandQueueFolder_ = () => { throw new Error('アクセスできません'); };
    expect(() => ctx.processCommandQueue()).toThrow(/アクセスできません/);
    expect(props.getProperty('QUEUE_LAST_RUN')).toBe(old);
  });

  it('処理済みの置き場を開けなくても回った時刻を書かない', () => {
    const { ctx, fake } = setup();
    const props = fake.PropertiesService.getScriptProperties();
    ctx.commandDoneFolder_ = () => { throw new Error('アクセスできません'); };
    expect(() => ctx.processCommandQueue()).toThrow(/アクセスできません/);
    expect(props.getProperty('QUEUE_LAST_RUN')).toBe(null);
  });

  it('前から動いている番頭 (仕掛けた人の記録が無い) でも、回った時刻で決める', () => {
    const { ctx, fake } = setup();
    // QUEUE_RUNNER は setupCommandQueue() を実行し直すまで入らない
    ctx.processCommandQueue();
    const st = ctx.queueStatus_();
    expect(st.runner).toBe('');
    expect(st.stale).toBe(false);
    expect(ctx.queueStatus_(new Date(Date.now() + 61 * 60 * 1000)).stale).toBe(true);
    // 読めない時刻は、回っているか分からないので止まった側に倒す
    fake.PropertiesService.getScriptProperties().setProperty('QUEUE_LAST_RUN', 'あとで');
    expect(ctx.queueStatus_().stale).toBe(true);
  });

  it('apiSettings は管理者にだけ返す', () => {
    const { ctx, fake } = setup();
    ctx.setupCommandQueue();
    expect(ctx.apiSettings().queue.runner).toBe('tester@example.com');
    fake._setUser('viewer@example.com');
    expect(ctx.apiSettings().queue).toBe(null);
  });
});
