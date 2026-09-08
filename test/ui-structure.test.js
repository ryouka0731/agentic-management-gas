import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * UI の部分HTMLが壊れていないかを見る。
 *
 * app.css.html は <style> だけ、app.js.html は <script> だけを含む
 * 部分ファイルである。末尾に追記すると閉じタグの外に出てしまい、
 * CSS や JS がページ本文としてそのまま表示される。実際に踏んだ。
 */
describe('UI 部分HTMLの構造', () => {
  const cases = [
    ['src/ui/app.css.html', 'style'],
    ['src/ui/app.js.html', 'script'],
  ];

  cases.forEach(([file, tag]) => {
    it(file + ' は <' + tag + '> の内側だけで完結している', () => {
      const src = read(file).trim();

      expect(src.startsWith('<' + tag + '>')).toBe(true);
      expect(src.endsWith('</' + tag + '>')).toBe(true);

      // 開閉は1組だけ
      expect(src.split('<' + tag + '>').length - 1).toBe(1);
      expect(src.split('</' + tag + '>').length - 1).toBe(1);

      // 閉じタグより後ろに中身が無い
      expect(src.slice(src.lastIndexOf('</' + tag + '>') + tag.length + 3).trim())
        .toBe('');
    });
  });

  it('app.css.html が参照するトークンはすべて定義されている', () => {
    const css = read('src/ui/app.css.html');

    const defined = new Set();
    const defRe = /^\s*(--[a-z0-9-]+):/gm;
    let m;
    while ((m = defRe.exec(css)) !== null) defined.add(m[1]);

    const used = new Set();
    const useRe = /var\((--[a-z0-9-]+)/g;
    while ((m = useRe.exec(css)) !== null) used.add(m[1]);

    const missing = [...used].filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it('wiki.html は CSS と JS を取り込んでいる', () => {
    const html = read('src/ui/wiki.html');
    expect(html).toContain("include('ui/app.css')");
    expect(html).toContain("include('ui/app.js')");
  });
});

/**
 * CSS のトークン定義ブロックを取り出す。
 *
 * @param {string} css
 * @param {string} selector
 * @returns {Object<string,string>}
 */
function tokensOf(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error('セレクタが見つかりません: ' + selector);

  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);

  const out = {};
  const re = /(--[a-z0-9-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].trim();
  return out;
}

/** @param {string} hex @returns {number} 相対輝度 (WCAG 2.1) */
function luminance(hex) {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(v.substring(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** @returns {number} コントラスト比 */
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('テーマのトークン', () => {
  const css = read('src/ui/app.css.html');

  it('ダークの2つのブロックが同じ内容を持つ', () => {
    // 片方だけ直すと「システムはダークなのに手動ダークが古い」等が起きる
    const bySystem = tokensOf(css, ':root:not([data-theme="light"])');
    const byAttr = tokensOf(css, ':root[data-theme="dark"]');
    expect(byAttr).toEqual(bySystem);
  });

  it('ライトとダークが同じトークンを定義している', () => {
    const light = tokensOf(css, ':root {');
    const dark = tokensOf(css, ':root[data-theme="dark"]');

    // ダークは面と色だけを上書きする。余白や角丸は共通
    const missing = Object.keys(dark).filter((k) => !(k in light));
    expect(missing).toEqual([]);
  });

  const THEMES = [
    ['ライト', ':root {'],
    ['ダーク', ':root[data-theme="dark"]'],
  ];

  THEMES.forEach(([name, selector]) => {
    const t = () => {
      const light = tokensOf(css, ':root {');
      return Object.assign({}, light, tokensOf(css, selector));
    };

    it(name + ': 本文と補助テキストが 4.5:1 以上ある', () => {
      const c = t();
      const pairs = [
        ['--ink', '--bg'], ['--ink', '--bg-2'], ['--ink', '--bg-3'],
        ['--ink-2', '--bg'], ['--ink-2', '--bg-2'],
      ];
      pairs.forEach(([fg, bg]) => {
        expect({ pair: fg + ' on ' + bg, ratio: +contrast(c[fg], c[bg]).toFixed(2) })
          .toEqual({ pair: fg + ' on ' + bg, ratio: expect.any(Number) });
        expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': 意味を持つ色が地の上で 4.5:1 以上ある', () => {
      const c = t();
      ['--accent', '--success', '--danger', '--warn', '--merged'].forEach((fg) => {
        expect(contrast(c[fg], c['--bg'])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': 差分とコンフリクトの塗りの上でも本文が読める', () => {
      const c = t();
      [['--ink', '--success-bg'], ['--ink', '--danger-bg'],
       ['--danger', '--danger-bg']].forEach(([fg, bg]) => {
        expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': accent の上の文字が読める', () => {
      const c = t();
      // セグメント選択中など、accent を塗った上に文字を置く箇所がある。
      // 地の明るさがテーマで逆転するため、載せる文字色も対で持つ
      expect(contrast(c['--on-accent'], c['--accent'])).toBeGreaterThanOrEqual(4.5);
    });

    it(name + ': 浮いた面の上の文字が読める', () => {
      const c = t();
      expect(contrast(c['--ink'], c['--surface-raised'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c['--ink-2'], c['--surface-raised'])).toBeGreaterThanOrEqual(4.5);
    });

    it(name + ': 状態バッジが読める', () => {
      const c = t();
      [['--success', '--success-bg'], ['--accent', '--accent-bg'],
       ['--merged', '--merged-bg'], ['--warn', '--warn-bg']].forEach(([fg, bg]) => {
        expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
      });
    });

    it(name + ': グラフのレーンが地に対して 3:1 以上ある', () => {
      const c = t();
      ['--ink-2', '--accent', '--success', '--warn'].forEach((stroke) => {
        expect(contrast(c[stroke], c['--bg'])).toBeGreaterThanOrEqual(3);
      });
    });
  });
});

describe('モードレスなUI', () => {
  it('ブラウザのモーダル (alert / confirm / prompt) を使っていない', () => {
    const js = read('src/ui/app.js.html');

    // モーダルは操作を中断させ、取り消しの手段も与えない。
    // バナー通知 (showSnack) と画面内フォーム (openInlineForm) を使う
    const found = (js.match(/window\.(alert|confirm|prompt)\s*\(/g) || []);
    expect(found).toEqual([]);
  });

  it('通知は読み上げに載る', () => {
    const js = read('src/ui/app.js.html');
    expect(js).toContain("setAttribute('role', 'status')");
    expect(js).toContain("setAttribute('aria-live', 'polite')");
  });




  it('タブに動詞を置かない', () => {
    const html = read('src/ui/wiki.html');

    // 「編集」は文書に対する動作であってビューではない。
    // タブはオブジェクトとそのビューだけにする
    expect(html).not.toContain('data-tab="edit"');
    expect(html).toContain('id="mode-edit"');
  });
});

describe('色の指定', () => {
  it('CSSに直書きの色が残っていない', () => {
    const css = read('src/ui/app.css.html');

    // トークン定義の行だけを取り除いてから探す。直書きが残ると
    // 片方のテーマで取り残されて読めなくなる
    const withoutTokens = css.replace(/^\s*--[a-z0-9-]+:.*$/gm, '');
    const hardcoded = withoutTokens.match(/#[0-9a-fA-F]{3,8}\b/g) || [];

    expect(hardcoded).toEqual([]);
  });

  it('文書ビューの色をテーマから取っている', () => {
    const js = read('src/ui/app.js.html');

    // iframe の中には外側のCSS変数が届かないため、描画のたびに
    // 実際の値を読んで流し込む必要がある
    expect(js).toContain('function themeColors()');
    expect(js).toContain("getPropertyValue(n)");

    const viewer = js.slice(js.indexOf('function renderIntoViewer'),
      js.indexOf('viewer.srcdoc'));
    expect(viewer.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });
});

describe('シグニファイア', () => {
  const css = read('src/ui/app.css.html');

  it('ボタンは影で押せることを示し、押すと沈む', () => {
    // 枠線は境界の記号であって、押せることの記号ではない
    const btn = css.slice(css.indexOf('.btn {'), css.indexOf('.btn-primary'));

    expect(btn).toContain('box-shadow');
    expect(css).toContain('.btn:active:not(:disabled)');
    expect(css).toContain('.btn:hover:not(:disabled)');
  });

  it('押せないボタンは浮かせない', () => {
    const disabled = css.slice(css.indexOf('.btn:disabled'),
      css.indexOf('}', css.indexOf('.btn:disabled')));
    expect(disabled).toContain('transform: none');
  });

  it('主操作は塗りで区別する', () => {
    expect(css).toContain('.btn-primary');

    const html = read('src/ui/wiki.html');
    // 画面ごとに主操作は1つ。ツールバーで塗るのはコミットだけ
    const toolbar = html.slice(html.indexOf('<div class="toolbar">'),
      html.indexOf('<div class="tabs"'));
    expect((toolbar.match(/btn-primary/g) || []).length).toBe(1);
  });

  it('現在地のタブは下線で示す', () => {
    expect(css).toContain('.tab[aria-current="true"] { border-bottom-color: var(--accent)');
  });
});

describe('関係の分かりやすさ', () => {
  const html = read('src/ui/wiki.html');



  it('専門用語に平易な言い換えを添える', () => {
    // 覚えていることを前提にしない (認識より想起を避ける)
    expect(html).toContain('やること');
    expect(html).toContain('直している途中の版');
    expect(html).toContain('正式版に反映してよいか尋ねる');
    expect(html).toContain('正式版');
  });

  it('ナビの各項目に一行の説明がある', () => {
    const sidebar = html.slice(html.indexOf('<nav class="sidebar">'),
      html.indexOf('</nav>'));

    const items = sidebar.match(/class="nav-item"/g) || [];
    const descs = sidebar.match(/class="nav-desc"/g) || [];
    expect(descs.length).toBe(items.length);
  });
});

describe('概念モデルとの対応', () => {
  const html = read('src/ui/wiki.html');

  it('画面の名前は対象だけで、動作を使わない', () => {
    const sidebar = html.slice(html.indexOf('<nav class="sidebar"'), html.indexOf('</nav>'));
    const tabs = html.slice(html.indexOf('<div class="tabs"'),
      html.indexOf('</div>', html.indexOf('<div class="tabs"')));

    ['編集', 'コミット', 'マージ'].forEach((verb) => {
      expect(sidebar).not.toContain('>' + verb + '<');
      expect(tabs).not.toContain('>' + verb + '<');
    });
  });

  it('Git の用語を画面に出さない', () => {
    const visible = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/data-tab="[^"]*"/g, '')
      .replace(/id="[^"]*"/g, '')
      .replace(/class="[^"]*"/g, '');

    ['リポジトリ', 'ブランチ', 'プルリクエスト', 'コミット'].forEach((term) => {
      expect(visible).not.toContain(term);
    });
  });

  it('文書を根に置き、そのビューをタブにする', () => {
    const tabs = html.slice(html.indexOf('<div class="tabs"'),
      html.indexOf('</div>', html.indexOf('<div class="tabs"')));

    // 文書に従属するビューだけがタブになる
    ['content', 'history', 'drafts'].forEach((t) => {
      expect(tabs).toContain('data-tab="' + t + '"');
    });
    expect(tabs).not.toContain('data-tab="pulls"');
    expect(tabs).not.toContain('data-tab="issues"');
  });

  it('文書を選ぶまでタブを出さない', () => {
    const js = read('src/ui/app.js.html');

    // 対象が無ければそのビューは意味を持たない
    expect(js).toContain('tabsEl.hidden = !current.fileId');
    expect(js).toContain("if (DOC_TABS[name] && !current.fileId) name = 'docs';");
  });

  it('ホームは文書の一覧', () => {
    const js = read('src/ui/app.js.html');
    expect(js).toContain("loadFiles(function () { switchTab('docs'); })");
  });
});

describe('読み込み中の見せ方', () => {
  const js = read('src/ui/app.js.html');
  const css = read('src/ui/app.css.html');

  it('「読み込み中」の文字を画面に出さない', () => {
    // 出来上がりの形を見せたほうが待ち時間が短く感じられ、
    // 中身が入ったときに位置もずれない
    const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('読み込み中');
  });

  it('骨組みを出す仕組みがある', () => {
    expect(js).toContain('function showSkeleton(');
    expect(css).toContain('.skeleton');
  });

  it('動きを減らす設定では光らせない', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.skeleton { animation: none;');
  });
});

describe('やることの操作', () => {
  const js = read('src/ui/app.js.html');

  it('一覧・ボード・工程表のどこからでも中身を直せる', () => {
    // 対象が同じなら編集の場所も同じにする
    expect(js).toContain('function openIssueDetail(');
    expect((js.match(/openIssueDetail\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(js).toContain('function openIssueByNumber(');
  });

  it('担当者と期限を入力できる', () => {
    expect(js).toContain("label: '担当者 (メールアドレス)'");
    expect(js).toContain("label: '期限 (例: 2026-09-30)'");
    expect(js).toContain('自分に割り当てる');
  });

  it('担当者の候補を関わった人から出す', () => {
    expect(js).toContain('apiKnownPeople()');
    expect(js).toContain("setAttribute('list', 'people-list')");
  });

  it('ボードのカードはキーボードでも開ける', () => {
    // 掴む操作しか無いと、キーボードだけの利用者が中身を見られない
    expect(js).toContain('el.tabIndex = 0;');
  });

  it('工程表の配置はサーバ側と同じ計算を使う', () => {
    const gantt = read('src/core/Gantt.js');
    expect(gantt).toContain('function ganttLayout(');
    expect(js).toContain('function ganttLayout(');
  });
});

describe('入力の置き場所', () => {
  const html = read('src/ui/wiki.html');
  const js = read('src/ui/app.js.html');

  it('入力は右のパネルで受ける', () => {
    // 一覧の上に差し込むと、書いている間に一覧が押し下げられ、
    // 何に対する入力なのかが見えなくなる
    expect(html).toContain('id="side-panel"');
    expect(html).toContain('id="side-body"');
    expect(js).toContain('sideBody.appendChild(form)');
  });

  it('何の入力かを見出しに出す', () => {
    expect(js).toContain('sideTitle.textContent = title;');
    ['変更を記録する', 'やることを作る', '確認を依頼する'].forEach((t) => {
      expect(js).toContain(t);
    });
  });

  it('閉じ道が3つある (閉じるボタン・やめる・Escape)', () => {
    expect(html).toContain('id="side-close"');
    expect(js).toContain("cancel.textContent = 'やめる'");
    expect(js).toContain("if (e.key === 'Escape' && !sidePanel.hidden) closeSide();");
  });

  it('画面を切り替えたら入力は閉じる', () => {
    const fn = js.slice(js.indexOf('function switchTab('), js.indexOf('function updateCrumbs'));
    expect(fn).toContain('closeSide();');
  });
});
