/**
 * 実績 (バッジ)。**ここが唯一の定義である。** 何を・いくつで取れるか (ACHIEVEMENTS)・まとまり (ACH_GROUPS)・
 * 数えるもの (ACH_METRICS) を持つ。数えるのと覚えるのは src/core/AchievementsStore.gs、入口は src/api/Achievements.gs、
 * 画面は src/ui/js-ach.html (apiAchievements の返事を描くだけで、写しを持たない)。手引きは docs/manual/achievements.md。
 *
 * 守ること:
 * - **連続日数を持たない。** 日は「通算で開いた日」だけを数える (途切れたときに意欲が下がる)。毎日来ないと取れない実績は作らない
 * - 一度取った実績は消さない (取り消し・使われ方の間引き (180日) で数が減っても、取った印は残る)
 * - 見せるのは本人にだけ。順位は作らない
 * - 推しのレベルは 1 + 取った実績の数 (achLevelOf)。段は OSHI_STAGES (src/core/Oshi.js) が Lv で決める
 *
 * key は取った印 (スクリプトプロパティ ACH:<アドレス>) に残るので変えない。GAS に依らないので vitest で直に試す。
 */

/**
 * まとまり。並びは画面に出す順。
 *
 * @returns {Array<{key: string, label: string}>}
 */
function ACH_GROUPS() {
  return [
    { key: 'days', label: '通算の日' },
    { key: 'done', label: '片づけた' },
    { key: 'team', label: 'いっしょに' },
    { key: 'first', label: 'はじめて: 文書' },
    { key: 'work', label: 'はじめて: やること' },
    { key: 'me', label: 'はじめて: 自分と道具' },
    { key: 'oshi', label: '推しと部屋' },
  ];
}

/**
 * 数えるもの。unit は「あと◯日」の字。first が true のものは「はじめて」(1回あれば取れる。数の手がかりを出さない)。
 *
 * @returns {Object<string, {label: string, unit: string, first?: boolean}>}
 */
function ACH_METRICS() {
  return {
    days: { label: '番頭を開いた日 (通算)', unit: '日' },
    done: { label: '済ませたやること (担当)', unit: '件' },
    merged: { label: '反映まで届いた自分の確認依頼', unit: '件' },
    reviews: { label: 'ほかの人の確認依頼への返事', unit: '件' },
    pats: { label: '推しの頭をなでた (通算)', unit: '回' },
    rooms: { label: '作業部屋を開いた (通算)', unit: '回' },
    branch: { label: '改訂版を作った', unit: '', first: true },
    pull: { label: '確認依頼を出した', unit: '', first: true },
    merge: { label: '反映した', unit: '', first: true },
    approve: { label: '承認した', unit: '', first: true },
    markdown: { label: 'Markdown で保存した', unit: '', first: true },
    register: { label: '文書を登録した', unit: '', first: true },
    commit: { label: '変更を記録した', unit: '', first: true },
    addFile: { label: '改訂版に文書を足した', unit: '', first: true },
    docLink: { label: '全画面のリンクを写した', unit: '', first: true },
    issue: { label: 'やることを作った', unit: '', first: true },
    comment: { label: 'やりとりを書いた', unit: '', first: true },
    inquiry: { label: '報告を書いた', unit: '', first: true },
    reportCopy: { label: '日報をコピーした', unit: '', first: true },
    template: { label: '下書き (ひな形) を使った', unit: '', first: true },
    tag: { label: 'タグを付けた', unit: '', first: true },
    board: { label: '進捗ボードで動かした', unit: '', first: true },
    gantt: { label: '工程表を見た', unit: '', first: true },
    sprint: { label: '作業期間を作った', unit: '', first: true },
    impediment: { label: '困りごとを書き出した', unit: '', first: true },
    goal: { label: '目標を立てた', unit: '', first: true },
    calendar: { label: '予定に入れた', unit: '', first: true },
    tasks: { label: 'Google ToDo に送った', unit: '', first: true },
    search: { label: '探す (Ctrl+K) を使った', unit: '', first: true },
    focus: { label: '集中を始めた', unit: '', first: true },
    style: { label: '仕事のスタンス診断を受けた', unit: '', first: true },
    kit: { label: '手元の道具を使った', unit: '', first: true },
    settings: { label: '自分の設定を変えた', unit: '', first: true },
    help: { label: '使い方を開いた', unit: '', first: true },
    usageView: { label: '使われ方を見た', unit: '', first: true },
    achPage: { label: '実績の頁を見た', unit: '', first: true },
    oshi: { label: '推しを選んだ', unit: '', first: true },
    mychar: { label: '自分のキャラを作った', unit: '', first: true },
    charkit: { label: 'キャラ作成キットで取り込んだ', unit: '', first: true },
    mood: { label: '推しの機嫌をオンにした', unit: '', first: true },
    pat: { label: '推しの頭をなでた', unit: '', first: true },
    room: { label: '作業部屋を開いた', unit: '', first: true },
    roomSound: { label: '作業部屋で音を流した', unit: '', first: true },
    cowork: { label: '作業雑談部屋をのぞいた', unit: '', first: true },
  };
}

