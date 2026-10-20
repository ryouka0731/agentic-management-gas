// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

describe('ボードのカードから捨てる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openBoard(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    return app;
  }

  it('カードにも捨てるボタンがある', () => {
    openBoard();
    const del = document.querySelector('.board-card .btn-danger');

    expect(del).toBeTruthy();
    expect(del.textContent).toBe('');
    expect(del.getAttribute('aria-label')).toContain('捨てる');
  });

  it('確かめてから捨てる', () => {
    const app = openBoard();
    document.querySelector('.board-card .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiIssueArchive')).toBe(false);

    document.querySelector('#panel-issues .confirm-strip .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiIssueArchive').pop().args[0]).toBe(2);
  });

  it('捨てるボタンを押してもカードは開かない', () => {
    const app = openBoard();
    document.querySelector('.board-card .btn-danger').click();

    // 開いてしまうと、確かめの帯が入力パネルに隠れる
    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(app.calls.some((c) => c.name === 'apiIssueList' && c.args.length === 0))
      .toBe(false);
  });
});

describe('工程表の担当者と工数', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openGantt(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-gantt').click();
    return app;
  }

  it('行にも棒にも担当者の顔を出す', () => {
    openGantt();
    const row = document.querySelector('.gantt-row');

    expect(row.querySelector('.gantt-name .avatar').textContent).toBe('山');
    expect(row.querySelector('.gantt-bar .avatar')).toBeTruthy();
  });

  it('名前に指を置くと、切れた名前も全部読める', () => {
    openGantt();
    const row = document.querySelector('.gantt-row');
    const title = row.querySelector('.gantt-title').textContent;
    expect(row.querySelector('.gantt-name').title).toContain(title);
  });

  it('棒に人日を出す', () => {
    openGantt();

    expect(document.querySelector('.gantt-bar .gantt-days').textContent)
      .toMatch(/人日$/);
  });

  it('工数は人日で尋ねて、半日きざみで書ける', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[6].step).toBe('0.5');
    expect(inputs[7].step).toBe('0.5');
    expect([...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent).join(' ')).toContain('人日');
  });

  it('予定工数を変えると期限も動く', () => {
    const app = mount({
      apiIssueList: [{
        ...DEFAULTS.apiIssueList[0], parent: '',
        startDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-30T00:00:00.000Z', plannedHours: 8,
      }],
    });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    inputs[6].value = '3';
    document.querySelector('#side-body form .btn-primary').click();

    // 9/1 から3人日なので 9/3 まで
    const patch = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1];
    expect(patch.dueDate).toBe('2026-09-03');
  });

  it('予定工数を触っていなければ期限は動かさない', () => {
    const app = mount({
      apiIssueList: [{
        ...DEFAULTS.apiIssueList[0], parent: '',
        startDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-30T00:00:00.000Z', plannedHours: 8,
      }],
    });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    document.querySelector('#side-body form input').value = '題だけ直す';
    document.querySelector('#side-body form .btn-primary').click();

    const patch = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1];
    expect(patch.dueDate).toBe('2026-09-30');
  });
});

