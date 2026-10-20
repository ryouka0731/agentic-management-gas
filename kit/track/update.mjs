/**
 * 手元の道具を、番頭から新しい版を受け取って入れ替える。
 *
 * 入れ替えのあいだは受け取った中身を実行しない。**ただし実行されないわけではない。**
 * 新しい agent.mjs は次に呼ばれたときに動き、写した ~/.banto/hooks/track-hook.mjs は
 * Claude Code が次の依頼から (どのフォルダでも) 自動で動かす。
 *
 * 命令の入れ先 (Drive の queue/) は、Drive を共有している人なら誰でも書ける。
 * そこへ偽の結果を置かれても動かないよう、**番頭の署名が合うものしか自動では
 * 入れない** (verifyKit)。秘密鍵は deploy する人の手元にだけあり、番頭 (Apps Script)
 * には deploy のときに作った署名しか置かない。Drive に書けるだけの人は署名を作れない。
 * 確かめる公開鍵は、いま入っている道具の track/kit-key.pem
 * (最初は Web アプリから落とした zip のもの) で、届いた中身の鍵は使わない。
 * 残る信頼の先は、秘密鍵を持つ人 (= deploy する人) である。
 *
 * そのほかの手当て (壊れた版に効く):
 *   - 置き場 (~/.banto/kit) の外には書かない (safeName)。外を指す名前・字でない中身・
 *     欠けた中身が1つでもあれば、全体を断る (checkFiles)
 *   - 入れ替える前に控えを取り、agent update rollback で戻せる
 *   - 何が変わったかを、次に Claude Code を開いたときに見せる
 *   - config.json の autoUpdate: false で、知らせるだけにできる
 *   - 指紋が名乗りと合わなければ入れない (途中で切れたものを防ぐ)
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
 * 署名する文。**番頭の kitSignedText_() と同じ字でなければならない。**
 *
 * 指紋 (kitPrintOf) は8字しか無いので、署名には中身の sha256 を64字まるごと入れる。
 * 頭の 'softbanto-kit/1' は、同じ鍵で別の物に付けた署名を流用させないため。
 *
 * @param {string} version
 * @param {Object<string,string>} files 名前 → base64
 * @returns {string}
 */
export function kitSignedText(version, files) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
  return 'softbanto-kit/1\n' + String(version) + '\n' + digest;
}

/**
 * 番頭の署名が、固定した公開鍵で確かめられるか。読めないものは全部「合わない」。
 *
 * @param {{version:string, files:Object<string,string>, signature:string}} kit
 * @param {string} publicKeyPem
 * @returns {boolean}
 */
export function verifyKit({ version, files, signature }, publicKeyPem) {
  try {
    if (typeof signature !== 'string' || !signature) return false;
    return crypto.verify('RSA-SHA256', Buffer.from(kitSignedText(version, files), 'utf8'),
      publicKeyPem, Buffer.from(signature, 'base64'));
  } catch (e) {
    return false;
  }
}

/**
 * いま入っている道具が固定している公開鍵。無ければ ''。
 *
 * **確かめる鍵は必ずここから読む。** 届いた中身の kit-key.pem で確かめると、
 * 偽物は自分の鍵を添えて自分で署名するだけで通ってしまう。
 */
export function readPinnedKey(home) {
  try {
    return fs.readFileSync(path.join(paths(home).kit, 'track', 'kit-key.pem'), 'utf8');
  } catch (e) {
    return '';
  }
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

/**
 * 記録に残す版の字。形が違えば ''。
 *
 * **版の字は Claude への合図 (hook の additionalContext) に入る。** kitVersion の返事には
 * 署名が無いので、偽の返事で好きな文を Claude に読ませられる。字の並びを絞って止める。
 * hook.mjs の cleanVersion_ と同じ規則 (hook は他のファイルを import しない)。
 *
 * @param {*} v
 * @returns {string}
 */
export function cleanVersion(v) {
  const s = String(v == null ? '' : v);
  return /^[0-9A-Za-z.+-]{1,32}$/.test(s) ? s : '';
}

/**
 * 版を比べる。点で区切り、両方が数なら数として、ほかは字として比べる。欠けた段は 0。
 *
 * @returns {number} a が新しければ正、古ければ負、同じなら 0
 */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.');
  const pb = String(b || '').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] === undefined ? '0' : pa[i];
    const y = pb[i] === undefined ? '0' : pb[i];
    if (x === y) continue;
    if (/^[0-9]+$/.test(x) && /^[0-9]+$/.test(y)) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * 欠けていれば入れない。agent.mjs が無いと、戻す命令 (update rollback) ごと無くなる。
 * **agent.mjs が読み込むものも同じ** (欠けると agent.mjs が起動時に落ちる)。読み込むものを足したらここにも足す
 */
