/**
 * 実績 (バッジ) を数えて覚える。定義 (何を・いくつで) は src/core/Achievements.js が持つ。
 *
 * - **覚えるのはスクリプトプロパティ `ACH:<小文字のアドレス>` の1つの値だけ** = {days: {n, last: 'yyyy-MM-dd'}, got: {key: 'yyyy-MM-dd'}}。
 *   days は通算で開いた日 (東京の暦日ごとに1回)、got は取った日 (東京の暦日)。値は1つ 9KB までなので、時刻ではなく日を置く
 * - 前の形 (日を `ACH_DAYS:<アドレス>` に、取った印を時刻で) は読むときに今の形にし、書くとき (鍵の中) に ACH_DAYS を消す
 * - **書くのは短い鍵 (dbWithLock_) の中で、読み直してから。** 開いた日を2つのタブで2日にしない・同じ実績を2回「取った」と言わない。
 *   鍵の中で台帳も Drive も読まない
 * - **一度取ったら消さない。** 使われ方 (usage) は USAGE_KEEP_DAYS で間引かれ、やることの完了は取り消せるので、いまの数だけで決めると消える
 * - 数は台帳と、今あるスクリプトプロパティ (STYLE: / CAL_PLANNED: / MYPREF: / OUTCOME_QUEUE:) と使われ方の場所から数える。
 *   **実績のための記録の表は作らない**
 * - 全部を数え直すのは開いたときだけ。済ませたあとは変わりうるもの (metrics) だけを数える。「はじめて」がまだなことは
 *   その日のうちは CacheService に覚え、頁を開くたびに読み直さない (名指しで数え直すときは覚えを使わない)
 * - 手元からの命令で書いた行は持ち主の名で残るので、命令を置いた人 (OUTCOME_QUEUE:) のものとして数える
 * - UserProperties には置かない (通知やキューは別の人の権限で走る。MYPREF: と同じ事情)。読むのは前の育ちの段 (OSHI_STAGE_MAX:) だけ
 *
 * **見せるのは本人にだけ。** アドレスを受ける関数は末尾 _ (画面から呼べない)。api は開いている本人のアドレスだけを渡す。
 * 順位は作らない。
 */

/** @returns {string} 小文字のアドレス */
function achWho_(email) {
  return String(email || '').replace(/^\s+|\s+$/g, '').toLowerCase();
}

/** 覚えの鍵 (日と取った印) */
function achKey_(who) {
  return 'ACH:' + achWho_(who);
}

/**
 * **この環境では (まだ) 取れない実績と、その理由。決めるのはここだけ。** クリア (oshiClearedOf_)・実績の頁の数・
 * 「クリアで分かる」の Lv は、取れない実績を数えない。**取った実績は、取れなくなっても数える** (取り上げない) ので、
 * 取った印のあるものはここに入れない。理由は、どの設定をオンにすれば取れるかを言う。
 *
 * - いっしょに (team の6つ)・はじめての 反映した・承認した: 番頭を使っているのが本人1人のとき (承認や返事をする相手がいない)
 * - 目標を立てた: チームの設定 goals.enabled がオフ
 * - 予定に入れた: 共有カレンダー (calendar.shared) が決まっていない・自分の calendar.plan がオフ
 * - 使われ方で数えるもの (Markdown・日報・探す): チームの usage.enabled か自分の usage.self がオフ
 * - 集中を始めた: 自分の focus.start がオフ。推しを選んだ: 自分の oshi.on がオフ
 * - 手元の道具を使った: いつも取れる (だれでも入れられる。ACH_TIPS で取り方を見せる)
 *
 * @param {string} email
 * @param {Object<string, string>} [have] 取った印 (省くと読む)
 * @returns {Object<string, string>} key → 理由
 */
