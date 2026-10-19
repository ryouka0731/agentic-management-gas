/**
 * ホーム (トップページ)。設計: docs/superpowers/specs/2026-10-14-home-design.md
 *
 * - 草は**本人のぶんとチームの合計だけ**。部下を含めて他人の草は返さない
 *   (人に関わる数は本人と部下だけ、の決まりより狭くしてある。人ごとの草は監視に見える)
 * - **連続日数・最長記録は数えない。** 途切れたときに意欲が下がる (Silverman & Barasch 2022)
 * - 数は台帳から数え、保存しない。表は1回ずつ読む
 */

/** 草の週の数 (GitHub と同じく約1年) */
function HOME_WEEKS() {
  return 53;
}

/**
 * 'YYYY-MM-DD' を n 日ずらす。
 *
 * @param {string} day
 * @param {number} n
 * @returns {string}
 */
function homeAddDay_(day, n) {
  var d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

/**
 * 草。前に進めた行い (記録・完了・依頼・承認や差し戻し・反映) を日ごとに数える。
 *
 * **チームは1つの行いを1回。** 担当が2人のやることを完了しても1。自分の草は、
 * その行いを自分のものとして数えるとき (完了は担当、空なら閉じた人) に1。
 *
 * @param {string} email 開いている本人
 * @param {Date} now
 * @returns {{weeks: Array<Array<{day: string, me: number, team: number, future: boolean}>>, meTotal: number}}
 */
function homeActivity_(email, now) {
  var me = String(email || '');
  var span = motivationSpan_(now);
  var first = homeAddDay_(span.weekStart, -7 * (HOME_WEEKS() - 1));
  var mine = {};
  var team = {};

  function add(v, who) {
    var day = motivationDay_(v);
    if (!day || day < first || day > span.today) return;
    team[day] = (team[day] || 0) + 1;
    if (me && who.indexOf(me) >= 0) mine[day] = (mine[day] || 0) + 1;
  }

  var commits = dbReadAll('commits');
  for (var c = 0; c < commits.length; c++) {
    add(commits[c].timestamp, [String(commits[c].author || '')]);
  }

  var closers = motivationClosers_();
  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    if (String(issues[i].state) !== 'closed') continue;
    add(issues[i].closedAt, motivationCredited_(issues[i], closers));
  }

  var pulls = dbReadAll('pulls');
  var authors = {};
  for (var p = 0; p < pulls.length; p++) {
    var author = String(pulls[p].author || '');
    authors[String(pulls[p].number)] = author;
    add(pulls[p].createdAt, [author]);
    if (String(pulls[p].state) === 'merged') add(pulls[p].mergedAt, [author]);
  }

  var reviews = dbReadAll('reviews');
  for (var r = 0; r < reviews.length; r++) {
    var state = String(reviews[r].state);
    if (state !== 'approve' && state !== 'request_changes') continue;
    var reviewer = String(reviews[r].reviewer || '');
    // 自分の依頼への自分の判断は行いに数えない
    if (!reviewer || reviewer === authors[String(reviews[r].prNumber)]) continue;
    add(reviews[r].at, [reviewer]);
  }

  var weeks = [];
  var meTotal = 0;
  for (var w = 0; w < HOME_WEEKS(); w++) {
    var days = [];
    for (var d = 0; d < 7; d++) {
      var day = homeAddDay_(first, w * 7 + d);
      var future = day > span.today;
      var m = future ? 0 : (mine[day] || 0);
      meTotal += m;
      days.push({ day: day, me: m, team: future ? 0 : (team[day] || 0), future: future });
    }
    weeks.push(days);
  }
  return { weeks: weeks, meTotal: meTotal };
}

/** あなたの番に種類ごとに出す件数 */
function HOME_TURN_MAX() {
  return 5;
}

/** 期限が近いとみなす日数 (今日から) */
function HOME_DUE_DAYS() {
  return 3;
}

/** 最近の動きの件数 */
function HOME_RECENT_MAX() {
  return 10;
}

/**
 * 先頭の HOME_TURN_MAX() 件と総数。
 *
 * @param {object[]} list
 * @returns {{items: object[], total: number}}
 */
function homeCap_(list) {
  return { items: list.slice(0, HOME_TURN_MAX()), total: list.length };
}

