# Phase 4b (Markdown 編集 + main のブランチ保護) 実装計画

**ステータス: 実装完了 (2026-09-04)** — 残は実機での目視と往復確認のみ。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブランチ上の文書をアプリ内で Markdown として編集できるようにし、main は
PR 経由でしか変更できないようにする。

**Architecture:** 新しいピュアモジュール `src/core/Markdown.js` が
`mdToBlocks()` / `blocksToMd()` の2関数だけを公開する。既存の Block 型を挟むため、
Diff / Merge / 書き戻しは一切変更しない。保護は API 層 (`apiCommit` /
`apiSaveMarkdown`) で行い、`commitFile` そのものは変えない。

**Tech Stack:** Google Apps Script (V8) / vitest / 疑似GAS (`test/fakegas.js`)

**Spec:** `docs/superpowers/specs/2026-09-04-gws-git-management-phase4-design.md` (§5)

## Global Constraints

- GAS 標準サービスのみ。**GCP プロジェクトは使用不可**
- ランタイムコードに `import` / `export` / `require` を書かない
- **既存の正規化HTMLの出力を変えない。** `Normalize.js` の
  `serializeBlocks` / `parseBlocks` には手を入れない
- Run の形は `{text, bold?, italic?, underline?, strike?, link?}`。
  装飾のネスト順は `bold → italic → underline → strike → link` で固定
- Markdown が扱う語彙は正規化HTMLの語彙に閉じる。脚注・引用・コードブロックは扱わない
- ピュアなロジックは vitest、GAS 依存は疑似GASで統合テストする

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/core/Markdown.js` (新規) | Block[] ⇄ Markdown の相互変換 |
| `src/Main.gs` (変更) | `apiGetMarkdown` / `apiSaveMarkdown` / `apiStashMainDrift` と main 保護 |
| `src/ui/wiki.html` / `app.js.html` / `app.css.html` (変更) | 編集画面 |
| `test/markdown.test.js` (新規) | 変換の往復テスト |
| `test/phase4-edit.test.js` (新規) | 保護と退避の統合テスト |

## 記法の対応 (この計画全体の前提)

| Markdown | Block / Run |
|---|---|
| `# ` 〜 `###### ` | `heading` (level 1-6) |
| 空行で区切られた行 | `paragraph` |
| `- ` / `1. ` (ネストは半角2スペース) | `listItem` (`ordered`, `depth`) |
| GFM テーブル (先頭行をヘッダとして扱う) | `table` |
| `![alt](sha:<sha>)` | `image` |
| `**text**` | `bold` |
| `*text*` | `italic` |
| `<u>text</u>` | `underline` |
| `~~text~~` | `strike` |
| `[text](url)` | `link` |

エスケープ対象は `\ * ~ [ < |` と、行頭の `#` / `-` / `N.` とする。

---

## Task 1: blocksToMd — Block配列を Markdown にする

**Files:**
- Create: `src/core/Markdown.js`
- Test: `test/markdown.test.js` (新規)

**Interfaces:**
- Produces: `blocksToMd(blocks) -> string`

- [x] **Step 1: 失敗するテストを書く**

