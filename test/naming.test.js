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
  it('ブラウザのタブに出る', () => {
    expect(read('src/Main.gs')).toContain(".setTitle('" + NAME + "')");
  });

  it('通知メールの件名がすべて揃っている', () => {
    const text = read('src/core/Notifier.gs');
    const subjects = text.match(/'\[[^\]]+\] /g) || [];

    expect(subjects.length).toBeGreaterThan(5);
    subjects.forEach((one) => expect(one).toContain('[' + NAME + ']'));
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
      'src/Main.gs', 'src/core/Notifier.gs', 'src/core/AgentKit.gs',
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
