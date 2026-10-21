import { describe, it, expect } from 'vitest';
import { ui } from './ui-source.js';

/*
 * キャラ作成キットの、画面に依らない計算 (js-oshi)。画面の JS から原文のまま切り出して動かす。
 * 緑の背景を抜くのは ImageData の data (RGBA の並び) を書き換える関数で、node の配列で確かめる。
 */

const f = ui(['oshiKeyGreen', 'oshiSheetCells', 'oshiSheetDefaults', 'oshiSheetClamp']);

/** RGBA の画素を並べた配列 */
const pixels = (...list) => new Uint8ClampedArray(list.flat());

describe('緑の背景を抜く (oshiKeyGreen)', () => {
  it('#00FF00 とその近くの緑はすっかり透明にする。数を返す', () => {
    const data = pixels([0, 255, 0, 255], [20, 230, 30, 255], [60, 200, 50, 255]);
    expect(f.oshiKeyGreen(data)).toBe(3);
    expect([data[3], data[7], data[11]]).toEqual([0, 0, 0]);
  });

  it('緑でない色 (肌・白・黒・暗い緑・黄色) は触らない', () => {
    const before = [[240, 200, 180, 255], [255, 255, 255, 255], [0, 0, 0, 255], [20, 80, 20, 255], [230, 240, 40, 255]];
    const data = pixels(...before);
    expect(f.oshiKeyGreen(data)).toBe(0);
    expect([...data]).toEqual(before.flat());
  });

  it('縁の半端な緑は少しだけ透かし、緑のにじみを落とす (緑の値を赤と青の大きいほうに揃える)', () => {
    const data = pixels([100, 170, 90, 255]);
    expect(f.oshiKeyGreen(data)).toBe(0);
    // 緑の勝ち分は 70 → 255 × (90 − 70) / 50 = 102
    expect(data[3]).toBe(102);
    expect(data[1]).toBe(100);
    expect([data[0], data[2]]).toEqual([100, 90]);
  });

  it('もともと透けている画素は濃くしない', () => {
    const data = pixels([100, 170, 90, 30]);
    f.oshiKeyGreen(data);
    expect(data[3]).toBe(30);
  });
});

describe('1枚の表のマス (oshiSheetCells)', () => {
  it('左上から右へ、行ごとに並べる。4 列 × 3 行なら 12 マス', () => {
    const cells = f.oshiSheetCells(400, 300, 3, 4);
    expect(cells.length).toBe(12);
    expect(cells[0]).toEqual({ index: 0, row: 0, col: 0, x: 0, y: 0, w: 100, h: 100 });
    expect(cells[1]).toMatchObject({ row: 0, col: 1, x: 100, y: 0 });
    expect(cells[4]).toMatchObject({ index: 4, row: 1, col: 0, x: 0, y: 100 });
    expect(cells[11]).toMatchObject({ row: 2, col: 3, x: 300, y: 200, w: 100, h: 100 });
  });

  it('割り切れないときも、隙間も重なりも作らず、幅と高さを使い切る', () => {
    const cells = f.oshiSheetCells(1001, 767, 3, 4);
    for (let r = 0; r < 3; r++) {
      const row = cells.filter((c) => c.row === r);
      expect(row[0].x).toBe(0);
      for (let i = 1; i < row.length; i++) expect(row[i].x).toBe(row[i - 1].x + row[i - 1].w);
      expect(row[row.length - 1].x + row[row.length - 1].w).toBe(1001);
    }
    const col = cells.filter((c) => c.col === 0);
    for (let i = 1; i < col.length; i++) expect(col[i].y).toBe(col[i - 1].y + col[i - 1].h);
    expect(col[col.length - 1].y + col[col.length - 1].h).toBe(767);
  });

  it('列が画像の幅より多い・行が高さより多いときは、幅と高さで止める (0px のマスを作らない)', () => {
    const cells = f.oshiSheetCells(3, 2, 4, 8);
    expect(cells.length).toBe(6);
    expect(cells.every((c) => c.w >= 1 && c.h >= 1)).toBe(true);
  });

  it('行と列は 1 より小さくしない', () => {
    expect(f.oshiSheetCells(10, 10, 0, -2)).toEqual([{ index: 0, row: 0, col: 0, x: 0, y: 0, w: 10, h: 10 }]);
  });
});

describe('マスに当てる表情 (oshiSheetDefaults / oshiSheetClamp)', () => {
  const states = ['idle', 'praise', 'celebrate'].map((key) => ({ key }));

  it('表情の並びの順に当て、余ったマスは「使わない」にする', () => {
    expect(f.oshiSheetDefaults(4, states)).toEqual(['idle', 'praise', 'celebrate', '']);
    expect(f.oshiSheetDefaults(2, states)).toEqual(['idle', 'praise']);
  });

  it('行と列の欄は 1〜8 の整数。読めなければ既定', () => {
    expect(f.oshiSheetClamp('3', 4)).toBe(3);
    expect(f.oshiSheetClamp('20', 4)).toBe(8);
    expect(f.oshiSheetClamp('0', 4)).toBe(4);
    expect(f.oshiSheetClamp('abc', 4)).toBe(4);
    expect(f.oshiSheetClamp('2.7', 4)).toBe(2);
  });
});
