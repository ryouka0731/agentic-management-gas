/**
 * 集中のしかた: 「今から始める」の記録。
 *
 * いちばん難しいのは始めることなので、**始めたことをその場で返す** (気合いに頼らない)。
 * カメラで「始めた証拠」を撮らせる道具もあるが、番頭では番頭の中で実際に手を動かしたこと
 * (やりとりを書く・やることを直す・ボードで作業中へ動かす・つながった改訂版を記録する) か、
 * 最初の一手を書いたことを「始めた」と数える。
 *
 * 守ること (docs/dev/permissions.md):
 * - **自分の設定でオンにした人だけ** (focus.start、既定はオフ)
 * - **本人にだけ見せる。** 記録を扱えるのは本人だけ (ほかの人の id を名指しされても断る)。
 *   使われ方・工数の集計・ホームの最近の動き・探す一覧には入れない
 * - **数は台帳から数え、保存しない。** 技の図鑑も、ポイントも、取り消せば (やることを消せば) 消える
 * - **連続日数は持たない。** 途切れたときに意欲が下がる
 * - ポイントに入れるのは、週の上位に参加している人のぶんだけ (gamePointsBySpans_)
 *
 * 設計: docs/superpowers/specs/2026-10-14-task-flow-motivation-design.md (2026-10-21 に改めた線)、
 * 調べたこと: 実行意図 (Gollwitzer & Sheeran 2006)・時間の見えにくさ・すぐの報酬。
 */

/** @returns {number[]} 選べる長さ (分)。決まった刻みは無く、ほかの長さも書ける */
function FOCUS_LENGTHS() {
  return [15, 25, 45, 60];
}

/** @returns {number} 書ける長さの上限 (分) */
function FOCUS_MAX_MINUTES() {
  return 180;
}

/** @returns {number} 「すぐ始めた」とみなす秒数 (始めるボーナス・電光石火) */
function FOCUS_QUICK_SECONDS() {
  return 60;
}

/** @returns {number} 「もう少し」で延ばす分 */
function FOCUS_EXTEND_MINUTES() {
  return 10;
}

/** @returns {number} 最初の一手の字数の上限 */
function FOCUS_STEP_MAX() {
  return 200;
}

/**
 * 終わり方。done = やることを完了にした、stopped = やめた、left = 終えないまま次を始めた。
 *
 * @returns {string[]}
 */
function FOCUS_RESULTS() {
  return ['done', 'stopped', 'left'];
}

/**
 * 技の図鑑。**唯一の定義。** 並びは画面に出す順。n 回目を満たした日を得た日とする。
 * まだ得ていないものは名前も中身も返さない (画面は ??? と出す)。
 *
 * @returns {Array<{key: string, label: string, about: string, kind: string, n: number}>}
 */
function FOCUS_BADGES() {
  return [
    { key: 'lightning', label: '電光石火', about: '開いてから1分のうちに始めた', kind: 'quick', n: 1 },
    { key: 'early', label: '一番乗り', about: 'その日の最初の集中を10時より前に始めた', kind: 'early', n: 1 },
    { key: 'finish', label: 'やりきった', about: '集中しているうちに、やることを完了にした', kind: 'done', n: 1 },
    { key: 'comeback', label: '七転び八起き', about: '「もう少し」で延ばしたあと、最後までやりきった', kind: 'comeback', n: 1 },
    { key: 'steps', label: '小さな一歩', about: '最初の一手を10回書いた', kind: 'firstStep', n: 10 },
    { key: 'starts10', label: '十回始めた', about: '始めたことを10回確かめた', kind: 'proved', n: 10 },
  ];
}

/**
 * 始めるまでの時間の区切り (秒)。上から順に見て、最初に収まったもの。
 *
 * @returns {Array<{label: string, max: number}>}
 */
function FOCUS_TO_START_BUCKETS() {
  return [
    { label: '1分以内', max: 60 },
    { label: '5分以内', max: 300 },
    { label: '15分以内', max: 900 },
    { label: 'それより長く', max: Infinity },
  ];
}

/**
 * 時刻を数にする。読めなければ NaN。
 *
 * @param {*} v
 * @returns {number}
 */
function focusTime_(v) {
  return motivationTime_(v);
}

/**
 * 本人の記録だけ。台帳を1回だけ読む (既に読んだものがあれば読み直さない)。
 *
 * @param {string} me 小文字のアドレス
 * @param {object[]} [rows] 既に読んだ focus_sessions
 * @returns {object[]}
 */
