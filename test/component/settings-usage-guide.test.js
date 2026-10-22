// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountApp, DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';

describe('触れたときの補足', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('分かりにくい言葉には補足が付く', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    // 使い方の頁を読みに行かないと分からない道具は、読みに行かれない
    const seg = document.getElementById('view-gantt');
    expect(seg.dataset.hint).toContain('棒');
    expect(seg.classList.contains('has-hint')).toBe(true);
  });

  it('補足は読み上げにも届く', () => {
    mount();
    const seg = document.getElementById('view-board');
    const note = document.getElementById(seg.getAttribute('aria-describedby'));

    expect(note.textContent).toBe(seg.dataset.hint);
  });

  it('控えは1か所にまとめて置く', () => {
    mount();

    // 隣に差し込むと、並びで組んでいるところの形が変わる
    const notes = document.getElementById('hint-notes');
    expect(notes.className).toBe('sr-only');
    expect(notes.children.length).toBeGreaterThan(5);
  });

  it('ブラウザ既定の吹き出しと二重にしない', () => {
    mount();
    const seg = document.getElementById('view-list');

    expect(seg.getAttribute('title')).toBe(null);
    expect(seg.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('操作のアイコンにも付く', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const del = document.querySelector('#issue-list .btn-danger');
    expect(del.dataset.hint).toContain('戻せます');
    expect(del.getAttribute('aria-label')).toContain('捨てる');
  });
});

describe('使われ方を数える', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const SUMMARY = {
    from: '2026-08-12', to: '2026-09-10', total: 30,
    byTarget: [
      { kind: 'action', target: 'issue-create-btn', count: 12 },
      { kind: 'action', target: 'row-open', count: 6 },
      { kind: 'view', target: 'issues', count: 9 },
    ],
    byDay: [
      { day: '2026-09-09', count: 10 },
      { day: '2026-09-10', count: 20 },
    ],
  };

  it('押した場所を数える', () => {
    const app = mount();
    document.getElementById('bell-btn').click();

    // すぐには送らない。押すたびに送るとシートが持たない
    expect(app.calls.some((c) => c.name === 'apiUsageRecord')).toBe(false);
  });

  it('画面を開いたら送るときに一緒に出す', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.getElementById('bell-btn').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    const keys = rows.map((r) => r.kind + ':' + r.target);

    expect(keys).toContain('action:bell-btn');
    expect(keys).toContain('view:usage');
  });

  it('名前の無いところは数えない', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.querySelector('.layout').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    expect(rows.every((r) => r.target)).toBe(true);
  });

  it('一覧の行は種類でまとめて数える', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    expect(rows.map((r) => r.target)).toContain('row-open');
  });

  it('同じところを2回押したら2と数える', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.getElementById('bell-btn').click();
    document.getElementById('bell-btn').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    expect(rows.filter((r) => r.target === 'bell-btn')[0].count).toBe(2);
  });
});

describe('使われ方のボード', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const SUMMARY = {
    from: '2026-08-12', to: '2026-09-10', total: 30,
    byTarget: [
      { kind: 'action', target: 'issue-create-btn', count: 12 },
      { kind: 'action', target: 'row-open', count: 6 },
      { kind: 'view', target: 'issues', count: 9 },
    ],
    byDay: [
      { day: '2026-09-09', count: 10 },
      { day: '2026-09-10', count: 20 },
    ],
    byUser: [
      { who: 'other@example.com', count: 20 },
      { who: 'me@example.com', count: 10 },
    ],
  };

  function openBoard(over) {
    const app = mount(Object.assign({ apiUsageSummary: SUMMARY }, over || {}));
    document.querySelector('[data-tab="usage"]').click();
    return app;
  }

  it('誰でも開ける場所に置く', () => {
    openBoard();
    expect(document.getElementById('panel-usage').hidden).toBe(false);
  });

  it('人が読める言葉に直して並べる', () => {
    openBoard();
    const names = [...document.querySelectorAll('#usage .usage-name')]
      .map((n) => n.textContent);

    expect(names).toContain('やることを作る');
    expect(names).toContain('やること・報告の行を開く');
  });

  it('押す物は全部、id のままではなく名前で出る (wiki.html の全ボタン・画面が付ける id・決まった形の id)', async () => {
    const fs = await import('node:fs');
    const wiki = fs.readFileSync('src/ui/wiki.html', 'utf8');
    const ids = [...wiki.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    const js = fs.readdirSync('src/ui').filter((f) => /\.html$/.test(f) && f !== 'wiki.html')
      .map((f) => fs.readFileSync('src/ui/' + f, 'utf8')).join('\n');
    const tracks = [...js.matchAll(/dataset\.track = '([a-z-]+)'/g)].map((m) => m[1]);
    const made = ['cache-clear', 'calendar-mine', 'calendar-team', 'game-join-toggle', 'game-toggle', 'outcomes-refresh',
      'progress-toggle', 'scrum-toggle', 'style-again', 'style-copy', 'style-forget', 'style-image', 'style-share', 'style-submit',
      'md-save', 'oshi-choose', 'search-open', 'style-use-planner', 'search-opt-3', 'scrum-text-goal', 'error:timeout'];
    const targets = [...new Set([...ids, ...tracks, ...made])];
    expect(targets.length).toBeGreaterThan(40);
    // 板は上位 15 か所までしか並べないので、15 ずつに分けて開き直す
    const raw = [];
    for (let at = 0; at < targets.length; at += 15) {
      const part = targets.slice(at, at + 15);
      openBoard({ apiUsageSummary: Object.assign({}, SUMMARY, {
        byTarget: part.map((t, i) => ({ kind: 'action', target: t, count: 100 - i })),
      }) });
      const rows = [...document.querySelectorAll('#usage .usage-name')].map((n) => n.textContent);
      expect(rows.length).toBeGreaterThanOrEqual(part.length);
      part.forEach((t) => { if (rows.indexOf(t) >= 0) raw.push(t); });
    }
    expect(raw, '名前の無い id').toEqual([]);
  });

  it('操作と画面を分けて並べる', () => {
    openBoard();
    const heads = [...document.querySelectorAll('#usage h3')]
      .map((h) => h.textContent);

    expect(heads).toEqual([
      'よく使っている人', 'よく押されている操作', 'よく開かれている画面',
      'この期間に開かれなかった画面', '曜日ごと', '日ごと',
    ]);
  });

  it('多いものほど棒が長い', () => {
    openBoard();
    const bars = [...document.querySelectorAll('#usage .usage-list')][0]
      .querySelectorAll('.usage-bar');

    expect(bars[0].style.width).toBe('100%');
    expect(parseInt(bars[1].style.width, 10)).toBeLessThan(100);
  });

  it('日ごとの高さも比べられる', () => {
    openBoard();
    const days = document.querySelectorAll('#usage .usage-day-bar');

    expect(days).toHaveLength(2);
    expect(days[1].style.height).toBe('100%');
  });

  it('期間を変えられる', () => {
    const app = openBoard();

    document.getElementById('usage-days').value = '7';
    document.getElementById('usage-days')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiUsageSummary').pop().args[0])
      .toBe(7);
  });

  it('まだ何も無ければ何が出るのかを言う', () => {
    openBoard({
      apiUsageSummary: {
        from: '', to: '', total: 0, byTarget: [], byDay: [], byUser: [],
      },
    });

    expect(document.getElementById('usage').textContent)
      .toContain('どこがよく押されているか');
  });

  it('何を数えているかを画面にも書く', () => {
    openBoard();

    // 押した順番や時刻までは残していない
    expect(document.getElementById('panel-usage').textContent)
      .toContain('順番や時刻は残していません');
  });

  it('よく使っている人を多い順に並べる', () => {
    openBoard();
    const rows = [...document.querySelectorAll('#usage .usage-person')];

    expect(rows.map((r) => r.querySelector('.usage-name').textContent))
      .toEqual(['鈴鈴木 花子', '山山田 太郎']);
    expect(rows[0].querySelector('.usage-rank').textContent).toBe('1');
  });

  it('人を押すとその人のぶんに絞る', () => {
    const app = openBoard();
    document.querySelector('#usage .usage-person').click();

    expect(app.calls.filter((c) => c.name === 'apiUsageSummary').pop().args[1])
      .toBe('other@example.com');
  });

  it('対象を選び直せる', () => {
    const app = openBoard();

    expect([...document.querySelectorAll('#usage-who option')]
      .map((o) => o.textContent))
      .toEqual(['みんなの合計', '鈴木 花子', '山田 太郎']);

    document.getElementById('usage-who').value = 'me@example.com';
    document.getElementById('usage-who')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiUsageSummary').pop().args[1])
      .toBe('me@example.com');
  });

  it('誰のぶんを見ているかを出す', () => {
    openBoard({
      apiUsageSummary: Object.assign({}, SUMMARY, { who: 'me@example.com' }),
    });

    expect([...document.querySelectorAll('#usage .tally-card')]
      .map((c) => c.textContent).join(' ')).toContain('山田 太郎');
  });
});

