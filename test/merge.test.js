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

  it('oursの削除とtheirsの隣接追加は独立した変更として両方適用される', () => {
    // base[0..1) の削除と base[1..1) への挿入は区間が重ならないため、
    // 独立した変更として扱う。文書の版管理では誤ってコンフリクトを増やすと
    // 運用が回らないため、重ならない変更は自動マージする方針とする。
    const r = merge3(['a'], [], ['a', 'X']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['X']);
  });

  it('片方だけが末尾に追記した場合は衝突しない', () => {
    const r = merge3(['a'], ['a', 'X'], ['a']);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['a', 'X']);
  });

  it('先頭への挿入を両方が別内容で行うとコンフリクト', () => {
    const r = merge3(['a'], ['X', 'a'], ['Y', 'a']);
    expect(r.clean).toBe(false);
    expect(r.conflicts.length).toBe(1);
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

  it('同じ行への異なる変更はHTMLでもコンフリクトになる', () => {
    const base = '<p>もとの条文</p>\n';
    const ours = '<p>main側の条文</p>\n';
    const theirs = '<p>ブランチ側の条文</p>\n';
    const r = merge3Html(base, ours, theirs);
    expect(r.clean).toBe(false);
    expect(r.conflicts[0].ours).toEqual(['<p>main側の条文</p>']);
    expect(r.conflicts[0].theirs).toEqual(['<p>ブランチ側の条文</p>']);
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

  it('複数コンフリクトを個別に解決できる', () => {
    const r = merge3(
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'X', 'c', 'P', 'e'],
      ['a', 'Y', 'c', 'Q', 'e']
    );
    expect(resolveConflicts(r, ['ours', 'theirs'])).toEqual(
      ['a', 'X', 'c', 'Q', 'e']
    );
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

  it('削除との衝突で theirs を選ぶと追加側が残る', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'c'], ['a', 'X', 'c']);
    expect(resolveConflicts(r, ['theirs'])).toEqual(['a', 'X', 'c']);
  });

  it('削除との衝突で ours を選ぶと削除が維持される', () => {
    const r = merge3(['a', 'b', 'c'], ['a', 'c'], ['a', 'X', 'c']);
    expect(resolveConflicts(r, ['ours'])).toEqual(['a', 'c']);
  });
});
