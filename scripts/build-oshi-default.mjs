/**
 * 最初からいるキャラクター (推しの既定のキャラ) の絵を、GAS に持ち込める形に焼き直す。
 *
 * 本物は assets/oshi-default/<キャラ>/<形>-<表情>.webp (利用者が用意した絵。透明な WebP、長い辺 384px まで)。
 * GAS は src の外を読めないので、base64 の data URL にして、キャラと形ごとに1つのファイル
 * (src/core/OshiDefault<キャラ><形>.gs。例: OshiDefaultItsukiNormal.gs) に書く。分けるのは、
 * 1つが大きくなりすぎないため (1ファイル 600KB まで)。
 *
 * キャラ・表情・形の並びは src/core/Oshi.js (OSHI_BUILTINS / OSHI_STATES / OSHI_STYLES) が唯一の定義なので、
 * そこから読む。絵が1枚でも欠けていれば作らずに止める (欠けた表情だけ黙って絵が出なくなる)。
 * ただし optional の表情 (推しの機嫌の「むっ」など) は、絵が無ければ焼かない (画面が fallback の表情に代える)。
 *
 *   node scripts/build-oshi-default.mjs   # npm run deploy も送る前に走らせる
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets', 'oshi-default');

/** 1ファイルの上限 (バイト) */
export const OSHI_DEFAULT_MAX_BYTES = 600 * 1024;

/** 形の人に見せる名前 (コメントに書くだけ) */
const STYLE_LABELS = { normal: '等身', chibi: '2頭身' };

/** Oshi.js を読み、キャラ・表情・形の key を返す */
export function oshiDefinitions() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'core', 'Oshi.js'), 'utf8'), ctx);
  return {
    chars: ctx.OSHI_BUILTINS().map((c) => ({ key: c.key, name: c.name })),
    states: ctx.OSHI_STATES().map((s) => s.key),
    optional: ctx.OSHI_STATES().filter((s) => s.optional).map((s) => s.key),
    styles: ctx.OSHI_STYLES().map((s) => s.key),
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * 書き出す先と関数の名前。キャラ×形ごとに1つ。
 * ファイル名は src の中で他と重ならない (同じ名前の .js と .gs は clasp で1つになる)。
 *
 * @param {string} char
 * @param {string} style
 * @returns {{file: string, fn: string}}
 */
export function oshiDefaultOut(char, style) {
  if (!/^[a-z]+$/.test(char) || !/^[a-z]+$/.test(style)) throw new Error('名前に使えない key です: ' + char + '/' + style);
  return {
    file: 'src/core/OshiDefault' + cap(char) + cap(style) + '.gs',
    fn: 'OSHI_DEFAULT_' + char.toUpperCase() + '_' + style.toUpperCase(),
  };
}

/** 書き出すもの全部 ({char, style, file, fn}) */
export function oshiDefaultTargets() {
  const d = oshiDefinitions();
  const out = [];
  for (const c of d.chars) for (const st of d.styles) out.push(Object.assign({ char: c.key, style: st }, oshiDefaultOut(c.key, st)));
  return out;
}

/**
 * そのキャラ・形の 表情 → data URL。
 *
 * @param {string} char
 * @param {string} style
 * @returns {Object<string,string>}
 */
export function oshiDefaultMap(char, style) {
  const out = {};
  const d = oshiDefinitions();
  for (const state of d.states) {
    const rel = path.join('assets', 'oshi-default', char, style + '-' + state + '.webp');
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file) && d.optional.includes(state)) continue;
    if (!fs.existsSync(file)) throw new Error('既定のキャラの絵がありません: ' + rel);
    const bytes = fs.readFileSync(file);
    // 名乗る形式と中身が合うか (RIFF....WEBP)。拡張子だけ変えた別の物を焼かない
    if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') {
      throw new Error('WebP ではありません: ' + rel);
    }
    out[state] = 'data:image/webp;base64,' + bytes.toString('base64');
  }
  return out;
}

/**
 * 焼き直した中身を返す。
 *
 * @param {string} char
 * @param {string} style
 * @returns {string}
 */
export function buildOshiDefaultSource(char, style) {
  const d = oshiDefinitions();
  const c = d.chars.find((x) => x.key === char);
  if (!c) throw new Error('知らないキャラです: ' + char);
  if (!d.styles.includes(style)) throw new Error('知らない絵の形です: ' + style);
  const out = oshiDefaultOut(char, style);
  const lines = [
    '/**',
    ' * 最初からいるキャラクター「' + c.name + '」の絵、' + (STYLE_LABELS[style] || style) + '。',
    ' * **scripts/build-oshi-default.mjs が assets/oshi-default/' + char + '/ から作る。手で直さない。**',
    ' *',
    ' * 画面へは apiOshiDefaultImage で1枚ずつ渡す (最初のページには入れない)。',
    ' */',
    '',
    '/**',
    ' * 表情 → data URL (image/webp)。',
    ' *',
    ' * @returns {Object<string,string>}',
    ' */',
    'function ' + out.fn + '() {',
    '  return {',
  ];
  for (const [state, url] of Object.entries(oshiDefaultMap(char, style))) lines.push("    '" + state + "': '" + url + "',");
  lines.push('  };', '}', '');
  const text = lines.join('\n');
  if (Buffer.byteLength(text) > OSHI_DEFAULT_MAX_BYTES) {
    throw new Error(out.file + ' が ' + Math.round(OSHI_DEFAULT_MAX_BYTES / 1024) + 'KB を超えます。絵を縮めてください');
  }
  return text;
}

/**
 * 書き出す。
 *
 * @returns {string[]} 作り直したファイル
 */
export function writeOshiDefaultSources() {
  const changed = [];
  for (const t of oshiDefaultTargets()) {
    const next = buildOshiDefaultSource(t.char, t.style);
    const target = path.join(ROOT, t.file);
    const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (now === next) continue;
    fs.writeFileSync(target, next);
    changed.push(t.file);
  }
  return changed;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const changed = writeOshiDefaultSources();
  process.stdout.write(changed.length
    ? changed.map((f) => f + ' を作り直しました\n').join('')
    : '既定のキャラの絵は最新です\n');
}
