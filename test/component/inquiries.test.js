// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from './mount.js';

describe('開発者に伝える', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openReport(over) {
    const app = mount(over);
    document.querySelector('[data-tab="report"]').click();
    return app;
  }

  it('左のメニューから開ける', () => {
    openReport();
    expect(document.getElementById('panel-report').hidden).toBe(false);
  });

  it('まだ何も無いときは次の一手を示す', () => {
    openReport();
    expect(document.getElementById('report-list').textContent)
      .toContain('まだ何も伝えていません');
  });

  it('種類は選択肢から選ぶ', () => {
    openReport();
    document.getElementById('report-btn').click();

    const sel = document.querySelector('#side-body select');
    expect([...sel.options].map((o) => o.value))
      .toEqual(['bug', 'request', 'question', 'other']);
    expect(sel.value).toBe('bug');
  });

  it('見ている画面と環境を一緒に送る', () => {
    const app = openReport();
    document.getElementById('report-btn').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    inputs[0].value = '棒が伸びない';
    inputs[1].value = '掴んだ';
    inputs[2].value = '伸びない';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiInquiryCreate').pop();
    expect(call.args[0]).toBe('bug');
    expect(call.args[1]).toContain('棒が伸びない');
    expect(call.args[2]).toContain('画面: report');
    expect(call.args[2]).toContain('環境: ');
  });

  it('送ると受付番号が返る', () => {
    openReport({ apiInquiryCreate: { number: 7, kind: 'bug', body: 'x' } });
    document.getElementById('report-btn').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    inputs[0].value = 'ひとこと';
    inputs[1].value = 'したこと';
    inputs[2].value = 'なったこと';
    document.querySelector('#side-body form .btn-primary').click();

    expect(document.getElementById('snackbar').textContent).toContain('受付 #7');
  });

  it('送ったものが並ぶ', () => {
    openReport({
      apiInquiryList: [{
        number: 3, kind: 'bug', kindLabel: 'うまく動かない',
        title: '棒が伸びない', body: '棒が伸びない',
        by: 'me@example.com', state: 'open', context: '', answer: '',
        at: '2026-09-09T00:00:00.000Z', answeredAt: '', replyCount: 2,
      }],
    });

    const row = document.querySelector('#report-list .row-item');
    expect(row.textContent).toContain('#3 棒が伸びない');
    expect(row.textContent).toContain('返信 2件');
    expect(row.querySelector('.state').textContent).toBe('未解決');
  });

  it('未解決の件数を左に出す', () => {
    openReport({
      apiInquiryList: [
        { number: 1, kind: 'bug', kindLabel: 'うまく動かない', title: 'a', body: 'a', state: 'open', at: '', by: 'x@example.com' },
        { number: 2, kind: 'bug', kindLabel: 'うまく動かない', title: 'b', body: 'b', state: 'done', at: '', by: 'x@example.com' },
      ],
    });

    expect(document.getElementById('count-reports').textContent).toBe('1');
  });
});

