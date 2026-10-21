import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { isTracked, onPrompt, onStop, writeSession, readSession, sessionFile } from '../kit/track/hook.mjs';
import {
  installHooks, uninstallHooks, hookCommand, addFolder, removeFolder, setIssue, touch, clearIssue, trackInstall,
} from '../kit/track/track.mjs';
import { kitPrintOf, writeConfig, readConfig } from '../kit/track/update.mjs';
import { trackedFolders } from '../kit/track/hook.mjs';
import { TEST_KEYS, OTHER_KEYS, signKit } from './kitkeys.js';

/** 一時的な ~/.banto と、載せるフォルダを作る */
function home(folders) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
  fs.writeFileSync(path.join(dir, 'tracked.json'), JSON.stringify({ folders: folders || [] }));
  return dir;
}

function project() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
}

describe('フック: 登録したフォルダだけ', () => {
  it('登録したフォルダとその下は載る、外は載らない', () => {
    const p = project();
    fs.mkdirSync(path.join(p, 'sub'));
    const h = home([p]);
    expect(isTracked(h, p)).toBe(true);
    expect(isTracked(h, path.join(p, 'sub'))).toBe(true);
    expect(isTracked(h, p + '-other')).toBe(false);
    expect(isTracked(h, os.tmpdir())).toBe(false);
  });

  it('/tmp と /private/tmp のような別名でも同じフォルダと読む', () => {
    const p = project();
    const h = home([fs.realpathSync(p)]);
    expect(isTracked(h, p)).toBe(true);
  });

  it('絶対パスでない登録は見ない (空や相対だと、いまの場所しだいで何でも載る)', () => {
    const p = project();
    const h = home(['', 'relative', '.', p, 42]);
    expect(trackedFolders(h)).toEqual([p]);
    expect(isTracked(h, process.cwd())).toBe(false);
    expect(isTracked(h, path.join(process.cwd(), 'relative'))).toBe(false);
    expect(isTracked(h, p)).toBe(true);
  });

  it('Windows では大文字小文字を区別せずに比べる', () => {
    // 実在しない道のりなら realpath を通らず、そのままの綴りで比べる
    const root = path.join(path.parse(process.cwd()).root, 'no-such-banto-case', 'Proj');
    const h = home([root]);
    const lower = path.join(path.dirname(root), 'proj', 'sub');
    const was = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(isTracked(h, lower)).toBe(true);
      expect(isTracked(h, path.join(path.dirname(root), 'proj-other'))).toBe(false);
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(isTracked(h, lower)).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', was);
    }
  });

  it('一覧が無い・壊れていても落ちない', () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    expect(isTracked(h, project())).toBe(false);
    fs.writeFileSync(path.join(h, 'tracked.json'), '{こわれ');
    expect(isTracked(h, project())).toBe(false);
  });
});

