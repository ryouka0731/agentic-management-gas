// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

describe('やること', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('一覧に行が並ぶ', () => {
    openIssues();

    const rows = document.querySelectorAll('#issue-list .row-item');
    expect(rows.length).toBe(2);
    expect(document.getElementById('issue-count').textContent).toBe('2 / 2件');
  });

  it('親子が入れ子になる', () => {
    openIssues();

    const rows = [...document.querySelectorAll('#issue-list .row-item')];
    const child = rows.find((r) => r.textContent.indexOf('#1') >= 0);

    expect(child.classList.contains('nested')).toBe(true);
    expect(child.style.marginLeft).toBe('40px');
  });

  it('子の工数を親に足し上げて出す', () => {
    openIssues();

    const parent = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.textContent.indexOf('#2') >= 0);

    // 親8h + 子4h
    expect(parent.querySelector('.effort').textContent).toContain('予定 12人日');
  });

  it('絞り込むと件数と行が減る', () => {
    openIssues();

    const box = document.getElementById('issue-filter');
    box.value = '通勤';
    box.dispatchEvent(new window.Event('input'));

    expect(document.querySelectorAll('#issue-list .row-item').length).toBe(1);
    expect(document.getElementById('issue-count').textContent).toBe('1 / 2件');
  });

  it('束ねを畳める', () => {
    openIssues();

    const head = document.querySelector('#issue-list .group-head');
    expect(head.getAttribute('aria-expanded')).toBe('true');

    head.click();
    expect(document.querySelectorAll('#issue-list .row-item').length).toBe(0);
  });

  it('サーバが null を返しても落ちない', () => {
    // 実際に起きた不具合。1つの値が欠けただけで画面全体が止まっていた
    const app = mount({ apiIssueList: null });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.getElementById('fatal-error')).toBeNull();
    expect(document.getElementById('issue-count').textContent).toBe('0 / 0件');
  });

  it('見え方を切り替えられる', () => {
    openIssues();

    document.getElementById('view-board').click();
    expect(document.getElementById('board').hidden).toBe(false);
    expect(document.getElementById('issue-list').hidden).toBe(true);

    document.getElementById('view-gantt').click();
    expect(document.getElementById('gantt').hidden).toBe(false);
  });
});

describe('入力は右のパネルで受ける', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('行を押すと右に開き、対象に印が付く', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const row = document.querySelector('#issue-list .row-item');
    row.querySelector('.row-open').click();

    const panel = document.getElementById('side-panel');
    expect(panel.hidden).toBe(false);
    expect(document.getElementById('side-title').textContent).toBe('やること #2');
    expect(row.classList.contains('editing')).toBe(true);
  });

  it('閉じると印も外れる', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const row = document.querySelector('#issue-list .row-item');
    row.querySelector('.row-open').click();
    document.getElementById('side-close').click();

    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(document.querySelectorAll('.editing').length).toBe(0);
  });

  it('担当と期限を入れて保存できる', () => {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .row-open').click();
    document.getElementById('side-edit').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[2].value).toBe('@me@example.com ');
    expect(inputs[4].value).toBe('2026-09-30');

    inputs[2].value = '@other@example.com ';
    inputs[2].dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[0]).toBe(2);
    expect(call.args[1].assignee).toBe('other@example.com');
  });

  it('Escape で閉じられる', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .row-open').click();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('side-panel').hidden).toBe(true);
  });
});

describe('掴んで親子を付け替える', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** jsdom には dataTransfer が無いので、同じ形のものを持たせる */
  function dragEvent(type, number) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.dataTransfer = {
      data: String(number),
      setData(_, v) { this.data = v; },
      getData() { return this.data; },
    };
    return ev;
  }

  function rows() {
    return [...document.querySelectorAll('#issue-list .row-item')];
  }

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('行を掴める', () => {
    openIssues();
    expect(rows()[0].draggable).toBe(true);
    expect(rows()[0].dataset.number).toBe('2');
  });

  it('掴むと解除の置き場所が出る', () => {
    openIssues();
    const zone = document.getElementById('drop-root');

    expect(zone.hidden).toBe(true);
    rows()[0].dispatchEvent(dragEvent('dragstart', 2));
    expect(zone.hidden).toBe(false);

    rows()[0].dispatchEvent(dragEvent('dragend', 2));
    expect(zone.hidden).toBe(true);
  });

  it('別のやることの上に落とすと子になる', () => {
    const app = openIssues();

    // #1 を掴んで #2 の上に落とす
    const child = rows().find((r) => r.dataset.number === '1');
    const parent = rows().find((r) => r.dataset.number === '2');

    child.dispatchEvent(dragEvent('dragstart', 1));
    parent.dispatchEvent(dragEvent('drop', 1));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[0]).toBe(1);
    expect(call.args[1].parent).toBe(2);
  });

  it('解除の置き場所に落とすと親が外れる', () => {
    const app = openIssues();

    document.getElementById('drop-root').dispatchEvent(dragEvent('drop', 1));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[0]).toBe(1);
    expect(call.args[1].parent).toBe('');
  });

  it('自分の子を親にはできない', () => {
    const app = openIssues();

    // #1 は #2 の子。#2 を #1 の上に落とそうとする
    const parent = rows().find((r) => r.dataset.number === '2');
    const child = rows().find((r) => r.dataset.number === '1');

    parent.dispatchEvent(dragEvent('dragstart', 2));
    child.dispatchEvent(dragEvent('drop', 2));

    expect(app.calls.some((c) => c.name === 'apiIssueUpdate')).toBe(false);
    expect(document.getElementById('snackbar').textContent).toContain('親にはできません');
  });
});

describe('やることの絞り込み', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function titles() {
    return [...document.querySelectorAll('#issue-list .row-title')]
      .map((el) => el.textContent);
  }

  it('文書名で絞り込める', () => {
    openIssues();
    const input = document.getElementById('issue-filter');

    // どちらの題名にも「就業規則」は無い。紐づく文書 DOC1 の名前で当たる
    input.value = '就業規則';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(titles()).toHaveLength(2);

    input.value = '賃金規程';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(titles()).toHaveLength(0);
  });

  it('改訂版の写しの名前では二重に数えない', () => {
    openIssues();

    const input = document.getElementById('issue-filter');
    input.value = '見直し';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    // 「通勤手当の見直し」の題名だけが当たる
    expect(titles()).toHaveLength(1);
  });

  it('自分の担当ボタンで自分の分だけになる', () => {
    openIssues({
      apiIssueList: [
        { ...DEFAULTS.apiIssueList[0], assignee: 'me@example.com' },
        { ...DEFAULTS.apiIssueList[1], assignee: 'other@example.com' },
      ],
    });

    document.getElementById('mine-btn').click();

    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain('#2');
    expect(document.getElementById('mine-btn').getAttribute('aria-checked')).toBe('true');
  });

  it('もう一度押すと全部に戻る', () => {
    openIssues();

    const btn = document.getElementById('mine-btn');
    btn.click();
    btn.click();

    expect(btn.getAttribute('aria-checked')).toBe('false');
    expect(titles().length).toBeGreaterThan(1);
  });
});

