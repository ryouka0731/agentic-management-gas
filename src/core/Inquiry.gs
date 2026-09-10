/**
 * 不具合の報告と問い合わせ。
 *
 * 使っていて困ったことを、その場から送れるようにする。口頭やメールで
 * 伝えられた報告は集まらないまま消える。メタDBに貯めれば、誰が何に
 * つまずいたかが残り、直す順番を決められる。
 */

/**
 * 報告の種類。
 *
 * @returns {Object<string,string>} 値 → 画面に出す名前
 */
/**
 * 受け取れる画像の形と、1枚あたりの上限。
 *
 * 何でも受け取ると、動画や実行ファイルを置き場にできてしまう。
 *
 * @returns {{mimes: Object<string,string>, maxBytes: number, maxCount: number}}
 */
function INQUIRY_SHOT_LIMITS() {
  return {
    mimes: {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    },
    maxBytes: 5 * 1024 * 1024,
    maxCount: 4,
  };
}

function INQUIRY_KINDS() {
  return {
    bug: 'うまく動かない',
    request: 'こうしてほしい (機能の要望)',
    question: '使い方が分からない',
    other: 'その他',
  };
}

/**
 * 種類ごとに、開発者のやることに付けるタグ。
 *
 * @returns {Object<string,string>}
 */
function INQUIRY_TAGS() {
  return {
    bug: '不具合',
    request: '要望',
    question: '問合せ対応',
    other: '問合せ対応',
  };
}

/**
 * 次の受付番号を返す。
 *
 * @returns {number}
 */
function inquiryNextNumber_() {
  var rows = dbReadAll('inquiries');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].number);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * 報告を受け付ける。
 *
 * 送った本人が誰かは画面から受け取らない。名乗りを詐称できてしまう。
 *
 * @param {string} kind INQUIRY_KINDS のいずれか
 * @param {string} body 本文
 * @param {string} [context] どの画面から送られたか
 * @param {string[]} [shots] 画像 (data URL)
 * @returns {object} inquiries 行
 */
function inquiryCreate(kind, body, context, shots) {
  var kinds = INQUIRY_KINDS();
  var key = String(kind || 'bug');
  if (!kinds[key]) throw new Error('種類が正しくありません: ' + kind);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');
  if (text.length > 2000) throw new Error('内容は2000文字までにしてください');

  var row = {
    number: inquiryNextNumber_(),
    kind: key,
    title: inquiryTitleOf_(text),
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    state: 'open',
    context: String(context || '').substring(0, 500),
    answer: '',
    answeredAt: '',
    closedBy: '',
    shots: inquirySaveShots_(shots, 'report'),
    issueNumber: '',
  };
  dbAppend('inquiries', row);

  var made = inquiryToIssue_(row);
  if (made) {
    dbUpdate('inquiries', 'number', row.number, { issueNumber: made });
    row.issueNumber = made;
  }

  notifyInquiry(row);
  notifyInquiryMention(row, row, inquiryMentioned_(text, [row.by]));
  return row;
}

/**
 * 報告を返す。新しい順。
 *
 * @param {string} [by] 指定するとその人のぶんだけ
 * @returns {object[]}
 */
function inquiryList(by) {
  var rows = dbReadAll('inquiries');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (by && String(rows[i].by) !== String(by)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(b.number) - Number(a.number); });
  return out;
}

/**
 * 報告に答えて、受付を閉じる。
 *
 * @param {number} number
 * @param {string} answer
 * @returns {object} 更新後の行
 */
function inquiryAnswer(number, answer) {
  var row = dbFindOne('inquiries', 'number', number);
  if (!row) throw new Error('受付が見つかりません: ' + number);

  dbUpdate('inquiries', 'number', number, {
    state: 'done',
    answer: String(answer || ''),
    answeredAt: new Date(),
  });

  var after = dbFindOne('inquiries', 'number', number);
  notifyInquiryAnswered(after);
  return after;
}

/**
 * 本文の1行目を見出しにする。
 *
 * 一覧に本文をそのまま並べると、長いものが場所を食って見比べられない。
 * 見出しを別に入力させると、書く手間が増えて報告が出てこなくなる。
 *
 * @param {string} body
 * @returns {string}
 */
