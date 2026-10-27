/**
 * テーブル定義。ヘッダ行のカラム名と順序を決める唯一の情報源。
 *
 * トップレベルのconstではなく関数として公開する。GASはファイルを
 * ファイル名順に読み込むため、トップレベル初期化は順序依存になる。
 *
 * @returns {Object<string, string[]>}
 */
function DB_SCHEMA() {
  // 列を増やすときは必ず**末尾に足す**。途中に挿入すると、既にシートに
  // 書かれている行を新しい順序で読むことになり、値が1つずつずれる。
  // dueDate を createdAt の前に入れて実際に壊した (作成日時が空になり、
  // 工程表が全行を読み飛ばした)。順序は test/schema.test.js で固定している
  return {
    // 末尾の4つは文書の見直しの期日 (FileReview.gs)。reviewDue は 'YYYY-MM-DD'、reviewNoticeDays は何日前に作るか (空は30)、
    // reviewIssuedFor は作った期日 (**二度作らない印**)。列の意味は docs/dev/ledger-schema.md
    files: ['fileId', 'path', 'type', 'registeredAt', 'registeredBy', 'baseSha',
      'reviewDue', 'reviewAssignee', 'reviewNoticeDays', 'reviewIssuedFor'],
    commits: ['sha', 'parentSha', 'branch', 'fileId', 'blobSha', 'author', 'message', 'timestamp'],
    branches: ['name', 'headSha', 'baseSha', 'state', 'workingFolderId', 'createdBy', 'createdAt'],
    pulls: ['number', 'title', 'body', 'sourceBranch', 'targetBranch', 'state', 'author', 'createdAt', 'mergedAt', 'reviewers', 'targetFiles', 'staleReviewId', 'mergedBy', 'mergeReason'],
    reviews: ['prNumber', 'reviewer', 'state', 'body', 'at', 'id', 'editedAt'],
    task_links: ['issueNumber', 'user', 'taskId', 'listId', 'syncedAt'],
    issue_comments: ['id', 'issueNumber', 'body', 'by', 'at', 'editedAt'],
    usage: ['day', 'kind', 'target', 'count', 'user'],
    templates: ['name', 'body', 'builtin', 'createdBy', 'createdAt'],
    members: ['email', 'manager', 'note', 'updatedAt', 'name'],
    tags: ['name', 'color', 'builtin', 'createdBy', 'createdAt'],
    notifications: ['id', 'to', 'kind', 'title', 'body', 'link', 'at', 'readAt'],
    inquiries: ['number', 'kind', 'body', 'by', 'at', 'state', 'context',
      'answer', 'answeredAt', 'title', 'closedBy', 'shots', 'issueNumber'],
    inquiry_replies: ['id', 'inquiryNumber', 'body', 'by', 'at', 'editedAt', 'shots'],
    issues: ['number', 'title', 'body', 'state', 'assignee', 'labels', 'linkedFileIds', 'linkedPr', 'createdAt', 'closedAt', 'dueDate', 'startDate', 'parent', 'estimate', 'plannedHours', 'actualHours', 'archivedAt', 'updatedAt', 'priority',
      // エージェンティックスクラム (既定はオフ)。やることを PBI として扱う
      'sprint', 'points', 'acceptance'],
    // コードの変更を、確認依頼に添える証跡として持つ。版を持つ文書では
    // ないので files には入れない (コピーも編集も書き戻しも無い)
    pull_patches: ['prNumber', 'id', 'path', 'blobSha', 'added', 'removed', 'at', 'by'],
    // 手元の Claude に頼むことの置き場。**この道具から手元へ向かう唯一の
    // 経路である。** 外部 API は使わないので、Drive の同期に乗せる
    outbox: ['id', 'verb', 'args', 'note', 'state', 'prNumber',
      'createdAt', 'createdBy', 'takenAt', 'takenBy', 'doneAt', 'result'],
    project_items: ['issueNumber', 'column', 'order'],
    // ここから下はエージェンティックスクラム (ai-scrum-gas から取り入れた)。
    // 既定はオフで、オンのときだけ使う
    sprints: ['name', 'goal', 'startDate', 'endDate', 'notes', 'createdAt', 'createdBy'],
    impediments: ['number', 'title', 'body', 'reportedBy', 'reportedAt', 'state',
      'resolvedAt', 'resolution', 'sprint', 'updatedAt'],
    impediment_comments: ['id', 'impedimentNumber', 'body', 'by', 'at', 'editedAt'],
    // 画面や命令からの変更の前と後。誰がいつ何を変えたかを辿るため
    change_log: ['id', 'at', 'actor', 'target', 'action', 'field', 'before', 'after'],
    // 集中のしかた (Focus.gs)。自分の設定でオンにした人の「今から始める」の記録。本人にだけ見せる
    focus_sessions: ['id', 'issueNumber', 'who', 'plannedMinutes', 'startedAt', 'firstStep', 'provedAt',
      'endedAt', 'result', 'openedAt', 'extendedMinutes', 'proofKind', 'columnAtStart'],
    // 推し (自分だけのキャラクター。既定はオフ)。名前・口調・自分のせりふは1人1行、
    // 表情の画像は中身を objects/ に置き、どの人のどの表情かだけをここに書く
    oshi: ['id', 'who', 'name', 'tone', 'lines', 'updatedAt', 'charId', 'profile', 'shared'],
    oshi_images: ['id', 'who', 'state', 'sha', 'mime', 'updatedAt', 'charId'],
    // 成果の数 (Outcomes.gs)。日ごとのチーム全体の数だけで、人の名前もアドレスも持たない。
    // 1日1回の片付けが、直近8日を数え直して日ごとに上書きする。列の意味は docs/dev/ledger-schema.md
    outcomes_daily: ['day', 'moved', 'closedClean', 'mergedClean', 'reopened', 'overdue', 'activePeople',
      'busyErrors', 'timeoutErrors', 'fxOff'],
    // 目標 (Goal.gs。OKR・MBO・KPI。既定はオフ)。who は小文字のアドレス、period は '2026H2' / '2026Q3'。
    // 見せるのは本人と、上長の連なり (docs/dev/permissions.md)。列の意味は docs/dev/ledger-schema.md
    goals: ['id', 'who', 'period', 'kind', 'title', 'status', 'submittedAt', 'approver', 'approvedAt',
      'managerNote', 'selfReview', 'autoScore', 'finalGrade', 'gradedBy', 'gradedAt', 'createdAt', 'updatedAt',
      // 立てたときの年度の始まりの月 (あとから足した。空の行はいまの設定で読む)
      'fyStart'],
    goal_items: ['id', 'goalId', 'title', 'weight', 'measure', 'target', 'unit', 'actual', 'checked', 'filter', 'order'],
    // 項目とやることの結び付き。「あるか見てから書く」ので鍵の中で足す (goalLink_)
    goal_links: ['id', 'itemId', 'issueNumber'],
    // お知らせ・1問アンケート・案内 (Announcement.gs)。置けるのは管理者だけ。kind は notice / poll / ad、
    // options はアンケートの選択肢 (JSON の配列)、startAt / endAt は 'yyyy-MM-dd' (空は限りなし)
    announcements: ['id', 'kind', 'title', 'body', 'options', 'startAt', 'endAt', 'createdBy', 'createdAt', 'archivedAt'],
    // 誰がどう片づけたか。answer は '' (読んだ) / 'closed' (閉じた) / 選んだ選択肢。1人1回 (鍵の中で見てから書く)
    announcement_replies: ['id', 'announcementId', 'who', 'answer', 'at'],
    // 取り込んだ Gemini のメモ (MeetingNotesImport.gs)。1つのメモに1行で、二度取り込まないための印 (鍵の中で見てから書く)。
    // meeting は結び付いた予定の名前 (会議不明なら空)、meetingAt はその始まり、minutes は長さ (分)、
    // issueNumbers は作ったやることの番号 (カンマ区切り)。列の意味は docs/dev/ledger-schema.md
    meeting_notes: ['docId', 'title', 'meeting', 'meetingAt', 'minutes', 'importedBy', 'importedAt', 'issueNumbers'],
    // 繰り返しのやること (Recurrence.gs)。kind は weekly / monthly / yearly、weekday は 0 (日) 〜 6、day は日 (31 は月末)、
    // month は毎年の月。lastIssuedFor は最後に起票した対象日 ('YYYY-MM-DD')。**二度作らない印**で、鍵の中で見てから書く。
    // 列の意味は docs/dev/ledger-schema.md
    recurrences: ['id', 'title', 'body', 'assignee', 'kind', 'weekday', 'day', 'month', 'dueDays', 'leadDays',
      'active', 'lastIssuedFor', 'lastIssueNumber', 'createdBy', 'createdAt'],
  };
}

