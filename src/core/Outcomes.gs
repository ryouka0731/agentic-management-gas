/**
 * 成果の数 (日ごと・チーム全体)。
 *
 * 番頭の価値は改訂と依頼を止めずに通すことなので、使われた回数ではなく「止まっていた仕事が動き、
 * きれいに終わったか」を数える。あわせて、悪くなったら止める合図 (見張り) を数える。
 * **人の名前とアドレスは持たない。** 台帳の `outcomes_daily` に日ごとの数だけを置く。
 *
 * 1日1回の片付け (housekeepArchiveDaily_) のあとに、別の印で1日1回 (outcomesDailyOnce_)、**鍵の外で**台帳を読んで数え、書くところだけ
 * 短く鍵を取る (outcomesWrite_)。「7日以内に開き直されなかった」のように、あとの7日で決まる数が
 * あるので、毎回直近8日を数え直して日ごとに上書きする。8日たった日の数はもう動かない。
 *
 * 列の意味 (日は東京の暦日 D。「動き」は下の outcomesLedger_ が集める記録):
 * - moved:        D の始まりに開いていたやること・確認依頼のうち、D より前の最後の動きが D-7 日以前
 *                 (7日以上動きが無かった) で、D に動きがあったものの数。初めての動き (作った日) は数えない
 * - closedClean:  D に完了にしたやることのうち、その日の最後の完了から7日以内に開き直されていないものの数
 * - mergedClean:  D に反映した確認依頼のうち、反映より前に差し戻しが1件も無かったものの数
 * - reopened:     D に開き直したやることの数 (同じやることは1日1件) — 見張り
 * - overdue:      D の終わりに開いていて、期限 (いまの期限の欄) が D より前のやることの数 — 見張り
 * - activePeople: D に何か1つ記録した人の数 (人数だけ)。手元からの命令の行は置いた人として数える — 3人未満の週は画面に出さない
 * - busyErrors:   D に鍵が取れずに投げた数 (Db.gs の dbBusyNote_)。**上限の数**: 呼んだ側が握って画面に届かないもの
 *                 (履歴・知らせ・使われ方) も入る。鍵なしで足すので数え漏れもある — 見張り
 * - timeoutErrors: D に画面で時間切れになった操作の数 (使われ方の場所 error:timeout。使われ方を止めた人は数えない) — 見張り
 * - fxOff:        楽しい演出・集中のしかた・推し・ポイントのどれかを、自分の設定ではっきり切っている人の数
 *                 (数えた時点の数。前日の行にだけ入れ、数え直しでは前の値を残す) — 見張り
 *
 * 設計: docs/superpowers/specs/2026-10-21-motivation-review.md の §7・§8。
 */

/** 止まっていたとみなす日数 */
function OUTCOMES_STALE_DAYS() {
  return 7;
}

/** 開き直されなければ「きれいに終わった」とみなす日数 */
function OUTCOMES_CLEAN_DAYS() {
  return 7;
}

/** 毎回数え直す日数 (きれいに終わったかが決まるまで) */
function OUTCOMES_RECOUNT_DAYS() {
  return 8;
}

/** 週の数を出すのに要る人数。これより少ない週は null (1人の分が引き算で見えるため) */
function OUTCOMES_MIN_PEOPLE() {
  return 3;
}

/** 「混み合っています」の日ごとの数を残す日数 (数え直す8日より長く) */
function OUTCOMES_BUSY_KEEP_DAYS() {
  return 14;
}

/** @returns {string[]} 数える欄 (day を除く outcomes_daily の列) */
function OUTCOMES_FIELDS_() {
  return DB_SCHEMA().outcomes_daily.slice(1);
}

/**
 * 台帳の時刻を ms にする。Date・ISO の字・'yyyy-MM-dd' (東京の0時) を受ける。読めなければ NaN。
 *
 * @param {*} v
 * @returns {number}
 */
function outcomesTime_(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T00:00:00+09:00');
  return Date.parse(s);
}

