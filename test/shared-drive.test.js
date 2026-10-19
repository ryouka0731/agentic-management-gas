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

const MEMBERS = [
  { emailAddress: 'tester@example.com', role: 'organizer', type: 'user' },
  { emailAddress: 'boss@example.com', role: 'organizer', type: 'user' },
  { emailAddress: 'manager@example.com', role: 'fileOrganizer', type: 'user' },
  { emailAddress: 'writer@example.com', role: 'writer', type: 'user' },
  { emailAddress: 'reader@example.com', role: 'reader', type: 'user' },
  { emailAddress: 'team@example.com', role: 'organizer', type: 'group' },
];

/** スクリプトを共有ドライブに置き、そこに入れ物を作る */
function setupShared({ members = MEMBERS, pageSize } = {}) {
  const fake = withZip(createFakeGas());
  fake.Drive = fake._makeDrive({ members: { 'drive-1': members }, pageSize });
  const drive = fake.DriveApp.createFolder('共有ドライブ')._markShared('drive-1');
  fake._placeScript(drive);
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
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
    const work = ctx.dbReadAll('files').filter((r) => String(r.path).indexOf('branches/見直し/') === 0);
    expect(work.length).toBeGreaterThan(0);
    // フォルダだけ断る。ファイルが先に消されるなら、作業コピーが消えてしまう
    fake._denyTrashFor((item) => typeof item.createFolder === 'function');
    expect(() => ctx.branchDelete('見直し')).toThrow('コンテンツ管理者');
    expect(ctx.dbFindOne('branches', 'name', '見直し').state).toBe('open');
    for (const r of work) expect(fake.DriveApp.getFileById(r.fileId).isTrashed()).toBe(false);
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

describe('共有ドライブかどうか', () => {
  it('入れ物を作ったときに driveId を覚える', () => {
    const { ctx } = setupShared();
    expect(ctx.repoConfig().driveId).toBe('drive-1');
  });

  it('マイドライブなら今のまま。2回目からは問い合わせない', () => {
    const fake = createFakeGas();
    fake.Drive = fake._makeDrive({});
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.repoDriveId_()).toBe('');
    const n = fake.Drive._calls.filesGet;
    ctx.repoDriveId_();
    ctx.repoIsAdmin_('tester@example.com');
    expect(fake.Drive._calls.filesGet).toBe(n);
    expect(ctx.repoOwners_()).toEqual(['tester@example.com']);
  });

  it('設定に driveId が無い (前からある番頭) と、最初に読んだときに埋める', () => {
    const { ctx, fake } = setupShared();
    const cfg = ctx.repoConfig();
    delete cfg.driveId;
    fake.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(), JSON.stringify(cfg));
    expect(ctx.repoDriveId_()).toBe('drive-1');
    expect(ctx.repoConfig().driveId).toBe('drive-1');
  });

  it('読むついでに覚えるときは、鍵を長く待たない', () => {
    const { ctx, fake } = setupShared();
    const cfg = ctx.repoConfig();
    delete cfg.driveId;
    fake.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(), JSON.stringify(cfg));
    const waits = [];
    const real = ctx.dbWithLock_;
    ctx.dbWithLock_ = (ms, fn, onBusy) => { waits.push(ms); return real(ms, fn, onBusy); };
    expect(ctx.repoDriveId_()).toBe('drive-1');
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeLessThanOrEqual(2000);
  });

  it('拡張サービスが無ければマイドライブとして扱い、覚えない (あとで足されたら読み直す)', () => {
    const fake = createFakeGas();
    const drive = fake.DriveApp.createFolder('共有ドライブ')._markShared('drive-1');
    fake._placeScript(drive);
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.repoDriveId_()).toBe('');
    expect('driveId' in ctx.repoConfig()).toBe(false);
  });
});

