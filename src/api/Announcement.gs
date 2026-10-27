/*
 * 画面の API: お知らせ・1問アンケート・案内 (src/core/Announcement.gs)。
 *
 * ホームの上に1つずつ出す (apiAnnouncementNext)。作る・終える・答えの数を見るのは管理者だけ。
 * **誰が何と答えたかは返さない。** アドレスを受ける関数は末尾 _ の側に置く。
 */

/**
 * 画面に渡す形 (本人に出すもの)。置いた人のアドレスは入れない。
 *
 * @param {object} r announcements の行
 * @returns {object}
 */
function announcementPlain_(r) {
  return {
    id: plainId(r.id), kind: plainText(r.kind), title: plainText(r.title), body: plainText(r.body),
    options: r.kind === 'poll' ? announcementOptionsOf_(r.options).map(plainText) : [],
    startAt: plainText(announcementDayOf_(r.startAt)), endAt: plainText(announcementDayOf_(r.endAt)),
  };
}

/**
 * 本人がまだ片づけていない、いま出してよいお知らせを1つ (古い順)。無ければ null。
 *
 * @returns {object|null}
 */
function apiAnnouncementNext() {
  var row = announcementNext_(currentEmail_());
  return row ? announcementPlain_(row) : null;
}

/**
 * 読んだ ('')・閉じた ('closed')・アンケートの答え (選択肢の字) を残す。1人1回。
 *
 * @param {number} id
 * @param {string} answer
 * @returns {{id: number, answer: string, already: boolean}}
 */
function apiAnnouncementReply(id, answer) {
  var out = announcementReply_(id, answer, currentEmail_());
  return { id: plainId(out.id), answer: plainText(out.answer), already: !!out.already };
}

/**
 * 管理者の一覧 (新しい順)。答えは選択肢ごとの数・読んだ数・閉じた数だけ。名前もアドレスも入れない。
 *
 * @returns {{items: object[]}}
 */
function apiAnnouncementList() {
  var list = announcementList_(currentEmail_());
  return {
    items: list.map(function (x) {
      var p = announcementPlain_(x.row);
      p.options = x.options.map(plainText);
      p.counts = x.counts.map(function (c) { return { option: plainText(c.option), count: plainNumber(c.count) }; });
      p.read = plainNumber(x.read);
      p.closed = plainNumber(x.closed);
      p.total = plainNumber(x.total);
      p.active = !!x.active;
      p.archived = !!x.row.archivedAt;
      p.createdAt = plainDate(x.row.createdAt);
      return p;
    }),
  };
}

/**
 * お知らせを置く。管理者だけ。
 *
 * @param {{kind: string, title: string, body: string, options: (string|string[]), startAt: string, endAt: string}} fields
 * @returns {{items: object[]}} 置いたあとの一覧
 */
function apiAnnouncementCreate(fields) {
  announcementCreate_(fields, currentEmail_());
  return apiAnnouncementList();
}

/**
 * お知らせを終える。管理者だけ。答えの数は残る。
 *
 * @param {number} id
 * @returns {{items: object[]}} 終えたあとの一覧
 */
function apiAnnouncementArchive(id) {
  announcementArchive_(id, currentEmail_());
  return apiAnnouncementList();
}