/** @returns {string} 'yyyy-MM-dd' (東京) */
function outcomesDayOf_(ms) {
  return Utilities.formatDate(new Date(ms), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/** @returns {number} その日 (東京) の始まり */
function outcomesDayStart_(day) {
  return Date.parse(day + 'T00:00:00+09:00');
}

/** @returns {string} n 日ずらした日 */
function outcomesShiftDay_(day, n) {
  return outcomesDayOf_(outcomesDayStart_(day) + n * 86400000);
}

/** 人を比べる形。空なら '' */
function outcomesWho_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/** 手元からの命令が走った時間を覚える日数 */
function OUTCOMES_QUEUE_KEEP_DAYS() {
  return 14;
}

/**
 * 手元からの命令が走った時間と、置いた人を覚える (スクリプトプロパティ `OUTCOME_QUEUE:<日>` の JSON)。
 * runCommandFileLocked_ が命令1件ごとに呼ぶ (鍵の中)。覚えられなくても命令は止めない。
 *
 * @param {number} from 走り始め (ms)
 * @param {number} to 走り終わり (ms)
 * @param {string} runner トリガーを仕掛けた人 (台帳にはこの人の名で残る)
 * @param {string} by 命令を置いた人 (分からなければ空)
 */
function outcomesQueueNote_(from, to, runner, by) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'OUTCOME_QUEUE:' + outcomesDayOf_(from);
    var list = prefParse_(props.getProperty(key));
    if (!Array.isArray(list)) list = [];
    list.push({ s: from, e: to, runner: outcomesWho_(runner), by: outcomesWho_(by) });
    props.setProperty(key, JSON.stringify(list));
  } catch (e) {
    // 覚えられなくても命令は止めない (その日の記録した人の数が持ち主の分だけ多くなりうる)
  }
}

/** @returns {Array<{s: number, e: number, runner: string, by: string}>} 覚えている命令の時間 */
function outcomesQueueWindows_() {
  var all = PropertiesService.getScriptProperties().getProperties() || {};
  var out = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('OUTCOME_QUEUE:') !== 0) return;
    var list = prefParse_(all[k]);
    if (!Array.isArray(list)) return;
    list.forEach(function (q) {
      if (q && typeof q.s === 'number' && typeof q.e === 'number' && q.runner) {
        out.push({ s: q.s, e: q.e, runner: String(q.runner), by: String(q.by || '') });
      }
    });
  });
  return out;
}

/**
 * 数えるのに要る台帳を1回だけ読む。
 *
 * 動き (activity) として数えるもの:
 * - やること: 変更の履歴 (change_log の issue:N。作る・直す・完了・開き直し)、やりとり、作った時刻
 * - 確認依頼: 出した時刻、確認 (承認・差し戻し・コメント)、元の改訂版への記録 (その時点で開いていた依頼にだけ)、
 *   証跡、反映した時刻。**取り下げた依頼 (state closed) は数えない**
 *
 * @returns {object}
 */
