/**
 * 推し (Web App API)。**どれもアドレスを受けない。** 開いている本人のぶんだけを読み書きする
 * (ほかの人の推しを置く道は作らない)。定義は src/core/Oshi.js、置き場は src/core/OshiStore.gs。
 * **ほかの人のキャラを読む道は、作った人が「みんなに公開する」にしたものだけ** (src/core/OshiShare.gs)。
 * 読めるのは絵・名前・口調・せりふ・プロフィールで、書けるのは作った人だけ。
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
  return OSHI_EVENTS().map(function (e) {
    return { key: plainText(e.key), label: plainText(e.label), state: plainText(e.state), praise: !!e.praise,
      randomState: !!e.randomState, mood: !!e.mood,
      // 考え中 (spinner) は画面の吹き出しには出さず、自分のせりふの欄で直すだけ。字数の上限は場面ごと
      spinner: !!e.spinner, lineMax: plainNumber(oshiLineMaxOf(e.key)),
      lines: oshiToneLines(tone, e.key).map(plainText),
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
 * - builtins: 最初からいるキャラ。mine: 自分のキャラ (頁で直すため、せりふと絵の行・プロフィールの JSON・公開しているか もそれぞれに入れる)
 * - shared: ほかの人がみんなに公開したキャラ (選び方に並べるため。名前・口調・作った人の表示名・絵の行)。
 *   いま借りているキャラなら kind は 'shared' で、owner に作った人の表示名が入る (直す欄は出さない)
 * - reveal: いま使うキャラのプロフィール。Lv (実績の数) が届いた項目だけ名前と中身を入れる (サーバが決める)
 * - cleared: 実績を全部取ったか。clear: クリアしたときだけ、キャラのお祝いの言葉と動画の id (それまでは null)
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
      // 本人が書いたものなので、直す欄にはそのまま出す (動画もリンクで)
      profileJson: plainText(oshiProfileJson_(p.profile)),
      shared: oshiSharedOn_(p.row),
      profile: p.profile,
    };
  });
  // ほかの人が公開したキャラ。作った人は表示名だけ (アドレスは返さない)
  var memberRows = null;
  var shared = oshiSharedFor_(me, profRows).map(function (sc) {
    if (!memberRows) memberRows = dbReadAll('members');
    var p = oshiProfile_(sc.who, sc.charId, profRows);
    return { char: plainText('shared:' + sc.sid), sid: plainNumber(sc.sid), name: plainText(p.name), tone: plainText(p.tone),
      owner: plainText(oshiOwnerName_(sc.who, memberRows)),
      images: oshiImagesPlain_(oshiImageRows_(sc.who, sc.charId, imgRows)),
      src: p };
  });
  var active = null;
  var borrowed = null;
  if (choice.kind === 'mine') {
    for (var i = 0; i < mine.length; i++) if (mine[i].charId === choice.id) active = mine[i];
  } else if (choice.kind === 'shared') {
    for (var j = 0; j < shared.length; j++) if (shared[j].sid === choice.id) borrowed = shared[j];
    if (borrowed) {
      active = { charId: 0, name: borrowed.name, tone: borrowed.tone, images: borrowed.images, profile: borrowed.src.profile,
        events: oshiEventsPlain_(borrowed.src.tone, borrowed.src.lines) };
    }
  }
  // 公開が読む間に止められた (検査のあとで消えた) ときも、既定のキャラに倒す
  var builtin = active ? null : (oshiBuiltinOf(choice.key) || OSHI_BUILTINS()[0]);
  var profile = active ? active.profile : oshiBuiltinProfileRead_(builtin.key);
  mine.forEach(function (m) { delete m.profile; });
  shared.forEach(function (m) { delete m.src; });
  // 取れない実績は1回だけ数え、クリアと「クリアで分かる」の Lv の両方に使う
  var off = achUnavailable_(me);
  var cleared = oshiCleared_(me, off);
  var events = active ? active.events : oshiEventsPlain_(builtin.tone, {});
  return {
    char: plainText(borrowed ? borrowed.char : (active ? 'mine:' + active.charId : 'builtin:' + builtin.key)),
    kind: plainText(borrowed ? 'shared' : (active ? 'mine' : 'builtin')),
    builtinKey: plainText(active ? '' : builtin.key),
    charId: plainNumber(active ? active.charId : 0),
    // 借りているキャラの作った人 (表示名)。借りていなければ空
    owner: plainText(borrowed ? borrowed.owner : ''),
    fallback: plainText(active ? choice.fallback : ''),
    name: plainText(active ? active.name : builtin.name),
    tone: plainText(active ? active.tone : builtin.tone),
    events: events,
    images: active ? active.images : [],
    builtins: OSHI_BUILTINS().map(function (c) {
      return { key: plainText(c.key), name: plainText(c.name), tone: plainText(c.tone) };
    }),
    mine: mine,
    shared: shared,
    mineMax: plainNumber(OSHI_MINE_MAX()),
    styles: OSHI_STYLES().map(function (s) { return { key: plainText(s.key), label: plainText(s.label) }; }),
    tones: OSHI_TONES().map(function (t) { return { key: plainText(t.key), label: plainText(t.label) }; }),
    states: OSHI_STATES().map(function (s) {
      return { key: plainText(s.key), label: plainText(s.label), when: plainText(s.when), grow: !!s.grow, scene: !!s.scene,
        prompt: plainText(oshiPrompt(s.key)), optional: !!s.optional, fallback: plainText(s.fallback || '') };
    }),
    basePrompt: plainText(OSHI_PROMPT_BASE()),
    // キャラ作成キットの道具 (頼み文の中身は apiOshiCharKitPrompt で1つずつ取る) と、1枚の表を切り分けるときの既定の行と列
    kitTools: OSHI_CHARKIT_TOOLS().map(function (t) { return { key: plainText(t.key), label: plainText(t.label) }; }),
    sheet: { rows: plainNumber(oshiSheetGrid(OSHI_STATES().length).rows), cols: plainNumber(oshiSheetGrid(OSHI_STATES().length).cols) },
    luckyOneIn: plainNumber(OSHI_LUCKY_ONE_IN()),
    // 最初からいるキャラの絵の版。画面がブラウザに覚えた絵を使ってよいかを、取りに行く前に見る
    defaultImageVersion: plainNumber(OSHI_DEFAULT_IMAGE_VERSION()),
    growth: {
      index: plainNumber(g.index), key: plainText(g.key), label: plainText(g.label),
      meter: plainNumber(g.meter), toNext: plainNumber(g.toNext), level: plainNumber(g.level),
      unlocked: plainNumber(g.unlocked), floored: !!g.floored,
      stages: OSHI_STAGES().map(function (s) { return { key: plainText(s.key), label: plainText(s.label), min: plainNumber(s.min) }; }),
    },
    limits: {
      maxBytes: plainNumber(lim.maxBytes), maxPx: plainNumber(lim.maxPx),
      mimes: Object.keys(lim.mimes).map(plainText),
      nameMax: plainNumber(text.nameMax), lineMax: plainNumber(text.lineMax),
      linesPerEvent: plainNumber(text.linesPerEvent),
    },
    reveal: oshiRevealPlain_(profile, g.level, cleared, achLevelOf(ACHIEVEMENTS().length - Object.keys(off).length)),
    achOn: prefGet_('ach.on', me) !== false,
    cleared: cleared,
    // クリアの言葉と動画は、クリアしたときだけ入れる (動画の id もそれまで画面に渡さない)
    clear: cleared ? {
      line: plainText(profile ? profile.clearLine : ''),
      video: plainText(profile ? profile.clearVideo : ''),
    } : null,
    // 推しの機嫌 (自分の設定 oshi.mood)。オフなら null で、やることの台帳を読まない
    mood: oshiMoodPlain_(oshiMood_(me), events),
  };
}

/**
 * 推しの機嫌だけ (済ませたあとに、直ったかを見る)。オフなら null。本人のぶんだけ。
 *
 * @returns {?{level: string, label: string, event: string, state: string, recovered: boolean, line: string,
 *   reasons: Array<{kind: string, count: number, text: string}>}}
 */
