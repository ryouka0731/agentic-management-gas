/**
 * 最初からいるキャラクター (推しの既定のキャラ) の絵を、GAS に持ち込める形に焼き直す。
 *
 * 本物は assets/oshi-default/<形>-<表情>.webp (利用者が用意した絵。透明な WebP、長い辺 384px まで)。
 * GAS は src の外を読めないので、base64 の data URL にして src/core/OshiDefaultNormal.gs と
 * src/core/OshiDefaultChibi.gs に書く。形ごとにファイルを分けるのは、1つが大きくなりすぎないため
 * (1ファイル 600KB まで)。
 *
 * 表情と形の並びは src/core/Oshi.js (OSHI_STATES / OSHI_STYLES) が唯一の定義なので、そこから読む。
 * 絵が1枚でも欠けていれば作らずに止める (欠けた表情だけ黙って絵が出なくなる)。
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

/** 形 → 書き出す先と関数の名前 */
export const OSHI_DEFAULT_OUT = {
  normal: { file: 'src/core/OshiDefaultNormal.gs', fn: 'OSHI_DEFAULT_NORMAL', label: '等身' },
  chibi: { file: 'src/core/OshiDefaultChibi.gs', fn: 'OSHI_DEFAULT_CHIBI', label: '2頭身' },
};

/** Oshi.js を読み、表情と形の key を返す */
function definitions() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'core', 'Oshi.js'), 'utf8'), ctx);
  return {
    states: ctx.OSHI_STATES().map((s) => s.key),
    styles: ctx.OSHI_STYLES().map((s) => s.key),
  };
}

/**
 * その形の 表情 → data URL。
 *
 * @param {string} style
 * @returns {Object<string,string>}
 */
export function oshiDefaultMap(style) {
  const out = {};
  for (const state of definitions().states) {
    const file = path.join(ASSETS, style + '-' + state + '.webp');
    if (!fs.existsSync(file)) throw new Error('既定のキャラの絵がありません: assets/oshi-default/' + style + '-' + state + '.webp');
    const bytes = fs.readFileSync(file);
    // 名乗る形式と中身が合うか (RIFF....WEBP)。拡張子だけ変えた別の物を焼かない
    if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') {
      throw new Error('WebP ではありません: ' + path.relative(ROOT, file));
    }
    out[state] = 'data:image/webp;base64,' + bytes.toString('base64');
  }
  return out;
}

/**
 * 焼き直した中身を返す。
 *
 * @param {string} style
 * @returns {string}
 */
export function buildOshiDefaultSource(style) {
  const out = OSHI_DEFAULT_OUT[style];
  if (!out) throw new Error('知らない絵の形です: ' + style);
  const lines = [
    '/**',
    ' * 最初からいるキャラクター (推しの既定のキャラ) の絵、' + out.label + '。',
    ' * **scripts/build-oshi-default.mjs が assets/oshi-default/ から作る。手で直さない。**',
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
  for (const [state, url] of Object.entries(oshiDefaultMap(style))) lines.push("    '" + state + "': '" + url + "',");
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
  for (const style of definitions().styles) {
    const out = OSHI_DEFAULT_OUT[style];
    if (!out) throw new Error('書き出す先が決まっていない絵の形です: ' + style);
    const next = buildOshiDefaultSource(style);
    const target = path.join(ROOT, out.file);
    const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (now === next) continue;
    fs.writeFileSync(target, next);
    changed.push(out.file);
  }
  return changed;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const changed = writeOshiDefaultSources();
  process.stdout.write(changed.length
    ? changed.map((f) => f + ' を作り直しました\n').join('')
    : '既定のキャラの絵は最新です\n');
}
