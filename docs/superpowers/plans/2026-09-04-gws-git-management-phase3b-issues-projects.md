# GWS Git-like 文書管理システム Phase 3b (Issue / Projects) 実装計画

**ステータス: 完了 (2026-09-08)** — 実機検証済み（9項目すべて PASS）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文書に紐づく Issue と、PR の状態変化で自動的に動くカンバンボードを実装し、
「文書中心の作業管理」を成立させる。

**Architecture:** `issues` / `project_items` テーブルは Phase 1 の `DB_SCHEMA()` に
定義済みで、`prClosesIssues_()` (PR本文の `closes #N` 解析) も Phase 2 で実装済み。
本計画はその上に Issue のCRUD、Issue からのブランチ作成、PR 状態変化のフックを載せる。
通知は `Notifier.gs` に隔離し、将来 `UrlFetchApp` が解禁されたときに Chat Webhook へ
差し替えられるようにする。

**Tech Stack:** Google Apps Script (V8) / `GmailApp` / vitest / 疑似GAS (`test/fakegas.js`)

**Spec:** `docs/superpowers/specs/2026-09-02-gws-git-management-design.md` (§3.2 データモデル / §6 Issue と Projects / §7 UI)

## Global Constraints

- GAS 標準サービスのみ。Advanced Google Services / 外部 API は使用不可
- ランタイムコードに `import` / `export` / `require` を書かない
- `DB_SCHEMA()` の `issues` / `project_items` の**カラム名と順序は変更しない**。
  変更するとメタDBの既存シートと食い違う
- カンバンの列は `Backlog` / `In Progress` / `In Review` / `Done` の4つに固定する
- ブランチ名は `branchNameValid_` の `^[A-Za-z0-9ぁ-んァ-ヶ一-龠々ー_\-]{1,80}$` を満たすこと
- GAS 依存のロジックは `test/fakegas.js` の疑似GASで統合テストする

## spec からの逸脱

spec §7 は `?p=issues` / `?p=board` という別ルートを想定しているが、Phase 2 で
UI を単一ページのタブ構成にしたため、本計画でもタブとして実装する。
`doGet` のルーティングは Phase 2 時点で `p` パラメータを検証したうえで
`wiki` に固定しており、その方針を引き継ぐ。

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/core/Issue.gs` (新規) | Issue の作成・取得・更新・クローズ、文書との紐付け |
| `src/core/IssueBranch.gs` (新規) | Issue からのブランチ命名とブランチ作成 |
| `src/core/Project.gs` (新規) | カンバンのカード配置と並び替え、PR連動の自動移動 |
| `src/core/Notifier.gs` (新規) | 通知アダプタ (現状は `GmailApp` のみ) |
| `src/core/PullRequest.gs` (変更) | PR 作成・マージ時に Issue とボードを動かす |
| `src/Main.gs` (変更) | Issue / ボードの Web App API |
| `src/ui/wiki.html` / `app.js.html` / `app.css.html` (変更) | Issue タブとボードタブ |
| `test/phase3-issues.test.js` (新規) | Issue / ボード / PR連動の統合テスト |

---

## Task 1: Issue.gs — Issue の CRUD

**Files:**
- Create: `src/core/Issue.gs`
- Test: `test/phase3-issues.test.js` (新規)

**Interfaces:**
- Consumes: `dbAppend` / `dbReadAll` / `dbFindOne` / `dbUpdate` (既存)
- Produces:
  - `issueCreate(title, body, linkedFileIds) -> object` (issues 行)
  - `issueList(state) -> object[]` (`state` 省略時は全件)
  - `issueGet(number) -> object`
  - `issueUpdate(number, patch) -> object`
  - `issueClose(number, prNumber) -> object`
  - `issuesForFile(fileId) -> object[]` (open のみ)

- [x] **Step 1: 失敗するテストを書く**

`test/phase3-issues.test.js` を新規作成する。

```javascript
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/ObjectStore.gs',
  'src/core/Normalize.js',
  'src/core/Diff.js',
  'src/core/Merge.js',
  'src/core/Commit.gs',
  'src/core/Branch.gs',
  'src/render/HtmlWriter.gs',
  'src/core/PullRequest.gs',
  'src/core/Issue.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  const fileId = fake._createDoc('就業規則', '<p>第1条</p>\n', config.mainId);
  ctx.repoRegisterFile(fileId, '就業規則.doc');
  ctx.commitFile(fileId, 'main', '初期状態', null);
  return { ctx, fake, fileId };
}

