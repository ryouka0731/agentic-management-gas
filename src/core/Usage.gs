/**
 * どこがよく使われているかの記録。
 *
 * 日・場所・回数に加えて、押した人も残す。人ごとに見られるようにする
 * ためで、これは道具を配る側の判断による。
 *
 * 残すのは「その日に何回押したか」までで、押した順番や時刻は残さない。
 * 何時に何をしていたかまで追える形にはしない。
 *
 * 押すたびに書くとスプレッドシートが持たないため、画面側でまとめてから
 * 送ってもらい、ここでは同じ日・同じ場所の行に足し込む。
 */

/**
 * 一度に受け取る場所の数の上限。
 *
 * 際限なく受け取ると、作りかけの画面から知らない名前が大量に流れ込み、
 * 行が増え続ける。
 *
 * @returns {number}
 */
function USAGE_MAX_KEYS() {
  return 60;
}

/**
 * 数える種類。
 *
 * @returns {string[]}
 */
function USAGE_KINDS() {
  return ['view', 'action'];
}

/**
 * 残す日数。
 *
 * **片付けないと行は増え続ける。** 場所が20か所、種類が2つ、人が10人
 * いれば1日で最大400行になり、1年で15万行に届く。この表は足し込みの
 * たびに丸ごと読んで丸ごと書き戻すため、増えたぶんがそのまま待ち時間に
 * なり、いずれ実行時間の上限に当たって数えられなくなる。
 *
 * 画面から見られるのは直近90日までなので、その倍を残せば足りる。
 *
 * **これは既定値。** チームの設定 usage.keepDays で変えられるので、残す日数は
 * usageKeepDays_() で読む。
 *
 * @returns {number}
 */
function USAGE_KEEP_DAYS() {
  return 180;
}

/**
 * 残す日数 (チームの設定。決めていなければ USAGE_KEEP_DAYS())。
 *
 * @returns {number}
 */
function usageKeepDays_() {
  // 読めなければ既定の日数 (短く倒して行を消すことはしない)
  try {
    return prefGet_('usage.keepDays');
  } catch (e) {
    return USAGE_KEEP_DAYS();
  }
}

/**
 * その日の文字列を返す。
 *
 * @param {Date} [when]
 * @returns {string} YYYY-MM-DD
 */
function usageDay(when) {
  return Utilities.formatDate(when || new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * 台帳から読んだ日を 'yyyy-MM-dd' にする。
 *
 * **Sheets は 'yyyy-MM-dd' の字を書くと日付として持ち、Date で返す。**
 * 字のまま扱うと、足し込みの鍵が一致せず毎回行が増え、間引きも集計も
 * その行を読み飛ばす。
 *
 * @param {*} v
 * @returns {string}
 */
function usageDayOf_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : usageDay(v);
  }
  return String(v == null ? '' : v);
}

/**
 * 場所の名前として使えるかを見る。
 *
 * @param {string} target
 * @returns {boolean}
 */
function usageTargetValid_(target) {
  return /^[A-Za-z0-9:_-]{1,60}$/.test(String(target || ''));
}

/**
 * まとめて足し込む。
 *
 * @param {Array<{kind:string, target:string, count:number}>} rows
 * @returns {number} 足し込んだ場所の数
 */