function focusRowsOf_(me, rows) {
  var all = rows || dbReadAll('focus_sessions');
  return all.filter(function (r) { return String(r.who || '').toLowerCase() === me; });
}

/**
 * 開いている本人 (小文字)。分からなければ断る。
 *
 * @returns {string}
 */
function focusMe_() {
  var me = currentEmailLower_();
  if (!me) throw new Error('誰か分かりません。集中の記録は本人にしか付けられません');
  return me;
}

/**
 * 自分の記録を名指しで引く。**ほかの人の記録は断る。**
 *
 * @param {string} me
 * @param {*} id
 * @returns {object}
 */
function focusOwn_(me, id) {
  var row = dbFindOne('focus_sessions', 'id', id);
  if (!row) throw new Error('集中の記録が見つかりません: ' + id);
  if (String(row.who || '').toLowerCase() !== me) throw new Error('ほかの人の集中の記録は扱えません');
  return row;
}

/**
 * 始める。前に終えていない自分の記録があれば「終えないまま次を始めた」(left) にする。
 *
 * openedAt は画面が「今から始める」を開いた時刻。今より先・1時間より前・読めないものは
 * 始めた時刻に倒す (始めるまでの時間を作り物にさせない)。
 *
 * @param {string} me 小文字のアドレス
 * @param {number} number やることの番号
 * @param {number} minutes 長さ (分)
 * @param {string} firstStep 最初の一手 (空でよい)
 * @param {*} openedAt
 * @param {Date} now
 * @returns {object} 足した行
 */
function focusStart_(me, number, minutes, firstStep, openedAt, now) {
  var issue = issueGet(number);
  if (String(issue.state) === 'closed') throw new Error('#' + number + ' は完了しています。開き直してから始めてください');
  if (issue.archivedAt) throw new Error('#' + number + ' は捨てたものです');
  var m = Number(minutes);
  if (!isFinite(m) || Math.floor(m) !== m || m < 1 || m > FOCUS_MAX_MINUTES()) {
    throw new Error('集中する長さは1〜' + FOCUS_MAX_MINUTES() + '分の整数で選んでください');
  }
  var step = String(firstStep == null ? '' : firstStep).replace(/^\s+|\s+$/g, '');
  if (step.length > FOCUS_STEP_MAX()) step = step.substring(0, FOCUS_STEP_MAX());

  var opened = focusTime_(openedAt);
  if (!isFinite(opened) || opened > now.getTime() || opened < now.getTime() - 3600000) opened = now.getTime();

  return dbWithLock_(30000, function () {
    var mine = focusRowsOf_(me);
    for (var i = 0; i < mine.length; i++) {
      if (!mine[i].endedAt) dbUpdate('focus_sessions', 'id', mine[i].id, { endedAt: now, result: 'left' });
    }
    // 始めた時点のボードの置き場。ボードの移し替えは履歴に残らないので、「始めたあとに作業中へ動かした」は
    // これと今の置き場を比べて確かめる。カードが無ければ 'none' (空は列を足す前の記録 = 分からない)
    var card = dbFindOne('project_items', 'issueNumber', Number(number));
    var columnAtStart = card && card.column ? String(card.column) : 'none';
    return dbAppendNumbered('focus_sessions', 'id', {
      issueNumber: Number(number),
      who: me,
      plannedMinutes: m,
      startedAt: now,
      // 最初の一手を書いたら、その時点で始めたことにする (実行意図を決めたこと自体が一歩)
      firstStep: step,
      provedAt: step ? now : '',
      endedAt: '',
      result: '',
      openedAt: new Date(opened),
      extendedMinutes: 0,
      proofKind: step ? 'firstStep' : '',
      columnAtStart: columnAtStart,
    });
  });
}

