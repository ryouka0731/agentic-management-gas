/**
 * 推しの置き場。定義 (表情・口調・せりふ・頼み文・上限) は src/core/Oshi.js が持つ。
 *
 * - 自分のキャラは1人 OSHI_MINE_MAX 人まで。人ごとの番号 (`charId`) で分ける
 * - 名前・口調・自分のせりふ・プロフィールは台帳の `oshi` に、キャラごとに1行 (プロフィールは後から足した列 `profile`)
 * - 最初からいるキャラのプロフィールは台帳にもリポジトリにも置かず、スクリプトプロパティ `OSHI_PROFILE:<key>` にだけ置く
 *   (管理者が入れる。oshiBuiltinProfileRead_)
 * - 表情ごとの画像は、中身を objects/ (`oshi-<中身の指紋>.<拡張子>`。oshiObjectName_) に、どの人のどのキャラのどの表情かを
 *   台帳の `oshi_images` に置く (台帳のセルには上限があり、画像は入らない)
 * - **推しの画像は文書の履歴の画像と別の名前で置く。** 履歴の画像も `<sha>.<ext>` で置かれるので、同じ名前だと
 *   同じバイトの推しの画像を外したとき、履歴が要る画像までゴミ箱へ移してしまう
 * - Drive のファイルを触るのは鍵の外 (鍵の中では台帳の行を書き、片付ける中身の指紋を集めるだけ)
 * - `charId` は後から足した列。それより前の行は空で、その人の1人目 (1) として読む (oshiCharIdOf_)
 * - 最初からいるキャラ (OSHI_BUILTINS) は台帳に置かない。名前・口調は決まっていて、絵は焼いたファイルにある
 * - どのキャラを使うかは自分の設定 oshi.char、自分のキャラの絵が無い表情に出す最初からいるキャラは oshi.fallback
 * - 育ちの段は取った実績の数 (Lv) で決まる (oshiGrowth_)。実績は消えないので段も戻らない。前の最高の段 (OSHI_STAGE_MAX:) より下にしない
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
 * 自分のキャラの名前・口調・自分のせりふ・プロフィール。名前の行が無ければ (絵だけの1人目) 名前なし・丁寧。
 *
 * @param {string} email
 * @param {number} id 自分のキャラの番号
 * @param {object[]} [rows] 読んだ oshi の行
 * @returns {{row: (object|null), id: number, name: string, tone: string, lines: Object<string, string[]>, profile: ?object}}
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
  // プロフィール (後から足した列)。読めない・検査に通らないものは無いことにする
  var profile = row ? oshiProfileParse_(row.profile) : null;
  return { row: row, id: id, name: row ? plainText(row.name) : '', tone: tone, lines: lines, profile: profile };
}

/**
 * 名前・口調・せりふを書く。**あるか見てから書くまでを1つの鍵の中で行う**
 * (分けると、ほぼ同時の2回が両方「無い」と読んで、同じキャラの行が2つ並ぶ)。
 *
 * @param {string} email
 * @param {number} id
 * @param {{name?: string, tone?: string, lines?: Object<string, string[]>, profile?: string}} patch profile は検査を通した JSON の字 (空で外す)
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
      // 読めなかった前の値は残さない (書き直すときに無いことにする)
      profile: patch.profile !== undefined ? patch.profile
        : (cur.profile ? JSON.stringify({ items: cur.profile.items, clearLine: cur.profile.clearLine, clearVideo: cur.profile.clearVideo }) : ''),
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
  // 字の数は見た目の1字ずつ数える (絵文字も1字。せりふの oshiCleanLines と同じ)
  if (Array.from(n).length > lim.nameMax) throw new Error('名前は' + lim.nameMax + '字までにしてください');
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
 * 自分のキャラを全部消す (名前・口調・せりふ・画像)。育ちは実績で決まるので消さない (前の段の覚え OSHI_STAGE_MAX: も残す)。
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
 * 育ちの段。**Lv = 1 + 取った実績の数** (achLevel_。src/core/AchievementsStore.gs) から決める。
 * 取った実績は消さないので、段は下がらない。実績の前に届いていた段 (UserProperties の OSHI_STAGE_MAX:) より下にもしない
 * (achStageFloor_。前から使っている人の推しが、実績を足した日に見習いへ戻らないように)。
 *
 * @param {string} email
 * @returns {{index: number, key: string, label: string, meter: number, toNext: number, level: number, unlocked: number}}
 */
