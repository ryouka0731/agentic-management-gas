/**
 * 目標 (OKR / MBO / KPI) の進み具合と、自動の見立て。
 *
 * **台帳に触らない。** Goal.gs が集めた事実 (つないだやること・期の中で済ませたやることの数・
 * 入れた数) を渡し、ここは数えるだけにする。数え方を1か所に置き、画面・期末のまとめ・
 * 手引き (docs/manual/goals.md) が同じ式を指すようにするため。
 *
 * **自動の見立ては、いつも「見立て」である。** 評価 (finalGrade) を決めるのは上長で、
 * ここはその目安を出すだけ。ポイント (Game.gs) は使わない (遊びの数を評価に混ぜない)。
 */

/**
 * 目標の種類。
 *
 * @returns {Array<{key: string, label: string, help: string}>}
 */
function GOAL_KINDS() {
  return [
    { key: 'okr', label: 'OKR',
      help: '目指す姿と、それに届いたかを測る主な結果 (2〜5つ) を決めます。0.0〜1.0 で見て、0.7 前後なら狙いどおりです' },
    { key: 'mbo', label: 'MBO',
      help: '期のはじめに上長と決める目標です。項目ごとの重み (合わせて100) で達成率を出します' },
    { key: 'kpi', label: 'KPI',
      help: '追いかける数です。目標の値に対する今の値で達成率を出します' },
  ];
}

/**
 * 項目の測り方。
 *
 * @returns {Array<{key: string, label: string, help: string}>}
 */
function GOAL_MEASURES() {
  return [
    { key: 'issues', label: 'つないだやることの完了',
      help: 'つないだ自分のやることのうち、期の中に完了したものの割合。予定の工数 (人日) があればその重さで数え、無ければ1件を1と数えます' },
    { key: 'label', label: 'タグの付いたやることの数',
      help: 'あなたが担当で、期の中に完了したやることのうち、決めたタグが付いたものの数を、目標の数と比べます' },
    { key: 'number', label: '数を入れる',
      help: '今の値を自分で入れ、目標の値と比べます (売上・件数・満足度など)' },
    { key: 'check', label: 'できた・まだ',
      help: 'できたら印を付けます。できていれば100%、まだなら0%です' },
  ];
}

/**
 * 目標の状態。
 *
 * @returns {Object<string, string>}
 */
function GOAL_STATUSES() {
  return {
    draft: '下書き',
    submitted: '承認を待っています',
    approved: '承認済み',
    returned: '差し戻されました',
    closed: '評価済み',
  };
}

/**
 * 状態の移り方。**ここにある移り方だけを許す。**
 *
 * - submit: 本人が承認を頼む (下書き・差し戻しから)
 * - approve / return: 上長が承認する・差し戻す
 * - withdraw: 本人が承認の頼みを取り下げる (下書きに戻る)
 * - edit: 承認済みの目標を本人が直す。もう一度承認を待つ
 * - grade: 上長が期末の評価を付ける。評価済みになり、もう動かない
 *
 * @returns {Object<string, Object<string, string>>}
 */
function GOAL_TRANSITIONS() {
  return {
    draft: { submit: 'submitted' },
    returned: { submit: 'submitted' },
    submitted: { approve: 'approved', 'return': 'returned', withdraw: 'draft' },
    approved: { edit: 'submitted', grade: 'closed' },
    closed: {},
  };
}

/**
 * 次の状態。移れなければ null。
 *
 * @param {string} status
 * @param {string} action
 * @returns {string|null}
 */
function goalNext(status, action) {
  var table = GOAL_TRANSITIONS();
  var from = Object.prototype.hasOwnProperty.call(table, status) ? table[status] : null;
  if (!from || !Object.prototype.hasOwnProperty.call(from, action)) return null;
  return from[action];
}

/**
 * MBO・KPI の達成率から引く見立ての段。**唯一の定義。** 上から順に、min 以上なら当たる。
 *
 * @returns {Array<{grade: string, min: number}>}
 */
function GOAL_GRADES() {
  return [
    { grade: 'S', min: 120 },
    { grade: 'A', min: 100 },
    { grade: 'B', min: 80 },
    { grade: 'C', min: 60 },
    { grade: 'D', min: 0 },
  ];
}

