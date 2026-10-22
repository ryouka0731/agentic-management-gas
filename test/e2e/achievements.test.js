// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountFullstack, go, click, byText } from './fullstack.js';

/*
 * 実績を通しで: 開いた1日目 → 「はじめの一日」→ はじめてやることを済ませる → 「はじめて片づけた」と推しのお祝い → Lv が上がる。
 * 何も仕込まない (人がたどる順に通す)。返事は本物のサーバ (疑似GAS) が返す。
 */

const $ = (s) => document.querySelector(s);
const ME = 'tester@example.com';

describe('実績を取って推しのレベルが上がる', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('開いた日 → 済ませる → 実績と推しのお祝い → Lv が上がる。ほかの人には見えない', async () => {
    const e2e = mountFullstack();
    await e2e.settle();

    // 1. 開いた1日目。「はじめの一日」を取り、推しは Lv 2
    expect(e2e.ctx.achDaysRead_(ME).n).toBe(1);
    expect($('#ach-toast').textContent).toContain('実績「はじめの一日」を取りました');
    expect($('#ach-toast').textContent).toContain('Lv 2');
    expect($('#oshi-bubble').dataset.event).toBe('badge');
    expect(e2e.ctx.apiOshiGet().growth.level).toBe(2);
    click($('#oshi-bubble .oshi-close'));

    // 2. はじめてやることを済ませる → 推しがほめ、消えたあとに「実績を取った」
    e2e.ctx.issueCreate('慶弔規程の見直し', '', []);
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label$="を完了にする"]')); await e2e.settle();
    expect($('#ach-toast').textContent).toContain('実績「はじめて片づけた」を取りました');
    expect($('#ach-toast').textContent).toContain('Lv 3');
    expect($('#oshi-bubble').dataset.event).toBe('done');
    click($('#oshi-bubble .oshi-close'));
    expect($('#oshi-bubble').dataset.event).toBe('badge');
    expect(e2e.ctx.OSHI_LINES().buddy.badge).toContain($('#oshi-bubble .oshi-line').textContent);

    // 3. 推しの育ちは Lv 3 (ホームのカードも揃っている)
    expect(e2e.ctx.apiOshiGet().growth).toMatchObject({ level: 3, key: 'grow1' });
    go('home'); await e2e.settle();
    expect($('#home-cards .oshi-card .oshi-stage').textContent).toContain('Lv 3');
    expect($('#home-cards .ach-card').textContent).toContain('はじめて片づけた');

    // 4. 自分 → 実績。取ったものと ??? が並ぶ
    click($('#me-btn'));
    click(byText('#me-body button', '実績')); await e2e.settle();
    expect($('.ach-page .ach-badge[data-ach="done-1"] .ach-name').textContent).toBe('はじめて片づけた');
    expect($('.ach-page .ach-badge[data-ach="done-10"] .ach-name').textContent).toBe('???');

    // 5. 同じ日にもう一度開いても、開いた日は増えない
    const again = e2e.as(ME);
    await again.settle();
    expect(e2e.ctx.achDaysRead_(ME).n).toBe(1);

    // 6. 完了を取り消しても実績は消えず、Lv も下がらない (4 で実績の頁を開いたので「実績の頁を見た」も取れている)
    e2e.ctx.issueReopen(1);
    expect(e2e.ctx.apiAchievements().unlocked.map((a) => a.key).sort()).toEqual(['days-1', 'done-1', 'first-achPage']);
    expect(e2e.ctx.apiOshiGet().growth.level).toBe(4);

    // 7. ほかの人には見えない (その人の実績は自分の1日目だけ)
    const other = e2e.as('b@example.com');
    await other.settle();
    other.fake._setUser('b@example.com');
    // apiAchievements は頁を開いたことでもあるので「実績の頁を見た」も付く (ほかの人の実績は入らない)
    expect(other.ctx.apiAchievements().unlocked.map((a) => a.key).sort()).toEqual(['days-1', 'first-achPage']);
  });
});
