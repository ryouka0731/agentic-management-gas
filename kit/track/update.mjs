/**
 * 手元の道具を、番頭から新しい版を受け取って入れ替える。
 *
 * 入れ替えのあいだは受け取った中身を実行しない。**ただし実行されないわけではない。**
 * 新しい agent.mjs は次に呼ばれたときに動き、写した ~/.banto/hooks/track-hook.mjs は
 * Claude Code が次の依頼から (どのフォルダでも) 自動で動かす。
 *
 * 命令の入れ先 (Drive の queue/) は、Drive を共有している人なら誰でも書ける。
 * 偽の結果を置かれると、その人が書いたものが全員の手元で動く。この仕組みの
 * 中に本物か確かめる手段は無い (署名は後で足す予定)。次の手当ては壊れた版には
 * 効くが、偽物は防げない。本当の止め方は autoUpdate: false である:
 *   - 置き場 (~/.banto/kit) の外には書かない (safeName)。外を指す名前・字でない中身・
 *     欠けた中身が1つでもあれば、全体を断る (checkFiles)
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

/** 欠けていれば入れない。agent.mjs が無いと、戻す命令 (update rollback) ごと無くなる */
export const REQUIRED_FILES = ['agent.mjs', 'track/hook.mjs', 'track/update.mjs'];

/**
 * 届いた中身を、書く前に丸ごと確かめる。1つでも駄目なら全体を断る。
 *
 * **黙って飛ばさない。** 外を指す名前だけを捨てて残りを入れると、空や欠けた
 * 置き場が出来上がり、agent.mjs ごと消えて戻すこともできなくなる。
 *
 * @param {*} files
 * @returns {Array<[string, string]>} 置き場の中の名前と base64
 */
