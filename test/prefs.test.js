import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 設定の一覧 (#18)。変えられる項目は PREFS_SCHEMA() が唯一の定義。
 * 設計: docs/superpowers/specs/2026-10-20-guide-usage-settings-design.md の 1。
 */
const SOURCES = APP_SOURCES;

const ME = 'tester@example.com';
const OTHER = 'b@example.com';
const NOW = new Date('2026-10-14T03:00:00Z');

function setup(opts) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  const admin = !(opts && opts.admin === false);
  ctx.repoIsAdmin_ = (who) => admin && String(who) === ME;
  return { ctx, fake };
}

function item(ctx, key) {
  return ctx.PREFS_SCHEMA().filter((p) => p.key === key)[0];
}

function unserializable(value, path) {
  if (value === null || value === undefined) return [];
  if (Object.prototype.toString.call(value) === '[object Date]') return [path + ' が Date のまま'];
  if (Array.isArray(value)) return value.flatMap((v, i) => unserializable(v, path + '[' + i + ']'));
  if (typeof value === 'object') {
    return Object.keys(value).flatMap((k) => unserializable(value[k], path + '.' + k));
  }
  if (typeof value === 'function') return [path + ' が関数'];
  return [];
}

describe('一覧', () => {
  it('どの項目も key・scope・type・label・def を持ち、key は重ならない', () => {
    const { ctx } = setup();
    const all = ctx.PREFS_SCHEMA();
    const keys = all.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    all.forEach((p) => {
      expect(['team', 'me']).toContain(p.scope);
      expect(['int', 'bool', 'enum', 'steps', 'char']).toContain(p.type);
      expect(p.label).toBeTruthy();
      // 既定値はそれ自身の検査を通る (通らないと未設定のときに今の動きが崩れる)
      expect(ctx.prefValid_(p, p.def)).toBe(true);
    });
  });

  it('既定値は今の定義から取る (写さない)', () => {
    const { ctx } = setup();
    const rules = ctx.ADVICE_RULES();
    const reviews = rules.filter((r) => r.id === 'reviews')[0];
    expect(item(ctx, 'advice.reviews.min').def).toBe(reviews.min);
    expect(item(ctx, 'advice.reviews.days').def).toBe(reviews.days);
    expect(item(ctx, 'advice.wip.limit').def).toBe(3);
    expect(item(ctx, 'stale.steps').def).toEqual(ctx.STALE_STEPS());
    expect(item(ctx, 'home.dueDays').def).toBe(ctx.HOME_DUE_DAYS());
    expect(item(ctx, 'usage.keepDays').def).toBe(ctx.USAGE_KEEP_DAYS());
    expect(item(ctx, 'report.defaultKind').options.map((o) => o.value))
      .toEqual(ctx.REPORT_TEMPLATES().map((t) => t.key));
  });

  it('改善のヒントの数は tunable に書いたものだけが出る', () => {
    const { ctx } = setup();
    ctx.ADVICE_RULES().forEach((r) => {
      expect(Array.isArray(r.tunable)).toBe(true);
      expect(item(ctx, 'advice.' + r.id + '.on')).toBeTruthy();
      r.tunable.forEach((k) => expect(item(ctx, 'advice.' + r.id + '.' + k)).toBeTruthy());
    });
    // overdue は日数を持たない
    expect(item(ctx, 'advice.overdue.days')).toBeUndefined();
  });

  it('通知の種類は NOTIFY_KINDS ごとに1つずつ、自分の設定にある', () => {
    const { ctx } = setup();
    const kinds = ctx.NOTIFY_KINDS().map((k) => k.key);
    expect(kinds).toEqual(['review', 'result', 'inquiry', 'mention', 'comment', 'goal']);
    kinds.forEach((k) => expect(item(ctx, 'notify.' + k).scope).toBe('me'));
  });

  it('最初の画面の選択肢は、スクラムがオフならスプリントと障害物を除く', () => {
    const { ctx } = setup();
    const off = item(ctx, 'start.tab').options.map((o) => o.value);
    expect(off).toContain('issues');
    expect(off).not.toContain('sprint');
    ctx.scrumSetEnabled_(true);
    expect(item(ctx, 'start.tab').options.map((o) => o.value)).toContain('sprint');
  });
});

