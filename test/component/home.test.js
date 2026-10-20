// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { ui } from '../ui-source.js';
import { mount } from './mount.js';

describe('起動', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('ホームから始まる。文書タブには文書の一覧だけがある', () => {
    mount();
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(document.getElementById('panel-docs').hidden).toBe(true);

    document.querySelector('.nav-item[data-tab="docs"]').click();
    const docs = document.getElementById('panel-docs');
    expect(docs.querySelectorAll('.doc-card').length).toBe(1);
    expect(document.querySelector('.doc-name').textContent).toBe('就業規則.doc');
    // 文書でないものは文書タブに置かない
    expect(docs.querySelector('#home-cards')).toBeNull();
    expect(docs.querySelector('#guideline')).toBeNull();
    expect(docs.querySelector('.flow-steps')).toBeNull();
  });

  it('ホームに はじめに・あなたの番・草・最近の動き・前進・全体の数 が並ぶ', () => {
    mount();
    const home = document.getElementById('panel-home');
    // 最近の動きは主の列の草の下 (従に置くと従だけ長くなり、主の下が空いた)
    const ids = ['guideline', 'home-turn', 'home-activity', 'home-recent', 'home-cards', 'home-counts'];
    const at = ids.map((id) => home.querySelector('#' + id));
    at.forEach((el) => expect(el).not.toBeNull());
    for (let k = 1; k < at.length; k++) {
      expect(at[k - 1].compareDocumentPosition(at[k]) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // 全体の数は流れの形で、はじめに からは外す (同じ数を2回出さない)
    expect(home.querySelector('#home-counts #flow-issues').textContent).toBe('2');
    expect(home.querySelector('#guideline .flow-steps')).toBeNull();
  });

  it('左のメニューと下の帯の先頭がホーム', () => {
    mount();
    expect(document.querySelector('.sidebar .nav-item').dataset.tab).toBe('home');
    expect(document.querySelector('#mobile-nav .mobile-nav-item').dataset.go).toBe('home');
    expect(document.getElementById('doc-title').textContent).toBe('ホーム');
  });

  it('ホームを開いたまま返事を待つあいだに やること へ移り、届いても戻されない', () => {
    // 開いた直後は返事に数秒かかる。届いた時点で最初の画面へ切り替えて
    // いたため、そのあいだに押した行き先が押した直後に戻されていた
    let lateOverview = null;
    let first = true;
    mount({
      apiOverview: () => {
        if (!first) return DEFAULTS.apiOverview;
        first = false;
        return { later: (ok) => { lateOverview = ok; } };
      },
    });
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(lateOverview).not.toBeNull();

    document.querySelector('.nav-item[data-tab="issues"]').click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);

    lateOverview(DEFAULTS.apiOverview);

    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(true);
    expect(document.getElementById('panel-docs').hidden).toBe(true);
  });

  it('文書の一覧が遅れて届いても、文書タブを開いていれば一覧を描く', () => {
    let lateList = null;
    mount({ apiListFiles: () => ({ later: (ok) => { lateList = ok; } }) });

    document.querySelector('.nav-item[data-tab="docs"]').click();
    lateList(DEFAULTS.apiListFiles);

    expect(document.getElementById('panel-docs').hidden).toBe(false);
    expect(document.querySelector('.doc-name').textContent).toBe('就業規則.doc');
  });

  it('文書を選ぶまでタブを出さない', () => {
    mount();
    expect(document.getElementById('tabs').hidden).toBe(true);
  });

  it('テーマの切り替えが効く', () => {
    // 初期化がハンドラの中に紛れ込んでいたとき、この切り替えは死んでいた
    mount();
    const btn = document.getElementById('theme-btn');

    expect(btn.querySelector('svg')).not.toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('左のメニューとタブにアイコンが付く', () => {
    mount();
    document.querySelectorAll('.nav-item').forEach((el) => {
      expect(el.querySelector('svg.icon')).not.toBeNull();
    });
  });

  it('関係の流れに実数が入る', () => {
    mount();
    expect(document.getElementById('flow-issues').textContent).toBe('2');
    expect(document.getElementById('flow-prs').textContent).toBe('1');
  });
});

describe('何も無いときの次の一手', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('押しても落ちず、入力が開く', () => {
    mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();

    const btn = document.querySelector('#report-list .blank-state .btn');
    expect(() => btn.click()).not.toThrow();

    expect(document.getElementById('side-panel').hidden).toBe(false);
  });

  it('押したボタンが対象として印される', () => {
    mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();

    const btn = document.querySelector('#report-list .blank-state .btn');
    btn.click();

    // Event をそのまま渡すと、対象として受け取った側で落ちる
    expect(btn.classList.contains('editing')).toBe(true);
  });

  it('やることの空の状態からも作れる', () => {
    mount({ apiIssueList: [] });
    document.querySelector('[data-tab="issues"]').click();

    const btn = document.querySelector('#issue-list .blank-state .btn');
    expect(() => btn.click()).not.toThrow();
    expect(document.getElementById('side-title').textContent).toBe('やることを作る');
  });
});

describe('はじめの案内', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('先に何が得られるかを言う', () => {
    mount();

    expect(document.querySelector('.guideline-lead').textContent)
      .toContain('誰がいつ何を変えたか');
  });

  it('しまえる', () => {
    mount();
    document.getElementById('guideline-hide').click();

    expect(document.getElementById('guideline').hidden).toBe(true);
  });

  it('しまったことを覚えている', () => {
    mount();
    document.getElementById('guideline-hide').click();

    mount();
    expect(document.getElementById('guideline').hidden).toBe(true);
  });

  it('使い方から出し直せる', () => {
    mount();
    document.getElementById('guideline-hide').click();

    document.querySelector('[data-tab="help"]').click();
    [...document.querySelectorAll('#guide .btn')]
      .find((b) => b.textContent.includes('もう一度出す')).click();

    // 案内はホームにあるので、ホームを開いて見せる
    expect(document.getElementById('guideline').hidden).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(false);
  });
});

describe('はじめにの入口', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('最初にやることを置く', () => {
    mount();
    const extra = document.getElementById('guideline-extra');

    expect([...extra.querySelectorAll('.btn')].map((b) => b.textContent))
      .toEqual(['文書を登録する', '手元から動かす道具を落とす']);
  });

  it('流れの図とは分けて置く', () => {
    mount();
    const body = document.getElementById('guideline-body');

    // 図の中に混ぜると手順と読めてしまう
    expect(body.querySelector('.flow-steps .btn')).toBe(null);
    expect(body.querySelector('.guideline-extra')).toBeTruthy();
  });

  it('文書の登録に入れる', () => {
    mount();

    [...document.querySelectorAll('#guideline-extra .btn')]
      .find((b) => b.textContent === '文書を登録する').click();

    expect(document.getElementById('side-title').textContent).toBe('文書を登録する');
  });

  it('道具も落とせる', () => {
    window.open = () => {};
    const app = mount();

    [...document.querySelectorAll('#guideline-extra .btn')]
      .find((b) => b.textContent.includes('道具を落とす')).click();

    expect(app.calls.some((c) => c.name === 'apiAgentKit')).toBe(true);
  });

  it('道具が要らない人には断りを添える', () => {
    mount();

    expect(document.getElementById('guideline-extra').textContent)
      .toContain('Claude や Codex から操作する場合だけ');
  });
});

