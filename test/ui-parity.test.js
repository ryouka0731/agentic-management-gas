import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { APP, ui } from './ui-source.js';

/*
 * サーバと画面の両方にある関数が、同じ入力に同じ答えを返すか。
 *
 * google.script.run の往復を減らすために、画面にも同じ計算を写してある
 * (docs/dev/ui.md の「サーバ側と UI 側の両方にある関数」)。片方だけ直すと、
 * 表示と実体がずれる。これまでは「両方に関数がある」ことしか見ていなかった。
 *
 * 画面の関数は画面の JS (app.js.html と js-*.html) の中から原文のまま切り出して動かす。写しを
 * テストに書くと、写しどうしを比べることになって意味が無い。
 */

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

  it('focusMusicParse_ / focusMusicPartsValid_ / focusMusicEmbedUrl_ / focusMusicLinkOf_', () => {
    // 自分の曲 (src/core/FocusMusic.js)。ずれると、保存できるのに流れない (または逆の) URL が出る
    const core = loadGas('src/core/FocusMusic.js');
    const VID = 'dQw4w9WgXcQ';
    const LIST = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
    const names = ['focusMusicRe_', 'focusMusicHosts_', 'focusMusicIsMix_', 'focusMusicSoundcloudReserved_',
      'focusMusicParse_', 'focusMusicQuery_', 'focusMusicPartsValid_', 'focusMusicEmbedUrl_', 'focusMusicLinkOf_'];
    const view = ui(names);
    const urls = [
      'https://www.youtube.com/watch?v=' + VID, 'https://youtu.be/' + VID, 'https://youtu.be/' + VID + '/',
      'https://www.youtube.com/playlist?list=' + LIST,
      'https://music.youtube.com/watch?v=' + VID + '&list=' + LIST, 'https://soundcloud.com/a/b',
      'https://soundcloud.com/a/sets/c', 'http://youtube.com/watch?v=' + VID, 'https://youtube.com.evil.com/x',
      'javascript:alert(1)', '', null, 'https://www.youtube.com/watch?v=' + VID + '&v=' + VID,
      'https://www.youtube.com/shorts/' + VID, 'https://soundcloud.com/discover/sets/x',
      // 大文字の場所・符号にした値・壊れた % の並び
      'HTTPS://WWW.YOUTUBE.COM/watch?v=' + VID, 'https://SoundCloud.com/a/b', 'https://YOUTU.BE/' + VID,
      'https://www.youtube.com/watch?v=' + encodeURIComponent(VID), 'https://www.youtube.com/watch?%76=' + VID,
      'https://www.youtube.com/watch?v=abc%26autoplay%3D1', 'https://www.youtube.com/watch?v=%E0%A4%A',
      'https://www.youtube.com/playlist?list=%zz', 'https://www.youtube.com/watch?v=' + VID + '&x=%',
      // ミックス (RD)・高く評価した動画 (LL)・後で見る (WL)・同じ list が2つ
      'https://www.youtube.com/playlist?list=RD' + VID, 'https://www.youtube.com/watch?v=' + VID + '&list=RD' + VID,
      'https://www.youtube.com/watch?v=' + VID + '&list=LL', 'https://www.youtube.com/watch?v=' + VID + '&list=WL',
      'https://www.youtube.com/playlist?list=LL', 'https://www.youtube.com/playlist?list=' + LIST + '&list=' + LIST,
      'https://www.youtube.com/embed/videoseries', 'https://www.youtube.com/embed/videoseries?list=' + LIST,
      'https://youtu.be/videoseries',
      // SoundCloud の、曲の名前の位置に来ても曲ではないもの・短いリンク
      'https://soundcloud.com/a/likes', 'https://soundcloud.com/a/tracks', 'https://soundcloud.com/a/reposts',
      'https://soundcloud.com/a/followers', 'https://soundcloud.com/a/popular-tracks', 'https://on.soundcloud.com/AbCd1',
    ];
    urls.forEach((u) => {
      const a = core.focusMusicParse_(u);
      const b = view.focusMusicParse_(u);
      expect(same(a, b), String(u)).toBe(true);
      const p = a.parts || { kind: 'x' };
      expect(view.focusMusicPartsValid_(p)).toBe(core.focusMusicPartsValid_(p));
      expect(view.focusMusicEmbedUrl_(p)).toBe(core.focusMusicEmbedUrl_(p));
      expect(view.focusMusicLinkOf_(p)).toBe(core.focusMusicLinkOf_(p));
    });
  });

  it('oshiGreetingOf (推しのあいさつの区切り)', () => {
    const core = loadGas('src/core/Oshi.js');
    const view = ui(['oshiGreetingOf']);
    for (let h = -1; h <= 24; h++) expect(view.oshiGreetingOf(h), String(h)).toBe(core.oshiGreetingOf(h));
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

  it('term / termFill (スクラムまわりの言葉)', () => {
    // 言葉の表は TERMS() が唯一の定義。画面の写しが1語でもずれると、同じ人に2つの言葉が混ざる
    const core = loadGas('src/core/Terms.js');
    const view = ui(['TERMS', 'term', 'termFill']);
    expect(same(view.TERMS(), core.TERMS())).toBe(true);
    const keys = Object.keys(core.TERMS()).concat(['', 'x', 'constructor', '__proto__', 'toString']);
    for (const style of ['plain', 'scrum', '', undefined, 'x']) {
      for (const k of keys) {
        expect(view.term(k, style)).toBe(core.term(k, style));
        const text = 'あ{' + k + '}い{' + pick(keys) + '}';
        expect(view.termFill(text, style)).toBe(core.termFill(text, style));
      }
    }
  });

  it('errorKindOf / nextStepOf / errorTextOf (断りの型と次にすること)', () => {
    // 型の表は src/core/ErrorKind.js。画面の写しが1つでもずれると、同じ断りに別の「次にすること」が出る
    const core = loadGas('src/core/ErrorKind.js');
    const names = ['ERROR_KIND_ENGLISH_', 'ERROR_KIND_PHRASES_', 'ERROR_NAME_SLOTS_', 'errorHeadOf_', 'errorBareOf_',
      'errorKindOf', 'nextStepOf', 'errorTextOf'];
    const view = ui(names);
    const words = ['混み合っています', '見つかりません', '開いたあとで', 'だけが行えます', '入れてください', '既にあります',
      'Exceeded maximum execution time', 'Lock timeout', 'Authorization is required', 'not found', 'boom', '',
      '混み合っています。少し待ってからもう一度お試しください', '途中まで済みましたが、混み合って続きができませんでした',
      // 英語の名前の人 (名前が文の頭に来る形)
      'Lock timeout さんの差し戻しが残っています', 'Not Found の反映結果を書き戻せません'];
    const glue = ['', ': ', '：', 'Error: ', 'Exception: ', '。', ' #3', '「x」', '「Lock timeout」'];
    for (let t = 0; t < 2000; t++) {
      const text = pick(glue) + pick(words) + pick(glue) + pick(words);
      expect(view.errorKindOf(text)).toBe(core.errorKindOf(text));
      expect(view.errorTextOf(text)).toBe(core.errorTextOf(text));
    }
    for (const k of ['busy', 'partial', 'quota', 'timeout', 'forbidden', 'gone', 'stale', 'invalid', 'unknown', '', 'constructor']) {
      expect(same(view.nextStepOf(k), core.nextStepOf(k))).toBe(true);
    }
    for (const v of [null, undefined, 3]) expect(view.errorKindOf(v)).toBe(core.errorKindOf(v));
    for (const w of words) for (const g of glue) {
      expect(view.errorKindOf(w + g)).toBe(core.errorKindOf(w + g));
      expect(view.errorKindOf(g + w)).toBe(core.errorKindOf(g + w));
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
    // 言葉は一般の言葉 (設定が届く前と同じ)。サーバの見出しも一般の言葉に固定してある
    const view = ui(['groupIssues', 'TERMS', 'term', 'termFill', 'termStyleNow', 'termIn'],
      { allFiles, splitPath, personName: (x) => x, prefs: null });
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
        sprint: pick(['', 'sprint001', 'sprint002', 'sprint010', 'constructor', '__proto__', '(未定)']),
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
