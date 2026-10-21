/**
 * Claude Code の考え中の字 (~/.claude/settings.json の spinnerVerbs) を、番頭で選んでいる推しのせりふにする。
 *
 * **settings.json に書くのは、人が ok した `oshi-spinner on` / `off` と、オンにした人の1日1回の入れ替えだけ。**
 * 書くのは spinnerVerbs の1つの鍵だけで、ほかの鍵はそのまま残す (読んで、1つの鍵を置き、同じ字下げで書き戻す)。
 * 1日1回の入れ替えと `off` は、いまの値が最後にこちらで書いたものと同じときだけ書く (人が手で直したら触らない)。
 *
 * せりふは番頭の返事から来る。返事の置き場 (Drive の queue/) は共有している人なら書けるので、ここで必ず絞る
 * (cleanVerbs)。JSON に入れるだけのデータだが、字でないもの・制御文字・改行・コードに見える字は入れない。
 *
 * 状態は ~/.banto/config.json の spinner に覚える:
 *   { on, queueDir, had, previous, written, char, name, at, lastCheck, pending: {id, at} }
 *   had / previous: オンにする前に spinnerVerbs があったか・その値 (off で戻す)
 *   written: 最後にこちらで書いた値 (これと同じときだけ書き直す・戻す)
 */

import fs from 'node:fs';
import path from 'node:path';
import { readConfig, writeConfig, stamp, DAY_MS } from './update.mjs';

/** せりふ1つの字数の上限。**番頭の oshiLineMaxOf('spinner') と同じ** (test/kit-spinner.test.js が見ている) */
export const SPINNER_LINE_MAX = 24;

/** せりふの数の上限。**番頭の OSHI_SPINNER_MAX() と同じ** */
export const SPINNER_COUNT_MAX = 20;

/** 番頭に頼む命令 */
export const SPINNER_OP = 'oshiSpinner';

/**
 * 落とす字。C0 (改行・タブを含む)・DEL・C1、字の向きを変える印、幅の無い空白と BOM、行・段落の区切り。
 * 絵文字をつなぐ印 (U+200C / U+200D) は字の一部なので残す
 */
