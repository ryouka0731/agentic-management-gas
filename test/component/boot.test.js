// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, DEFAULTS, takeUncaught } from '../dom.js';
import { mount } from './mount.js';
import fs from 'node:fs';
import path from 'node:path';

/*
 * 開いたときの呼び出しの波 (docs/dev/ui.md)。
 *
 * 以前は開いた直後に api を30本同時に投げていた (やることの一覧・名簿・札・ひな形… を、ホームしか見ていないのに)。
 * 1本ごとにサーバの起動代と台帳の読み取りがかかり、ブラウザは同じ相手への同時の接続を6本ほどに絞るので、
 * ホームに要るものまで後ろで待たされていた。ここで本数と順番を固定する。
 */

const names = (app) => app.calls.map((c) => c.name);
const count = (app, name) => names(app).filter((n) => n === name).length;
const $ = (sel) => document.querySelector(sel);

/** 最初の波: ホームの描画・左の行き先の数・上の段に要るもの */
const FIRST_WAVE = [
  // 1本ずつ投げるもの (Drive を読む重いもの・引数のあるもの・ほかの呼び出しが待つもの・動きの一覧) と、
  // まとめて1本 (apiBoot) で取る軽いもの。左の行き先・上の段のまとめは、ホームの重いものより先に送る
  // (bootHomeWave の直後の bootBatchFlush)。疑似の返事は同期で返るので、前進の返事が投げた続き (カードの軽い3本) は
  // 前進の返事の扱いの終わりに送られ、ホームの要約より前に並ぶ (実物では前進の返事が届いたときになる)
  'apiListFiles', 'apiNotifications',
  'apiBoot', 'apiWorkspace', 'apiSettings', 'apiWhoAmI',
  'apiOverview', 'apiProgress', 'apiMyToday', 'apiReportParts',
  'apiBoot', 'apiMyMilestones', 'apiGameState', 'apiGameTop',
  'apiHomeSummary', 'apiHomeActivity', 'apiPrefs', 'apiOshiGet',
];

/** まとめて取る軽いもの (app.js の BOOT_BATCH_NAMES と Boot.gs の BOOT_BATCH_NAMES) */
const BATCHED = [
  'apiWorkspace', 'apiSettings', 'apiWhoAmI',
  'apiMyMilestones', 'apiGameState', 'apiGameTop',
];
/** まとめの口に渡した名前の並び (回ごと) */
const batches = (app) => app.calls.filter((c) => c.name === 'apiBoot').map((c) => c.args[0]);

/** 急がないもの: 最初の波の返事がそろってから。名前・型・札・優先度は、画面を初めて開くときに待たないよう先に取る */
const PREFETCH = ['apiPeopleNames', 'apiWorkStyleTeam', 'apiTagList', 'apiIssuePriorities'];
const LATER = ['apiAchievementsCheck', 'apiAnnouncementNext', 'apiKitStatus'].concat(PREFETCH);

/** 開いた直後には取らないもの (要るときに取る) */
const ON_DEMAND = [
  'apiIssueList', 'apiKnownPeople', 'apiTemplateList', 'apiArchiveKeepDays', 'apiTallyScope', 'apiTasksState',
];

/** 返事を止めておき、あとで返す */
function hold(value) {
  const box = { deliver: null };
  box.response = { later: (ok) => { box.deliver = () => ok(structuredClone(value)); } };
  return box;
}

