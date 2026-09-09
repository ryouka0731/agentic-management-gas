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
      expect(contrast(c['--on-danger'], c['--danger-solid'])).toBeGreaterThanOrEqual(4.5);
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

describe('編集中の対象', () => {
  const js = read('src/ui/app.js.html');
  const css = read('src/ui/app.css.html');

  it('どれを編集しているかに印を付ける', () => {
    expect(js).toContain('function setSideSource(');
    expect(js).toContain("classList.add('editing')");
    expect(css).toContain('.editing');
  });

  it('閉じたら印も外す', () => {
    const fn = js.slice(js.indexOf('function closeSide()'),
      js.indexOf('function openInlineForm'));
    expect(fn).toContain('setSideSource(null)');
  });

  it('一覧・ボード・工程表のどれからでも対象を渡している', () => {
    expect(js).toContain('openIssueDetail(issue, row)');
    expect(js).toContain('openIssueByNumber(card.issueNumber, el)');
    expect(js).toContain('openIssueByNumber(r.number, row)');
  });
});

describe('工程表の使い勝手', () => {
  const js = read('src/ui/app.js.html');
  const html = read('src/ui/wiki.html');

  it('月の見出しを出す', () => {
    // 日だけでは何月を見ているのか分からない
    expect(js).toContain('function ganttMonths(');
    expect(js).toContain("cell.className = 'gantt-month'");
  });

  it('棒を掴んで期間を変えられる', () => {
    expect(js).toContain('function makeBarDraggable(');
    expect(js).toContain("bar.addEventListener('pointerdown'");
    expect(js).toContain('apiIssueUpdate(row.number, patch)');
  });

  it('端と真ん中で動き方を変える', () => {
    const fn = js.slice(js.indexOf('function makeBarDraggable('),
      js.indexOf('function loadGantt()'));
    ["mode = 'start'", "mode = 'end'", "mode = 'move'"].forEach((m) => {
      expect(fn).toContain(m);
    });
  });

});

describe('線に頼らない表現', () => {
  const css = read('src/ui/app.css.html');

  it('触れる対象は影で持ち上げる', () => {
    // 枠は境界の記号であって、触れることの記号ではない
    ['.board-card {', '.btn {', '.gantt-bar {'].forEach((sel) => {
      const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
      expect(rule).toContain('box-shadow');
      expect(rule).not.toContain('border: 1px solid');
    });
  });

  it('カードと束ねは塗りでまとまりを作る', () => {
    const column = css.slice(css.indexOf('.board-column {'),
      css.indexOf('}', css.indexOf('.board-column {')));
    expect(column).toContain('border: 0');
    expect(column).toMatch(/background: var\(--bg-[23]\)/);
  });

  it('工程表の目盛りは日ごとに線を引かない', () => {
    const day = css.slice(css.indexOf('.gantt-day {'),
      css.indexOf('}', css.indexOf('.gantt-day {')));
    expect(day).not.toContain('border-left');

    // 週ごとの区切りだけを敷く
    expect(css).toContain('repeating-linear-gradient');
    expect(css).toContain('--week-offset');
  });

  it('罫線の総数を増やしすぎない', () => {
    // 線が増えるほど、どれが意味のある境界か読めなくなる
    const lines = (css.match(/1px solid/g) || []).length;
    expect(lines).toBeLessThanOrEqual(28);
  });
});

describe('骨組みの形', () => {
  const js = read('src/ui/app.js.html');
  const fn = js.slice(js.indexOf('function showSkeleton('),
    js.indexOf('// ===== 本文の描画'));

  it('実物と同じ器の中に置く', () => {
    // 別の形で描くと、中身が入ったときに位置も形も変わる
    ['row-item', 'row-open', 'graph-row', 'graph-col-desc', 'graph-col-sha',
     'doc-card', 'doc-open', 'board-column', 'board-card',
     'gantt-row', 'gantt-name', 'gantt-track'].forEach((cls) => {
      expect(fn).toContain(cls);
    });
  });

  it('画面ごとに合う形を選んでいる', () => {
    expect(js).toContain("showSkeleton(ganttEl, 'gantt'");
    expect(js).toContain("showSkeleton(historyList, 'graph'");
    expect(js).toContain("showSkeleton(docListEl, 'doc'");
    expect(js).toContain("showSkeleton(boardEl, 'board')");
  });
});