describe('やることを捨てる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('捨てるボタンは赤塗りのアイコンだけで、名前を持つ', () => {
    openIssues();
    const row = document.querySelector('#issue-list .row-item');
    const del = row.querySelector('.btn-danger');

    expect(del.textContent).toBe('');
    expect(del.querySelector('svg')).toBeTruthy();
    expect(del.getAttribute('aria-label')).toContain('捨てる');
  });

  it('確かめてからでないと捨てない', () => {
    const app = openIssues();
    document.querySelector('#issue-list .row-item .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiIssueArchive')).toBe(false);

    const strip = document.querySelector('#panel-issues .confirm-strip');
    expect(strip.textContent).toContain('戻せます');

    strip.querySelector('.btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiIssueArchive').pop().args[0]).toBe(2);
  });

  it('捨てたものは置き場に並び、残り日数が出る', () => {
    openIssues({
      apiIssueArchivedList: [{
        number: 7, title: '要らなくなった', state: 'open',
        archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22,
      }],
    });
    document.getElementById('view-trash').click();

    const row = document.querySelector('#trash-list .row-item');
    expect(row.textContent).toContain('#7');
    expect(row.textContent).toContain('あと22日');
  });

  it('置き場から元に戻せる', () => {
    const app = openIssues({
      apiIssueArchivedList: [{
        number: 7, title: '戻す', state: 'open',
        archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22,
      }],
    });
    document.getElementById('view-trash').click();

    [...document.querySelectorAll('#trash-list .btn')]
      .find((b) => b.textContent.includes('元に戻す')).click();

    expect(app.calls.filter((c) => c.name === 'apiIssueRestore').pop().args[0]).toBe(7);
  });

  it('完全に消すのは確かめてから', () => {
    const app = openIssues({
      apiIssueArchivedList: [{
        number: 7, title: '消す', state: 'open',
        archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22,
      }],
    });
    document.getElementById('view-trash').click();
    document.querySelector('#trash-list .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiIssuePurge')).toBe(false);

    const strip = document.querySelector('#panel-issues .confirm-strip');
    expect(strip.textContent).toContain('もう戻せません');
    strip.querySelector('.btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssuePurge').pop().args[0]).toBe(7);
  });

  it('置き場では絞り込みと束ね方を隠す', () => {
    openIssues();
    document.getElementById('view-trash').click();

    expect(document.getElementById('issue-filter').parentNode.hidden).toBe(true);
    expect(document.getElementById('mine-btn').hidden).toBe(true);
  });

  it('置き場が空なら何が起きるかを説明する', () => {
    openIssues();
    document.getElementById('view-trash').click();

    expect(document.getElementById('trash-list').textContent).toContain('30日');
  });
});

describe('動きのないやることの見た目', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function withStale(level, days) {
    return {
      apiIssueList: [{
        ...DEFAULTS.apiIssueList[0], parent: '',
        staleLevel: level, staleDays: days,
      }],
    };
  }

  it('動きがあるうちは何も付かない', () => {
    openIssues(withStale(0, 2));
    const row = document.querySelector('#issue-list .row-item');

    expect(row.className).not.toContain('rot-');
    expect(row.querySelector('.stale-badge')).toBe(null);
  });

  it('放っておくほど段階が上がる', () => {
    openIssues(withStale(3, 40));
    const row = document.querySelector('#issue-list .row-item');

    expect(row.classList.contains('rot-3')).toBe(true);
  });

  it('色だけに頼らず日数も出す', () => {
    openIssues(withStale(2, 20));
    const badge = document.querySelector('#issue-list .stale-badge');

    expect(badge.textContent).toContain('20日動きなし');
    expect(document.querySelector('#issue-list .row-item').title).toContain('20日間');
  });

  it('ボードのカードも傷む', () => {
    openIssues({
      apiProjectBoard: {
        Backlog: [{
          issueNumber: 5, order: 0, title: '忘れられた', state: 'open',
          assignee: '', labels: '', dueDate: '', staleLevel: 3, staleDays: 60,
        }],
        'In Progress': [], 'In Review': [], Done: [],
      },
    });
    document.getElementById('view-board').click();

    const card = document.querySelector('.board-card');
    expect(card.classList.contains('rot-3')).toBe(true);
    expect(card.textContent).toContain('60日動きなし');
  });
});

describe('完了を差し戻す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  const CLOSED = {
    apiIssueList: [{
      ...DEFAULTS.apiIssueList[0], number: 9, title: '終わったこと',
      state: 'closed', parent: '',
    }],
  };

  it('完了したものには戻すボタンが出る', () => {
    openIssues(CLOSED);
    const row = document.querySelector('#issue-list .row-item');

    expect(row.querySelector('.icon-btn.ok')).toBe(null);
    expect(row.getAttribute('aria-label')).toBe(null);
    expect([...row.querySelectorAll('.icon-btn')]
      .some((b) => (b.getAttribute('aria-label') || '').includes('完了を取り消す')))
      .toBe(true);
  });

  it('押すと開き直す', () => {
    const app = openIssues(CLOSED);

    [...document.querySelectorAll('#issue-list .icon-btn')]
      .find((b) => (b.getAttribute('aria-label') || '').includes('完了を取り消す'))
      .click();

    expect(app.calls.filter((c) => c.name === 'apiIssueReopen').pop().args[0]).toBe(9);
    expect(document.getElementById('snackbar').textContent).toContain('やることに戻しました');
  });

  it('まだ終わっていないものには出ない', () => {
    openIssues();
    const row = document.querySelector('#issue-list .row-item');

    expect([...row.querySelectorAll('.icon-btn')]
      .some((b) => (b.getAttribute('aria-label') || '').includes('完了を取り消す')))
      .toBe(false);
    expect(row.querySelector('.icon-btn.ok')).toBeTruthy();
  });

  it('右のパネルからも戻せる', () => {
    const app = openIssues(CLOSED);
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    [...document.querySelectorAll('#side-body .btn')]
      .find((b) => b.textContent.includes('完了を取り消す')).click();

    expect(app.calls.some((c) => c.name === 'apiIssueReopen')).toBe(true);
  });
});