describe('開いた直後に呼ぶもの', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('ホームに要る最初の波と、急がないものだけを呼ぶ', () => {
    const app = mount();
    expect(names(app)).toEqual(FIRST_WAVE.concat(LATER));
    ON_DEMAND.forEach((n) => expect(names(app), n).not.toContain(n));
  });

  it('ポイントの形 (apiGameState) は1回だけ取る (以前は自分の欄を描くたびに取り、3回呼んでいた)', () => {
    const app = mount();
    expect(count(app, 'apiGameState')).toBe(1);
  });

  it('急がないものは、最初の波の返事がそろうまで呼ばない', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mount({ apiHomeSummary: summary.response });
    LATER.forEach((n) => expect(names(app), n).not.toContain(n));
    summary.deliver();
    LATER.forEach((n) => expect(count(app, n), n).toBe(1));
  });

  it('最初の波の1本が失敗しても、急がないものは走る', () => {
    const app = mount({ apiHomeActivity: new Error('取れません') });
    LATER.forEach((n) => expect(count(app, n), n).toBe(1));
  });

  it('文書のリンクで開いたときは、文書に要るものだけを呼ぶ', () => {
    const app = mountApp(Object.assign({}, DEFAULTS), { link: { doc: 'DOC1' } });
    expect(names(app)).toEqual([
      'apiListFiles', 'apiGetFileHtml', 'apiFileStatus', 'apiPrefs', 'apiOshiGet',
      // 急がないもの (見えないベルの数と、開いた日を数える実績)
      'apiNotifications', 'apiAchievementsCheck',
    ]);
  });

  it('急がない波で、名前・型・札・優先度を先に取る (やることを開いたときは一覧の1本だけになる)', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mount({ apiHomeSummary: summary.response });
    PREFETCH.forEach((n) => expect(names(app), n).not.toContain(n));
    summary.deliver();
    PREFETCH.forEach((n) => expect(count(app, n), n).toBe(1));
    const before = app.calls.length;
    $('.nav-item[data-tab="issues"]').click();
    const opened = app.calls.slice(before).map((c) => c.name);
    PREFETCH.forEach((n) => expect(opened, n).not.toContain(n));
    // 待つものはそろっているので、一覧はその場で取る (名簿・ひな形などは待たずに並べて取る)
    expect(opened).toContain('apiIssueList');
    expect($('#issue-list').textContent).toContain('通勤手当の見直し');
  });

  it('文書のリンクで開いたときは、名前・型・札・優先度を先取りしない', () => {
    const app = mountApp(Object.assign({}, DEFAULTS), { link: { doc: 'DOC1' } });
    PREFETCH.concat(['apiKitStatus', 'apiAnnouncementNext']).forEach((n) => expect(names(app), n).not.toContain(n));
  });

  it('先取りの返事を待っているあいだにやることを開いても、二度取らずに待ち合わせる', () => {
    const tags = hold(DEFAULTS.apiTagList);
    const app = mount({ apiTagList: tags.response });
    expect(count(app, 'apiTagList')).toBe(1);
    $('.nav-item[data-tab="issues"]').click();
    expect(count(app, 'apiTagList')).toBe(1);
    // 札が届くまでは一覧を取らない
    expect(names(app)).not.toContain('apiIssueList');
    tags.deliver();
    expect(count(app, 'apiTagList')).toBe(1);
    expect(count(app, 'apiIssueList')).toBe(1);
    expect($('#issue-list').textContent).toContain('通勤手当の見直し');
  });

  it('文書のリンクの文書が開けずふつうの画面に戻したら、左の行き先と上の段に要るものを取る', () => {
    const app = mountApp(Object.assign({}, DEFAULTS), { link: { doc: 'NOPE123456' } });
    ['apiWorkspace', 'apiSettings', 'apiWhoAmI', 'apiNotifications', 'apiOverview', 'apiHomeSummary']
      .forEach((n) => expect(count(app, n), n).toBe(1));
  });
});

