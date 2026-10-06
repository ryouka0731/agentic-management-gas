import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

export const SCRUM_SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/Plain.js', 'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Issue.gs',
  'src/core/IssueComment.gs', 'src/core/Project.gs', 'src/core/Mention.js',
  'src/core/Member.gs', 'src/core/Brand.js', 'src/core/Inquiry.gs',
  'src/core/Notifier.gs', 'src/core/Settings.gs', 'src/core/Scrum.gs',
];

/*
 * エージェンティックスクラム (ai-scrum-gas から取り入れたもの)。
 *
 * 使わない人のほうが多いので、既定はオフにしてある。オンにできるのは持ち主
 * だけで、オフのあいだはスクラムの操作をすべて断る。
 */
export function setup(on) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SCRUM_SOURCES);
  ctx.repoInit('agentic-management');
  if (on !== false) ctx.scrumSetEnabled_(true);
  return { ctx, fake };
}

describe('既定はオフ', () => {
  it('何もしなければオフ', () => {
    const { ctx } = setup(false);
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('オフのあいだは、スクラムの操作を断る', () => {
    const { ctx } = setup(false);
    expect(() => ctx.sprintCreate({ name: 'sprint001' })).toThrow(/オフ/);
    expect(() => ctx.impedimentCreate({ title: 'x' })).toThrow(/オフ/);
    expect(() => ctx.sprintList()).toThrow(/オフ/);
  });

  it('オンにすると使え、オフに戻せる', () => {
    const { ctx } = setup(false);
    ctx.scrumSetEnabled_(true);
    expect(ctx.scrumEnabled()).toBe(true);
    expect(ctx.sprintList()).toEqual([]);

    ctx.scrumSetEnabled_(false);
    expect(ctx.scrumEnabled()).toBe(false);
  });

  it('オフに戻しても、書いたものは消さない', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    ctx.scrumSetEnabled_(false);
    ctx.scrumSetEnabled_(true);
    expect(ctx.sprintList().map((s) => s.name)).toEqual(['sprint001']);
  });
});

describe('プロダクトゴールと完了の定義', () => {
  it('書いて読める', () => {
    const { ctx } = setup();
    ctx.scrumSetText_('productGoal', '紙の稟議をなくす');
    ctx.scrumSetText_('definitionOfDone', '- 受入基準を満たす\n- レビュー済み');

    expect(ctx.scrumTexts()).toEqual({
      productGoal: '紙の稟議をなくす',
      definitionOfDone: '- 受入基準を満たす\n- レビュー済み',
    });
  });

  it('知らない種類と長すぎるものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.scrumSetText_('other', 'x')).toThrow(/知らない/);
    // スクリプトプロパティは1つ9KBまで。字数ではなくバイトで見る (日本語は1字3バイト)
    expect(() => ctx.scrumSetText_('productGoal', 'あ'.repeat(3000))).toThrow(/長すぎ/);
    expect(ctx.scrumSetText_('productGoal', 'あ'.repeat(2600)).productGoal).toHaveLength(2600);
    expect(ctx.scrumSetText_('productGoal', 'a'.repeat(5000)).productGoal).toHaveLength(5000);
  });
});

describe('スプリント', () => {
  it('作って、開始日の順に並ぶ', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint002', startDate: '2026-10-15', endDate: '2026-10-28' });
    ctx.sprintCreate({ name: 'sprint001', goal: '申請の流れを決める',
      startDate: '2026-10-01', endDate: '2026-10-14' });

    expect(ctx.sprintList().map((s) => s.name)).toEqual(['sprint001', 'sprint002']);
    expect(ctx.sprintGet('sprint001').goal).toBe('申請の流れを決める');
  });

  it('同じ名前、空の名前、終わりが始まりより前のものは断る', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    expect(() => ctx.sprintCreate({ name: 'sprint001' })).toThrow(/既に/);
    expect(() => ctx.sprintCreate({ name: '  ' })).toThrow(/名前/);
    expect(() => ctx.sprintCreate({ name: 's2', startDate: '2026-10-10', endDate: '2026-10-01' }))
      .toThrow(/終わり/);
  });

  it('ゴールや期間を直せる', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    ctx.sprintUpdate('sprint001', { goal: '承認の流れを作る', endDate: '2026-10-14' });

    expect(ctx.sprintGet('sprint001').goal).toBe('承認の流れを作る');
  });
});

