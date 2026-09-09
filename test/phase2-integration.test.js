import { describe, it, expect, beforeEach } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/**
 * Phase 2 の「組み立ての層」(commit / branch / PR / merge / 書き戻し) を
 * ローカルで通しで実行する統合テスト。
 *
 * Docs の描画と書き戻しだけは fileId → 正規化HTML の写像に置き換える。
 * 描画の忠実さは Phase 1 で実機検証済みで、ここで確かめたいのは
 * 「どの順序で、どの条件を満たしたときに書き戻すか」だから。
 */

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/ObjectStore.gs',
  'src/core/Normalize.js',
  'src/core/Diff.js',
  'src/core/Merge.js',
  'src/core/Commit.gs',
  'src/core/Branch.gs',
  'src/render/HtmlWriter.gs',
  'src/core/PullRequest.gs',
  // PullRequest.gs は Issue とボードと通知を呼ぶ。GAS は全ファイルを
  // 同じグローバルに読むため、テストでも同じ集合を読ませる
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Issue.gs',
  'src/core/Project.gs',
  'src/core/Inquiry.gs',
  'src/core/Notifier.gs',
];

const P1 = '<p>第1条 目的</p>';
const P2 = '<p>第2条 勤務時間</p>';
const P3 = '<p>始業は9時、終業は18時とする。</p>';

/** @param {string[]} lines */
function html(lines) {
  return lines.join('\n') + '\n';
}

/**
 * リポジトリを初期化し、main に Doc を1つ登録して初期コミットまで進める。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);

  // Docs の入出力を差し替える。ここだけが実機と異なる
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  const mainFileId = fake._createDoc('就業規則', html([P1, P2, P3]), config.mainId);
  ctx.repoRegisterFile(mainFileId, '就業規則.doc');
  ctx.commitFile(mainFileId, 'main', '初期状態', null);

  return { ctx, fake, mainFileId };
}

/**
 * ブランチを作り、ブランチ側と main 側をそれぞれ書き換えてコミットする。
 *
 * @returns {{workFileId:string}}
 */
function divergeBranch(ctx, fake, mainFileId, branchHtml, mainHtml) {
  ctx.branchCreate('改訂', mainFileId);
  const workFileId = ctx.branchWorkingFileId('改訂', mainFileId);

  fake._docs.set(workFileId, branchHtml);
  ctx.commitFile(workFileId, '改訂', 'ブランチ側の変更', null);

  if (mainHtml) {
    fake._docs.set(mainFileId, mainHtml);
    ctx.commitFile(mainFileId, 'main', 'main側の変更', null);
  }
  return { workFileId };
}

describe('Phase 2 統合: コミットからマージまで', () => {
  it('同一行の相反する変更はコンフリクトになり、ブランチ側を選ぶと書き戻される', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(
      ctx, fake, mainFileId,
      html([P1, '<p>第2条 勤務時間 (ブランチ側)</p>', P3]),
      html([P1, '<p>第2条 勤務時間 (main側)</p>', P3])
    );

    const pr = ctx.prCreate('勤務時間の改訂', '', '改訂', mainFileId);
    const preview = ctx.prPreviewMerge(pr.number);

    expect(preview.clean).toBe(false);
    expect(preview.conflicts.length).toBe(1);

    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '確認しました');
    fake._setUser('tester@example.com');

    ctx.prMerge(pr.number, ['theirs']);

    const merged = fake._docs.get(mainFileId);
    expect(merged).toContain('ブランチ側');
    expect(merged).not.toContain('main側');
    expect(merged).toContain('第1条 目的');
  });

  it('衝突しない変更は自動マージされる', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(
      ctx, fake, mainFileId,
      html([P1, P2, P3, '<p>第3条 休日</p>']),
      null
    );

    const pr = ctx.prCreate('第3条を追加', '', '改訂', mainFileId);
    const preview = ctx.prPreviewMerge(pr.number);

    expect(preview.clean).toBe(true);
    expect(preview.problems).toEqual([]);

    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');
    ctx.prMerge(pr.number, []);

    expect(fake._docs.get(mainFileId)).toContain('第3条 休日');
  });

  it('マージ後も同じ fileId が更新される (共有リンクが壊れない)', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(ctx, fake, mainFileId, html([P1, P2, P3, '<p>第3条 休日</p>']), null);

    const pr = ctx.prCreate('第3条を追加', '', '改訂', mainFileId);
    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');
    ctx.prMerge(pr.number, []);

    // 別のDocに差し替わっていないこと。パスが指す fileId が変わらず、
    // その fileId のDocが生きていて、マージ結果を持っていることを見る
    const row = ctx.dbFindOne('files', 'path', '就業規則.doc');
    expect(row.fileId).toBe(mainFileId);
    expect(ctx.DriveApp.getFileById(mainFileId).isTrashed()).toBe(false);
    expect(fake._docs.get(mainFileId)).toContain('第3条 休日');
  });
});