```javascript
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/Markdown.js');

function run(text, attrs) { return Object.assign({ text: text }, attrs || {}); }

describe('blocksToMd', () => {
  it('見出しと段落を変換する', () => {
    expect(gas.blocksToMd([
      { type: 'heading', level: 2, runs: [run('第1章')] },
      { type: 'paragraph', runs: [run('本文です。')] },
    ])).toBe('## 第1章\n\n本文です。\n');
  });

  it('装飾はネスト順どおりに出す', () => {
    expect(gas.blocksToMd([
      { type: 'paragraph', runs: [run('重要', { bold: true, italic: true })] },
    ])).toBe('***重要***\n');
  });

  it('リンクつき太字は太字が外側になる', () => {
    expect(gas.blocksToMd([
      { type: 'paragraph', runs: [run('規程', { bold: true, link: 'https://e.test/' })] },
    ])).toBe('**[規程](https://e.test/)**\n');
  });

  it('下線はHTMLタグで出す', () => {
    expect(gas.blocksToMd([
      { type: 'paragraph', runs: [run('注意', { underline: true })] },
    ])).toBe('<u>注意</u>\n');
  });

  it('連続するリスト項目は空行で区切らない', () => {
    expect(gas.blocksToMd([
      { type: 'listItem', ordered: false, depth: 0, runs: [run('一つ目')] },
      { type: 'listItem', ordered: false, depth: 1, runs: [run('入れ子')] },
      { type: 'listItem', ordered: true, depth: 0, runs: [run('番号つき')] },
    ])).toBe('- 一つ目\n  - 入れ子\n1. 番号つき\n');
  });

  it('テーブルは先頭行をヘッダとして出す', () => {
    expect(gas.blocksToMd([
      { type: 'table', rows: [[[run('月')], [run('額')]], [[run('1月')], [run('100')]]] },
    ])).toBe('| 月 | 額 |\n| --- | --- |\n| 1月 | 100 |\n');
  });

  it('画像は sha 形式で出す', () => {
    expect(gas.blocksToMd([
      { type: 'image', sha: 'a'.repeat(64), alt: '図1' },
    ])).toBe('![図1](sha:' + 'a'.repeat(64) + ')\n');
  });

  it('記法に使う文字をエスケープする', () => {
    expect(gas.blocksToMd([
      { type: 'paragraph', runs: [run('2 * 3 [注] ~ <tag> |')] },
    ])).toBe('2 \\* 3 \\[注] \\~ \\<tag> \\|\n');
  });

  it('行頭が記法に見える段落をエスケープする', () => {
    expect(gas.blocksToMd([
      { type: 'paragraph', runs: [run('# ハッシュで始まる')] },
      { type: 'paragraph', runs: [run('1. 数字で始まる')] },
    ])).toBe('\\# ハッシュで始まる\n\n1\\. 数字で始まる\n');
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/markdown.test.js`
Expected: FAIL (`blocksToMd is not defined`)

- [x] **Step 3: 実装する**

