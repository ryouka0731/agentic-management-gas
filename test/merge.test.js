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

describe('片側の1つの変更が、相手の2つの変更にまたがる', () => {
  /*
   * 重なりを塊1つずつでしか見ていなかったため、相手の2つ目の変更が
   * 食い違いから漏れていた。こちらを選ぶと消したはずの行が戻り、相手を
   * 選ぶと相手が残していた行が消えた。どちらを選んでも黙って壊れる。
   */
  const base = ['A', 'B', 'C', 'D', 'E', 'F'];
  const wide = ['A', 'X', 'F'];                    // B〜E をまとめて書き換えた
  const two = ['A', 'B2', 'C', 'D2', 'E', 'F'];    // B と D を別々に直した

  it('1つの食い違いにまとめる', () => {
    const r = merge3(base, wide, two);

    expect(r.clean).toBe(false);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].ours).toEqual(['X']);
    expect(r.conflicts[0].theirs).toEqual(['B2', 'C', 'D2', 'E']);
  });

  it('こちらを選べば、こちらの中身そのものになる', () => {
    const r = merge3(base, wide, two);
    expect(resolveConflicts(r, ['ours'])).toEqual(wide);
  });

  it('相手を選べば、相手の中身そのものになる', () => {
    const r = merge3(base, wide, two);
    expect(resolveConflicts(r, ['theirs'])).toEqual(two);
  });

  it('向きを入れ替えても同じようにまとまる', () => {
    const r = merge3(base, two, wide);

    expect(r.conflicts).toHaveLength(1);
    expect(resolveConflicts(r, ['ours'])).toEqual(two);
    expect(resolveConflicts(r, ['theirs'])).toEqual(wide);
  });

  it('鎖のようにつながる重なりもまとめる', () => {
    // ours: B〜C と E〜F、theirs: C〜E。3つが1つにつながる
    const b = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const o = ['A', 'b', 'c', 'D', 'e', 'f', 'G'];
    const t = ['A', 'B', 'x', 'y', 'z', 'F', 'G'];
    const r = merge3(b, o, t);

    expect(r.conflicts).toHaveLength(1);
    expect(resolveConflicts(r, ['ours'])).toEqual(o);
    expect(resolveConflicts(r, ['theirs'])).toEqual(t);
  });

  it('重ならない変更はこれまでどおり両方入る', () => {
    const b = ['A', 'B', 'C', 'D', 'E'];
    const r = merge3(b, ['A', 'b', 'C', 'D', 'E'], ['A', 'B', 'C', 'd', 'E']);

    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['A', 'b', 'C', 'd', 'E']);
  });
});

describe('消した行の直前に、相手が足す', () => {
  /*
   * 同じ位置ではこちらを先に処理していたため、こちらが削除・相手が挿入の
   * とき、読み進めた位置が後ろへ戻り、消したはずの行がもう一度写された。
   * 向きを逆にすると起きないので、隠れていた (ランダムな検査で見つけた)。
   */
  const base = ['b0', 'b1', 'b2'];
  const del = ['b0', 'b1'];               // b2 を消した
  const ins = ['b0', 'b1', 'n3', 'b2'];   // b2 の直前に足した

  it('こちらが消し、相手が足す', () => {
    const r = merge3(base, del, ins);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['b0', 'b1', 'n3']);
  });

  it('こちらが足し、相手が消す', () => {
    const r = merge3(base, ins, del);
    expect(r.clean).toBe(true);
    expect(r.lines).toEqual(['b0', 'b1', 'n3']);
  });
});

describe('ランダムな編集で崩れない', () => {
  /*
   * 上の2つの壊れ方は、手で思い付いた例では見つからず、ランダムな編集で
   * 見つかった。決まった種で回して、性質そのものを守る。
   *
   * - 両側が同じ変更なら、食い違わずにその中身になる
   * - 向きを入れ替えても、選んだ側が同じなら同じ結果になる
   */
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const edit = (b) => {
    const o = b.slice();
    const k = 1 + rnd(3);
    for (let i = 0; i < k; i++) {
      const p = rnd(o.length + 1);
      const op = rnd(4);
      if (op === 0) o.splice(p, 0, 'n' + rnd(9));
      else if (op === 1 && o.length) o.splice(p, 1);
      else if (op === 2 && o.length) o[Math.min(p, o.length - 1)] = 'm' + rnd(9);
      else o.splice(p, 1 + rnd(4), 'r' + rnd(9));
    }
    return o;
  };

  it('5000通り', () => {
    let broken = 0;
    for (let t = 0; t < 5000; t++) {
      const base = Array.from({ length: 3 + rnd(8) }, (_, i) => 'b' + i);
      const o = edit(base);
      const th = edit(base);

      const same = merge3(base, o, o);
      if (!same.clean || JSON.stringify(same.lines) !== JSON.stringify(o)) broken++;

      const r = merge3(base, o, th);
      const s = merge3(base, th, o);
      const a = resolveConflicts(r, r.conflicts.map(() => 'theirs'));
      const b = resolveConflicts(s, s.conflicts.map(() => 'ours'));
      if (JSON.stringify(a) !== JSON.stringify(b)) broken++;
    }
    expect(broken).toBe(0);
  });
});
