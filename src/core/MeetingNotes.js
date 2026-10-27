/**
 * Gemini のメモ (会議のあとに Drive に置かれる Google ドキュメント) を読む (ピュアな計算)。Drive・Docs・Calendar には触らない。
 * 探す・開く・やることを作るのは MeetingNotesImport.gs。
 *
 * - 印 (題名・見出し) は言語の設定で変わるので、表で持つ (MEETING_NOTE_TITLE_MARKS / MEETING_NOTE_STEP_HEADS)。
 *   **足すときはここだけを直す** (docs/dev/calendar.md の「Gemini のメモの取り込み」に表を写してある)
 * - 字の比べ方はどれも meetingNoteNorm を通す (全角・半角、大文字・小文字、空白と記号の違いを見ない)
 * - 同じ入力からは必ず同じ答えが出る
 */

/** Gemini のメモの題名に付く印 (Workspace の言語の設定で変わる) */
function MEETING_NOTE_TITLE_MARKS() {
  return ['Notes by Gemini', 'Gemini によるメモ', 'Gemini のメモ', 'Gemini メモ', 'Notas de Gemini', 'Notizen von Gemini',
    'Notes de Gemini'];
}

/** 決まったこと (次にすること) の見出しの印 */
function MEETING_NOTE_STEP_HEADS() {
  return ['Suggested next steps', 'Next steps', 'Action items', '推奨される次のステップ', '次のステップ',
    'アクション アイテム', 'アクションアイテム', '次にやること'];
}

/** 決まったことの節を閉じる見出し (Gemini のメモのほかの節) */
function MEETING_NOTE_OTHER_HEADS() {
  return ['Summary', 'Details', 'Transcript', 'まとめ', '概要', '詳細', '文字起こし'];
}

/** 取り込む行の上限 (1つのメモから)。読み違えたときに、やることが山ほどできないように */
function MEETING_NOTE_MAX_STEPS() {
  return 20;
}

/** やることの題名にする字数の上限 (それより長い行は切って、元の行は本文に入れる) */
function MEETING_NOTE_TITLE_MAX() {
  return 120;
}

/**
 * 比べるための形。全角・半角をそろえ、小文字にし、空白と記号を落とす。
 *
 * @param {*} s
 * @returns {string}
 */
