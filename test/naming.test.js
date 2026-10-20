import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { API_SOURCES } from './sources.js';
import { APP } from './ui-source.js';

/**
 * サービス名が、人の目に触れる場所すべてで揃っているかを見る。
 *
 * 名前は決めた場所にしか無いと必ずずれる。タブ・メールの件名・配る道具の
 * 3か所は、片方だけ直すと食い違ったまま気づかれない。
 */
const NAME = 'SoftBanto';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

describe('サービス名', () => {
  it('名前の出どころは1か所である', () => {
    // 散らすと、名前が変わるたびに全部を直すことになり、直し漏れた
    // 1通だけが古い名前で届く
    expect(read('src/core/Brand.js'))
      .toContain("return '" + NAME + "';");
  });

  it('ブラウザのタブに出る', () => {
    expect(read('src/Main.gs')).toContain('.setTitle(APP_NAME())');
  });

  it('サーバ側に名前の字を書かない', () => {
    // タブと通知と概要で食い違わないよう、どれも出どころから引く
    // 画面の入口は src/Main.gs と src/api/*.gs に分かれている
    const text = API_SOURCES.map(read).join('\n');

    expect(text).toContain('repo: APP_NAME()');
    expect(text).not.toContain("'" + NAME + "'");
  });

  it('画面の左上にも同じ名前が出る', () => {
    // 画面側はサーバの関数を呼べないため字で持つ。往復を1つ増やして
    // 左上が一瞬空になるほうが損である
    expect(APP)
      .toContain("name.textContent = '" + NAME + "';");
  });

  it('通知メールの件名は1か所で組む', () => {
    const text = read('src/core/Notifier.gs');

    // 以前は同じ接頭辞が10か所に写されていた
    expect(text).toContain("'[' + APP_NAME() + '] '");
    expect(text.match(/'\[[^\]]+\] /g) || []).toHaveLength(1);
    expect((text.match(/notifySubject_\(/g) || []).length)
      .toBeGreaterThan(5);
  });

  it('配る道具にも同じ名前が入っている', () => {
    ['kit/README.md', 'kit/AGENTS.md', 'kit/package.json', 'kit/agent.mjs']
      .forEach((path) => expect(read(path)).toContain(NAME));
  });

  it('配る道具の版を上げてある', () => {
    // 版が同じだと作り直さず、古い zip が配られ続ける
    expect(read('src/core/AgentKit.gs')).not.toContain("return '1.0.0';");
  });

  it('使い方で通称にも触れている', () => {
    expect(APP).toContain('通称は「番頭」');
  });

  it('仮の名前が人の目に触れる場所に残っていない', () => {
    const brand = [
      'src/core/Brand.js', ...API_SOURCES, 'src/core/Notifier.gs',
      'src/core/AgentKit.gs',
      'kit/README.md', 'kit/AGENTS.md', 'kit/package.json',
    ];

    brand.forEach((path) => {
      // Drive のフォルダ名を指す箇所だけは、実体に合わせて残してある
      const lines = read(path).split('\n')
        .filter((line) => /agentic-management/i.test(line))
        .filter((line) => !/repoInit\(|queueDir|マイドライブ/.test(line));

      expect(lines).toEqual([]);
    });
  });

  it('Drive のフォルダ名は変えていない', () => {
    // 運用中の実体をリネームする必然性がない。設定は ID で持っている
    expect(read('src/Main.gs')).toContain("repoInit('agentic-management')");
  });
});

/**
 * Git の言葉を人に見せていないか。
 *
 * この道具を使うのは総務・人事であって、git を知っている人ではない。
 * 画面だけ日本語にしても、**メールの件名と変更の記録に「PR」「マージ」が
 * 残っていれば同じこと**である。実際に件名10件が Git の言葉のままだった。
 */
describe('Git の言葉を人に見せない', () => {
  /** 人に届く字だけを取り出す (コメントと JSDoc は除く) */
  function spoken(path) {
    return read(path).split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
  }

  const WORDS = ['PR', 'マージ', 'プルリクエスト', 'ブランチ', 'コミット'];

  it('通知の件名と本文に残っていない', () => {
    const text = spoken('src/core/Notifier.gs');

    WORDS.forEach((word) => {
      expect(text, word + ' が残っている').not.toContain(word);
    });
  });

  it('変更の記録に残る文にも残っていない', () => {
    // 履歴は人が読む。ここに残ると、画面を日本語にした意味が無い
    const text = spoken('src/core/PullRequest.gs') + spoken('src/core/Branch.gs');

    ['マージ: PR', 'マージ前', "'ブランチ ' +"].forEach((bad) => {
      expect(text, bad + ' が残っている').not.toContain(bad);
    });
  });

  /**
   * 人に届く字を取り出す。断り文 (new Error) は画面の帯と手元の結果にそのまま出る。
   * 変更の記録の文 (commitFile の3つ目) は履歴に残り、人が読む。
   *
   * コメントと、エディタで持ち主だけが動かす debug* / setup* の関数は除く。字どうしを
   * 足した形はつなげて1つにする。'main' だけの字は比べる相手 (版の名前) であって、
   * 人に見せる字ではない。
   *
   * **見られないもの:** 断り文を一度変数に入れてから new Error(変数) に渡す形は、
   * 変数の中身までは追わない。代わりに msg / message / reason という名前の変数に
   * 字を入れる形を拾う (今は1つも無い)。ほかの名前の変数で組むと、ここをすり抜ける。
   */
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  }

  function withoutEditorOnly(src) {
    return src.split(/\n(?=function )/)
      .filter((p) => !/^\n?function (debug|setup)/.test(p)).join('\n');
  }

  /** start の位置から、括弧が閉じるまでの字の部分をつなげて返す */
  function literalsUntilClose(s, start, stopAtComma) {
    let i = start;
    let depth = 1;
    const parts = [];
    while (i < s.length && depth) {
      const c = s[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        let lit = '';
        while (j < s.length && s[j] !== c) {
          if (s[j] === '\\') { lit += s[j + 1]; j += 2; continue; }
          lit += s[j];
          j++;
        }
        if (lit !== 'main') parts.push(lit);
        i = j + 1;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      if (c === ')' || c === ']' || c === '}') depth--;
      if (stopAtComma && depth === 1 && c === ',') { parts.push('\u0000'); }
      if (stopAtComma && depth === 1 && c === ';') break;
      i++;
    }
    return parts.join('');
  }

  function errorTexts(src) {
    const s = withoutEditorOnly(stripComments(src));
    const out = [];
    for (const m of s.matchAll(/new Error\(/g)) {
      out.push(literalsUntilClose(s, m.index + m[0].length));
    }
    for (const m of s.matchAll(/\b(?:var|let|const)\s+(?:msg|message|reason)\s*=/g)) {
      out.push(literalsUntilClose(s, m.index + m[0].length, true).split('\u0000')[0]);
    }
    return out;
  }

  /** commitFile(id, 版, 文, ...) の「文」に当たる字 */
  function commitMessages(src) {
    const s = withoutEditorOnly(stripComments(src));
    const out = [];
    for (const m of s.matchAll(/(?<![\w.])commitFile\(/g)) {
      const args = literalsUntilClose(s, m.index + m[0].length, true).split('\u0000');
      if (args.length > 2) out.push(args[2]);
    }
    return out;
  }

  const ERROR_WORDS = [
    /(^|[^A-Z_])PR(?![A-Z_])/, /マージ/, /プルリクエスト/, /ブランチ/, /コミット/,
    /リベース/, /コンフリクト/, /クローズ/,
    /(^|[^A-Za-z_])Issue(?![A-Za-z_])/, /(^|[^A-Za-z_])HEAD(?![A-Za-z_])/,
    // 「main」と括った字は、名前そのものを指すので通す
    /(^|[^「A-Za-z_])main(?![A-Za-z_」])/,
  ];

  /** 人に届く字を持つファイル。配る道具の中身 (KitFiles) と署名の記録は字を持つだけ */
  function serverSources() {
    const out = [];
    (function walk(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = dir + '/' + ent.name;
        if (ent.isDirectory()) walk(p);
        else if (/\.gs$/.test(ent.name) || (/^src\/core\/[^/]+\.js$/.test(p))) out.push(p);
      }
    })('src');
    return out.filter((p) => !/\/(KitFiles|KitSigning)\.gs$/.test(p)).sort();
  }

  const badOf = (texts) => texts.filter((t) => ERROR_WORDS.some((w) => w.test(t)));

  it('断り文を拾える', () => {
    // 拾い方が壊れて空になると、下の検査は何も見ずに通る
    expect(serverSources().length).toBeGreaterThan(30);
    const all = serverSources().flatMap((f) => errorTexts(read(f)));
    expect(all.length).toBeGreaterThan(100);
    expect(errorTexts("function a() { throw new Error('PR ' + n + ' が無い'); }"))
      .toEqual(['PR  が無い']);
    expect(errorTexts("function a() { var msg = 'Issue' + 1; }")).toEqual(['Issue']);
    expect(errorTexts("function debugX() { throw new Error('PR'); }")).toEqual([]);
    expect(commitMessages("commitFile(id, 'main', 'マージ: ' + n, null);")).toEqual(['マージ: ']);
    expect(commitMessages("commitFile(id, f(a, b), 'ok', null);")).toEqual(['ok']);
  });

  it.each(serverSources())('%s の断り文に残っていない', (file) => {
    expect(badOf(errorTexts(read(file)))).toEqual([]);
  });

  it.each(serverSources())('%s の変更の記録の文に残っていない', (file) => {
    expect(badOf(commitMessages(read(file)))).toEqual([]);
  });

  it('言い換えの表は配る道具にある', () => {
    // 手元の Claude にも同じ言葉を使わせる
    const text = read('kit/AGENTS.md');

    expect(text).toContain('| 確認依頼 | プルリクエスト |');
    expect(text).toContain('| 反映 | マージ |');
  });

  it('件名の接頭辞は変えていない', () => {
    // 受信側の振り分けはここを見ている。言葉を直すときに動かさない
    expect(read('src/core/Notifier.gs')).toContain("'[' + APP_NAME() + '] '");
  });
});
