import { describe, it, expect } from 'vitest';
import { makeEnv, withPr, expectScreenSafe, expectRefused, snapshotDb, asUser, OWNER, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 確認依頼 (src/api/Pr.gs)。
 *
 * 取り下げられるのは出した本人か管理者。自分の依頼は承認できない。反映は
 * 全件を確かめてからまとめて書き戻す (CLAUDE.md「prMerge の順序を崩してはならない」)。
 */

const DIFF = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1,2 @@\n-a\n+b\n+c\n';

function prEnv(opts) {
  return withPr(makeEnv(), opts);
}

function approveAs(env, who = OTHER) {
  return asUser(env.fake, who, () => env.ctx.apiPrReview(env.pr.number, 'approve', 'よいです'));
}

describe('apiPrCreate / apiPrList', () => {
  it('作ると番号と題名と反映先だけを返し、一覧に並ぶ', () => {
    const env = prEnv();
    expect({ ...env.pr }).toEqual({ number: 1, title: '第2条の追加', targetBranch: 'main' });

    const list = expectScreenSafe(env.ctx.apiPrList());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 1, title: '第2条の追加', sourceBranch: '改訂',
      targetBranch: 'main', state: 'open', author: OWNER, canClose: true });
    expect(list[0].createdAt).toMatch(/T/);
  });

  it('一覧は新しい順', () => {
    const env = prEnv();
    const { ctx, fake, config } = env;
    const second = fake._createDoc('細則', '<p>細則</p>\n', config.mainId);
    ctx.repoRegisterFile(second, '細則.doc');
    ctx.commitFile(second, 'main', '細則', null);
    ctx.apiBranchCreate('細則改訂', second);
    const w = ctx.branchWorkingFileId('細則改訂', second);
    fake._docs.set(w, '<p>細則2</p>\n');
    ctx.commitFile(w, '細則改訂', '直した', null);
    ctx.apiPrCreate('細則', '', '細則改訂', second);
    expect(ctx.apiPrList().map((p) => p.number)).toEqual([2, 1]);
  });

  it('取り下げられるかはサーバが人ごとに決める', () => {
    const env = prEnv();
    const { ctx, fake } = env;
    expect(asUser(fake, OTHER, () => ctx.apiPrList()[0].canClose)).toBe(false);
    expect(asUser(fake, ADMIN, () => ctx.apiPrList()[0].canClose)).toBe(true);
    ctx.apiPrClose(1);
    expect(ctx.apiPrList()[0].canClose).toBe(false);
  });

  it('取り下げの見回りが落ちても、一覧は出す', () => {
    const env = prEnv();
    env.ctx.prWithdrawOrphans = () => { throw new Error('boom'); };
    expect(env.ctx.apiPrList().map((p) => p.number)).toEqual([1]);
  });

  it('元の文書が Drive で消えた依頼は、一覧を開いたときに取り下げる', () => {
    const env = prEnv();
    env.fake.DriveApp.getFileById(env.fileId).setTrashed(true);
    expect(env.ctx.apiPrList()[0].state).toBe('closed');
  });

  it.each([
    ['題名が無い', ['', '', '改訂'], /タイトルを入力してください/],
    ['無い改訂版', ['x', '', '無い'], /改訂版が見つかりません/],
    ['同じ版へ', ['x', '', '改訂', null, '改訂'], /同じ版には反映できません/],
    ['無い反映先', ['x', '', '改訂', null, '無い版'], /反映先の版が見つかりません/],
    ['登録外の文書', ['x', '', '改訂', 'file-x'], /対象ファイルが管理対象にありません/],
  ])('%s は断り、何も作らない', (_name, args, pattern) => {
    const { ctx, fake, fileId } = makeEnv();
    ctx.apiBranchCreate('改訂', fileId);
    const w = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(w, '<p>x</p>\n');
    ctx.commitFile(w, '改訂', 'x', null);
    const full = args.slice();
    if (full.length < 4 || full[3] === null) full[3] = fileId;
    const before = snapshotDb(ctx, ['pulls']);
    expectRefused(() => ctx.apiPrCreate(...full), pattern);
    expect(snapshotDb(ctx, ['pulls'])).toEqual(before);
  });

  it('作業コピーを名指し・同じ組で2つ目・入っていない文書は断る', () => {
    const env = prEnv();
    const { ctx, fake, config, work, fileId } = env;
    expectRefused(() => ctx.apiPrCreate('x', '', '改訂', work), /正式版の文書を選んでください/);
    expectRefused(() => ctx.apiPrCreate('x', '', '改訂', fileId), /閉じていない確認依頼があります: #1/);
    const other = fake._createDoc('細則', '<p>細則</p>\n', config.mainId);
    ctx.repoRegisterFile(other, '細則.doc');
    expectRefused(() => ctx.apiPrCreate('x', '', '改訂', other), /入っていません/);
    expect(ctx.dbReadAll('pulls')).toHaveLength(1);
  });

  it('スライドは反映できないので断る', () => {
    const { ctx, fake } = makeEnv();
    const slides = fake._createSlides('資料', [{ shapes: ['表紙'] }]);
    ctx.repoRegisterFile(slides, '資料.slide');
    ctx.commitFile(slides, 'main', '初期', null);
    ctx.apiBranchCreate('資料改訂', slides);
    expectRefused(() => ctx.apiPrCreate('x', '', '資料改訂', slides), /スライドは反映に対応していません/);
    expect(ctx.dbReadAll('pulls')).toHaveLength(0);
  });

  it.todo('正式版から正式版へ出そうとすると「同じ版には反映できません: main」と、括らない main が断りに出る (src/core/PullRequest.gs の prCreate)');
});