describe('Phase 2 統合: 書き戻しの安全機構', () => {
  it('実体を取得できない画像を含むマージは拒否され、main は書き換わらない', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(
      ctx, fake, mainFileId,
      html([P1, P2, P3, '<img data-sha="unavailable" alt="壊れた画像">']),
      null
    );

    const pr = ctx.prCreate('画像を追加', '', '改訂', mainFileId);
    const preview = ctx.prPreviewMerge(pr.number);
    expect(preview.problems.length).toBe(1);
    expect(preview.problems[0]).toContain('実体を取得できない画像');

    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');

    const before = fake._docs.get(mainFileId);
    expect(() => ctx.prMerge(pr.number, [])).toThrow(/書き戻せません/);
    expect(fake._docs.get(mainFileId)).toBe(before);
    expect(ctx.prGet(pr.number).state).not.toBe('merged');
  });

  it('コンフリクトがあっても、取得不能な画像は事前に問題として出る', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(
      ctx, fake, mainFileId,
      html([P1, '<p>第2条 勤務時間 (ブランチ側)</p>', P3, '<img data-sha="unavailable" alt="壊れた画像">']),
      html([P1, '<p>第2条 勤務時間 (main側)</p>', P3])
    );

    const pr = ctx.prCreate('画像つきの改訂', '', '改訂', mainFileId);
    const preview = ctx.prPreviewMerge(pr.number);

    // ここが空だと UI のマージボタンが有効のままになり、
    // 押した瞬間にサーバ側の検証で落ちる
    expect(preview.clean).toBe(false);
    expect(preview.problems.length).toBe(1);
    expect(preview.problems[0]).toContain('実体を取得できない画像');
  });

  it('main に未コミットの変更があるとマージを拒否する', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(ctx, fake, mainFileId, html([P1, P2, P3, '<p>第3条 休日</p>']), null);

    // main を直接編集し、コミットせずに放置する
    const draft = html([P1, P2, P3, '<p>まだコミットしていない下書き</p>']);
    fake._docs.set(mainFileId, draft);

    const pr = ctx.prCreate('第3条を追加', '', '改訂', mainFileId);
    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');

    // 未コミットの編集は3-way mergeに参加できないため、
    // 書き戻しで黙って失わせずに手前で止める
    expect(() => ctx.prMerge(pr.number, [])).toThrow(/mainに未コミットの変更があります/);
    expect(fake._docs.get(mainFileId)).toBe(draft);
    expect(ctx.prGet(pr.number).state).not.toBe('merged');

    // main をコミットすればマージできる
    ctx.commitFile(mainFileId, 'main', '下書きをコミット', null);
    expect(() => ctx.prMerge(pr.number, ['theirs'])).not.toThrow();
    expect(fake._docs.get(mainFileId)).toContain('第3条 休日');
  });
});

describe('Phase 2 統合: 楽観的並行制御', () => {
  it('古い headSha でのコミットは拒否され、最新なら通る', () => {
    const { ctx, fake, mainFileId } = setup();
    const staleSha = ctx.headCommit(mainFileId, 'main').sha;

    fake._docs.set(mainFileId, html([P1, P2, '<p>1回目の変更</p>']));
    ctx.commitFile(mainFileId, 'main', '1回目', staleSha);

    fake._docs.set(mainFileId, html([P1, P2, '<p>2回目の変更</p>']));
    expect(() => ctx.commitFile(mainFileId, 'main', '2回目', staleSha))
      .toThrow(/HEADが進んでいます/);

    const current = ctx.headCommit(mainFileId, 'main').sha;
    expect(() => ctx.commitFile(mainFileId, 'main', '2回目', current)).not.toThrow();
  });

  it('内容が変わっていなければ空コミットを作らない', () => {
    const { ctx, mainFileId } = setup();
    expect(() => ctx.commitFile(mainFileId, 'main', '変更なし', null))
      .toThrow(/変更がありません/);
  });
});

