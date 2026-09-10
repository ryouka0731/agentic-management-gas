/**
 * 工数の期間ごとの集計。
 *
 * 予定と実績を並べても、1件ずつ見ているうちは傾向が分からない。人ごとと
 * 全体で、一定の区切りごとに足し上げ、累計も並べる。
 *
 * どの日で数えるかは選ばせる。期限で数えれば「いつまでに何人日ぶん
 * 抱えているか」、完了日で数えれば「いつ何人日ぶん消化したか」になる。
 */

/**
 * 区切り方。
 *
 * @returns {Array<{value:string, label:string}>}
 */
function TALLY_UNITS() {
  return [
    { value: 'week', label: '週ごと' },
    { value: 'month', label: '月ごと' },
    { value: 'quarter', label: '四半期ごと' },
    { value: 'half', label: '半期ごと' },
    { value: 'year', label: '年度ごと' },
  ];
}

/**
 * 年度の始まる月 (1始まり)。
 *
 * 四半期と半期と年度は、暦ではなく年度で切る。4月から翌年3月までが
 * ひとつの年度になる。
 *
 * @returns {number}
 */
function TALLY_FISCAL_START() {
  return 4;
}

/**
 * その日が年度の何か月目かと、どの年度かを返す。
 *
 * @param {Date} date
 * @returns {{year:number, index:number}} index は 0 (4月) 〜 11 (翌3月)
 */
function tallyFiscal(date) {
  var start = TALLY_FISCAL_START() - 1;
  var index = date.getMonth() - start;
  var year = date.getFullYear();

  if (index < 0) {
    index += 12;
    year -= 1;
  }
  return { year: year, index: index };
}

/**
 * 数える日の決め方。
 *
 * @returns {Array<{value:string, label:string}>}
 */
function TALLY_BASES() {
  return [
    { value: 'due', label: '期限で数える' },
    { value: 'closed', label: '完了日で数える' },
    { value: 'start', label: '開始日で数える' },
  ];
}

/**
 * 日付を「その日の0時」に丸める。
 *
 * @param {Date|string|number} value
 * @returns {Date|null}
 */
