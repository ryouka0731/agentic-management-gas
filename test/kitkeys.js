/**
 * 道具の署名を試すための鍵。**本物の鍵は使わない。** テストのたびにその場で作る。
 */
import crypto from 'node:crypto';
import { kitSignedText } from '../kit/track/update.mjs';

/** RSA-2048 の組を作る (GAS が読める PKCS#8 の秘密鍵と、手元が持つ SPKI の公開鍵) */
export function makeKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { priv: privateKey, pub: publicKey };
}

/** 番頭が付けるのと同じ署名を付ける */
export function signKit(version, files, priv) {
  return crypto.sign('RSA-SHA256', Buffer.from(kitSignedText(version, files), 'utf8'), priv).toString('base64');
}

/** 1回だけ作って使い回す (作るのに時間がかかる) */
export const TEST_KEYS = makeKeys();
export const OTHER_KEYS = makeKeys();