describe('共有ドライブの持ち主と管理者', () => {
  it('持ち主は管理者 (organizer) 全員。グループは数えない', () => {
    const { ctx } = setupShared();
    expect(ctx.repoOwners_().sort()).toEqual(['boss@example.com', 'tester@example.com']);
  });

  it('管理者はコンテンツ管理者と投稿者まで。閲覧者とグループは違う', () => {
    const { ctx } = setupShared();
    for (const who of ['tester@example.com', 'boss@example.com', 'manager@example.com', 'writer@example.com']) {
      expect(ctx.repoIsAdmin_(who)).toBe(true);
    }
    expect(ctx.repoIsAdmin_('reader@example.com')).toBe(false);
    expect(ctx.repoIsAdmin_('team@example.com')).toBe(false);
  });

  it('エディタ専用の関数は、どの管理者 (organizer) でも動く。投稿者には動かない', () => {
    const { ctx, fake } = setupShared();
    fake._setUser('boss@example.com');
    expect(() => ctx.debugEnableSelfApprove()).not.toThrow();
    ctx.debugDisableSelfApprove();
    fake._setUser('writer@example.com');
    expect(() => ctx.debugEnableSelfApprove()).toThrow(/持ち主だけ/);
  });

  it('全頁を読む', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ emailAddress: 'w' + i + '@example.com', role: 'writer', type: 'user' }));
    many.push({ emailAddress: 'last@example.com', role: 'organizer', type: 'user' });
    const { ctx } = setupShared({ members: many, pageSize: 100 });
    expect(ctx.repoOwners_()).toEqual(['last@example.com']);
  });

  // loadGasWith は fake そのものを文脈にする (ctx === fake)。読み込んだあとに fake.Drive や
  // fake.CacheService を差し替えれば、そのまま効く
  it('役割が読めなければ誰も持ち主ではない。失敗は覚えない', () => {
    const { ctx, fake } = setupShared();
    const cache = new Map();
    fake.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) };
    fake.Drive = fake._makeDrive({ members: {} });
    expect(ctx.repoOwners_()).toEqual([]);
    expect(ctx.repoIsAdmin_('tester@example.com')).toBe(false);
    expect(() => ctx.assertOwner_()).toThrow(/持ち主だけ/);
    expect(cache.size).toBe(0);
    fake.Drive = fake._makeDrive({ members: { 'drive-1': MEMBERS } });
    expect(ctx.repoOwners_().length).toBe(2);
  });

  it('アドレスの大文字小文字が違っても、管理者は持ち主・管理者として通る', () => {
    const members = [
      { emailAddress: 'Boss@Example.com', role: 'organizer', type: 'user' },
      { emailAddress: 'Writer@Example.com', role: 'writer', type: 'user' },
    ];
    const { ctx, fake } = setupShared({ members });
    fake._setUser('boss@example.com');
    expect(() => ctx.assertOwner_()).not.toThrow();
    expect(ctx.repoIsAdmin_('boss@example.com')).toBe(true);
    expect(ctx.repoIsAdmin_('WRITER@example.com')).toBe(true);
    // Session の側が大文字混じりでも通る
    fake._setUser('BOSS@example.COM');
    expect(() => ctx.assertOwner_()).not.toThrow();
  });

  it('報告を書いた本人が持ち主なら、大文字小文字が違っても本人には送らない', () => {
    const members = [
      { emailAddress: 'Boss@Example.com', role: 'organizer', type: 'user' },
      { emailAddress: 'tester@example.com', role: 'organizer', type: 'user' },
    ];
    const { ctx, fake } = setupShared({ members });
    fake._setUser('BOSS@example.com');
    ctx.inquiryCreate('bug', '動かない', '押しても何も起きない', []);
    expect(fake._sentMails().map((m) => m.to)).toEqual(['tester@example.com']);
  });

  it('管理者 (organizer) が1人も居ない読みは失敗として扱い、覚えない', () => {
    const { ctx, fake } = setupShared();
    const cache = new Map();
    fake.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) };
    fake.Drive = fake._makeDrive({ members: { 'drive-1': MEMBERS.filter((m) => m.role !== 'organizer' || m.type !== 'user') } });
    expect(ctx.repoOwners_()).toEqual([]);
    expect(ctx.repoIsAdmin_('writer@example.com')).toBe(false);
    expect(cache.size).toBe(0);
    fake.Drive = fake._makeDrive({ members: { 'drive-1': MEMBERS } });
    expect(ctx.repoOwners_().sort()).toEqual(['boss@example.com', 'tester@example.com']);
    expect(fake.Drive._calls.permissionsList).toBeGreaterThan(0);
  });

  it('役割は10分覚え、続けて聞かない', () => {
    const { ctx, fake } = setupShared();
    const cache = new Map();
    fake.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) };
    ctx.repoOwners_();
    const n = fake.Drive._calls.permissionsList;
    ctx.repoOwners_();
    ctx.repoIsAdmin_('writer@example.com');
    expect(fake.Drive._calls.permissionsList).toBe(n);
  });
});

describe('共有ドライブの報告', () => {
  it('知らせは持ち主全員に届き、書いた本人には送らない。やることの担当は空', () => {
    const { ctx, fake } = setupShared();
    fake._setUser('writer@example.com');
    ctx.inquiryCreate('bug', '動かない', '押しても何も起きない', []);
    const to = fake._sentMails().map((m) => m.to).sort();
    expect(to).toEqual(['boss@example.com', 'tester@example.com']);
    const issue = ctx.dbReadAll('issues').find((r) => String(r.title).indexOf('[報告 #') === 0);
    expect(String(issue.assignee || '')).toBe('');
  });

  it('マイドライブでは今までどおり持ち主1人が担当になる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    fake._setUser('writer@example.com');
    ctx.inquiryCreate('bug', '動かない', '押しても何も起きない', []);
    const issue = ctx.dbReadAll('issues').find((r) => String(r.title).indexOf('[報告 #') === 0);
    expect(String(issue.assignee)).toBe('tester@example.com');
  });
});

describe('共有ドライブで命令を置いた人', () => {
  it('持ち主が無いので、最後に書いた人を読む', () => {
    const { ctx, fake } = setupShared();
    const queue = ctx.commandQueueFolder_();
    fake._setUser('writer@example.com');
    const f = queue.createFile('t2.cmd.json', '{}', 'text/plain');
    fake._setUser('tester@example.com');
    expect(ctx.commandOwner_(f)).toBe('writer@example.com');
  });
});

describe('実機で確かめる入口 (debugVerifySharedDrive)', () => {
  it('共有ドライブで全部通り、置いた命令を片付ける', () => {
    const { ctx } = setupShared();
    const out = ctx.debugVerifySharedDrive();
    expect(out).toContain('すべて通りました');
    expect(ctx.commandQueueFolder_().getFilesByName('verify-shared.cmd.json').hasNext()).toBe(false);
    expect(ctx.commandQueueFolder_().getFilesByName('verify-shared.result.json').hasNext()).toBe(false);
  });

  it('マイドライブでは「共有ドライブではありません」と言って止まる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.debugVerifySharedDrive()).toContain('共有ドライブではありません');
  });
});
