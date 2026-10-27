'use strict';
/*
 * 拡張の動き。vscode の API は ui (extension.js が作る薄い層) を通してだけ触る。test/ は ui と頼み先を差し替えて動かす。
 *
 * 見張りは1本 (tick)。15 秒ごとに呼ばれ、時刻が来たものだけをする:
 * - 会議: 始まりの1分前に知らせ、autoOpen なら始まりに会議の URL を開く。予定は1日の始まりと 30 分ごとに取り直す
 * - あなたの番: pollMinutes ごとに homeMine を見て、増えたものを知らせる
 * - 推し: 1時間に1回まで oshiSpinner を取り直し、ステータスバーに名前と一言を出す
 */
const logic = require('./logic');

const MEETINGS_EVERY_MS = 30 * 60 * 1000;
const OSHI_EVERY_MS = 60 * 60 * 1000;

/**
 * @param {object} o
 * @param {object} o.ui {info, warn, open, status, issues, log, openSettings}
 * @param {function(): {kitDir: string, email: string, pollMinutes: number, autoOpen: boolean, oshi: boolean}} o.settings
 * @param {function(object): {queue: ?{send: function, dispose: function}, reason: string}} o.connect 設定から頼み先を作る
 * @param {function(): number} [o.now]
 * @param {function(): number} [o.random]
 */
function createApp(o) {
  const ui = o.ui;
  const now = o.now || Date.now;
  const st = {
    queue: null, reason: '', warned: false,
    seen: null, lastTurn: NaN,
    meetings: [], done: new Set(), lastMeet: NaN, meetDay: '',
    lastOshi: NaN,
    busy: new Set(),
  };

  function cfg() {
    return o.settings();
  }

  /** 頼み先を作り直す (設定が変わったとき)。見つからなければ一度だけ案内する */
  function connect() {
    if (st.queue) st.queue.dispose();
    const got = o.connect(cfg());
    st.queue = got.queue;
    st.reason = got.reason || '';
    if (!st.queue) {
      ui.issues([], st.reason);
      ui.status(null);
      if (!st.warned) {
        st.warned = true;
        Promise.resolve(ui.warn('番頭: ' + st.reason, '設定を開く'))
          .then((pick) => { if (pick === '設定を開く') ui.openSettings(); })
          .catch(() => {});
      }
    }
    return !!st.queue;
  }

  /** 同じ頼みを重ねない。返事を待つあいだ (数分かかる) に次の tick が来ても送り直さない */
  async function once(name, fn) {
    if (st.busy.has(name)) return undefined;
    st.busy.add(name);
    try {
      return await fn();
    } finally {
      st.busy.delete(name);
    }
  }

  async function ask(op, args) {
    if (!st.queue) throw new Error(st.reason || '番頭に頼めません');
    return st.queue.send(op, args || {});
  }

  // ----- やること -----

  async function refreshIssues(loud) {
    if (!st.queue) { ui.issues([], st.reason); return; }
    return once('issues', async () => {
      try {
        const me = cfg().email;
        const list = logic.myIssues(await ask('issueList', { state: 'open' }), me);
        ui.issues(list, me ? (list.length ? '' : '担当の open なやることはありません')
          : '担当で絞るには、設定の banto.email に自分のアドレスを入れてください');
      } catch (e) {
        ui.log('やることを取れませんでした: ' + e.message);
        if (loud) ui.warn('番頭: やることを取れませんでした (' + e.message + ')');
      }
    });
  }

  function showIssue(item) {
    if (!item) return;
    const detail = [item.due ? '期限 ' + item.due : '', item.priority ? '優先度 ' + item.priority : '']
      .filter(Boolean).join(' / ');
    return ui.info('#' + item.number + ' ' + item.title, { modal: true, detail: (detail ? detail + '\n\n' : '') + (item.body || '(本文なし)') });
  }

  // ----- あなたの番 -----

  async function pollTurn() {
    st.lastTurn = now();
    return once('turn', async () => {
      try {
        const items = logic.turnItemsOf(await ask('homeMine'));
        const news = logic.turnNews(st.seen, items);
        st.seen = news.seen;
        for (const m of news.messages) ui.info(m);
      } catch (e) {
        ui.log('あなたの番を見られませんでした: ' + e.message);
      }
    });
  }

  // ----- 会議 -----

  async function fetchMeetings() {
    st.lastMeet = now();
    st.meetDay = logic.localDay(now());
    return once('meetings', async () => {
      try {
        st.meetings = logic.meetingsOf(await ask('calendarToday'));
      } catch (e) {
        ui.log('今日の予定を取れませんでした: ' + e.message);
      }
    });
  }

  /** 会議に入る。開いた印を付ける (同じ予定で二度自動では開かない) */
  function join(m) {
    st.done.add('open:' + m.key);
    const url = m.meetUrl || m.eventUrl;
    if (url) ui.open(url);
  }

  function runMeetings() {
    const t = now();
    const opts = { autoOpen: !!cfg().autoOpen };
    for (const a of logic.dueActions(st.meetings, t, opts, st.done)) {
      const m = a.meeting;
      if (a.kind === 'notify') {
        st.done.add('notify:' + m.key);
        const buttons = m.meetUrl ? ['入る'] : (m.eventUrl ? ['予定を開く'] : []);
        Promise.resolve(ui.info(logic.meetingMessage(m), ...buttons))
          .then((pick) => { if (pick === '入る' || pick === '予定を開く') join(m); })
          .catch(() => {});
      } else if (a.kind === 'open') {
        st.done.add('open:' + m.key);
        ui.open(m.meetUrl);
      }
    }
  }

  // ----- 推し -----

  async function fetchOshi() {
    if (!cfg().oshi) { ui.status(null); return; }
    st.lastOshi = now();
    return once('oshi', async () => {
      try {
        ui.status(logic.oshiStatus(await ask('oshiSpinner'), o.random));
      } catch (e) {
        ui.log('推しの一言を取れませんでした: ' + e.message);
        ui.status(null);
      }
    });
  }

  /** 見張り。15 秒ごとに呼ぶ。待たない (頼みの返事は数分かかる) */
  function tick() {
    if (!st.queue) return;
    runMeetings();
    const t = now();
    const c = cfg();
    const every = Math.max(1, Number(c.pollMinutes) || 5) * 60 * 1000;
    if (logic.stale(st.lastTurn, t, every)) pollTurn();
    if (logic.stale(st.lastMeet, t, MEETINGS_EVERY_MS) || st.meetDay !== logic.localDay(t)) fetchMeetings();
    if (c.oshi && logic.stale(st.lastOshi, t, OSHI_EVERY_MS)) fetchOshi();
  }

  function start() {
    if (connect()) {
      refreshIssues(false);
      tick();
    }
  }

  /** 設定が変わったとき。入れ先が変われば初めから */
  function reconfigure() {
    st.warned = false;
    st.seen = null;
    st.lastTurn = NaN;
    st.lastMeet = NaN;
    st.lastOshi = NaN;
    start();
  }

  function dispose() {
    if (st.queue) st.queue.dispose();
  }

  return { start, tick, reconfigure, refreshIssues, showIssue, join, dispose, fetchMeetings, fetchOshi, state: st };
}

module.exports = { createApp, MEETINGS_EVERY_MS, OSHI_EVERY_MS };