describe('検査', () => {
  it('型と範囲の外は通さない', () => {
    const { ctx } = setup();
    const due = item(ctx, 'home.dueDays');
    expect(ctx.prefValid_(due, 5)).toBe(true);
    expect(ctx.prefValid_(due, 0)).toBe(false);
    expect(ctx.prefValid_(due, 15)).toBe(false);
    expect(ctx.prefValid_(due, 2.5)).toBe(false);
    expect(ctx.prefValid_(due, '5')).toBe(false);
    const on = item(ctx, 'usage.enabled');
    expect(ctx.prefValid_(on, false)).toBe(true);
    expect(ctx.prefValid_(on, 'false')).toBe(false);
    const steps = item(ctx, 'stale.steps');
    expect(ctx.prefValid_(steps, [3, 10, 60])).toBe(true);
    expect(ctx.prefValid_(steps, [10, 3, 60])).toBe(false);
    expect(ctx.prefValid_(steps, [3, 3, 60])).toBe(false);
    expect(ctx.prefValid_(steps, [3, 10])).toBe(false);
    expect(ctx.prefValid_(steps, [3, 10, 181])).toBe(false);
    const kind = item(ctx, 'report.defaultKind');
    expect(ctx.prefValid_(kind, 'today')).toBe(true);
    expect(ctx.prefValid_(kind, 'custom')).toBe(false);
  });

  it('保持日数は90日を下回れない (画面で90日を選べる)', () => {
    const { ctx } = setup();
    expect(ctx.prefValid_(item(ctx, 'usage.keepDays'), 89)).toBe(false);
    expect(ctx.prefValid_(item(ctx, 'usage.keepDays'), 90)).toBe(true);
  });
});

describe('読み書き', () => {
  it('未設定なら既定値のまま', () => {
    const { ctx } = setup();
    expect(ctx.prefGet_('home.dueDays')).toBe(3);
    expect(ctx.prefGet_('notify.review', ME)).toBe(true);
  });

  it('チームの設定は PREF:<key> に、自分の設定は MYPREF:<小文字のアドレス> に置く', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('home.dueDays', 7);
    expect(fake.PropertiesService.getScriptProperties().getProperty('PREF:home.dueDays')).toBe('7');
    fake._setUser('Tester@Example.com');
    ctx.apiPrefSet('notify.review', false);
    const raw = fake.PropertiesService.getScriptProperties().getProperty('MYPREF:tester@example.com');
    expect(JSON.parse(raw)).toEqual({ 'notify.review': false });
    expect(ctx.prefGet_('home.dueDays')).toBe(7);
    expect(ctx.prefGet_('notify.review', ME)).toBe(false);
    // UserProperties には置かない (通知とキューは受け取る人のぶんを読めない)
    expect(fake.PropertiesService.getUserProperties().getProperty('MYPREF:tester@example.com')).toBe(null);
  });

  it('自分の設定は人ごとに分かれる', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('start.tab', 'issues');
    fake._setUser(OTHER);
    expect(ctx.prefGet_('start.tab', OTHER)).toBe('home');
    expect(ctx.prefGet_('start.tab', ME)).toBe('issues');
  });

  it('検査を通らない値は投げ、何も書かない', () => {
    const { ctx, fake } = setup();
    expect(() => ctx.apiPrefSet('home.dueDays', 99)).toThrow();
    expect(() => ctx.apiPrefSet('no.such', 1)).toThrow();
    expect(fake.PropertiesService.getScriptProperties().getProperty('PREF:home.dueDays')).toBe(null);
  });

  it('チームの設定は管理者でなければ断る。自分の設定は誰でも変えられる', () => {
    const { ctx } = setup({ admin: false });
    expect(() => ctx.apiPrefSet('home.dueDays', 5)).toThrow(/管理者/);
    expect(() => ctx.apiPrefSet('start.tab', 'issues')).not.toThrow();
  });

  it('null で既定に戻す', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('home.dueDays', 5);
    ctx.apiPrefSet('usage.self', false);
    ctx.apiPrefSet('home.dueDays', null);
    ctx.apiPrefSet('usage.self', null);
    expect(ctx.prefGet_('home.dueDays')).toBe(3);
    expect(ctx.prefGet_('usage.self', ME)).toBe(true);
    expect(fake.PropertiesService.getScriptProperties().getProperty('PREF:home.dueDays')).toBe(null);
  });

  it('人が台帳の外で書き換えた読めない値は既定に倒す', () => {
    const { ctx, fake } = setup();
    const props = fake.PropertiesService.getScriptProperties();
    props.setProperty('PREF:home.dueDays', '{壊れた');
    props.setProperty('PREF:stale.steps', '[30,7,14]');
    props.setProperty('MYPREF:tester@example.com', 'これは JSON ではない');
    expect(ctx.prefGet_('home.dueDays')).toBe(3);
    expect(ctx.prefGet_('stale.steps')).toEqual([7, 14, 30]);
    expect(ctx.prefGet_('notify.review', ME)).toBe(true);
  });

  it('スクラムをオフにしたら、スプリントを最初の画面に選んでいた人はホームに戻る', () => {
    const { ctx } = setup();
    ctx.scrumSetEnabled_(true);
    ctx.apiPrefSet('start.tab', 'sprint');
    expect(ctx.prefGet_('start.tab', ME)).toBe('sprint');
    ctx.scrumSetEnabled_(false);
    expect(ctx.prefGet_('start.tab', ME)).toBe('home');
  });
});