/**
 * ホームで使う表を1回ずつ読む。あなたの番・最近の動き・改善のヒントが同じ表を見るので、
 * apiHomeSummary は1回読んで渡す (区画ごとに読むと同じ表を3回読む)。
 *
 * @returns {{issues: object[], pulls: object[], reviews: object[]}}
 */
function homeTables_() {
  return { issues: dbReadAll('issues'), pulls: dbReadAll('pulls'), reviews: dbReadAll('reviews') };
}

/**
 * 確認依頼のうち、自分の番のもの。あなたの番と改善のヒントが同じ規則で数えるため、ここだけで決める。
 *
 * 判断の新旧は prDecisions_ と同じ規則で数える (承認は staleReviewId 以下なら古い。
 * 差し戻しは古くしない)。
 *
 * @param {string} me
 * @param {object[]} pulls
 * @param {object[]} reviews
 * @returns {{toReview: object[], returned: object[]}} pulls の行
 */
function homeReviewQueue_(me, pulls, reviews) {
  var byNumber = {};
  for (var p = 0; p < pulls.length; p++) byNumber[String(pulls[p].number)] = pulls[p];

  // 依頼ごと・人ごとの最後の判断
  var latest = {};
  for (var r = 0; r < reviews.length; r++) {
    var rv = reviews[r];
    var state = String(rv.state);
    if (state !== 'approve' && state !== 'request_changes') continue;
    var pr = byNumber[String(rv.prNumber)];
    if (!pr) continue;
    var old = Number(rv.id) <= (Number(pr.staleReviewId) || 0);
    if (state === 'approve' && old) state = 'stale';
    var key = String(rv.prNumber);
    latest[key] = latest[key] || {};
    latest[key][String(rv.reviewer)] = { state: state, old: old };
  }

  var toReview = [];
  var returned = [];
  for (var q = 0; q < pulls.length; q++) {
    var one = pulls[q];
    var st = String(one.state);
    if (st !== 'open' && st !== 'approved') continue;
    var decided = latest[String(one.number)] || {};

    // 差し戻したあとで中身が変わったら、差し戻した人にもう一度回す。回さないと、
    // 直してもらった依頼が誰の番にも出ない (書いた人の「戻ってきた」は差し戻しが残る限り出す)
    var mine = decided[me];
    if (String(one.author) !== me && prReviewers(one).indexOf(me) >= 0 &&
        (!mine || mine.state === 'stale' || (mine.state === 'request_changes' && mine.old))) {
      toReview.push(one);
    }
    if (String(one.author) === me) {
      for (var who in decided) {
        if (decided[who].state === 'request_changes') { returned.push(one); break; }
      }
    }
  }
  return { toReview: toReview, returned: returned };
}

/**
 * いま自分を待っているもの。
 *
 * **依頼ごとに表を読まない** (reviews と pulls を1回ずつ読む)。
 *
 * @param {string} email
 * @param {Date} now
 * @param {object} [tables] homeTables_() の返り値。無ければ読む
 * @returns {{reviews: {items: object[], total: number}, returned: {items: object[], total: number},
 *   due: {items: object[], total: number}}}
 */
function homeMyTurn_(email, now, tables) {
  var t = tables || homeTables_();
  var me = String(email || '');
  var today = motivationDay_(now);
  var soon = homeAddDay_(today, HOME_DUE_DAYS());

  var queue = homeReviewQueue_(me, t.pulls, t.reviews);
  function item(one) { return { number: Number(one.number), title: String(one.title || '') }; }

  var due = [];
  var issues = t.issues;
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) === 'closed' || row.archivedAt) continue;
    if (issueAssignees(row).indexOf(me) < 0) continue;
    var day = motivationDay_(row.dueDate);
    if (!day || day > soon) continue;
    due.push({ number: Number(row.number), title: String(row.title || ''), due: day, overdue: day < today });
  }
  due.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : a.number - b.number; });

  return {
    reviews: homeCap_(queue.toReview.map(item)),
    returned: homeCap_(queue.returned.map(item)),
    due: homeCap_(due),
  };
}

/**
 * チームで最近起きたこと。**名前もアドレスも持たない** (誰が何をしたかの流れは監視に見える)。
 *
 * 変更の記録は数が多く流れるので出さない。捨てたやることは出さない。
 *
 * @param {Date} now
 * @param {object} [tables] homeTables_() の返り値。無ければ読む
 * @returns {Array<{kind: string, number: number, fileId: string, title: string, at: Date}>}
 */