function outcomesLedger_() {
  var issues = {};
  dbReadAll('issues').forEach(function (r) {
    var n = Number(r.number);
    if (!n) return;
    issues[n] = { row: r, acts: [], states: [], createdAt: outcomesTime_(r.createdAt) };
    if (!isNaN(issues[n].createdAt)) issues[n].acts.push(issues[n].createdAt);
  });

  var people = [];
  var windows = outcomesQueueWindows_();
  function person(who, at) {
    var w = outcomesWho_(who);
    var t = outcomesTime_(at);
    if (!w || isNaN(t)) return;
    // 手元からの命令で書いた行は、トリガーを仕掛けた人の名で残る。命令を置いた人として数える
    // (分からなければ数えない)。数えないと、持ち主1人が命令を回すだけで「3人」に届いてしまう
    for (var i = 0; i < windows.length; i++) {
      var q = windows[i];
      if (q.runner === w && t >= q.s && t <= q.e) {
        w = q.by;
        break;
      }
    }
    if (w) people.push({ who: w, at: t });
  }

  dbReadAll('change_log').forEach(function (r) {
    person(r.actor, r.at);
    var m = /^issue:(\d+)$/.exec(String(r.target || ''));
    if (!m || !issues[Number(m[1])]) return;
    var t = outcomesTime_(r.at);
    if (isNaN(t)) return;
    var it = issues[Number(m[1])];
    it.acts.push(t);
    var action = String(r.action || '');
    if (action === 'close' || action === 'reopen') it.states.push({ at: t, action: action, id: Number(r.id) || 0 });
  });

  dbReadAll('issue_comments').forEach(function (r) {
    person(r.by, r.at);
    var it = issues[Number(r.issueNumber)];
    var t = outcomesTime_(r.at);
    if (it && !isNaN(t)) it.acts.push(t);
  });

  var pulls = {};
  var byBranch = {};
  dbReadAll('pulls').forEach(function (r) {
    var n = Number(r.number);
    if (!n) return;
    person(r.author, r.createdAt);
    // **取り下げた依頼は数えない。** 取り下げた時刻を持たないので、数えるといつまでも「開いている」ことになり、
    // 同じ名前の改訂版から出し直した依頼と一緒に、1つの動きを2回数える
    if (String(r.state) === 'closed') return;
    var p = { row: r, acts: [], createdAt: outcomesTime_(r.createdAt), mergedAt: outcomesTime_(r.mergedAt),
      changesAt: [] };
    if (!isNaN(p.createdAt)) p.acts.push(p.createdAt);
    if (!isNaN(p.mergedAt)) p.acts.push(p.mergedAt);
    pulls[n] = p;
    var b = String(r.sourceBranch || '');
    if (b) (byBranch[b] = byBranch[b] || []).push(p);
  });

  dbReadAll('reviews').forEach(function (r) {
    person(r.reviewer, r.at);
    var p = pulls[Number(r.prNumber)];
    var t = outcomesTime_(r.at);
    if (!p || isNaN(t)) return;
    p.acts.push(t);
    if (String(r.state) === 'request_changes') p.changesAt.push(t);
  });

  dbReadAll('commits').forEach(function (r) {
    person(r.author, r.timestamp);
    var t = outcomesTime_(r.timestamp);
    if (isNaN(t)) return;
    // その時点で開いていた依頼にだけ付ける (出す前・反映したあとの記録は、その依頼の動きではない)
    (byBranch[String(r.branch || '')] || []).forEach(function (p) {
      if (p.createdAt <= t && (isNaN(p.mergedAt) || t <= p.mergedAt)) p.acts.push(t);
    });
  });

  dbReadAll('pull_patches').forEach(function (r) {
    person(r.by, r.at);
    var p = pulls[Number(r.prNumber)];
    var t = outcomesTime_(r.at);
    if (p && !isNaN(t)) p.acts.push(t);
  });

  dbReadAll('inquiries').forEach(function (r) { person(r.by, r.at); });
  dbReadAll('inquiry_replies').forEach(function (r) { person(r.by, r.at); });

  var timeouts = {};
  dbReadAll('usage').forEach(function (r) {
    if (String(r.target) !== 'error:timeout') return;
    var d = usageDayOf_(r.day);
    timeouts[d] = (timeouts[d] || 0) + (Number(r.count) || 0);
  });

  Object.keys(issues).forEach(function (n) {
    issues[n].acts.sort(function (a, b) { return a - b; });
    issues[n].states.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
  });
  Object.keys(pulls).forEach(function (n) { pulls[n].acts.sort(function (a, b) { return a - b; }); });

  return { issues: issues, pulls: pulls, people: people, timeouts: timeouts };
}

/**
 * そのやることが、時刻 t の直前に開いていたか。
 *
 * 完了・開き直しの履歴があればその最後で決める。履歴が無ければ (履歴を残す前の行)、作った時刻と
 * 完了の時刻 (closedAt) で決める。置き場に移したもの (archivedAt が t より前) は開いていない。
 *
 * @param {object} it outcomesLedger_ の issues の1件
 * @param {number} t
 * @returns {boolean}
 */
