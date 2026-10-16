#!/usr/bin/env node
/**
 * Claude Code のフック。登録したフォルダでの作業を、番頭 (SoftBanto) の
 * やることに載せるよう Claude に合図する。
 *
 *   node track-hook.mjs prompt   … UserPromptSubmit。決まりと、いまのやることを渡す
 *   node track-hook.mjs stop     … Stop。やることを更新せずに終えようとしたら1回だけ止める
 *
 * **番頭には問い合わせない。** 命令の返事は最大1分かかり、フックで待つと
 * 依頼のたびに Claude Code が止まる。ファイルを読んで字を返すだけにする。
 *
 * **何が起きても作業を止めない。** 例外は握り、終了コードは 0 のまま。
 *
 * このファイルは ~/.banto/hooks/track-hook.mjs に写して使う。ほかのファイルを
 * import しない (道具の入れ替えの途中でも動くように)。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** 道具の置き場。テストでは BANTO_HOME で差し替える */
export function bantoHome() {
  return process.env.BANTO_HOME || path.join(os.homedir(), '.banto');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

/** 実体の道のり。/tmp と /private/tmp のような別名をそろえる */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    return path.resolve(p);
  }
}

/** @returns {string[]} 載せるフォルダ */
export function trackedFolders(home) {
  const t = readJson(path.join(home, 'tracked.json'), {});
  return t && Array.isArray(t.folders) ? t.folders.map(String) : [];
}

/** そのフォルダ (またはその下) を載せるか */
export function isTracked(home, cwd) {
  if (!cwd) return false;
  const here = real(String(cwd));
  return trackedFolders(home).some((f) => {
    const root = real(f);
    return here === root || here.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
}

/**
 * 会話ごとの覚え書きの道のり。id の記号は落とす (`../` で外に書かせない)。
 *
 * @returns {string} id が空になれば ''
 */
export function sessionFile(home, id) {
  const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return safe ? path.join(home, 'sessions', safe + '.json') : '';
}

export function readSession(home, id) {
  const file = sessionFile(home, id);
  return file ? readJson(file, {}) || {} : {};
}

export function writeSession(home, id, patch) {
  const file = sessionFile(home, id);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...readSession(home, id), ...patch }, null, 2));
}

/** 入れ替えの記録を、Claude に伝える1文にする */
function describeLog(log) {
  if (log.available) {
    return '番頭の道具に新しい版があります (' + log.available + ')。' +
      '`agent update` で入れられます。利用者に1行だけ伝えてください。';
  }
  const changed = Array.isArray(log.changed) ? log.changed : [];
  return '番頭の道具を自動で新しくしました (' + (log.version || '') + ')。変わったファイル: ' +
    (changed.join(', ') || 'なし') + '。戻すときは `agent update rollback`。利用者に1行だけ伝えてください。';
}

/**
 * UserPromptSubmit。登録したフォルダなら合図を返す。
 *
 * @param {string} home
 * @param {{cwd?:string, session_id?:string}} input
 * @param {Date} [now]
 * @returns {string} 出す JSON。出さないなら ''
 */
export function onPrompt(home, input, now) {
  if (!isTracked(home, input.cwd)) return '';
  const id = String(input.session_id || '');
  writeSession(home, id, { promptAt: (now || new Date()).toISOString() });

  const s = readSession(home, id);
  const lines = [
    'このフォルダの作業は 番頭 (SoftBanto) のやることに載せる決まりです。',
    'ファイル・設定・文書を作る・直す・消す依頼なら、banto-track スキルに従って起票・更新・完了してください。' +
      '質問・説明・調べもの・雑談は載せません。',
    'この会話の id: ' + id,
    '道具: node "' + path.join(home, 'kit', 'agent.mjs') + '"',
  ];
  if (s.issue) lines.push('いまのやること: #' + s.issue + (s.title ? ' (' + s.title + ')' : ''));

  const logFile = path.join(home, 'update-log.json');
  const log = readJson(logFile, null);
  if (log) {
    lines.push(describeLog(log));
    try { fs.unlinkSync(logFile); } catch (e) { /* 次に見せればよい */ }
  }

  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') },
  });
}

/**
 * Stop。いまのやることがあるのに、この返事のあいだに印が付いていなければ1回だけ止める。
 *
 * 止めたあとの2回目 (stop_hook_active) は止めない。止め続けると終われなくなる。
 *
 * @returns {string} 出す JSON。止めないなら ''
 */
export function onStop(home, input) {
  if (input.stop_hook_active) return '';
  if (!isTracked(home, input.cwd)) return '';
  const id = String(input.session_id || '');
  const s = readSession(home, id);
  if (!s.issue) return '';
  if (s.touchedAt && s.promptAt && String(s.touchedAt) >= String(s.promptAt)) return '';

  return JSON.stringify({
    decision: 'block',
    reason: '番頭のやること #' + s.issue + ' を、この作業に合わせて更新するか完了にしてください' +
      ' (banto-track スキル)。済んでいれば `agent track touch ' + id + '` で印を付けてください。',
  });
}

async function main() {
  const kind = process.argv[2];
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch (e) {
    return;
  }
  if (!input || typeof input !== 'object') return;

  const home = bantoHome();
  const out = kind === 'prompt' ? onPrompt(home, input)
    : kind === 'stop' ? onStop(home, input) : '';
  if (out) process.stdout.write(out + '\n');
}

// import されたときは動かない (track.mjs が関数を使う)
function isMain() {
  try {
    return Boolean(process.argv[1]) &&
      pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch (e) {
    return false;
  }
}

if (isMain()) {
  main().catch(() => {}).finally(() => { process.exitCode = 0; });
}
