/**
 * スプリントの見え方 (バーンダウン・ベロシティ・ロードマップ・要約) と用語の説明。
 * GAS に頼らない純関数。ai-scrum-gas の pure_view_sprint / pure_summary /
 * pure_glossary から取り入れた。
 *
 * **数は台帳から数える。** ai-scrum-gas では velocity.csv や sprint_backlog.md に
 * 人やエージェントが数を書いていた。手で書いた数は必ずずれるので、やることの
 * ポイントと完了日から求める。
 */

/**
 * 日を 'YYYY-MM-DD' にする。Date は東京の暦日で読む (この道具の時刻帯)。
 *
 * @param {*} v
 * @returns {string} 読めなければ ''
 */
function scrumDayOf_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return new Date(v.getTime() + 9 * 3600 * 1000).toISOString().substring(0, 10);
  }
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  if (!m) return '';
  // 台帳は人が手で書き換えられる。暦に無い日 ('2026-13-01') は読めないものと
  // して扱う。通すと次の日を作るところで投げ、タブ全体が開けなくなる
  var d = new Date(m[1] + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().substring(0, 10) === m[1] ? m[1] : '';
}

/**
 * やることのポイント。空や読めないものは数えない (null)。
 *
 * @param {object} issue
 * @returns {number|null}
 */
