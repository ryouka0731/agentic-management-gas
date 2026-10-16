/**
 * 手元の道具を、番頭から新しい版を受け取って入れ替える。
 *
 * **入れ替えは書き換えるだけで、受け取った中身を実行しない。** 新しい
 * agent.mjs が動くのは、次に呼ばれたときである。
 *
 * 命令の入れ先 (Drive の queue/) は、Drive を共有している人なら誰でも書ける。
 * 偽の結果を置かれると、その人が書いたものが次に呼んだときに動く。この仕組みの
 * 中に本物か確かめる手段は無いので、次の手当てで代える:
 *   - 置き場 (~/.banto/kit) の外には書かない (safeName)
 *   - 入れ替える前に控えを取り、agent update rollback で戻せる
 *   - 何が変わったかを、次に Claude Code を開いたときに見せる
 *   - config.json の autoUpdate: false で、知らせるだけにできる
 *   - 指紋が名乗りと合わなければ入れない (途中で切れたものを防ぐ。偽物は防げない)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_BACKUPS = 3;

export function paths(home) {
  return {
    kit: path.join(home, 'kit'),
    config: path.join(home, 'config.json'),
    backup: path.join(home, 'backup'),
    log: path.join(home, 'update-log.json'),
    hooks: path.join(home, 'hooks'),
  };
}

export function readConfig(home) {
  try {
    return JSON.parse(fs.readFileSync(paths(home).config, 'utf8'));
  } catch (e) {
    return null;
  }
}

export function writeConfig(home, patch) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(paths(home).config,
    JSON.stringify({ ...(readConfig(home) || {}), ...patch }, null, 2) + '\n');
}

/**
 * 中身の指紋。**番頭の kitPrint_() と同じ式でなければならない。**
 *
 * @param {Object<string,string>} files 名前 → base64
 * @returns {string} 16進8字
 */
export function kitPrintOf(files) {
  return crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex').slice(0, 8);
}

/**
 * 受け取った名前を、置き場の中の道のりにする。外を指すものは null。
 *
 * @param {string} name
 * @returns {string|null}
 */
export function safeName(name) {
  const s = String(name || '');
  if (!s || s.includes('\\') || s.includes('\0')) return null;
  if (path.posix.isAbsolute(s) || /^[A-Za-z]:/.test(s)) return null;
  const norm = path.posix.normalize(s);
  if (norm === '.' || norm.split('/').includes('..')) return null;
  return norm;
}

/** 並べると古い順になる日時の字 (20261015-093000) */
export function stamp(now) {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/** フォルダの中のファイルを、名前 → 中身 (字) で読む */
function snapshot(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  (function visit(rel) {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const next = rel ? rel + '/' + name : name;
      const at = path.join(dir, next);
      if (fs.statSync(at).isDirectory()) visit(next);
      else out[next] = fs.readFileSync(at, 'utf8');
    }
  })('');
  return out;
}

/** 番頭に作業を載せる仕掛けを入れているか */
export function claudeLinked(claude) {
  return fs.existsSync(path.join(claude, 'skills', 'banto-track'));
}

/**
 * 置き場の中のスキルとフックを、使われる場所に写す。
 *
 * **~/.claude に自動で書くのはこのスキル1つだけ。** settings.json は触らない。
 */
export function linkClaude(home, claude) {
  const kit = paths(home).kit;
  const skill = path.join(kit, 'track', 'SKILL.md');
  const hook = path.join(kit, 'track', 'hook.mjs');
  if (fs.existsSync(skill)) {
    const to = path.join(claude, 'skills', 'banto-track');
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(skill, path.join(to, 'SKILL.md'));
  }
  if (fs.existsSync(hook)) {
    fs.mkdirSync(paths(home).hooks, { recursive: true });
    fs.copyFileSync(hook, path.join(paths(home).hooks, 'track-hook.mjs'));
  }
}

function listBackups(home) {
  const dir = paths(home).backup;
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^\d{8}-\d{6}/.test(n)).sort() : [];
}

function backupKit(home, now, print) {
  const p = paths(home);
  if (!fs.existsSync(p.kit)) return;
  let name = stamp(now);
  // 同じ秒に2回入れ替えたときに前の控えを上書きしない
  for (let i = 1; fs.existsSync(path.join(p.backup, name)); i++) name = stamp(now) + '-' + i;
  const to = path.join(p.backup, name);
  fs.cpSync(p.kit, to, { recursive: true });
  fs.writeFileSync(path.join(to, 'backup.json'), JSON.stringify({ print: print || '' }));
  const all = listBackups(home);
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) {
    fs.rmSync(path.join(p.backup, old), { recursive: true, force: true });
  }
}