/**
 * 実績の一覧。**唯一の表。** 並びは画面に出す順。同じ数えるものの中では threshold が小さい順に並べる
 * (test/achievements.test.js が見ている)。
 *
 * @returns {Array<{key: string, group: string, metric: string, threshold: number, title: string, desc: string, icon: string}>}
 */
function ACHIEVEMENTS() {
  var out = [];
  function add(group, metric, threshold, key, title, desc, icon) {
    out.push({ key: key, group: group, metric: metric, threshold: threshold, title: title, desc: desc, icon: icon });
  }
  // 通算の日 (続けなくても数える。1日に何回開いても1日)
  [[1, 'はじめの一日', '🌱'], [3, '三日目', '🌿'], [7, '七日目', '🍀'], [30, '三十日目', '🌳'],
    [50, '五十日目', '🎋'], [100, '百日目', '🏅'], [200, '二百日目', '🎖️'], [365, '三百六十五日目', '👑']]
    .forEach(function (d) {
      add('days', 'days', d[0], 'days-' + d[0], d[1], '番頭を開いた日が、通算で ' + d[0] + ' 日になった (続けなくても数えます)', d[2]);
    });
  // 済ませたやること (担当。担当が空なら閉じた人)
  [[1, 'はじめて片づけた', '✅'], [10, '10件片づけた', '📦'], [30, '30件片づけた', '🧹'], [50, '50件片づけた', '🗂️'],
    [100, '100件片づけた', '💯'], [300, '300件片づけた', '🏔️'], [1000, '1000件片づけた', '🌟']].forEach(function (d) {
    add('done', 'done', d[0], 'done-' + d[0], d[1], '担当のやることを、通算で ' + d[0] + ' 件済ませた', d[2]);
  });
  // いっしょに: 自分の確認依頼が反映まで届いた・ほかの人の確認依頼に返事をした
  [[1, 'はじめて届けた', '🚀'], [10, '10件届けた', '🛰️'], [50, '50件届けた', '🌠']].forEach(function (d) {
    add('team', 'merged', d[0], 'merged-' + d[0], d[1], '自分が出した確認依頼が、通算で ' + d[0] + ' 件反映まで届いた', d[2]);
  });
  [[1, 'はじめての返事', '👀'], [10, '10件見た', '🔎'], [50, '50件見た', '🦉']].forEach(function (d) {
    add('team', 'reviews', d[0], 'reviews-' + d[0], d[1],
      'ほかの人の確認依頼に、通算で ' + d[0] + ' 件返事をした (同じ依頼には1日1件と数えます)', d[2]);
  });
  // はじめて (どれも1回で取れる)。まとまりは使う場所ごと。**key は取った印に残るので、まとまりを移しても key は変えない**
  // (はじめの15は、もとは1つの「はじめて」にあった)
  function firsts(group, list) {
    list.forEach(function (d) {
      add(group, d[0], 1, 'first-' + d[0], d[1], (d[3] || d[1]) + ' (はじめての1回で取れます)', d[2]);
    });
  }
  firsts('first', [['branch', '改訂版を作った', '📝'], ['pull', '確認依頼を出した', '📨'], ['merge', '反映した', '🎉'],
    ['approve', '承認した', '👍'], ['markdown', 'Markdown で保存した', '💾'],
    ['register', '文書を登録した', '📥', '文書を番頭に登録した'],
    ['commit', '変更を記録した', '🖊️', '文書の変更を記録した (自分で記録したもの)'],
    ['addFile', '改訂版に文書を足した', '📎', '作ってある改訂版に、別の文書を足した'],
    ['docLink', '全画面のリンクを写した', '🔗', '文書を全画面で開くリンクを写した']]);
  firsts('work', [['issue', 'やることを作った', '🆕'], ['comment', 'やりとりを書いた', '💬'], ['inquiry', '報告を書いた', '📮'],
    ['reportCopy', '日報をコピーした', '📋'],
    ['template', '下書き (ひな形) を使った', '🧩', 'やることの本文に下書き (ひな形) を入れた・自分の下書きを作った'],
    ['tag', 'タグを付けた', '🏷️', 'やることにタグを付けた・新しいタグを作った'],
    ['board', '進捗ボードで動かした', '🗃️', '進捗ボードで、やることのカードを動かした'],
    ['gantt', '工程表を見た', '📊', 'やることを工程表で見た'],
    ['sprint', '作業期間を作った', '🏁', '作業期間 (スプリント) を作った'],
    ['impediment', '困りごとを書き出した', '🚧', 'チームの進みを妨げている困りごと (障害物) を書き出した'],
    ['goal', '目標を立てた', '🎯'], ['calendar', '予定に入れた', '📅'],
    ['tasks', 'Google ToDo に送った', '☑️', 'やることを Google ToDo に送った'],
    ['search', '探す (Ctrl+K) を使った', '🔍']]);
  firsts('me', [['focus', '集中を始めた', '🔥'], ['style', '仕事のスタンス診断を受けた', '🧭'], ['kit', '手元の道具を使った', '🧰'],
    ['settings', '自分の設定を変えた', '⚙️'], ['help', '使い方を開いた', '📖', '左の「使い方」を開いた'],
    ['usageView', '使われ方を見た', '📈', '左の「使われ方」を開いた'], ['achPage', '実績の頁を見た', '🏆', '実績の頁を開いた']]);
  firsts('oshi', [['oshi', '推しを選んだ', '💖'], ['mychar', '自分のキャラを作った', '🎨', '推しに使う自分のキャラを作った'],
    ['charkit', 'キャラ作成キットで取り込んだ', '📦', 'キャラ作成キットで作ったキャラを取り込んだ'],
    ['mood', '推しの機嫌をオンにした', '🌦️', '自分の設定で「推しの機嫌」をオンにした'],
    ['pat', '推しの頭をなでた', '🫶', '推しの頁か作業部屋で、推しの頭をなでた'],
    ['room', '作業部屋を開いた', '🏠'], ['roomSound', '作業部屋で音を流した', '🎧', '作業部屋で雨やたき火の音を流した'],
    ['cowork', '作業雑談部屋をのぞいた', '☕', '左の「作業雑談部屋」を開いた']]);
  // 推しと部屋の通算 (続けなくても数える)
  [[10, '10回なでた', '💞'], [50, '50回なでた', '💝']].forEach(function (d) {
    add('oshi', 'pats', d[0], 'pats-' + d[0], d[1], '推しの頭を、通算で ' + d[0] + ' 回なでた', d[2]);
  });
  [[10, '部屋の常連', '🛋️'], [50, '部屋の住人', '🏡']].forEach(function (d) {
    add('oshi', 'rooms', d[0], 'rooms-' + d[0], d[1], '作業部屋を、通算で ' + d[0] + ' 回開いた', d[2]);
  });
  return out;
}

