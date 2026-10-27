'use strict';
/*
 * 番頭の VS Code 拡張の、vscode にも Drive にも依らない部分。test/ がそのまま読む。
 *
 * 返事は命令の入れ先 (Drive の queue/) から来る。入れ先は Drive を共有している人なら誰でも書けるので、
 * 返事の字はデータとして扱う: 制御文字を落とし、開く URL は決まった形 (Google Meet / Google カレンダー) だけにする。
 */

/** 落とす字。C0 (改行・タブを除く)・DEL・C1、字の向きを変える印、幅の無い空白と BOM、行・段落の区切り (kit/agent.mjs と同じ) */
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** 字から制御文字を落とす。字でなければ空 */
function clean(value) {
  return typeof value === 'string' ? value.replace(CONTROL_CHARS, '') : '';
}

/** 1行に収める (知らせ・ステータスバー用)。改行とタブは空白に、長ければ切る */
function oneLine(value, max) {
  const text = clean(value).replace(/[\n\t]+/g, ' ').trim();
  const limit = max || 80;
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/**
 * 命令の結果のファイルの中身を読む。形が違えば投げる。
 * 番頭は {ok: true, op, result} か {ok: false, op, error} を書く (src/core/CommandQueue.gs の runCommandFileLocked_)。
 *
 * @param {string} text
 * @returns {*} result
 */
function readResult(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('番頭の返事が読めません');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('番頭の返事が読めません');
  if (parsed.ok === true) return parsed.result;
  if (parsed.ok === false) throw new Error('番頭が断りました: ' + oneLine(parsed.error, 200));
  throw new Error('番頭の返事が読めません');
}

/** 開いてよい会議の URL か (https の Google Meet だけ) */
const MEET_RE = /^https:\/\/meet\.google\.com\/(?:lookup\/)?[a-z0-9][a-z0-9-]*$/i;
/** 開いてよい予定の URL か (https の Google カレンダーだけ) */
const EVENT_RE = /^https:\/\/calendar\.google\.com\/calendar\/event\?eid=[A-Za-z0-9_-]+$/;

/** 会議の URL を取り出す。形が違えば null */
function meetUrlOf(value) {
  return typeof value === 'string' && MEET_RE.test(value) ? value : null;
}

/** 予定の URL を取り出す。形が違えば null */
function eventUrlOf(value) {
  return typeof value === 'string' && EVENT_RE.test(value) ? value : null;
}

/**
 * calendarToday の返事を、扱える予定の並びにする。読めない予定は落とす。
 *
 * @param {*} result {day, events: [{start, end, title, meetUrl, eventUrl}]}
 * @returns {Array<{key: string, start: number, end: number, title: string, meetUrl: ?string, eventUrl: ?string}>}
 */
function meetingsOf(result) {
  const list = result && Array.isArray(result.events) ? result.events : [];
  const out = [];
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const start = Date.parse(ev.start);
    const end = Date.parse(ev.end);
    if (!Number.isFinite(start)) continue;
    const title = oneLine(ev.title, 60) || '(題名なし)';
    out.push({
      key: start + '|' + title,
      start,
      end: Number.isFinite(end) ? end : start,
      title,
      meetUrl: meetUrlOf(ev.meetUrl),
      eventUrl: eventUrlOf(ev.eventUrl),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** 始まりの何ミリ秒前に知らせるか */
const NOTIFY_BEFORE_MS = 60 * 1000;
/** 始まってからこれより後は、知らせも開くのもやめる (寝ていた・閉じていたあいだの会議を後から開かない) */
const LATE_MS = 5 * 60 * 1000;

/**
 * いますること。知らせる・開くの時刻が来ていて、まだしていないもの。
 *
 * - 知らせ: 始まりの1分前から (始まって5分まで)
 * - 開く: autoOpen がオンで会議の URL があるとき、始まりから (始まって5分まで)
 * - した印 (done) は予定ごと (key)。同じ予定で二度知らせない・二度開かない (押して開いたぶんも数える)
 *
 * @param {ReturnType<typeof meetingsOf>} meetings
 * @param {number} nowMs
 * @param {{autoOpen: boolean}} opts
 * @param {Set<string>} done 'notify:<key>' / 'open:<key>'
 * @returns {Array<{kind: 'notify'|'open', meeting: object}>}
 */
function dueActions(meetings, nowMs, opts, done) {
  const out = [];
  for (const m of meetings) {
    if (nowMs > m.start + LATE_MS) continue;
    if (nowMs >= m.start - NOTIFY_BEFORE_MS && !done.has('notify:' + m.key)) {
      out.push({ kind: 'notify', meeting: m });
    }
    if (opts && opts.autoOpen && m.meetUrl && nowMs >= m.start && !done.has('open:' + m.key)) {
      out.push({ kind: 'open', meeting: m });
    }
  }
  return out;
}

/** 次に何かする時刻 (無ければ null)。見張りの間隔を決めるのに使う */
function nextActionAt(meetings, nowMs, opts, done) {
  let next = null;
  for (const m of meetings) {
    if (nowMs > m.start + LATE_MS) continue;
    const times = [];
    if (!done.has('notify:' + m.key)) times.push(m.start - NOTIFY_BEFORE_MS);
    if (opts && opts.autoOpen && m.meetUrl && !done.has('open:' + m.key)) times.push(m.start);
    for (const t of times) if (next === null || t < next) next = t;
  }
  return next;
}

/** 会議の知らせの字 */
function meetingMessage(m) {
  const at = new Date(m.start);
  const hm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
  return '「' + m.title + '」が始まります (' + hm + ')';
}

/**
 * homeMine の返事 ({reviews, returned, due}) を、知らせる項目にする。
 *
 * @returns {Array<{key: string, text: string}>}
 */
function turnItemsOf(result) {
  const r = result && typeof result === 'object' ? result : {};
  const out = [];
  const add = (kind, list, label) => {
    for (const it of Array.isArray(list) ? list : []) {
      if (!it || typeof it !== 'object') continue;
      const n = Number(it.number);
      if (!Number.isInteger(n) || n <= 0) continue;
      const extra = kind === 'due' && typeof it.due === 'string' ? ' (期限 ' + oneLine(it.due, 10) + ')' : '';
      out.push({ key: kind + ':' + n + (kind === 'due' ? ':' + oneLine(it.due, 10) : ''),
        text: label + ' #' + n + ' ' + oneLine(it.title, 60) + extra });
    }
  };
  add('review', r.reviews, '確かめてほしい確認依頼');
  add('returned', r.returned, '戻ってきた確認依頼');
  add('due', r.due, '期限の近いやること');
  return out;
}

/**
 * 前に見たものと比べて、増えたものを知らせの字にする。
 * はじめて見たとき (seen が null) は、あるものをまとめて1つにする (開いた朝に今の番が分かるように)。
 *
 * @param {?Set<string>} seen
 * @param {Array<{key: string, text: string}>} items
 * @returns {{messages: string[], seen: Set<string>}}
 */
function turnNews(seen, items) {
  const next = new Set(items.map((i) => i.key));
  if (seen === null) {
    if (!items.length) return { messages: [], seen: next };
    const count = (k) => items.filter((i) => i.key.startsWith(k + ':')).length;
    const parts = [];
    if (count('review')) parts.push('確認依頼 ' + count('review') + ' 件');
    if (count('returned')) parts.push('戻ってきたもの ' + count('returned') + ' 件');
    if (count('due')) parts.push('期限の近いやること ' + count('due') + ' 件');
    return { messages: ['番頭: あなたの番があります (' + parts.join('・') + ')'], seen: next };
  }
  const fresh = items.filter((i) => !seen.has(i.key));
  if (fresh.length > 3) {
    return { messages: ['番頭: あなたの番が ' + fresh.length + ' 件増えました'], seen: next };
  }
  return { messages: fresh.map((i) => '番頭: ' + i.text), seen: next };
}

/**
 * issueList の返事から、自分の担当の open なやることを取り出す。
 * me が空なら担当で絞らない (open なものを全部)。
 *
 * @param {*} result
 * @param {string} me 自分のアドレス
 * @returns {Array<{number: number, title: string, body: string, due: string, priority: string}>}
 */
function myIssues(result, me) {
  const who = String(me || '').trim().toLowerCase();
  const out = [];
  for (const row of Array.isArray(result) ? result : []) {
    if (!row || typeof row !== 'object') continue;
    if (String(row.state) !== 'open' || row.archivedAt) continue;
    const n = Number(row.number);
    if (!Number.isInteger(n) || n <= 0) continue;
    const people = Array.isArray(row.assignees) ? row.assignees.map((a) => String(a).toLowerCase()) : [];
    if (who && people.indexOf(who) < 0) continue;
    out.push({ number: n, title: oneLine(row.title, 120), body: clean(row.body),
      due: oneLine(row.dueDate, 10), priority: oneLine(row.priority, 10) });
  }
  out.sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due !== b.due) return a.due ? -1 : 1;
    return a.number - b.number;
  });
  return out;
}

/**
 * oshiSpinner の返事から、ステータスバーの字を作る。出せなければ null。
 *
 * @param {*} result {on, name, lines}
 * @param {function(): number} [random]
 * @returns {?string}
 */
function oshiStatus(result, random) {
  if (!result || result.on !== true || !Array.isArray(result.lines)) return null;
  const lines = result.lines.map((l) => oneLine(l, 24)).filter(Boolean);
  const name = oneLine(result.name, 16);
  if (!name || !lines.length) return null;
  const pick = lines[Math.floor((random || Math.random)() * lines.length) % lines.length];
  return name + ': ' + pick;
}

/** 取り直してよいか (前に取ってから everyMs 以上たったか) */
function stale(lastMs, nowMs, everyMs) {
  return !Number.isFinite(lastMs) || nowMs - lastMs >= everyMs;
}

/** 手元の暦日 (日が変われば予定を取り直す) */
function localDay(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

module.exports = {
  clean, oneLine, readResult, meetUrlOf, eventUrlOf, meetingsOf, dueActions, nextActionAt, meetingMessage,
  turnItemsOf, turnNews, myIssues, oshiStatus, stale, localDay, NOTIFY_BEFORE_MS, LATE_MS,
};
