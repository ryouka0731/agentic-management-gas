/**
 * Google ToDo リストとの同期。オプション機能。
 *
 * この機能だけは Apps Script の拡張サービス (Tasks) を要る。エディタの
 * 「サービス +」から Tasks を足していない環境では、この道具の他の機能に
 * 影響を与えずに、ただ使えないだけになるようにしてある。
 *
 * 同期するのは「自分が担当で、まだ終わっていないやること」だけ。
 * 他人のぶんまで自分の ToDo に流し込むと、自分の予定が読めなくなる。
 */

/**
 * 同期先のリストを覚えておく名前。
 *
 * 人ごとに違う ToDo に入れるため、利用者ごとの設定に置く。
 *
 * @returns {string}
 */
function TASKS_LIST_KEY() {
  return 'GOOGLE_TASKS_LIST_ID';
}

/**
 * 拡張サービスが足されているかを見る。
 *
 * @returns {boolean}
 */
function tasksAvailable() {
  try {
    return typeof Tasks !== 'undefined' && !!Tasks.Tasklists;
  } catch (e) {
    return false;
  }
}

/**
 * 使えないときに投げる。
 */
function tasksAssertAvailable_() {
  if (tasksAvailable()) return;

  throw new Error(
    'Google ToDo との同期は使えません。' +
    'Apps Script エディタの「サービス +」から Tasks を追加してください'
  );
}

/**
 * 同期先に選んでいるリストの id を返す。
 *
 * @returns {string} 選んでいなければ空文字
 */
function tasksChosenList() {
  return String(
    PropertiesService.getUserProperties().getProperty(TASKS_LIST_KEY()) || '');
}

/**
 * 同期先のリストを選ぶ。
 *
 * @param {string} listId
 * @returns {string}
 */
function tasksChooseList(listId) {
  tasksAssertAvailable_();

  var lists = tasksLists();
  var ok = false;

  for (var i = 0; i < lists.length; i++) {
    if (String(lists[i].id) === String(listId)) ok = true;
  }
  if (!ok) throw new Error('そのリストは見つかりません: ' + listId);

  PropertiesService.getUserProperties().setProperty(TASKS_LIST_KEY(), listId);
  return listId;
}

/**
 * 自分の ToDo リストの一覧を返す。
 *
 * @returns {Array<{id:string, title:string}>}
 */
function tasksLists() {
  tasksAssertAvailable_();

  var res = Tasks.Tasklists.list();
  var out = [];
  var items = (res && res.items) || [];

  for (var i = 0; i < items.length; i++) {
    out.push({ id: String(items[i].id), title: String(items[i].title || '') });
  }
  return out;
}

/**
 * やることと ToDo の結び付きを返す。
 *
 * 人ごとに違う ToDo を持つため、番号と利用者の組で覚える。
 *
 * @param {number} number
 * @param {string} user
 * @returns {object|null}
 */
function tasksLinkOf(number, user) {
  var rows = dbReadAll('task_links');

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].issueNumber) !== Number(number)) continue;
    if (String(rows[i].user) !== String(user)) continue;
    return rows[i];
  }
  return null;
}

/**
 * ToDo に送る中身を作る。
 *
 * @param {object} issue issues 行
 * @returns {object}
 */
function tasksPayloadOf_(issue) {
  var body = {
    title: '#' + issue.number + ' ' + String(issue.title || ''),
    notes: String(issue.body || ''),
    status: String(issue.state) === 'closed' ? 'completed' : 'needsAction',
  };

  if (issue.dueDate) {
    var day = tasksDueDay_(issue.dueDate);
    if (day) body.due = day + 'T00:00:00.000Z';
  }
  return body;
}

/**
 * 自分の担当ぶんを ToDo に送る。
 *
 * 送るのは自分が担当のものだけ。他人のぶんまで流し込むと、自分の予定が
 * 読めなくなる。
 *
 * @returns {{pushed:number, closed:number, listId:string}}
 */
function tasksSyncMine() {
  tasksAssertAvailable_();

  var listId = tasksChosenList();
  if (!listId) throw new Error('先に入れ先の ToDo リストを選んでください');

  var me = Session.getActiveUser().getEmail();
  var issues = issueList(null);
  var pushed = 0;
  var closed = 0;

  for (var i = 0; i < issues.length; i++) {
    var issue = issues[i];
    if (issueAssignees(issue).indexOf(String(me)) < 0) continue;

    var link = tasksLinkOf(issue.number, me);
    var payload = tasksPayloadOf_(issue);

    if (!link) {
      // 終わっているものを今さら ToDo に足しても仕方がない
      if (String(issue.state) === 'closed') continue;

      var made = Tasks.Tasks.insert(payload, listId);
      dbAppend('task_links', {
        issueNumber: Number(issue.number),
        user: me,
        taskId: String(made.id),
        listId: listId,
        syncedAt: new Date(),
      });
      pushed++;
      continue;
    }

    var remote = tasksFetch_(link.listId, link.taskId);
    // 取れなかっただけのものは今回は飛ばす。消えたと読むと結び付きを捨て、
    // 次の同期で同じ ToDo をもう1つ作る
    if (remote === undefined) continue;
    if (!remote) {
      // 向こうで消えていたら、結び付きも忘れる
      dbDelete('task_links', 'taskId', link.taskId);
      continue;
    }

    // 向こうで終わりにしたなら、こちらも完了にする
    if (String(remote.status) === 'completed' && String(issue.state) !== 'closed') {
      issueClose(issue.number, null);
      closed++;
      continue;
    }

    Tasks.Tasks.patch(payload, link.listId, link.taskId);
    dbUpdate('task_links', 'taskId', link.taskId, { syncedAt: new Date() });
    pushed++;
  }
  return { pushed: pushed, closed: closed, listId: listId };
}

/**
 * 期限を 'yyyy-MM-dd' にする。
 *
 * **ToDo は時刻を捨てて日だけを見る。** Sheets は期限の字を日付として
 * 持ち、東京の0時の Date で返すので、`toISOString` にすると前日の15時に
 * なって1日前の期限で届く。東京の暦日で組む。
 *
 * @param {*} v
 * @returns {string} 読めなければ空
 */
function tasksDueDay_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  if (m) return m[1];

  var d = new Date(v);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * ToDo を1件取ってくる。消えていれば null、取れなければ undefined。
 *
 * **「無い」と「取れなかった」を分ける。** 通信や上限の失敗まで消えたと
 * 読むと、結び付きを捨てて同じ ToDo を作り直してしまう。
 *
 * @param {string} listId
 * @param {string} taskId
 * @returns {object|null|undefined}
 */
function tasksFetch_(listId, taskId) {
  try {
    var got = Tasks.Tasks.get(listId, taskId);
    return (got && got.deleted) ? null : got;
  } catch (e) {
    if (/not\s*found|404/i.test(String(e && e.message))) return null;

    Logger.log('ToDo を取れませんでした: ' + (e && e.message));
    return undefined;
  }
}
