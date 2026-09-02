# GWS Git-like 文書管理システム Phase 2 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Docs に対して commit / branch / Pull Request / 3-way merge を行い、マージ結果を元の Doc に書き戻せるようにする。

**Architecture:** Phase 1 で確立した「1ブロック=1行の決定的な正規化HTML」を土台に、Git と同じ行ベースの diff / 3-way merge を適用する。差分アルゴリズム (`Diff.js`) とマージアルゴリズム (`Merge.js`) は GAS API に依存しないピュア関数として実装し、Node + vitest で TDD する。マージ結果は `parseBlocks` で Block 配列に戻し、`HtmlWriter` が `DocumentApp` で main の Doc に書き戻す (fileId は維持)。

**Tech Stack:** Google Apps Script (V8、標準サービスのみ) / clasp 3.x / Node 22 + vitest / HtmlService

**Spec:** `docs/superpowers/specs/2026-09-02-gws-git-management-design.md` (§5 Git操作のセマンティクス)

**前提:** Phase 1 完了済み (`docs/superpowers/plans/2026-09-02-gws-git-management-phase1.md`)

## Global Constraints

Phase 1 と同一。すべてのタスクの要件に暗黙的に含まれる。

- **GAS標準サービスのみ。** Advanced Google Services も `UrlFetchApp` も使わない
- **ランタイムコードに `import` / `export` / `require` を書かない。** テストは `test/harness.js` の `loadGas()` 経由
- **トップレベルの `const` / `let` 初期化を書かない** (GAS のファイル読み込み順に依存するため)。定数は関数として公開する
- **ファイル内部専用の関数は末尾にアンダースコア** (`toHunks_` など)
- **入力検証はアンカー付き正規表現。** glob は使わない
- **文書HTMLは `<iframe sandbox>` 内でレンダリング**し、`allow-scripts` を付けない
- **`el.hidden` で開閉する要素には `[hidden]{display:none!important}` が必要** (Phase 1 で実際に踏んだ。UAスタイルは作者スタイルに詳細度で負ける。`app.css.html` に定義済み)
- **push は `clasp push --force`** (非対話ではマニフェスト確認が否定され `Skipping push.` になる)
- **破壊的操作にはすべて実行者** (`Session.getActiveUser().getEmail()`) を記録する
- コミットメッセージは Conventional Commits 形式

---

## Phase 1 から引き継ぐインターフェース

新規タスクはこれらを前提にしてよい。**再実装してはならない。**

```javascript
// src/core/Normalize.js (ピュア)
serializeBlocks(blocks) → string     // Block配列 → 正規化HTML
parseBlocks(html) → Block[]          // 正規化HTML → Block配列
mergeRuns(runs) → Run[]              // Run正規化 (リンク内の下線を落とす)
normalizeSpace(s) / escapeText(s) / escapeAttr(s) / unescapeText(s)

// src/core/Hash.js (ピュア) / HashGas.gs
bytesToHex(bytes) → string
sha256Hex(content) → string          // 64桁hex
sha256HexBytes(blob) → string

// src/core/Db.gs
DB_SCHEMA() → {table: string[]}
dbReadAll(table) → object[]
dbAppend(table, obj)
dbFindOne(table, key, value) → object|null
dbUpdate(table, key, value, patch) → boolean

// src/core/Repo.gs
repoConfig() → {rootId, mainId, branchesId, gitId, objectsId, dbId}
repoRegisterFile(fileId, path) → object

// src/core/ObjectStore.gs
objectPut(sha, content)              // テキストblob
objectPutBlob(sha, blob, ext)        // バイナリblob
objectGet(sha) → string|null
objectExists(sha, ext) → boolean

// src/render/DocRenderer.gs
renderDocBlocks(fileId) → Block[]
renderDoc(fileId) → string

// src/render/LiveCache.gs
liveHtml(fileId) → string
liveCacheInvalidate(fileId)
```

### Block / Run 型 (Phase 1 で確定)

```javascript
{ text: string, bold?: true, italic?: true, underline?: true, strike?: true, link?: string }

{ type: 'heading',   level: 1..6, runs: Run[] }
{ type: 'paragraph', runs: Run[] }
{ type: 'listItem',  ordered: boolean, depth: number, runs: Run[] }
{ type: 'table',     rows: Run[][][] }
{ type: 'image',     sha: string, alt: string }   // sha は64桁hex または 'unavailable'
```

---

## ファイル構成 (Phase 2 で追加・変更)

```
src/
├── Main.gs                    ← 変更: API を追加
├── core/
│   ├── Diff.js                ← 新規 ★ピュア (Myers 行diff)
│   ├── Merge.js               ← 新規 ★ピュア (3-way merge)
│   ├── Commit.gs              ← 新規
│   ├── Branch.gs              ← 新規
│   └── PullRequest.gs         ← 新規
├── render/
│   └── HtmlWriter.gs          ← 新規 (Block配列 → Google Docs)
└── ui/
    ├── wiki.html              ← 変更: タブUIを追加
    ├── app.css.html           ← 変更: diff/タブのスタイル
    └── app.js.html            ← 変更: 履歴・ブランチ・PR画面
test/
├── diff.test.js               ← 新規
└── merge.test.js              ← 新規
```

### UI 構成についての spec からの逸脱

spec §7 は `?p=history` のようなルート別画面を想定しているが、**実装ではタブ切り替え (SPA風) にする。**
Web App の `doGet` はページ遷移のたびにサーバーラウンドトリップが発生し、Phase 1 の実測でレンダリングに
4 秒かかることが分かっているため、画面遷移ごとに再読み込みする構成は体験を大きく損なう。
論理的な画面構成は spec のまま維持する。

---

## Task 1: Diff.js — 行ベース差分 (Myers)

**Files:**
- Create: `src/core/Diff.js`
- Test: `test/diff.test.js`

**Interfaces:**
- Consumes: なし (完全にピュア)
- Produces:
  - `diffLines(a: string[], b: string[]) → Op[]` — `Op` は `{type:'equal'|'delete'|'insert', line: string}`
  - `splitLines(html: string) → string[]` — 正規化HTMLを行配列に (末尾の空要素を除く)
  - `diffHtml(aHtml: string, bHtml: string) → Op[]`

- [ ] **Step 1: 失敗するテストを書く**

Create `test/diff.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { diffLines, splitLines, diffHtml } = loadGas('src/core/Diff.js');

const ops = (list) => list.map(([type, line]) => ({ type, line }));

describe('splitLines', () => {
  it('末尾の改行で空要素を作らない', () => {
    expect(splitLines('<p>a</p>\n<p>b</p>\n')).toEqual(['<p>a</p>', '<p>b</p>']);
  });

  it('空文字列は空配列になる', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('改行なしの1行も扱える', () => {
    expect(splitLines('<p>a</p>')).toEqual(['<p>a</p>']);
  });
});

describe('diffLines', () => {
  it('同一の入力はすべてequalになる', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual(
      ops([['equal', 'a'], ['equal', 'b']])
    );
  });

  it('末尾への追加を検出する', () => {
    expect(diffLines(['a'], ['a', 'b'])).toEqual(
      ops([['equal', 'a'], ['insert', 'b']])
    );
  });

  it('末尾の削除を検出する', () => {
    expect(diffLines(['a', 'b'], ['a'])).toEqual(
      ops([['equal', 'a'], ['delete', 'b']])
    );
  });

  it('中間への挿入を検出する', () => {
    expect(diffLines(['a', 'c'], ['a', 'b', 'c'])).toEqual(
      ops([['equal', 'a'], ['insert', 'b'], ['equal', 'c']])
    );
  });

  it('行の置換を削除+挿入として表現する', () => {
    const result = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
    expect(result.filter(o => o.type === 'delete')).toEqual(ops([['delete', 'b']]));
    expect(result.filter(o => o.type === 'insert')).toEqual(ops([['insert', 'x']]));
    expect(result.filter(o => o.type === 'equal')).toEqual(
      ops([['equal', 'a'], ['equal', 'c']])
    );
  });

  it('空から空でない配列への差分', () => {
    expect(diffLines([], ['a'])).toEqual(ops([['insert', 'a']]));
  });

  it('空でない配列から空への差分', () => {
    expect(diffLines(['a'], [])).toEqual(ops([['delete', 'a']]));
  });

  it('両方空なら空の結果', () => {
    expect(diffLines([], [])).toEqual([]);
  });

  it('共通部分がない場合は全削除+全挿入', () => {
    const result = diffLines(['a', 'b'], ['x', 'y']);
    expect(result.filter(o => o.type === 'equal')).toEqual([]);
    expect(result.filter(o => o.type === 'delete').length).toBe(2);
    expect(result.filter(o => o.type === 'insert').length).toBe(2);
  });

  it('編集距離が最小になる経路を選ぶ', () => {
    // 'b' を残す経路のほうが編集数が少ない
    const result = diffLines(['a', 'b', 'c'], ['b']);
    expect(result).toEqual(
      ops([['delete', 'a'], ['equal', 'b'], ['delete', 'c']])
    );
  });

  it('deleteはinsertより先に出力される(表示順の安定性)', () => {
    const result = diffLines(['a'], ['b']);
    const types = result.map(o => o.type);
    expect(types.indexOf('delete')).toBeLessThan(types.indexOf('insert'));
  });

  it('大きめの入力でも完了する', () => {
    const a = [];
    const b = [];
    for (let i = 0; i < 300; i++) { a.push('line' + i); b.push('line' + i); }
    b[150] = 'changed';
    const result = diffLines(a, b);
    expect(result.filter(o => o.type === 'delete')).toEqual(ops([['delete', 'line150']]));
    expect(result.filter(o => o.type === 'insert')).toEqual(ops([['insert', 'changed']]));
  });
});

describe('diffHtml', () => {
  it('正規化HTML同士を行単位で比較する', () => {
    const a = '<h1>A</h1>\n<p>x</p>\n';
    const b = '<h1>A</h1>\n<p>y</p>\n';
    expect(diffHtml(a, b)).toEqual(
      ops([['equal', '<h1>A</h1>'], ['delete', '<p>x</p>'], ['insert', '<p>y</p>']])
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `src/core/Diff.js` が存在しない

- [ ] **Step 3: 実装を書く**

Create `src/core/Diff.js`:

```javascript
/**
 * 正規化HTMLを行配列に分割する。
 * serializeBlocks は末尾に改行を付けるため、そのままsplitすると
 * 空の末尾要素ができる。それを除く。
 *
 * @param {string} html
 * @returns {string[]}
 */
function splitLines(html) {
  var s = String(html == null ? '' : html);
  if (s === '') return [];
  var lines = s.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Myersアルゴリズムの経路を逆向きにたどって編集操作列を復元する。
 *
 * @param {object[]} trace 各dラウンドでのvのスナップショット
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} d 最終的な編集距離
 * @returns {object[]} {type, line} の配列
 */
function backtrack_(trace, a, b, d) {
  var ops = [];
  var x = a.length;
  var y = b.length;

  for (var dd = d; dd > 0; dd--) {
    var v = trace[dd];
    var vPrev = trace[dd - 1];
    var k = x - y;

    var prevK;
    if (k === -dd || (k !== dd && vPrev[k - 1] < vPrev[k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    var prevX = vPrev[prevK];
    var prevY = prevX - prevK;

    // 対角線 (一致行) をさかのぼる
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', line: a[x - 1] });
      x--; y--;
    }

    if (x > prevX) {
      ops.push({ type: 'delete', line: a[x - 1] });
      x--;
    } else if (y > prevY) {
      ops.push({ type: 'insert', line: b[y - 1] });
      y--;
    }
  }

  // d=0 まで戻った残りはすべて一致行
  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', line: a[x - 1] });
    x--; y--;
  }

  ops.reverse();
  return ops;
}

/**
 * 同じ位置の delete と insert の並び順を安定させる。
 * Myersの復元順では insert が先に出ることがあるが、
 * 差分表示では「削除された行 → 追加された行」の順が読みやすい。
 *
 * @param {object[]} ops
 * @returns {object[]}
 */
function stabilizeOps_(ops) {
  var out = [];
  var i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      out.push(ops[i]);
      i++;
      continue;
    }
    // 連続する非equalブロックを集め、delete群 → insert群 の順に並べ直す
    var dels = [];
    var ins = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') dels.push(ops[i]);
      else ins.push(ops[i]);
      i++;
    }
    for (var d = 0; d < dels.length; d++) out.push(dels[d]);
    for (var n = 0; n < ins.length; n++) out.push(ins[n]);
  }
  return out;
}