function outcomesIssueOpenAt_(it, t) {
  if (isNaN(it.createdAt) || it.createdAt >= t) return false;
  var archived = outcomesTime_(it.row.archivedAt);
  if (!isNaN(archived) && archived < t) return false;
  var last = null;
  for (var i = 0; i < it.states.length; i++) {
    if (it.states[i].at < t) last = it.states[i];
  }
  if (last) return last.action === 'reopen';
  var closed = outcomesTime_(it.row.closedAt);
  if (!isNaN(closed)) return closed >= t;
  return String(it.row.state) !== 'closed';
}

/**
 * 動きの並び (小さい順) が、止まっていたあとに D で動いたか。
 *
 * @param {number[]} acts
 * @param {number} start D の始まり
 * @param {number} end D の終わり (次の日の始まり)
 * @returns {boolean}
 */
function outcomesMovedOn_(acts, start, end) {
  var prev = NaN;
  var on = false;
  for (var i = 0; i < acts.length; i++) {
    if (acts[i] < start) prev = acts[i];
    else if (acts[i] < end) on = true;
  }
  // 前の動きが D-7 日以前 = D-6 日の始まりより前
  return on && !isNaN(prev) && prev < start - (OUTCOMES_STALE_DAYS() - 1) * 86400000;
}

/**
 * 楽しさの層をはっきり切っている人の数 (いまの数)。
 *
 * 自分の設定 (MYPREF:<アドレス>) に、fun.* / focus.* / oshi.* / game.* か home.cards.game を false と
 * 書いている人を数える。既定のまま (書いていない) の人は数えない。
 *
 * @returns {number}
 */
function outcomesFxOff_() {
  var all = PropertiesService.getScriptProperties().getProperties() || {};
  var n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('MYPREF:') !== 0) return;
    var mine = prefParse_(all[k]);
    if (!mine || typeof mine !== 'object' || Array.isArray(mine)) return;
    var off = Object.keys(mine).some(function (key) {
      return mine[key] === false && (/^(fun|focus|oshi|game)\./.test(key) || key === 'home.cards.game');
    });
    if (off) n++;
  });
  return n;
}

/**
 * その日の数を作る。**鍵を取らない** (読むだけ。書くのは outcomesWrite_)。
 *
 * fxOff はいまの数なので、ここでは入れない (outcomesDaily_ が前日の行にだけ入れる)。
 *
 * @param {string} day 'yyyy-MM-dd' (東京)
 * @param {object} [led] outcomesLedger_() の返り。何日も数えるときは1回だけ読んで渡す
 * @returns {object} outcomes_daily の1行 (fxOff は null)
 */
function outcomesTally_(day, led) {
  var L = led || outcomesLedger_();
  var start = outcomesDayStart_(day);
  var end = start + 86400000;
  var clean = OUTCOMES_CLEAN_DAYS() * 86400000;
  var out = { day: day, moved: 0, closedClean: 0, mergedClean: 0, reopened: 0, overdue: 0, activePeople: 0,
    busyErrors: 0, timeoutErrors: L.timeouts[day] || 0, fxOff: null };

  Object.keys(L.issues).forEach(function (n) {
    var it = L.issues[n];
    if (outcomesIssueOpenAt_(it, start) && outcomesMovedOn_(it.acts, start, end)) out.moved++;

    var lastClose = null;
    var reopenedToday = false;
    it.states.forEach(function (s) {
      if (s.at < start || s.at >= end) return;
      if (s.action === 'close') lastClose = s;
      else reopenedToday = true;
    });
    if (reopenedToday) out.reopened++;
    if (lastClose && !it.states.some(function (s) {
      return s.action === 'reopen' && s.at > lastClose.at && s.at <= lastClose.at + clean;
    })) out.closedClean++;

    var due = usageDayOf_(it.row.dueDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(due) && due < day && outcomesIssueOpenAt_(it, end)) out.overdue++;
  });

  Object.keys(L.pulls).forEach(function (n) {
    var p = L.pulls[n];
    var openAtStart = !isNaN(p.createdAt) && p.createdAt < start && (isNaN(p.mergedAt) || p.mergedAt >= start);
    if (openAtStart && outcomesMovedOn_(p.acts, start, end)) out.moved++;

    if (String(p.row.state) === 'merged' && p.mergedAt >= start && p.mergedAt < end &&
        !p.changesAt.some(function (t) { return t < p.mergedAt; })) out.mergedClean++;
  });

  var seen = {};
  L.people.forEach(function (x) {
    if (x.at >= start && x.at < end) seen[x.who] = true;
  });
  out.activePeople = Object.keys(seen).length;

  out.busyErrors = Number(PropertiesService.getScriptProperties().getProperty(dbBusyKey_(day))) || 0;
  return out;
}

