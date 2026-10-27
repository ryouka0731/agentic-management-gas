/*
 * 画面の API: ホーム・前進を見せる (意欲づけ)・日報・横断検索。
 */

/**
 * チームの前進を返す (Web App API)。人ごとには数えない。
 *
 * @returns {{weekClosed: number, weekMerged: number, monthClosed: number, goal: number, canEditGoal: boolean}}
 */
function apiProgress() {
  var p = motivationProgress(new Date());
  p.canEditGoal = repoIsAdmin_(currentEmail_());
  return p;
}

/**
 * チームの毎月の目標を決める (Web App API)。管理者だけ。0 で消す。
 *
 * @param {number} n
 * @returns {object} 決めたあとの apiProgress()
 */
function apiSetTeamGoal(n) {
  repoAssertAdmin_('チームの目標を決めること');
  teamGoalSet_(n);
  return apiProgress();
}

/**
 * はじめの5歩を返す (Web App API)。開いている本人のぶんだけ。
 *
 * @returns {object[]}
 */
function apiMyMilestones() {
  return motivationMilestones_(currentEmail_()).map(function (m) {
    return { key: m.key, label: m.label, hint: m.hint, tab: m.tab, done: !!m.done };
  });
}

/**
 * 完了にしたやることについて、何が起きたかを1つ返す (Web App API)。
 *
 * issues は1回だけ読み、知らせとポイントの両方に回す (完了のたびに走るため)。
 * 閉じていないやることには、ポイントもレベルも添えない。
 *
 * @param {number} number
 * @returns {object}
 */
function apiCloseFeedback(number) {
  var issues = dbReadAll('issues');
  var fb = closeFeedback_(Number(number), new Date(), issues);
  var out = {
    kind: plainText(fb.kind),
    number: plainId(fb.number),
    title: plainText(fb.title),
    weekClosed: plainNumber(fb.weekClosed),
    monthClosed: plainNumber(fb.monthClosed),
    goal: plainNumber(fb.goal),
  };
  if (fb.parent) {
    out.parent = { number: plainId(fb.parent.number), title: plainText(fb.parent.title),
      done: plainNumber(fb.parent.done), total: plainNumber(fb.parent.total) };
  }
  if (fb.days) out.days = plainNumber(fb.days);
  if (gameEnabled() && fb.closed) {
    var g = gameAfterClose_(currentEmail_(), Number(number),
      { issues: issues });
    out.points = plainNumber(g.points);
    if (g.levelUp) out.levelUp = plainNumber(g.levelUp);
  }
  return out;
}

/**
 * 今日片づけたもの (Web App API)。開いている本人のぶんだけ。
 *
 * @returns {Array<{kind: string, number: number, title: string}>}
 */
function apiMyToday() {
  var me = currentEmail_();
  return myToday_(me, new Date()).map(function (x) {
    return { kind: plainText(x.kind), number: plainId(x.number), title: plainText(x.title) };
  });
}

/**
 * 草 (Web App API)。本人のぶんとチームの合計だけ。
 *
 * @returns {{weeks: Array<Array<{day: string, me: number, team: number, future: boolean}>>, meTotal: number}}
 */
function apiHomeActivity() {
  var me = currentEmail_();
  var act = homeActivity_(me, new Date());
  return {
    weeks: act.weeks.map(function (w) {
      return w.map(function (c) {
        return { day: plainText(c.day), me: plainNumber(c.me), team: plainNumber(c.team), future: !!c.future };
      });
    }),
    meTotal: plainNumber(act.meTotal),
  };
}

/**
 * あなたの番・最近の動き・改善のヒント (Web App API)。最近の動きにも改善のヒントにも名前は入らない。
 *
 * @returns {{myTurn: object, recent: object[], advice: object[]}}
 */
function apiHomeSummary() {
  var me = currentEmail_();
  var now = new Date();
  var tables = homeTables_();
  var turn = homeMyTurn_(me, now, tables);
  // 改善のヒントは無くてもホームは使える。落ちてもほかの区画は返す。
  // ホームに出さないと決めた人のぶんは数えない (表をいくつも読むので)
  var advice = [];
  try {
    if (prefGet_('home.cards.advice', me)) advice = homeAdvice_(me, now, tables);
  } catch (e) {
    Logger.log('改善のヒントを出せませんでした: ' + e.message);
  }
  return {
    myTurn: homeTurnPlain_(turn),
    recent: homeRecent_(now, tables).map(function (x) {
      return { kind: plainText(x.kind), number: plainId(x.number), fileId: plainText(x.fileId),
        title: plainText(x.title), at: plainDate(x.at) };
    }),
    advice: homeAdvicePlain_(advice),
  };
}

