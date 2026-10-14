/**
 * ポイント・レベル・週の上位。
 *
 * 第1段階では入れないと決めていたが、利用者の判断で入れた
 * (docs/superpowers/specs/2026-10-14-task-flow-motivation-design.md)。文献の害が
 * 消えるわけではないので、次の守りを付けている。崩さないこと。
 *
 * - **件数ではなく重さで付ける。** 件数だけだと簡単なものから手を付ける (KC ら 2020)
 * - **上位3人だけ出す。** 職場の順位の下位は晒しになる (Jia ら 2017)
 * - **週ごとに数え直す。** 通算だと古参が居座る
 * - **既定オフ・参加は本人が選ぶ。** 監視に見えるとストレスが増える (Ravid ら 2023)
 * - **数は台帳から数え、保存しない。** 手で書く数は必ずずれる。取り消せば消える
 */

/** @returns {string} */
function GAME_ENABLED_KEY() {
  return 'GAME_ENABLED';
}

/** @returns {string} 参加者のアドレスの JSON 配列を置く鍵 */
function GAME_PLAYERS_KEY() {
  return 'GAME_PLAYERS';
}

/** @returns {boolean} */
function gameEnabled() {
  return PropertiesService.getScriptProperties().getProperty(GAME_ENABLED_KEY()) === 'true';
}

/**
 * 切り替える。管理者かどうかは呼ぶ側で確かめる。オフにしても参加者は消さない。
 *
 * @param {boolean} on
 * @returns {boolean}
 */
function gameSetEnabled_(on) {
  var props = PropertiesService.getScriptProperties();
  if (on) props.setProperty(GAME_ENABLED_KEY(), 'true');
  else props.deleteProperty(GAME_ENABLED_KEY());
  return gameEnabled();
}

/**
 * 順位に参加している人。手で壊されていても空として読む。
 *
 * @returns {string[]}
 */
function gamePlayers() {
  var raw = PropertiesService.getScriptProperties().getProperty(GAME_PLAYERS_KEY());
  if (!raw) return [];
  try {
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(function (x) { return typeof x === 'string' && x; }) : [];
  } catch (e) {
    return [];
  }
}

/**
 * 参加する・やめる。**読む → 足す/外す → 書くを1つの鍵の中で行う。**
 * 分けると、ほぼ同時に押した2人のどちらかが消える。
 *
 * @param {string} email
 * @param {boolean} on
 * @returns {boolean} 切り替えたあと参加しているか
 */
function gameSetPlaying_(email, on) {
  var me = String(email || '');
  if (!me) throw new Error('誰か分かりません');
  return dbWithLock_(30000, function () {
    var list = gamePlayers().filter(function (x) { return x !== me; });
    if (on) list.push(me);
    PropertiesService.getScriptProperties().setProperty(GAME_PLAYERS_KEY(), JSON.stringify(list));
    return list.indexOf(me) >= 0;
  });
}

/**
 * レベル n に必要な合計。上がるほど遠くなる。
 *
 * @param {number} n
 * @returns {number}
 */
function gameLevelAt(n) {
  return 5 * n * (n + 1) / 2;
}

/**
 * 合計からレベルを決める (0 から)。
 *
 * @param {number} total
 * @returns {number}
 */
function gameLevel(total) {
  var n = 0;
  while (gameLevelAt(n + 1) <= total) n++;
  return n;
}

/**
 * このやること全体のポイント (頭数で割る前)。
 *
 * @param {object} row 閉じたやること
 * @param {Object<string, object[]>} kids motivationChildren_()
 * @returns {number}
 */
function gameIssuePoints_(row, kids) {
  var n = 1;
  if (motivationIsHeavy_(row)) n += 2;
  if (motivationWaitedDays_(row) >= CLOSE_LONG_DAYS()) n += 2;

  // 小分けの最後の1つ。いまの子の状態で見る (後で子が開き直されたら消える)
  var sibs = row.parent ? (kids[String(row.parent)] || []) : [];
  if (sibs.length && !row.archivedAt) {
    var last = null;
    for (var i = 0; i < sibs.length; i++) {
      if (String(sibs[i].state) !== 'closed') { last = null; break; }
      if (!last || motivationTime_(sibs[i].closedAt) > motivationTime_(last.closedAt)) last = sibs[i];
    }
    if (last && String(last.number) === String(row.number)) n += 1;
  }
  return n;
}

