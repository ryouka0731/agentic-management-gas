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
 * 署名だけを src/KitSigning.gs として持ち込む。秘密鍵は手元から出さない。
 * scripts/deploy.mjs が送る直前に prepareSigning() で書く。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kitSignedText } from '../kit/track/update.mjs';

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
 * src/KitSigning.gs の中身。**秘密鍵は入れない。** 署名と、署名した版・中身の指紋だけ。
 *
 * 番頭はこれを返すだけで、署名を計算しない。だからスクリプトを開ける人が何人いても、
 * 偽の中身に正しい署名を付けることはできない。
 *
 * @param {{version:string, filesSha:string, signature:string}} rec
 * @returns {string}
 */
export function signingSource(rec) {
  return [
    '/**',
    ' * 手元の道具に付ける署名。**scripts/deploy.mjs が作る。記録しない (.gitignore)。**',
    ' *',
    ' * 秘密鍵は入っていない。消したまま送ると、手元の道具は自動で入れ替えなくなる。',
    ' */',
    'function KIT_SIGNATURE_() {',
    '  return ' + JSON.stringify({ version: rec.version, filesSha: rec.filesSha, signature: rec.signature }) + ';',
    '}',
    '',
  ].join('\n');
}

/**
 * src/core/AgentKit.gs の AGENT_KIT_VERSION() が返す字。
 *
 * @param {string} sourceText
 * @returns {string}
 */
export function kitVersionOf(sourceText) {
  const m = /function AGENT_KIT_VERSION\(\)\s*\{\s*return '([^']+)';/.exec(String(sourceText));
  if (!m) throw new Error('AGENT_KIT_VERSION() の版が読めません');
  return m[1];
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
 * 送る前に、渡された中身に署名して src/KitSigning.gs を書く。
 *
 * **鍵が無ければ断る。** そのまま送ると向こうの KitSigning.gs が消え、全員の
 * 自動の入れ替えが黙って止まる。--no-sign (noSign) のときだけ書かずに通す。
 * 公開鍵 (kit/track/kit-key.pem) と組が合わないときも断る。配った道具が
 * 確かめられない署名を付けることになる。
 *
 * @param {{keyPath:string, publicPath:string, outPath:string, noSign?:boolean, version:string,
 *   files:Object<string,string>}} o
 * @returns {{signed:boolean, removed?:boolean}}
 */
export function prepareSigning({ keyPath, publicPath, outPath, noSign = false, version, files }) {
  if (noSign) {
    // 手元に前の KitSigning.gs が残っていると、署名しないつもりで古い鍵を送ってしまう。消してから送る
    if (!fs.existsSync(outPath)) return { signed: false };
    fs.rmSync(outPath, { force: true });
    return { signed: false, removed: true };
  }
  if (!fs.existsSync(keyPath)) {
    const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    const copy = old.includes('PRIVATE KEY')
      ? ' 前に送ったときの ' + outPath + ' に秘密鍵の写しが残っています。失くしたならそこから戻せます。'
      : '';
    throw new Error('署名の秘密鍵がありません (' + keyPath + ')。node scripts/kit-key.mjs で作るか、' +
      '控えを戻してください。' + copy + '署名せずに送るなら --no-sign を付けます (手元の道具は自動で入れ替えなくなります)');
  }
  const priv = fs.readFileSync(keyPath, 'utf8');
  const pub = fs.existsSync(publicPath) ? fs.readFileSync(publicPath, 'utf8') : '';
  if (!keysMatch(priv, pub)) {
    throw new Error('秘密鍵と ' + publicPath + ' の組が合いません。配る道具が署名を確かめられなくなるので送りません');
  }
  const filesSha = crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(kitSignedText(version, files), 'utf8'), priv)
    .toString('base64');
  const next = signingSource({ version, filesSha, signature });
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

/** 直に実行されたか。空白・日本語・シンボリックリンクを含む道のりでも当たるよう、実体の URL で比べる */
function isMain() {
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1] || '')).href ===
      pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href;
  } catch (e) {
    return false;
  }
}

if (isMain()) {
  try {
    main();
  } catch (err) {
    process.stderr.write(String(err.message || err) + '\n');
    process.exitCode = 1;
  }
}
