import { describe, it, expect } from 'vitest';
import { makeEnv, withPr, expectScreenSafe, expectRefused, snapshotDb, asUser, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 変更の記録と改訂版、Markdown での編集と正式版の保護 (src/api/Commit.gs)。
 *
 * 正式版の保護は API 層で行う (assertNotProtected_)。反映 (prMerge) は commitFile を
 * 直に呼ぶので止まらず、人の操作だけが止まる。
 */

function branched(name = '改訂') {
  const env = makeEnv();
  env.ctx.apiBranchCreate(name, env.fileId);
  env.work = env.ctx.branchWorkingFileId(name, env.fileId);
  return env;
}

describe('apiFileStatus', () => {
  it('記録と同じなら dirty でなく、Docs で直すと dirty になる', () => {
    const { ctx, fake, fileId } = makeEnv();
    const clean = expectScreenSafe(ctx.apiFileStatus(fileId));
    expect(clean).toMatchObject({ dirty: false, branch: 'main' });
    expect(clean.headSha).toMatch(/^[0-9a-f]{64}$/);

    fake._docs.set(fileId, '<p>直した</p>\n');
    expect(ctx.apiFileStatus(fileId).dirty).toBe(true);
  });

  it('作業コピーはその改訂版の名前を返す', () => {
    const { ctx, work } = branched();
    expect(ctx.apiFileStatus(work).branch).toBe('改訂');
  });

  it('登録されていない文書は断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiFileStatus('file-x'), /管理対象に登録されていません/);
  });
});

describe('apiCommit', () => {
  it('改訂版の文書は記録でき、sha と一言だけを返す', () => {
    const { ctx, fake, work } = branched();
    fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    const out = expectScreenSafe(ctx.apiCommit(work, '第2条を足した', null));
    expect(Object.keys(out).sort()).toEqual(['message', 'sha']);
    expect(out.message).toBe('第2条を足した');
    expect(ctx.apiFileStatus(work).dirty).toBe(false);
  });

  it('正式版は直接記録できず、何も書かない', () => {
    const { ctx, fake, fileId } = makeEnv();
    fake._docs.set(fileId, '<p>直接</p>\n');
    const before = snapshotDb(ctx, ['commits', 'files']);
    expectRefused(() => ctx.apiCommit(fileId, '直接', null), /正式版は直接なおせません/);
    expect(snapshotDb(ctx, ['commits', 'files'])).toEqual(before);
  });

  it('開いたあとに先に記録が入っていたら断る', () => {
    const { ctx, fake, work } = branched();
    const opened = ctx.apiFileStatus(work).headSha;
    fake._docs.set(work, '<p>A</p>\n');
    ctx.apiCommit(work, '先に', opened);
    fake._docs.set(work, '<p>B</p>\n');
    const before = snapshotDb(ctx, ['commits']);
    expectRefused(() => ctx.apiCommit(work, '後から', opened), /ほかの記録が先に入りました/);
    expect(snapshotDb(ctx, ['commits'])).toEqual(before);
  });

  it('一言が無い・変更が無い・登録されていない文書は断る', () => {
    const { ctx, fake, work } = branched();
    expectRefused(() => ctx.apiCommit(work, '変えていない', null), /変更がありません/);
    fake._docs.set(work, '<p>X</p>\n');
    expectRefused(() => ctx.apiCommit(work, '', null), /何を変えたかを入力してください/);
    expectRefused(() => ctx.apiCommit(work, 'あ'.repeat(501), null), /何を変えたか/);
    expectRefused(() => ctx.apiCommit('file-x', 'x', null), /管理対象に登録されていません/);
  });
});