describe('フック: 依頼のたびの合図', () => {
  it('登録内なら、決まり・会話の id・道具の場所を渡す', () => {
    const p = project();
    const h = home([p]);
    const out = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1', prompt: '直して' }));
    const text = out.hookSpecificOutput.additionalContext;
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(text).toContain('banto-track');
    expect(text).toContain('この会話の id: s1');
    expect(text).toContain(path.join(h, 'kit', 'agent.mjs'));
  });

  it('登録外なら何も出さない', () => {
    expect(onPrompt(home([]), { cwd: project(), session_id: 's1' })).toBe('');
  });

  it('いまのやることがあれば添える', () => {
    const p = project();
    const h = home([p]);
    writeSession(h, 's1', { issue: 12, title: '第3条を直す' });
    const text = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1' })).hookSpecificOutput.additionalContext;
    expect(text).toContain('いまのやること: #12 (第3条を直す)');
  });

  it('依頼を受けた時刻を覚える', () => {
    const p = project();
    const h = home([p]);
    onPrompt(h, { cwd: p, session_id: 's1' }, new Date('2026-10-15T00:00:00Z'));
    expect(readSession(h, 's1').promptAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('入れ替えの記録は1回だけ見せて消す', () => {
    const p = project();
    const h = home([p]);
    fs.writeFileSync(path.join(h, 'update-log.json'),
      JSON.stringify({ version: '1.8.0', changed: ['agent.mjs'] }));
    const first = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1' })).hookSpecificOutput.additionalContext;
    expect(first).toContain('agent.mjs');
    expect(first).toContain('/kit/agent.mjs" update rollback');
    const second = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1' })).hookSpecificOutput.additionalContext;
    expect(second).not.toContain('update rollback');
  });

  it('自動で入れない設定なら「新しい版がある」とだけ伝える', () => {
    const p = project();
    const h = home([p]);
    fs.writeFileSync(path.join(h, 'update-log.json'), JSON.stringify({ available: '1.9.0' }));
    const text = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1' })).hookSpecificOutput.additionalContext;
    expect(text).toContain('1.9.0');
    expect(text).toContain('/kit/agent.mjs" update`');
  });
});

describe('フック: 返事の終わり', () => {
  function ready(touched) {
    const p = project();
    const h = home([p]);
    writeSession(h, 's1', { issue: 7, title: 'x', promptAt: '2026-10-15T01:00:00.000Z',
      touchedAt: touched });
    return { p, h };
  }

  it('印が無ければ1回だけ止める', () => {
    const { p, h } = ready('2026-10-15T00:00:00.000Z');
    const out = JSON.parse(onStop(h, { cwd: p, session_id: 's1', stop_hook_active: false }));
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('#7');
    // 合図の道具と同じ、そのまま動く綴りで促す (agent というコマンドは無い)
    expect(out.reason).toContain('node "' + path.join(h, 'kit', 'agent.mjs') + '" track touch s1');
    expect(out.reason).not.toContain('`agent track');
  });

  it('止めたあとの2回目は止めない', () => {
    const { p, h } = ready('');
    expect(onStop(h, { cwd: p, session_id: 's1', stop_hook_active: true })).toBe('');
  });

  it('この返事のあいだに印があれば止めない', () => {
    const { p, h } = ready('2026-10-15T01:00:05.000Z');
    expect(onStop(h, { cwd: p, session_id: 's1' })).toBe('');
  });

  it('いまのやることが無ければ止めない', () => {
    const p = project();
    const h = home([p]);
    expect(onStop(h, { cwd: p, session_id: 's9' })).toBe('');
  });

  it('登録外なら止めない', () => {
    const { h } = ready('');
    expect(onStop(h, { cwd: project(), session_id: 's1' })).toBe('');
  });
});

describe('フック: 会話の id で外に書かない', () => {
  it('id の記号は落とす', () => {
    const h = home([]);
    expect(sessionFile(h, '../../evil')).toBe(path.join(h, 'sessions', 'evil.json'));
    expect(sessionFile(h, '')).toBe('');
    expect(sessionFile(h, '../')).toBe('');
  });
});

describe('フック: そのまま node で動く', () => {
  const HOOK = path.resolve('kit/track/hook.mjs');

  // 本物の ~/.claude を触らないよう、設定の場所も一時フォルダへ向ける
  function run(kind, input, env) {
    return execFileSync(process.execPath, [HOOK, kind], {
      input, encoding: 'utf8', timeout: 2000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), ...env },
    });
  }

  it('2秒以内に合図を返す', () => {
    const p = project();
    const h = home([p]);
    const out = run('prompt', JSON.stringify({ cwd: p, session_id: 's1' }), { BANTO_HOME: h });
    expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain('s1');
  });

  it('壊れた入力でも終了コード 0 で何も出さない', () => {
    const h = home([]);
    expect(run('prompt', '{こわれ', { BANTO_HOME: h })).toBe('');
    expect(run('stop', '', { BANTO_HOME: h })).toBe('');
    expect(run('unknown', '{}', { BANTO_HOME: h })).toBe('');
  });

  it('~/.banto が無くても落ちない', () => {
    const out = run('prompt', JSON.stringify({ cwd: project(), session_id: 's1' }),
      { BANTO_HOME: path.join(os.tmpdir(), 'no-such-banto-' + Date.now()) });
    expect(out).toBe('');
  });

  it('子プロセスを起こさない', () => {
    // 受け取った中身を実行しない作りを、新しいファイルでも崩さない
    for (const name of fs.readdirSync('kit/track').filter((n) => n.endsWith('.mjs'))) {
      expect(fs.readFileSync(path.join('kit/track', name), 'utf8'), name).not.toContain('child_process');
    }
  });
});

function claudeDir(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-'));
  if (settings !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), settings);
  return dir;
}

