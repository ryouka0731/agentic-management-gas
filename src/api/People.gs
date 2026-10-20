/*
 * 画面の API: 人 (上下関係・名前・担当になりうる人)、工数の集計、使われ方、Google ToDo。
 *
 * 人に関わる数は、本人と部下のぶんだけ見せる (memberVisibleTo)。
 */

/**
 * Google ToDo との同期が使えるかを返す (Web App API)。
 *
 * @returns {{available: boolean, listId: string, lists: object[]}}
 */
function apiTasksState() {
  if (!tasksAvailable()) return { available: false, listId: '', lists: [] };

  var lists = [];
  try {
    lists = tasksLists();
  } catch (e) {
    return { available: false, listId: '', lists: [] };
  }
  return { available: true, listId: tasksChosenList(), lists: lists };
}

/**
 * 同期先の ToDo リストを選ぶ (Web App API)。
 *
 * @param {string} listId
 * @returns {string}
 */
function apiTasksChooseList(listId) {
  return tasksChooseList(listId);
}

/**
 * 自分の担当ぶんを ToDo と同期する (Web App API)。
 *
 * @returns {object}
 */
function apiTasksSync() {
  return tasksSyncMine();
}

/**
 * 工数を区切りごとに足し上げて返す (Web App API)。
 *
 * 足し上げはサーバ側で行い、**見てよい人のぶんしか返さない**。画面側で
 * 絞る形にすると、全員のぶんが端末まで届いてしまい、絞っているのは
 * 見た目だけになる。
 *
 * @param {string} unit 'week' | 'month' | 'quarter'
 * @param {string} basis 'due' | 'closed' | 'start'
 * @param {string} who 空なら見てよい人ぜんぶ
 * @returns {object}
 */
function apiTallyEffort(unit, basis, who) {
  var me = currentEmail_();
  var allowed = memberVisibleTo(me);

  // 担当が付いていないぶんは誰の数字でもない。全員に見せる
  allowed.push('(担当なし)');

  var target = String(who || '');
  if (target && allowed.indexOf(target) < 0) {
    throw new Error('その人の集計は見られません');
  }

  var rows = issueList(null);
  var plain = [];
  var steps = staleSteps_();

  for (var i = 0; i < rows.length; i++) {
    var one = issueToPlain_(rows[i], steps);
    var who = one.assignees;

    if (!who.length) {
      plain.push(one);
      continue;
    }

    // 2人で持つ仕事は、頭数で割って数える。それぞれに全部を足すと、
    // 人ごとの合計を足しても全体の合計に戻らなくなる
    for (var w = 0; w < who.length; w++) {
      var part = {};
      for (var k in one) {
        if (Object.prototype.hasOwnProperty.call(one, k)) part[k] = one[k];
      }
      part.assignee = who[w];
      part.plannedHours = (Number(one.plannedHours) || 0) / who.length;
      part.actualHours = (Number(one.actualHours) || 0) / who.length;
      plain.push(part);
    }
  }

  // 全体の合計は誰でも見てよい。人ごとの内訳だけを絞る
  var res = tallyEffort(plain, { unit: unit, basis: basis });

  res.people = res.people.filter(function (p) {
    if (allowed.indexOf(p.who) < 0) return false;
    return !target || p.who === target;
  });

  for (var p = 0; p < res.periods.length; p++) {
    var kept = {};

    for (var name in res.periods[p].byPerson) {
      if (!Object.prototype.hasOwnProperty.call(res.periods[p].byPerson, name)) {
        continue;
      }
      if (allowed.indexOf(name) < 0) continue;
      if (target && name !== target) continue;

      kept[name] = res.periods[p].byPerson[name];
    }
    res.periods[p].byPerson = kept;
  }

  res.me = me;
  res.canSee = allowed;
  res.hidden = res.total.count - res.people.reduce(function (n, one) {
    return n + one.total.count;
  }, 0);
  return res;
}

/**
 * 集計で見てよい人を返す (Web App API)。
 *
 * @returns {{me:string, canSee:string[], isManager:boolean, canEdit:boolean}}
 */
function apiTallyScope() {
  var me = currentEmail_();
  var allowed = memberVisibleTo(me);

  return {
    me: me,
    canSee: allowed,
    isManager: allowed.length > 1,
    canEdit: repoIsAdmin_(me),
  };
}

/**
 * 上下関係の一覧を返す (Web App API)。
 *
 * @returns {Array<{email:string, manager:string}>}
 */
function apiMemberList() {
  var rows = memberList();
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    out.push({
      email: String(rows[i].email),
      manager: String(rows[i].manager || ''),
      name: String(rows[i].name || ''),
    });
  }
  return out;
}

/**
 * 知っている人の名前をまとめて返す (Web App API)。
 *
 * @returns {Object<string,string>} メールアドレス → 名前
 */
function apiPeopleNames() {
  return memberNames(apiKnownPeople());
}

