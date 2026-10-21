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
 *
 * @returns {number}
 */
function REWARD_KEEP_SPENDS() {
  return 30;
}

/**
 * 1人ぶんの中身の上限 (UTF-8 のバイト)。**スクリプトプロパティは1つ 9KB まで**で、超えると書けずに
 * その人は何もできなくなる。余裕を見て 8000 にし、超えるときは古い記録から合計にまとめる (rewardFit_)。
 *
 * @returns {number}
 */
function REWARD_MAX_BYTES() {
  return 8000;
}

/**
 * 済ませたやること1件を1と数えるとき、担当なしで閉じた人の取りぶんになるものを1日に数える上限。
 * 担当なしのやることは作って閉じるだけで数えられてしまうので、数稼ぎにならないよう絞る。
 *
 * @returns {number}
 */
function REWARD_UNASSIGNED_PER_DAY() {
  return 5;
}

/** 鍵。アドレスの大文字小文字で別の人にしない */
function rewardKey_(email) {
  return 'REWARD:' + String(email || '').toLowerCase();
}

/** UTF-8 のバイト数 */
function rewardBytes_(text) {
  return encodeURIComponent(String(text)).replace(/%[0-9A-F]{2}/gi, 'x').length;
}

/**
 * 覚えている中身。無い・読めない・壊れた欄は空として読む (人がエディタで書き換えうる)。
 *
 * - since: 数え始めた時刻 (ISO)。この時刻より後に作られたやることだけを数える
 * - unit: 数え始めたときの数え方 ('game' = ポイント / 'done' = 済ませたやること)。変わったら数え直す
 * - archived: 数え方が変わる前に交換したぶんのまとめ ({count, total, at})
 *
 * @param {string} email
 * @returns {object}
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
  var a = rec.archived;
  return {
    since: !isNaN(Date.parse(rec.since)) ? new Date(Date.parse(rec.since)).toISOString() : '',
    unit: rec.unit === 'game' || rec.unit === 'done' ? rec.unit : '',
    // ポイントは日ごとにしか数えられないので、数え始めた日のうち、その時刻までに付いていたぶんを引く
    base: isFinite(Number(rec.base)) && Number(rec.base) > 0 ? Number(rec.base) : 0,
    // 一度出した番号は二度出さない (取り消した交換の番号を次の交換に回さない)
    nextId: Math.max(num(rec.nextId), top + 1),
    spentOld: num(rec.spentOld),
    archived: a && typeof a === 'object' && num(a.count) ? { count: num(a.count), total: num(a.total),
      at: isNaN(Date.parse(a.at)) ? '' : String(a.at) } : null,
    ruleChangedAt: isNaN(Date.parse(rec.ruleChangedAt)) ? '' : String(rec.ruleChangedAt),
    items: items,
    spends: spends,
  };
}

/**
 * 書ける大きさに収める。古い交換の記録から合計 (spentOld) にまとめる。残りは変わらない。
 *
 * @param {object} rec
 * @returns {string} 書く JSON
 */
function rewardFit_(rec) {
  while (rec.spends.length > REWARD_KEEP_SPENDS()) rec.spentOld += rec.spends.shift().cost;
  var json = JSON.stringify(rec);
  while (rewardBytes_(json) > REWARD_MAX_BYTES() && rec.spends.length) {
    rec.spentOld += rec.spends.shift().cost;
    json = JSON.stringify(rec);
  }
  return json;
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
    PropertiesService.getScriptProperties().setProperty(rewardKey_(me), rewardFit_(rec));
    return out;
  });
}

/**
 * いまの数え方。ポイントとレベルがオンで、本人が週の上位に参加しているなら 'game'、ほかは 'done'。
 *
 * @param {string} email
 * @returns {string}
 */
function rewardUnit_(email) {
  return gameEnabled() && gamePlayers_().indexOf(String(email || '')) >= 0 ? 'game' : 'done';
}

/**
 * たまった数。**台帳から数え、保存しない** (取り消せば減る)。数え方は1つに決めてある:
 *
 * - 'game': **ポイント** (Game.gs と同じ数え方)。数え始めた日から
 * - 'done': **本人が済ませたやること1件を1** (担当が複数でも1件)。数えるのは**数え始めた時刻より後に閉じて**、
 *   いま完了のものだけ。前から台帳にあったやることも、数え始めてから済ませれば数える (以前は「数え始めてから作ったもの」
 *   だけで、ご褒美をオンにする前からあるやることを済ませても 0 のままだった。2026-10-22 の指摘)。
 *   担当なしで閉じた人の取りぶんになるものは、閉じた日ごとに REWARD_UNASSIGNED_PER_DAY() 件まで
 *
 * ポイントに参加していない人のポイントを数えて見せる道は作らない。
 *
 * @param {string} email
 * @param {string} since ISO
 * @param {string} unit 'game' / 'done'
 * @param {number} [base] 'game' のとき、数え始めた日のうち始める前に付いていたポイント (引く)
 * @param {{issues?: object[], closers?: Object<string, string>}} [pre] 既に読んだもの
 * @returns {number}
 */
