/**
 * 手元の Claude に頼むことの置き場。
 *
 * **この道具から手元へ向かう唯一の経路である。** 外部 API は使わないと決めて
 * あるので (`UrlFetchApp` も使わない)、手元の Remote Control に直に投げることは
 * できない。代わりに Drive の同期に乗せ、手元から取りに来てもらう。
 *
 *   手元 --(.cmd.json)--> queue --(1分)--> この道具が実行   … これまで
 *   この道具 --(outbox の行)--> 手元が取りに来て実行         … こちら
 *
 * **押すのではなく、取りに来る形である。** 寝ている機械は起きない。承認の
 * 取り次ぎのような人の時間の単位なら困らないが、時計として使ってはならない。
 *
 * ## 頼めることを列挙する理由
 *
 * この表は台帳 (スプレッドシート) にあり、Drive を共有している人なら手で
 * 書き換えられる。**頼みごとを自由な文字列にすると、Drive に書ける人が全員の
 * 手元マシンで好きなコマンドを走らせられることになる。**
 *
 * だから頼めることは動詞で列挙し、引数も形を検査する。`COMMAND_OPS` が
 * 「ここに無い op は実行しない」としているのと同じ理由による。
 *
 * そのうえで、**手元の `agent.mjs` は頼みごとを実行しない。** 中身を Claude に
 * 見せるところまでで止め、何をするかは人と Claude が決める。ここが崩れると、
 * 検査をすり抜けた1件がそのまま実行されてしまう。
 */

/**
 * 頼めることと、引数の形。
 *
 * **ここに無い動詞は置けない。** 増やすときは「手元で何が起きるか」を
 * 書いてから増やすこと。
 *
 * @returns {Object<string, {label:string, keys:string[]}>}
 */
function OUTBOX_VERBS() {
  return {
    // 差分を出して確認依頼に添えてほしい。Claude の判断が要る仕事
    diff: {
      label: '差分を出して添える',
      keys: ['branch', 'against'],
    },
    // 承認されたので取り込んでほしい。**人が見ている前で進める**
    merge: {
      label: '承認されたので取り込む',
      keys: ['branch', 'into'],
    },
    // 中身を読んで意見をもらいたい
    review: {
      label: '中身を読んで意見をもらう',
      keys: ['branch', 'against'],
    },
  };
}

/**
 * 頼みごとの状態。
 *
 * @returns {string[]}
 */
function OUTBOX_STATES() {
  return ['open', 'taken', 'done', 'failed'];
}

/**
 * 引数として使える字か。
 *
 * **通す字を並べる形にはしない。** この道具のブランチ名は日本語である
 * (「見直し」「土台」)。ASCII だけに絞ると、正規の名前が弾かれる。
 *
 * 代わりに**空白・制御文字・シェルの記号を弾く**。手元で字をつなげて
 * コマンドにされたときに、別の命令を足せる形にしない。上に抜ける道のりも
 * 弾く。
 *
 * @param {string} value
 * @returns {boolean}
 */