```javascript
/**
 * Markdown の記法に使う文字をエスケープする。
 *
 * 対象は parser が意味を持たせる文字だけに絞る。_ は斜体に使わないため
 * エスケープしない。過剰にエスケープすると読みにくくなる。
 *
 * @param {string} text
 * @returns {string}
 */
function escapeMd_(text) {
  return String(text).replace(/([\\*~\[<|])/g, '\\$1');
}

/**
 * escapeMd_ の逆変換。
 *
 * @param {string} text
 * @returns {string}
 */
function unescapeMd_(text) {
  return String(text).replace(/\\([\\*~\[<|#\-.])/g, '$1');
}

/**
 * Run配列を Markdown のインライン記法にする。
 *
 * 装飾のネスト順は serializeRuns_ と同じ bold → italic → underline →
 * strike → link で固定する。順序が違うと往復で形が変わる。
 *
 * @param {object[]} runs
 * @returns {string}
 */
function runsToMd_(runs) {
  var out = '';
  for (var i = 0; i < (runs || []).length; i++) {
    var r = runs[i];
    if (!r.text) continue;

    var md = escapeMd_(r.text);
    if (r.link) md = '[' + md + '](' + r.link + ')';
    if (r.strike) md = '~~' + md + '~~';
    if (r.underline) md = '<u>' + md + '</u>';
    if (r.italic) md = '*' + md + '*';
    if (r.bold) md = '**' + md + '**';
    out += md;
  }
  return out;
}

/**
 * 行頭が記法に見える場合にエスケープする。
 *
 * @param {string} line
 * @returns {string}
 */
function escapeLineStart_(line) {
  if (/^#{1,6} /.test(line)) return '\\' + line;
  if (/^- /.test(line)) return '\\' + line;
  if (/^(\d+)\. /.test(line)) return line.replace(/^(\d+)\./, '$1\\.');
  if (/^\| /.test(line)) return '\\' + line;
  return line;
}

/**
 * Block配列を Markdown にする。
 *
 * 連続するリスト項目とテーブルの行は空行で区切らない。区切ると
 * Markdown として別のリスト・別の表になってしまう。
 *
 * @param {object[]} blocks
 * @returns {string} 末尾に改行を持つ Markdown
 */
function blocksToMd(blocks) {
  var chunks = [];

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];

    if (b.type === 'heading') {
      var level = Math.min(6, Math.max(1, b.level));
      chunks.push({ glue: 'blank', text: new Array(level + 1).join('#') + ' ' + runsToMd_(b.runs) });
    } else if (b.type === 'paragraph') {
      var line = runsToMd_(b.runs);
      if (!line) continue;
      chunks.push({ glue: 'blank', text: escapeLineStart_(line) });
    } else if (b.type === 'listItem') {
      var indent = new Array((b.depth || 0) + 1).join('  ');
      var marker = b.ordered ? '1. ' : '- ';
      chunks.push({ glue: 'list', text: indent + marker + runsToMd_(b.runs) });
    } else if (b.type === 'table') {
      chunks.push({ glue: 'blank', text: tableToMd_(b.rows) });
    } else if (b.type === 'image') {
      chunks.push({ glue: 'blank', text: '![' + escapeMd_(b.alt || '') + '](sha:' + b.sha + ')' });
    }
  }

  var out = '';
  for (var c = 0; c < chunks.length; c++) {
    if (c > 0) {
      var bothList = chunks[c].glue === 'list' && chunks[c - 1].glue === 'list';
      out += bothList ? '\n' : '\n\n';
    }
    out += chunks[c].text;
  }
  return out ? out + '\n' : '';
}

/**
 * テーブルの行配列を GFM テーブルにする。先頭行をヘッダとして扱う。
 *
 * @param {Array<Array<object[]>>} rows
 * @returns {string}
 */
function tableToMd_(rows) {
  if (!rows.length) return '';

  var width = 0;
  for (var r = 0; r < rows.length; r++) {
    if (rows[r].length > width) width = rows[r].length;
  }

  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var cells = [];
    for (var c = 0; c < width; c++) {
      cells.push(runsToMd_(rows[i][c] || []));
    }
    lines.push('| ' + cells.join(' | ') + ' |');

    if (i === 0) {
      var seps = [];
      for (var s = 0; s < width; s++) seps.push('---');
      lines.push('| ' + seps.join(' | ') + ' |');
    }
  }
  return lines.join('\n');
}
```

- [x] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [x] **Step 5: コミット**

```bash
git add src/core/Markdown.js test/markdown.test.js
git commit -m "feat: Block配列をMarkdownに変換する"
```

---

## Task 2: mdToBlocks — Markdown を Block配列にする

**Files:**
- Modify: `src/core/Markdown.js`
- Test: `test/markdown.test.js`

**Interfaces:**
- Produces: `mdToBlocks(markdown) -> object[]`

- [x] **Step 1: 失敗するテストを書く**