export const REQUIRED_FILES = ['agent.mjs', 'track/hook.mjs', 'track/update.mjs', 'track/track.mjs', 'track/local.mjs'];

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

function backupKit(home, now, print, version) {
  const p = paths(home);
  if (!fs.existsSync(p.kit)) return;
  let name = stamp(now);
  // 同じ秒に2回入れ替えたときに前の控えを上書きしない
  for (let i = 1; fs.existsSync(path.join(p.backup, name)); i++) name = stamp(now) + '-' + i;
  const to = path.join(p.backup, name);
  fs.cpSync(p.kit, to, { recursive: true });
  fs.writeFileSync(path.join(to, 'backup.json'), JSON.stringify({ print: print || '', version: version || '' }));
  const all = listBackups(home);
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) {
    fs.rmSync(path.join(p.backup, old), { recursive: true, force: true });
  }
}

const stderr = (s) => process.stderr.write(s);

/**
 * 番頭から中身を受け取って置き場を入れ替える。
 *
 * **署名が合わなければ入れない。** 確かめる鍵は pinnedKey (落とした zip の鍵) か、
 * いま入っている道具の kit-key.pem。どちらも無いとき (初めて入れる・署名の前の道具) は、
 * 人が頼んだとき (manual) だけ、確かめられないと断ってから入れる。自動では入れない。
 *
 * @param {{home:string, claude:string, send:Function, now?:number, link?:boolean,
 *   manual?:boolean, pinnedKey?:string, warn?:Function}} o
 *   link: スキルとフックを必ず写す (入れるとき)。偽なら、入れている人だけ写す
 *   manual: 人が頼んだ (agent update / track install)
 * @returns {Promise<{print:string, version:string, changed:string[]}>}
 */
export async function installFromServer({ home, claude, send, now = Date.now(), link = false,
  manual = false, pinnedKey = '', warn = stderr }) {
  const { files, print, version, signature } = receivedKit(await send('kitFiles', {}));
  // 控えを取る前に確かめる。断ったときに控えだけ増えると、戻す先がずれる
  const entries = checkFiles(files);
  assertSigned({ version, files, signature }, pinnedKey || readPinnedKey(home), manual, warn);
  const mine = readConfig(home) || {};
  assertNotOlder(version, mine, manual);

  const p = paths(home);
  const before = snapshot(p.kit);
  backupKit(home, now, mine.kitPrint, cleanVersion(mine.kitVersion));

  // 新しい置き場を隣に組んでから差し替える。途中で落ちても今の置き場は残る
  const next = p.kit + '.new';
  const written = writeKitDir(next, entries);
  swapKit(p.kit, next);

  if (link || claudeLinked(claude)) linkClaude(home, claude);

  const names = new Set([...Object.keys(before), ...Object.keys(written)]);
  const changed = [...names].filter((n) => before[n] !== written[n]).sort();
  // 確かめたあとの版も、記録や合図に出すのは形の合う字だけ
  const shown = cleanVersion(version);
  writeConfig(home, { kitPrint: print, kitVersion: shown, skipPrint: '' });
  return { print, version: shown, changed };
}

/** 中身の返事を読む。返事が無い・指紋が合わないものは、何も変えないうちに断る */
function receivedKit(res) {
  if (!res || !res.ok) throw new Error('道具を受け取れませんでした: ' + ((res && res.error) || '返事がありません'));
  const result = res.result || {};
  const files = result.files || {};
  const print = String(result.print || '');
  const version = String(result.version || '');
  if (!print || kitPrintOf(files) !== print) {
    throw new Error('受け取った道具の指紋が合いません。入れ替えませんでした');
  }
  return { files, print, version, signature: result.signature };
}

/**
 * 署名を確かめる。鍵が無いときは、人が頼んだとき (manual) だけ断ってから通す。
 */