describe('apiPrPreview / apiPrCommits', () => {
  it('全体の判断と文書ごとの中身を、画面に渡せる形で返す', () => {
    const env = prEnv();
    const out = expectScreenSafe(env.ctx.apiPrPreview(1));
    expect(out).toMatchObject({ clean: true, approvals: 0, staleApprovals: 0, patchCount: 0 });
    expect(out.previewSha).toMatch(/^[0-9a-f]{64}$/);
    expect(out.files).toHaveLength(1);
    expect(out.files[0]).toMatchObject({ fileId: env.fileId, path: '就業規則.doc', type: 'doc', clean: true });
    expect(out.ops.some((o) => /第2条/.test(JSON.stringify(o)))).toBe(true);
  });

  it('改訂版の記録を新しい順で返す', () => {
    const env = prEnv();
    const out = expectScreenSafe(env.ctx.apiPrCommits(1));
    expect(out[0]).toMatchObject({ message: '第2条を足した', path: '就業規則.doc' });
    expect(out[0].timestamp).toMatch(/T/);
  });

  it('2つの文書をまとめた依頼は、文書をまたいで新しい順に記録を並べ、見比べも文書ごとに返す', () => {
    const { ctx, fake, config, fileId } = makeEnv();
    const second = fake._createDoc('細則', '<p>細則</p>\n', config.mainId);
    ctx.repoRegisterFile(second, '細則.doc');
    ctx.commitFile(second, 'main', '細則', null);
    ctx.apiBranchCreate('両方', fileId);
    ctx.apiBranchAddFile('両方', second);
    const w1 = ctx.branchWorkingFileId('両方', fileId);
    const w2 = ctx.branchWorkingFileId('両方', second);
    fake._docs.set(w1, '<p>第1条 改</p>\n');
    ctx.commitFile(w1, '両方', '規程を直した', null);
    fake._docs.set(w2, '<p>細則 改</p>\n');
    ctx.commitFile(w2, '両方', '細則を直した', null);
    ctx.apiPrCreate('両方', '', '両方', [fileId, second]);

    const commits = expectScreenSafe(ctx.apiPrCommits(1));
    const stamps = commits.map((c) => c.timestamp);
    expect([...stamps]).toEqual([...stamps].sort().reverse());
    expect(new Set(commits.map((c) => c.path))).toEqual(new Set(['就業規則.doc', '細則.doc']));

    const preview = expectScreenSafe(ctx.apiPrPreview(1));
    expect(preview.files.map((f) => f.path).sort()).toEqual(['就業規則.doc', '細則.doc']);
  });

  it('作業コピーが消えた文書の記録は飛ばす', () => {
    const env = prEnv();
    env.ctx.dbDelete('files', 'fileId', env.work);
    expect(env.ctx.apiPrCommits(1)).toEqual([]);
  });

  it('無い依頼は断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiPrPreview(7), /確認依頼が見つかりません: #7/);
    expectRefused(() => ctx.apiPrCommits(7), /確認依頼が見つかりません/);
  });
});

