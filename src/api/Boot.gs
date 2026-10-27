/**
 * 開いた直後の api をまとめて取る (Web App API)。
 *
 * 画面は開いた直後に api を十数本同時に投げる。1本ごとにサーバの起動代 (0.3〜1秒) がかかり、ブラウザは同じ相手への
 * 同時の接続を6本ほどに絞るので、台帳を読むだけの軽いものまで後ろで待たされていた。本番で1つの実行の中で順に呼ぶと、
 * ここに挙げたものは合わせて 2 秒ほど (2026-10-27)。Drive を読む重いもの (文書の一覧・ホームの要約・前進の中身・推し) は
 * 入れない。まとめると直列になって、並べて取るより遅くなる。**ほかの呼び出しが待つもの** (前進 `apiProgress` → カードの5本、
 * 設定 `apiPrefs` → 推し) も入れない。まとめの返事を待つぶん、続きが遅れる。
 *
 * **ここに挙げた名前しか呼ばない。** 引数も渡さない (開いた直後に引数なしで呼ぶものだけ)。画面の `BOOT_BATCH_NAMES`
 * (app.js.html) と同じ並びで、`test/component/boot.test.js` が揃っていることを見る。
 *
 * @returns {string[]}
 */
function BOOT_BATCH_NAMES() {
  return [
    'apiWorkspace', 'apiSettings', 'apiWhoAmI',
    'apiMyMilestones', 'apiGameState', 'apiGameTop',
  ];
}

/**
 * 名前の並びの api を順に呼び、1つずつの返事か断りを返す。1つが断っても残りは返す (画面はそれぞれの
 * 失敗の扱いに回す)。
 *
 * @param {string[]} names BOOT_BATCH_NAMES のもの
 * @returns {Array<{ok: boolean, value?: *, error?: string}>}
 */
function apiBoot(names) {
  var allowed = BOOT_BATCH_NAMES();
  var root = typeof globalThis !== 'undefined' ? globalThis : this;
  var out = [];
  var list = names || [];
  // 画面は決まった名前を1回ずつしか送らない。数が多い・同じ名前が2つあるものは断る (1回の実行で何度も Drive を読ませない)
  if (list.length > allowed.length) throw new Error('まとめて取れないものです: ' + list.length + '本');
  var seen = {};
  for (var d = 0; d < list.length; d++) {
    if (seen[String(list[d])]) throw new Error('まとめて取れないものです: ' + list[d] + ' が2つ');
    seen[String(list[d])] = true;
  }
  for (var i = 0; i < list.length; i++) {
    var name = String(list[i]);
    if (allowed.indexOf(name) < 0 || typeof root[name] !== 'function') {
      out.push({ ok: false, error: 'まとめて取れないものです: ' + name });
      continue;
    }
    try {
      var value = root[name]();
      out.push({ ok: true, value: value === undefined ? null : value });
    } catch (e) {
      out.push({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  return out;
}
