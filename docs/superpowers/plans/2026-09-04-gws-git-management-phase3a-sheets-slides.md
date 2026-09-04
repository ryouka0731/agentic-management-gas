# GWS Git-like 文書管理システム Phase 3a (Sheets / Slides レンダラ) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google Sheets と Google Slides を Docs と同じ正規化 HTML に載せ、Sheets は
マージと書き戻しまで、Slides は閲覧・履歴・diff まで対応させる。

**Architecture:** 正規化 HTML の語彙に `sheet` ブロック (`<table data-sheet="名前">`) と
`slide` ブロック (`<section data-slide="N">`) を足す。既存の Docs 用ブロックには一切触れない
ため、Phase 1/2 で作られたコミットの blob とバイト単位で互換が保たれる。
レンダラは `renderByType_` の分岐で切り替わり、書き戻しも種別ごとに分岐する。

**Tech Stack:** Google Apps Script (V8) / `SpreadsheetApp` / `SlidesApp` / vitest / 疑似GAS (`test/fakegas.js`)

**Spec:** `docs/superpowers/specs/2026-09-02-gws-git-management-design.md` (§2.3 語彙 / §4.1 レンダラ / §5.7 サポート範囲)

## Global Constraints

- GAS 標準サービスのみ。Advanced Google Services / 外部 API は使用不可
- ランタイムコードに `import` / `export` / `require` を書かない。テストは
  `test/harness.js` が `node:vm` で評価する
- **既存の Docs 出力をバイト単位で変えてはならない。** 変えると Phase 1/2 の
  全コミットが差分として浮き、履歴が壊れる。`<table>` / `<td>` の出力形は現状維持
- 正規化 HTML は 1 ブロック = 1 行、末尾に改行あり
- 色・フォント・サイズは版管理の対象外
- Slides はマージ非対応 (§5.7)
- ピュアなロジックは vitest、GAS 依存は `test/fakegas.js` の疑似GASで統合テストする

## spec からの逸脱

spec §5.7 は Slides について「マージはブランチのコピーを直接採用する
fast-forward 置き換えのみ」とするが、**本計画では Slides の PR 作成自体を拒否する**。