/**
 * あなたの番を画面 (と手元の道具) に渡せる形にする。apiHomeSummary とキューの homeMine が使う。
 *
 * @param {object} turn homeMyTurn_
 * @returns {{reviews: object, returned: object, due: object}}
 */
function homeTurnPlain_(turn) {
  function part(x, extra) {
    return {
      total: plainNumber(x.total),
      items: x.items.map(function (it) {
        var o = { number: plainId(it.number), title: plainText(it.title) };
        if (extra) extra(o, it);
        return o;
      }),
    };
  }
  return {
    reviews: part(turn.reviews),
    returned: part(turn.returned),
    due: part(turn.due, function (o, it) { o.due = plainText(it.due); o.overdue = !!it.overdue; }),
  };
}

/**
 * 改善のヒントを渡せる形にする。apiHomeSummary とキューの homeAdvice が使う。
 *
 * @param {object[]} advice homeAdvice_
 * @returns {object[]}
 */
function homeAdvicePlain_(advice) {
  return advice.map(function (a) {
    return {
      id: plainText(a.id), title: plainText(a.title), why: plainText(a.why), tip: plainText(a.tip),
      action: { kind: plainText(a.action.kind), arg: plainText(a.action.arg), label: plainText(a.action.label) },
      weight: plainNumber(a.weight),
    };
  });
}

/**
 * 日報の中身・ひな形・選んでいる形・自分の形 (Web App API)。本人のぶんだけ。
 *
 * @returns {{parts: object, templates: object[], kind: string, custom: string}}
 */
function apiReportParts() {
  var me = currentEmail_();
  return {
    parts: reportPartsPlain_(reportParts_(me, new Date())),
    templates: REPORT_TEMPLATES().map(function (t) {
      return { key: plainText(t.key), name: plainText(t.name), body: plainText(t.body) };
    }),
    kind: plainText(reportKind_(me)),
    custom: plainText(reportCustom_(me)),
  };
}

/**
 * 日報の中身を渡せる形にする。apiReportParts とキューの reportDraft が使う。
 *
 * @param {object} p reportParts_
 * @returns {object}
 */
function reportPartsPlain_(p) {
  return {
    today: p.today.map(function (x) {
      return { kind: plainText(x.kind), number: plainId(x.number), title: plainText(x.title) };
    }),
    tomorrow: p.tomorrow.map(function (x) {
      return { number: plainId(x.number), title: plainText(x.title), due: plainText(x.due) };
    }),
    troubles: p.troubles.map(function (x) {
      return { number: plainId(x.number), title: plainText(x.title) };
    }),
    done: p.done.map(function (x) {
      return { number: plainId(x.number), title: plainText(x.title) };
    }),
    doneText: plainText(p.doneText),
    date: plainText(p.date),
    name: plainText(p.name),
  };
}

/**
 * 日報を写したことを覚える (Web App API)。本人のぶんだけ。次の日報の「片付けたもの」は
 * これより後に片付けたものだけになる。
 *
 * @returns {{at: number}}
 */
function apiReportCopied() {
  return { at: plainNumber(reportMarkSent_(currentEmail_(), new Date())) };
}

/**
 * 日報の形を選ぶ (Web App API)。本人のぶんだけ。
 *
 * @param {string} kind
 * @returns {{kind: string}}
 */
function apiSetReportKind(kind) {
  var me = currentEmail_();
  return { kind: plainText(reportSetKind_(me, kind)) };
}

/**
 * 自分の日報の形を書く (Web App API)。本人のぶんだけ。2000字まで。
 * 中身があれば選んだ形も「自分の形」にし、いま選んでいる形を返す。
 *
 * @param {string} text
 * @returns {{custom: string, kind: string}}
 */
function apiSetReportCustom(text) {
  var me = currentEmail_();
  var custom = reportSetCustom_(me, text);
  return { custom: plainText(custom), kind: plainText(reportKind_(me)) };
}

/**
 * 横断検索の一覧 (Web App API)。題名・番号・状態だけ。画面が手元で絞る。
 *
 * @returns {Array<{kind: string, number: number, key: string, title: string, state: string, archived: boolean}>}
 */
function apiSearchIndex() {
  return searchIndex_().map(function (x) {
    return { kind: plainText(x.kind), number: plainId(x.number), key: plainText(x.key),
      title: plainText(x.title), state: plainText(x.state), archived: !!x.archived };
  });
}
