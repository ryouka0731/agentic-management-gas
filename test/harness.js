import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * GASのランタイムファイルを node:vm で評価し、定義されたグローバル関数を返す。
 * ランタイムコードに import/export/require を書かずにテストできる。
 *
 * @param {...string} relativePaths リポジトリルートからの相対パス
 * @returns {object} 評価後のグローバルコンテキスト
 */
export function loadGas(...relativePaths) {
  return loadGasWith({ console }, ...relativePaths);
}

/**
 * loadGas と同じだが、GASのサービスを模したグローバルを注入できる。
 * Commit / Branch / PullRequest のように DriveApp や SpreadsheetApp に
 * 依存するコードを、ローカルで通しで動かすために使う。
 *
 * @param {object} globals vm コンテキストに置くグローバル
 * @param {...string} relativePaths リポジトリルートからの相対パス
 * @returns {object} 評価後のグローバルコンテキスト
 */
export function loadGasWith(globals, ...relativePaths) {
  const context = vm.createContext(globals);
  for (const rel of relativePaths) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(src, context, { filename: rel });
  }
  return context;
}
