import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/Graph.js');

function c(sha, parentSha, at) {
  return { sha: sha, parentSha: parentSha || '', message: sha, author: 'a', timestamp: at };
}

describe('commitGraph', () => {
  it('1本のブランチは全て同じレーンに並ぶ', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('c2', 'c1', 3), c('c1', '', 1)] },
    ]);

    expect(rows.map((r) => r.sha)).toEqual(['c2', 'c1']);
    expect(rows.map((r) => r.lane)).toEqual([0, 0]);
    expect(rows[0].fork).toBe(false);
  });

  it('新しい順に並べる', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('old', '', 1), c('new', 'old', 5)] },
    ]);
    expect(rows.map((r) => r.sha)).toEqual(['new', 'old']);
  });

  it('ブランチは別のレーンに置かれる', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m2', 'm1', 2), c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b2', 'b1', 5), c('b1', '', 3)] },
    ]);

    const lane = {};
    rows.forEach(function (r) { lane[r.sha] = r.lane; });

    expect(lane.m1).toBe(0);
    expect(lane.m2).toBe(0);
    expect(lane.b1).toBe(1);
    expect(lane.b2).toBe(1);
  });

  it('合流の印は分岐元のコミットに付く', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b2', 'b1', 5), c('b1', '', 3)] },
    ]);

    const at = {};
    rows.forEach(function (r) { at[r.sha] = r; });

    // 枝の最も古いコミットに描くと、行き先のレーンがその行にまだ
    // 無いため線が宙に浮く。寄せ先の点がある行に描く
    expect(at.m1.fork).toBe(true);
    expect(at.m1.forkFrom).toEqual([1]);
    expect(at.b1.fork).toBe(false);
    expect(at.b1.forkFrom).toEqual([]);
  });

  it('同じコミットから枝が2本出ても両方が合流する', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m1', '', 1)] },
      { name: '改訂A', baseSha: 'm1', commits: [c('a1', '', 3)] },
      { name: '改訂B', baseSha: 'm1', commits: [c('b1', '', 4)] },
    ]);

    const m1 = rows.filter(function (r) { return r.sha === 'm1'; })[0];
    expect(m1.forkFrom.slice().sort()).toEqual([1, 2]);
  });

  it('枝のレーンは分岐元の行の手前で止まる', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m2', 'm1', 6), c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b1', '', 3)] },
    ]);

    // 並びは m2(6) / b1(3) / m1(1)
    expect(rows.map((r) => r.sha)).toEqual(['m2', 'b1', 'm1']);
    // 枝は自分の最も新しい記録より上には伸びない
    expect(rows[0].activeLanes).toEqual([0]);
    expect(rows[1].activeLanes).toContain(1);

    // 分岐元の行では縦線ではなく曲線で寄せる。両方描くと二重になる
    expect(rows[2].activeLanes).not.toContain(1);
    expect(rows[2].forkFrom).toEqual([1]);
  });

  it('合流の行き先のレーンは必ずその行で走っている', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m2', 'm1', 6), c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b2', 'b1', 5), c('b1', '', 3)] },
    ]);

    rows.forEach(function (r) {
      if (!r.fork) return;
      // 寄せ先の点がある行なので、その行のレーンが走っていなければ
      // 線がどこにも繋がらない
      expect(r.activeLanes).toContain(r.lane);
    });
  });

  it('マージコミットを見分ける', () => {
    const rows = gas.commitGraph([
      {
        name: 'main',
        baseSha: '',
        commits: [
          { sha: 'm2', parentSha: 'm1', message: 'マージ: PR #1 改訂', author: 'a', timestamp: 9 },
          c('m1', '', 1),
        ],
      },
    ]);
    expect(rows[0].merge).toBe(true);
    expect(rows[1].merge).toBe(false);
  });

  it('レーンの総数を返す', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m1', '', 1)] },
      { name: 'a', baseSha: 'm1', commits: [c('a1', '', 2)] },
      { name: 'b', baseSha: 'm1', commits: [c('b1', '', 3)] },
    ]);
    expect(gas.graphLaneCount(rows)).toBe(3);
  });

  it('空でも落ちない', () => {
    expect(gas.commitGraph([])).toEqual([]);
    expect(gas.graphLaneCount([])).toBe(1);
  });
});

describe('差分の起点', () => {
  it('ふつうの記録は1つ前を起点にする', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('c2', 'c1', 3), c('c1', '', 1)] },
    ]);
    expect(rows[0].diffFrom).toBe('c1');
  });

  it('分岐の最初の記録は分岐元を起点にする', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b1', '', 3)] },
    ]);

    // 親が無いまま差分を取ると全文が「追加」になってしまう
    const b1 = rows.filter((r) => r.sha === 'b1')[0];
    expect(b1.diffFrom).toBe('m1');
  });
});
