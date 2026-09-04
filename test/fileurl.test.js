import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/FileUrl.js');

describe('fileUrlOf', () => {
  it('種別ごとに正しいURLを作る', () => {
    expect(gas.fileUrlOf('doc', 'ID1'))
      .toBe('https://docs.google.com/document/d/ID1/edit');
    expect(gas.fileUrlOf('sheet', 'ID2'))
      .toBe('https://docs.google.com/spreadsheets/d/ID2/edit');
    expect(gas.fileUrlOf('slide', 'ID3'))
      .toBe('https://docs.google.com/presentation/d/ID3/edit');
  });

  it('未知の種別は Drive のファイルビューに落とす', () => {
    expect(gas.fileUrlOf('pdf', 'ID4'))
      .toBe('https://drive.google.com/file/d/ID4/view');
  });

  it('fileId が無ければ空文字を返す', () => {
    expect(gas.fileUrlOf('doc', '')).toBe('');
  });
});
