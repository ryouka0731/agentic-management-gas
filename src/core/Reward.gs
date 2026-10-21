/**
 * 自分へのご褒美 (換金の代わり)。
 *
 * 利用者から「パチンコの換金のように、たまったものを何かに換えたい」と頼まれた。お金や会社からの賞品は
 * くじと同じ害を持ち込み、給与や評価にも結び付いてしまうので作らない。代わりに、**本人が自分で決めた
 * 小さなご褒美** (好きなコーヒー・15分の散歩) と、本人のポイントを交換する。
 *
 * - **自分の設定 `luck.reward` をオンにした人だけ** (既定はオフ)
 * - **本人のもの。** スクリプトプロパティ `REWARD:<小文字のアドレス>` に1人1つ JSON で置く (仕事のスタンス診断の
 *   STYLE: と同じ事情)。台帳には置かない (台帳は Drive を共有している人なら誰でも読める)。ほかの人の分を返す入口は作らない
 * - **たまった数は台帳から数え、保存しない** (rewardEarned_)。覚えるのは「交換した記録」だけ
 * - 使えるのは、たまった数から交換したぶんを引いた残りまで。足りなければ断る。最後の交換は5分のあいだ取り消せる
 * - 確率は使わない (くじにしない)。当たりの演出 (js-luck) とは別のもの
 */

/** @returns {number} 1人が並べておけるご褒美の数 */
function REWARD_ITEMS_MAX() {
  return 20;
}

/** @returns {number} ご褒美1つのポイントの下限 */
function REWARD_COST_MIN() {
  return 1;
}

/** @returns {number} ご褒美1つのポイントの上限 */
function REWARD_COST_MAX() {
  return 50;
}

/** @returns {number} ご褒美の名前の字数の上限 */
function REWARD_TITLE_MAX() {
  return 40;
}

/** @returns {number} 交換を取り消せる時間 (ミリ秒) */
function REWARD_UNDO_MS() {
  return 5 * 60 * 1000;
}

/**
 * 交換した記録を1つずつ残す数。超えたぶんは合計 (spentOld) にまとめる。
 * スクリプトプロパティは1つ 9KB までなので、記録を際限なく並べられない。
 *
 * @returns {number}
 */
function REWARD_KEEP_SPENDS() {
  return 100;
}

/** 鍵。アドレスの大文字小文字で別の人にしない */
function rewardKey_(email) {
  return 'REWARD:' + String(email || '').toLowerCase();
}

/**
 * 覚えている中身。無い・読めない・壊れた欄は空として読む (人がエディタで書き換えうる)。
 *
 * @param {string} email
 * @returns {{since: string, nextId: number, spentOld: number,
 *   items: Array<{id: number, title: string, cost: number}>,
 *   spends: Array<{id: number, title: string, cost: number, at: string}>}}
 */
function rewardRead_(email) {
  var raw = PropertiesService.getScriptProperties().getProperty(rewardKey_(email));
  var rec = prefParse_(raw);
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) rec = {};
  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  var items = (Array.isArray(rec.items) ? rec.items : []).filter(function (it) {
    return it && num(it.id) && String(it.title || '') && num(it.cost);
  }).map(function (it) {
    return { id: num(it.id), title: String(it.title), cost: num(it.cost) };
  });
  var spends = (Array.isArray(rec.spends) ? rec.spends : []).filter(function (sp) {
    return sp && num(sp.id) && num(sp.cost) && !isNaN(Date.parse(sp.at));
  }).map(function (sp) {
    return { id: num(sp.id), title: String(sp.title || ''), cost: num(sp.cost), at: String(sp.at) };
  });
  var top = 0;
  items.concat(spends).forEach(function (x) { top = Math.max(top, x.id); });
  return {
    since: /^\d{4}-\d{2}-\d{2}$/.test(String(rec.since || '')) ? String(rec.since) : '',
    // 一度出した番号は二度出さない (取り消した交換の番号を次の交換に回さない)
    nextId: Math.max(num(rec.nextId), top + 1),
    spentOld: num(rec.spentOld),
    items: items,
    spends: spends,
  };
}