describe('Phase 2 統合: 承認のゲート', () => {
  let env;
  beforeEach(() => {
    env = setup();
    divergeBranch(env.ctx, env.fake, env.mainFileId, html([P1, P2, P3, '<p>第3条 休日</p>']), null);
    env.pr = env.ctx.prCreate('第3条を追加', '', '改訂', env.mainFileId);
  });

  it('承認が0件ならマージできない', () => {
    expect(() => env.ctx.prMerge(env.pr.number, [])).toThrow(/1件以上の承認/);
  });

  it('自己承認は既定で拒否される', () => {
    expect(() => env.ctx.prReview(env.pr.number, 'approve', ''))
      .toThrow(/自分が作成したPRは承認できません/);
  });

  it('ALLOW_SELF_APPROVE が true のときだけ自己承認できる', () => {
    env.ctx.PropertiesService.getScriptProperties()
      .setProperty('ALLOW_SELF_APPROVE', 'true');
    expect(() => env.ctx.prReview(env.pr.number, 'approve', '')).not.toThrow();
    expect(env.ctx.prApprovalCount(env.pr.number)).toBe(1);
  });

  it('マージ済みのPRは再度マージできない', () => {
    env.fake._setUser('reviewer@example.com');
    env.ctx.prReview(env.pr.number, 'approve', '');
    env.fake._setUser('tester@example.com');
    env.ctx.prMerge(env.pr.number, []);
    expect(() => env.ctx.prMerge(env.pr.number, [])).toThrow(/既にマージ済み/);
  });
});

describe('Phase 2 統合: ブランチの後始末', () => {
  it('ブランチを削除すると作業コピーが一覧から消える', () => {
    const { ctx, fake, mainFileId } = setup();
    const { workFileId } = divergeBranch(
      ctx, fake, mainFileId, html([P1, P2, P3, '<p>第3条 休日</p>']), null
    );

    const before = ctx.filesVisibleInWiki().map((r) => r.fileId);
    expect(before).toContain(workFileId);

    ctx.branchDelete('改訂');

    const after = ctx.filesVisibleInWiki().map((r) => r.fileId);
    expect(after).not.toContain(workFileId);
    expect(after).toContain(mainFileId);
    expect(ctx.dbFindOne('branches', 'name', '改訂').state).toBe('deleted');
  });

  it('ブランチを削除してもマージ済みPRを開ける', () => {
    const { ctx, fake, mainFileId } = setup();
    divergeBranch(ctx, fake, mainFileId, html([P1, P2, P3, '<p>第3条 休日</p>']), null);

    const pr = ctx.prCreate('第3条を追加', '', '改訂', mainFileId);
    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');
    ctx.prMerge(pr.number, []);

    ctx.branchDelete('改訂');

    // files 行を消すと branchWorkingFileId が解決できなくなり、
    // 履歴として残るはずのPRが二度と開けなくなる
    expect(() => ctx.prPreviewMerge(pr.number)).not.toThrow();
  });

  it('空の値では dbDelete できない', () => {
    const { ctx } = setup();
    expect(() => ctx.dbDelete('files', 'fileId', '')).toThrow(/削除条件の値が空です/);
    expect(() => ctx.dbDelete('files', 'fileId', null)).toThrow(/削除条件の値が空です/);
    expect(ctx.dbReadAll('files').length).toBe(1);
  });

  it('main ブランチは削除できない', () => {
    const { ctx } = setup();
    expect(() => ctx.branchDelete('main')).toThrow(/main ブランチは削除できません/);
  });
});

describe('Phase 2 統合: 履歴の並び', () => {
  it('同じミリ秒に作られたコミットでも親チェーンの順で並ぶ', () => {
    const { ctx, fake, mainFileId } = setup();

    // 疑似GASでは連続実行が同一ミリ秒に収まるため、timestamp だけで
    // 並べる実装ではここで順序が崩れる
    fake._docs.set(mainFileId, html([P1, P2, '<p>2回目</p>']));
    ctx.commitFile(mainFileId, 'main', '2回目', null);
    fake._docs.set(mainFileId, html([P1, P2, '<p>3回目</p>']));
    ctx.commitFile(mainFileId, 'main', '3回目', null);

    const messages = ctx.commitHistory(mainFileId, 'main').map((c) => c.message);
    expect(messages).toEqual(['3回目', '2回目', '初期状態']);
  });
});