describe('やることを PBI として扱う', () => {
  it('スプリント・ポイント・受入基準を入れられる', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 'sprint001' });
    const made = ctx.issueCreate('申請画面を作る', '', []);

    ctx.issueUpdate(made.number, { sprint: 'sprint001', points: 3, acceptance: '申請できる' });

    const row = ctx.issueGet(made.number);
    expect(row.sprint).toBe('sprint001');
    expect(Number(row.points)).toBe(3);
    expect(row.acceptance).toBe('申請できる');
  });

  it('無いスプリントと、数でないポイントは断る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('x', '', []);

    expect(() => ctx.issueUpdate(made.number, { sprint: 'nai' })).toThrow(/スプリント/);
    expect(() => ctx.issueUpdate(made.number, { points: -1 })).toThrow(/ポイント/);
    expect(() => ctx.issueUpdate(made.number, { points: 'たくさん' })).toThrow(/ポイント/);
  });

  it('オフのあいだは、スクラムの欄を直させない', () => {
    const { ctx } = setup(false);
    const made = ctx.issueCreate('x', '', []);
    expect(() => ctx.issueUpdate(made.number, { points: 3 })).toThrow(/オフ/);
    // ほかの欄はこれまでどおり直せる
    expect(ctx.issueUpdate(made.number, { title: 'y' }).title).toBe('y');
  });
});

describe('障害物', () => {
  it('記録すると番号が付き、未解決として並ぶ', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: '承認者が決まらない', body: '部長が不在' });

    expect(a.number).toBe(1);
    expect(a.state).toBe('open');
    expect(a.reportedBy).toBe('tester@example.com');
    expect(ctx.impedimentList().map((i) => i.number)).toEqual([1]);
  });

  it('題名が無いものは断る', () => {
    const { ctx } = setup();
    expect(() => ctx.impedimentCreate({ title: '' })).toThrow(/題名/);
  });

  it('直せる', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    ctx.impedimentUpdate(a.number, { title: '承認者が決まらない', body: '詳しく' });

    expect(ctx.impedimentGet(a.number).title).toBe('承認者が決まらない');
  });

  it('解決策を書いて解決し、取り消せる', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });

    expect(() => ctx.impedimentResolve(a.number, '')).toThrow(/解決策/);
    ctx.impedimentResolve(a.number, '課長が代わりに承認する');
    expect(ctx.impedimentGet(a.number).state).toBe('resolved');
    expect(ctx.impedimentGet(a.number).resolution).toBe('課長が代わりに承認する');

    ctx.impedimentReopen(a.number);
    expect(ctx.impedimentGet(a.number).state).toBe('open');
  });

  it('やりとりを書ける', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    ctx.impedimentCommentAdd(a.number, '来週には戻ります');

    expect(ctx.impedimentComments(a.number).map((c) => c.body)).toEqual(['来週には戻ります']);
  });
});

describe('変更の履歴', () => {
  /*
   * ai-scrum-gas では、画面からの変更を change_log に残し、項目ごとに前と後を
   * 見せていた。誰がいつ何を変えたかが分からないと、変わった理由を辿れない。
   */
  it('やることの欄を直すと、前と後が残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('はじめの題', '', []);
    ctx.issueUpdate(made.number, { title: '直した題', points: 5 });

    const log = ctx.historyOf_('issue:' + made.number);
    const title = log.find((h) => h.field === 'title');
    expect(title.before).toBe('はじめの題');
    expect(title.after).toBe('直した題');
    expect(title.actor).toBe('tester@example.com');
    expect(log.find((h) => h.field === 'points').after).toBe('5');
  });

  it('変わらなかった欄は残さない', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    ctx.issueUpdate(made.number, { title: '題' });

    expect(ctx.historyOf_('issue:' + made.number).filter((h) => h.field === 'title')).toEqual([]);
  });

  it('完了・差し戻し・作成も残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    ctx.issueClose(made.number, null);
    ctx.issueReopen(made.number);

    const actions = ctx.historyOf_('issue:' + made.number).map((h) => h.action);
    expect(actions).toContain('create');
    expect(actions).toContain('close');
    expect(actions).toContain('reopen');
  });

  it('障害物の解決も残る', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    ctx.impedimentResolve(a.number, '片付いた');

    expect(ctx.historyOf_('impediment:' + a.number).map((h) => h.action)).toContain('resolve');
  });

  it('新しい順に並ぶ', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('a', '', []);
    ctx.issueUpdate(made.number, { title: 'b' });
    ctx.issueUpdate(made.number, { title: 'c' });

    const titles = ctx.historyOf_('issue:' + made.number)
      .filter((h) => h.field === 'title').map((h) => h.after);
    expect(titles).toEqual(['c', 'b']);
  });
});