/**
 * 2つの行配列の差分をMyersアルゴリズムで求める。
 *
 * 計算量は O((N+M)D) で、Dは編集距離。文書の版管理では通常
 * 変更箇所が少ないためDが小さく、実用上は線形に近い。
 *
 * @param {string[]} a 変更前
 * @param {string[]} b 変更後
 * @returns {object[]} {type:'equal'|'delete'|'insert', line:string} の配列
 */
function diffLines(a, b) {
  var N = a.length;
  var M = b.length;

  if (N === 0 && M === 0) return [];
  if (N === 0) {
    var allIns = [];
    for (var bi = 0; bi < M; bi++) allIns.push({ type: 'insert', line: b[bi] });
    return allIns;
  }
  if (M === 0) {
    var allDel = [];
    for (var ai = 0; ai < N; ai++) allDel.push({ type: 'delete', line: a[ai] });
    return allDel;
  }

  var MAX = N + M;
  var v = {};
  v[1] = 0;
  var trace = [];

  for (var d = 0; d <= MAX; d++) {
    var snapshot = {};
    for (var key in v) {
      if (Object.prototype.hasOwnProperty.call(v, key)) snapshot[key] = v[key];
    }
    trace.push(snapshot);

    for (var k = -d; k <= d; k += 2) {
      var x;
      if (k === -d || (k !== d && v[k - 1] < v[k + 1])) {
        x = v[k + 1];
      } else {
        x = v[k - 1] + 1;
      }
      var y = x - k;

      while (x < N && y < M && a[x] === b[y]) { x++; y++; }

      v[k] = x;

      if (x >= N && y >= M) {
        // 到達したラウンドのvもtraceに含める必要がある
        var finalSnapshot = {};
        for (var fk in v) {
          if (Object.prototype.hasOwnProperty.call(v, fk)) finalSnapshot[fk] = v[fk];
        }
        trace.push(finalSnapshot);
        return stabilizeOps_(backtrack_(trace, a, b, d));
      }
    }
  }

  return [];
}

/**
 * 正規化HTML同士を行単位で比較する。
 *
 * @param {string} aHtml
 * @param {string} bHtml
 * @returns {object[]}
 */
function diffHtml(aHtml, bHtml) {
  return diffLines(splitLines(aHtml), splitLines(bHtml));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (全テスト)

失敗する場合、`backtrack_` の `trace` インデックスがずれている可能性が高い。
`trace[dd]` は「dd 回目のラウンドに入る前の v」でなければならない。

- [ ] **Step 5: コミット**

```bash
git add src/core/Diff.js test/diff.test.js
git commit -m "feat: Myersアルゴリズムによる行ベース差分を追加"
```

---

## Task 2: Merge.js — 3-way merge

**Files:**
- Create: `src/core/Merge.js`
- Test: `test/merge.test.js`

**Interfaces:**
- Consumes: Task 1 の `diffLines`, `splitLines`
- Produces:
  - `merge3(base: string[], ours: string[], theirs: string[]) → MergeResult`
    - `MergeResult` = `{ clean: boolean, lines: string[], conflicts: Conflict[] }`
    - `Conflict` = `{ index: number, base: string[], ours: string[], theirs: string[] }`
      (`index` は `lines` 配列内で衝突が起きた位置)
  - `merge3Html(baseHtml, oursHtml, theirsHtml) → MergeResult`
  - `resolveConflicts(result: MergeResult, choices: string[]) → string[]`
    (`choices[i]` は i 番目のコンフリクトに対する `'ours'` / `'theirs'` / `'both'`)

### アルゴリズム

base に対する2つの編集を「hunk (置換区間)」に変換し、区間が重なるかどうかで判定する。

```
base:   [A, B, C, D]
ours:   [A, X, C, D]     → hunk: base[1..2) を [X] に置換
theirs: [A, B, C, Y]     → hunk: base[3..4) を [Y] に置換
                         → 区間が重ならない → 両方適用 → [A, X, C, Y]

ours:   [A, X, C, D]     → hunk: base[1..2) を [X] に置換
theirs: [A, Z, C, D]     → hunk: base[1..2) を [Z] に置換
                         → 同じ区間で内容が違う → コンフリクト
```

- [ ] **Step 1: 失敗するテストを書く**

Create `test/merge.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

// Merge.js は Diff.js の関数を使うため、同じコンテキストに両方読み込む
const { merge3, merge3Html, resolveConflicts } =
  loadGas('src/core/Diff.js', 'src/core/Merge.js');

describe('merge3', () => {
  it('誰も変更していなければbaseのまま', () => {
    const r = merge3(['a', 'b'], ['a', 'b'], ['a', 'b']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.conflicts).toEqual([]);
  });

  it('oursだけが変更していればoursを採用する', () => {
    const r = merge3(['a', 'b'], ['a', 'X'], ['a', 'b']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a', 'X']);
  });

  it('theirsだけが変更していればtheirsを採用する', () => {
    const r = merge3(['a', 'b'], ['a', 'b'], ['a', 'Y']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a', 'Y']);
  });

  it('離れた場所への変更は両方適用する', () => {
    const r = merge3(['a', 'b', 'c', 'd'], ['X', 'b', 'c', 'd'], ['a', 'b', 'c', 'Y']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['X', 'b', 'c', 'Y']);
  });

  it('両方が同一の変更をしていれば衝突しない', () => {
    const r = merge3(['a', 'b'], ['a', 'X'], ['a', 'X']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a', 'X']);
  });

  it('同じ行への異なる変更はコンフリクトになる', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c']);
    expect(r.clean).toBe(false);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].base).toEqual(['b']);
    expect(r.conflicts[0].ours).toEqual(['X']);
    expect(r.conflicts[0].theirs).toEqual(['Y']);
  });

  it('コンフリクト時もlinesにはours側を入れておく', () => {
    // 未解決状態でもプレビューできるようにする
    const r = merge3(['a', 'b'], ['a', 'X'], ['a', 'Y']);
    expect(r.lines).toEqual(['a', 'X']);
  });

  it('片方が削除、もう片方が変更ならコンフリクト', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'c'], ['a', 'X', 'c']);
    expect(r.clean).toBe(false);
    expect(r.conflicts.length).toBe(1);
    expect(r.conflicts[0].ours).toEqual([]);
    expect(r.conflicts[0].theirs).toEqual(['X']);
  });

  it('両方が同じ行を削除していれば衝突しない', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'c'], ['a', 'c']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a', 'c']);
  });

  it('末尾への追記を両方が行った場合はコンフリクト', () => {
    const r = merge3(['a'], ['a', 'X'], ['a', 'Y']);
    expect(r.clean).toBe(false);
    expect(r.conflicts.length).toBe(1);
  });

  it('oursが空でtheirsが変更した場合', () => {
    const r = merge3(['a'], [], ['a', 'X']);
    expect(r.clean).toBe(false);
  });

  it('baseが空で両方が同じ内容を追加した場合は衝突しない', () => {
    const r = merge3([], ['a'], ['a']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a']);
  });

  it('複数のコンフリクトを個別に報告する', () => {
    const r = merge3(
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'X', 'c', 'P', 'e'],
      ['a', 'Y', 'c', 'Q', 'e']
    );
    expect(r.clean).toBe(false);
    expect(r.conflicts.length).toBe(2);
  });
});

describe('merge3Html', () => {
  it('正規化HTMLをマージする', () => {
    const base = '<h1>A</h1>\n<p>x</p>\n';
    const ours = '<h1>A</h1>\n<p>ours</p>\n';
    const theirs = '<h1>B</h1>\n<p>x</p>\n';
    const r = merge3Html(base, ours, theirs);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['<h1>B</h1>', '<p>ours</p>']);
  });
});

describe('resolveConflicts', () => {
  it("'ours' を選ぶとours側が採用される", () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c']);
    expect(resolveConflicts(r, ['ours'])).toEqual(['a', 'X', 'c']);
  });

  it("'theirs' を選ぶとtheirs側が採用される", () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c']);
    expect(resolveConflicts(r, ['theirs'])).toEqual(['a', 'Y', 'c']);
  });

  it("'both' を選ぶとours→theirsの順で両方採用される", () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c']);
    expect(resolveConflicts(r, ['both'])).toEqual(['a', 'X', 'Y', 'c']);
  });

  it('選択数がコンフリクト数と一致しなければエラー', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c']);
    expect(() => resolveConflicts(r, [])).toThrow(/選択の数/);
  });

  it('未知の選択肢はエラー', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'X', 'c'], ['a', 'Y', 'c']);
    expect(() => resolveConflicts(r, ['mine'])).toThrow(/不正な選択/);
  });

  it('クリーンなマージ結果はそのまま返す', () => {
    const r = merge3(['a'], ['a', 'b'], ['a']);
    expect(resolveConflicts(r, [])).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `src/core/Merge.js` が存在しない

- [ ] **Step 3: 実装を書く**

Create `src/core/Merge.js`:

```javascript
/**
 * 差分操作列を、base に対する置換区間 (hunk) のリストに変換する。
 *
 * hunk は {start, end, lines} で、base[start..end) を lines に
 * 置き換えることを意味する。equal が続く区間は hunk にならない。
 *
 * @param {object[]} ops diffLines の出力
 * @returns {object[]} {start:number, end:number, lines:string[]}
 */
function toHunks_(ops) {
  var hunks = [];
  var basePos = 0;
  var i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      basePos++;
      i++;
      continue;
    }

    var start = basePos;
    var replacement = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') {
        basePos++;
      } else {
        replacement.push(ops[i].line);
      }
      i++;
    }
    hunks.push({ start: start, end: basePos, lines: replacement });
  }

  return hunks;
}

/**
 * 2つの文字列配列が等しいか判定する。
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function sameLines_(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 2つのhunkが base 上で重なるか判定する。
 *
 * 長さ0の区間 (純粋な挿入) は、同じ位置にある場合のみ重なりとみなす。
 * 挿入位置が同じなら、どちらを先に置くか決められないためコンフリクトになる。
 *
 * @param {object} h1
 * @param {object} h2
 * @returns {boolean}
 */
function hunksOverlap_(h1, h2) {
  if (h1.start === h1.end && h2.start === h2.end) return h1.start === h2.start;
  return h1.start < h2.end && h2.start < h1.end;
}

/**
 * base / ours / theirs の3-wayマージを行う。
 *
 * base に対する ours の変更と theirs の変更をそれぞれ hunk に変換し、
 * base 上で重なるかどうかで判定する:
 *   - 重ならない        → 両方適用
 *   - 重なり内容が同じ  → 片方だけ適用
 *   - 重なり内容が違う  → コンフリクト
 *
 * コンフリクトがある場合も lines には ours 側を入れて返す。
 * 未解決のままプレビューできるようにするため。
 *
 * @param {string[]} base 分岐点の内容
 * @param {string[]} ours マージ先 (通常 main) の現在の内容
 * @param {string[]} theirs マージ元 (ブランチ) の現在の内容
 * @returns {{clean:boolean, lines:string[], conflicts:object[]}}
 */
function merge3(base, ours, theirs) {
  var oursHunks = toHunks_(diffLines(base, ours));
  var theirsHunks = toHunks_(diffLines(base, theirs));

  var lines = [];
  var conflicts = [];
  var basePos = 0;
  var oi = 0;
  var ti = 0;

  while (oi < oursHunks.length || ti < theirsHunks.length) {
    var oh = oi < oursHunks.length ? oursHunks[oi] : null;
    var th = ti < theirsHunks.length ? theirsHunks[ti] : null;

    // 次に処理すべきhunkの開始位置
    var nextStart;
    if (oh && th) nextStart = Math.min(oh.start, th.start);
    else if (oh) nextStart = oh.start;
    else nextStart = th.start;

    // hunkの手前までのbase行をそのまま出力
    while (basePos < nextStart) {
      lines.push(base[basePos]);
      basePos++;
    }

    if (oh && th && hunksOverlap_(oh, th)) {
      if (sameLines_(oh.lines, th.lines)) {
        for (var s = 0; s < oh.lines.length; s++) lines.push(oh.lines[s]);
      } else {
        conflicts.push({
          index: lines.length,
          base: base.slice(Math.min(oh.start, th.start), Math.max(oh.end, th.end)),
          ours: oh.lines.slice(),
          theirs: th.lines.slice(),
        });
        // 未解決状態のプレビュー用に ours を入れておく
        for (var c = 0; c < oh.lines.length; c++) lines.push(oh.lines[c]);
      }
      basePos = Math.max(oh.end, th.end);
      oi++;
      ti++;

    } else if (oh && (!th || oh.start <= th.start)) {
      for (var o = 0; o < oh.lines.length; o++) lines.push(oh.lines[o]);
      basePos = oh.end;
      oi++;

    } else {
      for (var t = 0; t < th.lines.length; t++) lines.push(th.lines[t]);
      basePos = th.end;
      ti++;
    }
  }

  // 残りのbase行を出力
  while (basePos < base.length) {
    lines.push(base[basePos]);
    basePos++;
  }

  return { clean: conflicts.length === 0, lines: lines, conflicts: conflicts };
}

