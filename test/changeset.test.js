import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/ObjectStore.gs', 'src/core/Normalize.js',
  'src/core/Diff.js', 'src/core/Merge.js', 'src/core/Commit.gs',
  'src/core/Branch.gs', 'src/render/HtmlWriter.gs',
  'src/render/DocRenderer.gs', 'src/render/LiveCache.gs',
  'src/core/PullRequest.gs',
  'src/core/PullPatch.gs',
  'src/core/Plain.js', 'src/core/Outbox.gs', 'src/core/Archive.js', 'src/core/Staleness.js',
  'src/core/Tag.gs', 'src/core/Issue.gs', 'src/core/Project.gs',
  'src/core/Mention.js', 'src/core/Brand.js', 'src/core/Notifier.gs',
  'src/core/Member.gs', 'src/core/Template.gs',
];

/**
 * 正式版に2つの文書を置く。
 *
 * 1つの改訂で規程と細則の両方を直す、というのが現実にある。それを別々の
 * 改訂版に分けると確認依頼も別々になり、片方だけ反映されうる。
 */
function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);

  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  const a = fake._createDoc('就業規則', '<p>A1</p>\n', config.mainId);
  const b = fake._createDoc('賃金規程', '<p>B1</p>\n', config.mainId);

  ctx.repoRegisterFile(a, '就業規則.doc');
  ctx.repoRegisterFile(b, '賃金規程.doc');
  ctx.commitFile(a, 'main', 'Aの初期', null);
  ctx.commitFile(b, 'main', 'Bの初期', null);

  return { ctx, fake, a, b };
}

describe('改訂版に文書を足す', () => {
  it('2つ目を足せる', () => {
    const { ctx, a, b } = setup();
    ctx.branchCreate('見直し', a);
    ctx.branchAddFile('見直し', b);

    expect(ctx.branchFiles('見直し').map((f) => f.path).sort())
      .toEqual(['branches/見直し/賃金規程.doc', 'branches/見直し/就業規則.doc'].sort());
  });

  it('足した文書にも最初の記録が入る', () => {
    const { ctx, a, b } = setup();
    ctx.branchCreate('見直し', a);
    ctx.branchAddFile('見直し', b);

    // 記録が無いと差分の起点が無く、状態を見た時点で落ちる
    const work = ctx.branchWorkingFileId('見直し', b);
    expect(ctx.headCommit(work, '見直し')).toBeTruthy();
    expect(ctx.fileStatus(work, '見直し').dirty).toBe(false);
  });

  it('同じ文書は二度入れられない', () => {
    const { ctx, a } = setup();
    ctx.branchCreate('見直し', a);

    expect(() => ctx.branchAddFile('見直し', a))
      .toThrow('この改訂版に入っています');
  });

  it('作業コピーは足せない', () => {
    const { ctx, a, b } = setup();
    ctx.branchCreate('見直し', a);
    const work = ctx.branchWorkingFileId('見直し', a);

    ctx.branchCreate('別の版', b);
    expect(() => ctx.branchAddFile('別の版', work))
      .toThrow('正式版の文書を選んでください');
  });

  it('閉じた改訂版には足せない', () => {
    const { ctx, a, b } = setup();
    ctx.branchCreate('見直し', a);
    ctx.dbUpdate('branches', 'name', '見直し', { state: 'merged' });

    expect(() => ctx.branchAddFile('見直し', b)).toThrow('既に閉じられています');
  });

  it('無い改訂版には足せない', () => {
    const { ctx, b } = setup();

    expect(() => ctx.branchAddFile('無い版', b)).toThrow('改訂版が見つかりません');
  });
});

