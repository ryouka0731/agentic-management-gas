import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import * as sp from '../kit/track/spinner.mjs';
import { REQUIRED_FILES, writeConfig, readConfig } from '../kit/track/update.mjs';

/*
 * 手元の道具の oshi-spinner: Claude Code の考え中の字 (settings.json の spinnerVerbs) を推しのせりふにする。
 * 書くのは spinnerVerbs だけ・人が ok したときと、オンにした人の1日1回だけ・手で直したら触らない。
 * 番頭の側 (命令 oshiSpinner) は test/oshi-spinner.test.js。
 */

const AGENT = path.resolve('kit/agent.mjs');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-21T09:00:00Z');
const VERBS = ['テストを考え中', 'テストをまとめ中'];

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-spin-'));
  const home = path.join(root, 'banto');
  const claude = path.join(root, 'claude');
  const queue = path.join(root, 'queue');
  for (const d of [home, claude, queue]) fs.mkdirSync(d);
  return { root, home, claude, queue };
}

const settingsPath = (d) => path.join(d.claude, 'settings.json');
const readSettings = (d) => JSON.parse(fs.readFileSync(settingsPath(d), 'utf8'));
const ok = (lines, more) => ({ ok: true, result: { on: true, char: 'builtin:taku', name: 'タク', lines, reason: '', ...(more || {}) } });

/** オンにした状態を作る (人が ok したあと) */
function turnedOn(d, verbs = VERBS) {
  const plan = sp.planOn({ home: d.home, claude: d.claude, verbs });
  sp.turnOn({ home: d.home, claude: d.claude, plan, queueDir: d.queue, name: 'タク', char: 'builtin:taku', now: NOW });
  return plan;
}

describe('番頭と揃える', () => {
  it('字数と数の上限は番頭の oshiLineMaxOf / OSHI_SPINNER_MAX と同じ', () => {
    const pure = loadGas('src/core/Oshi.js');
    expect(sp.SPINNER_LINE_MAX).toBe(pure.oshiLineMaxOf('spinner'));
    expect(sp.SPINNER_COUNT_MAX).toBe(pure.OSHI_SPINNER_MAX());
  });

  it('agent.mjs が読み込む spinner.mjs は、欠けると入れないもの (REQUIRED_FILES) に入っている', () => {
    expect(REQUIRED_FILES).toContain('track/spinner.mjs');
    expect(fs.readFileSync(AGENT, 'utf8')).toContain("from './track/spinner.mjs'");
  });
});

describe('せりふを絞る (cleanVerbs)', () => {
  it('字だけ・制御文字と改行を落とし・24字を超えるもの・コードに見えるもの・重なりを捨て・20個まで', () => {
    expect(sp.cleanVerbs(Array.from({ length: 30 }, (_, i) => 'テスト' + i))).toHaveLength(20);
    expect(sp.cleanVerbs([
      ' テスト ', 'テスト', 7, null, { a: 1 }, ['x'], '', 'あ'.repeat(25), 'あ'.repeat(24),
      'テ\nスト中\r', 'テスト\u0007\u001b[2J', 'x\u202eコード', '"}, "hooks": {', '<script>', '`rm -rf ~`', '$(id)', 'a\\b',
    ])).toEqual(['テスト', 'あ'.repeat(24), 'テスト中', 'xコード']);
    expect(sp.cleanVerbs('テスト')).toEqual([]);
    expect(sp.cleanVerbs(undefined)).toEqual([]);
  });

  it('返事が違う形・オフ・空なら書くせりふは無く、理由がある', () => {
    expect(sp.verbsFromResult(null).reason).toContain('受け取れませんでした');
    expect(sp.verbsFromResult({ ok: false, error: '命令を置いた人が分かりません' }).reason).toContain('命令を置いた人が分かりません');
    const off = sp.verbsFromResult({ ok: true, result: { on: false, lines: VERBS, reason: '推しがオフです。テスト' } });
    expect(off.verbs).toEqual([]);
    expect(off.reason).toBe('推しがオフです。テスト');
    expect(sp.verbsFromResult(ok([5, '<b>'])).reason).toContain('書ける考え中のせりふがありません');
    expect(sp.verbsFromResult(ok(VERBS, { char: 'evil\ncode' }))).toMatchObject({ verbs: VERBS, char: '', name: 'タク' });
  });
});

