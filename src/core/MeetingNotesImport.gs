/**
 * Gemini のメモ (会議のあとに Drive に置かれる Google ドキュメント) から、決まったことをやることにする。
 * 読み方 (ピュア) は MeetingNotes.js。
 *
 * - **使うのは標準の DriveApp / DocumentApp / CalendarApp だけ** (外の API は使わない)。Web アプリは executeAs: USER_ACCESSING
 *   なので、どれも**開いている本人の権限**で見る (本人が開けるメモと、本人の既定のカレンダーだけ)
 * - 探す: Drive で、ここ数日 (既定7日) に更新された Google ドキュメントのうち題名に「Gemini」を含むものを探し、
 *   題名の印 (MEETING_NOTE_TITLE_MARKS) で絞る。Gemini のメモは Workspace の機能なので、個人の Gmail では1つも見つからず、
 *   何も起きない
 * - 結び付ける: 同じ日数ぶんの本人の既定のカレンダーの予定から、題名に名前が入っていて日が合うものを選ぶ
 *   (meetingNoteMatchEvent)。結び付かなければ会議不明として扱い、会議の長さは残さない
 * - 読む: 本文の「次のステップ」などの見出しの下の箇条書きを1行ずつ (meetingNoteSteps)。1行 = やること1つ
 * - **二度取り込まない**: 台帳の meeting_notes に文書の id ごとに1行。鍵 (dbWithLock_) の中で「あるか見てから書く」。
 *   やることを作るのは鍵の外 (何件も作るので、鍵を長く持たない)。作り終えたら番号を書き足す
 * - すでに同じ題名のやることがあれば作らず「取り込み済み」に数える (meetingNoteNorm で比べる)
 */

/** 探す日数の既定と上限 */
function MEETING_NOTES_DAYS_() {
  return { def: 7, max: 14 };
}

/** 1回に読むメモの上限 (Drive と Docs を開く数がそのまま待ち時間になる) */
function MEETING_NOTES_MAX_DOCS_() {
  return 20;
}

/** 今。テストが差し替える */
function meetingNotesNow_() {
  return new Date();
}

/**
 * 探す日数を 1〜上限にそろえる。
 *
 * @param {*} days
 * @returns {number}
 */
function meetingNotesDays_(days) {
  var d = Math.floor(Number(days));
  var lim = MEETING_NOTES_DAYS_();
  if (!(d >= 1)) return lim.def;
  return Math.min(d, lim.max);
}

/**
 * Drive で Gemini のメモを探す。新しい順ではなく Drive の返す順で、上限まで。
 *
 * @param {number} sinceMs
 * @returns {Array<{id: string, title: string, url: string, timeMs: number}>}
 */
function meetingNotesFind_(sinceMs) {
  var since = new Date(sinceMs).toISOString();
  // 題名の印は言語で変わるが、どれも「Gemini」を含む。Drive の検索は語の頭で当てるので、そこだけで探して手元で絞る
  var q = "mimeType = 'application/vnd.google-apps.document' and trashed = false and modifiedDate > '" + since +
    "' and title contains 'Gemini'";
  var it = DriveApp.searchFiles(q);
  var out = [];
  var looked = 0;
  while (it.hasNext() && out.length < MEETING_NOTES_MAX_DOCS_() && looked < MEETING_NOTES_MAX_DOCS_() * 5) {
    var f = it.next();
    looked++;
    var title = String(f.getName() || '');
    if (!meetingNoteIsGemini(title)) continue;
    var at = null;
    try { at = f.getDateCreated ? f.getDateCreated() : null; } catch (e) { at = null; }
    if (!at) at = f.getLastUpdated();
    out.push({ id: String(f.getId()), title: title, url: String(f.getUrl() || ''), timeMs: new Date(at).getTime() });
  }
  return out;
}

/**
 * 本人の既定のカレンダーの予定 (終日を除く)。読めなければ空 (会議不明として取り込む)。
 *
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Array<{title: string, start: number, end: number}>}
 */
