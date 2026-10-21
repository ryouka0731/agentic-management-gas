import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES, FULL_SOURCES } from './sources.js';

/*
 * 機能ごとの「はじめて」と、推しと部屋の通算 (実績を足したぶん)。定義は src/core/Achievements.js、数えるのは
 * AchievementsStore.gs の achCounts_。どれも「操作すると取れる」ことを疑似GASで1つずつ確かめる。
 * 数え方は既にある記録 (台帳・自分の設定・使われ方の場所) に乗せ、実績のための記録の表や api は作らない。
 */

const ME = 'tester@example.com';
const OTHER = 'other@example.com';
const DAY1 = new Date('2026-10-21T03:00:00Z'); // 東京 12:00

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}
const newly = (ctx, opts) => ctx.achCheck_(ME, DAY1, opts || {}).newly.slice().sort();
const usage = (ctx, target, count) => ctx.usageRecord([{ kind: 'action', target, count: count || 1 }]);
const view = (ctx, target) => ctx.usageRecord([{ kind: 'view', target, count: 1 }]);

describe('文書 (はじめて: 文書)', () => {
  it('文書を登録した・変更を記録した・改訂版に文書を足した は、台帳に残る人の名から', () => {
    const { ctx } = setup();
    expect(newly(ctx)).toEqual([]);
    ctx.dbAppend('files', { fileId: 'F1', path: 'a', type: 'doc', registeredBy: ME, registeredAt: DAY1 });
    // 番頭が自分で残す記録 (最初の記録・改訂版を作る・反映・退避) は「変更を記録した」にしない
    for (const message of ['最初の記録', '改訂版「見直し」を作成', '反映: 確認依頼 #1 a', '確認依頼 #1 を反映する前の退避',
      '空白の扱いを改めた記録 (中身は変わっていません)']) {
      ctx.dbAppend('commits', { sha: message, branch: 'main', fileId: 'F1', author: ME, message, timestamp: DAY1 });
    }
    // 反映の記録は「反映した」になる (変更を記録した にはしない)
    expect(newly(ctx)).toEqual(['first-merge', 'first-register']);
    ctx.dbAppend('commits', { sha: 's1', branch: '見直し', fileId: 'F2', author: ME, message: 'a を 見直し に足した', timestamp: DAY1 });
    expect(newly(ctx)).toEqual(['first-addFile']);
    ctx.dbAppend('commits', { sha: 's2', branch: 'main', fileId: 'F1', author: OTHER, message: '誤字を直した', timestamp: DAY1 });
    expect(newly(ctx)).toEqual([]);
    ctx.dbAppend('commits', { sha: 's3', branch: 'main', fileId: 'F1', author: 'Tester@Example.com', message: '誤字を直した', timestamp: DAY1 });
    expect(newly(ctx)).toEqual(['first-commit']);
  });

  it('全画面のリンクを写した は、押した場所 doc-link-btn の使われ方から', () => {
    const { ctx } = setup();
    usage(ctx, 'doc-link-btn');
    expect(newly(ctx)).toEqual(['first-docLink']);
  });
});

