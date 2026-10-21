/**
 * 目標 (OKR・MBO・KPI)。既定はオフ (チームの設定 goals.enabled)。
 *
 * 本人が期ごとに目標と項目を立て、上長に承認してもらう。進み具合は済ませたやることと
 * 入れた数から GoalScore.js が数え、自動の見立てを添える。**評価を決めるのは上長**で、
 * 見立てはその目安でしかない。ポイント (Game.gs) は使わない。
 *
 * 誰が見られるか (docs/dev/permissions.md の「目標」):
 * - 本人
 * - 承認する人: 直属の上長 (members.manager)。上長が登録されていない人は、このアプリの持ち主
 * - 上長の連なり (memberVisibleTo と同じく、上の人は下の人のぶんを見られる)。承認はしない
 * **管理者だというだけでは見せない。** 人に関わる数を本人と上長の連なりの外に出さないため。
 * 探す一覧・最近の動き・使われ方・ポイントにも入れない。
 *
 * アドレスを受ける関数は末尾 `_` (画面から他人として呼ばれないように)。
 */

/** 目標の機能がオンか */
function goalsEnabled_() {
  return prefGet_('goals.enabled') === true;
}

/** オフなら断る。状態を見る apiGoalState だけはオフでも通す */
function goalsAssertEnabled_() {
  if (!goalsEnabled_()) {
    throw new Error('目標の機能はオフです。管理者が設定の「チームの設定」でオンにできます');
  }
}

/** 年度の始まる月 */
function goalFyStartNow_() {
  return prefGet_('goals.fyStart');
}

/**
 * いまの期。
 *
 * @param {Date} [now]
 * @returns {string}
 */
function goalCurrentPeriod_(now) {
  return goalPeriodOf(now || new Date(), prefGet_('goals.period'), goalFyStartNow_()).key;
}

/** 期の形を確かめて返す。空ならいまの期 */
function goalPeriodClean_(period) {
  var key = String(period || '').replace(/^\s+|\s+$/g, '');
  if (!key) return goalCurrentPeriod_();
  if (!goalPeriodParse_(key)) throw new Error('期の形が正しくありません: ' + key);
  return key;
}

/** アドレスを比べる形にする */
function goalLower_(v) {
  return String(v || '').replace(/^\s+|\s+$/g, '').toLowerCase();
}

/**
 * 上下関係を小文字で引ける形にする (1回読んで使い回す)。
 *
 * @returns {{managerOf: Object<string,string>}}
 */
function goalPeople_() {
  var managerOf = {};
  dbReadAll('members').forEach(function (r) {
    var who = goalLower_(r.email);
    if (who) managerOf[who] = goalLower_(r.manager);
  });
  return { managerOf: managerOf };
}

/**
 * その人の目標を承認する人。直属の上長。登録が無ければ持ち主 (本人は除く)。
 *
 * @param {string} who 小文字のアドレス
 * @param {object} people goalPeople_()
 * @returns {string[]}
 */
function goalApprovers_(who, people) {
  var boss = people.managerOf[who] || '';
  if (boss) return [boss];
  return repoOwners_().map(goalLower_).filter(function (o) { return o && o !== who; });
}

/**
 * viewer の下にいる人 (下の下も)。memberSubordinates と同じたどり方を小文字で行う。
 *
 * @param {string} viewer
 * @param {object} people
 * @returns {Object<string, boolean>}
 */
function goalBelow_(viewer, people) {
  var out = {};
  var queue = [viewer];
  var seen = {};
  seen[viewer] = true;
  while (queue.length) {
    var cur = queue.shift();
    for (var who in people.managerOf) {
      if (!Object.prototype.hasOwnProperty.call(people.managerOf, who)) continue;
      if (people.managerOf[who] !== cur || seen[who]) continue;
      seen[who] = true;
      out[who] = true;
      queue.push(who);
    }
  }
  return out;
}

/**
 * その目標を見られるか。本人・承認する人・上長の連なり。
 *
 * @param {string} viewer 小文字
 * @param {string} who 小文字
 * @param {object} people
 * @returns {boolean}
 */
function goalCanView_(viewer, who, people) {
  if (!viewer) return false;
  if (viewer === who) return true;
  if (goalApprovers_(who, people).indexOf(viewer) >= 0) return true;
  return !!goalBelow_(viewer, people)[who];
}

/** 承認・差し戻し・評価ができるか (承認する人だけ。本人はできない) */
function goalCanDecide_(viewer, who, people) {
  return !!viewer && viewer !== who && goalApprovers_(who, people).indexOf(viewer) >= 0;
}