describe('確認 (apiPrReview / apiPrReviews / apiReviewEdit / apiReviewDelete)', () => {
  it('ほかの人が承認すると数に入り、状態が approved になる', () => {
    const env = prEnv();
    const out = expectScreenSafe(approveAs(env));
    expect({ ...out }).toEqual({ prNumber: 1, state: 'approve' });
    expect(env.ctx.apiPrPreview(1).approvals).toBe(1);
    expect(env.ctx.apiPrList()[0].state).toBe('approved');
  });

  it('自分の依頼は承認できず、記録も残さない', () => {
    const env = prEnv();
    expectRefused(() => env.ctx.apiPrReview(1, 'approve', ''), /自分が出した確認依頼は承認できません/);
    expect(env.ctx.dbReadAll('reviews')).toHaveLength(0);
  });

  it('知らない種別・長すぎる本文・無い依頼は断る', () => {
    const env = prEnv();
    expectRefused(() => env.ctx.apiPrReview(1, 'merge', ''), /不正なレビュー種別です/);
    expectRefused(() => env.ctx.apiPrReview(1, 'comment', 'あ'.repeat(20001)), /20000文字まで/);
    expectRefused(() => env.ctx.apiPrReview(9, 'comment', 'x'), /確認依頼が見つかりません/);
    expect(env.ctx.dbReadAll('reviews')).toHaveLength(0);
  });

  it('取り下げた依頼には確認を足せない (生き返らせない)', () => {
    const env = prEnv();
    env.ctx.apiPrClose(1);
    asUser(env.fake, OTHER, () => {
      expectRefused(() => env.ctx.apiPrReview(1, 'approve', ''), /取り下げられています/);
    });
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).state)).toBe('closed');
  });

  it('やりとりは古い順で、書いた本人のコメントだけ直せる印が付く', () => {
    const env = prEnv();
    const { ctx, fake } = env;
    ctx.apiPrReview(1, 'comment', '自分のコメント');
    asUser(fake, OTHER, () => ctx.apiPrReview(1, 'request_changes', 'ここを直して'));

    const list = expectScreenSafe(ctx.apiPrReviews(1));
    expect(list.map((r) => r.state)).toEqual(['comment', 'request_changes']);
    expect(list.map((r) => r.canEdit)).toEqual([true, false]);
    // 差し戻しをした本人でも、差し戻しの記録は直せる印が付かない
    expect(asUser(fake, OTHER, () => ctx.apiPrReviews(1)[1].canEdit)).toBe(false);
    expect(ctx.apiPrReviews(99)).toEqual([]);
  });

  it('番号の列を足す前の行も、読むときに埋めて名指しできる', () => {
    const env = prEnv();
    const { ctx } = env;
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: OWNER, state: 'comment', body: '昔の', at: new Date() });
    const list = ctx.apiPrReviews(1);
    expect(list[0].id).toBeGreaterThan(0);
    expect(list[0].canEdit).toBe(true);
  });

  it('コメントは本人だけが直せて消せる。承認と差し戻しの記録は直せない', () => {
    const env = prEnv();
    const { ctx, fake } = env;
    ctx.apiPrReview(1, 'comment', '最初');
    const id = ctx.apiPrReviews(1)[0].id;

    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiReviewEdit(id, '横から'), /自分が書いたものだけ直せます/);
      expectRefused(() => ctx.apiReviewDelete(id), /自分が書いたものだけ直せます/);
      ctx.apiPrReview(1, 'approve', 'よい');
      const approveId = ctx.apiPrReviews(1)[1].id;
      expectRefused(() => ctx.apiReviewEdit(approveId, '直す'), /承認や差し戻しの記録は直せません/);
      expectRefused(() => ctx.apiReviewDelete(approveId), /承認や差し戻しの記録は直せません/);
    });

    const edited = expectScreenSafe(ctx.apiReviewEdit(id, '直した'));
    expect(edited).toEqual({ id, body: '直した' });
    expect(ctx.apiPrReviews(1)[0].editedAt).toMatch(/T/);
    expectRefused(() => ctx.apiReviewEdit(id, '  '), /中身を入力してください/);
    expectRefused(() => ctx.apiReviewEdit(id, 'あ'.repeat(20001)), /20000文字まで/);
    expect(ctx.apiReviewDelete(id)).toBe('コメントを消しました');
    expect(ctx.apiPrReviews(1).map((r) => r.state)).toEqual(['approve']);
  });

  it('名指しが無い・無いやりとりは断る', () => {
    const env = prEnv();
    expectRefused(() => env.ctx.apiReviewEdit('', 'x'), /やりとりを指定してください/);
    expectRefused(() => env.ctx.apiReviewDelete(42), /やりとりが見つかりません/);
  });
});

