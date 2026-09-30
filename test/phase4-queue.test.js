import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/**
 * Phase 4a (コマンドキュー) の統合テスト。
 */

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/ObjectStore.gs',
  'src/core/Normalize.js',
  'src/core/Markdown.js',
  'src/core/Diff.js',
  'src/core/Merge.js',
  'src/core/Commit.gs',
  'src/core/Branch.gs',
  'src/render/HtmlWriter.gs',
  'src/render/SheetRenderer.gs',
  'src/render/SheetWriter.gs',
  'src/core/PullRequest.gs',
  'src/core/PullPatch.gs',
  'src/core/Outbox.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Tag.gs',
  'src/core/Template.gs',
  'src/core/Member.gs',
  'src/core/Issue.gs',
  'src/core/IssueComment.gs',
  'src/core/IssueBranch.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Inquiry.gs',
  'src/core/Brand.js',
  'src/core/Notifier.gs',
  'src/core/CommandQueue.gs',
  'src/core/Tally.js',
  'src/core/Plain.js',
  'src/Main.gs',
];

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
    expect(readResult(ctx, 'cmd1').error).toContain('mainは保護されています');
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
