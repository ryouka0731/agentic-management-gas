# 共有ドライブ対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 番頭をスクリプトごと共有ドライブに置いても動くようにする。あわせて、署名の秘密鍵を番頭から出す。

**Architecture:** 署名は deploy が手元で作り、番頭は記録した署名を返すだけにする。共有ドライブかどうかは `repoDriveId_()` 1か所で決める。持ち主と管理者は Drive 拡張サービス (v3) の `Permissions.list` で読む。マイドライブでの振る舞いは変えない。Drive の操作は `moveTo` に寄せる。投稿者の権限で断られる操作には、何が要るかを添える。トリガーを誰が持っているかは設定の画面に出す。

**Tech Stack:** Google Apps Script (V8)、Drive 拡張サービス v3、Node 20+ (scripts)、vitest と疑似GAS (`test/fakegas.js`)、jsdom (`test/component.test.js`)。

**Spec:** `docs/superpowers/specs/2026-10-19-shared-drive-design.md`

## Global Constraints

- **ランタイムコード (`src/`) に `import` / `export` / `require` を書かない** (GAS で動かなくなる)
- **マイドライブで今動いているものの振る舞いは、①の署名を除いて変えない**
- **共有ドライブでの持ち主は `organizer` 全員。** 管理者は `organizer` / `fileOrganizer` / `writer`。**`type === 'group'` は数えない**
- **役割が読めないときは投げずに `[]`** (誰も持ち主ではない・管理者ではない)
- **報告から作るやることの担当:** 持ち主が1人ならその人、複数なら空
- **新しい関数は既存のファイルに置く** (`Repo.gs` / `AgentKit.gs` / `CommandQueue.gs`)。新しい `.gs` を足すと、23本あるテストの `SOURCES` を全部そろえることになる (CLAUDE.md「GAS は全ファイルを同じグローバルに読む」)
- **UI は `textContent` だけで組む。CSS は既存のトークンだけ使う**
- **CLAUDE.md の該当の節も同じコミットで直す** (片方だけ直すと食い違う)
- **直したら、直す前に戻して落ちることを確かめる** (CLAUDE.md)
- コミットの末尾:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0162CCMSAxuy4KXGZSQ8NNe8
  ```
- テストを走らせるのは `npx vitest run <ファイル>`、全体は `npm test`

## Review Focus

1. **共有ドライブではない入れ物に、Drive 拡張サービスがある**: `driveId` は `''` と覚え、2回目からは問い合わせない。マイドライブの振る舞いのまま → Task 3 のテスト「マイドライブなら今のまま、2回目は問い合わせない」
2. **`Permissions.list` が投げる** (メンバーでない・拡張サービスの障害): 持ち主も管理者も `[]`。画面は落ちない。失敗はキャッシュしない → Task 3 のテスト「役割が読めなければ誰も持ち主ではない。失敗は覚えない」
3. **メンバーが100人を超える** (`nextPageToken` が付く): 全頁を読む → Task 3 のテスト「全頁を読む」
4. **バージョンを上げたのに署名を作り直さずに送った**: `kitSignature_` は `''` を返す (配った道具は入れ替えず、知らせるだけ) → Task 1 のテスト「版が違えば空」
5. **既にある設定に `driveId` が無い** (今動いている番頭): 最初に読んだときに埋める。拡張サービスが無ければ覚えない (あとで足されたときに読み直せるように) → Task 3 のテスト「拡張サービスが無ければ覚えない」

---

### Task 1: 署名の鍵を番頭から出す

**Files:**
- Modify: `scripts/build-kit.mjs` (`kitFilesMap()` を出す)
- Modify: `scripts/kit-key.mjs` (`signingSource` / `prepareSigning` / `kitVersionOf`)
- Modify: `scripts/deploy.mjs`
- Modify: `src/core/AgentKit.gs` (`kitSignature_` とその説明)
- Modify: `test/kit-signing.test.js`
- Modify: `CLAUDE.md` (「手元から動かす道具は GAS の中に置く」の「道具の署名」「秘密鍵を読めるのは…」の2項目)

**Interfaces:**
- Produces: `kitFilesMap(): Object<string,string>` (build-kit.mjs。`KIT_FILES()` と同じ並び・同じ中身)
- Produces: `kitVersionOf(sourceText: string): string` (kit-key.mjs。`AGENT_KIT_VERSION()` の字。読めなければ投げる)
- Produces: `signingSource({version, filesSha, signature}): string` (kit-key.mjs。`function KIT_SIGNATURE_()` を1つ持つ GAS のソース)
- Produces: `prepareSigning({keyPath, publicPath, outPath, noSign, version, files}): {signed:boolean, removed?:boolean}`
- Produces (GAS): `KIT_SIGNATURE_(): {version:string, filesSha:string, signature:string}`。`kitSignature_(version, files): string` (今と同じ形)

- [ ] **Step 1: 落ちるテストを書く**

`test/kit-signing.test.js` の `describe('番頭が署名する (kitFiles)', …)` の中身を置き換える:

```js
describe('番頭が署名する (kitFiles)', () => {
  const SOURCES = ['src/core/Hash.js', 'src/core/HashGas.gs', 'src/KitFiles.gs', 'src/core/AgentKit.gs'];
  const sha = (files) => crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');

  /** deploy が書くのと同じ記録を持たせる */
  function withRecord(fake, ctxFiles, version) {
    fake.KIT_SIGNATURE_ = () => ({
      version, filesSha: sha(ctxFiles), signature: signKit(version, ctxFiles, TEST_KEYS.priv),
    });
  }

  it('記録が無ければ署名は空', () => {
    const ctx = loadGasWith(createFakeGas(), ...SOURCES);
    expect(ctx.kitSignature_('1', { a: 'b' })).toBe('');
  });

  it('記録した署名を返し、手元はそれを確かめられる', () => {
    const fake = createFakeGas();
    const files = loadGasWith(createFakeGas(), ...SOURCES).KIT_FILES();
    withRecord(fake, files, '1.8.0');
    const ctx = loadGasWith(fake, ...SOURCES);
    const signature = ctx.kitSignature_('1.8.0', ctx.KIT_FILES());
    expect(verifyKit({ version: '1.8.0', files, signature }, TEST_KEYS.pub)).toBe(true);
  });

  it('中身が1字違えば空', () => {
    const fake = createFakeGas();
    const files = { 'agent.mjs': b64('v1') };
    withRecord(fake, files, '1.8.0');
    const ctx = loadGasWith(fake, ...SOURCES);
    expect(ctx.kitSignature_('1.8.0', { 'agent.mjs': b64('v2') })).toBe('');
  });

  it('版が違えば空 (版を上げて署名を作り直さずに送ったとき)', () => {
    const fake = createFakeGas();
    const files = { 'agent.mjs': b64('v1') };
    withRecord(fake, files, '1.8.0');
    const ctx = loadGasWith(fake, ...SOURCES);
    expect(ctx.kitSignature_('1.9.0', files)).toBe('');
  });

  it('番頭は秘密鍵を持たない', () => {
    const src = fs.readFileSync('src/core/AgentKit.gs', 'utf8');
    expect(src).not.toMatch(/KIT_SIGNING_KEY_|computeRsaSha256Signature/);
  });
});
```

`describe('署名の鍵の扱い (scripts/kit-key.mjs)', …)` のうち、`KitSigning.gs は秘密鍵を返す関数1つで…` と `prepareSigning` を使う it を置き換える。`prepareSigning` を呼ぶ既存の it はすべて `version` と `files` を渡す形にする。

```js
  it('KitSigning.gs は署名の記録を返す関数1つで、秘密鍵を含まない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-sig-src-'));
    const rec = { version: '1.8.0', filesSha: 'ab'.repeat(32), signature: 'c2ln' };
    fs.writeFileSync(path.join(dir, 'KitSigning.gs'), signingSource(rec));
    const ctx = loadGasWith({}, path.relative(process.cwd(), path.join(dir, 'KitSigning.gs')));
    expect(ctx.KIT_SIGNATURE_()).toEqual(rec);
    expect(signingSource(rec)).not.toContain('PRIVATE KEY');
  });

  it('prepareSigning は渡された中身に署名し、公開鍵で確かめられる記録を書く', () => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-key-'));
    const keyPath = path.join(t, 'k.pem');
    const publicPath = path.join(t, 'kit-key.pem');
    const outPath = path.join(t, 'KitSigning.gs');
    fs.writeFileSync(keyPath, TEST_KEYS.priv);
    fs.writeFileSync(publicPath, TEST_KEYS.pub);
    const files = { 'agent.mjs': b64('v1') };
    expect(prepareSigning({ keyPath, publicPath, outPath, version: '1.8.0', files })).toEqual({ signed: true });
    const rec = loadGasWith({}, path.relative(process.cwd(), outPath)).KIT_SIGNATURE_();
    expect(rec.version).toBe('1.8.0');
    expect(verifyKit({ version: '1.8.0', files, signature: rec.signature }, TEST_KEYS.pub)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf8')).not.toContain('PRIVATE KEY');
  });

  it('版を AgentKit.gs から読む。読めなければ投げる', () => {
    expect(kitVersionOf("function AGENT_KIT_VERSION() {\n  return '1.8.0';\n}")).toBe('1.8.0');
    expect(() => kitVersionOf('function x() {}')).toThrow('AGENT_KIT_VERSION');
  });

  it('kitFilesMap は KIT_FILES() と同じ並び・同じ中身', () => {
    const ctx = loadGasWith(createFakeGas(), 'src/KitFiles.gs');
    expect(JSON.stringify(kitFilesMap())).toBe(JSON.stringify(ctx.KIT_FILES()));
  });