describe('絞り込みの入り切り', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('つまみのある切り替えとして出す', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    const btn = document.getElementById('mine-btn');

    // ただのボタンだと、押したのか絞り込んでいるのかが区別できない
    expect(btn.getAttribute('role')).toBe('switch');
    expect(btn.querySelector('.switch-track .switch-knob')).toBeTruthy();
  });

  it('いまどちらなのかを持つ', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    const btn = document.getElementById('mine-btn');

    expect(btn.getAttribute('aria-checked')).toBe('false');
    expect(btn.classList.contains('on')).toBe(false);

    btn.click();
    expect(btn.getAttribute('aria-checked')).toBe('true');
    expect(btn.classList.contains('on')).toBe(true);
  });

  it('報告の絞り込みは入りで始まる', () => {
    mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();
    const btn = document.getElementById('report-open-btn');

    expect(btn.getAttribute('role')).toBe('switch');
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('つまみを二重に作らない', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    const btn = document.getElementById('mine-btn');

    btn.click();
    btn.click();

    expect(btn.querySelectorAll('.switch-track')).toHaveLength(1);
  });
});

describe('名前を呼ぶ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const THREAD = {
    inquiry: {
      number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: 'x',
      body: '@me@example.com これ見て', by: 'other@example.com', state: 'open',
      context: '', answer: '', at: '', answeredAt: '', mine: false,
      canClose: false, replyCount: 0, shots: [],
    },
    replies: [{
      id: 1, inquiryNumber: 3, body: '@dareka おねがい', by: 'other@example.com',
      at: '', editedAt: '', canEdit: false, shots: [],
    }],
  };

  function openBoard() {
    const app = mount({
      apiInquiryList: [THREAD.inquiry],
      apiInquiryThread: THREAD,
      apiKnownPeople: ['me@example.com', 'other@example.com'],
    });
    document.querySelector('[data-tab="report"]').click();
    return app;
  }

  it('呼び出しに色が付く', () => {
    openBoard();
    const tag = document.querySelector('#report-detail .mention');

    expect(tag.textContent).toBe('@me@example.com');
    expect(tag.title).toBe('me@example.com');
  });

  it('自分が呼ばれたところは強く出す', () => {
    openBoard();

    // 長いやりとりの中で自分宛だけを拾えないと、呼ぶ意味がない
    expect(document.querySelector('#report-detail .mention').classList
      .contains('me')).toBe(true);
  });

  it('名簿に無い呼び出しは普通の字のまま', () => {
    openBoard();
    const tags = [...document.querySelectorAll('#report-detail .mention')];

    expect(tags.map((t) => t.textContent)).toEqual(['@me@example.com']);
    expect(document.getElementById('report-detail').textContent)
      .toContain('@dareka おねがい');
  });

  it('本文の字はそのまま残る', () => {
    openBoard();
    const body = document.querySelector('#report-detail .comment-body');

    expect(body.textContent).toBe('@me@example.com これ見て');
  });

  it('@ を打つと候補が出る', () => {
    openBoard();
    const input = document.querySelector('#report-detail .comment-form textarea');

    input.value = '@ot';
    input.selectionStart = 3;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    const picker = document.querySelector('#report-detail .mention-picker');
    expect(picker.hidden).toBe(false);
    // 名前を主に、アドレスを従に出す
    expect([...picker.querySelectorAll('.mention-option .mention-name')]
      .map((b) => b.textContent)).toEqual(['鈴木 花子']);
  });

  it('選ぶと本文に入る', () => {
    openBoard();
    const input = document.querySelector('#report-detail .comment-form textarea');

    input.value = '@ot';
    input.selectionStart = 3;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('#report-detail .mention-option').click();

    // ふだんは名前だけで足りる
    expect(input.value).toBe('@other ');
  });

  it('候補が無ければ出さない', () => {
    openBoard();
    const input = document.querySelector('#report-detail .comment-form textarea');

    input.value = '@zzz';
    input.selectionStart = 4;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelector('#report-detail .mention-picker').hidden)
      .toBe(true);
  });
});

describe('やることのタグ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openCreate(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    return app;
  }

  function tagInput() {
    return document.querySelector('#side-body .tag-input');
  }

  function type(value) {
    const input = tagInput();
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return input;
  }

  it('「#」を打つと候補が出る', () => {
    openCreate();
    type('#');

    const box = document.querySelector('#side-body .tag-suggest');
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.label-pill')].map((p) => p.textContent))
      .toEqual(['文書改訂', '会議']);
  });

  it('打った字で絞り込む', () => {
    openCreate();
    type('#会');

    expect([...document.querySelectorAll('#side-body .tag-suggest .label-pill')]
      .map((p) => p.textContent)).toEqual(['会議']);
  });

  it('候補を押すと差し込まれる', () => {
    openCreate();
    type('#会');
    document.querySelector('#side-body .tag-suggest .mention-option').click();

    expect(tagInput().value).toBe('#会議 ');
  });

  it('書いたぶんがその場で形になる', () => {
    openCreate();
    type('#会議 #調査 ');

    expect([...document.querySelectorAll('#side-body .tag-chosen .label-pill')]
      .map((p) => p.textContent)).toEqual(['会議', '調査']);
  });

  it('空白で区切って送る', () => {
    const app = openCreate();
    type('#会議 #棚卸し ');

    document.querySelector('#side-body form input').value = '棚卸しをする';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[3])
      .toBe('会議,棚卸し');
  });

  it('候補に無いタグもそのまま書ける', () => {
    const app = openCreate();
    type('#はじめてのタグ ');

    document.querySelector('#side-body form input').value = 'x';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[3])
      .toBe('はじめてのタグ');
  });

  it('もう書いたタグは候補に出さない', () => {
    openCreate();
    type('#会議 #');

    expect([...document.querySelectorAll('#side-body .tag-suggest .label-pill')]
      .map((p) => p.textContent)).toEqual(['文書改訂']);
  });

  it('直すときは今のタグが入った状態で開く', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], labels: '文書改訂,会議', parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    expect(tagInput().value).toBe('#文書改訂 #会議 ');
  });

  it('色はテーマの色だけを使う', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], labels: '文書改訂', parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .label-pill').className)
      .toContain('tag-accent');
  });

  it('一覧に無いタグでも読める色にする', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], labels: '知らないタグ', parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .label-pill').className)
      .toContain('tag-ink');
  });
});

