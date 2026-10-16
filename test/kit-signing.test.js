import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { TEST_KEYS, OTHER_KEYS, signKit } from './kitkeys.js';
import {
  installFromServer, tickUpdate, checkForUpdate, kitPrintOf, kitSignedText, verifyKit, readConfig, writeConfig, paths,
} from '../kit/track/update.mjs';
import { trackInstall } from '../kit/track/track.mjs';
import {
  signingKeyPath, signingSource, keysMatch, createKeys, prepareSigning,
} from '../scripts/kit-key.mjs';

const NOW = Date.parse('2026-10-15T00:00:00Z');
const DAY = 86400000;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function tree(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  (function visit(rel) {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const next = rel ? rel + '/' + name : name;
      if (fs.statSync(path.join(dir, next)).isDirectory()) visit(next);
      else out[next] = fs.readFileSync(path.join(dir, next), 'utf8');
    }
  })('');
  return out;
}

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banto-sig-'));
  const home = path.join(root, 'banto');
  const claude = path.join(root, 'claude');
  fs.mkdirSync(home);
  fs.mkdirSync(claude);
  return { root, home, claude };
}

/** 欠けると入れない3つと、固定する公開鍵 */
const kit = (agent, pub, more) => ({
  'agent.mjs': b64(agent), 'track/hook.mjs': b64('hook'), 'track/update.mjs': b64('update'),
  ...(pub ? { 'track/kit-key.pem': b64(pub) } : {}), ...(more || {}),
});

/** 向こう側の代わり。priv があれば署名を付ける */
function server(files, version, priv) {
  const print = kitPrintOf(files);
  const signature = priv ? signKit(version, files, priv) : '';
  return async (op) => (op === 'kitFiles'
    ? { ok: true, result: { version, print, files, signature } }
    : { ok: true, result: { version, print } });
}

const quiet = () => {};

/** 公開鍵を固定した道具を入れた状態にする (最初の1回は手で頼んだ扱い) */
async function pinned(d, pub = TEST_KEYS.pub, priv = TEST_KEYS.priv) {
  writeConfig(d.home, { queueDir: '/q' });
  await installFromServer({ home: d.home, claude: d.claude, send: server(kit('v1', pub), '1', priv),
    now: NOW, link: true, manual: true, warn: quiet });
  expect(fs.readFileSync(path.join(d.home, 'kit', 'track', 'kit-key.pem'), 'utf8')).toBe(pub);
}

const agentText = (d) => fs.readFileSync(path.join(d.home, 'kit', 'agent.mjs'), 'utf8');

describe('署名する文', () => {
  it('版と、中身の指紋 (64字) を決まった形で並べる', () => {
    const files = { a: b64('x') };
    const digest = crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
    expect(kitSignedText('1.2.3', files)).toBe('softbanto-kit/1\n1.2.3\n' + digest);
  });

  it('番頭の kitSignedText_ と同じ字になる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, 'src/core/Hash.js', 'src/core/HashGas.gs', 'src/KitFiles.gs', 'src/core/AgentKit.gs');
    const files = ctx.KIT_FILES();
    expect(kitSignedText('9.9.9', files)).toBe(ctx.kitSignedText_('9.9.9', files));
  });
});

describe('署名を確かめる (verifyKit)', () => {
  const files = kit('v2', TEST_KEYS.pub);
  const signature = signKit('2', files, TEST_KEYS.priv);

  it('正しい署名なら通す', () => {
    expect(verifyKit({ version: '2', files, signature }, TEST_KEYS.pub)).toBe(true);
  });

  it('中身・版・鍵・署名のどれかが違えば通さない', () => {
    expect(verifyKit({ version: '2', files: { ...files, 'agent.mjs': b64('evil') }, signature }, TEST_KEYS.pub)).toBe(false);
    expect(verifyKit({ version: '3', files, signature }, TEST_KEYS.pub)).toBe(false);
    expect(verifyKit({ version: '2', files, signature }, OTHER_KEYS.pub)).toBe(false);
    expect(verifyKit({ version: '2', files, signature: 'zz' }, TEST_KEYS.pub)).toBe(false);
    expect(verifyKit({ version: '2', files, signature: '' }, TEST_KEYS.pub)).toBe(false);
    expect(verifyKit({ version: '2', files, signature: undefined }, TEST_KEYS.pub)).toBe(false);
    expect(verifyKit({ version: '2', files, signature }, 'not a key')).toBe(false);
  });
});