describe('前進を見せる (意欲づけ)', () => {
  beforeEach(() => { window.localStorage.clear(); });
  // 写し先を差し替えたテストが、後のテストに残らないようにする
  afterEach(() => { delete window.navigator.clipboard; });

  it('今日片づけたものを本人にだけ出し、日報の形で写せる', async () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    const today = [
      { kind: 'issue', number: 12, title: '規程の改定' },
      { kind: 'pull', number: 7, title: '細則の見直し' },
    ];
    mount({ apiMyToday: today,
      apiReportParts: Object.assign({}, DEFAULTS.apiReportParts, { parts: Object.assign({},
        DEFAULTS.apiReportParts.parts, { today }) }) });
    const card = document.querySelector('#home-cards .my-today');
    expect(card.querySelector('.home-head h2').textContent).toBe('今日片づけたもの');
    // 「あなたにだけ見えます」を区画ごとに書き並べず、見出しの札1つで示す
    const pill = card.querySelector('.home-head .chip');
    expect(pill.textContent).toBe('自分だけ');
    expect(pill.title).toBe('あなたにだけ見えます');
    expect(card.textContent).not.toContain('あなたにだけ見えます');
    expect(card.querySelectorAll('li')).toHaveLength(2);
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '日報にコピー').click();
    await Promise.resolve();
    expect(copied[0]).toBe('✅今日やったこと\n- #12 規程の改定\n- 確認依頼 #7 細則の見直し を正式版に反映\n\n' +
      '📅明日やること\n- 特になし\n\n⛔️困っていること\n- 特になし');
  });

  it('前進はホームの従の列に、カードごとに見出しを付けて置き、文書の一覧とは別の画面にする', () => {
    // 前進のカードが文書の上に同じ形で並び、どこからが文書なのか分からなかった
    mount();
    const cards = document.getElementById('home-cards');
    expect(cards.closest('#panel-home .home-side')).not.toBeNull();
    expect(document.getElementById('doc-list').closest('#panel-home')).toBeNull();

    // まとめの見出しは置かず (同じ形の見出しが重なる)、カードがそれぞれ見出しを持つ
    const heads = Array.from(cards.children).map((c) => c.querySelector(':scope > .home-head > h2').textContent);
    expect(heads).toEqual(['今日片づけたもの', 'チームの前進']);
  });

  it('今日まだ何も無いときは「これから」と書く', () => {
    mount();
    const card = document.querySelector('#home-cards .my-today');
    expect(card.textContent).toContain('今日はこれから');
    expect(Array.from(card.querySelectorAll('button')).some((b) => b.textContent === '日報にコピー')).toBe(true);
  });

  it('日報の形を選ぶと、写す中身が変わり、選んだ形を覚える', async () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    const app = mount({ apiMyToday: [{ kind: 'issue', number: 12, title: '規程の改定' }],
      apiReportParts: Object.assign({}, DEFAULTS.apiReportParts, { parts: Object.assign({},
        DEFAULTS.apiReportParts.parts, { today: [{ kind: 'issue', number: 12, title: '規程の改定' }] }) }) });
    const card = document.querySelector('#home-cards .my-today');
    const pick = card.querySelector('select.report-kind');
    pick.value = 'today';
    pick.dispatchEvent(new window.Event('change'));
    expect(app.calls.filter((c) => c.name === 'apiSetReportKind').pop().args).toEqual(['today']);
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '日報にコピー').click();
    await Promise.resolve();
    expect(copied.pop()).toBe('✅今日\n- #12 規程の改定');
  });

  it('自分の形: 差し込みを当てはめ、知らない差し込みと閉じていない括弧はそのまま残す', () => {
    const { reportFill } = ui(['reportFill', 'reportLines'], { OFFICIAL: '正式版' });
    const parts = { today: [{ kind: 'issue', number: 1, title: 'a' }], tomorrow: [], troubles: [],
      date: '10/14 (水)', name: '中井' };
    expect(reportFill('{日付} {名前}\n{今日}\n{明日}\n{未知}\n{今日', parts))
      .toBe('10/14 (水) 中井\n- #1 a\n- 特になし\n{未知}\n{今日');
  });

  it('自分の形を直す欄で書いて保存すると、自分の形を選んだことになる', () => {
    const app = mount();
    const card = document.querySelector('#home-cards .my-today');
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '自分の形を直す').click();
    const form = document.querySelector('.inline-form');
    const area = form.querySelector('textarea');
    expect(form.textContent).toContain('{今日}');
    area.value = '【本日】{今日}';
    area.dispatchEvent(new window.Event('input'));
    expect(form.querySelector('.report-preview').textContent).toBe('【本日】- 特になし');
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(app.calls.filter((c) => c.name === 'apiSetReportCustom').pop().args).toEqual(['【本日】{今日}']);
    // 選んだことはサーバが同じ1回で覚える。2回に分けると、2回目だけ落ちたとき食い違う
    expect(app.calls.some((c) => c.name === 'apiSetReportKind')).toBe(false);
    expect(card.querySelector('select.report-kind').value).toBe('custom');
  });

  it('自分の形を選んだまま空にして保存すると、選ぶ欄も写す形も 3節 に戻る', async () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    const app = mount({ apiReportParts: { ...DEFAULTS.apiReportParts, kind: 'custom', custom: '【本日】{今日}' } });
    const card = document.querySelector('#home-cards .my-today');
    const pick = card.querySelector('select.report-kind');
    expect(pick.value).toBe('custom');
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '自分の形を直す').click();
    const form = document.querySelector('.inline-form');
    form.querySelector('textarea').value = '';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(app.calls.filter((c) => c.name === 'apiSetReportCustom').pop().args).toEqual(['']);
    expect(pick.value).toBe('three');
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '日報にコピー').click();
    await Promise.resolve();
    expect(copied.pop()).toMatch(/^✅今日やったこと\n/);
  });

  it('自分の形がまだ空なのに選んだら、選ばずに書く欄を開く (見せる形と写す形を揃える)', () => {
    const app = mount();
    const card = document.querySelector('#home-cards .my-today');
    const pick = card.querySelector('select.report-kind');
    pick.value = 'custom';
    pick.dispatchEvent(new window.Event('change'));
    expect(pick.value).toBe('three');
    expect(app.calls.some((c) => c.name === 'apiSetReportKind')).toBe(false);
    expect(document.querySelector('.inline-form textarea')).not.toBeNull();
  });

  it('覚えている形が知らないものか空の自分の形なら、写す形と同じ 3節 を選んで見せる', () => {
    ['weekly', 'custom'].forEach((kind) => {
      mount({ apiReportParts: { ...DEFAULTS.apiReportParts, kind, custom: '' } });
      expect(document.querySelector('#home-cards .my-today select.report-kind').value).toBe('three');
    });
  });

  it('並べる「今日片づけたもの」は日報に写す中身と同じものから作る', () => {
    mount({ apiMyToday: [{ kind: 'issue', number: 1, title: '古い一覧' }],
      apiReportParts: { ...DEFAULTS.apiReportParts, parts: { ...DEFAULTS.apiReportParts.parts,
        today: [{ kind: 'issue', number: 12, title: '規程の改定' }] } } });
    const items = Array.from(document.querySelectorAll('#home-cards .my-today li')).map((li) => li.textContent);
    expect(items).toEqual(['#12 規程の改定']);
  });

  it('自分の形が2000字を超えたら送らない', () => {
    const app = mount();
    const card = document.querySelector('#home-cards .my-today');
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '自分の形を直す').click();
    const form = document.querySelector('.inline-form');
    const area = form.querySelector('textarea');
    area.value = 'あ'.repeat(2001);
    area.dispatchEvent(new window.Event('input'));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(app.calls.some((c) => c.name === 'apiSetReportCustom')).toBe(false);
    // 欄は開いたままで、書いたものが残っている
    const still = document.querySelector('.inline-form');
    expect(still).not.toBeNull();
    expect(still.isConnected).toBe(true);
    expect(still.querySelector('textarea').value).toBe('あ'.repeat(2001));
    expect(still.textContent).toContain('2000字までです (いま 2001 字)');
  });

  it('日報の中身が取れないときは、今の形 (✅今日 と箇条) で写す', async () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    mount({ apiMyToday: [{ kind: 'issue', number: 12, title: '規程の改定' }],
      apiReportParts: () => new Error('混み合っています') });
    const card = document.querySelector('#home-cards .my-today');
    expect(card.querySelector('select.report-kind')).toBeNull();
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '日報にコピー').click();
    await Promise.resolve();
    expect(copied.pop()).toBe('✅今日\n- #12 規程の改定');
  });

  it('写せないブラウザでは、選んで写せる欄を出す', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
    const today = [{ kind: 'issue', number: 12, title: '規程の改定' }];
    mount({ apiMyToday: today,
      apiReportParts: Object.assign({}, DEFAULTS.apiReportParts, { parts: Object.assign({},
        DEFAULTS.apiReportParts.parts, { today }) }) });
    const card = document.querySelector('#home-cards .my-today');
    Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '日報にコピー').click();
    await Promise.resolve();
    expect(card.querySelector('textarea').value).toContain('- #12 規程の改定');
  });
  const STEPS = [
    { key: 'branch', label: '改訂版を作る', hint: 'h1', tab: 'docs', done: true },
    { key: 'commit', label: '変更を記録する', hint: '直したら「変更を記録」', tab: 'branches', done: false },
    { key: 'pull', label: '確認を依頼する', hint: 'h3', tab: 'branches', done: false },
    { key: 'review', label: 'ほかの人の依頼を確かめる', hint: 'h4', tab: 'pulls', done: false },
    { key: 'merge', label: '正式版に反映する', hint: 'h5', tab: 'pulls', done: false },
  ];

  it('ホームにチームの前進と、今月の目標までの進み具合を出す (人ごとには出さない)', () => {
    mount({ apiProgress: { weekClosed: 3, weekMerged: 1, monthClosed: 7, goal: 10, canEditGoal: true } });
    const card = document.querySelector('#home-cards .team-progress');
    expect(card.textContent).toContain('今週 3 件のやることを終え、1 件を正式版にしました');
    expect(card.textContent).toContain('今月の目標 7 / 10 件');
    expect(card.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('7');
    expect(card.querySelector('.team-goal-edit').textContent).toBe('目標を直す');
  });

  it('今週まだ何も無いときは「0 件」と並べず、これからだと伝える', () => {
    mount();
    const line = document.querySelector('#home-cards .team-progress-line').textContent;
    expect(line).toContain('今週はこれからです');
    expect(line).not.toContain('0 件');
  });

  it('管理者でなければ目標を直す入口は出さない', () => {
    mount({ apiProgress: { weekClosed: 0, weekMerged: 0, monthClosed: 0, goal: 0, canEditGoal: false } });
    expect(document.querySelector('#home-cards .team-goal-edit')).toBeNull();
  });

  it('はじめの5歩は、できたことに印を付け、次の一歩だけ入口を出す。閉じたら覚える', () => {
    mount({ apiMyMilestones: STEPS });
    const card = document.querySelector('#home-cards .first-steps');
    expect(card.querySelector('.home-head h2').textContent).toBe('はじめの5歩 (1 / 5)');
    expect(card.querySelector('.home-head .chip').textContent).toBe('自分だけ');
    expect(card.querySelectorAll('.first-step.is-done')).toHaveLength(1);
    const next = card.querySelector('.first-step.is-next');
    expect(next.textContent).toContain('変更を記録する');
    expect(card.querySelectorAll('.first-step .btn')).toHaveLength(1);
    next.querySelector('.btn').click();
    expect(document.getElementById('panel-branches').hidden).toBe(false);

    document.querySelector('.mobile-nav-item[data-go="docs"]').click();
    document.querySelector('#home-cards .first-steps .side-close').click();
    expect(document.querySelector('#home-cards .first-steps')).toBeNull();
    mount({ apiMyMilestones: STEPS });
    expect(document.querySelector('#home-cards .first-steps')).toBeNull();
  });

  it('全部できたら、はじめの5歩は出さない', () => {
    mount({ apiMyMilestones: STEPS.map((x) => Object.assign({}, x, { done: true })) });
    expect(document.querySelector('#home-cards .first-steps')).toBeNull();
  });

  function closeFirst() {
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .icon-btn.ok').click();
    return document.getElementById('snackbar');
  }

  it('完了にしたとき、どれにも当たらなければ今週チームで何件目かを添える', () => {
    mount({ apiCloseFeedback: { kind: 'team', number: 1, title: 'x', weekClosed: 4, monthClosed: 10, goal: 10 } });
    const snack = closeFirst().textContent;
    expect(snack).toContain('を完了にしました。今週チームで 4 件目です');
    expect(snack).toContain('今月の目標に届きました');
  });

  it('小分けの途中は「あと◯つ」と進み具合を出す', () => {
    mount({ apiCloseFeedback: { kind: 'parentStep', number: 3, title: '子', weekClosed: 1, monthClosed: 1, goal: 0,
      parent: { number: 12, title: '規程の改定', done: 1, total: 3 } } });
    const bar = closeFirst();
    expect(bar.textContent).toContain('#12 規程の改定 はあと 2 つ');
    expect(bar.querySelector('.snack-mark [role="progressbar"]').getAttribute('aria-valuenow')).toBe('1');
  });

  it('小分けの最後は、親も完了にするボタンを出す。押すと親も閉じる', () => {
    const closedNos = [];
    mount({
      apiIssueClose: (n) => { closedNos.push(n); return { number: n, state: 'closed' }; },
      apiCloseFeedback: { kind: 'parentDone', number: 3, title: '子', weekClosed: 1, monthClosed: 1, goal: 0,
        parent: { number: 12, title: '規程の改定', done: 3, total: 3 } },
    });
    const bar = closeFirst();
    expect(bar.textContent).toContain('#12 規程の改定 の小分けが全部終わりました');
    const btn = Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === '#12 も完了にする');
    btn.click();
    expect(closedNos).toContain(12);
  });

  it('長く止まっていたもの・大きいものは、件数ではなくそのことを伝える', () => {
    mount({ apiCloseFeedback: { kind: 'longAwaited', number: 1, title: 'x', weekClosed: 9, monthClosed: 9, goal: 0, days: 21 } });
    expect(closeFirst().textContent).toContain('3週間越しのものが片づきました');
    mount({ apiCloseFeedback: { kind: 'heavy', number: 1, title: 'x', weekClosed: 9, monthClosed: 9, goal: 0 } });
    const t = closeFirst().textContent;
    expect(t).toContain('大きいものが1つ終わりました');
    expect(t).not.toContain('件目');
  });

  it('ポイントとレベルが届けば添え、帯に出したレベルを見せたと伝える', () => {
    const seen = [];
    mount({ apiCloseFeedback: { kind: 'heavy', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0, points: 3, levelUp: 4 },
      apiGameLevelSeen: (n) => { seen.push(n); return { level: n }; } });
    const t = closeFirst().textContent;
    expect(t).toContain('+3');
    expect(t).toContain('レベル 4 になりました');
    expect(seen).toEqual([4]);
  });

  it('割り算の端数は小数1桁で出す', () => {
    mount({ apiCloseFeedback: { kind: 'team', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0, points: 1 / 3 } });
    expect(closeFirst().textContent).toContain('(+0.3)');
  });

  it('捨てた返事のレベルは、見せたと伝えない (次の完了でもう一度知らせる)', () => {
    const seen = [];
    const replies = [];
    mount({ apiCloseFeedback: { later: (ok) => { replies.push(ok); } },
      apiGameLevelSeen: (n) => { seen.push(n); return { level: n }; } });
    closeFirst();
    document.querySelectorAll('#issue-list .row-item .icon-btn.ok')[1].click();
    replies[0]({ kind: 'team', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0, points: 1, levelUp: 2 });
    expect(seen).toEqual([]);
  });

  it('やることの画面で完了にしても、ホームのカードは取りに行かない', () => {
    const app = mount({ apiCloseFeedback: { kind: 'team', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0 } });
    document.querySelector('[data-tab="issues"]').click();
    const before = app.calls.length;
    document.querySelector('#issue-list .row-item .icon-btn.ok').click();
    const names = app.calls.slice(before).map((c) => c.name);
    expect(names).toContain('apiCloseFeedback');
    expect(names).not.toContain('apiMyToday');
    expect(names).not.toContain('apiGameState');
    expect(names).not.toContain('apiGameTop');
  });

  it('小分けの棒に名前を付ける', () => {
    mount({ apiCloseFeedback: { kind: 'parentStep', number: 3, title: '子', weekClosed: 1, monthClosed: 1, goal: 0,
      parent: { number: 12, title: '規程の改定', done: 1, total: 3 } } });
    const bar = closeFirst().querySelector('.snack-mark [role="progressbar"]');
    expect(bar.getAttribute('aria-label')).toBe('小分けの進み具合');
  });

  it('知らせを止めた直後に届いた返事では、素の帯のまま (ポイントも出さない)', () => {
    let reply = null;
    mount({ apiCloseFeedback: { later: (ok) => { reply = ok; } } });
    closeFirst();
    document.getElementById('me-btn').click();
    document.getElementById('progress-toggle').click();
    reply({ kind: 'heavy', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0, points: 3 });
    const t = document.getElementById('snackbar').textContent;
    expect(t).not.toContain('+3');
    expect(t).not.toContain('大きいもの');
    expect(t).toContain('を完了にしました');
  });

  it('知らせを止めているあいだは、apiCloseFeedback を呼ばない', () => {
    const calls = [];
    mount({ apiCloseFeedback: () => { calls.push(1); return null; } });
    document.getElementById('me-btn').click();
    document.getElementById('progress-toggle').click();
    closeFirst();
    expect(calls).toHaveLength(0);
    expect(document.getElementById('snackbar').textContent).toContain('を完了にしました');
  });

  it('帯が別のものに替わったあとに届いた返事は、新しい帯を上書きしない', () => {
    const replies = [];
    mount({ apiCloseFeedback: { later: (ok) => { replies.push(ok); } } });
    closeFirst();
    document.querySelectorAll('#issue-list .row-item .icon-btn.ok')[1].click();
    const newer = document.getElementById('snackbar');
    const newerText = newer.textContent;
    replies[0]({ kind: 'heavy', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0, points: 3 });
    expect(document.getElementById('snackbar')).toBe(newer);
    expect(newer.textContent).toBe(newerText);
    expect(newer.textContent).not.toContain('+3');
  });

  it('帯を閉じたあとに届いた返事で、帯が出直さない', () => {
    let reply = null;
    mount({ apiCloseFeedback: { later: (ok) => { reply = ok; } } });
    const bar = closeFirst();
    Array.from(bar.querySelectorAll('button')).find((b) => b.textContent === '閉じる').click();
    reply({ kind: 'heavy', number: 1, title: 'x', weekClosed: 1, monthClosed: 1, goal: 0, points: 3 });
    expect(document.getElementById('snackbar')).toBeNull();
  });

  it('返事が失敗しても、完了したことは伝える', () => {
    mount({ apiCloseFeedback: () => new Error('落ちた') });
    expect(closeFirst().textContent).toContain('を完了にしました');
  });

  it('止めた直後に届いた返事では、カードも前進の数も出さない', () => {
    let replyProgress = null;
    mount({ apiProgress: { later: (ok) => { replyProgress = ok; } } });
    document.getElementById('me-btn').click();
    document.getElementById('progress-toggle').click();
    replyProgress({ weekClosed: 2, weekMerged: 0, monthClosed: 0, goal: 0, canEditGoal: false });
    expect(document.getElementById('home-cards').textContent).toBe('');
  });

  it('ブラウザに覚えられなくても、止めたことは開いているあいだ守る', () => {
    // 覚えられないブラウザ (保存しようとすると投げる) を作る
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem: () => { throw new Error('保存できない'); },
        removeItem: () => {}, clear: () => {} },
    });
    try {
      mount({ apiProgress: { weekClosed: 4, weekMerged: 0, monthClosed: 0, goal: 0, canEditGoal: false } });
      document.getElementById('me-btn').click();
      document.getElementById('progress-toggle').click();
      document.querySelector('[data-tab="issues"]').click();
      document.querySelector('#issue-list .row-item .icon-btn.ok').click();
      expect(document.getElementById('snackbar').textContent).not.toContain('今週チームで');
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real);
      else delete window.localStorage;
    }
  });

  it('別のタブで止めたら、このタブのカードも消える', () => {
    mount({ apiProgress: { weekClosed: 2, weekMerged: 0, monthClosed: 0, goal: 0, canEditGoal: false } });
    expect(document.getElementById('home-cards').textContent).toContain('今週');
    // 別のタブが止めた形 (このタブでは押していない)
    window.localStorage.setItem('progressNotes', 'off');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'progressNotes', newValue: 'off' }));
    expect(document.getElementById('home-cards').textContent).toBe('');
  });

  it('工数の集計に、誰に何が見えるかを書く', () => {
    mount({ apiTallyEffort: { periods: [{ key: '2026-10', label: '10月', planned: 1, actual: 1, diff: 0, count: 1, cumPlanned: 1, cumActual: 1 }],
      people: [], total: { planned: 1, actual: 1, diff: 0, count: 1 }, skipped: 0, hidden: 0 } });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();
    expect(document.querySelector('.tally-visibility').textContent).toContain('順位は作っていません');
  });

  it('自分で止められる。止めたら知らせは素のまま、ホームのカードも出さない', () => {
    mount({ apiProgress: { weekClosed: 4, weekMerged: 0, monthClosed: 0, goal: 0, canEditGoal: false } });
    document.getElementById('me-btn').click();
    const toggle = document.getElementById('progress-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('home-cards').textContent).toBe('');

    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .icon-btn.ok').click();
    expect(document.getElementById('snackbar').textContent).not.toContain('今週チームで');
  });
});