/**
 * テーブルに対応するシートを取得する。存在しなければヘッダ付きで作成する。
 *
 * @param {string} table
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function dbSheet_(table) {
  var schema = DB_SCHEMA();
  var cols = schema[table];
  if (!cols) throw new Error('未定義のテーブルです: ' + table);

  var ss = SpreadsheetApp.openById(repoConfig().dbId);
  var sheet = ss.getSheetByName(table);

  if (!sheet) {
    sheet = ss.insertSheet(table);
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
    // シートを作り直した (人が消した) ときは、キャッシュに前の行が残っている
    dbInvalidate_(table);
    return sheet;
  }

  // 列を増やしたとき、既存シートの見出し行が古いままだと
  // 人が開いたときに何の列か分からなくなる。合わせておく
  var header = sheet.getRange(1, 1, 1, cols.length).getValues()[0];
  var stale = false;
  for (var h = 0; h < cols.length; h++) {
    if (String(header[h]) !== cols[h]) stale = true;
  }
  if (stale) sheet.getRange(1, 1, 1, cols.length).setValues([cols]);

  return sheet;
}

/**
 * テーブルの全行をオブジェクト配列として読む。
 *
 * 注意: 行数に比例して遅くなる。数万行規模ではシャーディングが必要
 * (scaling doc §2.2 を参照)。
 *
 * ## 読み取りは2段で覚える (docs/dev/ledger-schema.md の「台帳の読み取りはキャッシュに置く」)
 *
 * 1回の読み取りが実機で 160〜800ms かかり、画面を開くと約30本の api* が同じ表を何度も読んでいた。
 * - **同じ実行の中の覚え** (`DB_MEMO_`)。1回の api* の中で同じ表を2度読まない
 * - **CacheService** (`DB:<表>:<版>`、30分)。版は `DBV:<表>` に置き、**書くたびに `dbInvalidate_` が変える**
 *
 * 返すのはいつも写し (行のオブジェクトを作り直したもの)。呼び出し側が行に書き込んでも、覚えは変わらない。
 * キャッシュが読めない・壊れているときは台帳を読む (キャッシュで止めない)。
 *
 * @param {string} table
 * @returns {object[]}
 */