function assertSigned(kit, key, manual, warn) {
  if (key) {
    if (!verifyKit(kit, key)) {
      throw new Error('受け取った道具の署名が合いません。番頭が作ったものではないおそれがあります。入れ替えませんでした');
    }
    return;
  }
  if (!manual) {
    throw new Error('いまの道具は署名を確かめる鍵を持っていないため、自動では入れ替えませんでした。' +
      '番頭の画面から道具の zip を落とし直し、node agent.mjs track install で入れ直してください');
  }
  warn('署名を確かめられませんでした (確かめる鍵をまだ持っていません)。頼まれたので入れます\n');
}

/**
 * 署名は本物でも、前に配った古い版の返事を流し直されうる (待っている id に置くだけで済む)。
 * 自動では今より古い版に戻さない。戻すのは人が頼んだとき (update / rollback) だけ
 */
function assertNotOlder(version, mine, manual) {
  if (!manual && cleanVersion(mine.kitVersion) && compareVersions(version, mine.kitVersion) < 0) {
    throw new Error('受け取った道具は今より古い版です (' + cleanVersion(version) + ')。自動では戻しません');
  }
}

/**
 * 確かめた中身を新しい置き場に書く。
 *
 * @returns {Object<string,string>} 書いた名前と中身 (変わったものを数えるため)
 */
function writeKitDir(next, entries) {
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
  return written;
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

/**
 * 新しい版があることだけを記録する。版の字は形が合うときだけ残す (署名の無い返事から来るため)。
 *
 * @param {boolean} [unsigned] 鍵を持たない道具なので入れられない (zip を落とし直してもらう)
 */
function writeAvailable(home, version, now, unsigned) {
  fs.writeFileSync(paths(home).log, JSON.stringify({ available: cleanVersion(version) || '?',
    ...(unsigned ? { unsigned: true } : {}), at: new Date(now).toISOString() }));
}

/** 入れ替えて、次に Claude Code を開いたときに見せる記録を書く */
async function installAndLog({ home, claude, send, now, manual = false, pinnedKey = '', warn = stderr }) {
  const done = await installFromServer({ home, claude, send, now, manual, pinnedKey, warn });
  fs.writeFileSync(paths(home).log,
    JSON.stringify({ version: done.version, changed: done.changed, at: new Date(now).toISOString() }));
  return { checked: true, updated: true, ...done };
}

/**
 * 新しい版が来ていないか確かめ、来ていれば入れ替える。**返事を待つ。**
 *
 * 待つのは人が頼んだとき (agent update) だけ。命令のついでの確認は tickUpdate で待たない。
 *
 * @param {{home:string, claude:string, send:Function, now?:number, force?:boolean, manual?:boolean, warn?:Function}} o
 *   force: 24時間を待たず、飛ばした版も入れる (agent update)
 *   manual: 人が頼んだ。鍵を持たない道具でも、確かめられないと断ってから入れる
 */
export async function checkForUpdate({ home, claude, send, now = Date.now(), force = false, manual = false,
  pinnedKey = '', warn = stderr }) {
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
    return { checked: true, updated: false, available: true, version: cleanVersion(j.version) };
  }
  return installAndLog({ home, claude, send, now, manual, pinnedKey, warn });
}

/**
 * 1日1回の確認が置く命令の id の頭。ほかの命令 (kit-) と分け、片付けで他人の命令を消さない。
 */
export const UPDATE_ID_PREFIX = 'kitup';

/**
 * 入れ先のファイル名から、この確認が置いて24時間たった命令と結果を選ぶ。
 *
 * 待ちを捨てたとき (24時間・手で update) や、2つの呼び出しが同時に置いて片方の
 * 記録が上書きされたとき、届いた結果は誰にも拾われずに残る。時刻は名前に入っている
 * ものを使う (Drive の同期で更新時刻は当てにならない)。
 *
 * @param {string[]} names
 * @param {number} now
 * @param {string} keepId 今待っている命令。古くても消さない (捨てるのは tickUpdate が決める)
 * @returns {string[]}
 */