/**
 * 「始めた」と言える手を、台帳から探す。始めた時刻から、終えた時刻 (まだなら今) まで。
 * いちばん早いものを返す。見つからなければ null。
 *
 * - やりとり: そのやることに本人が書いた
 * - 直した: そのやることの変更の履歴に本人の行がある (完了にしたのも入る。作ったことは入れない)
 * - 記録: そのやることから作った改訂版 (issue-N…) に本人が記録した
 * - ボード: 画面が「作業中へ動かした」と言い (kind === 'move')、始めた時点 (columnAtStart) では作業中でも
 *   完了でもなく、いま作業中の列にある (ボードの移し替えは履歴に残らないので、始めた時点と今の置き場で確かめる)。
 *   始める前から作業中だったカードを数えると、何もしなくても「始めた」になる。columnAtStart が空の行
 *   (列を足す前の記録) は始めた時点が分からないので、ボードの手は数えない
 *
 * @param {object} row
 * @param {string} kind 画面が言う手 (move のときだけ使う)
 * @param {Date} now
 * @returns {{at: Date, kind: string}|null}
 */
function focusEvidence_(row, kind, now) {
  var me = String(row.who || '').toLowerCase();
  var n = String(row.issueNumber);
  var since = focusTime_(row.startedAt);
  var until = row.endedAt ? focusTime_(row.endedAt) : now.getTime();
  if (!isFinite(since)) return null;
  var best = null;
  function seen(at, what) {
    var t = focusTime_(at);
    if (!isFinite(t) || t < since || t > until) return;
    if (!best || t < best.at.getTime()) best = { at: new Date(t), kind: what };
  }

  dbReadAll('issue_comments').forEach(function (c) {
    if (String(c.issueNumber) === n && String(c.by || '').toLowerCase() === me) seen(c.at, 'comment');
  });
  dbReadAll('change_log').forEach(function (h) {
    // 作ったこと (create) は手を動かしたうちに入れない (作ってすぐ始めると、作った記録が始めたあとに来ることがある)
    if (String(h.target) === 'issue:' + n && String(h.action) !== 'create' &&
        String(h.actor || '').toLowerCase() === me) seen(h.at, 'edit');
  });
  var branch = new RegExp('^issue-' + Number(n) + '(-|$)');
  dbReadAll('commits').forEach(function (c) {
    if (branch.test(String(c.branch || '')) && String(c.author || '').toLowerCase() === me) seen(c.timestamp, 'record');
  });
  var atStart = String(row.columnAtStart == null ? '' : row.columnAtStart);
  if (kind === 'move' && atStart && atStart !== 'In Progress' && atStart !== 'Done') {
    var card = dbFindOne('project_items', 'issueNumber', n);
    if (card && String(card.column) === 'In Progress') seen(now, 'move');
  }
  return best;
}

/**
 * 始めたことを確かめる。既に確かめていれば何もしない。
 *
 * @param {string} me
 * @param {*} id
 * @param {string} kind 画面が言う手 (comment / edit / move / record)
 * @param {Date} now
 * @returns {{row: object, fresh: boolean}} fresh は今回確かめたか
 */
function focusProve_(me, id, kind, now) {
  return dbWithLock_(30000, function () {
    var row = focusOwn_(me, id);
    if (row.provedAt) return { row: row, fresh: false };
    var ev = focusEvidence_(row, String(kind || ''), now);
    if (!ev) return { row: row, fresh: false };
    dbUpdate('focus_sessions', 'id', row.id, { provedAt: ev.at, proofKind: ev.kind });
    return { row: dbFindOne('focus_sessions', 'id', row.id), fresh: true };
  });
}

/**
 * 延ばす (「もう少し」)。終えた記録は延ばせない。
 *
 * @param {string} me
 * @param {*} id
 * @param {number} [minutes] 省くと FOCUS_EXTEND_MINUTES
 * @returns {object}
 */
function focusExtend_(me, id, minutes) {
  var m = minutes === undefined || minutes === null ? FOCUS_EXTEND_MINUTES() : Number(minutes);
  if (!isFinite(m) || Math.floor(m) !== m || m < 1 || m > 60) throw new Error('延ばすのは1〜60分の整数です');
  return dbWithLock_(30000, function () {
    var row = focusOwn_(me, id);
    if (row.endedAt) throw new Error('この集中はもう終わっています');
    var total = (Number(row.extendedMinutes) || 0) + m;
    if ((Number(row.plannedMinutes) || 0) + total > FOCUS_MAX_MINUTES()) {
      throw new Error('合わせて' + FOCUS_MAX_MINUTES() + '分までです。一度終えてから始め直してください');
    }
    dbUpdate('focus_sessions', 'id', row.id, { extendedMinutes: total });
    return dbFindOne('focus_sessions', 'id', row.id);
  });
}