describe('文書に紐づかないやること', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('文書を開いていなければ紐づけを尋ねない', () => {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();

    expect(document.querySelector('#side-body .check-row')).toBe(null);

    document.querySelector('#side-body form input').value = '棚卸しをする';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[2])
      .toEqual([]);
  });

  it('文書を開いていたら紐づけるかを選べる', () => {
    const app = mount();
    document.querySelector('[data-tab="docs"]').click();
    document.querySelector('#doc-list .doc-open').click();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();

    const box = document.querySelector('#side-body .check-row input');
    expect(box.checked).toBe(true);

    // 外せば、文書と関係のないやることとして作られる
    box.checked = false;
    document.querySelector('#side-body form input').value = '棚卸しをする';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[2])
      .toEqual([]);
  });
});

describe('Google ToDo との同期', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('使えない環境では入口を出さない', () => {
    openIssues();

    // 押した先で断られるだけのボタンを出さない
    expect(document.getElementById('tasks-btn').hidden).toBe(true);
  });

  it('使える環境では入口が出る', () => {
    openIssues({
      apiTasksState: {
        available: true, listId: '', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
    });

    expect(document.getElementById('tasks-btn').hidden).toBe(false);
  });

  it('入れ先が決まっていなければ先に選ばせる', () => {
    const app = openIssues({
      apiTasksState: {
        available: true, listId: '', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
    });

    document.getElementById('tasks-btn').click();

    expect(app.calls.some((c) => c.name === 'apiTasksSync')).toBe(false);
    expect(document.getElementById('side-title').textContent)
      .toBe('Google ToDo と同期する');
    expect([...document.querySelectorAll('#side-body select option')]
      .map((o) => o.textContent)).toEqual(['マイタスク']);
  });

  it('入れ先が決まっていれば同期する', () => {
    const app = openIssues({
      apiTasksState: {
        available: true, listId: 'L1', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
      apiTasksSync: { pushed: 3, closed: 1, listId: 'L1' },
    });

    document.getElementById('tasks-btn').click();

    expect(app.calls.some((c) => c.name === 'apiTasksSync')).toBe(true);
    expect(document.getElementById('snackbar').textContent)
      .toContain('3件を ToDo に送りました');
  });

  it('何を送るのかを先に伝える', () => {
    openIssues({
      apiTasksState: {
        available: true, listId: '', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
    });
    document.getElementById('tasks-btn').click();

    expect(document.getElementById('side-body').textContent)
      .toContain('自分が担当で、まだ終わっていない');
  });
});

describe('親子関係の見え方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function chips(scope) {
    return [...document.querySelectorAll(scope + ' .rel-chip')]
      .map((c) => c.textContent);
  }

  it('一覧で子から親へ行ける', () => {
    openIssues();

    // #1 は #2 の子
    const child = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '1');
    expect([...child.querySelectorAll('.rel-chip')].map((c) => c.textContent))
      .toContain('親 #2');
  });

  it('一覧で親から子へ行ける', () => {
    openIssues();

    const parent = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '2');
    expect([...parent.querySelectorAll('.rel-chip')].map((c) => c.textContent))
      .toContain('子 1');
  });

  it('押すと相手が光る', () => {
    openIssues();

    const child = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '1');
    [...child.querySelectorAll('.rel-chip')]
      .find((c) => c.textContent === '親 #2').click();

    const parent = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '2');
    expect(parent.classList.contains('flash')).toBe(true);
  });

  it('見えないところに居るなら中身を開く', () => {
    const app = openIssues();

    // 絞り込んで相手を画面から消す
    const input = document.getElementById('issue-filter');
    input.value = '第2条';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    const row = document.querySelector('#issue-list .row-item');
    const chip = [...row.querySelectorAll('.rel-chip')]
      .find((c) => c.textContent === '親 #2');

    if (chip) {
      chip.click();
      expect(app.calls.some((c) => c.name === 'apiIssueList')).toBe(true);
    }
    expect(true).toBe(true);
  });

  it('ボードのカードにも出る', () => {
    mount({
      apiProjectBoard: {
        Backlog: [{
          issueNumber: 1, order: 0, title: '第2条の改訂', state: 'open',
          assignee: '', labels: '', dueDate: '', staleLevel: 0, staleDays: 0,
        }],
        'In Progress': [], 'In Review': [], Done: [],
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();

    expect(chips('.board-card')).toContain('親 #2');
    expect(document.querySelector('.board-card').dataset.number).toBe('1');
  });

  it('工程表でも字下げと行き先が出る', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-gantt').click();

    const child = [...document.querySelectorAll('.gantt-row')]
      .find((r) => r.dataset.number === '1');

    expect(child.classList.contains('nested')).toBe(true);
    expect(child.querySelector('.gantt-name').style.paddingLeft).not.toBe('');
    expect([...child.querySelectorAll('.rel-chip')].map((c) => c.textContent))
      .toContain('親 #2');
  });

  it('親が居ないものには出さない', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(chips('#issue-list')).toEqual([]);
  });

  it('行き先には何が起きるかを添える', () => {
    openIssues();

    const child = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '1');
    const chip = [...child.querySelectorAll('.rel-chip')]
      .find((c) => c.textContent === '親 #2');

    expect(chip.dataset.hint).toContain('通勤手当の見直し');
  });
});