describe('起点は文書ごとに持つ', () => {
  /**
   * A で分岐したあと正式版の B を進め、そのあと B を足す。
   *
   * ブランチに起点を1つだけ持たせていると、B の起点が「A の古いコミット」
   * になる。そのコミットは B の履歴に無いため、3つを見比べる起点として
   * A の中身が使われ、**B の条文が黙って消える。**
   */
  function laterAdd(ctx, fake, a, b) {
    ctx.branchCreate('見直し', a);

    fake._docs.set(b, '<p>B1</p>\n<p>B2</p>\n');
    ctx.commitFile(b, 'main', 'Bに条文を足した', null);

    ctx.branchAddFile('見直し', b);
    return ctx.branchWorkingFileId('見直し', b);
  }

  it('あとから足した文書は、足した時点を起点にする', () => {
    const { ctx, fake, a, b } = setup();
    const work = laterAdd(ctx, fake, a, b);

    const bHead = ctx.headCommit(b, 'main');
    expect(ctx.branchBaseSha('見直し', b)).toBe(bHead.sha);

    // 1つ目の文書の起点とは違う
    expect(ctx.branchBaseSha('見直し', b))
      .not.toBe(ctx.branchBaseSha('見直し', a));
    expect(work).toBeTruthy();
  });

  it('あとから足した文書を直しても、正式版の条文が消えない', () => {
    const { ctx, fake, a, b } = setup();
    const work = laterAdd(ctx, fake, a, b);

    fake._docs.set(work, '<p>B1</p>\n<p>B2</p>\n<p>B3</p>\n');
    ctx.commitFile(work, '見直し', 'B3を足した', null);

    const pr = ctx.prCreate('Bの改訂', '', '見直し', b);
    const preview = ctx.prPreviewMerge(pr.number);
    const merged = preview.lines.join('\n');

    // 起点を取り違えると B2 が「相手が消した」と読まれて落ちる
    expect(merged).toContain('B1');
    expect(merged).toContain('B2');
    expect(merged).toContain('B3');
    expect(merged).not.toContain('A1');
    expect(preview.clean).toBe(true);
  });

  it('列を足す前の改訂版は、ブランチ側の起点に落ちる', () => {
    const { ctx, a } = setup();
    ctx.branchCreate('見直し', a);

    // 以前に作られた作業コピーは files.baseSha が空である
    const work = ctx.branchWorkingFileId('見直し', a);
    const row = ctx.dbFindOne('files', 'fileId', work);
    ctx.dbUpdate('files', 'fileId', work, { baseSha: '' });

    const branch = ctx.dbFindOne('branches', 'name', '見直し');
    expect(ctx.branchBaseSha('見直し', a)).toBe(String(branch.baseSha));
    expect(row).toBeTruthy();
  });
});

describe('確認依頼は変更の集まり', () => {
  /** 2つの文書を1つの改訂版で直し、両方を対象にした依頼を出す */
  function both(ctx, fake, a, b) {
    ctx.branchCreate('見直し', a);
    ctx.branchAddFile('見直し', b);

    const wa = ctx.branchWorkingFileId('見直し', a);
    const wb = ctx.branchWorkingFileId('見直し', b);

    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);
    fake._docs.set(wb, '<p>B1</p>\n<p>B2</p>\n');
    ctx.commitFile(wb, '見直し', 'Bを直した', null);

    const pr = ctx.prCreate('規程と細則の改訂', '', '見直し', [a, b]);
    ctx.dbUpdate('pulls', 'number', pr.number, { state: 'approved' });
    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });
    return pr;
  }

  it('2つの文書を対象にできる', () => {
    const { ctx, fake, a, b } = setup();
    const pr = both(ctx, fake, a, b);

    expect(ctx.prTargetFiles(ctx.prGet(pr.number))).toEqual([a, b]);
  });

  it('全件をまとめて見比べられる', () => {
    const { ctx, fake, a, b } = setup();
    const pr = both(ctx, fake, a, b);
    const all = ctx.prPreviewAll(pr.number);

    expect(all.files.map((f) => f.path).sort())
      .toEqual(['就業規則.doc', '賃金規程.doc'].sort());
    expect(all.clean).toBe(true);
    expect(all.problems).toEqual([]);
  });

  it('1回の反映で両方が書き戻る', () => {
    const { ctx, fake, a, b } = setup();
    const pr = both(ctx, fake, a, b);

    ctx.prMerge(pr.number, {});

    // 片方だけ反映された状態を作らない
    expect(fake._docs.get(a)).toContain('A2');
    expect(fake._docs.get(b)).toContain('B2');
    expect(ctx.prGet(pr.number).state).toBe('merged');
  });

  it('片方しか直していなくても反映できる', () => {
    const { ctx, fake, a, b } = setup();
    ctx.branchCreate('見直し', a);
    ctx.branchAddFile('見直し', b);

    const wa = ctx.branchWorkingFileId('見直し', a);
    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);

    const pr = ctx.prCreate('Aだけ直した', '', '見直し', [a, b]);
    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });
    const bHead = ctx.headCommit(b, 'main').sha;

    // B は変わらないので記録が空になる。そこで落ちると A だけ書き戻した
    // ところで止まり、やり直しても A で同じく落ちて二度と反映できない
    ctx.prMerge(pr.number, {});

    expect(fake._docs.get(a)).toContain('A2');
    expect(ctx.prGet(pr.number).state).toBe('merged');
    // 変わらない文書には空の記録を作らない
    expect(ctx.headCommit(b, 'main').sha).toBe(bHead);
  });

  it('その改訂版に入っていない文書は対象にできない', () => {
    const { ctx, a, b } = setup();
    ctx.branchCreate('見直し', a);

    // 作業コピーが無いと「何を反映するのか」が無い
    expect(() => ctx.prCreate('だめ', '', '見直し', [a, b]))
      .toThrow('「見直し」に入っていません');
  });

  it('対象が空なら作れない', () => {
    const { ctx, a } = setup();
    ctx.branchCreate('見直し', a);

    expect(() => ctx.prCreate('だめ', '', '見直し', []))
      .toThrow('反映する文書を選んでください');
  });

  it('列を足す前の依頼も1件の変更セットとして読める', () => {
    const { ctx, fake, a } = setup();
    ctx.branchCreate('見直し', a);
    const wa = ctx.branchWorkingFileId('見直し', a);
    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);

    const pr = ctx.prCreate('Aの改訂', '', '見直し', a);
    // 以前の依頼は本文の印にしか対象を持たない
    ctx.dbUpdate('pulls', 'number', pr.number, { targetFiles: '' });

    expect(ctx.prTargetFiles(ctx.prGet(pr.number))).toEqual([a]);
  });
});

