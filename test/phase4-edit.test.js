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
  'src/core/PullPatch.gs',
  'src/core/Outbox.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Tag.gs',
  'src/core/Template.gs',
  'src/core/Member.gs',
  'src/core/Usage.gs',
  'src/core/Issue.gs',
  'src/core/IssueComment.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Inquiry.gs',
  'src/core/Brand.js',
  'src/core/Notifier.gs',
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

  /*
   * 開いたあとで同じ文書が Docs で直されても、保存すると body.clear() で
   * 丸ごと上書きし、その人の編集が黙って消えていた。記録 (apiCommit) には
   * 「開いたあとで進んでいないか」の検査があるのに、ここには無かった。
   */
  it('開いたあとで文書が直されていたら、上書きしない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    const opened = ctx.apiGetMarkdown(workFileId);
    fake._docs.set(workFileId, '<p>Docs で直接足した段落</p>\n');

    expect(() => ctx.apiSaveMarkdown(workFileId, '# 上書き\n', opened.baseSha))
      .toThrow(/開いたあとで/);
    expect(fake._docs.get(workFileId)).toBe('<p>Docs で直接足した段落</p>\n');
  });

  it('続けて保存できる', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    const opened = ctx.apiGetMarkdown(workFileId);
    const first = ctx.apiSaveMarkdown(workFileId, '# 1回目\n', opened.baseSha);
    expect(() => ctx.apiSaveMarkdown(workFileId, '# 2回目\n', first.baseSha)).not.toThrow();
  });

  it('指紋を持たない呼び方は、これまでどおり通す', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    // コマンドキューの writeMarkdown など
    ctx.apiSaveMarkdown(workFileId, '# 手元から\n');
    expect(fake._docs.get(workFileId)).toBe('<h1>手元から</h1>\n');
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
      .toThrow(/「正式版」の .+ に記録していない変更があります/);

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
    expect(commits[1].message).toContain('改訂版「改訂」を作成');
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
    env.issue = issue;
    env.ctx.apiIssueUpdate(issue.number, {
      assignee: 'a@example.com', dueDate: '2026-09-30',
    });
    env.ctx.apiIssueArchive(issue.number);
    env.ctx.apiIssueRestore(issue.number);
    env.ctx.apiInquiryCreate('bug', '棒が伸びない', '画面: 工程表');
    env.ctx.apiInquiryReply(1, 'こちらでも起きます');

    env.ctx.branchCreate('改訂', env.fileId);

    // 確認依頼まで作る。やりとりが空だと Date の混入を見逃す
    const work = env.ctx.branchWorkingFileId('改訂', env.fileId);
    env.fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    env.ctx.commitFile(work, '改訂', '第2条を足した', null);

    env.pr = env.ctx.apiPrCreate('第2条の追加', '補足', '改訂', env.fileId);
    env.ctx.apiPrReview(env.pr.number, 'comment', 'ここを直してください');
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
    ['apiCommitHistory', (ctx, env) => ctx.apiCommitHistory(env.fileId)],
    ['apiDirtyFiles', (ctx) => ctx.apiDirtyFiles('改訂')],
    ['apiIssueArchivedList', (ctx) => ctx.apiIssueArchivedList()],
    ['apiInquiryList', (ctx) => ctx.apiInquiryList()],
    ['apiInquiryKinds', (ctx) => ctx.apiInquiryKinds()],
    ['apiInquiryThread', (ctx) => ctx.apiInquiryThread(1)],
    ['apiPrReviews', (ctx, env) => ctx.apiPrReviews(env.pr.number)],
    ['apiPrCommits', (ctx, env) => ctx.apiPrCommits(env.pr.number)],
    ['apiPrPreview', (ctx, env) => ctx.apiPrPreview(env.pr.number)],
    ['apiWorkspace', (ctx) => ctx.apiWorkspace()],
    ['apiIssueComments', (ctx, env) => ctx.apiIssueComments(env.issue.number)],
    // 消す側も走査する。返す形を間違えても、成功した以上は気づかれない
    ['apiPrClose', (ctx, env) => ctx.apiPrClose(env.pr.number)],
    // 外せるのは改訂版の無いものだけなので、別にもう1つ登録して外す
    ['apiUnregisterFile', (ctx, env) => {
      const id = env.fake._createDoc('賃金規程', '<p>x</p>\n',
        ctx.repoConfig().mainId);
      ctx.repoRegisterFile(id, '賃金規程');
      return ctx.apiUnregisterFile(id);
    }],
  ];

  CASES.forEach(([name, call]) => {
    it(name + ' は Date を含まない', () => {
      const env = prepared();
      expect(unserializable(call(env.ctx, env), name)).toEqual([]);
    });
  });

  /*
   * 台帳の字の欄が日付に化けていても運べるか。
   *
   * 字を ' 付きで書くようにする前は、'10/1' のような題名や記録の文を Sheets が
   * 日付として持っていた。そういう古い行が1つあるだけで、素の値を返している
   * 一覧は画面に null が届き、まるごと出なくなる。
   */
  function corrupted() {
    const env = prepared();
    const cols = env.ctx.DB_SCHEMA();
    const spoil = [
      ['pulls', 'title'], ['pulls', 'author'], ['pulls', 'sourceBranch'],
      ['commits', 'message'], ['commits', 'author'],
      ['branches', 'createdBy'], ['issues', 'title'], ['reviews', 'body'],
      ['inquiries', 'title'], ['issue_comments', 'body'],
    ];
    for (const [table, col] of spoil) {
      const sheet = env.ctx.dbSheet_(table);
      const c = cols[table].indexOf(col) + 1;
      for (let r = 2; r <= sheet.getLastRow(); r++) {
        // 改訂版の名前は引くのに使うので、化けた形では入れない
        if (table === 'pulls' && col === 'sourceBranch') continue;
        sheet.getRange(r, c, 1, 1).setValues([[new Date(2026, 9, 1)]]);
      }
    }
    return env;
  }

  CASES.forEach(([name, call]) => {
    it(name + ' は、化けた行があっても Date を含まない', () => {
      const env = corrupted();
      expect(unserializable(call(env.ctx, env), name)).toEqual([]);
    });
  });

  it('やることは中身も正しく運べる', () => {
    const env = prepared();
    // 報告からも1件作られるので、下ごしらえで作ったほうを名指しする
    const issues = env.ctx.apiIssueList('')
      .filter((i) => i.title === 'やること');

    expect(issues.length).toBe(1);
    expect(issues[0].assignee).toBe('a@example.com');
    expect(typeof issues[0].createdAt).toBe('string');
    expect(issues[0].dueDate).toContain('2026-09-30');
  });
});

