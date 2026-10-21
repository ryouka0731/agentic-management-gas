/**
 * 版を差し替える。URL は変えない。
 *
 * `clasp create-deployment` を -i なしで叩くと新しいデプロイが作られ、
 * URL が変わる。利用者のブックマークも、配ったリンクも死ぬ。
 * この道具は必ず deployment.json の ID に対して差し替える。
 *
 *   npm run deploy -- "何を変えたか"
 *   npm run deploy -- --no-sign "何を変えたか"   # 署名の鍵が無いまま送る (自動の入れ替えが止まる)
 */

import { execFileSync } from 'node:child_process';
import { writeKitSource, kitFilesMap, KIT_OUT } from './build-kit.mjs';
import { writeOshiDefaultSources } from './build-oshi-default.mjs';
import { prepareSigning, kitVersionOf, signingKeyPath, PUBLIC_KEY, SIGNING_SOURCE } from './kit-key.mjs';
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
  const args = process.argv.slice(2);
  const noSign = args.includes('--no-sign');
  const message = args.filter((a) => a !== '--no-sign').join(' ').trim();
  if (!message) {
    process.stderr.write('何を変えたかを渡してください: npm run deploy -- "説明"\n');
    process.exitCode = 2;
    return;
  }

  const id = deploymentId();

  // 配る道具は kit/ が本物。焼き直してから送らないと、古い中身が配られる
  if (writeKitSource()) {
    process.stdout.write(KIT_OUT + ' を作り直しました\n');
  }
  // 推しの最初からいるキャラの絵は assets/oshi-default/ が本物。同じく焼き直してから送る
  for (const f of writeOshiDefaultSources()) process.stdout.write(f + ' を作り直しました\n');

  // 中身に手元で署名し、署名だけを src/KitSigning.gs (記録しない) に書く。無いまま送ると向こうの
  // KitSigning.gs が消え、全員の道具が黙って自動で新しくならなくなるので断る
  const version = kitVersionOf(fs.readFileSync(path.join(ROOT, 'src', 'core', 'AgentKit.gs'), 'utf8'));
  const signing = prepareSigning({ keyPath: signingKeyPath(), publicPath: PUBLIC_KEY, outPath: SIGNING_SOURCE,
    noSign, version, files: kitFilesMap() });
  if (!signing.signed) {
    process.stderr.write('署名せずに送ります。手元の道具は自動では入れ替えなくなります' +
      (signing.removed ? ' (src/KitSigning.gs を消しました。向こうの署名も消えます)' : '') + '\n');
  }

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