describe('途中で失敗しても中途半端に反映しない', () => {
  /**
   * 2件のうち後ろの1件だけが書き戻せない状態を作る。
   *
   * 1件ずつ「検証して書く」を繰り返していると、1件目だけ反映された
   * 状態が残り、確認を経ていない中途半端な正式版ができる。
   */
  function oneBad(ctx, fake, a, b) {
    ctx.branchCreate('見直し', a);
    ctx.branchAddFile('見直し', b);

    const wa = ctx.branchWorkingFileId('見直し', a);
    const wb = ctx.branchWorkingFileId('見直し', b);

    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);
    fake._docs.set(wb, '<p>B1</p>\n<p>B2</p>\n');
    ctx.commitFile(wb, '見直し', 'Bを直した', null);

    const pr = ctx.prCreate('両方', '', '見直し', [a, b]);
    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });

    // 2件目だけ書き戻せないことにする
    const realValidate = ctx.htmlWriterValidate;
    ctx.htmlWriterValidate = (blocks) => {
      const text = JSON.stringify(blocks);
      if (text.indexOf('B2') > -1) return ['取り出せない画像があります'];
      return realValidate(blocks);
    };
    return pr;
  }

  it('1件目も書き戻さない', () => {
    const { ctx, fake, a, b } = setup();
    const before = fake._docs.get(a);
    const pr = oneBad(ctx, fake, a, b);

    expect(() => ctx.prMerge(pr.number, {})).toThrow('書き戻せません');

    // ここが崩れると、確認を経ていない中途半端な正式版ができる
    expect(fake._docs.get(a)).toBe(before);
    expect(ctx.prGet(pr.number).state).not.toBe('merged');
  });

  it('どの文書が駄目なのかを言う', () => {
    const { ctx, fake, a, b } = setup();
    const pr = oneBad(ctx, fake, a, b);

    expect(() => ctx.prMerge(pr.number, {})).toThrow('賃金規程.doc');
  });

  it('見比べた時点でも全件の問題を挙げる', () => {
    const { ctx, fake, a, b } = setup();
    const pr = oneBad(ctx, fake, a, b);
    const all = ctx.prPreviewAll(pr.number);

    // 押してから落ちるより、押す前に分かるほうがよい
    expect(all.problems.join('\n')).toContain('賃金規程.doc');
  });
});

