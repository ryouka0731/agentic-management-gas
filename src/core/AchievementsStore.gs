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
 * 取った印のあるものはここに入れない。理由は、どうすれば取れるかを言う。
 *
 * **入れるのはチームか環境の理由だけ。** 自分の設定 (usage.self / oshi.on / focus.start / calendar.plan) で止めているものは
 * 入れない (自分で切るだけでクリアに届き、クリアは消えないので取り返せない)。それは achPersonalTips_ が取り方を言うだけ。
 *
 * - いっしょに (team の6つ)・はじめての 反映した・承認した: 番頭を使っているのが本人1人のとき (achSolo_)
 * - 目標を立てた: チームの設定 goals.enabled がオフ
 * - 予定に入れた: 共有カレンダー (calendar.shared) を管理者が決めていない
 * - 作業期間を作った・困りごとを書き出した: 管理者が「期間で進める」(scrumEnabled) をオンにしていない (左に出ない)
 * - 作業雑談部屋をのぞいた: チームの設定 cowork.enabled がオフ (左に出ない)
 * - Google ToDo に送った: エディタで Tasks のサービスを足していない (tasksAvailable() が false。画面に入口が出ない)
 * - 使われ方で数えるもの (Markdown・日報・探す・作業部屋・なでる など achUsageKeys_): チームの usage.enabled がオフ
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
  }
  if (typeof scrumEnabled !== 'function' || !scrumEnabled()) {
    mark(['first-sprint', 'first-impediment'], '管理者が設定で「期間で進める」をオンにすると取れます');
  }
  if (prefGet_('cowork.enabled', who) !== true) {
    mark(['first-cowork'], 'チームの設定「作業雑談部屋を使う」をオンにすると取れます (管理者が変えられます)');
  }
  if (typeof tasksAvailable !== 'function' || !tasksAvailable()) {
    mark(['first-tasks'], '管理者がエディタの「サービス +」から Google Tasks を足すと取れます');
  }
  if (prefGet_('usage.enabled', who) === false) {
    mark(achUsageKeys_(), 'チームの設定「使われ方を記録する」をオンにすると取れます (管理者が変えられます)');
  }
  return off;
}

/**
 * 使われ方の場所だけで数える実績の key (通算の なでた・作業部屋 も含む)。台帳や設定でも数えるもの (ACH_USAGE_ALSO) は除く
 * (使われ方を記録しなくても、そちらで取れる)。
 *
 * @returns {string[]}
 */
function achUsageKeys_() {
  var places = ACH_USAGE_PLACES();
  var also = ACH_USAGE_ALSO();
  return ACHIEVEMENTS().filter(function (a) {
    return Object.prototype.hasOwnProperty.call(places, a.metric) && also.indexOf(a.metric) < 0;
  }).map(function (a) { return a.key; });
}

/** 使われ方の場所のほかに、台帳か設定でも数える数えるもの (推しを選んだ = 設定、下書き = 自分の下書きを作った) */
function ACH_USAGE_ALSO() {
  return ['oshi', 'template'];
}

/**
 * 自分の設定で止めているために取れない実績の、取り方の手がかり。**クリアの数からは外さない** (achUnavailable_ を見る)。
 *
 * @param {string} email
 * @returns {Object<string, string>} key → 手がかり
 */
function achPersonalTips_(email) {
  var who = achWho_(email);
  var out = {};
  if (prefGet_('usage.enabled', who) !== false && prefGet_('usage.self', who) === false) {
    achUsageKeys_().forEach(function (k) { out[k] = '自分の設定「自分の使われ方を記録する」をオンにすると取れます'; });
  }
  if (prefGet_('calendar.shared', who) && prefGet_('calendar.plan', who) !== true) {
    out['first-calendar'] = '自分の設定「やることを予定に入れる」をオンにすると取れます';
  }
  if (prefGet_('focus.start', who) !== true) out['first-focus'] = '自分の設定「今から始める」(集中のしかた) をオンにすると取れます';
  if (prefGet_('oshi.on', who) === false) {
    ['first-oshi', 'first-pat', 'pats-10', 'pats-50', 'first-mood'].forEach(function (k) {
      out[k] = '自分の設定「推しに応援してもらう」をオンにすると取れます';
    });
  }
  if (prefGet_('room.on', who) !== true) {
    ['first-room', 'first-roomSound', 'rooms-10', 'rooms-50'].forEach(function (k) {
      out[k] = '自分の設定「作業部屋を使う」をオンにすると取れます';
    });
  }
  return out;
}

