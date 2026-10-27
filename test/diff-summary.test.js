import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { loadGas } from './harness.js';

/*
 * 変わった箇所の要約 (やること #109)。正規化 HTML の行の差分から、人の言葉の箇条書きを作る。
 */
const g = loadGas('src/core/Normalize.js', 'src/core/Diff.js', 'src/core/DiffSummary.js');

const RULES = [
  '<h1>就業規則</h1>',
  '<h2>第2章 勤務</h2>',
  '<p>第3条（始業）始業は午前9時とする。</p>',
  '<p>2 前項にかかわらず、所属長が認めたときは、始業の時刻を繰り上げ又は繰り下げることができる。</p>',
  '<p>第4条（終業）終業は午後6時とする。</p>',
  '',
].join('\n');

describe('条の変更', () => {
  it('条の印を場所にして「前 → 後」を出す', () => {
    const after = RULES.replace('午前9時とする', '午前9時30分とする');
    expect(g.diffSummarize(RULES, after)).toEqual([
      '第3条: 変更 (（始業）始業は午前9時とする。 → （始業）始業は午前9時30分とする。)',
    ]);
  });

  it('項は条の中の印として場所に足す', () => {
    const after = RULES.replace('所属長', '部長');
    const out = g.diffSummarize(RULES, after);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^第3条 2: 変更 \(/);
    expect(out[0]).toContain('所属長');
    expect(out[0]).toContain('部長');
  });

  it('「前 → 後」は 40 字以内に収める', () => {
    const after = RULES.replace('所属長', '部長');
    const text = /\((.*)\)$/.exec(g.diffSummarize(RULES, after)[0])[1];
    expect(text.length).toBeLessThanOrEqual(40);
  });

  it('条の追加と削除', () => {
    const added = RULES + '<p>第5条（休憩）休憩は1時間とする。</p>\n';
    expect(g.diffSummarize(RULES, added)).toEqual(['第5条: 追加 (（休憩）休憩は1時間とする。)']);
    expect(g.diffSummarize(added, RULES)).toEqual(['第5条: 削除 (（休憩）休憩は1時間とする。)']);
  });

  it('見出しそのものの変更は「見出し」', () => {
    const after = RULES.replace('第2章 勤務', '第2章 勤務時間');
    expect(g.diffSummarize(RULES, after)).toEqual(['見出し: 変更 (第2章 勤務 → 第2章 勤務時間)']);
  });

  it('字が同じで装飾だけ変わったら、そう言う', () => {
    const after = RULES.replace('<p>第4条（終業）終業は午後6時とする。</p>', '<p><strong>第4条（終業）終業は午後6時とする。</strong></p>');
    expect(g.diffSummarize(RULES, after)).toEqual(['第4条: 変更 (装飾だけ)']);
  });

  it('印だけの段落は抜粋を出さず、印だけ変わったら印ごと見せる', () => {
    expect(g.diffSummarize('<p>第1条</p>\n', '<p>第1条</p>\n<p>第2条</p>\n')).toEqual(['第2条: 追加']);
    expect(g.diffSummarize('<p>第3条 休日</p>\n', '<p>第4条 休日</p>\n')).toEqual(['第4条: 変更 (第3条 休日 → 第4条 休日)']);
  });

  it('変わっていなければ空', () => {
    expect(g.diffSummarize(RULES, RULES)).toEqual([]);
  });

  it('Block の配列も行の差分も受ける', () => {
    const after = RULES.replace('午後6時', '午後5時');
    const want = g.diffSummarize(RULES, after);
    expect(g.diffSummarize(g.parseBlocks(RULES), g.parseBlocks(after))).toEqual(want);
    expect(g.diffSummarize(g.diffHtml(RULES, after))).toEqual(want);
  });
});

describe('表', () => {
  const TABLE = [
    '<p>別表1 手当</p>',
    '<table>',
    '<tr><td>名前</td><td>額</td></tr>',
    '<tr><td>通勤</td><td>1000</td></tr>',
    '</table>',
    '',
  ].join('\n');

  it('行の追加は行数で、書き換えはセル数で数える', () => {
    const after = TABLE
      .replace('<tr><td>通勤</td><td>1000</td></tr>',
        '<tr><td>通勤</td><td>2000</td></tr>\n<tr><td>住宅</td><td>3000</td></tr>\n<tr><td>家族</td><td>500</td></tr>');
    expect(g.diffSummarize(TABLE, after)).toEqual(['表 別表1: 2 行追加 / 1 セル変更']);
  });

  it('行の削除', () => {
    const after = TABLE.replace('<tr><td>通勤</td><td>1000</td></tr>\n', '');
    expect(g.diffSummarize(TABLE, after)).toEqual(['表 別表1: 1 行削除']);
  });

  it('名前の印が無い表は、場所の名前の表と言う', () => {
    const before = '<p>第8条 手当は次のとおり。</p>\n<table>\n<tr><td>a</td></tr>\n</table>\n';
    const after = before.replace('<tr><td>a</td></tr>', '<tr><td>a</td></tr>\n<tr><td>b</td></tr>');
    expect(g.diffSummarize(before, after)).toEqual(['第8条 の表: 1 行追加']);
  });

  it('Sheets のシートは名前で言う。新しいシートは丸ごと追加', () => {
    const before = '<table data-sheet="手当">\n<tr><td>a</td><td>1</td></tr>\n</table>\n';
    const after = '<table data-sheet="手当">\n<tr><td>a</td><td>2</td></tr>\n<tr><td>b</td><td>3</td></tr>\n</table>\n' +
      '<table data-sheet="新しい表">\n<tr><td>x</td></tr>\n<tr><td>y</td></tr>\n</table>\n';
    expect(g.diffSummarize(before, after)).toEqual([
      '表 手当: 1 行追加 / 1 セル変更',
      '表 新しい表: 追加 (2 行)',
    ]);
  });

  it('数式の違いもセルの変更に数える', () => {
    const before = '<table data-sheet="計算">\n<tr><td data-formula="=A1+1">2</td></tr>\n</table>\n';
    const after = '<table data-sheet="計算">\n<tr><td data-formula="=A1+2">2</td></tr>\n</table>\n';
    expect(g.diffSummarize(before, after)).toEqual(['表 計算: 1 セル変更']);
  });
});

