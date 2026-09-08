import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/**
 * Phase 4b (Markdown編集 + mainのブランチ保護) の統合テスト。
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
  'src/core/PullRequest.gs',
  'src/core/Issue.gs',
  'src/core/Project.gs',
  'src/core/Notifier.gs',
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

describe('Markdown編集', () => {
  it('mainのファイルは編集できない', () => {
    const { ctx, fileId } = setup();
    expect(ctx.apiGetMarkdown(fileId).editable).toBe(false);
    expect(() => ctx.apiSaveMarkdown(fileId, '# 変更\n'))
      .toThrow(/mainは保護されています/);
  });

  it('mainには直接コミットできない', () => {
    const { ctx, fake, fileId } = setup();
    fake._docs.set(fileId, '<p>直接編集</p>\n');
    expect(() => ctx.apiCommit(fileId, '直接コミット', null))
      .toThrow(/mainは保護されています/);
  });

  it('ブランチのファイルは編集して保存できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    expect(ctx.apiGetMarkdown(workFileId).editable).toBe(true);
    ctx.apiSaveMarkdown(workFileId, '# 第1条\n\n新しい本文\n');

    expect(fake._docs.get(workFileId)).toBe('<h1>第1条</h1>\n<p>新しい本文</p>\n');
  });

  it('保存してもコミットはされない', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    const before = ctx.headCommit(workFileId, '改訂').sha;

    ctx.apiSaveMarkdown(workFileId, '# 第1条\n\n新しい本文\n');

    expect(ctx.headCommit(workFileId, '改訂').sha).toBe(before);
    expect(ctx.apiFileStatus(workFileId).dirty).toBe(true);
  });

  it('書き戻せない内容は保存しない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    const before = fake._docs.get(workFileId);

    expect(() => ctx.apiSaveMarkdown(workFileId, '![x](sha:unavailable)\n'))
      .toThrow(/書き戻せません/);
    expect(fake._docs.get(workFileId)).toBe(before);
  });

  it('編集せずに保存しても内容が変わらない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId,
      '<h1>第1条</h1>\n<p>本文<strong>です</strong>。</p>\n' +
      '<li data-list="ul" data-depth="0">項目</li>\n');
    const before = fake._docs.get(workFileId);

    ctx.apiSaveMarkdown(workFileId, ctx.apiGetMarkdown(workFileId).markdown);
    expect(fake._docs.get(workFileId)).toBe(before);
  });
});

describe('mainの直接編集の退避', () => {
  it('退避するとコミットが残り、mainがcleanになる', () => {
    const { ctx, fake, fileId } = setup();
    fake._docs.set(fileId, '<p>Docsで直接編集した</p>\n');

    const commit = ctx.apiStashMainDrift(fileId);

    expect(commit.message).toContain('直接編集');
    expect(ctx.apiFileStatus(fileId).dirty).toBe(false);
  });

  it('変更が無ければ退避できない', () => {
    const { ctx, fileId } = setup();
    expect(() => ctx.apiStashMainDrift(fileId)).toThrow(/変更がありません/);
  });

  it('ブランチのファイルには使えない', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    expect(() => ctx.apiStashMainDrift(workFileId))
      .toThrow(/mainのファイルにのみ使えます/);
  });

  it('退避すればマージまで到達できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    ctx.commitFile(workFileId, '改訂', 'ブランチ側', null);

    // mainをDocsで直接編集してしまった状態を作る
    fake._docs.set(fileId, '<p>第1条 (直接編集)</p>\n');

    const pr = ctx.prCreate('第3条を追加', '', '改訂', fileId);
    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');

    expect(() => ctx.prMerge(pr.number, ['theirs']))
      .toThrow(/mainに未コミットの変更があります/);

    ctx.apiStashMainDrift(fileId);
    expect(() => ctx.prMerge(pr.number, ['theirs'])).not.toThrow();
  });
});

describe('PRの会話とコミット', () => {
  function prepare() {
    const env = setup();
    env.ctx.branchCreate('改訂', env.fileId);
    const workFileId = env.ctx.branchWorkingFileId('改訂', env.fileId);
    env.fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    env.ctx.commitFile(workFileId, '改訂', '第3条を追加', null);
    const pr = env.ctx.prCreate('第3条を追加', '', '改訂', env.fileId);
    return Object.assign(env, { pr: pr, workFileId: workFileId });
  }

  it('コメントを時系列で返す', () => {
    const env = prepare();
    env.fake._setUser('a@example.com');
    env.ctx.prReview(env.pr.number, 'comment', '第3条の文言が気になります');
    env.fake._setUser('b@example.com');
    env.ctx.prReview(env.pr.number, 'approve', '直りました');

    const reviews = env.ctx.apiPrReviews(env.pr.number);
    expect(reviews.length).toBe(2);
    expect(reviews[0].body).toBe('第3条の文言が気になります');
    expect(reviews[0].reviewer).toBe('a@example.com');
    expect(reviews[1].state).toBe('approve');
  });

  it('他のPRのコメントは混ざらない', () => {
    const env = prepare();
    env.ctx.prReview(env.pr.number, 'comment', 'こちらのPR');
    expect(env.ctx.apiPrReviews(999)).toEqual([]);
  });

  it('ブランチのコミットを新しい順で返す', () => {
    const env = prepare();
    const commits = env.ctx.apiPrCommits(env.pr.number);

    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe('第3条を追加');
    expect(commits[1].message).toContain('ブランチ 改訂 を作成');
    expect(commits[0].sha.length).toBe(64);
  });
});

describe('Slides の扱い', () => {
  it('SlidesではPRを作れない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);

    const slideId = fake._createSlides('提案書', [{ shapes: ['表紙'] }]);
    ctx.repoRegisterFile(slideId, '提案書.slide');

    expect(() => ctx.prCreate('改訂', '', '改訂', slideId))
      .toThrow(/Slidesはマージに対応していません/);
  });

  it('Slidesも管理対象として登録できる', () => {
    const { ctx, fake } = setup();
    const slideId = fake._createSlides('提案書', [{ shapes: ['表紙'] }]);
    const row = ctx.repoRegisterFile(slideId, '提案書.slide');
    expect(row.type).toBe('slide');
  });
});
