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
  'src/core/Graph.js',
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

describe('身元の実測', () => {
  it('実行者と権限保持者を返す', () => {
    const { ctx } = setup();
    const who = ctx.apiWhoAmI();

    expect(who.activeUser).toBe('tester@example.com');
    expect(who.effectiveUser).toBe('tester@example.com');
    expect(who.sameUser).toBe(true);
  });

  it('実行者が取れない場合を区別できる', () => {
    const { ctx, fake } = setup();
    fake._setUser('');

    const who = ctx.apiWhoAmI();
    expect(who.activeUser).toBe('');
    expect(who.sameUser).toBe(false);
  });

  it('executeAs: ME で別人が使っている状態を区別できる', () => {
    const { ctx, fake } = setup();
    fake._setUser('member@example.com');
    fake._setEffectiveUser('owner@example.com');

    const who = ctx.apiWhoAmI();
    expect(who.activeUser).toBe('member@example.com');
    expect(who.effectiveUser).toBe('owner@example.com');
    expect(who.sameUser).toBe(false);
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

describe('コミットグラフ', () => {
  it('mainとブランチをまとめて返す', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    ctx.commitFile(workFileId, '改訂', 'ブランチ側の変更', null);

    const graph = ctx.apiCommitGraph(fileId);

    expect(graph.branches).toEqual(['main', '改訂']);
    expect(graph.laneCount).toBe(2);
    expect(graph.rows.length).toBe(3);
    expect(graph.rows.some((r) => r.fork)).toBe(true);
  });

  it('ブランチの作業コピーを渡しても文書全体のグラフが返る', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    const fromMain = ctx.apiCommitGraph(fileId);
    const fromBranch = ctx.apiCommitGraph(workFileId);

    expect(fromBranch.rows.length).toBe(fromMain.rows.length);
    expect(fromBranch.branches).toEqual(fromMain.branches);
  });

  it('削除済みブランチはグラフに出ない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    ctx.commitFile(workFileId, '改訂', 'ブランチ側の変更', null);

    ctx.branchDelete('改訂');

    expect(ctx.apiCommitGraph(fileId).branches).toEqual(['main']);
  });
});

describe('一括コミット', () => {
  function twoFileBranch() {
    const env = setup();
    const config = env.ctx.repoConfig();

    const second = env.fake._createDoc('賃金規程', '<p>第1条</p>\n', config.mainId);
    env.ctx.repoRegisterFile(second, '賃金規程.doc');
    env.ctx.commitFile(second, 'main', '初期状態', null);

    env.ctx.branchCreate('改訂', env.fileId);
    env.ctx.branchCreate('改訂2', second);

    return Object.assign(env, { second: second });
  }

  it('未コミットの文書だけを返す', () => {
    const env = twoFileBranch();
    const workA = env.ctx.branchWorkingFileId('改訂', env.fileId);

    expect(env.ctx.apiDirtyFiles('改訂')).toEqual([]);

    env.fake._docs.set(workA, '<p>編集した</p>\n');
    const dirty = env.ctx.apiDirtyFiles('改訂');

    expect(dirty.length).toBe(1);
    expect(dirty[0].fileId).toBe(workA);
  });

  it('まとめてコミットできる', () => {
    const env = twoFileBranch();
    const workA = env.ctx.branchWorkingFileId('改訂', env.fileId);
    const workB = env.ctx.branchWorkingFileId('改訂2', env.second);

    env.fake._docs.set(workA, '<p>Aを編集</p>\n');
    env.fake._docs.set(workB, '<p>Bを編集</p>\n');

    const result = env.ctx.apiCommitMany([workA, workB], 'まとめて改訂');

    expect(result.committed.length).toBe(2);
    expect(result.failed).toEqual([]);
    expect(env.ctx.headCommit(workA, '改訂').message).toBe('まとめて改訂');
    expect(env.ctx.headCommit(workB, '改訂2').message).toBe('まとめて改訂');
  });

  it('1件失敗しても他は通す', () => {
    const env = twoFileBranch();
    const workA = env.ctx.branchWorkingFileId('改訂', env.fileId);
    env.fake._docs.set(workA, '<p>Aを編集</p>\n');

    // 変更のないファイルは「変更がありません」で落ちる
    const workB = env.ctx.branchWorkingFileId('改訂2', env.second);
    const result = env.ctx.apiCommitMany([workA, workB], 'まとめて改訂');

    expect(result.committed.length).toBe(1);
    expect(result.failed.length).toBe(1);
    expect(result.failed[0].error).toContain('変更がありません');
  });

  it('mainのファイルは保護されて失敗する', () => {
    const env = twoFileBranch();
    env.fake._docs.set(env.fileId, '<p>直接編集</p>\n');

    const result = env.ctx.apiCommitMany([env.fileId], 'main を直接');

    expect(result.committed).toEqual([]);
    expect(result.failed[0].error).toContain('mainは保護されています');
  });

  it('対象が空なら拒否する', () => {
    const { ctx } = setup();
    expect(() => ctx.apiCommitMany([], 'x')).toThrow(/対象が選ばれていません/);
  });
});

describe('全体の状態', () => {
  it('文書・ブランチ・Issue・PRの数を返す', () => {
    const { ctx, fake, fileId } = setup();

    expect(ctx.apiOverview().docs).toBe(1);
    expect(ctx.apiOverview().branches).toBe(0);

    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    ctx.commitFile(workFileId, '改訂', '第3条を追加', null);

    ctx.issueCreate('やること', '', [fileId]);
    ctx.prCreate('第3条を追加', '', '改訂', fileId);

    const o = ctx.apiOverview();
    expect(o.docs).toBe(1);
    expect(o.branches).toBe(1);
    expect(o.openIssues).toBe(1);
    expect(o.openPrs).toBe(1);
    expect(o.commits).toBeGreaterThan(0);
  });

  it('マージ済みのPRとクローズ済みIssueは数えない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    ctx.commitFile(workFileId, '改訂', '第3条を追加', null);

    const issue = ctx.issueCreate('やること', '', [fileId]);
    const pr = ctx.prCreate('第3条', 'closes #' + issue.number, '改訂', fileId);

    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');
    ctx.prMerge(pr.number, []);

    const o = ctx.apiOverview();
    expect(o.openPrs).toBe(0);
    expect(o.openIssues).toBe(0);
  });
});