/**
 * 読む → 直す → 書くを1つの鍵の中で行う。分けると、ほぼ同時に押した2つの交換のどちらかが消える
 * (残りより多く交換できてしまう)。
 *
 * @param {string} email
 * @param {function(object): *} fn 中身を直して、返すものを返す
 * @returns {*}
 */
function rewardMutate_(email, fn) {
  var me = String(email || '');
  if (!me) throw new Error('誰か分かりません');
  return dbWithLock_(30000, function () {
    var rec = rewardRead_(me);
    var out = fn(rec);
    PropertiesService.getScriptProperties().setProperty(rewardKey_(me), JSON.stringify(rec));
    return out;
  });
}

/**
 * たまった数。**台帳から数え、保存しない** (取り消せば減る)。数え方は1つに決めてある:
 *
 * - ポイントとレベルがオンで、本人が週の上位に参加しているなら、**ポイント** (Game.gs と同じ数え方)
 * - そうでなければ、**本人が済ませたやること1件を1** と数える (担当が複数でも1件。ポイントの取りぶんではない)
 *
 * どちらも始めた日 (since) から今日まで。ポイントに参加していない人のポイントを数えて見せる道は作らない。
 *
 * @param {string} email
 * @param {string} since 'YYYY-MM-DD'
 * @param {{issues?: object[], closers?: Object<string, string>}} [pre] 既に読んだもの
 * @returns {{rule: string, earned: number}} rule は 'points' か 'closed'
 */
function rewardEarned_(email, since, pre) {
  var me = String(email || '');
  if (!me || !since) return { rule: 'closed', earned: 0 };
  if (gameEnabled() && gamePlayers_().indexOf(me) >= 0) {
    var pts = gamePointsBySpans_([[since, '']], pre)[0][me] || 0;
    return { rule: 'points', earned: Math.floor(pts * 10 + 1e-9) / 10 };
  }
  var got = pre || {};
  var issues = got.issues || dbReadAll('issues');
  var closers = got.closers || motivationClosers_();
  var lower = me.toLowerCase();
  var n = 0;
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) !== 'closed') continue;
    var day = motivationDay_(row.closedAt);
    if (!day || day < since) continue;
    var who = motivationCredited_(row, closers).map(function (w) { return String(w).toLowerCase(); });
    if (who.indexOf(lower) >= 0) n++;
  }
  return { rule: 'closed', earned: n };
}

/** 交換したぶんの合計 */
function rewardSpent_(rec) {
  return rec.spends.reduce(function (a, sp) { return a + sp.cost; }, rec.spentOld);
}

/**
 * 本人の今の様子。
 *
 * @param {string} email
 * @param {Date} now
 * @param {object} [rec] rewardRead_() (読んだものがあれば)
 * @returns {object}
 */
function rewardState_(email, now, rec) {
  var r = rec || rewardRead_(email);
  var got = rewardEarned_(email, r.since);
  var spent = rewardSpent_(r);
  var last = r.spends.length ? r.spends[r.spends.length - 1] : null;
  var undo = last && now.getTime() - Date.parse(last.at) < REWARD_UNDO_MS() ? last : null;
  return {
    rule: got.rule,
    since: r.since,
    earned: got.earned,
    spent: spent,
    available: Math.max(0, Math.floor((got.earned - spent) * 10 + 1e-9) / 10),
    items: r.items,
    spends: r.spends.slice().reverse(),
    undoId: undo ? undo.id : 0,
    undoUntil: undo ? new Date(Date.parse(undo.at) + REWARD_UNDO_MS()).toISOString() : '',
  };
}

/**
 * 始めた日を決める (まだなら今日)。たまった数はこの日から数える。
 *
 * @param {string} email
 * @param {Date} now
 * @returns {object} rewardRead_()
 */
function rewardStart_(email, now) {
  var rec = rewardRead_(email);
  if (rec.since) return rec;
  return rewardMutate_(email, function (r) {
    if (!r.since) r.since = motivationDay_(now);
    return r;
  });
}

/**
 * 名前とポイントを確かめる。
 *
 * @param {*} title
 * @param {*} cost
 * @returns {{title: string, cost: number}}
 */