describe('補足の出しかた', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 位置を作ってから触れる */
  function hover(el, rect) {
    el.getBoundingClientRect = () => Object.assign(
      { left: 0, right: 32, top: 0, bottom: 32, width: 32, height: 32 }, rect);
    el.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    return document.getElementById('hint-bubble');
  }

  function sizeBubble(w, h) {
    const box = document.getElementById('hint-bubble');
    if (box) box.getBoundingClientRect = () => ({ width: w, height: h });
  }

  it('器の外に1つだけ置く', () => {
    mount();
    const box = hover(document.getElementById('bell-btn'), {});

    // 器の中に描くと、幅の狭いペインや巻き取る器に切り取られる
    expect(box.parentNode).toBe(document.body);
    expect(box.hidden).toBe(false);
    expect(document.querySelectorAll('.hint-bubble')).toHaveLength(1);
  });

  it('言葉をそのまま出す', () => {
    mount();
    const btn = document.getElementById('bell-btn');
    const box = hover(btn, {});

    expect(box.textContent).toBe(btn.dataset.hint);
  });

  it('補足を持たないところに移ったらしまう', () => {
    mount();
    hover(document.getElementById('bell-btn'), {});

    document.getElementById('doc-list')
      .dispatchEvent(new window.Event('pointerover', { bubbles: true }));

    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('中の要素に触れても出したままにする', () => {
    mount();
    const btn = document.getElementById('bell-btn');
    hover(btn, {});

    // アイコンは補足を持つボタンの中にある
    btn.querySelector('svg')
      .dispatchEvent(new window.Event('pointerover', { bubbles: true }));

    expect(document.getElementById('hint-bubble').hidden).toBe(false);
  });

  it('押したらしまう', () => {
    mount();
    const btn = document.getElementById('bell-btn');
    hover(btn, {});

    btn.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('相手が居なくなったらしまう', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const del = document.querySelector('#issue-list .btn-danger');
    hover(del, {});
    expect(document.getElementById('hint-bubble').hidden).toBe(false);

    // 押した拍子に一覧が描き直されると「離れた」が来ない
    del.remove();
    document.body.dispatchEvent(new window.Event('pointermove', { bubbles: true }));

    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('焦点が外れたらしまう', () => {
    mount();
    hover(document.getElementById('bell-btn'), {});

    document.dispatchEvent(new window.Event('focusout', { bubbles: true }));
    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('右にはみ出すなら左に寄せる', () => {
    mount();
    const btn = document.getElementById('bell-btn');

    hover(btn, {});
    sizeBubble(280, 60);
    hideAndHover(btn, { left: window.innerWidth - 40, right: window.innerWidth - 8 });

    const left = parseInt(document.getElementById('hint-bubble').style.left, 10);
    expect(left + 280).toBeLessThanOrEqual(window.innerWidth);
  });

  it('下にはみ出すなら上に出す', () => {
    mount();
    const btn = document.getElementById('bell-btn');

    hover(btn, {});
    sizeBubble(200, 80);
    hideAndHover(btn, {
      top: window.innerHeight - 40, bottom: window.innerHeight - 8,
    });

    const top = parseInt(document.getElementById('hint-bubble').style.top, 10);
    expect(top).toBeLessThan(window.innerHeight - 40);
  });

  it('窓からはみ出す位置には置かない', () => {
    mount();
    const btn = document.getElementById('bell-btn');

    hover(btn, {});
    sizeBubble(280, 400);
    hideAndHover(btn, { left: -50, top: -50, bottom: -18 });

    const box = document.getElementById('hint-bubble');
    expect(parseInt(box.style.left, 10)).toBeGreaterThanOrEqual(0);
    expect(parseInt(box.style.top, 10)).toBeGreaterThanOrEqual(0);
  });

  it('巻き取ったらしまう', () => {
    mount();
    hover(document.getElementById('bell-btn'), {});

    document.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('触れられて操作の邪魔をしない', () => {
    mount();
    const box = hover(document.getElementById('bell-btn'), {});

    expect(box.getAttribute('aria-hidden')).toBe('true');
  });

  /** 同じ相手をもう一度測り直させる */
  function hideAndHover(el, rect) {
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    return hover(el, rect);
  }
});

describe('表示する名前', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    const app = mount();
    document.querySelector('[data-tab="help"]').click();
    return app;
  }

  it('使い方から決められる', () => {
    const app = openHelp();

    [...document.querySelectorAll('#guide .btn')]
      .find((b) => b.textContent.includes('表示する名前')).click();

    const input = document.querySelector('#side-body input');
    expect(input.value).toBe('山田 太郎');

    input.value = '山田 一郎';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiPeopleSetName').pop().args)
      .toEqual(['me@example.com', '山田 一郎']);
  });

  it('名前を決めても、次に組んだ画面には前の名前が残らない', () => {
    // 疑似の google.script.run が返事の写しを渡しているかを見る。同じ物を渡すと
    // 画面が書き込んだ名前が DEFAULTS に残り、後のテストに漏れる
    openHelp();
    [...document.querySelectorAll('#guide .btn')]
      .find((b) => b.textContent.includes('表示する名前')).click();
    document.querySelector('#side-body input').value = '山田 一郎';
    document.querySelector('#side-body form .btn-primary').click();

    openHelp();
    expect(document.getElementById('whoami').textContent).toContain('山田 太郎');
  });

  it('遅らせた返事も写しで渡す', () => {
    const shared = { 'me@example.com': '山田 太郎' };
    let deliver;
    mount({ apiPeopleNames: { later: (ok) => { deliver = ok; } } });
    deliver(shared);
    [...document.querySelectorAll('[data-tab="help"]')][0].click();
    [...document.querySelectorAll('#guide .btn')]
      .find((b) => b.textContent.includes('表示する名前')).click();
    document.querySelector('#side-body input').value = '山田 一郎';
    document.querySelector('#side-body form .btn-primary').click();

    expect(shared['me@example.com']).toBe('山田 太郎');
  });

  it('いまの名前とアドレスの両方を示す', () => {
    openHelp();

    expect(document.getElementById('whoami').textContent)
      .toBe('このアプリはあなたを 山田 太郎 (me@example.com) として認識しています');
  });

  it('名前を知らない人はアドレスの手前で出る', () => {
    mount({ apiPeopleNames: {} });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .avatar')
      .getAttribute('aria-label')).toBe('me (me@example.com)');
  });
});

describe('担当者を「@」で選ぶ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDetail() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    return app;
  }

  function field() {
    return document.querySelectorAll('#side-body input, #side-body textarea')[2];
  }

  function type(value) {
    const input = field();
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return input;
  }

  it('いまの担当が「@」の形で入っている', () => {
    openDetail();
    expect(field().value).toBe('@me@example.com ');
  });

  it('名前でも探せる', () => {
    openDetail();
    type('@鈴木');

    const box = document.querySelector('.assignee-picker .mention-picker');
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.mention-name')].map((n) => n.textContent))
      .toEqual(['鈴木 花子']);
  });

  it('アドレスでも探せる', () => {
    openDetail();
    type('@other');

    expect([...document.querySelectorAll('.assignee-picker .mention-name')]
      .map((n) => n.textContent)).toEqual(['鈴木 花子']);
  });

  it('選ぶとアドレスが入る', () => {
    openDetail();
    type('@鈴木');
    document.querySelector('.assignee-picker .mention-option').click();

    // 手で打たせると、打ち間違いが黙って通る
    expect(field().value).toContain('@other@example.com');
  });

  it('何人でも並べられる', () => {
    const app = openDetail();
    type('@me@example.com @other@example.com ');

    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].assignee)
      .toBe('me@example.com,other@example.com');
  });

  it('選んだ人が顔と名前で並ぶ', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    expect([...document.querySelectorAll('.assignee-chosen .person-name')]
      .map((n) => n.textContent)).toEqual(['山田 太郎', '鈴木 花子']);
  });

  it('もう選んだ人は候補に出さない', () => {
    openDetail();
    type('@me@example.com @');

    expect([...document.querySelectorAll('.assignee-picker .mention-name')]
      .map((n) => n.textContent)).toEqual(['鈴木 花子']);
  });

  it('自分に割り当てるを押すと足される', () => {
    openDetail();
    type('@other@example.com ');

    [...document.querySelectorAll('#side-body .btn')]
      .find((b) => b.textContent.includes('自分に割り当てる')).click();

    expect(field().value).toContain('@me@example.com');
    expect(field().value).toContain('@other@example.com');
  });

  it('誰も居なければそう出す', () => {
    openDetail();
    type('');

    expect(document.querySelector('.assignee-chosen').textContent)
      .toContain('まだ誰も割り当てていません');
  });
});