/**
 * 正規化HTML同士を3-wayマージする。
 *
 * @param {string} baseHtml
 * @param {string} oursHtml
 * @param {string} theirsHtml
 * @returns {{clean:boolean, lines:string[], conflicts:object[]}}
 */
function merge3Html(baseHtml, oursHtml, theirsHtml) {
  return merge3(splitLines(baseHtml), splitLines(oursHtml), splitLines(theirsHtml));
}

/**
 * コンフリクトに対する選択を適用して最終的な行配列を作る。
 *
 * merge3 の lines には ours 側が入っているため、'ours' 以外を選んだ
 * コンフリクトだけを置き換える。後ろのコンフリクトから処理することで
 * インデックスのずれを避ける。
 *
 * @param {object} result merge3 の戻り値
 * @param {string[]} choices 各コンフリクトに対する 'ours'|'theirs'|'both'
 * @returns {string[]}
 */
function resolveConflicts(result, choices) {
  if (result.conflicts.length !== choices.length) {
    throw new Error(
      '選択の数がコンフリクトの数と一致しません: ' +
      choices.length + ' / ' + result.conflicts.length
    );
  }

  var lines = result.lines.slice();

  for (var i = result.conflicts.length - 1; i >= 0; i--) {
    var conf = result.conflicts[i];
    var choice = choices[i];
    var replacement;

    if (choice === 'ours') {
      continue;
    } else if (choice === 'theirs') {
      replacement = conf.theirs;
    } else if (choice === 'both') {
      replacement = conf.ours.concat(conf.theirs);
    } else {
      throw new Error('不正な選択です: ' + choice);
    }

    var args = [conf.index, conf.ours.length].concat(replacement);
    Array.prototype.splice.apply(lines, args);
  }

  return lines;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS (全テスト)

- [ ] **Step 5: コミット**

```bash
git add src/core/Merge.js test/merge.test.js
git commit -m "feat: 3-way mergeとコンフリクト解決を追加"
```

---

## Task 3: Commit.gs — コミットの作成と履歴取得

**Files:**
- Create: `src/core/Commit.gs`
- Modify: `src/Main.gs` (API を追加)

**Interfaces:**
- Consumes: `sha256Hex`, `objectPut`, `objectGet`, `dbAppend`, `dbReadAll`, `dbFindOne`, `dbUpdate`, `liveHtml`, `diffHtml`
- Produces:
  - `commitFile(fileId: string, branch: string, message: string, expectedHeadSha: string|null) → object`
  - `headCommit(fileId: string, branch: string) → object|null`
  - `commitHistory(fileId: string, branch: string) → object[]` (新しい順)
  - `commitHtml(sha: string) → string|null`
  - `fileStatus(fileId: string, branch: string) → {dirty: boolean, headSha: string|null, ops: object[]}`

- [ ] **Step 1: Commit.gs を作成**

```javascript
/**
 * コミットSHAを計算する。内容だけでなく親・作者・時刻も含めることで、
 * 同じ内容の再コミットでも異なるコミットSHAになる。
 *
 * blobSha は内容そのもののハッシュで、これとは別物である。
 *
 * @param {string} parentSha
 * @param {string} blobSha
 * @param {string} author
 * @param {string} message
 * @param {Date} timestamp
 * @returns {string} 64桁hex
 */
function commitSha_(parentSha, blobSha, author, message, timestamp) {
  return sha256Hex([
    'parent:' + (parentSha || ''),
    'blob:' + blobSha,
    'author:' + author,
    'message:' + message,
    'time:' + timestamp.getTime(),
  ].join('\n'));
}

/**
 * ブランチ上のファイルの最新コミットを返す。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {object|null} commits 行
 */
function headCommit(fileId, branch) {
  var rows = dbReadAll('commits');
  var best = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.fileId) !== String(fileId)) continue;
    if (String(r.branch) !== String(branch)) continue;
    if (!best || new Date(r.timestamp) >= new Date(best.timestamp)) best = r;
  }
  return best;
}

/**
 * ブランチ上のファイルのコミット履歴を新しい順で返す。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {object[]}
 */
function commitHistory(fileId, branch) {
  var rows = dbReadAll('commits');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.fileId) !== String(fileId)) continue;
    if (String(r.branch) !== String(branch)) continue;
    out.push(r);
  }
  out.sort(function (x, y) {
    return new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime();
  });
  return out;
}

/**
 * コミットSHAから、その時点の正規化HTMLを取得する。
 *
 * @param {string} sha コミットSHA
 * @returns {string|null}
 */
function commitHtml(sha) {
  var row = dbFindOne('commits', 'sha', sha);
  return row ? objectGet(row.blobSha) : null;
}

/**
 * ファイルの現在の状態を返す。HEADコミットと現在のライブ内容を比較し、
 * 未コミットの変更があるかを判定する (git status 相当)。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {{dirty:boolean, headSha:string|null, ops:object[]}}
 */
function fileStatus(fileId, branch) {
  var head = headCommit(fileId, branch);
  var live = liveHtml(fileId);

  if (!head) {
    return { dirty: true, headSha: null, ops: diffHtml('', live) };
  }

  var committed = objectGet(head.blobSha) || '';
  if (committed === live) {
    return { dirty: false, headSha: head.sha, ops: [] };
  }
  return { dirty: true, headSha: head.sha, ops: diffHtml(committed, live) };
}

/**
 * ファイルの現在の内容をコミットする。
 *
 * 内容がHEADと同一なら空コミットを作らずエラーにする。
 * expectedHeadSha を渡すと楽観的並行制御が働き、その間に他者が
 * コミットしていた場合は拒否される (scaling doc §6.3)。
 *
 * @param {string} fileId
 * @param {string} branch
 * @param {string} message
 * @param {string|null} expectedHeadSha 省略時はチェックしない
 * @returns {object} 作成された commits 行
 */
function commitFile(fileId, branch, message, expectedHeadSha) {
  if (!/^.{1,500}$/.test(String(message || ''))) {
    throw new Error('コミットメッセージを入力してください');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('他の処理が実行中です。しばらくしてから再試行してください');
  }

  try {
    var head = headCommit(fileId, branch);
    var headSha = head ? head.sha : null;

    if (expectedHeadSha !== undefined && expectedHeadSha !== null &&
        String(expectedHeadSha) !== String(headSha)) {
      throw new Error(
        'HEADが進んでいます。画面を再読み込みしてから再度コミットしてください'
      );
    }

    var html = liveHtml(fileId);
    var blobSha = sha256Hex(html);

    if (head && String(head.blobSha) === blobSha) {
      throw new Error('変更がありません');
    }

    objectPut(blobSha, html);

    var author = Session.getActiveUser().getEmail();
    var timestamp = new Date();
    var sha = commitSha_(headSha, blobSha, author, message, timestamp);

    var row = {
      sha: sha,
      parentSha: headSha || '',
      branch: branch,
      fileId: fileId,
      blobSha: blobSha,
      author: author,
      message: message,
      timestamp: timestamp,
    };
    dbAppend('commits', row);

    if (dbFindOne('branches', 'name', branch)) {
      dbUpdate('branches', 'name', branch, { headSha: sha });
    }

    return row;
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: main ブランチの初期化を Repo.gs に追加**

`main` ブランチが `branches` テーブルに存在しないと `commitFile` が
headSha を更新できない。`repoInit` の末尾で登録する。

Modify `src/core/Repo.gs` — `Logger.log('リポジトリを初期化しました…')` の直前に追加:

```javascript
  dbAppend('branches', {
    name: 'main',
    headSha: '',
    baseSha: '',
    state: 'open',
    workingFolderId: config.mainId,
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  });
```

**既に `repoInit` を実行済みの環境では、この行は反映されない。**
Task 3 Step 4 の `debugEnsureMainBranch` で補う。

- [ ] **Step 3: Main.gs に API と検証関数を追加**

Append to `src/Main.gs`:

```javascript
/**
 * 既存リポジトリに main ブランチ行が無い場合に補う (移行用)。
 * repoInit を実行済みの環境で1回だけ実行する。
 *
 * @returns {string} 実行結果
 */
function debugEnsureMainBranch() {
  if (dbFindOne('branches', 'name', 'main')) return 'main ブランチは既に存在します';
  dbAppend('branches', {
    name: 'main',
    headSha: '',
    baseSha: '',
    state: 'open',
    workingFolderId: repoConfig().mainId,
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  });
  return 'main ブランチを追加しました';
}

/**
 * ファイルの状態を返す (Web App API)。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {{dirty:boolean, headSha:string|null, ops:object[]}}
 */
function apiFileStatus(fileId, branch) {
  return fileStatus(fileId, branch || 'main');
}

/**
 * ファイルをコミットする (Web App API)。
 *
 * @param {string} fileId
 * @param {string} branch
 * @param {string} message
 * @param {string|null} expectedHeadSha
 * @returns {object}
 */
function apiCommit(fileId, branch, message, expectedHeadSha) {
  return commitFile(fileId, branch || 'main', message, expectedHeadSha);
}

/**
 * コミット履歴を返す (Web App API)。
 * timestamp は google.script.run で文字列化されるため ISO 文字列で返す。
 *
 * @param {string} fileId
 * @param {string} branch
 * @returns {object[]}
 */
function apiCommitHistory(fileId, branch) {
  var rows = commitHistory(fileId, branch || 'main');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      sha: rows[i].sha,
      parentSha: rows[i].parentSha,
      author: rows[i].author,
      message: rows[i].message,
      timestamp: new Date(rows[i].timestamp).toISOString(),
    });
  }
  return out;
}

/**
 * 2つのコミット間の差分を返す (Web App API)。
 * fromSha が空文字なら初回コミットとして扱う。
 *
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {object[]} diff ops
 */
function apiCommitDiff(fromSha, toSha) {
  var from = fromSha ? (commitHtml(fromSha) || '') : '';
  var to = commitHtml(toSha);
  if (to === null) throw new Error('コミットが見つかりません: ' + toSha);
  return diffHtml(from, to);
}

/**
 * コミット機能の動作確認用。
 */