describe('apiPrSetReviewers', () => {
  it('重なりと空欄を落として決め、新しく頼んだ人にだけ知らせる', () => {
    const env = prEnv();
    const { ctx, fake } = env;
    const out = expectScreenSafe(ctx.apiPrSetReviewers(1, [' a@example.com ', 'a@example.com', '', 'b@example.com']));
    expect([...out]).toEqual(['a@example.com', 'b@example.com']);
    const mailsAfterFirst = fake._sentMails().filter((m) => m.to === 'a@example.com').length;

    ctx.apiPrSetReviewers(1, ['a@example.com', 'c@example.com']);
    expect(fake._sentMails().filter((m) => m.to === 'a@example.com').length).toBe(mailsAfterFirst);
    expect(fake._sentMails().some((m) => m.to === 'c@example.com')).toBe(true);
    expect([...ctx.apiPrList()[0].reviewers]).toEqual(['a@example.com', 'c@example.com']);
    expect([...ctx.apiPrSetReviewers(1)]).toEqual([]);
  });

  it('メールアドレスでない・反映済みは断り、宛先を変えない', () => {
    const env = prEnv();
    const { ctx } = env;
    ctx.apiPrSetReviewers(1, ['a@example.com']);
    expectRefused(() => ctx.apiPrSetReviewers(1, ['なまえ']), /メールアドレスの形になっていません/);
    expect([...ctx.apiPrList()[0].reviewers]).toEqual(['a@example.com']);

    approveAs(env);
    ctx.apiPrMerge(1, [], '');
    expectRefused(() => ctx.apiPrSetReviewers(1, ['b@example.com']), /既に反映済みです/);
  });
});

