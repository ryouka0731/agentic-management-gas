/**
 * 推しの機嫌を数える (自分の設定 oshi.mood。既定はオフ)。決め方は src/core/Oshi.js の OSHI_MOOD_RULES / oshiMoodOf。
 *
 * 守ること:
 * - **変わるのは表情とせりふだけ。** Lv・実績・ポイント・当たり・プロフィール・クリアは何も取り上げない。知らせもメールも出さない
 * - 数えるのは本人のぶんだけ (担当に本人がいるもの。担当なしなら本人が作ったもの)。ほかの人の機嫌を読む道は作らない
 * - オフの人は台帳を読まない
 * - 1人ぶんを OSHI_MOOD_RULES().cacheSeconds のあいだ CacheService に覚える。済ませた・閉じた・直したときは
 *   Issue.gs が oshiMoodForget_ で消すので、待たずに数え直す (機嫌はすぐ直る)
 */

/**
 * 機嫌の印を覚えておく器。使えなければ null (覚えずに毎回数える)。
 *
 * @returns {object|null}
 */
function oshiMoodCache_() {
  try {
    return CacheService.getScriptCache();
  } catch (e) {
    return null;
  }
}

/** @returns {string} */
function oshiMoodKey_(who) {
  return 'OSHI_MOOD:' + who;
}

/** 前に見せた機嫌の段。直ったかを見るために覚える (6時間) */
function oshiMoodLastKey_(who) {
  return 'OSHI_MOOD_LAST:' + who;
}

/**
 * 機嫌を数えるか。推しも機嫌も本人がオンにしているときだけ。
 *
 * @param {string} email
 * @returns {boolean}
 */
function oshiMoodOn_(email) {
  var who = oshiWho_(email);
  if (!who) return false;
  return prefGet_('oshi.on', who) === true && prefGet_('oshi.mood', who) === true;
}

/**
 * 東京の暦日 'YYYY-MM-DD'。台帳の期限は東京の0時の Date で返り、人が書いた字のこともある。読めなければ ''。
 *
 * @param {*} v
 * @returns {string}
 */
function oshiMoodDay_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return plainDay(v);
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var t = Date.parse(s);
  return isNaN(t) ? '' : plainDay(new Date(t));
}

