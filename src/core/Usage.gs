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
 * @returns {number}
 */
function USAGE_KEEP_DAYS() {
  return 180;
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

  // 数えられなくても操作は続けられる。取れなければ諦める
  return dbWithLock_(5000, function () {
        var cols = DB_SCHEMA().usage;
        var sheet = dbSheet_('usage');
        var last = sheet.getLastRow();

        var values = last > 1
          ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [];

        // 押した人は画面から受け取らない。名乗りを詐称できてしまう
        var me = Session.getActiveUser().getEmail();
        var day = usageDay();

        // 古いぶんは落としてから足し込む。落とさないと丸ごとの読み書きが
        // 際限なく重くなる
        var kept = usageWithinKeep_(values, day);
        var dropped = values.length - kept.length;
        values = kept;

        var at = {};
        for (var r = 0; r < values.length; r++) {
          at[values[r][0] + '\t' + values[r][1] + '\t' + values[r][2] +
            '\t' + values[r][4]] = r;
        }

        var kinds = USAGE_KINDS();
        var added = [];

        // 同じまとめの中に同じ場所が2度入ることがある。**足し先を values の
        // 長さから数えると、まだ書いていない行を指してしまう。** 以前は
        // `values[at[key]]` が undefined になって例外で終わり、そのまとめの
        // ぶんが黙って失われていた
        var addedAt = {};
        var touched = dropped > 0;
        var done = 0;

        for (var i = 0; i < list.length; i++) {
          var kind = String(list[i].kind || '');
          var target = String(list[i].target || '');
          var count = Math.round(Number(list[i].count) || 0);

          if (kinds.indexOf(kind) < 0) continue;
          if (!usageTargetValid_(target)) continue;
          if (count < 1 || count > 10000) continue;

          var key = day + '\t' + kind + '\t' + target + '\t' + me;

          if (Object.prototype.hasOwnProperty.call(at, key)) {
            values[at[key]][3] = (Number(values[at[key]][3]) || 0) + count;
            touched = true;
          } else if (Object.prototype.hasOwnProperty.call(addedAt, key)) {
            added[addedAt[key]][3] = (Number(added[addedAt[key]][3]) || 0) + count;
          } else {
            addedAt[key] = added.length;
            added.push([day, kind, target, count, me]);
          }
          done++;
        }

        if (touched && values.length) {
          sheet.getRange(2, 1, values.length, cols.length).setValues(values);
        }
        if (added.length) {
          sheet.getRange(values.length + 2, 1, added.length, cols.length)
            .setValues(added);
        }

        // 落としたぶんだけ行が余る。消さないと、書き戻した中身の下に
        // 古い行が残ったままになる
        for (var d = 0; d < dropped; d++) {
          sheet.deleteRow(values.length + added.length + 2);
        }
        return done;
  }, function () { return 0; });
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
    end.getFullYear(), end.getMonth(), end.getDate() - USAGE_KEEP_DAYS() + 1));

  var out = [];
  for (var i = 0; i < values.length; i++) {
    // 日が読めない行は落とさない。手で書き換えられる表なので、
    // 読めないことを理由に人の書いたものを消してはならない
    var day = String(values[i][0] || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < from) continue;

    out.push(values[i]);
  }
  return out;
}

/**
 * 使われ方をまとめる。
 *
 * @param {number} [days] 何日ぶんを見るか。省略すると30日
 * @param {Date} [today]
 * @returns {{from:string, to:string, total:number, byTarget:object[],
 *   byDay:object[]}}
 */
function usageSummary(days, today, who) {
  var span = Math.max(1, Math.min(365, Number(days) || 30));
  var end = today || new Date();
  var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - span + 1);

  var from = usageDay(start);
  var to = usageDay(end);
  var target = String(who || '');

  var rows = dbReadAll('usage');
  var byTarget = {};
  var order = [];
  var byDay = {};
  var dayOrder = [];
  var byUser = {};
  var userOrder = [];
  var total = 0;

  for (var i = 0; i < rows.length; i++) {
    var day = String(rows[i].day || '');
    if (day < from || day > to) continue;

    var user = String(rows[i].user || '');
    var count = Number(rows[i].count) || 0;

    // 人ごとの並びは、絞り込んでいても全員ぶんを出す。誰が使って
    // いるかは、一人を見ているときにも知りたい
    if (!byUser[user]) {
      byUser[user] = { who: user, count: 0 };
      userOrder.push(user);
    }
    byUser[user].count += count;

    if (target && user !== target) continue;

    var key = String(rows[i].kind) + ':' + String(rows[i].target);

    if (!byTarget[key]) {
      byTarget[key] = {
        kind: String(rows[i].kind), target: String(rows[i].target), count: 0,
      };
      order.push(key);
    }
    byTarget[key].count += count;

    if (!byDay[day]) {
      byDay[day] = { day: day, count: 0 };
      dayOrder.push(day);
    }
    byDay[day].count += count;
    total += count;
  }

  var targets = order.map(function (k) { return byTarget[k]; });
  targets.sort(function (a, b) { return b.count - a.count; });

  var users = userOrder.map(function (u) { return byUser[u]; });
  users.sort(function (a, b) { return b.count - a.count; });

  dayOrder.sort();
  var daily = dayOrder.map(function (d) { return byDay[d]; });

  return {
    from: from,
    to: to,
    who: target,
    total: total,
    byTarget: targets,
    byDay: daily,
    byUser: users,
  };
}
