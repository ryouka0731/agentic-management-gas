/**
 * 実績 (Web App API)。**どれもアドレスを受けない。** 開いている本人のぶんだけを数えて返す
 * (ほかの人の実績を読む道を作らない。順位も作らない)。定義は src/core/Achievements.js、数えるのは
 * src/core/AchievementsStore.gs。
 *
 * まだ取っていない実績は名前も中身も返さない (画面は ??? と出す)。数のある実績は、数えるものごとに
 * いちばん近い1つだけ「あと◯件で…」の手がかりを返す。
 */

/**
 * 開いたときに1回だけ、引数なしで呼ぶ (js-init)。開いた日を数え (東京の暦日ごとに1回)、全部を数え直して届いた実績を取る。
 * 済ませたあとは hint.metrics に、その操作で変わりうる数えるもの (ACH_METRICS の key) を名指して呼ぶ。
 * そのときは開いた日を数えず、名指したものだけを数える。
 *
 * @param {{metrics?: string[]}} [hint]
 * @returns {object} achPlain_ の形
 */
function apiAchievementsCheck(hint) {
  var metrics = hint && Array.isArray(hint.metrics) ? hint.metrics.slice(0, 40).map(String) : null;
  return achApi_(metrics ? { metrics: metrics } : { countDay: true });
}

/**
 * 実績の頁。全部を数え直して届いた実績を取る (開いた日は数えない)。その日に「まだ」と分かった「はじめて」は読み直さない。
 * 頁を開いたこと自体で「実績の頁を見た」に届く (page)。
 *
 * @returns {object} achPlain_ の形
 */
function apiAchievements() {
  return achApi_({ useNeg: true, page: true });
}

/**
 * @param {object} opts achCheck_ の opts
 * @returns {object}
 */
function achApi_(opts) {
  var me = currentEmail_();
  var on = !!me && prefGet_('ach.on', me) !== false;
  if (!on) return achPlain_(null, me);
  return achPlain_(achCheck_(me, new Date(), opts), me);
}

/**
 * 画面に渡す形。res が null (止めている・誰か分からない) なら on: false と、いまのレベルだけ。
 *
 * - level / stage: 推しのレベル (1 + 取った数) と育ちの段。crossed は今回取ったぶんで段が上がったか
 * - items: 全部の実績。取ったものは名前・説明・絵・取った日 (東京の暦日 'yyyy-MM-dd')。まだのものは group と hint だけ (名前は返さない)
 * - partial: 済ませたあとの数え直し (数えるものを絞った)。hint と next は数えたものの分しか無い (画面は頁を描き直さない)
 * - unlocked: 取ったもの (取った時刻の新しい順)。newly: 今回取ったもの
 * - next: 近い順に3つまで。名前は返さず、まとまり・いま・要る数・あと何か・手がかりの字
 * - groups: まとまりごとの取った数と全部の数 (この環境で取れないものは数えない)
 * - total / got: クリアまでの数 (取れる実績と取った実績) と取った数
 * - items の off / reason: この環境では取れない (achUnavailable_) と、どの設定で取れるか。near: 取れる実績の残りが3つ以下で、
 *   名前と説明を見せる。hint は数の手がかりか、取り方の手がかり (ACH_TIPS と、自分の設定で止めているもの achPersonalTips_)
 * - cleared: クリアしたか (一度届けば消えない OSHI_CLEARED)。clearedNow: この返事で初めて届いた (お祝いは1回だけ)
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
  var next = res ? achNext(counts, have, 99).filter(function (n) {
    return Object.prototype.hasOwnProperty.call(counts, n.metric);
  }) : [];
  var off = achUnavailable_(me, have);
  // 取れない実績には「あと◯件で…」を出さない
  next = next.filter(function (n) { return !Object.prototype.hasOwnProperty.call(off, n.key); });
  var hintOf = {};
  var tips = ACH_TIPS();
  Object.keys(tips).forEach(function (k) { hintOf[k] = tips[k]; });
  var mineTips = achPersonalTips_(me);
  Object.keys(mineTips).forEach(function (k) { hintOf[k] = mineTips[k]; });
  next.forEach(function (n) { hintOf[n.key] = achHintOf(n); });

  function shown(a) {
    return { key: plainText(a.key), group: plainText(a.group), groupLabel: plainText(labelOf[a.group]), done: true,
      title: plainText(a.title), desc: plainText(a.desc), icon: plainText(a.icon), at: plainText(have[a.key]) };
  }
  var all = ACHIEVEMENTS();
  function had(a) { return Object.prototype.hasOwnProperty.call(have, a.key); }
  function isOff(a) { return Object.prototype.hasOwnProperty.call(off, a.key); }
  // 取れる実績の残りが少なければ (3つ以下)、何が残っているかを名前と説明で見せる
  var left = all.filter(function (a) { return !had(a) && !isOff(a); });
  var near = left.length > 0 && left.length <= 3;
  var items = all.map(function (a) {
    if (had(a)) return shown(a);
    var it = { key: plainText(a.key), group: plainText(a.group), groupLabel: plainText(labelOf[a.group]), done: false,
      hint: plainText(hintOf[a.key] || ''), off: isOff(a), reason: plainText(off[a.key] || ''), near: near && !isOff(a) };
    if (it.near) {
      it.title = plainText(a.title);
      it.desc = plainText(a.desc);
    }
    return it;
  });
  var unlocked = all.filter(function (a) { return Object.prototype.hasOwnProperty.call(have, a.key); }).map(shown);
  // 取った日の新しい順 (同じ日なら一覧の並び)
  unlocked = unlocked.map(function (a, i) { return { a: a, i: i }; }).sort(function (x, y) {
    return x.a.at < y.a.at ? 1 : x.a.at > y.a.at ? -1 : x.i - y.i;
  }).map(function (x) { return x.a; });

  var count = Object.keys(have).length;
  var was = oshiClearedSaved_(me);
  var cleared = res ? oshiCleared_(me, off, have) : was;
  // 前に届いていた段 (OSHI_STAGE_MAX:) より下にしない。その床だけで「段が上がった」とは言わない
  var floor = achStageFloor_(me);
  var st = oshiStageOf(achLevelOf(count), floor);
  var before = oshiStageOf(achLevelOf(count - newly.length), floor);
  return {
    on: !!res,
    partial: !!(res && res.partial),
    level: plainNumber(st.level),
    stage: {
      index: plainNumber(st.index), key: plainText(st.key), label: plainText(st.label),
      meter: plainNumber(st.meter), toNext: plainNumber(st.toNext), floored: !!st.floored,
    },
    crossed: newly.length > 0 && st.index > before.index,
    days: plainNumber(res ? res.days.n : 0),
    total: plainNumber(all.length - Object.keys(off).length),
    cleared: !!cleared,
    clearedNow: !!cleared && !was,
    got: plainNumber(all.filter(had).length),
    groups: groups.map(function (g) {
      var mine = all.filter(function (a) { return a.group === g.key && !isOff(a); });
      return { key: plainText(g.key), label: plainText(g.label), total: plainNumber(mine.length),
        got: plainNumber(mine.filter(had).length) };
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
