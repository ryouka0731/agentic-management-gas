// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

describe('読み込み中の骨組み', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('板の中にもう1枚板を作らない', () => {
    let snapshot = '';

    // 応答を返す直前が、骨組みが出ている瞬間
    mount({
      apiProjectBoard: () => {
        snapshot = document.getElementById('board').innerHTML;
        return DEFAULTS.apiProjectBoard;
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();

    // 器そのものが4列の板。中に板を作ると1列に4列を押し込むことになる
    expect(snapshot).not.toContain('class="board"');
    expect(snapshot.split('board-column').length - 1).toBe(4);
  });

  it('骨組みは実物と同じ器で作る', () => {
    let snapshot = '';

    mount({
      apiProjectBoard: () => {
        snapshot = document.getElementById('board').innerHTML;
        return DEFAULTS.apiProjectBoard;
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();

    // 形が違うと、出た瞬間に位置が飛ぶ
    expect(snapshot).toContain('board-card');
  });
});

describe('ペインの幅', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--sidebar-w');
  });

  /** jsdom には PointerEvent が無いので、同じ形のものを送る */
  function pointer(type, x) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.clientX = x;
    ev.pointerId = 1;
    return ev;
  }

  function handle() {
    return document.getElementById('resizer');
  }

  function width() {
    return document.documentElement.style.getPropertyValue('--sidebar-w');
  }

  it('広げられる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointermove', 400));

    expect(width()).toBe('400px');
  });

  it('縮められる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointermove', 200));

    expect(width()).toBe('200px');
  });

  it('限度を超えない', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));

    handle().dispatchEvent(pointer('pointermove', 10));
    expect(width()).toBe('180px');

    handle().dispatchEvent(pointer('pointermove', 9999));
    expect(width()).toBe('560px');
  });

  it('離したら追いかけるのをやめる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointerup', 300));

    handle().dispatchEvent(pointer('pointermove', 500));
    expect(width()).toBe('300px');
  });

  it('枠の外で離しても張り付かない', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));

    // 枠の外で離すと境界には pointerup が届かない
    window.dispatchEvent(pointer('pointerup', 320));

    handle().dispatchEvent(pointer('pointermove', 500));
    expect(width()).toBe('320px');
  });

  it('取り消されても張り付かない', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointercancel', 300));

    handle().dispatchEvent(pointer('pointermove', 500));
    expect(width()).toBe('300px');
  });

  it('二度押しで元の幅に戻る', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointerup', 420));
    expect(width()).toBe('420px');

    handle().dispatchEvent(new window.Event('dblclick', { bubbles: true }));

    expect(width()).toBe('');
    expect(window.localStorage.getItem('sidebarWidth')).toBe(null);
  });

  it('キーボードでも変えられる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointerup', 300));

    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(width()).toBe('284px');

    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
    expect(width()).toBe('');
  });
});

