/**
 * 推し (Web App API)。**どれもアドレスを受けない。** 開いている本人のぶんだけを読み書きする
 * (ほかの人の推しを読む道・置く道を作らない)。定義は src/core/Oshi.js、置き場は src/core/OshiStore.gs。
 */

/**
 * 自分の推しのすべて (画像の中身を除く)。画面はこれで頁と吹き出しを組む。
 * 画像の中身は大きいので apiOshiImage で1枚ずつ取る。
 *
 * @returns {object}
 */
function apiOshiGet() {
  var me = currentEmail_();
  var prof = oshiProfile_(me);
  var imgs = oshiImageRows_(me);
  var defaults = OSHI_LINES()[prof.tone] || OSHI_LINES().polite;
  var lim = OSHI_IMAGE_LIMITS();
  var text = OSHI_TEXT_LIMITS();
  var g = oshiGrowth_(me);
  return {
    name: plainText(prof.name),
    tone: plainText(prof.tone),
    // 最初からいるキャラ。絵そのものは apiOshiDefaultImage で1枚ずつ取る
    defaultName: plainText(OSHI_DEFAULT().name),
    styles: OSHI_STYLES().map(function (s) { return { key: plainText(s.key), label: plainText(s.label) }; }),
    tones: OSHI_TONES().map(function (t) { return { key: plainText(t.key), label: plainText(t.label) }; }),
    states: OSHI_STATES().map(function (s) {
      return { key: plainText(s.key), label: plainText(s.label), when: plainText(s.when), grow: !!s.grow,
        prompt: plainText(oshiPrompt(s.key)) };
    }),
    events: OSHI_EVENTS().map(function (e) {
      return { key: plainText(e.key), label: plainText(e.label), state: plainText(e.state), praise: !!e.praise,
        lines: (defaults[e.key] || []).map(plainText),
        mine: (prof.lines[e.key] || []).map(plainText) };
    }),
    basePrompt: plainText(OSHI_PROMPT_BASE()),
    luckyOneIn: plainNumber(OSHI_LUCKY_ONE_IN()),
    images: Object.keys(imgs).map(function (k) {
      return { state: plainText(imgs[k].state), sha: plainText(imgs[k].sha), mime: plainText(imgs[k].mime),
        updatedAt: plainDate(imgs[k].updatedAt) };
    }),
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
 * 表情の画像1枚 (data URL)。無ければ null。
 *
 * @param {string} state
 * @returns {{state: string, sha: string, dataUrl: string}|null}
 */
function apiOshiImage(state) {
  var got = oshiImageData_(currentEmail_(), state);
  return got ? { state: plainText(got.state), sha: plainText(got.sha), dataUrl: plainText(got.dataUrl) } : null;
}

/**
 * 最初からいるキャラクターの絵1枚 (data URL)。**最初のページには入れず、要るときに1枚ずつ渡す**
 * (全部で 1MB 近くある)。画面がその場で覚える。
 *
 * @param {string} style chibi / normal
 * @param {string} state 表情
 * @returns {{style: string, state: string, dataUrl: string}|null}
 */
function apiOshiDefaultImage(style, state) {
  var url = oshiDefaultImage_(style, state);
  return url ? { style: plainText(style), state: plainText(state), dataUrl: plainText(url) } : null;
}

/**
 * 表情の画像を置く (差し替える)。PNG・JPEG・WebP・GIF の 1MB まで。
 *
 * @param {string} state
 * @param {string} dataUrl
 * @returns {{state: string, sha: string, mime: string}}
 */
function apiOshiSetImage(state, dataUrl) {
  var got = oshiSetImage_(currentEmail_(), state, dataUrl);
  return { state: plainText(got.state), sha: plainText(got.sha), mime: plainText(got.mime) };
}

/**
 * 表情の画像を外す。
 *
 * @param {string} state
 * @returns {{state: string, removed: boolean}}
 */
function apiOshiClearImage(state) {
  return { state: plainText(state), removed: !!oshiClearImage_(currentEmail_(), state) };
}

/**
 * 名前と口調を決める。
 *
 * @param {string} name
 * @param {string} tone
 * @returns {{name: string, tone: string}}
 */
function apiOshiSetProfile(name, tone) {
  var got = oshiSetProfile_(currentEmail_(), name, tone);
  return { name: plainText(got.name), tone: plainText(got.tone) };
}

/**
 * 場面ごとの自分のせりふを決める (空で消す)。
 *
 * @param {string} event
 * @param {string[]} lines
 * @returns {{event: string, lines: string[]}}
 */
function apiOshiSetLines(event, lines) {
  var got = oshiSetLines_(currentEmail_(), event, lines);
  return { event: plainText(event), lines: got.map(plainText) };
}

/**
 * 推しをまるごと消す。
 *
 * @returns {{removed: number}}
 */
function apiOshiForget() {
  return { removed: plainNumber(oshiForget_(currentEmail_())) };
}