```

import に `kitVersionOf` (`../scripts/kit-key.mjs`) と `kitFilesMap` (`../scripts/build-kit.mjs`) を足す。`署名の手直し` の中にある `番頭で署名に失敗しても、kitFiles は空の署名で中身を返す` は消す (署名の計算が番頭から無くなるため)。`--no-sign は手元の KitSigning.gs を消してから送る…` の it は、`signingSource(TEST_KEYS.priv)` の代わりに `signingSource({ version: '1', filesSha: '', signature: '' })` を置く。鍵が無いときの断りの言葉は、次の Step 3 の文に合わせて `toThrow('秘密鍵')` で見る。

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run test/kit-signing.test.js`
Expected: FAIL (`kitVersionOf` / `kitFilesMap` が無い、`KIT_SIGNATURE_` が無い)

- [ ] **Step 3: 作る**

`scripts/build-kit.mjs`。`buildKitSource()` の中で組んでいる「名前 → base64」を関数に出し、`buildKitSource()` もそれを使う:

```js
/**
 * zip の中の名前 → base64 にした中身。src/KitFiles.gs の KIT_FILES() と同じ並び。
 *
 * **署名はこの並びの JSON に付く。** 並びを変えると署名が合わなくなる。
 *
 * @returns {Object<string,string>}
 */
export function kitFilesMap() {
  const out = {};
  for (const [from, to] of FILES) {
    if (Object.prototype.hasOwnProperty.call(out, to)) continue;
    out[to] = Buffer.from(fs.readFileSync(path.join(SRC, from), 'utf8'), 'utf8').toString('base64');
  }
  return out;
}
```

`buildKitSource()` の `for (const [from, to] of FILES)` の繰り返しは、`for (const [to, b64] of Object.entries(kitFilesMap())) lines.push("    '" + to + "': '" + b64 + "',");` に置き換える。焼いた中身は変わらないこと (`test/agentkit.test.js` が見ている)。

`scripts/kit-key.mjs`:

```js
import { kitSignedText } from '../kit/track/update.mjs';

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
```

`prepareSigning` は `{ keyPath, publicPath, outPath, noSign = false, version, files }` を受ける。`noSign` の扱いは今のまま。鍵が無いときの文は次にする (写しの案内は、出力に `PRIVATE KEY` が含まれるときだけ足す。今の手元の KitSigning.gs には古い形の鍵が残っているため):

```js
  if (!fs.existsSync(keyPath)) {
    const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    const copy = old.includes('PRIVATE KEY')
      ? ' 前に送ったときの ' + outPath + ' に秘密鍵の写しが残っています。失くしたならそこから戻せます。'
      : '';
    throw new Error('署名の秘密鍵がありません (' + keyPath + ')。node scripts/kit-key.mjs で作るか、' +
      '控えを戻してください。' + copy + '署名せずに送るなら --no-sign を付けます (手元の道具は自動で入れ替えなくなります)');
  }
```

組が合うかを確かめたあと:

```js
  const filesSha = crypto.createHash('sha256').update(JSON.stringify(files), 'utf8').digest('hex');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(kitSignedText(version, files), 'utf8'), priv)
    .toString('base64');
  const next = signingSource({ version, filesSha, signature });
  const now = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (now !== next) fs.writeFileSync(outPath, next, { mode: 0o600 });
  return { signed: true };
```

ファイル冒頭の説明 (「GAS へは src/KitSigning.gs (記録しない) として持ち込む」) を「署名だけを src/KitSigning.gs として持ち込む。秘密鍵は手元から出さない」に直す。

`scripts/deploy.mjs`: `import { writeKitSource, kitFilesMap } from './build-kit.mjs';` と `kitVersionOf` を import し、`prepareSigning` の呼び出しを次にする:

```js
  const version = kitVersionOf(fs.readFileSync(path.join(ROOT, 'src', 'core', 'AgentKit.gs'), 'utf8'));
  const signing = prepareSigning({ keyPath: signingKeyPath(), publicPath: PUBLIC_KEY, outPath: SIGNING_SOURCE,
    noSign, version, files: kitFilesMap() });
```

コメント「署名の秘密鍵を src/KitSigning.gs (記録しない) に書く」は「中身に手元で署名し、署名だけを src/KitSigning.gs (記録しない) に書く」に直す。`--no-sign` の知らせの「向こうの鍵も消えます」は「向こうの署名も消えます」に直す。

`src/core/AgentKit.gs` の `kitSignature_` とその説明を置き換える:

```js
/**
 * 配る中身の署名を返す。
 *
 * **番頭は署名を計算しない。** 秘密鍵は deploy する人の手元にだけあり、scripts/deploy.mjs が
 * 送る直前に署名して src/KitSigning.gs (KIT_SIGNATURE_。記録しない) に書く。スクリプトを開ける人
 * (共有ドライブならメンバー全員) が KIT_FILES を書き換えても、署名は合わない。
 *
 * 記録した版と中身の指紋が、いまの版と中身に**両方**合うときだけ返す。合わなければ空
 * (版を上げて署名し直さずに送ったとき)。手元の道具は、空の署名を自動では入れない。
 * 指紋は64字で比べる (kitPrint_ の8字では短すぎる)。
 *
 * @param {string} version
 * @param {Object<string,string>} files
 * @returns {string} base64
 */
function kitSignature_(version, files) {
  if (typeof KIT_SIGNATURE_ !== 'function') return '';
  var rec = KIT_SIGNATURE_() || {};
  if (String(rec.version) !== String(version)) return '';
  if (String(rec.filesSha) !== sha256Hex(JSON.stringify(files))) return '';
  return String(rec.signature || '');
}
```

`CLAUDE.md` の「**道具の署名** (`kitSignature_` / `verifyKit`)」の項目を次に置き換える:

```
- **道具の署名** (`kitSignature_` / `verifyKit`)。秘密鍵は `$BANTO_SIGNING_KEY` か
  `~/.config/softbanto/kit-signing-key.pem` にだけ置き、**リポジトリにも Drive にも番頭にも置かない**。
  `npm run deploy` が送る直前に手元で中身に署名し、**署名と、署名した版・中身の指紋だけ**を
  `src/KitSigning.gs` (`KIT_SIGNATURE_`。記録しない) に書く。番頭は記録が今の版と中身に合うときだけ返す
  (版を上げて送り直さなければ空になり、手元の道具は知らせるだけになる)。
  作るのは `node scripts/kit-key.mjs` (公開鍵は `kit/track/kit-key.pem`)。
  **鍵が無いと deploy は断る。** 承知で送るなら `--no-sign`。公開鍵と組が合わないときも断る。
  **秘密鍵を失うと**、利用者は zip を落とし直すまで自動で新しくならない。作り直しは `--rotate`。
  確かめる鍵は必ず今入っている道具のもの (最初は落とした zip のもの)。届いた中身の鍵では確かめない
- **信頼の起点は「秘密鍵を持つ人 (deploy する人)」。** スクリプトを開ける人が `KIT_FILES` を書き換えても
  署名は合わない。以前 (1.8.0 を配った @151 まで) は番頭が秘密鍵を持って署名していたので、**それより前の
  版のスクリプトには秘密鍵が残っている**。スクリプトを他の人と共有する前に `--rotate` を検討する
```

「**秘密鍵を読めるのは「スクリプトを開ける人」全員である。**」で始まる項目は消す。「**番頭で署名に失敗しても `kitFiles` は落とさない**」の項目は「**記録が無い・合わないときも `kitFiles` は落とさない** (`kitSignature_` は空を返す)」に直す。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run test/kit-signing.test.js test/agentkit.test.js test/kit-update.test.js`
Expected: PASS

確かめ: `kitSignature_` の `filesSha` の比較を消すと「中身が1字違えば空」が落ちること。戻す。

- [ ] **Step 5: 全体を通す**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/build-kit.mjs scripts/kit-key.mjs scripts/deploy.mjs src/core/AgentKit.gs test/kit-signing.test.js CLAUDE.md
git commit -m "feat: 道具の署名を deploy で作り、番頭に秘密鍵を置かない"
```

---

### Task 2: 共有ドライブで使えない Drive の操作を置き換える

