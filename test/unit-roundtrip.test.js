import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

/*
 * 正規化 HTML・Markdown・差分の性質を、種を固定した乱数で確かめる。
 *
 * 手で思い付く例では見つからない組み合わせ (装飾の境目に記号が来る、など) を
 * 拾うためのもの。test/merge.test.js の「ランダムな編集で崩れない」と同じ作り。
 */
const g = loadGas('src/core/Normalize.js', 'src/core/Markdown.js', 'src/core/Diff.js');

function rng(seed) {
  let s = seed;
  // 下の桁は周期が短い (2 の冪を法とする LCG の性質) ので、上の桁を使う
  return (n) => { s = (s * 1103515245 + 12345) % 2147483648; return Math.floor(s / 65536) % n; };
}

/**
 * 乱数で Block 列を作る。
 * opts.alphabet: 字に使う文字。opts.boldItalic: 太字と斜体を重ねるか
 */
function genBlocks(rnd, opts) {
  const A = opts.alphabet;
  const word = () => { let s = ''; for (let i = 0, n = 1 + rnd(5); i < n; i++) s += A[rnd(A.length)]; return s; };
  const links = ['https://e.test/a', 'https://e.test/(b)', 'https://e.test/c)d', 'https://e.test/x\\y'];
  const run = () => {
    const r = { text: word() };
    if (rnd(4) === 0) r.bold = true;
    if (rnd(4) === 0 && (opts.boldItalic || !r.bold)) r.italic = true;
    if (rnd(5) === 0) r.underline = true;
    if (rnd(5) === 0) r.strike = true;
    if (rnd(6) === 0) r.link = links[rnd(links.length)];
    return r;
  };
  const runs = () => Array.from({ length: 1 + rnd(3) }, run);
  const block = () => {
    switch (rnd(5)) {
      case 0: return { type: 'heading', level: 1 + rnd(6), runs: runs() };
      case 1: return { type: 'paragraph', runs: runs() };
      case 2: return { type: 'listItem', ordered: rnd(2) === 1, depth: rnd(3), runs: runs() };
      case 3: {
        const w = 1 + rnd(3);
        return { type: 'table', rows: Array.from({ length: 1 + rnd(3) }, () => Array.from({ length: w }, runs)) };
      }
      default: return { type: 'image', sha: 'a'.repeat(64), alt: word() };
    }
  };
  return Array.from({ length: 1 + rnd(4) }, block);
}

/** 記法に使う字を全部含む */
const ALL = 'ab あ  *~[]()<>|\\#-._&"\'1';
/** 下の「既知の不具合」に当たる字 (* ~ \ ]) を除いたもの */
const SAFE = 'ab あ  [()<>|#-._&"\'1';

describe('正規化 HTML の往復', () => {
  it('serializeBlocks → parseBlocks → serializeBlocks でバイト単位に変わらない', () => {
    for (const seed of [1, 7, 42]) {
      const rnd = rng(seed);
      for (let t = 0; t < 500; t++) {
        const html = g.serializeBlocks(genBlocks(rnd, { alphabet: ALL, boldItalic: true }));
        expect(g.serializeBlocks(g.parseBlocks(html))).toBe(html);
      }
    }
  });

  it('空白だけが違う2つは、以前の形 (legacySpacingHtml) にすると一致する', () => {
    const a = '<p>Hello <strong>world</strong></p>\n';
    const b = '<p>Hello<strong> world</strong></p>\n';
    expect(a).not.toBe(b);
    expect(g.legacySpacingHtml(a)).toBe(g.legacySpacingHtml(b));
    // 空白だけの装飾は以前の形では空の要素になっていたので、両側とも落とす
    expect(g.legacySpacingHtml('<p>a<strong> </strong>b</p>\n')).toBe('<p>ab</p>\n');
  });
});

