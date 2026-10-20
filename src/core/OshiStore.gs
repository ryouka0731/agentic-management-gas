/**
 * 推しの置き場。定義 (表情・口調・せりふ・頼み文・上限) は src/core/Oshi.js が持つ。
 *
 * - 自分のキャラは1人 OSHI_MINE_MAX 人まで。人ごとの番号 (`charId`) で分ける
 * - 名前・口調・自分のせりふは台帳の `oshi` に、キャラごとに1行
 * - 表情ごとの画像は、中身を objects/ (`oshi-<中身の指紋>.<拡張子>`。oshiObjectName_) に、どの人のどのキャラのどの表情かを
 *   台帳の `oshi_images` に置く (台帳のセルには上限があり、画像は入らない)
 * - **推しの画像は文書の履歴の画像と別の名前で置く。** 履歴の画像も `<sha>.<ext>` で置かれるので、同じ名前だと
 *   同じバイトの推しの画像を外したとき、履歴が要る画像までゴミ箱へ移してしまう
 * - Drive のファイルを触るのは鍵の外 (鍵の中では台帳の行を書き、片付ける中身の指紋を集めるだけ)
 * - `charId` は後から足した列。それより前の行は空で、その人の1人目 (1) として読む (oshiCharIdOf_)
 * - 最初からいるキャラ (OSHI_BUILTINS) は台帳に置かない。名前・口調は決まっていて、絵は焼いたファイルにある
 * - どのキャラを使うかは自分の設定 oshi.char、自分のキャラの絵が無い表情に出す最初からいるキャラは oshi.fallback
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
 * 行の自分のキャラの番号。**この列 (charId) を足す前の行は空なので、その人の1人目 (1) として読む**
 * (それまでは1人1キャラだった)。書き直すときに 1 が入る。
 *
 * @param {object} row
 * @returns {number}
 */
function oshiCharIdOf_(row) {
  var n = Number(row && row.charId);
  return isFinite(n) && n >= 1 && Math.floor(n) === n ? n : 1;
}

/**
 * 画面から届いた自分のキャラの番号を読む。読めなければふつうの言葉で断る。
 *
 * @param {*} v
 * @returns {number}
 */
function oshiCharIdArg_(v) {
  var n = Number(v);
  if (!(isFinite(n) && n >= 1 && n < 1000000 && Math.floor(n) === n)) throw new Error('知らないキャラです: ' + v);
  return n;
}

/**
 * その人の自分のキャラの番号 (小さい順)。名前の行か、絵の行のどちらかがあれば「ある」。
 * (前は名前を決めずに絵だけ入れられたので、絵の行しか無い1人目もある)
 *
 * @param {string} email
 * @param {object[]} [profRows] 読んだ oshi の行
 * @param {object[]} [imgRows] 読んだ oshi_images の行
 * @returns {number[]}
 */
function oshiMineIds_(email, profRows, imgRows) {
  var who = oshiWho_(email);
  var seen = {};
  if (!who) return [];
  (profRows || dbReadAll('oshi')).concat(imgRows || dbReadAll('oshi_images')).forEach(function (r) {
    if (oshiWho_(r.who) === who) seen[oshiCharIdOf_(r)] = true;
  });
  return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
}

/**
 * 自分のキャラがあるか確かめる。無ければふつうの言葉で断る。
 *
 * @param {string} email
 * @param {number} id
 */
function oshiAssertMine_(email, id) {
  if (oshiMineIds_(email).indexOf(id) < 0) throw new Error('そのキャラは見つかりません。推しの頁を開き直してください');
}

/**
 * 自分のキャラの名前・口調・自分のせりふ。名前の行が無ければ (絵だけの1人目) 名前なし・丁寧。
 *
 * @param {string} email
 * @param {number} id 自分のキャラの番号
 * @param {object[]} [rows] 読んだ oshi の行
 * @returns {{row: (object|null), id: number, name: string, tone: string, lines: Object<string, string[]>}}
 */
