/**
 * 推しの置き場。定義 (表情・口調・せりふ・頼み文・上限) は src/core/Oshi.js が持つ。
 *
 * - 名前・口調・自分のせりふは台帳の `oshi` に、1人1行
 * - 表情ごとの画像は、中身を objects/ (中身の指紋の名前) に、どの人のどの表情かを台帳の `oshi_images` に置く
 *   (台帳のセルには上限があり、画像は入らない)
 * - 育ちの最高の段だけを UserProperties (`OSHI_STAGE_MAX:<アドレス>`) に覚える (取り消しで戻さない)
 *
 * **番頭の画面では本人にだけ見せる。** 末尾が _ の関数はアドレスを受けるので画面から呼べない。
 * api は開いている本人のアドレスだけを渡す。ただし台帳と objects/ は入れ物の中にあり、
 * Drive で入れ物を共有している人は直に開ける。画面にもそう書く (隠せるとは言わない)。
 */

/**
 * 小文字のアドレス。比べるのは小文字どうし (台帳には人が手で書いた大文字が混ざりうる)。
 *
 * @param {string} email
 * @returns {string}
 */
function oshiWho_(email) {
  return String(email || '').replace(/^\s+|\s+$/g, '').toLowerCase();
}

/**
 * その人が最初からいるキャラクターを使うか (自分の設定 oshi.useDefault。既定はオン)。
 *
 * @param {string} email
 * @returns {boolean}
 */
function oshiUseDefault_(email) {
  return prefGet_('oshi.useDefault', oshiWho_(email)) !== false;
}

/**
 * その人の名前・口調・自分のせりふ。まだ決めていなければ、最初からいるキャラを使う人は
 * その名前と口調 (OSHI_DEFAULT)、使わない人は名前なし・丁寧。せりふは無し。
 *
 * @param {string} email
 * @param {object[]} [rows] 読んだ oshi の行
 * @returns {{row: (object|null), name: string, tone: string, lines: Object<string, string[]>}}
 */
function oshiProfile_(email, rows) {
  var who = oshiWho_(email);
  var list = rows || dbReadAll('oshi');
  var row = null;
  for (var i = 0; i < list.length; i++) {
    if (oshiWho_(list[i].who) === who) { row = list[i]; break; }
  }
  var lines = {};
  if (row && row.lines) {
    try {
      var got = JSON.parse(String(row.lines));
      if (got && typeof got === 'object' && !Array.isArray(got)) {
        // 人が台帳を手で書き換えうる。知らない場面と字でないものは捨てる
        OSHI_EVENTS().forEach(function (e) {
          if (Array.isArray(got[e.key])) {
            lines[e.key] = got[e.key].filter(function (s) { return typeof s === 'string' && s; });
          }
        });
      }
    } catch (e) { /* 読めなければ、せりふは無いことにする */ }
  }
  var first = row ? null : (oshiUseDefault_(who) ? OSHI_DEFAULT() : { name: '', tone: 'polite' });
  var tone = row ? (oshiToneKnown(row.tone) ? String(row.tone) : 'polite') : first.tone;
  return { row: row, name: row ? plainText(row.name) : first.name, tone: tone, lines: lines };
}

/**
 * 名前・口調・せりふを書く。**あるか見てから書くまでを1つの鍵の中で行う**
 * (分けると、ほぼ同時の2回が両方「無い」と読んで、同じ人の行が2つ並ぶ)。
 *
 * @param {string} email
 * @param {{name?: string, tone?: string, lines?: Object<string, string[]>}} patch
 * @returns {{name: string, tone: string, lines: Object<string, string[]>}}
 */
function oshiProfileWrite_(email, patch) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  return dbWithLock_(30000, function () {
    var cur = oshiProfile_(who);
    var next = {
      who: who,
      name: patch.name !== undefined ? patch.name : cur.name,
      tone: patch.tone !== undefined ? patch.tone : cur.tone,
      lines: JSON.stringify(patch.lines !== undefined ? patch.lines : cur.lines),
      updatedAt: new Date(),
    };
    if (cur.row) dbUpdate('oshi', 'id', cur.row.id, next);
    else dbAppendNumbered('oshi', 'id', next);
    return { name: next.name, tone: next.tone, lines: JSON.parse(next.lines) };
  });
}