describe('コードの変更を確認依頼に添える', () => {
  const DIFF = [
    '--- a/src/core/Usage.gs',
    '+++ b/src/core/Usage.gs',
    '@@ -1,3 +1,4 @@',
    ' function usageDay() {',
    '-  return old;',
    '+  return next;',
    '+  // 足した行',
    ' }',
  ].join('\n');

  /** 文書1件の依頼を作る */
  function withPr(ctx, fake, a) {
    ctx.branchCreate('見直し', a);
    const wa = ctx.branchWorkingFileId('見直し', a);
    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);

    return ctx.prCreate('規程と実装', '', '見直し', a);
  }

  it('添えられる', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);
    const row = ctx.prPatchAdd(pr.number, 'src/core/Usage.gs', DIFF);

    expect(row.path).toBe('src/core/Usage.gs');
    expect(ctx.prPatches(pr.number)[0].text).toBe(DIFF);
  });

  it('本文は台帳ではなく objects に置く', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);
    ctx.prPatchAdd(pr.number, 'src/core/Usage.gs', DIFF);

    // 差分の本文は長い。スプレッドシートのセルには上限がある
    const row = ctx.dbReadAll('pull_patches')[0];
    expect(String(row.blobSha)).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.objectGet(String(row.blobSha))).toBe(DIFF);
  });

  it('足した行と消した行を数える', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);
    const row = ctx.prPatchAdd(pr.number, 'src/core/Usage.gs', DIFF);

    // 中身を開かずに大きさが分かるようにしておく
    expect(row.added).toBe(2);
    expect(row.removed).toBe(1);
  });

  it('同じ道のりは置き換える', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);
    ctx.prPatchAdd(pr.number, 'src/core/Usage.gs', DIFF);
    ctx.prPatchAdd(pr.number, 'src/core/Usage.gs', DIFF + '\n+もう1行');

    // 足すたびに増えると、最後がどれか分からなくなる
    const rows = ctx.prPatches(pr.number);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain('もう1行');
  });

  it('番号は依頼をまたいで通し番号になる', () => {
    const { ctx, fake, a, b } = setup();
    const pr1 = withPr(ctx, fake, a);

    ctx.branchCreate('別の版', b);
    const wb = ctx.branchWorkingFileId('別の版', b);
    fake._docs.set(wb, '<p>B1</p>\n<p>B2</p>\n');
    ctx.commitFile(wb, '別の版', 'Bを直した', null);
    const pr2 = ctx.prCreate('Bの改訂', '', '別の版', b);

    ctx.prPatchAdd(pr1.number, 'x.js', DIFF);
    ctx.prPatchAdd(pr2.number, 'y.js', DIFF);

    // かぶると dbUpdate / dbDelete が別の依頼の証跡を巻き込む
    const ids = ctx.dbReadAll('pull_patches').map((r) => Number(r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('外すとき、別の依頼のものを巻き込まない', () => {
    const { ctx, fake, a, b } = setup();
    const pr1 = withPr(ctx, fake, a);

    ctx.branchCreate('別の版', b);
    const wb = ctx.branchWorkingFileId('別の版', b);
    fake._docs.set(wb, '<p>B1</p>\n<p>B2</p>\n');
    ctx.commitFile(wb, '別の版', 'Bを直した', null);
    const pr2 = ctx.prCreate('Bの改訂', '', '別の版', b);

    const one = ctx.prPatchAdd(pr1.number, 'x.js', DIFF);
    ctx.prPatchAdd(pr2.number, 'y.js', DIFF);

    ctx.prPatchRemove(pr1.number, one.id);
    expect(ctx.prPatches(pr1.number)).toHaveLength(0);
    expect(ctx.prPatches(pr2.number)).toHaveLength(1);
  });

  it('断ったら中身を置き去りにしない', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);

    // 先に置くと、どこからも参照されない中身が残る
    const before = ctx.dbReadAll('pull_patches').length;
    ctx.PATCH_MAX_FILES = () => 0;

    expect(() => ctx.prPatchAdd(pr.number, 'src/x.js', DIFF))
      .toThrow('件までです');
    expect(ctx.dbReadAll('pull_patches')).toHaveLength(before);
    expect(ctx.objectExists(ctx.sha256Hex(DIFF))).toBe(false);
  });

  it('空の差分は受け取らない', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);

    expect(() => ctx.prPatchAdd(pr.number, 'x.js', '')).toThrow('差分が空です');
  });

  it('上に抜ける道のりは受け取らない', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);

    // キューは Drive の共有相手なら誰でも書ける
    expect(() => ctx.prPatchAdd(pr.number, '../../etc/passwd', DIFF))
      .toThrow('.. は使えません');
  });

  it('決まった依頼には添えられない', () => {
    const { ctx, fake, a } = setup();
    const pr = withPr(ctx, fake, a);
    ctx.dbUpdate('pulls', 'number', pr.number, { state: 'closed' });

    // 決まったあとに証跡が変わると、何を承認したのかが分からなくなる
    expect(() => ctx.prPatchAdd(pr.number, 'x.js', DIFF))
      .toThrow('あとから証跡を変えられません');
  });
});

