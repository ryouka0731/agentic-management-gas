/**
 * 繰り返しのやること (やること #110)。勤怠の締め・給与の計算・社会保険の手続きのように、暦で決まる仕事を
 * 周期で登録し、1日1回の回 (`recurrenceDailyOnce_`) で次の分を1つだけ起票する。
 *
 * - 暦の計算は `src/core/RecurrenceRule.js` (ピュア)。ここは台帳を読み書きする
 * - **二度作らない印は `lastIssuedFor` (最後に起票した対象日)。** 鍵 (dbWithLock_) の中で行を読み直し、
 *   印と見比べてから、やることを作り (番号を決めて書くのも同じ鍵の中)、印を書く
 * - 前の分が完了していなくても作る。本文に「前回: #番号」を添える
 * - 作れるのは誰でも。直す・止める・消すのは作った人と管理者 (docs/dev/permissions.md)
 */

/**
 * 有効か。台帳では true / 'TRUE' / 空 (止めた) のどれかで読む。
 *
 * @param {*} v
 * @returns {boolean}
 */
function recurrenceOn_(v) {
  return v === true || /^true$/i.test(String(v == null ? '' : v));
}

/**
 * 台帳の行から周期の決まりを取り出す。
 *
 * @param {object} row
 * @returns {object}
 */
function recurrenceRuleOf_(row) {
  return {
    kind: String(row.kind || ''),
    weekday: row.weekday,
    day: row.day,
    month: row.month,
    leadDays: row.leadDays,
  };
}

/**
 * 0〜上限の整数にする。空は既定。
 *
 * @param {*} v
 * @param {number} fallback
 * @param {string} what 断るときの名前
 * @returns {number}
 */
function recurrenceDays_(v, fallback, what) {
  if (v === '' || v === null || v === undefined) return fallback;
  var n = Number(v);
  if (Math.floor(n) !== n || n < 0 || n > RECURRENCE_DAYS_MAX()) {
    throw new Error(what + 'は 0〜' + RECURRENCE_DAYS_MAX() + ' の日数で入れてください');
  }
  return n;
}

/**
 * 画面・命令から受けた欄を確かめて、台帳に書く形にする。
 *
 * @param {object} input
 * @param {object} [before] 直すときの今の行 (渡されなかった欄は今のまま)
 * @returns {object}
 */
function recurrenceFields_(input, before) {
  var src = input || {};
  var base = before || {};
  function pick(k, d) {
    return Object.prototype.hasOwnProperty.call(src, k) ? src[k] : (before ? base[k] : d);
  }

  var title = String(pick('title', '') == null ? '' : pick('title', ''));
  if (!/^[\s\S]{1,200}$/.test(title) || !title.replace(/\s/g, '')) throw new Error('題名を入力してください');

  var rule = {
    kind: String(pick('kind', '') || ''),
    weekday: pick('weekday', ''),
    day: pick('day', ''),
    month: pick('month', ''),
  };
  var bad = recurrenceRuleCheck(rule);
  if (bad) throw new Error(bad);

  // 使わない欄は空にする (毎週に変えたのに日が残ると、読み違える)
  var out = {
    title: title,
    body: String(pick('body', '') == null ? '' : pick('body', '')),
    assignee: issueAssigneeClean(pick('assignee', '') || ''),
    kind: rule.kind,
    weekday: rule.kind === 'weekly' ? Number(rule.weekday) : '',
    day: rule.kind === 'weekly' ? '' : Number(rule.day),
    month: rule.kind === 'yearly' ? Number(rule.month) : '',
    dueDays: recurrenceDays_(pick('dueDays', ''), 0, '期限までの日数'),
    leadDays: recurrenceDays_(pick('leadDays', ''), RECURRENCE_LEAD_DEFAULT(), '何日前に作るか'),
  };
  if (out.body.length > 20000) throw new Error('本文は2万字までにしてください');
  if (Object.prototype.hasOwnProperty.call(src, 'active')) {
    out.active = recurrenceOn_(src.active) || src.active === 1;
  }
  return out;
}

/**
 * 直す・止める・消すのは、作った人と管理者だけ。
 *
 * @param {object} row
 * @param {string} who
 */
function recurrenceAssertCanEdit_(row, who) {
  var me = String(who || '').toLowerCase();
  if (me && String(row.createdBy || '').toLowerCase() === me) return;
  repoAssertAdmin_('ほかの人が作った繰り返しを直す・止める・消すこと', who);
}

/**
 * 画面に渡せる形にする。
 *
 * @param {object} row
 * @param {string} me 小文字のアドレス
 * @param {boolean} admin
 * @param {string} today 'YYYY-MM-DD'
 * @returns {object}
 */