describe('やること (はじめて: やること)', () => {
  it('やることを作った・タグを付けた (新しいタグを書いた) は変更の履歴とタグの一覧から', () => {
    const { ctx } = setup();
    ctx.issueCreate('しごと', '', [], '新しい札');
    expect(newly(ctx)).toEqual(['first-issue', 'first-tag']);
  });

  it('既にあるタグを付けただけでも、タグを付けた になる (変更の履歴の labels)。ほかの人が付けたものは数えない', () => {
    const { ctx, fake } = setup();
    fake._setUser(OTHER);
    const n = ctx.issueCreate('しごと', '', []).number;
    ctx.issueUpdate(n, { labels: '急ぎ' });
    fake._setUser(ME);
    expect(newly(ctx)).toEqual([]);
    ctx.issueUpdate(n, { labels: '' });
    expect(newly(ctx)).toEqual([]);
    ctx.issueUpdate(n, { labels: '急ぎ' });
    expect(newly(ctx)).toEqual(['first-tag']);
  });

  it('下書き (ひな形) は、自分の下書きを作るか、下書きを差し込む (template-use) と取れる', () => {
    let { ctx } = setup();
    ctx.apiTemplateSave('週次', '## やったこと');
    expect(newly(ctx)).toEqual(['first-template']);
    ({ ctx } = setup());
    usage(ctx, 'template-use');
    expect(newly(ctx)).toEqual(['first-template']);
    // 最初からある下書き (作った人が空) は数えない
    ({ ctx } = setup());
    ctx.apiTemplateList();
    expect(newly(ctx)).toEqual([]);
  });

  it('進捗ボードで動かした・工程表を見た は使われ方の場所 (board-move / view-gantt) から', () => {
    const { ctx } = setup();
    usage(ctx, 'board-move');
    usage(ctx, 'view-gantt');
    expect(newly(ctx)).toEqual(['first-board', 'first-gantt']);
  });

  it('作業期間を作った・困りごとを書き出した は台帳から。「期間で進める」がオフなら取れない', () => {
    const { ctx } = setup();
    expect(ctx.achUnavailable_(ME)['first-sprint']).toContain('期間で進める');
    expect(ctx.achUnavailable_(ME)['first-impediment']).toContain('期間で進める');
    ctx.apiSetScrumEnabled(true);
    expect(ctx.achUnavailable_(ME)['first-sprint']).toBeUndefined();
    ctx.apiSprintCreate({ name: 'S1', startDate: '2026-10-20', endDate: '2026-10-31' });
    ctx.apiImpedimentCreate({ title: '待ち' });
    expect(newly(ctx)).toEqual(['first-impediment', 'first-sprint']);
  });

  it('Google ToDo に送った は送った覚え (task_links) から。Tasks のサービスが無い環境では取れない', () => {
    expect(setup().ctx.achUnavailable_(ME)['first-tasks']).toContain('Google Tasks');
    const fake = createFakeGas();
    fake.Tasks = fake._makeTasks();
    // ToDo 連携 (GoogleTasks.gs) まで読む
    const ctx = loadGasWith(fake, ...FULL_SOURCES);
    ctx.repoInit('agentic-management');
    expect(ctx.achUnavailable_(ME)['first-tasks']).toBeUndefined();
    ctx.dbAppend('task_links', { issueNumber: 1, user: OTHER, taskId: 't0', listId: 'L', syncedAt: DAY1 });
    expect(newly(ctx)).toEqual([]);
    ctx.dbAppend('task_links', { issueNumber: 1, user: ME, taskId: 't1', listId: 'L', syncedAt: DAY1 });
    expect(newly(ctx)).toEqual(['first-tasks']);
  });
});

describe('自分と道具 (はじめて: 自分と道具)', () => {
  it('自分の設定を変えた は自分の設定 (MYPREF:) に値があれば。使い方・使われ方 は開いた頁の使われ方から', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('terms.style', 'scrum');
    view(ctx, 'help');
    view(ctx, 'usage');
    expect(newly(ctx)).toEqual(['first-help', 'first-settings', 'first-usageView']);
  });

  it('実績の頁を見た は頁を開いたとき (apiAchievements) に取れ、開いたときの数え直しでは取れない', () => {
    const { ctx } = setup();
    expect(ctx.apiAchievementsCheck().newly.map((a) => a.key)).toEqual(['days-1']);
    // その日に「まだ」と覚えても、頁を開けば取れる
    expect(ctx.apiAchievements().newly.map((a) => a.key)).toEqual(['first-achPage']);
    expect(ctx.apiAchievements().newly).toEqual([]);
  });
});

