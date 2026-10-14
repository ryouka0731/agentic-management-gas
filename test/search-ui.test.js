import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

const { searchNormalize, searchFilter } = ui(['searchNormalize', 'searchFilter', 'searchRank']);

const I = (kind, number, title, extra) => Object.assign({ kind, number, key: '', title, state: 'open', archived: false }, extra || {});

describe('合わせ方', () => {
  it('全角半角・大文字小文字・カタカナひらがなをそろえる', () => {
    expect(searchNormalize('ＡＢＣ　ｶﾀｶﾅ')).toBe('abc かたかな');
    expect(searchNormalize('カタカナ')).toBe('かたかな');
  });

  it('空白区切りは AND。空白だけなら何も返さない', () => {
    const idx = [I('issue', 1, '就業規則の改定'), I('issue', 2, '就業 細則')];
    expect(searchFilter(idx, '就業 改定')[0].items.map((x) => x.number)).toEqual([1]);
    expect(searchFilter(idx, '   ')).toEqual([]);
  });

  it('番号がぴったりのものを一番上に。#12・12・＃１２ のどれでも', () => {
    const idx = [I('issue', 3, '12月の締め'), I('issue', 12, '賃金規程')];
    ['#12', '12', '＃１２'].forEach((q) => {
      expect(searchFilter(idx, q)[0].items[0].number).toBe(12);
    });
  });

  it('先頭が合うものを途中が合うものより上に。置き場は同じ段の最後', () => {
    const idx = [I('issue', 1, '改定の就業規則'), I('issue', 2, '就業規則の改定'),
      I('issue', 3, '就業規則 古い', { archived: true }), I('issue', 4, '就業規則 新しい')];
    expect(searchFilter(idx, '就業')[0].items.map((x) => x.number)).toEqual([4, 2, 3, 1]);
  });

  it('同じ段では作業中 → 完了、新しい番号から', () => {
    const idx = [I('issue', 1, '規程A', { state: 'closed' }), I('issue', 2, '規程B'), I('issue', 3, '規程C')];
    expect(searchFilter(idx, '規程')[0].items.map((x) => x.number)).toEqual([3, 2, 1]);
  });

  it('種類ごとに5件・全体で20件。種類の並びは決まっている', () => {
    const idx = [];
    ['doc', 'issue', 'pull', 'branch', 'inquiry'].forEach((k) => {
      for (let n = 1; n <= 7; n++) idx.push(I(k, n, '規程' + n, { key: k + n }));
    });
    const out = searchFilter(idx, '規程');
    expect(out.map((g) => g.kind)).toEqual(['doc', 'issue', 'pull', 'branch']);
    expect(out.reduce((s, g) => s + g.items.length, 0)).toBe(20);
    out.forEach((g) => expect(g.items.length).toBeLessThanOrEqual(5));
  });

  it('合った場所を返す (正規化前の題名の位置)', () => {
    const out = searchFilter([I('issue', 1, 'ＡＢＣ規程')], 'abc');
    expect(out[0].items[0].hit).toEqual([0, 3]);
  });
});
