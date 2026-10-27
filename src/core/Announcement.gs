/*
 * 管理者が置くお知らせ・1問アンケート・案内 (社内イベント・社内システム)。
 *
 * ホームの上に1つずつ出し、本人が「読んだ」「答えた」「閉じる」をすれば次の機会にはもう出ない。
 * 台帳は announcements (置いたもの) と announcement_replies (誰がどう片づけたか)。
 *
 * - **作る・終えるは管理者だけ** (repoAssertAdmin_)。答えの数も管理者だけが見る
 * - **誰が何と答えたかは返さない。** 返すのは選択肢ごとの数だけ (台帳には誰が答えたかが残る。
 *   台帳を Drive で開ける人は直に読める。docs/dev/permissions.md)
 * - **答えは1人1回。** 「答えがあるか見てから書く」を1つの鍵の中で行う (docs/dev/locks-and-numbering.md)
 * - 読んだ印は answer ''、閉じた印は 'closed'、アンケートの答えは選んだ選択肢の字
 * - 本文は平文 (改行だけ)。画面は textContent で置く (他人が書いた字)
 */

/** @returns {string[]} 種類。notice = お知らせ・poll = 1問アンケート・ad = 案内 */
function ANNOUNCEMENT_KINDS() {
  return ['notice', 'poll', 'ad'];
}

/** 閉じた印 (答えの欄に入れる) */
function ANNOUNCEMENT_CLOSED() {
  return 'closed';
}

/** 字数と選択肢の上限 */
function ANNOUNCEMENT_LIMITS() {
  return { title: 80, body: 2000, option: 40, optionsMin: 2, optionsMax: 10 };
}

/** @returns {string} 東京の今日 'yyyy-MM-dd' */
function announcementToday_() {
  return usageDay(new Date());
}

/**
 * アンケートの選択肢を読む。台帳には JSON の配列で書く (手で `a|b` と書いたものも読む)。
 *
 * @param {*} v
 * @returns {string[]}
 */
function announcementOptionsOf_(v) {
  var text = String(v == null ? '' : v).trim();
  if (!text) return [];
  if (text.charAt(0) === '[') {
    try {
      var arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.map(function (o) { return String(o); }).filter(function (o) { return o !== ''; });
    } catch (e) {
      // 読めなければ区切りの形として読む
    }
  }
  return text.split('|').map(function (o) { return o.trim(); }).filter(function (o) { return o !== ''; });
}

/**
 * 画面から届いた選択肢を並びにする。並びでも、`|` か改行で区切った字でもよい。
 *
 * @param {*} v
 * @returns {string[]}
 */
function announcementOptionsInput_(v) {
  var list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[|\n]/);
  return list.map(function (o) { return String(o == null ? '' : o).trim(); }).filter(function (o) { return o !== ''; });
}

/**
 * 期間の日。'yyyy-MM-dd' か空。人が台帳を直に書いて Date になっていても日として読む。
 *
 * @param {*} v
 * @returns {string}
 */
function announcementDayOf_(v) {
  return plainDay(v);
}

/**
 * いま出してよいか (終えていない・期間の中)。
 *
 * @param {object} row announcements の行
 * @param {string} today 'yyyy-MM-dd'
 * @returns {boolean}
 */
function announcementActive_(row, today) {
  if (!row || row.archivedAt) return false;
  var start = announcementDayOf_(row.startAt);
  var end = announcementDayOf_(row.endAt);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/**
 * 作る中身を確かめて、台帳に書く形にする。
 *
 * @param {object} fields {kind, title, body, options, startAt, endAt}
 * @returns {object}
 */
function announcementValidate_(fields) {
  var f = fields || {};
  var lim = ANNOUNCEMENT_LIMITS();
  var kind = String(f.kind || '');
  if (ANNOUNCEMENT_KINDS().indexOf(kind) < 0) {
    throw new Error('種類は「お知らせ」「アンケート」「案内」のどれかにしてください');
  }
  var title = String(f.title == null ? '' : f.title).trim();
  if (!title) throw new Error('題名を入れてください');
  if (title.length > lim.title) throw new Error('題名は' + lim.title + '字までにしてください');
  // 本文は平文。改行の形だけそろえる
  var body = String(f.body == null ? '' : f.body).replace(/\r\n?/g, '\n').trim();
  if (body.length > lim.body) throw new Error('本文は' + lim.body + '字までにしてください');

  var options = [];
  if (kind === 'poll') {
    options = announcementOptionsInput_(f.options);
    if (options.length < lim.optionsMin || options.length > lim.optionsMax) {
      throw new Error('アンケートの選択肢は' + lim.optionsMin + '〜' + lim.optionsMax + '個にしてください');
    }
    options.forEach(function (o, i) {
      if (o.length > lim.option) throw new Error('選択肢は1つ' + lim.option + '字までにしてください');
      if (o === ANNOUNCEMENT_CLOSED()) throw new Error('その字は選択肢に使えません: ' + o);
      if (options.indexOf(o) !== i) throw new Error('同じ選択肢を2つ入れないでください: ' + o);
    });
  }

  var start = String(f.startAt == null ? '' : f.startAt).trim();
  var end = String(f.endAt == null ? '' : f.endAt).trim();
  [start, end].forEach(function (d) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('期間は 2026-11-01 の形で入れてください');
  });
  if (start && end && end < start) throw new Error('終わりの日は始まりの日より後にしてください');

  return { kind: kind, title: title, body: body, options: options, startAt: start, endAt: end };
}