function debugCommit() {
  var fileId = debugFileId_();
  var before = fileStatus(fileId, 'main');
  Logger.log('コミット前の状態: dirty=' + before.dirty + ' head=' + before.headSha);

  var row = commitFile(fileId, 'main', '初回コミット', before.headSha);
  Logger.log('コミット作成: ' + row.sha);

  var after = fileStatus(fileId, 'main');
  Logger.log('コミット後の状態: dirty=' + after.dirty + ' head=' + after.headSha);
  Logger.log('履歴件数: ' + commitHistory(fileId, 'main').length);
}
```

- [ ] **Step 4: push して動作確認**

Run: `clasp push --force`

GASエディタで以下を順に実行する:

1. **`debugEnsureMainBranch`** → 「main ブランチを追加しました」
2. **`debugCommit`** → ログを確認

Expected:
- コミット前: `dirty=true head=null`
- コミット作成: 64桁hex
- コミット後: **`dirty=false`** (ライブ内容とコミット内容が一致)
- 履歴件数: 1

- [ ] **Step 5: 空コミットが拒否されることを確認**

**`debugCommit`** をもう一度実行する。

Expected: `変更がありません` というエラーで停止する

- [ ] **Step 6: 変更後のコミットを確認**

1. Doc を開いて1行追加して閉じる
2. **`debugCommit`** を実行

Expected: 2件目のコミットが作られ、`履歴件数: 2` になる

- [ ] **Step 7: メタDBを目視確認**

`.git/agentic-management repo-db` を開き、`commits` シートに2行あること、
`branches` シートの `main` 行の `headSha` が最新コミットと一致することを確認する。

- [ ] **Step 8: コミット**

```bash
git add src/core/Commit.gs src/core/Repo.gs src/Main.gs
git commit -m "feat: コミットの作成と履歴取得を追加"
```

---

## Task 4: 履歴とコミットのUI

**Files:**
- Modify: `src/ui/wiki.html` (タブと履歴パネルを追加)
- Modify: `src/ui/app.css.html` (タブ・diff のスタイル)
- Modify: `src/ui/app.js.html` (履歴・diff 表示・コミット操作)

**Interfaces:**
- Consumes: Task 3 の `apiFileStatus`, `apiCommit`, `apiCommitHistory`, `apiCommitDiff`
- Produces: ブラウザ上で動作する履歴画面

- [ ] **Step 1: wiki.html にタブと履歴パネルを追加**

Replace the `<div class="main">` block in `src/ui/wiki.html`:

```html
    <div class="main">
      <div class="toolbar">
        <h1 id="doc-title">—</h1>
        <span id="dirty-badge" class="badge" hidden>未コミットの変更</span>
        <span class="spacer"></span>
        <button id="commit-btn" class="btn" hidden>コミット</button>
        <a id="open-in-docs" href="#" target="_blank" hidden>Google ドキュメントで開く</a>
      </div>

      <div class="tabs" id="tabs" hidden>
        <button class="tab" data-tab="content" aria-current="true">本文</button>
        <button class="tab" data-tab="history">履歴</button>
      </div>

      <div class="panel" id="panel-content">
        <iframe id="viewer" class="viewer" sandbox></iframe>
      </div>

      <div class="panel" id="panel-history" hidden>
        <div class="history-list" id="history-list"></div>
        <div class="diff-view" id="diff-view"></div>
      </div>

      <div id="empty" class="empty">左からファイルを選択してください</div>
    </div>
```

- [ ] **Step 2: app.css.html にスタイルを追加**

Append before `</style>` in `src/ui/app.css.html`:

```css
.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #fef3c7;
  color: #92400e;
}

.btn {
  font-family: inherit;
  font-size: 13px;
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
}

.btn:hover { background: var(--bg-2); }

.tabs {
  display: flex;
  gap: 4px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
}

.tab {
  font-family: inherit;
  font-size: 13px;
  padding: 8px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
}

.tab[aria-current="true"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.panel { flex: 1; display: flex; overflow: hidden; }

#panel-history { flex-direction: row; }

.history-list {
  width: 320px;
  flex: 0 0 320px;
  overflow-y: auto;
  border-right: 1px solid var(--line);
}

.commit-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 16px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
}

.commit-item:hover { background: var(--bg-2); }
.commit-item[aria-current="true"] { background: rgba(26, 115, 232, 0.08); }

.commit-message { font-size: 13px; color: var(--ink); margin-bottom: 3px; }
.commit-meta { font-size: 11px; color: var(--ink-2); }