function homeRecent_(now, tables) {
  var t = tables || homeTables_();
  var limit = now.getTime();
  var out = [];

  function push(kind, number, fileId, title, at) {
    var t = motivationTime_(at);
    if (isNaN(t) || t > limit) return;
    out.push({ kind: kind, number: number, fileId: fileId, title: title, at: new Date(t) });
  }

  var issues = t.issues;
  for (var i = 0; i < issues.length; i++) {
    if (String(issues[i].state) !== 'closed' || issues[i].archivedAt) continue;
    push('closed', Number(issues[i].number), '', String(issues[i].title || ''), issues[i].closedAt);
  }

  var pulls = t.pulls;
  for (var p = 0; p < pulls.length; p++) {
    var pr = pulls[p];
    push('pull', Number(pr.number), '', String(pr.title || ''), pr.createdAt);
    if (String(pr.state) === 'merged') push('merged', Number(pr.number), '', String(pr.title || ''), pr.mergedAt);
  }

  // Drive で消された文書は一覧と同じく出さない
  var files = filesVisibleInWiki();
  for (var f = 0; f < files.length; f++) {
    if (branchOfPath_(String(files[f].path || '')) !== 'main') continue;
    push('file', 0, String(files[f].fileId || ''), String(files[f].path || ''), files[f].registeredAt);
  }

  // 新しい順。同じ時刻なら反映を先に (依頼を出してすぐ反映した場合の並びを決める)
  var rank = { merged: 0, closed: 1, pull: 2, file: 3 };
  out.sort(function (a, b) {
    return b.at.getTime() - a.at.getTime() || rank[a.kind] - rank[b.kind];
  });
  return out.slice(0, HOME_RECENT_MAX());
}

/**
 * 改善のヒントの規則。**ここが唯一の定義** (id・重み・閾値・言葉・ボタン)。
 * 設計: docs/superpowers/specs/2026-10-19-five-asks-design.md の D。
 *
 * - **本人のデータとチームの合計だけから決める。** 外部 API も AI も使わない
 * - 人の名前・他人の数は出さない。報告の規則は件数だけ (誰が出したかは言わない)
 * - why / tip の {n} などは homeAdvice_ が数で埋める
 * - action.kind は画面の行き先 (adviceGo)。足すときは画面にも足す
 *
 * min: これ以上で当たる / days: 数える期間 (日) / weight: 重い順に出す
 *
 * @returns {Array<object>}
 */
function ADVICE_RULES() {
  return [
    { id: 'reviews', weight: 60, min: 1, days: 3,
      title: '確認を待たせています',
      why: '確かめてほしいと頼まれた依頼のうち {n}件が、{days}日以上そのままです',
      tip: '先に返すと、頼んだ人が先へ進めます',
      action: { kind: 'pulls', label: '確認依頼を開く' } },
    { id: 'overdue', weight: 50, min: 3,
      title: '期限切れが溜まっています',
      why: 'あなたが担当の期限切れが {n}件あります',
      tip: '期限を見直すか、分けるか、手放しましょう',
      action: { kind: 'issues-overdue', label: '期限切れを見る' } },
    { id: 'wip', weight: 40, min: 5, limit: 3,
      title: '抱えすぎています',
      why: 'あなたが担当で作業中のやることが {n}件あります',
      tip: '手を付けるのを{limit}件までに絞ると、早く終わります',
      action: { kind: 'board', label: 'ボードを開く' } },
    // share: 予定の ratio 倍以上かかったものの割合がこれ以上で当たる。sample: 工数を書いて片づけたものがこれ未満なら判断しない
    { id: 'estimate', weight: 30, min: 1, days: 30, ratio: 2, share: 0.5, sample: 3,
      title: '見積もりと実際がずれています',
      why: '{days}日で片づけた担当のうち工数を書いた {total}件の {n}件が、予定の{ratio}倍以上かかりました',
      tip: '見積もりを大きめにするか、分けて小さくしましょう',
      action: { kind: 'gantt', label: '工程表を開く' } },
    { id: 'repeat', weight: 20, min: 5, days: 30,
      title: '同じ作業を繰り返しています',
      why: '{days}日で「{key}」のやることが {n}件できました',
      tip: 'ひな形にするか、手元の道具で自動化できます',
      action: { kind: 'issues-filter', label: 'まとめて見る' } },
    { id: 'questions', weight: 10, min: 3, days: 30, admin: true,
      title: '使い方の問い合わせが続いています',
      why: '{days}日で「使い方が分からない」の報告が {n}件ありました',
      tip: '使い方に書き足すと減ります',
      action: { kind: 'report', label: '要望・不具合を開く' } },
  ];
}

