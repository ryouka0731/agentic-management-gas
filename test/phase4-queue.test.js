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
  'src/core/Issue.gs',
  'src/core/IssueBranch.gs',
  'src/core/Project.gs',
  'src/core/Notifier.gs',
  'src/core/CommandQueue.gs',
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