describe('仕掛けを入れる・外す', () => {
  const OTHER = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
    permissions: { allow: ['Bash(ls)'] }, model: 'opus' };

  it('控えを取ってから足し、既存のフックと設定を残す', () => {
    const h = home([]);
    const c = claudeDir(JSON.stringify(OTHER));
    const r = installHooks({ home: h, claude: c, now: Date.parse('2026-10-15T00:00:00Z') });
    const s = JSON.parse(fs.readFileSync(path.join(c, 'settings.json'), 'utf8'));
    expect(r.added).toBe(2);
    expect(JSON.parse(fs.readFileSync(r.backup, 'utf8'))).toEqual(OTHER);
    expect(s.permissions).toEqual(OTHER.permissions);
    expect(s.model).toBe('opus');
    expect(s.hooks.Stop[0].hooks[0].command).toBe('say done');
    expect(JSON.stringify(s.hooks.Stop)).toContain(JSON.stringify(hookCommand(h, 'stop')).slice(1, -1));
    expect(JSON.stringify(s.hooks.UserPromptSubmit)).toContain(JSON.stringify(hookCommand(h, 'prompt')).slice(1, -1));
  });

  it('2回入れても二重にならない', () => {
    const h = home([]);
    const c = claudeDir(JSON.stringify(OTHER));
    installHooks({ home: h, claude: c });
    const again = installHooks({ home: h, claude: c });
    const s = JSON.parse(fs.readFileSync(path.join(c, 'settings.json'), 'utf8'));
    expect(again.added).toBe(0);
    expect(s.hooks.Stop).toHaveLength(2);
    expect(s.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('設定が無ければ作る', () => {
    const h = home([]);
    const c = claudeDir();
    const r = installHooks({ home: h, claude: c });
    expect(r.backup).toBe('');
    expect(JSON.parse(fs.readFileSync(path.join(c, 'settings.json'), 'utf8')).hooks.Stop).toHaveLength(1);
  });

  it('設定が壊れていれば何も書かずに断る', () => {
    const h = home([]);
    const c = claudeDir('{こわれ');
    expect(() => installHooks({ home: h, claude: c })).toThrow('壊れています');
    expect(fs.readFileSync(path.join(c, 'settings.json'), 'utf8')).toBe('{こわれ');
  });

  it('hooks の形が違えば、何も書かず控えも取らずに断る', () => {
    const shapes = [
      '{"hooks":"x"}',
      '{"hooks":[1]}',
      '{"hooks":{"Stop":{"matcher":"","hooks":[{"type":"command","command":"keep"}]}}}',
      '{"hooks":{"UserPromptSubmit":"x"}}',
    ];
    for (const text of shapes) {
      for (const fn of [installHooks, uninstallHooks]) {
        const c = claudeDir(text);
        expect(() => fn({ home: home([]), claude: c })).toThrow('壊れています');
        expect(fs.readFileSync(path.join(c, 'settings.json'), 'utf8')).toBe(text);
        expect(fs.readdirSync(c)).toEqual(['settings.json']);
      }
    }
  });

  it.skipIf(process.platform === 'win32')('控えは元の許可を保つ', () => {
    const c = claudeDir(JSON.stringify(OTHER));
    fs.chmodSync(path.join(c, 'settings.json'), 0o600);
    const r = installHooks({ home: home([]), claude: c });
    expect(fs.statSync(r.backup).mode & 0o777).toBe(0o600);
  });

  it('外すと足したものだけが消える', () => {
    const h = home([]);
    const c = claudeDir(JSON.stringify(OTHER));
    installHooks({ home: h, claude: c });
    fs.mkdirSync(path.join(c, 'skills', 'banto-track'), { recursive: true });
    fs.writeFileSync(path.join(c, 'skills', 'banto-track', 'SKILL.md'), 'x');

    uninstallHooks({ home: h, claude: c });

    const s = JSON.parse(fs.readFileSync(path.join(c, 'settings.json'), 'utf8'));
    expect(s.hooks).toEqual(OTHER.hooks);
    expect(s.permissions).toEqual(OTHER.permissions);
    expect(fs.existsSync(path.join(c, 'skills', 'banto-track'))).toBe(false);
    expect(fs.existsSync(h)).toBe(true);
    // 2回目も落ちない
    expect(() => uninstallHooks({ home: h, claude: c })).not.toThrow();
  });
});

describe('載せるフォルダ', () => {
  it('足す・外す・二重にしない', () => {
    const h = home([]);
    const p = project();
    addFolder(h, p);
    addFolder(h, p);
    expect(trackedFolders(h)).toEqual([path.resolve(p)]);
    removeFolder(h, p);
    expect(trackedFolders(h)).toEqual([]);
    expect(() => removeFolder(h, p)).not.toThrow();
  });
});

describe('会話とやることの結び付き', () => {
  it('結び付けると印も付き、外すと止められなくなる', () => {
    const p = project();
    const h = home([p]);
    onPrompt(h, { cwd: p, session_id: 's1' }, new Date('2026-10-15T01:00:00Z'));
    setIssue(h, 's1', 5, '第3条', new Date('2026-10-15T01:00:01Z'));
    expect(onStop(h, { cwd: p, session_id: 's1' })).toBe('');

    onPrompt(h, { cwd: p, session_id: 's1' }, new Date('2026-10-15T02:00:00Z'));
    expect(JSON.parse(onStop(h, { cwd: p, session_id: 's1' })).decision).toBe('block');
    touch(h, 's1', new Date('2026-10-15T02:00:01Z'));
    expect(onStop(h, { cwd: p, session_id: 's1' })).toBe('');

    onPrompt(h, { cwd: p, session_id: 's1' }, new Date('2026-10-15T03:00:00Z'));
    clearIssue(h, 's1');
    expect(onStop(h, { cwd: p, session_id: 's1' })).toBe('');
  });

  it('番号と会話の id が無ければ断る', () => {
    const h = home([]);
    expect(() => setIssue(h, '', 5, 'x')).toThrow('会話の id');
    expect(() => setIssue(h, 's1', 'abc', 'x')).toThrow('番号');
  });
});

describe('まとめて入れる', () => {
  it('道具を受け取り、スキル・フック・設定を置く', async () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const c = claudeDir();
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    const files = {
      'agent.mjs': Buffer.from('a').toString('base64'),
      'track/SKILL.md': Buffer.from('s').toString('base64'),
      'track/hook.mjs': Buffer.from('h').toString('base64'),
      'track/update.mjs': Buffer.from('u').toString('base64'),
      'track/track.mjs': Buffer.from('t').toString('base64'),
      'track/local.mjs': Buffer.from('l').toString('base64'),
      'track/spinner.mjs': Buffer.from('p').toString('base64'),
    };
    const send = async (op) => ({ ok: true, result: { version: '1.8.0', print: kitPrintOf(files), files } });

    await trackInstall({ home: h, claude: c, config: { queueDir: q, webAppUrl: 'https://x/exec' }, send, warn: () => {} });

    expect(readConfig(h)).toMatchObject({ queueDir: q, webAppUrl: 'https://x/exec', kitPrint: kitPrintOf(files) });
    expect(fs.existsSync(path.join(c, 'skills', 'banto-track', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(h, 'hooks', 'track-hook.mjs'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(c, 'settings.json'), 'utf8')).hooks.Stop).toHaveLength(1);
  });

  it('命令の入れ先が無ければ何もせずに断る', async () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const c = claudeDir();
    await expect(trackInstall({ home: h, claude: c, config: { queueDir: '/no/such' }, send: async () => ({}) }))
      .rejects.toThrow('命令の入れ先');
    expect(fs.existsSync(path.join(c, 'settings.json'))).toBe(false);
  });
});

describe('agent.mjs から使う', () => {
  /** 本物の HOME / ~/.claude / ~/.banto を触らせない */
  const ISO = () => ({
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'home-')),
    BANTO_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'banto-iso-')),
    CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-iso-')),
  });
  const AGENT = path.resolve('kit/agent.mjs');

  function agent(args, env, opts) {
    return execFileSync(process.execPath, [AGENT, ...args], {
      encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...ISO(), ...env }, ...(opts || {}),
    });
  }

  it('track add / list はフォルダを載せる', () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const p = project();
    agent(['track', 'add', p], { BANTO_HOME: h });
    expect(agent(['track', 'list'], { BANTO_HOME: h })).toContain(path.resolve(p));
  });

  it('track set は、引用符の無い題名も続けて受ける', () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    agent(['track', 'set', 's1', '5', '第3条', 'を', '直す'], { BANTO_HOME: h });
    expect(readSession(h, 's1')).toMatchObject({ issue: 5, title: '第3条 を 直す' });
  });

  it('端末でなく --yes も無ければ、入れずに断る', () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const c = claudeDir();
    let err = '';
    let code = 0;
    try {
      agent(['track', 'install'], { BANTO_HOME: h, CLAUDE_CONFIG_DIR: c }, { input: '' });
    } catch (e) {
      err = String(e.stderr || '');
      code = e.status;
    }
    expect(code).toBe(2);
    expect(err).toContain('--yes');
    expect(fs.existsSync(path.join(c, 'settings.json'))).toBe(false);
  });

  it('--yes を付けても、入れるものと自動更新の危険・切り方を必ず出す', () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    let err = '';
    try {
      // 入れ先の設定が無いので入れる手前で止まる。出したものだけを見る
      agent(['track', 'install', '--yes'], { BANTO_HOME: h, CLAUDE_CONFIG_DIR: claudeDir(), AGENTKIT_QUEUE: '' },
        { cwd: project() });
    } catch (e) {
      err = String(e.stderr || '');
    }
    expect(err).toContain('settings.json');
    expect(err).toContain('track-hook.mjs');
    expect(err).toContain('自動で動かします');
    expect(err).toContain('偽の返事');
    expect(err).toContain('"autoUpdate": false');
    expect(err).toContain(path.join(h, 'config.json'));
  });

  it('setup が入れ方を案内し、次にすることは1つのまま', () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const out = agent(['setup'], { BANTO_HOME: h, CLAUDE_CONFIG_DIR: claudeDir(), AGENTKIT_QUEUE: '' },
      { cwd: project() });
    expect(out).toContain('node agent.mjs track install');
    expect((out.match(/次にすること/g) || [])).toHaveLength(1);
  });

  it('~/.banto/config.json があれば、そこから入れ先を読む', async () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    writeConfig(h, { queueDir: q });
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [AGENT, 'files'],
      // HOME も向ける。手元に本物の ~/.agentkit.json があると先にそちらを拾う
      { cwd: project(), env: { ...process.env, ...ISO(), HOME: h, BANTO_HOME: h, AGENTKIT_QUEUE: '' } });
    let cmd = null;
    for (let i = 0; i < 100 && !cmd; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const name = fs.readdirSync(q).find((n) => n.endsWith('.cmd.json'));
      if (name) {
        cmd = JSON.parse(fs.readFileSync(path.join(q, name), 'utf8'));
        fs.writeFileSync(path.join(q, name.replace('.cmd.json', '.result.json')), JSON.stringify({ ok: true }));
      }
    }
    await new Promise((r) => child.on('exit', r));
    expect(cmd.op).toBe('listFiles');
  }, 20000);

  it('リポジトリの写しから動かしても、1日1回の確認はしない', async () => {
    // ~/.banto/kit 以外から確かめても入れ替える先が違う。本物の入れ先に命令を置く事故にもなる
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    writeConfig(h, { queueDir: q, lastUpdateCheck: '2000-01-01T00:00:00.000Z' });
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [AGENT, 'files', '--queue', q],
      { env: { ...process.env, ...ISO(), BANTO_HOME: h } });
    const ops = [];
    let exited = false;
    const done = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
    for (let i = 0; i < 60 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const name of fs.readdirSync(q).filter((n) => n.endsWith('.cmd.json'))) {
        ops.push(JSON.parse(fs.readFileSync(path.join(q, name), 'utf8')).op);
        fs.writeFileSync(path.join(q, name.replace('.cmd.json', '.result.json')), JSON.stringify({ ok: true }));
        fs.unlinkSync(path.join(q, name));
      }
    }
    await done;
    expect(ops).toEqual(['listFiles']);
    expect(readConfig(h).lastUpdateCheck).toBe('2000-01-01T00:00:00.000Z');
  }, 20000);

  /** ~/.banto/kit に今の道具を置き、そこから agent.mjs を1回動かす。listFiles にだけ答える */
  function bantoKit() {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    fs.mkdirSync(path.join(h, 'kit', 'track'), { recursive: true });
    fs.copyFileSync('kit/agent.mjs', path.join(h, 'kit', 'agent.mjs'));
    for (const n of fs.readdirSync('kit/track')) fs.copyFileSync(path.join('kit/track', n), path.join(h, 'kit', 'track', n));
    // 本物の公開鍵ではなくテストの鍵を固定する (署名もテストの鍵で付ける)
    fs.writeFileSync(path.join(h, 'kit', 'track', 'kit-key.pem'), TEST_KEYS.pub);
    return { h, q };
  }

  async function runFromBanto(h, q) {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(h, 'kit', 'agent.mjs'), 'files'],
      { cwd: project(), env: { ...process.env, ...ISO(), HOME: h, BANTO_HOME: h, AGENTKIT_QUEUE: '' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    let exited = false;
    const done = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
    const ops = [];
    let answeredAt = 0;
    for (let i = 0; i < 300 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const name of fs.readdirSync(q).filter((n) => n.endsWith('.cmd.json'))) {
        const cmd = JSON.parse(fs.readFileSync(path.join(q, name), 'utf8'));
        if (cmd.op !== 'listFiles') continue;
        ops.push(cmd.op);
        fs.writeFileSync(path.join(q, name.replace('.cmd.json', '.result.json')),
          JSON.stringify({ ok: true, result: ['文書'] }));
        fs.unlinkSync(path.join(q, name));
        answeredAt = Date.now();
      }
    }
    const finished = exited;
    if (!exited) child.kill();
    await done;
    return { stdout, stderr, ops, exited: finished, waited: Date.now() - answeredAt };
  }

  it('~/.banto/kit から動かすと、命令のあとで版を尋ねる命令を置くだけで、返事を待たない', async () => {
    const { h, q } = bantoKit();
    writeConfig(h, { queueDir: q, lastUpdateCheck: '2000-01-01T00:00:00.000Z', kitPrint: 'abcd1234' });

    const r = await runFromBanto(h, q);

    // Claude Code の Bash は2分で打ち切る。版の返事を待つと本来の命令まで失敗に見える
    expect(r.exited).toBe(true);
    expect(r.waited).toBeLessThan(5000);
    expect(r.ops).toEqual(['listFiles']);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, result: ['文書'] });
    const c = readConfig(h);
    expect(c.lastUpdateCheck).not.toBe('2000-01-01T00:00:00.000Z');
    expect(c.pendingUpdate.op).toBe('kitVersion');
    const cmd = JSON.parse(fs.readFileSync(path.join(q, c.pendingUpdate.id + '.cmd.json'), 'utf8'));
    expect(cmd).toEqual({ op: 'kitVersion', args: { mine: 'abcd1234' } });
  }, 30000);

  it('次に呼ばれたとき、届いていた返事を拾って続きを進め、その次に入れ替える', async () => {
    const { h, q } = bantoKit();
    const b64 = (f) => fs.readFileSync(f).toString('base64');
    const files = { 'agent.mjs': b64('kit/agent.mjs'), 'marker.md': Buffer.from('new').toString('base64') };
    for (const n of fs.readdirSync('kit/track')) files['track/' + n] = b64(path.join('kit/track', n));
    files['track/kit-key.pem'] = Buffer.from(TEST_KEYS.pub).toString('base64');
    const print = kitPrintOf(files);
    const at = new Date().toISOString();
    writeConfig(h, { queueDir: q, lastUpdateCheck: at, kitPrint: 'abcd1234',
      pendingUpdate: { op: 'kitVersion', id: 'kit-1-aaaaaa', at } });
    fs.writeFileSync(path.join(q, 'kit-1-aaaaaa.cmd.json'), '{}');
    fs.writeFileSync(path.join(q, 'kit-1-aaaaaa.result.json'),
      JSON.stringify({ ok: true, result: { version: '9.9.9', print } }));

    const second = await runFromBanto(h, q);
    expect(second.waited).toBeLessThan(5000);
    const pending = readConfig(h).pendingUpdate;
    expect(pending.op).toBe('kitFiles');
    expect(fs.existsSync(path.join(q, 'kit-1-aaaaaa.result.json'))).toBe(false);
    expect(fs.existsSync(path.join(q, 'kit-1-aaaaaa.cmd.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(q, pending.id + '.cmd.json'), 'utf8')).op).toBe('kitFiles');

    fs.writeFileSync(path.join(q, pending.id + '.result.json'),
      JSON.stringify({ ok: true, result: { version: '9.9.9', print, files, signature: signKit('9.9.9', files, TEST_KEYS.priv) } }));
    const third = await runFromBanto(h, q);
    expect(third.waited).toBeLessThan(5000);
    expect(JSON.parse(third.stdout)).toEqual({ ok: true, result: ['文書'] });
    expect(third.stderr).toContain('新しくしました (9.9.9)');
    expect(fs.readFileSync(path.join(h, 'kit', 'marker.md'), 'utf8')).toBe('new');
    expect(readConfig(h)).toMatchObject({ kitPrint: print, pendingUpdate: null });
    expect(fs.readdirSync(q)).toEqual([]);
  }, 30000);

  it('届いた中身の署名が合わなければ、~/.banto/kit から動かしても入れ替えない', async () => {
    const { h, q } = bantoKit();
    const files = { 'agent.mjs': Buffer.from('evil').toString('base64') };
    for (const n of ['hook.mjs', 'update.mjs', 'track.mjs', 'local.mjs', 'spinner.mjs']) files['track/' + n] = Buffer.from('evil').toString('base64');
    const at = new Date().toISOString();
    writeConfig(h, { queueDir: q, lastUpdateCheck: at, kitPrint: 'abcd1234',
      pendingUpdate: { op: 'kitFiles', id: 'kitup-1-aaaaaa', at } });
    fs.writeFileSync(path.join(q, 'kitup-1-aaaaaa.result.json'), JSON.stringify({ ok: true,
      result: { version: '6.6.6', print: kitPrintOf(files), files, signature: signKit('6.6.6', files, OTHER_KEYS.priv) } }));
    const before = fs.readFileSync(path.join(h, 'kit', 'agent.mjs'), 'utf8');

    const r = await runFromBanto(h, q);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, result: ['文書'] });
    expect(r.stderr).toContain('署名が合いません');
    expect(fs.readFileSync(path.join(h, 'kit', 'agent.mjs'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(h, 'backup'))).toBe(false);
  }, 30000);

  it('track install は、落とした zip の公開鍵で、番頭から受け取る中身の署名を確かめる', async () => {
    // 落とした zip の代わり。agent.mjs と track/ をテストの鍵と一緒に置く
    const zip = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
    fs.mkdirSync(path.join(zip, 'track'));
    fs.copyFileSync('kit/agent.mjs', path.join(zip, 'agent.mjs'));
    for (const n of fs.readdirSync('kit/track')) fs.copyFileSync(path.join('kit/track', n), path.join(zip, 'track', n));
    fs.writeFileSync(path.join(zip, 'track', 'kit-key.pem'), TEST_KEYS.pub);
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const c = claudeDir();
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    const files = { 'agent.mjs': Buffer.from('evil').toString('base64'),
      'track/hook.mjs': Buffer.from('evil').toString('base64'), 'track/update.mjs': Buffer.from('evil').toString('base64'),
      'track/track.mjs': Buffer.from('evil').toString('base64'), 'track/local.mjs': Buffer.from('evil').toString('base64'),
      'track/spinner.mjs': Buffer.from('evil').toString('base64') };
    const forged = { ok: true, result: { version: '6.6.6', print: kitPrintOf(files), files,
      signature: signKit('6.6.6', files, OTHER_KEYS.priv) } };

    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(zip, 'agent.mjs'), 'track', 'install', '--yes', '--queue', q],
      { env: { ...process.env, ...ISO(), BANTO_HOME: h, CLAUDE_CONFIG_DIR: c, AGENTKIT_QUEUE: '' } });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b; });
    let exited = false;
    const done = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
    for (let i = 0; i < 200 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const name of fs.readdirSync(q).filter((n) => n.endsWith('.cmd.json'))) {
        fs.writeFileSync(path.join(q, name.replace('.cmd.json', '.result.json')), JSON.stringify(forged));
        fs.unlinkSync(path.join(q, name));
      }
    }
    if (!exited) child.kill();
    await done;
    expect(stderr).toContain('署名が合いません');
    expect(fs.existsSync(path.join(h, 'kit'))).toBe(false);
    expect(fs.existsSync(path.join(c, 'skills', 'banto-track'))).toBe(false);
  }, 30000);
});