/** 目標の行。無ければ断る */
function goalGet_(id) {
  var row = dbFindOne('goals', 'id', id);
  if (!row) throw new Error('目標が見つかりません: #' + id);
  return row;
}

/** 項目の行。無ければ断る */
function goalItemGet_(id) {
  var row = dbFindOne('goal_items', 'id', id);
  if (!row) throw new Error('目標の項目が見つかりません: #' + id);
  return row;
}

/** 本人でなければ断る */
function goalAssertOwn_(goal, me) {
  if (goalLower_(goal.who) !== me) throw new Error('目標を直せるのは、その目標を立てた本人だけです');
}

/** 評価が済んでいたら断る */
function goalAssertOpen_(goal) {
  if (String(goal.status) === 'closed') throw new Error('評価の済んだ目標は直せません');
}

/** 字を整える (前後の空白を落とし、長さで切る) */
function goalTextClean_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/^\s+|\s+$/g, '').substring(0, max);
}

/** 数の欄。空は ''。数でなければ断る */
function goalNumberClean_(v, label) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error('「' + label + '」には0以上の数を入れてください');
  return n;
}

/**
 * 項目の入力を確かめる。
 *
 * @param {object} raw
 * @param {number} order
 * @returns {object} goal_items 行の形 (id は残す)
 */
