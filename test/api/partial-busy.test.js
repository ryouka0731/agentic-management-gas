import { describe, it, expect } from 'vitest';
import { loadGas } from '../harness.js';
import { makeEnv } from './setup.js';

/*
 * 鍵を続けて取る操作で、2つ目からが混み合ったとき。
 *
 * やることを作る (番号を振る → カードを置く → 担当を書く) や、報告を受け付ける (番号を振る → やることを積む
 * → 結び付ける) は、鍵を何度か取る。2つ目で断られたときには1つ目の行がもう書かれている。そのとき
 * 「混み合っています」と言うと画面は [もう一度] を出し、押すと同じものが2つできる。
 * 途中まで済んだことを別の字で言い、押し直しを勧めない型 (partial) にする。
 */

const kind = loadGas('src/core/ErrorKind.js');

/** 最初の n 回だけ鍵が取れる */
function locksFor(ctx, n) {
  let k = 0;
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => k++ < n, releaseLock: () => {} }) };
}

function refusal(fn) {
  try {
    fn();
  } catch (e) {
    return String(e.message);
  }
  return null;
}

describe('途中まで書いてから混み合ったら、押し直しを勧めない', () => {
  it('やることを作る: 番号のあとのカードで断られたら partial。押し直す手立ては出ない', () => {
    const { ctx } = makeEnv({ file: false });
    locksFor(ctx, 1);
    const msg = refusal(() => ctx.apiIssueCreate('就業規則の読み合わせ', '', []));
    expect(msg).toBe(ctx.DB_PARTIAL_TEXT());
    expect(kind.errorKindOf(msg)).toBe('partial');
    expect(kind.nextStepOf(kind.errorKindOf(msg)).retry).toBe(false);
    expect(ctx.dbReadAll('issues')).toHaveLength(1);
  });

  it('最初の鍵で断られたら、何も書いていないので busy (押し直してよい)', () => {
    const { ctx } = makeEnv({ file: false });
    locksFor(ctx, 0);
    const msg = refusal(() => ctx.apiIssueCreate('就業規則の読み合わせ', '', []));
    expect(kind.errorKindOf(msg)).toBe('busy');
    expect(ctx.dbReadAll('issues')).toHaveLength(0);
  });

  it('報告を受け付ける: やることを積んだあと、結び付けるところで断られたら partial', () => {
    const { ctx } = makeEnv({ file: false });
    // 報告の行にやることの番号を書くところ (dbUpdate('inquiries')) の鍵だけ取れない
    let refuse = false;
    const real = ctx.dbUpdate;
    ctx.dbUpdate = function (table) {
      if (table === 'inquiries') refuse = true;
      try {
        return real.apply(this, arguments);
      } finally {
        refuse = false;
      }
    };
    ctx.LockService = { getScriptLock: () => ({ tryLock: () => !refuse, releaseLock: () => {} }) };
    const msg = refusal(() => ctx.apiInquiryCreate('bug', '棒が伸びない', '画面: 工程表'));
    expect(msg).toBe(ctx.DB_PARTIAL_TEXT());
    expect(kind.nextStepOf(kind.errorKindOf(msg)).retry).toBe(false);
    expect(ctx.dbReadAll('inquiries')).toHaveLength(1);
    expect(ctx.dbReadAll('issues')).toHaveLength(1);
  });

  it('別の呼び出し (別の実行) では、前の呼び出しで書いたことを持ち越さない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiIssueCreate('先に作った', '', []);
    locksFor(ctx, 0);
    expect(kind.errorKindOf(refusal(() => ctx.apiIssueCreate('次', '', [])))).toBe('busy');
  });
});
