import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { APP_SOURCES } from './sources.js';

/*
 * スクラムの言葉を一般の言葉にする (#21)。TERMS() が唯一の定義。
 * 設計: docs/superpowers/specs/2026-10-20-guide-usage-settings-design.md の 4。
 */

describe('TERMS', () => {
  const t = loadGas('src/core/Terms.js');

  it('対応表は設計のとおり', () => {
    expect(JSON.parse(JSON.stringify(t.TERMS()))).toEqual({
      feature: { plain: '期間で進める', scrum: 'エージェンティックスクラム' },
      sprint: { plain: '作業期間', scrum: 'スプリント' },
      sprintGoal: { plain: 'この期間の目標', scrum: 'スプリントゴール' },
      points: { plain: '大きさ', scrum: 'ポイント' },
      velocity: { plain: '期間ごとに終えた量', scrum: 'ベロシティ' },
      burndown: { plain: '残りの量の推移', scrum: 'バーンダウン' },
      impediment: { plain: '困りごと', scrum: '障害物' },
      productGoal: { plain: '目指すところ', scrum: 'プロダクトゴール' },
      definitionOfDone: { plain: '終わったと言える条件', scrum: '完了の定義' },
      acceptance: { plain: 'できたと言える条件', scrum: '受け入れ条件' },
    });
  });

  it('既定は一般の言葉。知らない表し方も一般の言葉', () => {
    expect(t.term('sprint')).toBe('作業期間');
    expect(t.term('sprint', 'plain')).toBe('作業期間');
    expect(t.term('sprint', 'scrum')).toBe('スプリント');
    expect(t.term('sprint', 'x')).toBe('作業期間');
  });

  it('知らない key はそのまま返す (字が消えない)', () => {
    expect(t.term('nope', 'scrum')).toBe('nope');
    expect(t.term('constructor')).toBe('constructor');
    expect(t.term('__proto__')).toBe('__proto__');
  });

  it('文の中に言葉だけを差し込む', () => {
    expect(t.termFill('この{sprint}を直す')).toBe('この作業期間を直す');
    expect(t.termFill('この{sprint}を直す', 'scrum')).toBe('このスプリントを直す');
    expect(t.termFill('{burndown}・{velocity}', 'scrum')).toBe('バーンダウン・ベロシティ');
    expect(t.termFill('{nope} {toString} {}')).toBe('{nope} {toString} {}');
    expect(t.termFill(null)).toBe('');
  });
});

describe('言葉の表し方は自分の設定', () => {
  const SOURCES = APP_SOURCES;

  it('terms.style は plain / scrum で、既定は plain', async () => {
    const { loadGasWith } = await import('./harness.js');
    const { createFakeGas } = await import('./fakegas.js');
    const ctx = loadGasWith(createFakeGas(), ...SOURCES);
    ctx.repoInit('agentic-management');
    const p = ctx.PREFS_SCHEMA().filter((x) => x.key === 'terms.style')[0];
    expect(p.scope).toBe('me');
    expect(p.type).toBe('enum');
    expect(p.label).toBe('言葉の表し方');
    expect(p.options.map((o) => o.value)).toEqual(['plain', 'scrum']);
    expect(p.options.map((o) => o.label)).toEqual(['一般の言葉', 'スクラムの言葉 (エンジニア向け)']);
    expect(p.def).toBe('plain');
    expect(ctx.apiPrefs().effective.termStyle).toBe('plain');
    ctx.apiPrefSet('terms.style', 'scrum');
    expect(ctx.apiPrefs().effective.termStyle).toBe('scrum');
  });

  it('最初に出す画面の選択肢は {key} で渡し、画面が言葉の表し方で埋める', async () => {
    const { loadGasWith } = await import('./harness.js');
    const { createFakeGas } = await import('./fakegas.js');
    const ctx = loadGasWith(createFakeGas(), ...SOURCES);
    ctx.repoInit('agentic-management');
    ctx.PropertiesService.getScriptProperties().setProperty(ctx.SCRUM_ENABLED_KEY(), 'true');
    const p = ctx.apiPrefs().items.filter((x) => x.key === 'start.tab')[0];
    const label = (v) => p.options.filter((o) => o.value === v)[0].label;
    expect(label('sprint')).toBe('{sprint}');
    expect(label('impediments')).toBe('{impediment}');
  });
});