describe('工数の集計', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const RESULT = {
    periods: [
      {
        key: '2026-09', label: '2026年9月',
        sum: { planned: 3, actual: 5, diff: 2, count: 1 },
        cumulative: { planned: 3, actual: 5, diff: 2, count: 1 },
        byPerson: { 'me@example.com': { planned: 3, actual: 5, diff: 2, count: 1 } },
      },
      {
        key: '2026-10', label: '2026年10月',
        sum: { planned: 2, actual: 1, diff: -1, count: 1 },
        cumulative: { planned: 5, actual: 6, diff: 1, count: 2 },
        byPerson: {},
      },
    ],
    people: [
      { who: 'me@example.com', total: { planned: 3, actual: 5, diff: 2, count: 1 } },
    ],
    total: { planned: 5, actual: 6, diff: 1, count: 2 },
    skipped: 0,
    hidden: 1,
  };

  function openTally(over) {
    const app = mount(Object.assign({ apiTallyEffort: RESULT }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();
    return app;
  }

  function cells(row) {
    return [...row.querySelectorAll('th, td')].map((c) => c.textContent);
  }

  it('まずチーム全体の合計を出す', () => {
    openTally();
    const cards = [...document.querySelectorAll('#tally .tally-card')]
      .map((c) => c.textContent);

    expect(cards[0]).toContain('5');
    expect(cards[1]).toContain('6');
    expect(cards[2]).toContain('+1');
  });

  it('区切りごとに並べ、累計も出す', () => {
    openTally();
    const rows = [...document.querySelectorAll('#tally .tally-table')][0]
      .querySelectorAll('tbody tr');

    expect(cells(rows[0])).toEqual(['2026年9月', '3', '5', '+2', '3', '5', '1']);
    expect(cells(rows[1])).toEqual(['2026年10月', '2', '1', '-1', '5', '6', '1']);
  });

  it('全体であることを見出しで言う', () => {
    openTally();

    expect(document.querySelectorAll('#tally h3')[0].textContent)
      .toContain('チーム全体');
  });

  it('その区切りに居ない人は空にする', () => {
    openTally();
    const table = [...document.querySelectorAll('#tally .tally-table')][1];
    const me = table.querySelectorAll('tbody tr')[0];

    // 0 と書くと「0人日やった」に読める
    expect(me.querySelectorAll('td')[1].textContent).toBe('—');
  });

  it('区切りを変えられる', () => {
    const app = openTally();

    document.getElementById('tally-unit').value = 'quarter';
    document.getElementById('tally-unit')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiTallyEffort').pop().args[0])
      .toBe('quarter');
  });

  it('半期と年度でも切れる', () => {
    openTally();

    expect([...document.querySelectorAll('#tally-unit option')]
      .map((o) => o.value))
      .toEqual(['week', 'month', 'quarter', 'half', 'year']);
  });

  it('数え方を変えられる', () => {
    const app = openTally();

    document.getElementById('tally-basis').value = 'closed';
    document.getElementById('tally-basis')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiTallyEffort').pop().args[1])
      .toBe('closed');
  });

  it('数える日が空のものがあることを伝える', () => {
    openTally({ apiTallyEffort: Object.assign({}, RESULT, { skipped: 1 }) });

    // 黙って落とすと、合計が合わない理由が分からない
    expect(document.querySelector('#tally .tally-skipped').textContent)
      .toContain('1件は、数える日が空');
  });

  it('超えた差と下回った差を見分ける', () => {
    openTally();
    const diffs = [...document.querySelectorAll('#tally .tally-table')][0]
      .querySelectorAll('.tally-diff');

    expect(diffs[0].classList.contains('over')).toBe(true);
    expect(diffs[1].classList.contains('under')).toBe(true);
  });

  it('集計では絞り込みと束ね方を隠す', () => {
    openTally();

    expect(document.getElementById('issue-filter').parentNode.hidden).toBe(true);
    expect(document.getElementById('tally-unit-box').hidden).toBe(false);
  });

  it('何も無ければ何を入れれば集まるかを言う', () => {
    openTally({
      apiTallyEffort: {
        periods: [], people: [],
        total: { planned: 0, actual: 0, diff: 0, count: 0 },
        skipped: 0, hidden: 0,
      },
    });

    expect(document.getElementById('tally').textContent)
      .toContain('集計できるやることがありません');
  });
});

describe('工数集計の見える範囲', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const RESULT = {
    periods: [{
      key: '2026-09', label: '2026年9月',
      sum: { planned: 10, actual: 10, diff: 0, count: 4 },
      cumulative: { planned: 10, actual: 10, diff: 0, count: 4 },
      byPerson: { 'me@example.com': { planned: 3, actual: 4, diff: 1, count: 1 } },
    }],
    people: [
      { who: 'me@example.com', total: { planned: 3, actual: 4, diff: 1, count: 1 } },
    ],
    total: { planned: 10, actual: 10, diff: 0, count: 4 },
    skipped: 0,
    hidden: 3,
  };

  function openTally(over) {
    const app = mount(Object.assign({ apiTallyEffort: RESULT }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();
    return app;
  }

  it('人ごとの内訳は自分のぶんだけ出る', () => {
    openTally();
    const rows = [...document.querySelectorAll('#tally .tally-table')][1]
      .querySelectorAll('tbody tr');

    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('th').textContent).toContain('山田 太郎');
  });

  it('合計と内訳が合わない理由を言う', () => {
    openTally();

    // 黙って減らすと、数が合わないことのほうが不安になる
    expect(document.getElementById('tally').textContent)
      .toContain('ほかの3件は全体の合計にだけ');
  });

  it('上長でなければ対象は選ばせない', () => {
    openTally();

    // 見てよい人が自分だけなら、選ばせる意味がない
    expect(document.getElementById('tally-who-box').hidden).toBe(true);
  });

  it('上長なら対象を選べる', () => {
    openTally({
      apiTallyScope: {
        me: 'me@example.com',
        canSee: ['me@example.com', 'buka@example.com'],
        isManager: true, canEdit: false,
      },
    });

    expect(document.getElementById('tally-who-box').hidden).toBe(false);
    expect([...document.querySelectorAll('#tally-who option')]
      .map((o) => o.textContent))
      .toEqual(['見られる人ぜんぶ', '自分 (山田 太郎)', 'buka']);
  });

  it('選んだ相手をサーバに渡す', () => {
    const app = openTally({
      apiTallyScope: {
        me: 'me@example.com',
        canSee: ['me@example.com', 'buka@example.com'],
        isManager: true, canEdit: false,
      },
    });

    document.getElementById('tally-who').value = 'buka@example.com';
    document.getElementById('tally-who')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiTallyEffort').pop().args[2])
      .toBe('buka@example.com');
  });
});

describe('工数を割って数えることの断り', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDetail() {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
  }

  function type(value) {
    const input = document
      .querySelectorAll('#side-body input, #side-body textarea')[2];
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('2人以上にしたその場で言う', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    // 集計を見てから気づくのでは遅い
    expect(document.querySelector('.assignee-note').textContent)
      .toContain('2人で割って数えます');
  });

  it('1人のときは言わない', () => {
    openDetail();
    type('@me@example.com ');

    expect(document.querySelector('.assignee-note')).toBe(null);
  });

  it('担当者の欄の補足にも書く', () => {
    openDetail();
    const label = document
      .querySelectorAll('#side-body input, #side-body textarea')[2].parentNode;

    expect(label.dataset.hint).toContain('頭数で割って');
  });

  it('集計の表の脇にも書く', () => {
    mount({
      apiTallyEffort: {
        periods: [{
          key: '2026-09', label: '2026年9月',
          sum: { planned: 4, actual: 6, diff: 2, count: 1 },
          cumulative: { planned: 4, actual: 6, diff: 2, count: 1 },
          byPerson: { 'me@example.com': { planned: 2, actual: 3, diff: 1, count: 1 } },
        }],
        people: [{
          who: 'me@example.com',
          total: { planned: 2, actual: 3, diff: 1, count: 1 },
        }],
        total: { planned: 4, actual: 6, diff: 2, count: 1 },
        skipped: 0, hidden: 0,
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();

    expect(document.querySelector('#tally .tally-note').textContent)
      .toContain('頭数で割って数えています');
  });
});

describe('一覧の行の高さ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('確認依頼の行も他と同じ器に入れる', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    // 入れないとこの行だけ背が低くなる
    const row = document.querySelector('#pr-list .row-item');
    expect(row.querySelector('.row-open')).toBeTruthy();
    expect(row.querySelector('.row-open .icon')).toBeTruthy();
  });

  it('どの一覧でも丈を揃える', () => {
    const css = document.querySelector('style').textContent;
    const at = css.indexOf('\n.row-item {');

    expect(css.slice(at, css.indexOf('}', at))).toContain('min-height: 56px');
  });

  it('確認してもらう人が一覧にも出る', () => {
    mount({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], reviewers: ['me@example.com'] }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    const row = document.querySelector('#pr-list .row-item');
    expect(row.textContent).toContain('確認');
    expect(row.querySelector('.avatars')).toBeTruthy();
  });

  it('頼んでいなければ出さない', () => {
    mount({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], reviewers: [] }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    expect(document.querySelector('#pr-list .row-item .avatars')).toBe(null);
  });
});