function inquiryTitleOf_(body) {
  var first = String(body || '').split('\n')[0].replace(/^\s+|\s+$/g, '');
  return first.length > 60 ? first.substring(0, 60) + '…' : first;
}

/**
 * 報告を1件返す。無ければエラー。
 *
 * @param {number} number
 * @returns {object} inquiries 行
 */
function inquiryGet(number) {
  var row = dbFindOne('inquiries', 'number', number);
  if (!row) throw new Error('受付が見つかりません: ' + number);
  return row;
}

/**
 * 次の返信の番号を返す。
 *
 * @returns {number}
 */
function inquiryReplyNextId_() {
  var rows = dbReadAll('inquiry_replies');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].id);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * 報告に返信する。
 *
 * 使う人どうしでも話せるようにする。同じところでつまずいた人が
 * 先に答えを知っていることがあり、それを開発者だけが答える形にすると
 * 誰も助け合えない。
 *
 * @param {number} number 受付番号
 * @param {string} body
 * @param {string[]} [shots] 画像 (data URL)
 * @returns {object} inquiry_replies 行
 */
function inquiryReply(number, body, shots) {
  inquiryGet(number);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');
  if (text.length > 2000) throw new Error('内容は2000文字までにしてください');

  var row = {
    id: inquiryReplyNextId_(),
    inquiryNumber: Number(number),
    body: text,
    by: Session.getActiveUser().getEmail(),
    at: new Date(),
    editedAt: '',
    shots: inquirySaveShots_(shots, 'reply-' + number),
  };
  dbAppend('inquiry_replies', row);

  var here = inquiryTalkers(number);
  notifyInquiryReply(inquiryGet(number), row, here);
  notifyInquiryMention(inquiryGet(number), row, inquiryMentioned_(text, here));
  return row;
}

/**
 * 返信を古い順に返す。
 *
 * @param {number} number
 * @returns {object[]}
 */
function inquiryReplies(number) {
  var rows = dbReadAll('inquiry_replies');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (Number(rows[i].inquiryNumber) !== Number(number)) continue;
    out.push(rows[i]);
  }
  out.sort(function (a, b) { return Number(a.id) - Number(b.id); });
  return out;
}

/**
 * その話に加わっている人を返す。
 *
 * @param {number} number
 * @returns {string[]}
 */
function inquiryTalkers(number) {
  var seen = {};
  var out = [];

  function add(who) {
    var one = String(who || '');
    if (!one || seen[one]) return;
    seen[one] = true;
    out.push(one);
  }

  add(inquiryGet(number).by);

  var replies = inquiryReplies(number);
  for (var i = 0; i < replies.length; i++) add(replies[i].by);
  return out;
}

/**
 * 返信を1件返す。無ければエラー。
 *
 * @param {number} id
 * @returns {object}
 */
function inquiryReplyGet(id) {
  if (id === '' || id === null || id === undefined) {
    throw new Error('返信を指定してください');
  }
  var row = dbFindOne('inquiry_replies', 'id', id);
  if (!row) throw new Error('返信が見つかりません: ' + id);
  return row;
}

/**
 * 書いた本人かを確かめる。
 *
 * @param {object} row
 */
function inquiryAssertOwn_(row) {
  var me = Session.getActiveUser().getEmail();
  if (String(row.by) !== String(me)) {
    throw new Error('自分が書いたものだけ直せます');
  }
}

/**
 * 返信を書き直す。
 *
 * @param {number} id
 * @param {string} body
 * @returns {object}
 */
function inquiryReplyEdit(id, body) {
  var row = inquiryReplyGet(id);
  inquiryAssertOwn_(row);

  var text = String(body || '').replace(/^\s+|\s+$/g, '');
  if (!text) throw new Error('内容を入力してください');

  dbUpdate('inquiry_replies', 'id', id, { body: text, editedAt: new Date() });
  return inquiryReplyGet(id);
}

/**
 * 返信を消す。
 *
 * @param {number} id
 */
