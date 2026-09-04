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