describe('報告で議論する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const LIST = [
    {
      number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: '棒が伸びない',
      body: '棒が伸びない\n右端を掴んだ', by: 'other@example.com', state: 'open',
      context: '画面: issues / 環境: test', answer: '', at: '2026-09-09T00:00:00.000Z',
      answeredAt: '', mine: false, canClose: false, replyCount: 1,
    },
  ];

  const THREAD = {
    inquiry: LIST[0],
    replies: [{
      id: 1, inquiryNumber: 3, body: 'こちらでも起きます', by: 'me@example.com',
      at: '2026-09-09T01:00:00.000Z', editedAt: '', canEdit: true,
    }],
  };

  function openBoard(over) {
    const app = mount(Object.assign(
      { apiInquiryList: LIST, apiInquiryThread: THREAD }, over || {}));
    document.querySelector('[data-tab="report"]').click();
    return app;
  }

  it('他人の報告も読める', () => {
    openBoard();
    expect(document.querySelector('#report-list .row-item').textContent)
      .toContain('鈴木 花子');
  });

  it('開くと本文とやりとりが出る', () => {
    openBoard();
    const detail = document.getElementById('report-detail');

    expect(detail.textContent).toContain('棒が伸びない');
    expect(detail.textContent).toContain('こちらでも起きます');
  });

  it('そのときの状況は畳んでおく', () => {
    openBoard();
    const box = document.querySelector('#report-detail .report-context');

    // 直すには要るが、読む人には邪魔になる
    expect(box.open).toBe(false);
    expect(box.textContent).toContain('画面: issues');
  });

  it('返信できる', () => {
    const app = openBoard();

    const box = document.querySelector('#report-detail .comment-form textarea');
    box.value = 'これで直りました';
    document.querySelector('#report-detail .comment-form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiInquiryReply').pop();
    expect(call.args).toEqual([3, 'これで直りました', []]);
  });

  it('自分の返信だけ直せる', () => {
    openBoard();
    const mine = [...document.querySelectorAll('#report-detail .comment')].pop();

    expect(mine.querySelector('.comment-tools')).toBeTruthy();
  });

  it('閉じられない人には解決ボタンを出さない', () => {
    openBoard();
    expect(document.querySelector('#report-detail .pr-actions')).toBe(null);
  });

  it('出した本人は解決にできる', () => {
    const app = openBoard({
      apiInquiryThread: {
        inquiry: Object.assign({}, LIST[0], { canClose: true, mine: true }),
        replies: [],
      },
    });

    document.querySelector('#report-detail .pr-actions .btn').click();
    expect(app.calls.some((c) => c.name === 'apiInquiryClose')).toBe(true);
  });

  it('解決したものは既定で隠れる', () => {
    openBoard({
      apiInquiryList: [Object.assign({}, LIST[0], { state: 'done' })],
    });

    expect(document.getElementById('report-list').textContent)
      .toContain('絞り込みに合う報告がありません');
  });

  it('未解決だけを外すと出る', () => {
    openBoard({
      apiInquiryList: [Object.assign({}, LIST[0], { state: 'done' })],
    });

    document.getElementById('report-open-btn').click();

    expect(document.querySelector('#report-list .row-item').textContent)
      .toContain('#3');
  });

  it('言葉で絞り込める', () => {
    openBoard();
    const input = document.getElementById('report-filter');

    input.value = 'あるはずのない言葉';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelectorAll('#report-list .row-item')).toHaveLength(0);
  });
});

describe('報告の書き方を尋ねる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openForm() {
    const app = mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();
    document.getElementById('report-btn').click();
    return app;
  }

  function fields() {
    return [...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent);
  }

  it('順番に尋ねる', () => {
    openForm();

    // 白紙に「詳しく書いて」と頼んでも、何を書けば直せるのかは伝わらない
    expect(fields()).toEqual([
      '種類', 'ひとことで言うと', '何をしましたか',
      'どうなりましたか', 'どうなってほしかったですか',
    ]);
  });

  it('答えを1つの本文に組み立てる', () => {
    const app = openForm();
    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');

    inputs[0].value = '棒が伸びない';
    inputs[1].value = '右端を掴んで引いた';
    inputs[2].value = '伸びなかった';
    inputs[3].value = '延びてほしかった';
    document.querySelector('#side-body form .btn-primary').click();

    const body = app.calls.filter((c) => c.name === 'apiInquiryCreate').pop().args[1];
    expect(body).toContain('棒が伸びない');
    expect(body).toContain('【何をしたか】');
    expect(body).toContain('【どうなったか】');
    expect(body).toContain('【どうなってほしかったか】');
  });

  it('望みが空なら見出しごと省く', () => {
    const app = openForm();
    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');

    inputs[0].value = 'ひとこと';
    inputs[1].value = 'したこと';
    inputs[2].value = 'なったこと';
    document.querySelector('#side-body form .btn-primary').click();

    const body = app.calls.filter((c) => c.name === 'apiInquiryCreate').pop().args[1];
    expect(body).not.toContain('【どうなってほしかったか】');
  });

  it('写真を選ぶ欄がある', () => {
    openForm();
    const pick = document.querySelector('#side-body .shot-input');

    expect(pick.type).toBe('file');
    expect(pick.multiple).toBe(true);
    expect(pick.accept).toContain('image/png');
  });

  it('写真は添えなくても送れる', () => {
    const app = openForm();
    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');

    inputs[0].value = 'a';
    inputs[1].value = 'b';
    inputs[2].value = 'c';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiInquiryCreate').pop().args[3])
      .toEqual([]);
  });
});

