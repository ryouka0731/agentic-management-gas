import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 改善のヒント (#14)。本人のデータとチームの合計だけから、決まった規則で多くて3件。
 * 規則の言葉と閾値は ADVICE_RULES() が唯一の定義。境目は ADVICE_RULES() から読む
 * (テストに数を写すと、閾値を変えたときにテストだけ古いまま通る)。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]);
})();

const ME = 'tester@example.com';
const OTHER = 'b@example.com';
const NOW = new Date('2026-10-14T03:00:00Z'); // 水曜 (東京 12:00)

function setup(opts) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  // 管理者かどうかは Drive に聞く。ここでは差し替えて決める
  ctx.repoIsAdmin_ = () => !!(opts && opts.admin);
  return { ctx, fake };
}

function rule(ctx, id) {
  return ctx.ADVICE_RULES().filter((r) => r.id === id)[0];
}

function ids(list) {
  return list.map((a) => a.id);
}

/** やることを作り、欄を直す */
function issue(ctx, patch) {
  const n = ctx.issueCreate((patch && patch.title) || 'やること', '', []).number;
  const p = Object.assign({}, patch || {});
  delete p.title;
  if (Object.keys(p).length) ctx.dbUpdate('issues', 'number', n, p);
  return n;
}

describe('規則の定義', () => {
  it('ADVICE_RULES が id・重み・閾値・言葉・ボタンを持ち、id は重ならない', () => {
    const { ctx } = setup();
    const rules = ctx.ADVICE_RULES();
    expect(ids(rules).sort()).toEqual(['estimate', 'overdue', 'questions', 'repeat', 'reviews', 'wip']);
    rules.forEach((r) => {
      expect(typeof r.weight).toBe('number');
      expect(typeof r.min).toBe('number');
      expect(r.title).toBeTruthy();
      expect(r.why).toBeTruthy();
      expect(r.tip).toBeTruthy();
      expect(r.action.kind).toBeTruthy();
      expect(r.action.label).toBeTruthy();
    });
  });

  it('何も当たらなければ空', () => {
    const { ctx } = setup();
    expect(ctx.homeAdvice_(ME, NOW)).toEqual([]);
  });
});

describe('期限切れが溜まっている', () => {
  function late(ctx, n, patch) {
    for (let k = 0; k < n; k++) {
      issue(ctx, Object.assign({ assignee: ME, dueDate: new Date('2026-10-10T15:00:00Z') }, patch || {}));
    }
  }

  it('期限切れの担当が閾値ちょうどで当たり、1件少ないと当たらない', () => {
    const { ctx } = setup();
    const min = rule(ctx, 'overdue').min;
    late(ctx, min - 1);
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('overdue');
    late(ctx, 1);
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'overdue')[0];
    expect(a.why).toContain(String(min));
    expect(a.action.kind).toBe('issues-overdue');
  });

  it('今日が期限のもの・済み・捨てた・他人の担当は数えない', () => {
    const { ctx } = setup();
    const min = rule(ctx, 'overdue').min;
    late(ctx, min - 1);
    issue(ctx, { assignee: ME, dueDate: new Date('2026-10-13T15:00:00Z') }); // 東京 10/14 = 今日
    late(ctx, 1, { archivedAt: new Date() });
    late(ctx, 3, { assignee: OTHER });
    const done = issue(ctx, { assignee: ME, dueDate: new Date('2026-10-10T15:00:00Z') });
    ctx.issueClose(done, null);
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('overdue');
  });

  it('期限が字で入っていても読む (台帳は Date でも字でも返す)', () => {
    const { ctx } = setup();
    const min = rule(ctx, 'overdue').min;
    late(ctx, min, { dueDate: '2026-10-01' });
    expect(ids(ctx.homeAdvice_(ME, NOW))).toContain('overdue');
  });
});

describe('抱えすぎ', () => {
  function working(ctx, n, who) {
    for (let k = 0; k < n; k++) {
      const num = issue(ctx, { assignee: who || ME });
      ctx.projectPlace(num, 'In Progress');
    }
  }

  it('作業中の担当が閾値ちょうどで当たり、1件少ないと当たらない。ほかの列と他人は数えない', () => {
    const { ctx } = setup();
    const min = rule(ctx, 'wip').min;
    working(ctx, min - 1);
    working(ctx, 3, OTHER);
    ctx.projectPlace(issue(ctx, { assignee: ME }), 'Backlog');
    ctx.projectPlace(issue(ctx, { assignee: ME }), 'In Review');
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('wip');
    working(ctx, 1);
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'wip')[0];
    expect(a.why).toContain(String(min));
    expect(a.action.kind).toBe('board');
  });
});