describe('Issue の CRUD', () => {
  it('連番が振られ、open で作られる', () => {
    const { ctx, fileId } = setup();
    const a = ctx.issueCreate('在宅勤務規定を改訂', '第7条を見直す', [fileId]);
    const b = ctx.issueCreate('賃金規程を確認', '', []);

    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
    expect(a.state).toBe('open');
    expect(a.linkedFileIds).toBe(fileId);
  });

  it('タイトルが空なら作れない', () => {
    const { ctx } = setup();
    expect(() => ctx.issueCreate('', '', [])).toThrow(/タイトルを入力してください/);
  });

  it('文書に紐づく open Issue を引ける', () => {
    const { ctx, fileId } = setup();
    ctx.issueCreate('紐づくもの', '', [fileId]);
    ctx.issueCreate('紐づかないもの', '', []);
    const closed = ctx.issueCreate('閉じたもの', '', [fileId]);
    ctx.issueClose(closed.number, null);

    const list = ctx.issuesForFile(fileId);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('紐づくもの');
  });

  it('クローズすると closedAt と linkedPr が入る', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    const closed = ctx.issueClose(issue.number, 5);

    expect(closed.state).toBe('closed');
    expect(closed.linkedPr).toBe(5);
    expect(String(closed.closedAt)).not.toBe('');
  });

  it('存在しない Issue はエラーになる', () => {
    const { ctx } = setup();
    expect(() => ctx.issueGet(99)).toThrow(/Issueが見つかりません/);
  });

  it('ラベルと担当を更新できる', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    const updated = ctx.issueUpdate(issue.number, {
      labels: '規定改訂,P1',
      assignee: 'someone@example.com',
    });
    expect(updated.labels).toBe('規定改訂,P1');
    expect(updated.assignee).toBe('someone@example.com');
  });

  it('state は issueUpdate では変えられない', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    expect(() => ctx.issueUpdate(issue.number, { state: 'closed' }))
      .toThrow(/stateはissueCloseで変更してください/);
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase3-issues.test.js`
Expected: FAIL (`issueCreate is not defined`)

- [x] **Step 3: 実装する**

```javascript
/**
 * 次のIssue番号を返す。
 *
 * @returns {number}
 */
function issueNextNumber_() {
  var rows = dbReadAll('issues');
  var max = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].number);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * Issueを作成する。
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} linkedFileIds 紐づく文書のfileId
 * @returns {object} 作成された issues 行
 */
function issueCreate(title, body, linkedFileIds) {
  if (!/^[\s\S]{1,200}$/.test(String(title || ''))) {
    throw new Error('タイトルを入力してください');
  }

  var ids = linkedFileIds || [];
  for (var i = 0; i < ids.length; i++) {
    if (!dbFindOne('files', 'fileId', ids[i])) {
      throw new Error('管理対象にない文書です: ' + ids[i]);
    }
  }

  var row = {
    number: issueNextNumber_(),
    title: title,
    body: body || '',
    state: 'open',
    assignee: '',
    labels: '',
    linkedFileIds: ids.join(','),
    linkedPr: '',
    createdAt: new Date(),
    closedAt: '',
  };
  dbAppend('issues', row);
  return row;
}

/**
 * Issueを1件返す。無ければエラー。
 *
 * @param {number} number
 * @returns {object}
 */
function issueGet(number) {
  var row = dbFindOne('issues', 'number', number);
  if (!row) throw new Error('Issueが見つかりません: #' + number);
  return row;
}

/**
 * Issue一覧を返す。新しい順。
 *
 * @param {string} [state] 'open' | 'closed'。省略時は全件
 * @returns {object[]}
 */
function issueList(state) {
  var rows = dbReadAll('issues');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (state && String(rows[i].state) !== String(state)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(b.number) - Number(a.number); });
  return out;
}

/**
 * 文書に紐づく open Issue を返す。
 *
 * Wiki で文書を開いたときに横に並べるためのもの。
 *
 * @param {string} fileId
 * @returns {object[]}
 */
function issuesForFile(fileId) {
  var rows = issueList('open');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var ids = String(rows[i].linkedFileIds || '').split(',');
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] !== fileId) continue;
      out.push(rows[i]);
      break;
    }
  }
  return out;
}

/**
 * Issueのタイトル・本文・担当・ラベル・紐づく文書を更新する。
 *
 * state は履歴の意味を持つため、ここでは変更させない。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object} 更新後の行
 */
function issueUpdate(number, patch) {
  issueGet(number);
  if (Object.prototype.hasOwnProperty.call(patch, 'state')) {
    throw new Error('stateはissueCloseで変更してください');
  }

  var allowed = {};
  var keys = ['title', 'body', 'assignee', 'labels', 'linkedFileIds'];
  for (var i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(patch, keys[i])) {
      allowed[keys[i]] = patch[keys[i]];
    }
  }

  dbUpdate('issues', 'number', number, allowed);
  return issueGet(number);
}

/**
 * Issueをクローズする。既にクローズ済みなら何もしない。
 *
 * @param {number} number
 * @param {number|null} prNumber 紐づくPR番号
 * @returns {object} 更新後の行
 */