describe('使われ方を前の期間と比べる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const SUMMARY = {
    from: '2026-08-12', to: '2026-09-10', total: 30, who: '',
    byTarget: [
      { kind: 'action', target: 'issue-create-btn', count: 12 },
      { kind: 'action', target: 'row-open', count: 6 },
      { kind: 'view', target: 'issues', count: 9 },
      { kind: 'view', target: 'usage', count: 3 },
    ],
    byDay: [{ day: '2026-09-10', count: 30 }],
    byUser: [{ who: 'me@example.com', count: 30 }],
    byWeekday: [10, 0, 5, 0, 0, 0, 15],
    prev: {
      total: 20,
      byTarget: [
        { kind: 'action', target: 'issue-create-btn', count: 10 },
        { kind: 'action', target: 'row-open', count: 8 },
        { kind: 'view', target: 'issues', count: 9 },
      ],
    },
  };

  function openBoard(over) {
    const app = mount(Object.assign({ apiUsageSummary: SUMMARY }, over || {}));
    document.querySelector('[data-tab="usage"]').click();
    return app;
  }

  function countCard() {
    return [...document.querySelectorAll('#usage .tally-card')]
      .find((c) => c.textContent.includes('数えた回数'));
  }

  function blockOf(title) {
    return [...document.querySelectorAll('#usage .tally-block')]
      .find((b) => b.querySelector('h3').textContent === title);
  }

  it('回数に前の期間との増減を添える', () => {
    openBoard();
    // 20 → 30 は 50% 増
    expect(countCard().querySelector('.usage-delta').textContent).toBe('↑ 50%');
  });

  it('減ったときは下向きで出す', () => {
    openBoard({ apiUsageSummary: Object.assign({}, SUMMARY, {
      prev: { total: 40, byTarget: [] },
    }) });
    expect(countCard().querySelector('.usage-delta').textContent).toBe('↓ 25%');
  });

  it('前の期間が0なら、割合を出さずにそう言う', () => {
    openBoard({ apiUsageSummary: Object.assign({}, SUMMARY, {
      prev: { total: 0, byTarget: [] },
    }) });
    expect(countCard().querySelector('.usage-delta').textContent).toBe('前の期間は記録なし');
  });

  it('前の期間を持たない返事でも描ける', () => {
    openBoard({ apiUsageSummary: Object.assign({}, SUMMARY, { prev: undefined, byWeekday: undefined }) });
    expect(countCard().querySelector('.usage-delta').textContent).toBe('前の期間は記録なし');
    expect(blockOf('曜日ごと').querySelectorAll('.usage-row')).toHaveLength(7);
  });

  it('順位表にも前の期間との差を小さく添える', () => {
    openBoard();
    const deltas = [...blockOf('よく押されている操作').querySelectorAll('.usage-delta')]
      .map((d) => d.textContent);
    expect(deltas).toEqual(['+2', '−2']);

    const views = [...blockOf('よく開かれている画面').querySelectorAll('.usage-delta')]
      .map((d) => d.textContent);
    // 前に無かった場所は、そのまま増えたぶん
    expect(views).toEqual(['±0', '+3']);
  });

  it('この期間に開かれなかった画面を、左の行き先から並べる', () => {
    openBoard();
    const names = [...blockOf('この期間に開かれなかった画面').querySelectorAll('.chip')]
      .map((c) => c.textContent);

    expect(names).toContain('ホーム');
    expect(names).toContain('文書');
    expect(names).toContain('設定');
    expect(names).not.toContain('やること');
    expect(names).not.toContain('使われ方');
    // スクラムがオフのあいだは、出ない画面を数えない
    expect(names).not.toContain('作業期間');
    expect(names).not.toContain('困りごと');
  });

  it('スクラムがオンなら、その画面も並べる', () => {
    openBoard({ apiSettings: {
      scrumEnabled: true, gameEnabled: false, canEdit: true, queue: null,
      productGoal: '', definitionOfDone: '', glossary: {}, 
    } });
    const names = [...blockOf('この期間に開かれなかった画面').querySelectorAll('.chip')]
      .map((c) => c.textContent);
    expect(names).toContain('作業期間');
  });

  it('全部開かれていればそう言う', () => {
    openBoard({ apiUsageSummary: Object.assign({}, SUMMARY, {
      byTarget: ['home', 'docs', 'issues', 'branches', 'pulls', 'sprint', 'impediments',
        'help', 'usage', 'report', 'settings']
        .map((t) => ({ kind: 'view', target: t, count: 1 })),
    }) });
    const block = blockOf('この期間に開かれなかった画面');
    expect(block.querySelectorAll('.chip')).toHaveLength(0);
    expect(block.textContent).toContain('どの画面も開かれていました');
  });

  it('曜日ごとに月曜から7本の棒で出す', () => {
    openBoard();
    const rows = [...blockOf('曜日ごと').querySelectorAll('.usage-row')];
    expect(rows.map((r) => r.querySelector('.usage-name').textContent))
      .toEqual(['月', '火', '水', '木', '金', '土', '日']);
    expect(rows[6].querySelector('.usage-bar').style.width).toBe('100%');
    expect(rows[6].querySelector('.usage-count').textContent).toBe('15');
  });
});

describe('使われ方を CSV で保存する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ROWS = {
    from: '2026-08-12', to: '2026-09-10', who: '',
    rows: [
      { day: '2026-09-09', kind: 'view', target: 'issues', user: 'me@example.com', count: 3 },
      { day: '2026-09-10', kind: 'action', target: 'issue-create-btn', user: '', count: 2 },
      { day: '2026-09-10', kind: 'action', target: '-x', user: '', count: 1 },
    ],
  };

  function openBoard(over) {
    const app = mount(Object.assign({
      apiUsageSummary: {
        from: '2026-08-12', to: '2026-09-10', total: 5, who: '',
        byTarget: [{ kind: 'view', target: 'issues', count: 5 }],
        byDay: [], byUser: [], byWeekday: [0, 0, 0, 0, 0, 0, 0], prev: { total: 0, byTarget: [] },
      },
      apiUsageRows: ROWS,
    }, over || {}));
    document.querySelector('[data-tab="usage"]').click();
    return app;
  }

  it('今見ている期間と対象で頼む', () => {
    const app = openBoard();
    document.getElementById('usage-days').value = '7';
    document.getElementById('usage-csv-btn').click();

    expect(app.calls.filter((c) => c.name === 'apiUsageRows').pop().args)
      .toEqual([7, '']);
  });

  it('保存できないときは、字をそのまま見せて写せるようにする', () => {
    openBoard();
    document.getElementById('usage-csv-btn').click();

    const code = document.querySelector('#usage .copy-row code');
    expect(code).toBeTruthy();
    const lines = code.textContent.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('日,種類,場所,名前,人,回数');
    expect(lines[1]).toBe('2026-09-09,画面,issues,やること,me@example.com,3');
    expect(lines[2]).toBe('2026-09-10,操作,issue-create-btn,やることを作る,,2');
    // 表計算で式として読まれないようにする
    expect(lines[3]).toBe("2026-09-10,操作,'-x,'-x,,1");
  });

  it('見られない人のぶんが入っていないことを添える', () => {
    openBoard();
    document.getElementById('usage-csv-btn').click();

    expect(document.querySelector('#usage .usage-export').textContent)
      .toContain('見られない人のぶんは入っていません');
  });

  it('期間を変えたあとに届いた古い CSV は出さない', () => {
    let late = null;
    openBoard({ apiUsageRows: () => ({ later: (ok) => { late = ok; } }) });
    document.getElementById('usage-csv-btn').click();

    document.getElementById('usage-days').value = '7';
    document.getElementById('usage-days')
      .dispatchEvent(new window.Event('change', { bubbles: true }));
    late(ROWS);

    expect(document.querySelector('#usage .usage-export')).toBeNull();
    expect(document.getElementById('usage-csv-btn').disabled).toBe(false);
  });

  it('期間を変えたあとに届いた古いまとめで描き直さない', () => {
    const lates = [];
    openBoard({
      apiUsageSummary: (days) => (days === 90
        ? { later: (ok) => { lates.push(ok); } }
        : {
          from: '2026-09-04', to: '2026-09-10', total: 7, who: '',
          byTarget: [{ kind: 'view', target: 'issues', count: 7 }],
          byDay: [], byUser: [], byWeekday: [0, 0, 0, 0, 0, 0, 0], prev: { total: 0, byTarget: [] },
        }),
    });
    const sel = document.getElementById('usage-days');
    sel.value = '90';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    sel.value = '7';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    lates[0]({
      from: '2026-06-13', to: '2026-09-10', total: 999, who: '',
      byTarget: [], byDay: [], byUser: [], byWeekday: [0, 0, 0, 0, 0, 0, 0], prev: { total: 0, byTarget: [] },
    });
    expect(document.getElementById('usage').textContent).toContain('7回');
    expect(document.getElementById('usage').textContent).not.toContain('999回');
  });

  it('保存できるならファイルとして落とす', () => {
    const made = [];
    const orig = window.URL.createObjectURL;
    const origRevoke = window.URL.revokeObjectURL;
    const origClick = window.HTMLAnchorElement.prototype.click;
    window.URL.createObjectURL = () => 'blob:usage';
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function () { made.push(this.download); };
    try {
      openBoard();
      document.getElementById('usage-csv-btn').click();
    } finally {
      window.URL.createObjectURL = orig;
      window.URL.revokeObjectURL = origRevoke;
      window.HTMLAnchorElement.prototype.click = origClick;
    }
    expect(made).toEqual(['usage-2026-08-12_2026-09-10.csv']);
  });
});