describe('確認を待たせている', () => {
  function pr(ctx, number, created, patch) {
    ctx.dbAppend('pulls', Object.assign({ number, title: '依頼' + number, state: 'open',
      author: OTHER, reviewers: ME, createdAt: created }, patch || {}));
  }

  it('自分宛ての確認が閾値の日数そのままで当たり、1日足りないと当たらない', () => {
    const { ctx } = setup();
    const days = rule(ctx, 'reviews').days;
    // 東京の暦日で数える。NOW は 10/14
    const at = (n) => new Date(Date.UTC(2026, 9, 14 - n, 1));
    pr(ctx, 1, at(days - 1));
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('reviews');
    pr(ctx, 2, at(days));
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'reviews')[0];
    expect(a.action).toMatchObject({ kind: 'pulls', arg: '2' });
  });

  it('返した依頼・他人宛て・閉じた依頼は数えない', () => {
    const { ctx } = setup();
    const old = new Date('2026-09-01T01:00:00Z');
    pr(ctx, 1, old);
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: ME, state: 'approve', at: new Date(), id: 1 });
    pr(ctx, 2, old, { reviewers: 'c@example.com' });
    pr(ctx, 3, old, { state: 'merged' });
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('reviews');
  });
});

describe('同じ作業の繰り返し', () => {
  function made(ctx, n, patch, daysAgo) {
    for (let k = 0; k < n; k++) {
      issue(ctx, Object.assign({ createdAt: new Date(NOW.getTime() - (daysAgo || 1) * 86400000) }, patch || {}));
    }
  }

  it('同じタグを閾値ちょうど作ると当たり、1件少ないと当たらない。ボタンはそのタグで絞る', () => {
    const { ctx } = setup();
    const min = rule(ctx, 'repeat').min;
    made(ctx, min - 1, { labels: '月次' });
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('repeat');
    made(ctx, 1, { labels: '月次,総務' });
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'repeat')[0];
    expect(a.action).toMatchObject({ kind: 'issues-filter', arg: '月次' });
    expect(a.why).toContain('月次');
  });

  it('題名の先頭の語が同じでも当たる', () => {
    const { ctx } = setup();
    const min = rule(ctx, 'repeat').min;
    for (let k = 0; k < min; k++) made(ctx, 1, { title: '経費精算 ' + (k + 1) + '月分' });
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'repeat')[0];
    expect(a.action.arg).toBe('経費精算');
  });

  it('期間より前に作ったもの・他人が作って他人が担当のものは数えない', () => {
    const { ctx, fake } = setup();
    const r = rule(ctx, 'repeat');
    made(ctx, r.min - 1, { labels: '月次' });
    made(ctx, 1, { labels: '月次' }, r.days + 1);
    fake._setUser(OTHER);
    made(ctx, 3, { labels: '月次', assignee: OTHER });
    fake._setUser(ME);
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('repeat');
  });

  it('他人が作っても自分が担当なら数える', () => {
    const { ctx, fake } = setup();
    const min = rule(ctx, 'repeat').min;
    fake._setUser(OTHER);
    made(ctx, min, { labels: '月次', assignee: ME });
    fake._setUser(ME);
    expect(ids(ctx.homeAdvice_(ME, NOW))).toContain('repeat');
  });
});

describe('見積もりと実際のずれ', () => {
  /** 片づけた担当。予定 planned 人日、開始から閉じるまで days 日 (両端を含む) */
  function finished(ctx, planned, days, patch) {
    const closedAt = new Date('2026-10-13T03:00:00Z'); // 東京 10/13
    const start = new Date(Date.UTC(2026, 9, 13 - (days - 1)));
    const n = issue(ctx, Object.assign({ assignee: ME, plannedHours: planned, startDate: start }, patch || {}));
    ctx.issueClose(n, null);
    ctx.dbUpdate('issues', 'number', n, { closedAt });
    return n;
  }

  it('工数を書いたもののちょうど半分が倍以上かかると当たる。半分に届かなければ当たらない', () => {
    const { ctx } = setup();
    const r = rule(ctx, 'estimate');
    expect(r.share).toBe(0.5);
    // 4件中 1件だけ倍以上: 当たらない
    finished(ctx, 2, 4);
    finished(ctx, 2, 3);
    finished(ctx, 2, 2);
    finished(ctx, 2, 1);
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('estimate');
    // 4件中 2件 (ちょうど半分) 倍以上: 当たる
    ctx.dbUpdate('issues', 'number', 2, { startDate: new Date(Date.UTC(2026, 9, 10)) }); // 4日
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'estimate')[0];
    expect(a.action.kind).toBe('gantt');
    expect(a.why).toContain('4');
    expect(a.why).toContain('2');
  });

  it('倍に1日足りなければ数えない。数えた件数が少なすぎると出さない', () => {
    const { ctx } = setup();
    const r = rule(ctx, 'estimate');
    // 予定2日 → 3日かかった (倍に届かない)
    for (let k = 0; k < r.sample; k++) finished(ctx, 2, 3);
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('estimate');

    const b = setup().ctx;
    for (let k = 0; k < r.sample - 1; k++) finished(b, 1, 5);
    expect(ids(b.homeAdvice_(ME, NOW))).not.toContain('estimate');
    finished(b, 1, 5);
    expect(ids(b.homeAdvice_(ME, NOW))).toContain('estimate');
  });

  it('工数・開始日の無いもの、他人の担当、期間より前に閉じたものは数えない', () => {
    const { ctx } = setup();
    const r = rule(ctx, 'estimate');
    for (let k = 0; k < r.sample; k++) {
      finished(ctx, '', 9);
      finished(ctx, 1, 9, { startDate: '' });
      finished(ctx, 1, 9, { assignee: OTHER });
    }
    for (let k = 0; k < r.sample; k++) {
      const n = finished(ctx, 1, 9);
      ctx.dbUpdate('issues', 'number', n, { closedAt: new Date('2026-08-01T03:00:00Z'),
        startDate: new Date('2026-07-20T00:00:00Z') });
    }
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('estimate');
  });
});