describe('進捗ボードの使い勝手', () => {
  beforeEach(() => { window.localStorage.clear(); });
  const BOARD = {
    Backlog: [
      { issueNumber: 1, order: 0, title: 'a', state: 'open', assignee: '', labels: '', dueDate: '' },
      { issueNumber: 2, order: 1, title: 'b', state: 'open', assignee: '', labels: '', dueDate: '' },
    ],
    'In Progress': [], 'In Review': [], Done: [],
  };
  function openBoard(over) {
    const app = mount(Object.assign({ apiProjectBoard: BOARD }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    return app;
  }

  it('列の「＋」から題名だけ打って、その列に足せる', () => {
    const app = openBoard({ apiIssueCreate: { number: 9, title: '思い付き' } });
    const col = document.querySelectorAll('.board-column')[1];
    col.querySelector('.board-add').click();

    const form = col.querySelector('.board-composer');
    const input = form.querySelector('input');
    expect(form.querySelector('.btn-primary').disabled).toBe(true);
    input.value = '思い付き';
    input.dispatchEvent(new window.Event('input'));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.find((c) => c.name === 'apiIssueCreate').args[0]).toBe('思い付き');
    // 作ると「これから」に入るので、足した列 (作業中) へ移す
    expect(app.calls.find((c) => c.name === 'apiProjectMove').args.slice(0, 2)).toEqual([9, 'In Progress']);
  });

  it('Esc で足す欄を閉じる', () => {
    openBoard();
    const col = document.querySelector('.board-column');
    col.querySelector('.board-add').click();
    col.querySelector('.board-composer input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(col.querySelector('.board-composer')).toBeNull();
  });

  it('落とした位置に入れる (末尾にしか入らなかった)', () => {
    const app = openBoard();
    const col = document.querySelector('.board-column');
    const cards = col.querySelectorAll('.board-card');
    // 2枚目の上半分に落とす → 2番目 (位置1) に入る
    cards[1].getBoundingClientRect = () => ({ top: 100, height: 40 });
    cards[0].getBoundingClientRect = () => ({ top: 40, height: 40 });
    const drop = new window.Event('drop', { cancelable: true });
    drop.clientY = 105;
    drop.dataTransfer = { getData: () => '5' };
    col.dispatchEvent(drop);

    expect(app.calls.find((c) => c.name === 'apiProjectMove').args).toEqual([5, 'Backlog', 1]);
  });

  it('カードが1枚も無くても列を描き、「＋」から足せる', () => {
    openBoard({ apiProjectBoard: { Backlog: [], 'In Progress': [], 'In Review': [], Done: [] } });
    expect(document.querySelector('#board .blank-state')).not.toBeNull();
    expect(document.querySelectorAll('.board-column .board-add')).toHaveLength(4);
  });

  it('足したあと列へ移せなかったら、欄を閉じて板を描き直す (押せないまま残さない)', () => {
    const app = openBoard({ apiIssueCreate: { number: 9, title: 'x' }, apiProjectMove: new Error('混み合っています') });
    const col = document.querySelectorAll('.board-column')[1];
    col.querySelector('.board-add').click();
    const form = col.querySelector('.board-composer');
    form.querySelector('input').value = 'x';
    form.querySelector('input').dispatchEvent(new window.Event('input'));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(document.getElementById('snackbar').textContent).toContain('#9 は作りましたが');
    expect(document.querySelector('.board-composer')).toBeNull();
    expect(app.calls.filter((c) => c.name === 'apiProjectBoard').length).toBeGreaterThan(1);
  });

  it('絞り込んでいても、保存されている並びの位置に入れる', () => {
    const board = {
      Backlog: [
        { issueNumber: 1, order: 0, title: '見えない', state: 'open', assignee: '', labels: '', dueDate: '' },
        { issueNumber: 2, order: 1, title: '会議の準備', state: 'open', assignee: '', labels: '', dueDate: '' },
      ],
      'In Progress': [], 'In Review': [], Done: [],
    };
    const issues = [
      Object.assign({}, DEFAULTS.apiIssueList[0], { number: 1, title: '見えない' }),
      Object.assign({}, DEFAULTS.apiIssueList[0], { number: 2, title: '会議の準備' }),
    ];
    const app = openBoard({ apiProjectBoard: board, apiIssueList: issues });
    const filter = document.getElementById('issue-filter');
    filter.value = '会議';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));

    const col = document.querySelector('.board-column');
    const cards = col.querySelectorAll('.board-card');
    expect(cards).toHaveLength(1);
    cards[0].getBoundingClientRect = () => ({ top: 100, height: 40 });
    const drop = new window.Event('drop', { cancelable: true });
    drop.clientY = 101;
    drop.dataTransfer = { getData: () => '7' };
    col.dispatchEvent(drop);
    // 見えている1番目は、保存されている並びでは2番目 (位置1)
    expect(app.calls.filter((c) => c.name === 'apiProjectMove').pop().args).toEqual([7, 'Backlog', 1]);
  });

  it('キーボード: ? で操作の一覧、N で作る、/ で絞り込み。入力中は効かない', () => {
    mount();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?' }));
    expect(document.getElementById('side-title').textContent).toBe('キーボードで使える操作');
    expect(document.querySelector('#side-body .shortcut-list').textContent).toContain('やることを作る');

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '/' }));
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('issue-filter'));

    // 絞り込みの欄で字を打っているあいだは、N で作り始めない
    const title = document.getElementById('side-title').textContent;
    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(document.getElementById('side-title').textContent).toBe(title);

    document.activeElement.blur();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'N' }));
    expect(document.getElementById('side-body').querySelector('form')).not.toBeNull();
  });
});