/** 改善のヒントを一度に出す件数 */
function ADVICE_MAX() {
  return 3;
}

/**
 * 規則の文の {名前} を埋める。
 *
 * @param {string} text
 * @param {object} vars
 * @returns {string}
 */
function adviceFill_(text, vars) {
  return String(text || '').replace(/\{([a-z]+)\}/g, function (all, key) {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : all;
  });
}

/**
 * 'YYYY-MM-DD' どうしの日数 (b - a)。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function adviceDays_(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/**
 * 題名の先頭の語。区切り (空白・記号) までを取る。2字に満たなければ '' (「月」などで束ねない)。
 *
 * @param {string} title
 * @returns {string}
 */
function adviceTitleHead_(title) {
  var head = String(title || '').replace(/^\s+/, '')
    .split(/[\s　:：、。・,，「」『』【】\[\]()（）\/／|｜#]/)[0];
  return head.length >= 2 ? head : '';
}

/**
 * 改善のヒント。規則を順に当て、当たったものを重い順に ADVICE_MAX() 件まで返す。
 *
 * **本人のぶんだけ数える** (担当・自分宛て・自分が作った)。報告の規則だけはチームの
 * 件数で、管理者にだけ出す。名前もアドレスも返さない。表は1回ずつ読む。
 *
 * @param {string} email
 * @param {Date} now
 * @param {object} [tables] homeTables_() の返り値。無ければ読む
 * @returns {Array<{id: string, title: string, why: string, tip: string,
 *   action: {kind: string, arg: string, label: string}, weight: number}>}
 */
function homeAdvice_(email, now, tables) {
  var me = String(email || '');
  if (!me) return [];
  var t = tables || homeTables_();
  var today = motivationDay_(now);
  var rules = {};
  ADVICE_RULES().forEach(function (r) { rules[r.id] = r; });
  var out = [];

  function hit(r, vars, arg) {
    var v = Object.assign({}, r, vars);
    out.push({
      id: r.id,
      title: r.title,
      why: adviceFill_(r.why, v),
      tip: adviceFill_(r.tip, v),
      action: { kind: r.action.kind, arg: String(arg === undefined || arg === null ? '' : arg), label: r.action.label },
      weight: r.weight,
    });
  }
  function since(r) { return homeAddDay_(today, -(r.days - 1)); }

  // 自分が担当の、片づいていないやること (捨てたものを除く)
  var mineOpen = t.issues.filter(function (row) {
    return String(row.state) !== 'closed' && !row.archivedAt && issueAssignees(row).indexOf(me) >= 0;
  });

  // 確認を待たせている
  var rv = rules.reviews;
  var waiting = homeReviewQueue_(me, t.pulls, t.reviews).toReview.filter(function (pr) {
    var day = motivationDay_(pr.createdAt);
    return day && adviceDays_(day, today) >= rv.days;
  });
  if (waiting.length >= rv.min) {
    // いちばん長く待たせているものを開く
    waiting.sort(function (a, b) { return motivationTime_(a.createdAt) - motivationTime_(b.createdAt); });
    hit(rv, { n: waiting.length }, Number(waiting[0].number));
  }

  // 期限切れが溜まっている (今日が期限のものはまだ切れていない)
  var overdue = mineOpen.filter(function (row) {
    var day = motivationDay_(row.dueDate);
    return day && day < today;
  });
  if (overdue.length >= rules.overdue.min) hit(rules.overdue, { n: overdue.length });

  // 抱えすぎ
  var columns = {};
  dbReadAll('project_items').forEach(function (it) { columns[String(it.issueNumber)] = String(it.column); });
  var working = mineOpen.filter(function (row) { return columns[String(row.number)] === 'In Progress'; });
  if (working.length >= rules.wip.min) hit(rules.wip, { n: working.length });

  // 見積もりと実際のずれ。棒の日数 (ganttDaysForEffort) と、開始日から閉じた日まで (両端を含む) を比べる
  var es = rules.estimate;
  var judged = 0;
  var over = 0;
  t.issues.forEach(function (row) {
    if (String(row.state) !== 'closed' || row.archivedAt) return;
    if (issueAssignees(row).indexOf(me) < 0) return;
    if (!(Number(row.plannedHours) > 0)) return;
    var start = motivationDay_(row.startDate);
    var closed = motivationDay_(row.closedAt);
    if (!start || !closed || closed < since(es) || closed > today || closed < start) return;
    judged++;
    if (adviceDays_(start, closed) + 1 >= es.ratio * ganttDaysForEffort(row.plannedHours)) over++;
  });
  if (judged >= es.sample && over >= es.min && over >= es.share * judged) {
    hit(es, { n: over, total: judged });
  }

  // 同じ作業の繰り返し。自分が作った (変更の履歴) か、自分が担当のもの
  var rp = rules.repeat;
  var recent = t.issues.filter(function (row) {
    if (row.archivedAt) return false;
    var day = motivationDay_(row.createdAt);
    return day && day >= since(rp) && day <= today;
  });
  if (recent.length >= rp.min) {
    var madeByMe = {};
    dbReadAll('change_log').forEach(function (c) {
      if (String(c.action) !== 'create' || String(c.actor) !== me) return;
      var m = /^issue:(\d+)$/.exec(String(c.target));
      if (m) madeByMe[m[1]] = true;
    });
    var counts = {};
    var isTag = {};
    recent.forEach(function (row) {
      if (!madeByMe[String(row.number)] && issueAssignees(row).indexOf(me) < 0) return;
      var keys = tagsOf(row.labels);
      keys.forEach(function (k) { isTag[k] = true; });
      var head = adviceTitleHead_(row.title);
      if (head && keys.indexOf(head) < 0) keys.push(head);
      keys.forEach(function (k) { counts[k] = (counts[k] || 0) + 1; });
    });
    // 多いものから。同じ数ならタグを先に (人が付けた束ねなので、題名の語より当たっている)
    var best = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || (isTag[b] ? 1 : 0) - (isTag[a] ? 1 : 0) || (a < b ? -1 : a > b ? 1 : 0);
    })[0];
    if (best && counts[best] >= rp.min) hit(rp, { n: counts[best], key: best }, best);
  }

  // 使い方の問い合わせ (管理者のみ)。件数だけ。Drive に聞くのは数が届いたときだけ
  var qs = rules.questions;
  var asked = dbReadAll('inquiries').filter(function (row) {
    var day = motivationDay_(row.at);
    return String(row.kind) === 'question' && day && day >= since(qs) && day <= today;
  });
  if (asked.length >= qs.min && repoIsAdmin_(me)) hit(qs, { n: asked.length });

  // 重い順。同じ重さなら規則の並び順 (sort が安定でなくても決まるよう、順位で比べる)
  var order = {};
  ADVICE_RULES().forEach(function (r, i) { order[r.id] = i; });
  out.sort(function (a, b) { return b.weight - a.weight || order[a.id] - order[b.id]; });
  return out.slice(0, ADVICE_MAX());
}