describe('添えられた写真', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const WITH_SHOT = {
    inquiry: {
      number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: 'x', body: 'x',
      by: 'me@example.com', state: 'open', context: '', answer: '', at: '',
      answeredAt: '', mine: true, canClose: true, replyCount: 0,
      shots: [{
        id: 'S1',
        url: 'https://drive.google.com/file/d/S1/view',
        thumb: 'https://drive.google.com/thumbnail?id=S1&sz=w800',
      }],
    },
    replies: [],
  };

  it('話の中に写真が並ぶ', () => {
    mount({
      apiInquiryList: [WITH_SHOT.inquiry],
      apiInquiryThread: WITH_SHOT,
    });
    document.querySelector('[data-tab="report"]').click();

    const link = document.querySelector('#report-detail .shot-item');
    expect(link.href).toContain('/file/d/S1/');
    expect(link.querySelector('img').src).toContain('thumbnail?id=S1');
  });

  it('見られないときは文字の手がかりを出す', () => {
    mount({
      apiInquiryList: [WITH_SHOT.inquiry],
      apiInquiryThread: WITH_SHOT,
    });
    document.querySelector('[data-tab="report"]').click();

    const img = document.querySelector('#report-detail .shot-item img');
    img.dispatchEvent(new window.Event('error'));

    expect(document.querySelector('#report-detail .shot-item').textContent)
      .toBe('写真 1枚目を開く');
  });
});

describe('知らせ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const NOTICES = {
    items: [
      {
        id: 2, kind: 'mention', title: 'other@example.com があなたを呼びました',
        body: '@me これ見て', link: 'report:3', at: '2026-09-10T00:00:00.000Z',
        read: false,
      },
      {
        id: 1, kind: 'reply', title: 'other@example.com が #3 に返信しました',
        body: '直りました', link: 'report:3', at: '2026-09-09T00:00:00.000Z',
        read: true,
      },
    ],
    unread: 1,
  };

  it('未読の件数をベルに出す', () => {
    mount({ apiNotifications: NOTICES });

    expect(document.getElementById('bell-count').textContent).toBe('1');
    expect(document.getElementById('bell-count').hidden).toBe(false);
  });

  it('無いときは数を出さない', () => {
    mount();
    expect(document.getElementById('bell-count').hidden).toBe(true);
  });

  it('押すと一覧が開く', () => {
    mount({ apiNotifications: NOTICES });
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-panel').hidden).toBe(false);
    expect(document.querySelectorAll('.notice-item')).toHaveLength(2);
  });

  it('まだ読んでいないものに印を付ける', () => {
    mount({ apiNotifications: NOTICES });
    document.getElementById('bell-btn').click();

    const items = [...document.querySelectorAll('.notice-item')];
    expect(items[0].classList.contains('unread')).toBe(true);
    expect(items[1].classList.contains('unread')).toBe(false);
  });

  it('押すと読んだことにして、その場所を開く', () => {
    const app = mount({
      apiNotifications: NOTICES,
      apiInquiryList: [],
    });
    document.getElementById('bell-btn').click();
    document.querySelector('.notice-item').click();

    expect(app.calls.filter((c) => c.name === 'apiNotificationsRead').pop().args[0])
      .toEqual([2]);
    expect(document.getElementById('panel-report').hidden).toBe(false);
    expect(document.getElementById('notice-panel').hidden).toBe(true);
  });

  it('全部まとめて読んだことにできる', () => {
    const app = mount({ apiNotifications: NOTICES });
    document.getElementById('bell-btn').click();
    document.getElementById('notice-read-all').click();

    expect(app.calls.filter((c) => c.name === 'apiNotificationsRead').pop().args[0])
      .toEqual([]);
  });

  it('何も無いときは何が出るのかを伝える', () => {
    mount();
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-body').textContent)
      .toContain('名前を呼ばれたとき');
  });

  it('デスクトップ通知が使えない環境ではその旨を出す', () => {
    const saved = window.Notification;
    delete window.Notification;

    mount();
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-desktop').hidden).toBe(true);
    expect(document.getElementById('notice-desktop-note').textContent)
      .toContain('出せません');

    if (saved) window.Notification = saved;
  });

  it('許可を求められる環境では頼むボタンを出す', () => {
    window.Notification = { permission: 'default', requestPermission: () => {} };

    mount();
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-desktop').hidden).toBe(false);

    delete window.Notification;
  });
});