function recurrencePlain_(row, me, admin, today) {
  var rule = recurrenceRuleOf_(row);
  var ok = !recurrenceRuleCheck(rule);
  var last = plainDay(row.lastIssuedFor);
  var from = today;
  if (recurrenceDayValid(last) && recurrenceShift(last, 1) > from) from = recurrenceShift(last, 1);
  var next = ok ? recurrenceNextOn(rule, from) : '';
  var lead = Number(row.leadDays === '' || row.leadDays == null ? RECURRENCE_LEAD_DEFAULT() : row.leadDays);
  return {
    id: plainId(row.id),
    title: plainText(row.title),
    body: plainText(row.body),
    assignee: plainText(row.assignee),
    kind: plainText(row.kind),
    weekday: plainNumber(row.weekday),
    day: plainNumber(row.day),
    month: plainNumber(row.month),
    dueDays: plainNumber(row.dueDays) === '' ? 0 : plainNumber(row.dueDays),
    leadDays: isNaN(lead) ? RECURRENCE_LEAD_DEFAULT() : lead,
    active: recurrenceOn_(row.active),
    ruleText: ok ? recurrenceRuleText(rule) : '',
    nextOn: next,
    // 次の分を起票する日
    issueOn: next ? recurrenceShift(next, -(isNaN(lead) ? RECURRENCE_LEAD_DEFAULT() : lead)) : '',
    lastIssuedFor: last,
    lastIssueNumber: plainNumber(row.lastIssueNumber),
    createdBy: plainText(row.createdBy),
    createdAt: plainDate(row.createdAt),
    canEdit: admin || (!!me && String(row.createdBy || '').toLowerCase() === me),
  };
}

/**
 * 一覧 (番号の順)。
 *
 * @param {string} who 見る人
 * @param {Date} [now]
 * @returns {object[]}
 */
function recurrenceList_(who, now) {
  var me = String(who || '').toLowerCase();
  var today = recurrenceTodayOf((now || new Date()).getTime());
  var rows = dbReadAll('recurrences');
  // 管理者かは Drive を読むので、自分のもの以外があるときだけ1回見る
  var others = rows.some(function (r) { return String(r.createdBy || '').toLowerCase() !== me; });
  var admin = others ? repoIsAdmin_(who) : false;
  return rows
    .map(function (r) { return recurrencePlain_(r, me, admin, today); })
    .sort(function (a, b) { return a.id - b.id; });
}

/**
 * 作る。誰でも作れる。
 *
 * @param {object} fields
 * @param {string} who 作った人
 * @returns {object} 画面に渡せる形
 */
function recurrenceCreate_(fields, who) {
  var by = String(who || '').toLowerCase();
  if (!by) throw new Error('作った人が分かりません');
  var row = recurrenceFields_(fields, null);
  row.active = Object.prototype.hasOwnProperty.call(row, 'active') ? row.active : true;
  row.lastIssuedFor = '';
  row.lastIssueNumber = '';
  row.createdBy = by;
  row.createdAt = new Date();
  dbAppendNumbered('recurrences', 'id', row);
  return recurrencePlain_(row, by, false, recurrenceTodayOf(Date.now()));
}

/**
 * 直す・止める (active: false)・動かし直す。作った人と管理者だけ。
 *
 * @param {number} id
 * @param {object} patch
 * @param {string} who
 * @returns {object}
 */
function recurrenceUpdate_(id, patch, who) {
  var row = dbFindOne('recurrences', 'id', id);
  if (!row) throw new Error('繰り返しが見つかりません: ' + id);
  // 管理者かは Drive を読むので鍵の外で確かめる。作った人は変わらないので、鍵の中で読み直しても同じ
  recurrenceAssertCanEdit_(row, who);
  var next = recurrenceFields_(patch || {}, row);
  var after;
  dbWithLock_(30000, function () {
    var current = dbFindOne('recurrences', 'id', id);
    if (!current) throw new Error('繰り返しが見つかりません: ' + id);
    dbUpdate('recurrences', 'id', id, next);
    after = dbFindOne('recurrences', 'id', id);
  });
  return recurrencePlain_(after, String(who || '').toLowerCase(), true, recurrenceTodayOf(Date.now()));
}

/**
 * 消す。作った人と管理者だけ。**これまでに作ったやることは消さない** (別の仕事として残る)。
 *
 * @param {number} id
 * @param {string} who
 * @returns {boolean}
 */
function recurrenceDelete_(id, who) {
  var row = dbFindOne('recurrences', 'id', id);
  if (!row) throw new Error('繰り返しが見つかりません: ' + id);
  recurrenceAssertCanEdit_(row, who);
  return dbDelete('recurrences', 'id', id);
}

/**
 * 起票するやることの本文。前の分の番号を添える (完了していなければ、そう書く)。
 *
 * @param {object} row
 * @param {string} target
 * @returns {string}
 */
function recurrenceIssueBody_(row, target) {
  var lines = [];
  var body = plainText(row.body);
  if (body) lines.push(body, '');
  lines.push('繰り返し (' + recurrenceRuleText(recurrenceRuleOf_(row)) + ') の ' + recurrenceDayLabel(target) + ' の分です。');
  var prev = Number(row.lastIssueNumber);
  if (prev > 0) {
    var before = dbFindOne('issues', 'number', prev);
    var open = before && String(before.state) === 'open';
    lines.push('前回: #' + prev + (open ? ' (まだ完了していません)' : ''));
  }
  return lines.join('\n');
}