function dbReadAll(table) {
  var cols = DB_SCHEMA()[table];
  if (!cols) throw new Error('未定義のテーブルです: ' + table);

  if (Object.prototype.hasOwnProperty.call(DB_MEMO_, table)) return dbRowsCopy_(DB_MEMO_[table]);

  // この実行の中で書いて、まだ版を変えていない表 (鍵を放すときに変える) は、キャッシュを見ずに台帳を読む。
  // キャッシュにあるのは書く前の中身で、そのまま返すと書いた直後に古い中身が見える
  var dirty = Object.prototype.hasOwnProperty.call(DB_DIRTY_, table);
  var cache = dirty ? null : dbCache_();
  var ver = null;
  var rows = null;

  if (cache) {
    try {
      ver = cache.get(dbVerKey_(table));
      if (ver) {
        rows = dbCacheRead_(cache, table, ver, cols);
      } else {
        // 版が無い (初めて・追い出された) ときは、新しい版を先に置いてから台帳を読む。
        // '0' のような決まった版にすると、追い出されたあとに前の '0' の中身が当たる
        ver = dbNewVer_();
        cache.put(dbVerKey_(table), ver, DB_CACHE_VER_SEC());
      }
    } catch (e) {
      cache = null;
      rows = null;
    }
  }

  if (!rows) {
    rows = dbReadSheet_(table, cols);
    if (cache && ver) dbCacheWrite_(cache, table, ver, cols, rows);
  }

  DB_MEMO_[table] = rows;
  return dbRowsCopy_(rows);
}

/**
 * 表をシートから読み直し、今の版の名でキャッシュに置き直す (期限を延ばす)。裏の定期実行が呼ぶ (CacheWarm.gs)。
 *
 * dbReadAll はキャッシュにあればそれを返し、期限を延ばさない。CacheService には期限だけを延ばす口が無いので、
 * 置き直すしかない。**キャッシュの中身を置き直すのではなく、シートから読む。** キャッシュの中身を置き直し続けると、
 * 人が台帳のシートを直にいじったぶんがいつまでも見えなくなる (今は 30分で見える)。
 *
 * **版は置き直さない。** 読んでいるあいだにほかの実行が書いて版を変えると、前の版に戻してしまい、書く前の中身が
 * 新しい版として当たる。版が無いときだけ、dbReadAll と同じく新しい版を作ってから読む。読んでいるあいだに版が
 * 変われば、置いたものは古い版の名になるだけで誰にも当たらない。
 *
 * @param {string} table
 * @returns {boolean} 置き直したか (キャッシュが使えない・この実行の中で書いた表なら false)
 */
function dbWarm_(table) {
  var cols = DB_SCHEMA()[table];
  if (!cols) throw new Error('未定義のテーブルです: ' + table);
  // この実行の中で書いて、まだ版を変えていない表は置かない (書く前の版の名で書いたあとの中身を置くことになる)
  if (dbTableDirty_(table)) return false;
  var cache = dbCache_();
  if (!cache) return false;
  var ver = cache.get(dbVerKey_(table));
  if (!ver) {
    ver = dbNewVer_();
    cache.put(dbVerKey_(table), ver, DB_CACHE_VER_SEC());
  }
  var rows = dbReadSheet_(table, cols);
  dbCacheWrite_(cache, table, ver, cols, rows);
  DB_MEMO_[table] = rows;
  return true;
}

/**
 * 台帳 (シート) から読む。dbReadAll の覚えが無いときの本体。
 *
 * @param {string} table
 * @param {string[]} cols
 * @returns {object[]}
 */