describe('settings.json に書く (spinnerVerbs だけ)', () => {
  it('ほかの鍵・字下げ・最後の改行はそのまま、spinnerVerbs だけを置く', () => {
    const d = dirs();
    const before = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, env: { A: '1' } };
    fs.writeFileSync(settingsPath(d), JSON.stringify(before, null, 4) + '\n');
    sp.writeSpinner({ claude: d.claude, value: sp.spinnerValue(VERBS) });
    const text = fs.readFileSync(settingsPath(d), 'utf8');
    expect(text).toBe(JSON.stringify({ ...before, spinnerVerbs: { mode: 'replace', verbs: VERBS } }, null, 4) + '\n');
    // タブの字下げ・最後の改行なしもそのまま
    fs.writeFileSync(settingsPath(d), JSON.stringify(before, null, '\t'));
    sp.writeSpinner({ claude: d.claude, value: sp.spinnerValue(VERBS) });
    expect(fs.readFileSync(settingsPath(d), 'utf8')).toBe(JSON.stringify({ ...before, spinnerVerbs: sp.spinnerValue(VERBS) }, null, '\t'));
    // 外すときも、ほかの鍵はそのまま
    sp.writeSpinner({ claude: d.claude, value: undefined });
    expect(JSON.parse(fs.readFileSync(settingsPath(d), 'utf8'))).toEqual(before);
  });

  it('壊れた settings.json は何も変えずに断る', () => {
    const d = dirs();
    fs.writeFileSync(settingsPath(d), '{ "model": ');
    expect(() => sp.writeSpinner({ claude: d.claude, value: sp.spinnerValue(VERBS) })).toThrow('何も変えていません');
    expect(fs.readFileSync(settingsPath(d), 'utf8')).toBe('{ "model": ');
  });
});

describe('on / off', () => {
  it('on は前の値を覚え、off で前の値に戻す (ほかの鍵はそのまま)', () => {
    const d = dirs();
    const mine = { mode: 'append', verbs: ['自分の字'] };
    fs.writeFileSync(settingsPath(d), JSON.stringify({ model: 'opus', spinnerVerbs: mine }, null, 2) + '\n');
    const plan = turnedOn(d);
    expect(plan).toMatchObject({ has: true, before: mine, next: { mode: 'replace', verbs: VERBS } });
    expect(readSettings(d)).toEqual({ model: 'opus', spinnerVerbs: { mode: 'replace', verbs: VERBS } });
    // 書く前に控えを取る
    expect(fs.readdirSync(d.claude).some((n) => n.startsWith('settings.json.banto-backup-'))).toBe(true);
    expect(sp.spinnerStatus({ home: d.home, claude: d.claude })).toMatchObject({ on: true, matches: true, count: 2, name: 'タク' });

    // オンのまま入れ直しても、前の値は最初のもの (こちらで書いた値を前の値にしない)
    turnedOn(d, ['テストの2回目']);
    expect(sp.spinnerState(d.home)).toMatchObject({ had: true, previous: mine });

    expect(sp.turnOff({ home: d.home, claude: d.claude, now: NOW }).state).toBe('restored');
    expect(readSettings(d)).toEqual({ model: 'opus', spinnerVerbs: mine });
    expect(sp.spinnerState(d.home).on).toBe(false);
    expect(sp.turnOff({ home: d.home, claude: d.claude }).state).toBe('off');
  });

  it('前に spinnerVerbs が無ければ、off で鍵を外す。settings.json が無ければ作る', () => {
    const d = dirs();
    turnedOn(d);
    expect(readSettings(d)).toEqual({ spinnerVerbs: { mode: 'replace', verbs: VERBS } });
    expect(sp.turnOff({ home: d.home, claude: d.claude }).state).toBe('removed');
    expect(readSettings(d)).toEqual({});
  });

  it('手で直されていたら、off は触らずにそう返す (入れ替えも止める)', () => {
    const d = dirs();
    fs.writeFileSync(settingsPath(d), JSON.stringify({ model: 'opus' }));
    turnedOn(d);
    const edited = { model: 'opus', spinnerVerbs: { mode: 'replace', verbs: ['手で直した'] } };
    fs.writeFileSync(settingsPath(d), JSON.stringify(edited));
    expect(sp.spinnerStatus({ home: d.home, claude: d.claude }).matches).toBe(false);
    expect(sp.turnOff({ home: d.home, claude: d.claude }).state).toBe('edited');
    expect(readSettings(d)).toEqual(edited);
    expect(sp.spinnerState(d.home).on).toBe(false);
  });

  it('鍵の並びが変わっただけなら、同じ値として扱う', () => {
    expect(sp.sameSpinner({ verbs: ['a'], mode: 'replace' }, { mode: 'replace', verbs: ['a'] })).toBe(true);
    expect(sp.sameSpinner({ mode: 'replace', verbs: ['a'], x: 1 }, { mode: 'replace', verbs: ['a'] })).toBe(false);
    expect(sp.sameSpinner({ mode: 'append', verbs: ['a'] }, { mode: 'replace', verbs: ['a'] })).toBe(false);
    expect(sp.sameSpinner(undefined, { mode: 'replace', verbs: ['a'] })).toBe(false);
  });
});

