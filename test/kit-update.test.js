import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import {
  checkForUpdate, installFromServer, rollback, kitPrintOf, safeName, readConfig, writeConfig, paths,
} from '../kit/track/update.mjs';

const NOW = Date.parse('2026-10-15T00:00:00Z');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-up-'));
  const home = path.join(root, 'banto');
  const claude = path.join(root, 'claude');
  fs.mkdirSync(home);
  fs.mkdirSync(claude);
  return { root, home, claude };
}

/** 向こう側の代わり。files を配る */
function server(files, version) {
  const print = kitPrintOf(files);
  const calls = [];
  const send = async (op, args) => {
    calls.push({ op, args });
    if (op === 'kitVersion') return { ok: true, result: { version, print } };
    if (op === 'kitFiles') return { ok: true, result: { version, print, files } };
    return { ok: false, error: 'unknown' };
  };
  return { send, calls, print };
}

const V1 = { 'agent.mjs': b64('v1'), 'track/SKILL.md': b64('skill v1'), 'track/hook.mjs': b64('hook v1') };
const V2 = { 'agent.mjs': b64('v2'), 'track/SKILL.md': b64('skill v2'), 'track/hook.mjs': b64('hook v1'), 'new.md': b64('n') };

async function installed(d) {
  writeConfig(d.home, { queueDir: '/q' });
  await installFromServer({ home: d.home, claude: d.claude, send: server(V1, '1.0.0').send, now: NOW, link: true });
}

describe('指紋', () => {
  it('番頭の kitPrint_ と同じ値になる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, 'src/core/Hash.js', 'src/core/HashGas.gs', 'src/KitFiles.gs', 'src/core/AgentKit.gs');
    expect(kitPrintOf(ctx.KIT_FILES())).toBe(ctx.kitPrint_());
  });
});

describe('名前の検査', () => {
  it('道具の置き場の外を指す名前は捨てる', () => {
    expect(safeName('agent.mjs')).toBe('agent.mjs');
    expect(safeName('.claude/skills/a/SKILL.md')).toBe('.claude/skills/a/SKILL.md');
    expect(safeName('../x')).toBeNull();
    expect(safeName('a/../../x')).toBeNull();
    expect(safeName('/etc/passwd')).toBeNull();
    expect(safeName('C:/x')).toBeNull();
    expect(safeName('a\\..\\x')).toBeNull();
    expect(safeName('')).toBeNull();
  });
});

describe('入れる', () => {
  it('受け取った中身を置き、スキルとフックを写す', async () => {
    const d = dirs();
    await installed(d);
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
    expect(fs.readFileSync(path.join(d.claude, 'skills', 'banto-track', 'SKILL.md'), 'utf8')).toBe('skill v1');
    expect(fs.readFileSync(path.join(d.home, 'hooks', 'track-hook.mjs'), 'utf8')).toBe('hook v1');
    expect(readConfig(d.home).kitPrint).toBe(kitPrintOf(V1));
  });

  it('外を指す名前は書かない', async () => {
    const d = dirs();
    writeConfig(d.home, { queueDir: '/q' });
    const evil = { 'agent.mjs': b64('x'), '../../evil.txt': b64('e'), '/tmp/abs.txt': b64('e') };
    await installFromServer({ home: d.home, claude: d.claude, send: server(evil, '1').send, now: NOW });
    expect(fs.existsSync(path.join(d.root, 'evil.txt'))).toBe(false);
    expect(fs.readdirSync(path.join(d.home, 'kit'))).toEqual(['agent.mjs']);
  });

  it('指紋が合わなければ何も変えない', async () => {
    const d = dirs();
    await installed(d);
    const bad = async (op) => op === 'kitFiles'
      ? { ok: true, result: { version: '2', print: 'deadbeef', files: V2 } }
      : { ok: true, result: { version: '2', print: 'deadbeef' } };
    await expect(installFromServer({ home: d.home, claude: d.claude, send: bad, now: NOW + 1000 }))
      .rejects.toThrow('指紋が合いません');
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
    expect(fs.existsSync(paths(d.home).backup)).toBe(false);
  });

  it('入れていない人の ~/.claude にはスキルを写さない', async () => {
    const d = dirs();
    writeConfig(d.home, { queueDir: '/q' });
    await installFromServer({ home: d.home, claude: d.claude, send: server(V1, '1').send, now: NOW });
    expect(fs.existsSync(path.join(d.claude, 'skills'))).toBe(false);
  });
});