function usageRecord(rows) {
  var list = rows || [];
  if (!list.length) return 0;

  if (list.length > USAGE_MAX_KEYS()) list = list.slice(0, USAGE_MAX_KEYS());

  // チームで止めたとき・本人が止めたときは数えない。鍵も取らない
  // 設定が読めないときは数え続ける (止めたつもりの無い人の記録を黙って落とさない)
  var who = currentEmail_();
  var on = true;
  try {
    on = prefGet_('usage.enabled') !== false && prefGet_('usage.self', who) !== false;
  } catch (e) {
    on = true;
  }
  if (!on) return 0;

  // 数えられなくても操作は続けられる。取れなければ諦める
  return dbWithLock_(5000, function () {
        var cols = DB_SCHEMA().usage;
        var sheet = dbSheet_('usage');
        var last = sheet.getLastRow();

        var values = last > 1
          ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [];

        // 押した人は画面から受け取らない。名乗りを詐称できてしまう
        var me = currentEmail_();
        var day = usageDay();

        // 古いぶんは落としてから足し込む。落とさないと丸ごとの読み書きが
        // 際限なく重くなる
        var kept = usageWithinKeep_(values, day);
        var dropped = values.length - kept.length;
        values = kept;

        var merged = usageMerge_(list, values, day, me);

        usageWriteBack_(sheet, cols, values, merged.added, merged.touched || dropped > 0);

        // 落としたぶんだけ行が余る。消さないと、書き戻した中身の下に
        // 古い行が残ったままになる
        for (var d = 0; d < dropped; d++) {
          sheet.deleteRow(values.length + merged.added.length + 2);
        }
        return merged.done;
  }, function () { return 0; });
}

/** 足し込む1件を読む。数えない種類・場所・回数なら null */
function usageEntry_(item, kinds) {
  var kind = String(item.kind || '');
  var target = String(item.target || '');
  var count = Math.round(Number(item.count) || 0);

  if (kinds.indexOf(kind) < 0) return null;
  if (!usageTargetValid_(target)) return null;
  if (count < 1 || count > 10000) return null;
  return { kind: kind, target: target, count: count };
}

/**
 * 今の行 (values) に足し込み、無い場所は新しい行 (added) にする。values は書き換える。
 *
 * @returns {{added: Array[], touched: boolean, done: number}} touched は values を変えたか
 */
function usageMerge_(list, values, day, me) {
  var at = {};
  for (var r = 0; r < values.length; r++) {
    at[usageDayOf_(values[r][0]) + '\t' + values[r][1] + '\t' + values[r][2] +
      '\t' + values[r][4]] = r;
  }

  var kinds = USAGE_KINDS();
  var added = [];

  // 同じまとめの中に同じ場所が2度入ることがある。**足し先を values の
  // 長さから数えると、まだ書いていない行を指してしまう。** 以前は
  // `values[at[key]]` が undefined になって例外で終わり、そのまとめの
  // ぶんが黙って失われていた
  var addedAt = {};
  var touched = false;
  var done = 0;

  for (var i = 0; i < list.length; i++) {
    var one = usageEntry_(list[i], kinds);
    if (!one) continue;

    var key = day + '\t' + one.kind + '\t' + one.target + '\t' + me;

    if (Object.prototype.hasOwnProperty.call(at, key)) {
      values[at[key]][3] = (Number(values[at[key]][3]) || 0) + one.count;
      touched = true;
    } else if (Object.prototype.hasOwnProperty.call(addedAt, key)) {
      added[addedAt[key]][3] = (Number(added[addedAt[key]][3]) || 0) + one.count;
    } else {
      addedAt[key] = added.length;
      added.push([day, one.kind, one.target, one.count, me]);
    }
    done++;
  }
  return { added: added, touched: touched, done: done };
}

/**
 * 今の行を (変えたときだけ) 書き戻し、新しい行をその下に書く。
 *
 * 字のセルは ' を付けて書く (dbCell_)。付けないと '1-2' のような場所が
 * 日付に化けて、次から足し込めなくなる
 */
function usageWriteBack_(sheet, cols, values, added, touched) {
  var cells = function (list) {
    return list.map(function (row) {
      return row.map(function (v, c) { return dbCell_(cols[c], v); });
    });
  };
  if (touched && values.length) {
    sheet.getRange(2, 1, values.length, cols.length).setValues(cells(values));
  }
  if (added.length) {
    sheet.getRange(values.length + 2, 1, added.length, cols.length)
      .setValues(cells(added));
  }
}

/**
 * 残す期間に入っている行だけを返す。
 *
 * 日の文字列は `YYYY-MM-DD` なので、字のまま比べられる。
 *
 * @param {Array<Array>} values usage の行 (配列のまま)
 * @param {string} today
 * @returns {Array<Array>}
 */