describe('自動の入れ替えは、署名が合うときだけ', () => {
  it('偽の返事 (署名なし・別の鍵) は断り、置き場も控えも変えない', async () => {
    const d = dirs();
    await pinned(d);
    const before = tree(d.home);
    for (const priv of [null, OTHER_KEYS.priv]) {
      await expect(installFromServer({ home: d.home, claude: d.claude,
        send: server(kit('evil', TEST_KEYS.pub), '6.6.6', priv), now: NOW + 1000 }))
        .rejects.toThrow('署名');
      expect(tree(d.home)).toEqual(before);
    }
    expect(fs.existsSync(paths(d.home).backup)).toBe(false);
  });

  it('署名を付けたあとで中身を差し替えたものも断る', async () => {
    const d = dirs();
    await pinned(d);
    const files = kit('v2', TEST_KEYS.pub);
    const signature = signKit('2', files, TEST_KEYS.priv);
    const swapped = { ...files, 'agent.mjs': b64('evil') };
    const send = async () => ({ ok: true, result: { version: '2', print: kitPrintOf(swapped), files: swapped, signature } });
    await expect(installFromServer({ home: d.home, claude: d.claude, send, now: NOW + 1000 })).rejects.toThrow('署名');
    expect(agentText(d)).toBe('v1');
  });

  it('正しい署名なら入れ替える', async () => {
    const d = dirs();
    await pinned(d);
    await installFromServer({ home: d.home, claude: d.claude,
      send: server(kit('v2', TEST_KEYS.pub), '2', TEST_KEYS.priv), now: NOW + 1000 });
    expect(agentText(d)).toBe('v2');
  });

  it('待たない確認でも、届いた偽の中身は入れない', async () => {
    const d = dirs();
    await pinned(d);
    const id = 'kit-1-aaaaaa';
    writeConfig(d.home, { pendingUpdate: { op: 'kitFiles', id, at: new Date(NOW).toISOString() } });
    const res = await server(kit('evil', TEST_KEYS.pub), '6.6.6', OTHER_KEYS.priv)('kitFiles');
    const q = { place: () => 'kit-2-bbbbbb', collect: (x) => (x === id ? res : null), drop: () => {} };
    await expect(tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 1000 })).rejects.toThrow('署名');
    expect(agentText(d)).toBe('v1');
    expect(fs.existsSync(paths(d.home).backup)).toBe(false);
  });
});

describe('公開鍵を持たない道具', () => {
  it('自動では入れず、新しい版があることだけ記録する', async () => {
    const d = dirs();
    writeConfig(d.home, { queueDir: '/q' });
    await installFromServer({ home: d.home, claude: d.claude, send: server(kit('v1', null), '1'),
      now: NOW, manual: true, warn: quiet });
    const placed = [];
    const answers = new Map();
    const q = {
      place: (op) => { const id = 'kit-' + (placed.length + 1) + '-x'; placed.push(op); return id; },
      collect: (id) => answers.get(id) || null,
      drop: () => {},
    };
    await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY });
    answers.set('kit-1-x', await server(kit('v2', TEST_KEYS.pub), '2.0.0', TEST_KEYS.priv)('kitVersion'));
    const r = await tickUpdate({ home: d.home, claude: d.claude, ...q, now: NOW + 2 * DAY + 1 });
    expect(r).toMatchObject({ updated: false, available: true, version: '2.0.0' });
    expect(placed).toEqual(['kitVersion']);
    expect(JSON.parse(fs.readFileSync(paths(d.home).log, 'utf8')).available).toBe('2.0.0');
    expect(agentText(d)).toBe('v1');
  });

  it('自動の入れ替えに直に渡されても断る', async () => {
    const d = dirs();
    writeConfig(d.home, { queueDir: '/q' });
    await installFromServer({ home: d.home, claude: d.claude, send: server(kit('v1', null), '1'),
      now: NOW, manual: true, warn: quiet });
    await expect(installFromServer({ home: d.home, claude: d.claude,
      send: server(kit('v2', TEST_KEYS.pub), '2', TEST_KEYS.priv), now: NOW + 1000 })).rejects.toThrow('署名');
    expect(agentText(d)).toBe('v1');
  });

  it('手で頼めば、確かめられないと断ってから入れる (最初の1回)', async () => {
    const d = dirs();
    writeConfig(d.home, { queueDir: '/q' });
    const said = [];
    await installFromServer({ home: d.home, claude: d.claude, send: server(kit('v1', null), '1'),
      now: NOW, manual: true, warn: (s) => said.push(s) });
    const r = await checkForUpdate({ home: d.home, claude: d.claude,
      send: server(kit('v2', TEST_KEYS.pub), '2', TEST_KEYS.priv), now: NOW + 1000, force: true, manual: true,
      warn: (s) => said.push(s) });
    expect(r.updated).toBe(true);
    expect(agentText(d)).toBe('v2');
    expect(said.length).toBe(2);
    expect(said[1]).toContain('署名を確かめられませんでした');
  });

  it('手で頼んでも、公開鍵を持っていれば署名の合わないものは断る', async () => {
    const d = dirs();
    await pinned(d);
    await expect(checkForUpdate({ home: d.home, claude: d.claude,
      send: server(kit('evil', TEST_KEYS.pub), '6', OTHER_KEYS.priv), now: NOW + 1000, force: true, manual: true }))
      .rejects.toThrow('署名');
    expect(agentText(d)).toBe('v1');
  });
});