function dbReadSheet_(table, cols) {
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < cols.length; c++) {
      obj[cols[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

/**
 * 同じ実行の中の覚え。表の名前 → 行。
 *
 * **Apps Script は呼び出しごとにグローバルを初めから読み直す**ので、ここに置けば「この実行の中で」になる
 * (dbWroteThisRun_ と同じ)。**鍵を取ったときに捨てる** (`dbWithLock_`): 鍵の中の「読んで決めて書く」は
 * ほかの実行が書いたあとの中身を読まないと成り立たない (同じ番号・同じカードが2つになる)。
 */
var DB_MEMO_ = {};

/**
 * この実行の中で書いたが、まだ版を変えていない表。表の名前 → true。
 *
 * 鍵の中で書いたときは、鍵を放す直前にまとめて版を変える (`dbFlushInvalidate_`)。1回の操作で何行も書く
 * ときに、1行ごとにキャッシュへ行かないため。
 */
var DB_DIRTY_ = {};

/**
 * 台帳のキャッシュの長さ (秒)。人がシートを直にいじったときは、これだけ古いまま見える (管理者は設定の「覚えを捨てる」で
 * すぐ新しくできる)。以前は 300 秒だったが、5分放置して開き直すと全部の表をシートから読み直し (1表 0.5 秒ほど)、
 * 開いた直後の api が軒並み遅かった (2026-10-27)。書いた側は必ず版を変えるので、長くしても自分たちの書き込みは遅れない
 */
function DB_CACHE_SEC() {
  return 1800;
}

/** 版の鍵の長さ (秒)。CacheService の上限 (6時間) */
function DB_CACHE_VER_SEC() {
  return 21600;
}

/**
 * キャッシュの1つの値に置く字数。
 *
 * 上限は1つの値につき 100KB (**バイト**)。日本語は1字3バイトなので、字数で区切ると超える (docs/dev/pitfalls.md)。
 * 25K 字なら全部が3バイトの字でも 75KB に収まる (LiveCache.gs の CACHE_CHUNK_SIZE と同じ)。
 *
 * @returns {number}
 */
function DB_CACHE_CHUNK_CHARS() {
  return 25 * 1024;
}

/**
 * 1つの表を分けて置く数の上限。これを超える表はキャッシュに置かない (同じ実行の中の覚えだけ)。
 *
 * 40 × 25K 字 = 約 100万字。usage は 400行で 44KB なので、180日ぶん (USAGE_KEEP_DAYS) たまっても収まる。
 *
 * @returns {number}
 */
function DB_CACHE_MAX_CHUNKS() {
  return 40;
}

/** @returns {string} */
function dbVerKey_(table) {
  return 'DBV:' + table;
}

/** @returns {string} */
function dbDataKey_(table, ver) {
  return 'DB:' + table + ':' + ver;
}

/** 新しい版。同じミリ秒に2つの実行が書いても重ならないよう、乱数を添える */
function dbNewVer_() {
  return String(Date.now()) + '.' + String(Math.floor(Math.random() * 1e9));
}

/** スクリプトのキャッシュ。使えなければ null (台帳を読む) */
function dbCache_() {
  try {
    if (typeof CacheService === 'undefined' || !CacheService) return null;
    return CacheService.getScriptCache() || null;
  } catch (e) {
    return null;
  }
}

/** 行の写し。セルの値は字・数・真偽・Date なので、1段の写しで足りる */
function dbRowsCopy_(rows) {
  var out = new Array(rows.length);
  for (var i = 0; i < rows.length; i++) {
    var src = rows[i];
    var obj = {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k];
      // Date は書き換えられる (setHours など) ので、作り直す
      obj[k] = Object.prototype.toString.call(v) === '[object Date]' ? new Date(v.getTime()) : v;
    }
    out[i] = obj;
  }
  return out;
}

/**
 * 行をキャッシュに置く字にする。
 *
 * **Date は JSON にすると字になる。** 台帳の日付の欄は Date で返る (docs/dev/pitfalls.md) ので、字のまま返すと
 * 読む側の `usageDayOf_` や `plainDay` の分かれ道が変わる。`{"d": ミリ秒}` にして、読むときに Date に戻す。
 * 列の並びも添え、列を足した新しい版のコードが古い形の覚えを読まないようにする。
 */
function dbCacheEncode_(cols, rows) {
  var list = new Array(rows.length);
  for (var i = 0; i < rows.length; i++) {
    var line = new Array(cols.length);
    for (var c = 0; c < cols.length; c++) {
      var v = rows[i][cols[c]];
      line[c] = Object.prototype.toString.call(v) === '[object Date]' ? { d: v.getTime() } : v;
    }
    list[i] = line;
  }
  return JSON.stringify({ c: cols.join(','), r: list });
}

/** dbCacheEncode_ の逆。形が違えば null (台帳を読む) */
function dbCacheDecode_(cols, text) {
  var data = JSON.parse(text);
  if (!data || data.c !== cols.join(',') || !Array.isArray(data.r)) return null;
  var out = new Array(data.r.length);
  for (var i = 0; i < data.r.length; i++) {
    var line = data.r[i];
    if (!Array.isArray(line) || line.length !== cols.length) return null;
    var obj = {};
    for (var c = 0; c < cols.length; c++) {
      var v = line[c];
      obj[cols[c]] = v && typeof v === 'object' && typeof v.d === 'number' ? new Date(v.d) : v;
    }
    out[i] = obj;
  }
  return out;
}

/**
 * キャッシュから読む。無い・欠けている・壊れているときは null。
 *
 * 置き方: `DB:<表>:<版>` に、全部が1つに収まるなら中身そのもの ('{' で始まる)、収まらなければ '#' と分けた数。
 * 分けたものは `DB:<表>:<版>:<n>`。1つでも追い出されていれば null。
 */
function dbCacheRead_(cache, table, ver, cols) {
  try {
    var head = cache.get(dbDataKey_(table, ver));
    if (!head) return null;
    if (head.charAt(0) === '{') return dbCacheDecode_(cols, head);
    if (head.charAt(0) !== '#') return null;

    var n = Number(head.substring(1));
    if (!(n > 0) || n > DB_CACHE_MAX_CHUNKS()) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(dbDataKey_(table, ver) + ':' + i);
    var got = cache.getAll(keys) || {};
    var text = '';
    for (var k = 0; k < keys.length; k++) {
      var part = got[keys[k]];
      if (part === undefined || part === null) return null;
      text += part;
    }
    return dbCacheDecode_(cols, text);
  } catch (e) {
    return null;
  }
}

/**
 * キャッシュに置く。置けなくても読み取りは続ける (次も台帳を読むだけ)。
 *
 * 分けた続きを先に置き、頭を最後に置く。頭が先にあると、続きを置き終える前に読んだ人が欠けを見る
 * (null になって台帳を読むだけなので壊れはしないが、無駄になる)。
 */
function dbCacheWrite_(cache, table, ver, cols, rows) {
  try {
    var text = dbCacheEncode_(cols, rows);
    var size = DB_CACHE_CHUNK_CHARS();
    var key = dbDataKey_(table, ver);
    if (text.length <= size) {
      cache.put(key, text, DB_CACHE_SEC());
      return;
    }

    var parts = [];
    for (var i = 0; i < text.length; ) {
      var end = Math.min(text.length, i + size);
      // サロゲートペアの間で切らない
      var code = text.charCodeAt(end - 1);
      if (end < text.length && code >= 0xD800 && code <= 0xDBFF) end--;
      parts.push(text.substring(i, end));
      i = end;
    }
    // 大きすぎる表は置かない。同じ実行の中の覚えだけで読む
    if (parts.length > DB_CACHE_MAX_CHUNKS()) return;

    var payload = {};
    for (var p = 0; p < parts.length; p++) payload[key + ':' + p] = parts[p];
    cache.putAll(payload, DB_CACHE_SEC());
    cache.put(key, '#' + parts.length, DB_CACHE_SEC());
  } catch (e) {
    // 置けなくても、読んだ中身は返す
  }
}

/**
 * 台帳のその表を書き換えたことを知らせ、覚えを捨てる。**台帳に書く道はすべてここを通す。**
 *
 * - 同じ実行の中の覚えはすぐ捨てる (書いた直後の読み取りが新しい中身になる)
 * - キャッシュの版は、鍵の中なら鍵を放す直前にまとめて変える (`dbFlushInvalidate_`)。鍵の外ならすぐ変える。
 *   どちらも、ほかの実行が次に鍵を取ったときには新しい版が見える
 *
 * Db.gs の外で台帳に直に書く所 (`usageRecord` / `noticeMarkRead` / `reviewBackfillIdsLocked_` /
 * `outcomesWrite_`) も、書いたあとにこれを呼ぶ。足すときも同じ。
 *
 * @param {string} table
 */
/** この実行の中で書いて、まだ版を変えていない表か (鍵の中)。台帳の外の覚え (Drive にあるか、など) も、このときは見ない */
function dbTableDirty_(table) {
  return Object.prototype.hasOwnProperty.call(DB_DIRTY_, table);
}

function dbInvalidate_(table) {
  delete DB_MEMO_[table];
  DB_DIRTY_[table] = true;
  if (dbLockDepth_ === 0) dbFlushInvalidate_();
}

/** すべての表の覚えを捨てる (入れ物を作り直したとき・管理者がキャッシュを捨てるとき) */
function dbInvalidateAll_() {
  var schema = DB_SCHEMA();
  for (var table in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, table)) {
      delete DB_MEMO_[table];
      DB_DIRTY_[table] = true;
    }
  }
  if (dbLockDepth_ === 0) dbFlushInvalidate_();
}