function oshiGrowth_(email) {
  var lv = achLevel_(oshiWho_(email));
  return { index: lv.index, key: lv.key, label: lv.label, meter: lv.meter, toNext: lv.toNext, level: lv.level,
    unlocked: lv.unlocked };
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
  if (char === 'itsuki') return style === 'normal' ? OSHI_DEFAULT_ITSUKI_NORMAL() : OSHI_DEFAULT_ITSUKI_CHIBI();
  if (char === 'taku') return style === 'normal' ? OSHI_DEFAULT_TAKU_NORMAL() : OSHI_DEFAULT_TAKU_CHIBI();
  if (char === 'tsujippi') return style === 'normal' ? OSHI_DEFAULT_TSUJIPPI_NORMAL() : OSHI_DEFAULT_TSUJIPPI_CHIBI();
  if (char === 'ikkun') return style === 'normal' ? OSHI_DEFAULT_IKKUN_NORMAL() : OSHI_DEFAULT_IKKUN_CHIBI();
  if (char === 'ryoka') return style === 'normal' ? OSHI_DEFAULT_RYOKA_NORMAL() : OSHI_DEFAULT_RYOKA_CHIBI();
  if (char === 'satomi') return style === 'normal' ? OSHI_DEFAULT_SATOMI_NORMAL() : OSHI_DEFAULT_SATOMI_CHIBI();
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

// ----- プロフィール (Lv で少しずつ分かる) と、クリア -----

/**
 * プロフィールを確かめて整える。**ここが唯一の検査** (最初からいるキャラの管理者の欄・手元からの命令 oshiProfileSet・
 * 自分のキャラの欄・置き場から読むときのどれもここを通す)。合わなければふつうの言葉で断る。
 *
 * 形: `{items: [{lv, label, text}], clearLine, clearVideo}`。items は OSHI_PROFILE_LIMITS の数まで、lv は整数。
 * clearVideo は YouTube の動画のリンク (か、読み解いたあとの11字の id) で、id だけを残す (読み解くのは focusMusicParse_)。
 * 再生リストとほかの場所は断る。JSON の字で渡してもよい。空の字は「プロフィール無し」。
 *
 * @param {*} v
 * @returns {{items: Array<{lv: number, label: string, text: string}>, clearLine: string, clearVideo: string}}
 */
function oshiProfileValid_(v) {
  var lim = OSHI_PROFILE_LIMITS();
  var p = v;
  if (typeof p === 'string') {
    if (!p.replace(/\s+/g, '')) return { items: [], clearLine: '', clearVideo: '' };
    try {
      p = JSON.parse(p);
    } catch (e) {
      throw new Error('プロフィールを JSON として読めませんでした。items (項目の並び) を持つ形で書いてください');
    }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('プロフィールは items (項目の並び) を持つ JSON の形で書いてください');
  Object.keys(p).forEach(function (k) {
    if (['items', 'clearLine', 'clearVideo'].indexOf(k) < 0) {
      throw new Error('プロフィールに知らない欄があります。使えるのは items・clearLine・clearVideo だけです: ' + k);
    }
  });
  var list = p.items === undefined || p.items === null ? [] : p.items;
  if (!Array.isArray(list)) throw new Error('items は並び ([...]) で書いてください');
  if (list.length > lim.itemsMax) throw new Error('プロフィールの項目は' + lim.itemsMax + '個までにしてください');
  var items = list.map(function (it, i) {
    var at = (i + 1) + '番目の項目';
    if (!it || typeof it !== 'object' || Array.isArray(it)) throw new Error(at + 'は lv・label・text を持つ形にしてください');
    Object.keys(it).forEach(function (k) {
      if (['lv', 'label', 'text'].indexOf(k) < 0) throw new Error(at + 'に知らない欄があります。使えるのは lv・label・text だけです: ' + k);
    });
    var lv = Number(it.lv);
    if (typeof it.lv !== 'number' || Math.floor(lv) !== lv || lv < lim.lvMin || lv > lim.lvMax) {
      throw new Error(at + 'の lv は ' + lim.lvMin + ' から ' + lim.lvMax + ' までの整数にしてください');
    }
    var label = oshiProfileText_(it.label);
    var text = oshiProfileText_(it.text);
    if (!label) throw new Error(at + 'の label (見出し) を書いてください');
    if (label.length > lim.labelMax) throw new Error(at + 'の label は' + lim.labelMax + '字までにしてください');
    if (!text) throw new Error(at + 'の text (中身) を書いてください');
    if (text.length > lim.textMax) throw new Error(at + 'の text は' + lim.textMax + '字までにしてください');
    return { lv: lv, label: label, text: text };
  });
  var line = oshiProfileText_(p.clearLine);
  if (line.length > lim.clearLineMax) throw new Error('clearLine (クリアのお祝い) は' + lim.clearLineMax + '字までにしてください');
  var out = { items: items, clearLine: line, clearVideo: oshiProfileVideo_(p.clearVideo) };
  // 台帳のセルは5万字まで。JSON にすると膨らむ字 (対の無いサロゲートなど) もあるので、書く形の長さで断る
  if (JSON.stringify(out).length > OSHI_PROFILE_JSON_MAX()) {
    throw new Error('プロフィールが長すぎます。JSON にして' + OSHI_PROFILE_JSON_MAX() + '字までにしてください');
  }
  return out;
}

/**
 * プロフィールの字。無い (null / undefined) は空、字でないものは断る。前後の空白は落とす。
 *
 * @param {*} v
 * @returns {string}
 */
function oshiProfileText_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error('プロフィールの label・text・clearLine は字 ("…") で書いてください');
  // 制御文字 (改行・タブを除く) は落とす。見えないうえに、JSON にすると \uXXXX の6字に膨らむ
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/^\s+|\s+$/g, '');
}