describe('鍵を替える', () => {
  it('今の鍵で署名した新しい公開鍵は受け入れ、以後はその鍵で確かめる', async () => {
    const d = dirs();
    await pinned(d);
    await installFromServer({ home: d.home, claude: d.claude,
      send: server(kit('v2', OTHER_KEYS.pub), '2', TEST_KEYS.priv), now: NOW + 1000 });
    expect(fs.readFileSync(path.join(d.home, 'kit', 'track', 'kit-key.pem'), 'utf8')).toBe(OTHER_KEYS.pub);
    await installFromServer({ home: d.home, claude: d.claude,
      send: server(kit('v3', OTHER_KEYS.pub), '3', OTHER_KEYS.priv), now: NOW + 2000 });
    expect(agentText(d)).toBe('v3');
  });

  it('新しい鍵だけで署名したものは断る', async () => {
    const d = dirs();
    await pinned(d);
    await expect(installFromServer({ home: d.home, claude: d.claude,
      send: server(kit('v2', OTHER_KEYS.pub), '2', OTHER_KEYS.priv), now: NOW + 1000 })).rejects.toThrow('署名');
    expect(fs.readFileSync(path.join(d.home, 'kit', 'track', 'kit-key.pem'), 'utf8')).toBe(TEST_KEYS.pub);
  });
});

describe('入れるとき (track install)', () => {
  const setup = () => {
    const d = dirs();
    const q = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
    fs.writeFileSync(path.join(d.claude, 'settings.json'), '{}');
    return { ...d, q };
  };

  it('落とした zip の公開鍵が渡されれば、それで確かめる', async () => {
    const d = setup();
    await expect(trackInstall({ home: d.home, claude: d.claude, config: { queueDir: d.q },
      send: server(kit('evil', OTHER_KEYS.pub), '6', OTHER_KEYS.priv), now: NOW, pinnedKey: TEST_KEYS.pub }))
      .rejects.toThrow('署名');
    expect(fs.existsSync(paths(d.home).kit)).toBe(false);

    await trackInstall({ home: d.home, claude: d.claude, config: { queueDir: d.q },
      send: server(kit('v1', TEST_KEYS.pub), '1', TEST_KEYS.priv), now: NOW, pinnedKey: TEST_KEYS.pub });
    expect(agentText(d)).toBe('v1');
  });

  it('公開鍵がどこにも無ければ、確かめられないと断ってから入れる', async () => {
    const d = setup();
    const said = [];
    await trackInstall({ home: d.home, claude: d.claude, config: { queueDir: d.q },
      send: server(kit('v1', TEST_KEYS.pub), '1'), now: NOW, warn: (s) => said.push(s) });
    expect(agentText(d)).toBe('v1');
    expect(said.join('')).toContain('署名を確かめられませんでした');
  });
});

