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

  it('全行が一致する長い入力でもequalだけを返す', () => {
    const a = [];
    for (let i = 0; i < 200; i++) a.push('x' + i);
    const result = diffLines(a, a.slice());
    expect(result.length).toBe(200);
    expect(result.every(o => o.type === 'equal')).toBe(true);
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

  it('空のHTMLからの差分はすべてinsertになる', () => {
    expect(diffHtml('', '<p>a</p>\n')).toEqual(ops([['insert', '<p>a</p>']]));
  });
});