describe('apiPrefs', () => {
  it('一覧・今の値・管理者か・チームの目標を返し、Date も関数も含まない', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('home.dueDays', 6);
    ctx.apiSetTeamGoal(12);
    const out = ctx.apiPrefs({ team: true });
    expect(unserializable(out, 'apiPrefs')).toEqual([]);
    expect(out.canEditTeam).toBe(true);
    expect(out.teamGoal).toBe(12);
    const due = out.items.filter((p) => p.key === 'home.dueDays')[0];
    expect(due.value).toBe(6);
    expect(due.custom).toBe(true);
    const steps = out.items.filter((p) => p.key === 'stale.steps')[0];
    expect(steps.value).toEqual([7, 14, 30]);
    expect(steps.custom).toBe(false);
    expect(out.effective.startTab).toBe('home');
    expect(out.effective.usageOn).toBe(true);
    expect(out.effective.homeCards.advice).toBe(true);
  });

  it('自分の設定は開いた本人のぶんだけを返す', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('start.tab', 'pulls');
    fake._setUser(OTHER);
    const out = ctx.apiPrefs();
    expect(out.effective.startTab).toBe('home');
    expect(out.canEditTeam).toBe(false);
  });

  it('使われ方はチームか本人のどちらかが止めていれば止まっていると返す', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('usage.self', false);
    expect(ctx.apiPrefs().effective.usageOn).toBe(false);
    ctx.apiPrefSet('usage.self', null);
    ctx.apiPrefSet('usage.enabled', false);
    expect(ctx.apiPrefs().effective.usageOn).toBe(false);
  });

  it('止めた通知の種類を返す (確認を頼まれた知らせを止めた人に断りを出すため)', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('notify.review', false);
    expect(ctx.apiPrefs().effective.notifyOff).toEqual(['review']);
  });
});