.diff-view {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.diff-line {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 1px 8px;
  border-radius: 2px;
}

.diff-equal  { color: var(--ink-2); }
.diff-insert { background: #e6ffed; color: #22863a; }
.diff-delete { background: #ffeef0; color: #b31d28; }

.diff-empty { color: var(--ink-2); font-family: inherit; }
```

- [ ] **Step 3: app.js.html に履歴機能を追加**

Replace the entire `<script>` block in `src/ui/app.js.html`:

```html
<script>
(function () {
  'use strict';

  var listEl = document.getElementById('file-list');
  var viewer = document.getElementById('viewer');
  var empty = document.getElementById('empty');
  var titleEl = document.getElementById('doc-title');
  var openLink = document.getElementById('open-in-docs');
  var dirtyBadge = document.getElementById('dirty-badge');
  var commitBtn = document.getElementById('commit-btn');
  var tabsEl = document.getElementById('tabs');
  var panelContent = document.getElementById('panel-content');
  var panelHistory = document.getElementById('panel-history');
  var historyList = document.getElementById('history-list');
  var diffView = document.getElementById('diff-view');

  var current = { fileId: null, headSha: null, branch: 'main' };

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
    var open = [];

    function closeTo(depth) {
      while (open.length > depth) out.push('</' + open.pop().tag + '>');
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

  /**
   * 文書HTMLをiframeのsrcdocに流し込む。
   *
   * sandbox属性を値なしで指定しているため、スクリプト実行・フォーム送信・
   * 同一オリジンアクセスがすべて禁止される。
   *
   * @param {string} bodyHtml
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
   * diff操作列を色分けして表示する。
   *
   * 行の内容は textContent で入れる。innerHTML を使うと文書内容が
   * そのままHTMLとして解釈され、XSSになる。
   *
   * @param {object[]} ops
   */
  function renderDiff(ops) {
    diffView.textContent = '';
    if (!ops || ops.length === 0) {
      var p = document.createElement('p');
      p.className = 'diff-empty';
      p.textContent = '差分はありません';
      diffView.appendChild(p);
      return;
    }
    ops.forEach(function (op) {
      var div = document.createElement('div');
      div.className = 'diff-line diff-' + op.type;
      var mark = op.type === 'insert' ? '+ ' : (op.type === 'delete' ? '- ' : '  ');
      div.textContent = mark + op.line;
      diffView.appendChild(div);
    });
  }

  function switchTab(name) {
    var tabs = tabsEl.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-current', String(tabs[i].dataset.tab === name));
    }
    panelContent.hidden = name !== 'content';
    panelHistory.hidden = name !== 'history';
    if (name === 'history') loadHistory();
  }

  function loadHistory() {
    historyList.textContent = '読み込み中…';
    google.script.run
      .withSuccessHandler(function (commits) {
        historyList.textContent = '';
        if (commits.length === 0) {
          var p = document.createElement('p');
          p.style.cssText = 'padding:12px 16px;color:#666;font-size:13px;';
          p.textContent = 'コミットがありません';
          historyList.appendChild(p);
          renderDiff([]);
          return;
        }
        commits.forEach(function (c) {
          var btn = document.createElement('button');
          btn.className = 'commit-item';

          var msg = document.createElement('div');
          msg.className = 'commit-message';
          msg.textContent = c.message;

          var meta = document.createElement('div');
          meta.className = 'commit-meta';
          meta.textContent =
            c.sha.substring(0, 7) + ' · ' + c.author + ' · ' +
            new Date(c.timestamp).toLocaleString('ja-JP');

          btn.appendChild(msg);
          btn.appendChild(meta);
          btn.addEventListener('click', function () {
            var items = historyList.querySelectorAll('.commit-item');
            for (var i = 0; i < items.length; i++) {
              items[i].setAttribute('aria-current', String(items[i] === btn));
            }
            diffView.textContent = '読み込み中…';
            google.script.run
              .withSuccessHandler(renderDiff)
              .withFailureHandler(function (err) {
                diffView.textContent = 'エラー: ' + err.message;
              })
              .apiCommitDiff(c.parentSha || '', c.sha);
          });
          historyList.appendChild(btn);
        });
        commits.length > 0 && historyList.firstChild.click();
      })
      .withFailureHandler(function (err) {
        historyList.textContent = 'エラー: ' + err.message;
      })
      .apiCommitHistory(current.fileId, current.branch);
  }

  function refreshStatus() {
    google.script.run
      .withSuccessHandler(function (st) {
        current.headSha = st.headSha;
        dirtyBadge.hidden = !st.dirty;
        commitBtn.hidden = !st.dirty;
      })
      .withFailureHandler(function () { /* 状態表示は失敗しても致命的ではない */ })
      .apiFileStatus(current.fileId, current.branch);
  }

  function doCommit() {
    var message = window.prompt('コミットメッセージを入力してください');
    if (!message) return;

    commitBtn.disabled = true;
    google.script.run
      .withSuccessHandler(function () {
        commitBtn.disabled = false;
        refreshStatus();
        if (!panelHistory.hidden) loadHistory();
      })
      .withFailureHandler(function (err) {
        commitBtn.disabled = false;
        window.alert('コミットできませんでした: ' + err.message);
      })
      .apiCommit(current.fileId, current.branch, message, current.headSha);
  }

  function selectFile(fileId, button) {
    var buttons = listEl.querySelectorAll('.file-item');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-current', String(buttons[i] === button));
    }

    current.fileId = fileId;
    titleEl.textContent = '読み込み中…';

    google.script.run
      .withSuccessHandler(function (res) {
        empty.hidden = true;
        tabsEl.hidden = false;
        titleEl.textContent = res.path;
        openLink.href = res.url;
        openLink.hidden = false;
        renderIntoViewer(res.html);
        switchTab('content');
        refreshStatus();
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

  var tabButtons = tabsEl.querySelectorAll('.tab');
  for (var t = 0; t < tabButtons.length; t++) {
    (function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    })(tabButtons[t]);
  }
  commitBtn.addEventListener('click', doCommit);

  panelContent.hidden = true;
  panelHistory.hidden = true;

  google.script.run
    .withSuccessHandler(renderFileList)
    .withFailureHandler(function (err) {
      listEl.textContent = 'エラー: ' + err.message;
    })
    .apiListFiles();
})();
</script>
```

- [ ] **Step 4: push して再デプロイ**

```bash
clasp push --force
clasp update-deployment <deploymentId>
```

`<deploymentId>` は `clasp list-deployments` で確認する (`@HEAD` ではない方)。

- [ ] **Step 5: Web App で動作確認**

確認項目:

- ファイルを選ぶと「本文」「履歴」タブが出る
- Doc を編集して戻ると **「未コミットの変更」バッジと「コミット」ボタンが出る**
- コミットするとバッジが消える
- 「履歴」タブでコミット一覧が出る
- コミットを選ぶと**差分が緑 (追加) / 赤 (削除) で表示される**
- `<p>` などのHTMLタグが**タグとして解釈されず、文字列として表示される** (diff表示のXSS対策)

- [ ] **Step 6: コミット**

```bash
git add src/ui/
git commit -m "feat: 履歴タブと差分表示、コミット操作のUIを追加"
```

---

## Task 5: Branch.gs — ブランチの作成と一覧

**Files:**
- Create: `src/core/Branch.gs`
- Modify: `src/Main.gs`

**Interfaces:**
- Consumes: `repoConfig`, `dbAppend`, `dbReadAll`, `dbFindOne`, `dbUpdate`, `headCommit`, `commitFile`, `repoRegisterFile`
- Produces:
  - `branchCreate(name: string, fileId: string) → object`
  - `branchList() → object[]`
  - `branchDelete(name: string) → void`
  - `branchWorkingFileId(name: string, mainFileId: string) → string|null`

### 設計

ブランチはファイル単位ではなくリポジトリ単位の概念だが、PoC では
**1ブランチ = 1ファイルの作業コピー**とする。`branches` シートの
`workingFolderId` にコピー先フォルダを持ち、その中に元と同名の
Doc コピーを置く。

`branch_files` のような追加テーブルは作らない。作業コピーの fileId は
`files` テーブルに `path` を `branches/<name>/<元のpath>` として登録する。
これにより Wiki のファイル一覧にブランチ版も現れ、そのまま閲覧・コミットできる。

- [ ] **Step 1: Branch.gs を作成**

```javascript
/**
 * ブランチ名を検証する。
 *
 * shell の glob ではなくアンカー付き正規表現を使う。日本語も許可するが、
 * Drive のフォルダ名として使えない文字とパス区切りは禁止する。
 *
 * @param {string} name
 * @returns {boolean}
 */
function branchNameValid_(name) {
  return /^[A-Za-z0-9ぁ-んァ-ヶ一-龠々ー_\-]{1,80}$/.test(String(name || ''));
}

/**
 * ブランチ上での作業コピーの論理パスを作る。
 *
 * @param {string} name ブランチ名
 * @param {string} mainPath main上の論理パス
 * @returns {string}
 */
function branchPath_(name, mainPath) {
  return 'branches/' + name + '/' + mainPath;
}

/**
 * ブランチ一覧を返す。
 *
 * @returns {object[]} branches 行
 */
function branchList() {
  return dbReadAll('branches');
}

/**
 * ブランチ上の作業コピーの fileId を返す。
 *
 * @param {string} name ブランチ名
 * @param {string} mainFileId main上の fileId
 * @returns {string|null}
 */
function branchWorkingFileId(name, mainFileId) {
  var mainRow = dbFindOne('files', 'fileId', mainFileId);
  if (!mainRow) return null;
  var row = dbFindOne('files', 'path', branchPath_(name, mainRow.path));
  return row ? row.fileId : null;
}

/**
 * ブランチを作成し、対象ファイルの作業コピーを作る。
 *
 * baseSha には分岐時点の main HEAD を記録する。これが3-way merge の
 * base になるため、正確に記録することが最も重要である。
 *
 * @param {string} name ブランチ名
 * @param {string} fileId main上の対象ファイル
 * @returns {object} 作成された branches 行
 */
function branchCreate(name, fileId) {
  if (!branchNameValid_(name)) {
    throw new Error('ブランチ名に使えない文字が含まれています: ' + name);
  }
  if (dbFindOne('branches', 'name', name)) {
    throw new Error('同名のブランチが既に存在します: ' + name);
  }

  var mainRow = dbFindOne('files', 'fileId', fileId);
  if (!mainRow) throw new Error('管理対象に登録されていません: ' + fileId);

  var head = headCommit(fileId, 'main');
  if (!head) {
    throw new Error(
      'mainにコミットがありません。ブランチを作る前に一度コミットしてください'
    );
  }

  var branchesFolder = DriveApp.getFolderById(repoConfig().branchesId);
  var workFolder = branchesFolder.createFolder(name);

  var srcFile = DriveApp.getFileById(fileId);
  var copy = srcFile.makeCopy(srcFile.getName(), workFolder);

  var row = {
    name: name,
    headSha: head.sha,
    baseSha: head.sha,
    state: 'open',
    workingFolderId: workFolder.getId(),
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  };
  dbAppend('branches', row);

  // 作業コピーを管理対象に登録する。Wikiの一覧に現れ、閲覧・コミットできる
  dbAppend('files', {
    fileId: copy.getId(),
    path: branchPath_(name, mainRow.path),
    type: mainRow.type,
    registeredAt: new Date(),
    registeredBy: Session.getActiveUser().getEmail(),
  });

  // 分岐直後の状態を、そのブランチの最初のコミットとして記録する。
  // これによりブランチのHEADが常に存在し、差分計算の起点が明確になる。
  commitFile(copy.getId(), name, 'ブランチ ' + name + ' を作成', null);

  return row;
}

/**
 * ブランチを削除する。作業コピーのDocとフォルダはゴミ箱に入れる。
 *
 * main は削除できない。
 *
 * @param {string} name
 */
function branchDelete(name) {
  if (name === 'main') throw new Error('main ブランチは削除できません');

  var row = dbFindOne('branches', 'name', name);
  if (!row) throw new Error('ブランチが見つかりません: ' + name);

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

  try {
    DriveApp.getFolderById(row.workingFolderId).setTrashed(true);
  } catch (e2) {
    Logger.log('作業フォルダを削除できません: ' + e2.message);
  }

  dbUpdate('branches', 'name', name, { state: 'deleted' });
}
```

- [ ] **Step 2: Main.gs に API を追加**

Append to `src/Main.gs`:

```javascript
/**
 * ブランチ一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiBranchList() {
  var rows = branchList();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].state) === 'deleted') continue;
    out.push({
      name: rows[i].name,
      headSha: rows[i].headSha,
      baseSha: rows[i].baseSha,
      state: rows[i].state,
      createdBy: rows[i].createdBy,
      createdAt: new Date(rows[i].createdAt).toISOString(),
    });
  }
  return out;
}

/**
 * ブランチを作成する (Web App API)。
 *
 * @param {string} name
 * @param {string} fileId
 * @returns {object}
 */
function apiBranchCreate(name, fileId) {
  var row = branchCreate(name, fileId);
  return { name: row.name, baseSha: row.baseSha };
}

/**
 * ブランチを削除する (Web App API)。
 *
 * @param {string} name
 * @returns {string}
 */
function apiBranchDelete(name) {
  branchDelete(name);
  return name;
}

/**
 * ブランチ機能の動作確認用。
 */
function debugBranch() {
  var fileId = debugFileId_();
  var row = branchCreate('feat-テスト改訂', fileId);
  Logger.log('ブランチ作成: ' + JSON.stringify(row));
  Logger.log('作業コピー: ' + branchWorkingFileId('feat-テスト改訂', fileId));
  Logger.log('ブランチ一覧: ' + JSON.stringify(branchList().map(function (b) {
    return b.name + '(' + b.state + ')';
  })));
}
```

- [ ] **Step 3: push して動作確認**

Run: `clasp push --force`

GASエディタで **`debugBranch`** を実行する。

Expected:
- ログにブランチ行が出る (`baseSha` が main の HEAD と一致すること)
- 作業コピーの fileId が出る
- Drive の `agentic-management/branches/feat-テスト改訂/` に Doc のコピーがある
- `branches` シートに1行、`files` シートに作業コピーの行、
  `commits` シートにブランチの初回コミットが増えている

- [ ] **Step 4: 同名ブランチが拒否されることを確認**

**`debugBranch`** をもう一度実行する。

Expected: `同名のブランチが既に存在します` で停止する

- [ ] **Step 5: コミット**

```bash
git add src/core/Branch.gs src/Main.gs
git commit -m "feat: ブランチの作成・一覧・削除を追加"
```

---

## Task 6: HtmlWriter.gs — Block配列を Google Docs に書き戻す

**Files:**
- Create: `src/render/HtmlWriter.gs`
- Modify: `src/core/ObjectStore.gs` (blob 検索を追加)
- Modify: `src/Main.gs`

**Interfaces:**
- Consumes: `parseBlocks`, `objectsFolder_`, `objectPath_`
- Produces:
  - `objectFindBlob(sha: string) → Blob|null`
  - `htmlWriterValidate(blocks: Block[]) → string[]` (問題の説明。空配列なら書き戻し可能)
  - `writeBlocksToDoc(fileId: string, blocks: Block[]) → void`
  - `writeHtmlToDoc(fileId: string, html: string) → void`

### この Task が Phase 2 で最も危険な理由

`body.clear()` してから再構築するため、**失敗すると文書の内容が失われる。**
以下の防御を必ず入れる:

1. **事前検証** — 書き戻せない要素があれば `body.clear()` の前に中断する
2. **取得できない画像を含む場合は拒否** — `sha === 'unavailable'` の画像は
   バイト列が存在せず復元できない。書き戻すと画像が永久に失われるため、
   マージ自体を拒否する
3. **書き戻し前に必ずコミットを取る** — 呼び出し側 (Task 7) の責務

- [ ] **Step 1: ObjectStore.gs に blob 検索を追加**

Append to `src/core/ObjectStore.gs`:

```javascript
/**
 * SHAに対応するバイナリblobを拡張子を問わず探す。
 *
 * Block型は拡張子を保持しないため、保存時に使いうる拡張子を順に試す。
 * PoC規模では十分に速い。
 *
 * @param {string} sha
 * @returns {GoogleAppsScript.Base.Blob|null}
 */
function objectFindBlob(sha) {
  var exts = ['png', 'jpg', 'gif', 'webp', 'bmp', 'bin'];
  var folder = objectsFolder_();
  for (var i = 0; i < exts.length; i++) {
    var it = folder.getFilesByName(objectPath_(sha, exts[i]));
    if (it.hasNext()) return it.next().getBlob();
  }
  return null;
}
```

- [ ] **Step 2: HtmlWriter.gs を作成**

```javascript
/**
 * Block配列が Google Docs に書き戻せるかを検証する。
 *
 * body.clear() は破壊的操作であり、途中で失敗すると内容が失われる。
 * そのため書き戻しの前に必ずこの検証を通す。
 *
 * @param {object[]} blocks
 * @returns {string[]} 問題の説明。空配列なら書き戻し可能
 */
function htmlWriterValidate(blocks) {
  var problems = [];
  var known = { heading: 1, paragraph: 1, listItem: 1, table: 1, image: 1 };

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];

    if (!known[b.type]) {
      problems.push((i + 1) + '行目: 未対応のブロック種別です (' + b.type + ')');
      continue;
    }

    if (b.type === 'image') {
      if (b.sha === 'unavailable') {
        problems.push(
          (i + 1) + '行目: 実体を取得できない画像が含まれています (alt=' +
          (b.alt || '') + ')。書き戻すとこの画像は失われます。' +
          'Docs上で画像を貼り直してからやり直してください'
        );
      } else if (!objectFindBlob(b.sha)) {
        problems.push(
          (i + 1) + '行目: 画像の実体がobjectsに見つかりません (sha=' +
          String(b.sha).substring(0, 7) + ')'
        );
      }
    }

    if (b.type === 'table') {
      if (!b.rows || b.rows.length === 0) {
        problems.push((i + 1) + '行目: 空のテーブルは書き戻せません');
      } else if (!b.rows[0] || b.rows[0].length === 0) {
        problems.push((i + 1) + '行目: 列が0のテーブルは書き戻せません');
      }
    }
  }

  return problems;
}

/**
 * Run配列を Text 要素に書き込み、装飾を適用する。
 *
 * appendText で追加した範囲に対して、開始位置と終了位置を指定して
 * 装飾を設定する。Docsの装飾APIは [start, end] の閉区間を取る。
 *
 * @param {GoogleAppsScript.Document.Text} text
 * @param {object[]} runs
 */
function writeRuns_(text, runs) {
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (!r.text) continue;

    var start = text.getText().length;
    text.appendText(r.text);
    var end = text.getText().length - 1;
    if (end < start) continue;

    if (r.bold) text.setBold(start, end, true);
    if (r.italic) text.setItalic(start, end, true);
    if (r.underline) text.setUnderline(start, end, true);
    if (r.strike) text.setStrikethrough(start, end, true);
    if (r.link) text.setLinkUrl(start, end, r.link);
  }
}

/**
 * 見出しレベルを ParagraphHeading に変換する。
 *
 * @param {number} level 1-6
 * @returns {GoogleAppsScript.Document.ParagraphHeading}
 */
function headingFromLevel_(level) {
  var H = DocumentApp.ParagraphHeading;
  if (level === 1) return H.HEADING1;
  if (level === 2) return H.HEADING2;
  if (level === 3) return H.HEADING3;
  if (level === 4) return H.HEADING4;
  if (level === 5) return H.HEADING5;
  return H.HEADING6;
}

/**
 * Block配列を Google Docs の body に書き込む。
 *
 * 破壊的操作である。必ず htmlWriterValidate を通してから呼ぶこと。
 * fileId は変わらないため、共有リンク・権限・埋め込みは維持される。
 *
 * @param {string} fileId
 * @param {object[]} blocks
 */
function writeBlocksToDoc(fileId, blocks) {
  var problems = htmlWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('書き戻せません:\n' + problems.join('\n'));
  }

  var doc = DocumentApp.openById(fileId);
  var body = doc.getBody();
  body.clear();

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];

    if (b.type === 'heading') {
      var h = body.appendParagraph('');
      h.setHeading(headingFromLevel_(b.level));
      writeRuns_(h.editAsText(), b.runs);

    } else if (b.type === 'paragraph') {
      var p = body.appendParagraph('');
      p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      writeRuns_(p.editAsText(), b.runs);

    } else if (b.type === 'listItem') {
      var li = body.appendListItem('');
      li.setGlyphType(b.ordered
        ? DocumentApp.GlyphType.NUMBER
        : DocumentApp.GlyphType.BULLET);
      li.setNestingLevel(b.depth || 0);
      writeRuns_(li.editAsText(), b.runs);

    } else if (b.type === 'table') {
      // appendTable は文字列の2次元配列を取る。装飾はセルごとに後から適用する
      var plain = [];
      for (var r = 0; r < b.rows.length; r++) {
        var row = [];
        for (var c = 0; c < b.rows[r].length; c++) {
          var cellText = '';
          for (var k = 0; k < b.rows[r][c].length; k++) {
            cellText += b.rows[r][c][k].text;
          }
          row.push(cellText);
        }
        plain.push(row);
      }
      var table = body.appendTable(plain);

      for (var tr = 0; tr < b.rows.length; tr++) {
        for (var tc = 0; tc < b.rows[tr].length; tc++) {
          var cell = table.getRow(tr).getCell(tc);
          cell.clear();
          writeRuns_(cell.editAsText(), b.rows[tr][tc]);
        }
      }

    } else if (b.type === 'image') {
      var blob = objectFindBlob(b.sha);
      var imgPara = body.appendParagraph('');
      var inserted = imgPara.appendInlineImage(blob);
      if (b.alt) inserted.setAltDescription(b.alt);
    }
  }

  // body.clear() の後には空の段落が1つ残る。先頭に不要な空行が
  // できるため、内容を書いた後で削除する
  if (body.getNumChildren() > blocks.length) {
    var first = body.getChild(0);
    if (first.getType() === DocumentApp.ElementType.PARAGRAPH &&
        first.asParagraph().getText() === '' &&
        first.asParagraph().getNumChildren() === 0) {
      body.removeChild(first);
    }
  }

  doc.saveAndClose();
}