describe('Markdown の往復', () => {
  it('HTML → Markdown → HTML がバイト単位で戻る (記法の字を含む乱数の文書)', () => {
    for (const seed of [3, 99, 2024]) {
      const rnd = rng(seed);
      for (let t = 0; t < 500; t++) {
        const html = g.serializeBlocks(genBlocks(rnd, { alphabet: SAFE, boldItalic: false }));
        const md = g.blocksToMd(g.parseBlocks(html));
        expect({ md, html: g.serializeBlocks(g.mdToBlocks(md)) }).toEqual({ md, html });
      }
    }
  });

  /*
   * 既知の不具合 (このテストを足したときに見つけた。src は直していない)。
   *
   * mdTakeDecorated_ が閉じの記号を indexOf で探すため、(1) 太字と斜体を重ねた
   * `***x***` の閉じを内側の `**` と取り違え、(2) 逃がした記号 `\*` / `\~` を閉じと
   * 読み、(3) リンクの字の中の `](` でリンクを切る。apiSaveMarkdown はこの読み方で
   * Docs に書き戻すので、Markdown で何も触っていない段落の装飾が変わり、字に * が
   * 混ざる。it.fails は「正しい答え」を書いておき、今は落ちることを確かめている。
   * 直したら it に戻す。
   */
  const back = (runs) => g.mdToBlocks(g.blocksToMd([{ type: 'paragraph', runs }]))[0].runs;

  it.fails('[既知の不具合] 太字と斜体を重ねた字が戻らない (***重要***)', () => {
    expect(back([{ text: '重要', bold: true, italic: true }])).toEqual([{ text: '重要', bold: true, italic: true }]);
  });

  it.fails('[既知の不具合] 装飾の最後の字が逃がした記号だと、そこで閉じたと読む (**a\\***)', () => {
    expect(back([{ text: 'a*', bold: true }])).toEqual([{ text: 'a*', bold: true }]);
  });

  it.fails('[既知の不具合] 取り消し線の最後の ~ も同じく閉じと読む', () => {
    expect(back([{ text: '1 ~', strike: true }])).toEqual([{ text: '1 ~', strike: true }]);
  });

  it.fails('[既知の不具合] リンクの字に ]( が入るとリンクが切れる', () => {
    expect(back([{ text: 'a](b', link: 'https://e.test/' }])).toEqual([{ text: 'a](b', link: 'https://e.test/' }]);
  });

  it('記法の字をすべて含む乱数の文書では、いまは往復が崩れることがある (上の不具合の現れ)', () => {
    const rnd = rng(7);
    let broken = 0;
    for (let t = 0; t < 300; t++) {
      const html = g.serializeBlocks(genBlocks(rnd, { alphabet: ALL, boldItalic: true }));
      if (g.serializeBlocks(g.mdToBlocks(g.blocksToMd(g.parseBlocks(html)))) !== html) broken++;
    }
    // 直したら 0 になる。そのときはこのテストを消し、上の往復を ALL で回す
    expect(broken).toBeGreaterThan(0);
  });
});

describe('Markdown: 行頭と表の枝', () => {
  it('行頭が記法に見える段落は逃がし、読むと段落のまま戻る', () => {
    for (const text of ['- 箇条ではない', '| 表ではない', '## 見出しではない', '3. 番号ではない']) {
      const md = g.blocksToMd([{ type: 'paragraph', runs: [{ text }] }]);
      expect(md.charAt(0) === '\\' || /^\d+\\\./.test(md)).toBe(true);
      expect(g.mdToBlocks(md)).toEqual([{ type: 'paragraph', runs: [{ text }] }]);
    }
  });

  it('行が無い表は何も出さず、空の run は飛ばす', () => {
    expect(g.blocksToMd([{ type: 'table', rows: [] }])).toBe('');
    expect(g.blocksToMd([{ type: 'paragraph', runs: [{ text: '' }, { text: 'a' }] }])).toBe('a\n');
    expect(g.blocksToMd([{ type: 'heading', level: 9, runs: null }])).toBe('###### \n');
  });

  it('表の行が縦棒で終わっていなくても、最後のセルを拾う', () => {
    expect(g.mdToBlocks('| a | b')).toEqual([{ type: 'table', rows: [[[{ text: 'a' }], [{ text: 'b' }]]] }]);
    // 縦棒だけの行も1つの空セルとして扱う
    expect(g.mdToBlocks('|')).toEqual([{ type: 'table', rows: [[[]]] }]);
  });

  it('閉じの無いリンクは字として読む', () => {
    expect(g.mdToBlocks('[a](b')[0].runs).toEqual([{ text: '[a](b' }]);
    expect(g.mdToBlocks('<u>a')[0].runs).toEqual([{ text: '<u>a' }]);
  });

  // 既知の不具合: 閉じの無い ** を「中身の無い斜体 (*と*)」と読み、2字とも消える。
  // 人が Markdown で「a **b」と書いて保存すると、文書には「a b」が入る
  it.fails('[既知の不具合] 閉じの無い ** が消える', () => {
    // mdToRuns_ は続きの字をまとめないので、正規化してから比べる
    expect(g.mergeRuns(g.mdToBlocks('a **b')[0].runs)).toEqual([{ text: 'a **b' }]);
  });
});