/**
 * 日報のひな形。**ここが唯一の定義。** 画面にも並びを持つが、取れなかったときの控え。
 * 差し込み: {今日} {明日} {困りごと} {日付} {名前}
 *
 * @returns {Array<{key: string, name: string, body: string}>}
 */
function REPORT_TEMPLATES() {
  return [
    { key: 'three', name: '3節', body: '✅今日やったこと\n{今日}\n\n📅明日やること\n{明日}\n\n⛔️困っていること\n{困りごと}' },
    { key: 'today', name: '今日だけ', body: '✅今日\n{今日}' },
    { key: 'plain', name: '見出し無し', body: '{今日}' },
  ];
}

/** 自分の形の上限 (字数)。UserProperties の1つの値の上限より十分小さく */
function REPORT_CUSTOM_MAX() {
  return 2000;
}

/**
 * 選んでいる形。鍵にアドレスを入れる (疑似GASの UserProperties は人で分かれない)。
 *
 * @param {string} email
 * @returns {string} 'three' | 'today' | 'plain' | 'custom'
 */
function reportKind_(email) {
  var v = String(PropertiesService.getUserProperties().getProperty('REPORT_KIND:' + email) || '');
  return reportKindValid_(v) ? v : 'three';
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function reportKindValid_(kind) {
  if (kind === 'custom') return true;
  return REPORT_TEMPLATES().some(function (t) { return t.key === kind; });
}

/**
 * @param {string} email
 * @param {string} kind
 * @returns {string}
 */
function reportSetKind_(email, kind) {
  var k = String(kind || '');
  if (!reportKindValid_(k)) throw new Error('日報の形が分かりません: ' + k);
  PropertiesService.getUserProperties().setProperty('REPORT_KIND:' + email, k);
  return k;
}

/**
 * @param {string} email
 * @returns {string}
 */
function reportCustom_(email) {
  return String(PropertiesService.getUserProperties().getProperty('REPORT_CUSTOM:' + email) || '');
}

/**
 * 自分の形を書く。中身があれば、選んだ形も「自分の形」にする (1回で両方)。
 * 空にしたとき「自分の形」を選んでいたら、先頭の形 (3節) に戻す。
 *
 * @param {string} email
 * @param {string} text
 * @returns {string}
 */
function reportSetCustom_(email, text) {
  var t = String(text || '');
  if (t.length > REPORT_CUSTOM_MAX()) throw new Error('日報の形は' + REPORT_CUSTOM_MAX() + '字までです');
  var props = PropertiesService.getUserProperties();
  props.setProperty('REPORT_CUSTOM:' + email, t);
  // 書いたら自分の形を選んだことにする。画面から2回に分けて送ると、2回目だけ
  // 落ちたとき書いた形と選んだ形が食い違う。空なら選ばない (空の形は 3節 で写る)
  if (t) props.setProperty('REPORT_KIND:' + email, 'custom');
  // 自分の形を選んだまま空にしたら、選んだ形も先頭の形に戻す。戻さないと
  // 「自分の形」を選んだことになっているのに 3節 で写る
  else if (reportKind_(email) === 'custom') props.setProperty('REPORT_KIND:' + email, REPORT_TEMPLATES()[0].key);
  return t;
}

/**
 * 日報に差し込む中身。本人のぶんだけ。
 *
 * - 明日: 自分が担当の未完了 (捨てたものを除く) で、期限か開始日が明日以前 (期限の早い順、10件)
 * - 困りごと: 自分が出した未解決の障害物。スクラムがオフなら空
 *
 * @param {string} email
 * @param {Date} now
 * @returns {{today: object[], tomorrow: object[], troubles: object[], date: string, name: string}}
 */
function reportParts_(email, now) {
  var me = String(email || '');
  var tomorrow = homeAddDay_(motivationDay_(now), 1);

  var next = [];
  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) === 'closed' || row.archivedAt) continue;
    if (issueAssignees(row).indexOf(me) < 0) continue;
    var due = motivationDay_(row.dueDate);
    var start = motivationDay_(row.startDate);
    if (!((due && due <= tomorrow) || (start && start <= tomorrow))) continue;
    next.push({ number: Number(row.number), title: String(row.title || ''), due: due });
  }
  next.sort(function (a, b) {
    var x = a.due || '9999';
    var y = b.due || '9999';
    return x < y ? -1 : x > y ? 1 : a.number - b.number;
  });

  var troubles = [];
  if (scrumEnabled()) {
    var imps = dbReadAll('impediments');
    for (var m = 0; m < imps.length; m++) {
      if (String(imps[m].reportedBy) !== me || String(imps[m].state) === 'resolved') continue;
      troubles.push({ number: Number(imps[m].number), title: String(imps[m].title || '') });
    }
  }

  var day = motivationDay_(now);
  var dow = '日月火水木金土'.charAt(new Date(day + 'T00:00:00Z').getUTCDay());
  return {
    today: myToday_(me, now),
    tomorrow: next.slice(0, 10),
    troubles: troubles,
    date: Number(day.substring(5, 7)) + '/' + Number(day.substring(8, 10)) + ' (' + dow + ')',
    name: memberNames([me])[me] || me,
  };
}