/** 2つの暦日の差 (日) */
function oshiMoodDays_(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

/**
 * 本人のぶんを数える。表は1回ずつ読み、行ごとに台帳を引かない。
 *
 * @param {string} email
 * @param {Date} now
 * @param {object[]} [issues] issues の行。無ければ読む
 * @returns {{open: number, overdue: number, stale: number, lastDoneDays: (number|null)}}
 */
function oshiMoodSignals_(email, now, issues) {
  var who = oshiWho_(email);
  var rows = (issues || dbReadAll('issues')).filter(function (r) { return !r.archivedAt; });
  var made = null;
  function mine(row) {
    var as = issueAssignees(row);
    if (as.length) return as.some(function (a) { return oshiWho_(a) === who; });
    // 担当なしは作った人のもの (変更の履歴。覚えてあれば読まない)。要るときだけ求める
    if (!made) made = adviceMadeBy_(email) || {};
    return !!made[String(row.number)];
  }

  var today = plainDay(now);
  var steps = staleSteps_();
  var open = 0;
  var overdue = 0;
  var stale = 0;
  var lastDone = '';
  rows.forEach(function (row) {
    var st = String(row.state);
    if (st !== 'open' && st !== 'closed') return;
    if (!mine(row)) return;
    if (st === 'closed') {
      var d = oshiMoodDay_(row.closedAt);
      if (d && d <= today && d > lastDone) lastDone = d;
      return;
    }
    open++;
    var due = oshiMoodDay_(row.dueDate);
    if (due && due < today) overdue++;
    if (stalenessOf(row, now, steps).level >= 1) stale++;
  });
  return { open: open, overdue: overdue, stale: stale, lastDoneDays: lastDone ? oshiMoodDays_(lastDone, today) : null };
}

/**
 * 本人の機嫌。オフなら null (台帳を読まない)。
 *
 * recovered は、前に見せた機嫌がしょんぼりかむっで、いまがふつうかごきげんになったとき true
 * (覚えている間は true のまま。お祝いのせりふを出す)。
 *
 * @param {string} email
 * @param {Date} [now]
 * @returns {{level: string, reasons: Array<{kind: string, count: number}>, recovered: boolean}|null}
 */
function oshiMood_(email, now) {
  if (!oshiMoodOn_(email)) return null;
  var who = oshiWho_(email);
  var at = now || new Date();
  var today = plainDay(at);
  var cache = oshiMoodCache_();
  if (cache) {
    try {
      var hit = JSON.parse(cache.get(oshiMoodKey_(who)) || 'null');
      // 覚えたのが前の日なら数え直す (期限は日で切れる)
      if (hit && hit.day === today && oshiMoodLevelOf(hit.level)) {
        return { level: hit.level, reasons: hit.reasons || [], recovered: !!hit.recovered };
      }
    } catch (e) { /* 読めなければ数え直す */ }
  }
  var got = oshiMoodOf(oshiMoodSignals_(email, at));
  var last = '';
  try {
    last = cache ? String(cache.get(oshiMoodLastKey_(who)) || '') : '';
  } catch (e) { last = ''; }
  var recovered = (last === 'sulky' || last === 'pouty') && (got.level === 'normal' || got.level === 'happy');
  if (cache) {
    try {
      cache.put(oshiMoodKey_(who), JSON.stringify({ day: today, level: got.level, reasons: got.reasons, recovered: recovered }),
        OSHI_MOOD_RULES().cacheSeconds);
      cache.put(oshiMoodLastKey_(who), got.level, 21600);
    } catch (e) {
      Logger.log('推しの機嫌を覚えられませんでした: ' + e.message);
    }
  }
  return { level: got.level, reasons: got.reasons, recovered: recovered };
}

/**
 * 覚えている機嫌を消す (次に見たときに数え直す)。やることを済ませた・閉じた・直したときに Issue.gs が呼ぶ。
 * 失敗しても本処理を巻き戻さない。
 *
 * @param {string[]} emails
 */
function oshiMoodForget_(emails) {
  var cache = oshiMoodCache_();
  if (!cache) return;
  var seen = {};
  (emails || []).forEach(function (e) {
    var who = oshiWho_(e);
    if (!who || seen[who]) return;
    seen[who] = true;
    try {
      cache.remove(oshiMoodKey_(who));
    } catch (err) {
      Logger.log('推しの機嫌を数え直せませんでした: ' + err.message);
    }
  });
}

/**
 * 画面に渡す形。せりふは、その段の場面の自分のせりふと口調の既定から1つ (直ったときは「機嫌が直った」)。
 *
 * @param {?object} m oshiMood_
 * @param {object[]} events oshiEventsPlain_ (いま使うキャラの)
 * @returns {?object}
 */
function oshiMoodPlain_(m, events) {
  if (!m) return null;
  var lv = oshiMoodLevelOf(m.level) || oshiMoodLevelOf('normal');
  var event = m.recovered ? 'mood_recover' : lv.event;
  var line = '';
  var state = lv.state;
  (events || []).forEach(function (e) {
    if (e.key !== event) return;
    var list = (e.mine || []).concat(e.lines || []);
    if (list.length) line = list[Math.min(list.length - 1, Math.floor(Math.random() * list.length))];
    state = e.state;
  });
  return {
    level: plainText(lv.key), label: plainText(lv.label), event: plainText(event), state: plainText(state),
    recovered: !!m.recovered, line: plainText(line),
    reasons: (m.reasons || []).map(function (r) {
      return { kind: plainText(r.kind), count: plainNumber(r.count), text: plainText(oshiMoodReasonText(r.kind, r.count)) };
    }),
  };
}
