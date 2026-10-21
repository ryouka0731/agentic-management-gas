// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

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
  'apiListFiles', 'apiWorkspace', 'apiSettings', 'apiWhoAmI', 'apiNotifications',
  'apiOverview', 'apiProgress', 'apiMyMilestones', 'apiMyToday', 'apiGameState', 'apiGameTop', 'apiReportParts',
  'apiHomeSummary', 'apiHomeActivity', 'apiPrefs', 'apiOshiGet',
];

/** 急がないもの: 最初の波の返事がそろってから */
const LATER = ['apiAchievementsCheck', 'apiKitStatus'];

/** 開いた直後には取らないもの (要るときに取る) */
const ON_DEMAND = [
  'apiIssueList', 'apiPeopleNames', 'apiWorkStyleTeam', 'apiTagList', 'apiIssuePriorities', 'apiKnownPeople',
  'apiTemplateList', 'apiArchiveKeepDays', 'apiTallyScope', 'apiTasksState',
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

  it('文書のリンクの文書が開けずふつうの画面に戻したら、左の行き先と上の段に要るものを取る', () => {
    const app = mountApp(Object.assign({}, DEFAULTS), { link: { doc: 'NOPE123456' } });
    ['apiWorkspace', 'apiSettings', 'apiWhoAmI', 'apiNotifications', 'apiOverview', 'apiHomeSummary']
      .forEach((n) => expect(count(app, n), n).toBe(1));
  });
});

describe('要るときに1回だけ取る', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('やることを開くと、一覧と、並べるのに要るものを取る', () => {
    const app = mount();
    const before = app.calls.length;
    $('.nav-item[data-tab="issues"]').click();
    const opened = app.calls.slice(before).map((c) => c.name);
    ['apiIssueList', 'apiPeopleNames', 'apiWorkStyleTeam', 'apiTagList', 'apiIssuePriorities',
      'apiKnownPeople', 'apiTemplateList', 'apiTasksState'].forEach((n) => expect(opened, n).toContain(n));
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
    $('.nav-item[data-tab="issues"]').click();
    // 取れなくても一覧は描く (控えの色で)
    expect($('#issue-list').textContent).toContain('通勤手当の見直し');
    $('.nav-item[data-tab="home"]').click();
    $('.nav-item[data-tab="issues"]').click();
    expect(count(app, 'apiTagList')).toBe(2);
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
