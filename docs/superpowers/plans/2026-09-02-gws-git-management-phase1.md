# GWS Git-like 文書管理システム Phase 1 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Docs を正規化HTMLに変換してブラウザ上でライブ表示する Wiki を、GAS標準サービスのみで構築する。

**Architecture:** Docs を `DocumentApp` で走査して中間表現 (Block配列) に変換し、それを決定的な正規化HTMLにシリアライズする。Block配列とHTML文字列の相互変換 (`Normalize.js`) は GAS API に一切依存しないピュア関数として実装し、Node + vitest で TDD する。GAS依存のレンダラ層は薄いアダプタに留める。閲覧時は `CacheService` にファイルの `lastUpdated` をキーに含めてキャッシュすることで、編集が自動的に反映される。

**Tech Stack:** Google Apps Script (V8ランタイム、標準サービスのみ) / clasp 3.x / Node 22 + vitest / HtmlService

**Spec:** `docs/superpowers/specs/2026-09-02-gws-git-management-design.md`

**関連:** `docs/superpowers/specs/2026-09-02-gws-git-management-scaling.md` (大規模化構想。Phase 1 では実装しないが、§10のチェックリストに従いインターフェース境界を守ること)

## Global Constraints

これらはすべてのタスクの要件に暗黙的に含まれる。

- **GAS標準サービスのみ**を使う。Advanced Google Services (Drive API / Docs API / Sheets API) は有効化しない。`UrlFetchApp` による外部通信も行わない。
- **外部npmライブラリをランタイムに持ち込まない。** `package.json` の依存は `vitest` のみで、これはテスト専用であり GAS には push しない。
- **ランタイムコードはすべて素の Apps Script として書く。** `import` / `export` / `require` / `module.exports` を **ランタイムファイルに書いてはならない**。テストは `node:vm` でファイルを評価するハーネス経由で行う (Task 2 で構築)。
- **GAS はすべてのファイルを1つのグローバルスコープに読み込む。** 関数宣言は巻き上げられるため関数間の呼び出し順は問題にならないが、**トップレベルの `const` / `let` による初期化は読み込み順に依存するため書かない。** 定数が必要な場合は関数内か、関数として公開する。
- **ファイル内部専用の関数は末尾にアンダースコアを付ける** (例: `objectPath_`)。GAS の慣習であり、Web App の公開 API と区別できる。
- **正規化HTMLは決定的でなければならない。** 同じ内容の文書からは常にバイト単位で同一のHTMLが出ること。属性順・空白・Runの結合ルールをすべて固定する。
- **入力検証はアンカー付き正規表現で行う。** glob やワイルドカードによるホワイトリストは使わない。
- **文書HTMLは必ず `<iframe sandbox>` 内でレンダリングする。** `allow-scripts` は付与しない。
- **破壊的操作にはすべて実行者 (`Session.getActiveUser().getEmail()`) を記録する。**
- コミットメッセージは Conventional Commits 形式 (`feat:` / `test:` / `chore:` / `docs:`)。

---

## ファイル構成 (Phase 1 完了時)

```
agentic-management-gas/
├── .clasp.json                 ← gitignore済 (scriptId を含むため)
├── .claspignore
├── package.json
├── vitest.config.js
├── src/
│   ├── appsscript.json         ← マニフェスト (rootDir 直下に置く必要がある)
│   ├── Main.gs                 ← doGet / ルーティング / google.script.run API
│   ├── core/
│   │   ├── Hash.js             ★ピュア: bytesToHex
│   │   ├── HashGas.gs          ← GAS依存: sha256Hex
│   │   ├── Normalize.js        ★ピュア: Block[] ⇄ HTML文字列
│   │   ├── Db.gs               ← スプレッドシートDB アクセス層
│   │   ├── Repo.gs             ← Drive レイアウト初期化
│   │   └── ObjectStore.gs      ← blob 保存/取得
│   ├── render/
│   │   ├── DocRenderer.gs      ← Doc → Block[]
│   │   └── LiveCache.gs        ← ライブHTML取得 + チャンクキャッシュ
│   └── ui/
│       ├── wiki.html
│       ├── app.css.html
│       └── app.js.html
└── test/
    ├── harness.js              ← node:vm でGASファイルを読み込む
    ├── hash.test.js
    └── normalize.test.js
```

### 中間表現 (Block / Run) の定義

このデータ構造が Phase 1 の中心であり、以降のすべてのタスクが依存する。

```javascript
// Run: インライン要素。装飾属性は true のときのみ存在する (false は書かない)
{ text: string, bold?: true, italic?: true, underline?: true, strike?: true, link?: string }

// Block: ブロック要素
{ type: 'heading',   level: 1..6, runs: Run[] }
{ type: 'paragraph', runs: Run[] }
{ type: 'listItem',  ordered: boolean, depth: number, runs: Run[] }
{ type: 'table',     rows: Run[][][] }   // rows[行][列] = Run[]
{ type: 'image',     sha: string, alt: string }
```

**装飾属性を `true` のときのみ持つ**のは決定性のためである。`{text:'a', bold:false}` と `{text:'a'}` が別物になると、シリアライズ結果が揺れる。

### 正規化HTMLの形式

- **1ブロック = 1行。** ただし `table` のみ複数行に展開する (表の1行変更が1行の差分になるため)
- 行末に `\n`。ファイル末尾にも `\n`
- インライン装飾のネスト順は **bold → italic → underline → strike → link** で固定
- エスケープ: テキスト内の `&` `<` `>` を `&amp;` `&lt;` `&gt;` に。属性値はさらに `"` を `&quot;` に

```html
<h1>就業規則</h1>
<p>第1条 <strong>目的</strong></p>
<li data-list="ul" data-depth="0">在宅勤務は週3日まで認める</li>
<table>
<tr><td>区分</td><td>日数</td></tr>
<tr><td>正社員</td><td>3</td></tr>
</table>
<img data-sha="a3f8b2..." alt="組織図">
```

---

## Task 1: プロジェクトスキャフォールドと clasp 接続

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.claspignore`
- Create: `src/appsscript.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: なし (最初のタスク)
- Produces: `npm test` が動作する環境、`clasp push` が通る GAS プロジェクト

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "agentic-management-gas",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "push": "clasp push",
    "deploy": "clasp deploy"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: vitest.config.js を作成**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: 依存をインストール**

Run: `npm install`
Expected: `node_modules/` が作られ、`vitest` が入る

- [ ] **Step 4: GAS マニフェストを作成**

Create `src/appsscript.json`:

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "DOMAIN"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
```

`executeAs: "USER_ACCESSING"` は spec §11 の PoC 権限モデルに対応する。大規模化時に `USER_DEPLOYING` へ変更する (scaling doc §4)。

- [ ] **Step 5: .claspignore を作成**

```
**/**
!src/**
src/**/*.test.js
```

`.claspignore` は「除外パターン」ではなく **negation を伴うホワイトリスト**として書く。最初の `**/**` ですべて除外し、`!src/**` で `src` 配下だけを戻す。これにより `test/` `docs/` `node_modules/` `package.json` が push されない。

- [ ] **Step 6: .gitignore に node_modules と .clasp.json が入っていることを確認**

Run: `cat .gitignore`
Expected: `node_modules/` と `.clasp.json` の行が存在する (Task 0 のコミットで作成済み)

`.clasp.json` は `scriptId` を含むため、コミットしない。

- [ ] **Step 7: clasp にログイン**

Run: `clasp login`

ブラウザで認可する。すでにログイン済みなら `clasp show-authorized-user` で確認できる。

- [ ] **Step 8: GAS プロジェクトを作成**

Run:

```bash
clasp create-script --type webapp --title "Agentic Management" --rootDir src
```

Expected: `.clasp.json` が生成され、`scriptId` と `rootDir: "src"` が記録される

**clasp 3.x のコマンド名 (検証済み)**: 2.x から改名されているが、旧名がエイリアスとして残っている。

| 用途 | 3.x の正式名 | エイリアス |
|---|---|---|
| スクリプト作成 | `create-script` | `create` |
| デプロイ | `create-deployment` | `deploy` |
| push対象の確認 | `show-file-status` | `status` |
| エディタを開く | `open-script` | — |
| Web Appを開く | `open-web-app` | — |
| ログ確認 | `tail-logs` | `logs` |

- [ ] **Step 9: push が通ることを確認**

Run: `clasp push`
Expected: `src/appsscript.json` が push される (この時点では他にファイルがない)

失敗する場合、`.clasp.json` の `rootDir` が `src` になっているか確認する。

- [ ] **Step 10: コミット**

```bash
git add package.json vitest.config.js .claspignore src/appsscript.json package-lock.json
git commit -m "chore: プロジェクトスキャフォールドとclasp接続をセットアップ"
```

---

## Task 2: テストハーネスと Hash

**Files:**
- Create: `test/harness.js`
- Create: `src/core/Hash.js`
- Create: `src/core/HashGas.gs`
- Test: `test/hash.test.js`

**Interfaces:**
- Consumes: Task 1 の vitest 環境
- Produces:
  - `loadGas(...relativePaths) → object` — GASファイルを評価してグローバル関数を取り出すテストハーネス
  - `bytesToHex(bytes: number[]) → string` — 符号付きバイト配列を hex 文字列に変換 (ピュア)
  - `sha256Hex(content: string) → string` — 文字列の SHA-256 を hex で返す (GAS依存)

### なぜハーネスが必要か

ランタイムコードに `module.exports` を書くと GAS で動かない。逆に `export` を書いても GAS で動かない。**GAS のコードを一切汚さずにテストする**ため、`node:vm` でファイルを評価してコンテキストから関数を取り出す。

- [ ] **Step 1: テストハーネスを作成**

Create `test/harness.js`:

```javascript
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
  const context = vm.createContext({ console });
  for (const rel of relativePaths) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(src, context, { filename: rel });
  }
  return context;
}
```

- [ ] **Step 2: 失敗するテストを書く**

Create `test/hash.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { bytesToHex } = loadGas('src/core/Hash.js');

describe('bytesToHex', () => {
  it('正のバイトを2桁hexに変換する', () => {
    expect(bytesToHex([0, 1, 15, 16, 127])).toBe('00010f107f');
  });

  it('GASが返す負のバイト(-128..-1)を正しく変換する', () => {
    // Utilities.computeDigest は符号付きバイトを返すため、
    // -1 は 0xff、-128 は 0x80 として扱う必要がある
    expect(bytesToHex([-1, -128, -16])).toBe('ff80f0');
  });

  it('空配列は空文字列になる', () => {
    expect(bytesToHex([])).toBe('');
  });

  it('32バイト入力から64文字を返す', () => {
    const bytes = new Array(32).fill(0);
    expect(bytesToHex(bytes)).toHaveLength(64);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `ENOENT: no such file or directory ... src/core/Hash.js`

- [ ] **Step 4: 最小実装を書く**

Create `src/core/Hash.js`:

```javascript
/**
 * 符号付きバイト配列 (GASのUtilities.computeDigestが返す形式) を
 * 小文字hex文字列に変換する。
 *
 * GASは -128..127 の符号付き値を返すため、& 0xFF でマスクしてから
 * 変換する必要がある。
 *
 * @param {number[]} bytes
 * @returns {string} 小文字hex文字列
 */