describe('効く先', () => {
  it('改善のヒントの規則を止めると出ない', () => {
    const { ctx } = setup();
    for (let k = 0; k < 3; k++) {
      const n = ctx.issueCreate('遅れ' + k, '', []).number;
      ctx.dbUpdate('issues', 'number', n, { assignee: ME, dueDate: new Date('2026-10-01T00:00:00Z') });
    }
    expect(ctx.homeAdvice_(ME, NOW).map((a) => a.id)).toContain('overdue');
    ctx.apiPrefSet('advice.overdue.on', false);
    expect(ctx.homeAdvice_(ME, NOW).map((a) => a.id)).not.toContain('overdue');
  });

  it('改善のヒントの閾値を上書きできる', () => {
    const { ctx } = setup();
    for (let k = 0; k < 2; k++) {
      const n = ctx.issueCreate('遅れ' + k, '', []).number;
      ctx.dbUpdate('issues', 'number', n, { assignee: ME, dueDate: new Date('2026-10-01T00:00:00Z') });
    }
    expect(ctx.homeAdvice_(ME, NOW).map((a) => a.id)).not.toContain('overdue');
    ctx.apiPrefSet('advice.overdue.min', 2);
    expect(ctx.homeAdvice_(ME, NOW).map((a) => a.id)).toContain('overdue');
  });

  it('抱えすぎの「何件まで」は助言の文に効く', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('advice.wip.min', 1);
    ctx.apiPrefSet('advice.wip.limit', 2);
    const n = ctx.issueCreate('作業中', '', []).number;
    ctx.dbUpdate('issues', 'number', n, { assignee: ME });
    ctx.projectPlace(n, 'In Progress');
    const wip = ctx.homeAdvice_(ME, NOW).filter((a) => a.id === 'wip')[0];
    expect(wip.tip).toContain('2件まで');
  });

  it('ADVICE_RULES は既定値のまま (上書きは adviceRulesEffective_ だけが返す)', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('advice.reviews.days', 9);
    expect(ctx.ADVICE_RULES().filter((r) => r.id === 'reviews')[0].days).toBe(3);
    expect(ctx.adviceRulesEffective_().filter((r) => r.id === 'reviews')[0].days).toBe(9);
  });

  it('「期限が近い」の日数が、あなたの番に効く', () => {
    const { ctx } = setup();
    const n = ctx.issueCreate('来週', '', []).number;
    // 東京で 10/14 の5日後
    ctx.dbUpdate('issues', 'number', n, { assignee: ME, dueDate: new Date('2026-10-18T15:00:00Z') });
    expect(ctx.homeMyTurn_(ME, NOW).due.total).toBe(0);
    ctx.apiPrefSet('home.dueDays', 5);
    expect(ctx.homeMyTurn_(ME, NOW).due.total).toBe(1);
  });

  it('「動きなし」の段階が、やることの一覧とボードに効く', () => {
    const { ctx } = setup();
    const n = ctx.issueCreate('古い', '', []).number;
    ctx.dbUpdate('issues', 'number', n, { updatedAt: new Date(Date.now() - 4 * 86400000) });
    ctx.projectPlace(n, 'Backlog');
    const level = () => ctx.apiIssueList('').filter((i) => i.number === n)[0].staleLevel;
    const card = () => ctx.apiProjectBoard().Backlog.filter((c) => c.issueNumber === n)[0].staleLevel;
    expect(level()).toBe(0);
    expect(card()).toBe(0);
    ctx.apiPrefSet('stale.steps', [3, 10, 20]);
    expect(level()).toBe(1);
    expect(card()).toBe(1);
  });

  it('自分の形を選んでいない人の日報の形は、チームの既定に従う', () => {
    const { ctx } = setup();
    expect(ctx.reportKind_(ME)).toBe('three');
    ctx.apiPrefSet('report.defaultKind', 'today');
    expect(ctx.reportKind_(ME)).toBe('today');
    ctx.reportSetKind_(ME, 'plain');
    expect(ctx.reportKind_(ME)).toBe('plain');
  });

  it('自分の形を空にしたら、チームの既定の形に戻る', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('report.defaultKind', 'today');
    ctx.reportSetCustom_(ME, '{今日}');
    expect(ctx.reportKind_(ME)).toBe('custom');
    ctx.reportSetCustom_(ME, '');
    expect(ctx.reportKind_(ME)).toBe('today');
  });

  it('ホームで改善のヒントを隠した人には、ヒントを数えない', () => {
    const { ctx } = setup();
    for (let k = 0; k < 3; k++) {
      const n = ctx.issueCreate('遅れ' + k, '', []).number;
      ctx.dbUpdate('issues', 'number', n, { assignee: ME, dueDate: new Date('2020-01-01T00:00:00Z') });
    }
    expect(ctx.apiHomeSummary().advice.length).toBeGreaterThan(0);
    ctx.apiPrefSet('home.cards.advice', false);
    expect(ctx.apiHomeSummary().advice).toEqual([]);
  });
});

describe('使われ方', () => {
  it('チームで止めると記録しない', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('usage.enabled', false);
    expect(ctx.usageRecord([{ kind: 'view', target: 'home', count: 1 }])).toBe(0);
    expect(ctx.dbReadAll('usage').length).toBe(0);
  });

  it('本人が止めると、その人のぶんだけ記録しない', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('usage.self', false);
    expect(ctx.usageRecord([{ kind: 'view', target: 'home', count: 1 }])).toBe(0);
    fake._setUser(OTHER);
    expect(ctx.usageRecord([{ kind: 'view', target: 'home', count: 1 }])).toBe(1);
    expect(ctx.dbReadAll('usage').map((r) => r.user)).toEqual([OTHER]);
  });

  it('残す日数は設定から読む', () => {
    const { ctx } = setup();
    expect(ctx.usageKeepDays_()).toBe(ctx.USAGE_KEEP_DAYS());
    ctx.apiPrefSet('usage.keepDays', 100);
    expect(ctx.usageKeepDays_()).toBe(100);
    const rows = [['2026-01-01', 'view', 'a', 1, ME], ['2026-07-10', 'view', 'a', 1, ME]];
    // 10/14 から100日前より古い行を落とす
    expect(ctx.usageWithinKeep_(rows, '2026-10-14').map((r) => r[0])).toEqual(['2026-07-10']);
  });
});