/** MBO・KPI の項目が超えて届いたときの上限 (150%)。上を数えすぎて1つの項目で全体が決まらないように */
function GOAL_CAP() {
  return 1.5;
}

/**
 * 期の中での進み方の見方。経った割合と進み具合の差 (経った割合 − 進み具合) で決める。
 * slight 以下なら順調、behind 以下なら少し遅れ気味、それより大きければ遅れ。
 *
 * @returns {{slight: number, behind: number}}
 */
function GOAL_PACE() {
  return { slight: 0.1, behind: 0.25 };
}

/**
 * 年度の始まりの月を 1〜12 に収める。読めなければ4月。
 *
 * @param {*} fyStart
 * @returns {number}
 */
function goalFyStart_(fyStart) {
  var n = Math.floor(Number(fyStart));
  return n >= 1 && n <= 12 ? n : 4;
}

/**
 * その日が入る期。key は '2026H2' / '2026Q3' の形 (年は年度)。
 *
 * @param {Date} date
 * @param {string} unit 'half' | 'quarter'
 * @param {number} fyStart 年度の始まる月 (1〜12)
 * @returns {{key: string, label: string}}
 */
function goalPeriodOf(date, unit, fyStart) {
  var start = goalFyStart_(fyStart) - 1;
  var index = date.getMonth() - start;
  var year = date.getFullYear();
  if (index < 0) {
    index += 12;
    year -= 1;
  }
  var key = unit === 'quarter'
    ? year + 'Q' + (Math.floor(index / 3) + 1)
    : year + 'H' + (index < 6 ? 1 : 2);
  return { key: key, label: goalPeriodLabel(key) };
}

/**
 * 期の key を読む。形が違えば null。
 *
 * @param {string} key
 * @returns {{year: number, unit: string, n: number}|null}
 */
function goalPeriodParse_(key) {
  var m = /^(\d{4})(H[12]|Q[1-4])$/.exec(String(key || ''));
  if (!m) return null;
  return { year: Number(m[1]), unit: m[2].charAt(0) === 'H' ? 'half' : 'quarter', n: Number(m[2].charAt(1)) };
}

/**
 * 期の名前。
 *
 * @param {string} key
 * @returns {string}
 */
function goalPeriodLabel(key) {
  var p = goalPeriodParse_(key);
  if (!p) return String(key || '');
  if (p.unit === 'half') return p.year + '年度 ' + (p.n === 1 ? '上期' : '下期');
  return p.year + '年度 第' + p.n + '四半期';
}

/**
 * 期の始まりと終わり。end は次の期の始まり (その日は入らない)。
 *
 * @param {string} key
 * @param {number} fyStart
 * @returns {{start: Date, end: Date}|null}
 */
function goalPeriodRange(key, fyStart) {
  var p = goalPeriodParse_(key);
  if (!p) return null;
  var first = goalFyStart_(fyStart) - 1;
  var len = p.unit === 'half' ? 6 : 3;
  var from = first + (p.n - 1) * len;
  // 月が12を超えても Date が翌年へ繰り上げる
  return { start: new Date(p.year, from, 1), end: new Date(p.year, from + len, 1) };
}

/**
 * となりの期。
 *
 * @param {string} key
 * @param {number} step -1 で前、+1 で次
 * @returns {string} 形が違えば ''
 */
function goalPeriodShift(key, step) {
  var p = goalPeriodParse_(key);
  if (!p) return '';
  var per = p.unit === 'half' ? 2 : 4;
  var at = p.year * per + (p.n - 1) + Number(step || 0);
  var year = Math.floor(at / per);
  return year + (p.unit === 'half' ? 'H' : 'Q') + (at - year * per + 1);
}

/** 台帳の日時を読む。読めなければ null */
function goalTime_(v) {
  if (v === null || v === undefined || v === '') return null;
  var d = v instanceof Date ? v : new Date(v);
  var t = d.getTime();
  return isNaN(t) ? null : t;
}

/** 台帳の真偽を読む (Sheets は TRUE、手で書けば 'true' もある) */
function goalBool_(v) {
  return v === true || String(v).toLowerCase() === 'true';
}

