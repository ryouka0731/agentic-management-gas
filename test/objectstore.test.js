import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

// ObjectStore.gs は repoConfig() を参照するが、関数定義を評価するだけなら
// GAS API は呼ばれない。純粋関数である objectPath_ 単体をテストできる。
const { objectPath_ } = loadGas('src/core/ObjectStore.gs');

const VALID_SHA = 'a'.repeat(64);

describe('objectPath_', () => {
  it('64桁hexのSHAを受け付け、デフォルトで.html拡張子を付ける', () => {
    expect(objectPath_(VALID_SHA)).toBe(VALID_SHA + '.html');
  });

  it('拡張子を指定できる', () => {
    expect(objectPath_(VALID_SHA, 'png')).toBe(VALID_SHA + '.png');
  });

  it("実体を取得できない画像の 'unavailable' を保存先として拒否する", () => {
    // レンダラは取得できない画像に sha='unavailable' を入れる。
    // これが誤って objectPut に渡されても、保存されずエラーになること。
    expect(() => objectPath_('unavailable')).toThrow(/SHAの形式が不正/);
  });

  it('短すぎるSHAを拒否する', () => {
    expect(() => objectPath_('abc123')).toThrow(/SHAの形式が不正/);
  });

  it('大文字を含むSHAを拒否する', () => {
    expect(() => objectPath_('A'.repeat(64))).toThrow(/SHAの形式が不正/);
  });

  it('空の値を拒否する', () => {
    expect(() => objectPath_('')).toThrow(/SHAの形式が不正/);
    expect(() => objectPath_(null)).toThrow(/SHAの形式が不正/);
  });

  it('パス区切りを含む拡張子を拒否する', () => {
    expect(() => objectPath_(VALID_SHA, '../x')).toThrow(/拡張子が不正/);
  });
});