**Files:**
- Modify: `test/fakegas.js` (`moveTo`、共有ドライブの印、ゴミ箱と共有の拒否)
- Modify: `src/core/CommandQueue.gs` (`commandRetire_`)
- Modify: `src/core/Repo.gs` (`repoInit` の台帳、`driveTrash_` を足す)
- Modify: `src/Main.gs` (検証用 Doc の取り込み2か所)
- Modify: `src/core/AgentKit.gs` (`setSharing` と古い zip の片付け)
- Modify: `src/core/Branch.gs` (改訂版を捨てる)
- Create: `test/shared-drive.test.js`
- Modify: `CLAUDE.md` (落とし穴の「`addFile` と `removeFile` は両方呼ぶ」)

**Interfaces:**
- Produces (fakegas): `folder._markShared(driveId: string)`。その下に作るフォルダ・ファイルは同じ `_driveId` を持ち、持ち主は無い (`getOwner()` が null)。`_driveId` を持つフォルダへの `addFile` は `Error('Cannot add a file to multiple parents in a shared drive')` を投げる。`file.moveTo(folder)` / `folder.moveTo(folder)` は親を移す。`fake._denyTrash(true)` で、以後 `setTrashed` が `Error('Insufficient permissions for this file')` を投げる。`fake._denySharing(true)` で、以後 `setSharing` が `Error('Sharing outside the shared drive is not allowed')` を投げる
- Produces (GAS): `driveTrash_(item): boolean`。消せたら true。断られたとき、共有ドライブ (`repoDriveIdOrEmpty_()` が空でない) なら言葉を添えて投げ、マイドライブなら記録して false
- Produces (GAS): `repoDriveIdOrEmpty_(): string`。Task 2 では `repoConfig().driveId` の字をそのまま返す (無ければ `''`、設定が読めなければ `''`)。Task 3 で `repoDriveId_()` に差し替える

- [ ] **Step 1: 疑似GASを実機に近づける**

`test/fakegas.js` の `makeFile` に足す:

```js
      _driveId: parentId && folders.has(parentId) ? folders.get(parentId)._driveId : '',
      moveTo: (folder) => { f._parent = folder.getId(); f._driveId = folder._driveId; return f; },
```

`_owner: activeUser` は `_owner: (parentId && folders.has(parentId) && folders.get(parentId)._driveId) ? '' : activeUser` にする (共有ドライブのファイルは持ち主を持たない)。`setTrashed` は `if (trashDenied) throw new Error('Insufficient permissions for this file');` を先頭に足す。`setSharing` は `if (sharingDenied) throw new Error('Sharing outside the shared drive is not allowed'); return f;` にする。

`makeFolder` に足す:

```js
      _driveId: parentId && folders.has(parentId) ? folders.get(parentId)._driveId : '',
      _markShared: (driveId) => { fo._driveId = driveId; fo._owner = ''; return fo; },
      moveTo: (folder) => { fo._parent = folder.getId(); fo._driveId = folder._driveId; return fo; },
```

`makeFolder` の `_owner` は親が共有ドライブなら `''`。`getOwner` は `() => (fo._owner ? { getEmail: () => fo._owner } : null)` にする。`setTrashed` に `trashDenied` を同じく足す。`addFile` を次にする (今の「親を移す」は、マイドライブで両方呼ぶ書き方を通すために残す):

```js
      // 実機の共有ドライブでは、ファイルは親を1つしか持てない。マイドライブの addFile は
      // 親を増やすが、この疑似GASは移す (removeFile は空実装)。片方だけ呼ぶ書き方は通ってしまう
      addFile: (f) => {
        if (fo._driveId) throw new Error('Cannot add a file to multiple parents in a shared drive');
        f._parent = id;
      },
```

`createFakeGas` の先頭に `let trashDenied = false; let sharingDenied = false;` を置き、返り値に `_denyTrash: (on) => { trashDenied = !!on; }` と `_denySharing: (on) => { sharingDenied = !!on; }` を足す。

`SpreadsheetApp.create` と `DocumentApp.create` の疑似は、今どおりマイドライブの直下 (`rootFolder`) に作る (実機と同じ)。

- [ ] **Step 2: 落ちるテストを書く**

`test/shared-drive.test.js` を作る:

```js
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 共有ドライブに置いたとき。ファイルは親を1つしか持てず、持ち主が無く、
 * 投稿者はゴミ箱へ移せない。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]);
})();

/** スクリプトを共有ドライブに置き、そこに入れ物を作る */
function setupShared() {
  const fake = createFakeGas();
  const drive = fake.DriveApp.createFolder('共有ドライブ')._markShared('drive-1');
  fake._placeScript(drive);
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake, drive };
}

describe('共有ドライブで入れ物を作る', () => {
  it('台帳を .git の下へ移せる (addFile を使わない)', () => {
    const { ctx, fake } = setupShared();
    const db = fake.DriveApp.getFileById(ctx.repoConfig().dbId);
    expect(db.getParents().next().getId()).toBe(ctx.repoConfig().gitId);
  });
});

describe('共有ドライブのコマンドキュー', () => {
  it('命令を処理済みへ移して結果を書く', () => {
    const { ctx } = setupShared();
    const queue = ctx.commandQueueFolder_();
    queue.createFile('t1.cmd.json', JSON.stringify({ op: 'fileList', args: {} }), 'text/plain');
    ctx.processCommandQueue();
    expect(queue.getFilesByName('t1.result.json').hasNext()).toBe(true);
    expect(queue.getFilesByName('t1.cmd.json').hasNext()).toBe(false);
    expect(ctx.commandDoneFolder_().getFilesByName('t1.cmd.json').hasNext()).toBe(true);
  });
});

describe('共有ドライブで消す', () => {
  it('投稿者が改訂版を捨てようとすると、要る役割を添えて断る。改訂版は残す', () => {
    const { ctx, fake } = setupShared();
    // 改訂版を1つ作る (文書を登録して記録し、改訂版を切る)
    const fileId = fake._createDoc('規程', '<p>a</p>', ctx.repoConfig().mainId);
    ctx.repoRegisterFile(fileId, '規程.doc');
    ctx.commitFile(fileId, 'main', '最初', null);
    ctx.branchCreate('見直し', fileId);
    fake._denyTrash(true);
    expect(() => ctx.branchDelete('見直し')).toThrow('コンテンツ管理者');
    expect(ctx.dbFindOne('branches', 'name', '見直し').state).toBe('open');
  });

  it('マイドライブでは今までどおり、消せなくても改訂版を閉じる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    const fileId = fake._createDoc('規程', '<p>a</p>', ctx.repoConfig().mainId);
    ctx.repoRegisterFile(fileId, '規程.doc');
    ctx.commitFile(fileId, 'main', '最初', null);
    ctx.branchCreate('見直し', fileId);
    fake._denyTrash(true);
    ctx.branchDelete('見直し');
    expect(ctx.dbFindOne('branches', 'name', '見直し').state).toBe('deleted');
  });
});

describe('共有ドライブで道具の zip を作る', () => {
  it('外への共有を断られても zip は作る', () => {
    const { ctx, fake } = setupShared();
    fake._denySharing(true);
    expect(ctx.agentKitBuild_().getName()).toMatch(/-agent-kit-.*\.zip$/);
  });
});
```

`branchCreate` / `branchDelete` / `repoRegisterFile` / `fileList` の名前と引数は、書く前に `grep -n "^function branchCreate\|^function branchDelete\|^function repoRegisterFile" src/core/*.gs` と `COMMAND_OPS` で確かめ、違えば実際の名前に合わせる (改訂版を捨てる関数は `src/core/Branch.gs` の `dbUpdate('branches', 'name', name, { state: 'deleted' })` を含む関数)。`_createDoc` の後に `getParents` が `mainId` を返すこと。

`agentKitBuild_()` は `Utilities.zip` と `Utilities.newBlob` を使う。疑似GASに無ければ、このテストは `fake.Utilities.zip = (blobs, name) => ({ getName: () => name, getBytes: () => [], getContentType: () => 'application/zip' }); fake.Utilities.newBlob = (b, t, n) => ({ getName: () => n });` を `loadGasWith` の前に足す。

- [ ] **Step 3: 落ちることを確かめる**

Run: `npx vitest run test/shared-drive.test.js`
Expected: FAIL (`addFile` が共有ドライブで投げる、`コンテンツ管理者` の言葉が無い、`setSharing` が投げる)

- [ ] **Step 4: 作る**

`src/core/CommandQueue.gs` の `commandRetire_` を置き換え、説明も直す:

```js
/**
 * 命令を queue から引き上げる。
 *
 * **`moveTo` で移す。** 共有ドライブのファイルは親を1つしか持てず、`addFile` は例外になる。
 * 以前の `addFile` + `removeFile` の組は、マイドライブでしか動かなかった。
 *
 * 実行した命令も、戻ってきた命令も、同じ道で片付ける。片方だけ別扱いに
 * すると、片方が queue に残って毎回の起動で見に来ることになる。
 *
 * @param {GoogleAppsScript.Drive.File} file
 * @param {GoogleAppsScript.Drive.Folder} queue
 * @param {GoogleAppsScript.Drive.Folder} done
 */
function commandRetire_(file, queue, done) {
  file.moveTo(done);
}
```