/**
 * 名前を覚えさせる (Web App API)。
 *
 * 自分の名前は自分で決められる。他人の名前は管理者だけが変えられる。
 *
 * @param {string} email
 * @param {string} name
 * @returns {object}
 */
function apiPeopleSetName(email, name) {
  var me = currentEmail_();
  var who = String(email || '');

  if (who !== me && !repoIsAdmin_(me)) {
    throw new Error('他人の名前を変えられるのは、このアプリの管理者だけです');
  }

  var row = memberSetName(who, name);
  return { email: String(row.email), name: String(row.name || '') };
}

/**
 * 上下関係を登録する (Web App API)。
 *
 * 誰でも書き換えられると、自分を上長にして他人の数字を覗ける。
 * このアプリの管理者 (持ち主と、入れ物のフォルダを編集できる人) だけが触れる。
 *
 * @param {string} email
 * @param {string} manager
 * @returns {object}
 */
function apiMemberSet(email, manager, name) {
  repoAssertAdmin_('上下関係を変えること');

  var row = memberSet(email, manager, name);
  return {
    email: String(row.email),
    manager: String(row.manager || ''),
    name: String(row.name || ''),
  };
}

/**
 * 使われ方を記録する (Web App API)。
 *
 * 日・場所・回数に加えて、押した人も残す (人ごとに見られるようにするため)。
 * 押した人は画面から受け取らず、サーバ側で決める (名乗りを詐称できるため)。
 * 人ごとの数を見られるのは本人と部下だけ (apiUsageSummary)。
 * 押した順番と時刻は残さない。
 *
 * @param {Array<{kind:string, target:string, count:number}>} rows
 * @returns {number}
 */
function apiUsageRecord(rows) {
  return usageRecord(rows || []);
}

/**
 * 使われ方をまとめて返す (Web App API)。
 *
 * @param {number} days
 * @param {string} [who] 空なら全員ぶん
 * @returns {object}
 */
function apiUsageSummary(days, who) {
  /*
   * 人ごとの数は、本人と部下のぶんだけ (工数の集計と同じ)。誰が何をどれだけ
   * 使ったかは個人の働き方そのものなので、上下関係の外には見せない。場所
   * ごとの合計は個人が写らないので、誰が見ても全員ぶん。
   */
  var me = currentEmail_();
  var allowed = memberVisibleTo(me);
  var target = String(who || '');
  if (target && allowed.indexOf(target) < 0) {
    throw new Error('その人の使われ方は見られません');
  }

  var res = usageSummary(days, null, target);
  res.byUser = res.byUser.filter(function (u) { return allowed.indexOf(u.who) >= 0; });
  return res;
}

/**
 * CSV にするための、日・場所・人ごとの数を返す (Web App API)。
 *
 * 本人と部下のぶんだけを返す。ほかの人の行は入れない (usageRows)。
 *
 * @param {number} days
 * @param {string} [who] 空なら全員ぶん
 * @returns {{from:string, to:string, who:string, rows:object[]}}
 */
function apiUsageRows(days, who) {
  var me = currentEmail_();
  var allowed = memberVisibleTo(me);
  var target = String(who || '');
  if (target && allowed.indexOf(target) < 0) {
    throw new Error('その人の使われ方は見られません');
  }
  return usageRows(days, null, target, allowed);
}

/**
 * 担当者になりうる人を返す (Web App API)。
 *
 * これまでに記録や確認をした人を集める。名簿を別に持たない。
 *
 * @returns {string[]}
 */
function apiKnownPeople() {
  var seen = {};
  var out = [];

  function add(email) {
    var v = String(email || '');
    if (!v || seen[v]) return;
    seen[v] = true;
    out.push(v);
  }

  add(currentEmail_());

  var commits = dbReadAll('commits');
  for (var i = 0; i < commits.length; i++) add(commits[i].author);

  var reviews = dbReadAll('reviews');
  for (var r = 0; r < reviews.length; r++) add(reviews[r].reviewer);

  var issues = dbReadAll('issues');
  for (var q = 0; q < issues.length; q++) {
    var who = issueAssignees(issues[q]);
    for (var w = 0; w < who.length; w++) add(who[w]);
  }

  // 名前や上下関係を登録した人は、まだ何もしていなくても名簿に入る
  var known = dbReadAll('members');
  for (var k = 0; k < known.length; k++) add(known[k].email);

  var talked = dbReadAll('issue_comments');
  for (var t = 0; t < talked.length; t++) add(talked[t].by);

  // 報告の場で名前を呼べるように、報告と返信を書いた人も名簿に入れる
  var reports = dbReadAll('inquiries');
  for (var n = 0; n < reports.length; n++) add(reports[n].by);

  var replies = dbReadAll('inquiry_replies');
  for (var m = 0; m < replies.length; m++) add(replies[m].by);

  out.sort();
  return out;
}
