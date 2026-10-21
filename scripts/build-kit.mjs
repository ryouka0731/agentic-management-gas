/**
 * 手元から動かす道具を、GAS に持ち込める形に焼き直す。
 *
 * 中身をそのまま GAS の HTML ファイルとして置くと壊れる。`<id>` や
 * `<mainFileId>` がタグと解釈され、`-->` がコメントの終わりと読まれて、
 * 読み出したときには別物になっている。実際に一部のファイルが壊れた。
 *
 * そこで、読み書きするのは kit/ の本物のファイルにしておき、GAS へは
 * base64 に直した文字列として持ち込む。base64 なら何が書いてあっても
 * 解釈されようがない。
 *
 * 書く先は src/ui/kit-files.html (zip の中の名前 → base64 の JSON の字だけ。**手で直さない**)。
 * サーバは AgentKit.gs の KIT_FILES() が HtmlService の getRawContent で読む。スクリプト (.gs) にしないのは、
 * GAS がどの呼び出しでも全部のスクリプトを読み込むから (以前の src/KitFiles.gs は 400KB あり、画面のどの api* も遅くした)。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'kit');
/** 書く先 (src からの相対で、拡張子の無い名前は ui/kit-files) */
export const KIT_OUT = 'src/ui/kit-files.html';
const OUT = path.join(ROOT, KIT_OUT);

/** 配る中身。左が kit/ の名前、右が zip の中の名前 */
export const FILES = [
  ['agent.mjs', 'agent.mjs'],
  ['package.json', 'package.json'],
  ['agentkit.example.json', 'agentkit.example.json'],
  ['README.md', 'README.md'],
  ['AGENTS.md', 'AGENTS.md'],
  // Claude も Codex も、同じ内容を別の名前で読みに行く
  ['AGENTS.md', 'CLAUDE.md'],
  // エージェンティックスクラム (既定はオフ)。ai-scrum-gas から取り入れた
  ['SCRUM.md', 'SCRUM.md'],
  ...walk('.claude'),
  ...walk('scrum-templates'),
  // 番頭に作業を載せるフックとスキル、道具の自動更新 (~/.banto に置かれる)
  ...walk('track'),
];

/**
 * kit/ の下のフォルダを丸ごと拾う。zip の中でも同じ道のりにする。
 *
 * スキルやエージェントを足すたびに一覧を書き足すと、書き忘れたものだけが
 * 配られない。並びは名前順にして、焼き直すたびに同じ中身にする。
 *
 * @param {string} dir kit/ からの道のり
 * @returns {Array<[string, string]>}
 */
function walk(dir) {
  const root = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit'), dir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function visit(rel) {
    const here = path.join(root, rel);
    for (const name of fs.readdirSync(here).sort()) {
      const next = rel ? rel + '/' + name : name;
      if (fs.statSync(path.join(here, name)).isDirectory()) visit(next);
      else out.push([dir + '/' + next, dir + '/' + next]);
    }
  })('');
  return out;
}

/**
 * zip の中の名前 → base64 にした中身。AgentKit.gs の KIT_FILES() と同じ並び。
 *
 * **署名はこの並びの JSON に付く。** 並びを変えると署名が合わなくなる。
 *
 * @returns {Object<string,string>}
 */
export function kitFilesMap() {
  const out = {};
  for (const [from, to] of FILES) {
    if (Object.prototype.hasOwnProperty.call(out, to)) continue;
    out[to] = Buffer.from(fs.readFileSync(path.join(SRC, from), 'utf8'), 'utf8').toString('base64');
  }
  return out;
}

/**
 * 焼き直した中身を返す。
 *
 * @returns {string} src/ui/kit-files.html に書くもの (JSON の字、1行)
 */
export function buildKitSource() {
  return JSON.stringify(kitFilesMap());
}

/**
 * 書き出す。
 *
 * @returns {boolean} 中身が変わったか
 */
export function writeKitSource() {
  const next = buildKitSource();
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';

  if (now === next) return false;

  fs.writeFileSync(OUT, next);
  return true;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const changed = writeKitSource();
  process.stdout.write(
    changed ? KIT_OUT + ' を作り直しました\n' : KIT_OUT + ' は最新です\n'
  );
}