/**
 * 1つの繰り返しの今日の分を作る。**印を見てから作って印を書くまでを1つの鍵の中で行う。**
 *
 * @param {number} id
 * @param {string} today
 * @returns {number|null} 作ったやることの番号。作らなければ null。鍵が取れなければ false
 */
function recurrenceIssueOne_(id, today) {
  return dbWithLock_(10000, function () {
    var row = dbFindOne('recurrences', 'id', id);
    if (!row || !recurrenceOn_(row.active)) return null;
    var rule = recurrenceRuleOf_(row);
    if (recurrenceRuleCheck(rule)) return null;
    var last = plainDay(row.lastIssuedFor);
    var target = recurrenceDueFor(rule, today, last);
    if (!target || target === last) return null;

    var dueDays = Number(row.dueDays) > 0 ? Number(row.dueDays) : 0;
    var issue = issueCreate(
      plainText(row.title) + ' (' + recurrenceDayLabel(target) + ')',
      recurrenceIssueBody_(row, target),
      [], '',
      { assignee: plainText(row.assignee), dueDate: recurrenceShift(target, dueDays), auto: true });
    // 印は作った直後に書く。ボードに置くところで落ちても、次の回に同じ分をもう一度作らない
    dbUpdate('recurrences', 'id', id, { lastIssuedFor: target, lastIssueNumber: issue.number });
    try {
      if (typeof projectPlace === 'function') projectPlace(issue.number, 'Backlog');
    } catch (e) {
      Logger.log('繰り返しのやること #' + issue.number + ' をボードに置けませんでした: ' + e.message);
    }
    return issue.number;
  }, function () { return false; });
}

/**
 * 今日の分を全部作る。読んで選ぶのは鍵の外、作るところは1つずつ短い鍵の中。
 *
 * @param {Date} [now]
 * @returns {{created: number[], busy: number}}
 */
function recurrenceIssueDue_(now) {
  var today = recurrenceTodayOf((now || new Date()).getTime());
  var out = { created: [], busy: 0 };
  dbReadAll('recurrences').forEach(function (r) {
    if (!recurrenceOn_(r.active)) return;
    var rule = recurrenceRuleOf_(r);
    if (recurrenceRuleCheck(rule)) return;
    if (!recurrenceDueFor(rule, today, plainDay(r.lastIssuedFor))) return;
    try {
      var n = recurrenceIssueOne_(r.id, today);
      if (n === false) out.busy++;
      else if (n) out.created.push(n);
    } catch (e) {
      // 1つ壊れた行 (担当の書き間違いなど) で、ほかの分を止めない
      Logger.log('繰り返し ' + r.id + ' のやることを作れませんでした: ' + e.message);
    }
  });
  return out;
}

/**
 * 1日1回だけ、繰り返しのやること (と文書の見直し) を起票する。processCommandQueue が成果の数のあとに呼ぶ。
 *
 * - **片付けとも成果の数とも別の印** (`RECURRENCE_ON` = その日)。outcomesDailyOnce_ と同じ形
 * - 片付けが済んだ日だけ走る (`ARCHIVE_HOUSEKEPT_ON` が今日)。捨てたものを片付けてから作る
 * - 受け持つ印 (`RECURRENCE_RUNNING`) は短い鍵の中で付け、作るのは鍵の外 (1つずつ短い鍵を取る)。
 *   受け持ったまま落ちても30分で受け持ち直す
 * - **鍵が取れなかった分があれば済みの印を付けない** (次の回 = 1分あとにもう一度。作った分は印で二度作らない)
 *
 * @param {Date} [now]
 * @returns {boolean} 回したか
 */
function recurrenceDailyOnce_(now) {
  var at = now || new Date();
  var props = PropertiesService.getScriptProperties();
  var today = recurrenceTodayOf(at.getTime());
  if (props.getProperty('RECURRENCE_ON') === today) return false;
  if (props.getProperty('ARCHIVE_HOUSEKEPT_ON') !== today) return false;

  var claimed = dbWithLock_(5000, function () {
    if (props.getProperty('RECURRENCE_ON') === today) return false;
    var running = String(props.getProperty('RECURRENCE_RUNNING') || '').split('|');
    if (running[0] === today && Date.now() - Number(running[1]) < 30 * 60 * 1000) return false;
    props.setProperty('RECURRENCE_RUNNING', today + '|' + Date.now());
    return true;
  }, function () { return false; });
  if (!claimed) return false;

  try {
    var busy = recurrenceIssueDue_(at).busy;
    if (!busy) props.setProperty('RECURRENCE_ON', today);
    return true;
  } finally {
    props.deleteProperty('RECURRENCE_RUNNING');
  }
}