/**
 * まだ取っていなくても見せる、取り方の手がかり (名前は ??? のまま)。どこで何をすればよいか分かりにくいものだけ。
 *
 * @returns {Object<string, string>} key → 手がかり
 */
function ACH_TIPS() {
  return {
    'first-kit': '手元の道具を入れて、手元から番頭に1回頼むと取れます (右上の自分の顔の欄から入れられます)',
  };
}

/**
 * @param {string} key
 * @returns {object|null}
 */
function achOf(key) {
  var list = ACHIEVEMENTS();
  for (var i = 0; i < list.length; i++) if (list[i].key === String(key)) return list[i];
  return null;
}

/**
 * まだ取っていないもののうち、数が届いたもの。並びは ACHIEVEMENTS の順。
 *
 * @param {Object<string, number>} counts 数えるもの → 数
 * @param {Object<string, string>} have 取った印 (key → 取った時刻)
 * @returns {string[]} key
 */
function achNewly(counts, have) {
  var c = counts || {};
  var h = have || {};
  return ACHIEVEMENTS().filter(function (a) {
    return !Object.prototype.hasOwnProperty.call(h, a.key) && (Number(c[a.metric]) || 0) >= a.threshold;
  }).map(function (a) { return a.key; });
}

/**
 * 数えるものごとの、まだ取っていない次の実績 (いちばん小さい threshold)。「はじめて」は出さない
 * (数の手がかりが無い)。近いもの (届いた割合が大きいもの) から max 件。
 *
 * @param {Object<string, number>} counts
 * @param {Object<string, string>} have
 * @param {number} [max] 既定 3
 * @returns {Array<{key: string, group: string, metric: string, have: number, need: number, left: number, unit: string}>}
 */
function achNext(counts, have, max) {
  var c = counts || {};
  var h = have || {};
  var metrics = ACH_METRICS();
  var seen = {};
  var out = [];
  ACHIEVEMENTS().forEach(function (a) {
    if (metrics[a.metric].first || seen[a.metric] || Object.prototype.hasOwnProperty.call(h, a.key)) return;
    seen[a.metric] = true;
    var got = Math.max(0, Math.floor(Number(c[a.metric]) || 0));
    out.push({ key: a.key, group: a.group, metric: a.metric, have: Math.min(got, a.threshold), need: a.threshold,
      left: Math.max(0, a.threshold - got), unit: metrics[a.metric].unit });
  });
  out.sort(function (x, y) { return y.have / y.need - x.have / x.need || x.left - y.left; });
  return out.slice(0, max === undefined ? 3 : max);
}

/**
 * 「あと3件で…」の字。数の無い「はじめて」は空。
 *
 * @param {{left: number, unit: string}} next achNext の1つ
 * @returns {string}
 */
function achHintOf(next) {
  if (!next || !next.unit) return '';
  return 'あと ' + next.left + ' ' + next.unit + 'で…';
}

/**
 * 推しのレベル。1 + 取った実績の数。取った実績は消さないので下がらない。
 *
 * @param {number} unlocked 取った実績の数
 * @returns {number}
 */
function achLevelOf(unlocked) {
  return 1 + Math.max(0, Math.floor(Number(unlocked) || 0));
}
