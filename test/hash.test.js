import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { bytesToHex } = loadGas('src/core/Hash.js');

describe('bytesToHex', () => {
  it('正のバイトを2桁hexに変換する', () => {
    expect(bytesToHex([0, 1, 15, 16, 127])).toBe('00010f107f');
  });

  it('GASが返す負のバイト(-128..-1)を正しく変換する', () => {
    // Utilities.computeDigest は符号付きバイトを返すため、
    // -1 は 0xff、-128 は 0x80 として扱う必要がある
    expect(bytesToHex([-1, -128, -16])).toBe('ff80f0');
  });

  it('空配列は空文字列になる', () => {
    expect(bytesToHex([])).toBe('');
  });

  it('32バイト入力から64文字を返す', () => {
    const bytes = new Array(32).fill(0);
    expect(bytesToHex(bytes)).toHaveLength(64);
  });
});
