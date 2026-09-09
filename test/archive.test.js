import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { ARCHIVE_KEEP_DAYS, archiveDaysLeft, archiveExpired } =
  loadGas('src/core/Archive.js');

const DAY = 24 * 60 * 60 * 1000;

describe('archiveDaysLeft', () => {
  it('捨てていなければ null', () => {
    expect(archiveDaysLeft('', new Date())).toBe(null);
    expect(archiveDaysLeft(null, new Date())).toBe(null);
  });

  it('捨てた直後は留め置く日数そのもの', () => {
    const now = new Date('2026-09-09T00:00:00Z');
    expect(archiveDaysLeft(now, now)).toBe(ARCHIVE_KEEP_DAYS());
  });

  it('日が進むと減る', () => {
    const at = new Date('2026-09-09T00:00:00Z');
    const now = new Date(at.getTime() + 10 * DAY);
    expect(archiveDaysLeft(at, now, 30)).toBe(20);
  });

  it('端数は切り上げる', () => {
    const at = new Date('2026-09-09T00:00:00Z');
    const now = new Date(at.getTime() + 9.5 * DAY);
    expect(archiveDaysLeft(at, now, 30)).toBe(21);
  });

  it('期限を過ぎたら 0 で止まる', () => {
    const at = new Date('2026-09-09T00:00:00Z');
    const now = new Date(at.getTime() + 99 * DAY);
    expect(archiveDaysLeft(at, now, 30)).toBe(0);
  });

  it('読めない日時は null', () => {
    expect(archiveDaysLeft('なんとか', new Date())).toBe(null);
  });
});

describe('archiveExpired', () => {
  const at = new Date('2026-09-09T00:00:00Z');

  it('期限を過ぎたものだけ返す', () => {
    const rows = [
      { number: 1, archivedAt: at },
      { number: 2, archivedAt: new Date(at.getTime() - 40 * DAY) },
      { number: 3, archivedAt: '' },
    ];
    expect(archiveExpired(rows, at, 30)).toEqual([2]);
  });

  it('ちょうど期限の日は片付ける', () => {
    const rows = [{ number: 9, archivedAt: new Date(at.getTime() - 30 * DAY) }];
    expect(archiveExpired(rows, at, 30)).toEqual([9]);
  });

  it('空でも落ちない', () => {
    expect(archiveExpired(null, at)).toEqual([]);
  });
});
