import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { makeEnv, asUser, OWNER, OTHER, expectScreenSafe } from './api/setup.js';

/*
 * Gemini のメモの取り込み (やること #97)。読み方は MeetingNotes.js (ピュア)、探す・開く・作るのは MeetingNotesImport.gs、
 * 口は apiMeetingNotesImport と命令 meetingNotesImport。時刻は東京。2026-10-27 は火曜。
 * 名前とアドレスは作り話 (テスト 花子 など)。
 */

const MEMBER = 'member@example.com';
const THIRD = 'c@example.com';

function tokyo(day, hm) {
  return new Date(day + 'T' + (hm || '00:00') + ':00+09:00');
}

describe('読み方 (ピュア)', () => {
  const gas = loadGas('src/core/CalendarPlan.js', 'src/core/MeetingNotes.js');

  it('題名の印は言語ごとに複数あり、全角・半角や空白の違いを見ない', () => {
    expect(gas.meetingNoteIsGemini('営業の定例 - 2026/10/27 10:00 JST - Gemini によるメモ')).toBe(true);
    expect(gas.meetingNoteIsGemini('Weekly sync – 2026/10/27 10:00 JST – Notes by Gemini')).toBe(true);
    expect(gas.meetingNoteIsGemini('週次 - Ｇｅｍｉｎｉのメモ')).toBe(true);
    // 「Gemini」を含んでも、メモの印でなければ取り込まない
    expect(gas.meetingNoteIsGemini('Gemini の使い方')).toBe(false);
    expect(gas.meetingNoteIsGemini('')).toBe(false);
  });

  it('次のステップの見出しの下の箇条書きを1行ずつ。ほかの節・添え書き・同じ行は拾わない', () => {
    const lines = gas.meetingNoteSteps([
      { text: 'まとめ', heading: 'HEADING2' },
      { text: '次のステップについて話した' },
      { text: '推奨される次のステップ', heading: true },
      { text: '・見積もりを直す', list: true },
      { text: '[ ] 資料を送る', list: true },
      { text: '資料を送る', list: true },
      { text: '', list: true },
      { text: 'Gemini が作成したメモは不正確な場合があります。' },
      { text: '会場を押さえる', list: true },
    ]);
    expect(lines).toEqual(['見積もりを直す', '資料を送る']);
    // 箇条書きの中の Gemini 自身の添え書きも拾わない
    expect(gas.meetingNoteSteps([{ text: '次のステップ', heading: true }, { text: '日程を決める', list: true },
      { text: 'Gemini のメモを確認してください', list: true }])).toEqual(['日程を決める']);
  });

  it('箇条書きでない段落の節も読む。別の見出しで閉じる。英語の見出しも読む', () => {
    expect(gas.meetingNoteSteps([
      { text: 'Suggested next steps' },
      { text: 'Alex will send the deck.' },
      { text: 'Details', heading: false },
      { text: 'Discussed the plan.' },
    ])).toEqual(['Alex will send the deck.']);
    expect(gas.meetingNoteSteps([{ text: 'アクション アイテム', heading: true }, { text: '日程を決める' },
      { text: '詳細', heading: true }, { text: '日程の話' }])).toEqual(['日程を決める']);
    // 見出しの印の字が後ろに続く行 (本文の文) は見出しにしない
    expect(gas.meetingNoteSteps([{ text: '次のステップは来週決める' }, { text: '何か' }])).toEqual([]);
    expect(gas.meetingNoteSteps([])).toEqual([]);
  });

  it('担当の名前の候補を「@名前」「名前:」「[名前]」「名前さんが」「Name will」から拾う', () => {
    expect(gas.meetingNoteAssigneeNames('@テスト太郎 資料を送る')).toContain('テスト太郎');
    expect(gas.meetingNoteAssigneeNames('テスト 花子: 見積もりを直す')).toEqual(['テスト 花子']);
    expect(gas.meetingNoteAssigneeNames('[テスト 花子] 見積もりを直す')).toEqual(['テスト 花子']);
    expect(gas.meetingNoteAssigneeNames('テスト太郎さんが会場を押さえる')).toEqual(['テスト太郎']);
    expect(gas.meetingNoteAssigneeNames('Alex Test will send the deck')).toEqual(['Alex Test']);
    expect(gas.meetingNoteAssigneeNames('会場を押さえる')).toEqual([]);
  });

  it('名前は人の表に当てる。空白を見ず、苗字だけでも1人なら当てる。何人も当たれば当てない', () => {
    const people = [{ email: 'a@x', name: 'テスト 花子' }, { email: 'b@x', name: 'テスト太郎' },
      { email: 'c@x', name: '見本 一郎' }, { email: 'd@x', name: '見本 次郎' }, { email: 'e@x', name: '' }];
    expect(gas.meetingNoteAssigneeOf(['テスト花子'], people)).toBe('a@x');
    expect(gas.meetingNoteAssigneeOf(['テスト太郎'], people)).toBe('b@x');
    expect(gas.meetingNoteAssigneeOf(['見本'], people)).toBe('');
    expect(gas.meetingNoteAssigneeOf(['見本 次郎'], people)).toBe('d@x');
    expect(gas.meetingNoteAssigneeOf(['知らない人'], people)).toBe('');
    expect(gas.meetingNoteAssigneeOf([], people)).toBe('');
  });

  it('予定に結び付ける: 題名に名前が入り、題名の日 (無ければ時刻の近さ) が合う予定。結び付かなければ -1', () => {
    const ev = (title, day, from, to) => ({ title, start: tokyo(day, from).getTime(), end: tokyo(day, to).getTime() });
    const events = [ev('定例', '2026-10-26', '10:00', '11:00'), ev('営業の定例', '2026-10-27', '10:00', '11:00'),
      ev('営業の定例', '2026-10-20', '10:00', '11:00'), ev('x', '2026-10-27', '10:00', '11:00')];
    const at = tokyo('2026-10-27', '11:05').getTime();
    expect(gas.meetingNoteMatchEvent('営業の定例 - 2026/10/27 10:00 JST - Gemini によるメモ', at, events)).toBe(1);
    // 題名に日が無ければ時刻の近さで (前の週の同じ会議ではなく)
    expect(gas.meetingNoteMatchEvent('営業の定例 - Gemini によるメモ', at, events)).toBe(1);
    // 題名の日に会議が無い
    expect(gas.meetingNoteMatchEvent('営業の定例 - 2026/10/28 - Gemini によるメモ', at, events)).toBe(-1);
    // 名前の入っていない題名・1字の名前の予定には結び付けない
    expect(gas.meetingNoteMatchEvent('ブレスト - Gemini によるメモ', at, events)).toBe(-1);
    expect(gas.meetingNoteMatchEvent('営業の定例 - Gemini によるメモ', tokyo('2026-10-30', '12:00').getTime(), events)).toBe(-1);
  });
});

