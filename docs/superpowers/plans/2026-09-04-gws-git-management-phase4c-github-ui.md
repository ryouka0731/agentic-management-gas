# Phase 4c (GitHub ライクな UI) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub を使ったことがある人が説明なしで操作できる画面にする。

**Architecture:** 判断を伴うロジックは**純関数に切り出して vitest で固定**し、DOM の
組み立てだけを UI に残す。左右2列の差分は `diffPairs()`、元ファイルの URL は
`fileUrlOf()` として `Diff.js` / 新規 `FileUrl.js` に置く。PR のコメントと
コミット一覧は既存テーブルから引くだけで、新しいテーブルは作らない。

**Tech Stack:** Google Apps Script (V8) / vitest / 疑似GAS (`test/fakegas.js`)

**Spec:** `docs/superpowers/specs/2026-09-04-gws-git-management-phase4-design.md` (§6)

## Global Constraints

- GAS 標準サービスのみ。**GCP プロジェクトは使用不可**
- ランタイムコードに `import` / `export` / `require` を書かない
- **表示は必ず `textContent` で組み立てる。`innerHTML` は使わない。**
  他人が書いた文書・コメント・Issue 題名を表示するため、XSS 遮断は必須要件
- CSS は既存のデザイントークン (`--ink` / `--ink-2` / `--line` / `--bg` /
  `--bg-2` / `--accent`) だけを使う。未定義変数 + フォールバックの形は使わない