/**
 * クリアの動画。YouTube の動画1本のリンクか、読み解いたあとの id。id だけを返す (空なら動画なし)。
 * 読み解くのは集中のしかたの「自分の曲」と同じ focusMusicParse_ (URL の読み方を2つにしない)。
 *
 * @param {*} v
 * @returns {string}
 */
function oshiProfileVideo_(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw new Error('clearVideo (クリアの動画) は YouTube の動画のリンクを字で書いてください');
  var s = v.replace(/^\s+|\s+$/g, '');
  if (!s) return '';
  if (focusMusicRe_().video.test(s) && s !== 'videoseries') return s;
  var got = focusMusicParse_(s);
  if (got.ok && got.parts.kind === 'youtube' && got.parts.video) return got.parts.video;
  if (got.ok && got.parts.kind === 'youtube') {
    throw new Error('clearVideo (クリアの動画) は、再生リストの入っていない YouTube の動画1本のリンクにしてください');
  }
  throw new Error('clearVideo (クリアの動画) は YouTube の動画のリンクだけ使えます');
}

/**
 * 置き場から読んだプロフィール。読めない・検査に通らないものは無いことにする (人がエディタや台帳で書き換えうる)。
 *
 * @param {*} raw
 * @returns {?{items: object[], clearLine: string, clearVideo: string}}
 */
function oshiProfileParse_(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    var p = oshiProfileValid_(String(raw));
    return p.items.length || p.clearLine || p.clearVideo ? p : null;
  } catch (e) {
    return null;
  }
}

/**
 * 直す欄に出す JSON。動画は id ではなくリンクで出す (書いたときの形に近づける)。無ければ空。
 *
 * @param {?object} p
 * @returns {string}
 */