function achUnavailable_(email, have) {
  var who = achWho_(email);
  var got = have || achUnlockedRead_(who);
  var off = {};
  function mark(keys, reason) {
    keys.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(got, k) && !off[k]) off[k] = reason;
    });
  }
  var all = ACHIEVEMENTS();
  if (achSolo_(who)) {
    mark(all.filter(function (a) { return a.group === 'team' || a.key === 'first-merge' || a.key === 'first-approve'; })
      .map(function (a) { return a.key; }),
    'ほかの人がいると取れます (いま番頭を使っているのは、あなた1人です。確認や承認をする相手が要ります)');
  }
  if (prefGet_('goals.enabled', who) !== true) {
    mark(['first-goal'], 'チームの設定「目標 (OKR・MBO・KPI) を使う」をオンにすると取れます (管理者が変えられます)');
  }
  if (!prefGet_('calendar.shared', who)) {
    mark(['first-calendar'], '管理者が設定で「予定を入れる共有カレンダー」を決めると取れます');
  } else if (prefGet_('calendar.plan', who) !== true) {
    mark(['first-calendar'], '自分の設定「やることを予定に入れる」をオンにすると取れます');
  }
  var usageOff = prefGet_('usage.enabled', who) === false
    ? 'チームの設定「使われ方を記録する」をオンにすると取れます (管理者が変えられます)'
    : prefGet_('usage.self', who) === false ? '自分の設定「自分の使われ方を記録する」をオンにすると取れます' : '';
  if (usageOff) {
    mark(Object.keys(ACH_USAGE_PLACES()).filter(function (m) { return m !== 'oshi'; })
      .map(function (m) { return 'first-' + m; }), usageOff);
  }
  if (prefGet_('focus.start', who) !== true) mark(['first-focus'], '自分の設定「今から始める」(集中のしかた) をオンにすると取れます');
  if (prefGet_('oshi.on', who) === false) mark(['first-oshi'], '自分の設定「推しに応援してもらう」をオンにすると取れます');
  return off;
}

/**
 * 番頭を使っているのが本人1人か。共有ドライブは台帳を書き換えられる人 (driveMembers_)、マイドライブは入れ物の持ち主と
 * 編集する人、どちらも上下関係の名簿 (members) の人を足す。**分からないとき (読めない) は1人とは言わない** (取れるものを
 * 取れないと言うより、まだ取れないほうがよい)。分かった答えは CacheService に10分覚える (開くたびに Drive に問い合わせない)。
 *
 * @param {string} who 小文字のアドレス
 * @returns {boolean}
 */
function achSolo_(who) {
  var key = 'ACH_PEOPLE:' + who;
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(key);
    if (hit === 'solo' || hit === 'team') return hit === 'solo';
  } catch (e) {
    cache = null;
  }
  var seen = {};
  function add(v) {
    var w = achWho_(v);
    if (w) seen[w] = true;
  }
  add(who);
  var known = false;
  var driveId = repoDriveIdSafe_();
  if (driveId) {
    var m = driveMembers_(driveId);
    if (m.admins.length) {
      known = true;
      m.admins.forEach(add);
    }
  } else {
    var owner = repoOwnerEmail();
    if (owner) {
      known = true;
      add(owner);
      try {
        DriveApp.getFolderById(repoConfig().rootId).getEditors().forEach(function (e) { add(e.getEmail()); });
      } catch (e2) {
        known = false;
      }
    }
  }
  try {
    dbReadAll('members').forEach(function (r) { add(r.email); add(r.manager); });
  } catch (e3) {
    // 名簿が読めなくても、役割で分かったぶんで決める
  }
  var many = Object.keys(seen).length > 1;
  if (!many && !known) return false;
  try {
    if (cache) cache.put(key, many ? 'team' : 'solo', 600);
  } catch (e4) {
    // 覚えられなければ、次も問い合わせるだけ
  }
  return !many;
}

/** 前の形の、通算で開いた日の鍵 (読んで移すだけ) */
function achDaysKey_(who) {
  return 'ACH_DAYS:' + achWho_(who);
}

/** 実績の使われ方の場所。画面が押したときに usageCount('action', ...) で数える (数を足すだけの安い記録) */
function ACH_USAGE_PLACES() {
  return { markdown: 'md-save', reportCopy: 'report-copy', search: 'search-open', oshi: 'oshi-choose' };
}

/** @returns {{n: number, last: string}} 読めなければ 0 日 */
function achDaysOf_(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { n: 0, last: '' };
  var n = Math.floor(Number(v.n));
  return { n: isFinite(n) && n > 0 ? n : 0, last: /^\d{4}-\d{2}-\d{2}$/.test(String(v.last)) ? String(v.last) : '' };
}

/**
 * 覚えを読む。前の形も読む (legacy: 書くときに今の形にして ACH_DAYS を消す)。知らない key と日でないものは落とす
 * (人がエディタで書き換えうる)。前の形の取った時刻は、東京の暦日にする。
 *
 * @param {string} who
 * @returns {{days: {n: number, last: string}, got: Object<string, string>, legacy: boolean}}
 */