describe('ポイント・レベル・週の上位', () => {
  beforeEach(() => { window.localStorage.clear(); });
  const ON = { enabled: true, total: 12, week: 4, level: 1, nextAt: 15, playing: false };

  it('オフのあいだは何も出さない', () => {
    mount();
    expect(document.querySelector('#home-cards .game-card')).toBeNull();
  });

  it('自分のレベルと次までを出し、評価に使わないと書く', () => {
    mount({ apiGameState: ON });
    const card = document.querySelector('#home-cards .game-card');
    expect(card.textContent).toContain('レベル 1');
    expect(card.textContent).toContain('次のレベルまで 3');
    expect(card.textContent).toContain('今週 4');
    expect(card.textContent).toContain('人事の評価には使いません');
  });

  it('ホームで描いたレベルを、見せたと伝える', () => {
    const seen = [];
    mount({ apiGameState: ON, apiGameLevelSeen: (n) => { seen.push(n); return { level: n }; } });
    expect(seen).toContain(1);
  });

  it('次のレベルまでは小数1桁で出す', () => {
    mount({ apiGameState: Object.assign({}, ON, { total: 4.1, week: 4.1, level: 0, levelFrom: 0, nextAt: 5 }) });
    const text = document.querySelector('#home-cards .game-card').textContent;
    expect(text).toContain('次のレベルまで 0.9');
    expect(text).not.toContain('0.900');
  });

  it('棒は、いまのレベルの中での進み具合で描く', () => {
    mount({ apiGameState: Object.assign({}, ON, { total: 16, level: 2, levelFrom: 15, nextAt: 30 }) });
    const bar = document.querySelector('#home-cards .game-level-bar');
    expect(bar.getAttribute('aria-valuemin')).toBe('15');
    expect(bar.getAttribute('aria-valuemax')).toBe('30');
    expect(bar.getAttribute('aria-valuenow')).toBe('16');
    expect(bar.querySelector('span').style.width).toBe('7%');
  });

  it('週の上位は3位まで。自分の行に印。上位にいなくても自分の順位は出さない', () => {
    mount({ apiGameState: Object.assign({}, ON, { playing: true }), apiGameTop: [
      { rank: 1, name: 'あ', points: 9, me: false },
      { rank: 2, name: 'い', points: 6, me: true },
    ] });
    const rows = document.querySelectorAll('#home-cards .game-top li');
    expect(rows).toHaveLength(2);
    expect(rows[1].classList.contains('is-me')).toBe(true);
    expect(document.querySelector('#home-cards .game-card').textContent).not.toMatch(/\d+ 位中/);
  });

  const BADGES = [
    { key: 'first', label: 'はじめの一歩', done: true, at: '2026-10-01', left: 0 },
    { key: 'closed10', label: '10件片づけた', done: false, at: '', left: 7 },
    { key: 'heavy', label: '重いやることを片づけた', done: false, at: '', left: 1 },
  ];

  it('称号は得たものを日付つきで並べ、まだのものは薄く「あと N 件」と出す', () => {
    mount({ apiGameState: Object.assign({}, ON, { badges: BADGES }) });
    const items = Array.from(document.querySelectorAll('#home-cards .game-badges li'));
    expect(items).toHaveLength(3);
    expect(items[0].classList.contains('is-done')).toBe(true);
    expect(items[0].textContent).toContain('はじめの一歩');
    expect(items[0].textContent).toContain('10/1');
    expect(items[1].classList.contains('is-done')).toBe(false);
    expect(items[1].textContent).toContain('あと 7 件');
    expect(items[2].textContent).toContain('あと 1 件');
  });

  it('称号が届かなければ並びを出さない', () => {
    mount({ apiGameState: ON });
    expect(document.querySelector('#home-cards .game-badges')).toBeNull();
  });

  it('先週のチームの合計を、先々週の合計と比べて棒で出す。名前は出さない', () => {
    mount({ apiGameState: Object.assign({}, ON, { team: { lastWeek: 6, weekBefore: 8 } }) });
    const bar = document.querySelector('#home-cards .game-team-bar');
    expect(bar.getAttribute('aria-valuenow')).toBe('6');
    expect(bar.getAttribute('aria-valuemax')).toBe('8');
    expect(bar.querySelector('span').style.width).toBe('75%');
    const team = document.querySelector('#home-cards .game-team');
    expect(team.textContent).toContain('先週のチーム 6');
    expect(team.textContent).toContain('先々週 8');
    expect(team.textContent).not.toContain('今週');
  });

  it('先々週を超えたら棒は満ちたまま。先々週が0でも割らず、aria は 1/1 にする', () => {
    mount({ apiGameState: Object.assign({}, ON, { team: { lastWeek: 3, weekBefore: 0 } }) });
    const bar = document.querySelector('#home-cards .game-team-bar');
    expect(bar.querySelector('span').style.width).toBe('100%');
    expect(bar.getAttribute('aria-valuemax')).toBe('1');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('先々週が出せないときは先週の合計だけ。棒は出さない', () => {
    mount({ apiGameState: Object.assign({}, ON, { team: { lastWeek: 5, weekBefore: null } }) });
    const team = document.querySelector('#home-cards .game-team');
    expect(team.textContent).toContain('先週のチーム 5');
    expect(team.textContent).not.toContain('先々週');
    expect(document.querySelector('#home-cards .game-team-bar')).toBeNull();
  });

  it('先週が出せないとき・チームが届かないときは欄ごと出さない', () => {
    mount({ apiGameState: Object.assign({}, ON, { team: { lastWeek: null, weekBefore: 4 } }) });
    expect(document.querySelector('#home-cards .game-team')).toBeNull();
  });

  it('チームが null なら出さない', () => {
    mount({ apiGameState: Object.assign({}, ON, { team: null }) });
    expect(document.querySelector('#home-cards .game-team')).toBeNull();
  });

  it('ポイントは片づけたものと、ほかの人の確認依頼への返事で付くと書く', () => {
    mount({ apiGameState: ON });
    const note = document.querySelector('#home-cards .game-note').textContent;
    expect(note).toContain('片づけた');
    expect(note).toContain('確認依頼');
  });

  const SETTINGS_ON = Object.assign({}, DEFAULTS.apiSettings, { gameEnabled: true });

  it('自分まわりで順位に参加できる。切り替えは並びのボタンと同じ器に入る', () => {
    let joined = null;
    mount({ apiSettings: SETTINGS_ON, apiGameState: ON,
      apiGameJoin: (on) => { joined = on; return Object.assign({}, ON, { playing: on }); } });
    document.getElementById('me-btn').click();
    const toggle = document.getElementById('game-join-toggle');
    expect(toggle.parentNode.classList.contains('me-actions')).toBe(true);
    toggle.click();
    expect(joined).toBe(true);
  });

  it('参加の返事が空でも、押したとおりのまま', () => {
    mount({ apiSettings: SETTINGS_ON, apiGameState: ON, apiGameJoin: () => null });
    document.getElementById('me-btn').click();
    const toggle = document.getElementById('game-join-toggle');
    toggle.click();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('設定でオフと分かっていれば、自分まわりはポイントを尋ねない', () => {
    const app = mount();
    const before = app.calls.length;
    document.getElementById('me-btn').click();
    expect(app.calls.slice(before).map((c) => c.name)).not.toContain('apiGameState');
    expect(document.getElementById('game-join-toggle')).toBeNull();
  });

  it('設定の見出しにオン・オフを出す', () => {
    mount({ apiSettings: SETTINGS_ON });
    document.querySelector('[data-tab="settings"]').click();
    const heads = Array.from(document.querySelectorAll('.settings-section h2'));
    const game = heads.find((h) => h.textContent.indexOf('ポイントとレベル') === 0);
    expect(game.querySelector('.state').textContent).toContain('オン');
  });

  it('管理者は設定で切り替えられる', () => {
    let set = null;
    mount({ apiSetGameEnabled: (on) => { set = on; return { scrumEnabled: false, gameEnabled: on, canEdit: true,
      productGoal: '', definitionOfDone: '', glossary: {} }; } });
    document.querySelector('[data-tab="settings"]').click();
    document.getElementById('game-toggle').click();
    expect(set).toBe(true);
  });

  it('前進の知らせを止めていると、ゲームのカードも出さない', () => {
    window.localStorage.setItem('progressNotes', 'off');
    mount({ apiGameState: ON });
    expect(document.querySelector('#home-cards .game-card')).toBeNull();
  });

  it('今日の一覧が取れなくても、チームの前進は出る', () => {
    mount({ apiMyToday: new Error('x'), apiGameState: ON });
    expect(document.querySelector('#home-cards .team-progress')).not.toBeNull();
    expect(document.querySelector('#home-cards .game-card')).not.toBeNull();
  });

  it('ポイントが取れなくても、ほかのカードは出る', () => {
    mount({ apiGameState: new Error('x') });
    expect(document.querySelector('#home-cards .team-progress')).not.toBeNull();
    expect(document.querySelector('#home-cards .my-today')).not.toBeNull();
    expect(document.querySelector('#home-cards .game-card')).toBeNull();
  });
});

describe('ホームの区画', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('あなたの番: 種類ごとに並び、押すと開く', () => {
    // やること #7 は既定の一覧に無いので足す
    mount({ apiIssueList: [...DEFAULTS.apiIssueList,
      { ...DEFAULTS.apiIssueList[0], number: 7, title: '附則の施行日を決める' }] });
    const turn = document.getElementById('home-turn');
    // 種類の見出しは短くし、数を札で添える
    const subs = Array.from(turn.querySelectorAll('.home-sub')).map((h) => h.textContent);
    expect(subs).toEqual(['確かめてほしい1', '期限が近い1']);
    expect(turn.querySelector('.home-sub .chip').textContent).toBe('1');
    expect(turn.textContent).toContain('確認依頼 #1 就業規則 第3条の改定');
    expect(turn.textContent).toContain('期限切れ');
    turn.querySelector('[data-issue="7"]').click();
    expect(document.getElementById('side-panel').hidden).toBe(false);
  });

  it('あなたの番: 確認依頼を押すと確認依頼の画面でその中身を開く', () => {
    const app = mount();
    document.querySelector('#home-turn [data-pr="1"]').click();
    expect(document.getElementById('panel-pulls').hidden).toBe(false);
    expect(app.calls.filter((c) => c.name === 'apiPrPreview').map((c) => c.args[0])).toContain(1);
  });

  it('あなたの番: 先頭でない確認依頼を押すと、返事が遅れてもその依頼を開く (先頭に戻されない)', () => {
    const lists = [];
    const previews = [];
    const two = [DEFAULTS.apiPrList[0], { ...DEFAULTS.apiPrList[0], number: 3, title: '育児休業の見直し' }];
    mount({
      apiHomeSummary: { ...DEFAULTS.apiHomeSummary, myTurn: { ...DEFAULTS.apiHomeSummary.myTurn,
        reviews: { items: [{ number: 3, title: '育児休業の見直し' }], total: 1 } } },
      apiPrList: () => ({ later: (ok) => { lists.push(ok); } }),
      apiPrPreview: (n) => ({ later: (ok) => { previews.push([n, ok]); } }),
    });
    document.querySelector('#home-turn [data-pr="3"]').click();
    // 返事を待たずに画面は移る
    expect(document.getElementById('panel-pulls').hidden).toBe(false);
    while (lists.length) lists.shift()(two);
    while (previews.length) { const [, ok] = previews.shift(); ok(DEFAULTS.apiPrPreview); }
    expect(document.querySelector('#pr-detail .pr-title').textContent).toBe('#3 育児休業の見直し');
    const current = document.querySelectorAll('#pr-list .row-item[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('#3 育児休業の見直し');
  });

  it('あなたの番: 確認依頼を押してから返事の前に別の画面へ移ったら、届いても引き戻さない', () => {
    let late = null;
    mount({ apiPrList: () => ({ later: (ok) => { late = ok; } }) });
    document.querySelector('#home-turn [data-pr="1"]').click();
    document.querySelector('.nav-item[data-tab="issues"]').click();
    late(DEFAULTS.apiPrList);
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('panel-pulls').hidden).toBe(true);
  });

  it('あなたの番: ホームから開いたやることを完了にしたら、あなたの番を取り直す', () => {
    const app = mount({ apiIssueList: [...DEFAULTS.apiIssueList,
      { ...DEFAULTS.apiIssueList[0], number: 7, title: '附則の施行日を決める', state: 'open' }] });
    const before = app.calls.filter((c) => c.name === 'apiHomeSummary').length;
    document.querySelector('#home-turn [data-issue="7"]').click();
    app.respond('apiHomeSummary', { ...DEFAULTS.apiHomeSummary, myTurn: { ...DEFAULTS.apiHomeSummary.myTurn,
      due: { items: [], total: 0 } } });
    Array.from(document.querySelectorAll('#side-panel button'))
      .find((b) => b.textContent === '完了にする').click();
    expect(app.calls.filter((c) => c.name === 'apiHomeSummary').length).toBe(before + 1);
    expect(document.querySelector('#home-turn [data-issue="7"]')).toBeNull();
  });

  it('あなたの番: 何も無ければそう書く。5件を超えたら一覧へ送る', () => {
    mount({ apiHomeSummary: { myTurn: {
      reviews: { items: [], total: 0 }, returned: { items: [], total: 0 }, due: { items: [], total: 0 },
    }, recent: [] } });
    expect(document.getElementById('home-turn').textContent).toContain('いまあなたを待っているものはありません');

    mount({ apiHomeSummary: { myTurn: {
      reviews: { items: [1, 2, 3, 4, 5].map((n) => ({ number: n, title: 'x' + n })), total: 8 },
      returned: { items: [], total: 0 }, due: { items: [], total: 0 },
    }, recent: [] } });
    expect(document.getElementById('home-turn').textContent).toContain('ほか 3 件');
  });

  // 2段 (あなた・チーム) を縦に並べていたのを、1つの草と「あなた | チーム」の切り替えに改めた
  it('草: 1つの草を「あなた | チーム」で切り替える。371 マス・読み上げの字があり、連続日数の字は無い', () => {
    mount();
    const box = document.getElementById('home-activity');
    const grids = () => box.querySelectorAll('.activity-grid');
    expect(grids()).toHaveLength(1);
    expect(grids()[0].querySelectorAll('.activity-cell')).toHaveLength(371);
    expect(grids()[0].getAttribute('role')).toBe('img');
    expect(grids()[0].getAttribute('aria-label')).toBe('あなたの行い。直近1年で 120 件');
    expect(box.textContent).toContain('直近1年で 120 件');
    const one = grids()[0].querySelector('.activity-cell[data-day]');
    expect(one.title).toMatch(/\d+月\d+日 \(.\) \d+件/);

    const [me, team] = box.querySelectorAll('.segmented .seg');
    expect(me.textContent).toBe('あなた');
    expect(me.getAttribute('aria-pressed')).toBe('true');
    expect(team.getAttribute('aria-pressed')).toBe('false');
    // 自分だけの札は あなた のときだけ
    expect(box.querySelector('.home-head .chip').hidden).toBe(false);

    team.click();
    let teamTotal = 0;
    DEFAULTS.apiHomeActivity.weeks.forEach((w) => w.forEach((c) => { if (!c.future) teamTotal += c.team; }));
    expect(team.getAttribute('aria-pressed')).toBe('true');
    expect(me.getAttribute('aria-pressed')).toBe('false');
    expect(grids()).toHaveLength(1);
    expect(grids()[0].getAttribute('aria-label')).toBe('チーム (全員の合計)の行い。直近1年で ' + teamTotal + ' 件');
    expect(box.textContent).toContain('直近1年で ' + teamTotal + ' 件');
    expect(box.querySelector('.home-head .chip').hidden).toBe(true);
    expect(box.textContent).not.toMatch(/連続|最長/);

    // 選んだほうを覚える
    mount();
    expect(document.querySelector('#home-activity .seg[aria-pressed="true"]').textContent).toBe('チーム');
  });

  it('草: 列の上に月の名、左に 月・水・金、右下に 少〜多 の見本を置く', () => {
    mount();
    const box = document.getElementById('home-activity');
    const months = Array.from(box.querySelectorAll('.activity-month')).map((m) => m.textContent).filter(Boolean);
    expect(months.length).toBeGreaterThanOrEqual(12);
    months.forEach((m) => expect(m).toMatch(/^\d{1,2}月$/));
    // 月の名は週の列と同じ数だけ並び、列に揃う
    expect(box.querySelectorAll('.activity-month')).toHaveLength(53);
    expect(Array.from(box.querySelectorAll('.activity-days span')).map((d) => d.textContent))
      .toEqual(['月', '', '水', '', '金', '', '']);
    const legend = box.querySelector('.activity-legend');
    expect(legend.textContent).toBe('少多');
    expect(Array.from(legend.querySelectorAll('.activity-cell')).map((c) => c.className))
      .toEqual([0, 1, 2, 3, 4].map((lv) => 'activity-cell lv' + lv));
  });

  it('草: 月の名はその月の1日を含む週に置き、近すぎる名は落とす', () => {
    const { activityMonths } = ui(['activityMonths']);
    // 2025-10-13 (月) から 53 週
    const start = Date.UTC(2025, 9, 13);
    const weeks = Array.from({ length: 53 }, (_, w) => Array.from({ length: 7 }, (_, d) => ({
      day: new Date(start + (w * 7 + d) * 86400000).toISOString().substring(0, 10),
    })));
    const out = activityMonths(weeks);
    expect(out.filter(Boolean)).toEqual(['11月', '12月', '1月', '2月', '3月', '4月', '5月', '6月',
      '7月', '8月', '9月', '10月']);
    // 11/1 は 10/27 の週 (3列目)
    expect(out[2]).toBe('11月');
    expect(out[0]).toBe('');
  });

  it('草: マスには入らず、枠1つで矢印キーを使って日を選び、下の1行に字で出す', () => {
    mount();
    const box = document.getElementById('home-activity');
    const scroll = box.querySelector('.activity-scroll');
    const live = box.querySelector('.activity-live');
    expect(scroll.tabIndex).toBe(0);
    expect(live.getAttribute('aria-live')).toBe('polite');
    // マスは押せる形にしない (role="img" の中身は読み上げに出ない)
    expect(box.querySelectorAll('.activity-cell[tabindex]')).toHaveLength(0);
    const days = box.querySelectorAll('.activity-grid .activity-cell[data-day]');
    const last = days[days.length - 1];
    // はじめは今日 (右端) の数
    expect(live.textContent).toBe(last.title);

    scroll.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(live.textContent).toBe(days[days.length - 2].title);
    expect(days[days.length - 2].classList.contains('is-picked')).toBe(true);
    scroll.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(live.textContent).toBe(days[days.length - 9].title);
    scroll.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(live.textContent).toBe(days[0].title);
    expect(live.textContent).toMatch(/^\d+月\d+日 \(.\) \d+件$/);

    // 指で押したマスも同じ行に出す
    days[10].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(live.textContent).toBe(days[10].title);
  });

  it('草: 色の段は0件が0、ほかは分布で1〜4', () => {
    const { activityCuts, activityLevel } = ui(['activityCuts', 'activityLevel']);
    const cuts = activityCuts([0, 0, 1, 1, 2, 3, 4, 8]);
    expect(activityLevel(0, cuts)).toBe(0);
    expect(activityLevel(1, cuts)).toBeGreaterThanOrEqual(1);
    expect(activityLevel(8, cuts)).toBe(4);
    // 1件も無い年でも段が決まる (0件は0のまま)
    expect(activityLevel(0, activityCuts([0, 0]))).toBe(0);
  });

  it('草: いちばん多い日は4段目。どの日も同じ数なら全部を1段目にせず真ん中にする', () => {
    const { activityCuts, activityLevel } = ui(['activityCuts', 'activityLevel']);
    // 上から4分の1の切れ目が最多と同じでも、最多は4段目
    const few = activityCuts([1, 1, 1, 2]);
    expect(activityLevel(2, few)).toBe(4);
    expect(activityLevel(1, few)).toBe(1);
    const same = activityCuts([0, 3, 3, 3]);
    expect(activityLevel(3, same)).toBe(2);
    expect(activityLevel(0, same)).toBe(0);
  });

  it('最近の動き: 名前を出さず、押すと開く', () => {
    mount();
    const recent = document.getElementById('home-recent');
    // 種類の札 + 題 + いつ。「〜が確認依頼が出た」のような文にしない
    const rows = Array.from(recent.querySelectorAll('.home-row'));
    expect(rows.map((r) => [r.firstElementChild.textContent, r.querySelector('.home-row-title').textContent]))
      .toEqual([['反映', '確認依頼 #1 就業規則 第3条の改定'], ['完了', '#3 第7条に在宅勤務を足す'],
        ['登録', '就業規則.doc']]);
    expect(rows[0].getAttribute('aria-label')).toMatch(/^反映 確認依頼 #1 就業規則 第3条の改定 \(.+\)$/);
    rows.forEach((r) => expect(r.querySelector('.home-row-when').textContent).not.toBe(''));
    expect(recent.textContent).not.toMatch(/が確認依頼が出た|が文書を登録|が正式版に反映/);
    expect(recent.textContent).not.toMatch(/@|中井|佐藤/);
    recent.querySelector('[data-file="DOC1"]').click();
    expect(document.getElementById('panel-content').hidden).toBe(false);
  });

  it('最近の動き: 文書の一覧がまだ届いていなくても、文書を開ける', () => {
    let lateList = null;
    let first = true;
    mount({ apiListFiles: () => {
      if (first) { first = false; return { later: (ok) => { lateList = ok; } }; }
      return DEFAULTS.apiListFiles;
    } });
    document.querySelector('#home-recent [data-file="DOC1"]').click();
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(lateList).not.toBeNull();
  });

  it('1つの区画が取れなくても、ほかは出す。取れない区画にはその場で知らせる', () => {
    mount({ apiHomeActivity: () => new Error('混み合っています') });
    const act = document.getElementById('home-activity');
    // 見出しは残し、その下に知らせる (見出しまで消すと、何が出ていないのか分からない)
    expect(act.querySelector('.home-head h2').textContent).toBe('アクティビティ');
    expect(act.querySelector('.home-empty').textContent).toBe('出せませんでした: 混み合っています');
    expect(document.getElementById('home-turn').textContent).toContain('就業規則 第3条の改定');

    mount({ apiHomeSummary: () => new Error('混み合っています') });
    ['home-turn', 'home-recent'].forEach((id) => {
      const el = document.getElementById(id);
      expect(el.querySelector('.home-head h2')).not.toBeNull();
      expect(el.textContent).toContain('出せませんでした: 混み合っています');
    });
  });

  it('上の1行: 日付と、あなたの番・今日片づけたの数。取れなかった数は出さない', () => {
    mount();
    const line = document.getElementById('home-summary');
    expect(line.querySelector('strong').textContent).toMatch(/^\d{1,2}月\d{1,2}日 \(.\)$/);
    // 確かめてほしい 1 + 期限が近い 1
    expect(line.textContent).toContain('あなたの番 2件');
    expect(line.textContent).toContain('今日片づけた 0件');

    mount({ apiHomeSummary: () => new Error('混み合っています'), apiProgress: () => new Error('混み合っています') });
    const failed = document.getElementById('home-summary').textContent;
    expect(failed).toMatch(/^\d{1,2}月\d{1,2}日 \(.\)$/);
    expect(failed).not.toMatch(/あなたの番|今日片づけた|undefined|null/);
  });

  it('上の1行の日付は東京の日付', () => {
    const { homeDateText } = ui(['homeDateText']);
    expect(homeDateText(new Date('2026-10-14T03:00:00Z'))).toBe('10月14日 (水)');
    // 東京ではもう翌日
    expect(homeDateText(new Date('2026-10-13T16:00:00Z'))).toBe('10月14日 (水)');
    expect(homeDateText(new Date('2026-12-31T15:00:00Z'))).toBe('1月1日 (金)');
  });

  it('返事を待つあいだに別の画面へ移ったら、届いても描かず、戻しもしない', () => {
    let late = null;
    mount({ apiHomeSummary: () => ({ later: (ok) => { late = ok; } }) });
    document.querySelector('.nav-item[data-tab="issues"]').click();
    late(DEFAULTS.apiHomeSummary);
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('home-turn').textContent).toBe('');
  });
});

describe('改善のヒント', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ADVICE = [
    { id: 'reviews', title: '確認を待たせています', why: '確かめてほしいと頼まれた依頼のうち 1件が、3日以上そのままです',
      tip: '先に返すと、頼んだ人が先へ進めます', action: { kind: 'pulls', arg: '1', label: '確認依頼を開く' }, weight: 60 },
    { id: 'overdue', title: '期限切れが溜まっています', why: 'あなたが担当の期限切れが 3件あります',
      tip: '期限を見直すか、分けるか、手放しましょう', action: { kind: 'issues-overdue', arg: '', label: '期限切れを見る' }, weight: 50 },
    { id: 'repeat', title: '同じ作業を繰り返しています', why: '30日で「規定改訂」のやることが 5件できました',
      tip: 'ひな形にするか、手元の道具で自動化できます', action: { kind: 'issues-filter', arg: '規定改訂', label: 'まとめて見る' }, weight: 20 },
  ];
  const withAdvice = (list) => ({ apiHomeSummary: { ...DEFAULTS.apiHomeSummary, advice: list } });
  const box = () => document.getElementById('home-advice');
  const button = (label) => Array.from(box().querySelectorAll('button')).find((b) => b.textContent === label);

  it('当たる規則が無ければカードごと出さない', () => {
    mount();
    expect(box().children).toHaveLength(0);
  });

  it('1件ごとに、なぜ (数字) と次にすること (ボタン) を出す', () => {
    mount(withAdvice(ADVICE));
    expect(box().querySelector('.home-section-head').textContent).toBe('改善のヒント');
    expect(box().querySelectorAll('.advice-item')).toHaveLength(3);
    expect(box().textContent).toContain('あなたが担当の期限切れが 3件あります');
    expect(box().textContent).toContain('期限を見直すか、分けるか、手放しましょう');
    expect(button('期限切れを見る')).toBeTruthy();
    expect(box().querySelectorAll('.advice-hide')).toHaveLength(3);
  });

  it('期限切れを見る: やることの一覧を、自分の担当の期限切れだけに絞って開く', () => {
    // 自分の担当で期限がまだ先のもの (#5) と、期限切れでも済んだもの (#6) は出ない
    mount({ ...withAdvice(ADVICE), apiIssueList: [...DEFAULTS.apiIssueList,
      { ...DEFAULTS.apiIssueList[0], number: 5, parent: '', dueDate: '2999-12-31' },
      { ...DEFAULTS.apiIssueList[0], number: 6, parent: '', state: 'closed' }] });
    button('期限切れを見る').click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('mine-btn').getAttribute('aria-checked')).toBe('true');
    const chip = document.getElementById('overdue-only');
    expect(chip.hidden).toBe(false);
    const rows = Array.from(document.querySelectorAll('#issue-list .row-item')).map((r) => r.dataset.number);
    expect(rows).toEqual(['2']);
    // 絞りを外せる
    chip.click();
    expect(chip.hidden).toBe(true);
    expect(document.querySelectorAll('#issue-list .row-item').length).toBeGreaterThan(1);
  });

  it('期限切れだけ: 人が見え方を切り替えたら外れ、集計・捨てたものでは札を出さない', () => {
    const list = [...DEFAULTS.apiIssueList,
      { ...DEFAULTS.apiIssueList[0], number: 5, parent: '', dueDate: '2999-12-31' }];
    mount({ ...withAdvice(ADVICE), apiIssueList: list });
    const chip = document.getElementById('overdue-only');
    button('期限切れを見る').click();
    expect(chip.hidden).toBe(false);
    document.getElementById('view-tally').click();
    expect(chip.hidden).toBe(true);
    document.getElementById('view-list').click();
    expect(chip.hidden).toBe(true);
    expect(Array.from(document.querySelectorAll('#issue-list .row-item')).map((r) => r.dataset.number)).toContain('5');

    // 捨てたものへ移っても札は出ない
    document.querySelector('.nav-item[data-tab="home"]').click();
    button('期限切れを見る').click();
    document.getElementById('view-trash').click();
    expect(chip.hidden).toBe(true);
  });

  it('まとめて見る: その言葉で絞ったやることの一覧を開く', () => {
    mount(withAdvice(ADVICE));
    button('まとめて見る').click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('issue-filter').value).toBe('規定改訂');
    expect(document.getElementById('overdue-only').hidden).toBe(true);
  });

  it('ボード・工程表・確認依頼・要望へも開く', () => {
    const app = mount(withAdvice([
      ...ADVICE.slice(0, 1),
      { ...ADVICE[1], id: 'wip', action: { kind: 'board', arg: '', label: 'ボードを開く' } },
      { ...ADVICE[1], id: 'estimate', action: { kind: 'gantt', arg: '', label: '工程表を開く' } },
    ]));
    button('ボードを開く').click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('board').hidden).toBe(false);

    document.querySelector('.nav-item[data-tab="home"]').click();
    button('工程表を開く').click();
    expect(document.getElementById('gantt').hidden).toBe(false);

    document.querySelector('.nav-item[data-tab="home"]').click();
    button('確認依頼を開く').click();
    expect(document.getElementById('panel-pulls').hidden).toBe(false);
    expect(app.calls.filter((c) => c.name === 'apiPrPreview').map((c) => c.args[0])).toContain(1);

    mount(withAdvice([{ ...ADVICE[1], id: 'questions', action: { kind: 'report', arg: '', label: '要望・不具合を開く' } }]));
    button('要望・不具合を開く').click();
    expect(document.getElementById('panel-report').hidden).toBe(false);
  });

  it('「今週は出さない」で消え、開き直しても今週は出ない。全部隠したらカードごと消える', () => {
    mount(withAdvice(ADVICE.slice(0, 2)));
    box().querySelector('[data-advice="overdue"] .advice-hide').click();
    expect(box().querySelector('[data-advice="overdue"]')).toBeNull();
    expect(box().querySelector('[data-advice="reviews"]')).not.toBeNull();
    expect(window.localStorage.getItem('adviceHidden')).toContain('overdue');

    mount(withAdvice(ADVICE.slice(0, 2)));
    expect(box().querySelector('[data-advice="overdue"]')).toBeNull();
    box().querySelector('[data-advice="reviews"] .advice-hide').click();
    expect(box().children).toHaveLength(0);
  });

  it('隠したのが前の週なら、また出す', () => {
    window.localStorage.setItem('adviceHidden', JSON.stringify({ overdue: '2000-W01' }));
    mount(withAdvice(ADVICE));
    expect(box().querySelector('[data-advice="overdue"]')).not.toBeNull();
  });

  it('覚え書きが壊れていても落ちずに出す', () => {
    window.localStorage.setItem('adviceHidden', '{壊れた');
    mount(withAdvice(ADVICE));
    expect(box().querySelectorAll('.advice-item')).toHaveLength(3);
  });
});