function outboxArgValid_(value) {
  var text = String(value == null ? '' : value);

  if (text.length > 200) return false;
  if (/(^|\/)\.\.(\/|$)/.test(text)) return false;

  // 空白と制御文字、そしてシェルで意味を持つ記号
  return !/[\s\u0000-\u001f;&|`$<>(){}[\]'"\\!*?~#]/.test(text);
}

/**
 * 次の番号を返す。**通し番号にする。**
 *
 * 依頼ごとに振ると番号がかぶり、`dbUpdate` は id だけで行を探すため、
 * 関係のない頼みごとを書き換える。
 *
 * @returns {number}
 */
function outboxNextId_() {
  var rows = dbReadAll('outbox');
  var max = 0;

  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].id);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * 頼みごとを置く。
 *
 * @param {string} verb OUTBOX_VERBS のどれか
 * @param {Object<string,string>} args
 * @param {{note?:string, prNumber?:number}} [extra] 人向けの一言と、紐づく依頼
 * @returns {object} 置いた行
 */
function outboxAdd(verb, args, extra) {
  var verbs = OUTBOX_VERBS();
  var want = String(verb || '');

  if (!Object.prototype.hasOwnProperty.call(verbs, want)) {
    throw new Error('頼めない動詞です: ' + verb);
  }

  var keys = verbs[want].keys;
  var given = args || {};
  var kept = {};

  for (var i = 0; i < keys.length; i++) {
    var value = String(given[keys[i]] == null ? '' : given[keys[i]]);

    if (!outboxArgValid_(value)) {
      throw new Error('引数に使えない字があります: ' + keys[i] + '=' + value);
    }
    if (value) kept[keys[i]] = value;
  }

  var options = extra || {};
  var row = {
    id: outboxNextId_(),
    verb: want,
    args: JSON.stringify(kept),
    // 人が読む一言。手元の Claude にはこれが最初に届く
    note: String(options.note || '').substring(0, 500),
    state: 'open',
    prNumber: options.prNumber ? Number(options.prNumber) : '',
    createdAt: new Date(),
    createdBy: Session.getActiveUser().getEmail(),
    takenAt: '',
    takenBy: '',
    doneAt: '',
    result: '',
  };
  dbAppend('outbox', row);
  return row;
}

/**
 * 行を素の形にする。
 *
 * @param {object} row
 * @returns {object}
 */
function outboxToPlain_(row) {
  var args = {};
  try {
    args = JSON.parse(String(row.args || '{}')) || {};
  } catch (e) {
    // 手で書き換えられる表なので、読めない字が入りうる。落とさない
    args = {};
  }
  var verbs = OUTBOX_VERBS();

  return {
    id: plainId(row.id),
    verb: plainText(row.verb),
    label: verbs[String(row.verb)] ? verbs[String(row.verb)].label : '',
    args: args,
    note: plainText(row.note),
    state: plainText(row.state),
    prNumber: plainNumber(row.prNumber),
    createdAt: plainDate(row.createdAt),
    createdBy: plainText(row.createdBy),
    takenAt: plainDate(row.takenAt),
    takenBy: plainText(row.takenBy),
    doneAt: plainDate(row.doneAt),
    result: plainText(row.result),
  };
}

/**
 * 置かれている頼みごとを返す。
 *
 * @param {string} [state] 絞るなら状態
 * @returns {object[]}
 */
function outboxList(state) {
  var rows = dbReadAll('outbox');
  var want = String(state || '');
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (want && String(rows[i].state) !== want) continue;
    out.push(outboxToPlain_(rows[i]));
  }
  out.sort(function (a, b) { return b.id - a.id; });
  return out;
}

/**
 * まだ誰も取っていないぶんを取る。
 *
 * 取った印を付けてから返す。付けないと、2つの手元が同じ頼みごとを別々に
 * 進めて、同じ差分が2回添えられる。
 *
 * @param {number} [limit]
 * @returns {object[]}
 */
function outboxTake(limit) {
  var max = Math.max(1, Math.min(20, Number(limit) || 5));
  var lock = LockService.getScriptLock();

  // 取る印を付ける前に他の手元が同じ行を読むと、二重に進む
  if (!lock.tryLock(10000)) return [];

  try {
    var rows = dbReadAll('outbox');
    var me = Session.getActiveUser().getEmail();
    var out = [];

    for (var i = 0; i < rows.length && out.length < max; i++) {
      if (String(rows[i].state) !== 'open') continue;

      var patch = { state: 'taken', takenAt: new Date(), takenBy: me };
      dbUpdate('outbox', 'id', rows[i].id, patch);

      var taken = dbFindOne('outbox', 'id', rows[i].id);
      out.push(outboxToPlain_(taken));
    }
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 終わったことにする。
 *
 * @param {number} id
 * @param {string} result 何をしたか (人が読む)
 * @returns {object}
 */
function outboxDone(id, result) {
  return outboxFinish_(id, 'done', result);
}

/**
 * できなかったことにする。
 *
 * **黙って消さない。** できなかった頼みごとが残らないと、頼んだ人は待ち
 * 続けることになる。
 *
 * @param {number} id
 * @param {string} reason
 * @returns {object}
 */
function outboxFail(id, reason) {
  return outboxFinish_(id, 'failed', reason);
}

/**
 * @param {number} id
 * @param {string} state
 * @param {string} text
 * @returns {object}
 */
function outboxFinish_(id, state, text) {
  var row = dbFindOne('outbox', 'id', id);
  if (!row) throw new Error('その頼みごとは見つかりません: ' + id);

  if (String(row.state) === 'done' || String(row.state) === 'failed') {
    throw new Error('その頼みごとは既に終わっています: ' + id);
  }

  dbUpdate('outbox', 'id', id, {
    state: state,
    doneAt: new Date(),
    result: String(text || '').substring(0, 2000),
  });
  return outboxToPlain_(dbFindOne('outbox', 'id', id));
}

/**
 * 取ったまま放置されたものを戻す。
 *
 * 手元が落ちたり、取ったあと人が忘れたりする。戻さないと誰も取れないまま
 * 残り続ける。
 *
 * @param {number} [hours] 何時間で戻すか
 * @param {Date} [now]
 * @returns {number} 戻した数
 */
function outboxReclaim(hours, now) {
  var span = Math.max(1, Number(hours) || 24) * 3600 * 1000;
  var at = (now || new Date()).getTime();
  var rows = dbReadAll('outbox');
  var back = 0;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].state) !== 'taken') continue;

    var when = new Date(rows[i].takenAt);
    if (isNaN(when.getTime())) continue;
    if (at - when.getTime() < span) continue;

    dbUpdate('outbox', 'id', rows[i].id,
      { state: 'open', takenAt: '', takenBy: '' });
    back++;
  }
  return back;
}