`src/core/Repo.gs` の `repoInit`。`git.addFile(dbFile); DriveApp.getRootFolder().removeFile(dbFile);` を `dbFile.moveTo(git);` にする。

`src/Main.gs` の2か所 (`DriveApp.getFolderById(repoConfig().mainId).addFile(file);` の直後に `DriveApp.getRootFolder().removeFile(file);` が続くところ) を `file.moveTo(DriveApp.getFolderById(repoConfig().mainId));` にする。

`src/core/Repo.gs` に足す (`repoParentFolder_` の後):

```js
/**
 * 入れ物が置かれている共有ドライブの id。マイドライブなら空。
 *
 * Task 3 で repoDriveId_() に置き換える。それまでは設定に書かれた字だけを見る。
 *
 * @returns {string}
 */
function repoDriveIdOrEmpty_() {
  try {
    return String(repoConfig().driveId || '');
  } catch (e) {
    return '';
  }
}

/**
 * ゴミ箱へ移す。
 *
 * **共有ドライブでは、投稿者の役割では消せない。** 黙って続けると、捨てたはずの改訂版が
 * 残り続ける。何が要るかを添えて投げる。マイドライブでは今までどおり記録して続ける
 * (持ち主でない編集者は他人のファイルを消せないが、それで止めたことはない)。
 *
 * @param {GoogleAppsScript.Drive.File|GoogleAppsScript.Drive.Folder} item
 * @returns {boolean} 消せたら true
 */
function driveTrash_(item) {
  try {
    item.setTrashed(true);
    return true;
  } catch (e) {
    if (repoDriveIdOrEmpty_()) {
      throw new Error('ゴミ箱へ移せませんでした。共有ドライブで消すには「コンテンツ管理者」以上の' +
        '役割が要ります (' + e.message + ')');
    }
    Logger.log('ゴミ箱へ移せませんでした: ' + e.message);
    return false;
  }
}
```

疑似GASで共有ドライブの入れ物を作ったときに `driveId` が設定に入るよう、`repoInit` の `config` に `driveId: repoParentFolder_()._driveId || ''` とは**書かない** (実機に `_driveId` は無い)。Task 2 のテストでは、`setupShared()` の `ctx.repoInit(...)` の直後に次を足して設定に入れる (Task 3 で `repoInit` が自分で入れるようになったら消す):

```js
  const cfg = ctx.repoConfig();
  cfg.driveId = 'drive-1';
  fake.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(), JSON.stringify(cfg));
```

`src/core/Branch.gs` の改訂版を捨てる関数。作業コピーを1つずつ消す繰り返しと作業フォルダを消す try を、次の順にする (**フォルダを先に**。共有ドライブで断られたら、何も消さずに止まる。役割はドライブ全体で同じなので、フォルダが消せればファイルも消せる):

```js
  // **フォルダを先に消す。** 共有ドライブで役割が足りないと、ここで止まり何も消えない。
  // 先にファイルを消すと、消えた作業コピーを持つ「開いた」改訂版が残る。
  // フォルダがもう無いとき (getFolderById が投げる) は、今までどおり記録して続ける
  var folder = null;
  try {
    folder = DriveApp.getFolderById(row.workingFolderId);
  } catch (e2) {
    Logger.log('作業フォルダが見つかりません: ' + e2.message);
  }
  if (folder) driveTrash_(folder);

  var files = dbReadAll('files');
  var prefix = 'branches/' + name + '/';
  for (var i = 0; i < files.length; i++) {
    if (String(files[i].path).indexOf(prefix) !== 0) continue;
    try {
      DriveApp.getFileById(files[i].fileId).setTrashed(true);
    } catch (e) {
      Logger.log('作業コピーを削除できません: ' + e.message);
    }
  }
```

(`driveTrash_` はマイドライブでは投げずに false を返すので、マイドライブの振る舞いは今と同じ。)

`src/core/AgentKit.gs` の `agentKitBuild_`:

```js
    try {
      old[i].setTrashed(true);
    } catch (e) {
      // 片付けのついで。消せなくても新しい zip は配れる
      console.warn('古い道具の zip を消せませんでした: ' + e.message);
    }
```

(`same` の繰り返しも同じく try で包む。) `file.setSharing(...)` は:

```js
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // 共有ドライブでは外への共有を組織が止めていることがある。メンバーはそのまま落とせる
    console.warn('道具の zip を「リンクを知っている全員」に共有できませんでした: ' + e.message);
  }
```

`CLAUDE.md` の落とし穴「**`addFile` と `removeFile` は両方呼ぶ。**…」の項目を次に置き換える:

```
- **フォルダを移すのは `moveTo` だけ。** `addFile` は共有ドライブで例外になる (ファイルは親を1つしか
  持てない)。以前は `addFile` と `removeFile` を両方呼ぶ形で、マイドライブでしか動かなかった。
  `test/fakegas.js` は `_markShared` した場所への `addFile` を投げる。**`removeFile` は空実装で
  `addFile` が親を移すので、マイドライブのテストだけでは片方だけの書き方が通ってしまう**
- **共有ドライブでゴミ箱へ移せるのはコンテンツ管理者から。** 人が押した操作は `driveTrash_` で
  要る役割を添えて断る。片付けのついで (古い zip など) は握って続ける
```

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run test/shared-drive.test.js test/phase4-queue.test.js test/agentkit.test.js`
Expected: PASS

確かめ: `commandRetire_` を `done.addFile(file); queue.removeFile(file);` に戻すと「命令を処理済みへ移して結果を書く」が落ちること。戻す。

- [ ] **Step 6: 全体を通す**

Run: `npm test`
Expected: PASS (`addFile` が親を移す疑似の振る舞いはマイドライブで変えていないので、既存のテストは通る)

- [ ] **Step 7: Commit**

```bash
git add test/fakegas.js test/shared-drive.test.js src/core/CommandQueue.gs src/core/Repo.gs src/Main.gs src/core/AgentKit.gs src/core/Branch.gs CLAUDE.md
git commit -m "feat: 共有ドライブで使えない Drive の操作を moveTo に置き換え、消せないときは要る役割を伝える"
```

---

### Task 3: 共有ドライブかどうかと、持ち主・管理者

**Files:**
- Modify: `src/appsscript.json` (Drive 拡張サービス)
- Modify: `src/core/Repo.gs` (`driveApiAvailable_` / `repoDriveId_` / `driveMembers_` / `repoOwners_`、`repoIsAdmin_`、`repoInit`、`repoEnsureMainBranch`、Task 2 の `repoDriveIdOrEmpty_` を `repoDriveId_` に寄せる)
- Modify: `src/Main.gs` (`assertOwner_`)
- Modify: `src/core/Inquiry.gs` (`inquiryOwner_` → `inquiryOwners_`)
- Modify: `src/core/Notifier.gs` (`notifyInquiry`)
- Modify: `src/core/CommandQueue.gs` (`commandOwner_`)
- Modify: `src/core/Settings.gs` (冒頭の説明)
- Modify: `test/fakegas.js` (`fake._makeDrive()`)
- Modify: `test/shared-drive.test.js`
- Modify: `CLAUDE.md` (制約・「管理者と持ち主は分けて使う」・「誰が持ち主かは Session からは分からない」)

**Interfaces:**
- Consumes: Task 2 の `folder._markShared(driveId)`、`driveTrash_`、`repoDriveIdOrEmpty_`
- Produces (fakegas): `fake._makeDrive({ members: {[driveId]: Array<{emailAddress, role, type}>}, pageSize?: number })` は Drive 拡張サービスの疑似を返す。テストは `fake.Drive = fake._makeDrive({...})` で入れる。`Files.get(id, {fields})` は、`_driveId` を持つフォルダ・ファイルなら `{ driveId }`、そうでなければ `{}`。`fields` に `lastModifyingUser` を含めば、`{ lastModifyingUser: { emailAddress: <作ったときの activeUser> } }`。`Permissions.list(driveId, {pageToken})` は `pageSize` 件ずつ返し、続きがあれば `nextPageToken` を付ける。`members` に無い driveId には `Error('File not found')` を投げる。`_calls` に呼んだ回数 (`{ filesGet, permissionsList }`) を数える
- Produces (GAS): `driveApiAvailable_(): boolean`、`repoDriveId_(): string`、`driveMembers_(driveId): {owners: string[], admins: string[]}`、`repoOwners_(): string[]`、`inquiryOwners_(): string[]`

- [ ] **Step 1: 疑似の拡張サービスを足す**

`test/fakegas.js` の `makeTasks` の後に:

```js
  /**
   * Drive の拡張サービス (v3) を模す。既定では返さない (足していない環境でも
   * マイドライブとして動くことを確かめるため)。
   */
  function makeDrive({ members = {}, pageSize = 100 } = {}) {
    const calls = { filesGet: 0, permissionsList: 0 };
    return {
      _calls: calls,
      Files: {
        get: (id, opts) => {
          calls.filesGet++;
          const item = files.get(id) || folders.get(id);
          if (!item) throw new Error('File not found: ' + id);
          const out = {};
          if (item._driveId) out.driveId = item._driveId;
          if (opts && /lastModifyingUser/.test(String(opts.fields || ''))) {
            out.lastModifyingUser = { emailAddress: item._createdBy || '' };
          }
          return out;
        },
      },
      Permissions: {
        list: (driveId, opts) => {
          calls.permissionsList++;
          if (!Object.prototype.hasOwnProperty.call(members, driveId)) throw new Error('File not found: ' + driveId);
          const all = members[driveId];
          const start = opts && opts.pageToken ? Number(opts.pageToken) : 0;
          const page = all.slice(start, start + pageSize);
          const res = { permissions: page };
          if (start + pageSize < all.length) res.nextPageToken = String(start + pageSize);
          return res;
        },
      },
    };
  }
