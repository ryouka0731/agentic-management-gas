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
