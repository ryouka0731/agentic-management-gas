/**
 * 1日のミリ秒。
 *
 * @returns {number}
 */
function GANTT_DAY_MS() {
  return 24 * 60 * 60 * 1000;
}

/**
 * 日付を「その日の0時」に丸める。
 *
 * 時刻を残すと、同じ日なのに棒の位置がずれる。
 *
 * @param {Date|string|number} value
 * @returns {number|null} ミリ秒。読めなければ null
 */
function ganttStartOfDay(value) {
  if (value === null || value === undefined || value === '') return null;

  var d = new Date(value);
  var t = d.getTime();
  if (isNaN(t)) return null;

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * やることを工程表の棒に並べる。
 *
 * 期限が無いものは棒を持たない。始まりは作成日、終わりは期限とし、
 * 期限が作成日より前なら1日分の棒にする。
 *
 * @param {object[]} issues issues 行
 * @param {Date|string|number} [today] 今日。省略時は現在時刻
 * @returns {{from:number, to:number, days:number, rows:object[]}}
 *   rows は {number, title, state, assignee, offset, span, overdue, hasDue}
 */
function ganttLayout(issues, today) {
  var now = ganttStartOfDay(today || new Date());
  var rows = [];
  var from = null;
  var to = null;

  for (var i = 0; i < (issues || []).length; i++) {
    var issue = issues[i];
    var start = ganttStartOfDay(issue.createdAt);
    var due = ganttStartOfDay(issue.dueDate);

    if (start === null) continue;

    var end = (due === null) ? start : Math.max(due, start);

    if (from === null || start < from) from = start;
    if (to === null || end > to) to = end;

    rows.push({
      number: Number(issue.number),
      title: issue.title,
      state: issue.state,
      assignee: issue.assignee,
      hasDue: due !== null,
      overdue: due !== null && String(issue.state) === 'open' && due < now,
      _start: start,
      _end: end,
    });
  }

  if (!rows.length) return { from: now, to: now, days: 1, rows: [] };

  // 今日が範囲の外にあっても線を引けるように含める
  if (now < from) from = now;
  if (now > to) to = now;

  var days = Math.round((to - from) / GANTT_DAY_MS()) + 1;

  for (var r = 0; r < rows.length; r++) {
    rows[r].offset = Math.round((rows[r]._start - from) / GANTT_DAY_MS());
    rows[r].span = Math.round((rows[r]._end - rows[r]._start) / GANTT_DAY_MS()) + 1;
    delete rows[r]._start;
    delete rows[r]._end;
  }

  return {
    from: from,
    to: to,
    days: days,
    todayOffset: Math.round((now - from) / GANTT_DAY_MS()),
    rows: rows,
  };
}
