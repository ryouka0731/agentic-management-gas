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
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');

    // filename は絶対パスで渡す。相対だとカバレッジ計測が元ファイルと
    // 結び付けられず、実行された行が数えられない
    vm.runInContext(src, context, { filename: file });
  }
  if (typeof context.dbRunBegin_ === 'function') wrapRuns(context, relativePaths);
  return context;
}

/**
 * テストから呼んだ1回を、Apps Script の1回の実行として扱う。
 *
 * 実機は呼び出しごとにグローバルを読み直すので、「この実行の中で書いたか」(Db.gs の dbWroteThisRun_) は
 * 呼び出しごとに戻る。node:vm の文脈は呼び出しをまたいで残るので、ソースに書いた関数を包み、
 * 外から (入れ子でなく) 呼ばれたときに dbRunBegin_() を呼ぶ。中から呼ぶ関数も同じ名前で引くので
 * 包んだものを通るが、入れ子の深さで見分ける。
 */
function wrapRuns(context, relativePaths) {
  let depth = 0;
  const begin = context.dbRunBegin_;
  const names = new Set();
  for (const rel of relativePaths) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  }
  names.delete('dbRunBegin_');
  for (const name of names) {
    const orig = context[name];
    if (typeof orig !== 'function') continue;
    context[name] = function () {
      if (depth === 0) begin();
      depth++;
      try {
        return orig.apply(this, arguments);
      } finally {
        depth--;
      }
    };
    // 引数の数と名前は元のまま (fn.length で「画面から渡せる引数」を確かめるテストがある)
    Object.defineProperty(context[name], 'length', { value: orig.length });
    Object.defineProperty(context[name], 'name', { value: orig.name });
  }
}