```

`makeFile` に `_createdBy: activeUser,` を足す。返り値に `_makeDrive: makeDrive,` を足す。

- [ ] **Step 2: 落ちるテストを書く**

`test/shared-drive.test.js` の `setupShared()` を、Task 2 で足した「設定に driveId を書く」3行を消して、次にする:

```js
const MEMBERS = [
  { emailAddress: 'tester@example.com', role: 'organizer', type: 'user' },
  { emailAddress: 'boss@example.com', role: 'organizer', type: 'user' },
  { emailAddress: 'manager@example.com', role: 'fileOrganizer', type: 'user' },
  { emailAddress: 'writer@example.com', role: 'writer', type: 'user' },
  { emailAddress: 'reader@example.com', role: 'reader', type: 'user' },
  { emailAddress: 'team@example.com', role: 'organizer', type: 'group' },
];

function setupShared({ members = MEMBERS, pageSize } = {}) {
  const fake = createFakeGas();
  fake.Drive = fake._makeDrive({ members: { 'drive-1': members }, pageSize });
  const drive = fake.DriveApp.createFolder('共有ドライブ')._markShared('drive-1');
  fake._placeScript(drive);
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake, drive };
}
```

足すテスト:

```js
describe('共有ドライブかどうか', () => {
  it('入れ物を作ったときに driveId を覚える', () => {
    const { ctx } = setupShared();
    expect(ctx.repoConfig().driveId).toBe('drive-1');
  });

  it('マイドライブなら今のまま。2回目からは問い合わせない', () => {
    const fake = createFakeGas();
    fake.Drive = fake._makeDrive({});
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.repoDriveId_()).toBe('');
    const n = fake.Drive._calls.filesGet;
    ctx.repoDriveId_();
    ctx.repoIsAdmin_('tester@example.com');
    expect(fake.Drive._calls.filesGet).toBe(n);
    expect(ctx.repoOwners_()).toEqual(['tester@example.com']);
  });

  it('設定に driveId が無い (前からある番頭) と、最初に読んだときに埋める', () => {
    const { ctx, fake } = setupShared();
    const cfg = ctx.repoConfig();
    delete cfg.driveId;
    fake.PropertiesService.getScriptProperties().setProperty(ctx.REPO_CONFIG_KEY(), JSON.stringify(cfg));
    expect(ctx.repoDriveId_()).toBe('drive-1');
    expect(ctx.repoConfig().driveId).toBe('drive-1');
  });

  it('拡張サービスが無ければマイドライブとして扱い、覚えない (あとで足されたら読み直す)', () => {
    const fake = createFakeGas();
    const drive = fake.DriveApp.createFolder('共有ドライブ')._markShared('drive-1');
    fake._placeScript(drive);
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.repoDriveId_()).toBe('');
    expect('driveId' in ctx.repoConfig()).toBe(false);
  });
});

describe('共有ドライブの持ち主と管理者', () => {
  it('持ち主は管理者 (organizer) 全員。グループは数えない', () => {
    const { ctx } = setupShared();
    expect(ctx.repoOwners_().sort()).toEqual(['boss@example.com', 'tester@example.com']);
  });

  it('管理者はコンテンツ管理者と投稿者まで。閲覧者とグループは違う', () => {
    const { ctx } = setupShared();
    for (const who of ['tester@example.com', 'boss@example.com', 'manager@example.com', 'writer@example.com']) {
      expect(ctx.repoIsAdmin_(who)).toBe(true);
    }
    expect(ctx.repoIsAdmin_('reader@example.com')).toBe(false);
    expect(ctx.repoIsAdmin_('team@example.com')).toBe(false);
  });

  it('エディタ専用の関数は、どの管理者 (organizer) でも動く。投稿者には動かない', () => {
    const { ctx, fake } = setupShared();
    fake._setUser('boss@example.com');
    expect(() => ctx.debugEnableSelfApprove()).not.toThrow();
    ctx.debugDisableSelfApprove();
    fake._setUser('writer@example.com');
    expect(() => ctx.debugEnableSelfApprove()).toThrow(/持ち主だけ/);
  });

  it('全頁を読む', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ emailAddress: 'w' + i + '@example.com', role: 'writer', type: 'user' }));
    many.push({ emailAddress: 'last@example.com', role: 'organizer', type: 'user' });
    const { ctx } = setupShared({ members: many, pageSize: 100 });
    expect(ctx.repoOwners_()).toEqual(['last@example.com']);
  });

  // loadGasWith は fake そのものを文脈にする (ctx === fake)。読み込んだあとに fake.Drive や
  // fake.CacheService を差し替えれば、そのまま効く
  it('役割が読めなければ誰も持ち主ではない。失敗は覚えない', () => {
    const { ctx, fake } = setupShared();
    const cache = new Map();
    fake.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) };
    fake.Drive = fake._makeDrive({ members: {} });
    expect(ctx.repoOwners_()).toEqual([]);
    expect(ctx.repoIsAdmin_('tester@example.com')).toBe(false);
    expect(() => ctx.assertOwner_()).toThrow(/持ち主だけ/);
    expect(cache.size).toBe(0);
    fake.Drive = fake._makeDrive({ members: { 'drive-1': MEMBERS } });
    expect(ctx.repoOwners_().length).toBe(2);
  });

  it('役割は10分覚え、続けて聞かない', () => {
    const { ctx, fake } = setupShared();
    const cache = new Map();
    fake.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) };
    ctx.repoOwners_();
    const n = fake.Drive._calls.permissionsList;
    ctx.repoOwners_();
    ctx.repoIsAdmin_('writer@example.com');
    expect(fake.Drive._calls.permissionsList).toBe(n);
  });
});

describe('共有ドライブの報告', () => {
  it('知らせは持ち主全員に届き、書いた本人には送らない。やることの担当は空', () => {
    const { ctx, fake } = setupShared();
    fake._setUser('writer@example.com');
    ctx.inquiryCreate('bug', '動かない', '押しても何も起きない', '');
    const to = fake._sentMails().map((m) => m.to).sort();
    expect(to).toEqual(['boss@example.com', 'tester@example.com']);
    const issue = ctx.dbReadAll('issues').find((r) => String(r.title).indexOf('[報告 #') === 0);
    expect(String(issue.assignee || '')).toBe('');
  });

  it('マイドライブでは今までどおり持ち主1人が担当になる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    fake._setUser('writer@example.com');
    ctx.inquiryCreate('bug', '動かない', '押しても何も起きない', '');
    const issue = ctx.dbReadAll('issues').find((r) => String(r.title).indexOf('[報告 #') === 0);
    expect(String(issue.assignee)).toBe('tester@example.com');
  });
});

describe('共有ドライブで命令を置いた人', () => {
  it('持ち主が無いので、最後に書いた人を読む', () => {
    const { ctx, fake } = setupShared();
    const queue = ctx.commandQueueFolder_();
    fake._setUser('writer@example.com');
    const f = queue.createFile('t2.cmd.json', '{}', 'text/plain');
    fake._setUser('tester@example.com');
    expect(ctx.commandOwner_(f)).toBe('writer@example.com');
  });
});
```

`inquiryCreate` の名前と引数は書く前に `grep -n "^function inquiryCreate\|^function apiInquiry" src/core/Inquiry.gs src/Main.gs` で確かめて合わせる (報告を受け付けて `notifyInquiry` と `inquiryToIssue_` を呼ぶ関数)。`debugEnableSelfApprove` が持ち主以外で投げることは `test/phase4-edit.test.js` にある。

- [ ] **Step 3: 落ちることを確かめる**

Run: `npx vitest run test/shared-drive.test.js`
Expected: FAIL (`repoDriveId_` / `repoOwners_` が無い、`driveId` が入らない)

- [ ] **Step 4: 作る**

`src/appsscript.json` に足す (`dependencies` は今は `{}`):

```json
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Drive", "serviceId": "drive", "version": "v3" }
    ]
  },