function apiOshiMood() {
  var me = currentEmail_();
  var m = oshiMood_(me);
  if (!m) return null;
  var choice = oshiChoice_(me);
  var events = null;
  // 自分のキャラが在るかは oshiChoice_ (設定の検査) が見てある。ここでは名前と口調の表だけを読み、絵の表は読まない
  var s = choice.kind === 'shared' ? oshiSharedFind_(choice.id) : null;
  if (choice.kind === 'mine' || s) {
    // 借りたキャラ (公開されたもの) は、作った人が書いたせりふ
    var p = s ? oshiProfile_(s.who, s.charId, dbReadAll('oshi')) : oshiProfile_(me, choice.id, dbReadAll('oshi'));
    events = oshiEventsPlain_(p.tone, p.lines);
  } else {
    var b = oshiBuiltinOf(choice.key) || OSHI_BUILTINS()[0];
    events = oshiEventsPlain_(b.tone, {});
  }
  return oshiMoodPlain_(m, events);
}

/**
 * プロフィールの見せ方 (oshiProfileReveal)。届いていない項目は Lv だけ。
 *
 * @param {?object} profile
 * @param {number} level
 * @param {boolean} cleared
 * @param {number} maxLevel 最高の Lv (1 + この環境で取れる実績と取った実績の数)
 * @returns {{items: object[], open: number, total: number, maxLevel: number, limits: object}}
 */