function goalItemClean_(raw, order) {
  var r = raw || {};
  var title = goalTextClean_(r.title, 200);
  if (!title) throw new Error('項目の名前を書いてください');
  var measure = String(r.measure || '');
  var known = GOAL_MEASURES().some(function (m) { return m.key === measure; });
  if (!known) throw new Error('知らない測り方です: ' + measure);

  var weight = goalNumberClean_(r.weight, '重み');
  if (weight !== '' && weight > 100) throw new Error('「重み」は100までです');
  var target = goalNumberClean_(r.target, '目標の値');
  if ((measure === 'label' || measure === 'number') && !(target > 0)) {
    throw new Error('「' + title + '」の目標の値を入れてください');
  }
  var filter = goalTextClean_(r.filter, 60).replace(/^#+/, '');
  if (measure === 'label' && !filter) throw new Error('「' + title + '」で数えるタグを書いてください');

  return {
    id: r.id, title: title, weight: weight, measure: measure,
    target: measure === 'issues' || measure === 'check' ? '' : target,
    unit: measure === 'number' ? goalTextClean_(r.unit, 20) : '',
    filter: measure === 'label' ? filter : '',
    order: order,
  };
}

/**
 * 目標と項目を保存する。新しく立てるときは id を空にする。
 *
 * - 下書き・差し戻しは何度でも直せる (状態はそのまま)
 * - 承認済みを直すと、もう一度承認を待つ (submitted に戻す。approvedAt は残し、画面が
 *   「承認のあとに直した」と読む)
 * - 承認を待っているあいだと、評価が済んだあとは直せない
 *
 * 項目は並びのとおりに置き直す。id のある項目は直し、無いものは足し、外したものは
 * つないだやることごと消す。**全部を1つの鍵の中で行う** (途中で断られて半分だけ書かれないように)。
 *
 * @param {string} me 小文字のアドレス
 * @param {object} input {id?, period?, kind, title, items: [...]}
 * @returns {{id: number, resubmitted: boolean}}
 */
function goalSave_(me, input) {
  if (!me) throw new Error('誰の目標か分かりません');
  var src = input || {};
  var kind = String(src.kind || '');
  if (!GOAL_KINDS().some(function (k) { return k.key === kind; })) throw new Error('知らない種類です: ' + kind);
  var title = goalTextClean_(src.title, 200);
  if (!title) throw new Error('目標の名前を書いてください');
  var list = Array.isArray(src.items) ? src.items : [];
  if (list.length > 10) throw new Error('項目は10個までです');
  var items = list.map(function (it, i) { return goalItemClean_(it, i); });
  var askedPeriod = src.period;

  var result = dbWithLock_(30000, function () {
    var now = new Date();
    var id = src.id === undefined || src.id === null || src.id === '' ? null : Number(src.id);
    var before = null;
    var status = 'draft';

    if (id !== null) {
      before = goalGet_(id);
      goalAssertOwn_(before, me);
      goalAssertOpen_(before);
      status = String(before.status);
      if (status === 'submitted') {
        throw new Error('承認を待っているあいだは直せません。承認されるか差し戻されてから直してください');
      }
      var next = status === 'approved' ? goalNext('approved', 'edit') : status;
      var patch = { kind: kind, title: title, status: next, updatedAt: now };
      // 期を変えられるのは承認の前だけ (承認したものの期が黙って動かないように)
      if (status !== 'approved' && askedPeriod) patch.period = goalPeriodClean_(askedPeriod);
      if (next === 'submitted') patch.submittedAt = now;
      dbUpdate('goals', 'id', id, patch);
      status = next;
    } else {
      var row = dbAppendNumbered('goals', 'id', {
        who: me, period: goalPeriodClean_(askedPeriod), kind: kind, title: title, status: 'draft',
        submittedAt: '', approver: '', approvedAt: '', managerNote: '', selfReview: '', autoScore: '',
        finalGrade: '', gradedBy: '', gradedAt: '', createdAt: now, updatedAt: now,
      });
      id = Number(row.id);
    }

    goalItemsReplace_(id, items);
    return { id: id, resubmitted: !!before && String(before.status) === 'approved' };
  });

  if (result.resubmitted) goalNotifySubmitted_(goalGet_(result.id), true);
  return result;
}

/**
 * 項目を並びのとおりに置き直す。鍵を持った状態で呼ばれる。
 *
 * 入れた数・付けた印は、測り方が変わらない限り残す (直しただけで今の値が消えないように)。
 *
 * @param {number} goalId
 * @param {object[]} items goalItemClean_ の返り
 */
function goalItemsReplace_(goalId, items) {
  var existing = {};
  dbReadAll('goal_items').forEach(function (r) {
    if (Number(r.goalId) === Number(goalId)) existing[String(r.id)] = r;
  });

  var kept = {};
  var fresh = [];
  items.forEach(function (it) {
    var old = it.id !== undefined && it.id !== null && it.id !== '' ? existing[String(it.id)] : null;
    var row = {
      goalId: goalId, title: it.title, weight: it.weight, measure: it.measure, target: it.target,
      unit: it.unit, filter: it.filter, order: it.order,
    };
    if (old) {
      kept[String(old.id)] = true;
      var same = String(old.measure) === it.measure;
      row.actual = same && it.measure === 'number' ? old.actual : '';
      row.checked = same && it.measure === 'check' ? goalBool_(old.checked) : '';
      dbUpdate('goal_items', 'id', old.id, row);
      // 測り方を「つないだやること」から変えたら、つないだものは外す (数えないのに残すと迷う)
      if (!same && String(old.measure) === 'issues') dbDelete('goal_links', 'itemId', old.id);
    } else {
      row.actual = '';
      row.checked = it.measure === 'check' ? false : '';
      fresh.push(row);
    }
  });

  for (var key in existing) {
    if (!Object.prototype.hasOwnProperty.call(existing, key) || kept[key]) continue;
    dbDelete('goal_links', 'itemId', key);
    dbDelete('goal_items', 'id', key);
  }
  if (fresh.length) dbAppendNumberedMany('goal_items', 'id', fresh);
}

/**
 * 下書き・差し戻しの目標を消す。項目とつないだやることの結び付きも消す (やること自体は消さない)。
 *
 * @param {string} me
 * @param {number} id
 * @returns {boolean}
 */
function goalDelete_(me, id) {
  return dbWithLock_(30000, function () {
    var goal = goalGet_(id);
    goalAssertOwn_(goal, me);
    var st = String(goal.status);
    if (st !== 'draft' && st !== 'returned') {
      throw new Error('消せるのは下書きか差し戻された目標だけです。承認を頼んだあとの目標は残ります');
    }
    dbReadAll('goal_items').forEach(function (r) {
      if (Number(r.goalId) !== Number(id)) return;
      dbDelete('goal_links', 'itemId', r.id);
      dbDelete('goal_items', 'id', r.id);
    });
    // 目標の行は最後に消す (途中で落ちても、もう一度消せるように)
    dbDelete('goals', 'id', id);
    return true;
  });
}

/** その目標の項目 (並び順) */
function goalItemsOf_(goalId, all) {
  return (all || dbReadAll('goal_items')).filter(function (r) {
    return Number(r.goalId) === Number(goalId);
  }).sort(function (a, b) { return Number(a.order) - Number(b.order) || Number(a.id) - Number(b.id); });
}

/**
 * 承認を頼む。下書きか差し戻しからだけ。
 *
 * @param {string} me
 * @param {number} id
 * @returns {object} goals 行
 */
function goalSubmit_(me, id) {
  var people = goalPeople_();
  dbWithLock_(30000, function () {
    var goal = goalGet_(id);
    goalAssertOwn_(goal, me);
    var next = goalNext(String(goal.status), 'submit');
    if (!next) throw new Error('承認を頼めるのは、下書きか差し戻された目標だけです');
    var items = goalItemsOf_(id);
    if (!items.length) throw new Error('項目を1つ以上足してから頼んでください');
    if (String(goal.kind) === 'mbo') {
      var sum = items.reduce(function (a, r) { return a + (Number(r.weight) || 0); }, 0);
      if (Math.abs(sum - 100) > 0.001) {
        throw new Error('MBO の重みは合わせて100にしてください (いまは ' + (Math.round(sum * 100) / 100) + ')');
      }
    }
    if (!goalApprovers_(me, people).length) {
      throw new Error('承認する人がいません。設定の「人」で上長を登録してください');
    }
    dbUpdate('goals', 'id', id, { status: next, submittedAt: new Date(), updatedAt: new Date() });
  });
  var row = goalGet_(id);
  goalNotifySubmitted_(row, false);
  return row;
}

/**
 * 承認する・差し戻す。承認する人だけ。差し戻すときは直してほしいことを書く。
 *
 * @param {string} me
 * @param {number} id
 * @param {string} decision 'approve' | 'return'
 * @param {string} note
 * @returns {object} goals 行
 */
function goalDecide_(me, id, decision, note) {
  if (decision !== 'approve' && decision !== 'return') throw new Error('「承認する」か「差し戻す」を選んでください');
  var text = goalTextClean_(note, 2000);
  if (decision === 'return' && !text) throw new Error('差し戻すときは、直してほしいことを書いてください');
  var people = goalPeople_();
  dbWithLock_(30000, function () {
    var goal = goalGet_(id);
    if (!goalCanDecide_(me, goalLower_(goal.who), people)) {
      throw new Error('承認と差し戻しは、その人の上長だけが行えます');
    }
    var next = goalNext(String(goal.status), decision);
    if (!next) throw new Error('承認を待っている目標ではありません');
    var now = new Date();
    var patch = { status: next, managerNote: text, updatedAt: now };
    if (decision === 'approve') {
      patch.approver = me;
      patch.approvedAt = now;
    }
    dbUpdate('goals', 'id', id, patch);
  });
  var row = goalGet_(id);
  goalNotifyDecided_(row, decision);
  return row;
}

/**
 * 項目の今の値を入れる (数を入れる項目の値・できた印)。承認のあとでも直せ、承認し直しは要らない。
 *
 * @param {string} me
 * @param {number} itemId
 * @param {{actual?: number, checked?: boolean}} input
 * @returns {object} goal_items 行
 */
function goalProgressInput_(me, itemId, input) {
  var v = input || {};
  return dbWithLock_(30000, function () {
    var item = goalItemGet_(itemId);
    var goal = goalGet_(item.goalId);
    goalAssertOwn_(goal, me);
    goalAssertOpen_(goal);
    var measure = String(item.measure);
    var patch;
    if (measure === 'number') {
      var n = Number(v.actual);
      if (v.actual === '' || v.actual === null || v.actual === undefined || !isFinite(n)) {
        throw new Error('今の値には数を入れてください');
      }
      patch = { actual: n };
    } else if (measure === 'check') {
      if (typeof v.checked !== 'boolean') throw new Error('できたかどうかを選んでください');
      patch = { checked: v.checked };
    } else {
      throw new Error('この項目は、済ませたやることから自動で数えます。値は入れられません');
    }
    dbUpdate('goal_items', 'id', itemId, patch);
    return goalItemGet_(itemId);
  });
}

/**
 * 項目にやることをつなぐ。「つないだやることの完了」で測る項目だけ。
 * **あるか見てから書くので、鍵の中で行う** (同じ結び付きが2つできないように)。
 *
 * @param {string} me
 * @param {number} itemId
 * @param {number} issueNumber
 * @returns {object} goal_links 行
 */
function goalLink_(me, itemId, issueNumber) {
  var n = Number(issueNumber);
  return dbWithLock_(30000, function () {
    var item = goalItemGet_(itemId);
    var goal = goalGet_(item.goalId);
    goalAssertOwn_(goal, me);
    goalAssertOpen_(goal);
    if (String(item.measure) !== 'issues') {
      throw new Error('やることをつなげるのは「つないだやることの完了」で測る項目だけです');
    }
    var issue = issueGet(n);
    if (issue.archivedAt) throw new Error('捨てたものに入っているやることはつなげません: #' + n);
    var found = dbReadAll('goal_links').filter(function (r) {
      return Number(r.itemId) === Number(itemId) && Number(r.issueNumber) === n;
    })[0];
    if (found) return found;
    return dbAppendNumbered('goal_links', 'id', { itemId: Number(itemId), issueNumber: n });
  });
}

/**
 * 結び付きを外す。やること自体は変えない。
 *
 * @param {string} me
 * @param {number} itemId
 * @param {number} issueNumber
 * @returns {number} 外した数
 */
function goalUnlink_(me, itemId, issueNumber) {
  var n = Number(issueNumber);
  return dbWithLock_(30000, function () {
    var item = goalItemGet_(itemId);
    var goal = goalGet_(item.goalId);
    goalAssertOwn_(goal, me);
    goalAssertOpen_(goal);
    var hits = dbReadAll('goal_links').filter(function (r) {
      return Number(r.itemId) === Number(itemId) && Number(r.issueNumber) === n;
    });
    hits.forEach(function (r) { dbDelete('goal_links', 'id', r.id); });
    return hits.length;
  });
}

/**
 * 振り返りを書く。承認済みの目標だけ (評価の前)。
 *
 * @param {string} me
 * @param {number} id
 * @param {string} text
 * @returns {object} goals 行
 */
function goalReview_(me, id, text) {
  var body = goalTextClean_(text, 4000);
  dbWithLock_(30000, function () {
    var goal = goalGet_(id);
    goalAssertOwn_(goal, me);
    goalAssertOpen_(goal);
    if (String(goal.status) !== 'approved') throw new Error('振り返りは、承認された目標に書いてください');
    dbUpdate('goals', 'id', id, { selfReview: body, updatedAt: new Date() });
  });
  return goalGet_(id);
}

/**
 * 期末の評価を付ける。承認する人だけ。ひとことを添える。評価済みになり、もう動かない。
 * そのときの自動の見立ても残す (あとで数え方が変わっても、評価したときの目安が読めるように)。
 *
 * @param {string} me
 * @param {number} id
 * @param {string} grade GOAL_GRADES() の段
 * @param {string} note
 * @returns {object} goals 行
 */
function goalGrade_(me, id, grade, note) {
  var g = String(grade || '');
  if (!GOAL_GRADES().some(function (x) { return x.grade === g; })) {
    throw new Error('評価は ' + GOAL_GRADES().map(function (x) { return x.grade; }).join(' / ') + ' から選んでください');
  }
  var text = goalTextClean_(note, 2000);
  if (!text) throw new Error('評価には、ひとことを添えてください');
  var people = goalPeople_();
  var goal = goalGet_(id);
  if (!goalCanDecide_(me, goalLower_(goal.who), people)) {
    throw new Error('評価を付けられるのは、その人の上長だけです');
  }
  var auto = goalPlainList_([goal], me, people)[0].auto;
  dbWithLock_(30000, function () {
    var now = goalGet_(id);
    var next = goalNext(String(now.status), 'grade');
    if (!next) throw new Error('評価を付けられるのは、承認された目標だけです');
    dbUpdate('goals', 'id', id, {
      status: next, finalGrade: g, managerNote: text, gradedBy: me, gradedAt: new Date(),
      autoScore: auto.text, updatedAt: new Date(),
    });
  });
  var row = goalGet_(id);
  goalNotifyGraded_(row);
  return row;
}

/**
 * 項目ごとの事実を集める。表は1回ずつ読む (目標ごとに読み直さない)。
 *
 * @param {object[]} goals
 * @returns {{items: object[], linksByItem: Object<string, object[]>, issues: object[], byNumber: Object<string, object>}}
 */
function goalFactsBase_(goals) {
  var issues = dbReadAll('issues');
  var byNumber = {};
  issues.forEach(function (r) { byNumber[String(r.number)] = r; });
  var linksByItem = {};
  dbReadAll('goal_links').forEach(function (r) {
    var k = String(r.itemId);
    (linksByItem[k] = linksByItem[k] || []).push(r);
  });
  return { items: goals.length ? dbReadAll('goal_items') : [], linksByItem: linksByItem, issues: issues, byNumber: byNumber };
}

/**
 * 期の中に本人が完了した、タグの付いたやることの数。
 *
 * 担当に本人が入っているものを数える (担当が何人いても1件。工数を割るのとは違い、数は件数で見る)。
 * 捨てたものは数えない。タグは大文字小文字を見ない。
 */
function goalLabelCount_(issues, who, tag, range) {
  if (!range) return 0;
  var want = String(tag || '').toLowerCase();
  var s = range.start.getTime();
  var e = range.end.getTime();
  return issues.filter(function (r) {
    if (r.archivedAt || String(r.state) !== 'closed') return false;
    var at = goalTime_(r.closedAt);
    if (at === null || at < s || at >= e) return false;
    if (!issueAssignees(r).some(function (a) { return goalLower_(a) === who; })) return false;
    return tagsOf(r.labels).some(function (t) { return t.toLowerCase() === want; });
  }).length;
}

/**
 * 目標の行を画面に渡せる形にする (項目・進み具合・見立て・押せるもの)。
 *
 * @param {object[]} goals goals 行
 * @param {string} me 見る人 (小文字)
 * @param {object} [people] goalPeople_()
 * @param {Date} [now]
 * @returns {object[]}
 */
function goalPlainList_(goals, me, people, now) {
  var ppl = people || goalPeople_();
  var when = now || new Date();
  var base = goalFactsBase_(goals);
  var fy = goalFyStartNow_();
  var names = memberNames(goals.map(function (g) { return goalLower_(g.who); }));
  var statuses = GOAL_STATUSES();
  var measures = {};
  GOAL_MEASURES().forEach(function (m) { measures[m.key] = m.label; });
  var kinds = {};
  GOAL_KINDS().forEach(function (k) { kinds[k.key] = k.label; });

  return goals.map(function (g) {
    var who = goalLower_(g.who);
    var range = goalPeriodRange(String(g.period), fy);
    var items = goalItemsOf_(g.id, base.items);
    var facts = {};
    items.forEach(function (it) {
      var links = base.linksByItem[String(it.id)] || [];
      facts[String(it.id)] = {
        linked: links.map(function (l) { return base.byNumber[String(l.issueNumber)]; }).filter(Boolean),
        counted: String(it.measure) === 'label' ? goalLabelCount_(base.issues, who, it.filter, range) : 0,
        end: range ? range.end : null,
      };
    });
    var kind = String(g.kind);
    var prog = goalProgress(kind, items, facts);
    var auto = goalAutoScore(kind, prog.progress);
    var status = String(g.status);
    var own = who === me;
    var decide = goalCanDecide_(me, who, ppl);
    var open = status !== 'closed';

    return {
      id: plainNumber(g.id),
      who: plainText(who),
      whoName: plainText(names[who] || who),
      mine: own,
      period: plainText(g.period),
      periodLabel: plainText(goalPeriodLabel(String(g.period))),
      kind: plainText(kind),
      kindLabel: plainText(kinds[kind] || kind),
      title: plainText(g.title),
      status: plainText(status),
      statusLabel: plainText(statuses[status] || status),
      // 承認したあとに本人が直し、もう一度承認を待っている
      changedAfterApproval: status === 'submitted' && !!plainDate(g.approvedAt),
      submittedAt: plainDate(g.submittedAt),
      approver: plainText(g.approver),
      approvedAt: plainDate(g.approvedAt),
      managerNote: plainText(g.managerNote),
      selfReview: plainText(g.selfReview),
      autoScoreAtGrade: plainText(g.autoScore),
      finalGrade: plainText(g.finalGrade),
      gradedBy: plainText(g.gradedBy),
      gradedAt: plainDate(g.gradedAt),
      createdAt: plainDate(g.createdAt),
      updatedAt: plainDate(g.updatedAt),
      progress: Math.round(prog.progress * 1000) / 1000,
      percent: Math.round(prog.progress * 100),
      auto: {
        kind: plainText(auto.kind), score: auto.score === '' ? '' : Number(auto.score),
        percent: plainNumber(auto.percent), grade: plainText(auto.grade), text: plainText(auto.text),
        note: plainText(auto.note),
      },
      pace: (function () {
        var p = goalPace(prog.progress, range, when);
        return { key: plainText(p.key), label: plainText(p.label), elapsed: Math.round(p.elapsed * 100) / 100 };
      })(),
      items: items.map(function (it, i) {
        var p = prog.items[i];
        var links = (base.linksByItem[String(it.id)] || []).map(function (l) {
          var issue = base.byNumber[String(l.issueNumber)];
          return {
            number: plainNumber(l.issueNumber),
            title: plainText(issue ? issue.title : ''),
            state: plainText(issue ? issue.state : 'gone'),
          };
        });
        return {
          id: plainNumber(it.id),
          title: plainText(it.title),
          weight: plainNumber(it.weight),
          share: Math.round(p.share * 100),
          measure: plainText(it.measure),
          measureLabel: plainText(measures[String(it.measure)] || it.measure),
          target: plainNumber(it.target),
          unit: plainText(it.unit),
          actual: plainNumber(it.actual),
          checked: goalBool_(it.checked),
          filter: plainText(it.filter),
          progress: Math.round(p.progress * 1000) / 1000,
          percent: Math.round(p.progress * 100),
          done: plainNumber(p.done),
          total: plainNumber(p.total),
          remainingText: plainText(goalRemainingText(it, p)),
          links: links,
        };
      }),
      canEdit: own && (status === 'draft' || status === 'returned' || status === 'approved'),
      canDelete: own && (status === 'draft' || status === 'returned'),
      canSubmit: own && !!goalNext(status, 'submit'),
      canInput: own && open,
      canReview: own && status === 'approved',
      canDecide: decide && status === 'submitted',
      canGrade: decide && status === 'approved',
    };
  });
}

/**
 * 本人の目標 (その期)。
 *
 * @param {string} me
 * @param {string} period
 * @returns {object[]}
 */
function goalMine_(me, period) {
  var rows = dbReadAll('goals').filter(function (g) {
    return goalLower_(g.who) === me && String(g.period) === period;
  }).sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return goalPlainList_(rows, me);
}

/**
 * 見る人が見られる、ほかの人の目標 (その期) と、承認を待っているもの (期を問わない)。
 *
 * 並びは名前 → 状態 → 番号。**進み具合や見立てで並べない** (順位にしない)。
 *
 * @param {string} me
 * @param {string} period
 * @returns {{goals: object[], pending: object[]}}
 */
function goalTeam_(me, period) {
  var people = goalPeople_();
  var all = dbReadAll('goals').filter(function (g) {
    var who = goalLower_(g.who);
    return who !== me && goalCanView_(me, who, people);
  });
  var inPeriod = all.filter(function (g) { return String(g.period) === period; });
  var waiting = all.filter(function (g) {
    return String(g.status) === 'submitted' && goalCanDecide_(me, goalLower_(g.who), people);
  });
  var order = ['submitted', 'approved', 'returned', 'draft', 'closed'];
  function sort(list) {
    return list.sort(function (a, b) {
      if (a.whoName !== b.whoName) return a.whoName < b.whoName ? -1 : 1;
      var d = order.indexOf(a.status) - order.indexOf(b.status);
      return d || a.id - b.id;
    });
  }
  return {
    goals: sort(goalPlainList_(inPeriod, me, people)),
    pending: sort(goalPlainList_(waiting, me, people)),
  };
}

/** 見られなければ断る。見られるなら目標の行を返す */
function goalViewable_(me, id) {
  var goal = goalGet_(id);
  if (!goalCanView_(me, goalLower_(goal.who), goalPeople_())) throw new Error('この目標は見られません');
  return goal;
}

/**
 * 期末のまとめ (写して貼る字)。見られる人だけ。
 *
 * @param {string} me
 * @param {number} id
 * @returns {{title: string, text: string}}
 */
function goalReport_(me, id) {
  var goal = goalViewable_(me, id);
  var g = goalPlainList_([goal], me)[0];
  var lines = [];
  lines.push('# 目標のまとめ: ' + g.title);
  lines.push('');
  lines.push('- 期: ' + g.periodLabel);
  lines.push('- 種類: ' + g.kindLabel);
  lines.push('- 本人: ' + g.whoName);
  lines.push('- 状態: ' + g.statusLabel);
  lines.push('- 進み具合: ' + g.percent + '%');
  lines.push('- 自動の見立て: ' + g.auto.text + (g.auto.grade && g.kind !== 'okr' ? ' (' + g.auto.grade + ')' : '') +
    ' — ' + g.auto.note);
  lines.push('');
  lines.push('## 項目');
  lines.push('');
  g.items.forEach(function (it) {
    var detail = it.measureLabel;
    if (it.measure === 'issues') detail += ' (' + it.total + '件のうち' + it.done + '件)';
    if (it.measure === 'label') detail += ' (#' + it.filter + ' ' + it.done + ' / ' + it.target + '件)';
    if (it.measure === 'number') detail += ' (' + it.actual + ' / ' + it.target + (it.unit ? ' ' + it.unit : '') + ')';
    if (it.measure === 'check') detail += it.checked ? ' (できた)' : ' (まだ)';
    lines.push('- ' + it.title + ' — ' + it.percent + '% / 重み ' + it.share + '% / ' + detail);
  });
  lines.push('');
  lines.push('## 振り返り (本人)');
  lines.push('');
  lines.push(g.selfReview || '(まだ書いていません)');
  lines.push('');
  lines.push('## 上長の評価');
  lines.push('');
  lines.push('- 評価: ' + (g.finalGrade || '(まだ付いていません)'));
  if (g.autoScoreAtGrade) lines.push('- 評価したときの自動の見立て: ' + g.autoScoreAtGrade);
  if (g.managerNote) lines.push('- ひとこと: ' + g.managerNote);
  lines.push('');
  lines.push('自動の見立ては目安です。評価を決めるのは上長です。');
  return { title: g.title, text: lines.join('\n') };
}

/**
 * やることにつながっている目標の項目 (見られるものだけ) と、つなげる先 (本人の、評価前の項目)。
 *
 * @param {string} me
 * @param {number} number
 * @returns {{linked: object[], choices: object[]}}
 */
function goalIssueLinks_(me, number) {
  var n = Number(number);
  issueGet(n);
  var people = goalPeople_();
  var goals = {};
  dbReadAll('goals').forEach(function (g) { goals[String(g.id)] = g; });
  var items = dbReadAll('goal_items');
  var itemById = {};
  items.forEach(function (it) { itemById[String(it.id)] = it; });

  var linked = [];
  var linkedIds = {};
  dbReadAll('goal_links').forEach(function (l) {
    if (Number(l.issueNumber) !== n) return;
    var it = itemById[String(l.itemId)];
    var g = it ? goals[String(it.goalId)] : null;
    if (!g || !goalCanView_(me, goalLower_(g.who), people)) return;
    linkedIds[String(it.id)] = true;
    linked.push({
      itemId: plainNumber(it.id), goalId: plainNumber(g.id), goalTitle: plainText(g.title),
      itemTitle: plainText(it.title), periodLabel: plainText(goalPeriodLabel(String(g.period))),
      mine: goalLower_(g.who) === me && String(g.status) !== 'closed',
    });
  });

  var choices = items.filter(function (it) {
    var g = goals[String(it.goalId)];
    return g && goalLower_(g.who) === me && String(g.status) !== 'closed' &&
      String(it.measure) === 'issues' && !linkedIds[String(it.id)];
  }).map(function (it) {
    var g = goals[String(it.goalId)];
    return {
      itemId: plainNumber(it.id),
      label: plainText(goalPeriodLabel(String(g.period)) + ' / ' + g.title + ' / ' + it.title),
    };
  });
  return { linked: linked, choices: choices };
}

/**
 * つなげられる本人のやること (担当に本人が入っているもの。捨てたものは除く)。新しい順に200件まで。
 *
 * @param {string} me
 * @returns {object[]}
 */
function goalLinkable_(me) {
  return dbReadAll('issues').filter(function (r) {
    if (r.archivedAt) return false;
    return issueAssignees(r).some(function (a) { return goalLower_(a) === me; });
  }).sort(function (a, b) { return Number(b.number) - Number(a.number); }).slice(0, 200).map(function (r) {
    return { number: plainNumber(r.number), title: plainText(r.title), state: plainText(r.state) };
  });
}

// ===== 知らせ (本処理を巻き戻さない。notify / noticeAdd は例外を握る) =====

/** 承認を頼んだ (直したので頼み直した) ことを、承認する人に知らせる */
function goalNotifySubmitted_(goal, changed) {
  try {
    var who = goalLower_(goal.who);
    var to = goalApprovers_(who, goalPeople_());
    var name = memberNames([who])[who] || who;
    notifyGoalSubmitted(goal, to, name, changed);
  } catch (e) {
    Logger.log('目標の知らせを送れませんでした: ' + e.message);
  }
}

/** 承認した・差し戻したことを本人に知らせる */
function goalNotifyDecided_(goal, decision) {
  try {
    notifyGoalDecided(goal, decision);
  } catch (e) {
    Logger.log('目標の知らせを送れませんでした: ' + e.message);
  }
}

/** 評価が付いたことを本人に知らせる */
function goalNotifyGraded_(goal) {
  try {
    notifyGoalGraded(goal);
  } catch (e) {
    Logger.log('目標の知らせを送れませんでした: ' + e.message);
  }
}
