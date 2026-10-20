import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 仕事のスタンス診断。問い・軸・型は src/core/WorkStyleTypes.js が唯一の定義。
 * 結果は本人のもの (STYLE:<アドレス>)。ほかの人に見せるのは、本人が style.share をオンにしたときの型の名前だけ。
 */

const pure = loadGas('src/core/WorkStyleTypes.js');
const plain = (v) => JSON.parse(JSON.stringify(v));

/** 全部の問いに同じ答え */
function all(v) {
  const out = {};
  pure.STYLE_QUESTIONS().forEach((q) => { out[q.id] = v; });
  return out;
}

/** 極へはっきり寄せた答え。wants は軸 → 0 (左) か 1 (右) */
function toward(wants) {
  const out = {};
  pure.STYLE_QUESTIONS().forEach((q) => {
    const left = wants[q.axis] === 0;
    out[q.id] = (q.sign > 0) === left ? 5 : 1;
  });
  return out;
}

describe('問いの釣り合い', () => {
  const qs = pure.STYLE_QUESTIONS();
  const axes = pure.WORK_STYLE_AXES();

  it('16〜20問で、id は重ならない', () => {
    expect(qs.length).toBeGreaterThanOrEqual(16);
    expect(qs.length).toBeLessThanOrEqual(20);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
  });

  it('どの軸も同じ数の問いを持ち、両方の向きを2問以上含む', () => {
    const per = axes.map((a) => qs.filter((q) => q.axis === a.key));
    per.forEach((list) => expect(list.length).toBe(qs.length / axes.length));
    per.forEach((list) => {
      expect(list.filter((q) => q.sign === 1).length).toBeGreaterThanOrEqual(2);
      expect(list.filter((q) => q.sign === -1).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('全体で、そう思うほど左に寄る問いと右に寄る問いが同じ数 (そう思い続ける癖だけで型が決まらない)', () => {
    expect(qs.filter((q) => q.sign === 1).length).toBe(qs.filter((q) => q.sign === -1).length);
  });

  it('同じ軸の問いが続かない', () => {
    for (let i = 1; i < qs.length; i++) expect(qs[i].axis).not.toBe(qs[i - 1].axis);
  });

  it('知らない軸を指す問いが無い。向きは +1 か -1', () => {
    const keys = axes.map((a) => a.key);
    qs.forEach((q) => {
      expect(keys).toContain(q.axis);
      expect([1, -1]).toContain(q.sign);
    });
  });
});

describe('16の型', () => {
  const axes = pure.WORK_STYLE_AXES();
  const types = pure.WORK_STYLES();

  it('軸の極の組み合わせ16通りが全部あり、それ以外は無い', () => {
    const codes = [];
    axes[0].poles.forEach((a) => axes[1].poles.forEach((b) => axes[2].poles.forEach((c) =>
      axes[3].poles.forEach((d) => codes.push([a.key, b.key, c.key, d.key].join('-'))))));
    expect(Object.keys(types).sort()).toEqual(codes.sort());
  });

  it('名前は重ならず、どれも一言・強み・気をつけたいこと・絵を持つ', () => {
    const list = Object.values(types);
    expect(new Set(list.map((t) => t.name)).size).toBe(16);
    list.forEach((t) => {
      expect(t.name).toBeTruthy();
      expect(t.emoji).toBeTruthy();
      expect(t.oneLine).toBeTruthy();
      expect(t.strengths.length).toBeGreaterThanOrEqual(2);
      expect(t.cautions.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('ほかの性格検査の4字の記号を使っていない', () => {
    const text = JSON.stringify(plain(types)) + JSON.stringify(plain(pure.STYLE_QUESTIONS()));
    expect(text).not.toMatch(/\b[EI][SN][TF][JP]\b/);
    expect(text).not.toMatch(/MBTI/i);
  });

  it('どの極も、画面のひとことと Claude への手伝い方とおすすめを持つ', () => {
    axes.forEach((a) => a.poles.forEach((p) => {
      expect(p.tip).toBeTruthy();
      expect(p.support).toBeTruthy();
      expect(p.uses.length).toBeGreaterThanOrEqual(1);
      p.uses.forEach((u) => expect(['pref', 'view']).toContain(u.kind));
    }));
  });
});

describe('数え方 (workStyleScore)', () => {
  it('極へはっきり寄せれば、その型になる (16通りすべて)', () => {
    const axes = pure.WORK_STYLE_AXES();
    for (let n = 0; n < 16; n++) {
      const wants = {};
      axes.forEach((a, i) => { wants[a.key] = (n >> i) & 1; });
      const code = axes.map((a) => a.poles[wants[a.key]].key).join('-');
      const got = pure.workStyleScore(toward(wants));
      expect(got.code).toBe(code);
      axes.forEach((a) => {
        expect(Math.abs(got.scores[a.key])).toBe(pure.workStyleAxisMax(a.key));
      });
    }
  });

  it('同じ答えなら何度数えても同じ', () => {
    const answers = {};
    pure.STYLE_QUESTIONS().forEach((q, i) => { answers[q.id] = (i * 7) % 5 + 1; });
    const first = plain(pure.workStyleScore(answers));
    for (let k = 0; k < 5; k++) expect(plain(pure.workStyleScore(answers))).toEqual(first);
  });

  it('ちょうど真ん中 (全部「どちらとも言えない」) は、どの軸も左の極', () => {
    const got = pure.workStyleScore(all(3));
    expect(got.code).toBe('go-solo-rush-new');
    expect(Object.values(got.scores)).toEqual([0, 0, 0, 0]);
    expect(pure.workStyleLean(0, 10)).toBe('どちらとも言えない');
  });

  it('全部「そう思う」でも点は打ち消し合う (向きを混ぜてある)', () => {
    const got = pure.workStyleScore(all(5));
    // start・pace は +1 が3問・-1 が2問、power・draw は逆
    expect(plain(got.scores)).toEqual({ start: 2, pace: 2, power: -2, draw: -2 });
    expect(pure.workStyleLean(2, 10)).toBe('やや');
    expect(pure.workStyleLean(-8, 10)).toBe('はっきり');
  });

  it('答えていない問い・範囲の外・字の答えは断る', () => {
    const some = all(3);
    delete some.q7;
    expect(() => pure.workStyleScore(some)).toThrow('答えていない問いがあります');
    expect(() => pure.workStyleScore(Object.assign(all(3), { q1: 6 }))).toThrow('答えていない問いがあります');
    expect(() => pure.workStyleScore(Object.assign(all(3), { q1: 2.5 }))).toThrow('答えていない問いがあります');
    expect(() => pure.workStyleScore(Object.assign(all(3), { q1: '5' }))).toThrow('答えていない問いがあります');
    expect(() => pure.workStyleScore(null)).toThrow('答えが読めません');
    expect(() => pure.workStyleScore([5, 5])).toThrow('答えが読めません');
  });

  it('知らない問いの答えは数えない', () => {
    const a = pure.workStyleScore(all(4));
    const b = pure.workStyleScore(Object.assign(all(4), { q99: 1, __proto__x: 5 }));
    expect(plain(b)).toEqual(plain(a));
  });
});

describe('共有用の札', () => {
  it('型の名前・一言・強みが入り、点数は入らない', () => {
    const text = pure.workStyleCardText('plan-team-steady-craft', 'SoftBanto');
    const t = pure.WORK_STYLES()['plan-team-steady-craft'];
    expect(text).toContain('「' + t.name + '」');
    expect(text).toContain(t.oneLine);
    t.strengths.forEach((s) => expect(text).toContain(s));
    expect(text).toContain('遊びの診断');
    expect(text).not.toMatch(/\d/);
  });

  it('知らない型は空', () => {
    expect(pure.workStyleCardText('x', 'SoftBanto')).toBe('');
    expect(pure.workStyleOf('constructor')).toBeNull();
  });
});

/* ---------- サーバ ---------- */

const ME = 'tester@example.com';
const OTHER = 'b@example.com';

function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('結果は本人のもの', () => {
  it('答えると本人のぶんとして覚え、問いの向きは画面に渡さない', () => {
    const { ctx } = server();
    const before = ctx.apiWorkStyle();
    expect(before.mine).toBeNull();
    expect(before.share).toBe(false);
    expect(before.questions.length).toBe(20);
    before.questions.forEach((q) => expect(Object.keys(q).sort()).toEqual(['id', 'text']));

    const res = ctx.apiWorkStyleSave(toward({ start: 1, pace: 1, power: 1, draw: 1 }));
    expect(res.code).toBe('plan-team-steady-craft');
    expect(res.name).toBe('みんなの縁の下');
    expect(res.axes.map((x) => x.pole)).toEqual(['段取りから', '声をかけ合う', 'コツコツ毎日', '決まった型を磨く']);
    expect(ctx.apiWorkStyle().mine.code).toBe('plan-team-steady-craft');
  });

  it('ほかの人の画面には出ない (その人の結果は無いまま)', () => {
    const { ctx, fake } = server();
    ctx.apiWorkStyleSave(all(5));
    fake._setUser(OTHER);
    expect(ctx.apiWorkStyle().mine).toBeNull();
  });

  it('答え直すと上書きする', () => {
    const { ctx } = server();
    ctx.apiWorkStyleSave(toward({ start: 0, pace: 0, power: 0, draw: 0 }));
    ctx.apiWorkStyleSave(toward({ start: 1, pace: 0, power: 0, draw: 0 }));
    expect(ctx.apiWorkStyle().mine.code).toBe('plan-solo-rush-new');
  });

  it('アドレスの大文字小文字で別の人にしない', () => {
    const { ctx } = server();
    ctx.workStyleSave_('Tester@Example.com', all(3), new Date());
    expect(ctx.workStyleRead_(ME).code).toBe('go-solo-rush-new');
  });

  it('手で書き換えられて読めない結果は、無いものとして扱う', () => {
    const { ctx } = server();
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('STYLE:' + ME, '{壊れた');
    expect(ctx.apiWorkStyle().mine).toBeNull();
    props.setProperty('STYLE:' + ME, JSON.stringify({ code: 'x-y-z-w' }));
    expect(ctx.apiWorkStyle().mine).toBeNull();
  });

  it('本人が分からなければ答えを覚えない', () => {
    const { ctx, fake } = server();
    fake._setUser('');
    expect(() => ctx.apiWorkStyleSave(all(3))).toThrow('誰の診断か分かりません');
  });

  it('おすすめの使い方は、いまある設定と画面だけを指す', () => {
    const { ctx } = server();
    const keys = ctx.PREFS_SCHEMA().map((p) => p.key);
    const views = Object.keys(ctx.WORK_STYLE_VIEWS_());
    ctx.WORK_STYLE_AXES().forEach((a) => a.poles.forEach((p) => p.uses.forEach((u) => {
      if (u.kind === 'pref') expect(keys).toContain(u.key);
      else expect(views).toContain(u.key);
    })));
    // 画面に渡す形では、名前は設定の一覧から引く
    const res = ctx.apiWorkStyleSave(all(3));
    res.uses.forEach((u) => expect(u.label).toBeTruthy());
    const turn = res.uses.filter((u) => u.key === 'home.cards.turn')[0];
    expect(turn.label).toBe('あなたの番');
  });
});

describe('チームに見せるのは、本人が選んだときの型の名前だけ', () => {
  it('既定では誰にも見えない', () => {
    const { ctx } = server();
    ctx.apiWorkStyleSave(all(3));
    expect(plain(ctx.apiWorkStyleTeam())).toEqual({});
  });

  it('オンにすると型の名前と絵だけが見え、点数・答え・日付は入らない', () => {
    const { ctx, fake } = server();
    ctx.apiWorkStyleSave(toward({ start: 1, pace: 1, power: 1, draw: 1 }));
    ctx.apiPrefSet('style.share', true);
    fake._setUser(OTHER);
    const team = plain(ctx.apiWorkStyleTeam());
    expect(team).toEqual({ [ME]: { name: 'みんなの縁の下', emoji: '🌱' } });
    expect(JSON.stringify(team)).not.toMatch(/\d/);
    expect(JSON.stringify(team)).not.toContain('scores');
  });

  it('オンでも結果が無ければ出ない', () => {
    const { ctx } = server();
    ctx.apiPrefSet('style.share', true);
    expect(plain(ctx.apiWorkStyleTeam())).toEqual({});
  });

  it('ほかの人がオンにしても、自分の結果は見えない', () => {
    const { ctx, fake } = server();
    ctx.apiWorkStyleSave(all(3));
    fake._setUser(OTHER);
    ctx.apiWorkStyleSave(all(1));
    ctx.apiPrefSet('style.share', true);
    expect(Object.keys(plain(ctx.apiWorkStyleTeam()))).toEqual([OTHER]);
  });

  it('見せる設定を戻せなかったときは、結果も消さない (見せるが残ったまま結果だけ消えない)', () => {
    const { ctx } = server();
    ctx.apiWorkStyleSave(all(3));
    ctx.apiPrefSet('style.share', true);
    const set = ctx.apiPrefSet;
    ctx.apiPrefSet = () => { throw new Error('混み合っています'); };
    expect(() => ctx.apiWorkStyleForget()).toThrow('混み合っています');
    ctx.apiPrefSet = set;
    expect(ctx.apiWorkStyle().mine).not.toBeNull();
  });

  it('結果を消すと、見せる設定も既定 (見せない) に戻る', () => {
    const { ctx } = server();
    ctx.apiWorkStyleSave(all(3));
    ctx.apiPrefSet('style.share', true);
    expect(ctx.apiWorkStyleForget().ok).toBe(true);
    expect(ctx.apiWorkStyle().mine).toBeNull();
    expect(ctx.apiWorkStyle().share).toBe(false);
    // 診断し直しても、選び直すまでは見えない
    ctx.apiWorkStyleSave(all(3));
    expect(plain(ctx.apiWorkStyleTeam())).toEqual({});
  });

  it('設定の一覧に「チームに見せる」があり、既定はオフで本人の設定', () => {
    const { ctx } = server();
    const p = ctx.PREFS_SCHEMA().filter((x) => x.key === 'style.share')[0];
    expect(p.scope).toBe('me');
    expect(p.type).toBe('bool');
    expect(p.def).toBe(false);
  });
});

describe('手元の Claude への命令 (workStyle)', () => {
  it('置いた人の型と手伝い方を返し、点数は入れない', () => {
    const { ctx } = server();
    ctx.workStyleSave_(ME, toward({ start: 0, pace: 1, power: 0, draw: 1 }), new Date());
    const r = plain(ctx.runCommand_({ op: 'workStyle', args: {} }, ME));
    expect(r.taken).toBe(true);
    expect(r.name).toBe('現場の切り込み隊長');
    expect(r.axes.map((x) => x.pole)).toEqual(['すぐ動く', '声をかけ合う', '締切が近いと', '決まった型を磨く']);
    r.axes.forEach((x) => expect(x.support).toBeTruthy());
    expect(JSON.stringify(r)).not.toContain('scores');
    expect(JSON.stringify(r)).not.toContain('score');
  });

  it('ほかの人のぶんは返さない。診断していなければ、そう返す', () => {
    const { ctx } = server();
    ctx.workStyleSave_(ME, all(3), new Date());
    const r = plain(ctx.runCommand_({ op: 'workStyle', args: {} }, OTHER));
    expect(r.taken).toBe(false);
    expect(r.howTo).toContain('仕事のスタンス診断');
  });

  it('置いた人が分からなければ断る (自分の様子を見る命令の1つ)', () => {
    const { ctx } = server();
    expect(ctx.COMMAND_PERSONAL_OPS()).toContain('workStyle');
    expect(() => ctx.runCommand_({ op: 'workStyle', args: {} }, '')).toThrow('命令を置いた人が分かりません');
  });
});

describe('手引き', () => {
  it('docs/manual/work-style.md に16の型の名前が全部ある', async () => {
    const fs = await import('node:fs');
    const text = fs.readFileSync('docs/manual/work-style.md', 'utf8');
    Object.values(pure.WORK_STYLES()).forEach((t) => expect(text).toContain(t.emoji + ' ' + t.name));
  });
});