function meetingNotesEvents_(fromMs, toMs) {
  try {
    return CalendarApp.getDefaultCalendar().getEvents(new Date(fromMs), new Date(toMs))
      .filter(function (ev) { return !ev.isAllDayEvent(); })
      .map(function (ev) {
        return { title: String(ev.getTitle() || ''), start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() };
      });
  } catch (e) {
    Logger.log('Gemini のメモに結び付ける予定を読めませんでした: ' + e.message);
    return [];
  }
}

/**
 * メモの本文を段落の並びにする ({text, heading, list})。
 *
 * @param {string} id
 * @returns {Array<{text: string, heading: boolean, list: boolean}>}
 */
function meetingNotesParas_(id) {
  var body = DocumentApp.openById(id).getBody();
  var ET = DocumentApp.ElementType;
  var NORMAL = DocumentApp.ParagraphHeading.NORMAL;
  var out = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var child = body.getChild(i);
    var t = child.getType();
    if (t === ET.LIST_ITEM) {
      out.push({ text: String(child.asListItem().getText() || ''), heading: false, list: true });
    } else if (t === ET.PARAGRAPH) {
      var p = child.asParagraph();
      var h = p.getHeading();
      out.push({ text: String(p.getText() || ''), heading: !!h && h !== NORMAL, list: false });
    }
  }
  return out;
}

/**
 * 東京の 'YYYY/M/D H:mm'。
 *
 * @param {number} ms
 * @returns {string}
 */