/**
 * 日ごとの行を書く (同じ日の行があれば上書き、無ければ足す)。**書くところだけ短く鍵を取る。**
 *
 * 取れなければ諦める (次の日に直近8日を数え直すので、1日ぶんなら戻る)。
 *
 * @param {object[]} rows outcomesTally_ の返り。fxOff / busyErrors が null の欄は前の値を残す
 * @returns {boolean} 書けたか
 */
function outcomesWrite_(rows) {
  return dbWithLock_(5000, function () {
    var cols = DB_SCHEMA().outcomes_daily;
    var sheet = dbSheet_('outcomes_daily');
    var last = sheet.getLastRow();
    var values = last > 1 ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [];
    var at = {};
    for (var r = 0; r < values.length; r++) at[usageDayOf_(values[r][0])] = r;

    rows.forEach(function (row) {
      var i = Object.prototype.hasOwnProperty.call(at, row.day) ? at[row.day] : -1;
      var cells = cols.map(function (c, k) {
        var v = row[c];
        if ((v === null || v === undefined) && i >= 0) v = values[i][k];
        return dbCell_(c, v === null || v === undefined ? '' : v);
      });
      if (i >= 0) sheet.getRange(i + 2, 1, 1, cols.length).setValues([cells]);
      else {
        sheet.appendRow(cells);
        at[row.day] = values.length;
        values.push(cells);
      }
    });
    return true;
  }, function () { return false; });
}

/**
 * 直近8日 (きのうから) を数え直して書く。outcomesDailyOnce_ から呼ぶ (鍵の外)。
 *
 * - fxOff はきのうの行にだけ入れる (いまの数なので、もっと前の日には分からない)
 * - 「混み合っています」の日ごとの数は、残す日数より古いものを消す
 *
 * @param {Date} [now]
 * @returns {object[]} 書いた行
 */