/**
 * 人ごとのポイント。台帳を表ごとに1回だけ読む。
 *
 * @param {string} from 'YYYY-MM-DD' ('' なら端なし)
 * @param {string} to 'YYYY-MM-DD' ('' なら端なし)
 * @returns {Object<string, number>}
 */
function gamePointsByPerson_(from, to) {
  var pts = {};
  function inSpan(day) { return !!day && (!from || day >= from) && (!to || day <= to); }
  function add(who, n) { if (who) pts[who] = (pts[who] || 0) + n; }

  var issues = dbReadAll('issues');
  var kids = motivationChildren_(issues);
  var closers = motivationClosers_();
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) !== 'closed' || !inSpan(motivationDay_(row.closedAt))) continue;
    var who = motivationCredited_(row, closers);
    if (!who.length) continue;
    // 頭数で割る。割らないと人ごとの合計を足しても全体に戻らない
    var share = gameIssuePoints_(row, kids) / who.length;
    for (var w = 0; w < who.length; w++) add(who[w], share);
  }

  var pulls = dbReadAll('pulls');
  var authors = {};
  for (var p = 0; p < pulls.length; p++) {
    authors[String(pulls[p].number)] = String(pulls[p].author || '');
    if (String(pulls[p].state) === 'merged' && inSpan(motivationDay_(pulls[p].mergedAt))) {
      add(String(pulls[p].author || ''), 2);
    }
  }

  // 同じ依頼には1人1回。最初の確認の日で数える
  var reviews = dbReadAll('reviews');
  var seen = {};
  for (var r = 0; r < reviews.length; r++) {
    var rv = reviews[r];
    var state = String(rv.state);
    if (state !== 'approve' && state !== 'request_changes') continue;
    var reviewer = String(rv.reviewer || '');
    if (!reviewer || reviewer === authors[String(rv.prNumber)]) continue;
    var key = String(rv.prNumber) + '|' + reviewer;
    if (seen[key]) continue;
    seen[key] = true;
    if (inSpan(motivationDay_(rv.at))) add(reviewer, 1);
  }

  for (var k in pts) pts[k] = Math.round(pts[k] * 10) / 10;
  return pts;
}

/**
 * 本人に見せたことのある最高のレベル。**下がらないようにするため**に覚える。
 * 鍵にアドレスを入れる (疑似GASの UserProperties は人で分かれない)。
 *
 * @param {string} email
 * @returns {number}
 */
function gameLevelSeen_(email) {
  var v = Number(PropertiesService.getUserProperties().getProperty('GAME_LEVEL_MAX:' + email));
  return isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * @param {string} email
 * @param {number} n
 */
function gameLevelSeenSet_(email, n) {
  PropertiesService.getUserProperties().setProperty('GAME_LEVEL_MAX:' + email, String(n));
}

/**
 * 本人の合計・今週・レベル・次のレベルまで・参加しているか。**順位は返さない**
 * (上位にいない人に「◯位」を見せると下位の印になる)。
 *
 * @param {string} email
 * @param {Date} now
 * @returns {{total: number, week: number, level: number, nextAt: number, playing: boolean}}
 */
function gameMine_(email, now) {
  var me = String(email || '');
  var span = motivationSpan_(now);
  var total = gamePointsByPerson_('', '')[me] || 0;
  var week = gamePointsByPerson_(span.weekStart, span.today)[me] || 0;
  var level = Math.max(gameLevel(total), gameLevelSeen_(me));
  return { total: total, week: week, level: level, nextAt: gameLevelAt(level + 1),
    playing: gamePlayers().indexOf(me) >= 0 };
}

/**
 * 今週の上位3位まで (参加している人だけ・0点は載らない・同点は同じ順位)。
 *
 * @param {Date} now
 * @returns {Array<{rank: number, email: string, name: string, points: number}>}
 */
function gameTop_(now) {
  var span = motivationSpan_(now);
  var pts = gamePointsByPerson_(span.weekStart, span.today);
  var list = gamePlayers()
    .filter(function (e) { return (pts[e] || 0) > 0; })
    .map(function (e) { return { email: e, points: pts[e] }; })
    .sort(function (a, b) { return b.points - a.points || (a.email < b.email ? -1 : 1); });

  var names = memberNames(list.map(function (x) { return x.email; }));
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var rank = i > 0 && list[i].points === list[i - 1].points ? out[i - 1].rank : i + 1;
    if (rank > 3) break;
    out.push({ rank: rank, email: list[i].email, name: names[list[i].email], points: list[i].points });
  }
  return out;
}