describe('自分まわりの操作', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.open = () => {};
  });

  function openMe() {
    const app = mount();
    document.getElementById('me-btn').click();
    return app;
  }

  function actions() {
    return [...document.querySelectorAll('#me-body .btn')]
      .map((b) => b.textContent);
  }

  it('上の帯からいつでも開ける', () => {
    openMe();

    // 使い方の頁の底に置くと、困ったときにしか開かれない場所に埋もれる
    expect(document.getElementById('me-panel').hidden).toBe(false);
    expect(actions()).toEqual([
      '手元から動かす道具を落とす', '表示する名前を決める', '仕事のスタンス診断',
      'はじめの案内をもう一度出す', '推し', '実績', '前進の知らせを出す',
    ]);
  });

  it('自分の顔と名前を出す', () => {
    openMe();

    expect(document.getElementById('me-btn').querySelector('.avatar')
      .textContent).toBe('山');
    expect(document.getElementById('me-who').textContent).toBe('山田 太郎');
    expect(document.getElementById('me-body').textContent)
      .toContain('me@example.com');
  });

  it('道具を落とせる', () => {
    let opened = '';
    window.open = (url) => { opened = url; };

    const app = openMe();
    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('手元から動かす道具')).click();

    expect(app.calls.some((c) => c.name === 'apiAgentKit')).toBe(true);
    expect(opened).toContain('drive.google.com');
  });

  it('名前を決められる', () => {
    const app = openMe();
    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('表示する名前')).click();

    const input = document.querySelector('#side-body input');
    expect(input.value).toBe('山田 太郎');

    input.value = '山田 一郎';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiPeopleSetName').pop().args)
      .toEqual(['me@example.com', '山田 一郎']);
  });

  it('はじめの案内を出し直せる', () => {
    mount();
    document.getElementById('guideline-hide').click();

    document.getElementById('me-btn').click();
    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('もう一度出す')).click();

    expect(document.getElementById('guideline').hidden).toBe(false);
    expect(document.getElementById('me-panel').hidden).toBe(true);
  });

  it('閉じられる', () => {
    openMe();
    document.getElementById('me-close').click();

    expect(document.getElementById('me-panel').hidden).toBe(true);
  });

  it('使い方でも読み物より先に置く', () => {
    mount();
    document.querySelector('[data-tab="help"]').click();

    const guide = document.getElementById('guide');
    const top = guide.querySelector('.guide-top');
    const firstHead = guide.querySelector('h2');

    expect(top).toBeTruthy();
    expect(top.compareDocumentPosition(firstHead) &
      window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('道具の更新', () => {
    const OLD = { apiKitStatus: { print: 'abcd1234', mine: '00000000', outdated: true } };
    const kitBtn = () => [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('手元から動かす道具'));

    it('古い道具を持つ人の顔に点を出す', () => {
      mount(OLD);
      const me = document.getElementById('me-btn');
      expect(me.querySelector('.me-dot')).not.toBeNull();
      expect(me.getAttribute('aria-label')).toContain('道具の更新あり');
    });

    it('自分まわりの道具のボタンに「更新あり」', () => {
      mount(OLD);
      document.getElementById('me-btn').click();
      expect(kitBtn().textContent).toContain('更新あり');
    });

    it('落とし直すと点も札も消える', () => {
      mount(OLD);
      document.getElementById('me-btn').click();
      kitBtn().click();
      expect(document.getElementById('me-btn').querySelector('.me-dot')).toBeNull();
      // 落とすと自分の欄は閉じる (続きの手順を右に出す)。欄の中身は開いたときに描くので、開き直して見る
      document.getElementById('me-btn').click();
      expect(kitBtn().textContent).not.toContain('更新あり');
    });

    it('新しければ何も出さない', () => {
      mount();
      expect(document.getElementById('me-btn').querySelector('.me-dot')).toBeNull();
    });

    it('取れなくても画面は動く', () => {
      mount({ apiKitStatus: new Error('止まっています') });
      expect(document.getElementById('me-btn').querySelector('.avatar')).not.toBeNull();
      expect(document.getElementById('me-btn').querySelector('.me-dot')).toBeNull();
    });
  });
});

describe('はじめての設定の案内', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    mount();
    document.querySelector('[data-tab="help"]').click();
    return document.getElementById('guide').textContent;
  }

  it('エディタでやることだけを名指しする', () => {
    const text = openHelp();

    expect(text).toContain('setupRepo');
    expect(text).toContain('setupCommandQueue');

    // 文書の登録は画面からできる。id を調べさせるのは使う人の仕事ではない
    expect(text).not.toContain('debugRegisterFile');
    expect(text).toContain('文書を登録する');
  });

  it('承認を求められることを先に伝える', () => {
    // 初回に出る Google の画面で止まる人がいちばん多い
    expect(openHelp()).toContain('アクセスを承認してください');
  });

  it('二人目以降は設定が要らないと書く', () => {
    expect(openHelp()).toContain('二人目からは');
  });

  it('つまずいたときの見どころを書く', () => {
    expect(openHelp()).toContain('実行数');
  });

  it('スクラムは既定でオフで、どこでオンにするかを書く', () => {
    const text = openHelp();

    // 使わない人が多い。オンにする場所が書いていないと、使いたい人が辿り着けない
    expect(text).toContain('既定ではオフ');
    expect(text).toContain('「設定」で「期間で進める」をオンに');
    expect(text).toContain('node agent.mjs scrum');
    expect(text).toContain('SCRUM.md');
  });

  it('手元から動かす手順も具体に書く', () => {
    const text = openHelp();

    expect(text).toContain('node agent.mjs files');
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('Node.js 18 以上');
  });
});

describe('道具を落としたあとの案内', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.open = () => {};
  });

  function download() {
    const app = mount();
    document.getElementById('me-btn').click();

    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('手元から動かす道具')).click();

    return app;
  }

  it('落としたら続きの手順が出る', () => {
    download();

    // zip を渡して終わりにすると、設定に何を書けばよいか分からず止まる
    const steps = [...document.querySelectorAll('#side-body .setup-steps li strong')]
      .map((s) => s.textContent);

    expect(steps).toEqual(['zip を広げる', 'Google ドライブを同期する', '入れ先を設定に書く']);
  });

  it('入れ先の場所を写せる形で出す', () => {
    download();

    const code = document.querySelector('#side-body .copy-line code');
    expect(code.textContent).toContain('.git/queue');
    expect(document.querySelector('#side-body .copy-line .btn').textContent)
      .toBe('写す');
  });

  it('その場所を Drive で開ける', () => {
    download();

    const link = [...document.querySelectorAll('#side-body a')]
      .find((a) => a.textContent.includes('Drive で開く'));

    expect(link.href).toContain('drive.google.com/drive/folders/');
    expect(link.target).toBe('_blank');
  });

  it('通ったかの確かめ方を書く', () => {
    download();

    expect(document.getElementById('side-body').textContent)
      .toContain('node agent.mjs files');
  });

  it('自分の設定の画面は閉じる', () => {
    download();

    // 案内が後ろに隠れると気づかれない
    expect(document.getElementById('me-panel').hidden).toBe(true);
    expect(document.getElementById('side-panel').hidden).toBe(false);
  });
});

describe('左上の名前', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('名前と読みを出す', () => {
    mount();
    const brand = document.getElementById('brand');

    expect(brand.querySelector('.brand-name').textContent).toBe('SoftBanto');
    expect(brand.querySelector('.brand-sub').textContent).toBe('そふと番頭');
    expect(brand.querySelector('.brand-tag').textContent)
      .toBe('AIで文書とタスクを管理するシステム');
  });

  it('何をする道具かは印と名前の下に置く', () => {
    mount();
    const brand = document.getElementById('brand');

    // 名前の横に足すと、260px の帯では名前が潰れる。上から
    // 印と名前 → 何をする道具か → どこを見ているか の順に積む
    expect([...brand.children].map((el) => el.classList[0]))
      .toEqual(['brand-row', 'brand-tag', 'brand-place']);
    expect(brand.querySelector('.brand-row .brand-name')).toBeTruthy();
    expect(brand.querySelector('.brand-row .brand-tag')).toBeNull();
  });

  it('印は字と同じ色で描く', () => {
    mount();
    const mark = document.querySelector('#brand .brand-mark');

    // 画像を置かない。読み込みを増やさず、明るい地でも暗い地でも読める
    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelectorAll('path').length).toBeGreaterThan(2);
  });

  it('栞だけは色を変える', () => {
    mount();

    expect(document.querySelector('#brand .brand-mark-fill')).toBeTruthy();
  });

  it('触れると何の道具かが出る', () => {
    mount();

    expect(document.getElementById('brand').dataset.hint)
      .toContain('番頭');
  });

  it('左の並びの先頭にある', () => {
    mount();
    const sidebar = document.querySelector('.sidebar');

    expect(sidebar.firstElementChild.id).toBe('brand');
  });
});