function oshiProfileJson_(p) {
  if (!p) return '';
  var out = { items: p.items };
  if (p.clearLine) out.clearLine = p.clearLine;
  if (p.clearVideo) out.clearVideo = focusMusicLinkOf_({ kind: 'youtube', video: p.clearVideo });
  return JSON.stringify(out, null, 2);
}

/** プロフィールを JSON にした字の上限。台帳のセル (5万字) に余裕を見る */
function OSHI_PROFILE_JSON_MAX() {
  return 45000;
}

/** 1つの値に置く UTF-8 のバイトの上限。スクリプトプロパティは1つ 9KB までなので余裕を見る (REWARD_MAX_BYTES と同じ) */
function OSHI_PROFILE_PART_BYTES() {
  return 8000;
}

/** 最初からいるキャラのプロフィールの鍵。分けて置くときは `<鍵>:<0 から>` に続きを置く */
function oshiBuiltinProfileKey_(key) {
  return 'OSHI_PROFILE:' + key;
}

/**
 * 最初からいるキャラのプロフィール。**中身はリポジトリに置かない** (スクリプトプロパティ OSHI_PROFILE:<key> にだけある。
 * 管理者が設定の画面か手元からの命令 oshiProfileSet で入れる)。無い・読めない・検査に通らないなら null。
 *
 * 1つの値は 9KB までなので、収まらないときは頭に `{"parts": N, "v": 版}` を置き、続きを `OSHI_PROFILE:<key>:<版>:0`〜`N-1` に
 * 分けて置く。版の無い `{"parts": N}` (続きは `OSHI_PROFILE:<key>:0`〜) も読む (oshiProfileHead_)。
 *
 * @param {string} key OSHI_BUILTINS の key
 * @returns {?object}
 */
function oshiBuiltinProfileRead_(key) {
  if (!oshiBuiltinOf(key)) return null;
  var props = PropertiesService.getScriptProperties();
  var base = oshiBuiltinProfileKey_(key);
  var raw = props.getProperty(base);
  var head = oshiProfileHead_(raw, base);
  if (head) {
    var text = '';
    for (var i = 0; i < head.parts; i++) {
      var part = props.getProperty(head.prefix + i);
      if (part === null || part === undefined) return null;
      text += part;
    }
    raw = text;
  }
  return oshiProfileParse_(raw);
}

/**
 * 分けて置いたときの頭を読む。分けていない (プロフィールそのもの)・読めないなら null。
 *
 * @param {?string} raw OSHI_PROFILE:<key> の値
 * @param {string} [base] 鍵 (省くと 'OSHI_PROFILE:' を付けない続きの前置きを返さない)
 * @returns {?{parts: number, v: number, prefix: string}} prefix は続きの鍵の前置き (base を除いた形は使わない)
 */
