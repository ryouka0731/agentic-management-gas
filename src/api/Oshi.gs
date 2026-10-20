/**
 * 推し (Web App API)。**どれもアドレスを受けない。** 開いている本人のぶんだけを読み書きする
 * (ほかの人の推しを読む道・置く道を作らない)。定義は src/core/Oshi.js、置き場は src/core/OshiStore.gs。
 *
 * キャラは2種類ある。最初からいるキャラ (OSHI_BUILTINS。名前・口調・絵は決まっていて変えられない) と、
 * 本人が作る自分のキャラ (OSHI_MINE_MAX 人まで。番号 charId で名指す)。どれを使うかは自分の設定 oshi.char。
 */

/**
 * 場面ごとのせりふ。口調の既定と、自分のせりふ。
 *
 * @param {string} tone
 * @param {Object<string, string[]>} mine
 * @returns {object[]}
 */
function oshiEventsPlain_(tone, mine) {
  var defaults = OSHI_LINES()[tone] || OSHI_LINES().polite;
  return OSHI_EVENTS().map(function (e) {
    return { key: plainText(e.key), label: plainText(e.label), state: plainText(e.state), praise: !!e.praise,
      lines: (defaults[e.key] || []).map(plainText),
      mine: ((mine || {})[e.key] || []).map(plainText) };
  });
}

/**
 * @param {Object<string, object>} imgs state → 行
 * @returns {object[]}
 */
function oshiImagesPlain_(imgs) {
  return Object.keys(imgs).map(function (k) {
    return { state: plainText(imgs[k].state), sha: plainText(imgs[k].sha), mime: plainText(imgs[k].mime),
      updatedAt: plainDate(imgs[k].updatedAt) };
  });
}

/**
 * 自分の推しのすべて (画像の中身を除く)。画面はこれで頁と吹き出しを組む。
 * 画像の中身は大きいので apiOshiImage / apiOshiDefaultImage で1枚ずつ取る。
 *
 * - char / kind / builtinKey / charId / name / tone / events / images: いま使うキャラ (自分の設定 oshi.char)
 * - fallback: 自分のキャラを使っているとき、絵の無い表情に出す最初からいるキャラの key (出さないなら空)
 * - builtins: 最初からいるキャラ。mine: 自分のキャラ (頁で直すため、せりふと絵の行もそれぞれに入れる)
 *
 * @returns {object}
 */
function apiOshiGet() {
  var me = currentEmail_();
  var lim = OSHI_IMAGE_LIMITS();
  var text = OSHI_TEXT_LIMITS();
  var g = oshiGrowth_(me);
  var choice = oshiChoice_(me);
  var profRows = dbReadAll('oshi');
  var imgRows = dbReadAll('oshi_images');
  var mine = oshiMineIds_(me, profRows, imgRows).map(function (id) {
    var p = oshiProfile_(me, id, profRows);
    return {
      charId: plainNumber(id), name: plainText(p.name), tone: plainText(p.tone),
      events: oshiEventsPlain_(p.tone, p.lines),
      images: oshiImagesPlain_(oshiImageRows_(me, id, imgRows)),
    };
  });
  var active = null;
  if (choice.kind === 'mine') {
    for (var i = 0; i < mine.length; i++) if (mine[i].charId === choice.id) active = mine[i];
  }
  var builtin = active ? null : oshiBuiltinOf(choice.key);
  return {
    char: plainText(active ? 'mine:' + active.charId : 'builtin:' + builtin.key),
    kind: plainText(active ? 'mine' : 'builtin'),
    builtinKey: plainText(active ? '' : builtin.key),
    charId: plainNumber(active ? active.charId : 0),
    fallback: plainText(active ? choice.fallback : ''),
    name: plainText(active ? active.name : builtin.name),
    tone: plainText(active ? active.tone : builtin.tone),
    events: active ? active.events : oshiEventsPlain_(builtin.tone, {}),
    images: active ? active.images : [],
    builtins: OSHI_BUILTINS().map(function (c) {
      return { key: plainText(c.key), name: plainText(c.name), tone: plainText(c.tone) };
    }),
    mine: mine,
    mineMax: plainNumber(OSHI_MINE_MAX()),
    styles: OSHI_STYLES().map(function (s) { return { key: plainText(s.key), label: plainText(s.label) }; }),
    tones: OSHI_TONES().map(function (t) { return { key: plainText(t.key), label: plainText(t.label) }; }),
    states: OSHI_STATES().map(function (s) {
      return { key: plainText(s.key), label: plainText(s.label), when: plainText(s.when), grow: !!s.grow,
        prompt: plainText(oshiPrompt(s.key)) };
    }),
    basePrompt: plainText(OSHI_PROMPT_BASE()),
    luckyOneIn: plainNumber(OSHI_LUCKY_ONE_IN()),
    growth: {
      index: plainNumber(g.index), key: plainText(g.key), label: plainText(g.label),
      meter: plainNumber(g.meter), toNext: plainNumber(g.toNext), points: plainNumber(g.points),
      source: plainText(g.source),
      stages: OSHI_STAGES().map(function (s) { return { key: plainText(s.key), label: plainText(s.label), min: plainNumber(s.min) }; }),
    },
    limits: {
      maxBytes: plainNumber(lim.maxBytes), maxPx: plainNumber(lim.maxPx),
      mimes: Object.keys(lim.mimes).map(plainText),
      nameMax: plainNumber(text.nameMax), lineMax: plainNumber(text.lineMax),
      linesPerEvent: plainNumber(text.linesPerEvent),
    },
  };
}