describe('サーバを呼ぶところ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  /** いま出ている短い帯の文 */
  function snack() {
    const bar = document.getElementById('snackbar');
    return bar ? bar.textContent : '';
  }

  it('失敗ハンドラを書かなくても、失敗は黙らない', () => {
    // google.script.run は付け忘れると失敗が完全に黙る。その画面だけが
    // 「押しても何も起きない」になる
    openIssues({ apiIssueArchive: new Error('持ち主ではありません') });

    document.querySelector('#issue-list .row-item .btn-danger').click();
    document.querySelector('#panel-issues .confirm-strip .btn-primary').click();

    expect(snack()).toContain('持ち主ではありません');
    expect(document.getElementById('snackbar').className).toContain('ng');
  });

  it('一覧が出ないときは器の中に出す', () => {
    // 帯は数秒で消えるため、後から見た人に「ここが出ていない」が伝わらない
    openIssues({ apiIssueList: new Error('台帳が読めません') });

    expect(document.querySelector('#issue-list .fail-text').textContent)
      .toBe('エラー: 台帳が読めません');
    // 器に出す断りにも、次にすることを添える (消えないので後から見た人にも伝わる)
    expect(document.querySelector('#issue-list .fail-next').textContent).toMatch(/^次にすること: /);
  });

  it('失敗しても押し直せる', () => {
    const app = mount({ apiCommit: new Error('もう変わっています') });
    const commit = document.getElementById('commit-btn');
    commit.click();

    document.querySelector('#side-body form input').value = '第3条を改訂';
    document.querySelector('#side-body form .btn-primary').click();

    // 戻さないと二度と押せなくなる。失敗したのに押し直せないがいちばん困る
    expect(app.calls.some((c) => c.name === 'apiCommit')).toBe(true);
    expect(commit.disabled).toBe(false);
    expect(snack()).toContain('記録できませんでした');
    expect(snack()).toContain('もう変わっています');
  });

  it('黙って済ませるものは、跡だけ残す', () => {
    const seen = [];
    const warn = window.console.warn;
    window.console.warn = (text) => seen.push(String(text));

    try {
      mount({ apiTagList: new Error('読めません') });
    } finally {
      window.console.warn = warn;
    }

    // 以前は空の関数だったため、失敗したことがどこにも残らなかった
    expect(snack()).toBe('');
    expect(seen.join('\n')).toContain('選べないだけで手で書ける: 読めません');
  });

  it('前置きを添えて何ができなかったかを伝える', () => {
    openIssues({ apiIssueCreate: new Error('題がありません') });
    document.getElementById('issue-create-btn').click();

    document.querySelector('#side-body form input').value = 'x';
    document.querySelector('#side-body form .btn-primary').click();

    // サーバからの文だけでは、押した操作と結び付かないことがある
    expect(snack()).toContain('題がありません');
  });
});

describe('右のペインの幅', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** やることを1つ開く */
  function openOne(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    return app;
  }

  function handle() {
    return document.getElementById('side-resizer');
  }

  it('掴んで動かせる', () => {
    openOne();

    // 360px 固定だと、補足や差分のように中身が長いものが縦に細長く伸び、
    // 読むのに送り続けることになる
    expect(handle().getAttribute('role')).toBe('separator');

    handle().dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const width = document.documentElement.style.getPropertyValue('--side-pane-w');

    expect(width).not.toBe('');
    expect(window.localStorage.getItem('sidePaneWidth'))
      .toBe(parseInt(width, 10) + '');
  });

  it('二度押しで元の幅に戻せる', () => {
    openOne();
    handle().dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    // 行き過ぎたときに戻す手立てが要る
    handle().dispatchEvent(new window.MouseEvent('dblclick'));

    expect(document.documentElement.style.getPropertyValue('--side-pane-w'))
      .toBe('');
    expect(window.localStorage.getItem('sidePaneWidth')).toBeNull();
  });

  it('掴み手はペインと一緒に出入りする', () => {
    openOne();

    // 片方だけ触ると、閉じているのに分け目の線だけが宙に残る
    expect(document.getElementById('side-panel').hidden).toBe(false);
    expect(handle().hidden).toBe(false);

    document.getElementById('side-close').click();
    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(handle().hidden).toBe(true);
  });

  it('入力を出すときにも掴み手が出る', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    expect(handle().hidden).toBe(true);

    document.getElementById('issue-create-btn').click();
    expect(handle().hidden).toBe(false);
  });

  it('広げられるのに縮まない形にしない', () => {
    openOne();
    const css = document.querySelector('style').textContent;
    const rule = css.substring(css.indexOf('\n.side-panel {'));

    // flex の既定 (min-width: auto) は中身より小さくならない
    expect(rule.substring(0, rule.indexOf('}'))).toContain('min-width: 0');
    expect(rule.substring(0, rule.indexOf('}')))
      .toContain('flex: 0 0 var(--side-pane-w)');
  });

  it('狭い画面では掴ませない', () => {
    openOne();
    const css = document.querySelector('style').textContent;

    // 縦積みになるため境界は掴めない
    expect(css).toMatch(/@media \(max-width: 767px\) \{[^}]*\.resizer \{ display: none/);
  });
});

