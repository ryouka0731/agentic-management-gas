import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { ISSUE_SOURCES } from './sources.js';

/*
 * 知らせの言い方の決まり (docs/dev/notifications.md / 設計 docs/superpowers/specs/2026-11-06-notifications-design.md §3)。
 *
 * - メールの本文の最後は必ず「次にすること: …」の1行
 * - 件名の形 [SoftBanto] 何の #番号 どうなったか は変えない
 * - 画面の知らせ (noticeAdd) の本文に次にすることを書かない (開く先がある)
 * - 責める言葉を見出しにしない
 */

const ROOT = path.resolve(__dirname, '..');
const OWNER = 'owner@example.com';
const PEOPLE = ['a@example.com', 'b@example.com'];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...ISSUE_SOURCES);
  ctx.repoInit('agentic-management');
  ctx.DriveApp.getFolderById(ctx.repoConfig().rootId)._setOwner(OWNER);
  return { ctx, fake };
}

const PR = { number: 12, title: '第2条の改訂', author: 'author@example.com', reviewers: PEOPLE.join(',') };
const ISSUE = { number: 5, title: '通勤手当の見直し' };
const INQ = { number: 3, kind: 'bug', title: '棒が伸びない', body: '工程表の棒が伸びない', by: 'c@example.com', context: '画面: 工程表' };
const GOAL = { id: 4, title: '手続きを速くする', who: 'member@example.com', managerNote: 'いいですね', finalGrade: 'A' };

/** Notifier.gs の知らせの関数を全部呼ぶ。名前 → 呼び方 */
const CALLS = {
  notifyPrCreated: (c) => c.notifyPrCreated(PR, ['第2条: 追加']),
  notifyPrMerged: (c) => c.notifyPrMerged(PR),
  notifyPrClosed: (c) => c.notifyPrClosed(PR, '別の改訂版にまとめました'),
  notifyPrReviewRequested: (c) => c.notifyPrReviewRequested(PR, PEOPLE[0], ['第2条: 追加']),
  notifyInquiry: (c) => c.notifyInquiry(INQ),
  notifyInquiryReply: (c) => c.notifyInquiryReply(INQ, { by: 'c@example.com', body: '直りました' }, PEOPLE),
  notifyInquiryMention: (c) => c.notifyInquiryMention(INQ, { by: 'c@example.com', body: '@a 見てください' }, PEOPLE),
  notifyPrMention: (c) => c.notifyPrMention(PR, { reviewer: 'c@example.com', body: '@a ここ' }, PEOPLE[0]),
  notifyIssueComment: (c) => c.notifyIssueComment(ISSUE, { by: 'c@example.com', body: '進めます' }, PEOPLE),
  notifyIssueCommentMention: (c) => c.notifyIssueCommentMention(ISSUE, { by: 'c@example.com', body: '@a お願い' }, PEOPLE),
  notifyGoalSubmitted_: (c) => { c.notifyGoalSubmitted_(GOAL, PEOPLE, '山田', false); c.notifyGoalSubmitted_(GOAL, PEOPLE, '山田', true); },
  notifyGoalDecided_: (c) => { c.notifyGoalDecided_(GOAL, 'approve'); c.notifyGoalDecided_(GOAL, 'return'); },
  notifyGoalGraded_: (c) => c.notifyGoalGraded_(GOAL),
  notifyGoalWithdrawn_: (c) => c.notifyGoalWithdrawn_(GOAL, PEOPLE, '山田'),
};

/** 1つの関数を呼び、送ったメールと残した知らせを返す */
function run(name) {
  const { ctx, fake } = setup();
  const before = fake._sentMails().length;
  CALLS[name](ctx);
  return {
    mails: fake._sentMails().slice(before),
    notices: ctx.dbReadAll('notifications'),
  };
}

function lastLine(text) {
  const lines = String(text).split('\n');
  return lines[lines.length - 1];
}