/** 1日1回の入れ替えの、入れ先の代わり */
function hands() {
  const placed = [];
  const results = {};
  const dropped = [];
  return {
    placed, results, dropped,
    place: (op, args) => { const id = 'kitup-' + placed.length + '-test'; placed.push({ id, op, args }); return id; },
    collect: (id) => (Object.prototype.hasOwnProperty.call(results, id) ? results[id] : null),
    drop: (id) => { dropped.push(id); },
  };
}

describe('1日1回の入れ替え (tickSpinner)', () => {
  it('オンにしていない人の settings.json は書かない (命令も置かない)', () => {
    const d = dirs();
    const h = hands();
    writeConfig(d.home, { queueDir: d.queue });
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW }).state).toBe('off');
    expect(h.placed).toEqual([]);
    expect(fs.existsSync(settingsPath(d))).toBe(false);
    // 切ったあとも同じ
    turnedOn(d);
    sp.turnOff({ home: d.home, claude: d.claude });
    const after = fs.readFileSync(settingsPath(d), 'utf8');
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + 2 * DAY }).state).toBe('off');
    expect(h.placed).toEqual([]);
    expect(fs.readFileSync(settingsPath(d), 'utf8')).toBe(after);
  });

  it('1日たったら待たずに命令を置き、次に呼ばれたときに届いた返事で書き直す (キャラを変えると1日のうちに変わる)', () => {
    const d = dirs();
    fs.writeFileSync(settingsPath(d), JSON.stringify({ model: 'opus' }, null, 2) + '\n');
    turnedOn(d);
    const h = hands();
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + 1000 }).state).toBe('fresh');
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY }).state).toBe('placed');
    expect(h.placed).toEqual([{ id: 'kitup-0-test', op: 'oshiSpinner', args: {} }]);
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY + 1000 }).state).toBe('waiting');
    h.results['kitup-0-test'] = ok(['テストを祈っているのだ', '<b>捨てる</b>'], { name: 'イツキ', char: 'builtin:itsuki' });
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY + 2000 }).state).toBe('updated');
    expect(readSettings(d)).toEqual({ model: 'opus', spinnerVerbs: { mode: 'replace', verbs: ['テストを祈っているのだ'] } });
    expect(sp.spinnerState(d.home)).toMatchObject({ name: 'イツキ', char: 'builtin:itsuki', pending: null, had: false });
    // 入れ替えたあとも、off で前の形 (鍵なし) に戻る
    expect(sp.turnOff({ home: d.home, claude: d.claude }).state).toBe('removed');
    expect(readSettings(d)).toEqual({ model: 'opus' });
  });

  it('手で直されていたら書かず、命令も置かない。届くまでに直されたときも書かない', () => {
    const d = dirs();
    turnedOn(d);
    const h = hands();
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY }).state).toBe('placed');
    const edited = { spinnerVerbs: { mode: 'append', verbs: ['手で直した'] } };
    fs.writeFileSync(settingsPath(d), JSON.stringify(edited));
    h.results['kitup-0-test'] = ok(['テストの新しい字']);
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY + 1000 }).state).toBe('edited');
    expect(readSettings(d)).toEqual(edited);
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + 3 * DAY }).state).toBe('edited');
    expect(h.placed).toHaveLength(1);
  });

  it('頼んでから届くまでにオフにしたら書かない。24時間返らない命令は捨てる', () => {
    const d = dirs();
    turnedOn(d);
    const h = hands();
    sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY });
    // 返事が来ないまま1日たつ → 捨てて置き直す
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + 2 * DAY + 1 }).state).toBe('placed');
    expect(h.dropped).toEqual(['kitup-0-test']);
    // 届く前にオフ (置いた命令は off が捨てる)
    sp.turnOff({ home: d.home, claude: d.claude, drop: h.drop });
    expect(h.dropped).toEqual(['kitup-0-test', 'kitup-1-test']);
    h.results['kitup-1-test'] = ok(['テストの新しい字']);
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + 2 * DAY + 2 }).state).toBe('off');
    expect(fs.readFileSync(settingsPath(d), 'utf8')).toBe('{}\n');
  });

  it('推しをオフにした返事・空の返事では書かない', () => {
    const d = dirs();
    turnedOn(d);
    const h = hands();
    sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY });
    h.results['kitup-0-test'] = { ok: true, result: { on: false, lines: [], reason: '推しがオフです' } };
    expect(sp.tickSpinner({ home: d.home, claude: d.claude, ...h, now: NOW + DAY + 1 }).state).toBe('skipped');
    expect(readSettings(d)).toEqual({ spinnerVerbs: { mode: 'replace', verbs: VERBS } });
  });
});