理由: 「ブランチのコピーを直接採用する」には main の Slides ファイルをコピーで
置き換える必要があり、fileId が変わる。fileId の維持 (共有リンクが壊れないこと) は
Phase 2 で実機検証済みの中核的な保証であり、種別によって破るべきではない。
Slides は閲覧・履歴・diff のみを提供し、反映は人が Slides 上で行う。

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/core/Normalize.js` (変更) | `sheet` / `slide` ブロックの直列化とパース |
| `src/render/SheetRenderer.gs` (新規) | Sheets → 正規化HTML |
| `src/render/SheetWriter.gs` (新規) | 正規化HTML → Sheets 書き戻しと事前検証 |
| `src/render/SlidesRenderer.gs` (新規) | Slides → 正規化HTML (読み取り専用) |
| `src/render/LiveCache.gs` (変更) | `renderByType_` の分岐 |
| `src/render/HtmlWriter.gs` (変更) | 種別ごとの書き戻し入口 `writeHtmlToFile` |
| `src/core/PullRequest.gs` (変更) | Slides の PR 作成を拒否 |
| `src/ui/app.css.html` (変更) | シート表示とスライド境界のスタイル |
| `test/normalize.test.js` (変更) | `sheet` / `slide` の往復テスト |
| `test/phase3-render.test.js` (新規) | レンダラと書き戻しの統合テスト |

---

## Task 1: Normalize に sheet ブロックを足す

**Files:**
- Modify: `src/core/Normalize.js`
- Test: `test/normalize.test.js`

**Interfaces:**
- Consumes: `escapeAttr` / `escapeText` / `unescapeText` (既存)
- Produces: ブロック型 `{type:'sheet', name:string, rows:Array<Array<{value:string, formula?:string}>>}`。
  直列化形は `<table data-sheet="名前">` / `<tr><td>値</td></tr>` / `</table>`。
  数式のあるセルだけ `<td data-formula="=SUM(A1:A2)">` になる

- [ ] **Step 1: 失敗するテストを書く**

`test/normalize.test.js` の末尾に追記する。

```javascript
describe('sheet ブロック', () => {
  const gas = loadGas('src/core/Normalize.js');

  it('シート名と値を直列化する', () => {
    const html = gas.serializeBlocks([{
      type: 'sheet',
      name: '売上',
      rows: [
        [{ value: '月' }, { value: '金額' }],
        [{ value: '1月' }, { value: '100' }],
      ],
    }]);
    expect(html).toBe(
      '<table data-sheet="売上">\n' +
      '<tr><td>月</td><td>金額</td></tr>\n' +
      '<tr><td>1月</td><td>100</td></tr>\n' +
      '</table>\n'
    );
  });

  it('数式のあるセルだけ data-formula を持つ', () => {
    const html = gas.serializeBlocks([{
      type: 'sheet',
      name: 'Sheet1',
      rows: [[{ value: '300', formula: '=SUM(A1:A2)' }, { value: '固定値' }]],
    }]);
    expect(html).toContain('<td data-formula="=SUM(A1:A2)">300</td>');
    expect(html).toContain('<td>固定値</td>');
  });

  it('往復して同じブロックに戻る', () => {
    const blocks = [{
      type: 'sheet',
      name: '売上 <2026>',
      rows: [
        [{ value: 'A&B' }, { value: '', formula: '=NOW()' }],
        [{ value: '"引用"' }, { value: '普通' }],
      ],
    }];
    expect(gas.parseBlocks(gas.serializeBlocks(blocks))).toEqual(blocks);
  });

  it('Docs の table とは別物として扱う', () => {
    const docTable = '<table>\n<tr><td>あ</td></tr>\n</table>\n';
    const blocks = gas.parseBlocks(docTable);
    expect(blocks[0].type).toBe('table');
    expect(gas.serializeBlocks(blocks)).toBe(docTable);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/normalize.test.js`
Expected: FAIL (`sheet` ブロックが無視され、空文字列が返る)

- [ ] **Step 3: 直列化を実装する**

`serializeBlocks` の `image` 分岐の直後 (`}` の前) に足す。

```javascript
    } else if (b.type === 'sheet') {
      lines.push('<table data-sheet="' + escapeAttr(b.name || '') + '">');
      for (var sr = 0; sr < b.rows.length; sr++) {
        var scells = '';
        for (var sc = 0; sc < b.rows[sr].length; sc++) {
          var cell = b.rows[sr][sc] || {};
          var open = cell.formula
            ? '<td data-formula="' + escapeAttr(cell.formula) + '">'
            : '<td>';
          scells += open + escapeText(cell.value || '') + '</td>';
        }
        lines.push('<tr>' + scells + '</tr>');
      }
      lines.push('</table>');
    }
```

- [ ] **Step 4: パースを実装する**

`parseTableRow_` の直後に足す。

```javascript
/**
 * シート行をセル配列にパースする。
 *
 * Docs の表と違い、セルは装飾を持たない素の文字列と数式である。
 *
 * @param {string} line
 * @returns {Array<{value:string, formula?:string}>}
 */
function parseSheetRow_(line) {
  var cells = [];
  var re = /<td(?: data-formula="([^"]*)")?>([\s\S]*?)<\/td>/g;
  var m;
  while ((m = re.exec(line)) !== null) {
    var cell = { value: unescapeText(m[2]) };
    if (m[1] !== undefined) cell.formula = unescapeText(m[1]);
    cells.push(cell);
  }
  return cells;
}
```

`parseBlocks` の先頭で状態変数を足す。

```javascript
  var table = null;
  var sheet = null;
  var sheetName = '';
```

`if (table !== null) { ... }` ブロックの**直前**に足す。

```javascript
    if (sheet !== null) {
      if (line === '</table>') {
        blocks.push({ type: 'sheet', name: sheetName, rows: sheet });
        sheet = null;
      } else if (line.indexOf('<tr>') === 0) {
        sheet.push(parseSheetRow_(line));
      }
      continue;
    }
```

`if (line === '<table>') { table = []; continue; }` の**直前**に足す。

```javascript
    var ms = /^<table data-sheet="([^"]*)">$/.exec(line);
    if (ms) { sheet = []; sheetName = unescapeText(ms[1]); continue; }