describe('工程表のペインと細かさ', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--gantt-name-w');
  });

  /** jsdom の PointerEvent は clientX を持たせにくいので、同じ形のものを送る */
  function pointer(type, x) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.clientX = x;
    ev.pointerId = 1;
    ev.button = 0;
    return ev;
  }

  function openGantt(over, viewWidth) {
    const app = mount(over);
    if (viewWidth) {
      Object.defineProperty(document.getElementById('gantt'), 'clientWidth',
        { configurable: true, value: viewWidth });
    }
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-gantt').click();
    return app;
  }

  function handle() {
    return document.getElementById('gantt-resizer');
  }

  function width() {
    return document.documentElement.style.getPropertyValue('--gantt-name-w');
  }

  function zoom(name) {
    document.querySelector('#gantt-zoom [data-zoom="' + name + '"]').click();
  }

  function col() {
    return document.querySelector('.gantt').style.getPropertyValue('--gantt-col');
  }

  it('名前の欄と日の並びの間に掴み手があり、工程表と一緒に出る', () => {
    openGantt();
    const h = handle();

    expect(h).toBeTruthy();
    expect(document.getElementById('gantt').contains(h)).toBe(true);
    expect(h.getAttribute('role')).toBe('separator');
    expect(h.getAttribute('aria-orientation')).toBe('vertical');
    expect(h.getAttribute('tabindex')).toBe('0');
    expect(h.getAttribute('aria-valuenow')).toBe('220');

    // 一覧へ切り替えると、器ごと隠れる (掴み手だけが宙に残らない)
    document.getElementById('view-list').click();
    expect(document.getElementById('gantt').hidden).toBe(true);
  });

  it('掴んで動かすと名前の欄の幅が変わり、覚える', () => {
    openGantt();
    handle().dispatchEvent(pointer('pointerdown', 220));
    handle().dispatchEvent(pointer('pointermove', 300));
    expect(width()).toBe('300px');

    handle().dispatchEvent(pointer('pointerup', 320));
    expect(width()).toBe('320px');
    expect(window.localStorage.getItem('ganttNameW')).toBe('320');
    expect(handle().getAttribute('aria-valuenow')).toBe('320');

    // 開き直しても覚えている
    document.documentElement.style.removeProperty('--gantt-name-w');
    openGantt();
    expect(width()).toBe('320px');
  });

  it('120〜480px の範囲で止まる', () => {
    openGantt();
    handle().dispatchEvent(pointer('pointerdown', 220));

    handle().dispatchEvent(pointer('pointermove', 10));
    expect(width()).toBe('120px');

    handle().dispatchEvent(pointer('pointermove', 9999));
    expect(width()).toBe('480px');
  });

  it('枠の外で離しても、取り消されても張り付かない', () => {
    openGantt();
    handle().dispatchEvent(pointer('pointerdown', 220));
    window.dispatchEvent(pointer('pointerup', 260));
    handle().dispatchEvent(pointer('pointermove', 400));
    expect(width()).toBe('260px');

    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointercancel', 280));
    handle().dispatchEvent(pointer('pointermove', 400));
    expect(width()).toBe('280px');
  });

  it('キーボードの ←→ で 16px ずつ動く', () => {
    openGantt();

    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(width()).toBe('236px');
    expect(handle().getAttribute('aria-valuenow')).toBe('236');

    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(width()).toBe('204px');
    expect(window.localStorage.getItem('ganttNameW')).toBe('204');
  });

  it('ダブルクリックで既定の 220px に戻る', () => {
    openGantt();
    handle().dispatchEvent(pointer('pointerdown', 220));
    handle().dispatchEvent(pointer('pointerup', 400));
    expect(width()).toBe('400px');

    handle().dispatchEvent(new window.Event('dblclick', { bubbles: true }));
    expect(width()).toBe('');
    expect(window.localStorage.getItem('ganttNameW')).toBe(null);
    expect(handle().getAttribute('aria-valuenow')).toBe('220');
  });

  it('描き直しても掴み手は1つ', () => {
    openGantt();
    const first = handle();
    document.getElementById('issue-group').dispatchEvent(new window.Event('change'));

    expect(document.querySelectorAll('#gantt .gantt-resizer').length).toBe(1);
    expect(handle()).toBe(first);
  });

  it('細かさを変えると1日の幅が変わり、覚える', () => {
    openGantt();
    expect(col()).toBe('26px');
    expect(document.getElementById('gantt-zoom').hidden).toBe(false);

    zoom('week');
    expect(col()).toBe('12px');
    expect(document.querySelector('#gantt-zoom [data-zoom="week"]')
      .getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('ganttZoom')).toBe('week');

    zoom('month');
    expect(col()).toBe('4px');

    // 開き直しても覚えている
    openGantt();
    expect(col()).toBe('4px');

    // 工程表でなければ切り替えは出さない
    document.getElementById('view-list').click();
    expect(document.getElementById('gantt-zoom').hidden).toBe(true);
    expect(document.getElementById('gantt-today').hidden).toBe(true);
  });

  it('週・月では日の見出しを間引き、月の見出しは残す', () => {
    openGantt();
    const named = () => [...document.querySelectorAll('.gantt-day')]
      .filter((c) => c.textContent !== '').length;
    const days = document.querySelectorAll('.gantt-day').length;
    expect(named()).toBe(days);

    zoom('week');
    expect(named()).toBeGreaterThan(0);
    expect(named()).toBeLessThan(days / 5);
    expect(document.querySelectorAll('.gantt-month').length).toBeGreaterThan(0);

    zoom('month');
    expect(named()).toBe(0);
    expect(document.querySelectorAll('.gantt-month').length).toBeGreaterThan(0);
    // 字が無くても、指を置けば日付は読める
    expect(document.querySelector('.gantt-day').title).not.toBe('');
  });

  // 細かさごとに分ける。1つにまとめると画面を3回組むぶん時間の上限に当たる
  it.each([['day', 26], ['week', 12], ['month', 4]])(
    '細かさが %s (1日 %ipx) でも、棒を掴んで1日ずらせる', (name, px) => {
      const capture = window.Element.prototype.setPointerCapture;
      const release = window.Element.prototype.releasePointerCapture;
      window.Element.prototype.setPointerCapture = () => {};
      window.Element.prototype.releasePointerCapture = () => {};

      try {
        const due = new Date('2026-09-30T00:00:00.000Z');
        const next = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
        const pad = (n) => String(n).padStart(2, '0');
        const expected = next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate());

        const app = openGantt();
        zoom(name);
        const before = app.calls.length;

        const bar = document.querySelector('.gantt-row[data-number="2"] .gantt-bar');
        // jsdom では大きさが 0 なので、右の端を掴んだことになる (期限だけ動く)
        bar.dispatchEvent(pointer('pointerdown', 100));
        bar.dispatchEvent(pointer('pointermove', 100 + px));
        bar.dispatchEvent(pointer('pointerup', 100 + px));

        const update = app.calls.slice(before).find((c) => c.name === 'apiIssueUpdate');
        expect(update).toBeTruthy();
        expect(update.args[0]).toBe(2);
        expect(update.args[1].dueDate).toBe(expected);
      } finally {
        window.Element.prototype.setPointerCapture = capture;
        window.Element.prototype.releasePointerCapture = release;
      }
    });

  it('開いたとき、今日の線が左から 1/3 に来るよう横に送る', () => {
    openGantt(null, 900);
    const scroller = document.getElementById('gantt');
    const cells = [...document.querySelectorAll('.gantt-day')];
    const today = cells.findIndex((c) => c.classList.contains('today'));
    expect(today).toBeGreaterThan(10);

    // 名前の欄 (220px) を除いた見える幅の 1/3 に今日の真ん中を置く
    const expected = today * 26 + 13 - (900 - 220) / 3;
    expect(Math.abs(scroller.scrollLeft - expected)).toBeLessThan(40);
  });

  it('「今日」で今日へ戻り、描き直しでは人が送った位置を保つ', () => {
    openGantt(null, 900);
    const scroller = document.getElementById('gantt');
    const atToday = scroller.scrollLeft;
    expect(atToday).toBeGreaterThan(0);

    scroller.scrollLeft = 5;
    document.getElementById('issue-group').dispatchEvent(new window.Event('change'));
    expect(scroller.scrollLeft).toBe(5);

    document.getElementById('gantt-today').click();
    expect(scroller.scrollLeft).toBe(atToday);
  });

  it('細かさを変えても今日へ送り直す', () => {
    openGantt(null, 900);
    zoom('week');
    const cells = [...document.querySelectorAll('.gantt-day')];
    const today = cells.findIndex((c) => c.classList.contains('today'));
    const expected = today * 12 + 6 - (900 - 220) / 3;
    expect(Math.abs(document.getElementById('gantt').scrollLeft - expected)).toBeLessThan(40);
  });

  it('工程表を覚えたまま起動し、あとでやることを開いても今日へ送る', () => {
    // 起動時はホームが出ていて工程表は隠れている。隠れたまま描いた時点で
    // 今日へ送る印を使い切ると、開いたときに左端のままになる
    window.localStorage.setItem('issueView', 'gantt');
    mount();
    const scroller = document.getElementById('gantt');
    scroller.scrollLeft = 0; // 隠れている器は実機では送れない
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 900 });

    document.querySelector('[data-tab="issues"]').click();
    const cells = [...document.querySelectorAll('.gantt-day')];
    const today = cells.findIndex((c) => c.classList.contains('today'));
    const expected = today * 26 + 13 - (900 - 220) / 3;
    expect(Math.abs(scroller.scrollLeft - expected)).toBeLessThan(40);
  });

  it('月の細かさで 2px ぶれただけでは、期間を変えない', () => {
    const capture = window.Element.prototype.setPointerCapture;
    const release = window.Element.prototype.releasePointerCapture;
    window.Element.prototype.setPointerCapture = () => {};
    window.Element.prototype.releasePointerCapture = () => {};
    try {
      const app = openGantt();
      zoom('month');
      const before = app.calls.length;
      const bar = document.querySelector('.gantt-row[data-number="2"] .gantt-bar');
      bar.dispatchEvent(pointer('pointerdown', 100));
      bar.dispatchEvent(pointer('pointermove', 102));
      bar.dispatchEvent(pointer('pointerup', 102));

      expect(app.calls.slice(before).some((c) => c.name === 'apiIssueUpdate')).toBe(false);
    } finally {
      window.Element.prototype.setPointerCapture = capture;
      window.Element.prototype.releasePointerCapture = release;
    }
  });

  /**
   * 工程表の読み込みを止めておける形で組む。hold() のあとに来た読み込みは
   * 返事を預かり、release(list) で返す
   */
  function openGanttHeld(viewWidth) {
    const held = [];
    let holding = false;
    const app = openGantt({
      apiIssueList: () => (holding
        ? { later: (ok) => { held.push(ok); } }
        : DEFAULTS.apiIssueList),
    }, viewWidth);
    return {
      app,
      hold() { holding = true; },
      go() { holding = false; },
      release(list) { held.shift()(list || DEFAULTS.apiIssueList); },
    };
  }

  function reload() {
    document.getElementById('issue-group').dispatchEvent(new window.Event('change'));
  }

  it('遅れて届いた古い返事で、新しい工程表を描き直さない', () => {
    const t = openGanttHeld(900);
    t.hold();
    reload();          // 1つ目は待たせる
    t.go();
    reload();          // 2つ目はすぐ届く
    const old = DEFAULTS.apiIssueList.map((i) => Object.assign({}, i, { title: '古い題' }));
    t.release(old);    // 1つ目が遅れて届く

    expect(document.querySelector('.gantt-title').textContent).not.toContain('古い題');
    expect(document.querySelectorAll('#gantt .gantt').length).toBe(1);
  });

  it('待っている間に人が送ったら、その位置を奪わない', () => {
    const t = openGanttHeld(900);
    const scroller = document.getElementById('gantt');
    expect(scroller.scrollLeft).toBeGreaterThan(100);

    t.hold();
    reload();
    scroller.scrollLeft = 50;   // 返事を待つ間に人が送った
    t.release();
    expect(scroller.scrollLeft).toBe(50);
  });

  it('描き直しを待つ間に「今日」を押しても、届いたら今日へ送る', () => {
    const t = openGanttHeld(900);
    const scroller = document.getElementById('gantt');
    const atToday = scroller.scrollLeft;
    scroller.scrollLeft = 5;

    t.hold();
    reload();
    document.getElementById('gantt-today').click();
    t.release();
    expect(scroller.scrollLeft).toBe(atToday);
  });

  it('今日が端にあっても、前後に余白の日を足して 1/3 に置ける', () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    openGantt({
      apiIssueList: [{
        number: 3, title: '今日から', body: '', state: 'open', assignee: '', assignees: [],
        labels: '', linkedFileIds: '', linkedPr: '', createdAt: now.toISOString(), closedAt: '',
        startDate: ymd(now), dueDate: ymd(later), parent: '', plannedHours: 3,
      }],
    }, 900);

    const cells = [...document.querySelectorAll('.gantt-day')];
    const today = cells.findIndex((c) => c.classList.contains('today'));
    const view = 900 - 220;
    // 今日の前に、見える幅の 1/3 ぶんの日がある
    expect(today * 26 + 13).toBeGreaterThanOrEqual(view / 3);
    // 今日の後ろに、見える幅の 2/3 ぶんの日がある
    expect((cells.length - today) * 26).toBeGreaterThanOrEqual(view * 2 / 3);
    const expected = today * 26 + 13 - view / 3;
    expect(Math.abs(document.getElementById('gantt').scrollLeft - expected)).toBeLessThan(40);

    // 足した日のぶん棒もずれる (棒は今日の列から始まる)
    const bar = document.querySelector('.gantt-row[data-number="3"] .gantt-bar');
    expect(bar.style.gridColumn).toBe((today + 1) + ' / span 3');
  });

  it('週では、字があるのは月曜だけで、月曜にはすべて字がある', () => {
    openGantt();
    zoom('week');
    const cells = [...document.querySelectorAll('.gantt-day')];
    expect(cells.length).toBeGreaterThan(14);
    cells.forEach((c) => {
      const [y, m, d] = c.title.split('/').map(Number);
      const day = new Date(y, m - 1, d);
      if (day.getDay() === 1) expect(c.textContent).toBe(String(d));
      else expect(c.textContent).toBe('');
    });
  });

  it('掴み手は触れて動かしてもページを送らない', () => {
    openGantt();
    const css = document.querySelector('style').textContent;
    const rule = css.slice(css.indexOf('.gantt-resizer {'), css.indexOf('}', css.indexOf('.gantt-resizer {')));
    expect(rule).toContain('touch-action: none');
  });

  it('狭い画面では掴み手を出さず、名前の欄は 140px', () => {
    openGantt();
    const css = document.querySelector('style').textContent;
    expect(handle().classList.contains('resizer')).toBe(true);
    expect(css).toMatch(/@media \(max-width: 767px\) \{[^}]*\.resizer \{ display: none/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{[^}]*\.gantt \{ --gantt-name-w: 140px; \}/);
  });
});

