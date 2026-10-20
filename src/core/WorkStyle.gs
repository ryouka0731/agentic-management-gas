/**
 * 仕事のスタンス診断の結果を覚える。問い・軸・型の定義は WorkStyle.js にある。
 *
 * **結果は本人のもの。** スクリプトプロパティ `STYLE:<小文字のアドレス>` に JSON で1人1つ置く
 * ({code, scores, takenAt})。台帳には置かない (台帳は Drive を共有している人なら誰でも読める)。
 * UserProperties に置かないのは自分の設定 (MYPREF:) と同じ事情で、手元からの命令は持ち主の
 * 権限で走り、本人の UserProperties を読めないため。持ち主はエディタで中を見られる。
 *
 * ほかの人に見せるのは、本人が自分の設定 `style.share` をオンにしたときの**型の名前と絵だけ**
 * (workStyleShared_)。点数・答え・診断した日は誰にも返さない。
 */

/** 結果の鍵。アドレスの大文字小文字で別の人にしない */
function workStyleKey_(email) {
  return 'STYLE:' + String(email || '').toLowerCase();
}

/**
 * 覚えている結果。無い・読めない・知らない型なら null (人がエディタで書き換えうる)。
 *
 * @param {string} email
 * @param {function(string): *} [read] prefReader_()。省略すると1つ読む
 * @returns {{code: string, scores: Object<string, number>, takenAt: string}|null}
 */
function workStyleRead_(email, read) {
  var who = String(email || '');
  if (!who) return null;
  var raw = (read || prefReaderLive_())(workStyleKey_(who));
  var rec = prefParse_(raw);
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !workStyleCodeValid(rec.code)) return null;
  var scores = {};
  WORK_STYLE_AXES().forEach(function (a) {
    var n = rec.scores && rec.scores[a.key];
    scores[a.key] = typeof n === 'number' && isFinite(n) ? n : 0;
  });
  return { code: rec.code, scores: scores, takenAt: String(rec.takenAt || '') };
}

/**
 * 答えから型を決めて、本人のぶんとして覚える。
 *
 * @param {string} email
 * @param {Object<string, number>} answers
 * @param {Date} now
 * @returns {{code: string, scores: Object<string, number>, takenAt: string}}
 */
function workStyleSave_(email, answers, now) {
  var who = String(email || '');
  if (!who) throw new Error('誰の診断か分かりません');
  var got = workStyleScore(answers);
  var rec = { code: got.code, scores: got.scores, takenAt: now.toISOString() };
  // 1人1つの値を丸ごと書くだけで、読んで足す形ではないので鍵は要らない
  PropertiesService.getScriptProperties().setProperty(workStyleKey_(who), JSON.stringify(rec));
  return rec;
}

/**
 * 結果を消す。
 *
 * @param {string} email
 */
function workStyleForget_(email) {
  var who = String(email || '');
  if (!who) throw new Error('誰の診断か分かりません');
  PropertiesService.getScriptProperties().deleteProperty(workStyleKey_(who));
}

/**
 * チームに見せてよい人の型の名前。本人が style.share をオンにして、結果がある人だけ。
 *
 * @returns {Object<string, {name: string, emoji: string}>} 小文字のアドレス → 型の名前と絵
 */
function workStyleShared_() {
  var all = PropertiesService.getScriptProperties().getProperties() || {};
  var read = function (k) { return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : null; };
  var item = prefItem_('style.share');
  var out = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('STYLE:') !== 0) return;
    var who = k.slice('STYLE:'.length);
    if (!who || prefValueOf_(item, who, read).value !== true) return;
    var rec = workStyleRead_(who, read);
    if (!rec) return;
    var t = WORK_STYLES()[rec.code];
    out[who] = { name: plainText(t.name), emoji: plainText(t.emoji) };
  });
  return out;
}

/**
 * 型の説明を画面に渡せる形にする。点数は本人の画面にだけ渡す (rec.scores)。
 *
 * @param {{code: string, scores: Object<string, number>, takenAt: string}} rec
 * @returns {object}
 */
function workStylePlain_(rec) {
  var s = workStyleOf(rec.code);
  return {
    code: plainText(s.code),
    name: plainText(s.name),
    emoji: plainText(s.emoji),
    oneLine: plainText(s.oneLine),
    strengths: s.strengths.map(plainText),
    cautions: s.cautions.map(plainText),
    takenAt: plainDate(rec.takenAt),
    axes: s.axes.map(function (x) {
      var max = workStyleAxisMax(x.key);
      var score = plainNumber(rec.scores[x.key]) || 0;
      return {
        key: plainText(x.key), label: plainText(x.label),
        left: plainText(x.left.label), right: plainText(x.right.label),
        pole: plainText(x.pole.label), tip: plainText(x.pole.tip),
        score: score, max: plainNumber(max), lean: plainText(workStyleLean(score, max)),
      };
    }),
    uses: s.uses.map(function (u) {
      // 設定の名前は、いまの一覧から引く (写さない)。知らないものは画面に出さない
      var label = '';
      if (u.kind === 'pref') {
        var item = prefItem_(u.key);
        label = item ? item.label : '';
      } else {
        label = WORK_STYLE_VIEWS_()[u.key] || '';
      }
      return { kind: plainText(u.kind), key: plainText(u.key), label: plainText(label),
        why: plainText(u.why), from: plainText(u.from) };
    }).filter(function (u) { return !!u.label; }),
    card: plainText(workStyleCardText(rec.code, APP_NAME())),
  };
}

/**
 * おすすめの使い方で開ける画面。key は WORK_STYLE_AXES の uses の view。画面の styleGo も同じ key を知っている。
 *
 * @returns {Object<string, string>}
 */
function WORK_STYLE_VIEWS_() {
  return {
    board: '進捗ボード',
    gantt: '工程表',
    list: 'やることの一覧',
    help: '使い方',
  };
}

/**
 * 手元の Claude に渡す形 (命令 workStyle)。点数は入れない。返事は命令の入れ先に置かれ、
 * 共有している人なら読めるため。
 *
 * @param {string} email
 * @returns {object}
 */
function workStyleKitPlain_(email) {
  var rec = workStyleRead_(email);
  if (!rec) {
    return { taken: false, howTo: '画面の右上の自分の顔から「仕事のスタンス診断」を開くと、20問で診断できます' };
  }
  var s = workStyleOf(rec.code);
  return {
    taken: true,
    code: plainText(s.code),
    name: plainText(s.name),
    emoji: plainText(s.emoji),
    oneLine: plainText(s.oneLine),
    takenAt: plainDate(rec.takenAt),
    strengths: s.strengths.map(plainText),
    cautions: s.cautions.map(plainText),
    axes: s.axes.map(function (x) {
      return { label: plainText(x.label), pole: plainText(x.pole.label), support: plainText(x.pole.support) };
    }),
  };
}