/**
 * 正規化HTMLを Google Docs に書き戻す。
 *
 * @param {string} fileId
 * @param {string} html
 */
function writeHtmlToDoc(fileId, html) {
  writeBlocksToDoc(fileId, parseBlocks(html));
}
```

- [ ] **Step 3: Main.gs に往復検証を追加**

Append to `src/Main.gs`:

```javascript
/**
 * 書き戻しの往復検証。Phase 2 で最も重要な検証。
 *
 * Doc → HTML → Doc → HTML と往復させ、2つのHTMLが一致すれば
 * 書き戻しが情報を落としていないことになる。
 *
 * 破壊的操作を含むため、必ずブランチの作業コピーに対して実行すること。
 * DEBUG_WRITE_FILE_ID に対象を設定する。
 */
function debugWriteRoundTrip() {
  var fileId = PropertiesService.getScriptProperties()
    .getProperty('DEBUG_WRITE_FILE_ID');
  if (!fileId) {
    throw new Error(
      'スクリプトプロパティ DEBUG_WRITE_FILE_ID に、' +
      '書き戻してよい作業コピーのfileIdを設定してください'
    );
  }

  var before = renderDoc(fileId);
  Logger.log('書き戻し前の長さ: ' + before.length);

  var problems = htmlWriterValidate(parseBlocks(before));
  if (problems.length > 0) {
    Logger.log('検証で問題が見つかりました:\n' + problems.join('\n'));
    return;
  }

  writeHtmlToDoc(fileId, before);
  liveCacheInvalidate(fileId);

  var after = renderDoc(fileId);
  Logger.log('書き戻し後の長さ: ' + after.length);

  if (before === after) {
    Logger.log('往復一致: OK — 書き戻しは情報を落としていません');
    return;
  }

  Logger.log('往復不一致: 差分は以下のとおり');
  var ops = diffHtml(before, after);
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].type === 'equal') continue;
    Logger.log('  ' + (ops[i].type === 'insert' ? '+ ' : '- ') + ops[i].line);
  }
}
```

- [ ] **Step 4: push して往復検証を実行**

Run: `clasp push --force`

1. Task 5 で作った**ブランチの作業コピー**の fileId を、
   スクリプトプロパティ `DEBUG_WRITE_FILE_ID` に設定する
   (main の原本ではなく作業コピーを使う。失敗しても main が壊れないようにする)
2. **`debugWriteRoundTrip`** を実行

Expected: `往復一致: OK — 書き戻しは情報を落としていません`

- [ ] **Step 5: 往復が一致しない場合の対処**

差分ログを見て原因を特定する。よくある原因:

| 差分の症状 | 原因 | 対処 |
|---|---|---|
| リストが `<p>` になる | `setGlyphType` / `setNestingLevel` の順序 | `setNestingLevel` を先に呼ぶ |
| 表のセルに空段落が増える | `cell.clear()` が段落を残す | `cell.getChild(0).asParagraph()` に直接書く |
| 先頭に `<p></p>` が入る | `body.clear()` 後の残存段落 | 削除条件を見直す (Step 2 末尾) |
| 装飾が1文字ずれる | `setBold(start, end)` の end は閉区間 | `end = length - 1` を確認 |

**修正したら、その症状を再現する Block 配列を `test/normalize.test.js` の
ラウンドトリップケースに追加してから直すこと。**

- [ ] **Step 6: Doc を目視確認**

書き戻した作業コピーを Google Docs で開き、見出し・装飾・リスト・表・画像が
元と同じように見えることを確認する。

- [ ] **Step 7: コミット**

```bash
git add src/render/HtmlWriter.gs src/core/ObjectStore.gs src/Main.gs
git commit -m "feat: 正規化HTMLをGoogle Docsに書き戻す機能を追加"
```

---

## Task 7: PullRequest.gs — PR とマージ

**Files:**
- Create: `src/core/PullRequest.gs`
- Modify: `src/Main.gs`

**Interfaces:**
- Consumes: `merge3Html`, `resolveConflicts`, `objectGet`, `commitHtml`, `headCommit`, `commitFile`, `writeHtmlToDoc`, `htmlWriterValidate`, `parseBlocks`, `liveCacheInvalidate`, `branchWorkingFileId`
- Produces:
  - `prCreate(title, body, sourceBranch, mainFileId) → object`
  - `prList() → object[]`
  - `prGet(number) → object`
  - `prPreviewMerge(number) → {clean, lines, conflicts, problems}`
  - `prReview(number, state, body) → object`
  - `prMerge(number, choices: string[]) → object`

- [ ] **Step 1: PullRequest.gs を作成**

```javascript
/**
 * 次のPR番号を採番する。
 *
 * @returns {number}
 */
function prNextNumber_() {
  var rows = dbReadAll('pulls');
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].number);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * PRを作成する。
 *
 * @param {string} title
 * @param {string} body
 * @param {string} sourceBranch
 * @param {string} mainFileId 対象ファイルのmain上のfileId
 * @returns {object} 作成された pulls 行
 */
function prCreate(title, body, sourceBranch, mainFileId) {
  if (!/^.{1,200}$/.test(String(title || ''))) {
    throw new Error('タイトルを入力してください');
  }

  var branch = dbFindOne('branches', 'name', sourceBranch);
  if (!branch) throw new Error('ブランチが見つかりません: ' + sourceBranch);
  if (String(branch.state) !== 'open') {
    throw new Error('このブランチは既に閉じられています: ' + sourceBranch);
  }

  var existing = dbReadAll('pulls');
  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i].sourceBranch) === String(sourceBranch) &&
        String(existing[i].state) === 'open') {
      throw new Error('このブランチには未クローズのPRがあります: #' + existing[i].number);
    }
  }

  var row = {
    number: prNextNumber_(),
    title: title,
    body: body || '',
    sourceBranch: sourceBranch,
    targetBranch: 'main',
    state: 'open',
    author: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
    mergedAt: '',
  };
  dbAppend('pulls', row);

  // 対象ファイルをPR本文の末尾に記録する。pulls シートに列を増やさずに
  // 対象を辿れるようにするための最小限の措置
  dbUpdate('pulls', 'number', row.number, {
    body: (body || '') + '\n\n[target-file:' + mainFileId + ']',
  });

  return row;
}

/**
 * PR本文から対象ファイルのfileIdを取り出す。
 *
 * @param {string} body
 * @returns {string|null}
 */
function prTargetFileId_(body) {
  var m = /\[target-file:([A-Za-z0-9_\-]+)\]/.exec(String(body || ''));
  return m ? m[1] : null;
}

/**
 * PR一覧を返す。
 *
 * @returns {object[]}
 */
function prList() {
  return dbReadAll('pulls');
}

/**
 * PRを1件返す。
 *
 * @param {number} number
 * @returns {object}
 */
function prGet(number) {
  var row = dbFindOne('pulls', 'number', number);
  if (!row) throw new Error('PRが見つかりません: #' + number);
  return row;
}

/**
 * PRのマージ結果をプレビューする。実際のマージは行わない。
 *
 * base   = ブランチ作成時点の main HEAD (branches.baseSha)
 * ours   = main の現在のHEAD
 * theirs = ブランチの現在のHEAD
 *
 * @param {number} number
 * @returns {{clean:boolean, lines:string[], conflicts:object[], problems:string[]}}
 */
function prPreviewMerge(number) {
  var pr = prGet(number);
  var branch = dbFindOne('branches', 'name', pr.sourceBranch);
  if (!branch) throw new Error('ブランチが見つかりません: ' + pr.sourceBranch);

  var mainFileId = prTargetFileId_(pr.body);
  if (!mainFileId) throw new Error('PRの対象ファイルを特定できません');

  var baseHtml = commitHtml(branch.baseSha) || '';

  var mainHead = headCommit(mainFileId, 'main');
  var oursHtml = mainHead ? (objectGet(mainHead.blobSha) || '') : '';

  var workFileId = branchWorkingFileId(pr.sourceBranch, mainFileId);
  if (!workFileId) throw new Error('ブランチの作業コピーが見つかりません');
  var branchHead = headCommit(workFileId, pr.sourceBranch);
  var theirsHtml = branchHead ? (objectGet(branchHead.blobSha) || '') : '';

  var result = merge3Html(baseHtml, oursHtml, theirsHtml);

  // クリーンな場合のみ、書き戻せるかを事前検証する
  var problems = [];
  if (result.clean) {
    problems = htmlWriterValidate(parseBlocks(result.lines.join('\n') + '\n'));
  }

  return {
    clean: result.clean,
    lines: result.lines,
    conflicts: result.conflicts,
    problems: problems,
  };
}

/**
 * PRにレビューを記録する。
 *
 * @param {number} number
 * @param {string} state 'approve' | 'request_changes' | 'comment'
 * @param {string} body
 * @returns {object}
 */
function prReview(number, state, body) {
  if (!/^(approve|request_changes|comment)$/.test(String(state))) {
    throw new Error('不正なレビュー種別です: ' + state);
  }
  var pr = prGet(number);
  var reviewer = Session.getActiveUser().getEmail();

  if (state === 'approve' && String(pr.author) === reviewer) {
    throw new Error('自分が作成したPRは承認できません');
  }

  var row = {
    prNumber: number,
    reviewer: reviewer,
    state: state,
    body: body || '',
    at: new Date(),
  };
  dbAppend('reviews', row);

  if (state === 'approve') {
    dbUpdate('pulls', 'number', number, { state: 'approved' });
  }
  return row;
}

/**
 * PRのapprove数を返す。同一レビュアーの複数承認は1件として数える。
 *
 * Main.gs の apiPrPreview からも呼ぶため、末尾アンダースコアを付けない
 * (アンダースコアはファイル内部専用の目印という規約のため)。
 *
 * @param {number} number
 * @returns {number}
 */
function prApprovalCount(number) {
  var rows = dbReadAll('reviews');
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].prNumber) !== Number(number)) continue;
    if (String(rows[i].state) !== 'approve') continue;
    seen[String(rows[i].reviewer)] = true;
  }
  var count = 0;
  for (var k in seen) {
    if (Object.prototype.hasOwnProperty.call(seen, k)) count++;
  }
  return count;
}

/**
 * PR本文の closes #N 記法から Issue 番号を取り出す。
 * Phase 3 で issues テーブルと連動させるための準備。
 *
 * @param {string} body
 * @returns {number[]}
 */
function prClosesIssues_(body) {
  var out = [];
  var re = /closes\s+#(\d+)/gi;
  var m;
  while ((m = re.exec(String(body || ''))) !== null) out.push(Number(m[1]));
  return out;
}

/**
 * PRをマージし、結果を main の Doc に書き戻す。
 *
 * 書き戻しは破壊的操作であるため、以下の順序を厳守する:
 *   1. マージ結果を計算し、書き戻せるか検証する
 *   2. 検証に通らなければ、何も変更せずに中断する
 *   3. main の現在の内容をコミットして退避する
 *   4. 書き戻す
 *   5. 書き戻し結果をコミットする
 *
 * @param {number} number
 * @param {string[]} choices コンフリクトへの選択 ('ours'|'theirs'|'both')
 * @returns {object} マージコミット行
 */
