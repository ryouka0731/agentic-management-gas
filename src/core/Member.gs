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
 * @param {string} [name] 画面に出す名前。省略すると今のまま
 * @returns {object} members 行
 */
function memberSet(email, manager, name) {
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
  if (name !== undefined && name !== null) {
    patch.name = String(name).replace(/^\s+|\s+$/g, '');
  }

  if (dbFindOne('members', 'email', who)) {
    dbUpdate('members', 'email', who, patch);
  } else {
    dbAppend('members', {
      email: who, manager: boss, note: '', updatedAt: new Date(),
      name: patch.name || '',
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

/**
 * 画面に出す名前を決める。
 *
 * メールアドレスは目で追いにくく、長い並びの中では全部同じに見える。
 * 登録された名前があればそれを、無ければアドレスの手前を使う。
 *
 * @param {string} email
 * @returns {string}
 */
function memberNameOf(email) {
  var who = String(email || '');
  if (!who) return '';

  var row = dbFindOne('members', 'email', who);
  var name = row ? String(row.name || '') : '';

  return name || who.split('@')[0];
}

/**
 * 名前を覚えさせる。上下関係は変えない。
 *
 * @param {string} email
 * @param {string} name
 * @returns {object} members 行
 */
function memberSetName(email, name) {
  var row = dbFindOne('members', 'email', email);
  return memberSet(email, row ? row.manager : '', name);
}

/**
 * 知っている人の名前をまとめて返す。
 *
 * 1人ずつ引くと、一覧を描くたびに何度も探すことになる。
 *
 * @param {string[]} emails
 * @returns {Object<string,string>}
 */
function memberNames(emails) {
  var rows = dbReadAll('members');
  var named = {};

  for (var i = 0; i < rows.length; i++) {
    var one = String(rows[i].name || '');
    if (one) named[String(rows[i].email)] = one;
  }

  var out = {};
  for (var e = 0; e < (emails || []).length; e++) {
    var who = String(emails[e] || '');
    if (!who) continue;

    out[who] = named[who] || who.split('@')[0];
  }
  return out;
}