describe('どのワークスペースを見ているか', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('ロゴの下に置き場所の名前を出す', () => {
    mount();

    // 同じ道具を複数のワークスペースに置くと、画面だけでは見分けが
    // 付かず、別のところの文書を直してしまう
    const place = document.querySelector('#brand .brand-place');

    expect(place.querySelector('.brand-place-name').textContent)
      .toBe('総務共有');
    expect(document.getElementById('brand').lastElementChild).toBe(place);
  });

  it('押すとその場所を開ける', () => {
    mount();
    const place = document.querySelector('#brand .brand-place');

    expect(place.tagName).toBe('A');
    expect(place.href).toContain('PLACE');
    expect(place.target).toBe('_blank');
    expect(place.rel).toBe('noopener');
  });

  it('上からの道のりも添える', () => {
    mount();

    expect(document.querySelector('#brand .brand-place').dataset.hint)
      .toContain('総務共有/agentic-management');
  });

  it('場所が分からないときは何も出さない', () => {
    // 空の器を先に置くと、名前が届いたときに左上の段がずれる
    mount({ apiWorkspace: { name: '', path: '', url: '' } });

    expect(document.querySelector('#brand .brand-place')).toBeNull();
    expect(document.querySelector('#brand .brand-name')).toBeTruthy();
  });

  it('リンクが無いときは字だけ出す', () => {
    mount({ apiWorkspace: { name: 'マイドライブ', path: '', url: '' } });
    const place = document.querySelector('#brand .brand-place');

    expect(place.tagName).toBe('SPAN');
    expect(place.textContent).toContain('マイドライブ');
  });

  it('長い名前でも左の帯を広げない', () => {
    mount({
      apiWorkspace: {
        name: 'とても長い名前のワークスペース共有フォルダ2026年度版',
        path: 'x', url: '',
      },
    });
    const css = document.querySelector('style').textContent;
    const rule = css.substring(css.indexOf('\n.brand-place-name {'));

    expect(rule.substring(0, rule.indexOf('}')))
      .toContain('text-overflow: ellipsis');
  });
});

describe('使い方の目次', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    mount();
    document.querySelector('[data-tab="help"]').click();
    return document.getElementById('guide-toc');
  }

  function items(toc) {
    return [...toc.querySelectorAll('.guide-toc-item')];
  }

  it('本文の右に、節の数だけ並ぶ', () => {
    const toc = openHelp();
    const heads = [...document.querySelectorAll('#guide h2')];

    // 節を足して目次に載らないと、そこだけ辿り着けない。
    // 見出しの横の札 (管理者) は目次には載せない
    expect(items(toc).map((b) => b.textContent))
      .toEqual(heads.map((h) => h.querySelector('.guide-head-text').textContent));
  });

  it('本文の隣に置く', () => {
    const toc = openHelp();
    const guide = document.getElementById('guide');

    /*
     * 本文は 760px で止まるので、その右は空いている。左の帯に出していた
     * ときは、道具そのものの行き先と混ざって何の目次か分からず、開くたびに
     * 左の並びが動いていた。
     */
    expect(guide.nextElementSibling).toBe(toc);
    expect(toc.closest('#panel-help')).toBeTruthy();
    expect(document.querySelector('.sidebar .guide-toc-item')).toBeNull();
  });

  it('何の目次かを言う', () => {
    const toc = openHelp();

    expect(toc.querySelector('h2').textContent).toBe('この頁の中身');
    expect(toc.getAttribute('aria-label')).toBe('使い方の目次');
  });

  it('左の並びを動かさない', () => {
    mount();
    const before = [...document.querySelectorAll('.sidebar .nav-item')].length;

    // 開くたびに左が伸び縮みすると、押したい行の位置が変わる
    document.querySelector('[data-tab="help"]').click();
    expect([...document.querySelectorAll('.sidebar .nav-item')].length)
      .toBe(before);
  });

  it('押すとその節へ寄る', () => {
    const toc = openHelp();
    const heads = [...document.querySelectorAll('#guide h2')];
    const seen = [];

    heads.forEach((h) => { h.scrollIntoView = () => seen.push(h.textContent); });
    items(toc)[3].click();

    expect(seen).toEqual([heads[3].textContent]);
  });

  it('飛び先ではなく押して寄せる', () => {
    const toc = openHelp();

    // 枠の中で動いているため、場所を変えると外側の頁ごと動くことがある
    expect(toc.querySelectorAll('a')).toHaveLength(0);
    expect(items(toc)[0].tagName).toBe('BUTTON');
  });

  it('いま読んでいる節を示す', () => {
    const toc = openHelp();
    const list = items(toc);
    const guide = document.getElementById('guide');

    // jsdom は位置を持たないので、見出しの位置を差し込んで送る
    const heads = [...document.querySelectorAll('#guide h2')];
    heads.forEach((h, i) => {
      Object.defineProperty(h, 'offsetTop', { value: 40 + i * 500 });
    });

    /** @param {number} to */
    function scrollTo(to) {
      guide.scrollTop = to;
      guide.dispatchEvent(new window.Event('scroll'));
      return list.map((b) => b.getAttribute('aria-current'));
    }

    // 色だけでは気づけない人がいるので aria-current でも示す。
    // 示すのは必ず1つ。0個だと目次が死んで見え、2個だとどちらか分からない
    // 底は節の数から決める (節を足すたびに直さなくてよいように)
    const far = heads.length * 500;
    [0, 1100, far].forEach(function (at) {
      expect(scrollTo(at).filter((v) => v === 'true')).toHaveLength(1);
    });

    expect(scrollTo(0)[0]).toBe('true');
    expect(scrollTo(1100)[2]).toBe('true');
    expect(scrollTo(1100)[0]).toBe('false');
    expect(scrollTo(far)[list.length - 1]).toBe('true');
  });

  it('送っても上に残す', () => {
    openHelp();
    const css = document.querySelector('style').textContent;
    const rule = css.substring(css.indexOf('\n.guide-aside {'));

    // 底の節からでも一息で戻れるようにする
    expect(rule.substring(0, rule.indexOf('}'))).toContain('position: sticky');
  });

  it('狭い画面では出さない', () => {
    openHelp();
    const css = document.querySelector('style').textContent;

    // 本文の幅が足りなくなる。見出しは本文の中にあるので、無くても辿れる
    expect(css).toMatch(
      /@media \(max-width: 1023px\) \{[^}]*\.guide-aside \{ display: none/);
  });

  it('色だけで現在地を示さない', () => {
    openHelp();
    const css = document.querySelector('style').textContent;
    const at = css.indexOf("\n.guide-toc-item[aria-current='true'] {");
    const rule = css.substring(at, css.indexOf('}', at));

    expect(rule).toContain('border-left-color');
    expect(rule).toContain('font-weight');
  });
});