describe('知らせの言い方 (やること #108)', () => {
  it('Notifier.gs の知らせの関数を、このテストが全部呼んでいる (足したら CALLS にも足す)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/core/Notifier.gs'), 'utf8');
    const helpers = ['notify', 'notifySubject_', 'notifyBody_', 'notifySummaryText_'];
    const found = [...text.matchAll(/^function (notify\w*)\(/gm)].map((m) => m[1]).filter((n) => !helpers.includes(n));
    expect(found.sort()).toEqual(Object.keys(CALLS).sort());
  });

  for (const name of Object.keys(CALLS)) {
    it(name + ': メールは本文の最後が「次にすること: …」の1行で、件名の形は変わらない', () => {
      const { mails } = run(name);
      expect(mails.length, name).toBeGreaterThan(0);
      for (const m of mails) {
        expect(lastLine(m.body), name + ': ' + m.subject).toMatch(/^次にすること: \S/);
        // 「次にすること」は1通に1行だけ
        expect(m.body.split('次にすること:').length, m.subject).toBe(2);
        expect(m.subject).toMatch(/^\[SoftBanto\] (確認依頼|報告|やること|目標) #\d+ \S/);
        // 責める言葉を見出しにしない
        expect(m.subject + '\n' + m.body).not.toMatch(/期限切れ|滞って|未対応/);
      }
    });
  }

  it('画面の知らせの本文には次にすることを書かない (開く先がある)。見出しも責めない', () => {
    for (const name of Object.keys(CALLS)) {
      for (const n of run(name).notices) {
        expect(String(n.body), name).not.toContain('次にすること');
        expect(String(n.title), name).not.toMatch(/期限切れ|滞って|未対応/);
        expect(String(n.link), name).not.toBe('');
      }
    }
  });

  it('確認を頼まれた: 「あなたを待っています」と、押すボタンを添える', () => {
    const { mails, notices } = run('notifyPrReviewRequested');
    expect(mails[0].subject).toBe('[SoftBanto] 確認依頼 #12 があなたを待っています');
    expect(lastLine(mails[0].body)).toBe('次にすること: 「確認依頼」で中身を見て、「承認」か「直してほしい」を返してください');
    expect(notices.map((n) => n.title)).toEqual(['確認依頼 #12 があなたを待っています']);
  });

  it('やることに返事が来た: 見出しは「返事が来ました」、次は #番号 を開いて続きを書く', () => {
    const { mails, notices } = run('notifyIssueComment');
    expect(mails[0].subject).toBe('[SoftBanto] やること #5 に返事が来ました');
    expect(lastLine(mails[0].body)).toBe('次にすること: 「やること」#5 を開いて、続きを書いてください');
    expect(notices[0].title).toBe('やること #5 に c@example.com から返事が来ました');
  });

  it('取り下げ: 「要らなくなりました」。理由は本文の中に置き、次にすることは「ありません」', () => {
    const { mails, notices } = run('notifyPrClosed');
    expect(mails[0].subject).toBe('[SoftBanto] 確認依頼 #12 は要らなくなりました');
    expect(mails[0].body).toContain('別の改訂版にまとめました');
    expect(lastLine(mails[0].body)).toBe('次にすること: ありません');
    expect(notices[0].title).toBe('確認依頼 #12 は要らなくなりました (改訂版は残っています)');
  });

  it('目標の差し戻しは責めない言い方で、直して頼み直す一歩を添える', () => {
    const { mails } = run('notifyGoalDecided_');
    const back = mails.find((m) => m.subject.includes('直してほしいところ'));
    expect(back.subject).toBe('[SoftBanto] 目標 #4 に直してほしいところが返ってきました');
    expect(lastLine(back.body)).toBe('次にすること: 「目標」で上長のひとことを見て、直してから承認を頼み直してください');
    expect(mails.map((m) => m.subject).join('\n')).not.toContain('差し戻されました');
  });

  it('報告に補足が無くても、本文は「次にすること」で終わる (空の行を挟まない)', () => {
    const { ctx, fake } = setup();
    ctx.notifyInquiry(Object.assign({}, INQ, { context: '' }));
    const body = fake._sentMails().pop().body;
    expect(body).not.toMatch(/\n\n\n/);
    expect(lastLine(body)).toBe('次にすること: 「報告」#3 を開いて、返事を書いてください');
  });

  it('メールに推しの一言は入れない (本人の画面にだけ)', () => {
    const lines = Object.values(loadGas('src/core/Oshi.js').OSHI_LINES()).flatMap((t) => t.notice || []);
    expect(lines.length).toBeGreaterThan(0);
    for (const name of Object.keys(CALLS)) {
      for (const m of run(name).mails) for (const l of lines) expect(m.body).not.toContain(l);
    }
  });
});
