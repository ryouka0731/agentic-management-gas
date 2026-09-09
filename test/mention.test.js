import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { mentionMatch, mentionResolve, mentionSegments } =
  loadGas('src/core/Mention.js');

const KNOWN = ['aoki@example.com', 'ito@example.com', 'aoki@other.example.com'];

describe('mentionMatch', () => {
  it('メールアドレスをそのまま指せる', () => {
    expect(mentionMatch('ito@example.com', KNOWN)).toBe('ito@example.com');
  });

  it('名前だけでも指せる', () => {
    expect(mentionMatch('ito', KNOWN)).toBe('ito@example.com');
  });

  it('大文字小文字は区別しない', () => {
    expect(mentionMatch('ITO@Example.com', KNOWN)).toBe('ito@example.com');
  });

  it('同じ名前が2人いたら先の人になる', () => {
    expect(mentionMatch('aoki', KNOWN)).toBe('aoki@example.com');
  });

  it('名簿に無ければ空', () => {
    expect(mentionMatch('dare', KNOWN)).toBe('');
    expect(mentionMatch('', KNOWN)).toBe('');
  });
});

describe('mentionResolve', () => {
  it('呼ばれた人を返す', () => {
    expect(mentionResolve('@ito これお願い', KNOWN)).toEqual(['ito@example.com']);
  });

  it('複数でも重複は除く', () => {
    const text = '@ito と @aoki@example.com、あと @ito';
    expect(mentionResolve(text, KNOWN))
      .toEqual(['ito@example.com', 'aoki@example.com']);
  });

  it('名簿に無い呼び出しは無視する', () => {
    expect(mentionResolve('@dareka おねがい', KNOWN)).toEqual([]);
  });

  it('メールアドレスの一部を誤って拾わない', () => {
    // 「@」で始まっていないものは呼び出しではない
    expect(mentionResolve('連絡先は ito@example.com です', KNOWN))
      .toEqual([]);
  });

  it('空文でも落ちない', () => {
    expect(mentionResolve('', KNOWN)).toEqual([]);
    expect(mentionResolve(null, KNOWN)).toEqual([]);
  });
});

describe('mentionSegments', () => {
  it('呼び出しの場所を切り出す', () => {
    expect(mentionSegments('やあ @ito よろしく', KNOWN)).toEqual([
      { text: 'やあ ', mention: '' },
      { text: '@ito', mention: 'ito@example.com' },
      { text: ' よろしく', mention: '' },
    ]);
  });

  it('呼び出しが無ければ丸ごと1つ', () => {
    expect(mentionSegments('ふつうの文', KNOWN))
      .toEqual([{ text: 'ふつうの文', mention: '' }]);
  });

  it('名簿に無い呼び出しは普通の字のまま', () => {
    expect(mentionSegments('@dareka です', KNOWN))
      .toEqual([{ text: '@dareka です', mention: '' }]);
  });

  it('先頭と末尾の呼び出しも切り出す', () => {
    expect(mentionSegments('@ito', KNOWN))
      .toEqual([{ text: '@ito', mention: 'ito@example.com' }]);
  });

  it('切り出した字を繋ぐと元に戻る', () => {
    const text = '@ito と @aoki、それから @dareka';
    const joined = mentionSegments(text, KNOWN)
      .map((s) => s.text).join('');

    expect(joined).toBe(text);
  });
});
