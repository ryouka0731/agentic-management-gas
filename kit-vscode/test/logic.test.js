'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../lib/logic');

const T = (hm) => Date.parse('2026-10-28T' + hm + ':00+09:00');

test('結果の読み方: ok なら result、断られたら理由で投げる、読めなければ投げる', () => {
  assert.deepEqual(logic.readResult(JSON.stringify({ ok: true, op: 'issueList', result: [1] })), [1]);
  assert.throws(() => logic.readResult(JSON.stringify({ ok: false, op: 'calendarToday', error: '読めません' })), /番頭が断りました: 読めません/);
  assert.throws(() => logic.readResult('{"ok":'), /返事が読めません/);
  assert.throws(() => logic.readResult('null'), /返事が読めません/);
  assert.throws(() => logic.readResult('{"result":1}'), /返事が読めません/);
});

test('会議の URL は https の Google Meet だけ。予定の URL は Google カレンダーだけ', () => {
  assert.equal(logic.meetUrlOf('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(logic.meetUrlOf('https://meet.google.com/lookup/abcdef'), 'https://meet.google.com/lookup/abcdef');
  assert.equal(logic.meetUrlOf('http://meet.google.com/abc-defg-hij'), null);
  assert.equal(logic.meetUrlOf('https://meet.google.com.evil.example/abc'), null);
  assert.equal(logic.meetUrlOf('https://meet.google.com/abc?x=https://evil.example'), null);
  assert.equal(logic.meetUrlOf('javascript:alert(1)'), null);
  assert.equal(logic.meetUrlOf(null), null);
  assert.equal(logic.eventUrlOf('https://calendar.google.com/calendar/event?eid=YWJj'), 'https://calendar.google.com/calendar/event?eid=YWJj');
  assert.equal(logic.eventUrlOf('https://evil.example/calendar/event?eid=YWJj'), null);
});

test('予定の並び: 読めない予定を落とし、題名の制御文字を落とし、始まりの順にする', () => {
  const got = logic.meetingsOf({ day: '2026-10-28', events: [
    { start: '2026-10-28T04:00:00.000Z', end: '2026-10-28T05:00:00.000Z', title: '午後\u202e', meetUrl: 'https://meet.google.com/abc-defg-hij', eventUrl: null },
    { start: '読めない', end: '', title: 'x' },
    { start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T00:30:00.000Z', title: '', meetUrl: 'https://evil.example/' },
    null,
  ] });
  assert.equal(got.length, 2);
  assert.equal(got[0].title, '(題名なし)');
  assert.equal(got[0].meetUrl, null);
  assert.equal(got[1].title, '午後');
  assert.equal(got[1].meetUrl, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual(logic.meetingsOf(null), []);
  assert.deepEqual(logic.meetingsOf({ events: 'x' }), []);
});

function meeting(hm, more) {
  const start = T(hm);
  return Object.assign({ key: start + '|会議', start, end: start + 1800000, title: '会議', meetUrl: 'https://meet.google.com/abc-defg-hij', eventUrl: null }, more || {});
}

test('知らせる時刻: 始まりの1分前から。それより前は何もしない', () => {
  const m = meeting('10:00');
  const done = new Set();
  assert.deepEqual(logic.dueActions([m], T('09:58'), { autoOpen: true }, done), []);
  assert.deepEqual(logic.dueActions([m], T('09:59'), { autoOpen: false }, done).map((a) => a.kind), ['notify']);
  assert.equal(logic.nextActionAt([m], T('09:00'), { autoOpen: false }, done), T('09:59'));
});

test('開く時刻: autoOpen がオンで URL があるときだけ、始まりに', () => {
  const m = meeting('10:00');
  const done = new Set(['notify:' + m.key]);
  assert.deepEqual(logic.dueActions([m], T('09:59'), { autoOpen: true }, done), []);
  assert.deepEqual(logic.dueActions([m], T('10:00'), { autoOpen: true }, done).map((a) => a.kind), ['open']);
  assert.deepEqual(logic.dueActions([m], T('10:00'), { autoOpen: false }, done), []);
  const noUrl = meeting('10:00', { meetUrl: null });
  assert.deepEqual(logic.dueActions([noUrl], T('10:00'), { autoOpen: true }, new Set()).map((a) => a.kind), ['notify']);
  assert.equal(logic.nextActionAt([m], T('09:30'), { autoOpen: true }, done), T('10:00'));
});

test('同じ予定で二度知らせない・二度開かない。始まって5分を過ぎたものは何もしない', () => {
  const m = meeting('10:00');
  const done = new Set(['notify:' + m.key, 'open:' + m.key]);
  assert.deepEqual(logic.dueActions([m], T('10:01'), { autoOpen: true }, done), []);
  assert.equal(logic.nextActionAt([m], T('10:01'), { autoOpen: true }, done), null);
  // 閉じていたあいだの会議を、後から開かない
  assert.deepEqual(logic.dueActions([m], T('10:06'), { autoOpen: true }, new Set()), []);
  // 5分以内なら、遅れても知らせて開く
  assert.deepEqual(logic.dueActions([m], T('10:04'), { autoOpen: true }, new Set()).map((a) => a.kind), ['notify', 'open']);
});

test('会議の知らせの字', () => {
  assert.equal(logic.meetingMessage({ title: '朝会', start: new Date(2026, 9, 28, 9, 5).getTime() }), '「朝会」が始まります (09:05)');
});

test('あなたの番: はじめはまとめて1つ、次からは増えたものだけ。4件以上増えたらまとめる', () => {
  const r1 = { reviews: [{ number: 3, title: '規程' }], returned: [], due: [{ number: 5, title: '申請', due: '2026-10-29', overdue: false }] };
  const first = logic.turnNews(null, logic.turnItemsOf(r1));
  assert.deepEqual(first.messages, ['番頭: あなたの番があります (確認依頼 1 件・期限の近いやること 1 件)']);
  const same = logic.turnNews(first.seen, logic.turnItemsOf(r1));
  assert.deepEqual(same.messages, []);
  const r2 = { reviews: [{ number: 3, title: '規程' }, { number: 4, title: '手順' }], returned: [{ number: 2, title: '戻り' }], due: r1.due };
  const more = logic.turnNews(same.seen, logic.turnItemsOf(r2));
  assert.deepEqual(more.messages, ['番頭: 確かめてほしい確認依頼 #4 手順', '番頭: 戻ってきた確認依頼 #2 戻り']);
  const many = { reviews: [6, 7, 8, 9].map((n) => ({ number: n, title: 't' })) };
  assert.deepEqual(logic.turnNews(more.seen, logic.turnItemsOf(many)).messages, ['番頭: あなたの番が 4 件増えました']);
  assert.deepEqual(logic.turnNews(null, []).messages, []);
  // 期限が変われば、同じ番号でも新しく知らせる
  const moved = { due: [{ number: 5, title: '申請', due: '2026-10-30' }] };
  assert.equal(logic.turnNews(logic.turnNews(null, logic.turnItemsOf(r1)).seen, logic.turnItemsOf(moved)).messages.length, 1);
});

test('やることの一覧: open で自分が担当のものだけ。期限の早い順、期限なしは後ろ', () => {
  const rows = [
    { number: 1, title: 'a', state: 'open', assignees: ['Me@Example.com'], dueDate: '' },
    { number: 2, title: 'b', state: 'closed', assignees: ['me@example.com'] },
    { number: 3, title: 'c', state: 'open', assignees: ['other@example.com'] },
    { number: 4, title: 'd', state: 'open', assignees: ['me@example.com'], dueDate: '2026-10-30' },
    { number: 5, title: 'e', state: 'open', assignees: ['me@example.com'], dueDate: '2026-10-29', archivedAt: '2026-10-01' },
    { number: 6, title: 'f\u0007', state: 'open', assignees: ['me@example.com'], dueDate: '2026-10-29', body: '本文' },
  ];
  const mine = logic.myIssues(rows, 'me@example.com');
  assert.deepEqual(mine.map((r) => r.number), [6, 4, 1]);
  assert.equal(mine[0].title, 'f');
  assert.equal(mine[0].body, '本文');
  assert.deepEqual(logic.myIssues(rows, '').map((r) => r.number), [6, 4, 1, 3]);
  assert.deepEqual(logic.myIssues({ not: 'list' }, 'me@example.com'), []);
});

test('推しの一言: オンで名前とせりふがあるときだけ。せりふは24字まで', () => {
  assert.equal(logic.oshiStatus({ on: true, name: '番頭くん', lines: ['考え中', 'もう少し'] }, () => 0.9), '番頭くん: もう少し');
  assert.equal(logic.oshiStatus({ on: false, name: 'x', lines: ['a'] }), null);
  assert.equal(logic.oshiStatus({ on: true, name: 'x', lines: [] }), null);
  assert.equal(logic.oshiStatus({ on: true, name: '', lines: ['a'] }), null);
  assert.equal(logic.oshiStatus(null), null);
  assert.equal(logic.oshiStatus({ on: true, name: 'x', lines: ['あ'.repeat(30)] }, () => 0).length, 'x: '.length + 24);
});

test('取り直す間隔', () => {
  assert.equal(logic.stale(NaN, 1000, 500), true);
  assert.equal(logic.stale(800, 1000, 500), false);
  assert.equal(logic.stale(500, 1000, 500), true);
});