function usageWithinKeep_(values, today) {
  var parts = String(today).split('-');
  var end = new Date(
    Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var from = usageDay(new Date(
    end.getFullYear(), end.getMonth(), end.getDate() - usageKeepDays_() + 1));

  var out = [];
  for (var i = 0; i < values.length; i++) {
    // 日が読めない行は落とさない。手で書き換えられる表なので、
    // 読めないことを理由に人の書いたものを消してはならない
    var day = usageDayOf_(values[i][0]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < from) continue;

    out.push(values[i]);
  }
  return out;
}

/**
 * 見る期間と、同じ長さで直前の期間を決める。
 *
 * @param {number} [days] 省略すると30日。1年で止める
 * @param {Date} [today]
 * @returns {{from:string, to:string, prevFrom:string, prevTo:string}}
 */
function usageSpan_(days, today) {
  // 日の境目は usageDay (東京) と、ここでの new Date(y, m, d) の両方で決まる。
  // 後者は実行環境の時刻帯で動くので、appsscript.json の timeZone が
  // Asia/Tokyo であることを前提にしている。変えると期間が1日ずれる
  var span = Math.max(1, Math.min(365, Number(days) || 30));
  var end = today || new Date();
  var y = end.getFullYear();
  var m = end.getMonth();
  var d = end.getDate();

  return {
    from: usageDay(new Date(y, m, d - span + 1)),
    to: usageDay(end),
    prevFrom: usageDay(new Date(y, m, d - span * 2 + 1)),
    prevTo: usageDay(new Date(y, m, d - span)),
  };
}

/**
 * 'yyyy-MM-dd' が何曜日か。月曜を0、日曜を6とする。
 *
 * 字から決める。台帳の Date の時刻 (東京の0時) を使うと、動いている場所の
 * 時刻帯によって前の日の曜日になる。
 *
 * @param {string} day
 * @returns {number} 読めなければ -1
 */
function usageWeekday_(day) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) return -1;
  var w = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  return (w + 6) % 7;
}

/**
 * 使われ方をまとめる。
 *
 * 前の期間 (`prev`) は同じ長さで直前の期間。増えたか減ったかを見るため。
 * 曜日ごと (`byWeekday`) は月曜から日曜までの7つ。
 *
 * @param {number} [days] 何日ぶんを見るか。省略すると30日
 * @param {Date} [today]
 * @returns {{from:string, to:string, total:number, byTarget:object[],
 *   byDay:object[], byUser:object[], byWeekday:number[],
 *   prev:{total:number, byTarget:object[]}}}
 */
function usageSummary(days, today, who) {
  var range = usageSpan_(days, today);
  var target = String(who || '');

  var rows = dbReadAll('usage');
  var acc = {
    byTarget: usageTally_(),
    byDay: usageTally_(),
    byUser: usageTally_(),
    total: 0,
    byWeekday: [0, 0, 0, 0, 0, 0, 0],
  };
  var prev = { byTarget: usageTally_(), total: 0 };

  for (var i = 0; i < rows.length; i++) {
    var day = usageDayOf_(rows[i].day);

    if (day >= range.prevFrom && day <= range.prevTo) {
      usageSummaryAddPrev_(prev, rows[i], target);
      continue;
    }
    if (day < range.from || day > range.to) continue;

    usageSummaryAdd_(acc, rows[i], day, target);
  }

  var dailyOrder = acc.byDay.order.slice().sort();

  return {
    from: range.from,
    to: range.to,
    who: target,
    total: acc.total,
    byTarget: usageByCount_(acc.byTarget),
    byDay: dailyOrder.map(function (d) { return acc.byDay.map[d]; }),
    byUser: usageByCount_(acc.byUser),
    byWeekday: acc.byWeekday,
    prev: { total: prev.total, byTarget: usageByCount_(prev.byTarget) },
  };
}

