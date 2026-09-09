import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { STALE_STEPS, staleLastMoved, stalenessOf } =
  loadGas('src/core/Staleness.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-09T00:00:00Z');

function open(days, extra) {
  return Object.assign({
    state: 'open',
    updatedAt: new Date(NOW.getTime() - days * DAY),
  }, extra || {});
}

describe('staleLastMoved', () => {
  it('updatedAt が無ければ作った日に落とす', () => {
    const at = new Date('2026-08-01T00:00:00Z');
    expect(staleLastMoved({ createdAt: at }).getTime()).toBe(at.getTime());
  });

  it('日時が無ければ null', () => {
    expect(staleLastMoved({})).toBe(null);
    expect(staleLastMoved(null)).toBe(null);
  });
});

describe('stalenessOf', () => {
  it('動いたばかりなら段階は0', () => {
    expect(stalenessOf(open(0), NOW)).toEqual({ days: 0, level: 0 });
  });

  it('境目の手前ではまだ上がらない', () => {
    expect(stalenessOf(open(6), NOW).level).toBe(0);
  });

  it('境目に届くと段階が上がる', () => {
    expect(stalenessOf(open(7), NOW).level).toBe(1);
    expect(stalenessOf(open(14), NOW).level).toBe(2);
    expect(stalenessOf(open(30), NOW).level).toBe(3);
  });

  it('どれだけ放っても最後の段階で止まる', () => {
    expect(stalenessOf(open(999), NOW).level).toBe(STALE_STEPS().length);
  });

  it('完了したものは腐らない', () => {
    expect(stalenessOf(open(99, { state: 'closed' }), NOW))
      .toEqual({ days: 0, level: 0 });
  });

  it('捨てたものは腐らない', () => {
    expect(stalenessOf(open(99, { archivedAt: NOW }), NOW).level).toBe(0);
  });

  it('先の日付でも負の日数にならない', () => {
    expect(stalenessOf(open(-5), NOW).days).toBe(0);
  });

  it('経過日数を返す', () => {
    expect(stalenessOf(open(12), NOW).days).toBe(12);
  });
});