describe('apiCommitHistory / apiCommitDiff', () => {
  it('新しい順に画面に渡せる形で返す', () => {
    const { ctx, fake, work } = branched();
    fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    ctx.apiCommit(work, '2つ目', null);
    const hist = expectScreenSafe(ctx.apiCommitHistory(work));
    expect(hist.map((c) => c.message)).toEqual(['2つ目', '改訂版「改訂」を作成']);
    expect(hist[0].parentSha).toBe(hist[1].sha);
    expect(hist[0].timestamp).toMatch(/T/);
    expect(hist[0].author).toBe('tester@example.com');
  });

  it('2つの記録の差分を返し、起点が空なら初めの記録として扱う', () => {
    const { ctx, fake, work } = branched();
    fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    ctx.apiCommit(work, '2つ目', null);
    const [to, from] = ctx.apiCommitHistory(work);

    const ops = expectScreenSafe(ctx.apiCommitDiff(from.sha, to.sha));
    expect(ops.some((o) => /第2条/.test(JSON.stringify(o)))).toBe(true);
    const first = expectScreenSafe(ctx.apiCommitDiff('', from.sha));
    expect(first.length).toBeGreaterThan(0);
  });

  it('無い記録・登録されていない文書は断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiCommitDiff('', 'f'.repeat(64)), /変更の記録が見つかりません/);
    expectRefused(() => ctx.apiCommitHistory('file-x'), /管理対象に登録されていません/);
  });
});

describe('改訂版 (apiBranchCreate / List / AddFile / Addable / Delete)', () => {
  it('作ると名前と起点を返し、一覧に main と並ぶ', () => {
    const { ctx, fileId } = makeEnv();
    const made = expectScreenSafe(ctx.apiBranchCreate('見直し', fileId));
    expect(made.name).toBe('見直し');
    expect(made.baseSha).toBe(ctx.apiFileStatus(fileId).headSha);

    const list = expectScreenSafe(ctx.apiBranchList());
    expect([...list.map((b) => b.name)].sort()).toEqual(['main', '見直し']);
    expect(list.find((b) => b.name === '見直し')).toMatchObject({ state: 'open', createdBy: 'tester@example.com' });
  });

  it.each([
    ['main', /正式版に使っている名前/],
    ['a/b', /名前に使えない文字/],
  ])('名前 %s は断り、何も作らない', (name, pattern) => {
    const { ctx, fileId } = makeEnv();
    const before = snapshotDb(ctx, ['branches', 'files']);
    expectRefused(() => ctx.apiBranchCreate(name, fileId), pattern);
    expect(snapshotDb(ctx, ['branches', 'files'])).toEqual(before);
  });

  it('同じ名前・登録外の文書・作業コピーからは作らない', () => {
    const { ctx, fileId, work } = branched('改訂');
    expectRefused(() => ctx.apiBranchCreate('改訂', fileId), /同じ名前の改訂版が既にあります/);
    expectRefused(() => ctx.apiBranchCreate('別', 'file-x'), /管理対象に登録されていません/);
    expectRefused(() => ctx.apiBranchCreate('別', work), /作業コピーからは改訂版を作れません/);
  });

  it('もう1つ文書を足せ、足せる候補からは入っている文書と Slides を外す', () => {
    const { ctx, fake, config } = branched('改訂');
    const second = fake._createDoc('細則', '<p>細則</p>\n', config.mainId);
    ctx.repoRegisterFile(second, '細則.doc');
    ctx.commitFile(second, 'main', '細則', null);
    const slides = fake._createSlides('資料', [{ shapes: ['表紙'] }]);
    ctx.repoRegisterFile(slides, '資料.slide');

    const addable = expectScreenSafe(ctx.apiBranchAddable('改訂'));
    expect(addable.map((a) => a.path)).toEqual(['細則.doc']);

    const added = expectScreenSafe(ctx.apiBranchAddFile('改訂', second));
    expect(added.path).toBe('branches/改訂/細則.doc');
    expect(ctx.apiBranchAddable('改訂')).toEqual([]);
    expectRefused(() => ctx.apiBranchAddFile('改訂', second), /この改訂版に入っています/);
  });

  it('足すときの断り: 無い改訂版・登録外・作業コピー', () => {
    const { ctx, fileId, work } = branched('改訂');
    expectRefused(() => ctx.apiBranchAddFile('無い', fileId), /改訂版が見つかりません/);
    expectRefused(() => ctx.apiBranchAddFile('改訂', 'file-x'), /管理対象に登録されていません/);
    expectRefused(() => ctx.apiBranchAddFile('改訂', work), /作業コピーは足せません/);
  });

  it('捨てられるのは作った本人か管理者だけ', () => {
    const { ctx, fake, fileId } = makeEnv();
    asUser(fake, OTHER, () => ctx.apiBranchCreate('ほかの人の', fileId));
    const before = snapshotDb(ctx, ['branches']);
    asUser(fake, 'third@example.com', () => {
      expectRefused(() => ctx.apiBranchDelete('ほかの人の'), /作った本人か、このアプリの管理者だけ/);
    });
    expect(snapshotDb(ctx, ['branches'])).toEqual(before);

    expect(asUser(fake, ADMIN, () => ctx.apiBranchDelete('ほかの人の'))).toBe('ほかの人の');
    expect(String(ctx.dbFindOne('branches', 'name', 'ほかの人の').state)).toBe('deleted');
    expect(ctx.apiBranchList().some((b) => b.name === 'ほかの人の')).toBe(false);
  });

  it('作った本人は捨てられ、作業コピーはゴミ箱へ入る', () => {
    const { ctx, fake, fileId } = makeEnv();
    asUser(fake, OTHER, () => {
      ctx.apiBranchCreate('自分の', fileId);
      const work = ctx.branchWorkingFileId('自分の', fileId);
      ctx.apiBranchDelete('自分の');
      expect(fake.DriveApp.getFileById(work).isTrashed()).toBe(true);
    });
  });

  it('開いた確認依頼がある改訂版・正式版・無い改訂版は捨てない', () => {
    const env = withPr(makeEnv());
    const { ctx } = env;
    expectRefused(() => ctx.apiBranchDelete('改訂'), /開いている確認依頼があります/);
    expect(String(ctx.dbFindOne('branches', 'name', '改訂').state)).toBe('open');
    expectRefused(() => ctx.apiBranchDelete('main'), /正式版は捨てられません/);
    expectRefused(() => ctx.apiBranchDelete('無い'), /改訂版が見つかりません/);
  });

  it('中の文書が Drive で消えた改訂版は一覧から外す', () => {
    const { ctx, fake, work } = branched('改訂');
    fake.DriveApp.getFileById(work).setTrashed(true);
    expect(ctx.apiBranchList().some((b) => b.name === '改訂')).toBe(false);
  });
});

