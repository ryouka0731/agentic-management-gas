import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 共有ドライブに置いたとき。ファイルは親を1つしか持てず、持ち主が無く、
 * 投稿者はゴミ箱へ移せない。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  const base = eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]);
  // GAS は全ファイルを同じグローバルに読む。zip は AgentKit を使う
  return [...base, 'src/KitFiles.gs', 'src/core/AgentKit.gs'];
})();

/** 疑似GASに zip が無ければ足す */
function withZip(fake) {
  if (!fake.Utilities.zip) {
    fake.Utilities.zip = (blobs, name) => ({
      getName: () => name, getBytes: () => [], getContentType: () => 'application/zip',
    });
  }
  if (!fake.Utilities.newBlob) {
    fake.Utilities.newBlob = (b, t, n) => ({ getName: () => n });
  }
  return fake;
}

/** スクリプトを共有ドライブに置き、そこに入れ物を作る */
function setupShared() {
  const fake = withZip(createFakeGas());
  const drive = fake.DriveApp.createFolder('共有ドライブ')._markShared('drive-1');
  fake._placeScript(drive);
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  // Task 3 で repoInit が自分で入れるようになったら消す
  const cfg = ctx.repoConfig();
  cfg.driveId = 'drive-1';
  fake.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(), JSON.stringify(cfg));
  return { ctx, fake, drive };
}

describe('共有ドライブで入れ物を作る', () => {
  it('台帳を .git の下へ移せる (addFile を使わない)', () => {
    const { ctx, fake } = setupShared();
    const db = fake.DriveApp.getFileById(ctx.repoConfig().dbId);
    expect(db.getParents().next().getId()).toBe(ctx.repoConfig().gitId);
  });
});

describe('共有ドライブのコマンドキュー', () => {
  it('命令を処理済みへ移して結果を書く', () => {
    const { ctx } = setupShared();
    const queue = ctx.commandQueueFolder_();
    queue.createFile('t1.cmd.json', JSON.stringify({ op: 'listFiles', args: {} }), 'text/plain');
    ctx.processCommandQueue();
    expect(queue.getFilesByName('t1.result.json').hasNext()).toBe(true);
    expect(queue.getFilesByName('t1.cmd.json').hasNext()).toBe(false);
    expect(ctx.commandDoneFolder_().getFilesByName('t1.cmd.json').hasNext()).toBe(true);
  });
});

function makeBranch(fake, ctx) {
  // 描画は実機の DocumentApp が要るので、疑似の本文で置き換える (他のテストと同じ)
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  const fileId = fake._createDoc('規程', '<p>a</p>', ctx.repoConfig().mainId);
  ctx.repoRegisterFile(fileId, '規程.doc');
  ctx.commitFile(fileId, 'main', '最初', null);
  ctx.branchCreate('見直し', fileId);
}

describe('共有ドライブで消す', () => {
  it('投稿者が改訂版を捨てようとすると、要る役割を添えて断る。改訂版は残す', () => {
    const { ctx, fake } = setupShared();
    makeBranch(fake, ctx);
    fake._denyTrash(true);
    expect(() => ctx.branchDelete('見直し')).toThrow('コンテンツ管理者');
    expect(ctx.dbFindOne('branches', 'name', '見直し').state).toBe('open');
  });

  it('マイドライブでは今までどおり、消せなくても改訂版を閉じる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    makeBranch(fake, ctx);
    fake._denyTrash(true);
    ctx.branchDelete('見直し');
    expect(ctx.dbFindOne('branches', 'name', '見直し').state).toBe('deleted');
  });
});

describe('共有ドライブで道具の zip を作る', () => {
  it('外への共有を断られても zip は作る', () => {
    const { ctx, fake } = setupShared();
    fake._denySharing(true);
    expect(ctx.agentKitBuild_().getName()).toMatch(/-agent-kit-.*\.zip$/);
  });
});