/**
 * 終える。まだ確かめていなければ、終える前に台帳を見て確かめる (書いてから終えた人を取りこぼさない)。
 * 既に終えていれば、そのまま返す (二度押し)。
 *
 * @param {string} me
 * @param {*} id
 * @param {string} result done / stopped
 * @param {Date} now
 * @returns {object}
 */
function focusEnd_(me, id, result, now) {
  var r = String(result || '');
  if (r !== 'done' && r !== 'stopped') throw new Error('終わり方は「終わった」か「やめる」です');
  return dbWithLock_(30000, function () {
    var row = focusOwn_(me, id);
    if (row.endedAt) return row;
    var patch = { endedAt: now, result: r };
    if (!row.provedAt) {
      var ev = focusEvidence_(row, '', now);
      if (ev) {
        patch.provedAt = ev.at;
        patch.proofKind = ev.kind;
      }
    }
    dbUpdate('focus_sessions', 'id', row.id, patch);
    return dbFindOne('focus_sessions', 'id', row.id);
  });
}

/**
 * 開いてから始めたと確かめるまでの秒数。確かめていなければ NaN。
 *
 * @param {object} row
 * @returns {number}
 */
function focusSecondsToStart_(row) {
  var proved = focusTime_(row.provedAt);
  var opened = focusTime_(row.openedAt);
  if (!isFinite(opened)) opened = focusTime_(row.startedAt);
  if (!isFinite(proved) || !isFinite(opened)) return NaN;
  return Math.max(0, (proved - opened) / 1000);
}

/**
 * 始めるボーナスが付くか。開いてから1分のうちに始めた、または、やることの開始日に始めた。
 *
 * @param {object} row
 * @param {object} [issue]
 * @returns {boolean}
 */
function focusBonus_(row, issue) {
  var opened = focusTime_(row.openedAt);
  var started = focusTime_(row.startedAt);
  if (isFinite(opened) && isFinite(started) && started - opened <= FOCUS_QUICK_SECONDS() * 1000) return true;
  var day = motivationDay_(row.startedAt);
  return !!(issue && day && motivationDay_(issue.startDate) === day);
}

/**
 * ポイントになる始め。**確かめた始めだけ・同じやることには1人1日1回まで** (数稼ぎをさせない)。
 * 1点、始めるボーナスが付けば +1。同じ日に何度か始めたら、いちばん良いもの1つ。
 *
 * @param {object[]} sessions focus_sessions
 * @param {object[]} issues
 * @returns {Array<{id: number, who: string, day: string, points: number}>}
 */
function focusCredits_(sessions, issues) {
  var byNumber = {};
  for (var i = 0; i < issues.length; i++) byNumber[String(issues[i].number)] = issues[i];
  var best = {};
  var order = [];
  for (var s = 0; s < sessions.length; s++) {
    var row = sessions[s];
    if (!row.provedAt) continue;
    var who = String(row.who || '').toLowerCase();
    var day = motivationDay_(row.provedAt);
    var issue = byNumber[String(row.issueNumber)];
    // 消したやることの記録は数えない (やることごと消えたものとして扱う)
    if (!who || !day || !issue) continue;
    var points = 1 + (focusBonus_(row, issue) ? 1 : 0);
    var key = who + '|' + String(row.issueNumber) + '|' + day;
    if (!best[key]) order.push(key);
    if (!best[key] || points > best[key].points) best[key] = { id: Number(row.id), who: who, day: day, points: points };
  }
  return order.map(function (k) { return best[k]; });
}

/**
 * 本人の技の図鑑。**本人にだけ見せる。台帳から数え、保存しない。**
 * まだ得ていないものは名前も中身も返さない (画面は ??? と出す)。
 *
 * @param {object[]} mine 本人の記録
 * @returns {Array<{key: string, label: string, about: string, done: boolean, at: string}>}
 */
