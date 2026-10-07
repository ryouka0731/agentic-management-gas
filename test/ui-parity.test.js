import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

/*
 * サーバと画面の両方にある関数が、同じ入力に同じ答えを返すか。
 *
 * google.script.run の往復を減らすために、画面にも同じ計算を写してある
 * (CLAUDE.md の「サーバ側と UI 側の両方にある関数」)。片方だけ直すと、
 * 表示と実体がずれる。これまでは「両方に関数がある」ことしか見ていなかった。
 *
 * 画面の関数は app.js.html の中から原文のまま切り出して動かす。写しを
 * テストに書くと、写しどうしを比べることになって意味が無い。
 */

const APP = fs.readFileSync('src/ui/app.js.html', 'utf8');

/** app.js.html から function name(...) { ... } を原文のまま切り出す */
function extract(name) {
  const start = APP.indexOf('  function ' + name + '(');
  if (start < 0) throw new Error('画面に ' + name + ' がありません');

  let i = APP.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for (; i < APP.length; i++) {
    const ch = APP[i];
    const next = APP[i + 1];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { i = APP.indexOf('\n', i); continue; }
    if (ch === '/' && next === '*') { i = APP.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return APP.substring(start, i + 1);
}

/** 画面の関数を、外側の変数を差し込んだ箱の中で動かす */
function ui(names, globals) {
  const ctx = Object.assign({}, globals || {});
  vm.createContext(ctx);
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return ctx;
}

/*
 * 乱数は Math.imul で32ビットのまま回す。
 *
 * 以前は (seed * 1103515245 + 12345) % 2^31 と書いていた。掛け算が 2^53 を超えて
 * 下の桁が落ち、並びが偏っていた。groupIssues を担当者で束ねる場合が 302 回あって、
 * 担当者の入ったやることが1件も作られず、画面とサーバの食い違いを見落としていた
 */
let seed = 17;
const rnd = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return (seed >>> 8) % n;
};
const pick = (list) => list[rnd(list.length)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

describe('画面とサーバで同じ答えになる', () => {
  it('fileUrlOf', () => {
    const core = loadGas('src/core/FileUrl.js');
    const view = ui(['fileUrlOf']);
    for (const type of ['doc', 'sheet', 'slide', 'pdf', '', null]) {
      for (const id of ['abc', '', 'x-_9']) {
        expect(view.fileUrlOf(type, id)).toBe(core.fileUrlOf(type, id));
      }
    }
  });

  it('tokyoDay (東京の暦日)', () => {
    // 画面は ISO の字で受け取り、サーバは台帳の Date で数える。同じ瞬間が
    // 同じ暦日にならないと、今日の線や残り日数がバーンダウンとずれる
    const core = loadGas('src/core/ScrumView.js');
    const view = ui(['tokyoDay']);
    for (let t = 0; t < 2000; t++) {
      const d = new Date(Date.UTC(2026, rnd(12), 1 + rnd(28), rnd(24), rnd(60)));
      expect(view.tokyoDay(d.toISOString())).toBe(core.scrumDayOf_(d));
    }
    for (const day of ['2026-10-07', '2026-02-30', '2026-13-01', '', 'x']) {
      expect(view.tokyoDay(day)).toBe(core.scrumDayOf_(day));
    }
  });

  it('diffPairs', () => {
    const core = loadGas('src/core/Diff.js');
    const view = ui(['diffPairs']);
    for (let t = 0; t < 3000; t++) {
      const ops = Array.from({ length: rnd(8) }, () => ({
        type: pick(['equal', 'insert', 'delete']), line: 'l' + rnd(5),
      }));
      expect(same(view.diffPairs(ops), core.diffPairs(ops))).toBe(true);
    }
  });

  it('ganttDaysForEffort', () => {
    const core = loadGas('src/core/Gantt.js');
    const view = ui(['ganttDaysForEffort']);
    for (const v of ['', null, 0, 1, 7, 7.5, 8, 16, 100, -3, '8', 'x', 0.1]) {
      expect(view.ganttDaysForEffort(v)).toBe(core.ganttDaysForEffort(v));
    }
  });

  it('tagParse', () => {
    const core = loadGas('src/core/Tag.gs');
    const view = ui(['tagParse']);
    const parts = ['#a', '#あ', ' ', '#', 'x', ',', '#b,c', '##d', '#e#f', '　'];
    for (let t = 0; t < 3000; t++) {
      const text = Array.from({ length: rnd(6) }, () => pick(parts)).join('');
      expect(same(view.tagParse(text), core.tagParse(text))).toBe(true);
    }
  });

  it('mentionMatch', () => {
    const core = loadGas('src/core/Mention.js');
    const roster = ['Aoki@example.com', 'aoki@other.test', 'sato@example.com', 'x@y'];
    const view = ui(['mentionMatch'], { roster });
    for (const token of ['aoki', 'AOKI', 'sato', 'sato@example.com', 'x', 'x@y', '', 'nobody', '@']) {
      expect(view.mentionMatch(token)).toBe(core.mentionMatch(token, roster));
    }
  });

  it('wouldCycle と issueWouldCycle', () => {
    const core = loadGas('src/core/IssueTree.js');
    // 箱は1回だけ作る。繰り返しのたびに作ると、機械が重いときに時間切れになる
    const view = ui(['wouldCycle'], { lastIssues: [] });
    for (let t = 0; t < 2000; t++) {
      const issues = Array.from({ length: 1 + rnd(6) }, (_, i) => ({
        number: i + 1, parent: rnd(3) ? '' : 1 + rnd(6),
      }));
      view.lastIssues = issues;
      const child = 1 + rnd(6);
      const parent = 1 + rnd(6);
      expect(view.wouldCycle(child, parent)).toBe(core.issueWouldCycle(issues, child, parent));
    }
  });

  it('rollupEffort', () => {
    const core = loadGas('src/core/IssueTree.js');
    const view = ui(['rollupEffort']);
    const node = (depth) => ({
      issue: {
        number: rnd(100), estimate: pick(['', 1, 2.5, '3']),
        plannedHours: pick(['', 4, '8']), actualHours: pick(['', 1, 0]),
        state: pick(['open', 'closed']),
      },
      children: depth > 2 ? [] : Array.from({ length: rnd(3) }, () => node(depth + 1)),
    });
    for (let t = 0; t < 1000; t++) {
      const a = node(0);
      const b = JSON.parse(JSON.stringify(a));
      expect(same(view.rollupEffort(a), core.rollupEffort(b))).toBe(true);
      expect(same(a, b)).toBe(true);
    }
  });

  it('groupIssues', () => {
    const core = loadGas('src/core/Grouping.js');
    const allFiles = [
      { fileId: 'D1', path: '就業規則.doc' }, { fileId: 'D2', path: '賃金規程.doc' },
      { fileId: 'W1', path: 'branches/見直し/就業規則.doc' },
    ];
    const docNames = { D1: '就業規則.doc', D2: '賃金規程.doc' };
    const splitPath = (p) => {
      const m = /^branches\/([^/]+)\/(.*)$/.exec(String(p || ''));
      return m ? { branch: m[1], path: m[2] } : { branch: 'main', path: String(p || '') };
    };
    // 箱は1回だけ作る (wouldCycle と同じ理由)
    // 束の見出しの人の名前は、画面では表示名に直す。比べるのは束ね方なので、そのまま返す
    const view = ui(['groupIssues'], { allFiles, splitPath, personName: (x) => x });
    for (let t = 0; t < 2000; t++) {
      const issues = Array.from({ length: rnd(6) }, (_, i) => ({
        number: i + 1,
        assignee: pick(['', 'a@x', 'a@x,b@x', 'b@x']),
        labels: pick(['', '会議', '会議,調査']),
        linkedFileIds: pick(['', 'D1', 'D1,D2', 'W1']),
        state: pick(['open', 'closed']),
        priority: pick(['', 'high', 'low', 'normal']),
        dueDate: pick(['', '2026-09-30']),
        // 人が付ける名前は Object の持ち物や未定の印と重なりうる
        sprint: pick(['', 'sprint001', 'sprint002', 'sprint010', 'constructor', '(未定)']),
      }));
      const by = pick(['assignee', 'label', 'doc', 'state', 'sprint', 'priority', 'none', 'due']);
      const a = view.groupIssues(issues, by);
      const b = core.groupIssues(issues, by, docNames);
      if (!same(a, b)) {
        throw new Error(by + ' で食い違う\n画面: ' + JSON.stringify(a) +
          '\nサーバ: ' + JSON.stringify(b));
      }
    }
  });

  it('ganttLayout', () => {
    const core = loadGas('src/core/Gantt.js');
    // 画面では関数ではなく変数で持っている。原文から読む (サーバの値と違えば
    // それも食い違いとして出る)
    const tail = Number(/var GANTT_TAIL_DAYS = (\d+);/.exec(APP)[1]);
    const view = ui(['ganttLayout', 'ganttDaysForEffort', 'ganttDateAt', 'ganttMonths'],
      { GANTT_TAIL_DAYS: tail });
    const day = (d) => '2026-09-' + String(d).padStart(2, '0');
    for (let t = 0; t < 2000; t++) {
      const issues = Array.from({ length: rnd(5) }, (_, i) => ({
        number: i + 1,
        title: 't' + i,
        state: pick(['open', 'closed']),
        startDate: rnd(2) ? day(1 + rnd(28)) : '',
        dueDate: rnd(2) ? day(1 + rnd(28)) : '',
        plannedHours: pick(['', 8, 16, '4']),
        estimate: pick(['', 1, 2]),
        createdAt: '2026-09-01T00:00:00.000Z',
        assignees: [],
      }));
      const today = new Date(2026, 8, 1 + rnd(28));
      const a = view.ganttLayout(issues, today);
      const b = core.ganttLayout(issues, today);
      if (!same(a, b)) {
        throw new Error('食い違う\n画面: ' + JSON.stringify(a) + '\nサーバ: ' + JSON.stringify(b));
      }
    }
  });
});