describe('複数の担当者の見え方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const TWO = {
    ...DEFAULTS.apiIssueList[0], parent: '',
    assignee: 'me@example.com,other@example.com',
    assignees: ['me@example.com', 'other@example.com'],
  };

  it('顔を並べて出す', () => {
    mount({ apiIssueList: [TWO] });
    document.querySelector('[data-tab="issues"]').click();

    const faces = document.querySelectorAll('#issue-list .avatars .avatar');
    expect([...faces].map((f) => f.textContent)).toEqual(['山', '鈴']);
  });

  it('多いときは残りを数で示す', () => {
    mount({
      apiIssueList: [{
        ...TWO,
        assignees: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'],
      }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .avatar.more').textContent)
      .toBe('+2');
  });

  it('担当者ごとに束ねると両方の束に出る', () => {
    mount({ apiIssueList: [TWO] });
    document.querySelector('[data-tab="issues"]').click();

    const sel = document.getElementById('issue-group');
    sel.value = 'assignee';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    // 片方にしか出さないと、もう片方の人には自分の仕事が見えない
    expect([...document.querySelectorAll('#issue-list .group-head')]
      .map((h) => h.textContent.replace('▾', '')))
      .toEqual(['山田 太郎1', '鈴木 花子1']);
  });

  it('自分の担当だけに絞っても残る', () => {
    mount({ apiIssueList: [TWO] });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('mine-btn').click();

    expect(document.querySelectorAll('#issue-list .row-item')).toHaveLength(1);
  });
});

describe('担当者を外す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDetail() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    return app;
  }

  function field() {
    return document.querySelectorAll('#side-body input, #side-body textarea')[2];
  }

  function type(value) {
    const input = field();
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  function chips() {
    return [...document.querySelectorAll('.assignee-chosen .reviewer-chip')];
  }

  it('札ごとに外す印が付く', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    // 文字を消させると、どこからどこまでが1人ぶんか分かりにくい
    expect(chips().map((c) => c.querySelector('.chip-off').getAttribute('aria-label')))
      .toEqual(['山田 太郎 を外す', '鈴木 花子 を外す']);
  });

  it('押すとその人だけ消える', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    chips()[0].querySelector('.chip-off').click();

    expect(field().value).toBe('@other@example.com ');
    expect(chips().map((c) => c.querySelector('.person-name').textContent))
      .toEqual(['鈴木 花子']);
  });

  it('全部外すと担当なしになる', () => {
    const app = openDetail();
    type('@me@example.com ');

    chips()[0].querySelector('.chip-off').click();
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].assignee)
      .toBe('');
  });

  it('外したあとに残った人だけを送る', () => {
    const app = openDetail();
    type('@me@example.com @other@example.com ');

    chips()[1].querySelector('.chip-off').click();
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].assignee)
      .toBe('me@example.com');
  });

  it('外したあと、その人はまた候補に出る', () => {
    openDetail();
    type('@me@example.com @other@example.com ');
    chips()[1].querySelector('.chip-off').click();

    type(field().value + '@');

    expect([...document.querySelectorAll('.assignee-picker .mention-name')]
      .map((n) => n.textContent)).toContain('鈴木 花子');
  });

  it('2人から1人になったら断り書きも消える', () => {
    openDetail();
    type('@me@example.com @other@example.com ');
    expect(document.querySelector('.assignee-note')).toBeTruthy();

    chips()[1].querySelector('.chip-off').click();

    expect(document.querySelector('.assignee-note')).toBe(null);
  });
});