describe('使い方の問い合わせ (管理者のみ)', () => {
  let seq = 100;
  function asked(ctx, n, kind, at) {
    for (let k = 0; k < n; k++) {
      ctx.dbAppend('inquiries', { number: seq++, kind: kind || 'question', body: 'x', by: OTHER,
        at: at || new Date('2026-10-10T01:00:00Z'), state: 'open' });
    }
  }

  it('管理者なら閾値ちょうどで当たり、1件少ないと当たらない。ほかの種類と期間外は数えない', () => {
    const { ctx } = setup({ admin: true });
    const min = rule(ctx, 'questions').min;
    asked(ctx, min - 1);
    asked(ctx, 3, 'bug');
    asked(ctx, 3, 'question', new Date('2026-08-01T01:00:00Z'));
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('questions');
    asked(ctx, 1);
    const a = ctx.homeAdvice_(ME, NOW).filter((x) => x.id === 'questions')[0];
    expect(a.action.kind).toBe('report');
    expect(a.why).toContain(String(min));
  });

  it('管理者でなければ出さない', () => {
    const { ctx } = setup({ admin: false });
    asked(ctx, 10);
    expect(ids(ctx.homeAdvice_(ME, NOW))).not.toContain('questions');
  });
});

describe('並びと形', () => {
  /** 全部の規則を当てる */
  function everything(ctx) {
    for (let k = 0; k < 5; k++) {
      const n = issue(ctx, { assignee: ME, dueDate: new Date('2026-10-01T00:00:00Z'), labels: '月次',
        createdAt: new Date('2026-10-10T01:00:00Z') });
      ctx.projectPlace(n, 'In Progress');
    }
    ctx.dbAppend('pulls', { number: 1, title: '依頼', state: 'open', author: OTHER, reviewers: ME,
      createdAt: new Date('2026-10-01T01:00:00Z') });
    for (let k = 0; k < 5; k++) {
      ctx.dbAppend('inquiries', { number: k + 1, kind: 'question', body: 'x', by: OTHER,
        at: new Date('2026-10-10T01:00:00Z'), state: 'open' });
    }
  }

  it('重みの重い順に3件まで', () => {
    const { ctx } = setup({ admin: true });
    everything(ctx);
    const out = ctx.homeAdvice_(ME, NOW);
    expect(out).toHaveLength(ctx.ADVICE_MAX());
    expect(ctx.ADVICE_MAX()).toBe(3);
    const weights = out.map((a) => a.weight);
    expect(weights).toEqual(weights.slice().sort((x, y) => y - x));
    // 当たった中から重いものが選ばれている
    const all = ctx.ADVICE_RULES().filter((r) => ['overdue', 'wip', 'reviews', 'repeat', 'questions'].indexOf(r.id) >= 0)
      .map((r) => r.weight).sort((x, y) => y - x).slice(0, 3);
    expect(weights).toEqual(all);
  });

  it('並びは当てる順ではなく重みで決まる (重みを入れ替えると並びも入れ替わる)', () => {
    const { ctx } = setup({ admin: true });
    everything(ctx);
    const base = ctx.ADVICE_RULES();
    ctx.ADVICE_RULES = () => base.map((r) => Object.assign({}, r, { weight: r.id === 'questions' ? 999 : r.weight }));
    expect(ctx.homeAdvice_(ME, NOW)[0].id).toBe('questions');
  });

  it('返す形に名前・アドレスが無い', () => {
    const { ctx } = setup({ admin: true });
    everything(ctx);
    const out = ctx.homeAdvice_(ME, NOW);
    expect(JSON.stringify(out)).not.toMatch(/@/);
    out.forEach((a) => expect(Object.keys(a).sort()).toEqual(['action', 'id', 'tip', 'title', 'weight', 'why']));
  });

  it('アドレスを受ける関数は画面から直に呼べない。API は本人のぶんだけ返し、Date を含まない', () => {
    const { ctx } = setup({ admin: true });
    expect(ctx.homeAdvice).toBeUndefined();
    everything(ctx);
    const out = ctx.apiHomeSummary();
    expect(out.advice.length).toBeGreaterThan(0);
    expect(JSON.stringify(out.advice)).not.toMatch(/@/);
    out.advice.forEach((a) => {
      expect(typeof a.why).toBe('string');
      expect(typeof a.action.arg).toBe('string');
    });
  });

  it('助言で落ちても、ホームのほかの区画は返す', () => {
    const { ctx } = setup();
    ctx.homeAdvice_ = () => { throw new Error('壊れた'); };
    const out = ctx.apiHomeSummary();
    expect(out.advice).toEqual([]);
    expect(out.myTurn).toBeTruthy();
  });
});