const DROP = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** コードや JSON に見える字。考え中のせりふには要らないので、含むものは入れない */
const CODE_LIKE = /[{}[\]<>`$\\]/;

/**
 * 番頭から受け取ったせりふを、settings.json に書ける形にそろえる。字だけ・制御文字と改行を落とし・前後の空白を取り・
 * コードに見えるもの・長すぎるもの・重なりを捨て、SPINNER_COUNT_MAX 個までにする。
 *
 * @param {*} list
 * @returns {string[]}
 */
export function cleanVerbs(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const v of list) {
    if (out.length >= SPINNER_COUNT_MAX) break;
    if (typeof v !== 'string') continue;
    const one = v.replace(DROP, '').trim();
    if (!one || one.length > SPINNER_LINE_MAX || CODE_LIKE.test(one) || out.includes(one)) continue;
    out.push(one);
  }
  return out;
}

/** こちらで書く値 */
export function spinnerValue(verbs) {
  return { mode: 'replace', verbs: verbs.slice() };
}

/**
 * 2つの spinnerVerbs が同じか。鍵の並びは見ない (Claude Code が settings.json を書き直すと並びが変わりうる)。
 *
 * @returns {boolean}
 */
export function sameSpinner(a, b) {
  const ok = (x) => x && typeof x === 'object' && !Array.isArray(x) && Array.isArray(x.verbs) &&
    Object.keys(x).every((k) => k === 'mode' || k === 'verbs');
  if (!ok(a) || !ok(b)) return false;
  return a.mode === b.mode && a.verbs.length === b.verbs.length && a.verbs.every((v, i) => v === b.verbs[i]);
}

export function settingsFile(claude) {
  return path.join(claude, 'settings.json');
}

/**
 * 字下げを読む。最初の字下げした行の頭の空白 (無ければ2つの空白)。
 *
 * @param {string} text
 * @returns {string}
 */
export function indentOf(text) {
  const m = /\n([ \t]+)\S/.exec(String(text || ''));
  return m ? m[1] : '  ';
}

/**
 * settings.json を読む。無ければ空。壊れていれば何も変えずに断る。
 *
 * @returns {{file:string, exists:boolean, text:string, settings:object}}
 */
export function readSettings(claude) {
  const file = settingsFile(claude);
  if (!fs.existsSync(file)) return { file, exists: false, text: '', settings: {} };
  const text = fs.readFileSync(file, 'utf8');
  let settings;
  try {
    settings = text.trim() ? JSON.parse(text) : {};
  } catch (e) {
    settings = null;
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(file + ' を読めません (JSON として壊れています)。直してからもう一度実行してください。何も変えていません');
  }
  return { file, exists: true, text, settings };
}

/**
 * いまの spinnerVerbs。
 *
 * @returns {{has:boolean, value:*}}
 */
export function currentSpinner(claude) {
  const { settings } = readSettings(claude);
  const has = Object.prototype.hasOwnProperty.call(settings, 'spinnerVerbs');
  return { has, value: has ? settings.spinnerVerbs : undefined };
}

/**
 * spinnerVerbs の1つの鍵だけを置く (value が undefined なら外す)。ほかの鍵・字下げ・最後の改行はそのまま。
 *
 * @param {{claude:string, value:*, backup?:boolean, now?:number}} o backup: 書く前に控えを取る (人が ok したとき)
 * @returns {{file:string, backup:string}}
 */
export function writeSpinner({ claude, value, backup = false, now = Date.now() }) {
  const { file, exists, text, settings } = readSettings(claude);
  if (value === undefined) delete settings.spinnerVerbs;
  else settings.spinnerVerbs = value;
  let saved = '';
  if (backup && exists) {
    saved = file + '.banto-backup-' + stamp(now);
    fs.copyFileSync(file, saved); // 元の許可 (600 など) を保つ。トークンを含みうる
  }
  const eol = !exists || /\n$/.test(text) ? '\n' : '';
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, exists ? indentOf(text) : '  ') + eol);
  return { file, backup: saved };
}

/** ~/.banto/config.json の spinner。無ければ {} */
export function spinnerState(home) {
  const c = readConfig(home);
  return c && c.spinner && typeof c.spinner === 'object' ? c.spinner : {};
}

function saveState(home, patch) {
  writeConfig(home, { spinner: { ...spinnerState(home), ...patch } });
}

/**
 * 番頭の返事 (命令 oshiSpinner) から書くせりふを決める。書けないときは理由。
 *
 * @returns {{verbs:string[], name:string, char:string, reason:string}}
 */
export function verbsFromResult(res) {
  if (!res || !res.ok) {
    return { verbs: [], name: '', char: '', reason: '考え中のせりふを受け取れませんでした: ' + ((res && res.error) || '返事がありません') };
  }
  const r = res.result && typeof res.result === 'object' ? res.result : {};
  const name = typeof r.name === 'string' ? r.name.replace(DROP, '').slice(0, 40) : '';
  const char = typeof r.char === 'string' && /^(builtin:[a-z]+|mine:[0-9]{1,6})$/.test(r.char) ? r.char : '';
  if (r.on !== true) {
    const why = typeof r.reason === 'string' ? r.reason.replace(DROP, '').slice(0, 200) : '';
    return { verbs: [], name, char, reason: why || '推しがオフです' };
  }
  const verbs = cleanVerbs(r.lines);
  return { verbs, name, char, reason: verbs.length ? '' : '書ける考え中のせりふがありませんでした' };
}

/**
 * オンにする前の様子と、書いたあとの値。書くのは人が ok してから (turnOn)。
 *
 * **前の値はオンにした最初のときのものを残す。** オンのまま入れ直すとき、いまの値はこちらで書いたものなので、
 * それを「前の値」にすると off で元に戻らなくなる。人が手で直していたら、その値を前の値にする。
 *
 * @returns {{file:string, has:boolean, before:*, next:object, previous:{had:boolean, value:*}}}
 */
export function planOn({ home, claude, verbs }) {
  const cur = currentSpinner(claude);
  const st = spinnerState(home);
  const keep = st.on === true && cur.has && sameSpinner(cur.value, st.written);
  const previous = keep ? { had: !!st.had, value: st.previous } : { had: cur.has, value: cur.value };
  return { file: settingsFile(claude), has: cur.has, before: cur.value, next: spinnerValue(verbs), previous };
}

/**
 * オンにする (人が ok したあと)。spinnerVerbs だけを書き、前の値と書いた値を覚える。
 *
 * @returns {{file:string, backup:string}}
 */
export function turnOn({ home, claude, plan, queueDir, name = '', char = '', now = Date.now() }) {
  const done = writeSpinner({ claude, value: plan.next, backup: true, now });
  writeConfig(home, { spinner: {
    on: true, queueDir: String(queueDir || ''), had: plan.previous.had,
    previous: plan.previous.had ? plan.previous.value : null, written: plan.next, name, char,
    at: new Date(now).toISOString(), lastCheck: new Date(now).toISOString(), pending: null,
  } });
  return done;
}

/**
 * 切る。いまの値がこちらで書いたものと同じときだけ、前の値に戻す (前に無ければ鍵を外す)。
 * 手で直されていたら触らない。どちらでも、覚えた状態はオフにし、置いたままの命令は捨てる。
 *
 * @param {{home:string, claude:string, drop?:Function, now?:number}} o drop(id) は命令と結果を消す
 * @returns {{state:'off'|'restored'|'removed'|'edited', file:string}}
 */
export function turnOff({ home, claude, drop, now = Date.now() }) {
  const st = spinnerState(home);
  const file = settingsFile(claude);
  if (st.on !== true) return { state: 'off', file };
  dropSpinnerPending(home, drop);
  const cur = currentSpinner(claude);
  let state = 'edited';
  if (cur.has && sameSpinner(cur.value, st.written)) {
    writeSpinner({ claude, value: st.had ? st.previous : undefined, backup: true, now });
    state = st.had ? 'restored' : 'removed';
  }
  writeConfig(home, { spinner: { on: false, at: new Date(now).toISOString() } });
  return { state, file };
}

/** 置いたまま拾っていない命令を捨てる。捨てられなくても記録は外す */
export function dropSpinnerPending(home, drop) {
  const st = spinnerState(home);
  if (!st.pending) return;
  try { if (drop) drop(String(st.pending.id || '')); } catch (e) { /* 読めない id なら置いた物も無い */ }
  saveState(home, { pending: null });
}

/**
 * いまの様子 (status)。
 *
 * @returns {{on:boolean, name:string, count:number, matches:boolean, has:boolean, at:string, lastCheck:string, pending:boolean}}
 */
export function spinnerStatus({ home, claude }) {
  const st = spinnerState(home);
  const cur = currentSpinner(claude);
  return {
    on: st.on === true, name: String(st.name || ''), count: st.written && Array.isArray(st.written.verbs) ? st.written.verbs.length : 0,
    matches: st.on === true && cur.has && sameSpinner(cur.value, st.written), has: cur.has,
    at: String(st.at || ''), lastCheck: String(st.lastCheck || ''), pending: !!st.pending,
  };
}

/**
 * 1日1回、せりふを番頭から取り直す。**待たない** (update.tickUpdate と同じ): 命令を置いて spinner.pending に覚え、
 * 返事は次に呼ばれたときに拾う。番頭で使うキャラを変えると、1日のうちに考え中の字も変わる。
 *
 * - オンにしていない人の settings.json は読みもしない (書かない)
 * - いまの値がこちらで最後に書いたものと違えば (人が手で直した) 書かない。命令も置かない
 * - 頼んでから届くまでのあいだにオフにされたら書かない (届いたときに決め直す)
 * - 24時間返らない命令は捨てる
 *
 * @param {{home:string, claude:string, place:Function, collect:Function, drop:Function, now?:number}} o
 *   place(op, args) → id / collect(id) → 結果か null / drop(id) は命令と結果を消す
 * @returns {{state:string}}
 */
export function tickSpinner({ home, claude, place, collect, drop, now = Date.now() }) {
  let st = spinnerState(home);
  if (st.on !== true) return { state: 'off' };
  if (st.pending) {
    const at = Date.parse(st.pending.at || '');
    let res;
    let broken = !Number.isFinite(at) || now - at >= DAY_MS;
    if (!broken) {
      try { res = collect(String(st.pending.id)); } catch (e) { broken = true; }
    }
    if (broken) {
      dropSpinnerPending(home, drop);
      st = spinnerState(home);
    } else if (res === null || res === undefined) {
      return { state: 'waiting' };
    } else {
      saveState(home, { pending: null });
      return applyResult({ home, claude, res, now });
    }
  }
  const last = Date.parse(st.lastCheck || '');
  if (Number.isFinite(last) && now - last < DAY_MS) return { state: 'fresh' };
  const cur = currentSpinner(claude);
  if (!cur.has || !sameSpinner(cur.value, st.written)) return { state: 'edited' };
  // 先に書く。置けなくても、命令のたびに置き直さない
  saveState(home, { lastCheck: new Date(now).toISOString() });
  const id = place(SPINNER_OP, {});
  saveState(home, { pending: { id, at: new Date(now).toISOString() } });
  return { state: 'placed' };
}

/** 届いた返事で書き直す。書くのは、まだオンで、いまの値がこちらで書いたものと同じときだけ */
function applyResult({ home, claude, res, now }) {
  const st = spinnerState(home);
  if (st.on !== true) return { state: 'off' };
  const got = verbsFromResult(res);
  if (!got.verbs.length) return { state: 'skipped', reason: got.reason };
  const cur = currentSpinner(claude);
  if (!cur.has || !sameSpinner(cur.value, st.written)) return { state: 'edited' };
  const next = spinnerValue(got.verbs);
  if (sameSpinner(next, st.written)) return { state: 'same' };
  writeSpinner({ claude, value: next, now });
  saveState(home, { written: next, name: got.name, char: got.char, at: new Date(now).toISOString() });
  return { state: 'updated' };
}
