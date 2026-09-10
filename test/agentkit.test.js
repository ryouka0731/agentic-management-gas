import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/AgentKit.gs',
];

/** GAS に置いてある道具一式を、そのまま読む */
function kitText(name) {
  return fs.readFileSync('src/kit/' + name + '.html', 'utf8');
}

function setup() {
  const fake = createFakeGas();
  ['agent.mjs', 'package.json', 'agentkit.example.json', 'README.md', 'AGENTS.md']
    .forEach((name) => fake._setKitFile('kit/' + name, kitText(name)));

  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('手元から動かす道具を配る', () => {
  it('必要なものが揃っている', () => {
    const { ctx } = setup();
    const names = ctx.AGENT_KIT_FILES().map((pair) => pair[1]);

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
    const second = ctx.agentKitFile();

    expect(second.url).toBe(first.url);
  });

  it('置き場は無ければ作る', () => {
    const { ctx } = setup();
    ctx.agentKitFile();

    expect(ctx.agentKitFolder_().getName()).toBe('kit');
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