describe('改訂版を作って確認を依頼する', () => {
  it('記録が1件も無い文書からでも改訂版を作れる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
    ctx.renderDoc = ctx.liveHtml;
    ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
    ctx.liveCacheInvalidate = () => {};

    const config = ctx.repoInit('agentic-management');
    const fileId = fake._createDoc('新しい規程', '<p>第1条</p>\n', config.mainId);
    ctx.repoRegisterFile(fileId, '新しい規程.doc');

    // 登録しただけで、まだ一度も記録していない状態。
    // mainは保護されていて自分では記録できないため、ここで詰まってはいけない
    expect(ctx.headCommit(fileId, 'main')).toBeNull();
    expect(() => ctx.apiBranchCreate('見直し', fileId)).not.toThrow();
    expect(ctx.headCommit(fileId, 'main')).not.toBeNull();
  });

  it('名前に空白や記号があっても作れる', () => {
    const { ctx, fileId } = setup();
    expect(() => ctx.apiBranchCreate('第7条の見直し (法務確認あり)', fileId)).not.toThrow();
  });

  it('区切り文字は名前に使えない', () => {
    const { ctx, fileId } = setup();
    expect(() => ctx.apiBranchCreate('a/b', fileId)).toThrow(/使えない文字/);
  });

  it('作った改訂版でそのまま確認を依頼できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.apiBranchCreate('見直し', fileId);

    const workFileId = ctx.branchWorkingFileId('見直し', fileId);
    expect(workFileId).toBeTruthy();

    fake._docs.set(workFileId, '<p>第1条 改訂</p>\n');
    ctx.commitFile(workFileId, '見直し', '直した', null);

    const pr = ctx.apiPrCreate('第1条を直した', '', '見直し', fileId);
    expect(pr.number).toBe(1);
    expect(() => ctx.apiPrPreview(pr.number)).not.toThrow();
  });
});