function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i] & 0xFF;
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS (4 tests)

- [ ] **Step 6: GAS依存のハッシュ関数を書く**

Create `src/core/HashGas.gs`:

```javascript
/**
 * 文字列のSHA-256を小文字hexで返す。
 *
 * @param {string} content
 * @returns {string} 64文字のhex文字列
 */
function sha256Hex(content) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    content,
    Utilities.Charset.UTF_8
  );
  return bytesToHex(bytes);
}

/**
 * Blobの内容のSHA-256を小文字hexで返す。画像のコンテンツアドレッシングに使う。
 *
 * @param {GoogleAppsScript.Base.Blob} blob
 * @returns {string} 64文字のhex文字列
 */
function sha256HexBytes(blob) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    blob.getBytes()
  );
  return bytesToHex(bytes);
}
```

`sha256Hex` は `Utilities` に依存するためローカルテストできない。Task 10 の手動検証で確認する。

- [ ] **Step 7: コミット**

```bash
git add test/harness.js test/hash.test.js src/core/Hash.js src/core/HashGas.gs
git commit -m "feat: node:vmテストハーネスとSHA-256ハッシュ関数を追加"
```

---

## Task 3: Normalize — Block配列 → HTML文字列

**Files:**
- Create: `src/core/Normalize.js`
- Test: `test/normalize.test.js`

**Interfaces:**
- Consumes: なし (完全にピュア)
- Produces:
  - `serializeBlocks(blocks: Block[]) → string` — Block配列を正規化HTML文字列に変換
  - `escapeText(s: string) → string`
  - `escapeAttr(s: string) → string`
  - `normalizeSpace(s: string) → string`
  - `mergeRuns(runs: Run[]) → Run[]`

- [ ] **Step 1: 失敗するテストを書く**

Create `test/normalize.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { serializeBlocks, mergeRuns, normalizeSpace, escapeText } =
  loadGas('src/core/Normalize.js');

const run = (text, attrs) => Object.assign({ text }, attrs || {});

describe('normalizeSpace', () => {
  it('連続空白を1つにまとめる', () => {
    expect(normalizeSpace('a   b')).toBe('a b');
  });

  it('タブと改行も空白として正規化する', () => {
    expect(normalizeSpace('a\t\nb')).toBe('a b');
  });

  it('前後の空白を削除する', () => {
    expect(normalizeSpace('  a b  ')).toBe('a b');
  });
});

describe('escapeText', () => {
  it('HTML特殊文字をエスケープする', () => {
    expect(escapeText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  it('アンパサンドを二重エスケープしない', () => {
    // & を最初に置換することで &lt; が &amp;lt; にならない
    expect(escapeText('<')).toBe('&lt;');
  });
});

describe('mergeRuns', () => {
  it('同じ属性の連続Runを結合する', () => {
    expect(mergeRuns([run('a'), run('b')])).toEqual([run('ab')]);
  });

  it('異なる属性のRunは結合しない', () => {
    const input = [run('a'), run('b', { bold: true })];
    expect(mergeRuns(input)).toEqual(input);
  });

  it('空文字のRunを除去する', () => {
    expect(mergeRuns([run(''), run('a'), run('')])).toEqual([run('a')]);
  });

  it('リンクが異なれば結合しない', () => {
    const input = [
      run('a', { link: 'https://a.example' }),
      run('b', { link: 'https://b.example' }),
    ];
    expect(mergeRuns(input)).toEqual(input);
  });
});

describe('serializeBlocks', () => {
  it('見出しをh1-h6に変換する', () => {
    const blocks = [{ type: 'heading', level: 2, runs: [run('就業規則')] }];
    expect(serializeBlocks(blocks)).toBe('<h2>就業規則</h2>\n');
  });

  it('段落をpに変換する', () => {
    const blocks = [{ type: 'paragraph', runs: [run('第1条')] }];
    expect(serializeBlocks(blocks)).toBe('<p>第1条</p>\n');
  });

  it('装飾をbold→italic→underline→strike→linkの固定順でネストする', () => {
    const blocks = [{
      type: 'paragraph',
      runs: [run('x', {
        bold: true, italic: true, underline: true, strike: true,
        link: 'https://example.com',
      })],
    }];
    expect(serializeBlocks(blocks)).toBe(
      '<p><strong><em><u><s><a href="https://example.com">x</a></s></u></em></strong></p>\n'
    );
  });

  it('リスト項目をdata-list/data-depth付きのliにする', () => {
    const blocks = [
      { type: 'listItem', ordered: false, depth: 0, runs: [run('項目A')] },
      { type: 'listItem', ordered: true, depth: 1, runs: [run('項目B')] },
    ];
    expect(serializeBlocks(blocks)).toBe(
      '<li data-list="ul" data-depth="0">項目A</li>\n' +
      '<li data-list="ol" data-depth="1">項目B</li>\n'
    );
  });

  it('テーブルを行ごとに1行で展開する', () => {
    const blocks = [{
      type: 'table',
      rows: [
        [[run('区分')], [run('日数')]],
        [[run('正社員')], [run('3')]],
      ],
    }];
    expect(serializeBlocks(blocks)).toBe(
      '<table>\n' +
      '<tr><td>区分</td><td>日数</td></tr>\n' +
      '<tr><td>正社員</td><td>3</td></tr>\n' +
      '</table>\n'
    );
  });

  it('画像をdata-sha付きのimgにする', () => {
    const blocks = [{ type: 'image', sha: 'abc123', alt: '組織図' }];
    expect(serializeBlocks(blocks)).toBe('<img data-sha="abc123" alt="組織図">\n');
  });

  it('空の段落も1行として出力する', () => {
    expect(serializeBlocks([{ type: 'paragraph', runs: [] }])).toBe('<p></p>\n');
  });

  it('同一入力から常に同一出力を返す(決定性)', () => {
    const blocks = [
      { type: 'heading', level: 1, runs: [run('A')] },
      { type: 'paragraph', runs: [run('B', { bold: true })] },
    ];
    expect(serializeBlocks(blocks)).toBe(serializeBlocks(blocks));
  });

  it('属性値の二重引用符をエスケープする', () => {
    const blocks = [{ type: 'image', sha: 'x', alt: 'a"b' }];
    expect(serializeBlocks(blocks)).toBe('<img data-sha="x" alt="a&quot;b">\n');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `src/core/Normalize.js` が存在しない

- [ ] **Step 3: 実装を書く**

Create `src/core/Normalize.js`:

```javascript
/**
 * 空白を正規化する。連続する空白文字を1つのスペースにまとめ、前後を削除する。
 * これにより「見た目が同じで空白だけ違う」編集が差分にならない。
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeSpace(s) {
  return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
}

/**
 * テキストノード用のHTMLエスケープ。& を最初に置換して二重エスケープを防ぐ。
 *
 * @param {string} s
 * @returns {string}
 */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 属性値用のHTMLエスケープ。テキスト用に加えて " もエスケープする。
 *
 * @param {string} s
 * @returns {string}
 */
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * Runの装飾属性が同一かどうかを判定する。
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function sameRunAttrs_(a, b) {
  return a.bold === b.bold &&
         a.italic === b.italic &&
         a.underline === b.underline &&
         a.strike === b.strike &&
         a.link === b.link;
}

/**
 * 同じ装飾を持つ連続Runを結合し、空文字のRunを除去する。
 * 決定性を保つために必須の処理。DocumentAppは同じ装飾でもRunを
 * 分割して返すことがあるため、結合しないと差分ノイズになる。
 *
 * @param {object[]} runs
 * @returns {object[]}
 */