describe('推しと部屋', () => {
  it('作業部屋を開いた・音を流した・頭をなでた は使われ方の場所から (本人のぶんだけ)', () => {
    const { ctx, fake } = setup();
    fake._setUser(OTHER);
    usage(ctx, 'room-open');
    usage(ctx, 'oshi-pat');
    fake._setUser(ME);
    expect(newly(ctx)).toEqual([]);
    usage(ctx, 'room-open');
    usage(ctx, 'room-sound');
    usage(ctx, 'oshi-pat');
    expect(newly(ctx)).toEqual(['first-pat', 'first-room', 'first-roomSound']);
  });

  it('通算 (なでた 10 / 50 回・作業部屋 10 / 50 回) は、日ごとの回数を足して数え、あと何回かを出す', () => {
    const { ctx } = setup();
    ctx.dbAppend('usage', { day: '2026-10-01', kind: 'action', target: 'oshi-pat', count: 6, user: ME });
    ctx.dbAppend('usage', { day: '2026-10-02', kind: 'action', target: 'oshi-pat', count: 3, user: 'Tester@Example.com' });
    ctx.dbAppend('usage', { day: '2026-10-02', kind: 'action', target: 'oshi-pat', count: 30, user: OTHER });
    ctx.dbAppend('usage', { day: '2026-10-03', kind: 'action', target: 'room-open', count: 12, user: ME });
    const res = ctx.achCheck_(ME, DAY1, {});
    expect(res.counts).toMatchObject({ pats: 9, pat: 1, rooms: 12, room: 1 });
    expect(res.newly.slice().sort()).toEqual(['first-pat', 'first-room', 'rooms-10']);
    const page = ctx.apiAchievements();
    expect(page.items.find((a) => a.key === 'pats-10').hint).toBe('あと 1 回で…');
    expect(page.items.find((a) => a.key === 'rooms-50').hint).toBe('あと 38 回で…');
    ctx.dbAppend('usage', { day: '2026-10-04', kind: 'action', target: 'oshi-pat', count: 1, user: ME });
    expect(newly(ctx, { metrics: ['pat', 'pats'] })).toEqual(['pats-10']);
  });

  it('作業雑談部屋をのぞいた は頁を開いた使われ方から。チームの設定がオフなら取れない (入ったかは数えない)', () => {
    const { ctx } = setup();
    expect(ctx.achUnavailable_(ME)['first-cowork']).toContain('作業雑談部屋を使う');
    ctx.apiPrefSet('cowork.enabled', true);
    expect(ctx.achUnavailable_(ME)['first-cowork']).toBeUndefined();
    view(ctx, 'cowork');
    // チームの設定は自分の設定ではない (自分の設定を変えた にはならない)
    expect(newly(ctx)).toEqual(['first-cowork']);
  });

  it('自分のキャラを作った は台帳 (oshi) から、キャラ作成キットで取り込んだ は取り込めたあとの使われ方から', () => {
    const { ctx } = setup();
    ctx.apiOshiCharCreate('ルナ', 'polite');
    expect(newly(ctx)).toEqual(['first-mychar']);
    usage(ctx, 'charkit-import');
    expect(newly(ctx)).toEqual(['first-charkit']);
  });

  it('推しの機嫌をオンにした は自分の設定から (機嫌が直ったかでは決めない。機嫌は実績を動かさない)', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('oshi.mood', true);
    expect(newly(ctx)).toEqual(['first-mood', 'first-settings']);
  });

  it('作業部屋は自分の設定「作業部屋を使う」、なでるは「推しに応援してもらう」で取り方の手がかりを出す (取れないことにはしない)', () => {
    const { ctx } = setup();
    const tips = ctx.achPersonalTips_(ME);
    for (const k of ['first-room', 'first-roomSound', 'rooms-10', 'rooms-50']) expect(tips[k], k).toContain('作業部屋を使う');
    expect(tips['first-pat']).toBeUndefined();
    ctx.apiPrefSet('room.on', true);
    ctx.apiPrefSet('oshi.on', false);
    const tips2 = ctx.achPersonalTips_(ME);
    expect(tips2['first-room']).toBeUndefined();
    for (const k of ['first-pat', 'pats-10', 'pats-50', 'first-mood']) expect(tips2[k], k).toContain('推しに応援してもらう');
    for (const k of ['first-room', 'first-pat', 'pats-10']) expect(ctx.achUnavailable_(ME)[k], k).toBeUndefined();
  });
});

describe('使われ方を記録しないチーム', () => {
  it('使われ方の場所だけで数える実績は取れない。台帳や設定でも数えるもの (推しを選ぶ・下書き) は取れる', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('usage.enabled', false);
    const off = ctx.achUnavailable_(ME);
    for (const k of ['first-room', 'first-roomSound', 'first-pat', 'pats-10', 'pats-50', 'rooms-10', 'rooms-50', 'first-board',
      'first-gantt', 'first-docLink', 'first-help', 'first-usageView', 'first-charkit', 'first-markdown', 'first-search']) {
      expect(off[k], k).toContain('使われ方を記録する');
    }
    for (const k of ['first-oshi', 'first-template', 'first-achPage', 'first-settings', 'first-mychar']) expect(off[k], k).toBeUndefined();
  });
});

describe('なつき度との整合', () => {
  it('最高の Lv は 1 + 実績の数。段の Lv はそのまま。キャラ作成キットの項目は Lv 36 までのまま (頼み文のクリアの Lv は今の数)', () => {
    const { ctx } = setup();
    const n = ctx.ACHIEVEMENTS().length;
    expect(ctx.achLevelOf(n)).toBe(1 + n);
    expect(ctx.OSHI_STAGES().map((s) => s.min)).toEqual([1, 5, 15, 25, 35]);
    const levels = ctx.oshiCharKitLevels(1 + n);
    expect(levels[0]).toBe(2);
    expect(levels[levels.length - 1]).toBe(36);
    expect(levels.length).toBe(18);
    const prompt = ctx.apiOshiCharKitPrompt('chatgpt').prompt;
    expect(prompt).toContain('クリア。Lv ' + (1 + n) + ')');
    expect(prompt).toContain('最後の項目 (Lv 36) はクリアより前に分かっている');
  });

  it('実績を全部取るとクリア。取った印は1つのスクリプトプロパティ (9KB まで) に収まる', () => {
    const { ctx } = setup();
    const got = {};
    ctx.ACHIEVEMENTS().forEach((a) => { got[a.key] = '2026-10-21'; });
    ctx.PropertiesService.getScriptProperties().setProperty('ACH:' + ME, JSON.stringify({ days: { n: 365, last: '2026-10-21' }, got }));
    const res = ctx.apiAchievements();
    expect(res.cleared).toBe(true);
    expect(res.level).toBe(1 + ctx.ACHIEVEMENTS().length);
    const raw = ctx.PropertiesService.getScriptProperties().getProperty('ACH:' + ME);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(2600);
  });
});
