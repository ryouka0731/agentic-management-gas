/**
 * 版を差し替える。URL は変えない。
 *
 * `clasp create-deployment` を -i なしで叩くと新しいデプロイが作られ、
 * URL が変わる。利用者のブックマークも、配ったリンクも死ぬ。
 * この道具は必ず deployment.json の ID に対して差し替える。
 *
 *   npm run deploy -- "何を変えたか"
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'deployment.json');

/**
 * 差し替える先を読む。
 *
 * @returns {string} デプロイID
 */
function deploymentId() {
  if (!fs.existsSync(CONFIG)) {
    throw new Error(
      'deployment.json がありません。`npx clasp list-deployments` で ID を調べて作ってください'
    );
  }

  const id = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).deploymentId;
  if (!id || !/^AKfycb[\w-]{20,}$/.test(id)) {
    throw new Error('deployment.json の deploymentId が読めません: ' + id);
  }
  return id;
}

/**
 * @param {string[]} args
 */
function clasp(args) {
  execFileSync('npx', ['clasp', ...args], { cwd: ROOT, stdio: 'inherit' });
}

function main() {
  const message = process.argv.slice(2).join(' ').trim();
  if (!message) {
    process.stderr.write('何を変えたかを渡してください: npm run deploy -- "説明"\n');
    process.exitCode = 2;
    return;
  }

  const id = deploymentId();

  // 先に送る。送らずに差し替えると、前の中身のまま版だけが上がる
  clasp(['push', '-f']);
  clasp(['create-deployment', '-i', id, '-d', message]);

  process.stdout.write('\nURL は変わっていません (deploymentId: ' + id + ')\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(String(err.message || err) + '\n');
  process.exitCode = 1;
}
