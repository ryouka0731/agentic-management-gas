import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { makeEnv, asUser, expectScreenSafe } from './api/setup.js';

/*
 * 文書の見直しの期日 (やること #112)。計算は RecurrenceRule.js の reviewIssueDue (ピュア)、台帳と起票は FileReview.gs、
 * 口は apiFileReviewSet と apiListFiles の見直しの欄。1日1回の回は繰り返しと同じ recurrenceDailyOnce_。日は東京の暦日。
 */

const MEMBER = 'member@example.com';

function tokyo(day, hm) {
  return new Date(day + 'T' + (hm || '09:00') + ':00+09:00');
}

function daily(env, at) {
  const props = env.ctx.PropertiesService.getScriptProperties();
  props.setProperty('ARCHIVE_HOUSEKEPT_ON', env.ctx.recurrenceTodayOf(at.getTime()));
  props.deleteProperty('RECURRENCE_ON');
  return env.ctx.recurrenceDailyOnce_(at);
}

const reviews = (env) => env.ctx.dbReadAll('issues').filter((r) => /の見直し \(期日/.test(String(r.title)));

describe('作るか (ピュア)', () => {
  const gas = loadGas('src/core/RecurrenceRule.js');

  it('期日の N 日前 (既定30) から、その期日のぶんをまだ作っていなければ作る', () => {
    expect(gas.reviewIssueDue('2026-12-31', '', '', '2026-11-30')).toBe(false);
    expect(gas.reviewIssueDue('2026-12-31', '', '', '2026-12-01')).toBe(true);
    expect(gas.reviewIssueDue('2026-12-31', 10, '', '2026-12-20')).toBe(false);
    expect(gas.reviewIssueDue('2026-12-31', 10, '', '2026-12-21')).toBe(true);
    // 作った期日と同じなら、期日が過ぎても作らない
    expect(gas.reviewIssueDue('2026-12-31', 30, '2026-12-31', '2027-01-15')).toBe(false);
    // 期日を変えれば印と食い違うので作る
    expect(gas.reviewIssueDue('2027-06-30', 30, '2026-12-31', '2027-06-01')).toBe(true);
    expect(gas.reviewIssueDue('', 30, '', '2027-06-01')).toBe(false);
  });
});

describe('見直しの期日', () => {
  it('設定が台帳に残り、一覧に期日・担当・何日前・残り日数が出る', () => {
    const env = makeEnv();
    const got = asUser(env.fake, MEMBER, () => env.ctx.apiFileReviewSet(env.fileId, '2099-12-31', MEMBER, ''));
    expect(got.reviewDue).toBe('2099-12-31');
    expect(got.reviewNoticeDays).toBe(30);
    const row = env.ctx.dbFindOne('files', 'fileId', env.fileId);
    expect(env.ctx.plainDay(row.reviewDue)).toBe('2099-12-31');
    expect(row.reviewAssignee).toBe(MEMBER);

    const list = expectScreenSafe(env.ctx.apiListFiles());
    const one = list.find((f) => f.fileId === env.fileId);
    const today = env.ctx.recurrenceTodayOf(Date.now());
    expect(one.reviewDue).toBe('2099-12-31');
    expect(one.reviewAssignee).toBe(MEMBER);
    expect(one.reviewDaysLeft).toBe(env.ctx.recurrenceDaysBetween(today, '2099-12-31'));

    // 外すと期日と担当が空になり、一覧にも出ない
    env.ctx.apiFileReviewSet(env.fileId, '', MEMBER, 30);
    const off = env.ctx.apiListFiles().find((f) => f.fileId === env.fileId);
    expect(off.reviewDue).toBe('');
    expect(off.reviewAssignee).toBe('');
    expect(off.reviewDaysLeft).toBe('');
  });

  it('残り日数は過ぎていれば負', () => {
    const env = makeEnv();
    const today = env.ctx.recurrenceTodayOf(Date.now());
    env.ctx.apiFileReviewSet(env.fileId, env.ctx.recurrenceShift(today, -3), '', 30);
    expect(env.ctx.apiListFiles().find((f) => f.fileId === env.fileId).reviewDaysLeft).toBe(-3);
  });

  it('日付でないもの・改訂版の文書・登録していない文書は断る', () => {
    const env = makeEnv();
    expect(() => env.ctx.apiFileReviewSet(env.fileId, '2026-02-30', '', 30)).toThrow(/日付/);
    expect(() => env.ctx.apiFileReviewSet(env.fileId, '2026-12-31', '', 400)).toThrow(/0〜365/);
    expect(() => env.ctx.apiFileReviewSet('nope', '2026-12-31', '', 30)).toThrow(/登録されていません/);
    env.ctx.apiBranchCreate('改訂', env.fileId);
    const work = env.ctx.branchWorkingFileId('改訂', env.fileId);
    expect(() => env.ctx.apiFileReviewSet(work, '2026-12-31', '', 30)).toThrow(/正式版の文書/);
  });

  it('30日前に1つだけ作る。文書に結び付け、担当と期限 (= 期日) を付ける。翌日に二度作らない', () => {
    const env = makeEnv();
    env.ctx.apiFileReviewSet(env.fileId, '2026-12-31', MEMBER, '');
    daily(env, tokyo('2026-11-30'));
    expect(reviews(env)).toHaveLength(0);

    daily(env, tokyo('2026-12-01'));
    const made = reviews(env);
    expect(made).toHaveLength(1);
    expect(made[0].title).toBe('就業規則.doc の見直し (期日 12月31日)');
    expect(String(made[0].linkedFileIds)).toBe(env.fileId);
    expect(made[0].assignee).toBe(MEMBER);
    expect(env.ctx.plainDay(made[0].dueDate)).toBe('2026-12-31');
    expect(env.ctx.plainDay(env.ctx.dbFindOne('files', 'fileId', env.fileId).reviewIssuedFor)).toBe('2026-12-31');

    daily(env, tokyo('2026-12-02'));
    // 期日が過ぎても、次の期日を決めるまでは作り続けない
    daily(env, tokyo('2027-01-10'));
    expect(reviews(env)).toHaveLength(1);
  });

  it('期日を変えると、新しい期日のぶんを1つ作る', () => {
    const env = makeEnv();
    env.ctx.apiFileReviewSet(env.fileId, '2026-12-31', '', 30);
    daily(env, tokyo('2026-12-01'));
    env.ctx.apiFileReviewSet(env.fileId, '2027-12-31', '', 10);
    daily(env, tokyo('2027-12-20'));
    expect(reviews(env)).toHaveLength(1);
    daily(env, tokyo('2027-12-21'));
    const made = reviews(env);
    expect(made).toHaveLength(2);
    expect(made.map((r) => r.title)).toContain('就業規則.doc の見直し (期日 12月31日)');
    expect(made.filter((r) => env.ctx.plainDay(r.dueDate) === '2027-12-31')).toHaveLength(1);
  });

  it('鍵が取れなかったら済みの印を付けず、次の回に作る', () => {
    const env = makeEnv();
    env.ctx.apiFileReviewSet(env.fileId, '2026-12-31', '', 30);
    const real = env.ctx.fileReviewIssueOne_;
    env.ctx.fileReviewIssueOne_ = () => false;
    env.ctx.PropertiesService.getScriptProperties().setProperty('ARCHIVE_HOUSEKEPT_ON', '2026-12-01');
    env.ctx.recurrenceDailyOnce_(tokyo('2026-12-01'));
    expect(env.ctx.PropertiesService.getScriptProperties().getProperty('RECURRENCE_ON')).toBe(null);
    env.ctx.fileReviewIssueOne_ = real;
    env.ctx.recurrenceDailyOnce_(tokyo('2026-12-01', '09:01'));
    expect(reviews(env)).toHaveLength(1);
  });
});