function oshiRevealPlain_(profile, level, cleared, maxLevel) {
  var lim = OSHI_PROFILE_LIMITS();
  var items = oshiProfileReveal(profile ? profile.items : [], level, cleared).map(function (it) {
    return { lv: plainNumber(it.lv), open: !!it.open, label: plainText(it.label), text: plainText(it.text) };
  });
  return {
    items: items,
    open: plainNumber(items.filter(function (it) { return it.open; }).length),
    total: plainNumber(items.length),
    // 最高の Lv (この環境で取れる実績を全部取った = クリア)。これより上の Lv の項目は Lv では届かず、クリアで分かる
    maxLevel: plainNumber(maxLevel),
    limits: {
      itemsMax: plainNumber(lim.itemsMax), labelMax: plainNumber(lim.labelMax), textMax: plainNumber(lim.textMax),
      lvMin: plainNumber(lim.lvMin), lvMax: plainNumber(lim.lvMax), clearLineMax: plainNumber(lim.clearLineMax),
    },
  };
}

/**
 * キャラ作成キットの頼み文 (画面の「コピー」と、手元の道具の命令 oshiPrompt が使う)。
 * 最高の Lv は 1 + 実績の数 (プロフィールの項目の Lv をそこまでに散らす)。
 *
 * @param {string} tool OSHI_CHARKIT_TOOLS の key
 * @returns {{tool: string, label: string, prompt: string}}
 */
function oshiCharKitPromptPlain_(tool) {
  var t = oshiCharKitToolOf(tool);
  if (!t) {
    throw new Error('知らない道具です: ' + tool + '。' + OSHI_CHARKIT_TOOLS().map(function (x) { return x.key; }).join(' / ') + ' のどれかにしてください');
  }
  return { tool: plainText(t.key), label: plainText(t.label),
    prompt: plainText(oshiCharKitPrompt(t.key, achLevelOf(ACHIEVEMENTS().length))) };
}

/**
 * キャラ作成キットの頼み文を1つ (画面の「コピー」)。中身は番頭にだけあり、画面は写しを持たない。
 *
 * @param {string} tool chatgpt / gemini / claude / codex
 * @returns {{tool: string, label: string, prompt: string}}
 */
function apiOshiCharKitPrompt(tool) {
  return oshiCharKitPromptPlain_(tool);
}

/**
 * AI の答え (キャラ作成キットの JSON) を取り込む。charId が 0 なら新しいキャラを作り、そうでなければそのキャラを書き直す。
 * 確かめるのはサーバだけ (oshiCharImportValid_)。
 *
 * @param {number} charId 0 なら新しく作る
 * @param {string} text AI の答え (```json の囲みや前後の字があってもよい)
 * @returns {{charId: number, created: boolean, name: string, tone: string, lines: number, items: number}}
 */
function apiOshiCharImport(charId, text) {
  var id = charId === 0 || charId === '0' || charId === null || charId === undefined || charId === '' ? 0 : oshiCharIdArg_(charId);
  var got = oshiCharImport_(currentEmail_(), id, text);
  return { charId: plainNumber(got.id), created: !!got.created, name: plainText(got.name), tone: plainText(got.tone),
    lines: plainNumber(got.lines), items: plainNumber(got.items) };
}

/**
 * 自分のキャラのプロフィールを決める (JSON の字。空で外す)。形は oshiProfileValid_ (OshiStore.gs)。
 *
 * @param {number} charId
 * @param {string} json
 * @returns {{charId: number, items: number, profileJson: string}}
 */
function apiOshiSetCharProfile(charId, json) {
  var id = oshiCharIdArg_(charId);
  var p = oshiSetCharProfile_(currentEmail_(), id, json);
  return { charId: plainNumber(id), items: plainNumber(p ? p.items.length : 0), profileJson: plainText(oshiProfileJson_(p)) };
}

/**
 * 最初からいるキャラのプロフィールの一覧 (設定の画面の管理者の欄)。**管理者だけ。** 中身はスクリプトプロパティにだけある。
 *
 * @returns {{chars: Array<{key: string, name: string, json: string, items: number}>}}
 */
