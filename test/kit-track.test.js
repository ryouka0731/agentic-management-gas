import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { isTracked, onPrompt, onStop, writeSession, readSession, sessionFile } from '../kit/track/hook.mjs';

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