```

末尾の取りこぼし対策 (`if (table !== null) blocks.push(...)`) の隣に足す。

```javascript
  if (sheet !== null) blocks.push({ type: 'sheet', name: sheetName, rows: sheet });
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS (既存 122 件 + 追加 4 件)

- [ ] **Step 6: コミット**

```bash
git add src/core/Normalize.js test/normalize.test.js
git commit -m "feat: 正規化HTMLにsheetブロックを追加"
```

---

## Task 2: Normalize に slide ブロックを足す

**Files:**
- Modify: `src/core/Normalize.js`
- Test: `test/normalize.test.js`

**Interfaces:**
- Produces: ブロック型 `{type:'slide', index:number}`。直列化形は `<section data-slide="3">`。
  スライドの中身は後続の `heading` / `paragraph` ブロックとして並ぶ (境界マーカ方式)

- [ ] **Step 1: 失敗するテストを書く**

```javascript
describe('slide ブロック', () => {
  const gas = loadGas('src/core/Normalize.js');

  it('スライド境界を1行で表す', () => {
    const html = gas.serializeBlocks([
      { type: 'slide', index: 1 },
      { type: 'paragraph', runs: [{ text: 'タイトル' }] },
      { type: 'slide', index: 2 },
    ]);
    expect(html).toBe(
      '<section data-slide="1">\n<p>タイトル</p>\n<section data-slide="2">\n'
    );
  });

  it('往復して同じブロックに戻る', () => {
    const blocks = [
      { type: 'slide', index: 1 },
      { type: 'paragraph', runs: [{ text: '本文' }] },
    ];
    expect(gas.parseBlocks(gas.serializeBlocks(blocks))).toEqual(blocks);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/normalize.test.js`
Expected: FAIL

- [ ] **Step 3: 実装する**

`serializeBlocks` の `sheet` 分岐の直後に足す。

```javascript
    } else if (b.type === 'slide') {
      lines.push('<section data-slide="' + Number(b.index) + '">');
    }
```

`parseBlocks` の `<img ...>` の判定の直後に足す。

```javascript
    var msl = /^<section data-slide="(\d+)">$/.exec(line);
    if (msl) {
      blocks.push({ type: 'slide', index: Number(msl[1]) });
      continue;
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/Normalize.js test/normalize.test.js
git commit -m "feat: 正規化HTMLにslideブロックを追加"
```

---

## Task 3: SheetRenderer.gs — Sheets を正規化HTMLにする

**Files:**
- Create: `src/render/SheetRenderer.gs`
- Test: `test/phase3-render.test.js` (新規)

**Interfaces:**
- Consumes: `serializeBlocks` (Task 1)
- Produces: `renderSheet(fileId) -> string`

- [ ] **Step 1: 疑似GASに SpreadsheetApp のシート走査を足す**

`test/fakegas.js` の `SpreadsheetApp` に `getSheets` を持つシートを作れるようにする。
`makeSheet` の戻り値に以下を足す。

```javascript
      getDataRange: () => ({
        getDisplayValues: () => rows.map((r) => r.map((v) => (v === undefined ? '' : String(v)))),
        getFormulas: () => rows.map((r) => r.map((v) => (String(v).indexOf('=') === 0 ? String(v) : ''))),
      }),
      clear: () => { rows.length = 0; return sheet; },
      getRange: (row, col, numRows, numCols) => ({ /* 既存のまま */ }),
```

`SpreadsheetApp.create` が返すオブジェクトに足す。

```javascript
        getSheets: () => Array.from(sheets.values()),
```

- [ ] **Step 2: 失敗するテストを書く**

`test/phase3-render.test.js` を新規作成する。

