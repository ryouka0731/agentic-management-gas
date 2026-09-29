import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { plainText, plainDate, plainNumber, plainId, plainTalk } =
  loadGas('src/core/Plain.js');

/*
 * 台帳は人が手で書き換えられる表である。空欄・書き間違い・日付に見えない
 * 字が入り得る。ここを通ったものだけが画面に届くので、入り得る形を
 * すべて受け止めきれているかを固定する。
 */

describe('plainText', () => {
  it('字はそのまま返す', () => {
    expect(plainText('あ')).toBe('あ');
  });

  it('空欄は空文字にする', () => {
    // String(v) を直に呼ぶと 'null' や 'undefined' が画面に出る
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
  });

  it('数や真偽も字にする', () => {
    expect(plainText(0)).toBe('0');
    expect(plainText(false)).toBe('false');
  });
});

describe('plainDate', () => {
  it('Date を ISO の字にする', () => {
    // google.script.run は Date を運べない。混ざると画面には null が届く
    expect(plainDate(new Date('2026-09-29T04:05:06.000Z')))
      .toBe('2026-09-29T04:05:06.000Z');
  });

  it('ISO の字はそのまま通る', () => {
    expect(plainDate('2026-09-29T00:00:00.000Z'))
      .toBe('2026-09-29T00:00:00.000Z');
  });

  it('空欄は空文字にする', () => {
    expect(plainDate('')).toBe('');
    expect(plainDate(null)).toBe('');
    expect(plainDate(undefined)).toBe('');
  });

  it('日付に見えないものは例外にせず空文字にする', () => {
    // 裸の new Date(v).toISOString() は RangeError で落ち、1件の書き間違いで
    // 一覧まるごとが出なくなる
    expect(plainDate('あとで')).toBe('');
    expect(plainDate('2026-13-45')).toBe('');
    expect(plainDate(new Date('x'))).toBe('');
  });

  it('返るのは必ず字である', () => {
    [new Date(), '2026-01-01', '', null, 'あとで'].forEach((v) => {
      expect(typeof plainDate(v)).toBe('string');
    });
  });
});

describe('plainNumber', () => {
  it('数はそのまま返す', () => {
    expect(plainNumber(4)).toBe(4);
    expect(plainNumber('2.5')).toBe(2.5);
  });

  it('0 は空欄と混同しない', () => {
    // 工数の欄では「入れていない」と「0人日」を区別する必要がある
    expect(plainNumber(0)).toBe(0);
    expect(plainNumber('')).toBe('');
  });

  it('空欄と数に見えないものは空文字にする', () => {
    expect(plainNumber(null)).toBe('');
    expect(plainNumber(undefined)).toBe('');
    expect(plainNumber('三')).toBe('');
  });
});

describe('plainId', () => {
  it('番号は必ず数で返す', () => {
    // 読めないまま渡すと画面の '#' + number が 'NaN' になる
    expect(plainId('12')).toBe(12);
    expect(plainId('')).toBe(0);
    expect(plainId(null)).toBe(0);
    expect(plainId('あ')).toBe(0);
  });
});

describe('plainTalk', () => {
  const row = {
    id: 7, issueNumber: 3, body: 'そうしましょう', by: 'a@example.com',
    at: new Date('2026-09-29T01:00:00.000Z'), editedAt: '',
  };

  it('親を指す欄の名前は呼ぶ側が決める', () => {
    // 報告の返信とやることのやりとりで、この欄だけが違う
    expect(plainTalk(row, 'a@example.com', 'issueNumber').issueNumber).toBe(3);
    expect(plainTalk({ ...row, inquiryNumber: 9 }, '', 'inquiryNumber')
      .inquiryNumber).toBe(9);
  });

  it('日時は字にして返す', () => {
    const out = plainTalk(row, '', 'issueNumber');

    expect(out.at).toBe('2026-09-29T01:00:00.000Z');
    expect(out.editedAt).toBe('');
  });

  it('書いた本人だけが直せる', () => {
    expect(plainTalk(row, 'a@example.com', 'issueNumber').canEdit).toBe(true);
    expect(plainTalk(row, 'b@example.com', 'issueNumber').canEdit).toBe(false);
  });

  it('id を持たない古い行は直せない', () => {
    // id を足す前に書かれた行は名指しできない。直そうとすると
    // 「やりとりを指定してください」で止まる
    expect(plainTalk({ ...row, id: '' }, 'a@example.com', 'issueNumber').canEdit)
      .toBe(false);
    expect(plainTalk({ ...row, id: '' }, 'a@example.com', 'issueNumber').id)
      .toBe(0);
  });

  it('Date を1つも残さない', () => {
    const out = plainTalk(row, 'a@example.com', 'issueNumber');

    Object.keys(out).forEach((key) => {
      expect(out[key] instanceof Date, key).toBe(false);
    });
  });
});
