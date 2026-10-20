import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

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
    const text = read('src/Main.gs');

    expect(text).toContain('repo: APP_NAME()');
    expect(text).not.toContain("'" + NAME + "'");
  });

  it('画面の左上にも同じ名前が出る', () => {
    // 画面側はサーバの関数を呼べないため字で持つ。往復を1つ増やして
    // 左上が一瞬空になるほうが損である
    expect(read('src/ui/app.js.html'))
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
    expect(read('src/ui/app.js.html')).toContain('通称は「番頭」');
  });

  it('仮の名前が人の目に触れる場所に残っていない', () => {
    const brand = [
      'src/core/Brand.js', 'src/Main.gs', 'src/core/Notifier.gs',
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
   * new Error(...) に渡す字だけを取り出す。断り文は画面の帯と手元の結果にそのまま出る。
   * コメントと、エディタで持ち主だけが動かす debug* の関数は除く。字どうしを足した形は
   * つなげて1つにする。'main' だけの字は比べる相手 (版の名前) であって、人に見せる字ではない。
   */
  function errorTexts(src) {
    let s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    s = s.split(/\n(?=function )/).filter((p) => !/^\n?function debug/.test(p)).join('\n');
    const out = [];
    const re = /new Error\(/g;
    let m;
    while ((m = re.exec(s))) {
      let i = m.index + m[0].length;
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
        if (c === '(') depth++;
        if (c === ')') depth--;
        i++;
      }
      out.push(parts.join(''));
    }
    return out;
  }

  const ERROR_WORDS = [
    /(^|[^A-Z_])PR(?![A-Z_])/, /マージ/, /プルリクエスト/, /ブランチ/, /コミット/,
    // 「main」と括った字は、名前そのものを指すので通す
    /(^|[^「A-Za-z_])main(?![A-Za-z_」])/,
  ];

  it.each(['src/Main.gs', 'src/core/PullRequest.gs', 'src/core/Branch.gs'])(
    '%s の断り文に残っていない', (file) => {
      const texts = errorTexts(read(file));
      expect(texts.length).toBeGreaterThan(0);
      const bad = texts.filter((t) => ERROR_WORDS.some((w) => w.test(t)));
      expect(bad).toEqual([]);
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