/**
 * 項目の重みを、合わせて1になる割合にする。
 *
 * 重みが1つも無い (全部空か0) ときは等しく分ける (OKR の主な結果はふつう同じ重さ)。
 * 1つでも書いてあれば、書いてあるものだけで分ける (空は0)。
 *
 * @param {object[]} items
 * @returns {number[]}
 */
function goalWeights(items) {
  var list = items || [];
  var raw = list.map(function (it) {
    var w = Number(it && it.weight);
    return w > 0 && isFinite(w) ? w : 0;
  });
  var sum = raw.reduce(function (a, b) { return a + b; }, 0);
  if (!sum) return list.map(function () { return list.length ? 1 / list.length : 0; });
  return raw.map(function (w) { return w / sum; });
}

/**
 * 1つの項目の進み具合。
 *
 * facts:
 * - linked: つないだやること (issues 行)。measure 'issues' のとき
 * - counted: 期の中に完了した、タグの付いた本人のやることの数。measure 'label' のとき
 * - start / end: 期の始まりと終わり (この間に完了したものだけを済んだと数える。前の期に済んだものは数えない)
 *
 * OKR の主な結果は 1.0 で止める。MBO・KPI は GOAL_CAP() (150%) まで超えてよい。
 * つないだやることの完了は、全部済んでも 1.0 を超えない。
 *
 * @param {object} item goal_items 行
 * @param {object} facts
 * @param {string} kind 'okr' | 'mbo' | 'kpi'
 * @returns {{progress: number, done: number, total: number, remaining: number}}
 */
function goalItemProgress(item, facts, kind) {
  var f = facts || {};
  var cap = kind === 'okr' ? 1 : GOAL_CAP();
  var measure = String(item && item.measure);
  var target = Number(item && item.target);
  if (!(target > 0) || !isFinite(target)) target = 0;

  if (measure === 'issues') {
    var start = goalTime_(f.start);
    var end = goalTime_(f.end);
    var rows = (f.linked || []).filter(function (r) { return r && !r.archivedAt; });
    var all = 0;
    var got = 0;
    var doneCount = 0;
    rows.forEach(function (r) {
      // 予定の工数 (人日)。列の名前は plannedHours だが、この道具では人日で入れる
      var w = Number(r.plannedHours);
      if (!(w > 0) || !isFinite(w)) w = 1;
      all += w;
      var closed = String(r.state) === 'closed';
      var at = goalTime_(r.closedAt);
      // 期の終わりより後に済ませたものは、この期には数えない (完了の日が無い古い行は済んだと読む)
      if (closed && (at === null || ((end === null || at < end) && (start === null || at >= start)))) {
        got += w;
        doneCount++;
      }
    });
    return { progress: all ? got / all : 0, done: doneCount, total: rows.length, remaining: rows.length - doneCount };
  }

  if (measure === 'label') {
    var n = Math.max(0, Number(f.counted) || 0);
    return {
      progress: target ? Math.min(cap, n / target) : 0,
      done: n, total: target, remaining: Math.max(0, target - n),
    };
  }

  if (measure === 'number') {
    var actual = Number(item && item.actual);
    if (!isFinite(actual)) actual = 0;
    return {
      progress: target ? Math.min(cap, Math.max(0, actual / target)) : 0,
      done: actual, total: target, remaining: Math.max(0, target - actual),
    };
  }

  if (measure === 'check') {
    var ok = goalBool_(item && item.checked);
    return { progress: ok ? 1 : 0, done: ok ? 1 : 0, total: 1, remaining: ok ? 0 : 1 };
  }

  return { progress: 0, done: 0, total: 0, remaining: 0 };
}

/**
 * 目標全体の進み具合 = 項目の進み具合の重み付きの平均。
 *
 * @param {string} kind
 * @param {object[]} items goal_items 行 (並び順)
 * @param {Object<string, object>} factsById 項目の id → goalItemProgress の facts
 * @returns {{progress: number, items: object[]}} items は {progress, done, total, remaining, share}
 */
