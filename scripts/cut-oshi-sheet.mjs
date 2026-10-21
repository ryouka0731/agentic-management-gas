/**
 * 最初からいるキャラクターの絵を、利用者が用意した1枚の絵 (いくつもの絵が並んだもの) から切り出す。
 *
 * 本物は assets/oshi-sheets/<キャラ>/ にある:
 * - <形>.webp      並んだ絵 (透明な WebP。可逆で縮めてある)。**リポジトリには置かない** (.gitignore)。利用者から
 *                  受け取った絵をそのまま手元に置く。予備の枠に、実在の人に結び付く字やロゴ (ユニフォーム・背番号・
 *                  製品名) が残るため。切り出した絵 (assets/oshi-default) だけがリポジトリに入る
 * - cells.json    どの絵がどこにあるか (`cells`) と、表情ごとにどの絵を使うか (`states`)。こちらは置く
 *
 * 絵の並びは升目どおりではない (大きさがばらばら) ので、決まった升目では切らない。透けていない画素の
 * つながり (塊) を探し、cells.json の枠に中心が入る塊だけを集めて切る。枠からはみ出した隣の絵の手足は
 * 拾わず、頭の上の「!?」や「zzz」のような小さな飾りは、枠の中にあれば一緒に入る。
 *
 * 書き出す先は assets/oshi-default/<キャラ>/<形>-<表情>.webp (長い辺 384px まで)。そのあと
 * scripts/build-oshi-default.mjs で .gs に焼く。`states` に使わない絵 (`spare_*`) は枠だけ残し、書き出さない。
 *
 * dwebp / cwebp (libwebp) を使う (macOS なら brew install webp)。
 *
 *   node scripts/cut-oshi-sheet.mjs <キャラ>              # 表情の絵を書き出す
 *   node scripts/cut-oshi-sheet.mjs <キャラ> --detect <形> # 塊を一覧する (cells.json を作るとき)
 *   node scripts/cut-oshi-sheet.mjs <キャラ> --all <出す先> # 予備の絵も含めて全部を出す先に書き出す (見比べるため)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** これより透けている画素は塊に数えない (背景のうっすらした霞を拾わない) */
const ALPHA_MIN = 24;
/** これより小さい塊は捨てる (霞の点) */
const SPECK = 12;
/** 切った絵の周りの余白 (px) */
const PAD = 2;
/** 長い辺の上限 (build-oshi-default.mjs の絵と同じ) */
const LONG_MAX = 384;

/** 一時の場所を作って fn に渡し、終わったら消す */
function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oshi-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** dwebp で RGBA に戻す */
function readWebp(file) {
  const buf = withTmp((dir) => {
    const tmp = path.join(dir, 'sheet.pam');
    execFileSync('dwebp', ['-quiet', file, '-pam', '-o', tmp]);
    return fs.readFileSync(tmp);
  });
  const end = buf.indexOf('ENDHDR\n');
  const head = buf.toString('latin1', 0, end);
  const w = Number(/WIDTH (\d+)/.exec(head)[1]);
  const h = Number(/HEIGHT (\d+)/.exec(head)[1]);
  if (!/DEPTH 4/.test(head)) throw new Error('透明の無い絵です: ' + file);
  return { w, h, px: buf.subarray(end + 7, end + 7 + w * h * 4) };
}

/** RGBA を cwebp で WebP にする */
function writeWebp(img, file) {
  withTmp((dir) => writeWebpIn_(dir, img, file));
}

function writeWebpIn_(dir, img, file) {
  const tmp = path.join(dir, 'cell.pam');
  const head = 'P7\nWIDTH ' + img.w + '\nHEIGHT ' + img.h + '\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n';
  fs.writeFileSync(tmp, Buffer.concat([Buffer.from(head, 'latin1'), img.px]));
  const args = ['-quiet', '-q', '85', '-alpha_q', '100', '-m', '6', '-exact'];
  const long = Math.max(img.w, img.h);
  if (long > LONG_MAX) args.push('-resize', String(Math.round(img.w * LONG_MAX / long)), String(Math.round(img.h * LONG_MAX / long)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('cwebp', args.concat([tmp, '-o', file]));
}

/**
 * 透けていない画素のつながり (8方向) を数える。
 *
 * @returns {{label: Int32Array, comps: Array<{id: number, x0: number, y0: number, x1: number, y1: number, n: number}>}}
 */
export function components(img) {
  const { w, h, px } = img;
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== -1 || px[s * 4 + 3] < ALPHA_MIN) continue;
    const c = { id: comps.length, x0: w, y0: h, x1: -1, y1: -1, n: 0 };
    label[s] = c.id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (label[q] === -1 && px[q * 4 + 3] >= ALPHA_MIN) { label[q] = c.id; stack.push(q); }
      }
    }
    comps.push(c);
  }
  return { label, comps };
}

/** 枠よりこれだけ大きい塊は、隣の絵とくっついたものとみなす */
const MERGED = 1.6;