describe('カードの幅', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 宣言の塊を取り出す */
  function ruleOf(selector) {
    const css = document.querySelector('style').textContent;
    const at = css.indexOf('\n' + selector + ' {');

    expect(at, selector + ' が見つからない').toBeGreaterThan(-1);
    return css.substring(at, css.indexOf('}', at));
  }

  it('行はどれも器いっぱいまで伸びる', () => {
    mount();

    // button の既定 width: auto は中身に合わせて縮むため、<button> の
    // 一覧 (確認依頼・要望) だけ題の長さで幅が変わっていた
    ['.row-item', '.usage-person'].forEach(function (sel) {
      const rule = ruleOf(sel);

      expect(rule, sel).toContain('width: stretch');
      // stretch を知らない環境のための控え
      expect(rule, sel).toContain('width: -webkit-fill-available');
      expect(rule, sel).toContain('width: -moz-available');
    });
  });

  it('幅の指定に 100% は使わない', () => {
    mount();

    // 左右に margin があるぶんだけはみ出す (実際に右端が見切れた)
    const rule = ruleOf('.row-item');

    expect(rule).toContain('margin: 0 var(--sp-4)');
    expect(rule).not.toContain('width: 100%');
  });

  it('確認依頼と要望の行も同じクラスで組む', () => {
    mount({
      apiInquiryList: [{
        number: 3, kind: 'bug', kindLabel: 'うまく動かない',
        title: 'とても長い題を付けたときにカードの右端が揃わない',
        body: 'x', by: 'me@example.com', state: 'open', context: '',
        answer: '', at: '2026-09-09T00:00:00.000Z', answeredAt: '',
        replyCount: 0,
      }],
    });

    document.querySelector('[data-tab="pulls"]').click();
    const pr = document.querySelector('#pr-list .row-item');

    document.querySelector('[data-tab="report"]').click();
    const report = document.querySelector('#report-list .row-item');

    // 一覧ごとに別のクラスを当てると、幅の直しが片方にしか効かない
    expect(pr.tagName).toBe('BUTTON');
    expect(report.tagName).toBe('BUTTON');
    expect(pr.classList.contains('row-item')).toBe(true);
    expect(report.classList.contains('row-item')).toBe(true);
  });
});

describe('上の見出し', () => {
  it('左の行き先を開くと、その名前が見出しに出る (どれも「文書」に倒れない)', () => {
    mount({ apiSettings: { scrumEnabled: true, canEdit: true, productGoal: '', definitionOfDone: '', glossary: {} } });
    // 名前の表に足し忘れると、既定の「文書」が出る (使われ方・要望で実際にそうなっていた)
    [...document.querySelectorAll('.sidebar .nav-item[data-tab]')].forEach((btn) => {
      btn.click();
      const label = btn.querySelector('.nav-label').textContent.trim();
      expect(document.getElementById('doc-title').textContent, btn.dataset.tab).toBe(label);
    });
  });
});

describe('スマホ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('主な行き先を下の帯に並べ、押すとその画面を開いて現在地にする', () => {
    mount();
    const items = [...document.querySelectorAll('#mobile-nav .mobile-nav-item')];
    // 4つに絞る。改訂中の版は「メニュー」から
    expect(items.map((b) => b.textContent)).toEqual(['ホーム', '文書', 'やること', '確認依頼', 'メニュー']);
    expect(items[0].getAttribute('aria-current')).toBe('true');

    items[2].click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(items[2].getAttribute('aria-current')).toBe('true');
    expect(items[0].getAttribute('aria-current')).toBe('false');
  });

  it('「メニュー」で行き先の引き出しを開き、選ぶか外側を押すと閉じる', () => {
    mount();
    const sidebar = document.getElementById('sidebar');
    const menu = document.getElementById('mobile-nav-menu');
    const scrim = document.querySelector('.nav-scrim');

    menu.click();
    expect(sidebar.classList.contains('drawer-open')).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(scrim.hidden).toBe(false);

    // 下の帯に無い行き先を選ぶと閉じ、「メニュー」を現在地にする
    sidebar.querySelector('[data-tab="help"]').click();
    expect(sidebar.classList.contains('drawer-open')).toBe(false);
    expect(scrim.hidden).toBe(true);
    expect(menu.classList.contains('is-here')).toBe(true);
    // 現在地は読み上げにも伝える
    expect(menu.getAttribute('aria-current')).toBe('true');

    menu.click();
    scrim.click();
    expect(sidebar.classList.contains('drawer-open')).toBe(false);

    menu.click();
    // 開いているあいだ、後ろの画面には焦点を行かせない
    expect(document.querySelector('.main').hasAttribute('inert')).toBe(true);
    expect(document.getElementById('mobile-nav').hasAttribute('inert')).toBe(true);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sidebar.classList.contains('drawer-open')).toBe(false);
    expect(document.querySelector('.main').hasAttribute('inert')).toBe(false);
    // 閉じたら「メニュー」へ焦点を戻す
    expect(document.activeElement).toBe(menu);
  });

  it('下の帯にも件数を出す (左の行き先は引き出しの中で見えない)', async () => {
    mount();
    const issues = document.querySelector('#mobile-nav [data-go="issues"]');
    const count = issues.querySelector('.mobile-nav-count');
    const src = document.getElementById('count-todos');
    src.textContent = '7';
    src.hidden = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe('7');
    expect(issues.getAttribute('aria-label')).toBe('やること (7)');
  });

  it('改訂版の一覧では、行の捨てるボタンを畳まない (そこが唯一の入口)', () => {
    const css = document.querySelector('style').textContent;
    expect(css).toMatch(/#issue-list \.row-item \.btn-danger \{ display: none; \}/);
    expect(css).not.toMatch(/\n\s*\.row-item \.btn-danger \{ display: none; \}/);
  });
});

