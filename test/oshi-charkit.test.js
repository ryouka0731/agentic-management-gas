import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * キャラ作成キット (やること #50)。写真とプロフィールのリンクを AI の道具に渡し、プロフィール・せりふ・表情ごとの絵を
 * 作ってもらって、番頭に取り込む。頼み文の定義は src/core/Oshi.js (oshiCharKitPrompt)、取り込みの検査は
 * src/core/OshiStore.gs (oshiCharImportValid_) だけ。テストの中身は作り話にする。
 */

const pure = loadGas('src/core/Oshi.js');
const TOOLS = ['chatgpt', 'gemini', 'claude', 'codex'];
/** 1 + 実績の数 (いまは 36 の実績で Lv37 まで) */
const MAX = 37;

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

/** 作り話のキャラの答え。lines と profile は場面・Lv の全部ではなく一部だけ */
const ANSWER = {
  name: 'テストのミント',
  tone: 'genki',
  lines: { done: ['テストできたね！', 'テストおつかれ！'], night: ['テストはもう休も？'] },
  profile: {
    items: [{ lv: 2, label: 'テストの好物', text: 'テスト用のプリン' }, { lv: 4, label: 'テストの口ぐせ', text: 'テストだよ' }],
    clearLine: 'テストのお祝いだよ！',
  },
};

describe('キャラ作成キットの頼み文 (oshiCharKitPrompt)', () => {
  it('道具は ChatGPT / Gemini / Claude / Codex の4つ', () => {
    expect(pure.OSHI_CHARKIT_TOOLS().map((t) => t.key)).toEqual(TOOLS);
    expect(pure.oshiCharKitPrompt('nope', MAX)).toBe('');
  });

  it('どの道具の頼み文も、全部の表情 (作業中の場面も) と全部の場面・口調を挙げる', () => {
    for (const tool of TOOLS) {
      const p = pure.oshiCharKitPrompt(tool, MAX);
      for (const s of pure.OSHI_STATES()) {
        expect(p, tool + ': ' + s.key).toContain('- ' + s.key + ' (' + s.label + '): ' + s.pose);
      }
      for (const e of pure.OSHI_EVENTS()) expect(p, tool + ': ' + e.key).toContain('  - ' + e.key + ': ' + e.label);
      for (const t of pure.OSHI_TONES()) expect(p, tool + ': ' + t.key).toContain(t.key + ' (' + t.label + ')');
    }
  });

  it('JSON の形と、欄ごとの長さを挙げる (検査の上限と同じ数)', () => {
    const text = pure.OSHI_TEXT_LIMITS();
    const prof = pure.OSHI_PROFILE_LIMITS();
    for (const tool of TOOLS) {
      const p = pure.oshiCharKitPrompt(tool, MAX);
      for (const key of ['"name"', '"tone"', '"lines"', '"profile"', '"items"', '"lv"', '"label"', '"text"', '"clearLine"', '```json']) {
        expect(p, tool + ': ' + key).toContain(key);
      }
      expect(p).toContain(text.nameMax + '字まで');
      expect(p).toContain(text.lineMax + '字まで');
      expect(p).toContain(text.linesPerEvent + '個まで');
      expect(p).toContain(prof.labelMax + '字まで');
      expect(p).toContain(prof.textMax + '字まで');
      expect(p).toContain(prof.clearLineMax + '字まで');
      expect(p).toContain('Lv ' + MAX);
      expect(p).not.toContain('clearVideo');
    }
  });

  it('プロフィールの Lv は 2 から最高の Lv の手前まで 2 ずつ (実績2つで1つ分かる)', () => {
    const levels = pure.oshiCharKitLevels(MAX);
    expect(levels[0]).toBe(2);
    expect(levels[levels.length - 1]).toBe(36);
    expect(levels.length).toBe(18);
    expect(levels.every((lv, i) => i === 0 || lv - levels[i - 1] === 2)).toBe(true);
    expect(pure.oshiCharKitPrompt('chatgpt', MAX)).toContain('lv は ' + levels.join(', ') + ' の 18 項目');
    // 上限 (OSHI_PROFILE_LIMITS) を超えない
    expect(pure.oshiCharKitLevels(1000).length).toBeLessThanOrEqual(pure.OSHI_PROFILE_LIMITS().itemsMax);
    expect(pure.oshiCharKitLevels(1000).every((lv) => lv <= pure.OSHI_PROFILE_LIMITS().lvMax)).toBe(true);
  });

  it('写真とリンクは手がかりだけ。実在の人を描かせず、名前・所属・肩書きを書かせない', () => {
    for (const tool of TOOLS) {
      const p = pure.oshiCharKitPrompt(tool, MAX);
      for (const rule of pure.OSHI_CHARKIT_ORIGINAL_RULES()) expect(p, tool).toContain(rule);
      expect(p).toContain('オリジナルのキャラクター');
      expect(p).toContain('顔立ちを似せず');
      expect(p).toMatch(/実在の人の名前・所属[^\n]*肩書き/);
      // 表情ごとの頼み文の「参考画像と同じキャラクター」(自分で描いた絵のための決まり) は入れない
      expect(p).not.toContain('参考画像と同じキャラクター');
      expect(p).not.toMatch(/そっくり|本人に似せ|同じ顔に/);
    }
  });

  it('道具ごとの絵の受け取り方 (透明な PNG / 緑の背景 / 頼み文だけ / 表を切り分ける)', () => {
    expect(pure.oshiCharKitPrompt('chatgpt', MAX)).toContain('透明な PNG で書き出す');
    expect(pure.oshiCharKitPrompt('chatgpt', MAX)).toContain('1枚に1つの表情');
    const gemini = pure.oshiCharKitPrompt('gemini', MAX);
    expect(gemini).toContain('#00FF00');
    expect(gemini).toContain('緑を使わない');
    expect(gemini).toContain('1枚に1つの表情');
    const claude = pure.oshiCharKitPrompt('claude', MAX);
    expect(claude).toContain('絵を作らなくてかまいません');
    expect(claude).toContain('画像を作る道具に貼れる頼み文');
    const codex = pure.oshiCharKitPrompt('codex', MAX);
    expect(codex).toContain('oshi/idle.png');
    expect(codex).toContain('oshi/character.json');
    expect(codex).toContain('4 列 × 3 行');
    expect(codex).toContain('利用者に確かめ');
  });

  it('表の行と列は表情の数から決まる (11 なら 4 × 3)', () => {
    expect(pure.oshiSheetGrid(11)).toEqual({ rows: 3, cols: 4 });
    expect(pure.oshiSheetGrid(9)).toEqual({ rows: 3, cols: 3 });
    expect(pure.oshiSheetGrid(1)).toEqual({ rows: 1, cols: 1 });
    expect(pure.oshiSheetGrid(pure.OSHI_STATES().length)).toEqual({ rows: 3, cols: 4 });
  });

  it('Git の言葉を人に見せない', () => {
    const all = TOOLS.map((t) => pure.oshiCharKitPrompt(t, MAX)).join('');
    for (const bad of ['マージ', 'コミット', 'ブランチ', 'プルリク', 'PR', 'Issue']) expect(all.includes(bad), bad).toBe(false);
  });
});

describe('AI の答えから JSON を取り出す (oshiExtractJson)', () => {
  it('```json の囲みの中を取り出す (前後の説明は捨てる)', () => {
    const text = 'はい、作りました！\n\n```json\n{"name": "テスト", "tone": "cool"}\n```\n\nほかに直すところは？';
    expect(JSON.parse(pure.oshiExtractJson(text))).toEqual({ name: 'テスト', tone: 'cool' });
  });

  it('囲みの前の説明に別の {…} があっても、囲みの中を先に取る', () => {
    const text = '形は {"name": "例"} のようにします。\n```json\n{"name": "テスト"}\n```';
    expect(JSON.parse(pure.oshiExtractJson(text))).toEqual({ name: 'テスト' });
  });

  it('囲みが無くても、前後の字の中から最初の物を取り出す。字の中の括弧は数えない', () => {
    const text = 'こちらです → {"name": "テスト{かっこ}", "lines": {"done": ["\\"引用\\" }"]}} 以上です。{"other": 1}';
    expect(JSON.parse(pure.oshiExtractJson(text))).toEqual({ name: 'テスト{かっこ}', lines: { done: ['"引用" }'] } });
  });

  it('読めない括弧は飛ばして次を見る。何も無ければ null', () => {
    expect(JSON.parse(pure.oshiExtractJson('{こわれた} それから {"name": "テスト"}'))).toEqual({ name: 'テスト' });
    expect(pure.oshiExtractJson('JSON はありません')).toBe(null);
    expect(pure.oshiExtractJson('')).toBe(null);
    expect(pure.oshiExtractJson(null)).toBe(null);
  });
});

describe('答えの検査 (oshiCharImportValid_)', () => {
  it('知らない欄・知らない場面・プロフィールの中の知らない欄は捨てる。lv の数の字は数にする', () => {
    const { ctx } = setup();
    const got = ctx.oshiCharImportValid_('```json\n' + JSON.stringify({
      ...ANSWER, age: 20, emoji: '★',
      lines: { ...ANSWER.lines, dance: ['テスト'] },
      profile: { items: [{ lv: '6', label: 'テスト', text: 'テスト', color: 'red' }], clearLine: 'テスト', secret: 'x', clearVideo: 'https://youtu.be/dQw4w9WgXcQ' },
    }) + '\n```');
    expect(Object.keys(got).sort()).toEqual(['lines', 'name', 'profile', 'tone']);
    expect(Object.keys(got.lines).sort()).toEqual(['done', 'night']);
    expect(got.profile).toEqual({ items: [{ lv: 6, label: 'テスト', text: 'テスト' }], clearLine: 'テスト' });
  });

  it('口調は決まった key だけ。名前は要る・長すぎれば断る', () => {
    const { ctx } = setup();
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, tone: 'tsundere' }))).toThrow('知らない口調です: tsundere');
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, name: '' }))).toThrow('名前 (name) が書かれていません');
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, name: 'あ'.repeat(21) }))).toThrow('名前は20字まで');
  });

  it('せりふとプロフィールの長さは、ふだんの検査と同じ上限で断る', () => {
    const { ctx } = setup();
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, lines: { done: ['あ'.repeat(61)] } })))
      .toThrow('「やることを済ませた」のせりふを直してください。せりふは1つ60字まで');
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, lines: { done: 5 } }))).toThrow('字の並び');
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, profile: { items: [{ lv: 1, label: 'a', text: 'b' }] } })))
      .toThrow('lv は 2 から');
    expect(() => ctx.oshiCharImportValid_(JSON.stringify({ ...ANSWER, profile: { items: [{ lv: 2, label: 'a', text: 'あ'.repeat(201) }] } })))
      .toThrow('text は200字まで');
  });

  it('JSON が無い・物でない答えは、ふつうの言葉で断る', () => {
    const { ctx } = setup();
    expect(() => ctx.oshiCharImportValid_('できませんでした')).toThrow('JSON が見つかりませんでした');
    expect(() => ctx.oshiCharImportValid_('[1, 2]')).toThrow('JSON が見つかりませんでした');
  });
});