function mergeRuns(runs) {
  var out = [];
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (!r.text) continue;
    var last = out.length ? out[out.length - 1] : null;
    if (last && sameRunAttrs_(last, r)) {
      last.text += r.text;
    } else {
      var copy = { text: r.text };
      if (r.bold) copy.bold = true;
      if (r.italic) copy.italic = true;
      if (r.underline) copy.underline = true;
      if (r.strike) copy.strike = true;
      if (r.link) copy.link = r.link;
      out.push(copy);
    }
  }
  return out;
}

/**
 * Run配列をインラインHTMLに変換する。
 * 装飾のネスト順は bold → italic → underline → strike → link で固定。
 * この順序を固定しないと、同じ内容から異なるHTMLが出て差分ノイズになる。
 *
 * @param {object[]} runs
 * @returns {string}
 */
function serializeRuns_(runs) {
  var merged = mergeRuns(runs || []);
  var out = '';
  for (var i = 0; i < merged.length; i++) {
    var r = merged[i];
    var html = escapeText(normalizeSpace(r.text));
    if (r.link) html = '<a href="' + escapeAttr(r.link) + '">' + html + '</a>';
    if (r.strike) html = '<s>' + html + '</s>';
    if (r.underline) html = '<u>' + html + '</u>';
    if (r.italic) html = '<em>' + html + '</em>';
    if (r.bold) html = '<strong>' + html + '</strong>';
    out += html;
  }
  return out;
}

/**
 * Block配列を正規化HTML文字列に変換する。
 *
 * 出力は決定的である: 同じBlock配列からは常にバイト単位で同一の文字列が出る。
 * 1ブロック=1行 (tableのみ複数行) とすることで、行ベースdiffが
 * そのまま意味のある差分になる。
 *
 * @param {object[]} blocks
 * @returns {string} 各行が改行で終わるHTML文字列
 */
function serializeBlocks(blocks) {
  var lines = [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.type === 'heading') {
      var lv = Math.min(6, Math.max(1, b.level));
      lines.push('<h' + lv + '>' + serializeRuns_(b.runs) + '</h' + lv + '>');
    } else if (b.type === 'paragraph') {
      lines.push('<p>' + serializeRuns_(b.runs) + '</p>');
    } else if (b.type === 'listItem') {
      lines.push(
        '<li data-list="' + (b.ordered ? 'ol' : 'ul') + '"' +
        ' data-depth="' + (b.depth || 0) + '">' +
        serializeRuns_(b.runs) + '</li>'
      );
    } else if (b.type === 'table') {
      lines.push('<table>');
      for (var r = 0; r < b.rows.length; r++) {
        var cells = '';
        for (var c = 0; c < b.rows[r].length; c++) {
          cells += '<td>' + serializeRuns_(b.rows[r][c]) + '</td>';
        }
        lines.push('<tr>' + cells + '</tr>');
      }
      lines.push('</table>');
    } else if (b.type === 'image') {
      lines.push(
        '<img data-sha="' + escapeAttr(b.sha) + '"' +
        ' alt="' + escapeAttr(b.alt || '') + '">'
      );
    }
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (全テスト)

- [ ] **Step 5: コミット**

```bash
git add src/core/Normalize.js test/normalize.test.js
git commit -m "feat: Block配列を決定的な正規化HTMLにシリアライズする実装"
```

---

## Task 4: Normalize — HTML文字列 → Block配列 (ラウンドトリップ)

**Files:**
- Modify: `src/core/Normalize.js` (末尾に追記)
- Modify: `test/normalize.test.js` (末尾に追記)

**Interfaces:**
- Consumes: Task 3 の `serializeBlocks`, `mergeRuns`
- Produces:
  - `parseBlocks(html: string) → Block[]` — 正規化HTMLをBlock配列に戻す
  - `unescapeText(s: string) → string`

### なぜパーサが必要か

Phase 2 のマージ書き戻し (HTML → Google Docs) で必須になる。また **ラウンドトリップテスト
(`parseBlocks(serializeBlocks(b)) === b`) が、シリアライザの正しさを検証する最も強力な手段**である。

パーサは**自分が出力したHTMLだけを読めばよい**ため、汎用HTMLパーサは不要。行ベースの
正規表現で十分に堅牢に書ける。

- [ ] **Step 1: 失敗するテストを追記**

Append to `test/normalize.test.js`:

```javascript
describe('parseBlocks', () => {
  const { parseBlocks } = loadGas('src/core/Normalize.js');

  it('見出しをパースする', () => {
    expect(parseBlocks('<h2>就業規則</h2>\n')).toEqual([
      { type: 'heading', level: 2, runs: [{ text: '就業規則' }] },
    ]);
  });

  it('装飾のネストをパースする', () => {
    const html = '<p><strong><em>x</em></strong></p>\n';
    expect(parseBlocks(html)).toEqual([
      { type: 'paragraph', runs: [{ text: 'x', bold: true, italic: true }] },
    ]);
  });

  it('リンクをパースする', () => {
    const html = '<p><a href="https://example.com">x</a></p>\n';
    expect(parseBlocks(html)).toEqual([
      { type: 'paragraph', runs: [{ text: 'x', link: 'https://example.com' }] },
    ]);
  });

  it('リスト項目をパースする', () => {
    const html = '<li data-list="ol" data-depth="2">項目</li>\n';
    expect(parseBlocks(html)).toEqual([
      { type: 'listItem', ordered: true, depth: 2, runs: [{ text: '項目' }] },
    ]);
  });

  it('テーブルをパースする', () => {
    const html = '<table>\n<tr><td>A</td><td>B</td></tr>\n</table>\n';
    expect(parseBlocks(html)).toEqual([
      { type: 'table', rows: [[[{ text: 'A' }], [{ text: 'B' }]]] },
    ]);
  });

  it('画像をパースする', () => {
    expect(parseBlocks('<img data-sha="abc" alt="図">\n')).toEqual([
      { type: 'image', sha: 'abc', alt: '図' },
    ]);
  });

  it('エスケープされた文字を復元する', () => {
    expect(parseBlocks('<p>a &amp; b &lt; c</p>\n')).toEqual([
      { type: 'paragraph', runs: [{ text: 'a & b < c' }] },
    ]);
  });

  it('空文字列は空配列になる', () => {
    expect(parseBlocks('')).toEqual([]);
  });
});

describe('ラウンドトリップ', () => {
  const { parseBlocks } = loadGas('src/core/Normalize.js');

  const cases = [
    {
      name: '見出しと段落',
      blocks: [
        { type: 'heading', level: 1, runs: [{ text: '就業規則' }] },
        { type: 'paragraph', runs: [{ text: '第1条 目的' }] },
      ],
    },
    {
      name: '全装飾とリンク',
      blocks: [{
        type: 'paragraph',
        runs: [{
          text: 'x', bold: true, italic: true, underline: true,
          strike: true, link: 'https://example.com',
        }],
      }],
    },
    {
      name: '混在するリスト',
      blocks: [
        { type: 'listItem', ordered: false, depth: 0, runs: [{ text: 'A' }] },
        { type: 'listItem', ordered: true, depth: 1, runs: [{ text: 'B' }] },
      ],
    },
    {
      name: 'テーブル',
      blocks: [{
        type: 'table',
        rows: [
          [[{ text: '区分' }], [{ text: '日数' }]],
          [[{ text: '正社員' }], [{ text: '3' }]],
        ],
      }],
    },
    {
      name: '画像',
      blocks: [{ type: 'image', sha: 'abc123', alt: '組織図' }],
    },
    {
      name: 'エスケープが必要な文字',
      blocks: [{ type: 'paragraph', runs: [{ text: 'a < b & c > d' }] }],
    },
  ];

  for (const c of cases) {
    it(`${c.name}: parse(serialize(x)) === x`, () => {
      expect(parseBlocks(serializeBlocks(c.blocks))).toEqual(c.blocks);
    });
  }

  for (const c of cases) {
    it(`${c.name}: serialize(parse(serialize(x))) === serialize(x)`, () => {
      const html = serializeBlocks(c.blocks);
      expect(serializeBlocks(parseBlocks(html))).toBe(html);
    });
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `parseBlocks is not a function`

- [ ] **Step 3: パーサを実装**

Append to `src/core/Normalize.js`:

```javascript
/**
 * escapeText の逆変換。&amp; を最後に戻して二重デコードを防ぐ。
 *
 * @param {string} s
 * @returns {string}
 */
function unescapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * インラインHTMLをRun配列にパースする。
 * serializeRuns_ が出力する形式 (固定ネスト順) のみを対象とする。
 *
 * @param {string} inner
 * @returns {object[]}
 */
function parseRuns_(inner) {
  var runs = [];
  var re = /<(strong|em|u|s|a)\b([^>]*)>|<\/(strong|em|u|s|a)>|([^<]+)/g;
  var stack = [];
  var m;
  while ((m = re.exec(inner)) !== null) {
    if (m[1]) {
      var frame = { tag: m[1] };
      if (m[1] === 'a') {
        var href = /href="([^"]*)"/.exec(m[2] || '');
        frame.link = href ? unescapeText(href[1]) : '';
      }
      stack.push(frame);
    } else if (m[3]) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === m[3]) { stack.splice(i, 1); break; }
      }
    } else if (m[4]) {
      var run = { text: unescapeText(m[4]) };
      for (var j = 0; j < stack.length; j++) {
        var t = stack[j].tag;
        if (t === 'strong') run.bold = true;
        else if (t === 'em') run.italic = true;
        else if (t === 'u') run.underline = true;
        else if (t === 's') run.strike = true;
        else if (t === 'a') run.link = stack[j].link;
      }
      runs.push(run);
    }
  }
  return mergeRuns(runs);
}

