import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/ObjectStore.gs', 'src/core/Normalize.js',
  'src/core/Diff.js', 'src/core/Merge.js', 'src/core/Commit.gs',
  'src/core/Branch.gs', 'src/render/HtmlWriter.gs',
  'src/render/DocRenderer.gs', 'src/render/LiveCache.gs',
  'src/core/PullRequest.gs', 'src/core/Archive.js', 'src/core/Staleness.js',
  'src/core/Tag.gs', 'src/core/Issue.gs', 'src/core/Project.gs',
  'src/core/Mention.js', 'src/core/Brand.js', 'src/core/Notifier.gs',
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