function focusBadges_(mine) {
  var days = { quick: [], early: [], done: [], comeback: [], firstStep: [], proved: [] };
  var firstOfDay = {};
  var list = mine.slice().sort(function (a, b) { return focusTime_(a.startedAt) - focusTime_(b.startedAt); });
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var day = motivationDay_(row.startedAt);
    if (!day) continue;
    if (!firstOfDay[day]) {
      firstOfDay[day] = true;
      var hour = Number(Utilities.formatDate(new Date(focusTime_(row.startedAt)), 'Asia/Tokyo', 'HH'));
      if (isFinite(hour) && hour < 10) days.early.push(day);
    }
    if (String(row.firstStep || '').replace(/^\s+|\s+$/g, '')) days.firstStep.push(day);
    if (row.provedAt) {
      var proved = motivationDay_(row.provedAt) || day;
      days.proved.push(proved);
      if (focusSecondsToStart_(row) <= FOCUS_QUICK_SECONDS()) days.quick.push(proved);
    }
    if (String(row.result) === 'done') {
      var ended = motivationDay_(row.endedAt) || day;
      days.done.push(ended);
      if ((Number(row.extendedMinutes) || 0) > 0) days.comeback.push(ended);
    }
  }
  for (var k in days) days[k].sort();
  return FOCUS_BADGES().map(function (b) {
    var got = days[b.kind];
    var done = got.length >= b.n;
    return { key: b.key, label: done ? b.label : '', about: done ? b.about : '', done: done,
      at: done ? got[b.n - 1] : '' };
  });
}

/**
 * 本人の数。今週 (月曜はじまり) に始めた・始めたと確かめた・やりきった数と、
 * 始めるまでの時間の分かれ方 (確かめた全部)。**連続日数は持たない。**
 *
 * @param {object[]} mine
 * @param {Date} now
 * @returns {{week: {started: number, proved: number, finished: number},
 *   toStart: Array<{label: string, count: number}>, measured: number}}
 */
function focusStats_(mine, now) {
  var span = motivationSpan_(now);
  var week = { started: 0, proved: 0, finished: 0 };
  var buckets = FOCUS_TO_START_BUCKETS().map(function (b) { return { label: b.label, max: b.max, count: 0 }; });
  var measured = 0;
  for (var i = 0; i < mine.length; i++) {
    var row = mine[i];
    var day = motivationDay_(row.startedAt);
    if (day && day >= span.weekStart && day <= span.today) {
      week.started++;
      if (row.provedAt) week.proved++;
      if (String(row.result) === 'done') week.finished++;
    }
    var sec = focusSecondsToStart_(row);
    if (!isFinite(sec)) continue;
    measured++;
    for (var b = 0; b < buckets.length; b++) {
      if (sec <= buckets[b].max) {
        buckets[b].count++;
        break;
      }
    }
  }
  return { week: week, toStart: buckets.map(function (x) { return { label: x.label, count: x.count }; }),
    measured: measured };
}

/**
 * いま続いている本人の記録 (終えていないもののうち新しいもの)。12時間より前に始めたものは
 * 置きっぱなしとみなして返さない。無ければ null。
 *
 * @param {object[]} mine
 * @param {Date} now
 * @returns {object|null}
 */
function focusActive_(mine, now) {
  var found = null;
  for (var i = 0; i < mine.length; i++) {
    var row = mine[i];
    if (row.endedAt) continue;
    var t = focusTime_(row.startedAt);
    if (!isFinite(t) || now.getTime() - t > 12 * 3600000) continue;
    if (!found || t > focusTime_(found.startedAt)) found = row;
  }
  return found;
}

/**
 * 画面に渡す形。
 *
 * @param {object} row
 * @param {object} [issue] 題名を添えるとき
 * @returns {object}
 */
function focusPlain_(row, issue) {
  return {
    id: plainId(row.id),
    issueNumber: plainId(row.issueNumber),
    title: plainText(issue ? issue.title : ''),
    plannedMinutes: plainNumber(row.plannedMinutes),
    extendedMinutes: plainNumber(row.extendedMinutes) || 0,
    startedAt: plainDate(row.startedAt),
    openedAt: plainDate(row.openedAt),
    provedAt: plainDate(row.provedAt),
    endedAt: plainDate(row.endedAt),
    result: plainText(row.result),
    firstStep: plainText(row.firstStep),
    proofKind: plainText(row.proofKind),
  };
}

/**
 * この記録で本人に付いたポイント。ゲームがオフ・週の上位に参加していない・数えない始めなら 0。
 *
 * @param {string} me
 * @param {object} row
 * @returns {number}
 */
function focusPointsOf_(me, row) {
  if (!gameEnabled()) return 0;
  var playing = gamePlayers_().some(function (p) { return String(p).toLowerCase() === me; });
  if (!playing) return 0;
  var credits = focusCredits_(focusRowsOf_(me), dbReadAll('issues'));
  for (var i = 0; i < credits.length; i++) if (credits[i].id === Number(row.id)) return credits[i].points;
  return 0;
}