function inquiryReplyDelete(id) {
  var row = inquiryReplyGet(id);
  inquiryAssertOwn_(row);
  dbDelete('inquiry_replies', 'id', id);
}

/**
 * このアプリの持ち主を返す。
 *
 * この Web アプリは開いた人の権限で動く (executeAs: USER_ACCESSING) ため、
 * Session.getEffectiveUser() は常に開いている本人になる。それを持ち主と
 * 見なすと誰もが持ち主になってしまうので、入れ物の持ち主を見る。
 *
 * @returns {string} 分からなければ空文字
 */
function inquiryOwner_() {
  try {
    return String(DriveApp.getFolderById(repoConfig().rootId)
      .getOwner().getEmail() || '');
  } catch (e) {
    return '';
  }
}

/**
 * 話を閉じられる人かを確かめる。
 *
 * 出した本人と、このアプリを持っている人だけが閉じられる。誰でも
 * 閉じられると、まだ困っている人の話が横から畳まれてしまう。
 *
 * @param {object} row inquiries 行
 */
function inquiryAssertCanClose_(row) {
  var me = Session.getActiveUser().getEmail();
  var owner = inquiryOwner_();

  if (String(row.by) !== String(me) && (!owner || String(owner) !== String(me))) {
    throw new Error('出した本人か、このアプリの持ち主だけが閉じられます');
  }
}

/**
 * 話を閉じる。
 *
 * @param {number} number
 * @returns {object}
 */
function inquiryClose(number) {
  var row = inquiryGet(number);
  inquiryAssertCanClose_(row);
  if (String(row.state) === 'done') return row;

  dbUpdate('inquiries', 'number', number, {
    state: 'done',
    answeredAt: new Date(),
    closedBy: Session.getActiveUser().getEmail(),
  });

  inquirySyncIssue_(row, true);
  return inquiryGet(number);
}

/**
 * 閉じた話を開け直す。
 *
 * @param {number} number
 * @returns {object}
 */
function inquiryReopen(number) {
  var row = inquiryGet(number);
  inquiryAssertCanClose_(row);
  if (String(row.state) !== 'done') return row;

  dbUpdate('inquiries', 'number', number, {
    state: 'open',
    answeredAt: '',
    closedBy: '',
  });

  inquirySyncIssue_(row, false);
  return inquiryGet(number);
}

/**
 * 画像の置き場を返す。無ければ作る。
 *
 * 設定は初期化のときに書かれていて、後から足した入れ物は入っていない。
 * 名前で探して、無ければその場で作る。
 *
 * @returns {Folder}
 */
function inquiryShotsFolder_() {
  var git = DriveApp.getFolderById(repoConfig().gitId);
  var found = git.getFoldersByName('shots');

  return found.hasNext() ? found.next() : git.createFolder('shots');
}

/**
 * 画面から届いた画像を Drive に置く。
 *
 * @param {string[]} dataUrls "data:image/png;base64,..." の並び
 * @param {string} tag ファイル名に付ける印
 * @returns {string} 置いたファイルの id をカンマで繋いだもの
 */
function inquirySaveShots_(dataUrls, tag) {
  var list = dataUrls || [];
  if (!list.length) return '';

  var limits = INQUIRY_SHOT_LIMITS();
  if (list.length > limits.maxCount) {
    throw new Error('画像は' + limits.maxCount + '枚までにしてください');
  }

  var folder = inquiryShotsFolder_();
  var ids = [];

  for (var i = 0; i < list.length; i++) {
    var m = /^data:([a-z\/+-]+);base64,([\s\S]+)$/.exec(String(list[i] || ''));
    if (!m) throw new Error('画像として読めませんでした');

    var ext = limits.mimes[m[1]];
    if (!ext) throw new Error('受け取れない形式です: ' + m[1]);

    // base64 は元の4/3の長さになる。復号する前に大きさを断る
    if (m[2].length * 3 / 4 > limits.maxBytes) {
      throw new Error('画像は1枚5MBまでにしてください');
    }

    var blob = Utilities.newBlob(
      Utilities.base64Decode(m[2]), m[1], tag + '-' + (i + 1) + '.' + ext);
    ids.push(folder.createFile(blob).getId());
  }
  return ids.join(',');
}

