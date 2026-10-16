/**
 * 番頭に作業を載せる仕掛けを、Claude Code に入れる・外す。
 *
 * 入れるもの:
 *   ~/.claude/settings.json の hooks に2つ (UserPromptSubmit / Stop)。既存は残す
 *   ~/.claude/skills/banto-track/SKILL.md
 *   ~/.banto/ (道具の本体・設定・載せるフォルダ・会話ごとの覚え書き)
 *
 * **settings.json を書くのは、人が ok した install / uninstall のときだけ。**
 * 書く前に settings.json.banto-backup-<日時> に控える。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { trackedFolders, writeSession } from './hook.mjs';
import { installFromServer, readConfig, writeConfig, stamp } from './update.mjs';

/** Claude Code の設定の置き場。テストでは CLAUDE_CONFIG_DIR で差し替える */
export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function hookCommand(home, kind) {
  return 'node "' + path.join(home, 'hooks', 'track-hook.mjs') + '" ' + kind;
}

const EVENTS = [['UserPromptSubmit', 'prompt'], ['Stop', 'stop']];

function readSettings(file) {
  if (!fs.existsSync(file)) return { settings: {}, text: null };
  const text = fs.readFileSync(file, 'utf8');
  try {
    const settings = text.trim() ? JSON.parse(text) : {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('not object');
    return { settings, text };
  } catch (e) {
    throw new Error(file + ' を読めません (JSON として壊れています)。直してからもう一度実行してください。何も変えていません');
  }
}

function brokenHooks(file) {
  return new Error(file + ' の hooks の形が想定と違います (壊れています)。直してからもう一度実行してください。何も変えていません');
}

/** hooks が object で、各イベントが配列であることを確かめる。形が違えば何も触らず断る */
function hooksOf(settings, file) {
  if (settings.hooks === undefined) settings.hooks = {};
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw brokenHooks(file);
  for (const [event] of EVENTS) {
    if (hooks[event] !== undefined && !Array.isArray(hooks[event])) throw brokenHooks(file);
  }
  return hooks;
}

/**
 * settings.json にフックを2つ足す。既にあれば足さない。
 *
 * @returns {{file:string, backup:string, added:number}}
 */
export function installHooks({ home, claude, now = Date.now() }) {
  const file = path.join(claude, 'settings.json');
  const { settings, text } = readSettings(file);
  const hooks = hooksOf(settings, file);
  let added = 0;
  for (const [event, kind] of EVENTS) {
    const cmd = hookCommand(home, kind);
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const has = groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h && h.command === cmd));
    if (!has) {
      groups.push({ hooks: [{ type: 'command', command: cmd, timeout: 5 }] });
      added++;
    }
    hooks[event] = groups;
  }
  if (!added) return { file, backup: '', added };

  let backup = '';
  if (text !== null) {
    backup = file + '.banto-backup-' + stamp(now);
    fs.copyFileSync(file, backup); // 元の許可 (600 など) を保つ。トークンを含みうる
  }
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { file, backup, added };
}

/**
 * 足したフックとスキルだけを外す。~/.banto は残す (載せるフォルダや控えを失わないため)。
 *
 * @returns {{removed:number}}
 */
export function uninstallHooks({ home, claude, now = Date.now() }) {
  const file = path.join(claude, 'settings.json');
  let removed = 0;
  if (fs.existsSync(file)) {
    const { settings, text } = readSettings(file);
    const hooks = hooksOf(settings, file);
    for (const [event, kind] of EVENTS) {
      const cmd = hookCommand(home, kind);
      if (!Array.isArray(hooks[event])) continue;
      const kept = [];
      for (const g of hooks[event]) {
        if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
        const rest = g.hooks.filter((h) => !(h && h.command === cmd));
        removed += g.hooks.length - rest.length;
        if (rest.length) kept.push({ ...g, hooks: rest });
      }
      if (kept.length) hooks[event] = kept;
      else delete hooks[event];
    }
    if (!Object.keys(hooks).length) delete settings.hooks;
    if (removed) {
      fs.copyFileSync(file, file + '.banto-backup-' + stamp(now));
      fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    }
  }
  fs.rmSync(path.join(claude, 'skills', 'banto-track'), { recursive: true, force: true });
  return { removed };
}

function writeTracked(home, folders) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'tracked.json'), JSON.stringify({ folders }, null, 2) + '\n');
}

export function addFolder(home, dir) {
  const abs = path.resolve(dir || process.cwd());
  const list = trackedFolders(home);
  if (!list.includes(abs)) list.push(abs);
  writeTracked(home, list);
  return list;
}

export function removeFolder(home, dir) {
  const abs = path.resolve(dir || process.cwd());
  const list = trackedFolders(home).filter((f) => f !== abs);
  writeTracked(home, list);
  return list;
}

function needSession(session) {
  if (!String(session || '').replace(/[^A-Za-z0-9_-]/g, '')) {
    throw new Error('会話の id を渡してください (依頼のたびの合図に「この会話の id」として出ています)');
  }
}

/** 会話にやることを結び付ける。結び付けたことが印にもなる */
export function setIssue(home, session, number, title, now = new Date()) {
  needSession(session);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new Error('番号は 1 以上の整数で渡してください: ' + number);
  writeSession(home, session, { issue: n, title: String(title || ''), touchedAt: now.toISOString() });
}

/** やることを更新した印を付ける (Stop フックが促さなくなる) */
export function touch(home, session, now = new Date()) {
  needSession(session);
  writeSession(home, session, { touchedAt: now.toISOString() });
}

/** 完了したやることを会話から外す */
export function clearIssue(home, session, now = new Date()) {
  needSession(session);
  writeSession(home, session, { issue: null, title: '', touchedAt: now.toISOString() });
}

/**
 * まとめて入れる: 設定を写し、道具を番頭から受け取り、フックを足す。
 *
 * 道具は手元の展開先を写さずに番頭から受け取る。展開先が利用者のリポジトリの
 * 直下だと、写すときに .claude/ や CLAUDE.md まで巻き込むため。
 */
export async function trackInstall({ home, claude, config, send, now = Date.now(), pinnedKey = '', warn }) {
  if (!config || !config.queueDir || !fs.existsSync(config.queueDir)) {
    throw new Error('命令の入れ先が見つかりません。先に node agent.mjs setup の案内どおりに設定してください');
  }
  const before = readConfig(home) || {};
  writeConfig(home, {
    queueDir: config.queueDir,
    webAppUrl: config.webAppUrl || before.webAppUrl || '',
    scriptUrl: config.scriptUrl || before.scriptUrl || '',
    autoUpdate: before.autoUpdate !== false,
  });
  // 人が頼んだ入れ方。落とした zip の公開鍵 (pinnedKey) があれば、それで署名を確かめる
  const kit = await installFromServer({ home, claude, send, now, link: true, manual: true, pinnedKey,
    ...(warn ? { warn } : {}) });
  writeConfig(home, { lastUpdateCheck: new Date(now).toISOString() });
  const hooks = installHooks({ home, claude, now });
  return { kit, hooks };
}