describe('横断検索', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function type(text) {
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = text;
    input.dispatchEvent(new window.Event('input'));
    return input;
  }
  const key = (el, k, extra) => el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));

  it('打つと種類ごとに候補が出る。合った部分に印が付き、字は字のまま', () => {
    mount({ apiSearchIndex: DEFAULTS.apiSearchIndex.concat([{ kind: 'issue', number: 30, key: '', title: '<b>就業</b>&', state: 'open', archived: false }]) });
    type('就業');
    const box = document.getElementById('search-results');
    expect(box.hidden).toBe(false);
    expect(Array.from(box.querySelectorAll('.search-group-head')).map((h) => h.textContent)).toEqual(['文書', 'やること', '確認依頼']);
    expect(box.querySelector('mark').textContent).toBe('就業');
    expect(box.textContent).toContain('<b>就業</b>&');
    expect(box.querySelector('b')).toBeNull();
  });

  it('↑↓ で選び Enter で開く。やることは右のパネルに、選んだもの', () => {
    // 開くときは一覧から引き直すので、候補の #12 と #1 を一覧にも置く
    mount({ apiIssueList: DEFAULTS.apiIssueList.concat([
      Object.assign({}, DEFAULTS.apiIssueList[1], { number: 12, title: '賃金規程の見直し', parent: '' }),
      Object.assign({}, DEFAULTS.apiIssueList[1], { number: 1, title: '就業規則の改定', parent: '' }),
    ]) });
    // 「規」で 文書 → #12 → #1 → #13 → … と並ぶ。下へ3つ・上へ1つで #12 を選ぶ
    const input = type('規');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'ArrowDown');
    key(input, 'ArrowUp');
    const picked = document.getElementById(input.getAttribute('aria-activedescendant'));
    expect(picked.textContent).toContain('#12');
    key(input, 'Enter');
    const side = document.getElementById('side-panel');
    expect(side.hidden).toBe(false);
    expect(side.textContent).toContain('賃金規程の見直し');
    expect(side.textContent).not.toContain('就業規則の改定');
    expect(document.getElementById('search-results').hidden).toBe(true);
    expect(input.value).toBe('');
  });

  it('文書は本文を、確認依頼はその依頼を、改訂中の版と報告はその画面を開く (選んだものが開く)', () => {
    const PR2 = Object.assign({}, DEFAULTS.apiPrList[0], { number: 2, title: '就業規則 第3条の改定' });
    const app = mount({
      apiListFiles: DEFAULTS.apiListFiles.concat([{ fileId: 'DOC2', path: '賃金規程.doc', type: 'doc' }]),
      apiSearchIndex: DEFAULTS.apiSearchIndex.concat([
        { kind: 'doc', number: 0, key: 'DOC2', title: '賃金規程.doc', state: '', archived: false },
        { kind: 'pull', number: 2, key: '', title: '就業規則 第3条の改定', state: 'open', archived: false },
      ]).filter((x) => !(x.kind === 'pull' && x.number === 1)).concat([
        { kind: 'pull', number: 1, key: '', title: '第2条の改訂', state: 'open', archived: false },
      ]),
      apiPrList: DEFAULTS.apiPrList.concat([PR2]),
    });
    const last = (name) => app.calls.filter((c) => c.name === name).pop();

    type('賃金規程.doc');
    document.querySelector('#search-results [data-kind="doc"]').click();
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(last('apiGetFileHtml').args[0]).toBe('DOC2');

    type('第3条');
    document.querySelector('#search-results [data-kind="pull"]').click();
    expect(document.getElementById('panel-pulls').hidden).toBe(false);
    expect(last('apiPrReviews').args[0]).toBe(2);
    expect(document.getElementById('pr-detail').textContent).toContain('第3条の改定');

    type('見直し');
    document.querySelector('#search-results [data-kind="branch"]').click();
    expect(document.getElementById('panel-branches').hidden).toBe(false);

    type('棒が');
    document.querySelector('#search-results [data-kind="inquiry"]').click();
    expect(document.getElementById('panel-report').hidden).toBe(false);
    // 報告がその番号で開くことは「報告を選ぶと、その報告が開く」が見ている
  });

  it('Esc で閉じる。合わなければ「見つかりませんでした」', () => {
    mount();
    const input = type('ありえない字');
    expect(document.getElementById('search-results').textContent).toContain('見つかりませんでした');
    key(input, 'Escape');
    expect(document.getElementById('search-results').hidden).toBe(true);
  });

  it('かなの変換中の Enter と Esc は、候補を開かず欄も閉じない', () => {
    mount();
    const input = type('就業');
    key(input, 'Enter', { isComposing: true });
    expect(document.getElementById('search-results').hidden).toBe(false);
    expect(document.getElementById('panel-content').hidden).toBe(true);
    expect(input.value).toBe('就業');
    key(input, 'Escape', { isComposing: true });
    expect(document.getElementById('search-results').hidden).toBe(false);
    key(input, 'Enter', { keyCode: 229 });
    expect(document.getElementById('search-results').hidden).toBe(false);
    expect(input.value).toBe('就業');
  });

  it('右の欄が開いていても、欄の中の Esc は探すのだけを閉じる', () => {
    mount();
    document.querySelector('.nav-item[data-tab="issues"]').click();
    key(document.body, '?');
    expect(document.getElementById('side-panel').hidden).toBe(false);
    const input = type('就業');
    key(input, 'Escape');
    expect(document.getElementById('search-results').hidden).toBe(true);
    expect(document.getElementById('side-panel').hidden).toBe(false);
  });

  it('Ctrl+K と ⌘K でどの画面からでも欄へ移る', () => {
    mount();
    document.querySelector('.nav-item[data-tab="issues"]').click();
    key(document.body, 'k', { ctrlKey: true });
    expect(document.activeElement.id).toBe('search-input');
    document.activeElement.blur();
    key(document.body, 'k', { metaKey: true });
    expect(document.activeElement.id).toBe('search-input');
  });

  it('一覧は1回だけ取る (60秒以内は取り直さない)', () => {
    const app = mount();
    type('就業');
    document.getElementById('search-input').dispatchEvent(new window.Event('blur'));
    type('賃金');
    expect(app.calls.filter((c) => c.name === 'apiSearchIndex')).toHaveLength(1);
  });

  it('取れないときはその場に知らせる', () => {
    mount({ apiSearchIndex: () => new Error('混み合っています') });
    type('就業');
    expect(document.getElementById('search-results').textContent).toMatch(/探せませんでした.*混み合っています/);
  });

  it('返事を待つあいだに打った字で、届いてから絞る。閉じていれば出さず、画面も変えない', () => {
    let late = null;
    mount({ apiSearchIndex: () => ({ later: (ok) => { late = ok; } }) });
    type('就業');
    late(DEFAULTS.apiSearchIndex);
    expect(document.getElementById('search-results').textContent).toContain('就業規則の改定');

    let late2 = null;
    mount({ apiSearchIndex: () => ({ later: (ok) => { late2 = ok; } }) });
    const input = type('就業');
    key(input, 'Escape');
    // 候補の先頭はやること (issues) なので、それ以外の画面で返事を受ける
    document.querySelector('.nav-item[data-tab="pulls"]').click();
    late2(DEFAULTS.apiSearchIndex);
    expect(document.getElementById('search-results').hidden).toBe(true);
    expect(document.getElementById('panel-pulls').hidden).toBe(false);
    expect(document.getElementById('panel-issues').hidden).toBe(true);
    expect(document.getElementById('panel-content').hidden).toBe(true);
    expect(document.querySelector('.nav-item[data-tab="pulls"]').getAttribute('aria-current')).toBe('true');
  });

  it('返事を待つあいだに一覧を動かす操作があったら、届いたものは使うが次に欄へ入ったとき取り直す', () => {
    const lates = [];
    const app = mount({ apiSearchIndex: () => ({ later: (ok) => { lates.push(ok); } }) });
    const indexCalls = () => app.calls.filter((c) => c.name === 'apiSearchIndex').length;
    key(document.body, 'k', { ctrlKey: true });
    document.activeElement.blur();
    expect(indexCalls()).toBe(1);
    // 返事が届く前に、やることを完了にする
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
    lates[0](DEFAULTS.apiSearchIndex);
    // 届いたものは使える
    const input = type('就業');
    expect(document.getElementById('search-results').textContent).toContain('就業規則の改定');
    // が、取ったばかりとは扱わない (完了にする前の中身なので)
    expect(indexCalls()).toBe(2);
    input.blur();
  });

  it('字を残したまま欄に戻ると、打ち直さなくても候補が出る', () => {
    mount();
    const input = type('就業');
    input.dispatchEvent(new window.Event('blur'));
    expect(document.getElementById('search-results').hidden).toBe(true);
    input.dispatchEvent(new window.Event('focus'));
    expect(document.getElementById('search-results').hidden).toBe(false);
    expect(document.getElementById('search-results').textContent).toContain('就業規則の改定');
  });

  it('狭い画面で開いた欄は、Tab で次へ移るとき閉じる', () => {
    mount();
    document.getElementById('search-open').click();
    const input = document.getElementById('search-input');
    input.value = '就業';
    input.dispatchEvent(new window.Event('input'));
    expect(document.querySelector('.search-box').classList.contains('is-open')).toBe(true);
    const ev = new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(document.querySelector('.search-box').classList.contains('is-open')).toBe(false);
    expect(document.getElementById('search-results').hidden).toBe(true);
    // 次への移動は止めない
    expect(ev.defaultPrevented).toBe(false);
  });

  it('変換中の Tab では閉じない', () => {
    mount();
    document.getElementById('search-open').click();
    const input = document.getElementById('search-input');
    key(input, 'Tab', { isComposing: true });
    expect(document.querySelector('.search-box').classList.contains('is-open')).toBe(true);
  });

  it('捨てたもの (#13) を選ぶと、置き場を開いてその行を指す', () => {
    const app = mount({
      apiIssueArchivedList: [
        { number: 9, title: '別のもの', state: 'open', archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 20 },
        { number: 13, title: '就業規則 古い案', state: 'open', archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22 },
      ],
    });
    type('古い案');
    document.querySelector('#search-results [data-kind="issue"]').click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('trash-list').hidden).toBe(false);
    expect(document.querySelector('#trash-list [aria-current="true"]').textContent).toContain('#13');
    expect(document.getElementById('snackbar')).toBeNull();
    // 置き場は1回だけ読む
    expect(app.calls.filter((c) => c.name === 'apiIssueArchivedList')).toHaveLength(1);
  });

  it('探して置き場へ移っても、次に開くときの見え方は変えない', () => {
    // 覚えると、以後ずっと「捨てたもの」で開くようになる
    window.localStorage.setItem('issueView', 'board');
    mount({
      apiIssueArchivedList: [{ number: 13, title: '就業規則 古い案', state: 'open', archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22 }],
    });
    type('古い案');
    document.querySelector('#search-results [data-kind="issue"]').click();
    expect(document.getElementById('trash-list').hidden).toBe(false);
    expect(window.localStorage.getItem('issueView')).toBe('board');
  });

  it('置き場が取れなかったら、指す先は捨てる (後で開いても古い行を指さない)', () => {
    let n = 0;
    const LIST = [{ number: 13, title: '就業規則 古い案', state: 'open', archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22 }];
    mount({ apiIssueArchivedList: () => (++n === 1 ? new Error('混み合っています') : LIST) });
    type('古い案');
    document.querySelector('#search-results [data-kind="issue"]').click();
    expect(document.getElementById('trash-list').textContent).toContain('混み合っています');
    document.getElementById('view-trash').click();
    expect(n).toBe(2);
    expect(document.getElementById('trash-list').textContent).toContain('#13');
    expect(document.querySelector('#trash-list [aria-current="true"]')).toBeNull();
  });

  describe('一覧を動かす操作のあとは取り直す。読むだけなら取り直さない', () => {
    const indexCalls = (app) => app.calls.filter((c) => c.name === 'apiSearchIndex').length;
    const touch = () => { key(document.body, 'k', { ctrlKey: true }); document.activeElement.blur(); };

    it('やることを完了にしたあと', () => {
      const app = mount();
      touch();
      document.querySelector('[data-tab="issues"]').click();
      document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
      expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
      touch();
      expect(indexCalls(app)).toBe(2);
    });

    it('報告を解決にしたあと', () => {
      const R = { number: 6, kind: 'bug', kindLabel: 'うまく動かない', title: '新しい報告', body: '新しい報告', by: 'me@example.com',
        state: 'open', context: '', answer: '', at: '2026-09-09T00:00:00.000Z', answeredAt: '', mine: true, canClose: true, replyCount: 0 };
      const app = mount({
        apiSearchIndex: [{ kind: 'inquiry', number: 6, key: '', title: '新しい報告', state: 'open', archived: false }],
        apiInquiryList: [R],
        apiInquiryThread: { inquiry: R, replies: [] },
      });
      type('新しい');
      document.querySelector('#search-results [data-kind="inquiry"]').click();
      expect(indexCalls(app)).toBe(1);
      document.querySelector('#report-detail .pr-actions .btn').click();
      expect(app.calls.some((c) => c.name === 'apiInquiryClose')).toBe(true);
      touch();
      expect(indexCalls(app)).toBe(2);
    });

    it('一覧を読むだけなら取り直さない', () => {
      const app = mount();
      touch();
      document.querySelector('[data-tab="issues"]').click();
      expect(app.calls.some((c) => c.name === 'apiIssueList')).toBe(true);
      touch();
      expect(indexCalls(app)).toBe(1);
    });
  });

  describe('報告を選ぶと、その報告が開く', () => {
    const R = (number, title, state) => ({
      number, kind: 'bug', kindLabel: 'うまく動かない', title, body: title, by: 'other@example.com',
      state, context: '', answer: '', at: '2026-09-09T00:00:00.000Z', answeredAt: '', mine: false,
      canClose: false, replyCount: 0,
    });
    const LIST = [R(6, '新しい報告', 'open'), R(5, '棒が伸びない', 'done')];
    const over = {
      apiSearchIndex: [{ kind: 'inquiry', number: 5, key: '', title: '棒が伸びない', state: 'done', archived: false }],
      apiInquiryList: LIST,
      apiInquiryThread: (n) => ({ inquiry: LIST.filter((r) => r.number === n)[0], replies: [] }),
    };
    const opened = (app) => app.calls.filter((c) => c.name === 'apiInquiryThread').pop().args[0];

    it('済んだ報告 (「未解決だけ」で外れるもの)', () => {
      const app = mount(over);
      type('棒が');
      document.querySelector('#search-results [data-kind="inquiry"]').click();
      expect(opened(app)).toBe(5);
      expect(document.querySelector('#report-list [aria-current="true"]').dataset.number).toBe('5');
    });

    it('報告の絞り込みに字が残っていても', () => {
      const app = mount(over);
      document.querySelector('[data-tab="report"]').click();
      const filter = document.getElementById('report-filter');
      filter.value = '新しい';
      filter.dispatchEvent(new window.Event('input'));
      type('棒が');
      document.querySelector('#search-results [data-kind="inquiry"]').click();
      expect(opened(app)).toBe(5);
      expect(filter.value).toBe('');
    });
  });

  it('狭い画面で開いた欄は、外側を押すと閉じる。中を押しても閉じない', () => {
    mount();
    document.getElementById('search-open').click();
    const box = document.querySelector('.search-box');
    document.getElementById('search-input').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(box.classList.contains('is-open')).toBe(true);
    document.querySelector('main, #panel-home, body').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(box.classList.contains('is-open')).toBe(false);
  });

  it('一覧の見出しを押しても候補は閉じない (欄から抜けない)', () => {
    mount();
    type('就業');
    const head = document.querySelector('#search-results .search-group-head');
    const ev = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    head.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // 行を押せば今までどおり開く
    document.querySelector('#search-results [data-kind="doc"]').click();
    expect(document.getElementById('panel-content').hidden).toBe(false);
  });

  it('選んだ行を外して打ち直すと、aria-activedescendant を残さない', () => {
    mount();
    const input = type('就業');
    key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    input.value = '就業規';
    input.dispatchEvent(new window.Event('input'));
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    key(input, 'ArrowDown');
    input.value = 'ありえない字';
    input.dispatchEvent(new window.Event('input'));
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('この画面でやることを作ったら、次に欄へ入ったとき一覧を取り直す', () => {
    const app = mount();
    key(document.body, 'k', { ctrlKey: true });
    document.activeElement.blur();
    expect(app.calls.filter((c) => c.name === 'apiSearchIndex')).toHaveLength(1);

    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    document.querySelector('#side-body form input').value = '新しいやること';
    document.querySelector('#side-body form .btn-primary').click();
    expect(app.calls.some((c) => c.name === 'apiIssueCreate')).toBe(true);

    key(document.body, 'k', { ctrlKey: true });
    expect(app.calls.filter((c) => c.name === 'apiSearchIndex')).toHaveLength(2);
  });

  it('狭い画面のボタンで欄が開き、Esc で閉じる', () => {
    mount();
    document.getElementById('search-open').click();
    expect(document.querySelector('.search-box').classList.contains('is-open')).toBe(true);
    expect(document.activeElement.id).toBe('search-input');
    key(document.activeElement, 'Escape');
    expect(document.querySelector('.search-box').classList.contains('is-open')).toBe(false);
  });
});