function oshiProfileHead_(raw, base) {
  var head = null;
  try { head = raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  if (!head || typeof head !== 'object' || Array.isArray(head) || head.items !== undefined) return null;
  var n = Number(head.parts);
  if (!(isFinite(n) && n >= 1 && n <= 20 && Math.floor(n) === n)) return null;
  var v = head.v === undefined ? 0 : Number(head.v);
  if (!(isFinite(v) && v >= 0 && Math.floor(v) === v)) return null;
  return { parts: n, v: v, prefix: (base || '') + ':' + (v ? v + ':' : '') };
}

/**
 * 最初からいるキャラのプロフィールを置く (null で外す)。検査を通したものだけを渡す。**鍵の中で書く** (ほぼ同時の2回で、
 * 続きが混ざらないように)。台帳も Drive も触らない。
 *
 * **途中で止まっても前のものを失わない順に書く**: 新しい続きを新しい版の鍵に置く → 頭を替える → 前の版の続きを消す。
 * 前の続きを先に消すと、頭を替える前に止まったとき、頭が指す続きがもう無い。
 *
 * @param {string} key
 * @param {?object} p oshiProfileValid_ の返り
 */
function oshiBuiltinProfileWrite_(key, p) {
  var props = PropertiesService.getScriptProperties();
  var base = oshiBuiltinProfileKey_(key);
  var empty = !p || (!p.items.length && !p.clearLine && !p.clearVideo);
  var json = empty ? '' : JSON.stringify({ items: p.items, clearLine: p.clearLine, clearVideo: p.clearVideo });
  dbWithLock_(10000, function () {
    var parts = [];
    if (json && rewardBytes_(json) > OSHI_PROFILE_PART_BYTES()) parts = oshiProfileSplit_(json, OSHI_PROFILE_PART_BYTES());
    var before = oshiProfileHead_(props.getProperty(base), base);
    if (empty) {
      props.deleteProperty(base);
    } else if (!parts.length) {
      props.setProperty(base, json);
    } else {
      var v = (before ? before.v : 0) + 1;
      parts.forEach(function (part, j) { props.setProperty(base + ':' + v + ':' + j, part); });
      props.setProperty(base, JSON.stringify({ parts: parts.length, v: v }));
    }
    // 頭を替えたあとで、前の版の続きを消す
    if (before) for (var i = 0; i < before.parts; i++) props.deleteProperty(before.prefix + i);
  });
}

/**
 * 字を UTF-8 のバイトの上限ごとに分ける。字の途中 (サロゲートの組) では切らない。
 *
 * @param {string} s
 * @param {number} max
 * @returns {string[]}
 */
function oshiProfileSplit_(s, max) {
  var out = [];
  var cur = '';
  var bytes = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    var code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) ch += s.charAt(++i);
    var b = rewardBytes_(ch);
    if (bytes + b > max) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 最初からいるキャラのプロフィールを決める。**管理者だけ** (who は画面なら開いている本人、命令なら置いた人)。
 * 検査に通らなければ何も書かずに断る。空にすると外す。
 *
 * @param {string} who
 * @param {string} key OSHI_BUILTINS の key
 * @param {*} value プロフィール (JSON の字か、形のままの物)
 * @returns {{key: string, items: number, clearLine: boolean, clearVideo: boolean, profile: ?object}}
 */
function oshiBuiltinProfileSet_(who, key, value) {
  repoAssertAdmin_('最初からいるキャラのプロフィールを決めること', who);
  if (!oshiBuiltinOf(key)) throw new Error('知らないキャラです: ' + key);
  var p = oshiProfileValid_(value);
  oshiBuiltinProfileWrite_(String(key), p);
  var now = oshiBuiltinProfileRead_(String(key));
  return { key: String(key), items: now ? now.items.length : 0, clearLine: !!(now && now.clearLine),
    clearVideo: !!(now && now.clearVideo), profile: now };
}

/**
 * 自分のキャラのプロフィールを決める (台帳 oshi の profile の欄)。空にすると外す。
 *
 * @param {string} email
 * @param {number} id
 * @param {*} value
 * @returns {?object} 置いたプロフィール (外したら null)
 */
function oshiSetCharProfile_(email, id, value) {
  var p = oshiProfileValid_(value);
  var empty = !p.items.length && !p.clearLine && !p.clearVideo;
  var raw = empty ? '' : JSON.stringify({ items: p.items, clearLine: p.clearLine, clearVideo: p.clearVideo });
  oshiProfileWrite_(email, id, { profile: raw });
  return empty ? null : p;
}

// ----- キャラ作成キットの答えを取り込む -----

/**
 * AI の答え (キャラ作成キットの JSON) を確かめて整える。**ここが唯一の検査** (画面の「AI の答えを貼る」はここを通す。
 * 画面では確かめない)。```json の囲みや前後の説明の字があってもよい (最初の JSON の物を取り出す)。
 *
 * - 知らない欄は捨てる (上の欄・場面・プロフィールの中)。AI はよく欄を足すので、断ると貼るたびに直すことになる
 * - name は要る (OSHI_TEXT_LIMITS の長さまで)、tone は OSHI_TONES の key だけ
 * - lines は知っている場面だけ。長さと数は oshiCleanLines で見る
 * - profile は items と clearLine だけを拾い、oshiProfileValid_ で見る (lv の "2" のような数の字は数にする)。
 *   動画 (clearVideo) は取り込まない (AI に動画のリンクを作らせない。あとで「プロフィール (JSON)」で足せる)
 *
 * @param {*} text
 * @returns {{name: string, tone: string, lines: Object<string, string[]>, profile: {items: object[], clearLine: string}}}
 */
function oshiCharImportValid_(text) {
  var pasted = String(text == null ? '' : text);
  if (pasted.length > OSHI_CHARKIT_TEXT_MAX()) {
    throw new Error('貼った字が長すぎます。AI の答えは' + OSHI_CHARKIT_TEXT_MAX() + '字までにしてください (JSON のところだけを貼っても取り込めます)');
  }
  var raw = oshiExtractJson(pasted);
  if (!raw) throw new Error('AI の答えの中に JSON が見つかりませんでした。{ から } までを全部貼ってください');
  var got = JSON.parse(raw);
  if (!got || typeof got !== 'object' || Array.isArray(got)) throw new Error('AI の答えの JSON は、欄を { } で囲んだ形にしてください');
  var name = oshiCleanName_(typeof got.name === 'string' ? oshiCharKitText_(got.name) : '');
  if (!name) throw new Error('名前 (name) が書かれていません');
  var tone = typeof got.tone === 'string' ? got.tone.replace(/^\s+|\s+$/g, '') : '';
  if (!oshiToneKnown(tone)) {
    throw new Error('知らない口調です: ' + tone + '。tone は ' + OSHI_TONES().map(function (t) { return t.key; }).join(' / ') + ' のどれかにしてください');
  }
  var lines = {};
  var given = got.lines && typeof got.lines === 'object' && !Array.isArray(got.lines) ? got.lines : {};
  OSHI_EVENTS().forEach(function (e) {
    if (!Object.prototype.hasOwnProperty.call(given, e.key)) return;
    var v = given[e.key];
    if (!Array.isArray(v) && typeof v !== 'string') throw new Error('「' + e.label + '」のせりふは字の並び (["…"]) にしてください');
    var clean;
    try {
      clean = oshiCleanLines(Array.isArray(v) ? v.map(function (x) { return typeof x === 'string' ? oshiCharKitText_(x) : ''; })
        : oshiCharKitText_(v));
    } catch (err) {
      throw new Error('「' + e.label + '」のせりふを直してください。' + err.message);
    }
    if (clean.length) lines[e.key] = clean;
  });
  var p = got.profile && typeof got.profile === 'object' && !Array.isArray(got.profile) ? got.profile : {};
  var items = Array.isArray(p.items) ? p.items.map(function (it) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return it;
    var lv = typeof it.lv === 'string' && /^\s*\d+\s*$/.test(it.lv) ? Number(it.lv) : it.lv;
    return { lv: lv, label: oshiCharKitText_(it.label), text: oshiCharKitText_(it.text) };
  }) : [];
  var profile = oshiProfileValid_({ items: items, clearLine: p.clearLine === undefined ? null : oshiCharKitText_(p.clearLine) });
  oshiCharKitLinesFit_(lines);
  return { name: name, tone: tone, lines: lines, profile: { items: profile.items, clearLine: profile.clearLine } };
}