describe('Normalize: 細かい枝', () => {
  it('null を空として扱う', () => {
    expect(g.normalizeSpace(null)).toBe('');
    expect(g.escapeText(undefined)).toBe('');
    expect(g.parseBlocks(null)).toEqual([]);
    expect(g.describeLine(null)).toEqual({ kind: '', text: '' });
  });

  it('代替の字の無い画像は alt="" で出す', () => {
    expect(g.serializeBlocks([{ type: 'image', sha: 'a'.repeat(64) }])).toBe('<img data-sha="' + 'a'.repeat(64) + '" alt="">\n');
  });

  it('href の無い a は空のリンクとして読む', () => {
    expect(g.parseBlocks('<p><a>x</a></p>\n')).toEqual([{ type: 'paragraph', runs: [{ text: 'x' }] }]);
  });

  it('閉じられないまま終わった表とシートも取りこぼさない', () => {
    expect(g.parseBlocks('<table>\n<tr><td>a</td></tr>\n')).toEqual([{ type: 'table', rows: [[[{ text: 'a' }]]] }]);
    expect(g.parseBlocks('<table data-sheet="S">\n<tr><td>1</td></tr>\n'))
      .toEqual([{ type: 'sheet', name: 'S', rows: [[{ value: '1' }]] }]);
  });

  it('表の始まりと終わりの行を人の言葉で示す', () => {
    expect(g.describeLine('<table>')).toEqual({ kind: '表', text: '開始' });
    expect(g.describeLine('</table>')).toEqual({ kind: '表', text: '終わり' });
  });
});

describe('差分の性質', () => {
  /** ops から変更前・変更後を組み立て直す */
  function rebuild(ops) {
    const a = []; const b = [];
    for (const op of ops) {
      if (op.type !== 'insert') a.push(op.line);
      if (op.type !== 'delete') b.push(op.line);
    }
    return { a, b };
  }

  it('diffLines の ops から両側がそのまま組み立て直せ、等しい行は最長共通部分列の長さになる', () => {
    const lcs = (a, b) => {
      const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      return dp[a.length][b.length];
    };
    const rnd = rng(5);
    for (let t = 0; t < 400; t++) {
      const a = Array.from({ length: rnd(12) }, () => 'L' + rnd(5));
      const b = a.slice();
      for (let e = rnd(5); e > 0; e--) {
        const at = rnd(b.length + 1);
        if (rnd(2) && b.length) b.splice(at, 1); else b.splice(at, 0, 'L' + rnd(5));
      }
      const ops = g.diffLines(a, b);
      expect(rebuild(ops)).toEqual({ a, b });
      expect(ops.filter((o) => o.type === 'equal').length).toBe(lcs(a, b));
    }
  });

  it('diffPairs は左右の並びを崩さない', () => {
    const rnd = rng(8);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rnd(8) }, () => 'L' + rnd(4));
      const b = Array.from({ length: rnd(8) }, () => 'L' + rnd(4));
      const pairs = g.diffPairs(g.diffLines(a, b));
      expect(pairs.map((p) => p.left).filter((x) => x !== null)).toEqual(a);
      expect(pairs.map((p) => p.right).filter((x) => x !== null)).toEqual(b);
      for (const p of pairs) {
        expect(p.type).toBe(p.left === null ? 'insert' : p.right === null ? 'delete' : (p.type === 'equal' ? 'equal' : 'change'));
      }
    }
  });

  it('null の HTML は空として比べる', () => {
    expect(g.splitLines(null)).toEqual([]);
    expect(g.diffHtml(null, '<p>a</p>\n')).toEqual([{ type: 'insert', line: '<p>a</p>' }]);
  });
});
