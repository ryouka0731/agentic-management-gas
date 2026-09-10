/**
 * どこがよく使われているかの記録。
 *
 * **誰が押したかは残さない。** 日と場所と回数だけを数える。個人の操作を
 * 追える形にすると、見られている道具になり、率直に使われなくなる。
 * 知りたいのは「どこが使われていないか」であって「誰が何をしたか」ではない。
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

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;

  try {
    var cols = DB_SCHEMA().usage;
    var sheet = dbSheet_('usage');
    var last = sheet.getLastRow();

    var values = last > 1
      ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [];

    var at = {};
    for (var r = 0; r < values.length; r++) {
      at[values[r][0] + '\t' + values[r][1] + '\t' + values[r][2]] = r;
    }

    var day = usageDay();
    var kinds = USAGE_KINDS();
    var added = [];
    var touched = false;
    var done = 0;

    for (var i = 0; i < list.length; i++) {
      var kind = String(list[i].kind || '');
      var target = String(list[i].target || '');
      var count = Math.round(Number(list[i].count) || 0);

      if (kinds.indexOf(kind) < 0) continue;
      if (!usageTargetValid_(target)) continue;
      if (count < 1 || count > 10000) continue;

      var key = day + '\t' + kind + '\t' + target;

      if (Object.prototype.hasOwnProperty.call(at, key)) {
        values[at[key]][3] = (Number(values[at[key]][3]) || 0) + count;
        touched = true;
      } else {
        at[key] = values.length + added.length;
        added.push([day, kind, target, count]);
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
    return done;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 使われ方をまとめる。
 *
 * @param {number} [days] 何日ぶんを見るか。省略すると30日
 * @param {Date} [today]
 * @returns {{from:string, to:string, total:number, byTarget:object[],
 *   byDay:object[]}}
 */
function usageSummary(days, today) {
  var span = Math.max(1, Math.min(365, Number(days) || 30));
  var end = today || new Date();
  var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - span + 1);

  var from = usageDay(start);
  var to = usageDay(end);

  var rows = dbReadAll('usage');
  var byTarget = {};
  var order = [];
  var byDay = {};
  var dayOrder = [];
  var total = 0;

  for (var i = 0; i < rows.length; i++) {
    var day = String(rows[i].day || '');
    if (day < from || day > to) continue;

    var count = Number(rows[i].count) || 0;
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

  dayOrder.sort();
  var daily = dayOrder.map(function (d) { return byDay[d]; });

  return { from: from, to: to, total: total, byTarget: targets, byDay: daily };
}