describe('apiPrClose', () => {
  it('出した本人は取り下げられ、改訂版は捨てない', () => {
    const env = prEnv();
    const out = expectScreenSafe(env.ctx.apiPrClose(1));
    expect({ ...out }).toEqual({ number: 1, state: 'closed', title: '第2条の追加' });
    expect(String(env.ctx.dbFindOne('branches', 'name', '改訂').state)).toBe('open');
  });

  it('本人でも管理者でもない人は取り下げられず、状態を変えない', () => {
    const env = prEnv();
    asUser(env.fake, OTHER, () => {
      expectRefused(() => env.ctx.apiPrClose(1), /出した本人か、このアプリの管理者だけが取り下げられます/);
    });
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).state)).toBe('open');
  });

  it('管理者は他人の依頼を取り下げられる', () => {
    const env = prEnv();
    expect(asUser(env.fake, ADMIN, () => env.ctx.apiPrClose(1)).state).toBe('closed');
  });

  it('二度目・反映済み・無い依頼は断る', () => {
    const env = prEnv();
    const { ctx } = env;
    approveAs(env);
    ctx.apiPrMerge(1, [], '');
    expectRefused(() => ctx.apiPrClose(1), /既に反映済みです/);
    expectRefused(() => ctx.apiPrClose(9), /確認依頼が見つかりません/);

    const env2 = prEnv();
    env2.ctx.apiPrClose(1);
    expectRefused(() => env2.ctx.apiPrClose(1), /既に取り下げられています/);
  });
});

