/*
 * 画面の API: エージェンティックスクラム (スプリント・障害物) と変更の履歴。
 *
 * スクラムが既定でオフのあいだは scrumAssertEnabled_() が断る。
 */

/**
 * sprints 行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @returns {object}
 */
function sprintToPlain_(row) {
  return {
    name: plainText(row.name),
    goal: plainText(row.goal),
    startDate: plainDay(row.startDate),
    endDate: plainDay(row.endDate),
    notes: plainText(row.notes),
  };
}

/**
 * impediments 行を、画面に渡せる素の形にする。
 *
 * @param {object} row
 * @param {Object<string, number>} [counts] 障害物の番号 → やりとりの数
 * @returns {object}
 */
function impedimentToPlain_(row, counts) {
  return {
    number: plainId(row.number),
    title: plainText(row.title),
    body: plainText(row.body),
    reportedBy: plainText(row.reportedBy),
    reportedAt: plainDate(row.reportedAt),
    state: plainText(row.state),
    resolvedAt: plainDate(row.resolvedAt),
    resolution: plainText(row.resolution),
    sprint: plainText(row.sprint),
    updatedAt: plainDate(row.updatedAt),
    commentCount: counts ? (counts[String(plainId(row.number))] || 0) : 0,
  };
}

/**
 * スプリントの一覧を返す (Web App API)。
 *
 * @returns {object[]}
 */
function apiSprintList() {
  return sprintList().map(sprintToPlain_);
}

/**
 * スプリントを作る (Web App API)。
 *
 * @param {object} fields
 * @returns {object}
 */
function apiSprintCreate(fields) {
  return sprintToPlain_(sprintCreate(fields || {}));
}

/**
 * スプリントのゴール・期間・備考を直す (Web App API)。
 *
 * @param {string} name
 * @param {object} patch
 * @returns {object}
 */
function apiSprintUpdate(name, patch) {
  return sprintToPlain_(sprintUpdate(name, patch || {}));
}

/**
 * スプリントのタブの中身を返す (Web App API)。
 *
 * 要約・ベロシティ・バーンダウン・ロードマップを1回でまとめて返す。タブを
 * 開くたびに4回往復させない。
 *
 * @param {string} [sprintName] バーンダウンを見るスプリント。空なら今のもの、
 *   無ければ最後のもの
 * @returns {object}
 */
function apiScrumView(sprintName) {
  var sprints = sprintList();
  var issues = dbReadAll('issues');
  var impediments = impedimentList();
  var today = new Date();
  // 終わったスプリントは、終わりの日の中身で数える。移したことは履歴にある
  var moves = scrumSprintMoves(dbReadAll('change_log'), sprints);
  var summary = scrumSummary(sprints, issues, impediments, today, moves);

  var name = String(sprintName || '') || summary.current ||
    (sprints.length ? String(sprints[sprints.length - 1].name) : '');
  var target = null;
  for (var i = 0; i < sprints.length; i++) {
    if (String(sprints[i].name) === name) target = sprints[i];
  }

  return {
    sprint: target ? plainText(target.name) : '',
    sprints: sprints.map(sprintToPlain_),
    summary: summary,
    velocity: scrumVelocity(sprints, issues, today, moves),
    burndown: target ? scrumBurndown(target, issues, today, moves)
      : { days: [], remaining: [], ideal: [], notice: '作業期間がまだありません。' },
    roadmap: scrumRoadmap(sprints, issues),
    texts: scrumTexts(),
  };
}

/**
 * 障害物の一覧を返す (Web App API)。やりとりの数も添える。
 *
 * @returns {object[]}
 */
function apiImpedimentList() {
  var rows = impedimentList();
  var counts = {};
  var talk = dbReadAll('impediment_comments');
  for (var t = 0; t < talk.length; t++) {
    var key = String(plainId(talk[t].impedimentNumber));
    counts[key] = (counts[key] || 0) + 1;
  }
  return rows.map(function (row) { return impedimentToPlain_(row, counts); });
}