describe('要るときに1回だけ取る', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('やることを開くと、一覧と、入力のときに引くものを取る (名前・札は急がない波で取ってある)', () => {
    const app = mount();
    const before = app.calls.length;
    $('.nav-item[data-tab="issues"]').click();
    const opened = app.calls.slice(before).map((c) => c.name);
    ['apiIssueList', 'apiKnownPeople', 'apiTemplateList', 'apiTasksState', 'apiArchiveKeepDays']
      .forEach((n) => expect(opened, n).toContain(n));
    expect($('#issue-list').textContent).toContain('通勤手当の見直し');
  });

  it('2回開いても、名前や札は1回しか取らない (一覧は開くたびに取り直す)', () => {
    const app = mount();
    $('.nav-item[data-tab="issues"]').click();
    $('.nav-item[data-tab="home"]').click();
    $('.nav-item[data-tab="issues"]').click();
    ['apiPeopleNames', 'apiWorkStyleTeam', 'apiTagList', 'apiIssuePriorities', 'apiKnownPeople',
      'apiTemplateList', 'apiTasksState'].forEach((n) => expect(count(app, n), n).toBe(1));
    expect(count(app, 'apiIssueList')).toBe(2);
  });

  it('取りに行っている最中に別の画面を開いても、2本目を投げずに待ち合わせる', () => {
    const people = hold(DEFAULTS.apiPeopleNames);
    const app = mount({ apiPeopleNames: people.response });
    $('.nav-item[data-tab="issues"]').click();
    // 名前を待っているあいだは一覧を取らない (名前の無い一覧を描かない)
    expect(names(app)).not.toContain('apiIssueList');
    $('.nav-item[data-tab="pulls"]').click();
    expect(count(app, 'apiPeopleNames')).toBe(1);
    expect(names(app)).not.toContain('apiPrList');
    people.deliver();
    // いま開いている確認依頼だけを取る。待つあいだに離れたやることの一覧は取らない
    expect(names(app)).toContain('apiPrList');
    expect(names(app)).not.toContain('apiIssueList');
  });

  it('取れなかったものは覚えず、次に要るときに取り直す', () => {
    const app = mount({ apiTagList: new Error('混み合っています') });
    // 急がない波の先取りで1回失敗している
    expect(count(app, 'apiTagList')).toBe(1);
    $('.nav-item[data-tab="issues"]').click();
    expect(count(app, 'apiTagList')).toBe(2);
    // 取れなくても一覧は描く (控えの色で)
    expect($('#issue-list').textContent).toContain('通勤手当の見直し');
    $('.nav-item[data-tab="home"]').click();
    $('.nav-item[data-tab="issues"]').click();
    expect(count(app, 'apiTagList')).toBe(3);
  });

  it('自分の欄は、開いたときに名前と道具の更新を待ってから描く', () => {
    const app = mount({ apiKitStatus: { print: 'new', mine: 'old', outdated: true } });
    // 起動のあと急がない波で取っている。開いても取り直さない
    $('#me-btn').click();
    expect(count(app, 'apiKitStatus')).toBe(1);
    expect(count(app, 'apiPeopleNames')).toBe(1);
    expect($('#me-panel').textContent).toMatch(/道具/);
    expect($('#me-who').textContent).toBe('山田 太郎');
  });

  it('集計を開くと、誰のぶんを見られるかを取る (開いた直後には取らない)', () => {
    window.localStorage.setItem('issueView', 'tally');
    const app = mount();
    expect(names(app)).not.toContain('apiTallyScope');
    $('.nav-item[data-tab="issues"]').click();
    expect(count(app, 'apiTallyScope')).toBe(1);
    expect(names(app)).toContain('apiTallyEffort');
  });

  it('ホームから (近道の n で) 作る欄を開くと、札・優先度・ひな形を取ってから組む', () => {
    const tpl = hold([{ name: '定例', body: '議題:', mine: true }]);
    const app = mount({ apiTemplateList: tpl.response });
    expect($('#panel-home').hidden).toBe(false);
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    ['apiTemplateList', 'apiTagList', 'apiIssuePriorities', 'apiPeopleNames']
      .forEach((n) => expect(count(app, n), n).toBe(1));
    // ひな形が届くまでは組まない (ひな形の無い欄を出さない)
    expect($('#side-body form')).toBe(null);
    tpl.deliver();
    expect($('#side-body form')).not.toBe(null);
    expect($('#side-body').textContent).toContain('定例');
  });

  it('ホームからやることを開いても、親への行き先が出る (開くときに取った一覧で埋める)', () => {
    const list = [
      { number: 6, title: '施行日まわり', state: 'open', parent: '', assignee: '', labels: '' },
      { number: 7, title: '附則の施行日を決める', state: 'open', parent: 6, assignee: '', labels: '' },
    ];
    const app = mount({ apiIssueList: list });
    expect(names(app)).not.toContain('apiIssueList');
    // あなたの番の「期限」の行。番号だけ分かっているので、開くときに一覧を取る
    $('#home-turn [data-issue="7"]').click();
    expect(count(app, 'apiIssueList')).toBe(1);
    expect($('#side-title').textContent).toBe('やること #7');
    // 以前は起動のときに隠れた一覧を取っていたので、親と子を引けていた。取らなくなっても引ける
    expect($('#side-body .rel-chip').textContent).toContain('6');
  });
});