export function staleUpdateFiles(names, now, keepId) {
  const re = new RegExp('^(' + UPDATE_ID_PREFIX + '-([0-9]+)-[a-z0-9]+)\\.(cmd|result)\\.json$');
  return names.filter((n) => {
    const m = re.exec(n);
    return !!m && m[1] !== keepId && now - Number(m[2]) >= DAY_MS;
  });
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
  try { if (drop) drop(String(pending.id || '')); } catch (e) { /* 読めない id なら置いた物も無い */ }
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
 * **中身が届いたときにも、入れてよいかを決め直す。** 頼んでから届くまで何時間も
 * 空くことがあり、その間に autoUpdate: false にした・rollback で戻した人の道具を
 * 入れ替えてはならない。
 *
 * 公開鍵を持たない道具 (署名の前の版) は、自動では入れず知らせるだけにする。
 *
 * 24時間たっても返らない命令は捨てる (向こうが止まっているか、同期が切れている)。
 *
 * @param {{home:string, claude:string, place:Function, collect:Function, drop:Function,
 *   sweep?:Function, now?:number}} o
 *   place(op, args) → id / collect(id) → 結果か null / drop(id) は命令と結果を消す /
 *   sweep(keepId, now) は、この確認が置いて24時間たった命令と結果を消す (捨てた待ちの残り。staleUpdateFiles)
 * @returns {Promise<{updated:boolean, placed?:string, available?:boolean, skipped?:boolean, version?:string, changed?:string[]}>}
 */
export async function tickUpdate({ home, claude, place, collect, drop, sweep, now = Date.now() }) {
  let config = readConfig(home);
  if (!config) return { updated: false };

  const pending = config.pendingUpdate;
  if (sweep) sweepQuietly(sweep, pending, now);
  if (pending) {
    const got = collectPending(pending, collect, now);
    if (!got.broken) return continuePending({ home, claude, place, pending, res: got.res, now });
    dropPending(home, drop);
    config = readConfig(home);
  }

  const last = Date.parse(config.lastUpdateCheck || '');
  if (Number.isFinite(last) && now - last < DAY_MS) return { updated: false };

  // 先に書く。置けなくても、命令のたびに置き直さない
  writeConfig(home, { lastUpdateCheck: new Date(now).toISOString() });
  const id = place('kitVersion', { mine: config.kitPrint || '' });
  writeConfig(home, { pendingUpdate: { op: 'kitVersion', id, at: new Date(now).toISOString() } });
  return { updated: false, placed: 'kitVersion' };
}

/** 捨てた待ちの残りを片付ける。片付けに失敗しても、確認そのものは止めない */
function sweepQuietly(sweep, pending, now) {
  try { sweep(pending && pending.id ? String(pending.id) : '', now); } catch (e) { /* 次の日にまた試す */ }
}

/**
 * 待っている命令の結果を拾う。知らない命令・読めない時刻・24時間たったものは捨てる側 (broken) に回す。
 *
 * @returns {{broken: boolean, res?: *}}
 */
function collectPending(pending, collect, now) {
  const at = Date.parse(pending.at || '');
  const known = pending.op === 'kitVersion' || pending.op === 'kitFiles';
  if (!known || !Number.isFinite(at) || now - at >= DAY_MS) return { broken: true };
  // 読めない id で collect が投げると、24時間のあいだ命令のたびに失敗する。捨てる
  try { return { broken: false, res: collect(String(pending.id)) }; } catch (e) { return { broken: true }; }
}

/** 待っていた命令の結果で1歩進める。まだ返っていなければ待ち続ける */
async function continuePending({ home, claude, place, pending, res, now }) {
  if (res === null || res === undefined) return { updated: false };
  writeConfig(home, { pendingUpdate: null });
  const config = readConfig(home);

  const j = judgeVersion(config, res, false);
  if (j.next === 'skip') return { updated: false, skipped: true };
  if (j.next === 'available' || (j.next === 'install' && !readPinnedKey(home))) {
    writeAvailable(home, j.version, now, j.next === 'install');
    return { updated: false, available: true, version: cleanVersion(j.version) };
  }
  if (j.next !== 'install') return { updated: false };
  if (pending.op === 'kitFiles') {
    return installAndLog({ home, claude, send: async () => res, now });
  }
  const id = place('kitFiles', {});
  writeConfig(home, { pendingUpdate: { op: 'kitFiles', id, at: new Date(now).toISOString() } });
  return { updated: false, placed: 'kitFiles' };
}

/**
 * 最後の控えに戻す。戻した版は、翌日の確認で入れ直さない。
 *
 * 置いたまま拾っていない確認の命令も捨てる。残すと、あとで届いた中身で戻した
 * 先から入れ替わる。
 *
 * @param {{home:string, claude:string, drop?:Function}} o
 *
 * @returns {{restored:string}}
 */
export function rollback({ home, claude, drop }) {
  dropPending(home, drop);
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

  writeConfig(home, { kitPrint: meta.print || '', kitVersion: cleanVersion(meta.version), skipPrint: config.skipPrint || config.kitPrint || '' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { restored: last };
}