/*
 * 疑似GASで通す。本人の Drive に Gemini のメモを置き、本人の既定のカレンダーに会議を置く。
 */
const NOW = tokyo('2026-10-27', '18:00');

function ready() {
  const env = makeEnv({ file: false });
  env.fake.DocumentApp = env.fake._documentApp;
  env.ctx.meetingNotesNow_ = () => NOW;
  env.ctx.calendarNow_ = () => NOW;
  env.ctx.dbAppend('members', { email: OTHER, name: 'テスト 花子' });
  env.ctx.dbAppend('members', { email: THIRD, name: 'テスト太郎' });
  return env;
}

const STEPS = [
  { text: 'まとめ', heading: 'HEADING2' },
  { text: '今期の数字を確かめた' },
  { text: '推奨される次のステップ', heading: 'HEADING2' },
  { text: '[テスト 花子] 見積もりを直す', list: true },
  { text: '@テスト太郎 資料を送る', list: true },
  { text: '会場を押さえる', list: true },
  { text: 'Gemini が作成したメモは不正確な場合があります。' },
];

/** その人の Drive に Gemini のメモを置く */
function note(env, title, paras, opts = {}) {
  const owner = opts.owner || MEMBER;
  const id = asUser(env.fake, owner, () => env.fake._createDoc(title, '', env.fake.DriveApp.getRootFolder().getId()));
  const f = env.fake.DriveApp.getFileById(id);
  f._created = opts.at || tokyo('2026-10-27', '11:05');
  f._updated = f._created;
  if (opts.share) f._viewers.push(opts.share);
  env.fake._setDocParas(id, paras || STEPS);
  return id;
}