function oshiProfile_(email, id, rows) {
  var who = oshiWho_(email);
  var list = rows || dbReadAll('oshi');
  var row = null;
  for (var i = 0; i < list.length; i++) {
    if (oshiWho_(list[i].who) === who && oshiCharIdOf_(list[i]) === id) { row = list[i]; break; }
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
  var tone = row && oshiToneKnown(row.tone) ? String(row.tone) : 'polite';
  return { row: row, id: id, name: row ? plainText(row.name) : '', tone: tone, lines: lines };
}

/**
 * 名前・口調・せりふを書く。**あるか見てから書くまでを1つの鍵の中で行う**
 * (分けると、ほぼ同時の2回が両方「無い」と読んで、同じキャラの行が2つ並ぶ)。
 *
 * @param {string} email
 * @param {number} id
 * @param {{name?: string, tone?: string, lines?: Object<string, string[]>}} patch
 * @returns {{id: number, name: string, tone: string, lines: Object<string, string[]>}}
 */
function oshiProfileWrite_(email, id, patch) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  return dbWithLock_(30000, function () {
    oshiAssertMine_(who, id);
    var cur = oshiProfile_(who, id);
    var next = {
      who: who,
      name: patch.name !== undefined ? patch.name : cur.name,
      tone: patch.tone !== undefined ? patch.tone : cur.tone,
      lines: JSON.stringify(patch.lines !== undefined ? patch.lines : cur.lines),
      updatedAt: new Date(),
      charId: id,
    };
    if (cur.row) dbUpdate('oshi', 'id', cur.row.id, next);
    else dbAppendNumbered('oshi', 'id', next);
    return { id: id, name: next.name, tone: next.tone, lines: JSON.parse(next.lines) };
  });
}

/**
 * 名前を整える。長すぎれば断る。
 *
 * @param {*} name
 * @returns {string}
 */
function oshiCleanName_(name) {
  var lim = OSHI_TEXT_LIMITS();
  var n = String(name == null ? '' : name).replace(/^\s+|\s+$/g, '');
  if (n.length > lim.nameMax) throw new Error('名前は' + lim.nameMax + '字までにしてください');
  return n;
}

/**
 * 自分のキャラを1人作る。上限 (OSHI_MINE_MAX) まで。
 *
 * **番号は人ごとの通し番号で、一度出した番号は二度出さない** (スクリプトプロパティ `OSHI_CHAR_HIGH:<アドレス>`
 * に出した最大を覚える)。消した番号を次のキャラに回すと、自分の設定 oshi.char が指していた消したキャラが、
 * 選んだ覚えの無い新しいキャラにすり替わる。数えるのと書くのは1つの鍵の中で行う。
 *
 * @param {string} email
 * @param {string} name
 * @param {string} tone
 * @returns {{id: number, name: string, tone: string}}
 */
function oshiCharCreate_(email, name, tone) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  var n = oshiCleanName_(name);
  var t = tone === undefined || tone === null || tone === '' ? 'polite' : String(tone);
  if (!oshiToneKnown(t)) throw new Error('知らない口調です: ' + t);
  return dbWithLock_(30000, function () {
    var ids = oshiMineIds_(who);
    if (ids.length >= OSHI_MINE_MAX()) {
      throw new Error('自分のキャラは' + OSHI_MINE_MAX() + '人までです。作り直すときは、使わないキャラを消してください');
    }
    var id = oshiCharHighNote_(who, ids) + 1;
    dbAppendNumbered('oshi', 'id', { who: who, name: n, tone: t, lines: '{}', updatedAt: new Date(), charId: id });
    PropertiesService.getScriptProperties().setProperty('OSHI_CHAR_HIGH:' + who, String(id));
    return { id: id, name: n, tone: t };
  });
}