describe('入口 (api)', () => {
  it('apiOshiCharKitPrompt は道具ごとの頼み文を返し、知らない道具は断る', () => {
    const { ctx } = setup();
    for (const tool of TOOLS) {
      const got = ctx.apiOshiCharKitPrompt(tool);
      expect(got.tool).toBe(tool);
      expect(got.prompt).toBe(pure.oshiCharKitPrompt(tool, 1 + ctx.ACHIEVEMENTS().length));
      expect(got.prompt).toContain('Lv ' + (1 + ctx.ACHIEVEMENTS().length));
    }
    expect(() => ctx.apiOshiCharKitPrompt('paint')).toThrow('知らない道具です: paint');
  });

  it('apiOshiGet は道具の一覧と表の既定の行と列を返す (頼み文の中身は返さない)', () => {
    const { ctx } = setup();
    const got = ctx.apiOshiGet();
    expect(got.kitTools.map((t) => t.key)).toEqual(TOOLS);
    expect(got.kitTools[0]).toEqual({ key: 'chatgpt', label: 'ChatGPT' });
    expect(got.sheet).toEqual({ rows: 3, cols: 4 });
  });

  it('apiOshiCharImport(0, …) は新しいキャラを作り、名前・口調・せりふ・プロフィールを入れる', () => {
    const { ctx } = setup();
    const got = ctx.apiOshiCharImport(0, 'はい！\n```json\n' + JSON.stringify(ANSWER) + '\n```');
    expect(got).toEqual({ charId: 1, created: true, name: 'テストのミント', tone: 'genki', lines: 2, items: 2 });
    const mine = ctx.apiOshiGet().mine[0];
    expect(mine.name).toBe('テストのミント');
    expect(mine.tone).toBe('genki');
    expect(mine.events.find((e) => e.key === 'done').mine).toEqual(['テストできたね！', 'テストおつかれ！']);
    expect(JSON.parse(mine.profileJson).clearLine).toBe('テストのお祝いだよ！');
  });

  it('書き直すときは、答えにある場面だけ置き換え、ほかの場面のせりふと動画は残す', () => {
    const { ctx } = setup();
    const id = ctx.apiOshiCharCreate('テストの前', 'polite').charId;
    ctx.apiOshiSetLines(id, 'morning', ['テストのおはよう']);
    ctx.apiOshiSetLines(id, 'done', ['前のせりふ']);
    ctx.apiOshiSetCharProfile(id, JSON.stringify({ items: [{ lv: 2, label: 'a', text: 'b' }], clearVideo: 'https://youtu.be/dQw4w9WgXcQ' }));
    const got = ctx.apiOshiCharImport(id, JSON.stringify(ANSWER));
    expect(got.created).toBe(false);
    expect(got.charId).toBe(id);
    const mine = ctx.apiOshiGet().mine.find((m) => m.charId === id);
    expect(mine.name).toBe('テストのミント');
    expect(mine.events.find((e) => e.key === 'morning').mine).toEqual(['テストのおはよう']);
    expect(mine.events.find((e) => e.key === 'done').mine).toEqual(['テストできたね！', 'テストおつかれ！']);
    const prof = JSON.parse(mine.profileJson);
    expect(prof.items.length).toBe(2);
    expect(prof.clearVideo).toContain('dQw4w9WgXcQ');
    expect(ctx.apiOshiGet().mine.length).toBe(1);
  });

  it('検査に通らなければ、キャラを作らない (名前だけのキャラを残さない)', () => {
    const { ctx } = setup();
    expect(() => ctx.apiOshiCharImport(0, JSON.stringify({ ...ANSWER, tone: 'tsundere' }))).toThrow('知らない口調です');
    expect(ctx.apiOshiGet().mine).toEqual([]);
  });

  it('5人いれば新しくは作れない。ほかの人のキャラの番号は自分の中から探すだけ', () => {
    const { ctx } = setup();
    for (let i = 0; i < 5; i++) ctx.apiOshiCharCreate('テスト' + i, 'polite');
    expect(() => ctx.apiOshiCharImport(0, JSON.stringify(ANSWER))).toThrow('自分のキャラは5人までです');
    expect(() => ctx.apiOshiCharImport(99, JSON.stringify(ANSWER))).toThrow('そのキャラは見つかりません');
    expect(() => ctx.apiOshiCharImport('x', JSON.stringify(ANSWER))).toThrow('知らないキャラです');
  });
});