/**
 * 番頭を使っているのが本人1人か。**1人と言うのは、Drive が1人と言い、しかも台帳のどこにもほかの人がいないときだけ。**
 * Drive は、共有ドライブなら台帳を書き換えられる人 (driveMembers_)、マイドライブなら入れ物の持ち主と編集する人 (getEditors) を見る。
 * ドメイン全体やリンクでの共有は getEditors に出ないので、台帳 (上下関係の名簿・確認依頼・返事・やりとり・担当・使われ方) に
 * 本人のほかのアドレスがあれば1人ではない。
 *
 * **分からないとき (読めない) は1人とは言わない** (取れるものを外すと、クリアに早く届いてしまい、クリアは消えない)。
 * 答えは CacheService に覚える (1人 / ほかの人がいる は10分、読めなかったことは2分。読めないまま開くたびに Drive に問い合わせない)。
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
    if (hit === 'solo') return true;
    if (hit === 'team' || hit === 'unknown') return false;
  } catch (e) {
    cache = null;
  }
  var got = achSoloRead_(who);
  try {
    // 分からない (リンクやドメインで共有している) ときも 600 秒置く。以前は 120 秒で、そのたびに Drive の共有の設定を
    // 読み直していた (本番で 1〜2 秒。推しの頁を開くたびに当たっていた。2026-10-27)
    if (cache) cache.put(key, got, 600);
  } catch (e2) {
    // 覚えられなければ、次も問い合わせるだけ
  }
  return got === 'solo';
}

/**
 * achSolo_ の本体。
 *
 * @param {string} who
 * @returns {string} solo / team / unknown
 */
function achSoloRead_(who) {
  var seen = {};
  seen[who] = true;
  var other = false;
  function add(v) {
    var w = achWho_(v);
    if (!w || seen[w]) return;
    seen[w] = true;
    other = true;
  }
  // グループ・ドメイン・リンクで共有していると、何人いるか Drive からは分からない (known のまま上げない)
  var known = false;
  var driveId = repoDriveIdSafe_();
  if (driveId) {
    var m = driveMembers_(driveId);
    if (m.admins.length && !m.wide) {
      known = true;
      m.admins.forEach(add);
    }
  } else {
    var owner = repoOwnerEmail();
    if (owner) {
      try {
        var folder = DriveApp.getFolderById(repoConfig().rootId);
        known = folder.getSharingAccess() === DriveApp.Access.PRIVATE;
        add(owner);
        folder.getEditors().forEach(function (e) { add(e.getEmail()); });
      } catch (e) {
        known = false;
      }
    }
  }
  if (other) return 'team';
  if (achOthersInLedger_(who)) return 'team';
  return known ? 'solo' : 'unknown';
}

/**
 * 台帳に本人のほかの人がいるか (大文字小文字は見ない)。1人がいたところで読むのをやめる。
 *
 * @param {string} who 小文字のアドレス
 * @returns {boolean}
 */
function achOthersInLedger_(who) {
  function otherIn(v) {
    return String(v || '').split(',').some(function (p) {
      var w = achWho_(p);
      return !!w && w !== who;
    });
  }
  var where = [
    ['members', ['email', 'manager']], ['pulls', ['author', 'reviewers']], ['reviews', ['reviewer']], ['issue_comments', ['by']],
    ['issues', ['assignee']], ['usage', ['user']],
  ];
  for (var i = 0; i < where.length; i++) {
    var rows;
    try {
      rows = dbReadAll(where[i][0]);
    } catch (e) {
      continue;
    }
    var cols = where[i][1];
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < cols.length; c++) if (otherIn(rows[r][cols[c]])) return true;
    }
  }
  return false;
}

/** 前の形の、通算で開いた日の鍵 (読んで移すだけ) */
function achDaysKey_(who) {
  return 'ACH_DAYS:' + achWho_(who);
}

/**
 * 実績の使われ方の場所 (数えるもの → 使われ方の target)。画面が押したときに usageCount('action', ...) で数えるか、
 * 画面を開いたときの usageCount('view', 頁の名前) をそのまま使う (数を足すだけの安い記録。**実績のための新しい api は作らない**)。
 * 画面の写し (js-ach の ACH_USAGE_METRICS) と揃える (test/achievements.test.js が見ている)。
 * 1つの場所を2つの数えるもので使ってよい (なでた: はじめて と 通算)。通算のもの (unit のあるもの) は回数の合計で数える。
 *
 * @returns {Object<string, string>}
 */