describe('割合で決まる幅の掴み手', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--graph-pane-w');
  });

  it('起動の時点で測れるなら、その幅を値にする', () => {
    const orig = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      const next = this.nextElementSibling;
      if (next && next.id === 'diff-resizer') {
        return { left: 0, right: 480, top: 0, bottom: 0, width: 480, height: 0 };
      }
      return orig.call(this);
    };
    try {
      mount();
      expect(document.getElementById('diff-resizer').getAttribute('aria-valuenow')).toBe('480');
    } finally {
      window.Element.prototype.getBoundingClientRect = orig;
    }
  });

  it('隠れていて測れなかったペインも、掴み手に触れた時に測り直す', () => {
    mount();
    const handle = document.getElementById('diff-resizer');
    expect(handle.hasAttribute('aria-valuenow')).toBe(false);

    handle.previousElementSibling.getBoundingClientRect =
      () => ({ left: 0, right: 520, top: 0, bottom: 0, width: 520, height: 0 });
    handle.dispatchEvent(new window.FocusEvent('focus'));
    expect(handle.getAttribute('aria-valuenow')).toBe('520');
  });

  it('既定が割合のペインは、今の幅を測って値にし、矢印でそこから動く', () => {
    mount();
    const handle = document.getElementById('diff-resizer');
    // 既定は 46% 。字のまま数えると 46 になり、下限より小さい値を名乗る
    expect(handle.getAttribute('aria-valuenow')).not.toBe('46');

    const pane = handle.previousElementSibling;
    pane.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 0, width: 500, height: 0 });

    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(document.documentElement.style.getPropertyValue('--graph-pane-w')).toBe('516px');
    expect(handle.getAttribute('aria-valuenow')).toBe('516');
  });
});
