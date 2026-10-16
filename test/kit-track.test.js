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
    expect(first).toContain('agent update rollback');
    const second = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1' })).hookSpecificOutput.additionalContext;
    expect(second).not.toContain('agent update rollback');
  });

  it('自動で入れない設定なら「新しい版がある」とだけ伝える', () => {
    const p = project();
    const h = home([p]);
    fs.writeFileSync(path.join(h, 'update-log.json'), JSON.stringify({ available: '1.9.0' }));
    const text = JSON.parse(onPrompt(h, { cwd: p, session_id: 's1' })).hookSpecificOutput.additionalContext;
    expect(text).toContain('1.9.0');
    expect(text).toContain('agent update');
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
    expect(out.reason).toContain('agent track touch s1');
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
    };
    const send = async (op) => ({ ok: true, result: { version: '1.8.0', print: kitPrintOf(files), files } });

    await trackInstall({ home: h, claude: c, config: { queueDir: q, webAppUrl: 'https://x/exec' }, send });

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

  it('~/.banto/kit から動かすと、命令のあとで版を確かめ、結果は変えない', async () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-'));
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    fs.mkdirSync(path.join(h, 'kit', 'track'), { recursive: true });
    fs.copyFileSync('kit/agent.mjs', path.join(h, 'kit', 'agent.mjs'));
    for (const n of fs.readdirSync('kit/track')) fs.copyFileSync(path.join('kit/track', n), path.join(h, 'kit', 'track', n));
    writeConfig(h, { queueDir: q, lastUpdateCheck: '2000-01-01T00:00:00.000Z', kitPrint: 'abcd1234' });

    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(h, 'kit', 'agent.mjs'), 'files'],
      { cwd: project(), env: { ...process.env, ...ISO(), HOME: h, BANTO_HOME: h, AGENTKIT_QUEUE: '' } });
    let stdout = '';
    child.stdout.on('data', (b) => { stdout += b; });
    const ops = [];
    let exited = false;
    const done = new Promise((r) => child.on('exit', () => { exited = true; r(); }));
    for (let i = 0; i < 400 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 50));
      for (const name of fs.readdirSync(q).filter((n) => n.endsWith('.cmd.json'))) {
        const cmd = JSON.parse(fs.readFileSync(path.join(q, name), 'utf8'));
        ops.push(cmd.op);
        const result = cmd.op === 'kitVersion'
          ? { ok: true, result: { version: '1.8.0', print: 'abcd1234' } }
          : { ok: true, result: ['文書'] };
        fs.writeFileSync(path.join(q, name.replace('.cmd.json', '.result.json')), JSON.stringify(result));
        fs.unlinkSync(path.join(q, name));
      }
    }
    await done;
    expect(ops).toEqual(['listFiles', 'kitVersion']);
    expect(JSON.parse(stdout)).toEqual({ ok: true, result: ['文書'] });
    expect(readConfig(h).lastUpdateCheck).not.toBe('2000-01-01T00:00:00.000Z');
  }, 30000);
});