function ACH_USAGE_PLACES() {
  return {
    markdown: 'md-save', reportCopy: 'report-copy', search: 'search-open', oshi: 'oshi-choose',
    // 押した場所 (id か data-track。js-me の usageTargetOf がそのまま数える)
    docLink: 'doc-link-btn', gantt: 'view-gantt', template: 'template-use',
    // 画面の中だけで起きること (js-room / js-oshi / js-ach が数える)
    board: 'board-move', charkit: 'charkit-import', pat: 'oshi-pat', pats: 'oshi-pat', room: 'room-open',
    rooms: 'room-open', roomSound: 'room-sound',
    // 開いた頁 (app.js の switchTab が usageCount('view', 名前) で数える)
    help: 'help', usageView: 'usage', cowork: 'cowork',
  };
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
  // 場所 → 回数の合計 (本人のぶんだけ。日ごとの行を足す)
  function usageSum(place) {
    if (!usage) {
      usage = {};
      rows('usage').forEach(function (r) {
        var n = Number(r.count) || 0;
        if (!mine(r.user) || n <= 0) return;
        var t = String(r.target);
        usage[t] = (usage[t] || 0) + n;
      });
    }
    return usage[place] || 0;
  }
  function used(place) { return usageSum(place) > 0 ? 1 : 0; }
  // 自分の設定 (MYPREF:)。既定と同じ値は残らない
  var myPrefs;
  function mySettings() {
    if (myPrefs === undefined) {
      var v = prefParse_(prop(prefMineKey_(who)));
      myPrefs = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }
    return myPrefs;
  }
  // 番頭が自分で残す変更の記録の文 (人が記録したものではない)。反映・改訂版を作る・足す・最初の記録・空白の記録し直し・退避
  function autoCommit(msg) {
    return /^(反映: |最初の記録$|改訂版「|空白の扱いを改めた記録)/.test(msg) || / に足した$/.test(msg) || /退避$/.test(msg);
  }
  var places = ACH_USAGE_PLACES();
  // 手元からの命令の覚え (スクリプトプロパティ) は、反映した・手元の道具 の両方が使うので1回だけ読む
  var queueWindows = null;
  function windowsOnce() {
    if (!queueWindows) queueWindows = outcomesQueueWindows_();
    return queueWindows;
  }
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
      var windows = windowsOnce();
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
    kit: function () { return windowsOnce().some(function (q) { return mine(q.by); }) ? 1 : 0; },
    search: function () { return used(places.search); },
    register: function () { return any('files', 'registeredBy'); },
    // 手元からの命令で記録したものは持ち主の名で残るので、命令を置いた人のものにする (反映した と同じ)
    commit: function () {
      var windows = windowsOnce();
      return rows('commits').some(function (c) {
        return !autoCommit(String(c.message || '')) && achPersonOf_(c.author, c.timestamp, windows) === who;
      }) ? 1 : 0;
    },
    // 改訂版に足すと「<文書> を <改訂版> に足した」の記録が、足した人の名で残る (Branch.gs の branchAddFile)
    addFile: function () {
      return rows('commits').some(function (c) {
        return String(c.branch) !== 'main' && / に足した$/.test(String(c.message || '')) && mine(c.author);
      }) ? 1 : 0;
    },
    docLink: function () { return used(places.docLink); },
    // やることを作ると、作った人の名で変更の履歴 (create) が残る (Issue.gs → historyRecord_)
    issue: function () {
      return rows('change_log').some(function (h) {
        return mine(h.actor) && String(h.action) === 'create' && /^issue:/.test(String(h.target));
      }) ? 1 : 0;
    },
    template: function () {
      return any('templates', 'createdBy', function (t) { return !t.builtin; }) || used(places.template);
    },
    // 新しいタグを作った (書いたタグは tagAdopt が作った人の名で一覧に足す) か、やることのタグを直した
    tag: function () {
      return any('tags', 'createdBy', function (t) { return !t.builtin; }) || (rows('change_log').some(function (h) {
        return mine(h.actor) && String(h.field) === 'labels' && String(h.after || '') !== '';
      }) ? 1 : 0);
    },
    board: function () { return used(places.board); },
    gantt: function () { return used(places.gantt); },
    sprint: function () { return any('sprints', 'createdBy'); },
    impediment: function () { return any('impediments', 'reportedBy'); },
    tasks: function () { return any('task_links', 'user'); },
    settings: function () { return Object.keys(mySettings()).length ? 1 : 0; },
    help: function () { return used(places.help); },
    usageView: function () { return used(places.usageView); },
    // 実績の頁を開いた (apiAchievements が page で名指す)。ここでは数えない
    achPage: function () { return 0; },
    mychar: function () { return any('oshi', 'who'); },
    charkit: function () { return used(places.charkit); },
    mood: function () { return mySettings()['oshi.mood'] === true ? 1 : 0; },
    pat: function () { return used(places.pat); },
    pats: function () { return usageSum(places.pats); },
    room: function () { return used(places.room); },
    rooms: function () { return usageSum(places.rooms); },
    roomSound: function () { return used(places.roomSound); },
    cowork: function () { return used(places.cowork); },
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
 * - useNeg: その日に「まだ」と分かった「はじめて」を数えない (頁を開いたとき。countDay のときも、覚えがあれば数えない)
 * - page: 実績の頁を開いた (「実績の頁を見た」に届く。使われ方は使わない = 記録を止めていても取れる)
 *
 * @param {string} email
 * @param {Date} now
 * @param {{countDay?: boolean, metrics?: string[], useNeg?: boolean, page?: boolean}} [opts]
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
  // 頁を開いたときと、その日2回目からの開いたとき (覚えがあるとき) は、その日に「まだ」と分かった「はじめて」を数えない
  var useNeg = (o.useNeg || o.countDay) && !only;
  var negKnown = useNeg ? achNegRead_(who, today) : null;
  var counts = achCounts_(who, have, days, only, negKnown);
  if (o.page && !Object.prototype.hasOwnProperty.call(have, 'first-achPage')) counts.achPage = 1;
  if (!only) {
    var metrics = ACH_METRICS();
    var neg = Object.keys(counts).filter(function (m) { return metrics[m].first && !counts[m]; });
    if (negKnown) Object.keys(negKnown).forEach(function (m) { if (neg.indexOf(m) < 0) neg.push(m); });
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