export function checkFiles(files) {
  const refuse = (why) => new Error('受け取った道具の中身が' + why + '。入れ替えませんでした');
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw refuse('読めない形です');
  const out = [];
  for (const [name, body] of Object.entries(files)) {
    const safe = safeName(name);
    if (!safe) throw refuse('置き場の外を指しています (' + name + ')');
    if (typeof body !== 'string') throw refuse('字ではありません (' + name + ')');
    out.push([safe, body]);
  }
  const have = new Set(out.map(([n]) => n));
  const missing = REQUIRED_FILES.filter((n) => !have.has(n));
  if (missing.length) throw refuse('欠けています (' + missing.join(', ') + ')');
  return out;
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

/**
 * 置き場を差し替える。**消してから置く形にしない**: 間で落ちると rollback の
 * 命令を持つ agent.mjs ごと無くなる。いまのを .old に退けてから置き、置けなければ戻す。
 */
function swapKit(kit, next) {
  const old = kit + '.old';
  fs.rmSync(old, { recursive: true, force: true });
  const had = fs.existsSync(kit);
  if (had) fs.renameSync(kit, old);
  try {
    fs.renameSync(next, kit);
  } catch (e) {
    if (had) fs.renameSync(old, kit);
    throw e;
  }
  fs.rmSync(old, { recursive: true, force: true });
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
  // 控えを取る前に確かめる。断ったときに控えだけ増えると、戻す先がずれる
  const entries = checkFiles(files);

  const p = paths(home);
  const before = snapshot(p.kit);
  backupKit(home, now, (readConfig(home) || {}).kitPrint);

  // 新しい置き場を隣に組んでから差し替える。途中で落ちても今の置き場は残る
  const next = p.kit + '.new';
  fs.rmSync(next, { recursive: true, force: true });
  fs.mkdirSync(next, { recursive: true });
  const written = {};
  for (const [safe, body] of entries) {
    const to = path.join(next, ...safe.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const bytes = Buffer.from(body, 'base64');
    fs.writeFileSync(to, bytes);
    written[safe] = bytes.toString('utf8');
  }
  swapKit(p.kit, next);

  if (link || claudeLinked(claude)) linkClaude(home, claude);

  const names = new Set([...Object.keys(before), ...Object.keys(written)]);
  const changed = [...names].filter((n) => before[n] !== written[n]).sort();
  writeConfig(home, { kitPrint: print, kitVersion: version, skipPrint: '' });
  return { print, version, changed };
}

/**
 * 版の返事を読み、次にすることを決める。待つ確認と待たない確認で同じ判断にする。
 *
 * @returns {{next:'none'|'skip'|'available'|'install', print:string, version:string}}
 */
function judgeVersion(config, res, force) {
  if (!res || !res.ok) throw new Error('道具の版を確かめられませんでした: ' + ((res && res.error) || '返事がありません'));
  const print = String((res.result || {}).print || '');
  const version = String((res.result || {}).version || '');
  if (!print || print === config.kitPrint) return { next: 'none', print, version };
  if (!force && print === config.skipPrint) return { next: 'skip', print, version };
  if (!force && config.autoUpdate === false) return { next: 'available', print, version };
  return { next: 'install', print, version };
}

function writeAvailable(home, version, now) {
  fs.writeFileSync(paths(home).log, JSON.stringify({ available: version, at: new Date(now).toISOString() }));
}

/** 入れ替えて、次に Claude Code を開いたときに見せる記録を書く */
async function installAndLog({ home, claude, send, now }) {
  const done = await installFromServer({ home, claude, send, now });
  fs.writeFileSync(paths(home).log,
    JSON.stringify({ version: done.version, changed: done.changed, at: new Date(now).toISOString() }));
  return { checked: true, updated: true, ...done };
}

/**
 * 新しい版が来ていないか確かめ、来ていれば入れ替える。**返事を待つ。**
 *
 * 待つのは人が頼んだとき (agent update) だけ。命令のついでの確認は tickUpdate で待たない。
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
  const j = judgeVersion(config, res, force);
  if (j.next === 'none') return { checked: true, updated: false };
  if (j.next === 'skip') return { checked: true, updated: false, skipped: true };
  if (j.next === 'available') {
    writeAvailable(home, j.version, now);
    return { checked: true, updated: false, available: true, version: j.version };
  }
  return installAndLog({ home, claude, send, now });
}

/**
 * 置いたまま拾っていない確認の命令を捨てる。捨てられなくても記録は外す。
 *
 * @param {Function} drop (id) => void。命令と届いた結果のファイルを消す
 */
export function dropPending(home, drop) {
  const config = readConfig(home);
  const pending = config && config.pendingUpdate;
  if (!pending) return;
  try { drop(String(pending.id || '')); } catch (e) { /* 読めない id なら置いた物も無い */ }
  writeConfig(home, { pendingUpdate: null });
}

/**
 * 1日1回の確認を、**待たずに**1歩だけ進める。命令のついでに呼ぶ。
 *
 * Claude Code の Bash は2分で打ち切るので、命令の返事 (最大で数分) を待てない。
 * 置いた命令を config.json の pendingUpdate に覚えて帰り、次に呼ばれたときに
 * 結果があれば拾って続きをする:
 *
 *   版を尋ねる (kitVersion) を置く → 次: 新しければ中身を頼む (kitFiles) を置く → 次: 入れ替える
 *
 * 24時間たっても返らない命令は捨てる (向こうが止まっているか、同期が切れている)。
 *
 * @param {{home:string, claude:string, place:Function, collect:Function, drop:Function, now?:number}} o
 *   place(op, args) → id / collect(id) → 結果か null / drop(id) は命令と結果を消す
 * @returns {Promise<{updated:boolean, placed?:string, available?:boolean, skipped?:boolean, version?:string, changed?:string[]}>}
 */
export async function tickUpdate({ home, claude, place, collect, drop, now = Date.now() }) {
  let config = readConfig(home);
  if (!config) return { updated: false };

  const pending = config.pendingUpdate;
  if (pending) {
    const at = Date.parse(pending.at || '');
    const known = pending.op === 'kitVersion' || pending.op === 'kitFiles';
    if (!known || !Number.isFinite(at) || now - at >= DAY_MS) {
      dropPending(home, drop);
      config = readConfig(home);
    } else {
      const res = collect(String(pending.id));
      if (res === null || res === undefined) return { updated: false };
      writeConfig(home, { pendingUpdate: null });

      if (pending.op === 'kitFiles') {
        return installAndLog({ home, claude, send: async () => res, now });
      }
      const j = judgeVersion(config, res, false);
      if (j.next === 'skip') return { updated: false, skipped: true };
      if (j.next === 'available') {
        writeAvailable(home, j.version, now);
        return { updated: false, available: true, version: j.version };
      }
      if (j.next === 'install') {
        const id = place('kitFiles', {});
        writeConfig(home, { pendingUpdate: { op: 'kitFiles', id, at: new Date(now).toISOString() } });
        return { updated: false, placed: 'kitFiles' };
      }
      return { updated: false };
    }
  }

  const last = Date.parse(config.lastUpdateCheck || '');
  if (Number.isFinite(last) && now - last < DAY_MS) return { updated: false };

  // 先に書く。置けなくても、命令のたびに置き直さない
  writeConfig(home, { lastUpdateCheck: new Date(now).toISOString() });
  const id = place('kitVersion', { mine: config.kitPrint || '' });
  writeConfig(home, { pendingUpdate: { op: 'kitVersion', id, at: new Date(now).toISOString() } });
  return { updated: false, placed: 'kitVersion' };
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

  const next = p.kit + '.new';
  fs.rmSync(next, { recursive: true, force: true });
  fs.cpSync(dir, next, { recursive: true });
  fs.rmSync(path.join(next, 'backup.json'), { force: true });
  swapKit(p.kit, next);
  if (claudeLinked(claude)) linkClaude(home, claude);

  writeConfig(home, { kitPrint: meta.print || '', skipPrint: config.skipPrint || config.kitPrint || '' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { restored: last };
}