/**
 * 書いた表の版を変える。
 *
 * **先に書いた中身を台帳へ送り切る (`SpreadsheetApp.flush`)。** Apps Script はシートへの書き込みをため込むので、
 * 送る前に版を変えると、ほかの実行が新しい版の名で書く前の中身を読んでキャッシュに置き、30分古いまま見える。
 * 版を置けなかったときは版の鍵を消す (読む側が新しい版を作り、台帳を読み直す)。
 */
function dbFlushInvalidate_() {
  var tables = Object.keys(DB_DIRTY_);
  if (!tables.length) return;
  try {
    SpreadsheetApp.flush();
  } catch (e) {
    // 送れなくても版は変える
  }
  var cache = dbCache_();
  if (cache) {
    var ver = dbNewVer_();
    var payload = {};
    for (var i = 0; i < tables.length; i++) payload[dbVerKey_(tables[i])] = ver;
    try {
      cache.putAll(payload, DB_CACHE_VER_SEC());
    } catch (e) {
      // まとめて置けなければ1つずつ。それも置けなければ版の鍵を消す
      for (var t = 0; t < tables.length; t++) dbVerReplace_(cache, dbVerKey_(tables[t]), ver);
    }
  }
  DB_DIRTY_ = {};
}

/**
 * 版の鍵を1つ置き直す。置けなければ消す。**どちらもできなければ、古い版のまま 30分残りうる**
 * (キャッシュそのものが使えないときで、そのときは読む側も台帳を読む)。
 */
function dbVerReplace_(cache, key, ver) {
  try {
    cache.put(key, ver, DB_CACHE_VER_SEC());
    return;
  } catch (e) {
    // 消すほうへ
  }
  try {
    cache.remove(key);
  } catch (e2) {
    // キャッシュそのものが使えない
  }
}

/**
 * いま鍵を持っている深さ。
 *
 * **入れ子で二度取りに行かないため。** コマンドキューは鍵を持ったまま命令を
 * 実行し、その中で番号を採る。鍵を取り直す作りだと、取れるかどうかが
 * LockService の入れ子の扱いに左右される。自分で数えて、持っているなら
 * 取りに行かない。
 */
var dbLockDepth_ = 0;

/**
 * 台帳を書き換えるあいだ、他を待たせる。
 *
 * Web アプリと1分ごとのトリガーが同じ表に書くため、読んで決めて書く形は
 * 鍵なしでは成立しない。
 *
 * @param {number} waitMs 待つ上限
 * @param {function} fn 鍵を持って行うこと
 * @param {function} [onBusy] 取れなかったときの返し。省略すると投げる
 * @returns {*} fn の戻り
 */