describe('1日1回の確認', () => {
  it('24時間以内は確かめない', async () => {
    const d = dirs();
    await installed(d);
    writeConfig(d.home, { lastUpdateCheck: new Date(NOW - 3600000).toISOString() });
    const s = server(V2, '2.0.0');
    expect((await checkForUpdate({ home: d.home, claude: d.claude, send: s.send, now: NOW })).checked).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('設定が無ければ確かめない', async () => {
    const d = dirs();
    const s = server(V2, '2.0.0');
    expect((await checkForUpdate({ home: d.home, claude: d.claude, send: s.send, now: NOW })).checked).toBe(false);
    expect(s.calls).toEqual([]);
  });

  it('指紋が同じなら中身を取らない', async () => {
    const d = dirs();
    await installed(d);
    const s = server(V1, '1.0.0');
    const r = await checkForUpdate({ home: d.home, claude: d.claude, send: s.send, now: NOW + 2 * 86400000 });
    expect(r).toMatchObject({ checked: true, updated: false });
    expect(s.calls.map((c) => c.op)).toEqual(['kitVersion']);
    // 自分の指紋を名乗る (番頭が「更新あり」を消すため)
    expect(s.calls[0].args.mine).toBe(kitPrintOf(V1));
  });

  it('新しい版なら控えを取ってから入れ替え、変わったものを記録する', async () => {
    const d = dirs();
    await installed(d);
    const r = await checkForUpdate({ home: d.home, claude: d.claude, send: server(V2, '2.0.0').send, now: NOW + 2 * 86400000 });
    expect(r.updated).toBe(true);
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v2');
    expect(fs.readFileSync(path.join(d.claude, 'skills', 'banto-track', 'SKILL.md'), 'utf8')).toBe('skill v2');
    const backups = fs.readdirSync(paths(d.home).backup);
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(paths(d.home).backup, backups[0], 'agent.mjs'), 'utf8')).toBe('v1');
    const log = JSON.parse(fs.readFileSync(paths(d.home).log, 'utf8'));
    expect(log.version).toBe('2.0.0');
    expect(log.changed).toEqual(['agent.mjs', 'new.md', 'track/SKILL.md']);
  });

  it('消えたファイルは置き場からも消える', async () => {
    const d = dirs();
    await installed(d);
    const V3 = { 'agent.mjs': b64('v3') };
    await checkForUpdate({ home: d.home, claude: d.claude, send: server(V3, '3').send, now: NOW + 2 * 86400000 });
    expect(fs.existsSync(path.join(d.home, 'kit', 'track'))).toBe(false);
  });

  it('自動で入れない設定なら知らせるだけ', async () => {
    const d = dirs();
    await installed(d);
    writeConfig(d.home, { autoUpdate: false });
    const s = server(V2, '2.0.0');
    const r = await checkForUpdate({ home: d.home, claude: d.claude, send: s.send, now: NOW + 2 * 86400000 });
    expect(r).toMatchObject({ checked: true, updated: false, available: true });
    expect(s.calls.map((c) => c.op)).toEqual(['kitVersion']);
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
    expect(JSON.parse(fs.readFileSync(paths(d.home).log, 'utf8')).available).toBe('2.0.0');
  });

  it('向こうが失敗しても、次の確認は翌日にする', async () => {
    const d = dirs();
    await installed(d);
    const down = async () => ({ ok: false, error: '止まっています' });
    await expect(checkForUpdate({ home: d.home, claude: d.claude, send: down, now: NOW + 2 * 86400000 }))
      .rejects.toThrow('止まっています');
    expect(readConfig(d.home).lastUpdateCheck).toBe(new Date(NOW + 2 * 86400000).toISOString());
  });

  it('控えは新しい3つだけ残す', async () => {
    const d = dirs();
    await installed(d);
    for (let i = 1; i <= 5; i++) {
      const files = { 'agent.mjs': b64('v' + (i + 1)) };
      await checkForUpdate({ home: d.home, claude: d.claude, send: server(files, String(i)).send,
        now: NOW + i * 2 * 86400000 });
    }
    expect(fs.readdirSync(paths(d.home).backup)).toHaveLength(3);
  });
});