```javascript
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Normalize.js',
  'src/render/SheetRenderer.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  return { ctx, fake };
}

describe('renderSheet', () => {
  it('シートごとに table を出し、数式を保持する', () => {
    const { ctx, fake } = setup();
    const ss = ctx.SpreadsheetApp.create('売上表');
    const s = ss.insertSheet('2026年');
    s.appendRow(['月', '金額']);
    s.appendRow(['1月', '=SUM(B1:B1)']);

    const html = ctx.renderSheet(ss.getId());

    expect(html).toContain('<table data-sheet="2026年">');
    expect(html).toContain('<tr><td>月</td><td>金額</td></tr>');
    expect(html).toContain('data-formula="=SUM(B1:B1)"');
  });

  it('同じ内容からは常に同じ HTML が出る', () => {
    const { ctx, fake } = setup();
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['a', 'b']);
    expect(ctx.renderSheet(ss.getId())).toBe(ctx.renderSheet(ss.getId()));
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/phase3-render.test.js`
Expected: FAIL (`renderSheet is not defined`)

- [ ] **Step 4: 実装する**

```javascript
/**
 * Google Sheets を正規化HTMLにする。
 *
 * 表示値 (getDisplayValues) を内容とし、数式は data-formula に退避する。
 * 表示値を使うのは、書式込みの「人が見ている値」を版管理の対象にするため。
 *
 * @param {string} fileId
 * @returns {string} 正規化HTML
 */
function renderSheet(fileId) {
  var ss = SpreadsheetApp.openById(fileId);
  var sheets = ss.getSheets();
  var blocks = [];

  for (var i = 0; i < sheets.length; i++) {
    blocks.push(sheetBlock_(sheets[i]));
  }
  return serializeBlocks(blocks);
}

/**
 * 1シートを sheet ブロックにする。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {object} sheet ブロック
 */
function sheetBlock_(sheet) {
  var range = sheet.getDataRange();
  var values = range.getDisplayValues();
  var formulas = range.getFormulas();
  var rows = [];

  for (var r = 0; r < values.length; r++) {
    var row = [];
    for (var c = 0; c < values[r].length; c++) {
      var cell = { value: String(values[r][c] == null ? '' : values[r][c]) };
      if (formulas[r] && formulas[r][c]) cell.formula = String(formulas[r][c]);
      row.push(cell);
    }
    rows.push(row);
  }

  return { type: 'sheet', name: sheet.getName(), rows: trimTrailingEmptyRows_(rows) };
}

/**
 * 末尾の空行を落とす。空行の増減で差分が出るのを防ぐ。
 *
 * @param {Array<Array<object>>} rows
 * @returns {Array<Array<object>>}
 */
function trimTrailingEmptyRows_(rows) {
  var end = rows.length;
  while (end > 0) {
    var empty = true;
    for (var c = 0; c < rows[end - 1].length; c++) {
      if (rows[end - 1][c].value !== '' || rows[end - 1][c].formula) empty = false;
    }
    if (!empty) break;
    end--;
  }
  return rows.slice(0, end);
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/render/SheetRenderer.gs test/phase3-render.test.js test/fakegas.js
git commit -m "feat: SheetsをレンダリングするSheetRenderer.gsを追加"
```

---

## Task 4: SheetWriter.gs — Sheets への書き戻し

**Files:**
- Create: `src/render/SheetWriter.gs`
- Test: `test/phase3-render.test.js`

