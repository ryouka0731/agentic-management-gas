/**
 * 実績 (バッジ) を数えて覚える。定義 (何を・いくつで) は src/core/Achievements.js が持つ。
 *
 * - **通算で開いた日** はスクリプトプロパティ `ACH_DAYS:<小文字のアドレス>` = {n, last: 'yyyy-MM-dd'} に覚える。
 *   東京の暦日ごとに1回だけ足す。**見ることと足すことを1つの鍵の中で行う** (2つのタブで同時に開いても2日にしない)。
 *   鍵の中で Drive も台帳も読まない
 * - **取った印** は `ACH:<小文字のアドレス>` = {key: 取った時刻 (ISO)} に覚える。**一度取ったら消さない。**
 *   使われ方 (usage) は USAGE_KEEP_DAYS で間引かれ、やることの完了は取り消せるので、いまの数だけで決めると実績が消える
 * - 数は台帳と、今あるスクリプトプロパティ (STYLE: / CAL_PLANNED: / MYPREF: / OUTCOME_QUEUE:) と使われ方の場所から数える。
 *   **実績のための記録の表は作らない**
 * - UserProperties には置かない (通知やキューは別の人の権限で走る。MYPREF: と同じ事情)
 *
 * **見せるのは本人にだけ。** アドレスを受ける関数は末尾 _ (画面から呼べない)。api は開いている本人のアドレスだけを渡す。
 * 順位は作らない。
 */

/** @returns {string} 小文字のアドレス */
function achWho_(email) {
  return String(email || '').replace(/^\s+|\s+$/g, '').toLowerCase();
}

/** 通算で開いた日の鍵 */
function achDaysKey_(who) {
  return 'ACH_DAYS:' + achWho_(who);
}

/** 取った印の鍵 */
function achKey_(who) {
  return 'ACH:' + achWho_(who);
}

/** 実績の使われ方の場所。画面が押したときに usageCount('action', ...) で数える (数を足すだけの安い記録) */
function ACH_USAGE_PLACES() {
  return { markdown: 'md-save', reportCopy: 'report-copy', search: 'search-open', oshi: 'oshi-choose' };
}

/**
 * 通算で開いた日。読めなければ 0 日。
 *
 * @param {string} who
 * @returns {{n: number, last: string}}
 */
function achDaysRead_(who) {
  var v = prefParse_(PropertiesService.getScriptProperties().getProperty(achDaysKey_(who)));
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { n: 0, last: '' };
  var n = Math.floor(Number(v.n));
  return { n: isFinite(n) && n > 0 ? n : 0, last: /^\d{4}-\d{2}-\d{2}$/.test(String(v.last)) ? String(v.last) : '' };
}

/**
 * 開いた日を数える。東京の暦日ごとに1回だけ足す。**見ると足すを1つの鍵の中で** (2つのタブで2日にしない)。
 * 鍵が取れなければ数えない (次に開いたときに数える)。
 *
 * @param {string} who
 * @param {Date} now
 * @returns {{n: number, last: string, counted: boolean}}
 */
function achDaysTouch_(who, now) {
  var w = achWho_(who);
  if (!w) return { n: 0, last: '', counted: false };
  var today = usageDay(now);
  var got = dbWithLock_(5000, function () {
    var rec = achDaysRead_(w);
    if (rec.last === today) return { n: rec.n, last: rec.last, counted: false };
    var next = { n: rec.n + 1, last: today };
    PropertiesService.getScriptProperties().setProperty(achDaysKey_(w), JSON.stringify(next));
    return { n: next.n, last: next.last, counted: true };
  }, function () { return null; });
  if (got) return got;
  var seen = achDaysRead_(w);
  return { n: seen.n, last: seen.last, counted: false };
}

/**
 * 取った印。知らない key と時刻でないものは落とす (人がエディタで書き換えうる)。
 *
 * @param {string} who
 * @returns {Object<string, string>} key → 取った時刻
 */
function achUnlockedRead_(who) {
  var v = prefParse_(PropertiesService.getScriptProperties().getProperty(achKey_(who)));
  var out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  Object.keys(v).forEach(function (k) {
    if (achOf(k) && /^\d{4}-\d{2}-\d{2}T/.test(String(v[k]))) out[k] = String(v[k]);
  });
  return out;
}

/**
 * 数えるもの → 数。**まだ取っていない実績がある数えるものだけ** 数え、表は要るときに1回だけ読む
 * (全部取ったものの表は読まない)。本人のぶんだけ。
 *
 * @param {string} who 小文字のアドレス
 * @param {Object<string, string>} have 取った印
 * @param {{n: number}} days 通算で開いた日
 * @returns {Object<string, number>}
 */