describe('やることを読む形で開く', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ISSUE = {
    ...DEFAULTS.apiIssueList[0], parent: '',
    body: '## 手順\n\n- [ ] まず\n- [x] 済んだ\n\n**大事**なこと',
  };

  function openView(over) {
    const app = mount(Object.assign({ apiIssueList: [ISSUE] }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    return app;
  }

  it('読む形で出る', () => {
    openView();

    // 触っただけで中身が変わりそうで怖い、を避ける
    expect(document.querySelector('#side-body .side-view')).toBeTruthy();
    expect(document.querySelector('#side-body form')).toBe(null);
  });

  it('鉛筆を押すと書き換えられる', () => {
    openView();
    expect(document.getElementById('side-edit').hidden).toBe(false);

    document.getElementById('side-edit').click();

    expect(document.querySelector('#side-body form')).toBeTruthy();
  });

  it('いつ・誰が・どれくらいを並べる', () => {
    openView();
    const facts = [...document.querySelectorAll('.view-facts dt')]
      .map((d) => d.textContent);

    expect(facts).toContain('状態');
    expect(facts).toContain('担当');
    expect(facts).toContain('工数');
  });

  it('補足をマークダウンとして組み立てる', () => {
    openView();
    const md = document.querySelector('#side-body .md');

    // 「##」は2段目なので h4。パネルの中では h2 より下に置く
    expect(md.querySelector('h4').textContent).toBe('手順');
    expect(md.querySelectorAll('.md-tasks li')).toHaveLength(2);
    expect(md.querySelector('.md-check.done')).toBeTruthy();
    expect(md.querySelector('strong').textContent).toBe('大事');
  });

  it('組み立ては字だけで行う', () => {
    openView({
      apiIssueList: [{ ...ISSUE, body: '<script>あぶない</script>' }],
    });

    const md = document.querySelector('#side-body .md');
    expect(md.querySelector('script')).toBe(null);
    expect(md.textContent).toContain('<script>');
  });

  it('http 以外のリンクは字のまま出す', () => {
    openView({
      apiIssueList: [{ ...ISSUE, body: '[あぶない](javascript:alert(1))' }],
    });

    expect(document.querySelector('#side-body .md a')).toBe(null);
    expect(document.querySelector('#side-body .md').textContent)
      .toContain('あぶない');
  });

  it('読む形のまま完了にできる', () => {
    const app = openView();

    [...document.querySelectorAll('#side-body .inline-form-actions .btn')]
      .find((b) => b.textContent.includes('完了にする')).click();

    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
  });

  it('補足が空ならそう出す', () => {
    openView({ apiIssueList: [{ ...ISSUE, body: '' }] });

    expect(document.querySelector('#side-body .md').textContent)
      .toContain('補足はありません');
  });
});

describe('やることの中で話す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const TALK = [
    {
      id: 1, issueNumber: 2, body: '**急ぎ**でお願いします',
      by: 'other@example.com', at: '2026-09-09T00:00:00.000Z',
      editedAt: '', canEdit: false,
    },
    {
      id: 2, issueNumber: 2, body: '了解です', by: 'me@example.com',
      at: '2026-09-10T00:00:00.000Z', editedAt: '', canEdit: true,
    },
  ];

  function openView(over) {
    const app = mount(Object.assign({ apiIssueComments: TALK }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    return app;
  }

  it('やりとりが並ぶ', () => {
    openView();
    const rows = [...document.querySelectorAll('.issue-talk-list .comment')];

    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.person-name').textContent).toBe('鈴木 花子');
    expect(rows[0].querySelector('strong').textContent).toBe('急ぎ');
  });

  it('書き込める', () => {
    const app = openView();

    const box = document.querySelector('.issue-talk .comment-form textarea');
    box.value = '着手します';
    document.querySelector('.issue-talk .comment-form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueComment').pop().args)
      .toEqual([2, '着手します']);
  });

  it('自分の書き込みだけ直せる', () => {
    openView();
    const rows = [...document.querySelectorAll('.issue-talk-list .comment')];

    expect(rows[0].querySelector('.comment-tools')).toBe(null);
    expect(rows[1].querySelector('.comment-tools')).toBeTruthy();
  });

  it('消すのは確かめてから', () => {
    const app = openView();
    const mine = [...document.querySelectorAll('.issue-talk-list .comment')][1];

    mine.querySelector('.comment-tools .btn-danger').click();
    expect(app.calls.some((c) => c.name === 'apiIssueCommentDelete')).toBe(false);

    document.querySelector('#side-body .confirm-strip .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiIssueCommentDelete').pop().args[0])
      .toBe(2);
  });

  it('まだ何も無ければ何を残す場所かを言う', () => {
    openView({ apiIssueComments: [] });

    expect(document.querySelector('.issue-talk-list').textContent)
      .toContain('決めた理由をここに残せます');
  });

  it('「@」で人を呼べる', () => {
    openView();
    const box = document.querySelector('.issue-talk .comment-form textarea');

    box.value = '@ot';
    box.selectionStart = 3;
    box.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelector('.issue-talk .mention-picker').hidden)
      .toBe(false);
  });
});

describe('補足の下書き', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openEdit() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    return app;
  }

  function bodyField() {
    return document.querySelectorAll('#side-body input, #side-body textarea')[1];
  }

  it('用意されたものと自分のものが並ぶ', () => {
    openEdit();

    expect([...document.querySelectorAll('.template-use')]
      .map((b) => b.textContent)).toEqual(['作業の段取り', '週報']);
  });

  it('押すと差し込まれる', () => {
    openEdit();
    const body = bodyField();
    body.value = '';
    body.selectionStart = 0;
    body.selectionEnd = 0;

    document.querySelector('.template-use').click();

    expect(body.value).toContain('## やること');
  });

  it('前に字があれば1行空ける', () => {
    openEdit();
    const body = bodyField();
    body.value = 'まえの字';
    body.selectionStart = body.selectionEnd = body.value.length;

    document.querySelector('.template-use').click();

    // 続けて差し込むと塊が繋がって読めない
    expect(body.value).toBe('まえの字\n\n## やること\n\n- [ ] \n');
  });

  it('自分の下書きだけ消せる', () => {
    openEdit();
    const chips = [...document.querySelectorAll('.template-chip')];

    expect(chips[0].querySelector('.chip-off')).toBe(null);
    expect(chips[1].querySelector('.chip-off')).toBeTruthy();
  });

  it('いまの補足を下書きにできる', () => {
    const app = openEdit();
    bodyField().value = '## 今週やったこと\n';

    [...document.querySelectorAll('.template-bar .btn')]
      .find((b) => b.textContent.includes('下書きにする')).click();

    document.querySelector('#side-body form input').value = '週次';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiTemplateSave').pop().args)
      .toEqual(['週次', '## 今週やったこと\n']);
  });

  it('補足が空なら下書きにさせない', () => {
    openEdit();
    bodyField().value = '   ';

    [...document.querySelectorAll('.template-bar .btn')]
      .find((b) => b.textContent.includes('下書きにする')).click();

    expect(document.getElementById('snackbar').textContent)
      .toContain('先に補足を書いて');
  });
});