describe('戻す', () => {
  it('最後の控えに戻し、その版を翌日に入れ直さない', async () => {
    const d = dirs();
    await installed(d);
    const s2 = server(V2, '2.0.0');
    await checkForUpdate({ home: d.home, claude: d.claude, send: s2.send, now: NOW + 2 * 86400000 });

    rollback({ home: d.home, claude: d.claude });

    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
    expect(fs.existsSync(path.join(d.home, 'kit', 'backup.json'))).toBe(false);
    expect(fs.readFileSync(path.join(d.claude, 'skills', 'banto-track', 'SKILL.md'), 'utf8')).toBe('skill v1');
    expect(readConfig(d.home).kitPrint).toBe(kitPrintOf(V1));

    const again = await checkForUpdate({ home: d.home, claude: d.claude, send: s2.send, now: NOW + 4 * 86400000 });
    expect(again).toMatchObject({ updated: false, skipped: true });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('手で頼んだときは飛ばした版も入れる', async () => {
    const d = dirs();
    await installed(d);
    const s2 = server(V2, '2.0.0');
    await checkForUpdate({ home: d.home, claude: d.claude, send: s2.send, now: NOW + 2 * 86400000 });
    rollback({ home: d.home, claude: d.claude });
    const r = await checkForUpdate({ home: d.home, claude: d.claude, send: s2.send, now: NOW + 2 * 86400000 + 1, force: true });
    expect(r.updated).toBe(true);
  });

  it('2回戻しても、戻した元の版を翌日に入れ直さない', async () => {
    const d = dirs();
    await installed(d);
    const files = (n) => ({ 'agent.mjs': b64('v' + n) });
    await checkForUpdate({ home: d.home, claude: d.claude, send: server(files(2), '2').send, now: NOW + 2 * 86400000 });
    const s3 = server(files(3), '3');
    await checkForUpdate({ home: d.home, claude: d.claude, send: s3.send, now: NOW + 4 * 86400000 });
    rollback({ home: d.home, claude: d.claude });
    rollback({ home: d.home, claude: d.claude });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
    const r = await checkForUpdate({ home: d.home, claude: d.claude, send: s3.send, now: NOW + 6 * 86400000 });
    expect(r).toMatchObject({ updated: false, skipped: true });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('落ちた跡の kit.old / kit.new があっても次の入れ替えは通る', async () => {
    const d = dirs();
    await installed(d);
    for (const n of ['kit.old', 'kit.new']) {
      fs.mkdirSync(path.join(d.home, n));
      fs.writeFileSync(path.join(d.home, n, 'junk'), 'x');
    }
    await checkForUpdate({ home: d.home, claude: d.claude, send: server(V2, '2.0.0').send, now: NOW + 2 * 86400000 });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v2');
    expect(fs.existsSync(path.join(d.home, 'kit.old'))).toBe(false);
    expect(fs.existsSync(path.join(d.home, 'kit.new'))).toBe(false);
    rollback({ home: d.home, claude: d.claude });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('控えが無ければ断る', () => {
    const d = dirs();
    expect(() => rollback({ home: d.home, claude: d.claude })).toThrow('戻せる控えがありません');
  });
});