const meeting = (env, title, day, from, to) => env.fake._calAddBusy(MEMBER, {
  title, start: tokyo(day, from), end: tokyo(day, to), guests: [OTHER] });
const importAs = (env, who, days, opts) => asUser(env.fake, who || MEMBER, () => env.ctx.apiMeetingNotesImport(days, opts));
const issues = (env) => env.ctx.dbReadAll('issues');
const notes = (env) => env.ctx.dbReadAll('meeting_notes');

describe('Gemini のメモを取り込む', () => {
  it('次のステップの1行 = やること1つ。担当は名前の当たった人、当たらなければ本人。本文に会議名・日時・URL・元の行', () => {
    const env = ready();
    meeting(env, '営業の定例', '2026-10-27', '10:00', '11:00');
    const id = note(env, '営業の定例 - 2026/10/27 10:00 JST - Gemini によるメモ');
    const out = expectScreenSafe(importAs(env));
    expect(out).toMatchObject({ ok: true, found: 1, notes: 1, created: 3, already: 0, unmatched: 0 });
    expect(out.items.map((i) => [i.title, i.assignee])).toEqual([
      ['[テスト 花子] 見積もりを直す', OTHER], ['@テスト太郎 資料を送る', THIRD], ['会場を押さえる', MEMBER]]);
    const made = issues(env);
    expect(made).toHaveLength(3);
    const body = String(made[2].body);
    expect(body).toContain('会議: 営業の定例');
    expect(body).toContain('日時: 2026/10/27 10:00 (60分)');
    expect(body).toContain('https://example.invalid/d/' + id);
    expect(body).toContain('元の行: 会場を押さえる');
    // ボードの「未着手」に置く (画面から作るのと同じ)
    expect(env.ctx.dbReadAll('project_items').map((r) => Number(r.issueNumber)).sort())
      .toEqual(made.map((r) => Number(r.number)).sort());
    // 二度取り込まない印。会議の名前・始まり・長さ・取り込んだ人・作った番号
    const row = notes(env);
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ docId: id, meeting: '営業の定例', minutes: 60, importedBy: MEMBER });
    expect(new Date(row[0].meetingAt).getTime()).toBe(tokyo('2026-10-27', '10:00').getTime());
    expect(String(row[0].issueNumbers)).toBe(made.map((r) => r.number).join(','));
  });

  it('二度取り込まない (同じメモは取り込み済み。開きもしない)', () => {
    const env = ready();
    meeting(env, '営業の定例', '2026-10-27', '10:00', '11:00');
    note(env, '営業の定例 - 2026/10/27 10:00 JST - Gemini によるメモ');
    importAs(env);
    let opened = 0;
    const open = env.fake._documentApp.openById;
    env.fake.DocumentApp = Object.assign({}, env.fake._documentApp, { openById: (id) => { opened++; return open(id); } });
    const again = importAs(env);
    expect(opened).toBe(0);
    expect(again).toMatchObject({ ok: true, found: 1, notes: 0, created: 0, already: 1 });
    expect(issues(env)).toHaveLength(3);
    expect(notes(env)).toHaveLength(1);
    // ほかの人が同じメモ (共有されたもの) を取り込もうとしても作らない
    env.fake.DriveApp.getFileById(notes(env)[0].docId)._viewers.push(OTHER);
    expect(importAs(env, OTHER)).toMatchObject({ found: 1, created: 0, already: 1 });
    expect(issues(env)).toHaveLength(3);
  });

  it('鍵の中で「あるか見てから書く」: 覚えより後にほかの実行が印を付けていれば作らない', () => {
    const env = ready();
    const id = note(env, '営業の定例 - Gemini によるメモ');
    // 覚え (鍵の外で読んだ表) を読んだあと、鍵を取るまでのあいだにほかの実行が書いた形
    const claim = env.ctx.meetingNotesClaim_;
    env.ctx.meetingNotesClaim_ = (row) => {
      env.ctx.dbAppend('meeting_notes', { docId: id, title: 'ほかの実行', importedBy: OTHER });
      return claim(row);
    };
    expect(importAs(env)).toMatchObject({ notes: 0, created: 0, already: 1 });
    expect(issues(env)).toHaveLength(0);
    expect(notes(env)).toHaveLength(1);
  });

  it('同じ題名のやることがあれば作らず、取り込み済みに数える (空白・全角半角の違いは見ない)', () => {
    const env = ready();
    env.ctx.issueCreate('会場を 押さえる', '', []);
    note(env, '営業の定例 - Gemini によるメモ');
    const out = importAs(env);
    expect(out).toMatchObject({ notes: 1, created: 2, already: 1 });
    expect(issues(env).map((r) => r.title)).not.toContain('会場を押さえる');
  });

  it('予定に結び付かないメモは会議不明。やることは作るが、会議の時間は残さない', () => {
    const env = ready();
    note(env, 'ブレスト - Gemini によるメモ');
    const out = importAs(env);
    expect(out).toMatchObject({ notes: 1, created: 3, unmatched: 1 });
    expect(notes(env)[0]).toMatchObject({ meeting: '', minutes: '', meetingAt: '' });
    expect(String(issues(env)[0].body)).toContain('会議: 不明');
  });

  it('個人の Gmail (Gemini のメモが無い) では何も起きない。メモでない文書・古いメモ・ゴミ箱のメモも見ない', () => {
    const env = ready();
    note(env, 'Gemini の使い方');
    note(env, '先月の会議 - Gemini によるメモ', STEPS, { at: tokyo('2026-10-01', '10:00') });
    const trashed = note(env, '捨てた会議 - Gemini によるメモ');
    env.fake.DriveApp.getFileById(trashed)._trashed = true;
    const out = importAs(env);
    expect(out).toMatchObject({ ok: true, found: 0, notes: 0, created: 0, already: 0 });
    expect(issues(env)).toHaveLength(0);
    expect(notes(env)).toHaveLength(0);
    // 探すのは Google ドキュメントの、直近の日数ぶんだけ (標準の DriveApp の検索)
    const q = env.fake._driveSearches()[0];
    expect(q).toContain("mimeType = 'application/vnd.google-apps.document'");
    expect(q).toContain("modifiedDate > '" + new Date(NOW.getTime() - 7 * 86400000).toISOString() + "'");
  });

  it('見るのは本人の権限で見えるメモだけ (共有されていないほかの人のメモは見ない)', () => {
    const env = ready();
    note(env, '営業の定例 - Gemini によるメモ', STEPS, { owner: OTHER });
    expect(importAs(env)).toMatchObject({ found: 0, created: 0 });
    note(env, '別の会議 - Gemini によるメモ', STEPS, { owner: OTHER, share: MEMBER });
    expect(importAs(env)).toMatchObject({ found: 1, created: 3 });
  });

  it('Drive を探せないときは断らずに ok: false。何も作らない', () => {
    const env = ready();
    note(env, '営業の定例 - Gemini によるメモ');
    env.fake._failSearch('Service invoked too many times');
    const out = importAs(env);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Drive を探せませんでした');
    expect(issues(env)).toHaveLength(0);
  });

  it('開けないメモは飛ばし、印を付けない (開けるようになれば次に取り込む)', () => {
    const env = ready();
    const id = note(env, '営業の定例 - Gemini によるメモ');
    const open = env.fake._documentApp.openById;
    env.fake.DocumentApp = Object.assign({}, env.fake._documentApp, { openById: () => { throw new Error('Document is missing'); } });
    expect(importAs(env)).toMatchObject({ ok: true, found: 1, notes: 0, created: 0 });
    expect(notes(env)).toHaveLength(0);
    env.fake.DocumentApp = Object.assign({}, env.fake._documentApp, { openById: open });
    expect(importAs(env)).toMatchObject({ notes: 1, created: 3 });
    expect(notes(env)[0].docId).toBe(id);
  });

  it('開いたときの自動は1日1回。次の日にはまた探す', () => {
    const env = ready();
    note(env, '営業の定例 - Gemini によるメモ');
    expect(importAs(env, MEMBER, 7, { auto: true })).toMatchObject({ skipped: false, created: 3 });
    expect(importAs(env, MEMBER, 7, { auto: true })).toMatchObject({ skipped: true, created: 0 });
    expect(env.fake._driveSearches()).toHaveLength(1);
    // 手で押したときは絞らない
    importAs(env);
    expect(env.fake._driveSearches()).toHaveLength(2);
    env.ctx.meetingNotesNow_ = () => tokyo('2026-10-28', '09:00');
    expect(importAs(env, MEMBER, 7, { auto: true }).skipped).toBe(false);
    expect(env.fake._driveSearches()).toHaveLength(3);
  });

  it('探す日数は 1〜14 (既定7)', () => {
    const env = ready();
    importAs(env, MEMBER, 30);
    importAs(env, MEMBER, 'x');
    const since = (q) => /modifiedDate > '([^']*)'/.exec(q)[1];
    expect(since(env.fake._driveSearches()[0])).toBe(new Date(NOW.getTime() - 14 * 86400000).toISOString());
    expect(since(env.fake._driveSearches()[1])).toBe(new Date(NOW.getTime() - 7 * 86400000).toISOString());
  });

  it('会議の時間の欄に、議事録のある会議の時間を添える', () => {
    const env = ready();
    meeting(env, '営業の定例', '2026-10-27', '10:00', '11:00');
    meeting(env, '別の会議', '2026-10-27', '13:00', '13:30');
    asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.meetings', true));
    expect(asUser(env.fake, MEMBER, () => env.ctx.apiMeetingHours()).noted).toBe(0);
    note(env, '営業の定例 - 2026/10/27 10:00 JST - Gemini によるメモ');
    importAs(env);
    // 取り込んだら覚え (30分) を待たずに数え直す
    const hours = asUser(env.fake, MEMBER, () => env.ctx.apiMeetingHours());
    expect([hours.half, hours.noted]).toEqual([1.5, 1]);
  });
});

describe('手元からの命令 meetingNotesImport', () => {
  it('置いた人がキューを仕掛けた人 (実行している人) なら取り込む', () => {
    const env = ready();
    note(env, '営業の定例 - Gemini によるメモ');
    const out = asUser(env.fake, MEMBER, () => env.ctx.runCommand_({ op: 'meetingNotesImport', args: { days: 3 } }, MEMBER));
    expect(out).toMatchObject({ ok: true, found: 1, created: 3 });
    expect(env.ctx.COMMAND_PERSONAL_OPS()).toContain('meetingNotesImport');
  });

  it('ほかの人が置いた命令では、仕掛けた人のメモを取り込まない', () => {
    const env = ready();
    note(env, '営業の定例 - Gemini によるメモ', STEPS, { owner: OWNER });
    expect(() => asUser(env.fake, OWNER, () => env.ctx.runCommand_({ op: 'meetingNotesImport', args: {} }, OTHER)))
      .toThrow('命令キューを仕掛けた人のメモだけです');
    expect(() => env.ctx.runCommand_({ op: 'meetingNotesImport', args: {} }, '')).toThrow('命令を置いた人が分かりません');
    expect(issues(env)).toHaveLength(0);
  });
});