/**
 * 出した番号の最大を、いまある番号 (charId の列を足す前の1人目の 1 も) と合わせて覚え直し、その値を返す。
 * 作る前と消す前に呼ぶ。**前の形の1人目は oshiCharCreate_ を通っていないので覚えが無い。** 覚えずに消すと、
 * 次に作るキャラが 1 を受け取り、oshi.char が指していた消したキャラにすり替わる。鍵の中で呼ぶ。
 *
 * @param {string} who 小文字のアドレス
 * @param {number[]} ids いまある番号
 * @returns {number}
 */
function oshiCharHighNote_(who, ids) {
  var props = PropertiesService.getScriptProperties();
  var key = 'OSHI_CHAR_HIGH:' + who;
  var high = Number(props.getProperty(key));
  if (!isFinite(high) || high < 0) high = 0;
  var top = Math.max(high, ids.length ? ids[ids.length - 1] : 0);
  if (top > high) props.setProperty(key, String(top));
  return top;
}

/**
 * 名前と口調を決める。
 *
 * @param {string} email
 * @param {number} id
 * @param {string} name 空なら名前なし
 * @param {string} tone OSHI_TONES の key
 * @returns {object}
 */
function oshiSetProfile_(email, id, name, tone) {
  var n = oshiCleanName_(name);
  if (!oshiToneKnown(tone)) throw new Error('知らない口調です: ' + tone);
  return oshiProfileWrite_(email, id, { name: n, tone: String(tone) });
}

/**
 * 場面ごとの自分のせりふを決める。空にすると、その場面は口調のせりふだけになる。
 *
 * @param {string} email
 * @param {number} id
 * @param {string} event OSHI_EVENTS の key
 * @param {string[]|string} lines
 * @returns {string[]} 残したせりふ
 */
function oshiSetLines_(email, id, event, lines) {
  if (!oshiEventOf(event)) throw new Error('知らない場面です: ' + event);
  var clean = oshiCleanLines(lines);
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  return dbWithLock_(30000, function () {
    oshiAssertMine_(who, id);
    var all = oshiProfile_(who, id).lines;
    if (clean.length) all[String(event)] = clean;
    else delete all[String(event)];
    oshiProfileWrite_(who, id, { lines: all });
    return clean;
  });
}

/**
 * そのキャラの画像の行。表情ごとに1つ (同じ表情が2つあれば後のもの)。
 *
 * @param {string} email
 * @param {number} id
 * @param {object[]} [rows] 読んだ oshi_images の行
 * @returns {Object<string, object>} state → 行
 */