describe('apiPrMerge', () => {
  it('承認があれば反映し、正式版の文書が改訂版の中身になる', () => {
    const env = prEnv();
    const { ctx, fake, fileId } = env;
    approveAs(env);
    const preview = ctx.apiPrPreview(1);
    const out = expectScreenSafe(ctx.apiPrMerge(1, [], preview.previewSha));
    expect(Object.keys(out).sort()).toEqual(['message', 'sha']);
    expect(out.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(fake._docs.get(fileId)).toBe('<p>第1条</p>\n<p>第2条</p>\n');
    expect(ctx.apiPrList()[0].state).toBe('merged');
  });

  it('承認が無い・差し戻しが残る・見比べたあとで進んだときは反映せず、正式版を変えない', () => {
    const env = prEnv();
    const { ctx, fake, fileId, work } = env;
    const before = fake._docs.get(fileId);
    const commitsBefore = snapshotDb(ctx, ['commits']);

    expectRefused(() => ctx.apiPrMerge(1, [], ''), /1件以上の承認が必要です/);

    approveAs(env);
    asUser(fake, 'third@example.com', () => ctx.apiPrReview(1, 'request_changes', '待って'));
    expectRefused(() => ctx.apiPrMerge(1, [], ''), /third@example\.com さんの差し戻しが残っています/);
    asUser(fake, 'third@example.com', () => ctx.apiPrReview(1, 'approve', 'よし'));

    const preview = ctx.apiPrPreview(1);
    fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n<p>第3条</p>\n');
    ctx.commitFile(work, '改訂', '第3条', null);
    expectRefused(() => ctx.apiPrMerge(1, [], preview.previewSha), /承認のあとに中身が変わっています|見比べたあとで/);

    expect(fake._docs.get(fileId)).toBe(before);
    expect(snapshotDb(ctx, ['commits']).commits.length).toBeGreaterThan(commitsBefore.commits.length);
    expect(ctx.apiCommitHistory(fileId)).toHaveLength(1);
  });

  it('二度目・取り下げた依頼・無い依頼は断る', () => {
    const env = prEnv();
    const { ctx } = env;
    approveAs(env);
    ctx.apiPrMerge(1, [], '');
    expectRefused(() => ctx.apiPrMerge(1, [], ''), /既に反映済みです/);
    expectRefused(() => ctx.apiPrMerge(9, [], ''), /確認依頼が見つかりません/);

    const env2 = prEnv();
    env2.ctx.apiPrClose(1);
    expectRefused(() => env2.ctx.apiPrMerge(1, [], ''), /取り下げられています/);
  });

  it('対象の文書が Drive で消えていたら、反映せずに取り下げる', () => {
    const env = prEnv();
    const { ctx, fake, fileId } = env;
    approveAs(env);
    fake.DriveApp.getFileById(fileId).setTrashed(true);
    expectRefused(() => ctx.apiPrMerge(1, [], ''), /Drive で消されているため/);
    expect(String(ctx.dbFindOne('pulls', 'number', 1).state)).toBe('closed');
  });
});

describe('コードの証跡 (apiPrPatchAdd / apiPrPatches / apiPrPatchRemove)', () => {
  it('添えると数を返し、一覧で本文まで読める。同じ道のりは置き換える', () => {
    const env = prEnv();
    const { ctx } = env;
    const added = expectScreenSafe(ctx.apiPrPatchAdd(1, 'src/x.js', DIFF));
    expect({ ...added }).toEqual({ id: 1, path: 'src/x.js', added: 2, removed: 1 });

    const again = ctx.apiPrPatchAdd(1, 'src/x.js', DIFF + '+d\n');
    expect(again.id).toBe(1);
    expect(again.added).toBe(3);

    const list = expectScreenSafe(ctx.apiPrPatches(1));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 1, path: 'src/x.js', by: OWNER, text: DIFF + '+d\n' });
    expect(list[0].at).toMatch(/T/);
    expect(ctx.apiPrPreview(1).patchCount).toBe(1);
  });

  it('証跡を変えると、それまでの承認は数えない', () => {
    const env = prEnv();
    const { ctx } = env;
    approveAs(env);
    ctx.apiPrPatchAdd(1, 'src/x.js', DIFF);
    const preview = ctx.apiPrPreview(1);
    expect(preview.approvals).toBe(0);
    expect(preview.staleApprovals).toBe(1);
    expectRefused(() => ctx.apiPrMerge(1, [], ''), /承認のあとに中身が変わっています/);
  });

  it('外すと数が返り、無い証跡は断る', () => {
    const env = prEnv();
    const { ctx } = env;
    ctx.apiPrPatchAdd(1, 'a.js', DIFF);
    expect(expectScreenSafe(ctx.apiPrPatchRemove(1, 1))).toEqual({ removed: 1 });
    expect(ctx.apiPrPatches(1)).toEqual([]);
    expectRefused(() => ctx.apiPrPatchRemove(1, 1), /その証跡は見つかりません/);
  });

  it.each([
    ['空の道のり', ['', DIFF], /道のりが不正です/],
    ['上に抜ける道のり', ['../etc/passwd', DIFF], /\.\. は使えません/],
    ['空の差分', ['a.js', ''], /差分が空です/],
  ])('%s は断り、何も添えない', (_name, args, pattern) => {
    const env = prEnv();
    expectRefused(() => env.ctx.apiPrPatchAdd(1, ...args), pattern);
    expect(env.ctx.dbReadAll('pull_patches')).toHaveLength(0);
  });

  it('大きすぎる差分は断り、中身も置かない', () => {
    const env = prEnv();
    const big = '+' + 'x'.repeat(env.ctx.PATCH_MAX_CHARS());
    const objects = env.fake.DriveApp.getFolderById(env.ctx.repoConfig().objectsId);
    const count = () => { let n = 0; const it = objects.getFiles(); while (it.hasNext()) { it.next(); n++; } return n; };
    const before = count();
    expectRefused(() => env.ctx.apiPrPatchAdd(1, 'a.js', big), /差分が大きすぎます/);
    expect(count()).toBe(before);
  });

  it('決まった依頼の証跡は変えられない', () => {
    const env = prEnv();
    const { ctx } = env;
    ctx.apiPrPatchAdd(1, 'a.js', DIFF);
    ctx.apiPrClose(1);
    expectRefused(() => ctx.apiPrPatchAdd(1, 'b.js', DIFF), /この依頼は決まっています/);
    expectRefused(() => ctx.apiPrPatchRemove(1, 1), /この依頼は決まっています/);
    expect(ctx.apiPrPatches(1)).toHaveLength(1);
  });
});