describe('やりとりを画面に渡す形', () => {
  function withPr() {
    const env = setup();
    const { ctx, fileId } = env;
    ctx.branchCreate('改訂', fileId);

    const work = ctx.branchWorkingFileId('改訂', fileId);
    env.fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    ctx.commitFile(work, '改訂', '第2条を足した', null);

    env.pr = ctx.apiPrCreate('第2条の追加', '補足', '改訂', fileId);
    return env;
  }

  it('直せるかどうかは画面ではなくここで決める', () => {
    const { ctx, pr } = withPr();
    ctx.apiPrReview(pr.number, 'comment', 'じぶんの');

    const [row] = ctx.apiPrReviews(pr.number);
    expect(row.canEdit).toBe(true);
    expect(typeof row.id).toBe('number');
  });

  it('他人のコメントは直せない印になる', () => {
    const { ctx, pr } = withPr();
    const a = ctx.apiPrReview(pr.number, 'comment', 'ひとの');
    ctx.dbUpdate('reviews', 'id', ctx.dbReadAll('reviews')[0].id,
      { reviewer: 'other@example.com' });

    expect(ctx.apiPrReviews(pr.number)[0].canEdit).toBe(false);
    expect(a).toBeTruthy();
  });

  it('確認してもらう人が一覧に入る', () => {
    const { ctx, pr } = withPr();
    ctx.apiPrSetReviewers(pr.number, ['a@example.com']);

    const row = ctx.apiPrList().filter((p) => p.number === pr.number)[0];
    expect(row.reviewers).toEqual(['a@example.com']);
  });
});

