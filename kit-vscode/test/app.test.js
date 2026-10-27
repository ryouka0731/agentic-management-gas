'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../lib/app');

/*
 * 拡張の動きを、vscode の代わり (ui) と番頭の代わり (queue) で通す。
 */

const T = (hm) => Date.parse('2026-10-28T' + hm + ':00+09:00');
const flush = () => new Promise((done) => setImmediate(done));

function harness(o) {
  const calls = { info: [], warn: [], open: [], status: [], issues: [], log: [], settings: 0 };
  let clock = o.now;
  const answers = o.answers;
  const sent = [];
  const ui = {
    info: (m, ...rest) => { calls.info.push([m, ...rest]); return Promise.resolve(o.pick ? o.pick(m, rest) : undefined); },
    warn: (m, ...rest) => { calls.warn.push([m, ...rest]); return Promise.resolve(o.warnPick); },
    open: (u) => { calls.open.push(u); },
    status: (t) => { calls.status.push(t); },
    issues: (items, hint) => { calls.issues.push({ items, hint }); },
    log: (l) => { calls.log.push(l); },
    openSettings: () => { calls.settings++; },
  };
  const settings = Object.assign({ kitDir: '/kit', email: 'me@example.com', pollMinutes: 5, autoOpen: false, oshi: true }, o.settings || {});
  const app = createApp({
    ui,
    settings: () => settings,
    now: () => clock,
    random: () => 0,
    connect: () => (o.noQueue ? { queue: null, reason: '道具のフォルダが決まっていません' } : {
      queue: {
        send: async (op, args) => {
          sent.push(op);
          const a = answers[op];
          if (a instanceof Error) throw a;
          return typeof a === 'function' ? a(args) : a;
        },
        dispose: () => {},
      },
      reason: '',
    }),
  });
  return { app, calls, sent, settings, setNow: (t) => { clock = t; } };
}

const CAL = {
  day: '2026-10-28',
  events: [
    { start: '2026-10-28T01:00:00.000Z', end: '2026-10-28T01:30:00.000Z', title: '朝会', meetUrl: 'https://meet.google.com/abc-defg-hij', eventUrl: null },
    { start: '2026-10-28T04:00:00.000Z', end: '2026-10-28T05:00:00.000Z', title: '打ち合わせ', meetUrl: null, eventUrl: null },
  ],
};

function answers(more) {
  return Object.assign({
    issueList: [{ number: 1, title: '直す', state: 'open', assignees: ['me@example.com'], body: '本文' }],
    homeMine: { reviews: [], returned: [], due: [] },
    calendarToday: CAL,
    oshiSpinner: { on: true, name: '推し', lines: ['がんばろう'] },
  }, more || {});
}

test('入れ先が無ければ一度だけ案内し、何も頼まない', async () => {
  const h = harness({ now: T('08:00'), answers: answers(), noQueue: true, warnPick: '設定を開く' });
  h.app.start();
  h.app.tick();
  await flush();
  assert.equal(h.calls.warn.length, 1);
  assert.match(h.calls.warn[0][0], /道具のフォルダ/);
  assert.equal(h.calls.settings, 1);
  assert.deepEqual(h.sent, []);
});

test('始めると、やること・あなたの番・今日の予定・推しを取る', async () => {
  const h = harness({ now: T('08:00'), answers: answers() });
  h.app.start();
  await flush();
  assert.deepEqual(h.sent.sort(), ['calendarToday', 'homeMine', 'issueList', 'oshiSpinner']);
  assert.equal(h.calls.issues.at(-1).items[0].title, '直す');
  assert.equal(h.calls.status.at(-1), '推し: がんばろう');
});

test('会議の1分前に「入る」付きで知らせ、押すと会議の URL を開く。二度は開かない', async () => {
  const h = harness({ now: T('08:00'), answers: answers(), pick: (m, rest) => (rest[0] === '入る' ? '入る' : undefined) });
  h.app.start();
  await flush();
  h.setNow(T('09:58'));
  h.app.tick();
  assert.equal(h.calls.info.length, 0);
  h.setNow(T('09:59'));
  h.app.tick();
  await flush();
  assert.deepEqual(h.calls.info[0], ['「朝会」が始まります (' + new Date(T('10:00')).getHours().toString().padStart(2, '0') + ':00)', '入る']);
  assert.deepEqual(h.calls.open, ['https://meet.google.com/abc-defg-hij']);
  h.setNow(T('10:00'));
  h.app.tick();
  await flush();
  assert.equal(h.calls.info.length, 1);
  assert.equal(h.calls.open.length, 1);
});