describe('開いた直後の軽いものは、まとめて1本で取る (apiBoot)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('開いたときに投げた軽いものを1本にまとめ、前進の返事を待つあいだは、返事が投げた続きを次の1本にまとめる。重いものは1本ずつ', () => {
    const progress = hold(DEFAULTS.apiProgress);
    const app = mount({ apiProgress: progress.response });
    // 左の行き先・上の段の3本は、ホームの重いものより先に1本で
    expect(batches(app)).toEqual([['apiWorkspace', 'apiSettings', 'apiWhoAmI']]);
    expect(names(app).indexOf('apiBoot')).toBeLessThan(names(app).indexOf('apiOverview'));
    progress.deliver();
    expect(batches(app)).toEqual([
      ['apiWorkspace', 'apiSettings', 'apiWhoAmI'],
      ['apiMyMilestones', 'apiGameState', 'apiGameTop'],
    ]);
    // まとめた中の1本ずつは、口の外で投げていない。重いものと、ほかが待つもの (前進・設定) は1本ずつ
    const direct = app.calls.filter((c) => !c.batched).map((c) => c.name);
    BATCHED.forEach((n) => expect(direct, n).not.toContain(n));
    ['apiListFiles', 'apiOverview', 'apiHomeSummary', 'apiProgress', 'apiPrefs', 'apiMyToday', 'apiReportParts', 'apiOshiGet',
      'apiHomeActivity'].forEach((n) => expect(direct, n).toContain(n));
  });

  it('画面とサーバの「まとめて取るもの」の並びが揃っている', () => {
    const read = (f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    const listOf = (text) => {
      const m = /BOOT_BATCH_NAMES(?:\(\) \{\s*return| =) \[([\s\S]*?)\]/.exec(text);
      return [...m[1].matchAll(/'(api\w+)'/g)].map((x) => x[1]);
    };
    expect(listOf(read('src/ui/app.js.html'))).toEqual(listOf(read('src/api/Boot.gs')));
    expect(listOf(read('src/api/Boot.gs'))).toEqual(BATCHED);
  });

  it('まとめた中の1本が断られても、ほかの返事は届き、断りは1本ずつの失敗の扱いに回る', () => {
    // 動きの一覧 (apiHomeActivity) だけ断られる。同じ口の左上の名前 (apiWorkspace) と設定 (apiSettings) は届く
    // 自分の顔 (apiWhoAmI) だけ断られる。同じ口の左上の名前 (apiWorkspace) と設定 (apiSettings) は届く
    const app = mount({ apiWhoAmI: new Error('判定できません'), apiWorkspace: { name: '総務の文書' } });
    expect($('#brand').textContent).toContain('総務の文書');
    expect(batches(app)[0]).toContain('apiWhoAmI');
    expect(batches(app)[0]).toContain('apiSettings');
    // 急がないものも走る (失敗も返事として数える)
    LATER.forEach((n) => expect(count(app, n), n).toBe(1));
  });

  it('まとめの口そのものが落ちたら、1本ずつ取り直す (まとめる前と同じ動きに戻る)', () => {
    const app = mountApp(Object.assign({}, DEFAULTS, { apiBoot: new Error('まとめて取れませんでした') }));
    expect(count(app, 'apiBoot')).toBeGreaterThanOrEqual(1);
    // 取り直しは口の外で1本ずつ
    const direct = app.calls.filter((c) => !c.batched).map((c) => c.name);
    BATCHED.forEach((n) => expect(count({ calls: app.calls.filter((c) => !c.batched) }, n), n).toBe(1));
    expect(direct).toContain('apiPrefs');
    LATER.forEach((n) => expect(count(app, n), n).toBe(1));
  });

  it('返事の形が合わなければ (数が違う・1つの形が違う)、その分を1本ずつ取り直す', () => {
    const app = mountApp(Object.assign({}, DEFAULTS, { apiBoot: [] }));
    const bootAt = app.calls.findIndex((c) => c.name === 'apiBoot');
    expect(bootAt).toBeGreaterThanOrEqual(0);
    // 口のあとに、口の外で1本ずつ
    const after = app.calls.slice(bootAt + 1).filter((c) => !c.batched).map((c) => c.name);
    BATCHED.forEach((n) => expect(after.filter((x) => x === n).length, n).toBe(1));

    // 数は合うが、1つだけ形が違う (ok が真偽でない)。その1本だけ取り直し、ほかはそのまま届く
    const odd = mountApp(Object.assign({}, DEFAULTS, {
      apiBoot: (names) => names.map((n) => (n === 'apiWhoAmI' ? { value: DEFAULTS.apiWhoAmI } : { ok: true, value: DEFAULTS[n] })),
    }));
    const oddAfter = odd.calls.slice(odd.calls.findIndex((c) => c.name === 'apiBoot') + 1).filter((c) => !c.batched).map((c) => c.name);
    expect(oddAfter.filter((x) => x === 'apiWhoAmI').length).toBe(1);
    expect(oddAfter).not.toContain('apiWorkspace');
    expect(oddAfter).not.toContain('apiSettings');
  });

  it('まとめた返事の1つの扱いが投げても、残りの返事は配り、投げたものは握りつぶさずに表に出す', () => {
    // カードの返事が描けない形 (扱いが投げる) でも、同じ口の残りは届き、急がないものも走る
    const progress = hold(DEFAULTS.apiProgress);
    // カードは5本の返事がそろって描く。最後に届くのはまとめの口なので、描けない返事 (今日の一覧が字。日報の形が無いと
    // 今日の一覧をそのまま並べる) はその扱いの中で投げる
    const app = mount({ apiProgress: progress.response, apiMyToday: 'こわれた', apiReportParts: null });
    progress.deliver();
    expect(batches(app)[1]).toEqual(['apiMyMilestones', 'apiGameState', 'apiGameTop']);
    expect(count(app, 'apiGameTop')).toBe(1);
    LATER.forEach((n) => expect(count(app, n), n).toBe(1));
    // 投げたものは受け止められなかった例外として表に出る (握りつぶすと壊れた扱いに気づけない)
    const errs = takeUncaught();
    expect(errs.length).toBe(1);
  });

  it('口は、知らない名前・同じ名前の重なり・多すぎる並びを断る (サーバ)', async () => {
    const { loadGasWith } = await import('../harness.js');
    const { createFakeGas } = await import('../fakegas.js');
    const { APP_SOURCES } = await import('../sources.js');
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    const res = ctx.apiBoot(['apiWhoAmI', 'apiIssueList']);
    expect(res[0].ok).toBe(true);
    expect(res[1].ok).toBe(false);
    expect(res[1].error).toContain('まとめて取れないものです');
    expect(() => ctx.apiBoot(['apiWhoAmI', 'apiWhoAmI'])).toThrow(/まとめて取れないものです/);
    expect(() => ctx.apiBoot(new Array(20).fill('apiWhoAmI'))).toThrow(/まとめて取れないものです/);
  });

  it('最初の波が閉じたあとは、同じ名前でも1本ずつ取る (まとめない)', () => {
    const app = mount();
    const before = app.calls.length;
    // 設定の画面を開くとチームの設定 (apiSettings) を取り直す
    $('.nav-item[data-tab="settings"]').click();
    const after = app.calls.slice(before);
    expect(after.some((c) => c.name === 'apiBoot')).toBe(false);
    expect(after.some((c) => c.name === 'apiSettings' && !c.batched)).toBe(true);
  });
});