```

`src/core/Repo.gs`。Task 2 の `repoDriveIdOrEmpty_` を消し、呼んでいるところ (`driveTrash_`) を `repoDriveIdSafe_()` に替える (`grep -rn repoDriveIdOrEmpty_ src` で残りが無いことを確かめる)。次を足す:

```js
/**
 * Drive の拡張サービス (v3) が使えるか。
 *
 * appsscript.json で足してあるが、足す前に作ったデプロイや、組織が止めている環境もある。
 * 使えなければマイドライブとして扱う。
 *
 * @returns {boolean}
 */
function driveApiAvailable_() {
  try {
    return typeof Drive !== 'undefined' && !!Drive.Files && !!Drive.Permissions;
  } catch (e) {
    return false;
  }
}

/**
 * 入れ物が置かれている共有ドライブの id。マイドライブなら空。
 *
 * **共有ドライブとマイドライブの分かれ目はここだけ。** `if (driveId)` を散らさない。
 *
 * 設定 (`repoConfig().driveId`) に覚える。空文字も「マイドライブ」として覚え、毎回
 * 問い合わせない。拡張サービスが無いときと問い合わせに失敗したときは覚えない
 * (あとで足されたら読み直す)。設定が読めなければ投げる (repoConfig と同じ)。
 *
 * @returns {string}
 */
function repoDriveId_() {
  var config = repoConfig();
  if (typeof config.driveId === 'string') return config.driveId;
  if (!driveApiAvailable_()) return '';

  var id;
  try {
    var meta = Drive.Files.get(config.rootId, { fields: 'driveId', supportsAllDrives: true });
    id = String((meta && meta.driveId) || '');
  } catch (e) {
    Logger.log('共有ドライブか分かりませんでした: ' + e.message);
    return '';
  }

  // 設定はキューの置き場を作るときにも書くので、鍵の中で読み直してから書く。
  // 取れなければ覚えずに返す (次に読んだときにまた問い合わせるだけ)
  dbWithLock_(30000, function () {
    var again = repoConfig();
    if (typeof again.driveId === 'string') return;
    again.driveId = id;
    PropertiesService.getScriptProperties().setProperty(REPO_CONFIG_KEY(), JSON.stringify(again));
  }, function () {});
  return id;
}

/**
 * repoDriveId_ を、設定が読めないときに空で返す形。消す・断るの判断に使う。
 *
 * @returns {string}
 */
function repoDriveIdSafe_() {
  try {
    return repoDriveId_();
  } catch (e) {
    return '';
  }
}

/**
 * 共有ドライブのメンバーを、持ち主 (organizer) と管理者 (organizer / fileOrganizer / writer) に分ける。
 *
 * **グループは数えない。** 中の人を確かめる手立てが無い。
 * **読めなければ投げずに空。** 誰も持ち主・管理者ではない (安全側)。失敗は覚えない。
 * 読めたものは10分覚える。一覧で1行ごとに問い合わせると、行の数だけ待つ。
 *
 * @param {string} driveId
 * @returns {{owners: string[], admins: string[]}}
 */
function driveMembers_(driveId) {
  var key = 'driveMembers:' + driveId;
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    cache = null;
  }

  var out = { owners: [], admins: [] };
  try {
    var token = '';
    do {
      var res = Drive.Permissions.list(driveId, {
        supportsAllDrives: true, pageSize: 100, pageToken: token || undefined,
        fields: 'nextPageToken,permissions(emailAddress,role,type)',
      });
      var list = (res && res.permissions) || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.type !== 'user' || !p.emailAddress) continue;
        var email = String(p.emailAddress);
        if (p.role === 'organizer') out.owners.push(email);
        if (p.role === 'organizer' || p.role === 'fileOrganizer' || p.role === 'writer') out.admins.push(email);
      }
      token = (res && res.nextPageToken) || '';
    } while (token);
  } catch (e) {
    Logger.log('共有ドライブの役割が読めませんでした: ' + e.message);
    return { owners: [], admins: [] };
  }

  try {
    if (cache) cache.put(key, JSON.stringify(out), 600);
  } catch (e2) {
    Logger.log('役割を覚えられませんでした: ' + e2.message);
  }
  return out;
}

/**
 * このアプリの持ち主。マイドライブでは入れ物の持ち主1人、共有ドライブでは管理者 (organizer) 全員。
 *
 * エディタ専用の関数・報告の知らせ・報告から作るやることの担当が見る。
 *
 * @returns {string[]} 分からなければ空
 */
function repoOwners_() {
  var driveId;
  try {
    driveId = repoDriveId_();
  } catch (e) {
    return [];
  }
  if (driveId) return driveMembers_(driveId).owners;
  var owner = repoOwnerEmail();
  return owner ? [owner] : [];
}
```

`repoIsAdmin_` の `if (!who) return false;` の直後に足す (残りは今のまま):

```js
  var driveId;
  try {
    driveId = repoDriveId_();
  } catch (e) {
    return false;
  }
  // 共有ドライブでは、台帳を書き換えられる役割 (投稿者まで) を管理者とする。フォルダの持ち主は無い
  if (driveId) return driveMembers_(driveId).admins.indexOf(who) >= 0;
```

`repoIsAdmin_` の説明の冒頭に「**共有ドライブでは** organizer / fileOrganizer / writer (driveMembers_)。」を足す。

`repoInit` の `PropertiesService…setProperty(REPO_CONFIG_KEY(), …)` の直後に `repoDriveId_();` を足す (共有ドライブなら覚える)。`repoEnsureMainBranch` の `createdBy: repoOwnerEmail(),` を `createdBy: repoOwners_()[0] || '',` にする。

`src/Main.gs` の `assertOwner_`:

```js
function assertOwner_() {
  var me = String(Session.getActiveUser().getEmail() || '');
  if (!me || repoOwners_().indexOf(me) < 0) {
    throw new Error('この操作は、このアプリの持ち主だけが行えます (共有ドライブでは管理者)');
  }
}
```

説明に「持ち主は repoOwners_ が決める (共有ドライブでは管理者 = organizer 全員)」を足す。

`src/core/Inquiry.gs`。`inquiryOwner_` を `inquiryOwners_` に替える:

```js
/**
 * 報告の知らせを受ける人。このアプリの持ち主 (共有ドライブでは管理者全員)。
 *
 * この Web アプリは開いた人の権限で動く (executeAs: USER_ACCESSING) ため、
 * Session.getEffectiveUser() は常に開いている本人になる。それを持ち主と
 * 見なすと誰もが持ち主になってしまうので、入れ物を見る (repoOwners_)。
 *
 * @returns {string[]}
 */
function inquiryOwners_() {
  return repoOwners_();
}
```

呼んでいる2か所: 宛先の一覧の `add(inquiryOwner_());` は `var owners = inquiryOwners_(); for (var o = 0; o < owners.length; o++) add(owners[o]);`。`inquiryToIssue_` の担当は:

```js
    // 持ち主が1人ならその人。共有ドライブで複数なら空 (全員を担当にすると工数が頭数で割られる)
    var owners = inquiryOwners_();
    if (owners.length === 1) issueUpdate(issue.number, { assignee: owners[0] });
```

`inquiryToIssue_` の説明「持ち主は環境によって変わるため、入れ物の持ち主を見る。分からないときは担当なしで積む。」に「持ち主が複数 (共有ドライブ) のときも担当なしで積む。」を足す。

`src/core/Notifier.gs` の `notifyInquiry`:

```js
function notifyInquiry(row) {
  var owners = inquiryOwners_();
  for (var i = 0; i < owners.length; i++) {
    if (String(owners[i]) === String(row.by)) continue;
    notify(
      owners[i],
      notifySubject_('報告', row.number, 'が届きました'),
      INQUIRY_KINDS()[row.kind] + ' / ' + row.by + '\n\n' +
      row.body + '\n\n' + (row.context || '')
    );
  }
}
```

説明に「共有ドライブでは管理者全員に送る」を足す。`grep -rn "inquiryOwner_" src test` で残りが無いことを確かめる (テストが名前で呼んでいれば `inquiryOwners_` に直す)。

`src/core/CommandQueue.gs` の `commandOwner_`:

```js
function commandOwner_(file) {
  try {
    var owner = file.getOwner();
    if (owner) return String(owner.getEmail() || '');
  } catch (e) {
    // 共有ドライブのファイルは持ち主を持たない。下で最後に書いた人を読む
  }
  // 使い道は「誰の道具が古いか」(kitRemember_) だけ。書き換えられるので権限の判断には使わない
  if (typeof driveApiAvailable_ !== 'function' || !driveApiAvailable_()) return '';
  try {
    var meta = Drive.Files.get(file.getId(), { fields: 'lastModifyingUser(emailAddress)', supportsAllDrives: true });
    return String((meta && meta.lastModifyingUser && meta.lastModifyingUser.emailAddress) || '');
  } catch (e2) {
    return '';
  }
}
```

説明の「共有ドライブのファイルは持ち主を持たず、getOwner() が null を返す。」の後に「そのときは最後に書いた人 (lastModifyingUser) を読む。」を足す。

`src/core/Settings.gs` 冒頭の「変えられるのは持ち主だけ」を「変えられるのは管理者だけ」に直す (今の実装 `repoIsAdmin_` と合わせる)。

`CLAUDE.md`:
- 「## 制約」の「**拡張サービスは Google ToDo 連携 (`src/core/GoogleTasks.gs`) だけの例外。**」の項目を「**拡張サービスは2つだけの例外**: Google ToDo 連携 (`src/core/GoogleTasks.gs`) と Drive (v3。共有ドライブの役割を読む `driveMembers_` と、入れ物が共有ドライブかを見る `repoDriveId_`)。Drive は `appsscript.json` で足してあるので利用者は何もしない。使えないときはマイドライブとして扱う」に直す
- 「## 誰が持ち主かは Session からは分からない」の末尾に「**共有ドライブには持ち主が無い。** 持ち主は `repoOwners_()` が決め、共有ドライブでは管理者 (`organizer`) 全員になる。`repoOwnerEmail()` を直に呼んで持ち主を決めない」を足す
- 「## 管理者と持ち主は分けて使う」の箇条に「**共有ドライブでは** 持ち主 = `organizer` 全員、管理者 = `organizer` / `fileOrganizer` / `writer`。グループは数えない。役割は `driveMembers_` が10分覚える。読めないときは誰も持ち主・管理者ではない」「報告の知らせは持ち主全員に届く。報告から作るやることは、持ち主が複数なら担当なし」を足す。「宛先を管理者に広げると同じ知らせが何通も届く」の文は「宛先を (持ち主でない) 管理者に広げると…」に直す

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run test/shared-drive.test.js test/admin.test.js test/phase4-edit.test.js test/phase4-queue.test.js`
Expected: PASS