/*
 * 画面にスクラムの言葉を直に書かない。書くと、一般の言葉を選んだ人 (既定) にも
 * スクラムの言葉が混ざって出る。言葉は term() / termFill() を通す。
 *
 * コメントは人に見せないので数えない。TERMS() の表そのものは除く。使い方 (GUIDE) と
 * その図も {key} で書く。
 * ゲームの「ポイントとレベル」はスクラムの見積もりとは別物なので、「ポイント」
 * だけは禁じない (見積もりの「ストーリーポイント」は禁じる)。
 */
const SCRUM_WORDS = /スプリント|ベロシティ|バーンダウン|障害物|完了の定義|プロダクトゴール|受け入れ条件|受入基準|スクラム|ストーリーポイント/;

/**
 * JS のコメントを空にする。行ごとに見る (字の数え方で追うと、正規表現の中の ' で
 * 字の内外が入れ替わる)。行の頭が // ・ /* ・ * の行と、行の後ろの「 // 」以降
 * (それより前の ' が対になっているときだけ) を消す。改行は残して行番号を保つ
 */
function stripJsComments(text) {
  return text.split('\n').map((line) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return '';
    const at = line.indexOf(' // ');
    if (at >= 0 && (line.substring(0, at).split("'").length - 1) % 2 === 0) return line.substring(0, at);
    return line;
  }).join('\n');
}

/** start の行から、閉じる行 (close) までを空にする */
function blank(text, start, close) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error('見つかりません: ' + start);
  const b = text.indexOf(close, a);
  return text.substring(0, a) + text.substring(a, b + close.length).replace(/[^\n]/g, ' ') +
    text.substring(b + close.length);
}

function offenders(text) {
  return text.split('\n').map((line, i) => [i + 1, line])
    .filter(([, line]) => SCRUM_WORDS.test(line))
    .map(([n, line]) => n + ': ' + line.trim());
}

describe('画面にスクラムの言葉を直に書かない', () => {
  it('app.js.html', () => {
    let text = stripJsComments(fs.readFileSync('src/ui/app.js.html', 'utf8'));
    text = blank(text, '  function TERMS() {', '\n  }\n');
    expect(offenders(text)).toEqual([]);
  });

  it('wiki.html', () => {
    const text = fs.readFileSync('src/ui/wiki.html', 'utf8').replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
    expect(offenders(text)).toEqual([]);
  });
});

describe('サーバの文は一般の言葉に固定する', () => {
  /*
   * 人ごとに切り替えると、キューやトリガーから出る文の言葉がばらつく。スクラムの言葉を
   * 選んだ人にも一般の言葉で出るが、意味は通じる (設計の 4)。
   * エディタで動かす確かめ (debug*) は持ち主だけが読むので数えない。
   * 設定の「言葉の表し方」は、スクラムの言葉そのものを選択肢として見せる。
   */
  const FILES = ['src/core/Scrum.gs', 'src/core/Issue.gs', 'src/core/IssueTree.js', 'src/core/Settings.gs', 'src/core/CommandQueue.gs',
    'src/core/ScrumView.js', 'src/core/Grouping.js', 'src/core/Prefs.gs', 'src/Main.gs'];

  FILES.forEach((path) => {
    it(path, () => {
      let text = stripJsComments(fs.readFileSync(path, 'utf8'));
      // debug で始まる関数を除く (次の function まで)
      text = text.split(/\n(?=function )/).map((chunk) =>
        (/^function debug/.test(chunk) ? chunk.replace(/[^\n]/g, ' ') : chunk)).join('\n');
      const lines = offenders(text).filter((l) => !/スクラムの言葉/.test(l));
      expect(lines).toEqual([]);
    });
  });
});