describe('見直しで見つけたもの', () => {
  it('同じ日付で直しても、日付の履歴は増えない', () => {
    // 台帳の日付は Date で返る。字の 'YYYY-MM-DD' とそのまま比べると、毎回
    // 「変わった」と残り、前の値も前日の15時Zで出ていた
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    ctx.issueUpdate(made.number, { dueDate: '2026-10-07', startDate: '2026-10-01' });
    ctx.issueUpdate(made.number, { dueDate: '2026-10-07', startDate: '2026-10-01' });

    const days = ctx.historyOf_('issue:' + made.number).filter((h) => /Date$/.test(h.field));
    expect(days.map((h) => [h.field, h.before, h.after]).sort()).toEqual([
      ['dueDate', '', '2026-10-07'], ['startDate', '', '2026-10-01'],
    ]);
  });

  it('スプリントの期間を変えたときの履歴も日付で残す', () => {
    const { ctx } = setup();
    ctx.sprintCreate({ name: 's1', startDate: '2026-10-01', endDate: '2026-10-14' });
    ctx.sprintUpdate('s1', { startDate: '2026-10-01', endDate: '2026-10-15' });

    const log = ctx.historyOf_('sprint:s1').filter((h) => h.action === 'update');
    expect(log.map((h) => [h.field, h.before, h.after])).toEqual([['endDate', '2026-10-14', '2026-10-15']]);
  });

  it('暦に無い日付のスプリントは作らせない', () => {
    // 作れてしまうと、そのあとスプリントのタブがずっと開けなくなる
    const { ctx } = setup();
    expect(() => ctx.sprintCreate({ name: 's1', startDate: '2026-13-01', endDate: '2026-13-05' }))
      .toThrow(/日付/);
    expect(() => ctx.sprintCreate({ name: 's2', startDate: '2026-02-30' })).toThrow(/日付/);
  });

  it('やることを完全に消すと、その変更の履歴も消える', () => {
    // 残ると、消したはずの題名や補足が履歴から読める
    const { ctx } = setup();
    const made = ctx.issueCreate('消す題', '', []);
    ctx.issueUpdate(made.number, { body: '人に見せたくない中身' });
    ctx.issueArchive(made.number);
    ctx.issuePurge(made.number);

    expect(ctx.historyOf_('issue:' + made.number)).toEqual([]);
  });

  it('直しているあいだに消されたやることには、履歴を書き足さない', () => {
    // 読んだあと・書く前に完全に消された形。書き込みと履歴を1つの鍵の中で
    // 行わないと、消したあとに履歴だけが残り、消した中身が読める
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    const row = ctx.issueGet(made.number);
    ctx.dbDelete('issues', 'number', made.number);
    ctx.issueGet = () => row;

    expect(() => ctx.issueUpdate(made.number, { body: '消したはずの中身' })).toThrow(/見つかりません/);
    expect(ctx.historyOf_('issue:' + made.number).filter((h) => h.field === 'body')).toEqual([]);
  });

  it('壊れた字 (対になっていないサロゲート) でも、理由の分かる形で断るか保存する', () => {
    const { ctx } = setup();
    // encodeURIComponent は投げる。投げると「保存できませんでした」としか出ない
    expect(ctx.scrumSetText_('productGoal', 'ゴール\uD800').productGoal).toBe('ゴール\uD800');
  });

  it('変わった欄がいくつあっても、履歴の表を読むのは1回にする', () => {
    // 1行ごとに番号を採ると、そのたびに表を丸ごと読む。履歴の表は増える一方
    // なので、保存がだんだん重くなる
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    const original = ctx.dbReadAll;
    let reads = 0;
    ctx.dbReadAll = (table) => { if (table === 'change_log') reads++; return original(table); };
    ctx.issueUpdate(made.number, { title: '題2', body: '中身', points: 3, acceptance: '基準' });
    ctx.dbReadAll = original;

    expect(reads).toBe(1);
    const ids = ctx.historyOf_('issue:' + made.number).map((h) => Number(h.id));
    expect(new Set(ids).size).toBe(ids.length);
    // 次に残す行は、まとめて出した番号の続きになる
    ctx.issueUpdate(made.number, { title: '題3' });
    const next = ctx.historyOf_('issue:' + made.number)[0];
    expect(Number(next.id)).toBe(Math.max(...ids) + 1);
  });

  it('障害物の解決は、状態を確かめてから書くまでを鍵の中で行う', () => {
    const { ctx } = setup();
    const a = ctx.impedimentCreate({ title: 'x' });
    let depth = 0;
    const lock = ctx.dbWithLock_;
    ctx.dbWithLock_ = (ms, fn) => lock(ms, () => { depth++; try { return fn(); } finally { depth--; } });
    const get = ctx.impedimentGet;
    const seen = [];
    ctx.impedimentGet = (n) => { seen.push(depth); return get(n); };
    ctx.impedimentResolve(a.number, '片付いた');
    ctx.impedimentReopen(a.number);

    // 最初に読むところ (状態の確かめ) が鍵の中にある
    expect(seen[0]).toBeGreaterThan(0);
  });

  it('オフにされたあとも、開いたままの画面からの保存を止めない', () => {
    // オンのときに開いた画面は、変えていないスクラムの欄も一緒に送ってくる。
    // それまで断ると、読み込み直すまで誰もやることを直せなくなる
    const { ctx } = setup();
    ctx.sprintCreate({ name: 's1' });
    const made = ctx.issueCreate('題', '', []);
    ctx.issueUpdate(made.number, { sprint: 's1', points: 3 });
    ctx.scrumSetEnabled_(false);

    const after = ctx.issueUpdate(made.number, { title: '直した', sprint: 's1', points: '3', acceptance: '' });
    expect(after.title).toBe('直した');
    // 実際に変えようとしたら、これまでどおり断る
    expect(() => ctx.issueUpdate(made.number, { points: 5 })).toThrow(/オフ/);
  });

  it('設定を書き換える関数は、画面から直に呼べない名前にする', () => {
    // 末尾が _ でない関数は google.script.run から誰でも呼べる。持ち主かを
    // 確かめているのは api 側だけなので、素の関数は隠す
    const { ctx } = setup();
    expect(ctx.scrumSetEnabled).toBeUndefined();
    expect(ctx.scrumSetText).toBeUndefined();
    expect(ctx.historyOf).toBeUndefined();
  });
});

describe('ai-scrum-gas とそろえた規則', () => {
  /*
   * ai-scrum-gas (fix/bughunt2) で決めた規則を、こちらでも同じにする。
   */
  it('履歴の前と後は4000字まで。超えたら省いたことと全体の字数を添える', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('題', '', []);
    const long = '😀'.repeat(4100);
    ctx.issueUpdate(made.number, { body: long });

    const after = ctx.historyOf_('issue:' + made.number).find((h) => h.field === 'body').after;
    expect(Array.from(after).slice(0, 4000).join('')).toBe('😀'.repeat(4000));
    expect(after).toContain('…（以下省略・全 4100 字）');
  });

  it('全体を全角の（…）だけで囲んだ障害物の題名は、ひな形の行として断る', () => {
    const { ctx } = setup();
    expect(() => ctx.impedimentCreate({ title: '（障害物タイトル）' })).toThrow(/ひな形/);
    const a = ctx.impedimentCreate({ title: '承認者（部長）が不在' });
    expect(() => ctx.impedimentUpdate(a.number, { title: '（なにか）' })).toThrow(/ひな形/);
  });
});
