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
 * **画面から直に呼べない名前にする (末尾 _)。** 参加している全員のアドレスを返す。
 *
 * @returns {string[]}
 */
function gamePlayers_() {
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
    var list = gamePlayers_().filter(function (x) { return x !== me; });
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
  return gamePointsBySpans_([[from, to]])[0];
}

/**
 * いくつかの期間の、人ごとのポイントを**1回の読みで**まとめて数える。
 * 通算と今週を別々に数えると、同じ表を2回ずつ読むことになる。
 *
 * @param {Array<Array<string>>} spans [[from, to], ...] ('' なら端なし)
 * @param {{issues?: object[], closers?: Object<string, string>}} [pre] 既に読んだもの
 * @returns {Array<Object<string, number>>} spans と同じ順
 */
function gamePointsBySpans_(spans, pre) {
  var got = pre || {};
  var all = spans.map(function () { return {}; });
  function add(day, who, n) {
    if (!who || !day) return;
    for (var s = 0; s < spans.length; s++) {
      var from = spans[s][0];
      var to = spans[s][1];
      if ((from && day < from) || (to && day > to)) continue;
      all[s][who] = (all[s][who] || 0) + n;
    }
  }

  var issues = got.issues || dbReadAll('issues');
  var kids = motivationChildren_(issues);
  var closers = got.closers || motivationClosers_();
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) !== 'closed') continue;
    var day = motivationDay_(row.closedAt);
    if (!day) continue;
    var who = motivationCredited_(row, closers);
    if (!who.length) continue;
    // 頭数で割る。割らないと人ごとの合計を足しても全体に戻らない
    var share = gameIssuePoints_(row, kids) / who.length;
    for (var w = 0; w < who.length; w++) add(day, who[w], share);
  }

  var pulls = dbReadAll('pulls');
  var authors = {};
  for (var p = 0; p < pulls.length; p++) {
    authors[String(pulls[p].number)] = String(pulls[p].author || '');
    if (String(pulls[p].state) === 'merged') {
      add(motivationDay_(pulls[p].mergedAt), String(pulls[p].author || ''), 2);
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
    add(motivationDay_(rv.at), reviewer, 1);
  }

  // 浮動小数の端数 (1/3 を3回足して 0.9999999999999999) だけ落とす。0.1 刻みに
  // 丸めると、3人で分けた1点が 0.3 ずつになり合計が 0.9 に減る。レベルの境目や
  // 同点の判定もずれる。見せるときの丸めは画面 (pointWords) で行う
  for (var a = 0; a < all.length; a++) {
    for (var k in all[a]) all[a][k] = Math.round(all[a][k] * 1e9) / 1e9;
  }
  return all;
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
 * 画面がレベル n を見せたことを覚える。**覚えるのは画面が実際に見せたときだけ。**
 * 返事を返した時点で覚えると、画面がその返事を捨てたとき (帯が替わっていた等)
 * 上がったことが一度も見えないまま消える。
 *
 * 実際に届いているレベルより上は覚えない (画面から好きな数を送られても上げない)。
 * 下げもしない。読む → 比べる → 書くは鍵の中で行う (合計を数えるのは鍵の外)。
 *
 * @param {string} email
 * @param {number} n
 * @returns {number} 覚えている最高のレベル
 */
function gameLevelSeenAck_(email, n) {
  var me = String(email || '');
  if (!me) return 0;
  var asked = Math.floor(Number(n));
  var seen0 = gameLevelSeen_(me);
  // 上げられない頼みは、数えも鍵も取らずに今の値を返す
  if (!isFinite(asked) || asked <= 0 || asked <= seen0) return seen0;
  var earned = gameLevel(gamePointsByPerson_('', '')[me] || 0);
  var want = Math.min(asked, earned);
  return dbWithLock_(30000, function () {
    var seen = gameLevelSeen_(me);
    if (isFinite(want) && want > seen) {
      gameLevelSeenSet_(me, want);
      return want;
    }
    return seen;
  });
}

/**
 * 本人の合計・今週・レベル・次のレベルまで・参加しているか。**順位は返さない**
 * (上位にいない人に「◯位」を見せると下位の印になる)。
 *
 * levelFrom はいまのレベルに届いた合計。棒はここから nextAt までの進み具合で描く。
 *
 * @param {string} email
 * @param {Date} now
 * @returns {{total: number, week: number, level: number, levelFrom: number, nextAt: number,
 *   playing: boolean}}
 */
function gameMine_(email, now) {
  var me = String(email || '');
  var span = motivationSpan_(now);
  var both = gamePointsBySpans_([['', ''], [span.weekStart, span.today]]);
  var total = both[0][me] || 0;
  var week = both[1][me] || 0;
  var level = Math.max(gameLevel(total), gameLevelSeen_(me));
  return { total: total, week: week, level: level, levelFrom: gameLevelAt(level),
    nextAt: gameLevelAt(level + 1), playing: gamePlayers_().indexOf(me) >= 0 };
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
  var list = gamePlayers_()
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

/**
 * 完了したやることの、本人の取りぶんと、レベルが上がったか。
 *
 * **ここでは見せたことを覚えない。** 画面が帯に「レベル N になりました」を
 * 実際に出したときに apiGameLevelSeen で覚える。返事を捨てた場合は、次の完了で
 * もう一度知らせる。
 *
 * @param {string} email
 * @param {number} number
 * @param {{issues?: object[], closers?: Object<string, string>}} [pre] 既に読んだもの
 * @returns {{points: number, levelUp: number}} levelUp は上がっていなければ 0
 */
function gameAfterClose_(email, number, pre) {
  var got = { issues: (pre && pre.issues) || dbReadAll('issues'),
    closers: (pre && pre.closers) || motivationClosers_() };
  var row = null;
  for (var i = 0; i < got.issues.length; i++) {
    if (String(got.issues[i].number) === String(number)) row = got.issues[i];
  }
  var points = 0;
  if (row) {
    var who = motivationCredited_(row, got.closers);
    if (who.indexOf(email) >= 0) {
      points = Math.round(gameIssuePoints_(row, motivationChildren_(got.issues)) / who.length * 10) / 10;
    }
  }
  var level = gameLevel(gamePointsBySpans_([['', '']], got)[0][email] || 0);
  return { points: points, levelUp: level > gameLevelSeen_(email) ? level : 0 };
}