/**
 * 画像の id を配列にして返す。
 *
 * @param {object} row
 * @returns {string[]}
 */
function inquiryShotsOf(row) {
  var raw = String((row && row.shots) || '');
  var out = [];

  var parts = raw.split(',');
  for (var i = 0; i < parts.length; i++) {
    var one = parts[i].replace(/^\s+|\s+$/g, '');
    if (one) out.push(one);
  }
  return out;
}

/**
 * 文中で呼ばれた人のうち、まだ知らせていない人を返す。
 *
 * 既に話に加わっている人には返信の知らせが届く。同じことで二度
 * 呼ばれると、通知そのものが読まれなくなる。
 *
 * @param {string} text
 * @param {string[]} already 既に知らせる相手
 * @returns {string[]}
 */
function inquiryMentioned_(text, already) {
  var called = mentionResolve(text, inquiryRoster_());
  var me = Session.getActiveUser().getEmail();
  var out = [];

  for (var i = 0; i < called.length; i++) {
    if (String(called[i]) === String(me)) continue;
    if ((already || []).indexOf(called[i]) >= 0) continue;
    out.push(called[i]);
  }
  return out;
}

/**
 * 名前を呼べる人の名簿。
 *
 * 誰でも呼べると、関わりのない人に知らせが飛ぶ。この道具に
 * 名前が出ている人だけにする。
 *
 * @returns {string[]}
 */
function inquiryRoster_() {
  var seen = {};
  var out = [];

  function add(who) {
    var one = String(who || '');
    if (!one || seen[one]) return;
    seen[one] = true;
    out.push(one);
  }

  var tables = [
    ['commits', 'author'],
    ['reviews', 'reviewer'],
    ['issues', 'assignee'],
    ['inquiries', 'by'],
    ['inquiry_replies', 'by'],
  ];

  for (var t = 0; t < tables.length; t++) {
    var rows = dbReadAll(tables[t][0]);
    for (var i = 0; i < rows.length; i++) add(rows[i][tables[t][1]]);
  }

  add(inquiryOwner_());
  return out;
}

/**
 * 届いた報告を、このアプリを持っている人のやることに積む。
 *
 * 貯めるだけでは順番が決まらない。他の仕事と同じ列に並べて初めて、
 * いつ手を付けるかを決められる。
 *
 * 持ち主は環境によって変わるため、入れ物の持ち主を見る。分からない
 * ときは担当なしで積む。担当が付かないより、積まれないほうが困る。
 *
 * @param {object} row inquiries 行
 * @returns {number|string} 作ったやることの番号。作れなければ空文字
 */
function inquiryToIssue_(row) {
  try {
    var issue = issueCreate(
      '[報告 #' + row.number + '] ' + row.title,
      row.body + '\n\n' +
        '---\n' +
        '「不具合・要望」の受付 #' + row.number + ' から作られました。\n' +
        '出した人: ' + row.by + '\n' +
        (row.context ? 'そのときの状況: ' + row.context + '\n' : ''),
      [],
      INQUIRY_TAGS()[row.kind] || '問合せ対応'
    );

    var owner = inquiryOwner_();
    if (owner) issueUpdate(issue.number, { assignee: owner });

    projectPlace(issue.number, 'Backlog');
    return issue.number;
  } catch (e) {
    // やることを作れなくても、報告そのものは受け付ける。ここで投げると
    // 送ったのに何も残らないことになる
    Logger.log('報告からやることを作れませんでした: ' + e.message);
    return '';
  }
}

/**
 * 報告に紐づくやることを、報告と同じ状態にする。
 *
 * 報告が解決したのに、やることが開いたまま残ると数が合わなくなる。
 *
 * @param {object} row inquiries 行
 * @param {boolean} done
 */
function inquirySyncIssue_(row, done) {
  if (!row.issueNumber) return;

  try {
    if (done) issueClose(row.issueNumber, null);
    else issueReopen(row.issueNumber);
  } catch (e) {
    Logger.log('やることの状態を合わせられませんでした: ' + e.message);
  }
}