確かめ: `driveMembers_` の `if (p.type !== 'user' …) continue;` を消すと「グループは数えない」が落ちること。`do … while (token)` を1回だけにすると「全頁を読む」が落ちること。戻す。

- [ ] **Step 6: 全体を通す**

Run: `npm test`
Expected: PASS。`test/naming.test.js` / `test/phase4-edit.test.js` が `inquiryOwner_` や断りの言葉を見ていて落ちたら、そちらを新しい名前・言葉に合わせる (断りの言葉は `/持ち主だけ/` に合うようにしてある)

- [ ] **Step 7: Commit**

```bash
git add src/appsscript.json src/core/Repo.gs src/Main.gs src/core/Inquiry.gs src/core/Notifier.gs src/core/CommandQueue.gs src/core/Settings.gs test/fakegas.js test/shared-drive.test.js CLAUDE.md
git commit -m "feat: 共有ドライブでは管理者全員を持ち主として扱う"
```

---

### Task 4: キューを動かしている人を設定の画面に出す

**Files:**
- Modify: `src/Main.gs` (`setupCommandQueue`、`apiSettings`)
- Modify: `src/core/CommandQueue.gs` (`processCommandQueue` が最後に回った時刻を書く、`queueStatus_` を足す)
- Modify: `src/ui/app.js.html` (`makeQueueSettings`、`loadSettingsPanel`)
- Modify: `test/dom.js` (`DEFAULTS.apiSettings`)
- Modify: `test/phase4-queue.test.js`、`test/component.test.js`
- Modify: `CLAUDE.md` (「## 制約」の後の、コマンドキューの落とし穴の並び)

**Interfaces:**
- Consumes: Task 3 の `repoIsAdmin_`、`assertOwner_`
- Produces (GAS): スクリプトプロパティ `QUEUE_RUNNER` (メール)、`QUEUE_LAST_RUN` (ISO 文字列)。`queueStatus_(now?: Date): {runner: string, lastRun: string, stale: boolean}`。`stale` は runner があり、lastRun が無いか1時間より前のとき true
- Produces (API): `apiSettings()` に `queue: {runner, lastRun, stale}` を足す。**管理者でなければ `queue` は `null`** (人のアドレスを全員に返さない)

- [ ] **Step 1: 落ちるテストを書く**

`test/phase4-queue.test.js` に足す (このファイルの `setup()` を使う):

```js
describe('キューを動かしている人', () => {
  it('setupCommandQueue が実行した人を覚え、processCommandQueue が回った時刻を書く', () => {
    const { ctx, fake } = setup();
    ctx.setupCommandQueue();
    ctx.processCommandQueue();
    const st = ctx.queueStatus_();
    expect(st.runner).toBe('tester@example.com');
    expect(st.lastRun).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(st.stale).toBe(false);
  });

  it('1時間より前に止まっていれば stale', () => {
    const { ctx } = setup();
    ctx.setupCommandQueue();
    ctx.processCommandQueue();
    const later = new Date(Date.now() + 61 * 60 * 1000);
    expect(ctx.queueStatus_(later).stale).toBe(true);
  });

  it('一度も回っていなければ stale。仕掛けた人がいなければ stale ではない', () => {
    const { ctx } = setup();
    expect(ctx.queueStatus_().stale).toBe(false);
    ctx.setupCommandQueue();
    expect(ctx.queueStatus_().stale).toBe(true);
  });

  it('apiSettings は管理者にだけ返す', () => {
    const { ctx, fake } = setup();
    ctx.setupCommandQueue();
    expect(ctx.apiSettings().queue.runner).toBe('tester@example.com');
    fake._setUser('viewer@example.com');
    expect(ctx.apiSettings().queue).toBe(null);
  });
});
```

(`setup()` が `apiSettings` に要る Settings.gs / ScrumView 等を読んでいなければ、`admin.test.js` と同じく `scrum-api.test.js` の SOURCES を使う `setup` をこの describe の中に置く。)

`test/dom.js` の `DEFAULTS.apiSettings` に `queue: null` を足す (同じキューを二度書かない)。

`test/component.test.js` の設定の画面のテストの近く (`mount({ apiSettings: ON })` を使う describe) に足す:

```js
  it('キューが止まっていれば、引き継ぎ方を出す', () => {
    const app = mount({ apiSettings: Object.assign({}, ON, {
      queue: { runner: 'boss@example.com', lastRun: '2026-10-19T00:00:00.000Z', stale: true } }) });
    app.openSettings();
    const box = app.document.getElementById('queue-settings');
    expect(box.textContent).toContain('boss@example.com');
    expect(box.textContent).toContain('setupCommandQueue()');
  });

  it('管理者でなければキューの節を出さない', () => {
    const app = mount({ apiSettings: Object.assign({}, ON, { canEdit: false, queue: null }) });
    app.openSettings();
    expect(app.document.getElementById('queue-settings')).toBe(null);
  });
```

`mount` / `ON` / 設定の画面を開く手順は、同じファイルの既存のスクラム設定のテスト (`mount({ apiSettings: ON })` の周り) と同じ書き方に合わせる (`app.openSettings()` は、そこで使っている開き方に置き換える)。

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run test/phase4-queue.test.js test/component.test.js -t "キュー"`
Expected: FAIL (`queueStatus_` が無い、`#queue-settings` が無い)

- [ ] **Step 3: 作る**

`src/core/CommandQueue.gs` に足す:

```js
/**
 * キューを動かしている人と、最後に回った時刻。
 *
 * トリガーは setupCommandQueue() を実行した人の権限で走る。共有ドライブではその人が
 * 抜けると止まるが、他人のトリガーは見えないので、止まったことに誰も気づかない。
 * 設定の画面に出し、1時間より前に止まっていれば引き継ぎ方を出す。
 *
 * @param {Date} [now]
 * @returns {{runner: string, lastRun: string, stale: boolean}}
 */
function queueStatus_(now) {
  var props = PropertiesService.getScriptProperties();
  var runner = String(props.getProperty('QUEUE_RUNNER') || '');
  var lastRun = String(props.getProperty('QUEUE_LAST_RUN') || '');
  var at = lastRun ? Date.parse(lastRun) : NaN;
  var t = (now || new Date()).getTime();
  var stale = !!runner && (isNaN(at) || t - at > 60 * 60 * 1000);
  return { runner: runner, lastRun: lastRun, stale: stale };
}
```

`processCommandQueue` の先頭 (`var queue = commandQueueFolder_();` の前) に:

```js
  // 回ったことを残す (鍵は取らない。上書きするだけで、ずれても困らない)
  try {
    PropertiesService.getScriptProperties().setProperty('QUEUE_LAST_RUN', new Date().toISOString());
  } catch (e) {
    Logger.log('回った時刻を残せませんでした: ' + e.message);
  }
```

`src/Main.gs` の `setupCommandQueue` のトリガーを作った直後に:

```js
  // 誰の権限で回っているかを残す。他人のトリガーは見えないので、抜けた人のぶんは消せない。
  // 引き継いだ人がもう一度実行すれば、その人のトリガーで回る (二重に回っても同じ命令は二度走らない)
  PropertiesService.getScriptProperties()
    .setProperty('QUEUE_RUNNER', String(Session.getActiveUser().getEmail() || ''));
```

`apiSettings` の返り値に足す:

```js
    // 人のアドレスを含むので、管理者にだけ返す
    queue: admin ? plainQueueStatus_(queueStatus_()) : null,
```

(`canEdit: repoIsAdmin_(me)` を `var admin = repoIsAdmin_(me);` に出して両方で使う。) `plainQueueStatus_` は `apiSettings` の直前に置く:

```js
function plainQueueStatus_(st) {
  return { runner: plainText(st.runner), lastRun: plainText(st.lastRun), stale: !!st.stale };
}
```

`apiSettings` の `@returns` に `queue: ({runner:string, lastRun:string, stale:boolean}|null)` を足す。

`src/ui/app.js.html` の `loadSettingsPanel` で `settingsEl.appendChild(makeGameSettings());` の後に `if (settings.canEdit && settings.queue) settingsEl.appendChild(makeQueueSettings());` を足し、`makeGameSettings` の後に:

```js
  /**
   * 手元からの命令を受け付ける仕掛け (コマンドキュー) の節。管理者にだけ出す。
   *
   * 仕掛けた人の権限で1分ごとに回る。その人が抜けると止まり、他人からは見えない。
   *
   * @returns {HTMLElement}
   */
  function makeQueueSettings() {
    var q = settings.queue || {};
    var box = document.createElement('section');
    box.className = 'settings-section';
    box.id = 'queue-settings';

    var head = document.createElement('h2');
    head.className = 'view-title';
    head.appendChild(document.createTextNode('手元からの命令の受付 '));
    head.appendChild(makePill(!q.runner ? '未設定' : q.stale ? '止まっています' : '動いています',
      !q.runner || q.stale ? 'state' : 'state state-open'));
    box.appendChild(head);

    var who = document.createElement('p');
    who.textContent = q.runner
      ? q.runner + ' さんの権限で1分ごとに動いています。最後に動いたのは ' +
        (q.lastRun ? new Date(q.lastRun).toLocaleString('ja-JP') : 'まだありません') + '。'
      : 'まだ仕掛けていません。';
    box.appendChild(who);

    if (!q.runner || q.stale) {
      var how = document.createElement('p');
      how.className = 'row-meta';
      how.textContent = '持ち主 (共有ドライブでは管理者の役割の人) が Apps Script のエディタで ' +
        'setupCommandQueue() を実行すると、その人の権限で動き始めます (前の人が抜けた場合も、これで引き継げます)。';
      box.appendChild(how);
    }
    return box;
  }
```

`CLAUDE.md` のコマンドキューの落とし穴 (「**キューの置き場は、ゴミ箱に入っていたら作り直す**」の項目) の後に足す:

```
- **キューは仕掛けた人の権限で回る** (`QUEUE_RUNNER`)。共有ドライブでその人が抜けると止まり、
  他人のトリガーは見えない。`processCommandQueue` が回った時刻 (`QUEUE_LAST_RUN`) を残し、設定の
  画面が1時間より前なら引き継ぎ方を出す (持ち主 = 共有ドライブでは管理者の役割の人が `setupCommandQueue()` を実行する)。人のアドレスを
  含むので `apiSettings` は管理者にだけ返す
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run test/phase4-queue.test.js test/component.test.js test/phase4-edit.test.js`
Expected: PASS (`phase4-edit.test.js` の「画面に渡せる形か」が `apiSettings` の新しい欄も見る)

確かめ: `apiSettings` の `admin ?` を外すと「apiSettings は管理者にだけ返す」が落ちること。戻す。

- [ ] **Step 5: 全体を通す**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/Main.gs src/core/CommandQueue.gs src/ui/app.js.html test/dom.js test/phase4-queue.test.js test/component.test.js CLAUDE.md
git commit -m "feat: キューを動かしている人と止まっているかを設定の画面に出す"
```

---

### Task 5: 実機で確かめる入口

**Files:**
- Modify: `src/Main.gs` (`debugVerifySharedDrive` を `debugVerifyCommandQueue` の後に足す)
- Modify: `test/phase4-edit.test.js` (「エディタ専用の関数は、持ち主以外には動かない」の `NAMES`)
- Modify: `test/shared-drive.test.js`
- Modify: `CLAUDE.md` (「## 実機検証の入口」の表)

**Interfaces:**
- Consumes: `repoDriveId_`、`repoOwners_`、`driveMembers_`、`commandQueueFolder_`、`commandDoneFolder_`、`processCommandQueue`、`queueStatus_`、`agentKitBuild_`
- Produces: `debugVerifySharedDrive(): string` (PASS / FAIL の行を改行でつないだ要約。最後の行は `'失敗: N件'` か `'すべて通りました'`)

- [ ] **Step 1: 落ちるテストを書く**

`test/phase4-edit.test.js` の `NAMES` に `'debugVerifySharedDrive'` を足す。`test/shared-drive.test.js` に足す:

```js
describe('実機で確かめる入口 (debugVerifySharedDrive)', () => {
  it('共有ドライブで全部通り、置いた命令を片付ける', () => {
    const { ctx } = setupShared();
    const out = ctx.debugVerifySharedDrive();
    expect(out).toContain('すべて通りました');
    expect(ctx.commandQueueFolder_().getFilesByName('verify-shared.cmd.json').hasNext()).toBe(false);
    expect(ctx.commandQueueFolder_().getFilesByName('verify-shared.result.json').hasNext()).toBe(false);
  });

  it('マイドライブでは「共有ドライブではありません」と言って止まる', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.debugVerifySharedDrive()).toContain('共有ドライブではありません');
  });
});
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run test/shared-drive.test.js test/phase4-edit.test.js -t "debugVerifySharedDrive"`
Expected: FAIL (`debugVerifySharedDrive is not a function`)

- [ ] **Step 3: 作る**

```js
/**
 * 共有ドライブに置いたときに動くかを、実機で確かめる。持ち主専用。置いた命令は片付ける。
 *
 * 疑似GASでは「権限で断られる」形を再現しきれない。役割の読み方・親が1つの移動・
 * 外への共有の拒否はここで見る。
 *
 * @returns {string} 判定サマリ
 */