describe('サイドバーと見え方', () => {
  const html = read('src/ui/wiki.html');
  const js = read('src/ui/app.js.html');

  it('左のメニューを役割で束ねる', () => {
    const sidebar = html.slice(html.indexOf('<nav class="sidebar"'), html.indexOf('</nav>'));

    expect(sidebar).toContain('管理するもの');
    expect(sidebar).toContain('進行中');
    expect((sidebar.match(/nav-section/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('やることは1つの行き先で、見え方を切り替える', () => {
    // 対象は同じで見せ方だけが違う。行き先を3つに割らない
    expect(html).toContain('id="view-list"');
    expect(html).toContain('id="view-board"');
    expect(html).toContain('id="view-gantt"');
    expect(html).not.toContain('data-tab="board"');
    expect(html).not.toContain('data-tab="gantt"');

    expect(js).toContain('function setIssueView(');
  });

  it('絞り込みと束ねを共通の帯に置く', () => {
    const bar = html.slice(html.indexOf('<div class="view-bar">'),
      html.indexOf('</div>', html.indexOf('id="issue-group"')));
    expect(bar).toContain('id="issue-filter"');
    expect(bar).toContain('id="issue-group"');
  });

  it('束ねは畳める', () => {
    expect(js).toContain("head.setAttribute('aria-expanded'");
    expect(js).toContain('collapsed[group.key]');
  });

  it('カードに番号・ラベル・担当を出す', () => {
    expect(js).toContain('function makeLabels(');
    expect(js).toContain('function makeAvatar(');
    expect(js).toContain("num.className = 'card-number'");
  });
});

describe('面と面の見分け', () => {
  const css = read('src/ui/app.css.html');

  it('カードは触れても面の色を変えない', () => {
    // 載っている面と同じ色になると、触れた瞬間に同化する
    const generic = css.slice(css.indexOf('.file-item:hover'),
      css.indexOf('}', css.indexOf('.file-item:hover')));
    expect(generic).not.toContain('.board-card');

    const hover = css.slice(css.indexOf('.board-card:hover {'),
      css.indexOf('}', css.indexOf('.board-card:hover {')));
    expect(hover).toContain('var(--surface-raised)');
  });

  it('編集中は塗りではなく輪郭で示す', () => {
    const editing = css.slice(css.indexOf('.board-card.editing {'),
      css.indexOf('}', css.indexOf('.board-card.editing {')));
    expect(editing).toContain('0 0 0 2px var(--accent)');
    expect(editing).toContain('var(--surface-raised)');
  });

  it('行は自前の面を持ち、器のほうを沈める', () => {
    const row = css.slice(css.indexOf('.row-item {'),
      css.indexOf('}', css.indexOf('.row-item {')));
    expect(row).toContain('var(--surface-raised)');

    const area = css.slice(css.indexOf('.list-area {'),
      css.indexOf('}', css.indexOf('.list-area {')));
    expect(area).toContain('var(--bg-2)');
  });
});

describe('やることの中身と操作', () => {
  const js = read('src/ui/app.js.html');
  const css = read('src/ui/app.css.html');
  const html = read('src/ui/wiki.html');

  it('見積もりと工数を入力できる', () => {
    ["label: '見積もり (規模。数値)'", "label: '予定工数 (時間)'",
     "label: '実績工数 (時間)'"].forEach((f) => expect(js).toContain(f));
  });

  it('親子にできて、子の工数を親に足し上げる', () => {
    expect(js).toContain("label: '親のやること (番号。空なら親なし)'");
    expect(js).toContain('function issueTreeRows(');
    expect(js).toContain('function rollupEffort(');
  });

  it('操作は形と色で意味を示す', () => {
    // 削除は赤いゴミ箱、完了は緑のチェック、編集はペン
    expect(js).toContain("makeIcon('trash')");
    expect(js).toContain("del.className = 'btn btn-danger'");

    // アイコンだけの操作には名前が要る。
    // title の代入が消えると aria-label が空になり、名前を持たない
    // ボタンになってしまうため、両方を見る
    expect(js).toContain("del.title = '改訂版「'");
    expect(js).toContain("del.setAttribute('aria-label', del.title)");
    expect(js).toContain("done.className = 'icon-btn ok'");
    expect(js).toContain("edit.appendChild(makeIcon('pencil'))");

    const danger = css.slice(css.indexOf('.btn-danger {'),
      css.indexOf('}', css.indexOf('.btn-danger {')));
    expect(danger).toContain('background: var(--danger-solid)');
    expect(danger).toContain('color: var(--on-danger)');

    // 塗りの上に縁の線を重ねると、触れた瞬間に縁だけが消えて見える
    expect(danger).toContain('box-shadow: var(--elev-1)');
    expect(danger).not.toContain('var(--hairline)');

    // 並びの中で潰れない
    expect(danger).toContain('flex: 0 0 auto');
    expect(css).toContain('.icon-btn.ok:hover { color: var(--success); }');
  });

  it('確認依頼のアイコンを分かりやすいものにする', () => {
    expect(js).toContain("pulls: 'clipboard-check'");
  });

  it('文書はカードで並べる', () => {
    expect(js).toContain("card.className = 'doc-card'");
    const rule = css.slice(css.indexOf('.doc-card {'), css.indexOf('}', css.indexOf('.doc-card {')));
    expect(rule).toContain('box-shadow');
  });

  it('進め方は案内として別に置く', () => {
    // 文書の一覧と混ざると、どれが対象でどれが説明か読めない
    expect(html).toContain('class="guideline"');
    expect(html).toContain('進め方');

    const docList = html.indexOf('id="doc-list"');
    const guide = html.indexOf('class="guideline"');
    expect(docList).toBeLessThan(guide);
  });

  it('工程表に日の補助線を敷く', () => {
    const start = css.indexOf('.gantt-grid {');
    const grid = css.slice(start, css.indexOf('\n}', start));

    // 土日の塗り・週の区切り・日の目安の3つ
    expect((grid.match(/repeating-linear-gradient/g) || []).length).toBe(3);

    // 行ごとに描くと行間で途切れる。1枚の下敷きに描く
    const track = css.slice(css.indexOf('\n.gantt-track {'),
      css.indexOf('\n}', css.indexOf('\n.gantt-track {')));
    expect(track).not.toContain('repeating-linear-gradient');

    const js = read('src/ui/app.js.html');
    expect(js).toContain("grid.className = 'gantt-grid'");
    expect(js).toContain("rows.className = 'gantt-rows'");
  });

  it('左のメニューはすべて見出しの下にある', () => {
    const sidebar = html.slice(html.indexOf('<nav class="sidebar"'), html.indexOf('</nav>'));
    const sections = (sidebar.match(/<h2>/g) || []).length;
    expect(sections).toBe((sidebar.match(/nav-section/g) || []).length);
  });
});