function dbWithLock_(waitMs, fn, onBusy) {
  if (dbLockDepth_ > 0) {
    dbLockDepth_++;
    try {
      return fn();
    } finally {
      dbLockDepth_--;
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) {
    if (onBusy) return onBusy();
    // 断った数を数える (成果の数の busyErrors)。onBusy で黙って次に回すものは数えない
    dbBusyNote_();
    // **同じ実行の中で、もう鍵の中の処理を1つ済ませていたら、別の字で断る。** やることを作る
    // (番号を振る → カードを置く → 担当を書く) のように鍵を続けて取る操作では、2つ目で断られた
    // ときには1つ目の行がもう書かれている。「混み合っています」と言うと画面は [もう一度] を出し、
    // 押すと同じものが2つできる。この字は押し直しを勧めない型 (partial) になる (ErrorKind.js)
    if (dbWroteThisRun_) throw new Error(DB_PARTIAL_TEXT());
    throw new Error(DB_BUSY_TEXT());
  }

  // 鍵を取る前に読んだ覚えは、ほかの実行が書く前の中身かもしれない。鍵の中の「読んで決めて書く」は
  // 新しい中身で決めないと、同じ番号・同じカードが2つになる (docs/dev/locks-and-numbering.md)
  DB_MEMO_ = {};
  dbLockDepth_++;
  try {
    var out = fn();
    dbWroteThisRun_ = true;
    return out;
  } finally {
    dbLockDepth_--;
    // 書いた表の版は、鍵を放す前に変える。放したあとに変えると、次に鍵を取った実行が古い版の中身を読む
    try {
      dbFlushInvalidate_();
    } finally {
      lock.releaseLock();
    }
  }
}

/**
 * この実行の中で、鍵の中の処理を1つでも済ませたか。
 *
 * **Apps Script は呼び出し (画面からの1回・トリガーの1回) ごとにグローバルを初めから読み直す**ので、
 * ここに置けば「この実行の中で」になる。テストは同じ文脈で何度も呼ぶので、test/harness.js が
 * 外から呼んだ1回ごとに dbRunBegin_() で戻す。
 */
var dbWroteThisRun_ = false;

/** 1回の実行の始まり (テストの harness が呼ぶ。実機ではグローバルの読み直しで同じことになる) */
function dbRunBegin_() {
  dbWroteThisRun_ = false;
  DB_MEMO_ = {};
  DB_DIRTY_ = {};
  DB_RUN_MEMO_ = {};
}

/**
 * 同じ実行の中だけの覚え (台帳の外のもの。Drive にあるか、など)。実機は呼び出しごとにグローバルを読み直すので
 * 自然に消える。テストは dbRunBegin_ で消す。鍵を取っても消さない (使う側が、書いた表の dbTableDirty_ を見て避ける)
 */
var DB_RUN_MEMO_ = {};

function dbRunMemo_() {
  return DB_RUN_MEMO_;
}

/** 鍵が取れなかったときの断り。**この字のときだけ**画面は [もう一度] を出す (ErrorKind.js の busy) */
function DB_BUSY_TEXT() {
  return '混み合っています。少し待ってからもう一度お試しください';
}

/** 途中まで書いたあとで鍵が取れなかったときの断り (ErrorKind.js の partial。押し直しを勧めない) */
function DB_PARTIAL_TEXT() {
  return '途中まで済みましたが、混み合って続きができませんでした。一覧で確かめてください';
}

/**
 * 「混み合っています」を数える日ごとの鍵 (スクリプトプロパティ)。1日1回の成果の数 (Outcomes.gs) が読む。
 *
 * @param {string} day 'yyyy-MM-dd' (東京)
 * @returns {string}
 */
function dbBusyKey_(day) {
  return 'OUTCOME_BUSY:' + day;
}

/**
 * 「混み合っています」で断った数を、その日の数に1つ足す。
 *
 * **鍵を取らずに足す。** 鍵が取れなかったから断っているので、ここで鍵を待つと断りがさらに遅れる。
 * そのかわり、ほぼ同時に2人が断られると1つ数え漏れる (読んで足して書くあいだに重なる)。見張りの数なので
 * それでよい (docs/dev/ledger-schema.md の outcomes_daily)。数えられなくても断りは出す。
 */
function dbBusyNote_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = dbBusyKey_(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'));
    props.setProperty(key, String((Number(props.getProperty(key)) || 0) + 1));
  } catch (e) {
    // 数えられなくても、断りそのものは出す
  }
}

/**
 * これまでに出した番号の覚え書きの鍵。
 *
 * @param {string} table
 * @param {string} column
 * @returns {string}
 */
function dbHighKey_(table, column) {
  return 'DB_HIGH_' + table + '_' + column;
}

/**
 * その列の次の番号を返す。
 *
 * **単独で呼ばない。** 読んだあと書くまでに他が割り込むと同じ番号になる。
 * `dbAppendNumbered` から鍵の中で呼ぶ。
 *
 * ## 一度出した番号は二度出さない
 *
 * 表の中のいちばん大きい番号だけを見ていると、**消した番号が次のものに
 * 回る。** 行を消しても、それを指しているものは他に残る。
 *
 * 確認依頼の本文の `closes #7` がその例である。#7 を捨てて完全に消し、
 * 無関係な新しいやることが #7 を受け取ると、その確認依頼を反映した時点で
 * **身に覚えのないやることが完了になる。** 本文を書き換えて回る手もあるが、
 * 指している先は本文だけとは限らない。
 *
 * だから出した番号を覚えておき、表が空になっても戻さない。覚え書きが
 * 失われても、表の中の最大値より小さくはならないので、壊れはしない。
 *
 * @param {string} table
 * @param {string} column
 * @returns {number}
 */