/**
 * 名前と口調を決める。
 *
 * @param {string} email
 * @param {string} name 空なら名前なし
 * @param {string} tone OSHI_TONES の key
 * @returns {object}
 */
function oshiSetProfile_(email, name, tone) {
  var lim = OSHI_TEXT_LIMITS();
  var n = String(name == null ? '' : name).replace(/^\s+|\s+$/g, '');
  if (n.length > lim.nameMax) throw new Error('名前は' + lim.nameMax + '字までにしてください');
  if (!oshiToneKnown(tone)) throw new Error('知らない口調です: ' + tone);
  return oshiProfileWrite_(email, { name: n, tone: String(tone) });
}

/**
 * 場面ごとの自分のせりふを決める。空にすると、その場面は既定のせりふだけになる。
 *
 * @param {string} email
 * @param {string} event OSHI_EVENTS の key
 * @param {string[]|string} lines
 * @returns {string[]} 残したせりふ
 */
function oshiSetLines_(email, event, lines) {
  if (!oshiEventOf(event)) throw new Error('知らない場面です: ' + event);
  var clean = oshiCleanLines(lines);
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  return dbWithLock_(30000, function () {
    var all = oshiProfile_(who).lines;
    if (clean.length) all[String(event)] = clean;
    else delete all[String(event)];
    oshiProfileWrite_(who, { lines: all });
    return clean;
  });
}

/**
 * その人の画像の行。表情ごとに1つ (同じ表情が2つあれば後のもの)。
 *
 * @param {string} email
 * @returns {Object<string, object>} state → 行
 */
function oshiImageRows_(email) {
  var who = oshiWho_(email);
  var out = {};
  if (!who) return out;
  dbReadAll('oshi_images').forEach(function (r) {
    if (oshiWho_(r.who) !== who) return;
    if (!oshiStateOf(r.state)) return;
    out[String(r.state)] = r;
  });
  return out;
}

/**
 * 中身が名乗った形式と合うか (先頭の数バイトを見る)。拡張子だけ変えた別の物を通さない。
 *
 * @param {number[]} bytes 符号付きでもよい
 * @param {string} mime
 * @returns {boolean}
 */
