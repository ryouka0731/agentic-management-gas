import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import {
  checkForUpdate, installFromServer, rollback, kitPrintOf, safeName, readConfig, writeConfig, paths,
  tickUpdate, dropPending, staleUpdateFiles, checkFiles,
} from '../kit/track/update.mjs';
import { TEST_KEYS, signKit } from './kitkeys.js';

const NOW = Date.parse('2026-10-15T00:00:00Z');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/** フォルダの中身を、名前 → 字で読む (変わっていないことを1字単位で比べる) */
function tree(dir) {
  const out = {};
  (function visit(rel) {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const next = rel ? rel + '/' + name : name;
      if (fs.statSync(path.join(dir, next)).isDirectory()) visit(next);
      else out[next] = fs.readFileSync(path.join(dir, next), 'utf8');
    }
  })('');
  return out;
}

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-up-'));
  const home = path.join(root, 'banto');
  const claude = path.join(root, 'claude');
  fs.mkdirSync(home);
  fs.mkdirSync(claude);
  return { root, home, claude };
}

/** 向こう側の代わり。files を配る (テストの鍵で署名を付ける) */
function server(files, version) {
  const print = kitPrintOf(files);
  const signature = signKit(version, files, TEST_KEYS.priv);
  const calls = [];
  const send = async (op, args) => {
    calls.push({ op, args });
    if (op === 'kitVersion') return { ok: true, result: { version, print } };
    if (op === 'kitFiles') return { ok: true, result: { version, print, files, signature } };
    return { ok: false, error: 'unknown' };
  };
  return { send, calls, print };
}

/** 欠けると入れないもの。agent.mjs が無いと戻す命令ごと無くなる (agent.mjs が読み込むものも同じ)。署名を確かめる公開鍵も配る */
const kit = (agent, more) => ({ 'agent.mjs': b64(agent), 'track/hook.mjs': b64('hook v1'),
  'track/update.mjs': b64('update v1'), 'track/track.mjs': b64('track v1'), 'track/local.mjs': b64('local v1'), 'track/kit-key.pem': b64(TEST_KEYS.pub), ...(more || {}) });
const quiet = () => {};
const V1 = kit('v1', { 'track/SKILL.md': b64('skill v1') });
const V2 = kit('v2', { 'track/SKILL.md': b64('skill v2'), 'new.md': b64('n') });