function tallyDay(value) {
  if (value === null || value === undefined || value === '') return null;

  var d = new Date(value);
  if (isNaN(d.getTime())) return null;

  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 数える日を返す。
 *
 * 選んだ基準が空なら、その1件は数えない。無い日を作って数えると、
 * どの区切りに入れても嘘になる。
 *
 * @param {object} issue
 * @param {string} basis 'due' | 'closed' | 'start'
 * @returns {Date|null}
 */
function tallyDateOf(issue, basis) {
  if (basis === 'closed') return tallyDay(issue && issue.closedAt);
  if (basis === 'start') return tallyDay(issue && issue.startDate);

  return tallyDay(issue && issue.dueDate);
}

/** @param {number} n @returns {string} 2桁に揃える */
function tallyPad_(n) {
  var s = String(n);
  return s.length < 2 ? '0' + s : s;
}

/**
 * その日が属する区切りを返す。
 *
 * key は文字の並び順がそのまま時の順になるようにする。並べ替えのために
 * 日付へ戻さずに済む。
 *
 * @param {Date} date
 * @param {string} unit 'week' | 'month' | 'quarter'
 * @returns {{key:string, label:string}}
 */
function tallyPeriodOf(date, unit) {
  var y = date.getFullYear();

  if (unit === 'month') {
    return {
      key: y + '-' + tallyPad_(date.getMonth() + 1),
      label: y + '年' + (date.getMonth() + 1) + '月',
    };
  }

  if (unit === 'quarter') {
    var fq = tallyFiscal(date);
    var q = Math.floor(fq.index / 3) + 1;

    return {
      key: fq.year + '-Q' + q,
      label: fq.year + '年度 第' + q + '四半期',
    };
  }

  if (unit === 'half') {
    var fh = tallyFiscal(date);
    var half = fh.index < 6 ? 1 : 2;

    return {
      key: fh.year + '-H' + half,
      label: fh.year + '年度 ' + (half === 1 ? '上期' : '下期'),
    };
  }

  if (unit === 'year') {
    var fy = tallyFiscal(date);
    return { key: String(fy.year), label: fy.year + '年度' };
  }

  // 週は月曜始まり。日曜始まりだと週末が2つの週に割れて読みにくい
  var shift = (date.getDay() + 6) % 7;
  var monday = new Date(y, date.getMonth(), date.getDate() - shift);

  return {
    key: monday.getFullYear() + '-' + tallyPad_(monday.getMonth() + 1) +
      '-' + tallyPad_(monday.getDate()),
    label: (monday.getMonth() + 1) + '/' + monday.getDate() + ' の週',
  };
}

/** @returns {object} 空の集計 */
function tallyZero_() {
  return { planned: 0, actual: 0, diff: 0, count: 0 };
}

/**
 * 1件を足し込む。
 *
 * @param {object} sum
 * @param {object} issue
 */
function tallyAdd_(sum, issue) {
  var planned = Number(issue.plannedHours) || 0;
  var actual = Number(issue.actualHours) || 0;

  sum.planned += planned;
  sum.actual += actual;
  sum.diff = sum.actual - sum.planned;
  sum.count++;
}

/**
 * 小数の足し算のあとの端数を落とす。
 *
 * 0.1 を3回足すと 0.30000000000000004 になる。人日は0.5きざみで入れる
 * ので、小数第2位まで残せば足りる。
 *
 * @param {object} sum
 * @returns {object} 同じ object
 */
function tallyRound_(sum) {
  sum.planned = Math.round(sum.planned * 100) / 100;
  sum.actual = Math.round(sum.actual * 100) / 100;
  sum.diff = Math.round((sum.actual - sum.planned) * 100) / 100;
  return sum;
}

/**
 * 工数を区切りごとに足し上げる。
 *
 * @param {object[]} issues issues 行 (画面に渡せる形)
 * @param {{unit?:string, basis?:string, who?:string}} [opts]
 *   who を渡すとその人のぶんだけ
 * @returns {{periods:object[], people:object[], total:object, skipped:number}}
 */
function tallyEffort(issues, opts) {
  var o = opts || {};
  var unit = o.unit || 'month';
  var basis = o.basis || 'due';

  var byPeriod = {};
  var order = [];
  var byPerson = {};
  var people = [];
  var total = tallyZero_();
  var skipped = 0;

  for (var i = 0; i < (issues || []).length; i++) {
    var issue = issues[i];
    if (issue.archivedAt) continue;

    var who = String(issue.assignee || '') || '(担当なし)';
    if (o.who && who !== o.who) continue;

    // 工数がどちらも空なら、数えても0が並ぶだけ
    if (!Number(issue.plannedHours) && !Number(issue.actualHours)) continue;

    var date = tallyDateOf(issue, basis);
    if (!date) {
      skipped++;
      continue;
    }

    var period = tallyPeriodOf(date, unit);

    if (!byPeriod[period.key]) {
      byPeriod[period.key] = {
        key: period.key, label: period.label, sum: tallyZero_(), byPerson: {},
      };
      order.push(period.key);
    }
    tallyAdd_(byPeriod[period.key].sum, issue);

    if (!byPeriod[period.key].byPerson[who]) {
      byPeriod[period.key].byPerson[who] = tallyZero_();
    }
    tallyAdd_(byPeriod[period.key].byPerson[who], issue);

    if (!byPerson[who]) {
      byPerson[who] = { who: who, total: tallyZero_() };
      people.push(byPerson[who]);
    }
    tallyAdd_(byPerson[who].total, issue);
    tallyAdd_(total, issue);
  }

  order.sort();

  // 累計は古いほうから積む
  var cum = tallyZero_();
  var periods = [];

  for (var p = 0; p < order.length; p++) {
    var row = byPeriod[order[p]];
    cum.planned += row.sum.planned;
    cum.actual += row.sum.actual;
    cum.count += row.sum.count;

    periods.push({
      key: row.key,
      label: row.label,
      sum: tallyRound_(row.sum),
      byPerson: row.byPerson,
      cumulative: tallyRound_({
        planned: cum.planned, actual: cum.actual, diff: 0, count: cum.count,
      }),
    });
  }

  people.sort(function (a, b) { return a.who < b.who ? -1 : 1; });
  for (var q = 0; q < people.length; q++) tallyRound_(people[q].total);

  return {
    unit: unit,
    basis: basis,
    periods: periods,
    people: people,
    total: tallyRound_(total),
    skipped: skipped,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TALLY_UNITS: TALLY_UNITS,
    TALLY_FISCAL_START: TALLY_FISCAL_START,
    tallyFiscal: tallyFiscal,
    TALLY_BASES: TALLY_BASES,
    tallyDay: tallyDay,
    tallyDateOf: tallyDateOf,
    tallyPeriodOf: tallyPeriodOf,
    tallyEffort: tallyEffort,
  };
}
