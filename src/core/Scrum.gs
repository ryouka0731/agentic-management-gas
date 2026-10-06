/**
 * エージェンティックスクラム。ai-scrum-gas から取り入れた。
 *
 * **既定はオフ** (Settings.gs の scrumEnabled)。操作の入口ではすべて
 * scrumAssertEnabled_ を呼ぶ。
 *
 * ai-scrum-gas では Drive の scrum/ にある CSV が本体で、手元の Claude Code が
 * 直に読み書きしていた。この道具は台帳が本体なので、スプリント・障害物・履歴は
 * 台帳の表に置き、手元からはコマンドキューの命令で触る。PBI は「やること」
 * そのもので、スプリント・ポイント・受入基準の列を足して表す (Issue.gs)。
 */

/**
 * スプリントを日付の字にそろえる。空はそのまま空。
 *
 * 台帳は日付の字を Date で返すので、字でも Date でも受ける。
 *
 * @param {*} v
 * @returns {string} 'YYYY-MM-DD' か ''
 */
function scrumDay_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var day = plainDay(v);
  // 形だけでなく暦にあるかも見る。'2026-13-01' を通すと、数えるときに日付を
  // 作れずに投げ、スプリントのタブがずっと開けなくなる
  if (!day || !scrumRealDay_(day)) throw new Error('日付は YYYY-MM-DD の形で入れてください: ' + v);
  return day;
}

/**
 * 'YYYY-MM-DD' が暦にある日か。'2026-02-30' のように繰り上がるものも断る。
 *
 * @param {string} day
 * @returns {boolean}
 */