/**
 * 番頭から中身を受け取って置き場を入れ替える。
 *
 * @param {{home:string, claude:string, send:Function, now?:number, link?:boolean}} o
 *   link: スキルとフックを必ず写す (入れるとき)。偽なら、入れている人だけ写す
 * @returns {Promise<{print:string, version:string, changed:string[]}>}
 */
export async function installFromServer({ home, claude, send, now = Date.now(), link = false }) {
  const res = await send('kitFiles', {});
  if (!res || !res.ok) throw new Error('道具を受け取れませんでした: ' + ((res && res.error) || '返事がありません'));
  const result = res.result || {};
  const files = result.files || {};
  const print = String(result.print || '');
  const version = String(result.version || '');
  if (!print || kitPrintOf(files) !== print) {
    throw new Error('受け取った道具の指紋が合いません。入れ替えませんでした');
  }

  const p = paths(home);
  const before = snapshot(p.kit);
  backupKit(home, now, (readConfig(home) || {}).kitPrint);

  // 新しい置き場を隣に組んでから差し替える。途中で落ちても今の置き場は残る
  const next = p.kit + '.new';
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(next, { recursive: true });
  const written = {};
  for (const [name, body] of Object.entries(files)) {
    const safe = safeName(name);
    if (!safe) continue;
    const to = path.join(next, ...safe.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const bytes = Buffer.from(String(body), 'base64');
    fs.writeFileSync(to, bytes);
    written[safe] = bytes.toString('utf8');
  }
  fs.rmSync(p.kit, { recursive: true, force: true });
  fs.renameSync(next, p.kit);

  if (link || claudeLinked(claude)) linkClaude(home, claude);

  const names = new Set([...Object.keys(before), ...Object.keys(written)]);
  const changed = [...names].filter((n) => before[n] !== written[n]).sort();
  writeConfig(home, { kitPrint: print, kitVersion: version, skipPrint: '' });
  return { print, version, changed };
}

/**
 * 新しい版が来ていないか確かめ、来ていれば入れ替える。
 *
 * @param {{home:string, claude:string, send:Function, now?:number, force?:boolean}} o
 *   force: 24時間を待たず、飛ばした版も入れる (agent update)
 */
export async function checkForUpdate({ home, claude, send, now = Date.now(), force = false }) {
  const config = readConfig(home);
  if (!config) return { checked: false, updated: false };
  const last = Date.parse(config.lastUpdateCheck || '');
  if (!force && Number.isFinite(last) && now - last < DAY_MS) return { checked: false, updated: false };

  // 先に書く。向こうが止まっていても、命令のたびに待たせない
  writeConfig(home, { lastUpdateCheck: new Date(now).toISOString() });

  const res = await send('kitVersion', { mine: config.kitPrint || '' });
  if (!res || !res.ok) throw new Error('道具の版を確かめられませんでした: ' + ((res && res.error) || '返事がありません'));
  const print = String((res.result || {}).print || '');
  const version = String((res.result || {}).version || '');
  const at = new Date(now).toISOString();

  if (!print || print === config.kitPrint) return { checked: true, updated: false };
  if (!force && print === config.skipPrint) return { checked: true, updated: false, skipped: true };
  if (!force && config.autoUpdate === false) {
    fs.writeFileSync(paths(home).log, JSON.stringify({ available: version, at }));
    return { checked: true, updated: false, available: true, version };
  }

  const done = await installFromServer({ home, claude, send, now });
  fs.writeFileSync(paths(home).log, JSON.stringify({ version: done.version, changed: done.changed, at }));
  return { checked: true, updated: true, ...done };
}

/**
 * 最後の控えに戻す。戻した版は、翌日の確認で入れ直さない。
 *
 * @returns {{restored:string}}
 */
export function rollback({ home, claude }) {
  const p = paths(home);
  const all = listBackups(home);
  if (!all.length) throw new Error('戻せる控えがありません');
  const last = all[all.length - 1];
  const dir = path.join(p.backup, last);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8')); } catch (e) { meta = {}; }
  const config = readConfig(home) || {};

  fs.rmSync(p.kit, { recursive: true, force: true });
  fs.cpSync(dir, p.kit, { recursive: true });
  fs.rmSync(path.join(p.kit, 'backup.json'), { force: true });
  if (claudeLinked(claude)) linkClaude(home, claude);

  writeConfig(home, { kitPrint: meta.print || '', skipPrint: config.kitPrint || '' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { restored: last };
}