function meetingNoteNorm(s) {
  var t = String(s === undefined || s === null ? '' : s);
  if (typeof t.normalize === 'function') t = t.normalize('NFKC');
  return t.toLowerCase()
    .replace(/[\s!-\/:-@\[-`{-~、。・「」『』（）［］【】〔〕！？：；，．…‥ー－—–‐〜～☐☑✓✔•●◦▪]/g, '');
}

/**
 * Gemini のメモの題名か。
 *
 * @param {string} title
 * @returns {boolean}
 */
function meetingNoteIsGemini(title) {
  var t = meetingNoteNorm(title);
  if (!t) return false;
  return MEETING_NOTE_TITLE_MARKS().some(function (m) { return t.indexOf(meetingNoteNorm(m)) >= 0; });
}

/**
 * 題名に入っている会議の日 ('YYYY-MM-DD')。無ければ ''。Gemini のメモの題名は「会議名 - 2026/10/27 10:00 JST - …」の形。
 *
 * @param {string} title
 * @returns {string}
 */
function meetingNoteDayOf(title) {
  var m = /(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/.exec(String(title || ''));
  if (!m) return '';
  var mo = Number(m[2]);
  var d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

/**
 * メモを予定に結び付ける。題名に予定の名前が入っていて、題名の日 (無ければメモの時刻) に近い予定のうち、
 * メモの時刻にいちばん近いもの。結び付かなければ -1 (会議不明)。
 *
 * - 題名に日があれば、その日 (東京の暦日) に始まった予定だけ
 * - 無ければ、メモの時刻が予定の始まりの2時間前から終わりの24時間後までに入る予定だけ
 * - 予定の名前は2字以上 (1字の名前はどの題名にも入ってしまう)
 *
 * @param {string} title メモの題名
 * @param {number} timeMs メモを作った (無ければ更新した) 時刻
 * @param {Array<{title: string, start: number, end: number}>} events
 * @returns {number} events の添字
 */
function meetingNoteMatchEvent(title, timeMs, events) {
  var t = meetingNoteNorm(title);
  var day = meetingNoteDayOf(title);
  var best = -1;
  var bestGap = Infinity;
  (events || []).forEach(function (ev, i) {
    var name = meetingNoteNorm(ev && ev.title);
    if (name.length < 2 || t.indexOf(name) < 0) return;
    if (day) {
      if (calendarDayOf(ev.start) !== day) return;
    } else if (!(timeMs >= ev.start - 2 * 3600000 && timeMs <= ev.end + 24 * 3600000)) {
      return;
    }
    var gap = Math.abs(timeMs - ev.end);
    // 同じ近さなら名前の長いほう (「定例」より「営業の定例」)
    if (gap < bestGap || (gap === bestGap && best >= 0 && name.length > meetingNoteNorm(events[best].title).length)) {
      best = i;
      bestGap = gap;
    }
  });
  return best;
}

/**
 * 見出しの印に当たるか。短い行だけを見る (本文の文の中に「次のステップ」とあっても見出しにしない)。
 *
 * @param {string} text
 * @param {string[]} marks
 * @returns {boolean}
 */
function meetingNoteHeadIs_(text, marks) {
  var t = meetingNoteNorm(text);
  if (!t || t.length > 30) return false;
  return marks.some(function (m) {
    var n = meetingNoteNorm(m);
    // 「推奨される次のステップ」のように、頭に少しだけ添えた見出しも当てる (後ろに続く字のある行は見出しにしない)
    return t === n || (t.length <= n.length + 8 && t.slice(-n.length) === n);
  });
}

/**
 * 行の頭の箇条書きの印 (・ - * 1. ☐ [ ] など) を落とす。
 *
 * @param {string} line
 * @returns {string}
 */
function meetingNoteStripBullet(line) {
  var s = String(line || '').replace(/^\s+|\s+$/g, '');
  var before;
  do {
    before = s;
    s = s.replace(/^(?:[-*•・●◦▪☐☑✓✔]|\d{1,2}[.)．）]|\[\s?[xX✓]?\s?\])\s*/, '');
  } while (s !== before);
  return s.replace(/^\s+|\s+$/g, '');
}

/**
 * 本文の段落の並びから、決まったこと (次にすること) の行を取り出す。
 *
 * 見出しの印 (MEETING_NOTE_STEP_HEADS) の段落の次から、別の見出し (見出しの書式か、ほかの節の印) までの段落を
 * 1行ずつ拾う。箇条書きの行を拾ったあとに箇条書きでない段落が来たら、そこで閉じる (節の終わりの添え書きを拾わない)。
 * Gemini 自身の添え書き (「Gemini」を含む行) は拾わない。印の節が2つあれば両方から拾う。
 *
 * @param {Array<{text: string, heading?: boolean, list?: boolean}>} paras
 * @returns {string[]} 箇条書きの印を落とした行 (同じ行は1つ)
 */
function meetingNoteSteps(paras) {
  var out = [];
  var seen = {};
  var inSteps = false;
  var tookList = false;
  (paras || []).forEach(function (p) {
    var text = String((p && p.text) || '').replace(/^\s+|\s+$/g, '');
    if (!text) return;
    if (meetingNoteHeadIs_(text, MEETING_NOTE_STEP_HEADS())) {
      inSteps = true;
      tookList = false;
      return;
    }
    if (!inSteps) return;
    if ((p && p.heading) || meetingNoteHeadIs_(text, MEETING_NOTE_OTHER_HEADS())) {
      inSteps = false;
      return;
    }
    if (p && p.list) {
      tookList = true;
    } else if (tookList) {
      inSteps = false;
      return;
    }
    // 中身の無い行と、Gemini の添え書き (「Gemini が作成したメモは…」) は拾わない
    var line = meetingNoteStripBullet(text);
    if (!line || /gemini/i.test(line)) return;
    var key = meetingNoteNorm(line);
    if (!key || seen[key] || out.length >= MEETING_NOTE_MAX_STEPS()) return;
    seen[key] = true;
    out.push(line);
  });
  return out;
}

/**
 * 行に書かれた担当の名前の候補。「@名前」「名前: …」「[名前] …」「名前さんが / は …」「Name will …」。
 *
 * @param {string} line 箇条書きの印を落とした行
 * @returns {string[]} 見つかった順 (重なりなし)
 */
function meetingNoteAssigneeNames(line) {
  var s = String(line || '');
  var out = [];
  function add(v) {
    var n = String(v || '').replace(/^\s+|\s+$/g, '');
    if (n && n.length <= 40 && out.indexOf(n) < 0) out.push(n);
  }
  var at = /@([^\s@、,，。:：]+(?:[ 　][^\s@、,，。:：]+)?)/.exec(s);
  if (at) {
    // 「@山田 太郎」の2語と、「@山田」の1語の両方を候補にする
    add(at[1]);
    add(at[1].split(/[ 　]/)[0]);
  }
  var bracket = /^\[([^\]]{1,40})\]/.exec(s);
  if (bracket) add(bracket[1]);
  var colon = /^([^:：、,，。@\[\]]{1,30})[:：]/.exec(s);
  if (colon) add(colon[1]);
  var san = /^([^、,，。@\s]{1,20}(?:[ 　][^、,，。@\s]{1,20})?)\s?さん(?:が|は|に|より)/.exec(s);
  if (san) add(san[1]);
  var will = /^([A-Za-z][\w.'\-]*(?: [A-Za-z][\w.'\-]*){0,2}) will /i.exec(s);
  if (will) add(will[1]);
  return out;
}

/**
 * 担当の名前の候補を、人の表 ({email, name}) に当てる。名前 (空白を見ない) が同じ人か、名前が候補で始まる人が
 * 1人だけのとき、その人のアドレス。当たらない・何人も当たるときは ''。
 *
 * @param {string[]} names meetingNoteAssigneeNames
 * @param {Array<{email: string, name: string}>} people
 * @returns {string}
 */
function meetingNoteAssigneeOf(names, people) {
  var list = (people || []).filter(function (p) { return p && p.email && meetingNoteNorm(p.name); });
  for (var i = 0; i < (names || []).length; i++) {
    var want = meetingNoteNorm(names[i]);
    if (!want) continue;
    var exact = list.filter(function (p) { return meetingNoteNorm(p.name) === want; });
    if (exact.length === 1) return String(exact[0].email);
    if (exact.length > 1) continue;
    // 「山田」で「山田 太郎」に当てる (同じ苗字の人が2人いれば当てない)
    var head = want.length >= 2 ? list.filter(function (p) { return meetingNoteNorm(p.name).indexOf(want) === 0; }) : [];
    if (head.length === 1) return String(head[0].email);
  }
  return '';
}

/**
 * やることの題名。長ければ切る。
 *
 * @param {string} line
 * @returns {string}
 */
function meetingNoteTitleOf(line) {
  var s = String(line || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  var max = MEETING_NOTE_TITLE_MAX();
  return s.length > max ? s.substring(0, max - 1) + '…' : s;
}