describe('スキルと説明', () => {
  const skill = () => fs.readFileSync('kit/track/SKILL.md', 'utf8');

  it('スキルは名前と、いつ使うかを持つ', () => {
    expect(skill()).toMatch(/^---\nname: banto-track\ndescription: .+\n---\n/);
  });

  it('載せる依頼と載せない依頼を分けてある', () => {
    expect(skill()).toContain('作る・直す・消す');
    expect(skill()).toContain('質問・説明・調べもの');
  });

  it('起票・結び付け・印・完了・外すの手順がある', () => {
    const t = skill();
    for (const s of ['agent.mjs" issue ', 'track set ', '"In Progress"', '"In Review"', 'issue-say ',
      'issue-close ', 'track touch ', 'track clear ']) {
      expect(t, s).toContain(s);
    }
  });

  it('待たずに進め、届かなくても作業を止めない', () => {
    expect(skill()).toContain('バックグラウンド');
    expect(skill()).toContain('番頭に載せられませんでした');
  });

  it('AGENTS.md から辿れるスキルに、入れ方・更新・危険と切り方がある', () => {
    // 毎回は要らないので AGENTS.md (= CLAUDE.md) からスキルに分けた。AGENTS.md には辿る先と、--yes の前に読むことを残す
    const agents = fs.readFileSync('kit/AGENTS.md', 'utf8');
    expect(agents).toContain('`banto-track-setup`');
    expect(agents).toContain('`--yes` を付ける前に必ず読む');
    // 確かめてから入れる、の決まりそのものは毎回読む AGENTS.md に残す
    expect(agents).toContain('入れる前に利用者に確かめ、ok をもらってから `--yes` を付ける');
    expect(agents).not.toContain('agent.mjs agent ');
    const t = fs.readFileSync('kit/.claude/skills/banto-track-setup/SKILL.md', 'utf8');
    expect(t).toContain('# 番頭に作業を載せる');
    expect(t).toContain('track install');
    expect(t).toContain('node agent.mjs update rollback');
    expect(t).not.toContain('agent.mjs agent ');
    expect(skill()).not.toContain('agent.mjs agent ');
    expect(t).toContain('"autoUpdate": false');
    expect(agents).toContain('Drive を共有している人なら誰でも');
  });

  it('自動更新は「書き換えるだけ」ではないと書いてある (フックが次の依頼で自動で動く)', () => {
    expect(fs.readFileSync('kit/AGENTS.md', 'utf8')).not.toContain('書き換えるだけで');
    for (const file of ['kit/.claude/skills/banto-track-setup/SKILL.md', 'docs/dev/kit.md']) {
      const t = fs.readFileSync(file, 'utf8');
      expect(t, file).not.toContain('書き換えるだけで');
      expect(t, file).toContain('track-hook.mjs');
      expect(t, file).toContain('自動で動かします');
      expect(t, file).toContain('"autoUpdate": false');
    }
    // --yes を付ける前に、利用者へ危険と切り方を伝える
    const agents = fs.readFileSync('kit/.claude/skills/banto-track-setup/SKILL.md', 'utf8');
    const at = agents.indexOf('`--yes` を付ける前に');
    expect(at).toBeGreaterThan(-1);
    expect(agents.slice(at, at + 300)).toContain('"autoUpdate": false');
  });

  it('署名が合うものしか自動で入れないこと、残る信頼の先、手で頼む update は待つことを書いてある', () => {
    for (const file of ['kit/AGENTS.md', 'docs/dev/kit.md', 'docs/superpowers/specs/2026-10-15-kit-track-design.md']) {
      const t = fs.readFileSync(file, 'utf8');
      expect(t, file).toContain('署名');
      expect(t, file).toContain('持ち主');
      expect(t, file).not.toContain('偽物は防げません');
      expect(t, file).not.toContain('偽物は防げない。本当の止め方');
      expect(t, file).not.toContain('この変更では入れていない');
    }
    const agents = fs.readFileSync('kit/.claude/skills/banto-track-setup/SKILL.md', 'utf8');
    // 詳しい説明はスキルに分けた。そちらも同じ言い方をしない
    expect(agents).toContain('署名が合うものだけ');
    expect(agents).toContain('秘密鍵を持つ人');
    expect(agents).not.toContain('偽物は防げません');
    expect(agents).not.toContain('この変更では入れていない');
    expect(agents).toContain('バックグラウンド');
    // 開発の決まりのうち道具の節は CLAUDE.md から docs/dev/kit.md に分けた
    const claude = fs.readFileSync('docs/dev/kit.md', 'utf8');
    expect(claude).toContain('src/KitSigning.gs');
    expect(claude).toContain('node scripts/kit-key.mjs');
    // 秘密鍵は番頭に置かない。信頼の起点は鍵を持つ人 (docs/dev/kit.md)。README もそう書く
    expect(claude).toContain('信頼の起点は「秘密鍵を持つ人');
    const readme = fs.readFileSync('README.md', 'utf8');
    expect(readme).toContain('deploy する人の手元にだけある');
    expect(readme).toContain('--rotate');
    expect(readme).not.toContain('共有するのは `agentic-management/` フォルダだけ');
    // 古い版に戻さないこと、鍵の無い道具は zip を落とし直すこと
    expect(agents).toContain('古い版には戻しません');
    expect(agents).toContain('zip を落とし直し');
  });

  it('入れる前の説明も、署名で偽物を断ることと残る信頼の先を出す', () => {
    const src = fs.readFileSync('kit/agent.mjs', 'utf8');
    expect(src).not.toContain('偽物は防げません');
    expect(src).toContain('署名');
  });
});