describe('番号を持たない古いやりとり', () => {
  function withPr() {
    const env = setup();
    const { ctx, fileId } = env;
    ctx.branchCreate('改訂', fileId);

    const work = ctx.branchWorkingFileId('改訂', fileId);
    env.fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    ctx.commitFile(work, '改訂', '第2条を足した', null);

    env.pr = ctx.apiPrCreate('第2条の追加', '補足', '改訂', fileId);
    return env;
  }

  /** 番号の列を足す前に書かれた行を作る */
  function blankOutIds(ctx) {
    const cols = ctx.DB_SCHEMA().reviews;
    const sheet = ctx.dbSheet_('reviews');
    const last = sheet.getLastRow();
    const idCol = cols.indexOf('id') + 1;

    const values = sheet.getRange(2, idCol, last - 1, 1).getValues();
    values.forEach((r) => { r[0] = ''; });
    sheet.getRange(2, idCol, last - 1, 1).setValues(values);
  }

  it('読むときに番号を埋める', () => {
    const { ctx, pr } = withPr();
    ctx.apiPrReview(pr.number, 'comment', 'ふるいもの');
    blankOutIds(ctx);

    const [row] = ctx.apiPrReviews(pr.number);

    expect(row.id).toBeGreaterThan(0);
    expect(row.canEdit).toBe(true);
  });

  it('埋めた番号で直せる', () => {
    const { ctx, pr } = withPr();
    ctx.apiPrReview(pr.number, 'comment', 'まえ');
    blankOutIds(ctx);

    const [row] = ctx.apiPrReviews(pr.number);
    ctx.apiReviewEdit(row.id, 'あと');

    expect(ctx.apiPrReviews(pr.number)[0].body).toBe('あと');
  });

  it('埋めた番号は重ならない', () => {
    const { ctx, pr } = withPr();
    ctx.apiPrReview(pr.number, 'comment', 'ひとつめ');
    ctx.apiPrReview(pr.number, 'comment', 'ふたつめ');
    blankOutIds(ctx);
    ctx.apiPrReviews(pr.number);

    ctx.apiPrReview(pr.number, 'comment', 'みっつめ');

    const ids = ctx.apiPrReviews(pr.number).map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('番号が無いあいだは直せる印を出さない', () => {
    const { ctx, pr } = withPr();
    ctx.apiPrReview(pr.number, 'comment', 'ばんごうなし');
    blankOutIds(ctx);

    // 押せるのに必ず失敗するボタンを出さない
    const rows = ctx.dbReadAll('reviews');
    expect(rows[0].id).toBe('');
  });
});

describe('工数の集計で見えるもの', () => {
  function withEffort() {
    const env = setup();
    const { ctx } = env;

    function make(title, assignee, planned, actual) {
      const issue = ctx.issueCreate(title, '', []);
      ctx.issueUpdate(issue.number, {
        assignee: assignee, plannedHours: planned, actualHours: actual,
        dueDate: '2026-09-10',
      });
      return issue.number;
    }

    make('自分の', 'tester@example.com', 3, 4);
    make('部下の', 'buka@example.com', 2, 1);
    make('他人の', 'hoka@example.com', 5, 5);
    make('担当なしの', '', 1, 1);

    return env;
  }

  it('全体の合計は誰でも見られる', () => {
    const { ctx } = withEffort();
    const res = ctx.apiTallyEffort('month', 'due', '');

    // 監視されている感は人ごとの内訳から出る。全体の数は共有してよい
    expect(res.total.planned).toBe(11);
    expect(res.periods[0].sum.planned).toBe(11);
  });

  it('人ごとの内訳は自分のぶんだけ', () => {
    const { ctx } = withEffort();
    const res = ctx.apiTallyEffort('month', 'due', '');

    expect(res.people.map((p) => p.who).sort())
      .toEqual(['(担当なし)', 'tester@example.com']);
  });

  it('区切りの中の内訳も絞る', () => {
    const { ctx } = withEffort();
    const res = ctx.apiTallyEffort('month', 'due', '');

    expect(Object.keys(res.periods[0].byPerson).sort())
      .toEqual(['(担当なし)', 'tester@example.com']);
  });

  it('上長は下のぶんも見られる', () => {
    const { ctx } = withEffort();
    ctx.memberSet('buka@example.com', 'tester@example.com');

    const res = ctx.apiTallyEffort('month', 'due', '');
    expect(res.people.map((p) => p.who)).toContain('buka@example.com');
  });

  it('見えていない件数を伝える', () => {
    const { ctx } = withEffort();
    const res = ctx.apiTallyEffort('month', 'due', '');

    // 合計と内訳が合わない理由が分からないほうが不安になる
    expect(res.hidden).toBe(2);
  });

  it('見てよい人だけ名指しできる', () => {
    const { ctx } = withEffort();

    expect(() => ctx.apiTallyEffort('month', 'due', 'hoka@example.com'))
      .toThrow(/見られません/);
    expect(() => ctx.apiTallyEffort('month', 'due', 'tester@example.com'))
      .not.toThrow();
  });

  it('見てよい人を返す', () => {
    const { ctx } = withEffort();
    ctx.memberSet('buka@example.com', 'tester@example.com');

    const scope = ctx.apiTallyScope();
    expect(scope.me).toBe('tester@example.com');
    expect(scope.isManager).toBe(true);
    expect(scope.canSee).toContain('buka@example.com');
  });

  it('上下関係を変えられるのは管理者だけ', () => {
    const { ctx } = withEffort();
    ctx.DriveApp.getFolderById(ctx.repoConfig().rootId)
      ._setOwner('owner@example.com');

    // 誰でも書き換えられると、自分を上長にして他人の数字を覗ける
    expect(() => ctx.apiMemberSet('a@example.com', 'tester@example.com'))
      .toThrow(/管理者/);
  });
});

describe('2人で持つ仕事の集計', () => {
  function shared() {
    const env = setup();
    const { ctx } = env;

    const issue = ctx.issueCreate('ふたりで', '', []);
    ctx.issueUpdate(issue.number, {
      assignee: 'tester@example.com,aite@example.com',
      plannedHours: 4, actualHours: 6, dueDate: '2026-09-10',
    });
    return env;
  }

  it('全体には1件ぶんだけ足す', () => {
    const { ctx } = shared();
    const res = ctx.apiTallyEffort('month', 'due', '');

    // それぞれに全部を足すと、人ごとの合計を足しても全体に戻らない
    expect(res.total.planned).toBe(4);
    expect(res.total.actual).toBe(6);
  });

  it('人ごとには頭数で割って足す', () => {
    const { ctx } = shared();
    const res = ctx.apiTallyEffort('month', 'due', '');
    const mine = res.people.filter((p) => p.who === 'tester@example.com')[0];

    expect(mine.total.planned).toBe(2);
    expect(mine.total.actual).toBe(3);
  });

  it('相手のぶんは見えない', () => {
    const { ctx } = shared();
    const res = ctx.apiTallyEffort('month', 'due', '');

    expect(res.people.map((p) => p.who)).toEqual(['tester@example.com']);
    expect(res.hidden).toBe(1);
  });

  it('担当が2人とも名簿に入る', () => {
    const { ctx } = shared();

    expect(ctx.apiKnownPeople()).toContain('aite@example.com');
  });

  it('画面に渡す形では配列にもする', () => {
    const { ctx } = shared();
    const [row] = ctx.apiIssueList('');

    expect(row.assignees).toEqual(['tester@example.com', 'aite@example.com']);
  });
});

describe('画面から文書を登録する', () => {
  it('入れ物にあって、まだ登録していないものを返す', () => {
    const env = setup();
    const { ctx, fake } = env;
    const config = ctx.repoConfig();

    fake._createDoc('賃金規程', '<p>第1条</p>\n', config.mainId);

    // 既に登録済みのものは出さない
    const found = ctx.apiFoundFiles();
    expect(found.map((f) => f.name)).toEqual(['賃金規程']);
    expect(found[0].ok).toBe(true);
    expect(found[0].type).toBe('doc');
  });

  it('扱えない形のものは理由を添えて返す', () => {
    const env = setup();
    const config = env.ctx.repoConfig();

    env.fake.DriveApp.getFolderById(config.mainId)
      .createFile('めも.txt', 'x', 'text/plain');

    const found = env.ctx.apiFoundFiles();
    expect(found[0].ok).toBe(false);
    expect(found[0].why).toContain('扱えません');
  });

  it('まとめて登録できる', () => {
    const env = setup();
    const config = env.ctx.repoConfig();
    const a = env.fake._createDoc('賃金規程', '<p>a</p>\n', config.mainId);
    const b = env.fake._createDoc('育児規程', '<p>b</p>\n', config.mainId);

    const res = env.ctx.apiRegisterFiles([a, b]);

    expect(res.added).toHaveLength(2);
    expect(res.failed).toEqual([]);
    expect(env.ctx.apiFoundFiles()).toEqual([]);
  });

  it('1つ失敗しても残りは登録する', () => {
    const env = setup();
    const config = env.ctx.repoConfig();
    const ok = env.fake._createDoc('賃金規程', '<p>a</p>\n', config.mainId);

    const res = env.ctx.apiRegisterFiles(['ないファイル', ok]);

    expect(res.added).toHaveLength(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].error).toBeTruthy();
  });

  it('入れ物を開く場所を返す', () => {
    const env = setup();

    expect(env.ctx.apiMainFolderUrl())
      .toContain('drive.google.com/drive/folders/');
  });
});

describe('報告の一覧を1回で組む', () => {
  /*
   * 1件ごとに持ち主 (Drive) と返信の表を読んでいたため、報告が増えるほど
   * 一覧が遅くなっていた。持ち主も返信の数も一覧で1回だけ求める。
   */
  it('件数が増えても持ち主と返信は1回しか見に行かない', () => {
    const { ctx } = setup();
    for (let i = 0; i < 4; i++) ctx.inquiryCreate('bug', '動かない' + i, '');
    ctx.inquiryReply(1, 'こちらでも起きます', []);

    const real = { owner: ctx.repoOwnerEmail, read: ctx.dbReadAll };
    let owners = 0;
    let replyReads = 0;
    ctx.repoOwnerEmail = () => { owners++; return real.owner(); };
    ctx.dbReadAll = (t) => {
      if (t === 'inquiry_replies') replyReads++;
      return real.read(t);
    };

    const list = ctx.apiInquiryList();
    expect(list).toHaveLength(4);
    expect(list.find((x) => x.number === 1).replyCount).toBe(1);
    expect(list.find((x) => x.number === 2).replyCount).toBe(0);
    expect(owners).toBe(1);
    expect(replyReads).toBe(1);
  });
});

describe('やることを作るときに一緒に入れるもの', () => {
  /*
   * 先に作ってから担当や優先度を入れていたため、後半で断られると、作られて
   * いるのに画面には失敗と出た。人はもう一度作るので、同じものが2つ並ぶ。
   */
  it('入れられないものがあれば、作らずに断る', () => {
    const { ctx } = setup();
    const before = ctx.dbReadAll('issues').length;

    expect(() => ctx.apiIssueCreate('棚卸し', '', [], '', { assignee: '名前だけ' }))
      .toThrow(/メールアドレス/);
    expect(() => ctx.apiIssueCreate('棚卸し', '', [], '', { priority: '至急' }))
      .toThrow(/知らない優先度/);

    expect(ctx.dbReadAll('issues')).toHaveLength(before);
    expect(ctx.dbReadAll('project_items')).toHaveLength(0);
  });

  it('入れられるものは、作った1件にそのまま入る', () => {
    const { ctx } = setup();
    const made = ctx.apiIssueCreate('棚卸し', '', [], '',
      { assignee: 'a@example.com', priority: 'high' });

    expect(made.assignee).toBe('a@example.com');
    expect(made.priority).toBe('high');
  });
});

describe('確認依頼の記録の並び', () => {
  it('変更セットの全部の文書の記録を出す', () => {
    const { ctx, fake, fileId } = setup();
    const other = fake._createDoc('賃金規程', '<p>B1</p>\n', ctx.repoConfig().mainId);
    ctx.repoRegisterFile(other, '賃金規程.doc');
    ctx.commitFile(other, 'main', 'Bの初期', null);

    ctx.branchCreate('改訂', fileId);
    ctx.branchAddFile('改訂', other);
    const wa = ctx.branchWorkingFileId('改訂', fileId);
    const wb = ctx.branchWorkingFileId('改訂', other);
    fake._docs.set(wa, '<p>第1条</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '改訂', 'Aを直した', null);
    fake._docs.set(wb, '<p>B1</p>\n<p>B2</p>\n');
    ctx.commitFile(wb, '改訂', 'Bを直した', null);

    const pr = ctx.apiPrCreate('両方', '', '改訂', [fileId, other]);
    const messages = ctx.apiPrCommits(pr.number).map((c) => c.message);

    // 1つ目の文書しか見ていなかったため、B の記録が出なかった
    expect(messages).toContain('Aを直した');
    expect(messages).toContain('Bを直した');
  });
});

describe('エディタ専用の関数は、持ち主以外には動かない', () => {
  /*
   * 末尾が _ でない関数は、画面の google.script.run から直に呼べる。今は
   * 持ち主しか開けない設定だが、executeAs: ME で共有すると、利用者の誰もが
   * 持ち主の権限で呼べる。自己承認の解禁やリポジトリの作り直しは塞ぐ。
   */
  const NAMES = [
    'debugEnableSelfApprove', 'debugDisableSelfApprove', 'debugRegisterFile',
    'debugRenderDoc', 'debugLiveHtml', 'debugInspectImages', 'debugEnsureMainBranch',
    'debugWriteRoundTrip', 'debugCleanupLastVerify', 'debugVerifyPhase2',
    'debugVerifyPhase3b', 'debugMarkdownRoundTrip', 'setupCommandQueue',
    'debugVerifyCommandQueue', 'debugCleanupVerifyIssues', 'debugDumpIssues',
    'debugListWorkingCopies', 'debugFindConvertedCells', 'debugVerifyScrum',
  ];

  for (const name of NAMES) {
    it(name, () => {
      const { ctx, fake } = setup();
      fake._setUser('someone@example.com');

      expect(() => ctx[name]()).toThrow(/持ち主だけ/);
    });
  }

  it('持ち主なら自己承認を切り替えられる', () => {
    const { ctx } = setup();
    ctx.debugEnableSelfApprove();
    expect(ctx.PropertiesService.getScriptProperties().getProperty('ALLOW_SELF_APPROVE'))
      .toBe('true');
    ctx.debugDisableSelfApprove();
  });

  it('リポジトリを作り直さない', () => {
    const { ctx } = setup();
    const before = ctx.repoConfig().rootId;

    // 作り直すと、道具が空のリポジトリを指し、これまでの記録が見えなくなる
    expect(() => ctx.setupRepo()).toThrow(/既に/);
    expect(ctx.repoConfig().rootId).toBe(before);
  });
});

describe('改訂版を捨てられる人', () => {
  it('作った本人は捨てられる', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    expect(() => ctx.apiBranchDelete('改訂')).not.toThrow();
  });

  it('ほかの人は捨てられない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    fake._setUser('someone@example.com');

    // 作業コピーをゴミ箱に入れるので、取り下げと同じく本人か持ち主に絞る
    expect(() => ctx.apiBranchDelete('改訂')).toThrow(/作った本人か/);
    expect(ctx.dbFindOne('branches', 'name', '改訂').state).toBe('open');
  });

  it('持ち主は、ほかの人の改訂版も捨てられる', () => {
    const { ctx, fake, fileId } = setup();
    fake._setUser('someone@example.com');
    ctx.branchCreate('改訂', fileId);
    fake._setUser('tester@example.com');

    expect(() => ctx.apiBranchDelete('改訂')).not.toThrow();
  });
});