describe('ボードと工程表の、まだ通していなかった道', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const $ = (s) => document.querySelector(s);
  const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;
  const ISSUES = [
    { ...DEFAULTS.apiIssueList[0], number: 2, parent: '', assignees: ['me@example.com', 'other@example.com'],
      assignee: 'me@example.com,other@example.com', labels: '規定改訂, 会議', state: 'open',
      startDate: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30T00:00:00.000Z' },
    { ...DEFAULTS.apiIssueList[1], number: 1, parent: '', assignees: [], assignee: '', labels: '', state: 'closed' },
  ];

  function group(by) {
    const sel = $('#issue-group');
    sel.value = by;
    sel.dispatchEvent(new window.Event('change'));
  }
  const heads = () => [...document.querySelectorAll('#issue-list .group-head, #issue-list .issue-group-head, #issue-list h3')]
    .map((h) => h.textContent);

  it.each([
    ['assignee', ['山田 太郎', '鈴木 花子', '担当なし']],
    ['state', ['未完了', '完了']],
    ['label', ['規定改訂', '会議', 'ラベルなし']],
  ])('一覧を %s ごとにまとめる。2人で持つものは両方の束に出す', (by, want) => {
    mount({ apiIssueList: ISSUES });
    $('.nav-item[data-tab="issues"]').click();
    group(by);
    const text = $('#issue-list').textContent;
    want.forEach((w) => expect(text).toContain(w));
  });

  function pointer(type, x) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.clientX = x;
    ev.pointerId = 1;
    return ev;
  }

  function withPointer(fn) {
    const capture = window.Element.prototype.setPointerCapture;
    const release = window.Element.prototype.releasePointerCapture;
    window.Element.prototype.setPointerCapture = () => {};
    window.Element.prototype.releasePointerCapture = () => {};
    try { return fn(); } finally {
      window.Element.prototype.setPointerCapture = capture;
      window.Element.prototype.releasePointerCapture = release;
    }
  }

  function openGantt(over) {
    const app = mount(Object.assign({ apiIssueList: [ISSUES[0]] }, over || {}));
    $('.nav-item[data-tab="issues"]').click();
    $('#view-gantt').click();
    const bar = $('.gantt-row[data-number="2"] .gantt-bar');
    // 幅 200px の棒として扱う (端は 10px)
    bar.getBoundingClientRect = () => ({ left: 100, right: 300, width: 200, top: 0, bottom: 20, height: 20 });
    return { app, bar };
  }

  it('棒に指を置くと、端では幅を変える形、中では掴む形になる', () => {
    const { bar } = openGantt();
    bar.dispatchEvent(pointer('pointermove', 102));
    expect(bar.style.cursor).toBe('ew-resize');
    bar.dispatchEvent(pointer('pointermove', 200));
    expect(bar.style.cursor).toBe('grab');
  });

  it('真ん中を掴んで動かすと、始まりと期限が一緒に動く', () => withPointer(() => {
    const { app, bar } = openGantt({ apiIssueUpdate: { ok: true } });
    const col = parseFloat(document.querySelector('.gantt').style.getPropertyValue('--gantt-col')) || 26;
    bar.dispatchEvent(pointer('pointerdown', 200));
    bar.dispatchEvent(pointer('pointermove', 200 + col * 2));
    bar.dispatchEvent(pointer('pointerup', 200 + col * 2));
    const patch = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1];
    expect(patch.startDate).toBeTruthy();
    expect(patch.dueDate).toBeTruthy();
    expect(snack()).toContain('#2 の期間を');
  }));

  it('左の端を掴むと始まりだけ動き、期限より後ろへは行かない', () => withPointer(() => {
    const { app, bar } = openGantt({ apiIssueUpdate: { ok: true } });
    bar.dispatchEvent(pointer('pointerdown', 101));
    bar.dispatchEvent(pointer('pointermove', 5000));
    bar.dispatchEvent(pointer('pointerup', 5000));
    const patch = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1];
    expect(patch.startDate).toBe(patch.dueDate);
  }));

  it('動かさずに離したら、押したのだと解して中身を開く', () => withPointer(() => {
    const { app, bar } = openGantt();
    bar.dispatchEvent(pointer('pointerdown', 200));
    bar.dispatchEvent(pointer('pointerup', 201));
    expect(app.calls.some((c) => c.name === 'apiIssueUpdate')).toBe(false);
    expect($('#side-title').textContent).toBe('やること #2');
  }));

  it('期間を変えられなければ、理由を出して描き直す', () => withPointer(() => {
    const { app, bar } = openGantt({ apiIssueUpdate: new Error('混み合っています') });
    const lists = app.calls.filter((c) => c.name === 'apiIssueList').length;
    bar.dispatchEvent(pointer('pointerdown', 299));
    bar.dispatchEvent(pointer('pointermove', 400));
    bar.dispatchEvent(pointer('pointerup', 400));
    expect(snack()).toContain('混み合っています');
    expect(app.calls.filter((c) => c.name === 'apiIssueList').length).toBeGreaterThan(lists);
  }));

  it('工程表に出せるものが無ければ、そう言う', () => {
    mount({ apiIssueList: [] });
    $('.nav-item[data-tab="issues"]').click();
    $('#view-gantt').click();
    expect($('#gantt').textContent).toContain('やることがありません');
  });

  it('ボードのカードは Enter でも開ける。ほかのキーでは開かない', () => {
    mount();
    $('.nav-item[data-tab="issues"]').click();
    $('#view-board').click();
    const card = $('.board-card');
    card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect($('#side-panel').hidden).toBe(true);
    card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect($('#side-title').textContent).toBe('やること #2');
  });

  it('カードを掴んで列の上を通ると落とす位置の線が出て、外れると消える', () => {
    mount();
    $('.nav-item[data-tab="issues"]').click();
    $('#view-board').click();
    const col = document.querySelectorAll('.board-column')[1];
    const over = new window.Event('dragover', { bubbles: true, cancelable: true });
    over.clientY = 0;
    col.dispatchEvent(over);
    expect(col.classList.contains('drop-target')).toBe(true);
    expect(col.querySelector('.drop-indicator')).toBeTruthy();

    const leave = new window.Event('dragleave', { bubbles: true });
    col.dispatchEvent(leave);
    expect(col.classList.contains('drop-target')).toBe(false);
  });

  it('番号の無いものを落としても何も頼まない', () => {
    const app = mount();
    $('.nav-item[data-tab="issues"]').click();
    $('#view-board').click();
    const col = document.querySelectorAll('.board-column')[1];
    const drop = new window.Event('drop', { bubbles: true, cancelable: true });
    drop.dataTransfer = { getData: () => '' };
    col.dispatchEvent(drop);
    expect(app.calls.some((c) => c.name === 'apiProjectMove')).toBe(false);
  });
});