function achRead_(who) {
  var props = PropertiesService.getScriptProperties();
  var v = prefParse_(props.getProperty(achKey_(who)));
  var oldDays = props.getProperty(achDaysKey_(who));
  var obj = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  var fresh = obj.got && typeof obj.got === 'object' && !Array.isArray(obj.got);
  var src = fresh ? obj.got : obj;
  var got = {};
  Object.keys(src).forEach(function (k) {
    if (!achOf(k)) return;
    var day = String(src[k]);
    if (/^\d{4}-\d{2}-\d{2}T/.test(day)) {
      var t = new Date(day);
      day = isNaN(t.getTime()) ? '' : usageDay(t);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) got[k] = day;
  });
  var days = fresh || obj.days ? achDaysOf_(obj.days) : { n: 0, last: '' };
  if (oldDays !== null && oldDays !== undefined) {
    var o = achDaysOf_(prefParse_(oldDays));
    if (o.n > days.n) days = o;
  }
  return { days: days, got: got, legacy: !fresh || (oldDays !== null && oldDays !== undefined) };
}

/** 今の形で書き、前の形の鍵を消す。**鍵の中で呼ぶ** */
function achWrite_(who, rec) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(achKey_(who), JSON.stringify({ days: { n: rec.days.n, last: rec.days.last }, got: rec.got }));
  props.deleteProperty(achDaysKey_(who));
}

/** @returns {{n: number, last: string}} 通算で開いた日 */
function achDaysRead_(who) {
  return achRead_(achWho_(who)).days;
}

/** @returns {Object<string, string>} 取った印 (key → 取った日) */
function achUnlockedRead_(who) {
  return achRead_(achWho_(who)).got;
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
    var rec = achRead_(w);
    if (rec.days.last === today) {
      if (rec.legacy) achWrite_(w, rec);
      return { n: rec.days.n, last: rec.days.last, counted: false };
    }
    rec.days = { n: rec.days.n + 1, last: today };
    achWrite_(w, rec);
    return { n: rec.days.n, last: rec.days.last, counted: true };
  }, function () { return null; });
  if (got) return got;
  var seen = achDaysRead_(w);
  return { n: seen.n, last: seen.last, counted: false };
}

/**
 * 前に届いていた育ちの段 (0〜)。実績の前は、育ちの最高の段を開いている本人の UserProperties の OSHI_STAGE_MAX: に覚えていた。
 * それより下に戻さないための床。読めなければ 0。
 *
 * @param {string} who
 * @returns {number}
 */
function achStageFloor_(who) {
  try {
    var n = Math.floor(Number(PropertiesService.getUserProperties().getProperty('OSHI_STAGE_MAX:' + achWho_(who))));
    return isFinite(n) && n > 0 ? Math.min(n, OSHI_STAGES().length - 1) : 0;
  } catch (e) {
    return 0;
  }
}

/** 「はじめて」がまだなことの、その日の覚えの鍵 */
function achNegKey_(who, day) {
  return 'ACH_NEG:' + achWho_(who) + ':' + day;
}

/** @returns {Object<string, boolean>} その日に「まだ」と分かった「はじめて」の数えるもの。覚えが使えなければ空 */
function achNegRead_(who, day) {
  try {
    var v = prefParse_(CacheService.getScriptCache().get(achNegKey_(who, day)));
    var out = {};
    if (Array.isArray(v)) v.forEach(function (m) { out[String(m)] = true; });
    return out;
  } catch (e) {
    return {};
  }
}

/** その日に「まだ」と分かった「はじめて」の数えるものを覚える (覚えられなくても止めない) */
function achNegWrite_(who, day, metrics) {
  try {
    CacheService.getScriptCache().put(achNegKey_(who, day), JSON.stringify(metrics), 21600);
  } catch (e) {
    // 覚えられなければ、次も数えるだけ
  }
}

/**
 * 手元からの命令で書いた行は、トリガーを仕掛けた人 (持ち主) の名で残る。命令の走った時間の中なら、命令を置いた人にする
 * (outcomes と同じ考え方)。
 *
 * @param {string} who 行に残った名
 * @param {*} at 行の時刻
 * @param {Array<{s: number, e: number, runner: string, by: string}>} windows outcomesQueueWindows_()
 * @returns {string} 小文字のアドレス
 */
function achPersonOf_(who, at, windows) {
  var w = achWho_(who);
  var t = outcomesTime_(at);
  if (!w || isNaN(t)) return w;
  for (var i = 0; i < windows.length; i++) {
    var q = windows[i];
    if (achWho_(q.runner) === w && t >= q.s && t <= q.e) return achWho_(q.by);
  }
  return w;
}