describe('apiCommitGraph', () => {
  it('作業コピーを選んでも、正式版と全部の改訂版の記録を1つのグラフで返す', () => {
    const { ctx, fake, work } = branched('改訂');
    fake._docs.set(work, '<p>改訂</p>\n');
    ctx.apiCommit(work, '改訂した', null);

    // forkLane は分かれ目でない行では undefined のまま (画面は読まない)
    const graph = expectScreenSafe(ctx.apiCommitGraph(work), { allowUndefined: ['forkLane'] });
    expect(graph.branches).toEqual(['main', '改訂']);
    // 同じミリ秒の記録どうしの並びは決まらないので、中身だけを見る
    expect([...graph.rows.map((r) => r.message)].sort()).toEqual(['初期状態', '改訂した', '改訂版「改訂」を作成'].sort());
    expect(graph.laneCount).toBeGreaterThanOrEqual(1);
  });

  it('捨てた改訂版と記録の無い改訂版は入れない', () => {
    const { ctx, fileId } = branched('改訂');
    ctx.apiBranchCreate('捨てる', fileId);
    ctx.apiBranchDelete('捨てる');
    expect(ctx.apiCommitGraph(fileId).branches).toEqual(['main', '改訂']);
  });

  it('登録外の文書は断る。正式版の行が無い作業コピーも断る', () => {
    const { ctx, fileId, work } = branched('改訂');
    expectRefused(() => ctx.apiCommitGraph('file-x'), /管理対象に登録されていません/);
    ctx.dbDelete('files', 'fileId', fileId);
    expectRefused(() => ctx.apiCommitGraph(work), /正式版の文書が見つかりません/);
  });
});

describe('apiDirtyFiles / apiCommitMany', () => {
  it('その改訂版の、記録していない文書だけを返す', () => {
    const { ctx, fake, work, fileId } = branched('改訂');
    expect(ctx.apiDirtyFiles('改訂')).toEqual([]);
    fake._docs.set(work, '<p>変更</p>\n');
    fake._docs.set(fileId, '<p>正式版も変わった</p>\n');
    const out = expectScreenSafe(ctx.apiDirtyFiles('改訂'));
    expect(out).toEqual([{ fileId: work, path: 'branches/改訂/就業規則.doc', dirty: true }]);
  });

  it('まとめて記録し、通ったものと落ちたものを分けて返す (1件で止めない)', () => {
    const { ctx, fake, work, fileId } = branched('改訂');
    fake._docs.set(work, '<p>変更</p>\n');
    fake._docs.set(fileId, '<p>直接</p>\n');

    const out = expectScreenSafe(ctx.apiCommitMany([fileId, work, 'file-x'], 'まとめて'));
    expect(out.committed.map((c) => c.path)).toEqual(['branches/改訂/就業規則.doc']);
    expect(out.failed.map((f) => f.path)).toEqual(['就業規則.doc', 'file-x']);
    expect(out.failed[0].error).toMatch(/正式版は直接なおせません/);
    expect(out.failed[1].error).toMatch(/管理対象に登録されていません/);
    // 正式版は動いていない
    expect(ctx.apiCommitHistory(fileId)).toHaveLength(1);
  });

  it('対象が無ければ断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiCommitMany([], 'x'), /対象が選ばれていません/);
    expectRefused(() => ctx.apiCommitMany(null, 'x'), /対象が選ばれていません/);
  });
});