function oshiMagicOk_(bytes, mime) {
  function at(i) { return bytes.length > i ? (bytes[i] & 0xff) : -1; }
  function is(start, list) {
    for (var i = 0; i < list.length; i++) if (at(start + i) !== list[i]) return false;
    return true;
  }
  if (mime === 'image/png') return is(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/jpeg') return is(0, [0xff, 0xd8, 0xff]);
  if (mime === 'image/gif') return is(0, [0x47, 0x49, 0x46, 0x38]);
  if (mime === 'image/webp') return is(0, [0x52, 0x49, 0x46, 0x46]) && is(8, [0x57, 0x45, 0x42, 0x50]);
  return false;
}

/**
 * 画面から届いた画像 (data URL) を読み、検査する。**置く前に全部を確かめる。**
 *
 * @param {string} dataUrl
 * @returns {{mime: string, ext: string, bytes: number[]}}
 */
function oshiParseImage_(dataUrl) {
  var lim = OSHI_IMAGE_LIMITS();
  var m = /^data:([a-z\/+.-]+);base64,([A-Za-z0-9+\/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('画像として読めませんでした');
  var mime = m[1];
  var ext = Object.prototype.hasOwnProperty.call(lim.mimes, mime) ? lim.mimes[mime] : '';
  if (!ext) throw new Error('受け取れない形式です (PNG・JPEG・WebP・GIF だけ): ' + mime);
  // base64 は元の4/3の長さになる。復号する前に大きさを断る
  var data = m[2].replace(/\s+/g, '');
  if (Math.floor(data.length * 3 / 4) > lim.maxBytes + 2) {
    throw new Error('画像は1枚' + Math.round(lim.maxBytes / 1024 / 1024) + 'MBまでにしてください');
  }
  var bytes = Utilities.base64Decode(data);
  if (!bytes.length) throw new Error('画像として読めませんでした');
  if (bytes.length > lim.maxBytes) {
    throw new Error('画像は1枚' + Math.round(lim.maxBytes / 1024 / 1024) + 'MBまでにしてください');
  }
  if (!oshiMagicOk_(bytes, mime)) throw new Error('画像の中身が形式と合いません: ' + mime);
  return { mime: mime, ext: ext, bytes: bytes };
}

/**
 * 表情の画像を置く。同じ表情が既にあれば差し替える。
 *
 * 中身を objects/ に置くのは、検査を通って鍵を取ってから (先に置くと、断ったときや鍵が取れなかったときに
 * どこからも指されない中身が残る)。差し替えた前の中身は、ほかに指す行が無ければゴミ箱へ移す。
 *
 * @param {string} email
 * @param {string} state OSHI_STATES の key
 * @param {string} dataUrl
 * @returns {{state: string, sha: string, mime: string}}
 */
function oshiSetImage_(email, state, dataUrl) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var img = oshiParseImage_(dataUrl);
  var blob = Utilities.newBlob(img.bytes, img.mime, 'oshi.' + img.ext);
  var sha = sha256HexBytes(blob);

  return dbWithLock_(30000, function () {
    var old = oshiImageRows_(who)[String(state)] || null;
    objectPutBlob(sha, blob, img.ext);
    var row = { who: who, state: String(state), sha: sha, mime: img.mime, updatedAt: new Date() };
    if (old) {
      row.id = old.id;
      dbUpdate('oshi_images', 'id', old.id, row);
      if (String(old.sha) !== sha) oshiDropObject_(String(old.sha), String(old.mime));
    } else {
      dbAppendNumbered('oshi_images', 'id', row);
    }
    return { state: row.state, sha: sha, mime: img.mime };
  });
}

/**
 * どの行からも指されていない中身をゴミ箱へ移す。片付けのついでなので、移せなくても続ける
 * (共有ドライブでは役割によって移せない)。
 *
 * @param {string} sha
 * @param {string} mime
 */
function oshiDropObject_(sha, mime) {
  var ext = OSHI_IMAGE_LIMITS().mimes[mime];
  if (!ext || !/^[0-9a-f]{64}$/.test(sha)) return;
  var still = dbReadAll('oshi_images').some(function (r) { return String(r.sha) === sha; });
  if (still) return;
  try {
    var it = objectsFolder_().getFilesByName(objectPath_(sha, ext));
    if (it.hasNext()) it.next().setTrashed(true);
  } catch (e) { /* 残っても、どこからも指されないだけ */ }
}

/**
 * 表情の画像を外す。
 *
 * @param {string} email
 * @param {string} state
 * @returns {boolean} 外したか
 */
function oshiClearImage_(email, state) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  return dbWithLock_(30000, function () {
    var old = oshiImageRows_(who)[String(state)];
    if (!old) return false;
    dbDelete('oshi_images', 'id', old.id);
    oshiDropObject_(String(old.sha), String(old.mime));
    return true;
  });
}

/**
 * 推しをまるごと消す (名前・口調・せりふ・画像)。入れた道と対の、出る道。
 * 画像の行を先に消し、名前の行を最後に消す (途中で落ちても、もう一度押せば片付く)。
 *
 * @param {string} email
 * @returns {number} 消した画像の数
 */
function oshiForget_(email) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  return dbWithLock_(30000, function () {
    var imgs = oshiImageRows_(who);
    var n = 0;
    Object.keys(imgs).forEach(function (k) {
      dbDelete('oshi_images', 'id', imgs[k].id);
      oshiDropObject_(String(imgs[k].sha), String(imgs[k].mime));
      n++;
    });
    var prof = oshiProfile_(who);
    if (prof.row) dbDelete('oshi', 'id', prof.row.id);
    PropertiesService.getUserProperties().deleteProperty('OSHI_STAGE_MAX:' + who);
    return n;
  });
}