```javascript
describe('mdToBlocks', () => {
  it('見出しと段落を戻す', () => {
    expect(gas.mdToBlocks('## 第1章\n\n本文です。\n')).toEqual([
      { type: 'heading', level: 2, runs: [run('第1章')] },
      { type: 'paragraph', runs: [run('本文です。')] },
    ]);
  });

  it('複数行の段落を1つにまとめる', () => {
    expect(gas.mdToBlocks('一行目\n二行目\n')).toEqual([
      { type: 'paragraph', runs: [run('一行目 二行目')] },
    ]);
  });

  it('装飾を戻す', () => {
    expect(gas.mdToBlocks('**[規程](https://e.test/)**\n')).toEqual([
      { type: 'paragraph', runs: [run('規程', { bold: true, link: 'https://e.test/' })] },
    ]);
  });

  it('テーブルの区切り行を読み飛ばす', () => {
    expect(gas.mdToBlocks('| 月 | 額 |\n| --- | --- |\n| 1月 | 100 |\n')).toEqual([
      { type: 'table', rows: [[[run('月')], [run('額')]], [[run('1月')], [run('100')]]] },
    ]);
  });

  it('画像を戻す', () => {
    const sha = 'a'.repeat(64);
    expect(gas.mdToBlocks('![図1](sha:' + sha + ')\n')).toEqual([
      { type: 'image', sha: sha, alt: '図1' },
    ]);
  });

  it('エスケープを外す', () => {
    expect(gas.mdToBlocks('2 \\* 3 \\[注] \\|\n')).toEqual([
      { type: 'paragraph', runs: [run('2 * 3 [注] |')] },
    ]);
  });
});

describe('往復', () => {
  const cases = [
    ['見出し', [{ type: 'heading', level: 3, runs: [run('第3条')] }]],
    ['段落', [{ type: 'paragraph', runs: [run('ふつうの文です。')] }]],
    ['装飾', [{ type: 'paragraph', runs: [
      run('太字', { bold: true }), run('と'), run('斜体', { italic: true }),
      run('と'), run('打消', { strike: true }), run('と'),
      run('下線', { underline: true }), run('と'),
      run('リンク', { link: 'https://e.test/a' }),
    ] }]],
    ['入れ子リスト', [
      { type: 'listItem', ordered: false, depth: 0, runs: [run('親')] },
      { type: 'listItem', ordered: false, depth: 1, runs: [run('子')] },
      { type: 'listItem', ordered: true, depth: 0, runs: [run('番号')] },
    ]],
    ['テーブル', [{ type: 'table', rows: [
      [[run('見出しA')], [run('見出しB')]],
      [[run('値1')], [run('値2', { bold: true })]],
    ] }]],
    ['画像', [{ type: 'image', sha: 'b'.repeat(64), alt: '図' }]],
    ['記号を含む文', [{ type: 'paragraph', runs: [run('a * b [c] ~ | <d>')] }]],
  ];

  cases.forEach(([name, blocks]) => {
    it(name + ' が往復する', () => {
      expect(gas.mdToBlocks(gas.blocksToMd(blocks))).toEqual(blocks);
    });
  });

  it('正規化HTMLを経由しても往復する', () => {
    const norm = loadGas('src/core/Normalize.js', 'src/core/Markdown.js');
    const html = '<h2>第1章</h2>\n<p>本文<strong>です</strong>。</p>\n';
    const md = norm.blocksToMd(norm.parseBlocks(html));
    expect(norm.serializeBlocks(norm.mdToBlocks(md))).toBe(html);
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/markdown.test.js`
Expected: FAIL

- [x] **Step 3: インラインの解析を実装する**

```javascript
/**
 * Markdown のインライン記法を Run配列にする。
 *
 * 外側から順に bold → italic → underline → strike → link を剥がす。
 * runsToMd_ と対称にすることで往復が成立する。
 *
 * @param {string} md
 * @returns {object[]}
 */
function mdToRuns_(md) {
  var runs = [];
  var re = /(\*\*|\*|<u>|~~|\[)/;
  var rest = String(md);
  var plain = '';

  function flush() {
    if (plain) { runs.push({ text: unescapeMd_(plain) }); plain = ''; }
  }

  while (rest) {
    // エスケープされた文字はそのまま送る
    if (rest.charAt(0) === '\\' && rest.length > 1) {
      plain += rest.substring(0, 2);
      rest = rest.substring(2);
      continue;
    }

    var m = re.exec(rest);
    if (!m || m.index > 0) {
      var cut = m ? m.index : rest.length;
      plain += rest.substring(0, cut);
      rest = rest.substring(cut);
      if (!m) break;
      continue;
    }

    var parsed = mdTakeDecorated_(rest);
    if (!parsed) {
      plain += rest.charAt(0);
      rest = rest.substring(1);
      continue;
    }
    flush();
    for (var i = 0; i < parsed.runs.length; i++) runs.push(parsed.runs[i]);
    rest = parsed.rest;
  }
  flush();
  return runs;
}

/**
 * 先頭の装飾を1つ剥がし、中身を再帰的に解析する。
 *
 * @param {string} rest
 * @returns {{runs: object[], rest: string}|null} 剥がせなければ null
 */
function mdTakeDecorated_(rest) {
  var forms = [
    { open: '**', close: '**', attr: 'bold' },
    { open: '~~', close: '~~', attr: 'strike' },
    { open: '<u>', close: '</u>', attr: 'underline' },
    { open: '*', close: '*', attr: 'italic' },
  ];

  for (var i = 0; i < forms.length; i++) {
    var f = forms[i];
    if (rest.indexOf(f.open) !== 0) continue;
    var end = rest.indexOf(f.close, f.open.length);
    if (end < 0) continue;

    var inner = rest.substring(f.open.length, end);
    var runs = mdToRuns_(inner);
    for (var r = 0; r < runs.length; r++) runs[r][f.attr] = true;
    return { runs: runs, rest: rest.substring(end + f.close.length) };
  }

  var link = /^\[([\s\S]*?)\]\(([^)]*)\)/.exec(rest);
  if (link) {
    var lruns = mdToRuns_(link[1]);
    for (var k = 0; k < lruns.length; k++) lruns[k].link = link[2];
    return { runs: lruns, rest: rest.substring(link[0].length) };
  }
  return null;
}
```