function scrumPointsOf_(issue) {
  var raw = issue && issue.points;
  if (raw === '' || raw === null || raw === undefined) return null;
  var n = Number(raw);
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * そのスプリントに入っている、数える対象のやること。捨てたものは除く。
 *
 * @param {string} name
 * @param {object[]} issues
 * @returns {object[]}
 */
function scrumIssuesIn_(name, issues) {
  var out = [];
  for (var i = 0; i < (issues || []).length; i++) {
    var it = issues[i];
    if (String(it.sprint || '') !== String(name)) continue;
    if (it.archivedAt) continue;
    if (scrumPointsOf_(it) === null) continue;
    out.push(it);
  }
  return out;
}

/**
 * スプリントの終わりの日までに完了したか。終わりの日が無ければ、完了していれば数える。
 *
 * @param {object} issue
 * @param {string} end 'YYYY-MM-DD' か ''
 * @returns {boolean}
 */
function scrumDoneBy_(issue, end) {
  if (String(issue.state) !== 'closed') return false;
  var closed = scrumDayOf_(issue.closedAt);
  if (!end) return true;
  return !!closed && closed <= end;
}

/**
 * スプリントごとの計画・終えた・持ち越しのポイント。
 *
 * @param {object[]} sprints sprints 行 (並べたい順)
 * @param {object[]} issues issues 行
 * @param {string|Date} today
 * @returns {Array<{name, goal, startDate, endDate, planned, completed, carriedOver}>}
 *   carriedOver はスプリントが終わっていなければ ''
 */
function scrumVelocity(sprints, issues, today) {
  var now = scrumDayOf_(today);
  var out = [];

  for (var s = 0; s < (sprints || []).length; s++) {
    var sp = sprints[s];
    var end = scrumDayOf_(sp.endDate);
    var members = scrumIssuesIn_(sp.name, issues);
    var planned = 0;
    var completed = 0;

    for (var i = 0; i < members.length; i++) {
      var p = scrumPointsOf_(members[i]);
      planned += p;
      if (scrumDoneBy_(members[i], end)) completed += p;
    }

    var ended = !!end && !!now && now > end;
    out.push({
      name: String(sp.name),
      goal: String(sp.goal || ''),
      startDate: scrumDayOf_(sp.startDate),
      endDate: end,
      planned: planned,
      completed: completed,
      carriedOver: ended ? planned - completed : '',
    });
  }
  return out;
}

/**
 * 終えたスプリントの、終えたポイントの平均 (直近3つまで)。次に積める量の目安。
 *
 * @param {object[]} velocity scrumVelocity の結果
 * @returns {number|string} 終えたスプリントが無ければ ''
 */
function scrumAverageVelocity(velocity) {
  var done = [];
  for (var i = 0; i < (velocity || []).length; i++) {
    if (velocity[i].carriedOver !== '') done.push(velocity[i].completed);
  }
  if (!done.length) return '';
  var last = done.slice(-3);
  var sum = 0;
  for (var k = 0; k < last.length; k++) sum += last[k];
  return Math.round((sum / last.length) * 10) / 10;
}

/**
 * 'YYYY-MM-DD' の次の日。
 *
 * @param {string} day
 * @returns {string}
 */
function scrumNextDay_(day) {
  var d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().substring(0, 10);
}

/**
 * バーンダウン。期間の毎日について、その日の終わりにまだ完了していないポイント。
 *
 * @param {object} sprint sprints 行
 * @param {object[]} issues issues 行
 * @param {string|Date} today
 * @returns {{days: string[], remaining: Array<number|null>, ideal: number[], notice: string}}
 *   まだ来ていない日の remaining は null
 */
function scrumBurndown(sprint, issues, today) {
  var start = scrumDayOf_(sprint && sprint.startDate);
  var end = scrumDayOf_(sprint && sprint.endDate);
  if (!start || !end || end < start) {
    return { days: [], remaining: [], ideal: [], notice: 'スプリントの期間 (始まりと終わり) が決まっていません。' };
  }

  var days = [];
  for (var d = start; d <= end && days.length < 400; d = scrumNextDay_(d)) days.push(d);

  var members = scrumIssuesIn_(sprint.name, issues);
  var total = 0;
  for (var i = 0; i < members.length; i++) total += scrumPointsOf_(members[i]);

  var now = scrumDayOf_(today);
  var remaining = [];
  var ideal = [];
  for (var k = 0; k < days.length; k++) {
    ideal.push(days.length > 1 ? Math.round(total * (1 - k / (days.length - 1)) * 100) / 100 : 0);
    if (now && days[k] > now) {
      remaining.push(null);
      continue;
    }
    var left = 0;
    for (var m = 0; m < members.length; m++) {
      if (!scrumDoneBy_(members[m], days[k])) left += scrumPointsOf_(members[m]);
    }
    remaining.push(left);
  }
  return { days: days, remaining: remaining, ideal: ideal, notice: '' };
}

/**
 * ロードマップ。どのやることがどのスプリントに入っているか。
 *
 * @param {object[]} sprints sprints 行 (並べたい順)
 * @param {object[]} issues issues 行
 * @returns {{sprints: string[], rows: Array<{number, title, col, state}>,
 *   unknown: object[], unplanned: number, notice: string}}
 */
function scrumRoadmap(sprints, issues) {
  var names = [];
  var at = {};
  for (var s = 0; s < (sprints || []).length; s++) {
    at[String(sprints[s].name)] = names.length;
    names.push(String(sprints[s].name));
  }

  var rows = [];
  var unknown = [];
  var unplanned = 0;
  for (var i = 0; i < (issues || []).length; i++) {
    var it = issues[i];
    if (it.archivedAt) continue;
    var name = String(it.sprint || '');
    if (!name) { unplanned++; continue; }

    var one = { number: Number(it.number), title: String(it.title || ''), state: String(it.state || '') };
    if (!Object.prototype.hasOwnProperty.call(at, name)) {
      one.sprint = name;
      unknown.push(one);
      continue;
    }
    one.col = at[name];
    rows.push(one);
  }
  rows.sort(function (a, b) { return a.col - b.col || a.number - b.number; });

  return {
    sprints: names,
    rows: rows,
    unknown: unknown,
    unplanned: unplanned,
    notice: names.length ? '' : 'スプリントがまだありません。スプリントを作ると、ここに帯が出ます。',
  };
}

/**
 * 今のスプリント。今日を含むものを先に、無ければ空。
 *
 * @param {object[]} sprints
 * @param {string} now 'YYYY-MM-DD'
 * @returns {object|null}
 */
function scrumCurrentSprint_(sprints, now) {
  for (var i = 0; i < (sprints || []).length; i++) {
    var start = scrumDayOf_(sprints[i].startDate);
    var end = scrumDayOf_(sprints[i].endDate);
    if (start && end && start <= now && now <= end) return sprints[i];
  }
  return null;
}

/**
 * スプリントのタブの上に出す要約。
 *
 * @param {object[]} sprints
 * @param {object[]} issues
 * @param {object[]} impediments
 * @param {string|Date} today
 * @returns {{current, goal, planned, completed, openImpediments, average}}
 */
function scrumSummary(sprints, issues, impediments, today) {
  var now = scrumDayOf_(today);
  var velocity = scrumVelocity(sprints, issues, today);
  var cur = scrumCurrentSprint_(sprints, now);
  var open = 0;
  for (var i = 0; i < (impediments || []).length; i++) {
    if (String(impediments[i].state) === 'open') open++;
  }

  var out = {
    current: '', goal: '', planned: 0, completed: 0,
    openImpediments: open, average: scrumAverageVelocity(velocity),
  };
  if (!cur) return out;

  for (var k = 0; k < velocity.length; k++) {
    if (velocity[k].name !== String(cur.name)) continue;
    out.current = velocity[k].name;
    out.goal = velocity[k].goal;
    out.planned = velocity[k].planned;
    // 今のスプリントは、今日までに完了したぶんを数える
    out.completed = 0;
    var members = scrumIssuesIn_(cur.name, issues);
    for (var m = 0; m < members.length; m++) {
      if (scrumDoneBy_(members[m], now)) out.completed += scrumPointsOf_(members[m]);
    }
  }
  return out;
}

/**
 * スクラムの用語と説明。同じ言葉の説明が画面ごとに違うと、それ自体が混乱の
 * もとになるため、ここを唯一の源泉にする。この道具の言葉 (やること・進捗ボード
 * の列・優先度) に合わせてある。
 *
 * @returns {Object<string, string>}
 */
function SCRUM_GLOSSARY() {
  return {
    'ストーリーポイント':
      'そのやること1つの相対的な大きさ。時間ではない。ベロシティは、終えたストーリーポイントの合計。',
    'ベロシティ':
      'チームが1スプリントで終えたストーリーポイントの合計。次のスプリントで積める量の目安になる。',
    'バーンダウン':
      'スプリントの残りが日を追ってどう減ったかの記録。線が下がりきればスプリントの目標に届く。',
    'ロードマップ':
      'どのやることを、どのスプリントで扱う予定かの一覧。',
    'スプリント':
      '区切られた作業の期間。この単位で計画し、終わりに成果を確かめる。',
    'スプリントゴール':
      'そのスプリントで目指すこと。やることを積むときの判断の拠り所にする。',
    'プロダクトゴール':
      'このプロダクトが目指す先。スプリントゴールはここに向かう一歩になる。',
    '完了の定義':
      'どのやることにも当てはまる「終わった」と言える条件。受入基準とは別に、全体で共有する。',
    '障害物':
      'チームの進みを妨げているもの。気づいた人が書き出し、取り除けたら解決済みにする。',
    '受入基準':
      'そのやることが「終わった」と言える条件。1行に1つ書く。',
    '持ち越し':
      'スプリントの終わりまでに終えられず、次に回したストーリーポイント。',
  };
}

/**
 * 画面の見出し語 → 用語集のキー。見出しの字を変えても説明が消えないように別名で繋ぐ。
 *
 * @returns {Object<string, string>}
 */
function SCRUM_GLOSSARY_ALIASES() {
  return { 'ポイント': 'ストーリーポイント' };
}

/**
 * 用語の説明を返す。別名も解く。知らない語なら空文字。
 *
 * @param {string} term
 * @returns {string}
 */
function scrumGlossaryOf(term) {
  var key = String(term == null ? '' : term).replace(/^\s+|\s+$/g, '');
  if (!key) return '';
  var aliases = SCRUM_GLOSSARY_ALIASES();
  if (Object.prototype.hasOwnProperty.call(aliases, key)) key = aliases[key];
  var all = SCRUM_GLOSSARY();
  return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : '';
}
