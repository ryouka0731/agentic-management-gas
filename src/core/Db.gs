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
    files: ['fileId', 'path', 'type', 'registeredAt', 'registeredBy', 'baseSha'],
    commits: ['sha', 'parentSha', 'branch', 'fileId', 'blobSha', 'author', 'message', 'timestamp'],
    branches: ['name', 'headSha', 'baseSha', 'state', 'workingFolderId', 'createdBy', 'createdAt'],
    pulls: ['number', 'title', 'body', 'sourceBranch', 'targetBranch', 'state', 'author', 'createdAt', 'mergedAt', 'reviewers', 'targetFiles', 'staleReviewId'],
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
    oshi: ['id', 'who', 'name', 'tone', 'lines', 'updatedAt', 'charId'],
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
 * @param {string} table
 * @returns {object[]}
 */
function dbReadAll(table) {
  var cols = DB_SCHEMA()[table];
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

  dbLockDepth_++;
  try {
    var out = fn();
    dbWroteThisRun_ = true;
    return out;
  } finally {
    dbLockDepth_--;
    lock.releaseLock();
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
    return true;
  }
  return false;
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
  return deleted;
}
