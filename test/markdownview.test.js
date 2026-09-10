import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const { mdRuns, mdBlocks } = loadGas('src/core/MarkdownView.js');

describe('一行の中の飾り', () => {
  it('ふつうの字はそのまま', () => {
    expect(mdRuns('ふつうの字')).toEqual([{ text: 'ふつうの字' }]);
  });

  it('強い字を切り出す', () => {
    expect(mdRuns('これは**大事**です')).toEqual([
      { text: 'これは' },
      { text: '大事', bold: true },
      { text: 'です' },
    ]);
  });

  it('斜めの字も切り出す', () => {
    expect(mdRuns('*そっと*')).toEqual([{ text: 'そっと', italic: true }]);
  });

  it('コードを切り出す', () => {
    expect(mdRuns('`code` を打つ')).toEqual([
      { text: 'code', code: true },
      { text: ' を打つ' },
    ]);
  });

  it('リンクを切り出す', () => {
    expect(mdRuns('[ここ](https://example.invalid/a)を見て')).toEqual([
      { text: 'ここ', link: 'https://example.invalid/a' },
      { text: 'を見て' },
    ]);
  });

  it('空でも1つ返す', () => {
    expect(mdRuns('')).toEqual([{ text: '' }]);
  });

  it('印を繋ぐと元の字に戻る', () => {
    const text = '**強い** と *斜め* と `code` と [林](https://x.invalid)';
    const joined = mdRuns(text).map((r) => r.text).join('');

    expect(joined).toBe('強い と 斜め と code と 林');
  });
});

describe('塊に分ける', () => {
  it('段落にする', () => {
    expect(mdBlocks('ふつうの文')).toEqual([
      { type: 'p', runs: [{ text: 'ふつうの文' }] },
    ]);
  });

  it('続く行はひとつの段落にまとめる', () => {
    expect(mdBlocks('ひとつめ\nふたつめ')[0].runs[0].text)
      .toBe('ひとつめ\nふたつめ');
  });

  it('空行で段落が切れる', () => {
    expect(mdBlocks('ひとつめ\n\nふたつめ')).toHaveLength(2);
  });

  it('見出しを深さごとに分ける', () => {
    const out = mdBlocks('# おおきい\n## なか\n### ちいさい');

    expect(out.map((b) => b.level)).toEqual([1, 2, 3]);
    expect(out[0].runs[0].text).toBe('おおきい');
  });

  it('箇条書きをまとめる', () => {
    const out = mdBlocks('- ひとつ\n- ふたつ');

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('ul');
    expect(out[0].items.map((i) => i.runs[0].text)).toEqual(['ひとつ', 'ふたつ']);
  });

  it('番号付きも分ける', () => {
    const out = mdBlocks('1. ひとつ\n2. ふたつ');

    expect(out[0].type).toBe('ol');
    expect(out[0].items).toHaveLength(2);
  });

  it('手を付けたかどうかの印を読む', () => {
    const out = mdBlocks('- [ ] まだ\n- [x] 済んだ');

    expect(out[0].type).toBe('tasks');
    expect(out[0].items.map((i) => i.done)).toEqual([false, true]);
  });

  it('引用と区切り線を分ける', () => {
    const out = mdBlocks('> ひきよう\n\n---');

    expect(out[0].type).toBe('quote');
    expect(out[1].type).toBe('hr');
  });

  it('種類が変わったら箇条書きを切る', () => {
    const out = mdBlocks('- ひとつ\n1. いち');

    expect(out.map((b) => b.type)).toEqual(['ul', 'ol']);
  });

  it('箇条書きの中でも飾りが効く', () => {
    expect(mdBlocks('- **大事**')[0].items[0].runs[0])
      .toEqual({ text: '大事', bold: true });
  });

  it('空なら何も返さない', () => {
    expect(mdBlocks('')).toEqual([]);
    expect(mdBlocks('   \n  ')).toEqual([]);
  });
});