/**
 * 表情の画像を data URL で返す。本人の行だけを見る (中身の指紋を名指しで読む道は作らない)。
 *
 * @param {string} email
 * @param {string} state
 * @returns {{state: string, sha: string, dataUrl: string}|null}
 */
function oshiImageData_(email, state) {
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var row = oshiImageRows_(email)[String(state)];
  if (!row) return null;
  var ext = OSHI_IMAGE_LIMITS().mimes[String(row.mime)];
  if (!ext || !/^[0-9a-f]{64}$/.test(String(row.sha))) return null;
  var it = objectsFolder_().getFilesByName(objectPath_(String(row.sha), ext));
  if (!it.hasNext()) return null;
  // 100KB を超えうるのでキャッシュに置かない (CacheService の上限)。画面が中身の指紋ごとに覚える
  var bytes = it.next().getBlob().getBytes();
  return {
    state: String(row.state),
    sha: String(row.sha),
    dataUrl: 'data:' + String(row.mime) + ';base64,' + Utilities.base64Encode(bytes),
  };
}

/**
 * 育ちの数。**台帳から数え、保存しない。**
 *
 * ポイントとレベルに参加している人はそのポイント (gamePointsByPerson_)。参加していない人は、
 * 済ませたやること (担当。担当が空なら閉じた人) と反映した確認依頼 (出した人) の数。
 * どちらも本人のぶんだけ。
 *
 * @param {string} email
 * @returns {{points: number, source: string}}
 */
function oshiPoints_(email) {
  var who = oshiWho_(email);
  if (!who) return { points: 0, source: 'count' };
  var playing = gameEnabled() && gamePlayers_().some(function (p) { return oshiWho_(p) === who; });
  if (playing) {
    var pts = gamePointsByPerson_('', '');
    var sum = 0;
    Object.keys(pts).forEach(function (k) { if (oshiWho_(k) === who) sum += pts[k]; });
    return { points: Math.round(sum * 1e9) / 1e9, source: 'game' };
  }
  var n = 0;
  var closers = motivationClosers_();
  dbReadAll('issues').forEach(function (row) {
    if (String(row.state) !== 'closed') return;
    if (motivationCredited_(row, closers).some(function (p) { return oshiWho_(p) === who; })) n++;
  });
  dbReadAll('pulls').forEach(function (pr) {
    if (String(pr.state) === 'merged' && oshiWho_(pr.author) === who) n++;
  });
  return { points: n, source: 'count' };
}

/**
 * 育ちの段。届いた最高の段を覚えて、それより下には戻さない (取り消しで下がらない)。
 *
 * @param {string} email
 * @returns {{index: number, key: string, label: string, meter: number, toNext: number, points: number, source: string}}
 */
function oshiGrowth_(email) {
  var who = oshiWho_(email);
  var got = oshiPoints_(who);
  var props = PropertiesService.getUserProperties();
  var key = 'OSHI_STAGE_MAX:' + who;
  var seen = Number(props.getProperty(key));
  if (!isFinite(seen) || seen < 0) seen = 0;
  var st = oshiStageOf(got.points, seen);
  if (who && st.index > seen) props.setProperty(key, String(st.index));
  return {
    index: st.index, key: st.key, label: st.label, meter: st.meter, toNext: st.toNext,
    points: got.points, source: got.source,
  };
}

/**
 * 最初からいるキャラクターの絵 (data URL)。形と表情は定義にあるものだけを通す。
 * 絵は src/core/OshiDefault{Normal,Chibi}.gs (scripts/build-oshi-default.mjs が作る)。
 *
 * @param {string} style OSHI_STYLES の key
 * @param {string} state OSHI_STATES の key
 * @returns {string|null} 絵が無ければ null
 */
function oshiDefaultImage_(style, state) {
  if (!oshiStyleKnown(style)) throw new Error('知らない絵の形です: ' + style);
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var all = String(style) === 'normal' ? OSHI_DEFAULT_NORMAL() : OSHI_DEFAULT_CHIBI();
  return Object.prototype.hasOwnProperty.call(all, String(state)) ? all[String(state)] : null;
}