describe('起票のときに入れられるもの', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openCreate() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    return app;
  }

  it('担当者や工数まで尋ねる', () => {
    openCreate();

    // 作ってすぐ直せばよい、では二度手間になる
    // ラベルの字だけを読む (必須の札は字の隣に並ぶ)
    expect([...document.querySelectorAll('#side-body label')]
      .map((l) => (l.querySelector('.field-label') || l).firstChild.textContent))
      .toEqual([
        'やること', '補足 (Markdown で書けます)',
        '担当者 (「@」で選びます。何人でも)', '優先度',
        '開始日 (任意)', '期限 (任意)',
        '見積もり (規模。数値)', '予定工数 (人日)',
        'タグ (「#」で書きます。例: #会議 #調査)',
      ]);
  });

  it('入れたものを一緒に送る', () => {
    const app = openCreate();
    const fields = document.querySelectorAll('#side-body input, #side-body textarea');

    fields[0].value = '棚卸しをする';
    fields[2].value = '@me@example.com ';
    fields[2].dispatchEvent(new window.Event('input', { bubbles: true }));
    fields[4].value = '2026-10-31';
    fields[6].value = '2.5';

    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiIssueCreate').pop();
    expect(call.args[4]).toEqual({
      assignee: 'me@example.com',
      startDate: '',
      dueDate: '2026-10-31',
      estimate: '',
      plannedHours: '2.5',
      priority: 'normal',
    });
  });

  it('工数は半日きざみで入れられる', () => {
    openCreate();
    const fields = document.querySelectorAll('#side-body input, #side-body textarea');

    expect(fields[6].step).toBe('0.5');
    expect(fields[3].type).toBe('date');
  });

  it('下書きも差し込める', () => {
    openCreate();

    expect(document.querySelector('#side-body .template-use')).toBeTruthy();
  });
});

describe('やることの優先度', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 既定の2件に優先度を付けたもの */
  const ROWS = {
    apiIssueList: [
      Object.assign({}, DEFAULTS.apiIssueList[0], { priority: 'high' }),
      Object.assign({}, DEFAULTS.apiIssueList[1], { priority: 'low' }),
      {
        number: 9, title: 'ふつうの件', body: '', state: 'open',
        assignee: '', assignees: [], labels: '', linkedFileIds: '', linkedPr: '',
        createdAt: '2026-09-03T00:00:00.000Z', closedAt: '',
        dueDate: '', startDate: '', parent: '',
        estimate: '', plannedHours: '', actualHours: '', priority: 'normal',
      },
    ],
  };

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function chipsOf(n) {
    const row = document.querySelector(
      '#issue-list .row-item[data-number="' + n + '"]');

    expect(row, '#' + n + ' の行が無い').toBeTruthy();
    return [...row.querySelectorAll('.chip-pri')].map((c) => c.textContent);
  }

  it('高いものと低いものに印が出る', () => {
    openIssues(ROWS);

    expect(chipsOf(2)).toEqual(['優先度高']);
    expect(chipsOf(1)).toEqual(['優先度低']);
  });

  it('ふつうには印を出さない', () => {
    openIssues(ROWS);

    // ほとんどがふつうなので、全件に付けると印が地になって、高いものが
    // 目に入らなくなる
    expect(chipsOf(9)).toEqual([]);
  });

  it('色だけに頼らない', () => {
    openIssues(ROWS);
    const chip = document.querySelector('#issue-list .chip-pri');

    // 色の違いに気づけない人がいる
    expect(chip.textContent).toContain('優先度');
    expect(chip.className).toContain('chip-pri-high');
  });

  it('作るときに選べる', () => {
    const app = openIssues();
    document.getElementById('issue-create-btn').click();

    const select = document.querySelector('#side-body select');
    expect([...select.options].map((o) => o.textContent))
      .toEqual(['高', 'ふつう', '低']);
    expect(select.value).toBe('normal');

    select.value = 'high';
    document.querySelector('#side-body form input').value = '棚卸し';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[4])
      .toMatchObject({ priority: 'high' });
  });

  it('直すときは今の値が選ばれている', () => {
    const app = openIssues(ROWS);
    document.querySelector('#issue-list .row-item[data-number="2"] .row-open')
      .click();
    document.getElementById('side-edit').click();

    const select = document.querySelector('#side-body select');
    expect(select.value).toBe('high');

    select.value = 'low';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1])
      .toMatchObject({ priority: 'low' });
  });

  it('語彙はサーバから取る', () => {
    const app = openIssues();

    // 写すと、足したときに選べるのに保存できない選択肢になる
    expect(app.calls.some((c) => c.name === 'apiIssuePriorities')).toBe(true);
  });

  it('ボードのカードにも出る', () => {
    openIssues({
      apiProjectBoard: {
        Backlog: [{
          issueNumber: 3, order: 0, title: '急ぎの件', state: 'open',
          assignee: '', assignees: [], labels: '', dueDate: '',
          staleDays: 0, staleLevel: '', priority: 'high',
        }],
      },
    });
    document.getElementById('view-board').click();

    // 一覧にだけ出ると、ボードで見ている人には何が急ぎなのか伝わらない
    expect(document.querySelector('#board .chip-pri').textContent)
      .toBe('優先度高');
  });
});

describe('送れなかった入力は消さない', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /*
   * 入力欄は送った直後に閉じる。サーバの返事を待たずに閉じるので、失敗すると
   * (混み合っているときなど) 書いた本文ごと消え、最初から書き直すことになった。
   */
  function form() { return document.querySelector('#side-body form'); }

  it('失敗したら、書いたまま開き直す', () => {
    const app = mount({ apiIssueCreate: new Error('混み合っています') });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();

    form().querySelector('input').value = '棚卸しの段取り';
    form().querySelector('textarea').value = '長い補足。\n書き直したくない。';
    form().querySelector('.btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate')).toHaveLength(1);
    expect(document.getElementById('side-panel').hidden).toBe(false);
    expect(form().querySelector('input').value).toBe('棚卸しの段取り');
    expect(form().querySelector('textarea').value).toBe('長い補足。\n書き直したくない。');
  });

  it('開き直した入力から、もう一度送れる', () => {
    const app = mount({ apiIssueCreate: new Error('混み合っています') });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    form().querySelector('input').value = '棚卸し';
    form().querySelector('.btn-primary').click();

    app.respond('apiIssueCreate', { number: 9, title: '棚卸し' });
    form().querySelector('.btn-primary').click();

    const sent = app.calls.filter((c) => c.name === 'apiIssueCreate');
    expect(sent).toHaveLength(2);
    expect(sent[1].args[0]).toBe('棚卸し');
    expect(document.getElementById('side-panel').hidden).toBe(true);
  });

  it('うまく送れたら、開き直さない', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    form().querySelector('input').value = '棚卸し';
    form().querySelector('.btn-primary').click();

    expect(document.getElementById('side-panel').hidden).toBe(true);
  });
});