function rewardEarned_(email, since, unit, base, pre) {
  var me = String(email || '');
  var from = Date.parse(since);
  if (!me || isNaN(from)) return 0;
  if (unit === 'game') {
    var pts = (gamePointsBySpans_([[motivationDay_(new Date(from)), '']], pre)[0][me] || 0) - (base || 0);
    return Math.max(0, Math.floor(pts * 10 + 1e-9) / 10);
  }
  var got = pre || {};
  var issues = got.issues || dbReadAll('issues');
  var closers = got.closers || motivationClosers_();
  var lower = me.toLowerCase();
  var n = 0;
  var loose = {};
  for (var i = 0; i < issues.length; i++) {
    var row = issues[i];
    if (String(row.state) !== 'closed') continue;
    var closed = row.closedAt instanceof Date ? row.closedAt.getTime() : Date.parse(row.closedAt);
    if (isNaN(closed) || closed < from) continue;
    var day = motivationDay_(row.closedAt);
    if (!day) continue;
    var who = motivationCredited_(row, closers).map(function (w) { return String(w).toLowerCase(); });
    if (who.indexOf(lower) < 0) continue;
    if (!issueAssignees(row).length) {
      loose[day] = (loose[day] || 0) + 1;
      if (loose[day] > REWARD_UNASSIGNED_PER_DAY()) continue;
    }
    n++;
  }
  return n;
}

/** 交換したぶんの合計 (今の数え方のぶんだけ) */
function rewardSpent_(rec) {
  return rec.spends.reduce(function (a, sp) { return a + sp.cost; }, rec.spentOld);
}

/**
 * 数え始める・数え方が変わっていたら数え直す。**読むたびに通す。**
 *
 * 数え方 (ポイント ↔ 済ませたやること) が変わると、たまった数の単位が変わり、交換したぶんと比べられなくなる
 * (急に減ったように見える)。変わっていたら、いまから数え直し、それまでの交換はまとめ (archived) にして残す。
 * 画面は ruleChanged を見て、落ち着いた言葉で知らせる。
 *
 * @param {string} email
 * @param {Date} now
 * @returns {object} rewardRead_()
 */
function rewardSync_(email, now) {
  var unit = rewardUnit_(email);
  var rec = rewardRead_(email);
  if (rec.since && rec.unit === unit) return rec;
  return rewardMutate_(email, function (r) {
    if (r.since && r.unit === unit) return r;
    if (r.since && r.unit) {
      var count = r.spends.length + (r.archived ? r.archived.count : 0);
      var total = rewardSpent_(r) + (r.archived ? r.archived.total : 0);
      r.archived = count ? { count: count, total: total, at: now.toISOString() } : r.archived;
      r.spends = [];
      r.spentOld = 0;
      r.ruleChangedAt = now.toISOString();
    }
    r.since = now.toISOString();
    r.unit = unit;
    var day = motivationDay_(now);
    r.base = unit === 'game' ? (gamePointsBySpans_([[day, day]])[0][String(email)] || 0) : 0;
    return r;
  });
}

/**
 * 本人の今の様子。
 *
 * @param {string} email
 * @param {Date} now
 * @param {object} rec rewardSync_() を通したもの
 * @returns {object}
 */
function rewardState_(email, now, rec) {
  var r = rec || rewardRead_(email);
  var earned = rewardEarned_(email, r.since, r.unit, r.base);
  var spent = rewardSpent_(r);
  var last = r.spends.length ? r.spends[r.spends.length - 1] : null;
  var undo = last && now.getTime() - Date.parse(last.at) < REWARD_UNDO_MS() ? last : null;
  return {
    rule: r.unit || 'done',
    since: r.since,
    earned: earned,
    spent: spent,
    available: Math.max(0, Math.floor((earned - spent) * 10 + 1e-9) / 10),
    items: r.items,
    spends: r.spends.slice().reverse(),
    archived: r.archived,
    // 数え直したあと、まだ1つも交換していなければ知らせる
    ruleChanged: !!r.ruleChangedAt && !r.spends.length,
    undoId: undo ? undo.id : 0,
    undoUntil: undo ? new Date(Date.parse(undo.at) + REWARD_UNDO_MS()).toISOString() : '',
  };
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
  rewardSync_(email, now);
  return rewardMutate_(email, function (r) {
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
 * 交換したぶんとの比べと書き込みだけを鍵の中で行う (中で読み直した交換のぶんで比べる)。
 *
 * @param {string} email
 * @param {number} itemId
 * @param {Date} now
 * @returns {{rec: object, spend: {id: number, title: string, cost: number, at: string}}}
 */
function rewardSpend_(email, itemId, now) {
  var n = Number(itemId) || 0;
  var start = rewardSync_(email, now);
  var earned = rewardEarned_(email, start.since, start.unit, start.base);
  return rewardMutate_(email, function (r) {
    // 数え方が鍵の外で数えたときと変わっていたら、比べない (単位が違う)
    if (r.since !== start.since || r.unit !== start.unit) throw new Error('数え方が変わりました。開き直してください');
    var item = r.items.filter(function (it) { return it.id === n; })[0];
    if (!item) throw new Error('そのご褒美は見つかりません');
    var left = earned - rewardSpent_(r);
    if (item.cost > left + 1e-9) {
      throw new Error('ポイントが足りないので交換できません (残り ' + Math.max(0, Math.floor(left * 10 + 1e-9) / 10) + '、このご褒美は ' + item.cost + ')');
    }
    var spend = { id: r.nextId, title: item.title, cost: item.cost, at: now.toISOString() };
    r.nextId++;
    r.spends.push(spend);
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