- 既存の `[hidden] { display: none !important; }` があるため、`display` を
  持つクラスに `hidden` を付けても隠れる

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/core/Diff.js` (変更) | `diffPairs()` — ops から左右2列の行を組む |
| `src/core/FileUrl.js` (新規) | `fileUrlOf(type, fileId)` — 種別から元ファイルの URL を作る |
| `src/Main.gs` (変更) | `apiPrReviews` / `apiPrCommits` |
| `src/ui/wiki.html` (変更) | 左ペインのブランチ切替、PR の3タブ |
| `src/ui/app.js.html` (変更) | ツリー、左右差分、PR タブ、リンク |
| `src/ui/app.css.html` (変更) | 上記のスタイル |
| `test/diff.test.js` (変更) | `diffPairs` のテスト |
| `test/fileurl.test.js` (新規) | `fileUrlOf` のテスト |
| `test/phase4-ui.test.js` (新規) | `apiPrReviews` / `apiPrCommits` の統合テスト |

---

## Task 1: diffPairs — 左右2列の差分を組む

**Files:**
- Modify: `src/core/Diff.js`
- Test: `test/diff.test.js`

**Interfaces:**
- Consumes: `diffHtml(a, b) -> ops` (既存。`{type:'equal'|'insert'|'delete', line}`)
- Produces: `diffPairs(ops) -> Array<{left:string|null, right:string|null, type:string}>`
  - `type` は `equal` / `change` / `insert` / `delete`
  - 連続する delete と insert は**同じ行に対応付けて `change`** にする。
    GitHub の split view はこれをやるため、これが無いと「左が全部消えて
    右が全部足された」ようにしか見えない

- [ ] **Step 1: 失敗するテストを書く**

`test/diff.test.js` の末尾に追記する。

```javascript
describe('diffPairs', () => {
  const gas = loadGas('src/core/Diff.js');

  it('equal は左右に同じ行を置く', () => {
    expect(gas.diffPairs([{ type: 'equal', line: 'a' }]))
      .toEqual([{ left: 'a', right: 'a', type: 'equal' }]);
  });

  it('delete は左だけ、insert は右だけに置く', () => {
    expect(gas.diffPairs([
      { type: 'delete', line: 'x' },
      { type: 'equal', line: 'a' },
    ])).toEqual([
      { left: 'x', right: null, type: 'delete' },
      { left: 'a', right: 'a', type: 'equal' },
    ]);

    expect(gas.diffPairs([{ type: 'insert', line: 'y' }]))
      .toEqual([{ left: null, right: 'y', type: 'insert' }]);
  });

  it('連続する delete と insert を1行の change にまとめる', () => {
    expect(gas.diffPairs([
      { type: 'delete', line: '古い' },
      { type: 'insert', line: '新しい' },
    ])).toEqual([{ left: '古い', right: '新しい', type: 'change' }]);
  });

  it('数が違う場合は余った側だけを残す', () => {
    expect(gas.diffPairs([
      { type: 'delete', line: 'd1' },
      { type: 'delete', line: 'd2' },
      { type: 'insert', line: 'i1' },
    ])).toEqual([
      { left: 'd1', right: 'i1', type: 'change' },
      { left: 'd2', right: null, type: 'delete' },
    ]);
  });

  it('insert が先に来ても対応付ける', () => {
    expect(gas.diffPairs([
      { type: 'insert', line: 'i1' },
      { type: 'delete', line: 'd1' },
    ])).toEqual([{ left: 'd1', right: 'i1', type: 'change' }]);
  });

  it('空なら空を返す', () => {
    expect(gas.diffPairs([])).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/diff.test.js`
Expected: FAIL (`diffPairs is not defined`)

- [ ] **Step 3: 実装する**

`src/core/Diff.js` の末尾に足す。

```javascript
/**
 * diff の ops を左右2列の行に組み替える。
 *
 * 連続する delete と insert は同じ行に対応付けて change にする。
 * これをしないと「左が全部消えて右が全部足された」ようにしか見えず、
 * どこが書き換わったのかが読めない。GitHub の split view と同じ挙動。
 *
 * @param {object[]} ops diffHtml が返す配列
 * @returns {Array<{left:string|null, right:string|null, type:string}>}
 */
function diffPairs(ops) {
  var out = [];
  var dels = [];
  var ins = [];

  function flush() {
    var n = Math.max(dels.length, ins.length);
    for (var i = 0; i < n; i++) {
      var left = i < dels.length ? dels[i] : null;
      var right = i < ins.length ? ins[i] : null;
      var type = (left !== null && right !== null)
        ? 'change'
        : (left !== null ? 'delete' : 'insert');
      out.push({ left: left, right: right, type: type });
    }
    dels = [];
    ins = [];
  }

  for (var i = 0; i < (ops || []).length; i++) {
    var op = ops[i];
    if (op.type === 'delete') { dels.push(op.line); continue; }
    if (op.type === 'insert') { ins.push(op.line); continue; }

    flush();
    out.push({ left: op.line, right: op.line, type: 'equal' });
  }
  flush();
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/Diff.js test/diff.test.js
git commit -m "feat: 差分を左右2列に組み替えるdiffPairsを追加"
```

---

## Task 2: fileUrlOf — 元ファイルへのリンク

**Files:**
- Create: `src/core/FileUrl.js`
- Test: `test/fileurl.test.js` (新規)

**Interfaces:**
- Produces: `fileUrlOf(type, fileId) -> string`

**なぜ純関数にするか:** `DriveApp.getFileById(id).getUrl()` を一覧の各行で呼ぶと
ファイル数だけ Drive を叩くことになる。URL は種別と fileId から決まるので、
計算で出す。

- [ ] **Step 1: 失敗するテストを書く**

```javascript
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/FileUrl.js');

describe('fileUrlOf', () => {
  it('種別ごとに正しいURLを作る', () => {
    expect(gas.fileUrlOf('doc', 'ID1'))
      .toBe('https://docs.google.com/document/d/ID1/edit');
    expect(gas.fileUrlOf('sheet', 'ID2'))
      .toBe('https://docs.google.com/spreadsheets/d/ID2/edit');
    expect(gas.fileUrlOf('slide', 'ID3'))
      .toBe('https://docs.google.com/presentation/d/ID3/edit');
  });

  it('未知の種別は Drive のファイルビューに落とす', () => {
    expect(gas.fileUrlOf('pdf', 'ID4'))
      .toBe('https://drive.google.com/file/d/ID4/view');
  });

  it('fileId が無ければ空文字を返す', () => {
    expect(gas.fileUrlOf('doc', '')).toBe('');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/fileurl.test.js`
Expected: FAIL

- [ ] **Step 3: 実装する**

```javascript
/**
 * ファイル種別と fileId から元ファイルの URL を作る。
 *
 * DriveApp を呼ばずに済ませるための関数である。一覧の各行で
 * getUrl() を呼ぶと、ファイル数だけ Drive へのアクセスが発生する。
 *
 * @param {string} type 'doc' | 'sheet' | 'slide'
 * @param {string} fileId
 * @returns {string} URL。fileId が無ければ空文字
 */
function fileUrlOf(type, fileId) {
  if (!fileId) return '';

  var base = {
    doc: 'https://docs.google.com/document/d/',
    sheet: 'https://docs.google.com/spreadsheets/d/',
    slide: 'https://docs.google.com/presentation/d/',
  }[String(type)];

  if (!base) return 'https://drive.google.com/file/d/' + fileId + '/view';
  return base + fileId + '/edit';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/FileUrl.js test/fileurl.test.js
git commit -m "feat: 元ファイルのURLを種別から作るfileUrlOfを追加"
```

---

## Task 3: PR のコメントとコミット一覧の API

**Files:**
- Modify: `src/Main.gs`
- Test: `test/phase4-ui.test.js` (新規)

**Interfaces:**
- Produces:
  - `apiPrReviews(number) -> object[]` (古い順。`{reviewer, state, body, at}`)
  - `apiPrCommits(number) -> object[]` (新しい順。`{sha, message, author, timestamp}`)

- [ ] **Step 1: 失敗するテストを書く**

`test/phase4-edit.test.js` と同じ SOURCES / `setup()` を使う。

```javascript
describe('PRの会話とコミット', () => {
  function prepare() {
    const env = setup();
    env.ctx.branchCreate('改訂', env.fileId);
    const workFileId = env.ctx.branchWorkingFileId('改訂', env.fileId);
    env.fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    env.ctx.commitFile(workFileId, '改訂', '第3条を追加', null);
    const pr = env.ctx.prCreate('第3条を追加', '', '改訂', env.fileId);
    return Object.assign(env, { pr: pr, workFileId: workFileId });
  }

  it('コメントを時系列で返す', () => {
    const env = prepare();
    env.fake._setUser('a@example.com');
    env.ctx.prReview(env.pr.number, 'comment', '第3条の文言が気になります');
    env.fake._setUser('b@example.com');
    env.ctx.prReview(env.pr.number, 'approve', '直りました');

    const reviews = env.ctx.apiPrReviews(env.pr.number);
    expect(reviews.length).toBe(2);
    expect(reviews[0].body).toBe('第3条の文言が気になります');
    expect(reviews[0].reviewer).toBe('a@example.com');
    expect(reviews[1].state).toBe('approve');
  });

  it('他のPRのコメントは混ざらない', () => {
    const env = prepare();
    env.ctx.prReview(env.pr.number, 'comment', 'こちらのPR');
    expect(env.ctx.apiPrReviews(999)).toEqual([]);
  });

  it('ブランチのコミットを新しい順で返す', () => {
    const env = prepare();
    const commits = env.ctx.apiPrCommits(env.pr.number);

    expect(commits.length).toBe(2);
    expect(commits[0].message).toBe('第3条を追加');
    expect(commits[1].message).toContain('ブランチ 改訂 を作成');
    expect(commits[0].sha.length).toBe(64);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase4-ui.test.js`
Expected: FAIL

- [ ] **Step 3: 実装する**

`src/Main.gs` の Phase 4b の API 群の後ろに足す。

```javascript
/**
 * PRに付いたレビューとコメントを古い順で返す (Web App API)。
 *
 * reviews テーブルは Phase 2 から state に 'comment' を許している。
 * 会話のために新しいテーブルは要らない。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrReviews(number) {
  var rows = dbReadAll('reviews');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;
    out.push({
      reviewer: rows[i].reviewer,
      state: rows[i].state,
      body: rows[i].body,
      at: rows[i].at,
    });
  }
  return out;
}

/**
 * PRのソースブランチのコミットを新しい順で返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiPrCommits(number) {
  var pr = prGet(number);
  var mainFileId = prTargetFileId_(pr.body);
  if (!mainFileId) return [];

  var workFileId = branchWorkingFileId(pr.sourceBranch, mainFileId);
  if (!workFileId) return [];

  var commits = commitHistory(workFileId, pr.sourceBranch);
  var out = [];
  for (var i = 0; i < commits.length; i++) {
    out.push({
      sha: commits[i].sha,
      message: commits[i].message,
      author: commits[i].author,
      timestamp: commits[i].timestamp,
    });
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/Main.gs test/phase4-ui.test.js
git commit -m "feat: PRの会話とコミット一覧のAPIを追加"
```

---

## Task 4: 左ペインのブランチ切替とファイルツリー

**Files:**
- Modify: `src/ui/wiki.html`
- Modify: `src/ui/app.js.html`
- Modify: `src/ui/app.css.html`

- [ ] **Step 1: ブランチ選択を左ペインに足す**

`wiki.html` のファイル一覧 (`id="file-list"`) の**直前**に足す。

```html
        <div class="branch-switch">
          <select id="branch-select" aria-label="ブランチ"></select>
        </div>
```

- [ ] **Step 2: スタイルを足す**

```css
.branch-switch { padding: 8px 12px; border-bottom: 1px solid var(--line); }

.branch-switch select {
  width: 100%;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
}

.tree-dir {
  font-size: 11px;
  color: var(--ink-2);
  padding: 6px 16px 2px;
}

.file-item.nested { padding-left: 28px; }

.file-link {
  font-size: 11px;
  color: var(--accent);
  margin-left: 6px;
  text-decoration: none;
}
```

- [ ] **Step 3: ブランチで絞り込んでツリーに並べる**

`app.js.html` の `renderFileList` を差し替える。論理パスから
ブランチ部分を取り除き、残りを `/` で階層化する。

```javascript
  /**
   * 論理パスをブランチ名と表示用パスに分ける。
   *
   * branches/<name>/<path> なら {branch:<name>, path:<path>}、
   * それ以外は {branch:'main', path:<そのまま>}。
   *
   * @param {string} path
   * @returns {{branch:string, path:string}}
   */
  function splitPath(path) {
    var m = /^branches\/([^\/]+)\/([\s\S]*)$/.exec(String(path || ''));
    return m ? { branch: m[1], path: m[2] } : { branch: 'main', path: String(path || '') };
  }

  function renderFileList(files) {
    allFiles = files;

    var branches = { main: true };
    files.forEach(function (f) { branches[splitPath(f.path).branch] = true; });

    var names = Object.keys(branches);
    branchSelect.textContent = '';
    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === currentBranch) opt.selected = true;
      branchSelect.appendChild(opt);
    });

    renderTree();
  }

  function renderTree() {
    listEl.textContent = '';

    var shown = allFiles.filter(function (f) {
      return splitPath(f.path).branch === currentBranch;
    });

    if (!shown.length) {
      var p = document.createElement('p');
      p.className = 'tree-dir';
      p.textContent = 'このブランチにファイルはありません';
      listEl.appendChild(p);
      return;
    }

    var lastDir = null;
    shown.sort(function (a, b) {
      return splitPath(a.path).path < splitPath(b.path).path ? -1 : 1;
    });

    shown.forEach(function (f) {
      var rel = splitPath(f.path).path;
      var cut = rel.lastIndexOf('/');
      var dir = cut < 0 ? '' : rel.substring(0, cut);
      var name = cut < 0 ? rel : rel.substring(cut + 1);

      if (dir !== lastDir) {
        lastDir = dir;
        if (dir) {
          var head = document.createElement('div');
          head.className = 'tree-dir';
          head.textContent = dir + '/';
          listEl.appendChild(head);
        }
      }

      var row = document.createElement('div');

      var btn = document.createElement('button');
      btn.className = dir ? 'file-item nested' : 'file-item';
      btn.textContent = name;
      btn.addEventListener('click', function () { selectFile(f.fileId, btn); });
      row.appendChild(btn);

      row.appendChild(makeFileLink(f.type, f.fileId));
      listEl.appendChild(row);
    });
  }

  /**
   * 元ファイルへのリンクを作る。
   *
   * @param {string} type
   * @param {string} fileId
   * @returns {HTMLElement}
   */
  function makeFileLink(type, fileId) {
    var a = document.createElement('a');
    a.className = 'file-link';
    a.href = fileUrlOf(type, fileId);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '↗';
    a.title = '元ファイルを開く';
    return a;
  }
```

`fileUrlOf` はサーバ側の関数なので、**UI 側にも同じ関数を置く**。
`app.js.html` の先頭付近に `src/core/FileUrl.js` と同じ実装を写す。
`google.script.run` の往復を増やさないための意図的な重複であり、
コメントでそう明記する。

状態変数を足す。

```javascript
  var allFiles = [];
  var currentBranch = 'main';
```

要素参照とイベントを足す。

```javascript
  var branchSelect = document.getElementById('branch-select');

  branchSelect.addEventListener('change', function () {
    currentBranch = branchSelect.value;
    renderTree();
  });
```

- [ ] **Step 4: push して確認**

```bash
npx clasp push -f
npx clasp create-deployment -i <既存のデプロイID> -d "Phase 4c: ブランチ切替とツリー"
```

Expected: 左上でブランチを選ぶと、そのブランチのファイルだけが出る。
main を選ぶと元の一覧に戻る。各行の `↗` で元ファイルが開く

- [ ] **Step 5: コミット**

```bash
git add src/ui/
git commit -m "feat: 左ペインにブランチ切替とファイルツリーを追加"
```

---

## Task 5: 左右2列の差分表示

**Files:**
- Modify: `src/ui/app.js.html`
- Modify: `src/ui/app.css.html`

- [ ] **Step 1: スタイルを足す**

```css
.diff-split { display: table; width: 100%; border-collapse: collapse; }

.diff-row { display: table-row; }

.diff-cell {
  display: table-cell;
  width: 50%;
  padding: 1px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  vertical-align: top;
  border-left: 1px solid var(--line);
}

.diff-cell.del { background: #fee2e2; }
.diff-cell.ins { background: #dcfce7; }
.diff-cell.empty { background: var(--bg-2); }
```

- [ ] **Step 2: 描画関数を差し替える**

`renderDiffInto` を左右2列版に置き換える。**`textContent` のみを使う。**

```javascript
  /**
   * 差分を左右2列で描画する。
   *
   * 行の高さを揃えるため、片側しか無い行にも空のセルを置く。
   * 置かないと左右の行がずれて読めなくなる。
   *
   * @param {object[]} ops
   * @param {HTMLElement} container
   * @param {boolean} skipEqual 一致行を省くか
   */
  function renderDiffInto(ops, container, skipEqual) {
    var pairs = diffPairs(ops || []);
    var shown = pairs.filter(function (p) {
      return !(skipEqual && p.type === 'equal');
    });

    if (!shown.length) {
      var p = document.createElement('p');
      p.className = 'diff-empty';
      p.textContent = '差分はありません';
      container.appendChild(p);
      return;
    }

    var table = document.createElement('div');
    table.className = 'diff-split';

    shown.forEach(function (pair) {
      var row = document.createElement('div');
      row.className = 'diff-row';
      row.appendChild(diffCell(pair.left, pair.type === 'equal' ? '' : 'del'));
      row.appendChild(diffCell(pair.right, pair.type === 'equal' ? '' : 'ins'));
      table.appendChild(row);
    });

    container.appendChild(table);
  }

  /**
   * 差分の1セルを作る。中身が無ければ空セルにする。
   *
   * @param {string|null} text
   * @param {string} kind '' | 'del' | 'ins'
   * @returns {HTMLElement}
   */
  function diffCell(text, kind) {
    var cell = document.createElement('div');
    cell.className = 'diff-cell' + (text === null ? ' empty' : (kind ? ' ' + kind : ''));
    cell.textContent = text === null ? '' : text;
    return cell;
  }
```

`diffPairs` もサーバ側の関数なので、**UI 側に同じ実装を写す**。
Task 4 の `fileUrlOf` と同じ理由であり、同じくコメントで明記する。

- [ ] **Step 3: push して確認**

Expected: 履歴の差分と PR の差分が左右2列になり、書き換わった行が
左右に並んで見える

- [ ] **Step 4: コミット**

```bash
git add src/ui/
git commit -m "feat: 差分を左右2列で表示する"
```

---

## Task 6: PR の3タブとコメント欄

**Files:**
- Modify: `src/ui/app.js.html`
- Modify: `src/ui/app.css.html`

- [ ] **Step 1: スタイルを足す**

```css
.pr-tabs { display: flex; gap: 4px; margin: 10px 0; }

.pr-tab {
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--ink-2);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.pr-tab[aria-current="true"] { color: var(--ink); background: var(--bg-2); }

.comment {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
}

.comment-head { font-size: 11px; color: var(--ink-2); margin-bottom: 4px; }
.comment-body { font-size: 13px; color: var(--ink); white-space: pre-wrap; }

.comment-form { display: flex; gap: 6px; margin-top: 10px; }
.comment-form textarea {
  flex: 1;
  min-height: 60px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--ink);
  background: var(--bg);
}
```

- [ ] **Step 2: showPrDetail を3タブ構成にする**

タイトルとメタ情報の直後にタブを置き、その下に「会話 / コミット /
変更ファイル」の中身を切り替えて出す。**操作ボタン (承認・マージ) は
どのタブでも常に見えるよう、タブの外に置く。**

```javascript
    var prTabs = document.createElement('div');
    prTabs.className = 'pr-tabs';

    var prBody = document.createElement('div');

    var views = {
      conversation: function () { renderConversation(pr, prBody); },
      commits: function () { renderPrCommits(pr, prBody); },
      files: function () { renderPrFiles(pr, preview, prBody); },
    };

    [['conversation', '会話'], ['commits', 'コミット'], ['files', '変更ファイル']]
      .forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'pr-tab';
        b.textContent = t[1];
        b.setAttribute('aria-current', String(t[0] === 'conversation'));
        b.addEventListener('click', function () {
          var all = prTabs.querySelectorAll('.pr-tab');
          for (var i = 0; i < all.length; i++) {
            all[i].setAttribute('aria-current', String(all[i] === b));
          }
          prBody.textContent = '';
          views[t[0]]();
        });
        prTabs.appendChild(b);
      });

    prDetail.appendChild(prTabs);
    prDetail.appendChild(prBody);
    views.conversation();
```

- [ ] **Step 3: 会話タブを実装する**

```javascript
  function renderConversation(pr, container) {
    var body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = pr.body || '(説明なし)';

    var first = document.createElement('div');
    first.className = 'comment';
    var head = document.createElement('div');
    head.className = 'comment-head';
    head.textContent = pr.author + ' が作成';
    first.appendChild(head);
    first.appendChild(body);
    container.appendChild(first);

    google.script.run
      .withSuccessHandler(function (reviews) {
        reviews.forEach(function (r) {
          var el = document.createElement('div');
          el.className = 'comment';

          var h = document.createElement('div');
          h.className = 'comment-head';
          h.textContent = r.reviewer + ' · ' +
            ({ approve: '承認', request_changes: '変更を要求', comment: 'コメント' }[r.state] || r.state);
          el.appendChild(h);

          if (r.body) {
            var b = document.createElement('div');
            b.className = 'comment-body';
            b.textContent = r.body;
            el.appendChild(b);
          }
          container.appendChild(el);
        });

        container.appendChild(makeCommentForm(pr));
      })
      .withFailureHandler(function (err) {
        container.textContent = 'エラー: ' + err.message;
      })
      .apiPrReviews(pr.number);
  }

  function makeCommentForm(pr) {
    var form = document.createElement('div');
    form.className = 'comment-form';

    var input = document.createElement('textarea');
    input.placeholder = 'コメントを書く';
    form.appendChild(input);

    var send = document.createElement('button');
    send.className = 'btn';
    send.textContent = '投稿';
    send.addEventListener('click', function () {
      if (!input.value) return;
      send.disabled = true;
      google.script.run
        .withSuccessHandler(function () { showPrDetail(pr); })
        .withFailureHandler(function (err) {
          send.disabled = false;
          window.alert(err.message);
        })
        .apiPrReview(pr.number, 'comment', input.value);
    });
    form.appendChild(send);
    return form;
  }
```

- [ ] **Step 4: コミットタブと変更ファイルタブを実装する**

```javascript
  function renderPrCommits(pr, container) {
    container.textContent = '読み込み中…';

    google.script.run
      .withSuccessHandler(function (commits) {
        container.textContent = '';
        if (!commits.length) {
          container.textContent = 'コミットはありません';
          return;
        }
        commits.forEach(function (c) {
          var row = document.createElement('div');
          row.className = 'row-item';

          var title = document.createElement('div');
          title.className = 'row-title';
          title.textContent = c.message;
          row.appendChild(title);

          var meta = document.createElement('div');
          meta.className = 'row-meta';
          meta.textContent = c.sha.substring(0, 7) + ' · ' + c.author;
          row.appendChild(meta);

          container.appendChild(row);
        });
      })
      .withFailureHandler(function (err) {
        container.textContent = 'エラー: ' + err.message;
      })
      .apiPrCommits(pr.number);
  }

  function renderPrFiles(pr, preview, container) {
    renderDiffInto(preview.ops, container, true);
  }
```

- [ ] **Step 5: push して確認**

Expected: PR を開くと「会話 / コミット / 変更ファイル」が並び、
会話にコメントを投稿できる。承認とマージのボタンはタブに関係なく見える

- [ ] **Step 6: コミット**

```bash
git add src/ui/
git commit -m "feat: PR詳細を会話・コミット・変更ファイルの3タブにする"
```

---

## Task 7: 統合検証とドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: この計画書

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Web App で一連の流れを確認**

1. 左上でブランチを切り替える
2. 履歴タブで2つのコミットを選び、差分が左右2列で出ることを確認
3. PR を開き、3タブが動くこと、コメントを投稿できることを確認
4. 各行の `↗` から元ファイルが開くことを確認

- [ ] **Step 3: README を更新**

「現在の状態」に UI の節を足し、ロードマップの 4c を「実装完了」にする。

- [ ] **Step 4: 計画書に完了マークを付ける**

- [ ] **Step 5: コミット**

```bash
git add README.md docs/
git commit -m "docs: Phase 4c 完了を反映"
```

---

## Phase 4c 完了時に達成されていること

- [ ] `npm test` で `diffPairs` / `fileUrlOf` / PR の会話とコミットのテストが通る
- [ ] 左ペインでブランチを切り替えられ、そのブランチのファイルだけが出る
- [ ] ファイルがパスで階層化されて並ぶ
- [ ] 差分が左右2列で表示され、書き換わった行が左右に並ぶ
- [ ] PR が「会話 / コミット / 変更ファイル」の3タブになる
- [ ] PR にコメントを投稿でき、時系列で読める
- [ ] ファイル一覧の各行から元ファイルを開ける