function oshiImageRows_(email, id, rows) {
  var who = oshiWho_(email);
  var out = {};
  if (!who) return out;
  (rows || dbReadAll('oshi_images')).forEach(function (r) {
    if (oshiWho_(r.who) !== who || oshiCharIdOf_(r) !== id) return;
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
  var bytes;
  try {
    bytes = Utilities.base64Decode(data);
  } catch (e) {
    // 形は base64 でも、並びが壊れていると復号で投げる。そのままの英語を見せない
    throw new Error('画像として読めませんでした');
  }
  if (!bytes || !bytes.length) throw new Error('画像として読めませんでした');
  if (bytes.length > lim.maxBytes) {
    throw new Error('画像は1枚' + Math.round(lim.maxBytes / 1024 / 1024) + 'MBまでにしてください');
  }
  if (!oshiMagicOk_(bytes, mime)) throw new Error('画像の中身が形式と合いません: ' + mime);
  return { mime: mime, ext: ext, bytes: bytes };
}

/**
 * 表情の画像を置く。同じ表情が既にあれば差し替える。
 *
 * 中身を objects/ に置くのは、検査を通り、鍵の中で行を書いてから (先に置くと、断ったときや鍵が取れなかったときに
 * どこからも指されない中身が残る)。置くのも片付けるのも鍵の外 (Drive を鍵の中に相乗りさせない)。
 * 行を先に書くので、ほぼ同時に片付ける側はこの行を見て、同じ中身をゴミ箱へ移さない。
 * 差し替えた前の中身は、ほかに指す行が無ければゴミ箱へ移す。
 *
 * @param {string} email
 * @param {number} id 自分のキャラの番号
 * @param {string} state OSHI_STATES の key
 * @param {string} dataUrl
 * @returns {{charId: number, state: string, sha: string, mime: string}}
 */
function oshiSetImage_(email, id, state, dataUrl) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var img = oshiParseImage_(dataUrl);
  var blob = Utilities.newBlob(img.bytes, img.mime, 'oshi.' + img.ext);
  var sha = sha256HexBytes(blob);

  var drop = [];
  var got = dbWithLock_(30000, function () {
    oshiAssertMine_(who, id);
    var old = oshiImageRows_(who, id)[String(state)] || null;
    var row = { who: who, state: String(state), sha: sha, mime: img.mime, updatedAt: new Date(), charId: id };
    if (old) {
      row.id = old.id;
      dbUpdate('oshi_images', 'id', old.id, row);
      if (String(old.sha) !== sha || String(old.mime) !== img.mime) drop.push({ sha: String(old.sha), mime: String(old.mime) });
    } else {
      dbAppendNumbered('oshi_images', 'id', row);
    }
    return { charId: id, state: row.state, sha: sha, mime: img.mime };
  });
  oshiObjectPut_(sha, blob, img.ext);
  oshiDropObjects_(drop);
  return got;
}

/**
 * 推しの画像の中身のファイル名。文書の履歴の画像 (`<sha>.<ext>`。DocRenderer の imageExt_) と重ならない名前にする。
 *
 * @param {string} sha
 * @param {string} ext
 * @returns {string}
 */
function oshiObjectName_(sha, ext) {
  return 'oshi-' + objectPath_(sha, ext);
}

/**
 * 推しの画像の中身を objects/ に置く。同じ名前が既にあれば何もしない。鍵の外で呼ぶ。
 *
 * @param {string} sha
 * @param {GoogleAppsScript.Base.Blob} blob
 * @param {string} ext
 */
function oshiObjectPut_(sha, blob, ext) {
  var name = oshiObjectName_(sha, ext);
  var folder = objectsFolder_();
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(blob.copyBlob().setName(name));
}

/**
 * 推しの画像の中身のファイル。この形にする前の行は中身を `<sha>.<ext>` に置いたので、無ければそちらを見る。
 *
 * @param {string} sha
 * @param {string} ext
 * @returns {GoogleAppsScript.Drive.File|null}
 */
function oshiObjectFile_(sha, ext) {
  var folder = objectsFolder_();
  var it = folder.getFilesByName(oshiObjectName_(sha, ext));
  if (it.hasNext()) return it.next();
  var legacy = folder.getFilesByName(objectPath_(sha, ext));
  return legacy.hasNext() ? legacy.next() : null;
}

/**
 * どの行からも指されていない推しの画像の中身をゴミ箱へ移す。**鍵の外で呼ぶ** (鍵の中では指紋を集めるだけ)。
 * 指されているかは、鍵を出たあとに読み直して確かめる (そのあいだに同じ中身を入れ直した人がいるかもしれない)。
 * 片付けのついでなので、移せなくても続ける (共有ドライブでは役割によって移せない)。
 *
 * **移すのは `oshi-<sha>.<ext>` だけ。** この形にする前の行の中身 (`<sha>.<ext>`) は、文書の履歴の画像と
 * 名前が同じで、どちらのものか見分けられないので移さない (残っても、どこからも指されないだけ)。
 *
 * @param {{sha: string, mime: string}[]} list
 */
function oshiDropObjects_(list) {
  if (!list || !list.length) return;
  var rows = null;
  list.forEach(function (o) {
    var sha = String(o.sha);
    var ext = OSHI_IMAGE_LIMITS().mimes[String(o.mime)];
    if (!ext || !/^[0-9a-f]{64}$/.test(sha)) return;
    try {
      if (!rows) rows = dbReadAll('oshi_images');
      var still = rows.some(function (r) {
        return String(r.sha) === sha && OSHI_IMAGE_LIMITS().mimes[String(r.mime)] === ext;
      });
      if (still) return;
      var it = objectsFolder_().getFilesByName(oshiObjectName_(sha, ext));
      if (it.hasNext()) it.next().setTrashed(true);
    } catch (e) { /* 残っても、どこからも指されないだけ */ }
  });
}

/**
 * 表情の画像を外す。
 *
 * @param {string} email
 * @param {number} id
 * @param {string} state
 * @returns {boolean} 外したか
 */
function oshiClearImage_(email, id, state) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var drop = [];
  var done = dbWithLock_(30000, function () {
    var old = oshiImageRows_(who, id)[String(state)];
    if (!old) return false;
    dbDelete('oshi_images', 'id', old.id);
    drop.push({ sha: String(old.sha), mime: String(old.mime) });
    return true;
  });
  oshiDropObjects_(drop);
  return done;
}

