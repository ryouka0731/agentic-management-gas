/**
 * 裏の定期実行で、台帳の読み取りのキャッシュを温める。
 *
 * 台帳の読み取りは CacheService (スクリプトのキャッシュ) に 30分置く (Db.gs の dbReadAll)。スクリプトのキャッシュは
 * 使う人全員で共有なので、だれかが読めば全員の初回の表示が速くなる。ところが 30分だれも開かないと切れ、次に開いた人の
 * 画面は表を1つずつシートから読み直す (1表 0.2〜0.8 秒。開いた直後の api が軒並み遅かった)。
 *
 * **新しいトリガーは足さない。** 1分ごとに回っている processCommandQueue の終わりに相乗りする。温めるのは台帳の
 * 読み取りの覚え (`DB:<表>:<版>`) だけ。Drive の一覧や人ごとに違う覚え (`ACH_PEOPLE:` など) は温めない
 * (トリガーを仕掛けた人に見える物が、ほかの人に見える物とは限らない)。
 *
 * 設計と予算の見積もりは docs/dev/command-queue.md の「キューのついでに台帳の覚えを温める」。
 */

/**
 * 温める表。画面を開いた直後に読む表 (test/e2e で画面を開いて数えた) のうち、次のものを除いた。
 *
 * - `commits`: 記録のたびに文書の数だけ行が増え、いちばん大きくなる。開いた直後に要るのは一部の画面だけ
 * - `change_log`: 変更のたびに増える。履歴の画面で読む
 * - `usage`: 画面を開いているあいだ1分ごとに書かれ、版がすぐ変わる (温めてもすぐ当たらなくなる)
 * - 開いた直後には読まない表 (`pull_patches` / `outbox` / `impediment_comments` / `outcomes_daily` / `goal_items` / `goal_links`)
 *
 * 並びは温める順 (印がそろって切れたときに先に読む)。開いた直後の画面に近いものを前に置く。
 *
 * @returns {string[]}
 */
function CACHE_WARM_TABLES_() {
  return [
    'issues', 'project_items', 'members', 'branches', 'pulls', 'reviews', 'files',
    'tags', 'templates', 'notifications', 'issue_comments', 'sprints', 'impediments',
    'inquiries', 'inquiry_replies', 'announcements', 'announcement_replies',
    'focus_sessions', 'oshi', 'oshi_images', 'goals', 'task_links',
  ];
}

/** 1回の実行で温める表の数の上限。1表 0.2〜0.8 秒なので、3表で数秒に収まる */
function CACHE_WARM_PER_RUN_() {
  return 3;
}

/**
 * 温めた印 (`DBW:<表>`) の長さ (秒)。**本体 (`DB_CACHE_SEC()` = 1800) より短くし、切れる前に温め直す。**
 *
 * 印も本体も、その表を温めた回から数える。1回に温めるのは3表までなので、同じ分に切れる印も3つまでで、
 * ふだんは印が切れた次の回 (1分あと) に温め直せる。差の 300 秒 (= 1分ごとの回の5回ぶん) は、命令があって
 * 温めを飛ばした回・長くなって飛ばした回・トリガーの遅れの余裕。飛ばした回が5回続くと、その間に印が切れた表は
 * 本体も切れ、次に開いた人がシートから読む (前と同じに戻るだけで、壊れはしない)。
 *
 * @returns {number}
 */
function CACHE_WARM_MARK_SEC_() {
  return 1500;
}

/** 1回の実行がここまで掛かっていたら温めない (ms)。命令や1日1回の片付けで長くなった回は、次の回に回す */
function CACHE_WARM_SKIP_AFTER_MS_() {
  return 20000;
}

/** @returns {string} */
function cacheWarmMarkKey_(table) {
  return 'DBW:' + table;
}

/**
 * 印の切れた表を、上限まで温める。processCommandQueue が命令の無い回の終わりに呼ぶ。
 *
 * **投げない。** 温めで落ちても、キューのトリガーは止めない。落ちた表にも印を置き (25分あとにもう一度)、その回は
 * そこで止める (Sheets そのものが落ちているときに、残りの表で同じ失敗を重ねない)。
 *
 * @returns {number} 温めた表の数
 */
function cacheWarmTick_() {
  var warmed = 0;
  try {
    var props = PropertiesService.getScriptProperties();
    // 持ち主向けのスイッチ。スクリプトプロパティ CACHE_WARM_OFF に何か入っていれば温めない
    if (props.getProperty('CACHE_WARM_OFF')) return 0;
  } catch (e) {
    // 読めなければ温める (止める理由が分からない)
  }
  var cache = dbCache_();
  if (!cache) return 0;

  var tables = CACHE_WARM_TABLES_();
  var marks;
  try {
    marks = cache.getAll(tables.map(cacheWarmMarkKey_)) || {};
  } catch (e) {
    Logger.log('温めの印を読めませんでした: ' + e.message);
    return 0;
  }

  var per = CACHE_WARM_PER_RUN_();
  for (var i = 0; i < tables.length && warmed < per; i++) {
    var table = tables[i];
    if (marks[cacheWarmMarkKey_(table)]) continue;
    var ok = true;
    try {
      dbWarm_(table);
    } catch (e) {
      ok = false;
      Logger.log('台帳の覚えを温められませんでした (' + table + '): ' + e.message);
    }
    try {
      cache.put(cacheWarmMarkKey_(table), String(Date.now()), CACHE_WARM_MARK_SEC_());
    } catch (e2) {
      // 印を置けなければ次の回にもう一度読む
    }
    if (!ok) break;
    warmed++;
  }
  return warmed;
}

/**
 * 1回の所要時間を残す (スクリプトプロパティ `QUEUE_LAST_COST`。1日の予算を見積もるため)。
 * 書くのは JSON の1つの値だけで、失敗しても止めない。
 *
 * @param {{ms: number, warmMs: number, warmed: number, ran: number}} cost
 */
function queueCostNote_(cost) {
  try {
    PropertiesService.getScriptProperties().setProperty('QUEUE_LAST_COST', JSON.stringify(cost));
  } catch (e) {
    Logger.log('所要時間を残せませんでした: ' + e.message);
  }
}