describe('やりとりの直しと確認してもらう人', () => {
  function withPr() {
    const env = setup();
    const { ctx, mainFileId } = env;
    ctx.branchCreate('改訂', mainFileId);

    const work = ctx.branchWorkingFileId('改訂', mainFileId);
    env.fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    ctx.commitFile(work, '改訂', '第2条を足した', null);

    env.pr = ctx.prCreate('第2条の追加', '補足', '改訂', mainFileId);
    return env;
  }

  it('コメントには番号が振られる', () => {
    const { ctx, pr } = withPr();
    const a = ctx.prReview(pr.number, 'comment', 'ひとつめ');
    const b = ctx.prReview(pr.number, 'comment', 'ふたつめ');

    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it('自分のコメントは書き直せる', () => {
    const { ctx, pr } = withPr();
    const a = ctx.prReview(pr.number, 'comment', 'まえ');

    const after = ctx.reviewEdit(a.id, 'あと');

    expect(after.body).toBe('あと');
    expect(after.editedAt).not.toBe('');
  });

  it('空にはできない', () => {
    const { ctx, pr } = withPr();
    const a = ctx.prReview(pr.number, 'comment', 'なにか');

    expect(() => ctx.reviewEdit(a.id, '   ')).toThrow(/中身を入力/);
  });

  it('自分のコメントは消せる', () => {
    const { ctx, pr } = withPr();
    const a = ctx.prReview(pr.number, 'comment', '消す');

    ctx.reviewDelete(a.id);

    expect(ctx.dbReadAll('reviews')).toEqual([]);
  });

  it('他人のコメントは直せない', () => {
    const { ctx, pr, fake } = withPr();
    const a = ctx.prReview(pr.number, 'comment', '他人の');
    ctx.dbUpdate('reviews', 'id', a.id, { reviewer: 'other@example.com' });

    expect(() => ctx.reviewEdit(a.id, '書き換え')).toThrow(/自分が書いたもの/);
    expect(() => ctx.reviewDelete(a.id)).toThrow(/自分が書いたもの/);
    expect(fake).toBeTruthy();
  });

  it('承認の記録は直せない', () => {
    const { ctx, pr } = withPr();
    ctx.PropertiesService.getScriptProperties()
      .setProperty('ALLOW_SELF_APPROVE', 'true');
    const a = ctx.prReview(pr.number, 'approve', 'よい');

    // 消せてしまうと、承認が無かったことになったまま反映できる
    expect(() => ctx.reviewEdit(a.id, '取り消し')).toThrow(/承認や差し戻し/);
    expect(() => ctx.reviewDelete(a.id)).toThrow(/承認や差し戻し/);
  });

  it('無い番号は断る', () => {
    const { ctx } = withPr();
    expect(() => ctx.reviewEdit(999, 'なにか')).toThrow(/見つかりません/);
    expect(() => ctx.reviewEdit('', 'なにか')).toThrow(/指定してください/);
  });

  it('確認してもらう人を決められる', () => {
    const { ctx, pr } = withPr();

    ctx.prSetReviewers(pr.number, ['a@example.com', 'b@example.com']);

    expect(ctx.prReviewers(ctx.prGet(pr.number)))
      .toEqual(['a@example.com', 'b@example.com']);
  });

  it('同じ人を二重に入れない', () => {
    const { ctx, pr } = withPr();

    ctx.prSetReviewers(pr.number, ['a@example.com', ' a@example.com ', '']);

    expect(ctx.prReviewers(ctx.prGet(pr.number))).toEqual(['a@example.com']);
  });

  it('メールの形になっていないものは断る', () => {
    const { ctx, pr } = withPr();

    expect(() => ctx.prSetReviewers(pr.number, ['だれか'])).toThrow(/メールアドレス/);
  });

  it('新しく頼んだ人にだけ知らせる', () => {
    const { ctx, pr, fake } = withPr();
    ctx.prSetReviewers(pr.number, ['a@example.com']);

    const before = fake._sentMails().length;
    ctx.prSetReviewers(pr.number, ['a@example.com', 'b@example.com']);

    const sent = fake._sentMails().slice(before);
    expect(sent.map((m) => m.to)).toEqual(['b@example.com']);
  });

});