function achCounts_(who, have, days) {
  var need = {};
  ACHIEVEMENTS().forEach(function (a) {
    if (!Object.prototype.hasOwnProperty.call(have, a.key)) need[a.metric] = true;
  });
  var cache = {};
  function rows(table) {
    if (!cache[table]) cache[table] = dbReadAll(table);
    return cache[table];
  }
  function mine(v) { return achWho_(v) === who; }
  function any(table, col, extra) {
    return rows(table).some(function (r) { return mine(r[col]) && (!extra || extra(r)); }) ? 1 : 0;
  }
  var usage = null;
  function used(place) {
    if (!usage) {
      usage = {};
      rows('usage').forEach(function (r) {
        if (mine(r.user) && (Number(r.count) || 0) > 0) usage[String(r.target)] = true;
      });
    }
    return usage[place] ? 1 : 0;
  }
  var places = ACH_USAGE_PLACES();
  var props = null;
  function prop(key) {
    if (!props) props = prefReader_();
    return props(key);
  }

  var counts = {};
  var count = {
    days: function () { return days.n; },
    done: function () {
      var closers = motivationClosers_();
      return rows('issues').filter(function (r) {
        return String(r.state) === 'closed' && motivationCredited_(r, closers).some(mine);
      }).length;
    },
    merged: function () {
      return rows('pulls').filter(function (p) { return String(p.state) === 'merged' && mine(p.author); }).length;
    },
    reviews: function () {
      return gameReviewCredits_(rows('pulls'), rows('reviews')).filter(function (c) { return mine(c.who); }).length;
    },
    branch: function () { return any('branches', 'createdBy', function (b) { return String(b.name) !== 'main'; }); },
    pull: function () { return any('pulls', 'author'); },
    // 反映すると、反映した人の名で「反映: 確認依頼 #…」の記録が残る (PullRequest.gs)
    merge: function () {
      return any('commits', 'author', function (c) { return String(c.message || '').indexOf('反映: 確認依頼 #') === 0; });
    },
    approve: function () { return any('reviews', 'reviewer', function (r) { return String(r.state) === 'approve'; }); },
    markdown: function () { return used(places.markdown); },
    comment: function () { return any('issue_comments', 'by') || any('inquiry_replies', 'by'); },
    inquiry: function () { return any('inquiries', 'by'); },
    reportCopy: function () { return used(places.reportCopy); },
    focus: function () { return any('focus_sessions', 'who'); },
    style: function () { return workStyleRead_(who, prop) ? 1 : 0; },
    // 既定のキャラを選び直したときは設定に残らない (既定と同じ値は消す) ので、選んだ使われ方も見る
    oshi: function () {
      var my = prefParse_(prop(prefMineKey_(who)));
      var set = !!(my && typeof my === 'object' && Object.prototype.hasOwnProperty.call(my, 'oshi.char'));
      return set ? 1 : used(places.oshi);
    },
    goal: function () { return any('goals', 'who'); },
    calendar: function () { return calendarPlannedOf_(who).day ? 1 : 0; },
    // 手元からの命令は持ち主の名で走るので、命令を置いた人の覚え (outcomesQueueNote_) で見る
    kit: function () { return outcomesQueueWindows_().some(function (q) { return mine(q.by); }) ? 1 : 0; },
    search: function () { return used(places.search); },
  };
  Object.keys(need).forEach(function (m) {
    try {
      counts[m] = count[m] ? count[m]() : 0;
    } catch (e) {
      // 1つ数えられなくても、ほかの実績は止めない (取れるのが次に開いたときになるだけ)
      counts[m] = 0;
    }
  });
  return counts;
}

/**
 * 数え直して、届いた実績を取った印に足す。**一度取ったものは消さない。**
 * 書くのは短い鍵の中だけで、鍵の中で読み直してから足す (2つのタブで同じ実績を2回「取った」と言わない)。
 * 鍵が取れなければ足さない (newly は空。次に数え直したときに取れる)。
 *
 * @param {string} email
 * @param {Date} now
 * @param {{countDay?: boolean}} [opts] countDay: 開いた日を数える (開いたときに1回だけ)
 * @returns {{who: string, days: {n: number, last: string}, have: Object<string, string>, newly: string[],
 *   counts: Object<string, number>}}
 */
function achCheck_(email, now, opts) {
  var who = achWho_(email);
  if (!who) return { who: '', days: { n: 0, last: '' }, have: {}, newly: [], counts: {} };
  var days = opts && opts.countDay ? achDaysTouch_(who, now) : achDaysRead_(who);
  var have = achUnlockedRead_(who);
  var counts = achCounts_(who, have, days);
  var reached = achNewly(counts, have);
  var newly = [];
  if (reached.length) {
    var at = now.toISOString();
    var wrote = dbWithLock_(5000, function () {
      var cur = achUnlockedRead_(who);
      var added = [];
      reached.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(cur, k)) return;
        cur[k] = at;
        added.push(k);
      });
      if (added.length) PropertiesService.getScriptProperties().setProperty(achKey_(who), JSON.stringify(cur));
      return { cur: cur, added: added };
    }, function () { return null; });
    if (wrote) {
      have = wrote.cur;
      newly = wrote.added;
    }
  }
  return { who: who, days: { n: days.n, last: days.last }, have: have, newly: newly, counts: counts };
}

/**
 * 推しのレベル (1 + 取った実績の数) と育ちの段。取った印を読むだけで、台帳は読まない。
 *
 * @param {string} email
 * @returns {{level: number, unlocked: number, index: number, key: string, label: string, meter: number, toNext: number}}
 */
function achLevel_(email) {
  var n = Object.keys(achUnlockedRead_(email)).length;
  var st = oshiStageOf(achLevelOf(n));
  return { level: st.level, unlocked: n, index: st.index, key: st.key, label: st.label, meter: st.meter, toNext: st.toNext };
}