function dbNextNumber_(table, column) {
  var rows = dbReadAll(table);
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i][column]);
    if (!isNaN(n) && n > max) max = n;
  }

  var props = PropertiesService.getScriptProperties();
  var key = dbHighKey_(table, column);
  var high = Number(props.getProperty(key));
  if (!isNaN(high) && high > max) max = high;

  var next = max + 1;
  props.setProperty(key, String(next));
  return next;
}

/**
 * その列でこれまでに出した最大の番号を返す。番号は進めない。
 *
 * @param {string} table
 * @param {string} column
 * @returns {number} 1つも出していなければ 0
 */
function dbLastNumber_(table, column) {
  var rows = dbReadAll(table);
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i][column]);
    if (!isNaN(n) && n > max) max = n;
  }

  var high = Number(PropertiesService.getScriptProperties()
    .getProperty(dbHighKey_(table, column)));
  return !isNaN(high) && high > max ? high : max;
}

/**
 * 番号を振って1行追記する。
 *
 * **番号を決めることと書くことを、1つの鍵の中で行う。** 分けると、ほぼ同時の
 * 2件が同じ番号を取る。そうなると一覧に同じ番号のものが2つ並び、`dbFindOne`
 * は先の1件しか返さないので、もう1件は見えるのに開けない幽霊になる。
 *
 * **番号は表ごとの通し番号にする。** 親ごとに振ると番号がかぶり、
 * `dbUpdate` / `dbDelete` は列の値だけで行を探すため、関係のない親の行を
 * 書き換えたり一緒に消したりする (実際に `pull_patches` で踏んだ)。
 *
 * @param {string} table
 * @param {string} column 番号の列
 * @param {object} row 番号以外を埋めた行
 * @returns {object} 番号の入った行
 */
function dbAppendNumbered(table, column, row) {
  return dbWithLock_(30000, function () {
    row[column] = dbNextNumber_(table, column);
    dbAppend(table, row);
    return row;
  });
}

/**
 * 番号を振りながら、何行かをまとめて足す。番号は続き番号になる。
 *
 * 1行ずつ dbAppendNumbered を呼ぶと、そのたびに表を丸ごと読んで最大値を
 * 探す。変更の履歴のように1回の操作で何行も足し、しかも増える一方の表では、
 * 操作がだんだん重くなる。表を読むのは1回にする。
 *
 * @param {string} table
 * @param {string} column
 * @param {object[]} rows 番号を書き込む
 * @returns {object[]} rows
 */
function dbAppendNumberedMany(table, column, rows) {
  if (!rows.length) return rows;
  return dbWithLock_(30000, function () {
    var first = dbNextNumber_(table, column);
    for (var i = 0; i < rows.length; i++) {
      rows[i][column] = first + i;
      dbAppend(table, rows[i]);
    }
    // 出した最後の番号を覚える。dbNextNumber_ が覚えたのは最初の番号だけ
    PropertiesService.getScriptProperties()
      .setProperty(dbHighKey_(table, column), String(first + rows.length - 1));
    return rows;
  });
}

/**
 * Sheets に字の解釈をさせてよい欄。
 *
 * 日付として書いている欄だけである。ここに無い欄の字は、書いたとおりに残す。
 *
 * @returns {Object<string, boolean>}
 */
function DB_TYPED_COLUMNS() {
  return { dueDate: true, startDate: true, endDate: true, day: true };
}

/**
 * 台帳のセルに書く値にする。
 *
 * **Sheets は書いた字を、人が打ち込んだときと同じように読む。** 題名や
 * やりとりに '1/2' と書けば日付に、'007' と書けば 7 になり、'=' で始めれば
 * 台帳の中で数式として動く (数式の差し込み)。先頭に ' を付けると解釈を止め、
 * ' そのものは残らない。
 *
 * 数そのものの字 ('3') は数として書く。字のまま残すと、これまで数で読んで
 * いたところと食い違う。String(Number(v)) === v のものだけを数と見なすので、
 * '007' や '1e3' は字のまま残る。
 *
 * @param {string} column
 * @param {*} v
 * @returns {*}
 */
function dbCell_(column, v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v === '') return v;
  if (DB_TYPED_COLUMNS()[column]) return v;
  if (String(Number(v)) === v) return v;
  return "'" + v;
}

/**
 * テーブルに1行追記する。スキーマに無いキーは無視される。
 *
 * @param {string} table
 * @param {object} obj
 */
function dbAppend(table, obj) {
  var cols = DB_SCHEMA()[table];
  var row = [];
  for (var i = 0; i < cols.length; i++) row.push(dbCell_(cols[i], obj[cols[i]]));
  dbSheet_(table).appendRow(row);
  dbInvalidate_(table);
}

/**
 * key === value を満たす最初の行を返す。見つからなければ null。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @returns {object|null}
 */
function dbFindOne(table, key, value) {
  var rows = dbReadAll(table);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][key]) === String(value)) return rows[i];
  }
  return null;
}

/**
 * key === value を満たす最初の行に patch を適用する。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @param {object} patch
 * @returns {boolean} 更新した行があれば true
 */