describe('Markdown (apiGetMarkdown / apiSaveMarkdown)', () => {
  it('正式版は読めるが直せないと伝え、指紋を添える', () => {
    const { ctx, fileId } = makeEnv();
    const out = expectScreenSafe(ctx.apiGetMarkdown(fileId));
    expect(out).toMatchObject({ markdown: '第1条\n', branch: 'main', editable: false });
    expect(out.baseSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('作業コピーに書き戻せ、続けて保存するための指紋を返す', () => {
    const { ctx, fake, work } = branched();
    const opened = ctx.apiGetMarkdown(work);
    expect(opened.editable).toBe(true);
    const saved = expectScreenSafe(ctx.apiSaveMarkdown(work, '# 見出し\n', opened.baseSha));
    expect(saved.ok).toBe(true);
    expect(fake._docs.get(work)).toBe('<h1>見出し</h1>\n');
    expect(saved.baseSha).toBe(ctx.apiGetMarkdown(work).baseSha);
  });

  it('正式版・指紋の食い違い・書き戻せない中身は断り、文書を変えない', () => {
    const { ctx, fake, fileId, work } = branched();
    const opened = ctx.apiGetMarkdown(work);
    expectRefused(() => ctx.apiSaveMarkdown(fileId, '# x\n'), /正式版は直接なおせません/);
    expect(fake._docs.get(fileId)).toBe('<p>第1条</p>\n');

    fake._docs.set(work, '<p>Docs で直した</p>\n');
    expectRefused(() => ctx.apiSaveMarkdown(work, '# 上書き\n', opened.baseSha), /開いたあとで/);
    expectRefused(() => ctx.apiSaveMarkdown(work, '![x](sha:unavailable)\n'), /書き戻せません/);
    expect(fake._docs.get(work)).toBe('<p>Docs で直した</p>\n');
  });

  it('登録されていない文書は断る', () => {
    const { ctx } = makeEnv();
    expectRefused(() => ctx.apiGetMarkdown('file-x'), /管理対象に登録されていません/);
    expectRefused(() => ctx.apiSaveMarkdown('file-x', 'x'), /管理対象に登録されていません/);
  });
});

describe('apiStashMainDrift', () => {
  it('正式版の直接編集を記録として退避し、画面に渡せる形で返す', () => {
    const { ctx, fake, fileId } = makeEnv();
    fake._docs.set(fileId, '<p>直接</p>\n');
    // 以前は commits の行をそのまま返し、timestamp が Date のまま混ざっていた
    const out = expectScreenSafe(ctx.apiStashMainDrift(fileId));
    expect(Object.keys(out).sort()).toEqual(
      ['author', 'blobSha', 'branch', 'fileId', 'message', 'parentSha', 'sha', 'timestamp']);
    expect(out).toMatchObject({ branch: 'main', fileId, author: 'tester@example.com' });
    expect(out.message).toContain('直接編集');
    expect(out.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ctx.apiCommitHistory(fileId)[0].sha).toBe(out.sha);
    expect(ctx.apiFileStatus(fileId).dirty).toBe(false);
  });

  it('作業コピー・変更の無い正式版・登録外は断る', () => {
    const { ctx, fileId, work } = branched();
    expectRefused(() => ctx.apiStashMainDrift(work), /正式版の文書にだけ使えます/);
    expectRefused(() => ctx.apiStashMainDrift(fileId), /変更がありません/);
    expectRefused(() => ctx.apiStashMainDrift('file-x'), /管理対象に登録されていません/);
  });
});