describe('コードは書き戻さない', () => {
  const DIFF = '--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b';

  it('文書が無くても承認を記録できる', () => {
    const { ctx, fake, a } = setup();

    // 文書の側は変えず、コードの証跡だけを添える
    ctx.branchCreate('実装だけ', a);
    const pr = ctx.prCreate('実装だけ直す', '', '実装だけ', a);
    ctx.dbUpdate('pulls', 'number', pr.number, { targetFiles: '' });
    ctx.dbUpdate('pulls', 'number', pr.number, { body: '補足のみ' });
    ctx.prPatchAdd(pr.number, 'x.js', DIFF);

    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });

    // 断ると「読んで納得したのにどこにも残らない」ことになる
    const res = ctx.prMerge(pr.number, {});
    expect(res.message).toContain('承認を記録しました');
    expect(ctx.prGet(pr.number).state).toBe('merged');
    expect(fake._docs.get(a)).toBe('<p>A1</p>\n');
  });

  it('文書が無く証跡も無ければ断る', () => {
    const { ctx, fake, a } = setup();
    ctx.branchCreate('空', a);
    const pr = ctx.prCreate('空', '', '空', a);
    ctx.dbUpdate('pulls', 'number', pr.number,
      { targetFiles: '', body: '補足のみ' });
    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });

    expect(() => ctx.prMerge(pr.number, {}))
      .toThrow('対象ファイルを特定できません');
    expect(fake).toBeTruthy();
  });

  it('承認が無ければ記録もしない', () => {
    const { ctx, fake, a } = setup();
    ctx.branchCreate('実装だけ', a);
    const pr = ctx.prCreate('実装だけ', '', '実装だけ', a);
    ctx.dbUpdate('pulls', 'number', pr.number,
      { targetFiles: '', body: '補足のみ' });
    ctx.prPatchAdd(pr.number, 'x.js', DIFF);

    // コードだからといって承認を省いてよい理由は無い
    expect(() => ctx.prMerge(pr.number, {})).toThrow('1件以上の承認が必要');
    expect(fake).toBeTruthy();
  });
});

describe('承認したら手元に取り込みを頼む', () => {
  const DIFF = '--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b';

  /** 文書1件 + 証跡1件の依頼を承認まで進める */
  function approved(ctx, fake, a) {
    ctx.branchCreate('見直し', a);
    const wa = ctx.branchWorkingFileId('見直し', a);
    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);

    const pr = ctx.prCreate('規程と実装', '', '見直し', a);
    ctx.prPatchAdd(pr.number, 'x.js', DIFF);
    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });
    return pr;
  }

  it('証跡があれば頼みごとが置かれる', () => {
    const { ctx, fake, a } = setup();
    const pr = approved(ctx, fake, a);

    ctx.prMerge(pr.number, {});

    const work = ctx.outboxList('open');
    expect(work).toHaveLength(1);
    expect(work[0].verb).toBe('merge');
    expect(work[0].args).toEqual({ branch: '見直し', into: 'main' });
    expect(Number(work[0].prNumber)).toBe(pr.number);
  });

  it('自動で取り込まない', () => {
    const { ctx, fake, a } = setup();
    const pr = approved(ctx, fake, a);
    ctx.prMerge(pr.number, {});

    // この道具はコードを書き換えない。頼むところまでで止める
    expect(ctx.outboxList('open')[0].state).toBe('open');
    expect(ctx.prPatches(pr.number)[0].text).toBe(DIFF);
  });

  it('証跡が無ければ頼まない', () => {
    const { ctx, fake, a } = setup();
    ctx.branchCreate('見直し', a);
    const wa = ctx.branchWorkingFileId('見直し', a);
    fake._docs.set(wa, '<p>A1</p>\n<p>A2</p>\n');
    ctx.commitFile(wa, '見直し', 'Aを直した', null);

    const pr = ctx.prCreate('規程だけ', '', '見直し', a);
    ctx.dbAppend('reviews', {
      prNumber: pr.number, reviewer: 'r@x.com', state: 'approve',
      body: '', at: new Date(), id: 1, editedAt: '',
    });
    ctx.prMerge(pr.number, {});

    // 文書だけの依頼で手元に頼むことは無い
    expect(ctx.outboxList('')).toEqual([]);
  });

  it('頼めなくてもマージは成立する', () => {
    const { ctx, fake, a } = setup();
    const pr = approved(ctx, fake, a);

    // 通知と同じく、失敗で巻き戻さない
    ctx.outboxAdd = () => { throw new Error('台帳が書けません'); };

    expect(() => ctx.prMerge(pr.number, {})).not.toThrow();
    expect(ctx.prGet(pr.number).state).toBe('merged');
    expect(fake._docs.get(a)).toContain('A2');
  });
});