/**
 * 道具を走らせる。置かれた命令 (oshiSpinner) には reply を返す。env は BANTO_HOME / CLAUDE_CONFIG_DIR。
 *
 * @returns {Promise<{cmds: object[], out: string, err: string, code: number}>}
 */
async function run(d, args, reply) {
  const child = spawn(process.execPath, [AGENT, ...args, '--queue', d.queue],
    { env: { ...process.env, BANTO_HOME: d.home, CLAUDE_CONFIG_DIR: d.claude, AGENTKIT_QUEUE: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (x) => { out += x; });
  child.stderr.on('data', (x) => { err += x; });
  let code = null;
  const done = new Promise((r) => child.on('exit', (c) => { code = c; r(); }));
  const cmds = [];
  const seen = new Set();
  while (code === null) {
    await new Promise((r) => setTimeout(r, 30));
    for (const name of fs.readdirSync(d.queue).filter((n) => n.endsWith('.cmd.json') && !seen.has(n))) {
      seen.add(name);
      const cmd = JSON.parse(fs.readFileSync(path.join(d.queue, name), 'utf8'));
      cmds.push({ name, ...cmd });
      if (name.startsWith('kit-')) {
        fs.writeFileSync(path.join(d.queue, name.replace('.cmd.json', '.result.json')),
          JSON.stringify(reply(cmd)));
      }
    }
  }
  await done;
  return { cmds, out, err, code };
}

describe('node agent.mjs oshi-spinner', () => {
  it('on は中身と変え方を見せ、尋ねられなければ書かずに止める。--yes で spinnerVerbs だけを書く', async () => {
    const d = dirs();
    fs.writeFileSync(settingsPath(d), JSON.stringify({ model: 'opus' }, null, 2) + '\n');
    const asked = await run(d, ['oshi-spinner', 'on'], () => ok(VERBS));
    expect(asked.cmds.map((c) => c.op)).toEqual(['oshiSpinner']);
    expect(asked.code).toBe(2);
    expect(asked.err).toContain('テストを考え中');
    expect(asked.err).toContain('いま: (無し)');
    expect(asked.err).toContain('これから: ' + JSON.stringify({ mode: 'replace', verbs: VERBS }));
    expect(asked.err).toContain('--yes を付けて実行してください');
    expect(readSettings(d)).toEqual({ model: 'opus' });

    const yes = await run(d, ['oshi-spinner', 'on', '--yes'], () => ok(VERBS));
    expect(yes.code).toBe(0);
    expect(readSettings(d)).toEqual({ model: 'opus', spinnerVerbs: { mode: 'replace', verbs: VERBS } });
    expect(readConfig(d.home).spinner).toMatchObject({ on: true, queueDir: d.queue, had: false });

    const status = await run(d, ['oshi-spinner', 'status'], () => ok(VERBS));
    expect(status.cmds).toEqual([]);
    expect(status.out).toContain('オンです (タクのせりふ 2個)');

    const off = await run(d, ['oshi-spinner', 'off'], () => ok(VERBS));
    expect(off.cmds).toEqual([]);
    expect(off.out).toContain('spinnerVerbs を外しました');
    expect(readSettings(d)).toEqual({ model: 'opus' });
  }, 30000);

  it('推しがオフなら理由を出して何も書かない。知らない言い方は使い方の誤り', async () => {
    const d = dirs();
    const r = await run(d, ['oshi-spinner', 'on', '--yes'], () => ({ ok: true, result: { on: false, lines: [], reason: '推しがオフです。テスト' } }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('推しがオフです。テスト');
    expect(fs.existsSync(settingsPath(d))).toBe(false);
    const bad = await run(d, ['oshi-spinner', 'maybe'], () => ok(VERBS));
    expect(bad.code).toBe(2);
    expect(bad.cmds).toEqual([]);
  }, 30000);

  it('オンの人がほかの命令を使うと、1日1回だけ待たずに oshiSpinner を置く (オフの人には置かない)', async () => {
    const d = dirs();
    const files = () => ({ ok: true, result: [] });
    const off = await run(d, ['files'], files);
    expect(off.cmds.map((c) => c.op)).toEqual(['listFiles']);

    turnedOn(d);
    writeConfig(d.home, { spinner: { ...sp.spinnerState(d.home), lastCheck: new Date(Date.now() - 2 * DAY).toISOString() } });
    const on = await run(d, ['files'], files);
    expect(on.code).toBe(0);
    expect(on.cmds.map((c) => c.op)).toEqual(['listFiles', 'oshiSpinner']);
    expect(on.cmds[1].name).toMatch(/^kitup-/);
    expect(sp.spinnerState(d.home).pending.id).toBe(on.cmds[1].name.replace('.cmd.json', ''));
  }, 30000);
});
