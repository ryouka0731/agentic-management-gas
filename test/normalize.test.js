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

  it('全角スペースも空白として正規化する', () => {
    // JSの \s は U+3000 にマッチする。日本語文書の全角字下げは
    // 意図的に失われる (書式であって内容ではないため)
    expect(normalizeSpace('　第1条　目的　')).toBe('第1条 目的');
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

  it('リンク内の下線を落とす', () => {
    // Docsはリンクに既定で下線を付けるため、下線は著者が指定した書式ではない。
    // 落とさないと全リンクに <u> が付き、差分ノイズの原因になる。
    expect(mergeRuns([run('x', { underline: true, link: 'https://example.com' })]))
      .toEqual([run('x', { link: 'https://example.com' })]);
  });

  it('リンクでない下線は保持する', () => {
    expect(mergeRuns([run('x', { underline: true })]))
      .toEqual([run('x', { underline: true })]);
  });

  it('下線の有無だけが違うリンクRunは結合される', () => {
    // 下線が落ちた結果、属性が同一になるため結合される
    const input = [
      run('a', { underline: true, link: 'https://example.com' }),
      run('b', { link: 'https://example.com' }),
    ];
    expect(mergeRuns(input)).toEqual([run('ab', { link: 'https://example.com' })]);
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

  it('装飾をbold→italic→underline→strikeの固定順でネストする', () => {
    const blocks = [{
      type: 'paragraph',
      runs: [run('x', {
        bold: true, italic: true, underline: true, strike: true,
      })],
    }];
    expect(serializeBlocks(blocks)).toBe(
      '<p><strong><em><u><s>x</s></u></em></strong></p>\n'
    );
  });

  it('リンクは最も内側に置く', () => {
    const blocks = [{
      type: 'paragraph',
      runs: [run('x', { bold: true, strike: true, link: 'https://example.com' })],
    }];
    expect(serializeBlocks(blocks)).toBe(
      '<p><strong><s><a href="https://example.com">x</a></s></strong></p>\n'
    );
  });

  it('リンクに下線を出力しない', () => {
    const blocks = [{
      type: 'paragraph',
      runs: [run('社内ポータル', { underline: true, link: 'https://example.com' })],
    }];
    expect(serializeBlocks(blocks)).toBe(
      '<p><a href="https://example.com">社内ポータル</a></p>\n'
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

  it('空の段落は出力しない', () => {
    // Docs上の空行は書式であって内容ではない。空行を1つ足しただけで
    // 差分が出るのを防ぐため、正規化の段階で落とす。
    expect(serializeBlocks([{ type: 'paragraph', runs: [] }])).toBe('');
  });

  it('空白のみの段落も出力しない', () => {
    expect(serializeBlocks([{ type: 'paragraph', runs: [run('   ')] }])).toBe('');
  });

  it('ブロックの間にある空段落を除去する', () => {
    const blocks = [
      { type: 'heading', level: 1, runs: [run('A')] },
      { type: 'paragraph', runs: [] },
      { type: 'paragraph', runs: [run('B')] },
      { type: 'paragraph', runs: [] },
    ];
    expect(serializeBlocks(blocks)).toBe('<h1>A</h1>\n<p>B</p>\n');
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
      name: 'リンクを含まない全装飾',
      blocks: [{
        type: 'paragraph',
        runs: [{
          text: 'x', bold: true, italic: true, underline: true, strike: true,
        }],
      }],
    },
    {
      // 下線はリンクに対して正規化で落とされるため、ここには含めない
      name: 'リンクと装飾',
      blocks: [{
        type: 'paragraph',
        runs: [{
          text: 'x', bold: true, italic: true, strike: true,
          link: 'https://example.com',
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
      // Driveから削除された画像・リンク切れ画像では getBlob() が失敗し、
      // バイト列が取得できない。その場合 sha に 'unavailable' を入れる。
      // SHAは常に64桁hexなので、この値が実SHAと衝突することはない。
      name: '実体を取得できない画像',
      blocks: [{ type: 'image', sha: 'unavailable', alt: '組織図' }],
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

  it('正規化で落ちる要素を含む入力でも2回目以降は安定する(冪等性)', () => {
    // 空段落とリンク下線は正規化で落ちるため parse(serialize(x)) === x は
    // 成立しない。正規化に求められるのは可逆性ではなく冪等性である。
    const blocks = [
      { type: 'paragraph', runs: [] },
      { type: 'paragraph', runs: [{ text: 'x', underline: true, link: 'https://e.example' }] },
    ];
    const once = serializeBlocks(blocks);
    expect(once).toBe('<p><a href="https://e.example">x</a></p>\n');
    expect(serializeBlocks(parseBlocks(once))).toBe(once);
  });
});

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

  it('セル内の改行を正規化し、1ブロック=1行を保つ', () => {
    // Sheets のセルは Alt+Enter で改行を含められる。そのまま出すと
    // <tr> が複数行に割れ、行ベース diff とパースが壊れる
    const html = gas.serializeBlocks([{
      type: 'sheet',
      name: 'S',
      rows: [[{ value: '1行目\n2行目' }]],
    }]);
    expect(html).toBe('<table data-sheet="S">\n<tr><td>1行目 2行目</td></tr>\n</table>\n');
  });
});

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