function goalProgress(kind, items, factsById) {
  var list = items || [];
  var shares = goalWeights(list);
  var facts = factsById || {};
  var total = 0;
  var parts = list.map(function (it, i) {
    var p = goalItemProgress(it, facts[String(it.id)] || {}, kind);
    p.share = shares[i];
    total += p.progress * shares[i];
    return p;
  });
  return { progress: total, items: parts };
}

/**
 * 自動の見立て。**見立てであって評価ではない** (評価は上長が付ける)。
 *
 * - OKR: 0.0〜1.0 の点 (小数1桁)。0.7 前後が狙いどおり、1.0 は目標が低かったかもしれない
 * - MBO・KPI: 達成率 (%, 150 まで) と、GOAL_GRADES() から引いた段
 *
 * @param {string} kind
 * @param {number} progress
 * @returns {{kind: string, score: number|string, percent: number, grade: string, text: string, note: string}}
 */
function goalAutoScore(kind, progress) {
  var p = Number(progress);
  if (!isFinite(p) || p < 0) p = 0;

  if (kind === 'okr') {
    var score = Math.round(Math.min(1, p) * 10) / 10;
    var note;
    if (score >= 1) note = '1.0 に届きました。目標が低めだったかもしれません。次の期は少し背伸びした目標を考えてみてください';
    else if (score >= 0.6) note = '狙いどおりの届き方です (0.7 前後が目安です)';
    else if (score >= 0.3) note = 'まだ途中です。0.7 前後に届けば狙いどおりです';
    else note = 'これからです。0.7 前後に届けば狙いどおりです';
    return { kind: 'okr', score: score, percent: Math.round(Math.min(1, p) * 100), grade: '',
      text: score.toFixed(1), note: note };
  }

  var percent = Math.round(Math.min(GOAL_CAP(), p) * 100);
  var grades = GOAL_GRADES();
  var grade = grades[grades.length - 1].grade;
  for (var i = 0; i < grades.length; i++) {
    if (percent >= grades[i].min) {
      grade = grades[i].grade;
      break;
    }
  }
  return { kind: String(kind), score: '', percent: percent, grade: grade, text: percent + '%',
    note: '見立ては ' + grade + ' です。評価を決めるのは上長です' };
}

/**
 * 期の中での進み方。責める言い方はしない。
 *
 * @param {number} progress
 * @param {{start: Date, end: Date}} range
 * @param {Date} now
 * @returns {{key: string, label: string, elapsed: number}}
 */
function goalPace(progress, range, now) {
  if (!range) return { key: 'none', label: '', elapsed: 0 };
  var t = now.getTime();
  var s = range.start.getTime();
  var e = range.end.getTime();
  if (t < s) return { key: 'before', label: 'まだ期が始まっていません', elapsed: 0 };
  if (t >= e) return { key: 'ended', label: '期が終わりました。振り返りを書きましょう', elapsed: 1 };

  var elapsed = (t - s) / (e - s);
  var gap = elapsed - Math.min(1, Math.max(0, Number(progress) || 0));
  var pace = GOAL_PACE();
  if (gap <= pace.slight) return { key: 'ok', label: '順調です', elapsed: elapsed };
  if (gap <= pace.behind) {
    return { key: 'slight', label: '少し遅れ気味です。次の一手を1つ決めておくと進みやすくなります', elapsed: elapsed };
  }
  return { key: 'behind', label: '期の残りに比べて遅れています。手伝いが要るか、上長と話してみてください', elapsed: elapsed };
}

/**
 * 「あと◯」の字。届いていれば ''。赤い警告ではなく、残りを静かに添える。
 *
 * @param {object} item goal_items 行
 * @param {{remaining: number}} p goalItemProgress の返り
 * @returns {string}
 */
function goalRemainingText(item, p) {
  var left = Number(p && p.remaining);
  if (!(left > 0)) return '';
  var measure = String(item && item.measure);
  if (measure === 'issues' || measure === 'label') return 'あと' + left + '件';
  if (measure === 'number') {
    var unit = String((item && item.unit) || '');
    return 'あと ' + (Math.round(left * 100) / 100) + (unit ? ' ' + unit : '');
  }
  return 'まだです';
}