function outcomesDaily_(now) {
  var today = outcomesDayOf_((now || new Date()).getTime());
  var led = outcomesLedger_();
  var rows = [];
  for (var k = 1; k <= OUTCOMES_RECOUNT_DAYS(); k++) {
    var row = outcomesTally_(outcomesShiftDay_(today, -k), led);
    // 消えた数え (残す日数を過ぎた) は 0 で上書きしない
    if (!row.busyErrors && k > 1) row.busyErrors = null;
    rows.push(row);
  }
  rows[0].fxOff = outcomesFxOff_();
  outcomesWrite_(rows);

  var props = PropertiesService.getScriptProperties();
  var oldest = outcomesShiftDay_(today, -OUTCOMES_BUSY_KEEP_DAYS());
  Object.keys(props.getProperties() || {}).forEach(function (key) {
    var m = /^OUTCOME_BUSY:(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (m && m[1] < oldest) props.deleteProperty(key);
    var q = /^OUTCOME_QUEUE:(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (q && q[1] < outcomesShiftDay_(today, -OUTCOMES_QUEUE_KEEP_DAYS())) props.deleteProperty(key);
  });
  return rows;
}

/**
 * 1日1回だけ outcomesDaily_ を走らせる。processCommandQueue が片付け (housekeepArchiveDaily_) のあとに呼ぶ。
 *
 * - **片付けとは別の印** (`OUTCOMES_ON` = その日)。数えるところで時間切れになっても、片付けはやり直さない
 * - **片付けが済んだ日だけ走る** (`ARCHIVE_HOUSEKEPT_ON` が今日)。捨てたものを片付けてから数える
 * - 受け持つ印 (`OUTCOMES_RUNNING`) は短い鍵の中で付け、数えるのは鍵の外。受け持ったまま落ちても30分で受け持ち直す。
 *   済みの印は終わってから付ける
 *
 * @param {Date} [now]
 * @returns {boolean} 数えたか
 */
function outcomesDailyOnce_(now) {
  var props = PropertiesService.getScriptProperties();
  var today = outcomesDayOf_((now || new Date()).getTime());
  if (props.getProperty('OUTCOMES_ON') === today) return false;
  if (props.getProperty('ARCHIVE_HOUSEKEPT_ON') !== today) return false;

  var claimed = dbWithLock_(5000, function () {
    if (props.getProperty('OUTCOMES_ON') === today) return false;
    var running = String(props.getProperty('OUTCOMES_RUNNING') || '').split('|');
    if (running[0] === today && Date.now() - Number(running[1]) < 30 * 60 * 1000) return false;
    props.setProperty('OUTCOMES_RUNNING', today + '|' + Date.now());
    return true;
  }, function () { return false; });
  if (!claimed) return false;

  try {
    outcomesDaily_(now || new Date());
    props.setProperty('OUTCOMES_ON', today);
    return true;
  } finally {
    props.deleteProperty('OUTCOMES_RUNNING');
  }
}

/**
 * 週ごとの合計 (月曜から日曜)。**終わった週だけ**を新しい順に返す。
 *
 * - 足す数: moved / closedClean / mergedClean / reopened / busyErrors / timeoutErrors
 * - 量の数 (その時点の数): overdue / fxOff は、その週で最後に数えた日の値
 * - people: その週の日ごとの activePeople の最大 (同じ人を何日も数えないので、週の人数の下限)
 * - **people が OUTCOMES_MIN_PEOPLE() より少ない週は、数を全部 null にする** (hidden: true)。
 *   人数が少ないと、合計から1人の分が見える (gameTeam_ と同じ守り)。下限で比べるので、
 *   本当は3人以上いた週を隠すことはあっても、2人以下の週を出すことは無い
 *
 * @param {object[]} rows outcomes_daily の行
 * @param {number} weeks 何週ぶん
 * @param {Date} now
 * @returns {object[]}
 */
function outcomesWeeks_(rows, weeks, now) {
  var today = outcomesDayOf_(now.getTime());
  // 東京の暦日の曜日 (0 = 日曜)
  var dow = new Date(outcomesDayStart_(today) + 9 * 3600000).getUTCDay();
  var thisMonday = outcomesShiftDay_(today, -((dow + 6) % 7));
  var byDay = {};
  rows.forEach(function (r) {
    var d = usageDayOf_(r.day);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) byDay[d] = r;
  });

  var sums = ['moved', 'closedClean', 'mergedClean', 'reopened', 'busyErrors', 'timeoutErrors'];
  var levels = ['overdue', 'fxOff'];
  var out = [];
  for (var w = 1; w <= weeks; w++) {
    var from = outcomesShiftDay_(thisMonday, -7 * w);
    var week = { start: from, end: outcomesShiftDay_(from, 6), days: 0, people: 0, hidden: false };
    sums.concat(levels).forEach(function (f) { week[f] = 0; });
    for (var d = 0; d < 7; d++) {
      var r = byDay[outcomesShiftDay_(from, d)];
      if (!r) continue;
      week.days++;
      week.people = Math.max(week.people, Number(r.activePeople) || 0);
      sums.forEach(function (f) { week[f] += Number(r[f]) || 0; });
      levels.forEach(function (f) {
        if (r[f] !== '' && r[f] !== null && r[f] !== undefined) week[f] = Number(r[f]) || 0;
      });
    }
    if (week.people < OUTCOMES_MIN_PEOPLE()) {
      week.hidden = true;
      week.people = null;
      sums.concat(levels).forEach(function (f) { week[f] = null; });
    }
    out.push(week);
  }
  return out;
}