function scrumRealDay_(day) {
  var d = new Date(day + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().substring(0, 10) === day;
}

/**
 * スプリントの一覧を返す。始まりの早い順 (始まりが空のものは後ろに名前順)。
 *
 * @returns {object[]} sprints 行
 */
function sprintList() {
  scrumAssertEnabled_();
  var rows = dbReadAll('sprints');
  rows.sort(function (a, b) {
    var x = scrumDayOrEmpty_(a.startDate);
    var y = scrumDayOrEmpty_(b.startDate);
    if (x !== y) {
      if (!x) return 1;
      if (!y) return -1;
      return x < y ? -1 : 1;
    }
    return String(a.name) < String(b.name) ? -1 : 1;
  });
  return rows;
}

/**
 * 読めない日付を空として扱う。並べ替えと数えるとき用 (例外にしない)。
 *
 * @param {*} v
 * @returns {string}
 */
function scrumDayOrEmpty_(v) {
  return v ? plainDay(v) : '';
}

/**
 * スプリントを1つ返す。無ければ断る。
 *
 * @param {string} name
 * @returns {object}
 */
function sprintGet(name) {
  scrumAssertEnabled_();
  var row = dbFindOne('sprints', 'name', String(name || ''));
  if (!row) throw new Error('スプリントが見つかりません: ' + name);
  return row;
}

/**
 * 期間を確かめる。終わりが始まりより前なら断る。
 *
 * @param {string} start
 * @param {string} end
 */
function sprintAssertSpan_(start, end) {
  if (start && end && end < start) {
    throw new Error('終わりの日が始まりの日より前になっています');
  }
}

/**
 * スプリントを作る。
 *
 * @param {{name: string, goal?: string, startDate?: string, endDate?: string, notes?: string}} fields
 * @returns {object} 作った行
 */
function sprintCreate(fields) {
  scrumAssertEnabled_();
  var f = fields || {};
  var name = String(f.name || '').replace(/^\s+|\s+$/g, '');
  if (!/^[^\/\\\n\r\t,]{1,40}$/.test(name)) {
    throw new Error('スプリントの名前を入れてください (40字まで、/ \\ と , は使えません)');
  }

  var start = scrumDay_(f.startDate);
  var end = scrumDay_(f.endDate);
  sprintAssertSpan_(start, end);

  // あるか見てから書くので鍵の中で行う。分けると同じ名前が2つ並ぶ
  return dbWithLock_(30000, function () {
    if (dbFindOne('sprints', 'name', name)) throw new Error('そのスプリントは既にあります: ' + name);

    var row = {
      name: name,
      goal: String(f.goal || '').substring(0, 1000),
      startDate: start,
      endDate: end,
      notes: String(f.notes || '').substring(0, 2000),
      createdAt: new Date(),
      createdBy: Session.getActiveUser().getEmail(),
    };
    dbAppend('sprints', row);
    historyRecord_('sprint:' + name, 'create', []);
    return row;
  });
}

/**
 * スプリントのゴール・期間・備考を直す。名前は変えられない (やることが名前で指す)。
 *
 * @param {string} name
 * @param {object} patch
 * @returns {object} 直したあとの行
 */
function sprintUpdate(name, patch) {
  var before = sprintGet(name);
  var p = patch || {};
  var allowed = {};

  if (Object.prototype.hasOwnProperty.call(p, 'goal')) allowed.goal = String(p.goal || '').substring(0, 1000);
  if (Object.prototype.hasOwnProperty.call(p, 'notes')) allowed.notes = String(p.notes || '').substring(0, 2000);
  if (Object.prototype.hasOwnProperty.call(p, 'startDate')) allowed.startDate = scrumDay_(p.startDate);
  if (Object.prototype.hasOwnProperty.call(p, 'endDate')) allowed.endDate = scrumDay_(p.endDate);

  sprintAssertSpan_(
    Object.prototype.hasOwnProperty.call(allowed, 'startDate') ? allowed.startDate : scrumDayOrEmpty_(before.startDate),
    Object.prototype.hasOwnProperty.call(allowed, 'endDate') ? allowed.endDate : scrumDayOrEmpty_(before.endDate));

  dbUpdate('sprints', 'name', String(name), allowed);
  historyRecord_('sprint:' + name, 'update', historyDiff_(before, allowed));
  return sprintGet(name);
}

/**
 * 障害物を記録する。
 *
 * @param {{title: string, body?: string, reportedBy?: string, sprint?: string}} fields
 * @returns {object} 記録した行
 */
function impedimentCreate(fields) {
  scrumAssertEnabled_();
  var f = fields || {};
  var title = impedimentTitle_(f.title);

  var sprint = String(f.sprint || '');
  if (sprint) sprintGet(sprint);

  var row = {
    title: title,
    body: String(f.body || '').substring(0, 4000),
    reportedBy: String(f.reportedBy || Session.getActiveUser().getEmail()),
    reportedAt: new Date(),
    state: 'open',
    resolvedAt: '',
    resolution: '',
    sprint: sprint,
    updatedAt: new Date(),
  };
  dbAppendNumbered('impediments', 'number', row);
  historyRecord_('impediment:' + row.number, 'create', []);
  return row;
}

/**
 * 障害物を1つ返す。無ければ断る。
 *
 * @param {number} number
 * @returns {object}
 */
function impedimentGet(number) {
  scrumAssertEnabled_();
  var row = dbFindOne('impediments', 'number', number);
  if (!row) throw new Error('障害物が見つかりません: #' + number);
  return row;
}

/**
 * 障害物の一覧を返す。未解決が先、同じなら新しいものから。
 *
 * @returns {object[]}
 */
function impedimentList() {
  scrumAssertEnabled_();
  var rows = dbReadAll('impediments');
  rows.sort(function (a, b) {
    var x = String(a.state) === 'open' ? 0 : 1;
    var y = String(b.state) === 'open' ? 0 : 1;
    if (x !== y) return x - y;
    return Number(b.number) - Number(a.number);
  });
  return rows;
}

/**
 * 障害物の題名・中身・報告者・スプリントを直す。解決は impedimentResolve で行う。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object}
 */
function impedimentUpdate(number, patch) {
  var before = impedimentGet(number);
  var p = patch || {};
  var allowed = {};

  if (Object.prototype.hasOwnProperty.call(p, 'title')) allowed.title = impedimentTitle_(p.title);
  if (Object.prototype.hasOwnProperty.call(p, 'body')) allowed.body = String(p.body || '').substring(0, 4000);
  if (Object.prototype.hasOwnProperty.call(p, 'reportedBy')) allowed.reportedBy = String(p.reportedBy || '');
  if (Object.prototype.hasOwnProperty.call(p, 'sprint')) {
    allowed.sprint = String(p.sprint || '');
    if (allowed.sprint) sprintGet(allowed.sprint);
  }
  allowed.updatedAt = new Date();

  dbUpdate('impediments', 'number', number, allowed);
  historyRecord_('impediment:' + number, 'update', historyDiff_(before, allowed));
  return impedimentGet(number);
}

/**
 * 障害物を解決する。何をして片付けたかは必ず残す (同じ障害物がまた起きたときに辿る)。
 *
 * @param {number} number
 * @param {string} resolution
 * @returns {object}
 */
function impedimentResolve(number, resolution) {
  var before = impedimentGet(number);
  var text = String(resolution || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('解決策を書いてください');
  if (String(before.state) === 'resolved') throw new Error('この障害物は既に解決しています');

  var patch = {
    state: 'resolved', resolvedAt: new Date(), resolution: text.substring(0, 4000), updatedAt: new Date(),
  };
  dbUpdate('impediments', 'number', number, patch);
  historyRecord_('impediment:' + number, 'resolve',
    [{ field: 'resolution', before: String(before.resolution || ''), after: patch.resolution }]);
  return impedimentGet(number);
}

/**
 * 解決を取り消して、未解決に戻す。解決策は消さずに残す (何を試したかの記録になる)。
 *
 * @param {number} number
 * @returns {object}
 */
function impedimentReopen(number) {
  var before = impedimentGet(number);
  if (String(before.state) !== 'resolved') return before;

  dbUpdate('impediments', 'number', number, { state: 'open', resolvedAt: '', updatedAt: new Date() });
  historyRecord_('impediment:' + number, 'reopen', []);
  return impedimentGet(number);
}

/**
 * 障害物にやりとりを書く。
 *
 * @param {number} number
 * @param {string} body
 * @returns {object} 書いた行
 */
function impedimentCommentAdd(number, body) {
  impedimentGet(number);
  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');
  if (text.length > 4000) throw new Error('内容は4000文字までにしてください');

  var row = {
    impedimentNumber: Number(number),
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    editedAt: '',
  };
  dbAppendNumbered('impediment_comments', 'id', row);
  return row;
}

/**
 * 障害物のやりとりを古い順に返す。
 *
 * @param {number} number
 * @returns {object[]}
 */
function impedimentComments(number) {
  scrumAssertEnabled_();
  var rows = dbReadAll('impediment_comments');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].impedimentNumber) === Number(number)) out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return out;
}