/** 出てきた順を覚えて数を足し込む入れ物 */
function usageTally_() {
  return { map: {}, order: [] };
}

/** key の行が無ければ make() で作ってから count を足す */
function usageTallyAdd_(tally, key, make, count) {
  if (!tally.map[key]) {
    tally.map[key] = make();
    tally.order.push(key);
  }
  tally.map[key].count += count;
}

/** 多い順に並べる (同じ数なら出てきた順) */
function usageByCount_(tally) {
  var list = tally.order.map(function (k) { return tally.map[k]; });
  list.sort(function (a, b) { return b.count - a.count; });
  return list;
}

/** 場所ごとの行の作り方 */
function usageTargetRow_(row) {
  return function () {
    return { kind: String(row.kind), target: String(row.target), count: 0 };
  };
}

/** 前の期間の1行を足す。絞り込んでいれば、その人のぶんだけ */
function usageSummaryAddPrev_(prev, row, target) {
  if (target && String(row.user || '') !== target) return;
  var count = Number(row.count) || 0;
  usageTallyAdd_(prev.byTarget, String(row.kind) + ':' + String(row.target),
    usageTargetRow_(row), count);
  prev.total += count;
}

/** 見ている期間の1行を足す */
function usageSummaryAdd_(acc, row, day, target) {
  var user = String(row.user || '');
  var count = Number(row.count) || 0;

  // 人ごとの並びは、絞り込んでいても全員ぶんを出す。誰が使って
  // いるかは、一人を見ているときにも知りたい
  usageTallyAdd_(acc.byUser, user, function () { return { who: user, count: 0 }; }, count);

  if (target && user !== target) return;

  usageTallyAdd_(acc.byTarget, String(row.kind) + ':' + String(row.target),
    usageTargetRow_(row), count);
  usageTallyAdd_(acc.byDay, day, function () { return { day: day, count: 0 }; }, count);
  acc.total += count;

  var weekday = usageWeekday_(day);
  if (weekday >= 0) acc.byWeekday[weekday] += count;
}

/**
 * CSV にするための、日・場所・人ごとの数。
 *
 * **見る人が見られる人 (`visible`) 以外の行は入れない。** 名前を空にして
 * 数だけ残す形にすると、見られない人が1人のとき、その人の日ごと・場所ごとの
 * 記録がそのまま読める。そのため足しても画面の「数えた回数」と合わない
 * ことがある (画面にもそう書く)。
 *
 * @param {number} [days]
 * @param {Date} [today]
 * @param {string} [who] 空なら全員ぶん
 * @param {string[]} visible 人の列に出してよい人
 * @returns {{from:string, to:string, who:string,
 *   rows:Array<{day:string, kind:string, target:string, user:string, count:number}>}}
 */
function usageRows(days, today, who, visible) {
  var range = usageSpan_(days, today);
  var target = String(who || '');
  var allowed = visible || [];

  var rows = dbReadAll('usage');
  var at = {};
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var day = usageDayOf_(rows[i].day);
    if (day < range.from || day > range.to) continue;

    var user = String(rows[i].user || '');
    if (target && user !== target) continue;
    if (allowed.indexOf(user) < 0) continue;

    var kind = String(rows[i].kind);
    var place = String(rows[i].target);
    var key = day + '\t' + kind + '\t' + place + '\t' + user;

    if (!Object.prototype.hasOwnProperty.call(at, key)) {
      at[key] = out.length;
      out.push({ day: day, kind: kind, target: place, user: user, count: 0 });
    }
    out[at[key]].count += Number(rows[i].count) || 0;
  }

  out.sort(function (a, b) {
    var ka = [a.day, a.kind, a.target, a.user];
    var kb = [b.day, b.kind, b.target, b.user];
    for (var k = 0; k < ka.length; k++) {
      if (ka[k] !== kb[k]) return ka[k] < kb[k] ? -1 : 1;
    }
    return 0;
  });

  return { from: range.from, to: range.to, who: target, rows: out };
}