describe('通知', () => {
  it('止めた種類の通知メールは、その人に送らない', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('notify.review', false);
    ctx.notify(ME, '件名', '本文', 'review');
    ctx.notify(OTHER, '件名', '本文', 'review');
    expect(fake._sentMails().map((m) => m.to)).toEqual([OTHER]);
  });

  it('宛先が並んでいれば、止めた人だけを外す (大文字小文字は見ない)', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('notify.comment', false);
    ctx.notify('Tester@Example.com, ' + OTHER, '件名', '本文', 'comment');
    expect(fake._sentMails().map((m) => m.to)).toEqual([OTHER]);
  });

  it('全員止めていれば送らない', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('notify.result', false);
    ctx.notify(ME, '件名', '本文', 'result');
    expect(fake._sentMails()).toEqual([]);
  });

  it('種類が無い呼び方は今までどおり送る', () => {
    const { ctx, fake } = setup();
    ['review', 'result', 'inquiry', 'mention', 'comment'].forEach((k) => ctx.apiPrefSet('notify.' + k, false));
    ctx.notify(ME, '件名', '本文');
    expect(fake._sentMails().length).toBe(1);
  });

  it('止めても画面の中の知らせは残す', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('notify.review', false);
    ctx.notifyPrReviewRequested({ number: 3, title: '依頼' }, ME);
    expect(fake._sentMails()).toEqual([]);
    expect(ctx.noticeList(ME).length).toBe(1);
  });

  it('知らせの関数はそれぞれ種類を添えて送る', () => {
    const { ctx } = setup();
    const kinds = [];
    ctx.notify = (to, s, b, kind) => { kinds.push(kind); };
    const pr = { number: 1, title: 't', author: OTHER, reviewers: ME };
    ctx.notifyPrCreated(pr);
    ctx.notifyPrReviewRequested(pr, ME);
    ctx.notifyPrMerged(pr);
    ctx.notifyPrClosed(pr, '');
    ctx.notifyInquiryReply({ number: 1, body: 'b' }, { by: OTHER, body: 'r' }, [ME]);
    ctx.notifyInquiryMention({ number: 1, body: 'b' }, { by: OTHER, body: 'r' }, [ME]);
    ctx.notifyPrMention(pr, { reviewer: OTHER, body: 'r' }, ME);
    ctx.notifyIssueComment({ number: 1, title: 't' }, { by: OTHER, body: 'r' }, [ME]);
    ctx.notifyIssueCommentMention({ number: 1, title: 't' }, { by: OTHER, body: 'r' }, [ME]);
    expect(kinds).toEqual(['review', 'review', 'result', 'result', 'inquiry',
      'mention', 'mention', 'comment', 'mention']);
  });
});