function debugVerifySharedDrive() {
  assertOwner_();
  var log = [];
  var failed = 0;

  function check(label, ok, detail) {
    log.push((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
    if (!ok) failed++;
    return ok;
  }

  var driveId = repoDriveId_();
  if (!driveId) {
    return '共有ドライブではありません (入れ物はマイドライブにあるか、Drive の拡張サービスが使えません)';
  }
  check('入れ物は共有ドライブにある', true, driveId);

  var members = driveMembers_(driveId);
  check('持ち主 (organizer) が読めた', members.owners.length > 0, members.owners.join(', '));
  check('自分が持ち主に入っている',
    members.owners.indexOf(String(Session.getActiveUser().getEmail() || '')) >= 0);

  var queue = commandQueueFolder_();
  var id = 'verify-shared';
  try {
    queue.createFile(id + '.cmd.json', JSON.stringify({ op: 'fileList', args: {} }), MimeType.PLAIN_TEXT);
    processCommandQueue();
    var res = queue.getFilesByName(id + '.result.json');
    check('命令を処理して結果を書いた (親が1つの移動が通った)', res.hasNext());
    check('命令は queue-done へ移った', commandDoneFolder_().getFilesByName(id + '.cmd.json').hasNext());
    check('キューが回った時刻を残した', !!queueStatus_().lastRun);
  } catch (e) {
    check('命令を通す', false, e.message);
  } finally {
    var leftovers = [queue.getFilesByName(id + '.cmd.json'), queue.getFilesByName(id + '.result.json'),
      commandDoneFolder_().getFilesByName(id + '.cmd.json')];
    for (var i = 0; i < leftovers.length; i++) {
      while (leftovers[i].hasNext()) {
        try { leftovers[i].next().setTrashed(true); } catch (e2) { Logger.log('片付けられません: ' + e2.message); }
      }
    }
  }

  try {
    check('道具の zip を作れた (外への共有を断られても)', !!agentKitBuild_().getId());
  } catch (e3) {
    check('道具の zip を作る', false, e3.message);
  }

  log.push(failed ? '失敗: ' + failed + '件' : 'すべて通りました');
  var out = log.join('\n');
  Logger.log(out);
  return out;
}
```

`fileList` が `COMMAND_OPS()` に無ければ、`grep -n "^    [a-zA-Z]*: function" src/core/CommandQueue.gs` で読むだけの命令を選んで置き換える (`debugVerifyCommandQueue` が置いている命令と同じものにする)。

`CLAUDE.md` の「## 実機検証の入口」の表に足す:

```
| `debugVerifySharedDrive()` | 共有ドライブに置いたとき: 役割が読めるか → 命令の移動 → 回った時刻 → 道具の zip。マイドライブなら何もせずにそう言う |
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run test/shared-drive.test.js test/phase4-edit.test.js`
Expected: PASS

- [ ] **Step 5: 全体を通す**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/Main.gs test/phase4-edit.test.js test/shared-drive.test.js CLAUDE.md
git commit -m "feat: 共有ドライブで動くかを実機で確かめる入口を足す"
```