- [x] **Step 4: ブロックの解析を実装する**

```javascript
/**
 * Markdown を Block配列にする。
 *
 * blocksToMd が出力した形式を対象とする限定パーサである。
 * 汎用の Markdown は扱えないが、その必要はない。
 *
 * @param {string} markdown
 * @returns {object[]}
 */
function mdToBlocks(markdown) {
  var lines = String(markdown == null ? '' : markdown).split('\n');
  var blocks = [];
  var para = [];

  function flushPara() {
    if (!para.length) return;
    blocks.push({ type: 'paragraph', runs: mdToRuns_(para.join(' ')) });
    para = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    if (!line.trim()) { flushPara(); continue; }

    var mh = /^(#{1,6}) ([\s\S]*)$/.exec(line);
    if (mh) {
      flushPara();
      blocks.push({ type: 'heading', level: mh[1].length, runs: mdToRuns_(mh[2]) });
      continue;
    }

    var mi = /^!\[([\s\S]*)\]\(sha:([0-9a-f]{64}|unavailable)\)$/.exec(line);
    if (mi) {
      flushPara();
      blocks.push({ type: 'image', sha: mi[2], alt: unescapeMd_(mi[1]) });
      continue;
    }

    var ml = /^( *)(- |\d+\. )([\s\S]*)$/.exec(line);
    if (ml) {
      flushPara();
      blocks.push({
        type: 'listItem',
        ordered: ml[2] !== '- ',
        depth: Math.floor(ml[1].length / 2),
        runs: mdToRuns_(ml[3]),
      });
      continue;
    }

    if (line.indexOf('|') === 0) {
      flushPara();
      var rows = [];
      while (i < lines.length && lines[i].indexOf('|') === 0) {
        var cells = mdTableRow_(lines[i]);
        if (cells !== null) rows.push(cells);
        i++;
      }
      i--;
      blocks.push({ type: 'table', rows: rows });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/**
 * GFM テーブルの1行をセル配列にする。区切り行なら null を返す。
 *
 * @param {string} line
 * @returns {Array<object[]>|null}
 */
function mdTableRow_(line) {
  var body = line.replace(/^\|/, '').replace(/\|$/, '');
  var parts = body.split('|');
  var cells = [];
  var separator = true;

  for (var i = 0; i < parts.length; i++) {
    var text = parts[i].replace(/^ /, '').replace(/ $/, '');
    if (!/^-{3,}$/.test(text)) separator = false;
    cells.push(mdToRuns_(text));
  }
  return separator ? null : cells;
}
```

- [x] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS。往復テストが落ちる場合は `runsToMd_` と `mdTakeDecorated_` の
順序が対称かを最初に疑うこと

- [x] **Step 6: コミット**

```bash
git add src/core/Markdown.js test/markdown.test.js
git commit -m "feat: MarkdownをBlock配列に戻す"
```

---

## Task 3: 編集API と main のブランチ保護

**Files:**
- Modify: `src/Main.gs`
- Test: `test/phase4-edit.test.js` (新規)

**Interfaces:**
- Consumes: `mdToBlocks` / `blocksToMd` (Task 1-2)
- Produces:
  - `apiGetMarkdown(fileId) -> {markdown:string, branch:string, editable:boolean}`
  - `apiSaveMarkdown(fileId, markdown) -> {ok:true}`
  - `apiStashMainDrift(fileId) -> object` (commits 行)