/** 貼れる AI の答えの長さの上限 (取り出す前に断る) */
function OSHI_CHARKIT_TEXT_MAX() {
  return 60000;
}

/** 台帳に書くせりふの JSON の長さの上限。セルは5万字までなので、プロフィール (OSHI_PROFILE_JSON_MAX) と同じく余裕を見る */
function OSHI_LINES_JSON_MAX() {
  return 45000;
}

/**
 * AI の答えの字から、制御文字 (改行・タブを除く C0・DEL・C1) と、字の向きを変える印・幅の無い空白・BOM を落とす。
 * 見えないうえに、JSON にすると \uXXXX の6字に膨らむ (oshiProfileText_ と同じ考え。字でないものはそのまま返す)。
 *
 * @param {*} v
 * @returns {*}
 */
function oshiCharKitText_(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, '');
}

/**
 * せりふが台帳の1つのセルに収まるか。書く形 (JSON) の長さで見て、超えればふつうの言葉で断る。
 *
 * @param {Object<string, string[]>} lines
 */
function oshiCharKitLinesFit_(lines) {
  if (JSON.stringify(lines).length > OSHI_LINES_JSON_MAX()) {
    throw new Error('せりふが長すぎます。せりふを JSON にして' + OSHI_LINES_JSON_MAX() + '字までにしてください');
  }
}

