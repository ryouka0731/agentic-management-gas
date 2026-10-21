/**
 * 実績 (Web App API)。**どれもアドレスを受けない。** 開いている本人のぶんだけを数えて返す
 * (ほかの人の実績を読む道を作らない。順位も作らない)。定義は src/core/Achievements.js、数えるのは
 * src/core/AchievementsStore.gs。
 *
 * まだ取っていない実績は名前も中身も返さない (画面は ??? と出す)。数のある実績は、数えるものごとに
 * いちばん近い1つだけ「あと◯件で…」の手がかりを返す。
 */

/**
 * 開いたときに1回だけ呼ぶ (js-init)。開いた日を数え (東京の暦日ごとに1回)、届いた実績を取る。
 *
 * @returns {object} achPlain_ の形
 */
function apiAchievementsCheck() {
  return achApi_(true);
}

/**
 * 数え直して、届いた実績を取る (開いた日は数えない)。実績の頁と、済ませたあとに呼ぶ。
 *
 * @returns {object} achPlain_ の形
 */
function apiAchievements() {
  return achApi_(false);
}

/**
 * @param {boolean} countDay
 * @returns {object}
 */
function achApi_(countDay) {
  var me = currentEmail_();
  var on = !!me && prefGet_('ach.on', me) !== false;
  if (!on) return achPlain_(null, me);
  return achPlain_(achCheck_(me, new Date(), { countDay: countDay }), me);
}

/**
 * 画面に渡す形。res が null (止めている・誰か分からない) なら on: false と、いまのレベルだけ。
 *
 * - level / stage: 推しのレベル (1 + 取った数) と育ちの段。crossed は今回取ったぶんで段が上がったか
 * - items: 全部の実績。取ったものは名前・説明・絵・取った日。まだのものは group と hint だけ (名前は返さない)
 * - unlocked: 取ったもの (取った時刻の新しい順)。newly: 今回取ったもの
 * - next: 近い順に3つまで。名前は返さず、まとまり・いま・要る数・あと何か・手がかりの字
 * - groups: まとまりごとの取った数と全部の数
 *
 * @param {?object} res achCheck_ の返り
 * @param {string} me
 * @returns {object}
 */
function achPlain_(res, me) {
  var have = res ? res.have : achUnlockedRead_(me);
  var newly = res ? res.newly : [];
  var counts = res ? res.counts : {};
  var groups = ACH_GROUPS();
  var labelOf = {};
  groups.forEach(function (g) { labelOf[g.key] = g.label; });
  var next = res ? achNext(counts, have, 99) : [];
  var hintOf = {};
  next.forEach(function (n) { hintOf[n.key] = achHintOf(n); });

  function shown(a) {
    return { key: plainText(a.key), group: plainText(a.group), groupLabel: plainText(labelOf[a.group]), done: true,
      title: plainText(a.title), desc: plainText(a.desc), icon: plainText(a.icon), at: plainText(have[a.key]) };
  }
  var all = ACHIEVEMENTS();
  var items = all.map(function (a) {
    if (Object.prototype.hasOwnProperty.call(have, a.key)) return shown(a);
    return { key: plainText(a.key), group: plainText(a.group), groupLabel: plainText(labelOf[a.group]), done: false,
      hint: plainText(hintOf[a.key] || '') };
  });
  var unlocked = all.filter(function (a) { return Object.prototype.hasOwnProperty.call(have, a.key); }).map(shown);
  unlocked.sort(function (x, y) { return x.at < y.at ? 1 : x.at > y.at ? -1 : 0; });

  var count = Object.keys(have).length;
  var st = oshiStageOf(achLevelOf(count));
  var before = oshiStageOf(achLevelOf(count - newly.length));
  return {
    on: !!res,
    level: plainNumber(st.level),
    stage: {
      index: plainNumber(st.index), key: plainText(st.key), label: plainText(st.label),
      meter: plainNumber(st.meter), toNext: plainNumber(st.toNext),
    },
    crossed: newly.length > 0 && st.index > before.index,
    days: plainNumber(res ? res.days.n : 0),
    groups: groups.map(function (g) {
      var mine = all.filter(function (a) { return a.group === g.key; });
      return { key: plainText(g.key), label: plainText(g.label), total: plainNumber(mine.length),
        got: plainNumber(mine.filter(function (a) { return Object.prototype.hasOwnProperty.call(have, a.key); }).length) };
    }),
    items: items,
    unlocked: unlocked,
    newly: newly.map(function (k) { return shown(achOf(k)); }),
    next: next.slice(0, 3).map(function (n) {
      return { key: plainText(n.key), group: plainText(n.group), groupLabel: plainText(labelOf[n.group]),
        have: plainNumber(n.have), need: plainNumber(n.need), left: plainNumber(n.left), unit: plainText(n.unit),
        hint: plainText(achHintOf(n)) };
    }),
  };
}