describe('確認依頼を作るときの検査', () => {
  it('反映先の版に入っていない文書は対象にできない', () => {
    const { ctx, a, b } = setup();
    ctx.branchCreate('見直し', a);
    ctx.branchCreate('土台', b);

    // 通すと、開くたびに「反映先の版に作業コピーがありません」で落ちる
    // 依頼ができ、取り下げる以外に道が無くなる
    expect(() => ctx.prCreate('だめ', '', '見直し', a, '土台'))
      .toThrow('「土台」に入っていません');
    expect(ctx.dbReadAll('pulls')).toHaveLength(0);
  });

  it('同じ組の依頼があるかを見るところから書くまで、鍵を持つ', () => {
    const { ctx, fake, a } = setup();
    ctx.branchCreate('見直し', a);
    const order = [];

    fake.LockService.getScriptLock = () => ({
      tryLock: () => { order.push('lock'); return true; },
      releaseLock: () => { order.push('unlock'); },
    });
    const realRead = ctx.dbReadAll;
    ctx.dbReadAll = (t) => { if (t === 'pulls') order.push('look'); return realRead(t); };
    const realAppend = ctx.dbAppend;
    ctx.dbAppend = (t, r) => { if (t === 'pulls') order.push('append'); return realAppend(t, r); };

    ctx.prCreate('改訂', '', '見直し', a);

    // 分けると、ほぼ同時の2件が「まだ無い」と読んで両方作る
    const look = order.indexOf('look');
    expect(look).toBeGreaterThan(-1);
    expect(order.lastIndexOf('lock', look)).toBeGreaterThan(order.lastIndexOf('unlock', look));
    expect(order.indexOf('append')).toBeLessThan(order.indexOf('unlock', look));
  });
});

describe('あるか見てから書くものは、鍵の中で行う', () => {
  /*
   * 分けると、ほぼ同時の2件が「まだ無い」と読んで両方書く。同名の改訂版が
   * 2つ並ぶと dbFindOne は先の1つしか返さず、もう1つは見えるのに触れない。
   */
  function watch(ctx, fake, table) {
    let held = false;
    const seen = { look: [], append: [] };
    fake.LockService.getScriptLock = () => ({
      tryLock: () => { held = true; return true; },
      releaseLock: () => { held = false; },
    });
    const realFind = ctx.dbFindOne;
    ctx.dbFindOne = (t, k, v) => {
      if (t === table) seen.look.push(held);
      return realFind(t, k, v);
    };
    const realAppend = ctx.dbAppend;
    ctx.dbAppend = (t, r) => {
      if (t === table) seen.append.push(held);
      return realAppend(t, r);
    };
    return seen;
  }

  const CASES = [
    ['branchCreate', 'branches', (ctx, s) => ctx.branchCreate('見直し', s.a)],
    ['branchAddFile', 'files', (ctx, s) => {
      ctx.branchCreate('見直し', s.a);
      return () => ctx.branchAddFile('見直し', s.b);
    }],
    ['repoRegisterFile', 'files', (ctx, s) => {
      const c = s.fake._createDoc('細則', '<p>c</p>\n', ctx.repoConfig().mainId);
      return () => ctx.repoRegisterFile(c, '細則.doc');
    }],
    ['tagCreate', 'tags', (ctx) => ctx.tagCreate('棚卸し', 'ink')],
    ['memberSet', 'members', (ctx) => ctx.memberSet('a@example.com', '', '')],
    ['templateSave', 'templates', (ctx) => ctx.templateSave('段取り', '中身')],
  ];

  for (const [name, table, act] of CASES) {
    it(name, () => {
      const s = setup();
      // 準備が要るものは、準備を済ませてから見張る
      const later = name === 'branchAddFile' || name === 'repoRegisterFile'
        ? act(s.ctx, s) : null;
      const seen = watch(s.ctx, s.fake, table);

      if (later) later(); else act(s.ctx, s);

      expect(seen.look.length).toBeGreaterThan(0);
      expect(seen.append.length).toBeGreaterThan(0);
      expect(seen.look.concat(seen.append).every(Boolean)).toBe(true);
    });
  }
});