function rewardCheckItem_(title, cost) {
  var t = String(title === null || title === undefined ? '' : title).replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  if (!t) throw new Error('ご褒美の名前を書いてください');
  if (t.length > REWARD_TITLE_MAX()) throw new Error('ご褒美の名前は ' + REWARD_TITLE_MAX() + ' 字までにしてください');
  var c = Number(cost);
  if (!isFinite(c) || Math.floor(c) !== c || c < REWARD_COST_MIN() || c > REWARD_COST_MAX()) {
    throw new Error('ポイントは ' + REWARD_COST_MIN() + '〜' + REWARD_COST_MAX() + ' の整数にしてください');
  }
  return { title: t, cost: c };
}

/**
 * ご褒美を足す・直す。id が無ければ足す。
 *
 * @param {string} email
 * @param {{id?: number, title: string, cost: number}} item
 * @param {Date} now
 * @returns {object} rewardRead_()
 */
function rewardItemSave_(email, item, now) {
  var v = rewardCheckItem_(item && item.title, item && item.cost);
  var id = Number(item && item.id) || 0;
  return rewardMutate_(email, function (r) {
    if (!r.since) r.since = motivationDay_(now);
    if (id) {
      var hit = r.items.filter(function (it) { return it.id === id; })[0];
      if (!hit) throw new Error('そのご褒美は見つかりません');
      hit.title = v.title;
      hit.cost = v.cost;
      return r;
    }
    if (r.items.length >= REWARD_ITEMS_MAX()) throw new Error('ご褒美は ' + REWARD_ITEMS_MAX() + ' 個までにしてください');
    r.items.push({ id: r.nextId, title: v.title, cost: v.cost });
    r.nextId++;
    return r;
  });
}

/**
 * ご褒美を外す。交換した記録は残す (外しても、交換したぶんは戻らない)。
 *
 * @param {string} email
 * @param {number} id
 * @returns {object} rewardRead_()
 */
function rewardItemDelete_(email, id) {
  var n = Number(id) || 0;
  return rewardMutate_(email, function (r) {
    var before = r.items.length;
    r.items = r.items.filter(function (it) { return it.id !== n; });
    if (r.items.length === before) throw new Error('そのご褒美は見つかりません');
    return r;
  });
}

/**
 * 交換する。**残りを超えては交換できない。** たまった数 (台帳を読む) は鍵の外で数え、
 * 交換したぶんとの比べと書き込みだけを鍵の中で行う。
 *
 * @param {string} email
 * @param {number} itemId
 * @param {Date} now
 * @returns {{rec: object, spend: {id: number, title: string, cost: number, at: string}}}
 */
function rewardSpend_(email, itemId, now) {
  var n = Number(itemId) || 0;
  var since = rewardStart_(email, now).since;
  var earned = rewardEarned_(email, since).earned;
  return rewardMutate_(email, function (r) {
    var item = r.items.filter(function (it) { return it.id === n; })[0];
    if (!item) throw new Error('そのご褒美は見つかりません');
    var left = earned - rewardSpent_(r);
    if (item.cost > left + 1e-9) {
      throw new Error('ポイントが足りないので交換できません (残り ' + Math.max(0, Math.floor(left * 10 + 1e-9) / 10) + '、このご褒美は ' + item.cost + ')');
    }
    var spend = { id: r.nextId, title: item.title, cost: item.cost, at: now.toISOString() };
    r.nextId++;
    r.spends.push(spend);
    // 古い記録は合計にまとめる (残りは変わらない)
    while (r.spends.length > REWARD_KEEP_SPENDS()) r.spentOld += r.spends.shift().cost;
    return { rec: r, spend: spend };
  });
}

/**
 * 最後の交換を取り消す。**5分のあいだ、最後の1つだけ。** 時刻はサーバの時計で見る。
 *
 * @param {string} email
 * @param {number} spendId
 * @param {Date} now
 * @returns {object} rewardRead_()
 */
function rewardUndo_(email, spendId, now) {
  var n = Number(spendId) || 0;
  return rewardMutate_(email, function (r) {
    var last = r.spends.length ? r.spends[r.spends.length - 1] : null;
    if (!last || last.id !== n) throw new Error('取り消せるのは最後の交換だけです');
    if (now.getTime() - Date.parse(last.at) >= REWARD_UNDO_MS()) {
      throw new Error('取り消せるのは交換してから5分のあいだだけです');
    }
    r.spends.pop();
    return r;
  });
}