function dbUpdate(table, key, value, patch) {
  /*
   * **読んだ位置へ書くので、鍵の中で行う。** dbDelete は行を詰める。並んで
   * 走ると、読んでから書くまでに上の行が消され、1行ずれた別の行を丸ごと
   * 上書きする。上書きされた行は黙って失われる。
   */
  return dbWithLock_(30000, function () {
    return dbUpdateLocked_(table, key, value, patch);
  });
}

/**
 * dbUpdate の本体。鍵を持った状態で呼ばれる。
 */
function dbUpdateLocked_(table, key, value, patch) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return false;

  var keyCol = cols.indexOf(key);
  if (keyCol < 0) throw new Error('未定義のカラムです: ' + key);

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][keyCol]) !== String(value)) continue;
    // 直さない欄も書き戻すので、全部を dbCell_ に通す。字のセルは読むと
    // ' の無い字で返ってくるため、そのまま書くと今度は解釈されてしまう
    var line = [];
    for (var c = 0; c < cols.length; c++) {
      var v = Object.prototype.hasOwnProperty.call(patch, cols[c])
        ? patch[cols[c]] : values[r][c];
      line.push(dbCell_(cols[c], v));
    }
    sheet.getRange(r + 2, 1, 1, cols.length).setValues([line]);
    dbInvalidate_(table);
    return true;
  }
  return false;
}

/**
 * 同じ表の何行かを、1つの鍵の中で、表を1回読んで1回で書く。
 *
 * `dbUpdate` を行の数だけ呼ぶと、そのたびに表を丸ごと読んで1行書く (本番で1回 0.3〜0.8秒)。進捗ボードの列を
 * 動かす (`projectMove`) は、動かす先の列と元の列の全部のカードの番号を書き直すので、本番でカードが 73 枚のとき
 * 27〜36 秒かかり、「完了にする」「完了を取り消す」が数十秒黙っていた (2026-10-22)。
 *
 * 直す行の最初から最後までを1回の `setValues` で書く。あいだの直さない行も `dbCell_` を通して書き戻す
 * (`dbUpdateLocked_` が直さない欄を書き戻すのと同じ理由。字のセルは読むと ' の無い字で返る)。
 * 同じ鍵の値の行が2つあれば、`dbUpdate` と同じく先の1行だけを直す。
 *
 * @param {string} table
 * @param {string} key 探す列
 * @param {Array<{value: *, patch: object}>} patches 行ごとの直す値。同じ value が2つあれば後が勝つ
 * @returns {number} 直した行の数
 */
function dbUpdateMany(table, key, patches) {
  if (!patches || !patches.length) return 0;
  return dbWithLock_(30000, function () {
    return dbUpdateManyLocked_(table, key, patches);
  });
}

function dbUpdateManyLocked_(table, key, patches) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var keyCol = cols.indexOf(key);
  if (keyCol < 0) throw new Error('未定義のカラムです: ' + key);

  var byKey = {};
  for (var p = 0; p < patches.length; p++) byKey[String(patches[p].value)] = patches[p].patch;

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  var lines = [];
  var first = -1;
  var end = -1;
  var count = 0;
  for (var r = 0; r < values.length; r++) {
    var k = String(values[r][keyCol]);
    var patch = Object.prototype.hasOwnProperty.call(byKey, k) ? byKey[k] : null;
    if (patch) delete byKey[k];
    var line = [];
    for (var c = 0; c < cols.length; c++) {
      var v = patch && Object.prototype.hasOwnProperty.call(patch, cols[c]) ? patch[cols[c]] : values[r][c];
      line.push(dbCell_(cols[c], v));
    }
    lines.push(line);
    if (patch) {
      if (first < 0) first = r;
      end = r;
      count++;
    }
  }
  if (first < 0) return 0;

  sheet.getRange(first + 2, 1, end - first + 1, cols.length).setValues(lines.slice(first, end + 1));
  dbInvalidate_(table);
  return count;
}

/**
 * 条件に一致する行をすべて削除する。
 *
 * 行番号は削除のたびにずれるため、必ず下から消す。
 *
 * @param {string} table
 * @param {string} key
 * @param {*} value
 * @returns {number} 削除した行数
 */
function dbDelete(table, key, value) {
  // 空の値を許すと「キー列が空の行」をまとめて消してしまう。
  // メタDBは人が直接編集できるスプレッドシートであり、手で消された
  // セルが1つあるだけで無関係な行まで巻き添えになる
  if (value === '' || value === null || value === undefined) {
    throw new Error('削除条件の値が空です: ' + table + '.' + key);
  }

  // 行を詰めるので、dbUpdate と同じく鍵の中で行う
  return dbWithLock_(30000, function () {
    return dbDeleteLocked_(table, key, value);
  });
}

/**
 * dbDelete の本体。鍵を持った状態で呼ばれる。
 */
function dbDeleteLocked_(table, key, value) {
  var cols = DB_SCHEMA()[table];
  var sheet = dbSheet_(table);
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var keyCol = cols.indexOf(key);
  if (keyCol < 0) throw new Error('未定義のカラムです: ' + key);

  var values = sheet.getRange(2, 1, last - 1, cols.length).getValues();
  var deleted = 0;
  for (var r = values.length - 1; r >= 0; r--) {
    if (String(values[r][keyCol]) !== String(value)) continue;
    sheet.deleteRow(r + 2);
    deleted++;
  }
  if (deleted) dbInvalidate_(table);
  return deleted;
}