- [x] **Step 1: 失敗するテストを書く**

`test/phase4-edit.test.js` を新規作成する。SOURCES は
`test/phase3-issues.test.js` と同じものに `'src/core/Markdown.js'` を足す。
`setup()` も同じ形で作る (Docs の入出力を写像に差し替える)。

```javascript
describe('Markdown編集', () => {
  it('mainのファイルは編集できない', () => {
    const { ctx, fileId } = setup();
    expect(ctx.apiGetMarkdown(fileId).editable).toBe(false);
    expect(() => ctx.apiSaveMarkdown(fileId, '# 変更\n'))
      .toThrow(/mainは保護されています/);
  });

  it('mainには直接コミットできない', () => {
    const { ctx, fake, fileId } = setup();
    fake._docs.set(fileId, '<p>直接編集</p>\n');
    expect(() => ctx.apiCommit(fileId, '直接コミット', null))
      .toThrow(/mainは保護されています/);
  });

  it('ブランチのファイルは編集して保存できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);

    expect(ctx.apiGetMarkdown(workFileId).editable).toBe(true);
    ctx.apiSaveMarkdown(workFileId, '# 第1条\n\n新しい本文\n');

    expect(fake._docs.get(workFileId)).toBe('<h1>第1条</h1>\n<p>新しい本文</p>\n');
  });

  it('保存してもコミットはされない', () => {
    const { ctx, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    const before = ctx.headCommit(workFileId, '改訂').sha;

    ctx.apiSaveMarkdown(workFileId, '# 第1条\n\n新しい本文\n');

    expect(ctx.headCommit(workFileId, '改訂').sha).toBe(before);
    expect(ctx.apiFileStatus(workFileId).dirty).toBe(true);
  });

  it('書き戻せない内容は保存しない', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    const before = fake._docs.get(workFileId);

    expect(() => ctx.apiSaveMarkdown(workFileId, '![x](sha:unavailable)\n'))
      .toThrow(/書き戻せません/);
    expect(fake._docs.get(workFileId)).toBe(before);
  });
});

describe('mainの直接編集の退避', () => {
  it('退避するとコミットが残り、mainがcleanになる', () => {
    const { ctx, fake, fileId } = setup();
    fake._docs.set(fileId, '<p>Docsで直接編集した</p>\n');

    const commit = ctx.apiStashMainDrift(fileId);

    expect(commit.message).toContain('直接編集');
    expect(ctx.apiFileStatus(fileId).dirty).toBe(false);
  });

  it('変更が無ければ退避できない', () => {
    const { ctx, fileId } = setup();
    expect(() => ctx.apiStashMainDrift(fileId)).toThrow(/変更がありません/);
  });

  it('退避すればマージまで到達できる', () => {
    const { ctx, fake, fileId } = setup();
    ctx.branchCreate('改訂', fileId);
    const workFileId = ctx.branchWorkingFileId('改訂', fileId);
    fake._docs.set(workFileId, '<p>第1条</p>\n<p>第3条</p>\n');
    ctx.commitFile(workFileId, '改訂', 'ブランチ側', null);

    // mainをDocsで直接編集してしまった状態を作る
    fake._docs.set(fileId, '<p>第1条 (直接編集)</p>\n');

    const pr = ctx.prCreate('第3条を追加', '', '改訂', fileId);
    fake._setUser('reviewer@example.com');
    ctx.prReview(pr.number, 'approve', '');
    fake._setUser('tester@example.com');

    // 退避しないとマージできない
    expect(() => ctx.prMerge(pr.number, ['theirs']))
      .toThrow(/mainに未コミットの変更があります/);

    ctx.apiStashMainDrift(fileId);
    expect(() => ctx.prMerge(pr.number, ['theirs'])).not.toThrow();
  });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase4-edit.test.js`
Expected: FAIL

- [x] **Step 3: 実装する**

`src/Main.gs` の Phase 3b の API 群の後ろに足す。