describe('使われ方で見えるもの', () => {
  function used(ctx, fake) {
    fake.Utilities.formatDate = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
    for (const who of ['tester@example.com', 'boss@example.com', 'other@example.com']) {
      fake._setUser(who);
      ctx.usageRecord([{ kind: 'action', target: 'issue-create-btn', count: 2 }]);
    }
  }

  it('人ごとの数は、本人と部下のぶんだけ', () => {
    const { ctx, fake } = setup();
    used(ctx, fake);
    ctx.memberSet('tester@example.com', 'boss@example.com', '');

    fake._setUser('boss@example.com');
    const res = ctx.apiUsageSummary(30, '');
    expect(res.byUser.map((u) => u.who).sort())
      .toEqual(['boss@example.com', 'tester@example.com']);
  });

  it('見てはいけない人には絞り込めない', () => {
    const { ctx, fake } = setup();
    used(ctx, fake);
    fake._setUser('tester@example.com');

    expect(() => ctx.apiUsageSummary(30, 'other@example.com')).toThrow(/見られません/);
  });

  it('場所ごとの合計は、誰が見ても全員ぶん', () => {
    const { ctx, fake } = setup();
    used(ctx, fake);
    fake._setUser('tester@example.com');

    expect(ctx.apiUsageSummary(30, '').total).toBe(6);
  });
});