/**
 * キャラ作成キットの答えで、自分のキャラを作る (id が 0) か、作ってあるキャラを書き直す。
 * 書き直すときは、答えにある場面のせりふだけ置き換え (ほかの場面の自分のせりふは残す)、プロフィールの動画は残す。
 * **確かめるのは鍵の外、作る・書くのは1つの鍵の中** (途中で断られて、名前だけのキャラが残らないように)。
 *
 * @param {string} email
 * @param {number} id 0 なら新しく作る
 * @param {*} text AI の答え
 * @returns {{id: number, created: boolean, name: string, tone: string, lines: number, items: number}}
 */
function oshiCharImport_(email, id, text) {
  var who = oshiWho_(email);
  if (!who) throw new Error('誰の推しか分かりません');
  var v = oshiCharImportValid_(text);
  /** 残す場面のせりふに、答えのせりふを重ねる */
  function merged(before) {
    var out = {};
    Object.keys(before || {}).forEach(function (k) { out[k] = before[k]; });
    Object.keys(v.lines).forEach(function (k) { out[k] = v.lines[k]; });
    return out;
  }
  // 直すときは、残す場面と合わせた長さも鍵を取る前に見る (鍵の中でも読み直して見る)
  if (id) oshiCharKitLinesFit_(merged(oshiProfile_(who, id).lines));
  return dbWithLock_(30000, function () {
    var created = !id;
    if (!created) {
      oshiAssertMine_(who, id);
      oshiCharKitLinesFit_(merged(oshiProfile_(who, id).lines));
    }
    var cid = created ? oshiCharCreate_(who, v.name, v.tone).id : id;
    var cur = oshiProfile_(who, cid);
    var lines = merged(created ? {} : cur.lines);
    var video = cur.profile ? cur.profile.clearVideo : '';
    var empty = !v.profile.items.length && !v.profile.clearLine && !video;
    oshiProfileWrite_(who, cid, {
      name: v.name, tone: v.tone, lines: lines,
      profile: empty ? '' : JSON.stringify({ items: v.profile.items, clearLine: v.profile.clearLine, clearVideo: video }),
    });
    return { id: cid, created: created, name: v.name, tone: v.tone, lines: Object.keys(v.lines).length, items: v.profile.items.length };
  });
}

/**
 * 実績を全部取ったか (クリア)。今ある実績の表 (ACHIEVEMENTS) を全部取っていれば true。
 *
 * @param {Object<string, string>} have achUnlockedRead_ の返り
 * @returns {boolean}
 */
function oshiClearedOf_(have) {
  var all = ACHIEVEMENTS();
  return all.length > 0 && all.every(function (a) { return Object.prototype.hasOwnProperty.call(have || {}, a.key); });
}

/**
 * その人がクリアしたか。**一度クリアしたら覚えて、あとから実績が増えてもクリアのまま** (スクリプトプロパティ
 * `OSHI_CLEARED:<小文字のアドレス>` = クリアした日)。取った印と同じく消さない。書くのは1つの値を置くだけなので鍵は取らない
 * (2回書いても同じ)。
 *
 * @param {string} email
 * @returns {boolean}
 */
function oshiCleared_(email) {
  var who = oshiWho_(email);
  if (!who) return false;
  var props = PropertiesService.getScriptProperties();
  var key = 'OSHI_CLEARED:' + who;
  if (props.getProperty(key)) return true;
  if (!oshiClearedOf_(achUnlockedRead_(who))) return false;
  props.setProperty(key, usageDay(new Date()));
  return true;
}