function apiOshiBuiltinProfiles() {
  repoAssertAdmin_('最初からいるキャラのプロフィールを見ること');
  return {
    chars: OSHI_BUILTINS().map(function (c) {
      var p = oshiBuiltinProfileRead_(c.key);
      return { key: plainText(c.key), name: plainText(c.name), json: plainText(oshiProfileJson_(p)),
        items: plainNumber(p ? p.items.length : 0) };
    }),
  };
}

/**
 * 最初からいるキャラのプロフィールを決める (JSON の字。空で外す)。**管理者だけ。**
 *
 * @param {string} key OSHI_BUILTINS の key
 * @param {string} json
 * @returns {{key: string, name: string, json: string, items: number}}
 */
function apiOshiBuiltinProfileSet(key, json) {
  var got = oshiBuiltinProfileSet_(currentEmail_(), key, json);
  return { key: plainText(got.key), name: plainText(oshiBuiltinOf(got.key).name), json: plainText(oshiProfileJson_(got.profile)),
    items: plainNumber(got.items) };
}

/**
 * 自分のキャラの表情の画像1枚 (data URL)。無ければ null。
 * charId に 'shared:<番号>' を渡すと、ほかの人がみんなに公開したキャラの絵を返す (公開されていなければ null)。
 *
 * @param {number|string} charId 自分のキャラの番号か 'shared:<番号>'
 * @param {string} state
 * @returns {{charId: number, state: string, sha: string, dataUrl: string}|null}
 */
function apiOshiImage(charId, state) {
  var sc = oshiCharParse(charId);
  if (sc && sc.kind === 'shared') {
    var s = oshiSharedFind_(sc.id);
    if (!s) {
      if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
      return null;
    }
    var sh = oshiImageData_(s.who, s.charId, state);
    // 作った人の番号は返さない (画面は中身の指紋と data URL だけを使う)
    return sh ? { charId: plainNumber(0), state: plainText(sh.state), sha: plainText(sh.sha), dataUrl: plainText(sh.dataUrl) } : null;
  }
  var got = oshiImageData_(currentEmail_(), oshiCharIdArg_(charId), state);
  return got ? { charId: plainNumber(got.charId), state: plainText(got.state), sha: plainText(got.sha),
    dataUrl: plainText(got.dataUrl) } : null;
}

/**
 * 最初からいるキャラクターの絵1枚 (data URL)。**最初のページには入れず、要るときに1枚ずつ渡す**
 * (1人の2つの形で 1MB 近くある)。画面がその場で覚え、ブラウザ (IndexedDB) にも版を添えて置く (js-oshi の oshiDefaultImage)。
 *
 * @param {string} char taku / itsuki / tsujippi / ikkun / ryoka / satomi (OSHI_BUILTINS の key)
 * @param {string} style chibi / normal
 * @param {string} state 表情
 * @returns {{char: string, style: string, state: string, dataUrl: string, version: number}|null}
 */
function apiOshiDefaultImage(char, style, state) {
  var url = oshiDefaultImage_(char, style, state);
  // version は絵の版。画面はこれを鍵に含めてブラウザに覚える (配り直して絵が変わったら、古い絵を使わない)
  return url ? { char: plainText(char), style: plainText(style), state: plainText(state), dataUrl: plainText(url),
    version: plainNumber(OSHI_DEFAULT_IMAGE_VERSION()) } : null;
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
 * 自分のキャラを「みんなに公開する」の入り切り。**本人のキャラだけ。** 名前を決めていないキャラは公開できない。
 * 公開すると、同じ入れ物を使うほかの人が使うキャラとして選べる (絵・名前・口調・せりふ・プロフィールが見える)。
 * 止めると、使っていた人は既定のキャラに戻る (oshi.char の検査が通らなくなる)。
 *
 * @param {number} charId
 * @param {boolean} on
 * @returns {{charId: number, shared: boolean}}
 */
function apiOshiSetShared(charId, on) {
  var id = oshiCharIdArg_(charId);
  var got = oshiSetShared_(currentEmail_(), id, on === true);
  return { charId: plainNumber(id), shared: !!got.shared };
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
 * 自分のキャラをまとめて消す (絵・名前・口調・せりふ・プロフィール)。育ちは実績で決まるので消さない。使うキャラの選び方も既定に戻す。
 *
 * @returns {{removed: number}}
 */
function apiOshiForget() {
  var n = oshiForget_(currentEmail_());
  apiPrefSet('oshi.char', null);
  return { removed: plainNumber(n) };
}
