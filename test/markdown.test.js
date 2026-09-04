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

  it('空の段落は出力しない', () => {
    expect(gas.blocksToMd([{ type: 'paragraph', runs: [] }])).toBe('');
  });
});

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

  it('入れ子リストの深さを2スペース単位で読む', () => {
    expect(gas.mdToBlocks('- 親\n  - 子\n')).toEqual([
      { type: 'listItem', ordered: false, depth: 0, runs: [run('親')] },
      { type: 'listItem', ordered: false, depth: 1, runs: [run('子')] },
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
    ['見出しに見える段落', [{ type: 'paragraph', runs: [run('# これは段落')] }]],
  ];

  cases.forEach(([name, blocks]) => {
    it(name + ' が往復する', () => {
      expect(gas.mdToBlocks(gas.blocksToMd(blocks))).toEqual(blocks);
    });
  });

  it('正規化HTMLを経由しても往復する', () => {
    const norm = loadGas('src/core/Normalize.js', 'src/core/Markdown.js');
    const html = '<h2>第1章</h2>\n<p>本文<strong>です</strong>。</p>\n' +
      '<li data-list="ul" data-depth="0">項目</li>\n';
    const md = norm.blocksToMd(norm.parseBlocks(html));
    expect(norm.serializeBlocks(norm.mdToBlocks(md))).toBe(html);
  });
});
