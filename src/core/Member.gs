/**
 * 誰が誰の工数を見てよいか。
 *
 * 全員が全員の数字を見られると、監視されている感が出て、正直な実績が
 * 入らなくなる。入らない数字は集計しても意味がない。
 *
 * 既定は自分のぶんだけ。上長として登録されている人は、その下の人の
 * ぶんも見られる。関係は members シートで持つ。
 */

/**
 * 上下関係を登録する。
 *
 * 名簿そのものは持たない。この道具に名前が出た人のうち、上下関係が
 * ある人だけを書く。
 *
 * @param {string} email その人
 * @param {string} manager 上長。空にすると関係を外す
 * @param {string} [note] 覚え書き
 * @returns {object} members 行
 */
function memberSet(email, manager) {
  var who = String(email || '').replace(/^\s+|\s+$/g, '');
  var boss = String(manager || '').replace(/^\s+|\s+$/g, '');

  if (!/^[^\s,@]+@[^\s,@]+$/.test(who)) {
    throw new Error('メールアドレスの形になっていません: ' + email);
  }
  if (boss && !/^[^\s,@]+@[^\s,@]+$/.test(boss)) {
    throw new Error('メールアドレスの形になっていません: ' + manager);
  }
  if (boss && boss === who) {
    throw new Error('自分を自分の上長にはできません');
  }

  // 輪ができると、配下をたどるのが終わらない
  if (boss && memberChainHas_(boss, who)) {
    throw new Error('上下が輪になります: ' + who + ' と ' + boss);
  }

  var patch = { manager: boss, updatedAt: new Date() };

  if (dbFindOne('members', 'email', who)) {
    dbUpdate('members', 'email', who, patch);
  } else {
    dbAppend('members', {
      email: who, manager: boss, note: '', updatedAt: new Date(),
    });
  }
  return dbFindOne('members', 'email', who);
}

/**
 * その人の上長をたどった先に、相手が居るかを見る。
 *
 * @param {string} email
 * @param {string} target
 * @returns {boolean}
 */
function memberChainHas_(email, target) {
  var seen = {};
  var cur = String(email || '');

  while (cur && !seen[cur]) {
    if (cur === String(target)) return true;

    seen[cur] = true;
    var row = dbFindOne('members', 'email', cur);
    cur = row ? String(row.manager || '') : '';
  }
  return false;
}

/**
 * 上下関係の一覧を返す。
 *
 * @returns {object[]}
 */
function memberList() {
  var rows = dbReadAll('members');
  rows.sort(function (a, b) { return String(a.email) < String(b.email) ? -1 : 1; });
  return rows;
}

/**
 * その人の配下を返す。下の下も含む。
 *
 * @param {string} email
 * @returns {string[]}
 */
function memberSubordinates(email) {
  var boss = String(email || '');
  if (!boss) return [];

  var rows = dbReadAll('members');
  var seen = {};
  var out = [];
  var queue = [boss];

  seen[boss] = true;

  while (queue.length) {
    var cur = queue.shift();

    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].manager) !== cur) continue;

      var who = String(rows[i].email);
      if (seen[who]) continue;

      seen[who] = true;
      out.push(who);
      queue.push(who);
    }
  }
  return out;
}

/**
 * 見てよい人の一覧を返す。
 *
 * 自分は必ず入る。上長として登録されていれば、その下も入る。
 *
 * @param {string} viewer
 * @returns {string[]}
 */
function memberVisibleTo(viewer) {
  var me = String(viewer || '');
  if (!me) return [];

  return [me].concat(memberSubordinates(me));
}

/**
 * その人の数字を見てよいかを返す。
 *
 * @param {string} viewer
 * @param {string} target
 * @returns {boolean}
 */
function memberCanSee(viewer, target) {
  return memberVisibleTo(viewer).indexOf(String(target)) >= 0;
}
