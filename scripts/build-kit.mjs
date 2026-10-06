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
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'kit');
const OUT = path.join(ROOT, 'src', 'KitFiles.gs');

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
 * 焼き直した中身を返す。
 *
 * @returns {string} src/KitFiles.gs に書くもの
 */
export function buildKitSource() {
  const lines = [
    '/**',
    ' * 手元から動かす道具の中身。**scripts/build-kit.mjs が作る。手で直さない。**',
    ' *',
    ' * 直すのは kit/ にある本物のファイルのほう。base64 にしてあるのは、',
    ' * 中身をそのまま GAS の HTML ファイルとして置くと `<id>` がタグと',
    ' * 解釈され、`-->` がコメントの終わりと読まれて壊れるためである。',
    ' */',
    '',
    '/**',
    ' * zip の中の名前 → base64 にした中身。',
    ' *',
    ' * @returns {Object<string,string>}',
    ' */',
    'function KIT_FILES() {',
    '  return {',
  ];

  const seen = new Set();
  for (const [from, to] of FILES) {
    if (seen.has(to)) continue;
    seen.add(to);

    const text = fs.readFileSync(path.join(SRC, from), 'utf8');
    const b64 = Buffer.from(text, 'utf8').toString('base64');

    lines.push("    '" + to + "': '" + b64 + "',");
  }

  lines.push('  };', '}', '');
  return lines.join('\n');
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
    changed ? 'src/KitFiles.gs を作り直しました\n' : 'src/KitFiles.gs は最新です\n'
  );
}