describe('見出しが無い文書', () => {
  it('場所が分からなければ「冒頭」', () => {
    expect(g.diffSummarize('<p>あいう</p>\n', '<p>あいえ</p>\n')).toEqual(['冒頭: 変更 (あいう → あいえ)']);
  });

  it('見出しの下の段落は見出しを場所にする', () => {
    const before = '<h2>はじめに</h2>\n<p>この規程は全員に適用する。</p>\n';
    const after = before.replace('全員', '正社員');
    expect(g.diffSummarize(before, after)[0]).toMatch(/^はじめに: 変更 \(/);
  });

  it('同じ場所に続けて足した段落は1本にまとめる', () => {
    const before = '<h2>附則</h2>\n';
    const after = '<h2>附則</h2>\n<p>一つ目</p>\n<p>二つ目</p>\n<p>三つ目</p>\n';
    expect(g.diffSummarize(before, after)).toEqual(['附則: 追加 (一つ目 ほか 2 段落)']);
  });

  it('長い段落の抜粋は 30 字で切る', () => {
    const long = 'あ'.repeat(50);
    const out = g.diffSummarize('', '<p>' + long + '</p>\n');
    expect(out[0]).toBe('冒頭: 追加 (' + 'あ'.repeat(29) + '…)');
  });
});

describe('8 本を超えたら', () => {
  it('8 本だけ出して「ほか N か所」', () => {
    const before = [];
    const after = [];
    for (let i = 1; i <= 11; i++) {
      before.push('<p>第' + i + '条 もとの文</p>');
      after.push('<p>第' + i + '条 あたらしい文</p>');
    }
    const out = g.diffSummarize(before.join('\n') + '\n', after.join('\n') + '\n');
    expect(out).toHaveLength(9);
    expect(out[0]).toBe('第1条: 変更 (もとの文 → あたらしい文)');
    expect(out[8]).toBe('ほか 3 か所');
  });

  it('ちょうど 8 本なら「ほか」は付けない', () => {
    const before = [];
    const after = [];
    for (let i = 1; i <= 8; i++) {
      before.push('<p>第' + i + '条 a</p>');
      after.push('<p>第' + i + '条 b</p>');
    }
    const out = g.diffSummarize(before.join('\n') + '\n', after.join('\n') + '\n');
    expect(out).toHaveLength(8);
    expect(out.join('\n')).not.toContain('ほか');
  });
});

describe('Slides', () => {
  it('スライドの番号を場所にする', () => {
    const before = '<section data-slide="1">\n<p>表紙</p>\n<section data-slide="2">\n<p>売上は10億</p>\n';
    const after = '<section data-slide="1">\n<p>表紙</p>\n<section data-slide="2">\n<p>売上は12億</p>\n' +
      '<section data-slide="3">\n<p>まとめ</p>\n<p>以上</p>\n';
    expect(g.diffSummarize(before, after)).toEqual([
      'スライド 2: 変更 (売上は10億 → 売上は12億)',
      'スライド 3: 追加 (まとめ ほか 1 段落)',
    ]);
  });
});

describe('変更セット', () => {
  it('2件以上なら文書の名前を頭に付け、上限は全体で数える', () => {
    const one = g.diffHtml('<p>第1条 a</p>\n', '<p>第1条 b</p>\n');
    const two = g.diffHtml('<p>第2条 c</p>\n', '<p>第2条 d</p>\n');
    expect(g.diffSummaryFiles([{ path: '就業規則', ops: one }, { path: '賃金規程', ops: two }])).toEqual([
      '就業規則 / 第1条: 変更 (a → b)',
      '賃金規程 / 第2条: 変更 (c → d)',
    ]);
    expect(g.diffSummaryFiles([{ path: '就業規則', ops: one }])).toEqual(['第1条: 変更 (a → b)']);
  });
});

describe('Git の言葉を使わない', () => {
  it('要約の字に PR・マージ・コミット・ブランチが出ない', () => {
    const src = fs.readFileSync(new URL('../src/core/DiffSummary.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const w of ['PR', 'マージ', 'コミット', 'ブランチ', 'プルリクエスト']) {
      expect(src).not.toContain(w);
    }
  });
});