```javascript
// ===== Phase 4b: 編集と main のブランチ保護 =====

/**
 * mainのファイルに対する人間の直接操作を拒否する。
 *
 * PR経由の書き戻しは prMerge が commitFile / writeHtmlToDoc を直接呼ぶため
 * この検査を通らない。人間の操作だけを止める (GitHub の branch protection)。
 *
 * @param {string} fileId
 */
function assertNotProtected_(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');
  if (branchOfPath_(row.path) !== 'main') return;

  throw new Error(
    'mainは保護されています。ブランチを作って変更し、PRでマージしてください'
  );
}

/**
 * ファイルの内容を Markdown で返す (Web App API)。
 *
 * @param {string} fileId
 * @returns {{markdown:string, branch:string, editable:boolean}}
 */
function apiGetMarkdown(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');

  var branch = branchOfPath_(row.path);
  return {
    markdown: blocksToMd(parseBlocks(liveHtml(fileId))),
    branch: branch,
    editable: branch !== 'main',
  };
}

/**
 * Markdown を文書に書き戻す (Web App API)。コミットはしない。
 *
 * 保存後は「未コミットの変更あり」になる。Docsで編集した場合と挙動を揃える。
 *
 * @param {string} fileId
 * @param {string} markdown
 * @returns {{ok:boolean}}
 */
function apiSaveMarkdown(fileId, markdown) {
  assertNotProtected_(fileId);

  var blocks = mdToBlocks(markdown);
  var problems = htmlWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('書き戻せません:\n' + problems.join('\n'));
  }

  writeHtmlToDoc(fileId, serializeBlocks(blocks));
  liveCacheInvalidate(fileId);
  return { ok: true };
}

/**
 * mainをDocs上で直接編集してしまった分を、専用のコミットとして退避する。
 *
 * mainは保護されているため通常のコミットができない。一方でマージは
 * 未コミットの変更があると拒否される。この2つが噛み合うと行き止まりに
 * なるため、逃げ道をここに1つだけ用意する (spec §5.6)。
 *
 * @param {string} fileId
 * @returns {object} 作成された commits 行
 */
function apiStashMainDrift(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません');
  if (branchOfPath_(row.path) !== 'main') {
    throw new Error('mainのファイルにのみ使えます');
  }
  return commitFile(fileId, 'main', 'mainへの直接編集を退避', null);
}
```

`apiCommit` の先頭に保護を足す。

```javascript
function apiCommit(fileId, message, expectedHeadSha) {
  assertNotProtected_(fileId);
  // 以降は既存のまま
```

- [x] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS。Phase 2/3b の統合テストも全て通ること

- [x] **Step 5: コミット**

```bash
git add src/Main.gs test/phase4-edit.test.js
git commit -m "feat: Markdown編集APIとmainのブランチ保護を追加"
```

---

## Task 4: 編集画面

**Files:**
- Modify: `src/ui/wiki.html`
- Modify: `src/ui/app.js.html`
- Modify: `src/ui/app.css.html`

- [x] **Step 1: 編集パネルを足す**

`wiki.html` のタブに足す。

```html
        <button class="tab" data-tab="edit">編集</button>
```

`panel-content` の直後にパネルを足す。

```html
      <div class="panel panel-col" id="panel-edit" hidden>
        <div class="panel-actions">
          <button id="edit-save-btn" class="btn">保存</button>
          <span class="row-meta" id="edit-hint"></span>
        </div>
        <textarea id="editor" class="editor" spellcheck="false"></textarea>
      </div>
```

- [x] **Step 2: スタイルを足す**

```css
.editor {
  flex: 1;
  width: 100%;
  border: 0;
  padding: 16px 20px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ink);
  background: var(--bg);
  resize: none;
}

.editor:disabled { background: var(--bg-2); color: var(--ink-2); }
```

- [x] **Step 3: 編集の読み書きを足す**

`app.js.html` に足す。`switchTab` に `edit` の分岐を追加すること。