describe('種類に応じた尋ね方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openForm() {
    const app = mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();
    document.getElementById('report-btn').click();
    return app;
  }

  function asks() {
    return [...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent);
  }

  it('不具合では起きたことを聞く', () => {
    openForm();

    expect(asks()).toContain('何をしましたか');
    expect(asks()).toContain('どうなりましたか');
  });

  it('要望では困りごとを聞く', () => {
    openForm();
    const sel = document.querySelector('#side-body select');

    sel.value = 'request';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    // 「何をしましたか」は要望には答えようがなく、白紙のまま送られる
    expect(asks()).toContain('いま何に困っていますか');
    expect(asks()).toContain('どうなるとよいですか');
    expect(asks()).not.toContain('何をしましたか');
  });

  it('質問では試したことを聞く', () => {
    openForm();
    const sel = document.querySelector('#side-body select');

    sel.value = 'question';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(asks()).toContain('どこまで試しましたか');
  });

  it('例も種類に合わせて変える', () => {
    openForm();
    const sel = document.querySelector('#side-body select');

    sel.value = 'request';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[0].placeholder).toContain('先に出したい');
  });

  it('やることに積まれることを先に伝える', () => {
    openForm();

    expect(document.getElementById('side-body').textContent)
      .toContain('開発者のやることに積まれます');
  });
});

describe('報告と、そこから作られたやること', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const WITH_ISSUE = {
    inquiry: {
      number: 3, kind: 'request', kindLabel: 'こうしてほしい (機能の要望)',
      title: '並べ替えたい', body: '並べ替えたい', by: 'me@example.com',
      state: 'open', context: '', answer: '', at: '', answeredAt: '',
      mine: true, canClose: true, replyCount: 0, shots: [], issueNumber: 12,
    },
    replies: [],
  };

  it('やることへの行き先が出る', () => {
    mount({
      apiInquiryList: [WITH_ISSUE.inquiry],
      apiInquiryThread: WITH_ISSUE,
    });
    document.querySelector('[data-tab="report"]').click();

    const link = document.querySelector('#report-detail .rel-chip');
    expect(link.textContent).toContain('やること #12');
  });

  it('押すとやることに移る', () => {
    const app = mount({
      apiInquiryList: [WITH_ISSUE.inquiry],
      apiInquiryThread: WITH_ISSUE,
    });
    document.querySelector('[data-tab="report"]').click();
    document.querySelector('#report-detail .rel-chip').click();

    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(app.calls.some((c) => c.name === 'apiIssueList')).toBe(true);
  });

  it('積まれていなければ出さない', () => {
    mount({
      apiInquiryList: [{ ...WITH_ISSUE.inquiry, issueNumber: '' }],
      apiInquiryThread: {
        inquiry: { ...WITH_ISSUE.inquiry, issueNumber: '' }, replies: [],
      },
    });
    document.querySelector('[data-tab="report"]').click();

    expect(document.querySelector('#report-detail .rel-chip')).toBe(null);
  });
});

describe('済んだ報告の見え方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const OPEN = {
    number: 1, kind: 'bug', kindLabel: 'うまく動かない', title: 'まだのもの',
    body: 'x', by: 'me@example.com', state: 'open', context: '', answer: '',
    at: '', answeredAt: '', mine: true, canClose: true, replyCount: 0,
    shots: [], issueNumber: '',
  };
  const DONE = Object.assign({}, OPEN, {
    number: 2, title: '済んだもの', state: 'done',
  });

  function openBoard(over) {
    const app = mount(Object.assign({
      apiInquiryList: [OPEN, DONE],
      apiInquiryThread: { inquiry: OPEN, replies: [] },
    }, over || {}));
    document.querySelector('[data-tab="report"]').click();
    document.getElementById('report-open-btn').click();
    return app;
  }

  function rows() {
    return [...document.querySelectorAll('#report-list .row-item')];
  }

  it('済んだものだけ一段沈める', () => {
    openBoard();

    const done = rows().find((r) => r.dataset.number === '2');
    const open = rows().find((r) => r.dataset.number === '1');

    expect(done.classList.contains('resolved')).toBe(true);
    expect(open.classList.contains('resolved')).toBe(false);
  });

  it('沈めても読めなくはしない', () => {
    openBoard();
    const done = rows().find((r) => r.dataset.number === '2');

    // あとから経緯を追うことがある
    expect(done.textContent).toContain('済んだもの');
    expect(done.querySelector('.state').textContent).toBe('解決');
  });

  it('未解決だけに絞ると出てこない', () => {
    const app = mount({
      apiInquiryList: [OPEN, DONE],
      apiInquiryThread: { inquiry: OPEN, replies: [] },
    });
    document.querySelector('[data-tab="report"]').click();

    expect(rows().map((r) => r.dataset.number)).toEqual(['1']);
    expect(app).toBeTruthy();
  });
});