describe('番頭が署名する (kitFiles)', () => {
  const SOURCES = ['src/core/Hash.js', 'src/core/HashGas.gs', 'src/KitFiles.gs', 'src/core/AgentKit.gs'];

  it('秘密鍵が無ければ署名は空', () => {
    const ctx = loadGasWith(createFakeGas(), ...SOURCES);
    expect(ctx.kitSignature_('1', { a: 'b' })).toBe('');
  });

  it('秘密鍵があれば、手元が確かめられる署名を付ける', () => {
    const fake = createFakeGas();
    fake.KIT_SIGNING_KEY_ = () => TEST_KEYS.priv;
    const ctx = loadGasWith(fake, ...SOURCES);
    const files = ctx.KIT_FILES();
    const signature = ctx.kitSignature_('1.8.0', files);
    expect(verifyKit({ version: '1.8.0', files, signature }, TEST_KEYS.pub)).toBe(true);
    expect(verifyKit({ version: '1.8.0', files, signature }, OTHER_KEYS.pub)).toBe(false);
  });
});

describe('署名の鍵の扱い (scripts/kit-key.mjs)', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-key-'));

  it('置き場は BANTO_SIGNING_KEY か ~/.config/softbanto', () => {
    expect(signingKeyPath({ BANTO_SIGNING_KEY: '/x/k.pem' }, '/h')).toBe('/x/k.pem');
    expect(signingKeyPath({}, '/h')).toBe(path.join('/h', '.config', 'softbanto', 'kit-signing-key.pem'));
  });

  it('KitSigning.gs は秘密鍵を返す関数1つで、GAS で読める', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-sig-src-'));
    fs.writeFileSync(path.join(dir, 'KitSigning.gs'), signingSource(TEST_KEYS.priv));
    const ctx = loadGasWith({}, path.relative(process.cwd(), path.join(dir, 'KitSigning.gs')));
    expect(ctx.KIT_SIGNING_KEY_()).toBe(TEST_KEYS.priv);
  });

  it('秘密鍵と公開鍵の組が合うかを見る', () => {
    expect(keysMatch(TEST_KEYS.priv, TEST_KEYS.pub)).toBe(true);
    expect(keysMatch(TEST_KEYS.priv, OTHER_KEYS.pub)).toBe(false);
    expect(keysMatch(TEST_KEYS.priv, '')).toBe(false);
  });

  it('鍵を作り、秘密鍵は本人だけが読める形で置く。あれば --rotate なしに上書きしない', () => {
    const t = tmp();
    const keyPath = path.join(t, 'conf', 'kit-signing-key.pem');
    const publicPath = path.join(t, 'kit-key.pem');
    const r = createKeys({ keyPath, publicPath });
    expect(r.created).toBe(true);
    const priv = fs.readFileSync(keyPath, 'utf8');
    expect(keysMatch(priv, fs.readFileSync(publicPath, 'utf8'))).toBe(true);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(keyPath)).mode & 0o777).toBe(0o700);

    expect(() => createKeys({ keyPath, publicPath })).toThrow('--rotate');
    expect(fs.readFileSync(keyPath, 'utf8')).toBe(priv);

    createKeys({ keyPath, publicPath, rotate: true });
    expect(fs.readFileSync(keyPath, 'utf8')).not.toBe(priv);
  });

  it('送る前に KitSigning.gs を書く。鍵が無い・組が合わなければ断る。--no-sign なら書かずに通す', () => {
    const t = tmp();
    const keyPath = path.join(t, 'k.pem');
    const publicPath = path.join(t, 'kit-key.pem');
    const outPath = path.join(t, 'KitSigning.gs');

    expect(() => prepareSigning({ keyPath, publicPath, outPath })).toThrow('秘密鍵');
    expect(fs.existsSync(outPath)).toBe(false);
    expect(prepareSigning({ keyPath, publicPath, outPath, noSign: true })).toEqual({ signed: false });
    expect(fs.existsSync(outPath)).toBe(false);

    fs.writeFileSync(keyPath, TEST_KEYS.priv);
    fs.writeFileSync(publicPath, OTHER_KEYS.pub);
    expect(() => prepareSigning({ keyPath, publicPath, outPath })).toThrow('合いません');
    expect(fs.existsSync(outPath)).toBe(false);

    fs.writeFileSync(publicPath, TEST_KEYS.pub);
    expect(prepareSigning({ keyPath, publicPath, outPath })).toEqual({ signed: true });
    expect(fs.readFileSync(outPath, 'utf8')).toBe(signingSource(TEST_KEYS.priv));
  });

  it('KitSigning.gs は記録しない', () => {
    const ignore = fs.readFileSync('.gitignore', 'utf8').split('\n').map((s) => s.trim());
    expect(ignore).toContain('src/KitSigning.gs');
  });
});