describe('実機確認の片付け', () => {
  /*
   * 開いた確認依頼がある改訂版は捨てられない (branchDelete が断る)。片付けが
   * 改訂版を先に捨てようとすると、検証が途中で落ちて依頼が開いたまま残った
   * ときに作業コピーがゴミ箱に入らず、台帳の行だけ消えて Drive に置き去りになる。
   */
  it('確認依頼が開いたままでも、作業コピーをゴミ箱に入れる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('verify-x', fileId);
    const work = ctx.branchWorkingFileId('verify-x', fileId);
    fake._docs.set(work, '<p>第1条</p>\n<p>足した</p>\n');
    ctx.commitFile(work, 'verify-x', '足した', null);
    const pr = ctx.prCreate('検証', '', 'verify-x', fileId);

    ctx.debugCleanupVerify_('verify-x', null, work, pr.number);

    expect(fake.DriveApp.getFileById(work).isTrashed()).toBe(true);
    expect(ctx.dbFindOne('pulls', 'number', pr.number)).toBeNull();
  });
});

describe('Drive で消された文書は一覧に出さない', () => {
  /*
   * 一覧は台帳だけから作っていて、Drive に文書がまだあるかを見ていなかった。
   * 消した文書が残り続け、完全に消したものは開くと「開けませんでした」になる。
   * 台帳の行と履歴は残す (ゴミ箱から戻せば、また出る)。
   */
  const paths = (ctx) => ctx.apiListFiles().map((f) => f.path);

  it('ゴミ箱に入れた正式版の文書は出さない', () => {
    const { ctx, fake, fileId } = setup();
    fake.DriveApp.getFileById(fileId).setTrashed(true);

    expect(paths(ctx)).not.toContain('就業規則.doc');
    expect(ctx.apiOverview().docs).toBe(0);
    // 台帳と履歴は残す
    expect(ctx.dbFindOne('files', 'fileId', fileId)).not.toBeNull();
    expect(ctx.headCommit(fileId, 'main')).not.toBeNull();
  });

  it('ゴミ箱から戻せば、また出る', () => {
    const { ctx, fake, fileId } = setup();
    fake.DriveApp.getFileById(fileId).setTrashed(true);
    fake.DriveApp.getFileById(fileId).setTrashed(false);

    expect(paths(ctx)).toContain('就業規則.doc');
  });

  it('完全に消した文書も出さない', () => {
    const { ctx, fake, fileId } = setup();
    fake._purgeFile(fileId);

    expect(paths(ctx)).not.toContain('就業規則.doc');
  });

  it('ゴミ箱に入れた作業コピーも出さない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const work = ctx.branchWorkingFileId('改訂', fileId);
    fake.DriveApp.getFileById(work).setTrashed(true);

    expect(paths(ctx)).toContain('就業規則.doc');
    expect(paths(ctx)).not.toContain('branches/改訂/就業規則.doc');
  });

  it('元の文書が消えていれば、その作業コピーも出さない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    fake.DriveApp.getFileById(fileId).setTrashed(true);

    // 作業コピーは Drive に残っていても、反映先が無いので扱えない
    expect(paths(ctx)).not.toContain('branches/改訂/就業規則.doc');
  });

  it('中の文書が全部見えなくなった改訂版は、改訂版の一覧に出さない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    expect(ctx.apiBranchList().map((b) => b.name)).toContain('改訂');

    fake.DriveApp.getFileById(fileId).setTrashed(true);

    expect(ctx.apiBranchList().map((b) => b.name)).not.toContain('改訂');
    // 正式版は消えない
    expect(ctx.apiBranchList().map((b) => b.name)).toContain('main');
  });

  it('文書が1つでも残っていれば、改訂版は出す', () => {
    const { ctx, fake, fileId } = setup();
    const other = fake._createDoc('賃金規程', '<p>B</p>\n', ctx.repoConfig().mainId);
    ctx.repoRegisterFile(other, '賃金規程.doc');
    ctx.commitFile(other, 'main', 'B', null);
    ctx.branchCreate('改訂', fileId);
    ctx.branchAddFile('改訂', other);

    fake.DriveApp.getFileById(fileId).setTrashed(true);

    expect(ctx.apiBranchList().map((b) => b.name)).toContain('改訂');
    expect(paths(ctx)).toContain('branches/改訂/賃金規程.doc');
  });

  it('正式版のフォルダの外に移しただけなら出す', () => {
    const { ctx, fake, fileId } = setup();
    const elsewhere = fake.DriveApp.getRootFolder();
    elsewhere.addFile(fake.DriveApp.getFileById(fileId));

    // 消えたわけではない。見当たらないものは1つずつ確かめる
    expect(paths(ctx)).toContain('就業規則.doc');
  });
});

