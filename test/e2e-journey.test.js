import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/**
 * 何も無いところから一連の流れを通す。
 *
 * 他のテストは setup() で「登録して1回記録した文書」を用意してから
 * 始めていた。そのため「登録しただけで一度も記録していない」状態が
 * どのテストにも現れず、そこから改訂版を作れない行き止まりを
 * 見逃した。行は覆えていても、状態が覆えていなかった。
 *
 * ここでは何も仕込まず、人がたどる順序でそのまま進める。
 */

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs', 'src/core/Repo.gs',
  'src/core/ObjectStore.gs', 'src/core/Normalize.js', 'src/core/Markdown.js',
  'src/core/Diff.js', 'src/core/Merge.js', 'src/core/Graph.js', 'src/core/Gantt.js',
  'src/core/Grouping.js', 'src/core/IssueTree.js', 'src/core/Commit.gs',
  'src/core/Branch.gs', 'src/render/HtmlWriter.gs', 'src/render/SheetRenderer.gs',
  'src/render/SheetWriter.gs', 'src/core/PullRequest.gs', 'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Issue.gs',
  'src/core/IssueBranch.gs', 'src/core/Project.gs', 'src/core/Notifier.gs',
  'src/Main.gs',
];

/** 何も仕込まない。リポジトリを作るだけ */
function bare() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);

  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  return { ctx, fake, config };
}

describe('初めて使う人の一連の流れ', () => {
  it('文書を登録してから正式版に反映するまで通る', () => {
    const { ctx, fake, config } = bare();

    // 1. 文書を置いて登録する。ここでは何も記録しない
    const docId = fake._createDoc('就業規則',
      '<p>第1条 目的</p>\n<p>第2条 勤務時間</p>\n', config.mainId);
    ctx.repoRegisterFile(docId, '就業規則.doc');

    expect(ctx.apiListFiles().length).toBe(1);
    expect(ctx.headCommit(docId, 'main')).toBeNull();

    // 2. 正式版は自分では直せない
    expect(() => ctx.apiCommit(docId, 'こっそり直す', null))
      .toThrow(/保護されています/);
    expect(() => ctx.apiSaveMarkdown(docId, '# 勝手に\n'))
      .toThrow(/保護されています/);

    // 3. 改訂版を作る。記録が無くてもここで詰まらない
    const draft = ctx.apiBranchCreate('第2条の見直し (法務確認あり)', docId);
    expect(draft.name).toBe('第2条の見直し (法務確認あり)');

    const workId = ctx.branchWorkingFileId(draft.name, docId);
    expect(workId).toBeTruthy();

    // 4. 改訂版を Markdown で直して保存する
    const before = ctx.apiGetMarkdown(workId);
    expect(before.editable).toBe(true);

    ctx.apiSaveMarkdown(workId,
      before.markdown.replace('第2条 勤務時間', '第2条 勤務時間 (改訂)'));
    expect(ctx.apiFileStatus(workId).dirty).toBe(true);

    // 5. 変更を記録する
    ctx.apiCommit(workId, '第2条を改訂', ctx.apiFileStatus(workId).headSha);
    expect(ctx.apiFileStatus(workId).dirty).toBe(false);

    // 6. 確認を依頼する
    const pr = ctx.apiPrCreate('第2条の改訂', '', draft.name, docId);
    expect(ctx.apiPrList().length).toBe(1);

    const preview = ctx.apiPrPreview(pr.number);
    expect(preview.clean).toBe(true);
    expect(preview.problems).toEqual([]);

    // 7. 承認がないと反映できない
    expect(() => ctx.apiPrMerge(pr.number, [])).toThrow(/1件以上の承認/);

    fake._setUser('reviewer@example.com');
    ctx.apiPrReview(pr.number, 'approve', '確認しました');
    fake._setUser('tester@example.com');

    // 8. 反映する。fileId は変わらない
    ctx.apiPrMerge(pr.number, []);

    expect(fake._docs.get(docId)).toContain('第2条 勤務時間 (改訂)');
    expect(ctx.dbFindOne('files', 'path', '就業規則.doc').fileId).toBe(docId);
    expect(ctx.apiPrList()[0].state).toBe('merged');

    // 9. 履歴に一連の流れが残っている
    const graph = ctx.apiCommitGraph(docId);
    const messages = graph.rows.map((r) => r.message);

    expect(messages).toContain('最初の記録');
    expect(messages).toContain('第2条を改訂');
    expect(messages.some((m) => m.indexOf('マージ') === 0)).toBe(true);
  });

  it('やることから始めても最後まで通る', () => {
    const { ctx, fake, config } = bare();

    const docId = fake._createDoc('賃金規程', '<p>第1条</p>\n', config.mainId);
    ctx.repoRegisterFile(docId, '賃金規程.doc');

    // 1. やることを作る
    const issue = ctx.apiIssueCreate('通勤手当の見直し', '', [docId]);
    expect(ctx.apiProjectBoard()['Backlog'].length).toBe(1);

    // 2. そこから改訂版を作る。記録が無い文書でも通る
    const draft = ctx.apiIssueCreateBranch(issue.number, docId);
    expect(ctx.apiProjectBoard()['In Progress'].length).toBe(1);

    const workId = ctx.branchWorkingFileId(draft.name, docId);
    fake._docs.set(workId, '<p>第1条 (改訂)</p>\n');
    ctx.apiCommit(workId, '通勤手当を改訂', null);

    // 3. closes を書いて依頼する
    const pr = ctx.apiPrCreate('通勤手当の見直し', 'closes #' + issue.number,
      draft.name, docId);
    expect(ctx.apiProjectBoard()['In Review'].length).toBe(1);

    fake._setUser('reviewer@example.com');
    ctx.apiPrReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');
    ctx.apiPrMerge(pr.number, []);

    // 4. やることが閉じ、カードも動く
    expect(ctx.issueGet(issue.number).state).toBe('closed');
    expect(ctx.apiProjectBoard()['Done'].length).toBe(1);
  });

  it('登録しただけの文書でも画面に必要な値がすべて揃う', () => {
    const { ctx, fake, config } = bare();

    const docId = fake._createDoc('新しい規程', '<p>第1条</p>\n', config.mainId);
    ctx.repoRegisterFile(docId, '新しい規程.doc');

    // 記録が無い状態で、どの画面を開いても落ちてはいけない
    expect(() => ctx.apiOverview()).not.toThrow();
    expect(() => ctx.apiCommitGraph(docId)).not.toThrow();
    expect(() => ctx.apiGetMarkdown(docId)).not.toThrow();
    expect(() => ctx.apiFileStatus(docId)).not.toThrow();
    expect(() => ctx.apiBranchList()).not.toThrow();
    expect(() => ctx.apiPrList()).not.toThrow();
    expect(() => ctx.apiIssueList('')).not.toThrow();
    expect(() => ctx.apiProjectBoard()).not.toThrow();

    expect(ctx.apiCommitGraph(docId).rows).toEqual([]);
    expect(ctx.apiFileStatus(docId).headSha).toBeNull();
  });
});
