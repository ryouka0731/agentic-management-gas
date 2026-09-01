/**
 * 実際のDocから出力された正規化HTMLでラウンドトリップを検証する。
 *
 * 使い方:
 *   node test/roundtrip-check.js <htmlファイルのパス>
 */
import fs from 'node:fs';
import { loadGas } from './harness.js';

const { parseBlocks, serializeBlocks } = loadGas('src/core/Normalize.js');

const target = process.argv[2];
if (!target) {
  console.error('使い方: node test/roundtrip-check.js <htmlファイルのパス>');
  process.exit(2);
}

const html = fs.readFileSync(target, 'utf8');
const again = serializeBlocks(parseBlocks(html));

if (again === html) {
  console.log('ROUND-TRIP OK (' + html.length + ' 文字)');
  process.exit(0);
}

console.error('ROUND-TRIP FAILED');
const a = html.split('\n');
const b = again.split('\n');
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    console.error('行 ' + (i + 1) + ':');
    console.error('  元:  ' + JSON.stringify(a[i]));
    console.error('  復元: ' + JSON.stringify(b[i]));
  }
}
process.exit(1);