describe('レビューの指摘', () => {
  it('設定を読めなくても通知メールは落とさず、元の宛先に送る', () => {
    const { ctx, fake } = setup();
    ctx.prefReaderLive_ = () => { throw new Error('読めない'); };
    ctx.notify(ME, '件名', '本文', 'review');
    expect(fake._sentMails().map((m) => m.to)).toEqual([ME]);
  });

  it('組の名前は自分の持ち物だけを見る (__proto__ などは知らない設定)', () => {
    const { ctx } = setup();
    ['__proto__.x', 'constructor.x', 'toString.x', 'hasOwnProperty.x'].forEach((k) => {
      expect(() => ctx.apiPrefSet(k, 1)).toThrow(/知らない設定です/);
      expect(() => ctx.prefGet_(k)).toThrow(/知らない設定です/);
    });
  });

  it('既定値と同じ値を書いたら、チームの設定は鍵ごと消す', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('home.dueDays', 5);
    ctx.apiPrefSet('home.dueDays', 3);
    expect(fake.PropertiesService.getScriptProperties().getProperty('PREF:home.dueDays')).toBe(null);
    ctx.apiPrefSet('stale.steps', [7, 14, 30]);
    expect(fake.PropertiesService.getScriptProperties().getProperty('PREF:stale.steps')).toBe(null);
  });

  it('既定値と同じ値を書いたら、自分の設定からも消し、空なら MYPREF ごと消す', () => {
    const { ctx, fake } = setup();
    const props = fake.PropertiesService.getScriptProperties();
    ctx.apiPrefSet('notify.review', false);
    ctx.apiPrefSet('start.tab', 'issues');
    ctx.apiPrefSet('notify.review', true);
    expect(JSON.parse(props.getProperty('MYPREF:tester@example.com'))).toEqual({ 'start.tab': 'issues' });
    ctx.apiPrefSet('start.tab', 'home');
    expect(props.getProperty('MYPREF:tester@example.com')).toBe(null);
    expect(ctx.apiPrefs().items.filter((p) => p.key === 'start.tab')[0].custom).toBe(false);
  });

  it('管理者かは設定の画面が尋ねたときだけ調べる (起動のときは Drive に聞かない)', () => {
    const { ctx } = setup();
    let asked = 0;
    ctx.repoIsAdmin_ = () => { asked++; return true; };
    expect(ctx.apiPrefs().canEditTeam).toBe(false);
    expect(asked).toBe(0);
    expect(ctx.apiPrefs({ team: true }).canEditTeam).toBe(true);
    expect(asked).toBe(1);
    // 画面から書いたあとの返りは設定の画面のもの
    expect(ctx.apiPrefSet('start.tab', 'issues').canEditTeam).toBe(true);
  });

  it('使われ方の設定を読めなくても、数えるのは止めない', () => {
    const { ctx } = setup();
    ctx.prefGet_ = () => { throw new Error('読めない'); };
    expect(ctx.usageRecord([{ kind: 'view', target: 'home', count: 1 }])).toBe(1);
  });
});

describe('楽しい演出 (既定はオフ)', () => {
  const FUN = ['fun.combo', 'fun.words', 'fun.cheer'];

  it('3つとも自分の設定の bool で、既定はオフ', () => {
    const { ctx } = setup();
    FUN.forEach((k) => {
      const p = item(ctx, k);
      expect(p).toBeTruthy();
      expect(p.scope).toBe('me');
      expect(p.type).toBe('bool');
      expect(p.def).toBe(false);
      expect(p.section).toBe('楽しい演出');
      expect(ctx.prefGet_(k, ME)).toBe(false);
    });
    expect(item(ctx, 'fun.combo').label).toBe('打つと盛り上がる');
    expect(item(ctx, 'fun.words').label).toBe('言葉に反応する');
    expect(item(ctx, 'fun.cheer').label).toBe('済ませたらお祝い');
  });

  it('effective.fun は既定で全部オフ。本人がオンにしたぶんだけオンになり、ほかの人には効かない', () => {
    const { ctx, fake } = setup();
    fake._setUser(ME);
    expect(ctx.apiPrefs().effective.fun).toEqual({ combo: false, words: false, cheer: false });
    ctx.apiPrefSet('fun.combo', true);
    expect(ctx.apiPrefs().effective.fun).toEqual({ combo: true, words: false, cheer: false });
    const raw = JSON.parse(fake.PropertiesService.getScriptProperties().getProperty('MYPREF:' + ME));
    expect(raw['fun.combo']).toBe(true);
    fake._setUser(OTHER);
    expect(ctx.apiPrefs().effective.fun.combo).toBe(false);
  });

  it('bool 以外は通さない。オフに戻すと既定と同じなので消える', () => {
    const { ctx, fake } = setup();
    fake._setUser(ME);
    expect(() => ctx.apiPrefSet('fun.words', 'true')).toThrow();
    expect(() => ctx.apiPrefSet('fun.words', 1)).toThrow();
    ctx.apiPrefSet('fun.words', true);
    ctx.apiPrefSet('fun.words', false);
    expect(fake.PropertiesService.getScriptProperties().getProperty('MYPREF:' + ME)).toBe(null);
  });

  it('管理者でなくても自分のぶんは変えられる', () => {
    const { ctx, fake } = setup({ admin: false });
    fake._setUser(ME);
    expect(() => ctx.apiPrefSet('fun.cheer', true)).not.toThrow();
    expect(ctx.apiPrefs().effective.fun.cheer).toBe(true);
  });
});
