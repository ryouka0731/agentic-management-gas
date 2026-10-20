// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountFullstack } from './fullstack.js';

/*
 * つなぎ方そのもの。実物の google.script.run と同じ運び方をしているか。
 * ここが甘いと、通しのテストが実機では起きない形で通ってしまう。
 */

describe('画面と本物のサーバのつなぎ方', () => {
  it('返事はあとから届く。押した直後には何も返っていない', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    let got = 'まだ';
    window.google.script.run.withSuccessHandler((v) => { got = v; }).apiIssuePriorities();
    expect(got).toBe('まだ');
    await e2e.settle();
    expect(Array.isArray(got)).toBe(true);
  });

  it('Date が混ざった返事は画面に null で届く (実物と同じ)', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    e2e.ctx.apiProbeDate = () => ({ at: new Date() });
    // 呼べる名前は組んだ時点で決まるので、組み直す
    const again = e2e.as(e2e.user);
    await again.settle();
    let got = 'まだ';
    window.google.script.run.withSuccessHandler((v) => { got = v; }).apiProbeDate();
    await again.settle();
    expect(got).toBe(null);
  });

  it('サーバが投げたら失敗のハンドラに文が届く。成功のハンドラは呼ばれない', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    let ok = false;
    let err = null;
    window.google.script.run
      .withSuccessHandler(() => { ok = true; })
      .withFailureHandler((e) => { err = e; })
      .apiIssueUpdate(999, { title: 'x' });
    await e2e.settle();
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('#999');
    expect(e2e.failures.map((f) => f.name)).toContain('apiIssueUpdate');
  });

  it('返事は写しで届く。画面が書き換えてもサーバの物は変わらない', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    const keep = [{ name: 'もと' }];
    e2e.ctx.apiProbeShared = () => keep;
    const again = e2e.as(e2e.user);
    await again.settle();
    window.google.script.run.withSuccessHandler((v) => { v[0].name = '画面'; }).apiProbeShared();
    await again.settle();
    expect(keep[0].name).toBe('もと');
  });

  it('画面の返事のハンドラが投げたら、settle で表に出す (黙って握らない)', async () => {
    const e2e = mountFullstack();
    await e2e.settle();
    window.google.script.run.withSuccessHandler(() => { throw new Error('描けない'); }).apiIssuePriorities();
    await expect(e2e.settle()).rejects.toThrow('描けない');
  });
});