describe('使い方の図', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp(style) {
    mount(style ? { apiPrefs: prefsFixture({ values: { 'terms.style': style } }) } : undefined);
    document.querySelector('[data-tab="help"]').click();
    return [...document.querySelectorAll('#guide .diagram')];
  }

  const TITLES = [
    '文書が変わっていく道のり',
    '言葉どうしのつながり',
    '基本の流れ（押す順に）',
    'ホームの見方',
    '文書と工程表の見え方',
    'はじめての設定（最初の一人だけ）',
    '手元から動かすときの往復',
    '同じ場所が両方で変わったとき',
    '作業期間の1巡り（使う人だけ）',
    '改善のヒントが出るまで',
    '使われ方で数えるもの',
    '設定でできること',
    '今から始めて、やりきるまで',
    'やることが予定に入るまで',
    '仕事のスタンス診断',
    '目標を立てて、期末にまとめるまで',
    '推しが応援するまで',
    '実績から推しがなつくまで',
    '推しの機嫌が変わるとき',
    '楽しい演出 (当たり・ご褒美)',
    '作業部屋で作業する',
    '作業雑談部屋に入って出るまで',
  ];

  it('どの節にも図がある', () => {
    const figures = openHelp();
    const heads = [...document.querySelectorAll('#guide h2')];

    // 図だけ見て帰れるようにする。ここが節の数と食い違うと、
    // 図が無い節が生まれ、そこだけ読まれない
    expect(figures).toHaveLength(heads.length);
    expect(figures.map((f) => f.querySelector('title').textContent))
      .toEqual(TITLES);
  });

  it('その節の説明より先に置く', () => {
    const figures = openHelp();
    const guide = [...document.getElementById('guide').children];

    // 見出し → 図 → 箇条書き の順。図が下に回ると読まれない
    figures.forEach((fig) => {
      const at = guide.indexOf(fig);

      expect(guide[at - 1].tagName).toBe('H2');
      expect(guide[at + 1].tagName).toBe('UL');
    });
  });

  it('読み上げにも中身が届く', () => {
    const figures = openHelp();

    figures.forEach((fig) => {
      const svg = fig.querySelector('svg');

      expect(svg.getAttribute('role')).toBe('img');
      // 図が読めない人には desc だけが届く。題だけでは何も伝わらない
      expect(svg.querySelector('desc').textContent.length)
        .toBeGreaterThan(40);
    });
    expect(figures[0].querySelector('desc').textContent)
      .toContain('正式版');
  });

  it('外から何も取ってこない', () => {
    openHelp();
    const js = document.querySelector('style').textContent;

    // 図を描く道具を足すと読み込みが1つ増える
    expect(document.querySelectorAll('script[src*="mermaid"]')).toHaveLength(0);
    expect(js).toContain('.diagram-box');
  });

  it('向きのある線には先が付き、地の線には付かない', () => {
    const figures = openHelp();
    const arrows = [...figures[0].querySelectorAll('.diagram-arrow')];
    const withHead = arrows.filter((a) => a.getAttribute('marker-end'));
    const bare = arrows.filter((a) => !a.getAttribute('marker-end'));

    expect(withHead.length).toBeGreaterThan(0);
    withHead.forEach((a) => {
      expect(a.getAttribute('marker-end')).toMatch(/^url\(#arrow-\d+(-soft)?\)$/);
    });
    // 帯の底や時間の流れ。先が2つ並ぶとどちらへ向かうのか読めなくなる
    expect(bare.length).toBeGreaterThan(0);
    expect(figures[0].querySelector('marker path')).toBeTruthy();
  });

  it('図どうしで矢印の名前がぶつからない', () => {
    const figures = openHelp();
    const ids = figures.map((f) => f.querySelector('marker').id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('言葉での断りも添える', () => {
    const figures = openHelp();

    figures.forEach((fig) => {
      expect(fig.querySelector('figcaption').textContent.length)
        .toBeGreaterThan(10);
    });
    expect(figures[0].querySelector('figcaption').textContent)
      .toContain('正式版は直接なおしません');
    const kit = figures.find((f) => f.querySelector('title').textContent === '手元から動かすときの往復');
    expect(kit.querySelector('figcaption').textContent).toContain('Node.js 18');
  });

  [undefined, 'scrum'].forEach((style) => it('描いたものが枠から出ない (' + (style || '一般の言葉') + ')', () => {
    const figures = openHelp(style);

    figures.forEach((fig) => {
      const svg = fig.querySelector('svg');
      const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);

      // はみ出したぶんは切られて見えなくなる。座標を手で置いている
      // ぶん、足したときに気付けないと黙って欠ける
      svg.querySelectorAll('rect').forEach((el) => {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));

        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + Number(el.getAttribute('width'))).toBeLessThanOrEqual(w);
        expect(y + Number(el.getAttribute('height'))).toBeLessThanOrEqual(h);
      });

      svg.querySelectorAll('text').forEach((el) => {
        expect(Number(el.getAttribute('y'))).toBeGreaterThan(0);
        expect(Number(el.getAttribute('y'))).toBeLessThanOrEqual(h);
        expect(Number(el.getAttribute('x'))).toBeGreaterThanOrEqual(0);
        expect(Number(el.getAttribute('x'))).toBeLessThanOrEqual(w);
      });

      svg.querySelectorAll('circle').forEach((el) => {
        const r = Number(el.getAttribute('r'));

        expect(Number(el.getAttribute('cx')) - r).toBeGreaterThanOrEqual(0);
        expect(Number(el.getAttribute('cx')) + r).toBeLessThanOrEqual(w);
        expect(Number(el.getAttribute('cy')) + r).toBeLessThanOrEqual(h);
      });
    });
  }));

  it('箱どうしが重ならない', () => {
    const figures = openHelp();

    figures.forEach((fig, at) => {
      const boxes = [...fig.querySelectorAll('rect.diagram-box')].map((el) => ({
        x: Number(el.getAttribute('x')),
        y: Number(el.getAttribute('y')),
        w: Number(el.getAttribute('width')),
        h: Number(el.getAttribute('height')),
      }));

      // 重なると下の箱の字が読めなくなる。座標は手で置いている
      boxes.forEach((a, i) => {
        boxes.slice(i + 1).forEach((b) => {
          const over = a.x < b.x + b.w && b.x < a.x + a.w &&
                       a.y < b.y + b.h && b.y < a.y + a.h;

          expect(over, TITLES[at] + ' の箱が重なっている').toBe(false);
        });
      });
    });
  });

  it('狭い画面では縮めずに横へ流す', () => {
    openHelp();
    const css = document.querySelector('style').textContent;

    // 幅に合わせて縮めると字が潰れて読めない図になる
    expect(css).toMatch(/\.diagram\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.diagram svg\s*\{[^}]*min-width:\s*680px/);
  });
});

