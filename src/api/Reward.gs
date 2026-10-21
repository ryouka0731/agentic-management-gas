/**
 * 自分へのご褒美 (Web App API)。中身は src/core/Reward.gs。
 *
 * **どの入口もアドレスを受けない。** 開いている本人のぶんだけを読み書きする (ほかの人のご褒美も
 * 交換した記録も、誰にも返さない)。自分の設定 `luck.reward` がオフなら断る。
 */

/** 自分の設定でオンか。オフなら断る */
function rewardAssertOn_(email) {
  if (prefGet_('luck.reward', email) !== true) {
    throw new Error('「ご褒美と交換する」は、自分の設定でオンにしてから使えます');
  }
}

/**
 * 画面に渡せる形にする。
 *
 * @param {object} st rewardState_()
 * @returns {object}
 */
function rewardPlain_(st) {
  return {
    rule: plainText(st.rule),
    since: plainText(st.since),
    earned: plainNumber(st.earned),
    spent: plainNumber(st.spent),
    available: plainNumber(st.available),
    costMin: plainNumber(REWARD_COST_MIN()),
    costMax: plainNumber(REWARD_COST_MAX()),
    itemsMax: plainNumber(REWARD_ITEMS_MAX()),
    titleMax: plainNumber(REWARD_TITLE_MAX()),
    items: st.items.map(function (it) {
      return { id: plainId(it.id), title: plainText(it.title), cost: plainNumber(it.cost) };
    }),
    spends: st.spends.slice(0, 30).map(function (sp) {
      return { id: plainId(sp.id), title: plainText(sp.title), cost: plainNumber(sp.cost), at: plainDate(sp.at) };
    }),
    archived: st.archived ? { count: plainNumber(st.archived.count), total: plainNumber(st.archived.total),
      at: plainDate(st.archived.at) } : null,
    ruleChanged: !!st.ruleChanged,
    undoId: plainId(st.undoId),
    undoUntil: plainDate(st.undoUntil),
  };
}

/**
 * 本人のご褒美・使えるポイント・交換した記録。初めて開いたら、その日から数え始める。
 *
 * @returns {object}
 */
function apiRewardGet() {
  var me = currentEmail_();
  rewardAssertOn_(me);
  var now = new Date();
  return rewardPlain_(rewardState_(me, now, rewardSync_(me, now)));
}

/**
 * ご褒美を足す・直す (id があれば直す)。
 *
 * @param {{id?: number, title: string, cost: number}} item
 * @returns {object}
 */
function apiRewardItemSave(item) {
  var me = currentEmail_();
  rewardAssertOn_(me);
  var now = new Date();
  return rewardPlain_(rewardState_(me, now, rewardItemSave_(me, item || {}, now)));
}

/**
 * ご褒美を外す。交換した記録は残る。
 *
 * @param {number} id
 * @returns {object}
 */
function apiRewardItemDelete(id) {
  var me = currentEmail_();
  rewardAssertOn_(me);
  return rewardPlain_(rewardState_(me, new Date(), rewardItemDelete_(me, id)));
}

/**
 * 交換する。残りを超えるときは断る。
 *
 * @param {number} itemId
 * @returns {object} 様子と、交換したもの (spent)
 */
function apiRewardSpend(itemId) {
  var me = currentEmail_();
  rewardAssertOn_(me);
  var now = new Date();
  var got = rewardSpend_(me, itemId, now);
  var out = rewardPlain_(rewardState_(me, now, got.rec));
  out.spentNow = { id: plainId(got.spend.id), title: plainText(got.spend.title), cost: plainNumber(got.spend.cost) };
  return out;
}

/**
 * 最後の交換を取り消す (5分のあいだ)。
 *
 * @param {number} spendId
 * @returns {object}
 */
function apiRewardUndo(spendId) {
  var me = currentEmail_();
  rewardAssertOn_(me);
  var now = new Date();
  return rewardPlain_(rewardState_(me, now, rewardUndo_(me, spendId, now)));
}