/**
 * <tr>...</tr> の1行をセルのRun配列の配列にパースする。
 *
 * @param {string} line
 * @returns {object[][]}
 */
function parseTableRow_(line) {
  var cells = [];
  var re = /<td>([\s\S]*?)<\/td>/g;
  var m;
  while ((m = re.exec(line)) !== null) {
    cells.push(parseRuns_(m[1]));
  }
  return cells;
}

/**
 * 正規化HTML文字列をBlock配列にパースする。
 *
 * serializeBlocks が出力した形式のみを対象とする限定パーサである。
 * 汎用HTMLは扱えないが、その必要はない。
 *
 * @param {string} html
 * @returns {object[]}
 */
function parseBlocks(html) {
  var blocks = [];
  var lines = String(html == null ? '' : html).split('\n');
  var table = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;

    if (table !== null) {
      if (line === '</table>') {
        blocks.push({ type: 'table', rows: table });
        table = null;
      } else if (line.indexOf('<tr>') === 0) {
        table.push(parseTableRow_(line));
      }
      continue;
    }

    if (line === '<table>') { table = []; continue; }

    var mh = /^<h([1-6])>([\s\S]*)<\/h\1>$/.exec(line);
    if (mh) {
      blocks.push({
        type: 'heading',
        level: Number(mh[1]),
        runs: parseRuns_(mh[2]),
      });
      continue;
    }

    var mp = /^<p>([\s\S]*)<\/p>$/.exec(line);
    if (mp) {
      blocks.push({ type: 'paragraph', runs: parseRuns_(mp[1]) });
      continue;
    }

    var ml = /^<li data-list="(ul|ol)" data-depth="(\d+)">([\s\S]*)<\/li>$/.exec(line);
    if (ml) {
      blocks.push({
        type: 'listItem',
        ordered: ml[1] === 'ol',
        depth: Number(ml[2]),
        runs: parseRuns_(ml[3]),
      });
      continue;
    }

    var mi = /^<img data-sha="([^"]*)" alt="([^"]*)">$/.exec(line);
    if (mi) {
      blocks.push({
        type: 'image',
        sha: unescapeText(mi[1]),
        alt: unescapeText(mi[2]),
      });
      continue;
    }
  }

  // <table> が閉じられずに終わった場合も取りこぼさない
  if (table !== null) blocks.push({ type: 'table', rows: table });

  return blocks;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (全テスト。ラウンドトリップ12件を含む)

失敗する場合、`parseRuns_` の正規表現が `serializeRuns_` の出力形式と
一致しているかを確認する。両者は対になっている必要がある。

- [ ] **Step 5: コミット**

```bash
git add src/core/Normalize.js test/normalize.test.js
git commit -m "feat: 正規化HTMLのパーサとラウンドトリップテストを追加"
```

---

## Task 5: スプレッドシートDBアクセス層

**Files:**
- Create: `src/core/Db.gs`

**Interfaces:**
- Consumes: Task 6 の `repoConfig()` (先に書くが、Task 6 完了まで実行はできない)
- Produces:
  - `dbReadAll(table: string) → object[]` — 全行をオブジェクト配列で返す
  - `dbAppend(table: string, obj: object) → void`
  - `dbFindOne(table: string, key: string, value: any) → object|null`
  - `dbUpdate(table: string, key: string, value: any, patch: object) → boolean`
  - `DB_SCHEMA() → object` — テーブル名 → カラム名配列

### 設計方針

**この層は scaling doc §10 のチェックリストに従い、アプリケーションロジックから
`SpreadsheetApp` を隠蔽する。** 将来シャーディング実装に差し替えるとき、
この4関数のシグネチャを保てばアプリ側は変更不要になる。

- [ ] **Step 1: Db.gs を作成**

```javascript
/**
 * テーブル定義。ヘッダ行のカラム名と順序を決める唯一の情報源。
 *
 * トップレベルのconstではなく関数として公開する。GASはファイルを
 * ファイル名順に読み込むため、トップレベル初期化は順序依存になる。
 *
 * @returns {Object<string, string[]>}
 */
function DB_SCHEMA() {
  return {
    files: ['fileId', 'path', 'type', 'registeredAt', 'registeredBy'],
    commits: ['sha', 'parentSha', 'branch', 'fileId', 'blobSha', 'author', 'message', 'timestamp'],
    branches: ['name', 'headSha', 'baseSha', 'state', 'workingFolderId', 'createdBy', 'createdAt'],
    pulls: ['number', 'title', 'body', 'sourceBranch', 'targetBranch', 'state', 'author', 'createdAt', 'mergedAt'],
    reviews: ['prNumber', 'reviewer', 'state', 'body', 'at'],
    issues: ['number', 'title', 'body', 'state', 'assignee', 'labels', 'linkedFileIds', 'linkedPr', 'createdAt', 'closedAt'],
    project_items: ['issueNumber', 'column', 'order'],
  };
}

/**
 * テーブルに対応するシートを取得する。存在しなければヘッダ付きで作成する。
 *
 * @param {string} table
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function dbSheet_(table) {
  var schema = DB_SCHEMA();
  var cols = schema[table];
  if (!cols) throw new Error('未定義のテーブルです: ' + table);

  var ss = SpreadsheetApp.openById(repoConfig().dbId);
  var sheet = ss.getSheetByName(table);
  if (!sheet) {
    sheet = ss.insertSheet(table);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * テーブルの全行をオブジェクト配列として読む。
 *
 * 注意: 行数に比例して遅くなる。数万行規模ではシャーディングが必要
 * (scaling doc §2.2 を参照)。
 *
 * @param {string} table
 * @returns {object[]}
 */
function dbReadAll(table) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < cols.length; c++) {
      obj[cols[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

/**
 * テーブルに1行追記する。スキーマに無いキーは無視される。
 *
 * @param {string} table
 * @param {object} obj
 */
function dbAppend(table, obj) {
  var cols = DB_SCHEMA()[table];
  var row = [];
  for (var i = 0; i < cols.length; i++) {
    var v = obj[cols[i]];
    row.push(v === undefined || v === null ? '' : v);
  }
  dbSheet_(table).appendRow(row);
}

/**
 * key === value を満たす最初の行を返す。見つからなければ null。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @returns {object|null}
 */
function dbFindOne(table, key, value) {
  var rows = dbReadAll(table);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key]) === String(value)) return rows[i];
  }
  return null;
}

/**
 * key === value を満たす最初の行に patch を適用する。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @param {object} patch
 * @returns {boolean} 更新した行があれば true
 */
function dbUpdate(table, key, value, patch) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return false;

  var keyCol = cols.indexOf(key);
  if (keyCol < 0) throw new Error('未定義のカラムです: ' + key);

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][keyCol]) !== String(value)) continue;
    for (var c = 0; c < cols.length; c++) {
      if (Object.prototype.hasOwnProperty.call(patch, cols[c])) {
        values[r][c] = patch[cols[c]];
      }
    }
    sheet.getRange(r + 2, 1, 1, cols.length).setValues([values[r]]);
    return true;
  }
  return false;
}
```

- [ ] **Step 2: コミット**

```bash
git add src/core/Db.gs
git commit -m "feat: スプレッドシートDBアクセス層を追加"
```

このタスクの動作確認は Task 6 の `repoInit()` 実行後に行う (Task 6 Step 5)。

---

## Task 6: Drive レイアウト初期化と ObjectStore

**Files:**
- Create: `src/core/Repo.gs`
- Create: `src/core/ObjectStore.gs`

**Interfaces:**
- Consumes: Task 5 の `dbSheet_`, `DB_SCHEMA`
- Produces:
  - `repoInit(rootFolderName: string) → object` — Driveレイアウトを作成し設定を保存
  - `repoConfig() → {rootId, mainId, branchesId, gitId, objectsId, dbId}`
  - `objectPut(sha: string, content: string) → void` — テキストblob保存
  - `objectPutBlob(sha: string, blob: Blob, ext: string) → void` — バイナリblob保存
  - `objectGet(sha: string) → string|null`
  - `objectExists(sha: string, ext?: string) → boolean`

- [ ] **Step 1: Repo.gs を作成**

```javascript
/**
 * リポジトリ設定を保存するPropertiesServiceのキー。
 *
 * @returns {string}
 */
function REPO_CONFIG_KEY() {
  return 'repoConfig';
}

/**
 * リポジトリのDriveレイアウトを作成し、設定をPropertiesServiceに保存する。
 * 初回セットアップ時にGASエディタから手動で1回だけ実行する。
 *
 * 作成される構造 (spec §3.1):
 *   <rootFolderName>/
 *   ├── main/
 *   ├── branches/
 *   └── .git/
 *       ├── objects/
 *       └── repo-db (スプレッドシート)
 *
 * @param {string} rootFolderName ルートフォルダ名
 * @returns {object} 保存された設定
 */
function repoInit(rootFolderName) {
  if (!/^[^\/\\]{1,100}$/.test(String(rootFolderName || ''))) {
    throw new Error('フォルダ名が不正です: ' + rootFolderName);
  }

  var root = DriveApp.createFolder(rootFolderName);
  var main = root.createFolder('main');
  var branches = root.createFolder('branches');
  var git = root.createFolder('.git');
  var objects = git.createFolder('objects');

  var db = SpreadsheetApp.create(rootFolderName + ' repo-db');
  var dbFile = DriveApp.getFileById(db.getId());
  git.addFile(dbFile);
  DriveApp.getRootFolder().removeFile(dbFile);

  var config = {
    rootId: root.getId(),
    mainId: main.getId(),
    branchesId: branches.getId(),
    gitId: git.getId(),
    objectsId: objects.getId(),
    dbId: db.getId(),
  };

  PropertiesService.getScriptProperties()
    .setProperty(REPO_CONFIG_KEY(), JSON.stringify(config));

  // スキーマ定義済みのシートをすべて先に作っておく
  var schema = DB_SCHEMA();
  for (var table in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, table)) dbSheet_(table);
  }
  var sheet1 = db.getSheetByName('シート1') || db.getSheetByName('Sheet1');
  if (sheet1) db.deleteSheet(sheet1);

  Logger.log('リポジトリを初期化しました: ' + JSON.stringify(config));
  return config;
}

/**
 * 保存済みのリポジトリ設定を返す。未初期化ならエラーを投げる。
 *
 * @returns {{rootId:string, mainId:string, branchesId:string, gitId:string, objectsId:string, dbId:string}}
 */
function repoConfig() {
  var raw = PropertiesService.getScriptProperties().getProperty(REPO_CONFIG_KEY());
  if (!raw) {
    throw new Error('リポジトリが初期化されていません。repoInit() を先に実行してください。');
  }
  return JSON.parse(raw);
}

/**
 * 管理対象ファイルを登録する。
 *
 * @param {string} fileId Drive fileId
 * @param {string} path リポジトリ内論理パス
 * @returns {object} 登録された files 行
 */
function repoRegisterFile(fileId, path) {
  if (!/^[^\\]{1,200}$/.test(String(path || ''))) {
    throw new Error('パスが不正です: ' + path);
  }
  if (dbFindOne('files', 'fileId', fileId)) {
    throw new Error('すでに登録されています: ' + fileId);
  }

  var mime = DriveApp.getFileById(fileId).getMimeType();
  var type;
  if (mime === MimeType.GOOGLE_DOCS) type = 'doc';
  else if (mime === MimeType.GOOGLE_SHEETS) type = 'sheet';
  else if (mime === MimeType.GOOGLE_SLIDES) type = 'slide';
  else throw new Error('対応していないファイル種別です: ' + mime);

  var row = {
    fileId: fileId,
    path: path,
    type: type,
    registeredAt: new Date(),
    registeredBy: Session.getActiveUser().getEmail(),
  };
  dbAppend('files', row);
  return row;
}
```

- [ ] **Step 2: ObjectStore.gs を作成**

```javascript
/**
 * SHAからobjectsフォルダ内のファイル名を解決する。
 *
 * PoCではフラットに <sha>.<ext> とするが、この関数にパス解決を
 * 閉じ込めておくことで、将来 Git 同様の 2文字シャーディング
 * (objects/ab/cdef...) へ差し替えられる (scaling doc §2.1)。
 *
 * @param {string} sha
 * @param {string} [ext] 拡張子。省略時は 'html'
 * @returns {string} ファイル名
 */
function objectPath_(sha, ext) {
  if (!/^[0-9a-f]{64}$/.test(String(sha || ''))) {
    throw new Error('SHAの形式が不正です: ' + sha);
  }
  var e = ext || 'html';
  if (!/^[a-z0-9]{1,8}$/.test(e)) {
    throw new Error('拡張子が不正です: ' + ext);
  }
  return sha + '.' + e;
}

/**
 * objectsフォルダを返す。
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function objectsFolder_() {
  return DriveApp.getFolderById(repoConfig().objectsId);
}

/**
 * テキストblobを保存する。すでに同じSHAが存在すれば何もしない。
 *
 * コンテンツアドレッシングにより、同一内容のblobは1つしか保存されない。
 *
 * @param {string} sha
 * @param {string} content
 */
function objectPut(sha, content) {
  var name = objectPath_(sha, 'html');
  var folder = objectsFolder_();
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(name, content, MimeType.PLAIN_TEXT);
}

/**
 * バイナリblob (画像など) を保存する。すでに同じSHAが存在すれば何もしない。
 *
 * 重要: 画像をテキストとして保存してはならない。getDataAsString() で
 * 文字列化するとUTF-8への再エンコードでバイト列が破壊される。
 * Blobのまま createFile に渡すこと。
 *
 * @param {string} sha
 * @param {GoogleAppsScript.Base.Blob} blob
 * @param {string} ext 拡張子 (例: 'png')
 */
function objectPutBlob(sha, blob, ext) {
  var name = objectPath_(sha, ext);
  var folder = objectsFolder_();
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(blob.copyBlob().setName(name));
}

/**
 * テキストblobを読む。存在しなければ null。
 *
 * @param {string} sha
 * @returns {string|null}
 */
function objectGet(sha) {
  var it = objectsFolder_().getFilesByName(objectPath_(sha, 'html'));
  return it.hasNext() ? it.next().getBlob().getDataAsString('UTF-8') : null;
}

/**
 * blobの存在を確認する。
 *
 * @param {string} sha
 * @param {string} [ext] 拡張子。省略時は 'html'
 * @returns {boolean}
 */
function objectExists(sha, ext) {
  return objectsFolder_().getFilesByName(objectPath_(sha, ext)).hasNext();
}
```

- [ ] **Step 3: push する**

Run: `clasp push`
Expected: `Main.gs` を除く全ファイルが push される

- [ ] **Step 4: GASエディタで repoInit を実行**

1. Run: `clasp open-script` (またはブラウザで GAS プロジェクトを開く)
2. 関数選択で `repoInit` を選び、引数を渡すためのラッパー関数を一時的に作るか、
   エディタのコンソールで実行する。**確実な方法**は以下の一時関数を
   `src/Main.gs` に書いて push し、それを実行することである:

```javascript
function setupRepo() {
  return repoInit('agentic-management');
}
```

3. 初回実行時に OAuth 認可画面が出るので承認する
4. 実行ログに設定JSONが出ることを確認

- [ ] **Step 5: Drive とスプレッドシートを目視確認**

Drive で以下を確認する:

- `agentic-management/` フォルダが存在する
- 配下に `main/` `branches/` `.git/` がある
- `.git/objects/` がある
- `.git/agentic-management repo-db` スプレッドシートがあり、
  **`files` `commits` `branches` `pulls` `reviews` `issues` `project_items`
  の7シートがヘッダ付きで作られている**
- デフォルトの「シート1」が削除されている

- [ ] **Step 6: コミット**

```bash
git add src/core/Repo.gs src/core/ObjectStore.gs
git commit -m "feat: Driveレイアウト初期化とObjectStoreを追加"
```

---

## Task 7: Docs レンダラ

**Files:**
- Create: `src/render/DocRenderer.gs`

**Interfaces:**
- Consumes: Task 3 の `serializeBlocks` と `mergeRuns`、Task 6 の `objectPutBlob`、Task 2 の `sha256HexBytes`
- Produces:
  - `renderDocBlocks(fileId: string) → Block[]`
  - `renderDoc(fileId: string) → string` — 正規化HTML

- [ ] **Step 1: DocRenderer.gs を作成**

```javascript
/**
 * DocumentAppのTextから装飾情報付きのRun配列を抽出する。
 *
 * getTextAttributeIndices() は装飾が変わる位置のインデックスを返す。
 * 先頭が0でない場合があるため補う必要がある。
 *
 * @param {GoogleAppsScript.Document.Text} textEl
 * @returns {object[]} Run配列
 */
function docTextToRuns_(textEl) {
  var s = textEl.getText();
  if (!s) return [];

  var bounds = textEl.getTextAttributeIndices().slice();
  if (bounds.length === 0 || bounds[0] !== 0) bounds.unshift(0);

  var runs = [];
  for (var i = 0; i < bounds.length; i++) {
    var start = bounds[i];
    var end = (i + 1 < bounds.length) ? bounds[i + 1] : s.length;
    if (end <= start) continue;

    var run = { text: s.substring(start, end) };
    if (textEl.isBold(start)) run.bold = true;
    if (textEl.isItalic(start)) run.italic = true;
    if (textEl.isUnderline(start)) run.underline = true;
    if (textEl.isStrikethrough(start)) run.strike = true;
    var url = textEl.getLinkUrl(start);
    if (url) run.link = url;

    runs.push(run);
  }
  return mergeRuns(runs);
}

/**
 * ParagraphHeadingをHTMLの見出しレベル(1-6)に変換する。
 * 見出しでない場合は0を返す。
 *
 * @param {GoogleAppsScript.Document.ParagraphHeading} heading
 * @returns {number}
 */
function docHeadingLevel_(heading) {
  var H = DocumentApp.ParagraphHeading;
  if (heading === H.HEADING1 || heading === H.TITLE) return 1;
  if (heading === H.HEADING2 || heading === H.SUBTITLE) return 2;
  if (heading === H.HEADING3) return 3;
  if (heading === H.HEADING4) return 4;
  if (heading === H.HEADING5) return 5;
  if (heading === H.HEADING6) return 6;
  return 0;
}

/**
 * 画像のMIMEタイプから保存用の拡張子を決める。
 *
 * @param {string} contentType
 * @returns {string}
 */
function imageExt_(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/gif') return 'gif';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/bmp') return 'bmp';
  return 'bin';
}

/**
 * 段落内のInlineImageを抽出し、blobをobjectsに保存してimageブロックを返す。
 *
 * 画像はコンテンツアドレッシングで保存する。同じ画像が複数箇所にあっても
 * 実体は1つしか保存されない。
 *
 * 注意: 画像は必ず objectPutBlob でBlobのまま保存する。文字列化すると
 * バイト列が破壊される。
 *
 * @param {GoogleAppsScript.Document.Paragraph|GoogleAppsScript.Document.ListItem} para
 * @returns {object[]} imageブロックの配列
 */
function docExtractImages_(para) {
  var out = [];
  var n = para.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = para.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.INLINE_IMAGE) continue;

    var img = child.asInlineImage();
    var blob = img.getBlob();
    var sha = sha256HexBytes(blob);
    objectPutBlob(sha, blob, imageExt_(blob.getContentType()));

    out.push({
      type: 'image',
      sha: sha,
      alt: img.getAltTitle() || img.getAltDescription() || '',
    });
  }
  return out;
}

/**
 * TableCellからRun配列を抽出する。セル内の全段落のテキストを連結する。
 *
 * @param {GoogleAppsScript.Document.TableCell} cell
 * @returns {object[]}
 */
function docCellToRuns_(cell) {
  var runs = [];
  var n = cell.getNumChildren();
  for (var i = 0; i < n; i++) {
    var child = cell.getChild(i);
    var t = child.getType();
    if (t === DocumentApp.ElementType.PARAGRAPH) {
      runs = runs.concat(docTextToRuns_(child.asParagraph().editAsText()));
    } else if (t === DocumentApp.ElementType.LIST_ITEM) {
      runs = runs.concat(docTextToRuns_(child.asListItem().editAsText()));
    }
  }
  return mergeRuns(runs);
}

/**
 * Google DocsをBlock配列に変換する。
 *
 * @param {string} fileId
 * @returns {object[]} Block配列
 */
function renderDocBlocks(fileId) {
  var body = DocumentApp.openById(fileId).getBody();
  var blocks = [];
  var ET = DocumentApp.ElementType;

  var n = body.getNumChildren();
  for (var i = 0; i < n; i++) {
    var el = body.getChild(i);
    var type = el.getType();

    if (type === ET.PARAGRAPH) {
      var para = el.asParagraph();
      var images = docExtractImages_(para);
      var runs = docTextToRuns_(para.editAsText());
      var level = docHeadingLevel_(para.getHeading());

      if (runs.length > 0 || images.length === 0) {
        blocks.push(level > 0
          ? { type: 'heading', level: level, runs: runs }
          : { type: 'paragraph', runs: runs });
      }
      for (var im = 0; im < images.length; im++) blocks.push(images[im]);

    } else if (type === ET.LIST_ITEM) {
      var li = el.asListItem();
      var glyph = li.getGlyphType();
      var ordered = (
        glyph === DocumentApp.GlyphType.NUMBER ||
        glyph === DocumentApp.GlyphType.LATIN_UPPER ||
        glyph === DocumentApp.GlyphType.LATIN_LOWER ||
        glyph === DocumentApp.GlyphType.ROMAN_UPPER ||
        glyph === DocumentApp.GlyphType.ROMAN_LOWER
      );
      blocks.push({
        type: 'listItem',
        ordered: ordered,
        depth: li.getNestingLevel(),
        runs: docTextToRuns_(li.editAsText()),
      });

    } else if (type === ET.TABLE) {
      var table = el.asTable();
      var rows = [];
      for (var r = 0; r < table.getNumRows(); r++) {
        var tr = table.getRow(r);
        var cells = [];
        for (var c = 0; c < tr.getNumCells(); c++) {
          cells.push(docCellToRuns_(tr.getCell(c)));
        }
        rows.push(cells);
      }
      blocks.push({ type: 'table', rows: rows });
    }
    // PAGE_BREAK / HORIZONTAL_RULE は版管理の対象外として無視する
  }

  return blocks;
}

/**
 * Google Docsを正規化HTMLに変換する。
 *
 * @param {string} fileId
 * @returns {string}
 */
function renderDoc(fileId) {
  return serializeBlocks(renderDocBlocks(fileId));
}
```

- [ ] **Step 2: push する**

Run: `clasp push`

- [ ] **Step 3: テスト用の Google Doc を用意する**

Drive の `agentic-management/main/` に、以下を含む Google Doc を手動で作成する:

- タイトル: `就業規則`
- 見出し1「就業規則」
- 見出し2「第1章 総則」
- 通常段落（**太字**、*斜体*、リンクを1つずつ含む）
- 箇条書き2項目（うち1つはネストさせる）
- 番号付きリスト2項目
- 2行2列の表
- 画像1つ（任意の画像を貼り付け、代替テキストを設定）

- [ ] **Step 4: レンダラを実行して出力を確認**

`src/Main.gs` に一時的な検証関数を追加して push し、GASエディタで実行する:

```javascript
function debugRenderDoc() {
  var fileId = 'ここにテスト用DocのfileIdを入れる';
  var html = renderDoc(fileId);
  Logger.log(html);
  return html;
}
```

Expected: 実行ログに正規化HTMLが出力される。以下を確認する:

- 見出しが `<h1>` `<h2>` になっている
- 太字が `<strong>`、斜体が `<em>`、リンクが `<a href="...">` になっている
- 箇条書きが `<li data-list="ul" data-depth="0">` / `data-depth="1"` になっている
- 番号付きリストが `data-list="ol"` になっている
- 表が `<table>` / `<tr><td>...</td></tr>` / `</table>` の複数行になっている
- 画像が `<img data-sha="<64桁hex>" alt="...">` になっている
- **`.git/objects/` に `<64桁hex>.png` のような画像blobファイルが作られており、Driveでプレビューすると元の画像が表示される** (テキスト化による破壊が起きていないことの確認)

- [ ] **Step 5: 決定性を確認**

`debugRenderDoc` を2回実行し、**2回の出力が完全に同一である**ことを確認する。
異なる場合は `mergeRuns` が効いていないか、`getTextAttributeIndices` の
扱いに問題がある。

- [ ] **Step 6: ラウンドトリップ検証スクリプトを作成**

合成データだけでなく**実際の Doc から出た HTML** でラウンドトリップが成立するかを
確認する。これが Phase 2 のマージ書き戻しが可能であることの証明になる。

Create `test/roundtrip-check.js`:

```javascript
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
```

- [ ] **Step 7: 実際のDoc出力でラウンドトリップを検証**

`debugRenderDoc` の実行ログに出た HTML を、ローカルのスクラッチファイルに保存する
(例: `/tmp/rendered.html`)。実行ログからのコピーで末尾改行が失われやすいため、
**ファイル末尾が改行1つで終わっていることを確認する。**

Run: `node test/roundtrip-check.js /tmp/rendered.html`
Expected: `ROUND-TRIP OK (NNNN 文字)`

失敗した場合、出力される差分行を見て `parseRuns_` または `serializeRuns_` を修正し、
その入力を再現するケースを `test/normalize.test.js` のラウンドトリップ配列に
**恒久的なテストケースとして追加してから**修正すること。

- [ ] **Step 8: コミット**

```bash
git add src/render/DocRenderer.gs test/roundtrip-check.js
git commit -m "feat: Google DocsをBlock配列に変換するレンダラを追加"
```

---

## Task 8: ライブキャッシュ

**Files:**
- Create: `src/render/LiveCache.gs`

**Interfaces:**
- Consumes: Task 7 の `renderDoc`
- Produces:
  - `liveHtml(fileId: string) → string` — キャッシュ付きライブHTML取得
  - `liveCacheInvalidate(fileId: string) → void`

### 設計の要点 (spec §4.2)

キャッシュキーに `lastUpdated` のミリ秒を含めることで、**編集された瞬間に
キーが変わり、キャッシュが自然に無効化される。** 同期ジョブもトリガーも不要である。

`CacheService` は 1キー100KBの上限があるため、チャンク分割して保存する。

- [ ] **Step 1: LiveCache.gs を作成**

```javascript
/**
 * CacheServiceの1キーあたりの安全なサイズ上限(バイト)。
 * 公称100KBだが、UTF-8マルチバイトとキー自体のオーバーヘッドを考慮して
 * 余裕を持たせる。
 *
 * @returns {number}
 */
function CACHE_CHUNK_SIZE() {
  return 80 * 1024;
}

/**
 * キャッシュのTTL(秒)。CacheServiceの上限は6時間。
 *
 * @returns {number}
 */
function CACHE_TTL_SEC() {
  return 6 * 60 * 60;
}

/**
 * ファイルの更新時刻を含むキャッシュキーのプレフィックスを作る。
 *
 * @param {string} fileId
 * @param {number} lastUpdatedMs
 * @returns {string}
 */
function liveCacheKey_(fileId, lastUpdatedMs) {
  return 'live:' + fileId + ':' + lastUpdatedMs;
}

/**
 * チャンク分割してキャッシュに保存する。
 *
 * @param {string} prefix
 * @param {string} html
 */
function liveCachePut_(prefix, html) {
  var cache = CacheService.getScriptCache();
  var size = CACHE_CHUNK_SIZE();
  var chunks = [];
  for (var i = 0; i < html.length; i += size) {
    chunks.push(html.substring(i, i + size));
  }

  var payload = {};
  payload[prefix + ':meta'] = String(chunks.length);
  for (var c = 0; c < chunks.length; c++) {
    payload[prefix + ':' + c] = chunks[c];
  }
  cache.putAll(payload, CACHE_TTL_SEC());
}

/**
 * チャンク分割されたキャッシュを復元する。1つでも欠けていれば null を返す。
 *
 * @param {string} prefix
 * @returns {string|null}
 */
function liveCacheGet_(prefix) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(prefix + ':meta');
  if (!meta) return null;

  var count = Number(meta);
  if (!(count >= 0)) return null;

  var keys = [];
  for (var c = 0; c < count; c++) keys.push(prefix + ':' + c);

  var got = cache.getAll(keys);
  var out = '';
  for (var i = 0; i < keys.length; i++) {
    var part = got[keys[i]];
    if (part === undefined || part === null) return null;  // 部分的な追い出し
    out += part;
  }
  return out;
}

/**
 * ファイル種別に応じたレンダラを呼ぶ。
 *
 * Phase 1 では doc のみ対応。Phase 3 で sheet / slide を追加する。
 *
 * @param {string} fileId
 * @param {string} type 'doc' | 'sheet' | 'slide'
 * @returns {string}
 */
function renderByType_(fileId, type) {
  if (type === 'doc') return renderDoc(fileId);
  throw new Error('このファイル種別はまだ対応していません: ' + type);
}

/**
 * ファイルの現在の内容を正規化HTMLで返す (ライブ層)。
 *
 * キャッシュキーにファイルの更新時刻を含めるため、編集されると
 * 自動的に再レンダリングされる。ポーリングも同期ジョブも不要。
 *
 * @param {string} fileId
 * @returns {string}
 */
function liveHtml(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません: ' + fileId);

  var lastUpdatedMs = DriveApp.getFileById(fileId).getLastUpdated().getTime();
  var prefix = liveCacheKey_(fileId, lastUpdatedMs);

  var cached = liveCacheGet_(prefix);
  if (cached !== null) return cached;

  var html = renderByType_(fileId, row.type);
  liveCachePut_(prefix, html);
  return html;
}

/**
 * 指定ファイルのキャッシュを明示的に無効化する。
 *
 * 通常は更新時刻ベースで自動無効化されるため不要だが、
 * レンダラを変更した直後などに使う。
 *
 * @param {string} fileId
 */
function liveCacheInvalidate(fileId) {
  var lastUpdatedMs = DriveApp.getFileById(fileId).getLastUpdated().getTime();
  var prefix = liveCacheKey_(fileId, lastUpdatedMs);
  var cache = CacheService.getScriptCache();
  var meta = cache.get(prefix + ':meta');
  if (!meta) return;

  var keys = [prefix + ':meta'];
  for (var c = 0; c < Number(meta); c++) keys.push(prefix + ':' + c);
  cache.removeAll(keys);
}
```

- [ ] **Step 2: push する**

Run: `clasp push`

- [ ] **Step 3: 検証関数で動作確認**

`src/Main.gs` に追加して実行する:

```javascript
function debugLiveHtml() {
  var fileId = 'テスト用DocのfileId';
  repoRegisterFile(fileId, '規定/就業規則');   // 初回のみ

  var t1 = new Date().getTime();
  var a = liveHtml(fileId);
  var t2 = new Date().getTime();
  var b = liveHtml(fileId);
  var t3 = new Date().getTime();

  Logger.log('1回目(レンダリング): ' + (t2 - t1) + 'ms');
  Logger.log('2回目(キャッシュ):   ' + (t3 - t2) + 'ms');
  Logger.log('内容が一致: ' + (a === b));
  Logger.log('長さ: ' + a.length);
}
```

Expected:
- 1回目は数百ms〜数秒
- **2回目は明確に速い (数十ms程度)**
- 内容が一致する

- [ ] **Step 4: 自動無効化を確認**

1. `debugLiveHtml` を実行してキャッシュを作る
2. **Google Doc を開いて1文字追加し、閉じる**
3. `debugLiveHtml` を再実行する

Expected: 1回目が再び遅くなり (キャッシュミス)、**出力に追加した文字が反映されている**

これが「常に同期される」ことの実証である。

- [ ] **Step 5: コミット**

```bash
git add src/render/LiveCache.gs
git commit -m "feat: 更新時刻ベースで自動無効化されるライブキャッシュを追加"
```

---

## Task 9: Web App と Wiki 画面

**Files:**
- Create: `src/Main.gs` (Task 6-8 の一時的な debug 関数を整理して置き換える)
- Create: `src/ui/wiki.html`
- Create: `src/ui/app.css.html`
- Create: `src/ui/app.js.html`

**Interfaces:**
- Consumes: Task 5-8 のすべて
- Produces:
  - `doGet(e) → HtmlOutput`
  - `apiListFiles() → object[]` — google.script.run から呼ぶ
  - `apiGetFileHtml(fileId: string) → {html: string, name: string, url: string}`

- [ ] **Step 1: Main.gs を作成**

既存の debug 関数をすべて削除し、以下で置き換える:

```javascript
/**
 * Web Appのエントリポイント。
 *
 * @param {object} e イベントオブジェクト
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.p) || 'wiki';
  if (!/^[a-z]{1,20}$/.test(page)) page = 'wiki';

  var template = HtmlService.createTemplateFromFile('ui/wiki');
  return template.evaluate()
    .setTitle('Agentic Management')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTMLテンプレートから別のHTMLファイルを取り込むためのヘルパー。
 * wiki.html 内で <?!= include('ui/app.css') ?> のように使う。
 *
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * リポジトリの初期セットアップ。GASエディタから1回だけ手動実行する。
 *
 * @returns {object}
 */
function setupRepo() {
  return repoInit('agentic-management');
}

/**
 * 管理対象ファイルの一覧を返す (Web App API)。
 *
 * @returns {object[]} {fileId, path, type} の配列
 */
function apiListFiles() {
  var rows = dbReadAll('files');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      fileId: rows[i].fileId,
      path: rows[i].path,
      type: rows[i].type,
    });
  }
  out.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
  return out;
}

/**
 * ファイルのライブHTMLとメタ情報を返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {{html:string, name:string, url:string, path:string}}
 */
function apiGetFileHtml(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');

  var file = DriveApp.getFileById(fileId);
  return {
    html: liveHtml(fileId),
    name: file.getName(),
    url: file.getUrl(),
    path: row.path,
  };
}

/**
 * ファイルを管理対象に登録する (Web App API)。
 *
 * @param {string} fileId
 * @param {string} path
 * @returns {object}
 */
function apiRegisterFile(fileId, path) {
  return repoRegisterFile(fileId, path);
}
```

- [ ] **Step 2: app.css.html を作成**

```html
<style>
:root {
  --ink: #1a1a1a;
  --ink-2: #666;
  --line: #e0e0e0;
  --bg: #ffffff;
  --bg-2: #f7f7f7;
  --accent: #1a73e8;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue',
               'Hiragino Sans', 'Noto Sans JP', sans-serif;
  color: var(--ink);
  background: var(--bg);
  font-size: 14px;
  line-height: 1.7;
}

.layout { display: flex; height: 100vh; }

.sidebar {
  width: 260px;
  flex: 0 0 260px;
  border-right: 1px solid var(--line);
  background: var(--bg-2);
  overflow-y: auto;
  padding: 16px 0;
}

.sidebar h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-2);
  margin: 0 16px 8px;
}

.file-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--ink);
  font-family: inherit;
}

.file-item:hover { background: rgba(0, 0, 0, 0.04); }
.file-item[aria-current="true"] { background: rgba(26, 115, 232, 0.1); color: var(--accent); }

.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
}

.toolbar h1 { font-size: 15px; margin: 0; font-weight: 600; }
.toolbar .spacer { flex: 1; }

.toolbar a {
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
}

.viewer { flex: 1; border: 0; width: 100%; background: var(--bg); }

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--ink-2);
}
</style>
```

- [ ] **Step 3: wiki.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <base target="_top">
  <meta charset="utf-8">
  <?!= include('ui/app.css') ?>
</head>
<body>
  <div class="layout">
    <nav class="sidebar">
      <h2>ファイル</h2>
      <div id="file-list"></div>
    </nav>
    <div class="main">
      <div class="toolbar">
        <h1 id="doc-title">—</h1>
        <span class="spacer"></span>
        <a id="open-in-docs" href="#" target="_blank" hidden>Google ドキュメントで開く</a>
      </div>
      <iframe id="viewer" class="viewer" sandbox></iframe>
      <div id="empty" class="empty">左からファイルを選択してください</div>
    </div>
  </div>
  <?!= include('ui/app.js') ?>
</body>
</html>
```

- [ ] **Step 4: app.js.html を作成**

```html
<script>
(function () {
  'use strict';

  var listEl = document.getElementById('file-list');
  var viewer = document.getElementById('viewer');
  var empty = document.getElementById('empty');
  var titleEl = document.getElementById('doc-title');
  var openLink = document.getElementById('open-in-docs');

  /**
   * 文書HTMLをiframeのsrcdocに流し込む。
   *
   * sandbox属性を値なしで指定しているため、スクリプト実行・フォーム送信・
   * 同一オリジンアクセスがすべて禁止される。他人が編集した文書を
   * 表示するため、これはセキュリティ上の必須要件である。
   *
   * @param {string} bodyHtml 正規化HTML
   */
  function renderIntoViewer(bodyHtml) {
    var css =
      'body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",' +
      '"Noto Sans JP",sans-serif;line-height:1.9;color:#1a1a1a;' +
      'padding:32px 48px;max-width:820px;margin:0 auto;}' +
      'h1{font-size:24px;margin:1.6em 0 .6em;}' +
      'h2{font-size:20px;margin:1.6em 0 .6em;}' +
      'h3{font-size:17px;margin:1.4em 0 .5em;}' +
      'table{border-collapse:collapse;margin:1em 0;width:100%;}' +
      'td{border:1px solid #e0e0e0;padding:6px 10px;}' +
      'li{margin:.3em 0;}' +
      'img{max-width:100%;}';

    viewer.srcdoc =
      '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
      '<style>' + css + '</style></head><body>' + wrapLists(bodyHtml) + '</body></html>';
  }

  /**
   * 連続する <li data-list="..." data-depth="N"> を対応する ul/ol でラップする。
   *
   * 正規化HTMLは差分粒度を優先して li を単独行で出力するため、
   * 表示時にリスト構造へ復元する必要がある。
   *
   * @param {string} html
   * @returns {string}
   */
  function wrapLists(html) {
    var lines = html.split('\n');
    var out = [];
    var open = [];   // {tag, depth} のスタック

    function closeTo(depth) {
      while (open.length > depth) {
        out.push('</' + open.pop().tag + '>');
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = /^<li data-list="(ul|ol)" data-depth="(\d+)">/.exec(line);
      if (m) {
        var tag = m[1];
        var depth = Number(m[2]);
        closeTo(depth);
        if (open.length === depth) {
          out.push('<' + tag + '>');
          open.push({ tag: tag, depth: depth });
        }
        out.push(line);
      } else {
        closeTo(0);
        out.push(line);
      }
    }
    closeTo(0);
    return out.join('\n');
  }

  function selectFile(fileId, button) {
    var buttons = listEl.querySelectorAll('.file-item');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-current', String(buttons[i] === button));
    }

    titleEl.textContent = '読み込み中…';
    google.script.run
      .withSuccessHandler(function (res) {
        empty.hidden = true;
        viewer.hidden = false;
        titleEl.textContent = res.path;
        openLink.href = res.url;
        openLink.hidden = false;
        renderIntoViewer(res.html);
      })
      .withFailureHandler(function (err) {
        titleEl.textContent = 'エラー: ' + err.message;
      })
      .apiGetFileHtml(fileId);
  }

  function renderFileList(files) {
    listEl.textContent = '';
    if (files.length === 0) {
      var p = document.createElement('p');
      p.style.cssText = 'padding:0 16px;color:#666;font-size:13px;';
      p.textContent = '管理対象のファイルがありません。';
      listEl.appendChild(p);
      return;
    }
    files.forEach(function (f) {
      var btn = document.createElement('button');
      btn.className = 'file-item';
      btn.textContent = f.path;
      btn.addEventListener('click', function () { selectFile(f.fileId, btn); });
      listEl.appendChild(btn);
    });
  }

  viewer.hidden = true;
  google.script.run
    .withSuccessHandler(renderFileList)
    .withFailureHandler(function (err) {
      listEl.textContent = 'エラー: ' + err.message;
    })
    .apiListFiles();
})();
</script>
```

**注意**: ファイル名にテキストを入れる際は `textContent` を使い、`innerHTML` は
使わない。ファイルパスはユーザー入力であり、XSS の経路になる。

- [ ] **Step 5: push してデプロイ**

```bash
clasp push
clasp deploy --description "Phase 1: ライブWiki"
```

`clasp deploy` の出力に含まれるデプロイIDを控える。

- [ ] **Step 6: Web App を開いて動作確認**

Run: `clasp open-web-app` (またはデプロイURLをブラウザで開く)

確認項目:

- サイドバーに管理対象ファイルの一覧 (パス) が表示される
- ファイルをクリックすると本文が右ペインに表示される
- **見出しの階層が視覚的に反映されている**
- **箇条書きが `<ul>` / `<ol>` として正しくネストされている** (`wrapLists` の検証)
- 表が罫線付きで表示される
- 「Google ドキュメントで開く」リンクが正しいDocを開く

- [ ] **Step 7: ライブ同期を確認**

1. Web App でファイルを表示する
2. **別タブで Google Doc を開き、見出しを1つ追加して閉じる**
3. Web App でサイドバーの同じファイルを再度クリックする

Expected: **追加した見出しが反映されている**

これが「GWS内のファイルを常に同期して描画時にキャストする」要件の達成確認である。

- [ ] **Step 8: サンドボックスを確認**

テスト用 Doc に、本文テキストとして `<script>alert(1)</script>` という
**文字列**を入力し、Web App で表示する。

Expected: **画面に `<script>alert(1)</script>` という文字列がそのまま表示され、
アラートは出ない。** エスケープとサンドボックスの両方が効いている証拠になる。

- [ ] **Step 9: コミット**

```bash
git add src/Main.gs src/ui/
git commit -m "feat: ライブWiki表示のWeb Appを追加"
```

---

## Task 10: Phase 1 の総合検証とドキュメント

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/plans/2026-09-02-gws-git-management-phase1.md` (完了マーク)

**Interfaces:**
- Consumes: Task 1-9 のすべて
- Produces: セットアップ手順が文書化された、デモ可能な状態

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: PASS。失敗が1件もないこと。

- [ ] **Step 2: 2つ目のテスト文書で検証**

`main/` に2つ目の Google Doc (構造の異なるもの。例えば表を多用した規定文書) を
作り、`apiRegisterFile` で登録して Web App で表示する。

Expected: 1つ目と同様に正しく表示される。レンダラが特定文書に
過適合していないことの確認。

- [ ] **Step 3: README.md を作成**

```markdown
# Agentic Management (GAS)

Google Workspace 上の文書に Git の概念を与えて管理するシステム。
GAS 標準サービスのみで構築され、外部APIを一切使用しない。

## 現在の状態: Phase 1 完了

Google Docs を正規化HTMLに変換し、ブラウザ上でライブ表示する Wiki が動作する。

## セットアップ

### 1. 依存のインストール

```bash
npm install
```

### 2. GAS プロジェクトへの接続

```bash
clasp login
clasp push
```

### 3. リポジトリの初期化

GAS エディタで `setupRepo()` を1回だけ実行する。
Drive に `agentic-management/` フォルダとメタDBスプレッドシートが作られる。

### 4. デプロイ

```bash
clasp deploy --description "Phase 1"
clasp open-web-app
```

### 5. 文書の登録

GAS エディタで以下を実行する (`fileId` は対象 Doc の URL から取得する):

```javascript
repoRegisterFile('<fileId>', '規定/就業規則');
```

## 開発

```bash
npm test          # ピュアロジックのユニットテスト
npm run test:watch
clasp push        # GAS へ反映
```

### テストの仕組み

ランタイムコードには `import` / `export` / `require` を**書かない**
(GAS で動かなくなるため)。テストは `test/harness.js` が `node:vm` で
ソースを評価し、定義された関数を取り出す方式を採る。

## ドキュメント

- [設計仕様](docs/superpowers/specs/2026-09-02-gws-git-management-design.md)
- [大規模版スケーリング構想](docs/superpowers/specs/2026-09-02-gws-git-management-scaling.md)
- [Phase 1 実装計画](docs/superpowers/plans/2026-09-02-gws-git-management-phase1.md)

## 制約

- GAS 標準サービスのみ (Advanced Google Services / 外部API は使用不可)
- 色・フォント・サイズは版管理の対象外 (意図的な割り切り)
- Phase 1 では Google Docs のみ対応 (Sheets / Slides は Phase 3)
```

- [ ] **Step 4: 計画書に完了マークを付ける**

このファイルの各タスクのチェックボックスがすべて `- [x]` になっていることを確認する。

- [ ] **Step 5: コミット**

```bash
git add README.md docs/
git commit -m "docs: Phase 1のREADMEとセットアップ手順を追加"
```

---

## Phase 1 完了時に達成されていること

- [ ] `npm test` でピュアロジック (Hash / Normalize) のテストが全件通る
- [ ] Google Docs が決定的な正規化HTMLに変換される
- [ ] 同じ文書からは常にバイト単位で同一のHTMLが出る
- [ ] `parseBlocks(serializeBlocks(x)) === x` のラウンドトリップが成立する
      (Phase 2 のマージ書き戻しが可能であることの証明)
- [ ] Drive にリポジトリ構造とメタDBが作られている
- [ ] Web App で文書一覧と本文が閲覧できる
- [ ] **Docsを編集すると、次に開いたときに自動で反映される**
- [ ] 文書HTMLが `<iframe sandbox>` 内で安全にレンダリングされる

## Phase 2 に持ち越すもの

- commit / branch / PR / merge (spec §5)
- HtmlWriter (HTML → Docs 書き戻し。Task 4 のパーサが土台になる)
- Diff.js / Merge.js のピュア実装

## Phase 3 に持ち越すもの

- SheetRenderer / SlidesRenderer (spec §4.1)
- Issue / Projects (spec §6)
- Notifier (spec §6.3)