describe('使い方を強くする', () => {
  let seen;
  let before;
  beforeEach(() => {
    window.localStorage.clear();
    seen = [];
    // jsdom は位置を持たないので、寄せた先だけを控える。ほかのテストが置いた控えは戻す
    before = Object.getOwnPropertyDescriptor(window.Element.prototype, 'scrollIntoView');
    window.Element.prototype.scrollIntoView = function () { seen.push(this.id); };
  });
  afterEach(() => {
    if (before) Object.defineProperty(window.Element.prototype, 'scrollIntoView', before);
    else delete window.Element.prototype.scrollIntoView;
  });

  function openHelp(over) {
    const app = mount(over);
    document.querySelector('.nav-item[data-tab="help"]').click();
    return app;
  }

  function filter(text) {
    const input = document.getElementById('guide-filter');
    input.value = text;
    input.dispatchEvent(new window.Event('input'));
    return input;
  }

  const shownHeads = () => [...document.querySelectorAll('#guide h2')]
    .filter((h) => !h.hidden).map((h) => h.id);
  const shownToc = () => [...document.querySelectorAll('#guide-toc .guide-toc-item')]
    .filter((b) => !b.hidden).map((b) => b.textContent);

  /** 溜めた数を送らせて、使い方の節を開いた数だけを取り出す */
  function guideViews(app) {
    document.querySelector('.nav-item[data-tab="usage"]').click();
    const out = {};
    app.calls.filter((c) => c.name === 'apiUsageRecord').forEach((c) => {
      c.args[0].forEach((r) => {
        if (r.kind === 'view' && /^guide-/.test(r.target)) out[r.target] = (out[r.target] || 0) + r.count;
      });
    });
    return out;
  }

  it('節はどれも英数の名前を持ち、新しい4つの節がある', () => {
    openHelp();
    const ids = [...document.querySelectorAll('#guide h2')].map((h) => h.id);

    // 見出しの id は guide-sec- で始める。画面の部品 (guide-filter / guide-link など) とぶつけない
    ids.forEach((id) => expect(id).toMatch(/^guide-sec-[a-z]+$/));
    expect(new Set(ids).size).toBe(ids.length);
    ['guide-sec-home', 'guide-sec-view', 'guide-sec-usage', 'guide-sec-settings'].forEach((id) => {
      expect(ids).toContain(id);
    });
  });

  it('新しい節は、決めた中身に触れている', () => {
    openHelp();
    const text = (id) => {
      const h = document.getElementById(id);
      let el = h.nextElementSibling;
      while (el && el.tagName !== 'UL') el = el.nextElementSibling;
      return el.textContent;
    };

    // ホームのカードは6つ (HOME_CARDS)。ポイントはチームの設定でオンのときだけ
    ['あなたの番', '改善のヒント', '草', 'ポイントとレベル', '称号', '最近の動き', 'チームの前進', 'ホームに出すもの']
      .forEach((w) => expect(text('guide-sec-home')).toContain(w));
    ['全画面', 'リンクをコピー', '幅', '日・週・月', '今日']
      .forEach((w) => expect(text('guide-sec-view')).toContain(w));
    ['数えない', '本人と部下', '止め', 'CSV', '曜日', '前の期間', '開かれなかった画面', '見られない人のぶん', '90日']
      .forEach((w) => expect(text('guide-sec-usage')).toContain(w));
    ['自分の設定', 'チームの設定', '通知', '止め', '既定に戻す', '毎月の目標', 'ポイントとレベル', '鈴']
      .forEach((w) => expect(text('guide-sec-settings')).toContain(w));
    const homeFig = [...document.querySelectorAll('#guide .diagram')]
      .find((f) => f.querySelector('title').textContent === 'ホームの見方');
    expect(homeFig.querySelectorAll('rect.diagram-box')).toHaveLength(6);
    expect(homeFig.querySelector('desc').textContent).toContain('チームの前進');
  });

  it('後から足した機能にも節があり、決めた中身に触れている', () => {
    openHelp();
    const text = (id) => {
      const h = document.getElementById(id);
      let el = h.nextElementSibling;
      while (el && el.tagName !== 'UL') el = el.nextElementSibling;
      return el.textContent;
    };

    // 推し・実績・機嫌・楽しい演出・作業部屋・作業雑談部屋。どれも画面にあるのに、使い方に節が無かった
    ['使うキャラ', 'あいさつ', '2頭身', '新しいキャラを作る', 'AI に作ってもらう', 'AI の答えを貼る',
      '緑の背景を抜く', '1枚の表から切り分ける', '実在の人の顔', '許し']
      .forEach((w) => expect(text('guide-sec-oshi')).toContain(w));
    ['なつき度 Lv', 'よそよそしい', 'なれてきた', 'なついた', 'べったり', '家族', '下がりません', '機嫌はその日の気分', 'この環境では取れません', 'クリア', '動画を見る', '消えず']
      .forEach((w) => expect(text('guide-sec-grow')).toContain(w));
    ['最初はオフ', '表情とせりふだけ', '減ったり消えたりしません', 'すぐに機嫌が直って', 'どうして？']
      .forEach((w) => expect(text('guide-sec-mood')).toContain(w));
    ['打つと盛り上がる', '言葉に反応する', '済ませたらお祝い', '大当たり', 'ノリノリタイム', '自分へのご褒美', '最初はオフ']
      .forEach((w) => expect(text('guide-sec-fun')).toContain(w));
    ['雨', 'カフェ', '作業中', 'Esc', '全画面', '動きを減らす', '最初はオフ']
      .forEach((w) => expect(text('guide-sec-room')).toContain(w));
    ['Meet', 'Slack', '入る', '出る', '集中中', '表示名', '2分', '記録しません']
      .forEach((w) => expect(text('guide-sec-cowork')).toContain(w));
    ['YouTube', 'SoundCloud', '読み込む']
      .forEach((w) => expect(text('guide-sec-focus')).toContain(w));
    ['oshi-prompt', 'oshi-spinner', 'track', 'doctor', 'update']
      .forEach((w) => expect(text('guide-sec-local')).toContain(w));
    ['180日', '時間切れ', '管理者だというだけでは', '手元の道具からの命令は数えません', '「?」']
      .forEach((w) => expect(text('guide-sec-usage')).toContain(w));
    // 設定の組 (PREFS_SCHEMA の section) はどれも、最初の値と一緒に挙げる
    ['最初に出す画面', '言葉の表し方', 'ホームに出すもの', '楽しい演出', '思いがけない当たり', '推し', '実績',
      '集中のしかた', '作業部屋', '予定に入れる', '診断の型の名前をチームに見せる', '通知メール', '自分の使われ方を記録する',
      '部屋にいるとき『集中中』を添える', '作業雑談部屋', '「期限が近い」', '残す日数', '改善のヒント', '「動きなし」', '日報の形', '目標', '共有カレンダー']
      .forEach((w) => expect(text('guide-sec-settings')).toContain(w));
  });

  it('後から足した節も、探す (Ctrl+K) から開ける', () => {
    mount();
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '作業雑談部屋';
    input.dispatchEvent(new window.Event('input'));

    const hit = [...document.querySelectorAll('#search-results [data-kind="guide"]')]
      .map((el) => el.textContent);
    expect(hit.some((t) => t.indexOf('作業雑談部屋 (使う人だけ)') >= 0)).toBe(true);
  });

  it('管理者向けの節には札を付ける。隠しはしない', () => {
    openHelp();
    const setup = document.getElementById('guide-sec-setup');

    expect(setup.hidden).toBe(false);
    expect(setup.querySelector('.chip').textContent).toBe('管理者');
    // 札は管理者向けの節だけ
    expect(document.querySelectorAll('#guide h2 .chip')).toHaveLength(1);
  });

  it('絞り込みは本文の上にあり、見出しと行で絞る。目次も同じく絞る', () => {
    openHelp();
    const input = document.getElementById('guide-filter');
    const firstHead = document.querySelector('#guide h2');

    expect(input.getAttribute('aria-label')).toBeTruthy();
    expect(input.compareDocumentPosition(firstHead) &
      window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 行にしか無い語 (setupRepo) でも当たる。全角・大文字でもそろえて比べる
    filter('ＳＥＴＵＰＲＥＰＯ');
    expect(shownHeads()).toEqual(['guide-sec-setup']);
    expect(shownToc()).toEqual(['はじめての設定 (最初の一人だけ)']);

    // 図と箇条書きも一緒に隠れる
    const figures = [...document.querySelectorAll('#guide .diagram')].filter((f) => !f.hidden);
    expect(figures).toHaveLength(1);
    const lists = [...document.querySelectorAll('#guide > ul')].filter((u) => !u.hidden);
    expect(lists).toHaveLength(1);

    filter('');
    expect(shownHeads()).toHaveLength(document.querySelectorAll('#guide h2').length);
  });

  it('何も当たらなければ「見つかりません」と出す', () => {
    openHelp();
    const empty = document.getElementById('guide-empty');

    expect(empty.hidden).toBe(true);
    filter('ありえない言葉ぞぞぞ');
    expect(shownHeads()).toEqual([]);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('見つかりません');

    filter('');
    expect(empty.hidden).toBe(true);
  });

  it('目次から送った節と、絞り込みで1件になった節を数える。打ち足しで数え直さない', () => {
    const app = openHelp();
    const toc = [...document.querySelectorAll('#guide-toc .guide-toc-item')];
    const advice = toc.find((b) => b.textContent === '改善のヒント');

    advice.click();
    expect(seen).toContain('guide-sec-advice');

    // 1件になってから打ち足しても同じ節なら1回
    filter('setupr');
    filter('setupre');
    filter('setuprepo');
    // 2件以上や0件は数えない
    filter('正式版');
    filter('ぞぞぞ');

    expect(guideViews(app)).toEqual({ 'guide-advice': 1, 'guide-setup': 1 });
  });

  it('送って通り過ぎただけの節は数えない', () => {
    const app = openHelp();
    const guide = document.getElementById('guide');

    [...document.querySelectorAll('#guide h2')].forEach((h, i) => {
      Object.defineProperty(h, 'offsetTop', { value: 40 + i * 500 });
    });
    [0, 1100, 4000].forEach((to) => {
      guide.scrollTop = to;
      guide.dispatchEvent(new window.Event('scroll'));
    });

    expect(guideViews(app)).toEqual({});
  });

  it('主な画面の見出しに「?」があり、押すとその節を開く', () => {
    const cases = [
      ['home', 'home'], ['docs', 'flow'], ['issues', 'pitfalls'],
      ['pulls', 'flow'], ['usage', 'usage'], ['settings', 'settings'],
    ];
    cases.forEach(([tab, id]) => {
      mount();
      document.querySelector('.nav-item[data-tab="' + tab + '"]').click();
      const btn = document.querySelector('.guide-link');

      expect(btn.hidden, tab).toBe(false);
      expect(btn.dataset.guide, tab).toBe(id);
      // 字が「?」だけなので、読み上げには何の使い方かを言う
      expect(btn.getAttribute('aria-label'), tab).toContain('使い方');
      expect(btn.tagName).toBe('BUTTON');

      seen = [];
      btn.click();
      expect(document.getElementById('panel-help').hidden, tab).toBe(false);
      expect(seen, tab).toEqual(['guide-sec-' + id]);
    });
  });

  it('工程表では工程表の節を開く', () => {
    mount();
    document.querySelector('.nav-item[data-tab="issues"]').click();
    document.getElementById('view-gantt').click();
    const btn = document.querySelector('.guide-link');

    expect(btn.dataset.guide).toBe('view');
    document.getElementById('view-list').click();
    expect(btn.dataset.guide).toBe('pitfalls');
  });

  it('節の無い画面では「?」を出さない', () => {
    mount();
    document.querySelector('.nav-item[data-tab="help"]').click();
    expect(document.querySelector('.guide-link').hidden).toBe(true);
  });

  it('「?」で開いた節を数え、絞り込みが残っていても見せる', () => {
    const app = openHelp();
    filter('ぞぞぞ');

    document.querySelector('.nav-item[data-tab="usage"]').click();
    document.querySelector('.guide-link').click();

    expect(document.getElementById('guide-sec-usage').hidden).toBe(false);
    expect(document.getElementById('guide-filter').value).toBe('');
    expect(guideViews(app)['guide-usage']).toBe(1);
  });

  it('探す (Ctrl+K) に使い方の節が「使い方」として出て、選ぶとその節を開く', () => {
    const app = mount();
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '改善';
    input.dispatchEvent(new window.Event('input'));

    const box = document.getElementById('search-results');
    const heads = [...box.querySelectorAll('.search-group-head')].map((h) => h.textContent);
    expect(heads).toContain('使い方');
    const row = [...box.querySelectorAll('.search-row')].find((r) => r.dataset.kind === 'guide');
    expect(row.textContent).toContain('改善のヒント');

    row.click();
    expect(document.getElementById('panel-help').hidden).toBe(false);
    expect(seen).toEqual(['guide-sec-advice']);
    expect(guideViews(app)['guide-advice']).toBe(1);
  });

  it('開いた文書の本文では、文書と工程表の節を開く', () => {
    mount();
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
    const btn = document.querySelector('.guide-link');

    expect(btn.hidden).toBe(false);
    expect(btn.dataset.guide).toBe('view');
  });

  it('「?」で開いた見出しに目を移す (読み上げもそこから始まる)', () => {
    mount();
    document.querySelector('.nav-item[data-tab="usage"]').click();
    document.querySelector('.guide-link').click();
    const h = document.getElementById('guide-sec-usage');

    expect(document.activeElement).toBe(h);
    expect(h.getAttribute('tabindex')).toBe('-1');
  });

  it('見出しを押しても、節を開いた数にも操作の数にも入れない', () => {
    const app = openHelp();
    document.getElementById('guide-sec-advice').click();
    document.querySelector('#guide-sec-advice .guide-head-text').click();

    document.querySelector('.nav-item[data-tab="usage"]').click();
    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').flatMap((c) => c.args[0]);
    expect(rows.filter((r) => /^guide-(sec-)?advice$/.test(r.target))).toEqual([]);
  });

  it('一覧が取れていなくても、使い方の節は出す', () => {
    mount({ apiSearchIndex: () => new Error('混み合っています') });
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '改善';
    input.dispatchEvent(new window.Event('input'));

    const box = document.getElementById('search-results');
    expect(box.textContent).toContain('混み合っています');
    expect(box.querySelector('.search-row[data-kind="guide"]').textContent).toContain('改善のヒント');
  });

  it('取りに行っているあいだも、使い方の節は出す', () => {
    mount({ apiSearchIndex: () => ({ later: () => {} }) });
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '改善';
    input.dispatchEvent(new window.Event('input'));

    const box = document.getElementById('search-results');
    expect(box.textContent).toContain('探しています');
    expect(box.querySelector('.search-row[data-kind="guide"]')).toBeTruthy();
  });

  it('使い方を足しても、候補は全体で20件まで', () => {
    const kinds = ['doc', 'issue', 'pull', 'branch', 'inquiry', 'impediment'];
    const many = [];
    kinds.forEach((kind) => {
      for (let i = 1; i <= 6; i++) {
        many.push({ kind, number: i, key: 'K' + i, title: '設定の話 ' + i, state: 'open', archived: false });
      }
    });
    mount({ apiSearchIndex: many });
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '設定';
    input.dispatchEvent(new window.Event('input'));

    const rows = document.querySelectorAll('#search-results .search-row');
    expect(rows.length).toBe(20);
  });

  it('枠が余っていれば、余ったぶんだけ使い方を足す', () => {
    const many = [];
    for (let i = 1; i <= 5; i++) {
      ['doc', 'issue', 'pull'].forEach((kind) => {
        many.push({ kind, number: i, key: 'K' + i, title: '設定の話 ' + i, state: 'open', archived: false });
      });
    }
    // 1種類だけ余りを食う: 5種類目までで 19件にする
    for (let i = 1; i <= 4; i++) {
      many.push({ kind: 'inquiry', number: i, key: '', title: '設定の話 ' + i, state: 'open', archived: false });
    }
    mount({ apiSearchIndex: many });
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '設定';
    input.dispatchEvent(new window.Event('input'));

    const rows = [...document.querySelectorAll('#search-results .search-row')];
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.dataset.kind === 'guide')).toHaveLength(1);
  });

  it('「?」は押しやすい大きさにする', () => {
    mount();
    const css = document.querySelector('style').textContent;
    const at = css.indexOf('\n.guide-link {');
    const rule = css.substring(at, css.indexOf('}', at));

    expect(rule).toMatch(/min-width: 24px/);
    expect(rule).toMatch(/min-height: 24px/);
  });

  it('使われ方では節の見出しで読む', () => {
    mount({
      apiUsageSummary: {
        from: '2026-08-12', to: '2026-09-10', total: 3,
        byTarget: [{ kind: 'view', target: 'guide-advice', count: 3 }],
        byDay: [{ day: '2026-09-10', count: 3 }], byUser: [],
      },
    });
    document.querySelector('.nav-item[data-tab="usage"]').click();

    const text = document.getElementById('usage').textContent;
    expect(text).toContain('使い方: 改善のヒント');
    expect(text).not.toContain('guide-advice');
  });
});

