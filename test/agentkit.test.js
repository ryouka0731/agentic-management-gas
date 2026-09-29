import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { buildKitSource, FILES } from '../scripts/build-kit.mjs';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/CommandQueue.gs',
  'src/KitFiles.gs',
  'src/core/AgentKit.gs',
];

/** kit/ にある本物のファイルを読む */
function kitText(name) {
  return fs.readFileSync('kit/' + name, 'utf8');
}

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('手元から動かす道具を配る', () => {
  it('必要なものが揃っている', () => {
    const { ctx } = setup();
    const names = Object.keys(ctx.KIT_FILES());

    expect(names).toContain('agent.mjs');
    expect(names).toContain('README.md');
    expect(names).toContain('AGENTS.md');
    // Claude も Codex も、同じ内容を別の名前で読みに行く
    expect(names).toContain('CLAUDE.md');
  });

  it('落とせる場所を返す', () => {
    const { ctx } = setup();
    const kit = ctx.agentKitFile();

    expect(kit.name).toContain(ctx.AGENT_KIT_VERSION());
    expect(kit.url).toContain('drive.google.com');
  });

  it('二度目は作り直さない', () => {
    const { ctx } = setup();
    const first = ctx.agentKitFile();

    expect(ctx.agentKitFile().url).toBe(first.url);
  });

  it('設定に書く場所を教える', () => {
    const { ctx } = setup();
    const kit = ctx.agentKitFile();

    // ここがいちばん詰まる。当てさせない
    expect(kit.queuePath).toMatch(/\/\.git\/queue$/);
    expect(kit.queuePath.split('/').length).toBeGreaterThan(2);
    expect(kit.queueUrl).toContain('drive.google.com/drive/folders/');
  });

  it('置き場は無ければ作る', () => {
    const { ctx } = setup();
    ctx.agentKitFile();

    expect(ctx.agentKitFolder_().getName()).toBe('kit');
  });
});

describe('中身が壊れずに運ばれるか', () => {
  it('焼き直したものを戻すと元の字に一致する', () => {
    const { ctx } = setup();
    const files = ctx.KIT_FILES();

    // 中身をそのまま HTML ファイルとして置くと `<id>` がタグと解釈され、
    // `-->` がコメントの終わりと読まれて壊れる。実際に壊れた
    FILES.forEach(([from, to]) => {
      const back = Buffer.from(files[to], 'base64').toString('utf8');
      expect(back).toBe(kitText(from));
    });
  });

  it('タグに見える字がそのまま残っている', () => {
    const { ctx } = setup();
    const agents = Buffer.from(ctx.KIT_FILES()['AGENTS.md'], 'base64')
      .toString('utf8');

    expect(agents).toContain('<id>.cmd.json');
    expect(agents).toContain('<mainFileId>');
    expect(agents).toContain('-->');
  });

  it('kit/ を直したら焼き直しが要ると分かる', () => {
    // 焼き直しを忘れると、古い中身が配られ続ける
    const now = fs.readFileSync('src/KitFiles.gs', 'utf8');
    expect(buildKitSource()).toBe(now);
  });

  it('焼き直したものは手で直さないと書いてある', () => {
    expect(fs.readFileSync('src/KitFiles.gs', 'utf8'))
      .toContain('手で直さない');
  });
});

describe('道具の中身', () => {
  it('手元で動く形になっている', () => {
    const text = kitText('agent.mjs');

    // 鍵もトークンも要らない。置くだけで動くことが要点
    expect(text).toContain('queueDir');
    expect(text).toContain('.cmd.json');
    expect(text).toContain('.result.json');
  });

  it('そのまま node で動く', () => {
    // .html の皮をかぶせていたころは、そのままでは動かなかった
    expect(kitText('agent.mjs').startsWith('#!/usr/bin/env node')).toBe(true);
    expect(() => JSON.parse(kitText('package.json'))).not.toThrow();
    expect(() => JSON.parse(kitText('agentkit.example.json'))).not.toThrow();
  });

  it('できないことを AGENTS.md に書いてある', () => {
    const text = kitText('AGENTS.md');

    expect(text).toContain('正式版 (main) は直接なおせません');
    expect(text).toContain('確認依頼の承認はできません');
  });

  it('この道具の言葉を使わせている', () => {
    const text = kitText('AGENTS.md');

    // Git の言葉のまま出されると、読む人に伝わらない
    expect(text).toContain('| 正式版 | main |');
    expect(text).toContain('| 確認依頼 | プルリクエスト |');
  });

  it('待ち時間があることを断ってある', () => {
    expect(kitText('AGENTS.md')).toContain('遅延は最大1分');
  });
});

describe('古い zip の片付け', () => {
  it('前の版は名前が違っても片付ける', () => {
    const { ctx } = setup();
    const folder = ctx.agentKitFolder_();

    // 壊れていたころのものが残っていると、前に配ったリンクから落ち続ける
    folder.createFile('agentic-management-agent-kit-1.0.0.zip', 'ふるい', 'application/zip');
    folder.createFile('softbanto-agent-kit-1.1.0.zip', 'ふるい', 'application/zip');

    ctx.agentKitBuild_();

    const left = [];
    const it = folder.getFiles();
    while (it.hasNext()) left.push(it.next().getName());

    expect(left).toEqual(['softbanto-agent-kit-' + ctx.AGENT_KIT_VERSION() + '.zip']);
  });

  it('zip でないものは片付けない', () => {
    const { ctx } = setup();
    const folder = ctx.agentKitFolder_();
    folder.createFile('おぼえがき.txt', 'x', 'text/plain');

    ctx.agentKitBuild_();

    const left = [];
    const it = folder.getFiles();
    while (it.hasNext()) left.push(it.next().getName());

    expect(left).toContain('おぼえがき.txt');
  });
});