```javascript
  function loadEditor() {
    editorEl.value = '読み込み中…';
    editorEl.disabled = true;
    editSaveBtn.disabled = true;

    google.script.run
      .withSuccessHandler(function (res) {
        editorEl.value = res.markdown;
        editorEl.disabled = !res.editable;
        editSaveBtn.disabled = !res.editable;
        editHint.textContent = res.editable
          ? 'Markdownで編集できます。保存してもコミットはされません'
          : 'mainは保護されています。ブランチを作って編集してください';
      })
      .withFailureHandler(function (err) {
        editorEl.value = '';
        editHint.textContent = 'エラー: ' + err.message;
      })
      .apiGetMarkdown(current.fileId);
  }

  function saveEditor() {
    editSaveBtn.disabled = true;
    editHint.textContent = '保存中…';

    google.script.run
      .withSuccessHandler(function () {
        editSaveBtn.disabled = false;
        editHint.textContent = '保存しました。コミットは「本文」タブから';
        refreshStatus();
      })
      .withFailureHandler(function (err) {
        editSaveBtn.disabled = false;
        editHint.textContent = '';
        window.alert(err.message);
      })
      .apiSaveMarkdown(current.fileId, editorEl.value);
  }
```

- [x] **Step 4: 退避ボタンを足す**

`refreshStatus` の中で、main かつ dirty のときだけ「直接編集を退避」ボタンを
出す。コミットボタンは main では出さない。

```javascript
    var isMain = st.branch === 'main';
    commitBtn.hidden = isMain || !st.dirty;
    stashBtn.hidden = !isMain || !st.dirty;
```

`stashBtn` の処理。

```javascript
  stashBtn.addEventListener('click', function () {
    if (!window.confirm(
      'mainをDocs上で直接編集した分を、退避用のコミットとして記録します。続けますか?'
    )) return;

    google.script.run
      .withSuccessHandler(function () { refreshStatus(); })
      .withFailureHandler(function (err) { window.alert(err.message); })
      .apiStashMainDrift(current.fileId);
  });
```

- [x] **Step 5: push して再デプロイ**

```bash
npx clasp push -f
npx clasp create-deployment -i <既存のデプロイID> -d "Phase 4b: Markdown編集とmain保護"
```

- [ ] **Step 6: Web App で確認**

1. main のファイルを開いて「編集」タブ

Expected: テキストエリアが**無効**で、「mainは保護されています」と出る

2. ブランチを作り、その作業コピーを開いて「編集」タブ

Expected: Markdown が表示され、編集して保存できる。保存後に
「未コミットの変更あり」が出る

3. main の Doc を Google ドキュメントで直接編集して Wiki に戻る

Expected: コミットボタンではなく**「直接編集を退避」**が出る

- [x] **Step 7: コミット**

```bash
git add src/ui/
git commit -m "feat: Markdown編集画面とmain直接編集の退避ボタンを追加"
```

---

## Task 5: 統合検証とドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: この計画書

- [x] **Step 1: 全テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: 実文書で往復を確認**

就業規則の Doc からブランチを作り、編集タブで Markdown を確認する。

Expected: 見出し・リスト・表・装飾が Markdown として読める形で出ている。
**何も編集せずに保存**して、「未コミットの変更あり」が**出ない**こと
(往復で内容が変わっていない証拠になる)

- [x] **Step 3: README を更新**

「現在の状態」に編集と保護の節を足し、ロードマップに Phase 4b を足す。

- [x] **Step 4: 計画書に完了マークを付ける**

- [x] **Step 5: コミット**

```bash
git add README.md docs/
git commit -m "docs: Phase 4b 完了を反映"
```

---

## Phase 4b 完了時に達成されていること

- [ ] `npm test` で Markdown の往復テストを含む全テストが通る
- [ ] ブランチ上の文書をアプリ内で Markdown として編集・保存できる
- [ ] 保存はコミットせず、「未コミットの変更あり」になる
- [ ] 書き戻せない内容 (取得不能な画像) は保存前に拒否される
- [ ] main のファイルは編集も直接コミットもできない
- [ ] main を Docs で直接編集した場合、「直接編集を退避」でのみ記録でき、
      退避すればマージまで到達できる
- [ ] 何も編集せずに保存しても差分が出ない (往復が情報を落としていない)