test('autoOpen なら押さなくても始まりに開く。URL の無い予定は知らせだけ。二度開かない', async () => {
  const h = harness({ now: T('08:00'), answers: answers(), settings: { autoOpen: true } });
  h.app.start();
  await flush();
  h.setNow(T('10:00'));
  h.app.tick();
  h.app.tick();
  assert.deepEqual(h.calls.open, ['https://meet.google.com/abc-defg-hij']);
  h.setNow(T('13:00'));
  h.app.tick();
  await flush();
  assert.equal(h.calls.open.length, 1);
  assert.deepEqual(h.calls.info.map((c) => c.slice(1)), [['入る'], []]);
});

test('予定は30分ごとに取り直す。取り直しても、知らせた予定はもう一度知らせない', async () => {
  const h = harness({ now: T('09:30'), answers: answers() });
  h.app.start();
  await flush();
  h.setNow(T('09:59'));
  h.app.tick();
  await flush();
  const before = h.sent.filter((s) => s === 'calendarToday').length;
  h.setNow(T('10:00'));
  h.app.tick();
  await flush();
  assert.equal(h.sent.filter((s) => s === 'calendarToday').length, before + 1);
  assert.equal(h.calls.info.filter((c) => /朝会/.test(c[0])).length, 1);
});

test('あなたの番は pollMinutes ごと。増えたものだけ知らせる', async () => {
  let mine = { reviews: [], returned: [], due: [] };
  const h = harness({ now: T('08:00'), answers: answers({ homeMine: () => mine }), settings: { pollMinutes: 5 } });
  h.app.start();
  await flush();
  assert.equal(h.calls.info.length, 0);
  mine = { reviews: [{ number: 7, title: '規程' }], returned: [], due: [] };
  h.setNow(T('08:04'));
  h.app.tick();
  await flush();
  assert.equal(h.sent.filter((s) => s === 'homeMine').length, 1);
  h.setNow(T('08:05'));
  h.app.tick();
  await flush();
  assert.deepEqual(h.calls.info.map((c) => c[0]), ['番頭: 確かめてほしい確認依頼 #7 規程']);
});

test('推しは1時間に1回まで取り直す。オフなら出さない', async () => {
  const h = harness({ now: T('08:00'), answers: answers() });
  h.app.start();
  await flush();
  h.setNow(T('08:59'));
  h.app.tick();
  await flush();
  assert.equal(h.sent.filter((s) => s === 'oshiSpinner').length, 1);
  h.setNow(T('09:00'));
  h.app.tick();
  await flush();
  assert.equal(h.sent.filter((s) => s === 'oshiSpinner').length, 2);
  const off = harness({ now: T('08:00'), answers: answers({ oshiSpinner: { on: false, name: '', lines: [], reason: 'オフ' } }) });
  off.app.start();
  await flush();
  assert.equal(off.calls.status.at(-1), null);
});

test('頼みが失敗しても知らせを出さず、記録に残す。返事を待つあいだは重ねて頼まない', async () => {
  let release;
  const slow = new Promise((done) => { release = done; });
  const h = harness({ now: T('08:00'), answers: answers({ calendarToday: () => slow, homeMine: new Error('番頭から返事が来ませんでした') }) });
  h.app.start();
  await flush();
  h.setNow(T('08:40'));
  h.app.tick();
  await flush();
  assert.equal(h.sent.filter((s) => s === 'calendarToday').length, 1);
  release(CAL);
  await flush();
  assert.equal(h.calls.warn.length, 0);
  assert.ok(h.calls.log.some((l) => /あなたの番を見られませんでした/.test(l)));
});

test('やることを押すと、題名・期限・本文を出す', async () => {
  const h = harness({ now: T('08:00'), answers: answers() });
  h.app.showIssue({ number: 3, title: '直す', body: '本文', due: '2026-10-30', priority: '' });
  assert.deepEqual(h.calls.info[0], ['#3 直す', { modal: true, detail: '期限 2026-10-30\n\n本文' }]);
});
