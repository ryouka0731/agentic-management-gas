// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * 設定の画面の「成果の数」(管理者だけ)。週ごとの棒・数の意味・3人に届かない週は出さない。
 * 返事の形はサーバの apiOutcomes (test/api/outcomes.test.js) に合わせてある。
 */

const $ = (s) => document.querySelector(s);

function week(start, end, o) {
  return Object.assign({ start, end, days: 7, people: 4, hidden: false, moved: 0, closedClean: 0, mergedClean: 0,
    reopened: 0, busyErrors: 0, timeoutErrors: 0, overdue: 0, fxOff: 0 }, o);
}
const HIDDEN = { people: null, hidden: true, moved: null, closedClean: null, mergedClean: null, reopened: null,
  busyErrors: null, timeoutErrors: null, overdue: null, fxOff: null };

const DATA = {
  minPeople: 3,
  since: '2026-09-28',
  // 新しい週から
  weeks: [
    week('2026-10-12', '2026-10-18', { moved: 4, closedClean: 3, overdue: 2 }),
    week('2026-10-05', '2026-10-11', Object.assign({}, HIDDEN)),
    week('2026-09-28', '2026-10-04', { moved: 2, closedClean: 1, overdue: 5 }),
  ],
};

function openSettings(over) {
  const app = mount(over);
  $('[data-tab="settings"]').click();
  return app;
}

describe('成果の数', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('数ごとに意味と週ごとの棒を出し、見張りには印を付ける', () => {
    openSettings({ apiOutcomes: DATA });
    const box = $('#outcomes-settings');
    expect(box).not.toBe(null);
    const rows = box.querySelectorAll('.outcome-row');
    expect(rows).toHaveLength(8);
    const moved = box.querySelector('[data-outcome="moved"]');
    expect(moved.textContent).toContain('止まっていた仕事が動いた');
    expect(moved.textContent).toContain('7日以上');
    expect(moved.querySelector('.outcome-now').textContent).toBe('先週 4');
    // 古い週が左。3人に届かない週は点線の枠だけ
    const bars = moved.querySelectorAll('rect');
    expect(bars).toHaveLength(3);
    expect(bars[1].getAttribute('class')).toContain('outcome-bar-hidden');
    expect(bars[1].querySelector('title').textContent).toContain('3人に届かない');
    expect(Number(bars[2].getAttribute('height'))).toBeGreaterThan(Number(bars[0].getAttribute('height')));
    expect(moved.querySelector('svg').getAttribute('role')).toBe('img');
    expect(box.querySelector('[data-outcome="overdue"]').textContent).toContain('見張り');
    expect(box.querySelector('[data-outcome="moved"]').textContent).not.toContain('見張り');
    expect(box.textContent).toContain('3人に届かない週');
    expect(box.textContent).not.toMatch(/@/);
  });

  it('先週が3人に届かなければ、数を出さないと言う', () => {
    openSettings({ apiOutcomes: { minPeople: 3, since: '2026-10-01', weeks: [week('2026-10-12', '2026-10-18', HIDDEN)] } });
    expect($('[data-outcome="moved"] .outcome-now').textContent).toBe('出しません');
  });

  it('まだ数えていなければ、いつから貯まるかを言う', () => {
    openSettings();
    expect($('#outcomes-body').textContent).toContain('まだ数えていません');
  });

  it('取れなければ器に理由と次にすることを出す', () => {
    openSettings({ apiOutcomes: new Error('この操作は、このアプリの管理者 (持ち主と、入れ物のフォルダを編集できる人) だけが行えます') });
    expect($('#outcomes-body .fail-text').textContent).toContain('管理者');
    expect($('#outcomes-body .fail-next').textContent).toMatch(/^次にすること: /);
  });

  it('管理者でなければ節を出さず、尋ねもしない', () => {
    const app = openSettings({ apiSettings: Object.assign({}, DEFAULTS.apiSettings, { canEdit: false }) });
    expect($('#outcomes-settings')).toBe(null);
    expect(app.calls.some((c) => c.name === 'apiOutcomes')).toBe(false);
  });
});