/**
 * 障害物を記録する (Web App API)。
 *
 * @param {object} fields
 * @returns {object}
 */
function apiImpedimentCreate(fields) {
  return impedimentToPlain_(impedimentCreate(fields || {}));
}

/**
 * 障害物を直す (Web App API)。
 *
 * @param {number} number
 * @param {object} patch
 * @returns {object}
 */
function apiImpedimentUpdate(number, patch) {
  return impedimentToPlain_(impedimentUpdate(number, patch || {}));
}

/**
 * 障害物を解決する (Web App API)。
 *
 * @param {number} number
 * @param {string} resolution
 * @returns {object}
 */
function apiImpedimentResolve(number, resolution) {
  return impedimentToPlain_(impedimentResolve(number, resolution));
}

/**
 * 障害物の解決を取り消す (Web App API)。
 *
 * @param {number} number
 * @returns {object}
 */
function apiImpedimentReopen(number) {
  return impedimentToPlain_(impedimentReopen(number));
}

/**
 * 障害物のやりとりを返す (Web App API)。
 *
 * @param {number} number
 * @returns {object[]}
 */
function apiImpedimentComments(number) {
  var me = currentEmail_();
  return impedimentComments(number).map(function (row) {
    return plainTalk(row, me, 'impedimentNumber');
  });
}

/**
 * 障害物にやりとりを書く (Web App API)。
 *
 * @param {number} number
 * @param {string} body
 * @returns {object}
 */
function apiImpedimentComment(number, body) {
  var me = currentEmail_();
  return plainTalk(impedimentCommentAdd(number, body), me, 'impedimentNumber');
}

/**
 * 変更の履歴を返す (Web App API)。
 *
 * やることの履歴はスクラムがオフでも見られる (誰がいつ何を変えたかは、
 * スクラムに関係なく要る)。障害物とスプリントの履歴はオンのときだけ。
 *
 * @param {string} target 'issue:N' | 'impediment:N' | 'sprint:名前'
 * @returns {object[]}
 */
function apiHistory(target) {
  var key = String(target || '');
  if (!/^(issue|impediment|sprint):.+$/.test(key)) throw new Error('履歴の対象が正しくありません: ' + key);
  if (key.indexOf('issue:') !== 0) scrumAssertEnabled_();

  return historyOf_(key).slice(0, HISTORY_MAX_ROWS()).map(function (row) {
    var before = plainText(row.before);
    var after = plainText(row.after);
    return {
      id: plainId(row.id),
      at: plainDate(row.at),
      actor: plainText(row.actor),
      target: plainText(row.target),
      action: plainText(row.action),
      field: plainText(row.field),
      before: before,
      after: after,
      // 複数行の値 (補足・受入基準・解決策) は行ごとの差分で見せる。前と後を丸ごと
      // 並べると、長い補足のどこが変わったのかが読めない
      lines: historyLineDiff_(before, after),
    };
  });
}

/**
 * 変更の履歴を画面へ渡す上限 (行)。これより前は省略したと画面が書く。
 *
 * @returns {number}
 */
function HISTORY_MAX_ROWS() {
  return 500;
}

/**
 * 前と後の行ごとの差分。どちらも1行なら null (「前 → 後」で足りる)。
 *
 * 行が多すぎると差分の計算が重くなるので、どちらかが 500 行を超えたら null を
 * 返し、画面は前と後を丸ごと並べる。
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{op: string, text: string}>|null} op は 'same' | 'del' | 'add'
 */
function historyLineDiff_(before, after) {
  if (before.indexOf('\n') < 0 && after.indexOf('\n') < 0) return null;
  // 末尾の空の行も残す (splitLines は落とす)。落とすと、改行を足しただけの
  // 変更が差分に出ない
  var a = before === '' ? [] : before.split('\n');
  var b = after === '' ? [] : after.split('\n');
  if (a.length > 500 || b.length > 500) return null;

  var names = { equal: 'same', 'delete': 'del', insert: 'add' };
  return diffLines(a, b).map(function (op) {
    return { op: names[op.type], text: String(op.line) };
  });
}
