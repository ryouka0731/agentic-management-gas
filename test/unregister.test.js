import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Normalize.js',
  'src/core/ObjectStore.gs',
  'src/core/Commit.gs',
  'src/core/Branch.gs',
  'src/render/DocRenderer.gs',
  'src/render/LiveCache.gs',
];

/**
 * 間違って登録したものを戻す道が、画面にもコマンドキューにも無かった。
 * 台帳を手で直すしかなく、それは「使う人に GAS を触らせない」に反する。
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
  const fileId = fake._createDoc('賃金規程', '<p>第1条 目的</p>\n', config.mainId);
  ctx.repoRegisterFile(fileId, '賃金規程');

  return { ctx, fake, fileId };
}

describe('管理から外す', () => {
  it('台帳から消える', () => {
    const { ctx, fileId } = setup();
    const out = ctx.repoUnregisterFile(fileId);

    expect(out.path).toBe('賃金規程');
    expect(out.type).toBe('doc');
    expect(ctx.dbFindOne('files', 'fileId', fileId)).toBeNull();
  });

  it('Drive の文書そのものは消さない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.repoUnregisterFile(fileId);

    // 消してしまうと取り返しがつかない。外すのは台帳の1行だけである
    const file = fake.DriveApp.getFileById(fileId);
    expect(file.getName()).toBe('賃金規程');
    expect(file.isTrashed ? file.isTrashed() : false).toBe(false);
  });

  it('これまでの記録は残り、登録し直すと履歴が戻る', () => {
    const { ctx, fileId } = setup();
    ctx.commitFile(fileId, 'main', '最初の版', null);
    const before = ctx.commitHistory(fileId, 'main').length;

    ctx.repoUnregisterFile(fileId);
    expect(ctx.dbReadAll('commits').length).toBe(before);

    // 同じ fileId の記録がそのまま繋がる。だから外すのは取り返しがつく
    ctx.repoRegisterFile(fileId, '賃金規程');
    expect(ctx.commitHistory(fileId, 'main').length).toBe(before);
  });

  it('登録していないものは外せない', () => {
    const { ctx } = setup();

    expect(() => ctx.repoUnregisterFile('NOPE'))
      .toThrow('登録されていません');
  });

  it('改訂版が残っているうちは外さない', () => {
    const { ctx, fileId } = setup();
    ctx.commitFile(fileId, 'main', '最初の版', null);
    ctx.branchCreate('賃金の見直し', fileId);

    // 外すと、その版の作業コピーだけが宙に浮き、どこからも辿れなくなる
    expect(() => ctx.repoUnregisterFile(fileId))
      .toThrow('賃金の見直し');
    expect(ctx.dbFindOne('files', 'fileId', fileId)).not.toBeNull();
  });

  it('作業コピーそのものは外せない', () => {
    const { ctx, fileId } = setup();
    ctx.commitFile(fileId, 'main', '最初の版', null);
    ctx.branchCreate('賃金の見直し', fileId);

    const copy = ctx.branchWorkingFileId('賃金の見直し', fileId);

    // 捨てるのは改訂版のほうである
    expect(() => ctx.repoUnregisterFile(copy))
      .toThrow('改訂版そのものを捨ててください');
  });

  it('未コミットでも外せる', () => {
    const { ctx, fileId } = setup();

    // 何も壊れないうえ、外せない状態が増えると
    // 「どうすれば外せるのか」が分からなくなる
    expect(ctx.commitHistory(fileId, 'main')).toHaveLength(0);
    expect(() => ctx.repoUnregisterFile(fileId)).not.toThrow();
  });
});

describe('パスを分ける', () => {
  it('作業コピーでなければ main になる', () => {
    const { ctx } = setup();

    expect(ctx.branchSplitPath_('賃金規程'))
      .toEqual({ branch: 'main', path: '賃金規程' });
  });

  it('版の名と文書のパスに分かれる', () => {
    const { ctx } = setup();

    expect(ctx.branchSplitPath_('branches/賃金の見直し/賃金規程'))
      .toEqual({ branch: '賃金の見直し', path: '賃金規程' });
  });

  it('文書のパストに区切りが入っていても後ろは丸ごと残す', () => {
    const { ctx } = setup();

    expect(ctx.branchSplitPath_('branches/A/規程/賃金'))
      .toEqual({ branch: 'A', path: '規程/賃金' });
  });

  it('branches で始まるだけの名前を取り違えない', () => {
    const { ctx } = setup();

    // 「branches」という名の文書があっても作業コピーではない。
    // 区切りまで見ないと branchesX/覚書 が版の名の無い作業コピーに化ける
    expect(ctx.branchSplitPath_('branches').branch).toBe('main');
    expect(ctx.branchSplitPath_('branchesの覚書').branch).toBe('main');
    expect(ctx.branchSplitPath_('branchesX/覚書'))
      .toEqual({ branch: 'main', path: 'branchesX/覚書' });
  });
});

describe('同じ名前は登録しない', () => {
  /*
   * 台帳は path で作業コピーを引く (branchWorkingFileId / branchBaseSha)。
   * 同じ path の文書が2つあると、A を直した改訂版から B を対象に依頼でき、
   * 反映すると **B に A の変更が入る** (実際にそうなった)。
   */
  it('正式版に同じ名前があれば断る', () => {
    const { ctx, fake } = setup();
    const other = fake._createDoc('賃金規程', '<p>別の文書</p>\n',
      ctx.repoConfig().mainId);

    expect(() => ctx.repoRegisterFile(other, '賃金規程'))
      .toThrow('同じ名前の文書が既に登録されています');
    expect(ctx.dbFindOne('files', 'fileId', other)).toBeNull();
  });

  it('外したあとなら同じ名前で登録できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.repoUnregisterFile(fileId);
    const other = fake._createDoc('賃金規程', '<p>別の文書</p>\n',
      ctx.repoConfig().mainId);

    expect(ctx.repoRegisterFile(other, '賃金規程').path).toBe('賃金規程');
  });
});