function issueClose(number, prNumber) {
  var row = issueGet(number);
  if (String(row.state) === 'closed') return row;

  dbUpdate('issues', 'number', number, {
    state: 'closed',
    closedAt: new Date(),
    linkedPr: prNumber === null || prNumber === undefined ? '' : prNumber,
  });
  return issueGet(number);
}
```

- [x] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [x] **Step 5: コミット**

```bash
git add src/core/Issue.gs test/phase3-issues.test.js
git commit -m "feat: Issueの作成・取得・更新・クローズを追加"
```

---

## Task 2: IssueBranch.gs — Issue からのブランチ作成

**Files:**
- Create: `src/core/IssueBranch.gs`
- Test: `test/phase3-issues.test.js`

**Interfaces:**
- Consumes: `issueGet` (Task 1) / `branchCreate` / `branchNameValid_` (既存)
- Produces:
  - `issueBranchName(number, title) -> string`
  - `issueCreateBranch(number, fileId) -> object` (branches 行)

- [x] **Step 1: 失敗するテストを書く**

```javascript
describe('Issue からのブランチ作成', () => {
  it('issue-<番号>-<題名> の形で命名する', () => {
    const { ctx } = setup();
    expect(ctx.issueBranchName(12, '在宅勤務規定')).toBe('issue-12-在宅勤務規定');
  });

  it('ブランチ名に使えない文字を落とす', () => {
    const { ctx } = setup();
    expect(ctx.issueBranchName(3, '就業規則/第7条を「改訂」する!'))
      .toBe('issue-3-就業規則第7条を改訂する');
  });

  it('長い題名は切り詰めて80文字以内にする', () => {
    const { ctx } = setup();
    const name = ctx.issueBranchName(1, 'あ'.repeat(200));
    expect(name.length).toBeLessThanOrEqual(80);
    expect(ctx.branchNameValid_(name)).toBe(true);
  });

  it('題名が全部落ちたら番号だけで名前を作る', () => {
    const { ctx } = setup();
    expect(ctx.issueBranchName(7, '!!!')).toBe('issue-7');
  });

  it('Issueからブランチを作ると作業コピーができる', () => {
    const { ctx, fileId } = setup();
    const issue = ctx.issueCreate('在宅勤務規定', '', [fileId]);
    const branch = ctx.issueCreateBranch(issue.number, fileId);

    expect(branch.name).toBe('issue-1-在宅勤務規定');
    expect(ctx.branchWorkingFileId(branch.name, fileId)).toBeTruthy();
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase3-issues.test.js`
Expected: FAIL

- [x] **Step 3: 実装する**

```javascript
/**
 * Issueからブランチ名を作る。
 *
 * branchNameValid_ が許す文字だけを残し、80文字に収める。
 * 題名が全部落ちた場合は番号だけの名前にする。
 *
 * @param {number} number
 * @param {string} title
 * @returns {string}
 */
function issueBranchName(number, title) {
  var prefix = 'issue-' + Number(number);
  var slug = String(title || '').replace(/[^A-Za-z0-9ぁ-んァ-ヶ一-龠々ー_\-]/g, '');
  if (!slug) return prefix;

  var room = 80 - prefix.length - 1;
  if (slug.length > room) slug = slug.substring(0, room);
  return prefix + '-' + slug;
}

/**
 * Issueに対応するブランチを作る。
 *
 * @param {number} number Issue番号
 * @param {string} fileId main上の対象ファイル
 * @returns {object} 作成された branches 行
 */
function issueCreateBranch(number, fileId) {
  var issue = issueGet(number);
  if (String(issue.state) === 'closed') {
    throw new Error('クローズ済みのIssueからはブランチを作れません: #' + number);
  }
  return branchCreate(issueBranchName(number, issue.title), fileId);
}
```

- [x] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [x] **Step 5: コミット**

```bash
git add src/core/IssueBranch.gs test/phase3-issues.test.js
git commit -m "feat: Issueからブランチを1クリックで作れるようにする"
```

---

## Task 3: Project.gs — カンバンボード

**Files:**
- Create: `src/core/Project.gs`
- Test: `test/phase3-issues.test.js`

**Interfaces:**
- Consumes: `issueGet` (Task 1) / `dbAppend` / `dbUpdate` / `dbReadAll`
- Produces:
  - `PROJECT_COLUMNS() -> string[]`
  - `projectBoard() -> Object<string, object[]>` (列名 → カード配列)
  - `projectPlace(issueNumber, column) -> object` (未配置なら末尾に追加)
  - `projectMove(issueNumber, column, order) -> object`

- [x] **Step 1: 失敗するテストを書く**

```javascript
describe('カンバンボード', () => {
  it('Issueを作ると Backlog に置かれる', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');

    const board = ctx.projectBoard();
    expect(board['Backlog'].length).toBe(1);
    expect(board['Backlog'][0].issueNumber).toBe(issue.number);
    expect(board['In Progress'].length).toBe(0);
  });

  it('列を移すと元の列から消える', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');
    ctx.projectMove(issue.number, 'In Progress', 0);

    const board = ctx.projectBoard();
    expect(board['Backlog'].length).toBe(0);
    expect(board['In Progress'].length).toBe(1);
  });

  it('order の昇順で並ぶ', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('A', '', []);
    const b = ctx.issueCreate('B', '', []);
    ctx.projectPlace(a.number, 'Backlog');
    ctx.projectPlace(b.number, 'Backlog');
    ctx.projectMove(b.number, 'Backlog', 0);
    ctx.projectMove(a.number, 'Backlog', 1);

    expect(ctx.projectBoard()['Backlog'].map((c) => c.issueNumber))
      .toEqual([b.number, a.number]);
  });

  it('定義されていない列には置けない', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('改訂', '', []);
    expect(() => ctx.projectPlace(issue.number, 'Someday'))
      .toThrow(/列が不正です/);
  });

  it('カードにはIssueの題名と状態が載る', () => {
    const { ctx } = setup();
    const issue = ctx.issueCreate('在宅勤務規定を改訂', '', []);
    ctx.projectPlace(issue.number, 'Backlog');
    expect(ctx.projectBoard()['Backlog'][0].title).toBe('在宅勤務規定を改訂');
    expect(ctx.projectBoard()['Backlog'][0].state).toBe('open');
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase3-issues.test.js`
Expected: FAIL

- [x] **Step 3: 実装する**

```javascript
/**
 * カンバンの列。順序がそのまま表示順になる。
 *
 * トップレベルのconstではなく関数として公開する。GASはファイルを
 * ファイル名順に読み込むため、トップレベル初期化は順序依存になる。
 *
 * @returns {string[]}
 */
function PROJECT_COLUMNS() {
  return ['Backlog', 'In Progress', 'In Review', 'Done'];
}

/**
 * 列名が定義済みかを確かめる。
 *
 * @param {string} column
 */
function projectAssertColumn_(column) {
  var cols = PROJECT_COLUMNS();
  for (var i = 0; i < cols.length; i++) {
    if (cols[i] === column) return;
  }
  throw new Error('列が不正です: ' + column);
}

/**
 * ボード全体を返す。列名をキーに、order 昇順のカード配列を持つ。
 *
 * カードにはIssueの題名と状態を載せる。UI側で再問い合わせしないため。
 *
 * @returns {Object<string, object[]>}
 */
function projectBoard() {
  var cols = PROJECT_COLUMNS();
  var board = {};
  for (var i = 0; i < cols.length; i++) board[cols[i]] = [];

  var items = dbReadAll('project_items');
  for (var j = 0; j < items.length; j++) {
    var column = String(items[j].column);
    if (!board[column]) continue;

    var issue = dbFindOne('issues', 'number', items[j].issueNumber);
    if (!issue) continue;

    board[column].push({
      issueNumber: Number(items[j].issueNumber),
      order: Number(items[j].order),
      title: issue.title,
      state: issue.state,
      assignee: issue.assignee,
      labels: issue.labels,
    });
  }

  for (var k = 0; k < cols.length; k++) {
    board[cols[k]].sort(function (a, b) { return a.order - b.order; });
  }
  return board;
}

/**
 * カードを列の末尾に置く。既に配置済みなら何もしない。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @returns {object} project_items 行
 */
function projectPlace(issueNumber, column) {
  projectAssertColumn_(column);
  issueGet(issueNumber);

  var existing = dbFindOne('project_items', 'issueNumber', issueNumber);
  if (existing) return existing;

  var board = projectBoard();
  var row = {
    issueNumber: issueNumber,
    column: column,
    order: board[column].length,
  };
  dbAppend('project_items', row);
  return row;
}

/**
 * カードを別の列・別の位置に移す。未配置なら先に置く。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @param {number} order
 * @returns {object} 更新後の行
 */
function projectMove(issueNumber, column, order) {
  projectAssertColumn_(column);
  if (!dbFindOne('project_items', 'issueNumber', issueNumber)) {
    projectPlace(issueNumber, column);
  }
  dbUpdate('project_items', 'issueNumber', issueNumber, {
    column: column,
    order: Number(order),
  });
  return dbFindOne('project_items', 'issueNumber', issueNumber);
}
```

- [x] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [x] **Step 5: コミット**

```bash
git add src/core/Project.gs test/phase3-issues.test.js
git commit -m "feat: Issueを載せるカンバンボードを追加"
```

---

## Task 4: PR の状態変化でボードと Issue を動かす

**Files:**
- Modify: `src/core/PullRequest.gs` (`prCreate` の末尾 / `prMerge` の末尾)
- Test: `test/phase3-issues.test.js`

**Interfaces:**
- Consumes: `prClosesIssues_` (既存) / `issueClose` (Task 1) / `projectMove` (Task 3)

- [x] **Step 1: 失敗するテストを書く**

`SOURCES` に `'src/core/Project.gs'` と `'src/core/IssueBranch.gs'` を足してから書く。

```javascript
describe('PRの状態変化がボードとIssueを動かす', () => {
  function prepare() {
    const env = setup();
    const issue = env.ctx.issueCreate('第3条を追加', '', [env.fileId]);
    env.ctx.projectPlace(issue.number, 'Backlog');
    env.ctx.issueCreateBranch(issue.number, env.fileId);

    const branchName = env.ctx.issueBranchName(issue.number, issue.title);
    const workFileId = env.ctx.branchWorkingFileId(branchName, env.fileId);
    env.fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条 休日</p>\n');
    env.ctx.commitFile(workFileId, branchName, '第3条を追加', null);

    return Object.assign(env, { issue: issue, branchName: branchName });
  }

  it('PRを作ると In Review に動く', () => {
    const env = prepare();
    env.ctx.prCreate('第3条を追加', 'closes #' + env.issue.number,
      env.branchName, env.fileId);

    expect(env.ctx.projectBoard()['In Review'].length).toBe(1);
    expect(env.ctx.projectBoard()['Backlog'].length).toBe(0);
  });

  it('マージすると Issue が閉じ、Done に動く', () => {
    const env = prepare();
    const pr = env.ctx.prCreate('第3条を追加', 'closes #' + env.issue.number,
      env.branchName, env.fileId);

    env.fake._setUser('reviewer@example.com');
    env.ctx.prReview(pr.number, 'approve', '');
    env.fake._setUser('tester@example.com');
    env.ctx.prMerge(pr.number, []);

    expect(env.ctx.issueGet(env.issue.number).state).toBe('closed');
    expect(env.ctx.issueGet(env.issue.number).linkedPr).toBe(pr.number);
    expect(env.ctx.projectBoard()['Done'].length).toBe(1);
  });

  it('closes 記法が無ければ Issue は閉じない', () => {
    const env = prepare();
    const pr = env.ctx.prCreate('第3条を追加', '', env.branchName, env.fileId);

    env.fake._setUser('reviewer@example.com');
    env.ctx.prReview(pr.number, 'approve', '');
    env.fake._setUser('tester@example.com');
    env.ctx.prMerge(pr.number, []);

    expect(env.ctx.issueGet(env.issue.number).state).toBe('open');
  });

  it('存在しないIssue番号を closes に書いてもマージは失敗しない', () => {
    const env = prepare();
    const pr = env.ctx.prCreate('第3条を追加', 'closes #999',
      env.branchName, env.fileId);

    env.fake._setUser('reviewer@example.com');
    env.ctx.prReview(pr.number, 'approve', '');
    env.fake._setUser('tester@example.com');
    expect(() => env.ctx.prMerge(pr.number, [])).not.toThrow();
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase3-issues.test.js`
Expected: FAIL

- [x] **Step 3: `prCreate` にフックを足す**

`dbAppend('pulls', row);` の直後、`return row;` の前に足す。

```javascript
  // PR本文の closes #N に対応するカードを In Review に動かす。
  // 人が動かさなくても文書の状態変化がボードに反映される (spec §6.2)
  var opened = prClosesIssues_(row.body);
  for (var k = 0; k < opened.length; k++) {
    projectMoveIfExists_(opened[k], 'In Review');
  }
```

`prClosesIssues_` の直後に補助関数を足す。

```javascript
/**
 * Issueが存在すればカードを動かす。存在しなければ何もしない。
 *
 * PR本文の closes #N は人が手で書くため、番号が間違っていることがある。
 * 間違いでPR作成やマージを失敗させない。
 *
 * @param {number} issueNumber
 * @param {string} column
 */
function projectMoveIfExists_(issueNumber, column) {
  if (!dbFindOne('issues', 'number', issueNumber)) return;
  var item = dbFindOne('project_items', 'issueNumber', issueNumber);
  projectMove(issueNumber, column, item ? Number(item.order) : 0);
}
```

- [x] **Step 4: `prMerge` にフックを足す**

マージコミットを作った直後、`dbUpdate('pulls', ...)` で `merged` にする処理の後ろに足す。

```javascript
    // closes #N のIssueを閉じ、カードを Done に動かす
    var closing = prClosesIssues_(pr.body);
    for (var ci = 0; ci < closing.length; ci++) {
      if (!dbFindOne('issues', 'number', closing[ci])) continue;
      issueClose(closing[ci], number);
      projectMoveIfExists_(closing[ci], 'Done');
    }
```

- [x] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS (Phase 2 の統合テストも全て通ること)

- [x] **Step 6: コミット**

```bash
git add src/core/PullRequest.gs test/phase3-issues.test.js
git commit -m "feat: PRの作成とマージでIssueとボードを自動で動かす"
```

---

## Task 5: Notifier.gs — 通知アダプタ

**Files:**
- Create: `src/core/Notifier.gs`
- Modify: `src/core/PullRequest.gs`
- Test: `test/phase3-issues.test.js`

**Interfaces:**
- Produces: `notify(to, subject, body)` / `notifyPrCreated(pr)` / `notifyPrMerged(pr)`

- [x] **Step 1: 疑似GASに GmailApp を足す**

`test/fakegas.js` の戻り値に足す。

```javascript
    GmailApp: {
      sendEmail: (to, subject, body) => { sentMails.push({ to, subject, body }); },
    },
    _sentMails: () => sentMails,
```

`createFakeGas` の先頭に `const sentMails = [];` を足す。

- [x] **Step 2: 失敗するテストを書く**

```javascript
describe('通知', () => {
  it('宛先が空なら送らない', () => {
    const { ctx, fake } = setup();
    ctx.notify('', '件名', '本文');
    expect(fake._sentMails().length).toBe(0);
  });

  it('通知に失敗してもエラーを投げない', () => {
    const { ctx, fake } = setup();
    ctx.GmailApp.sendEmail = () => { throw new Error('quota exceeded'); };
    expect(() => ctx.notify('a@example.com', '件名', '本文')).not.toThrow();
  });

  it('PR作成で作成者に通知が飛ぶ', () => {
    const { ctx, fake } = setup();
    ctx.notifyPrCreated({ number: 3, title: '改訂', author: 'a@example.com' });
    const mails = fake._sentMails();
    expect(mails.length).toBe(1);
    expect(mails[0].to).toBe('a@example.com');
    expect(mails[0].subject).toContain('PR #3');
  });
});
```

- [x] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/phase3-issues.test.js`
Expected: FAIL

- [x] **Step 4: 実装する**

```javascript
/**
 * 通知を送る。
 *
 * 通知はこの1関数に隔離する。将来 UrlFetchApp が解禁されたときに
 * Google Chat Webhook へ差し替える箇所をここだけにするため (spec §6.3)。
 *
 * 通知の失敗で本処理を巻き戻してはならないため、例外は握って記録する。
 *
 * @param {string} to 宛先メールアドレス
 * @param {string} subject
 * @param {string} body
 */
function notify(to, subject, body) {
  if (!to) return;
  try {
    GmailApp.sendEmail(to, subject, body);
  } catch (e) {
    Logger.log('通知を送れませんでした: ' + e.message);
  }
}

/**
 * PR作成を通知する。
 *
 * @param {object} pr pulls 行
 */
function notifyPrCreated(pr) {
  notify(
    pr.author,
    '[agentic-management] PR #' + pr.number + ' が作成されました',
    pr.title + '\n\nWiki のプルリクエストタブから確認してください。'
  );
}

/**
 * PRマージを通知する。
 *
 * @param {object} pr pulls 行
 */
function notifyPrMerged(pr) {
  notify(
    pr.author,
    '[agentic-management] PR #' + pr.number + ' がマージされました',
    pr.title + '\n\nmain の文書が更新されました。'
  );
}
```

- [x] **Step 5: PullRequest.gs から呼ぶ**

`prCreate` の `return row;` の直前に足す。

```javascript
  notifyPrCreated(row);
```

`prMerge` の Issue クローズ処理の後ろに足す。

```javascript
    notifyPrMerged(pr);
```

- [x] **Step 6: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [x] **Step 7: コミット**

```bash
git add src/core/Notifier.gs src/core/PullRequest.gs test/fakegas.js test/phase3-issues.test.js
git commit -m "feat: PR作成とマージのメール通知を単一アダプタで追加"
```

---

## Task 6: Web App API と UI

**Files:**
- Modify: `src/Main.gs`
- Modify: `src/ui/wiki.html`
- Modify: `src/ui/app.js.html`
- Modify: `src/ui/app.css.html`

**Interfaces:**
- Consumes: Task 1-5 のすべて

- [x] **Step 1: Main.gs に API を足す**

`src/Main.gs` の末尾 (`debugWriteRoundTrip` の前) に足す。

```javascript
/**
 * Issue一覧を返す (Web App API)。
 *
 * @param {string} state 'open' | 'closed' | ''
 * @returns {object[]}
 */
function apiIssueList(state) {
  return issueList(state || null);
}

/**
 * Issueを作成する (Web App API)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string[]} linkedFileIds
 * @returns {object}
 */
function apiIssueCreate(title, body, linkedFileIds) {
  var issue = issueCreate(title, body, linkedFileIds || []);
  projectPlace(issue.number, 'Backlog');
  return issue;
}

/**
 * Issueを更新する (Web App API)。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object}
 */
function apiIssueUpdate(number, patch) {
  return issueUpdate(number, patch || {});
}

/**
 * Issueからブランチを作る (Web App API)。
 *
 * @param {number} number
 * @param {string} fileId
 * @returns {object}
 */
function apiIssueCreateBranch(number, fileId) {
  var branch = issueCreateBranch(number, fileId);
  projectMoveIfExists_(number, 'In Progress');
  return { name: branch.name };
}

/**
 * 文書に紐づく open Issue を返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {object[]}
 */
function apiIssuesForFile(fileId) {
  return issuesForFile(fileId);
}

/**
 * カンバンボードを返す (Web App API)。
 *
 * @returns {Object<string, object[]>}
 */
function apiProjectBoard() {
  return projectBoard();
}

/**
 * カードを動かす (Web App API)。
 *
 * @param {number} issueNumber
 * @param {string} column
 * @param {number} order
 * @returns {object}
 */
function apiProjectMove(issueNumber, column, order) {
  return projectMove(issueNumber, column, order);
}
```

- [x] **Step 2: wiki.html にタブとパネルを足す**

`<button class="tab" data-tab="pulls">プルリクエスト</button>` の直後に足す。

```html
        <button class="tab" data-tab="issues">Issue</button>
        <button class="tab" data-tab="board">ボード</button>
```

`<div class="panel" id="panel-pulls" ...>` の直後に足す。

```html
      <div class="panel panel-col" id="panel-issues" hidden>
        <div class="panel-actions">
          <button id="issue-create-btn" class="btn">Issueを作成</button>
          <span class="row-meta">選択中の文書に紐づけて作成します</span>
        </div>
        <div class="list-area" id="issue-list"></div>
      </div>

      <div class="panel" id="panel-board" hidden>
        <div class="board" id="board"></div>
      </div>
```

- [x] **Step 3: app.css.html にボードのスタイルを足す**

既存のデザイントークン (`--ink` / `--ink-2` / `--line`) を使う。

```css
    .board {
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 12px;
      padding: 12px;
      overflow-x: auto;
    }

    .board-column {
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
    }

    .board-column h3 {
      font-size: 12px;
      color: var(--ink-2);
      margin: 0 0 8px;
    }

    .board-card {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--ink);
      cursor: grab;
    }

    .board-card .row-meta { display: block; margin-top: 4px; }
```

- [x] **Step 4: app.js.html に Issue とボードの表示を足す**

`switchTab` の分岐に `issues` と `board` を足し、以下の関数を追加する。
**テキストは必ず `textContent` で入れる。`innerHTML` は使わない** (XSS対策)。

```javascript
  function loadIssues() {
    var listEl = document.getElementById('issue-list');
    listEl.textContent = '読み込み中…';

    google.script.run
      .withSuccessHandler(function (issues) {
        listEl.textContent = '';
        if (issues.length === 0) {
          listEl.textContent = 'Issueはありません';
          return;
        }
        issues.forEach(function (issue) {
          var row = document.createElement('div');
          row.className = 'list-row';

          var title = document.createElement('div');
          title.textContent = '#' + issue.number + ' ' + issue.title;
          row.appendChild(title);

          var meta = document.createElement('div');
          meta.className = 'row-meta';
          meta.textContent = issue.state +
            (issue.assignee ? ' · ' + issue.assignee : '') +
            (issue.labels ? ' · ' + issue.labels : '');
          row.appendChild(meta);

          if (issue.state === 'open' && current.fileId) {
            var branchBtn = document.createElement('button');
            branchBtn.className = 'btn';
            branchBtn.textContent = 'このIssueでブランチを作る';
            branchBtn.addEventListener('click', function () {
              branchBtn.disabled = true;
              google.script.run
                .withSuccessHandler(function (b) {
                  window.alert('ブランチを作りました: ' + b.name);
                  loadFiles();
                  loadIssues();
                })
                .withFailureHandler(function (err) {
                  branchBtn.disabled = false;
                  window.alert(err.message);
                })
                .apiIssueCreateBranch(issue.number, current.fileId);
            });
            row.appendChild(branchBtn);
          }

          listEl.appendChild(row);
        });
      })
      .withFailureHandler(function (err) {
        listEl.textContent = 'エラー: ' + err.message;
      })
      .apiIssueList('');
  }

  function loadBoard() {
    var boardEl = document.getElementById('board');
    boardEl.textContent = '読み込み中…';

    google.script.run
      .withSuccessHandler(function (board) {
        boardEl.textContent = '';
        ['Backlog', 'In Progress', 'In Review', 'Done'].forEach(function (column) {
          var col = document.createElement('div');
          col.className = 'board-column';

          var head = document.createElement('h3');
          head.textContent = column + ' (' + board[column].length + ')';
          col.appendChild(head);

          board[column].forEach(function (card) {
            var el = document.createElement('div');
            el.className = 'board-card';
            el.textContent = '#' + card.issueNumber + ' ' + card.title;

            var meta = document.createElement('span');
            meta.className = 'row-meta';
            meta.textContent = card.assignee || '未割当';
            el.appendChild(meta);

            col.appendChild(el);
          });

          boardEl.appendChild(col);
        });
      })
      .withFailureHandler(function (err) {
        boardEl.textContent = 'エラー: ' + err.message;
      })
      .apiProjectBoard();
  }
```

Issue 作成ボタンの処理を足す。

```javascript
  document.getElementById('issue-create-btn').addEventListener('click', function () {
    var title = window.prompt('Issueのタイトルを入力してください');
    if (!title) return;
    var body = window.prompt('説明 (任意)') || '';

    google.script.run
      .withSuccessHandler(function () { loadIssues(); })
      .withFailureHandler(function (err) { window.alert(err.message); })
      .apiIssueCreate(title, body, current.fileId ? [current.fileId] : []);
  });
```

- [x] **Step 5: 文書を開いたときに紐づく open Issue を並べる**

spec §6.1 の「文書中心の作業管理」の核心はここにある。
`wiki.html` の `panel-content` の iframe の**前**に足す。

```html
        <div class="linked-issues" id="linked-issues" hidden></div>
```

`app.css.html` に足す。

```css
    .linked-issues {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--line);
    }

    .linked-issue {
      font-size: 12px;
      color: var(--ink-2);
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 10px;
    }
```

`app.js.html` の `selectFile` の成功ハンドラ (`renderIntoViewer(res.html);` の後) に足す。

```javascript
        loadLinkedIssues(fileId);
```

同じファイルに関数を足す。

```javascript
  function loadLinkedIssues(fileId) {
    var wrap = document.getElementById('linked-issues');
    wrap.textContent = '';
    wrap.hidden = true;

    google.script.run
      .withSuccessHandler(function (issues) {
        if (!issues.length) return;
        issues.forEach(function (issue) {
          var chip = document.createElement('span');
          chip.className = 'linked-issue';
          chip.textContent = '#' + issue.number + ' ' + issue.title;
          wrap.appendChild(chip);
        });
        wrap.hidden = false;
      })
      .withFailureHandler(function () { /* Issueが引けなくても本文表示は妨げない */ })
      .apiIssuesForFile(fileId);
  }
```

- [x] **Step 6: カードをドラッグ&ドロップで動かせるようにする**

`loadBoard` の中でカードを作っている箇所に足す。HTML5 の drag イベントを使う。

```javascript
            el.draggable = true;
            el.addEventListener('dragstart', function (e) {
              e.dataTransfer.setData('text/plain', String(card.issueNumber));
            });
```

列を作っている箇所 (`col` を作った直後) に足す。

```javascript
          col.addEventListener('dragover', function (e) { e.preventDefault(); });
          col.addEventListener('drop', function (e) {
            e.preventDefault();
            var issueNumber = Number(e.dataTransfer.getData('text/plain'));
            if (!issueNumber) return;

            google.script.run
              .withSuccessHandler(function () { loadBoard(); })
              .withFailureHandler(function (err) { window.alert(err.message); })
              .apiProjectMove(issueNumber, column, board[column].length);
          });
```

> `column` と `board` は `forEach` のクロージャに閉じ込められているため、
> そのまま参照してよい。`var` のループ変数を使うと最後の列に固定される
> 罠があるので、`forEach` のままにすること。

- [x] **Step 7: push して再デプロイ**

```bash
npx clasp push -f
npx clasp create-deployment -i <既存のデプロイID> -d "Phase 3b: Issue/Projects"
```

- [x] **Step 8: Web App で一連の流れを確認**

1. 文書を選び、Issue タブで「Issueを作成」
2. ボードタブを開く

Expected: Backlog にカードが1枚ある

3. Issue タブで「このIssueでブランチを作る」

Expected: `issue-1-<題名>` が作られ、ボードで **In Progress** に動く

4. ブランチの文書を編集してコミットし、PR を作る。**本文に `closes #1` と書く**

Expected: ボードで **In Review** に動く

5. 承認してマージする

Expected: Issue が closed になり、ボードで **Done** に動く。作成者にメールが届く

- [x] **Step 9: コミット**

```bash
git add src/Main.gs src/ui/
git commit -m "feat: IssueタブとカンバンボードをWeb Appに追加"
```

---

## Task 7: 統合検証とドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-04-gws-git-management-phase3b-issues-projects.md`

- [x] **Step 1: 全テストを実行**

Run: `npm test`
Expected: PASS

- [x] **Step 2: 間違った番号への耐性を確認**

PR 本文に `closes #999` と書いてマージする。

Expected: マージは成功し、ログにもエラーが出ない

- [x] **Step 3: README を更新**

「現在の状態」に Issue / Projects の節を足す。

```markdown
### Issue と Projects

- Issue は文書に紐づく。Wiki で文書を開くと、その文書の open Issue が並ぶ
- Issue から 1 クリックでブランチを作れる (`issue-<番号>-<題名>` で自動命名)
- PR 本文に `closes #N` と書くと、マージ時に Issue が閉じる
- カンバンは PR の状態変化で自動的に動く
  (ブランチ作成 → In Progress、PR 作成 → In Review、マージ → Done)
- 通知は `Notifier.gs` に隔離してある。`UrlFetchApp` が解禁されたら
  Google Chat Webhook に差し替えられる
```

ロードマップの Phase 3 行を「完了」にする。

- [x] **Step 4: 計画書に完了マークを付ける**

全チェックボックスが `- [x]` になっていることを確認し、ヘッダに完了ステータスを追記する。

- [x] **Step 5: コミット**

```bash
git add README.md docs/
git commit -m "docs: Phase 3b 完了を反映"
```

---

## Phase 3b 完了時に達成されていること

- [x] `npm test` で Issue / ボード / PR連動を含む全テストが通る
- [x] Issue を作成・更新・クローズでき、文書に紐づけられる
- [x] Wiki で文書を開くと、その文書の open Issue が見える
- [x] Issue から 1 クリックでブランチができ、命名が `issue-<番号>-<題名>` になる
- [x] PR 本文の `closes #N` でマージ時に Issue が閉じる
- [x] カンバンがブランチ作成・PR作成・マージで自動的に動く
- [x] 存在しない Issue 番号を `closes` に書いてもマージが失敗しない
- [x] PR 作成時とマージ時にメール通知が届く
- [x] 通知の失敗が本処理を巻き戻さない
- [x] Wiki で文書を開くと紐づく open Issue がチップとして並ぶ
- [x] ボードのカードをドラッグ&ドロップで別の列に動かせる