/**
 * 自分のキャラを1人消す (名前・口調・せりふ・絵)。入れた道と対の、出る道。ほかのキャラはそのまま。
 * 画像の行を先に消し、名前の行を最後に消す (途中で落ちても、もう一度押せば片付く)。
 * 中身 (objects/) は、ほかに指す行が無ければゴミ箱へ移す。
 *
 * @param {string} email
 * @param {number} id
 * @returns {number} 消した画像の数
 */
function oshiCharDelete_(email, id) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  var drop = [];
  var n = dbWithLock_(30000, function () {
    oshiAssertMine_(who, id);
    return oshiCharDeleteRows_(who, id, drop);
  });
  oshiDropObjects_(drop);
  return n;
}

/**
 * 自分のキャラ1人ぶんの行を消す。**鍵の中で呼ぶ。** 片付ける中身は drop に集めるだけで、Drive は触らない。
 * 消す前に出した番号の覚えを合わせる (前の形の1人目を消しても、その番号を次に回さない)。
 *
 * @param {string} who 小文字のアドレス
 * @param {number} id
 * @param {{sha: string, mime: string}[]} drop
 * @returns {number} 消した画像の数
 */
function oshiCharDeleteRows_(who, id, drop) {
  oshiCharHighNote_(who, oshiMineIds_(who));
  var n = 0;
  // 同じ表情の行が2つ残っていることもある (手で書き足した行)。そのキャラの行は全部消す
  dbReadAll('oshi_images').forEach(function (r) {
    if (oshiWho_(r.who) !== who || oshiCharIdOf_(r) !== id) return;
    dbDelete('oshi_images', 'id', r.id);
    drop.push({ sha: String(r.sha), mime: String(r.mime) });
    n++;
  });
  dbReadAll('oshi').forEach(function (r) {
    if (oshiWho_(r.who) === who && oshiCharIdOf_(r) === id) dbDelete('oshi', 'id', r.id);
  });
  return n;
}

/**
 * 自分のキャラを全部消す (名前・口調・せりふ・画像・育ちの覚え)。
 * 出した番号の覚え (OSHI_CHAR_HIGH) は残す (消した番号を次のキャラに回さない)。
 *
 * @param {string} email
 * @returns {number} 消した画像の数
 */
function oshiForget_(email) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  var drop = [];
  var n = dbWithLock_(30000, function () {
    var count = 0;
    oshiMineIds_(who).forEach(function (id) { count += oshiCharDeleteRows_(who, id, drop); });
    PropertiesService.getUserProperties().deleteProperty('OSHI_STAGE_MAX:' + who);
    return count;
  });
  oshiDropObjects_(drop);
  return n;
}

/**
 * 表情の画像を data URL で返す。本人の行だけを見る (中身の指紋を名指しで読む道は作らない)。
 *
 * @param {string} email
 * @param {number} id
 * @param {string} state
 * @returns {{charId: number, state: string, sha: string, dataUrl: string}|null}
 */