function meetingNotesWhen_(ms) {
  var t = new Date(ms + CAL_TZ_OFFSET_MIN() * 60000);
  var m = t.getUTCMinutes();
  return t.getUTCFullYear() + '/' + (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + ' ' + t.getUTCHours() + ':' +
    (m < 10 ? '0' : '') + m;
}

/**
 * やることの本文。会議名・日時・メモの URL・元の行。
 *
 * @param {{title: string, url: string}} doc
 * @param {?{title: string, start: number, end: number}} ev
 * @param {string} line
 * @returns {string}
 */
function meetingNotesBody_(doc, ev, line) {
  return [
    'Gemini のメモから取り込みました。',
    '会議: ' + (ev ? ev.title : '不明 (予定に結び付きませんでした)'),
    '日時: ' + (ev ? meetingNotesWhen_(ev.start) + ' (' + Math.round((ev.end - ev.start) / 60000) + '分)' : '不明'),
    'メモ: ' + (doc.url || doc.title),
    '元の行: ' + line,
  ].join('\n');
}

/**
 * 取り込む印を付ける。**鍵の中で「あるか見てから書く」** (分けると、2つの画面が同じメモを両方取り込む)。
 *
 * @param {object} row meeting_notes の行 (issueNumbers は空)
 * @returns {boolean} 付けた (false ならもう取り込まれている)
 */
function meetingNotesClaim_(row) {
  return dbWithLock_(30000, function () {
    if (dbFindOne('meeting_notes', 'docId', row.docId)) return false;
    dbAppend('meeting_notes', row);
    return true;
  });
}

/**
 * やることを1つ作る (作る → ボードに置く → 担当)。
 *
 * @param {string} title
 * @param {string} body
 * @param {string} assignee
 * @returns {number}
 */
function meetingNotesCreateIssue_(title, body, assignee) {
  var issue = issueCreate(title, body, [], '');
  projectPlace(issue.number, 'Backlog');
  if (assignee) issueUpdate(issue.number, { assignee: assignee });
  return Number(issue.number);
}

/**
 * Gemini のメモを取り込む。本人 (who) の権限で見えるメモと、本人の既定のカレンダーだけを見る。
 *
 * @param {string} who 小文字のアドレス (担当が当たらないときの担当)
 * @param {*} days 何日前から探すか
 * @param {{auto?: boolean}} [opts] auto は画面を開いたときの自動 (1日1回)
 * @returns {{ok: boolean, reason: string, skipped: boolean, found: number, notes: number, created: number,
 *   already: number, unmatched: number, items: Array<{number: number, title: string, assignee: string}>}}
 */
function meetingNotesImport_(who, days, opts) {
  var out = { ok: true, reason: '', skipped: false, found: 0, notes: 0, created: 0, already: 0, unmatched: 0, items: [] };
  var me = String(who || '').toLowerCase();
  if (!me) {
    out.ok = false;
    out.reason = '開いている人が分からないので、取り込めません';
    return out;
  }
  var now = meetingNotesNow_().getTime();
  if (opts && opts.auto) {
    if (meetingNotesAutoDone_(me, now)) {
      out.skipped = true;
      return out;
    }
    // 先に印を付ける (途中で落ちても、その日のうちに何度も探さない。二度取り込まないのは台帳の印が守る)
    meetingNotesAutoMark_(me, now);
  }
  var span = meetingNotesDays_(days);
  var since = now - span * 86400000;
  var docs;
  try {
    docs = meetingNotesFind_(since);
  } catch (e) {
    Logger.log('Gemini のメモを探せませんでした: ' + e.message);
    out.ok = false;
    out.reason = 'Drive を探せませんでした。少し待ってからもう一度押してください';
    return out;
  }
  out.found = docs.length;
  if (!docs.length) return out;

  var events = meetingNotesEvents_(since - 86400000, now);
  var people = dbReadAll('members').map(function (r) { return { email: String(r.email || ''), name: String(r.name || '') }; });
  var known = {};
  dbReadAll('issues').forEach(function (r) {
    var k = meetingNoteNorm(r.title);
    if (k) known[k] = true;
  });
  var done = {};
  dbReadAll('meeting_notes').forEach(function (r) { done[String(r.docId)] = true; });

  docs.forEach(function (doc) {
    // 先に覚えから見て、取り込み済みのメモは開かない (鍵の中でもう一度見る)
    if (done[doc.id]) {
      out.already++;
      return;
    }
    var lines;
    try {
      lines = meetingNoteSteps(meetingNotesParas_(doc.id));
    } catch (e) {
      // 開けないメモ (権限が外れた・消された) は飛ばす。印は付けないので、開けるようになれば次に取り込む
      Logger.log('Gemini のメモを開けませんでした: ' + e.message);
      return;
    }
    var hit = meetingNoteMatchEvent(doc.title, doc.timeMs, events);
    var ev = hit >= 0 ? events[hit] : null;
    var row = {
      docId: doc.id,
      title: doc.title,
      meeting: ev ? ev.title : '',
      meetingAt: ev ? new Date(ev.start) : '',
      minutes: ev ? Math.round((ev.end - ev.start) / 60000) : '',
      importedBy: me,
      importedAt: new Date(now),
      issueNumbers: '',
    };
    if (!meetingNotesClaim_(row)) {
      out.already++;
      return;
    }
    out.notes++;
    if (!ev) out.unmatched++;
    var numbers = [];
    lines.forEach(function (line) {
      var title = meetingNoteTitleOf(line);
      var key = meetingNoteNorm(title);
      if (!key) return;
      if (known[key]) {
        out.already++;
        return;
      }
      var assignee = meetingNoteAssigneeOf(meetingNoteAssigneeNames(line), people) || me;
      try {
        var n = meetingNotesCreateIssue_(title, meetingNotesBody_(doc, ev, line), assignee);
        known[key] = true;
        numbers.push(n);
        out.created++;
        out.items.push({ number: n, title: title, assignee: assignee });
      } catch (e) {
        // 1つ作れなくても残りは作る (作れなかった行は台帳の印で二度目に回らないので、記録に残す)
        Logger.log('Gemini のメモの行からやることを作れませんでした: ' + e.message);
      }
    });
    if (numbers.length) {
      try {
        dbUpdate('meeting_notes', 'docId', doc.id, { issueNumbers: numbers.join(',') });
      } catch (e) {
        // やることはできている。番号の並びが残らないだけ (二度取り込まないのは行があることで守る)
        Logger.log('取り込んだメモの記録に番号を書けませんでした: ' + e.message);
      }
    }
  });
  // 会議の時間の欄の「議事録のある会議」を、覚え (30分) を待たずに数え直させる
  if (out.notes && typeof meetingCacheKey_ === 'function') {
    try { CacheService.getScriptCache().remove(meetingCacheKey_(me, now)); } catch (e) { /* 覚えが切れるのを待つだけ */ }
  }
  return out;
}

/** 自動の取り込みの覚え (本人の UserProperties。値は東京の暦日) */
function meetingNotesAutoKey_(who) {
  return 'MNOTES_AUTO:' + String(who || '').toLowerCase();
}

/**
 * その日にもう自動で取り込んだか。
 *
 * @param {string} who
 * @param {number} nowMs
 * @returns {boolean}
 */
function meetingNotesAutoDone_(who, nowMs) {
  try {
    return PropertiesService.getUserProperties().getProperty(meetingNotesAutoKey_(who)) === calendarDayOf(nowMs);
  } catch (e) {
    return false;
  }
}

/** @param {string} who @param {number} nowMs */
function meetingNotesAutoMark_(who, nowMs) {
  try {
    PropertiesService.getUserProperties().setProperty(meetingNotesAutoKey_(who), calendarDayOf(nowMs));
  } catch (e) {
    Logger.log('自動の取り込みの日を覚えられませんでした: ' + e.message);
  }
}

/**
 * 議事録のある会議を見分ける鍵の集まり (会議の名前と始まりの時刻)。会議の時間の欄が「議事録のある会議」を足すのに使う。
 * 読めなければ空。
 *
 * @returns {Object<string, boolean>}
 */
function meetingNotesNotedKeys_() {
  var out = {};
  try {
    dbReadAll('meeting_notes').forEach(function (r) {
      var at = r.meetingAt instanceof Date ? r.meetingAt.getTime() : Date.parse(String(r.meetingAt || ''));
      if (!r.meeting || isNaN(at)) return;
      out[meetingNotesEventKey_(r.meeting, at)] = true;
    });
  } catch (e) {
    Logger.log('取り込んだメモの記録を読めませんでした: ' + e.message);
  }
  return out;
}

/**
 * @param {string} title
 * @param {number} startMs
 * @returns {string}
 */
function meetingNotesEventKey_(title, startMs) {
  return meetingNoteNorm(title) + '|' + Number(startMs);
}

/**
 * 手元からの命令 (meetingNotesImport)。キューは仕掛けた人の権限で回り、見える Drive と予定はその人のものなので、
 * **置いた人が仕掛けた人のときだけ**取り込む (ほかの人の命令で、仕掛けた人のメモを取り込まない)。
 *
 * @param {string} by 命令を置いた人
 * @param {*} days
 * @returns {object} meetingNotesImport_ の返事
 */
function meetingNotesForQueue_(by, days) {
  var runner = currentEmailLower_();
  if (!runner || String(by || '').toLowerCase() !== runner) {
    throw new Error('手元からの取り込みは、命令キューを仕掛けた人のメモだけです。画面の「Gemini のメモを取り込む」を押してください');
  }
  return meetingNotesImport_(runner, days, {});
}

/**
 * 画面・手元に返す形。
 *
 * @param {object} r meetingNotesImport_ の返事
 * @returns {object}
 */
function meetingNotesPlain_(r) {
  return {
    ok: !!r.ok,
    reason: plainText(r.reason),
    skipped: !!r.skipped,
    found: plainNumber(r.found),
    notes: plainNumber(r.notes),
    created: plainNumber(r.created),
    already: plainNumber(r.already),
    unmatched: plainNumber(r.unmatched),
    items: (r.items || []).map(function (i) {
      return { number: plainNumber(i.number), title: plainText(i.title), assignee: plainText(i.assignee) };
    }),
  };
}