describe('作業コピーの一覧 (実機確認の下ごしらえ)', () => {
  /*
   * debugWriteRoundTrip は、書き換えてよい作業コピーの fileId を要る。画面から
   * URL を写す手順は手間がかかるので、エディタから一覧を出せるようにする。
   * 書き換える対象は人が選ぶ。勝手に選ばない。
   */
  it('改訂版ごとの作業コピーと fileId を出す', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const work = ctx.branchWorkingFileId('改訂', fileId);

    const text = ctx.debugListWorkingCopies();

    expect(text).toContain('改訂');
    expect(text).toContain('就業規則.doc');
    expect(text).toContain(work);
    // 書き換える関数の入れ方も添える
    expect(text).toContain('DEBUG_WRITE_FILE_ID');
  });

  it('Drive で消えた作業コピーには、そう書く', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const work = ctx.branchWorkingFileId('改訂', fileId);
    fake.DriveApp.getFileById(work).setTrashed(true);

    expect(ctx.debugListWorkingCopies()).toContain('Drive に無い');
  });
});

describe('台帳の main の行を自分で入れる', () => {
  /*
   * main の行を台帳に入れるようになる前のリポジトリには、行が無い。無くても
   * 動くように直したが、形が新しいリポジトリと食い違ったままになる。人に
   * エディタで実行させずに、1日1回の片付けで入れる。
   */
  it('無ければ入れ、あれば何もしない', () => {
    const { ctx } = setup();
    ctx.dbDelete('branches', 'name', 'main');

    expect(ctx.repoEnsureMainBranch()).toBe(true);
    expect(ctx.dbFindOne('branches', 'name', 'main').state).toBe('open');

    expect(ctx.repoEnsureMainBranch()).toBe(false);
    expect(ctx.dbReadAll('branches').filter((b) => b.name === 'main')).toHaveLength(1);
  });

  it('1日1回の片付けで入る', () => {
    const { ctx } = setup();
    ctx.dbDelete('branches', 'name', 'main');

    ctx.housekeepArchiveDaily_();
    expect(ctx.dbFindOne('branches', 'name', 'main')).not.toBeNull();
  });
});