describe('設定の一覧 (#18)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openSettings(over) {
    const app = mount(over);
    document.querySelector('.nav-item[data-tab="settings"]').click();
    return app;
  }
  const field = (key) => document.querySelector('[data-pref="' + key + '"]');
  const sets = (app) => app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args);
  const change = (el, v) => { el.value = String(v); el.dispatchEvent(new window.Event('change', { bubbles: true })); };

  it('自分の設定とチームの設定に分かれ、スクラム・ポイント・キューはチームの設定に入る', () => {
    openSettings();
    const mine = document.getElementById('settings-mine');
    const team = document.getElementById('settings-team');
    expect(mine.querySelector('h2').textContent).toBe('自分の設定');
    expect(team.querySelector('h2').textContent).toBe('チームの設定');
    expect(mine.contains(field('start.tab'))).toBe(true);
    expect(team.contains(field('home.dueDays'))).toBe(true);
    expect(team.contains(document.getElementById('scrum-toggle'))).toBe(true);
    expect(team.contains(document.getElementById('game-toggle'))).toBe(true);
  });

  it('届いた一覧から欄を組む (トグル・数・選択・3つの数)', () => {
    openSettings();
    const toggle = field('notify.review').querySelector('button[role="switch"]');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const due = field('home.dueDays').querySelector('input[type="number"]');
    expect(due.value).toBe('3');
    expect(due.min).toBe('1');
    expect(due.max).toBe('14');
    expect(field('home.dueDays').textContent).toContain('1〜14');
    const sel = field('start.tab').querySelector('select');
    expect([...sel.options].map((o) => o.value)).toEqual(['home', 'issues', 'pulls']);
    expect(sel.value).toBe('home');
    const steps = field('stale.steps').querySelectorAll('input[type="number"]');
    expect([...steps].map((i) => i.value)).toEqual(['7', '14', '30']);
  });

  it('トグルを押すと、その項目だけを書く', () => {
    const app = openSettings();
    field('notify.review').querySelector('button[role="switch"]').click();
    expect(sets(app)).toEqual([['notify.review', false]]);
    expect(field('notify.review').querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('false');
  });

  it('数と選択は変えたときに書く。3つの数はまとめて送る', () => {
    const app = openSettings();
    change(field('home.dueDays').querySelector('input'), 5);
    change(field('start.tab').querySelector('select'), 'issues');
    change(field('stale.steps').querySelectorAll('input')[2], 60);
    expect(sets(app)).toEqual([['home.dueDays', 5], ['start.tab', 'issues'], ['stale.steps', [7, 14, 60]]]);
  });

  it('範囲の外の数は送らず、元の値に戻す', () => {
    const app = openSettings();
    const due = field('home.dueDays').querySelector('input');
    change(due, 99);
    expect(sets(app)).toEqual([]);
    expect(due.value).toBe('3');
    const steps = field('stale.steps').querySelectorAll('input');
    change(steps[0], 20);
    expect(sets(app)).toEqual([]);
    expect(steps[0].value).toBe('7');
  });

  it('書けなかったらトグルを元に戻し、押せるようにする', () => {
    openSettings({ apiPrefSet: new Error('混み合っています') });
    const toggle = field('notify.review').querySelector('button[role="switch"]');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.disabled).toBe(false);
  });

  it('書けなかったら数も元に戻す', () => {
    openSettings({ apiPrefSet: new Error('混み合っています') });
    const due = field('home.dueDays').querySelector('input');
    change(due, 5);
    expect(due.value).toBe('3');
  });

  it('決めた項目にだけ「既定に戻す」を出し、押すと null を送る', () => {
    const app = openSettings({ apiPrefs: prefsFixture({ values: { 'home.dueDays': 6 } }) });
    expect(field('start.tab').querySelector('.pref-reset').hidden).toBe(true);
    const reset = field('home.dueDays').querySelector('.pref-reset');
    expect(reset.hidden).toBe(false);
    reset.click();
    expect(sets(app)).toEqual([['home.dueDays', null]]);
    expect(field('home.dueDays').querySelector('input').value).toBe('3');
    expect(field('home.dueDays').querySelector('.pref-reset').hidden).toBe(true);
  });

  it('管理者でなければ、チームの設定は今の値を読むだけ', () => {
    openSettings({ apiPrefs: prefsFixture({ canEditTeam: false, values: { 'stale.steps': [3, 10, 20] } }) });
    const team = document.getElementById('settings-team');
    expect(field('home.dueDays').querySelector('input')).toBeNull();
    expect(field('home.dueDays').textContent).toContain('3');
    expect(field('stale.steps').textContent).toContain('3 / 10 / 20');
    expect(field('usage.enabled').querySelector('button')).toBeNull();
    expect(field('usage.enabled').textContent).toContain('オン');
    expect(team.textContent).toContain('管理者');
    // 自分の設定は誰でも変えられる
    expect(field('start.tab').querySelector('select')).not.toBeNull();
  });

  it('確認を頼まれた知らせを止めた人には断りを出す', () => {
    openSettings();
    expect(document.getElementById('settings-mine').textContent).not.toContain('確認を頼まれても知らせが届きません');
    field('notify.review').querySelector('button[role="switch"]').click();
    expect(document.getElementById('settings-mine').textContent).toContain('確認を頼まれても知らせが届きません');
  });

  it('チームの毎月の目標を設定から変えられる', () => {
    const app = openSettings({ apiPrefs: prefsFixture({ teamGoal: 8 }),
      apiSetTeamGoal: (n) => ({ weekClosed: 0, weekMerged: 0, monthClosed: 0, goal: n, canEditGoal: true }) });
    const input = document.querySelector('#team-goal-field input');
    expect(input.value).toBe('8');
    change(input, 12);
    expect(app.calls.filter((c) => c.name === 'apiSetTeamGoal').map((c) => c.args)).toEqual([[12]]);
  });

  it('最初に出す画面は自分の設定に従う', () => {
    mount({ apiPrefs: prefsFixture({ values: { 'start.tab': 'issues' } }) });
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(true);
  });

  it('文書のリンクから開いたときは、最初に出す画面を使わない', () => {
    mountApp(Object.assign({}, DEFAULTS, { apiPrefs: prefsFixture({ values: { 'start.tab': 'issues' } }) }),
      { location: { parameter: { doc: 'DOC1', full: '1' }, parameters: {}, hash: '' } });
    expect(document.getElementById('panel-issues').hidden).toBe(true);
  });

  it('設定が届く前に人が移っていたら、最初の画面で奪わない', () => {
    let reply;
    const app = mount({ apiPrefs: { later: (ok) => { reply = ok; } } });
    document.querySelector('.nav-item[data-tab="pulls"]').click();
    reply(prefsFixture({ values: { 'start.tab': 'issues' } }));
    expect(document.getElementById('panel-pulls').hidden).toBe(false);
    expect(app.calls.some((c) => c.name === 'apiPrefs')).toBe(true);
  });

  it('ホームに出さないと決めたものは出さない', () => {
    mount({
      apiPrefs: prefsFixture({ values: { 'home.cards.advice': false, 'home.cards.recent': false,
        'home.cards.game': false, 'home.cards.team': false } }),
      apiGameState: { enabled: true, total: 3, week: 1, level: 1, levelFrom: 0, nextAt: 5, playing: false, badges: [], team: null },
    });
    expect(document.getElementById('home-advice').hidden).toBe(true);
    expect(document.getElementById('home-recent').hidden).toBe(true);
    expect(document.getElementById('home-turn').hidden).toBe(false);
    expect(document.querySelector('#home-cards .game-card')).toBeNull();
    expect(document.querySelector('#home-cards .team-progress')).toBeNull();
  });

  it('ホームのカードは既定ですべて出る', () => {
    mount({ apiGameState: { enabled: true, total: 3, week: 1, level: 1, levelFrom: 0, nextAt: 5, playing: false, badges: [], team: null } });
    expect(document.getElementById('home-recent').hidden).toBe(false);
    expect(document.querySelector('#home-cards .game-card')).not.toBeNull();
    expect(document.querySelector('#home-cards .team-progress')).not.toBeNull();
  });

  it('設定で止めたらホームのカードもすぐ消える', () => {
    mount();
    document.querySelector('.nav-item[data-tab="settings"]').click();
    field('home.cards.recent').querySelector('button[role="switch"]').click();
    document.querySelector('.nav-item[data-tab="home"]').click();
    expect(document.getElementById('home-recent').hidden).toBe(true);
  });

  it('使われ方を止めていれば、画面からも送らない', () => {
    const app = mount({ apiPrefs: prefsFixture({ values: { 'usage.self': false } }) });
    document.getElementById('bell-btn').click();
    document.querySelector('[data-tab="issues"]').click();
    window.dispatchEvent(new window.Event('pagehide'));
    expect(app.calls.some((c) => c.name === 'apiUsageRecord')).toBe(false);
  });

  it('使われ方を止めていなければ送る', () => {
    const app = mount();
    document.getElementById('bell-btn').click();
    window.dispatchEvent(new window.Event('pagehide'));
    expect(app.calls.some((c) => c.name === 'apiUsageRecord')).toBe(true);
  });
});