**Interfaces:**
- Consumes: `parseBlocks` (Task 1)
- Produces: `sheetWriterValidate(blocks) -> string[]` / `writeHtmlToSheet(fileId, html)`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
describe('writeHtmlToSheet', () => {
  it('書き戻すと同じ HTML が再現される (往復)', () => {
    const { ctx } = setup();
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['月', '金額']);

    const before = ctx.renderSheet(ss.getId());
    ctx.writeHtmlToSheet(ss.getId(), before);
    expect(ctx.renderSheet(ss.getId())).toBe(before);
  });

  it('sheet 以外のブロックが混ざったら書き戻さない', () => {
    const { ctx } = setup();
    const problems = ctx.sheetWriterValidate([{ type: 'paragraph', runs: [] }]);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('Sheetsに書き戻せないブロック');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase3-render.test.js`
Expected: FAIL

- [ ] **Step 3: 実装する**

```javascript
/**
 * Sheets に書き戻せるかを検証する。問題があれば説明文の配列を返す。
 *
 * 書き戻しは sheet.clear() を伴う破壊的操作であるため、
 * 1つでも問題があれば実行前に中断する。
 *
 * @param {object[]} blocks
 * @returns {string[]}
 */
function sheetWriterValidate(blocks) {
  var problems = [];
  var names = {};

  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== 'sheet') {
      problems.push(
        (i + 1) + '行目: Sheetsに書き戻せないブロックです (' + blocks[i].type + ')'
      );
      continue;
    }
    var name = String(blocks[i].name || '');
    if (!name) problems.push((i + 1) + '行目: シート名が空です');
    if (names[name]) problems.push((i + 1) + '行目: シート名が重複しています: ' + name);
    names[name] = true;
  }
  return problems;
}

/**
 * 正規化HTMLを Google Sheets に書き戻す。
 *
 * fileId は変えない。シートは名前で対応付け、HTMLに無いシートは削除する。
 *
 * @param {string} fileId
 * @param {string} html
 */
function writeHtmlToSheet(fileId, html) {
  var blocks = parseBlocks(html);
  var problems = sheetWriterValidate(blocks);
  if (problems.length > 0) {
    throw new Error('Sheetsに書き戻せません:\n' + problems.join('\n'));
  }

  var ss = SpreadsheetApp.openById(fileId);
  var keep = {};

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    keep[block.name] = true;

    var sheet = ss.getSheetByName(block.name) || ss.insertSheet(block.name);
    sheet.clear();
    if (block.rows.length === 0) continue;

    var width = 0;
    for (var r = 0; r < block.rows.length; r++) {
      if (block.rows[r].length > width) width = block.rows[r].length;
    }

    var matrix = [];
    for (var r2 = 0; r2 < block.rows.length; r2++) {
      var line = [];
      for (var c = 0; c < width; c++) {
        var cell = block.rows[r2][c];
        // 数式があれば数式を書く。setValues は '=' 始まりを数式として解釈する
        line.push(cell ? (cell.formula || cell.value) : '');
      }
      matrix.push(line);
    }
    sheet.getRange(1, 1, matrix.length, width).setValues(matrix);
  }

  // HTMLに無くなったシートは削除する。ただし最後の1枚は消せない
  var existing = ss.getSheets();
  for (var e = 0; e < existing.length; e++) {
    if (keep[existing[e].getName()]) continue;
    if (ss.getSheets().length <= 1) break;
    ss.deleteSheet(existing[e]);
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/render/SheetWriter.gs test/phase3-render.test.js
git commit -m "feat: Sheetsへの書き戻しとその事前検証を追加"
```

---

## Task 5: SlidesRenderer.gs — Slides を正規化HTMLにする (読み取り専用)

**Files:**
- Create: `src/render/SlidesRenderer.gs`
- Test: `test/phase3-render.test.js`

**Interfaces:**
- Consumes: `serializeBlocks` (Task 2)
- Produces: `renderSlides(fileId) -> string`

- [ ] **Step 1: 疑似GASに SlidesApp を足す**

`test/fakegas.js` の戻り値に足す。テストからスライドを組み立てられればよい。

```javascript
    SlidesApp: {
      openById: (id) => {
        const pres = presentations.get(id);
        if (!pres) throw new Error('プレゼンテーションが見つかりません: ' + id);
        return pres;
      },
    },
    _createSlides: (name, slideDefs) => {
      // slideDefs: [{ shapes: ['タイトル', '本文'], notes: 'ノート' }, ...]
      const file = makeFile(name, '', rootFolder.getId(),
        'application/vnd.google-apps.presentation');
      presentations.set(file.getId(), {
        getSlides: () => slideDefs.map((d) => ({
          getShapes: () => (d.shapes || []).map((t) => ({
            getText: () => ({ asString: () => t }),
          })),
          getNotesPage: () => ({
            getSpeakerNotesShape: () => (d.notes
              ? { getText: () => ({ asString: () => d.notes }) }
              : null),
          }),
        })),
      });
      return file.getId();
    },
```

`createFakeGas` の先頭に `const presentations = new Map();` を足す。

- [ ] **Step 2: 失敗するテストを書く**

```javascript
describe('renderSlides', () => {
  it('スライド境界・本文・スピーカーノートを出す', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, 'src/core/Normalize.js', 'src/render/SlidesRenderer.gs');
    const id = fake._createSlides('提案書', [
      { shapes: ['表紙', '2026年度方針'], notes: '30秒で話す' },
      { shapes: ['目次'] },
    ]);

    const html = ctx.renderSlides(id);

    expect(html).toContain('<section data-slide="1">');
    expect(html).toContain('<p>表紙</p>');
    expect(html).toContain('<p>2026年度方針</p>');
    expect(html).toContain('<p>ノート: 30秒で話す</p>');
    expect(html).toContain('<section data-slide="2">');
  });

  it('空のシェイプは出力しない', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, 'src/core/Normalize.js', 'src/render/SlidesRenderer.gs');
    const id = fake._createSlides('提案書', [{ shapes: ['', '本文'] }]);
    expect(ctx.renderSlides(id)).toBe('<section data-slide="1">\n<p>本文</p>\n');
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/phase3-render.test.js`
Expected: FAIL

- [ ] **Step 4: 実装する**

```javascript
/**
 * Google Slides を正規化HTMLにする (読み取り専用)。
 *
 * 図形の座標・サイズ・レイアウトマスタは HTML から復元できないため、
 * テキストとスピーカーノートだけを版管理の対象とする。
 * 書き戻しは提供しない (spec §5.7)。
 *
 * @param {string} fileId
 * @returns {string} 正規化HTML
 */
function renderSlides(fileId) {
  var slides = SlidesApp.openById(fileId).getSlides();
  var blocks = [];

  for (var i = 0; i < slides.length; i++) {
    blocks.push({ type: 'slide', index: i + 1 });

    var shapes = slides[i].getShapes();
    for (var s = 0; s < shapes.length; s++) {
      var text = slideShapeText_(shapes[s]);
      if (text) blocks.push({ type: 'paragraph', runs: [{ text: text }] });
    }

    var notes = slideNotes_(slides[i]);
    if (notes) blocks.push({ type: 'paragraph', runs: [{ text: 'ノート: ' + notes }] });
  }
  return serializeBlocks(blocks);
}

/**
 * シェイプのテキストを取り出す。取れない種類は空文字を返す。
 *
 * @param {GoogleAppsScript.Slides.Shape} shape
 * @returns {string}
 */
function slideShapeText_(shape) {
  try {
    return normalizeSpace(shape.getText().asString());
  } catch (e) {
    return '';
  }
}

/**
 * スピーカーノートを取り出す。無ければ空文字を返す。
 *
 * @param {GoogleAppsScript.Slides.Slide} slide
 * @returns {string}
 */
function slideNotes_(slide) {
  try {
    var shape = slide.getNotesPage().getSpeakerNotesShape();
    return shape ? normalizeSpace(shape.getText().asString()) : '';
  } catch (e) {
    return '';
  }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/render/SlidesRenderer.gs test/phase3-render.test.js test/fakegas.js
git commit -m "feat: Slidesを読み取り専用でレンダリングする"
```

---

## Task 6: 種別ごとのレンダリングと書き戻しの分岐

**Files:**
- Modify: `src/render/LiveCache.gs:90-95` (`renderByType_`)
- Modify: `src/render/HtmlWriter.gs` (末尾に `writeHtmlToFile` を追加)
- Modify: `src/core/PullRequest.gs` (`prMerge` の書き戻し呼び出し)
- Test: `test/phase3-render.test.js`

**Interfaces:**
- Consumes: `renderSheet` (Task 3) / `renderSlides` (Task 5) / `writeHtmlToSheet` (Task 4)
- Produces: `writeHtmlToFile(fileId, html, type)`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
describe('種別ごとの分岐', () => {
  it('slide には書き戻せない', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake,
      'src/core/Normalize.js', 'src/render/SheetWriter.gs', 'src/render/HtmlWriter.gs');
    expect(() => ctx.writeHtmlToFile('x', '', 'slide'))
      .toThrow(/Slidesには書き戻せません/);
  });

  it('未知の種別は明示的に拒否する', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake,
      'src/core/Normalize.js', 'src/render/SheetWriter.gs', 'src/render/HtmlWriter.gs');
    expect(() => ctx.writeHtmlToFile('x', '', 'pdf'))
      .toThrow(/対応していないファイル種別/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase3-render.test.js`
Expected: FAIL

- [ ] **Step 3: `renderByType_` を広げる**

`src/render/LiveCache.gs` の該当関数を置き換える。

```javascript
function renderByType_(fileId, type) {
  if (type === 'doc') return renderDoc(fileId);
  if (type === 'sheet') return renderSheet(fileId);
  if (type === 'slide') return renderSlides(fileId);
  throw new Error('このファイル種別はまだ対応していません: ' + type);
}
```

- [ ] **Step 4: `writeHtmlToFile` を足す**

`src/render/HtmlWriter.gs` の末尾に足す。

```javascript
/**
 * ファイル種別に応じて書き戻し先を選ぶ。
 *
 * Slides は図形の座標やレイアウトを HTML から復元できないため、
 * 書き戻し自体を提供しない (spec §5.7)。
 *
 * @param {string} fileId
 * @param {string} html
 * @param {string} type 'doc' | 'sheet' | 'slide'
 */
function writeHtmlToFile(fileId, html, type) {
  if (type === 'doc') return writeHtmlToDoc(fileId, html);
  if (type === 'sheet') return writeHtmlToSheet(fileId, html);
  if (type === 'slide') {
    throw new Error(
      'Slidesには書き戻せません。図形の座標やレイアウトを復元できないためです'
    );
  }
  throw new Error('対応していないファイル種別です: ' + type);
}
```

- [ ] **Step 5: `prMerge` を分岐経由にする**

`src/core/PullRequest.gs` の `writeHtmlToDoc(mainFileId, mergedHtml);` を置き換える。

```javascript
    var targetRow = dbFindOne('files', 'fileId', mainFileId);
    writeHtmlToFile(mainFileId, mergedHtml, targetRow ? targetRow.type : 'doc');
```

同じく検証も種別で切り替える。`htmlWriterValidate(parseBlocks(mergedHtml))` を置き換える。

```javascript
    var mergedBlocks = parseBlocks(mergedHtml);
    var problems = (targetRow && targetRow.type === 'sheet')
      ? sheetWriterValidate(mergedBlocks)
      : htmlWriterValidate(mergedBlocks);
```

> `targetRow` は上の検証ブロックより前で引く必要がある。`prTargetFileId_` で
> `targetFileId` を得た直後に `var targetRow = dbFindOne('files', 'fileId', targetFileId);`
> を置き、以降はそれを使う。

- [ ] **Step 6: Slides の PR 作成を拒否する**

`src/core/PullRequest.gs` の `prCreate` で、対象ファイルの存在確認の直後に足す。

```javascript
  var targetRow = dbFindOne('files', 'fileId', mainFileId);
  if (!targetRow) throw new Error('対象ファイルが管理対象にありません');
  if (String(targetRow.type) === 'slide') {
    throw new Error(
      'Slidesはマージに対応していません。履歴とdiffは見られますが、' +
      '反映はSlides上で直接行ってください'
    );
  }
```

既存の `if (!dbFindOne('files', 'fileId', mainFileId)) { ... }` は上に置き換わるため削除する。

- [ ] **Step 7: テストが通ることを確認**

Run: `npm test`
Expected: PASS (Phase 2 の統合テストも全て通ること。通らなければ `targetRow` の
参照位置を見直す)

- [ ] **Step 8: コミット**

```bash
git add src/render/LiveCache.gs src/render/HtmlWriter.gs src/core/PullRequest.gs test/phase3-render.test.js
git commit -m "feat: ファイル種別ごとにレンダリングと書き戻しを分岐する"
```

---

## Task 7: UI — シートとスライドの表示

**Files:**
- Modify: `src/ui/app.css.html`
- Modify: `src/ui/app.js.html` (ファイル一覧の種別バッジ)

**Interfaces:**
- Consumes: `apiListFiles` の `type` (既存)

- [ ] **Step 1: シートとスライドのスタイルを足す**

`src/ui/app.css.html` の `.conflict-*` 定義の前に足す。既存のデザイントークン
(`--ink` / `--ink-2` / `--line`) を使い、未定義変数 + フォールバックの形は使わない。

```css
    .viewer-body table[data-sheet] {
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 13px;
    }

    .viewer-body table[data-sheet] td {
      border: 1px solid var(--line);
      padding: 4px 8px;
      white-space: nowrap;
    }

    .viewer-body td[data-formula] {
      background: #f8fafc;
      color: var(--ink-2);
    }

    .viewer-body section[data-slide] {
      border-top: 2px solid var(--line);
      margin-top: 16px;
      padding-top: 8px;
      font-size: 11px;
      color: var(--ink-2);
    }

    .viewer-body section[data-slide]::before {
      content: 'スライド ' attr(data-slide);
    }
```

> レンダリング結果は `<iframe sandbox>` の中に入るため、これらのスタイルは
> iframe に注入している側の CSS に足すこと。`renderIntoViewer` が
> どの CSS を注入しているかを `src/ui/app.js.html` で確認してから置く。

- [ ] **Step 2: ファイル一覧に種別バッジを出す**

`src/ui/app.js.html` の `renderFileList` で、行の `path` の後ろに足す。

```javascript
      var badge = document.createElement('span');
      badge.className = 'chip';
      badge.textContent = { doc: 'Doc', sheet: 'Sheet', slide: 'Slides' }[f.type] || f.type;
      row.appendChild(badge);
```

- [ ] **Step 3: push して再デプロイ**

```bash
npx clasp push -f
npx clasp create-deployment -i <既存のデプロイID> -d "Phase 3a: Sheets/Slides"
```

- [ ] **Step 4: Web App で目視確認**

1. Sheets を1つ `agentic-management/main/` に置き、`DEBUG_FILE_ID` を設定して
   `debugRegisterFile()` を実行する
2. Wiki で開く

Expected: シートごとに表が出て、数式セルが淡い背景で区別できる

3. Slides を同様に登録して開く

Expected: スライド境界に「スライド N」の見出しが出て、本文とノートが並ぶ
4. Slides でブランチを作り PR を作ろうとする

Expected: **「Slidesはマージに対応していません」** で拒否される

- [ ] **Step 5: コミット**

```bash
git add src/ui/
git commit -m "feat: シートとスライドの表示を整える"
```

---

## Task 8: 統合検証とドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-04-gws-git-management-phase3a-sheets-slides.md`

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Sheets のマージを実機で確認**

1. Sheets のブランチを作る
2. ブランチ側と main 側で**別々のセル**を書き換えてコミットする
3. PR を作ってマージする

Expected: 両方の変更が入った状態で main の Sheets が更新され、**fileId が変わらない**

- [ ] **Step 3: Sheets のコンフリクトを確認**

同じセルを両側で別の値にしてコミットし、PR を開く。

Expected: 該当行がコンフリクトとして赤枠で表示される

- [ ] **Step 4: README を更新**

制約の記述を差し替える。

```markdown
- Google Docs / Sheets に対応。Slides は閲覧・履歴・diff のみ (マージ非対応)
```

ロードマップの Phase 3 行を「Sheets / Slides レンダラ 完了 / Issue・Projects 未着手」に更新する。

- [ ] **Step 5: 計画書に完了マークを付ける**

全チェックボックスが `- [x]` になっていることを確認し、ヘッダに完了ステータスを追記する。

- [ ] **Step 6: コミット**

```bash
git add README.md docs/
git commit -m "docs: Phase 3a 完了を反映"
```

---

## Phase 3a 完了時に達成されていること

- [ ] `npm test` で sheet / slide の往復テストを含む全テストが通る
- [ ] Sheets を Wiki で閲覧でき、シートごとに表として表示される
- [ ] Sheets の数式が `data-formula` に保持され、書き戻しで復元される
- [ ] Sheets に対して commit / branch / PR / merge / 書き戻しができる
- [ ] Sheets の書き戻しで **fileId が維持される**
- [ ] Slides を Wiki で閲覧でき、スライド境界とスピーカーノートが見える
- [ ] Slides の PR 作成は明示的なメッセージとともに拒否される
- [ ] 既存の Docs の出力はバイト単位で変わっていない (Phase 1/2 の履歴が壊れない)
