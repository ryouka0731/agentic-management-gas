/**
 * 手元の道具に付ける署名の鍵を作り、送る前に GAS へ持ち込む。
 *
 *   node scripts/kit-key.mjs            # 鍵が無ければ作る
 *   node scripts/kit-key.mjs --rotate   # 作り直す (今の利用者は zip を落とし直すことになる)
 *
 * 秘密鍵は $BANTO_SIGNING_KEY か ~/.config/softbanto/kit-signing-key.pem に置く。
 * **リポジトリにも Drive にも置かない。** Drive のフォルダに書ける人が読めると、
 * 偽の道具に正しい署名を付けられる。公開鍵は kit/track/kit-key.pem に書き、
 * 道具と一緒に配る (手元の道具はこの鍵で確かめる)。
 *
 * GAS へは src/KitSigning.gs (記録しない) として持ち込む。scripts/deploy.mjs が
 * 送る直前に prepareSigning() で書く。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_KEY = path.join(ROOT, 'kit', 'track', 'kit-key.pem');
export const SIGNING_SOURCE = path.join(ROOT, 'src', 'KitSigning.gs');

/**
 * 秘密鍵の置き場。
 *
 * @param {Object<string,string>} env
 * @param {string} home
 * @returns {string}
 */
export function signingKeyPath(env = process.env, home = os.homedir()) {
  return env.BANTO_SIGNING_KEY || path.join(home, '.config', 'softbanto', 'kit-signing-key.pem');
}

/**
 * src/KitSigning.gs の中身。秘密鍵を返す関数1つだけ。
 *
 * @param {string} privatePem
 * @returns {string}
 */
export function signingSource(privatePem) {
  return [
    '/**',
    ' * 手元の道具に署名する秘密鍵。**scripts/deploy.mjs が作る。記録しない (.gitignore)。**',
    ' *',
    ' * 消したまま送ると、手元の道具は自動で入れ替えなくなる。',
    ' */',
    'function KIT_SIGNING_KEY_() {',
    '  return ' + JSON.stringify(privatePem) + ';',
    '}',
    '',
  ].join('\n');
}

/**
 * 秘密鍵と公開鍵が同じ組か。読めないものは「合わない」。
 *
 * @param {string} privatePem
 * @param {string} publicPem
 * @returns {boolean}
 */
export function keysMatch(privatePem, publicPem) {
  try {
    const mine = crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'der' });
    const theirs = crypto.createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
    return Buffer.compare(mine, theirs) === 0;
  } catch (e) {
    return false;
  }
}

/**
 * 鍵の組を作る。秘密鍵は本人だけが読める形で置く。
 *
 * **あれば --rotate なしに上書きしない。** 作り直すと、今の利用者の道具は
 * 新しい署名を確かめられず、自動の入れ替えが止まる (zip を落とし直してもらう)。
 *
 * @param {{keyPath:string, publicPath:string, rotate?:boolean}} o
 * @returns {{created:boolean, keyPath:string}}
 */
export function createKeys({ keyPath, publicPath, rotate = false }) {
  if (fs.existsSync(keyPath) && !rotate) {
    throw new Error('秘密鍵はもうあります (' + keyPath + ')。作り直すときは --rotate を付けてください');
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const dir = path.dirname(keyPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  fs.writeFileSync(publicPath, publicKey);
  return { created: true, keyPath };
}

/**
 * 送る前に src/KitSigning.gs を書く。
 *
 * **鍵が無ければ断る。** そのまま送ると向こうの KitSigning.gs が消え、全員の
 * 自動の入れ替えが黙って止まる。--no-sign (noSign) のときだけ書かずに通す。
 * 公開鍵 (kit/track/kit-key.pem) と組が合わないときも断る。配った道具が
 * 確かめられない署名を付けることになる。
 *
 * @param {{keyPath:string, publicPath:string, outPath:string, noSign?:boolean}} o
 * @returns {{signed:boolean}}
 */
export function prepareSigning({ keyPath, publicPath, outPath, noSign = false }) {
  if (noSign) return { signed: false };
  if (!fs.existsSync(keyPath)) {
    throw new Error('署名の秘密鍵がありません (' + keyPath + ')。node scripts/kit-key.mjs で作るか、' +
      '控えを戻してください。署名せずに送るなら --no-sign を付けます (手元の道具は自動で入れ替えなくなります)');
  }
  const priv = fs.readFileSync(keyPath, 'utf8');
  const pub = fs.existsSync(publicPath) ? fs.readFileSync(publicPath, 'utf8') : '';
  if (!keysMatch(priv, pub)) {
    throw new Error('秘密鍵と ' + publicPath + ' の組が合いません。配る道具が署名を確かめられなくなるので送りません');
  }
  const next = signingSource(priv);
  const now = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (now !== next) fs.writeFileSync(outPath, next, { mode: 0o600 });
  return { signed: true };
}

function main() {
  const rotate = process.argv.includes('--rotate');
  const keyPath = signingKeyPath();
  createKeys({ keyPath, publicPath: PUBLIC_KEY, rotate });
  process.stdout.write([
    '署名の鍵を作りました。',
    '  秘密鍵: ' + keyPath + ' (本人だけが読める形。**必ず控えを取ってください**)',
    '  公開鍵: ' + PUBLIC_KEY + ' (道具と一緒に配ります。記録してください)',
    '秘密鍵を失うと、利用者は zip を落とし直すまで自動で新しくなりません。',
    '',
  ].join('\n'));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  try {
    main();
  } catch (err) {
    process.stderr.write(String(err.message || err) + '\n');
    process.exitCode = 1;
  }
}