/**
 * 自分のキャラの表情の画像1枚 (data URL)。無ければ null。
 *
 * @param {number} charId
 * @param {string} state
 * @returns {{charId: number, state: string, sha: string, dataUrl: string}|null}
 */
function apiOshiImage(charId, state) {
  var got = oshiImageData_(currentEmail_(), oshiCharIdArg_(charId), state);
  return got ? { charId: plainNumber(got.charId), state: plainText(got.state), sha: plainText(got.sha),
    dataUrl: plainText(got.dataUrl) } : null;
}

/**
 * 最初からいるキャラクターの絵1枚 (data URL)。**最初のページには入れず、要るときに1枚ずつ渡す**
 * (1人の2つの形で 1MB 近くある)。画面がその場で覚える。
 *
 * @param {string} char kuroha / taku (OSHI_BUILTINS の key)
 * @param {string} style chibi / normal
 * @param {string} state 表情
 * @returns {{char: string, style: string, state: string, dataUrl: string}|null}
 */
function apiOshiDefaultImage(char, style, state) {
  var url = oshiDefaultImage_(char, style, state);
  return url ? { char: plainText(char), style: plainText(style), state: plainText(state), dataUrl: plainText(url) } : null;
}

/**
 * 自分のキャラを1人作る (OSHI_MINE_MAX 人まで)。
 *
 * @param {string} name
 * @param {string} tone
 * @returns {{charId: number, name: string, tone: string}}
 */
function apiOshiCharCreate(name, tone) {
  var got = oshiCharCreate_(currentEmail_(), name, tone);
  return { charId: plainNumber(got.id), name: plainText(got.name), tone: plainText(got.tone) };
}

/**
 * 自分のキャラを1人消す (名前・口調・せりふ・絵)。使うキャラに選んでいたら、選び方を既定に戻す。
 *
 * @param {number} charId
 * @returns {{charId: number, removed: number}}
 */
function apiOshiCharDelete(charId) {
  var id = oshiCharIdArg_(charId);
  var me = currentEmail_();
  // 消す前に見る (消したあとは在るか見る検査で既定に倒れて、選んでいたか分からない)
  var chosen = oshiChoice_(me);
  var n = oshiCharDelete_(me, id);
  // 番号は二度出さないので残しても害は無いが、「既定に戻す」が残ったままになる
  if (chosen.kind === 'mine' && chosen.id === id) apiPrefSet('oshi.char', null);
  return { charId: plainNumber(id), removed: plainNumber(n) };
}

/**
 * 自分のキャラの表情の画像を置く (差し替える)。PNG・JPEG・WebP・GIF の 1MB まで。
 *
 * @param {number} charId
 * @param {string} state
 * @param {string} dataUrl
 * @returns {{charId: number, state: string, sha: string, mime: string}}
 */
function apiOshiSetImage(charId, state, dataUrl) {
  var got = oshiSetImage_(currentEmail_(), oshiCharIdArg_(charId), state, dataUrl);
  return { charId: plainNumber(got.charId), state: plainText(got.state), sha: plainText(got.sha), mime: plainText(got.mime) };
}

/**
 * 自分のキャラの表情の画像を外す。
 *
 * @param {number} charId
 * @param {string} state
 * @returns {{charId: number, state: string, removed: boolean}}
 */
function apiOshiClearImage(charId, state) {
  var id = oshiCharIdArg_(charId);
  return { charId: plainNumber(id), state: plainText(state), removed: !!oshiClearImage_(currentEmail_(), id, state) };
}

/**
 * 自分のキャラの名前と口調を決める。
 *
 * @param {number} charId
 * @param {string} name
 * @param {string} tone
 * @returns {{charId: number, name: string, tone: string}}
 */
function apiOshiSetProfile(charId, name, tone) {
  var got = oshiSetProfile_(currentEmail_(), oshiCharIdArg_(charId), name, tone);
  return { charId: plainNumber(got.id), name: plainText(got.name), tone: plainText(got.tone) };
}

/**
 * 自分のキャラの場面ごとのせりふを決める (空で消す)。
 *
 * @param {number} charId
 * @param {string} event
 * @param {string[]} lines
 * @returns {{charId: number, event: string, lines: string[]}}
 */
function apiOshiSetLines(charId, event, lines) {
  var id = oshiCharIdArg_(charId);
  var got = oshiSetLines_(currentEmail_(), id, event, lines);
  return { charId: plainNumber(id), event: plainText(event), lines: got.map(plainText) };
}

/**
 * 自分のキャラをまとめて消す (育ちの覚えも)。使うキャラの選び方も既定に戻す。
 *
 * @returns {{removed: number}}
 */
function apiOshiForget() {
  var n = oshiForget_(currentEmail_());
  apiPrefSet('oshi.char', null);
  return { removed: plainNumber(n) };
}