/**
 * お知らせを置く。管理者だけ。
 *
 * @param {object} fields
 * @param {string} who 置いた人 (管理者)
 * @returns {object} 書いた行
 */
function announcementCreate_(fields, who) {
  repoAssertAdmin_('お知らせを置くこと', who);
  var v = announcementValidate_(fields);
  return dbAppendNumbered('announcements', 'id', {
    kind: v.kind, title: v.title, body: v.body,
    options: v.options.length ? JSON.stringify(v.options) : '',
    startAt: v.startAt, endAt: v.endAt,
    createdBy: String(who || '').toLowerCase(), createdAt: new Date(), archivedAt: '',
  });
}

/**
 * お知らせを終える (もう誰にも出さない)。管理者だけ。答えの数は残す。
 *
 * @param {number} id
 * @param {string} who
 * @returns {object} 終えたあとの行
 */
function announcementArchive_(id, who) {
  repoAssertAdmin_('お知らせを終えること', who);
  return dbWithLock_(30000, function () {
    var row = dbFindOne('announcements', 'id', Number(id));
    if (!row) throw new Error('お知らせが見つかりません: ' + id);
    if (!row.archivedAt) {
      row.archivedAt = new Date();
      dbUpdate('announcements', 'id', Number(id), { archivedAt: row.archivedAt });
    }
    return row;
  });
}

/**
 * 本人がまだ片づけていない・いま出してよいものを、古い順 (番号の小さい順) に1つ。無ければ null。
 *
 * @param {string} who
 * @returns {object|null} announcements の行
 */
function announcementNext_(who) {
  var me = String(who || '').toLowerCase();
  if (!me) return null;
  var today = announcementToday_();
  var done = {};
  dbReadAll('announcement_replies').forEach(function (r) {
    if (String(r.who || '').toLowerCase() === me) done[String(r.announcementId)] = true;
  });
  var rows = dbReadAll('announcements').filter(function (r) {
    return announcementActive_(r, today) && !done[String(r.id)];
  });
  rows.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return rows.length ? rows[0] : null;
}

/**
 * 読んだ・答えた・閉じたを残す。**1人1回。** 2回目は書かずに、前に残したものを返す
 * (押し直しや2つのタブで、同じ人の答えが2つ数えられないように)。
 *
 * @param {number} id
 * @param {string} answer '' (読んだ) / 'closed' (閉じた) / アンケートの選択肢
 * @param {string} who
 * @returns {{id: number, answer: string, already: boolean}}
 */
function announcementReply_(id, answer, who) {
  var me = String(who || '').toLowerCase();
  if (!me) throw new Error('だれが答えたのか分かりません。開き直してください');
  var n = Number(id);
  var ans = String(answer == null ? '' : answer);

  return dbWithLock_(30000, function () {
    var row = dbFindOne('announcements', 'id', n);
    if (!row) throw new Error('お知らせが見つかりません: ' + id);
    // 答えがあるかを見てから書くまでを、1つの鍵の中で行う
    var mine = dbReadAll('announcement_replies').filter(function (r) {
      return String(r.announcementId) === String(n) && String(r.who || '').toLowerCase() === me;
    })[0];
    if (mine) return { id: n, answer: String(mine.answer == null ? '' : mine.answer), already: true };

    if (!announcementActive_(row, announcementToday_())) {
      throw new Error('このお知らせはもう終わっています');
    }
    if (ans !== ANNOUNCEMENT_CLOSED()) {
      if (row.kind === 'poll') {
        if (announcementOptionsOf_(row.options).indexOf(ans) < 0) throw new Error('選択肢にない答えです');
      } else if (ans !== '') {
        throw new Error('このお知らせには答えられません');
      }
    }
    dbAppendNumbered('announcement_replies', 'id', { announcementId: n, who: me, answer: ans, at: new Date() });
    return { id: n, answer: ans, already: false };
  });
}

/**
 * 管理者の一覧。答えは選択肢ごとの数だけ (**誰が答えたかは入れない**)。新しい順。
 *
 * @param {string} who
 * @returns {object[]}
 */
function announcementList_(who) {
  repoAssertAdmin_('お知らせの答えを見ること', who);
  var today = announcementToday_();
  var replies = {};
  dbReadAll('announcement_replies').forEach(function (r) {
    var k = String(r.announcementId);
    (replies[k] = replies[k] || []).push(String(r.answer == null ? '' : r.answer));
  });
  var rows = dbReadAll('announcements').slice();
  rows.sort(function (a, b) { return Number(b.id) - Number(a.id); });
  return rows.map(function (r) {
    var options = announcementOptionsOf_(r.options);
    var answers = replies[String(r.id)] || [];
    var counts = options.map(function (o) {
      return { option: o, count: answers.filter(function (a) { return a === o; }).length };
    });
    return {
      row: r, options: options, counts: counts,
      read: answers.filter(function (a) { return a === ''; }).length,
      closed: answers.filter(function (a) { return a === ANNOUNCEMENT_CLOSED(); }).length,
      total: answers.length,
      active: announcementActive_(r, today),
    };
  });
}