describe('設定の一覧 (#18) レビューの指摘', () => {
  beforeEach(() => { window.localStorage.clear(); });
  const GAME = { enabled: true, total: 3, week: 1, level: 2, levelFrom: 0, nextAt: 5, playing: false, badges: [], team: null };

  it('設定が届くまでポイントのカードを出さず、見たレベルも覚えない', () => {
    let reply;
    const app = mount({ apiPrefs: { later: (ok) => { reply = ok; } }, apiGameState: GAME });
    expect(document.querySelector('#home-cards .game-card')).toBeNull();
    expect(app.calls.some((c) => c.name === 'apiGameLevelSeen')).toBe(false);
    reply(prefsFixture());
    expect(document.querySelector('#home-cards .game-card')).not.toBeNull();
    expect(app.calls.some((c) => c.name === 'apiGameLevelSeen')).toBe(true);
  });

  it('ポイントのカードを隠した人のレベルは、見たことにしない', () => {
    const app = mount({ apiPrefs: prefsFixture({ values: { 'home.cards.game': false } }), apiGameState: GAME });
    expect(document.querySelector('#home-cards .game-card')).toBeNull();
    expect(app.calls.some((c) => c.name === 'apiGameLevelSeen')).toBe(false);
  });

  it('設定が取れなくても、ポイントのカードは出す', () => {
    mount({ apiPrefs: new Error('混み合っています'), apiGameState: GAME });
    expect(document.querySelector('#home-cards .game-card')).not.toBeNull();
  });

  it('遅れて届いた古い書き込みの返事で、新しい設定を上書きしない', () => {
    const replies = [];
    mount({ apiPrefSet: (key, value) => ({ later: (ok) => replies.push(() => ok(prefsFixture({ values: { [key]: value } }))) }) });
    document.querySelector('.nav-item[data-tab="settings"]').click();
    document.querySelector('[data-pref="notify.review"] button[role="switch"]').click();
    document.querySelector('[data-pref="home.cards.recent"] button[role="switch"]').click();
    // 後から頼んだほうが先に届き、先に頼んだほうが遅れて届く
    replies[1]();
    replies[0]();
    document.querySelector('.nav-item[data-tab="home"]').click();
    expect(document.getElementById('home-recent').hidden).toBe(true);
  });

  it('起動のときは管理者かを尋ねず、設定の画面だけが尋ねる', () => {
    const app = mount();
    const first = app.calls.filter((c) => c.name === 'apiPrefs');
    expect(first.length).toBe(1);
    expect(first[0].args).toEqual([]);
    document.querySelector('.nav-item[data-tab="settings"]').click();
    expect(app.calls.filter((c) => c.name === 'apiPrefs').pop().args).toEqual([{ team: true }]);
  });
});

describe('使い方の、まだ通していなかった道', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const help = () => document.getElementById('panel-help');

  it('誰として認識しているかを出す。分からなければ警告し、取れなければ出さない', () => {
    mount({ apiWhoAmI: { activeUser: '', effectiveUser: '', sameUser: true } });
    document.querySelector('.nav-item[data-tab="help"]').click();
    expect(help().textContent).toContain('警告: 利用者を特定できていません');

    mount({ apiWhoAmI: new Error('取れません') });
    document.querySelector('.nav-item[data-tab="help"]').click();
    expect(help().textContent).not.toContain('として認識しています');
    expect(help().textContent).not.toContain('警告: 利用者を特定できていません');
  });

  it('送ると、いま読んでいる節が目次の現在地になる', () => {
    mount();
    document.querySelector('.nav-item[data-tab="help"]').click();
    const guide = document.getElementById('guide');
    const heads = [...guide.querySelectorAll('[id^="guide-sec-"]')];
    heads.forEach((h, i) => Object.defineProperty(h, 'offsetTop', { value: i * 1000, configurable: true }));
    guide.scrollTop = 2000;
    guide.dispatchEvent(new window.Event('scroll'));
    const current = [...document.querySelectorAll('#guide-toc [aria-current="true"]')];
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe(heads[2].querySelector('.guide-head-text').textContent);
  });
});