/**
 * 数えるもの → 数。**まだ取っていない実績がある数えるものだけ** 数え、表は要るときに1回だけ読む
 * (全部取ったものの表は読まない)。本人のぶんだけ。
 *
 * @param {string} who 小文字のアドレス
 * @param {Object<string, string>} have 取った印
 * @param {{n: number}} days 通算で開いた日
 * @param {?Object<string, boolean>} [only] 数えるものを絞る (済ませたあとの数え直し)。無ければ全部
 * @param {?Object<string, boolean>} [skip] 数えない (その日に「まだ」と分かった「はじめて」)
 * @returns {Object<string, number>}
 */
function achCounts_(who, have, days, only, skip) {
  var need = {};
  ACHIEVEMENTS().forEach(function (a) {
    if (Object.prototype.hasOwnProperty.call(have, a.key)) return;
    if (only && !only[a.metric]) return;
    if (skip && skip[a.metric]) return;
    need[a.metric] = true;
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
    // 手元からの命令で反映したものは持ち主の名で残るので、命令を置いた人のものにする
    merge: function () {
      var windows = outcomesQueueWindows_();
      return rows('commits').some(function (c) {
        return String(c.message || '').indexOf('反映: 確認依頼 #') === 0 && achPersonOf_(c.author, c.timestamp, windows) === who;
      }) ? 1 : 0;
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
 * - countDay: 開いた日を数える (開いたときに1回だけ)
 * - metrics: 数えるものを絞る (済ませたあと)。無ければ全部数え、「はじめて」でまだなものをその日の覚えに書く
 * - useNeg: その日に「まだ」と分かった「はじめて」を数えない (頁を開いたとき)
 *
 * @param {string} email
 * @param {Date} now
 * @param {{countDay?: boolean, metrics?: string[], useNeg?: boolean}} [opts]
 * @returns {{who: string, days: {n: number, last: string}, have: Object<string, string>, newly: string[],
 *   counts: Object<string, number>, partial: boolean}}
 */
function achCheck_(email, now, opts) {
  var o = opts || {};
  var who = achWho_(email);
  if (!who) return { who: '', days: { n: 0, last: '' }, have: {}, newly: [], counts: {}, partial: false };
  var today = usageDay(now);
  var days = o.countDay ? achDaysTouch_(who, now) : achDaysRead_(who);
  var have = achUnlockedRead_(who);
  var only = null;
  if (o.metrics) {
    var known = ACH_METRICS();
    only = {};
    o.metrics.forEach(function (m) { if (Object.prototype.hasOwnProperty.call(known, String(m))) only[String(m)] = true; });
  }
  var counts = achCounts_(who, have, days, only, o.useNeg && !only ? achNegRead_(who, today) : null);
  if (!only) {
    var metrics = ACH_METRICS();
    var neg = Object.keys(counts).filter(function (m) { return metrics[m].first && !counts[m]; });
    if (o.useNeg) Object.keys(achNegRead_(who, today)).forEach(function (m) { if (neg.indexOf(m) < 0) neg.push(m); });
    achNegWrite_(who, today, neg);
  }
  var reached = achNewly(counts, have);
  var newly = [];
  if (reached.length) {
    var wrote = dbWithLock_(5000, function () {
      var rec = achRead_(who);
      var added = [];
      reached.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(rec.got, k)) return;
        rec.got[k] = today;
        added.push(k);
      });
      if (added.length || rec.legacy) achWrite_(who, rec);
      return { cur: rec.got, added: added };
    }, function () { return null; });
    if (wrote) {
      have = wrote.cur;
      newly = wrote.added;
    }
  }
  return { who: who, days: { n: days.n, last: days.last }, have: have, newly: newly, counts: counts, partial: !!only };
}

/**
 * 推しのレベル (1 + 取った実績の数) と育ちの段 (前に届いていた段より下にしない)。取った印を読むだけで、台帳は読まない。
 *
 * @param {string} email
 * @returns {{level: number, unlocked: number, index: number, key: string, label: string, meter: number, toNext: number, floored: boolean}}
 */
function achLevel_(email) {
  var n = Object.keys(achUnlockedRead_(email)).length;
  var st = oshiStageOf(achLevelOf(n), achStageFloor_(email));
  return { level: st.level, unlocked: n, index: st.index, key: st.key, label: st.label, meter: st.meter, toNext: st.toNext,
    floored: st.floored };
}
