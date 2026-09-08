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

  it('分岐した最初のコミットに fork の印が付く', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b2', 'b1', 5), c('b1', '', 3)] },
    ]);

    const b1 = rows.filter(function (r) { return r.sha === 'b1'; })[0];
    expect(b1.fork).toBe(true);
    expect(b1.forkLane).toBe(0);
  });

  it('分岐点から枝の先頭までレーンが通っている', () => {
    const rows = gas.commitGraph([
      { name: 'main', baseSha: '', commits: [c('m2', 'm1', 6), c('m1', '', 1)] },
      { name: '改訂', baseSha: 'm1', commits: [c('b1', '', 3)] },
    ]);

    // 並びは m2(6) / b1(3) / m1(1)。m2 の行でも枝のレーンは走っている
    expect(rows.map((r) => r.sha)).toEqual(['m2', 'b1', 'm1']);
    expect(rows[0].activeLanes).toContain(0);
    expect(rows[1].activeLanes).toContain(1);
    expect(rows[2].activeLanes).toContain(1);
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