describe('手元からの命令 oshiPrompt', () => {
  it('読むだけの命令で、置いた人が分からなくても頼み文を返す。知らない道具は断る', () => {
    const { ctx } = setup();
    const got = ctx.runCommand_({ op: 'oshiPrompt', args: { tool: 'codex' } }, '');
    expect(got.tool).toBe('codex');
    expect(got.prompt).toBe(ctx.apiOshiCharKitPrompt('codex').prompt);
    expect(ctx.COMMAND_PERSONAL_OPS()).not.toContain('oshiPrompt');
    expect(() => ctx.runCommand_({ op: 'oshiPrompt', args: { tool: 'nope' } }, '')).toThrow('知らない道具です');
    expect(() => ctx.runCommand_({ op: 'oshiPrompt', args: {} }, '')).toThrow('知らない道具です');
  });
});

describe('手引き (docs/manual/oshi.md)', () => {
  const text = fs.readFileSync('docs/manual/oshi.md', 'utf8');

  it('キャラ作成キットの頼み文を写さない (唯一の定義は Oshi.js)', () => {
    for (const r of pure.OSHI_CHARKIT_ORIGINAL_RULES().slice(1)) expect(text.includes(r.slice(2)), r).toBe(false);
    for (const t of pure.OSHI_CHARKIT_TOOLS()) {
      for (const step of t.steps) expect(text.includes(step.replace(/^(- |\d+\. )/, '')), t.key + ': ' + step).toBe(false);
    }
  });

  it('画面の場所の名前と道具の名前が出る', () => {
    for (const where of ['AI に作ってもらう', 'AI の答えを貼る', '取り込む', '緑の背景を抜く', '1枚の表から切り分ける', '切り分けて入れる']) {
      expect(text, where).toContain(where);
    }
    for (const t of pure.OSHI_CHARKIT_TOOLS()) expect(text, t.label).toContain(t.label);
  });
});