describe('画面に渡せる形か', () => {
  /**
   * google.script.run は限られた型しか運べない。DBの行をそのまま返すと
   * 日時が Date のまま混ざり、変換に失敗して画面には null が届く。
   * 実際に apiIssueList でそれを踏んだ。
   *
   * @param {*} value
   * @param {string} path
   * @returns {string[]} 見つかった問題
   */
  function unserializable(value, path) {
    if (value === null || value === undefined) return [];
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return [path + ' が Date のまま'];
    }
    if (Array.isArray(value)) {
      return value.reduce(function (acc, v, i) {
        return acc.concat(unserializable(v, path + '[' + i + ']'));
      }, []);
    }
    if (typeof value === 'object') {
      return Object.keys(value).reduce(function (acc, k) {
        return acc.concat(unserializable(value[k], path + '.' + k));
      }, []);
    }
    if (typeof value === 'function') return [path + ' が関数'];
    return [];
  }

  function prepared() {
    const env = setup();
    const issue = env.ctx.apiIssueCreate('やること', '補足', [env.fileId]);
    env.ctx.apiIssueUpdate(issue.number, {
      assignee: 'a@example.com', dueDate: '2026-09-30',
    });
    env.ctx.branchCreate('改訂', env.fileId);
    return env;
  }

  const CASES = [
    ['apiIssueList', (ctx) => ctx.apiIssueList('')],
    ['apiIssuesForFile', (ctx, env) => ctx.apiIssuesForFile(env.fileId)],
    ['apiProjectBoard', (ctx) => ctx.apiProjectBoard()],
    ['apiBranchList', (ctx) => ctx.apiBranchList()],
    ['apiPrList', (ctx) => ctx.apiPrList()],
    ['apiListFiles', (ctx) => ctx.apiListFiles()],
    ['apiOverview', (ctx) => ctx.apiOverview()],
    ['apiFileStatus', (ctx, env) => ctx.apiFileStatus(env.fileId)],
    ['apiCommitGraph', (ctx, env) => ctx.apiCommitGraph(env.fileId)],
    ['apiKnownPeople', (ctx) => ctx.apiKnownPeople()],
    ['apiWhoAmI', (ctx) => ctx.apiWhoAmI()],
  ];

  CASES.forEach(([name, call]) => {
    it(name + ' は Date を含まない', () => {
      const env = prepared();
      expect(unserializable(call(env.ctx, env), name)).toEqual([]);
    });
  });

  it('やることは中身も正しく運べる', () => {
    const env = prepared();
    const issues = env.ctx.apiIssueList('');

    expect(issues.length).toBe(1);
    expect(issues[0].assignee).toBe('a@example.com');
    expect(typeof issues[0].createdAt).toBe('string');
    expect(issues[0].dueDate).toContain('2026-09-30');
  });
});
