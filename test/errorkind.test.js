import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { errorTexts, serverSources } from './error-texts.js';

/*
 * 断りの型 (src/core/ErrorKind.js)。設計: docs/superpowers/specs/2026-10-21-motivation-review-2.md の D.1。
 *
 * 断りの字は変えずに、決まった言い回しから型を引く。**今ある断り文が全部どれかの型に当たるか**
 * を走査する (test/naming.test.js と同じ拾い方)。当たらない文を足したら、ここで落ちる。
 * そのときは ErrorKind.js の言い回しに足す (断り文を言い換えない)。
 */

const core = loadGas('src/core/ErrorKind.js');
const KINDS = ['busy', 'timeout', 'forbidden', 'gone', 'stale', 'invalid'];

describe('今ある断り文が全部どれかの型に当たる', () => {
  const all = serverSources().flatMap((f) => errorTexts(fs.readFileSync(f, 'utf8')).map((t) => ({ f, t })));

  it('断り文を拾えている', () => {
    // 拾い方が壊れて空になると、下の検査は何も見ずに通る
    expect(all.length).toBeGreaterThan(150);
  });

  it('型に当たらない断り文が無い', () => {
    const miss = all.filter(({ t }) => core.errorKindOf(t) === 'unknown').map(({ f, t }) => f + ': ' + t);
    expect(miss).toEqual([]);
  });

  it('決まった断りは決まった型になる', () => {
    const want = {
      '混み合っています。少し待ってからもう一度お試しください': 'busy',
      '開いたあとで、この文書が直されています。いまの中身を読み込み直してから直してください': 'stale',
      '見比べたあとで、反映先か改訂版が進みました。見比べ直してから反映してください': 'stale',
      '開いたあとに、ほかの記録が先に入りました。画面を再読み込みしてから、もう一度記録してください': 'stale',
      '承認のあとに中身が変わっています。もう一度確認して承認してもらってください': 'stale',
      'やることが見つかりません: #3': 'gone',
      '対象の文書が Drive で消されているため、反映せずに取り下げました: 就業規則': 'gone',
      'この操作は、このアプリの管理者 (持ち主と、入れ物のフォルダを編集できる人) だけが行えます': 'forbidden',
      '改訂版を捨てられるのは、作った本人か、このアプリの管理者だけです': 'forbidden',
      '自分が書いたものだけ直せます': 'forbidden',
      'ゴミ箱へ移せませんでした。共有ドライブで消すには「コンテンツ管理者」以上の役割が要ります (writer)': 'forbidden',
      '題名を入れてください': 'invalid',
      '同じ名前の改訂版が既にあります: 「見直し」': 'invalid',
      '反映には1件以上の承認が必要です': 'invalid',
    };
    for (const [text, kind] of Object.entries(want)) expect(core.errorKindOf(text), text).toBe(kind);
  });

  it('名前や番号の部分に書かれた字では型を変えない', () => {
    // 題名は人が書く。「見つかりません」という名前の改訂版でも、重なりの断りのまま
    expect(core.errorKindOf('同じ名前の改訂版が既にあります: 「見つかりません」')).toBe('invalid');
    expect(core.errorKindOf('タグの名前が正しくありません: 混み合っています')).toBe('invalid');
  });
});

describe('英語の実行時エラー', () => {
  const cases = [
    ['Exceeded maximum execution time', 'timeout'],
    ['Exception: Service Spreadsheets failed while accessing document with id abc.', 'timeout'],
    ['NetworkError: Connection failure due to HTTP 0', 'timeout'],
    ['Service invoked too many times for one day: email.', 'busy'],
    ['Lock timeout: another process was holding the lock for too long.', 'busy'],
    ['Exception: Address unavailable: https://example.com', 'busy'],
    ['Authorization is required to perform that action.', 'forbidden'],
    ['Exception: You do not have permission to call DriveApp.getFolderById.', 'forbidden'],
    ['Exception: No item with the given ID could be found. Possibly because you have not edited this item or you do not have permission to access it.', 'gone'],
    ['Document is missing (perhaps it was deleted, or you don\'t have read access?)', 'gone'],
  ];

  it.each(cases)('%s は %s', (text, kind) => {
    expect(core.errorKindOf(text)).toBe(kind);
  });

  it('知らない英語・空は unknown', () => {
    expect(core.errorKindOf('TypeError: x is not a function')).toBe('unknown');
    expect(core.errorKindOf('')).toBe('unknown');
    expect(core.errorKindOf(null)).toBe('unknown');
    expect(core.errorKindOf(undefined)).toBe('unknown');
  });

  it('前に付いた Error: を外して日本語の文を読む', () => {
    expect(core.errorKindOf('Error: 混み合っています。少し待ってからもう一度お試しください')).toBe('busy');
    expect(core.errorKindOf('Exception: やることが見つかりません: #1')).toBe('gone');
  });

  it('英語は日本語に言い換え、日本語の文はそのまま出す', () => {
    expect(core.errorTextOf('Exceeded maximum execution time')).toBe('時間がかかりすぎて、途中で止まりました');
    expect(core.errorTextOf('Authorization is required to perform that action.')).toBe('この操作をする権限がありません');
    expect(core.errorTextOf('TypeError: x is not a function')).toBe('思いがけない理由でできませんでした');
    expect(core.errorTextOf('題名を入れてください')).toBe('題名を入れてください');
    for (const [text] of cases) expect(core.errorTextOf(text)).toMatch(/[぀-ヿ一-鿿]/);
  });
});

describe('次にすること', () => {
  it('もう一度押してよいのは busy だけ', () => {
    for (const k of KINDS.concat(['unknown', '', 'x', 'constructor', '__proto__'])) {
      const step = core.nextStepOf(k);
      expect(typeof step.text).toBe('string');
      expect(step.text.length).toBeGreaterThan(5);
      expect(step.retry).toBe(k === 'busy');
    }
  });

  it('時間切れは、押し直す前に確かめるよう言う', () => {
    expect(core.nextStepOf('timeout').text).toContain('確かめて');
    expect(core.nextStepOf('gone').text).toContain('ゴミ箱');
    expect(core.nextStepOf('stale').text).toContain('開き直して');
  });

  it('Git の言葉を使わない', () => {
    const words = /PR|マージ|プルリクエスト|ブランチ|コミット|Issue/;
    for (const k of KINDS.concat('unknown')) expect(core.nextStepOf(k).text).not.toMatch(words);
  });
});