function oshiImageData_(email, id, state) {
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var row = oshiImageRows_(email, id)[String(state)];
  if (!row) return null;
  var ext = OSHI_IMAGE_LIMITS().mimes[String(row.mime)];
  if (!ext || !/^[0-9a-f]{64}$/.test(String(row.sha))) return null;
  var file = oshiObjectFile_(String(row.sha), ext);
  if (!file) return null;
  // 100KB を超えうるのでキャッシュに置かない (CacheService の上限)。画面が中身の指紋ごとに覚える
  var bytes = file.getBlob().getBytes();
  return {
    charId: id,
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
 * 最初からいるキャラクターの絵 (data URL)。キャラ・形・表情は定義にあるものだけを通す。
 * 絵は src/core/OshiDefault<キャラ><形>.gs (scripts/build-oshi-default.mjs が作る)。
 *
 * @param {string} char OSHI_BUILTINS の key
 * @param {string} style OSHI_STYLES の key
 * @param {string} state OSHI_STATES の key
 * @returns {string|null} 絵が無ければ null
 */
function oshiDefaultImage_(char, style, state) {
  if (!oshiBuiltinOf(char)) throw new Error('知らないキャラです: ' + char);
  if (!oshiStyleKnown(style)) throw new Error('知らない絵の形です: ' + style);
  if (!oshiStateOf(state)) throw new Error('知らない表情です: ' + state);
  var all = oshiDefaultPictures_(String(char), String(style));
  return all && Object.prototype.hasOwnProperty.call(all, String(state)) ? all[String(state)] : null;
}

/**
 * キャラと形 → 焼いた絵の表。キャラを足したら、ここにも足す (test/oshi.test.js が全部の組を引いて見ている)。
 * 呼ぶのは要るときだけ (焼いたファイルは大きいので、読まないテストもある)。
 *
 * @param {string} char
 * @param {string} style
 * @returns {Object<string,string>|null}
 */
function oshiDefaultPictures_(char, style) {
  if (char === 'kuroha') return style === 'normal' ? OSHI_DEFAULT_KUROHA_NORMAL() : OSHI_DEFAULT_KUROHA_CHIBI();
  if (char === 'taku') return style === 'normal' ? OSHI_DEFAULT_TAKU_NORMAL() : OSHI_DEFAULT_TAKU_CHIBI();
  return null;
}

/**
 * 使うキャラの名指しが、その人にとって在るものか。最初からいるキャラは誰にでもあり、
 * 自分のキャラは本人が持っているものだけ (自分の設定 oshi.char の検査。Prefs.gs の prefValid_ が呼ぶ)。
 *
 * @param {string} email
 * @param {*} v
 * @returns {boolean}
 */
function oshiCharKnownFor_(email, v) {
  var c = oshiCharParse(v);
  if (!c) return false;
  if (c.kind === 'builtin') return true;
  return oshiMineIds_(email).indexOf(c.id) >= 0;
}

/**
 * いま使うキャラ (自分の設定 oshi.char)。在るものだけが返る (無い・消したキャラなら既定の最初からいるキャラ)。
 * 自分のキャラのときは、絵の無い表情に出す最初からいるキャラ (oshi.fallback。'none' なら出さない) も添える。
 *
 * @param {string} email
 * @returns {{value: string, kind: string, key: string, id: number, fallback: string}}
 */
function oshiChoice_(email) {
  var who = oshiWho_(email);
  var value = String(prefGet_('oshi.char', who));
  var c = oshiCharParse(value) || oshiCharParse('builtin:' + OSHI_BUILTINS()[0].key);
  var fb = oshiCharParse(prefGet_('oshi.fallback', who));
  return { value: value, kind: c.kind, key: c.key, id: c.id, fallback: fb && fb.kind === 'builtin' ? fb.key : '' };
}