/**
 * 履歴に残す値を字にする。長いものは切る (台帳のセルには上限がある)。
 *
 * @param {*} v
 * @returns {string}
 */
function historyText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  // ai-scrum-gas とそろえる: 値1つにつき4000字 (コードポイント) まで。黙って
  // 切ると、どこまでが元の字か分からなくなるので、省いたことと全体の字数を添える
  var chars = Array.from(String(v));
  if (chars.length <= 4000) return chars.join('');
  return chars.slice(0, 4000).join('') + '…（以下省略・全 ' + chars.length + ' 字）';
}

/**
 * 障害物の題名を確かめて整える。
 *
 * 全体を全角の（…）だけで囲んだものは、ひな形の行 (「（障害物タイトル）」など)
 * がそのまま入ったものとして断る (ai-scrum-gas と同じ規則)。
 *
 * @param {*} raw
 * @returns {string}
 */
function impedimentTitle_(raw) {
  var title = String(raw || '').replace(/^\s+|\s+$/g, '');
  if (!title) throw new Error('題名を入れてください');
  if (title.length > 200) throw new Error('題名は200字までにしてください');
  if (/^（[^（）]*）$/.test(title)) {
    throw new Error('全体を（）で囲んだ題名は、ひな形の行と見分けが付かないので使えません: ' + title);
  }
  return title;
}