/**
 * 枠に中心が入る塊だけを切り出す。塊のすぐ外の薄い縁 (1px) は残し、ほかの画素は透明にする。
 * 隣の絵とくっついた大きな塊 (枠の MERGED 倍より大きい) は、切る線 (cut) の中の画素だけを使う。
 *
 * @param {number[]|{box: number[], cut: number[]}} cell 枠 [x, y, 幅, 高さ]。くっついた塊を枠と別の線で
 *   切りたいときは {box, cut} (小さな飾りは box で、くっついた塊は cut で分ける)
 * @returns {{w: number, h: number, px: Buffer}}
 */
export function cutCell(img, found, cell) {
  const box = Array.isArray(cell) ? cell : cell.box;
  const cut = Array.isArray(cell) ? cell : cell.cut;
  const within = (r, x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
  const keep = new Map(); // 塊の番号 → 切る線で切るか
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of found.comps) {
    if (c.n < SPECK) continue;
    const merged = c.x1 - c.x0 + 1 > box[2] * MERGED || c.y1 - c.y0 + 1 > box[3] * MERGED;
    if (merged) {
      if (c.x1 < cut[0] || c.x0 >= cut[0] + cut[2] || c.y1 < cut[1] || c.y0 >= cut[1] + cut[3]) continue;
    } else if (!within(box, (c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2)) continue;
    keep.set(c.id, merged);
    // 見る範囲 (くっついた塊は切る線との重なり)
    x0 = Math.min(x0, merged ? Math.max(c.x0, cut[0]) : c.x0);
    y0 = Math.min(y0, merged ? Math.max(c.y0, cut[1]) : c.y0);
    x1 = Math.max(x1, merged ? Math.min(c.x1, cut[0] + cut[2] - 1) : c.x1);
    y1 = Math.max(y1, merged ? Math.min(c.y1, cut[1] + cut[3] - 1) : c.y1);
  }
  if (!keep.size) throw new Error('枠の中に絵がありません: ' + box.join(','));
  const kept = (x, y) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return false;
    const id = found.label[y * img.w + x];
    return keep.has(id) && (!keep.get(id) || within(cut, x, y));
  };
  // くっついた塊は切る線の中に画素が無い行・列があるので、実際に残る画素で詰め直す
  let tx0 = Infinity, ty0 = Infinity, tx1 = -1, ty1 = -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!kept(x, y)) continue;
    if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
  }
  x0 = Math.max(0, tx0 - PAD); y0 = Math.max(0, ty0 - PAD);
  x1 = Math.min(img.w - 1, tx1 + PAD); y1 = Math.min(img.h - 1, ty1 + PAD);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let ok = kept(x, y);
    // 塊に数えなかった薄い縁は、塊に接しているものだけ残す (なめらかな輪郭のため)
    if (!ok && found.label[y * img.w + x] === -1) {
      for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) ok = kept(x + dx, y + dy);
    }
    if (!ok) continue;
    img.px.copy(out, ((y - y0) * w + (x - x0)) * 4, (y * img.w + x) * 4, (y * img.w + x) * 4 + 4);
  }
  return { w, h, px: out };
}

/** assets/oshi-sheets/<キャラ>/cells.json を読む */
export function sheetMap(char) {
  if (!/^[a-z]+$/.test(char)) throw new Error('名前に使えない key です: ' + char);
  const dir = path.join(ROOT, 'assets', 'oshi-sheets', char);
  return { dir, map: JSON.parse(fs.readFileSync(path.join(dir, 'cells.json'), 'utf8')) };
}

/**
 * 切り出して書き出す。
 *
 * @param {string} char
 * @param {{all?: string, out?: string, only?: string[]}} [opt] all: 予備の絵も含めて全部をこの場所に書く (assets には書かない)。
 *   out: 表情の絵を assets/oshi-default/<キャラ>/ の代わりにこの場所に書く。only: この表情だけ (試すため)
 * @returns {string[]} 書いたファイル
 */
export function cutSheets(char, opt) {
  const { dir, map } = sheetMap(char);
  const written = [];
  for (const style of Object.keys(map.states)) {
    const img = readWebp(path.join(dir, style + '.webp'));
    const found = components(img);
    const cells = map.cells[style];
    const jobs = opt && opt.all
      ? Object.keys(cells).map((name) => [name, path.join(opt.all, style + '-' + name + '.webp')])
      : Object.entries(map.states[style]).filter(([state]) => !(opt && opt.only) || opt.only.includes(state)).map(([state, name]) => {
        if (!cells[name]) throw new Error(style + ' の ' + state + ' に使う絵 ' + name + ' がありません');
        return [name, path.join((opt && opt.out) || path.join(ROOT, 'assets', 'oshi-default', char), style + '-' + state + '.webp')];
      });
    for (const [name, file] of jobs) {
      writeWebp(cutCell(img, found, cells[name]), file);
      written.push(path.relative(ROOT, file));
    }
  }
  return written;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [char, flag, arg] = process.argv.slice(2);
  if (flag === '--detect') {
    const { dir } = sheetMap(char);
    const found = components(readWebp(path.join(dir, arg + '.webp')));
    for (const c of found.comps.filter((x) => x.n >= SPECK).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      process.stdout.write([c.x0, c.y0, c.x1 - c.x0 + 1, c.y1 - c.y0 + 1, c.n].join('\t') + '\n');
    }
  } else {
    for (const f of cutSheets(char, flag === '--all' ? { all: path.resolve(arg) } : undefined)) process.stdout.write(f + '\n');
  }
}
