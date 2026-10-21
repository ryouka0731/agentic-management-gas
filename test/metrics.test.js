import { describe, it, expect } from 'vitest';
import { collect, summarize } from '../scripts/metrics.mjs';

// コードの測り (scripts/metrics.mjs)。docs/metrics-report.md の数はここから出す
describe('コードの測り', () => {
  const data = collect();
  const sum = summarize(data);

  it('src と kit のファイル、画面の部分ファイルを全部数える', () => {
    const files = data.files.map((f) => f.file);
    expect(files).toContain('src/core/PullRequest.gs');
    expect(files).toContain('kit/agent.mjs');
    expect(files).toContain('src/ui/js-pulls.html');
    // 焼き直した中身は数えない
    expect(files).not.toContain('src/ui/kit-files.html');
    expect(files.filter((f) => f.startsWith('src/ui/oshi-default/'))).toEqual([]);
  });

  it('画面を包む一番外の関数は1つの関数として数えない (数えると最長が1万行を超える)', () => {
    expect(sum.length.max).toBeLessThan(1000);
    expect(data.funcs.some((f) => f.file.startsWith('src/ui/js-'))).toBe(true);
  });

  it('分かれ道の数は if / 三項 / && などを数える', () => {
    const f = data.funcs.find((x) => x.name === 'prMergeBase_');
    expect(f.complexity).toBeGreaterThan(1);
    expect(sum.functions).toBe(data.funcs.length);
  });
});