describe('以前に化けた字を探す', () => {
  /*
   * 字を ' 付きで書くようにする前は、題名や記録の文の '1/2' が日付に、'007' が
   * 7 に変わって台帳に入った。元の字は残っていないので戻せないが、どこに
   * あるかは探せる。直すのは人。
   */
  it('字の欄に入った日付と数を挙げる', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('ふつうの題', '', []);
    const cols = ctx.DB_SCHEMA().issues;
    const sheet = ctx.dbSheet_('issues');
    const row = ctx.dbReadAll('issues').findIndex((r) => r.number === made.number) + 2;
    sheet.getRange(row, cols.indexOf('title') + 1, 1, 1).setValues([[new Date(2026, 0, 2)]]);
    sheet.getRange(row, cols.indexOf('body') + 1, 1, 1).setValues([[7]]);

    const text = ctx.debugFindConvertedCells();

    expect(text).toContain('issues');
    expect(text).toContain('#' + made.number);
    expect(text).toContain('title');
    expect(text).toContain('body');
  });

  it('日付や数を入れる欄は挙げない', () => {
    const { ctx } = setup();
    ctx.issueCreate('題', '', []);

    // createdAt (日時) や number (番号) が日付・数なのは正しい
    expect(ctx.debugFindConvertedCells()).toContain('見つかりませんでした');
  });

  it('持ち主だけが動かせる', () => {
    const { ctx, fake } = setup();
    fake._setUser('someone@example.com');
    expect(() => ctx.debugFindConvertedCells()).toThrow(/持ち主だけ/);
  });
});