function prMerge(number, choices) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    throw new Error('他の処理が実行中です。しばらくしてから再試行してください');
  }

  try {
    var pr = prGet(number);
    if (String(pr.state) === 'merged') throw new Error('このPRは既にマージ済みです');
    if (String(pr.state) === 'closed') throw new Error('このPRは閉じられています');

    if (prApprovalCount(number) < 1) {
      throw new Error('マージには1件以上の承認が必要です');
    }

    var mainFileId = prTargetFileId_(pr.body);
    var preview = prPreviewMerge(number);

    var lines = preview.clean
      ? preview.lines
      : resolveConflicts(
          { lines: preview.lines, conflicts: preview.conflicts },
          choices || []
        );

    var mergedHtml = lines.length ? lines.join('\n') + '\n' : '';

    // 書き戻せるかを body.clear() の前に必ず検証する
    var problems = htmlWriterValidate(parseBlocks(mergedHtml));
    if (problems.length > 0) {
      throw new Error('マージ結果を書き戻せません:\n' + problems.join('\n'));
    }

    // 書き戻す前に main の現在の状態を退避する。
    // これが無いと、書き戻しで失われた内容を復元できない
    var status = fileStatus(mainFileId, 'main');
    if (status.dirty) {
      commitFile(mainFileId, 'main', 'PR #' + number + ' マージ前の自動退避', null);
    }

    writeHtmlToDoc(mainFileId, mergedHtml);
    liveCacheInvalidate(mainFileId);

    var mergeCommit = commitFile(
      mainFileId,
      'main',
      'マージ: PR #' + number + ' ' + pr.title,
      null
    );

    dbUpdate('pulls', 'number', number, {
      state: 'merged',
      mergedAt: new Date(),
    });
    dbUpdate('branches', 'name', pr.sourceBranch, { state: 'merged' });

    var issues = prClosesIssues_(pr.body);
    for (var i = 0; i < issues.length; i++) {
      if (dbFindOne('issues', 'number', issues[i])) {
        dbUpdate('issues', 'number', issues[i], {
          state: 'closed',
          closedAt: new Date(),
        });
      }
    }

    return mergeCommit;
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 2: Main.gs に API を追加**

Append to `src/Main.gs`:

```javascript
/**
 * PR一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiPrList() {
  var rows = prList();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    out.push({
      number: Number(rows[i].number),
      title: rows[i].title,
      sourceBranch: rows[i].sourceBranch,
      targetBranch: rows[i].targetBranch,
      state: rows[i].state,
      author: rows[i].author,
      createdAt: new Date(rows[i].createdAt).toISOString(),
    });
  }
  out.sort(function (a, b) { return b.number - a.number; });
  return out;
}

/**
 * PRを作成する (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string} sourceBranch
 * @param {string} mainFileId
 * @returns {object}
 */
function apiPrCreate(title, body, sourceBranch, mainFileId) {
  var row = prCreate(title, body, sourceBranch, mainFileId);
  return { number: row.number, title: row.title };
}

/**
 * PRのマージプレビューを返す (Web App API)。
 * 差分表示のため、main HEAD とマージ結果の diff も返す。
 *
 * @param {number} number
 * @returns {object}
 */
function apiPrPreview(number) {
  var preview = prPreviewMerge(number);
  var pr = prGet(number);
  var mainFileId = prTargetFileId_(pr.body);
  var mainHead = headCommit(mainFileId, 'main');
  var oursHtml = mainHead ? (objectGet(mainHead.blobSha) || '') : '';
  var mergedHtml = preview.lines.length ? preview.lines.join('\n') + '\n' : '';

  return {
    clean: preview.clean,
    problems: preview.problems,
    conflicts: preview.conflicts,
    approvals: prApprovalCount(number),
    ops: diffHtml(oursHtml, mergedHtml),
  };
}

/**
 * PRにレビューを記録する (Web App API)。
 *
 * @param {number} number
 * @param {string} state
 * @param {string} body
 * @returns {object}
 */
function apiPrReview(number, state, body) {
  var row = prReview(number, state, body);
  return { prNumber: row.prNumber, state: row.state };
}

/**
 * PRをマージする (Web App API)。
 *
 * @param {number} number
 * @param {string[]} choices
 * @returns {object}
 */
function apiPrMerge(number, choices) {
  var row = prMerge(number, choices);
  return { sha: row.sha, message: row.message };
}

/**
 * PR機能の動作確認用。ブランチ側を編集してコミットしてから実行する。
 */
function debugPr() {
  var mainFileId = debugFileId_();
  var branchName = 'feat-テスト改訂';

  var pr = prCreate('就業規則の改訂', 'テスト用のPRです', branchName, mainFileId);
  Logger.log('PR作成: #' + pr.number);

  var preview = prPreviewMerge(pr.number);
  Logger.log('マージ可能: ' + preview.clean);
  Logger.log('コンフリクト数: ' + preview.conflicts.length);
  Logger.log('書き戻しの問題: ' + JSON.stringify(preview.problems));
  Logger.log('マージ結果の行数: ' + preview.lines.length);
}
```

- [ ] **Step 3: push して動作確認**

Run: `clasp push --force`

1. **ブランチの作業コピー Doc を編集**する (どこか1行を書き換える)
2. Web App でそのブランチのファイルを選び、**コミット**する
   (`branches/feat-テスト改訂/…` という名前で一覧に出る)
3. GASエディタで **`debugPr`** を実行

Expected:
- `PR作成: #1`
- `マージ可能: true`
- `コンフリクト数: 0`
- `書き戻しの問題: []`

- [ ] **Step 4: コンフリクトを意図的に起こして確認**

1. **main の Doc** で、ブランチ側で書き換えたのと**同じ行**を別の内容に書き換える
2. Web App で main のファイルをコミットする
3. GASエディタで以下を実行:

```javascript
function debugPrPreviewOnly() {
  var preview = prPreviewMerge(1);
  Logger.log('マージ可能: ' + preview.clean);
  Logger.log('コンフリクト: ' + JSON.stringify(preview.conflicts, null, 2));
}
```

Expected: `マージ可能: false` となり、コンフリクトの `ours` / `theirs` に
それぞれの内容が入っている

- [ ] **Step 5: コミット**

```bash
git add src/core/PullRequest.gs src/Main.gs
git commit -m "feat: Pull Requestの作成・レビュー・3-wayマージを追加"
```

---

## Task 8: ブランチと PR の UI

**Files:**
- Modify: `src/ui/wiki.html`
- Modify: `src/ui/app.css.html`
- Modify: `src/ui/app.js.html`

**Interfaces:**
- Consumes: Task 5 の `apiBranchList` / `apiBranchCreate`、Task 7 の `apiPrList` / `apiPrCreate` / `apiPrPreview` / `apiPrReview` / `apiPrMerge`
- Produces: ブラウザ上で PR を作成・レビュー・マージできる画面

- [ ] **Step 1: wiki.html にタブとパネルを追加**

Modify the `.tabs` block and add two panels in `src/ui/wiki.html`:

```html
      <div class="tabs" id="tabs" hidden>
        <button class="tab" data-tab="content" aria-current="true">本文</button>
        <button class="tab" data-tab="history">履歴</button>
        <button class="tab" data-tab="branches">ブランチ</button>
        <button class="tab" data-tab="pulls">プルリクエスト</button>
      </div>
```

Add after `<div class="panel" id="panel-history" hidden>…</div>`:

```html
      <div class="panel panel-col" id="panel-branches" hidden>
        <div class="panel-actions">
          <button id="branch-create-btn" class="btn">ブランチを作成</button>
        </div>
        <div class="list-area" id="branch-list"></div>
      </div>

      <div class="panel" id="panel-pulls" hidden>
        <div class="history-list" id="pr-list"></div>
        <div class="diff-view" id="pr-detail"></div>
      </div>
```

- [ ] **Step 2: app.css.html にスタイルを追加**

Append before `</style>`:

```css
.panel-col { flex-direction: column; }

.panel-actions {
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
}

.list-area { flex: 1; overflow-y: auto; }

.row-item {
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
}

.row-title { font-size: 13px; }
.row-meta { font-size: 11px; color: var(--ink-2); }

.state {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-2);
  color: var(--ink-2);
}

.state-open { background: #dcfce7; color: #166534; }
.state-approved { background: #dbeafe; color: #1e40af; }
.state-merged { background: #ede9fe; color: #5b21b6; }
.state-conflict { background: #fee2e2; color: #991b1b; }

.pr-actions {
  display: flex;
  gap: 8px;
  padding: 12px 0;
  flex-wrap: wrap;
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
}

.conflict-block {
  border: 1px solid #fca5a5;
  border-radius: 4px;
  margin: 12px 0;
  overflow: hidden;
}

.conflict-head {
  background: #fee2e2;
  color: #991b1b;
  padding: 6px 10px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
}

.conflict-side { padding: 6px 10px; border-top: 1px solid #fecaca; }
.conflict-label {
  font-size: 11px;
  color: var(--ink-2);
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
}

.conflict-choice {
  padding: 8px 10px;
  border-top: 1px solid #fecaca;
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif;
  font-size: 12px;
}
```

- [ ] **Step 3: app.js.html にブランチ・PR機能を追加**

Insert before the final initialization block (before `panelContent.hidden = true;`)
in `src/ui/app.js.html`:

```javascript
  var panelBranches = document.getElementById('panel-branches');
  var panelPulls = document.getElementById('panel-pulls');
  var branchList = document.getElementById('branch-list');
  var branchCreateBtn = document.getElementById('branch-create-btn');
  var prListEl = document.getElementById('pr-list');
  var prDetail = document.getElementById('pr-detail');

  /**
   * 状態バッジの要素を作る。
   *
   * @param {string} state
   * @returns {HTMLElement}
   */
  function stateBadge(state) {
    var span = document.createElement('span');
    span.className = 'state state-' + state;
    span.textContent = state;
    return span;
  }

  function loadBranches() {
    branchList.textContent = '読み込み中…';
    google.script.run
      .withSuccessHandler(function (branches) {
        branchList.textContent = '';
        branches.forEach(function (b) {
          var row = document.createElement('div');
          row.className = 'row-item';

          var title = document.createElement('span');
          title.className = 'row-title';
          title.textContent = b.name;

          var meta = document.createElement('span');
          meta.className = 'row-meta';
          meta.textContent = b.createdBy + ' · ' +
            new Date(b.createdAt).toLocaleDateString('ja-JP');

          row.appendChild(title);
          row.appendChild(stateBadge(b.state));
          row.appendChild(meta);

          if (b.name !== 'main' && b.state === 'open') {
            var spacer = document.createElement('span');
            spacer.style.flex = '1';
            row.appendChild(spacer);

            var prBtn = document.createElement('button');
            prBtn.className = 'btn';
            prBtn.textContent = 'PRを作成';
            prBtn.addEventListener('click', function () { createPr(b.name); });
            row.appendChild(prBtn);
          }

          branchList.appendChild(row);
        });
      })
      .withFailureHandler(function (err) {
        branchList.textContent = 'エラー: ' + err.message;
      })
      .apiBranchList();
  }

  function createBranch() {
    if (!current.fileId) {
      window.alert('先にファイルを選択してください');
      return;
    }
    var name = window.prompt('ブランチ名を入力してください (例: feat-規則改訂)');
    if (!name) return;

    branchCreateBtn.disabled = true;
    google.script.run
      .withSuccessHandler(function () {
        branchCreateBtn.disabled = false;
        loadBranches();
        google.script.run.withSuccessHandler(renderFileList).apiListFiles();
      })
      .withFailureHandler(function (err) {
        branchCreateBtn.disabled = false;
        window.alert('作成できませんでした: ' + err.message);
      })
      .apiBranchCreate(name, current.fileId);
  }

  function createPr(branchName) {
    if (!current.fileId) {
      window.alert('先に main のファイルを選択してください');
      return;
    }
    var title = window.prompt('PRのタイトルを入力してください');
    if (!title) return;
    var body = window.prompt('説明 (任意)') || '';

    google.script.run
      .withSuccessHandler(function () {
        switchTab('pulls');
      })
      .withFailureHandler(function (err) {
        window.alert('作成できませんでした: ' + err.message);
      })
      .apiPrCreate(title, body, branchName, current.fileId);
  }

  /**
   * コンフリクトの選択UIを作る。
   *
   * @param {object[]} conflicts
   * @param {HTMLElement} container
   * @returns {function(): string[]} 選択値を集める関数
   */
  function renderConflicts(conflicts, container) {
    var selects = [];

    conflicts.forEach(function (c, i) {
      var block = document.createElement('div');
      block.className = 'conflict-block';

      var head = document.createElement('div');
      head.className = 'conflict-head';
      head.textContent = 'コンフリクト ' + (i + 1) + ' / ' + conflicts.length;
      block.appendChild(head);

      [['main側 (ours)', c.ours], ['ブランチ側 (theirs)', c.theirs]].forEach(
        function (pair) {
          var side = document.createElement('div');
          side.className = 'conflict-side';

          var label = document.createElement('div');
          label.className = 'conflict-label';
          label.textContent = pair[0];
          side.appendChild(label);

          if (pair[1].length === 0) {
            var del = document.createElement('div');
            del.className = 'conflict-label';
            del.textContent = '(削除)';
            side.appendChild(del);
          }
          pair[1].forEach(function (line) {
            var div = document.createElement('div');
            div.className = 'diff-line';
            div.textContent = line;
            side.appendChild(div);
          });
          block.appendChild(side);
        }
      );

      var choiceWrap = document.createElement('div');
      choiceWrap.className = 'conflict-choice';
      var sel = document.createElement('select');
      [['ours', 'main側を採用'], ['theirs', 'ブランチ側を採用'],
       ['both', '両方を残す']].forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        sel.appendChild(o);
      });
      choiceWrap.appendChild(sel);
      block.appendChild(choiceWrap);
      selects.push(sel);

      container.appendChild(block);
    });

    return function () { return selects.map(function (s) { return s.value; }); };
  }

  function showPrDetail(pr) {
    prDetail.textContent = '読み込み中…';

    google.script.run
      .withSuccessHandler(function (preview) {
        prDetail.textContent = '';

        var head = document.createElement('div');
        head.style.cssText =
          'font-family:-apple-system,sans-serif;font-size:14px;' +
          'font-weight:600;margin-bottom:6px;';
        head.textContent = '#' + pr.number + ' ' + pr.title;
        prDetail.appendChild(head);

        var meta = document.createElement('div');
        meta.className = 'commit-meta';
        meta.style.marginBottom = '10px';
        meta.textContent =
          pr.sourceBranch + ' → ' + pr.targetBranch +
          ' · ' + pr.author + ' · 承認 ' + preview.approvals + '件';
        prDetail.appendChild(meta);

        var getChoices = function () { return []; };

        if (preview.problems && preview.problems.length > 0) {
          var warn = document.createElement('div');
          warn.className = 'conflict-head';
          warn.style.marginBottom = '10px';
          warn.textContent = '書き戻せません: ' + preview.problems.join(' / ');
          prDetail.appendChild(warn);
        }

        if (!preview.clean) {
          getChoices = renderConflicts(preview.conflicts, prDetail);
        }

        if (pr.state !== 'merged' && pr.state !== 'closed') {
          var actions = document.createElement('div');
          actions.className = 'pr-actions';

          var approveBtn = document.createElement('button');
          approveBtn.className = 'btn';
          approveBtn.textContent = '承認する';
          approveBtn.addEventListener('click', function () {
            google.script.run
              .withSuccessHandler(function () { showPrDetail(pr); })
              .withFailureHandler(function (err) { window.alert(err.message); })
              .apiPrReview(pr.number, 'approve', '');
          });

          var mergeBtn = document.createElement('button');
          mergeBtn.className = 'btn';
          mergeBtn.textContent = 'マージする';
          mergeBtn.disabled = preview.problems && preview.problems.length > 0;
          mergeBtn.addEventListener('click', function () {
            if (!window.confirm(
              'mainの文書を書き換えます。実行前にmainの現在の内容は自動でコミットされます。続けますか?'
            )) return;
            mergeBtn.disabled = true;
            google.script.run
              .withSuccessHandler(function () {
                window.alert('マージしました');
                loadPulls();
                refreshStatus();
              })
              .withFailureHandler(function (err) {
                mergeBtn.disabled = false;
                window.alert('マージできませんでした: ' + err.message);
              })
              .apiPrMerge(pr.number, getChoices());
          });

          actions.appendChild(approveBtn);
          actions.appendChild(mergeBtn);
          prDetail.appendChild(actions);
        }

        var diffHead = document.createElement('div');
        diffHead.className = 'conflict-label';
        diffHead.style.margin = '12px 0 6px';
        diffHead.textContent = 'main に対する変更';
        prDetail.appendChild(diffHead);

        preview.ops.forEach(function (op) {
          if (op.type === 'equal') return;
          var div = document.createElement('div');
          div.className = 'diff-line diff-' + op.type;
          div.textContent = (op.type === 'insert' ? '+ ' : '- ') + op.line;
          prDetail.appendChild(div);
        });
      })
      .withFailureHandler(function (err) {
        prDetail.textContent = 'エラー: ' + err.message;
      })
      .apiPrPreview(pr.number);
  }

  function loadPulls() {
    prListEl.textContent = '読み込み中…';
    google.script.run
      .withSuccessHandler(function (prs) {
        prListEl.textContent = '';
        if (prs.length === 0) {
          var p = document.createElement('p');
          p.style.cssText = 'padding:12px 16px;color:#666;font-size:13px;';
          p.textContent = 'プルリクエストがありません';
          prListEl.appendChild(p);
          prDetail.textContent = '';
          return;
        }
        prs.forEach(function (pr) {
          var btn = document.createElement('button');
          btn.className = 'commit-item';

          var msg = document.createElement('div');
          msg.className = 'commit-message';
          msg.textContent = '#' + pr.number + ' ' + pr.title;

          var meta = document.createElement('div');
          meta.className = 'commit-meta';
          meta.textContent = pr.sourceBranch + ' → ' + pr.targetBranch +
            ' · ' + pr.state;

          btn.appendChild(msg);
          btn.appendChild(meta);
          btn.addEventListener('click', function () {
            var items = prListEl.querySelectorAll('.commit-item');
            for (var i = 0; i < items.length; i++) {
              items[i].setAttribute('aria-current', String(items[i] === btn));
            }
            showPrDetail(pr);
          });
          prListEl.appendChild(btn);
        });
        prListEl.firstChild.click();
      })
      .withFailureHandler(function (err) {
        prListEl.textContent = 'エラー: ' + err.message;
      })
      .apiPrList();
  }

  branchCreateBtn.addEventListener('click', createBranch);
```

- [ ] **Step 4: switchTab を新しいタブに対応させる**

Replace the `switchTab` function in `src/ui/app.js.html`:

```javascript
  function switchTab(name) {
    var tabs = tabsEl.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-current', String(tabs[i].dataset.tab === name));
    }
    panelContent.hidden = name !== 'content';
    panelHistory.hidden = name !== 'history';
    panelBranches.hidden = name !== 'branches';
    panelPulls.hidden = name !== 'pulls';

    if (name === 'history') loadHistory();
    else if (name === 'branches') loadBranches();
    else if (name === 'pulls') loadPulls();
  }
```

**注意**: `switchTab` は `panelBranches` / `panelPulls` を参照するが、
Step 3 の挿入位置 (末尾の初期化ブロックの直前) で問題ない。`switchTab` が
実際に呼ばれるのはユーザーがファイルを選んだ後であり、その時点では
`var` 宣言の初期化が完了しているためである。変数を先頭に移す必要はない。

- [ ] **Step 5: 初期状態で全パネルを閉じる**

Modify the initialization block at the bottom:

```javascript
  panelContent.hidden = true;
  panelHistory.hidden = true;
  panelBranches.hidden = true;
  panelPulls.hidden = true;
```

- [ ] **Step 6: push して再デプロイ**

```bash
clasp push --force
clasp update-deployment <deploymentId>
```

- [ ] **Step 7: Web App で一連の流れを確認**

1. main のファイルを選ぶ
2. 「ブランチ」タブ → 「ブランチを作成」→ 名前を入力
3. サイドバーに `branches/<名前>/…` が現れる
4. **ブランチ側の Doc を Google Docs で開いて編集**する
5. Web App でブランチのファイルを選び、「コミット」
6. 「ブランチ」タブ → 「PRを作成」
7. 「プルリクエスト」タブで PR を選ぶ → **差分が表示される**
8. 「承認する」→ 承認数が 1 になる
9. 「マージする」→ 確認ダイアログ → 実行

Expected: **main の Doc の内容がブランチの変更を取り込んだものに変わる**

- [ ] **Step 8: main の Doc を目視確認**

Google Docs で main の原本を開き、以下を確認する:

- ブランチでの変更が反映されている
- **見出し・装飾・リスト・表・画像が壊れていない**
- **URLが変わっていない** (fileId が維持されている)

- [ ] **Step 9: コミット**

```bash
git add src/ui/
git commit -m "feat: ブランチとPRのUI、コンフリクト解決画面を追加"
```

---

## Task 9: 統合検証とドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-02-gws-git-management-phase2.md`

**Interfaces:**
- Consumes: Task 1-8 のすべて
- Produces: Phase 2 完了状態

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: PASS (Phase 1 の62件 + Diff/Merge の追加分)

- [ ] **Step 2: コンフリクト解決の実地検証**

1. 新しいブランチを作る
2. **ブランチ側と main 側で、同じ行を別々の内容に書き換える**
3. 両方をコミットする
4. PR を作成し、「プルリクエスト」タブで開く

Expected: **コンフリクトが赤枠で表示され、各コンフリクトに
「main側を採用 / ブランチ側を採用 / 両方を残す」の選択肢が出る**

5. 「ブランチ側を採用」を選んでマージする

Expected: main の Doc がブランチ側の内容になる

- [ ] **Step 3: 書き戻し拒否の検証**

1. ブランチ側の Doc に**壊れた画像**を作る
   (`![x](./none.png)` を Markdown 自動検出で貼り付ける。
   Phase 1 で判明した手法)
2. コミットして PR を作る

Expected: PR画面に **「書き戻せません: … 実体を取得できない画像が
含まれています」** と表示され、**「マージする」ボタンが無効になる**

これは `body.clear()` による内容消失を防ぐ最後の砦であり、
Phase 2 で最も重要な安全機構である。

- [ ] **Step 4: 楽観的並行制御の検証**

1. Web App を2つのタブで開く
2. 両方で同じファイルを選ぶ
3. Doc を編集する
4. **タブAでコミット**する
5. **タブBでコミット**する (タブBは古い headSha を持っている)

Expected: タブBで **「HEADが進んでいます。画面を再読み込みしてから
再度コミットしてください」** というエラーが出る

- [ ] **Step 5: README を更新**

Replace the "現在の状態" section in `README.md`:

```markdown
## 現在の状態: Phase 2 完了

Google Docs に対して commit / branch / Pull Request / 3-way merge が動作し、
マージ結果を元の Doc に書き戻せる (fileId は維持されるため共有リンクは壊れない)。

### Git 操作の対応状況

| 操作 | 状態 |
|---|---|
| コミット / 履歴 / 差分表示 | 動作 |
| ブランチ作成 (Doc の作業コピー) | 動作 |
| Pull Request / レビュー / 承認 | 動作 |
| 3-way merge | 動作 |
| コンフリクト解決 (ours / theirs / both) | 動作 |
| main への書き戻し | 動作 |
| 楽観的並行制御 (HEAD 検証) | 動作 |

### 安全機構

- 書き戻し前に `htmlWriterValidate` で検証し、復元できない要素があれば
  `body.clear()` の前に中断する
- 実体を取得できない画像を含むマージは拒否する (画像の永久消失を防ぐ)
- マージ前に main の現在の内容を自動でコミットして退避する
- マージには 1 件以上の承認が必要で、PR 作成者は自分の PR を承認できない
```

- [ ] **Step 6: 計画書に完了マークを付ける**

このファイルの全チェックボックスが `- [x]` になっていることを確認し、
ヘッダに完了ステータスを追記する。

- [ ] **Step 7: コミット**

```bash
git add README.md docs/
git commit -m "docs: Phase 2 完了を反映"
```

---

## Phase 2 完了時に達成されていること

- [ ] `npm test` で Diff / Merge を含む全テストが通る
- [ ] Web App からコミットでき、履歴と差分が見られる
- [ ] ブランチを作ると Doc の作業コピーができ、Wiki 上で閲覧・編集できる
- [ ] PR を作成し、差分を見てレビュー・承認できる
- [ ] 衝突しない変更は自動マージされる
- [ ] 衝突する変更はコンフリクトとして提示され、選択して解決できる
- [ ] マージ結果が main の Doc に書き戻され、**fileId が維持される**
- [ ] 復元できない要素を含むマージは実行前に拒否される
- [ ] 同時コミットは楽観的並行制御で検出される

## Phase 3 に持ち越すもの

- SheetRenderer / SlidesRenderer と、それぞれの書き戻し (spec §4.1, §5.7)
- Issue / Projects (spec §6) — `prClosesIssues_` は実装済みで、
  `issues` テーブルができれば自動 close が働く
- Notifier (spec §6.3) — GmailApp による PR 通知