/**
 * 時刻を持たない日付の欄。履歴では 'YYYY-MM-DD' で比べて残す。
 *
 * 台帳はこれらを Date で返す。ISO の字にして送られた 'YYYY-MM-DD' と比べると、
 * 同じ日でも必ず食い違い、保存のたびに偽の行が増える。そのうえ東京の0時は
 * 前日の15時Zになるので、1日ずれたように見えていた。
 *
 * @returns {Object<string, boolean>}
 */
function HISTORY_DAY_FIELDS_() {
  return { dueDate: true, startDate: true, endDate: true };
}

/**
 * 履歴に残す字。日付の欄は暦日、それ以外は historyText_。
 *
 * @param {string} key
 * @param {*} v
 * @returns {string}
 */
function historyValue_(key, v) {
  if (HISTORY_DAY_FIELDS_()[key]) return plainDay(v);
  return historyText_(v);
}

/**
 * 直す前の行と、直す値から、変わった欄だけを並べる。
 *
 * @param {object} before 直す前の行
 * @param {object} patch 直す値
 * @returns {Array<{field: string, before: string, after: string}>}
 */
function historyDiff_(before, patch) {
  var out = [];
  for (var key in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (key === 'updatedAt') continue;

    var from = historyValue_(key, before[key]);
    var to = historyValue_(key, patch[key]);
    if (from === to) continue;
    out.push({ field: key, before: from, after: to });
  }
  return out;
}

/**
 * 変更の履歴を残す。
 *
 * **残せなくても、本処理は巻き戻さない。** 履歴は番号を振るので混み合うと
 * 投げられる。変更は先に保存されているため、ここで投げると「直したのに失敗と
 * 出る」。知らせ (noticeAdd) と同じ扱いにする。
 *
 * @param {string} target 'issue:N' | 'impediment:N' | 'sprint:名前'
 * @param {string} action 'create' | 'update' | 'close' | 'reopen' | 'resolve' など
 * @param {Array<{field: string, before: string, after: string}>} changes 空なら1行だけ残す
 */
function historyRecord_(target, action, changes) {
  var list = changes && changes.length ? changes : [{ field: '', before: '', after: '' }];
  // update で何も変わっていなければ残さない
  if (action === 'update' && !(changes && changes.length)) return;

  var actor = Session.getActiveUser().getEmail();
  for (var i = 0; i < list.length; i++) {
    try {
      dbAppendNumbered('change_log', 'id', {
        at: new Date(),
        actor: actor,
        target: target,
        action: action,
        field: list[i].field,
        before: list[i].before,
        after: list[i].after,
      });
    } catch (e) {
      Logger.log('履歴を残せませんでした: ' + e.message);
    }
  }
}

/**
 * ある対象の変更の履歴を新しい順に返す。
 *
 * @param {string} target 'issue:N' など
 * @returns {object[]}
 */
function historyOf_(target) {
  var rows = dbReadAll('change_log');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].target) !== String(target)) continue;
    // 前と後は字として読む。数だけの字 ('5') は台帳で数として返ってくる。
    // 切るのは書くときだけ (読むときに切ると、省略の印まで数えて二重に切る)
    rows[i].before = rows[i].before == null ? '' : String(rows[i].before);
    rows[i].after = rows[i].after == null ? '' : String(rows[i].after);
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(b.id) - Number(a.id); });
  return out;
}