async function installed(d) {
  writeConfig(d.home, { queueDir: '/q' });
  // 最初の1回は鍵をまだ持たないので、手で頼んだ扱いで入れる
  await installFromServer({ home: d.home, claude: d.claude, send: server(V1, '1.0.0').send, now: NOW, link: true,
    manual: true, warn: quiet });
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

  it('外を指す名前が1つでも混ざれば、何も書かずに断る', async () => {
    const d = dirs();
    await installed(d);
    const before = tree(d.home);
    for (const bad of ['../../evil.txt', '/tmp/abs.txt', 'a\\b', '']) {
      const evil = kit('x', { [bad]: b64('e') });
      await expect(installFromServer({ home: d.home, claude: d.claude, send: server(evil, '1').send, now: NOW + 1000 }))
        .rejects.toThrow('入れ替えませんでした');
      expect(fs.existsSync(path.join(d.root, 'evil.txt'))).toBe(false);
      expect(tree(d.home)).toEqual(before);
    }
  });

  it('中身が空・字・配列・欠けていれば、置き場も控えも変えずに断る', async () => {
    const d = dirs();
    await installed(d);
    const before = tree(d.home);
    const noAgent = kit('x');
    delete noAgent['agent.mjs'];
    const noUpdate = kit('x');
    delete noUpdate['track/update.mjs'];
    const noHook = kit('x');
    delete noHook['track/hook.mjs'];
    // agent.mjs が読み込むもの。欠けると agent.mjs ごと動かず、update rollback もできなくなる
    const noLocal = kit('x');
    delete noLocal['track/local.mjs'];
    const noTrack = kit('x');
    delete noTrack['track/track.mjs'];
    const notString = kit('x', { 'more.md': 5 });
    for (const files of [{}, 'zz', [b64('a')], null, noAgent, noUpdate, noHook, noLocal, noTrack, notString]) {
      // 名乗る指紋は届いた中身と合わせる (指紋だけでは防げないことを確かめる)
      const send = async () => ({ ok: true, result: { version: '9', print: kitPrintOf(files), files } });
      await expect(installFromServer({ home: d.home, claude: d.claude, send, now: NOW + 1000 }), JSON.stringify(files))
        .rejects.toThrow('入れ替えませんでした');
      expect(tree(d.home), JSON.stringify(files)).toEqual(before);
    }
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('agent.mjs が読み込むもの (track/local.mjs・track/track.mjs) が欠けた中身は、確かめる時点で断る', () => {
    // 欠けたまま入れると agent.mjs が読み込めずに落ち、update rollback もできなくなる
    expect(() => checkFiles(kit('x'))).not.toThrow();
    for (const name of ['track/local.mjs', 'track/track.mjs']) {
      const files = kit('x');
      delete files[name];
      expect(() => checkFiles(files), name).toThrow('欠けています (' + name + ')');
    }
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
    await installFromServer({ home: d.home, claude: d.claude, send: server(V1, '1').send, now: NOW,
      manual: true, warn: quiet });
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
    const V3 = kit('v3');
    await checkForUpdate({ home: d.home, claude: d.claude, send: server(V3, '3').send, now: NOW + 2 * 86400000 });
    expect(fs.existsSync(path.join(d.home, 'kit', 'track', 'SKILL.md'))).toBe(false);
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
      const files = kit('v' + (i + 1));
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
    const files = (n) => kit('v' + n);
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

/**
 * 待たない入れ先の代わり。置いた命令を覚え、answer() で返事を書くまで collect は null を返す。
 */
function queue() {
  const placed = [];
  const results = new Map();
  const dropped = [];
  let n = 0;
  return {
    placed, dropped, results,
    place: (op, args) => { const id = 'kit-' + (++n) + '-x'; placed.push({ id, op, args }); return id; },
    collect: (id) => { if (!results.has(id)) return null; const r = results.get(id); results.delete(id); return r; },
    drop: (id) => { dropped.push(id); results.delete(id); },
    answer(id, res) { results.set(id, res); },
    last() { return placed[placed.length - 1]; },
  };
}

describe('1日1回の確認は待たない', () => {
  const DAY = 86400000;

  it('確かめる日には、版を尋ねる命令を置いて覚えるだけで帰る', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    const r = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    expect(r).toMatchObject({ updated: false });
    expect(q.placed.map((c) => c.op)).toEqual(['kitVersion']);
    expect(q.placed[0].args.mine).toBe(kitPrintOf(V1));
    const c = readConfig(d.home);
    expect(c.pendingUpdate).toEqual({ op: 'kitVersion', id: q.placed[0].id, at: new Date(NOW + 2 * DAY).toISOString() });
    expect(c.lastUpdateCheck).toBe(new Date(NOW + 2 * DAY).toISOString());
  });

  it('24時間以内で待っている命令も無ければ、何も置かない', async () => {
    const d = dirs();
    await installed(d);
    writeConfig(d.home, { lastUpdateCheck: new Date(NOW).toISOString() });
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 3600000 });
    expect(q.placed).toEqual([]);
  });

  it('返事がまだなら、もう1つは置かずに待ち続ける', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 60000 });
    expect(q.placed).toHaveLength(1);
    expect(readConfig(d.home).pendingUpdate.id).toBe(q.placed[0].id);
  });

  it('次に呼ばれたとき、新しい版の返事があれば中身を頼み、その次に入れ替える', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    const s = server(V2, '2.0.0');
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    q.answer(q.last().id, await s.send('kitVersion', {}));

    const second = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 60000 });
    expect(second.updated).toBe(false);
    expect(q.placed.map((c) => c.op)).toEqual(['kitVersion', 'kitFiles']);
    expect(readConfig(d.home).pendingUpdate.op).toBe('kitFiles');
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');

    q.answer(q.last().id, await s.send('kitFiles', {}));
    const third = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 120000 });
    expect(third).toMatchObject({ updated: true, version: '2.0.0' });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v2');
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
    const log = JSON.parse(fs.readFileSync(paths(d.home).log, 'utf8'));
    expect(log).toMatchObject({ version: '2.0.0', changed: ['agent.mjs', 'new.md', 'track/SKILL.md'] });
  });

  it('同じ版なら、中身は頼まずに待ちを外す', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    q.answer(q.last().id, await server(V1, '1.0.0').send('kitVersion', {}));
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 60000 });
    expect(q.placed.map((c) => c.op)).toEqual(['kitVersion']);
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
  });

  it('自動で入れない設定なら、新しい版があることだけ記録する', async () => {
    const d = dirs();
    await installed(d);
    writeConfig(d.home, { autoUpdate: false });
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    q.answer(q.last().id, await server(V2, '2.0.0').send('kitVersion', {}));
    const r = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 60000 });
    expect(r).toMatchObject({ updated: false, available: true });
    expect(q.placed.map((c) => c.op)).toEqual(['kitVersion']);
    expect(JSON.parse(fs.readFileSync(paths(d.home).log, 'utf8')).available).toBe('2.0.0');
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('戻した版は、待たない確認でも入れ直さない', async () => {
    const d = dirs();
    await installed(d);
    await checkForUpdate({ home: d.home, claude: d.claude, send: server(V2, '2.0.0').send, now: NOW + 2 * DAY });
    rollback({ home: d.home, claude: d.claude });
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 4 * DAY });
    q.answer(q.last().id, await server(V2, '2.0.0').send('kitVersion', {}));
    const r = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 4 * DAY + 1 });
    expect(r).toMatchObject({ skipped: true });
    expect(q.placed.map((c) => c.op)).toEqual(['kitVersion']);
  });

  it('24時間たっても返らない命令は捨て、ファイルも片付ける', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    const stale = q.last().id;
    q.answer(stale, await server(V2, '2.0.0').send('kitVersion', {}));
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 3 * DAY + 1 });
    expect(q.dropped).toEqual([stale]);
    // 古い返事は読まない。捨てたあとは、その日の確認として新しく尋ねる
    expect(q.placed.map((c) => c.op)).toEqual(['kitVersion', 'kitVersion']);
    expect(readConfig(d.home).pendingUpdate.id).toBe(q.last().id);
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('読めない待ちの記録は捨てる', async () => {
    const d = dirs();
    await installed(d);
    writeConfig(d.home, { lastUpdateCheck: new Date(NOW).toISOString(), pendingUpdate: { op: 'rm', id: '../x', at: 'zz' } });
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 1000 });
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
    expect(q.placed).toEqual([]);
  });

  it('向こうが断った返事でも、待ちを外して翌日まで尋ねない', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    q.answer(q.last().id, { ok: false, error: '止まっています' });
    await expect(tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 1 }))
      .rejects.toThrow('止まっています');
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 2 });
    expect(q.placed).toHaveLength(1);
  });

  /** kitVersion を置いて新しい版と答え、kitFiles を置かせたところまで進める */
  async function filesPending(d, q, s) {
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    q.answer(q.last().id, await s.send('kitVersion', {}));
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 1 });
    expect(readConfig(d.home).pendingUpdate.op).toBe('kitFiles');
  }

  it('中身を頼んだあとで自動で入れない設定にしたら、届いても入れずに知らせるだけ', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    const s = server(V2, '2.0.0');
    await filesPending(d, q, s);
    writeConfig(d.home, { autoUpdate: false });
    q.answer(q.last().id, await s.send('kitFiles', {}));
    const r = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 2 });
    expect(r).toMatchObject({ updated: false, available: true, version: '2.0.0' });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
    expect(fs.existsSync(paths(d.home).backup)).toBe(false);
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
  });

  it('中身を頼んだあとでその版を戻したことになっていれば、届いても入れない', async () => {
    const d = dirs();
    await installed(d);
    await checkForUpdate({ home: d.home, claude: d.claude, send: server(V2, '2.0.0').send, now: NOW + DAY });
    rollback({ home: d.home, claude: d.claude });
    const q = queue();
    // 戻す前に置いた kitFiles が残っていた形 (戻す命令が捨てる前に別の呼び出しが書いた)
    writeConfig(d.home, { pendingUpdate: { op: 'kitFiles', id: 'kitup-1-x', at: new Date(NOW + 2 * DAY).toISOString() } });
    q.answer('kitup-1-x', await server(V2, '2.0.0').send('kitFiles', {}));
    const r = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 1 });
    expect(r).toMatchObject({ updated: false, skipped: true });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8')).toBe('v1');
  });

  it('戻すときは、置いたままの確認の命令を捨てる', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    const s = server(V2, '2.0.0');
    await checkForUpdate({ home: d.home, claude: d.claude, send: s.send, now: NOW + DAY });
    writeConfig(d.home, { lastUpdateCheck: new Date(NOW).toISOString() });
    await filesPending(d, q, server(kit('v3'), '3.0.0'));
    const pendingId = readConfig(d.home).pendingUpdate.id;
    rollback({ home: d.home, claude: d.claude, drop: q.drop });
    expect(q.dropped).toEqual([pendingId]);
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
  });

  it('結果を拾うところで投げても、待ちを捨てて命令は止めない', async () => {
    const d = dirs();
    await installed(d);
    writeConfig(d.home, { lastUpdateCheck: new Date(NOW).toISOString(),
      pendingUpdate: { op: 'kitVersion', id: 'bad id', at: new Date(NOW).toISOString() } });
    const q = queue();
    const dropped = [];
    const hands = { ...q, collect: () => { throw new Error('命令の id が読めません'); },
      drop: (id) => { dropped.push(id); throw new Error('命令の id が読めません'); } };
    await expect(tickUpdate({ home: d.home, claude: d.claude, ...hands, now: NOW + 1000 })).resolves.toMatchObject({ updated: false });
    expect(dropped).toEqual(['bad id']);
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
  });

  it('この確認が置いて24時間たった命令と結果を片付ける。待っているものとほかの命令は残す', async () => {
    const t = NOW + 3 * DAY;
    const old = 'kitup-' + (t - DAY - 1) + '-aa';
    const fresh = 'kitup-' + (t - 1000) + '-bb';
    const keep = 'kitup-' + (t - 2 * DAY) + '-cc';
    const names = [old + '.result.json', old + '.cmd.json', fresh + '.result.json', keep + '.result.json',
      'kit-' + (t - 2 * DAY) + '-dd.result.json', 'other.txt', 'kitup-zz-aa.result.json'];
    expect(staleUpdateFiles(names, t, keep).sort()).toEqual([old + '.cmd.json', old + '.result.json']);

    const d = dirs();
    await installed(d);
    const calls = [];
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, sweep: (k, n) => calls.push([k, n]), now: NOW + 2 * DAY });
    expect(calls).toEqual([['', NOW + 2 * DAY]]);
    await tickUpdate({ home: d.home, claude: d.claude, ...q,
      sweep: (k) => { calls.push([k]); throw new Error('読めません'); }, now: NOW + 2 * DAY + 1 });
    expect(calls[1]).toEqual([q.last().id]);
  });

  it('手で確かめる前に、置いたままの命令を捨てる', async () => {
    const d = dirs();
    await installed(d);
    const q = queue();
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    dropPending(d.home, q.drop);
    expect(q.dropped).toEqual([q.placed[0].id]);
    expect(readConfig(d.home).pendingUpdate).toBeFalsy();
  });
});
