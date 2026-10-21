/**
 * 作業雑談部屋。管理者が決めた Google Meet / Slack の部屋に「入る」と、いまいる人の名前がチームに見える。
 *
 * **番頭は Meet / Slack の API を呼ばない。** 部屋の中で話すのは Meet / Slack で、番頭はリンクを開くだけ
 * (リンクの読み解きは CoworkLink.js)。守ること:
 * - **いる印は CacheService (スクリプトのキャッシュ) にだけ置く。台帳にもスクリプトプロパティにも書かない。**
 *   誰がいつ入ったかを残さないため。最後の合図から COWORK_PRESENCE_MS() (2分) で消える
 * - 出すのは「入る」を押した人だけ。名前は members の表示名 (memberNames)。アドレスは返さない
 * - チームの設定 cowork.enabled (既定オフ) がオンのときだけ。オフのあいだは部屋もいる人も返さない
 * - キャッシュは1つの値につき 100KB (バイト) まで。1つの部屋の印をそれより小さく保つ (coworkFit_)
 * - 読んで書き直すのは dbWithLock_ の中で、短く待ち、取れなければ黙って次の合図に回す
 *
 * 部屋の一覧 (名前と、リンクの部品) はスクリプトプロパティ COWORK_ROOMS に JSON で置く。書くのは
 * apiCoworkSetRooms (管理者だけ) で、貼られた字は残さず部品だけを持つ。部屋の id は組み直したリンクの指紋
 * (同じリンクは同じ部屋。名前を変えても中にいる人は消えない)。
 */

/** 部屋の数の上限 */
function COWORK_ROOMS_MAX() {
  return 10;
}

/** 部屋の名前の長さの上限 (字) */
function COWORK_NAME_MAX() {
  return 30;
}

/** 最後の合図からこれだけ経つと、いる印が消える (ミリ秒) */
function COWORK_PRESENCE_MS() {
  return 2 * 60 * 1000;
}

/** 画面が合図を送る間隔 (秒)。消えるまでの長さより短くする */
function COWORK_BEAT_SECONDS() {
  return 60;
}

/** 1つの部屋の印に使ってよい大きさ (バイト)。キャッシュの上限 100KB より余裕を持たせる */
function COWORK_CACHE_BYTES() {
  return 90 * 1024;
}

/** キャッシュに置く長さ (秒)。消えるのは最後の合図から2分だが、置いたままにしないため短めに切る */
function COWORK_CACHE_SECONDS() {
  return 10 * 60;
}

/** 部屋の一覧のスクリプトプロパティの鍵 */
function COWORK_ROOMS_KEY() {
  return 'COWORK_ROOMS';
}

/** オンか (チームの設定) */
function coworkEnabled_() {
  return prefGet_('cowork.enabled') === true;
}

/** オフなら断る */
function coworkAssertEnabled_() {
  if (!coworkEnabled_()) {
    throw new Error('作業雑談部屋は使っていません。管理者が設定の画面の「作業雑談部屋を使う」をオンにすると使えます');
  }
}

/** 開いている本人 (小文字)。分からなければ断る */
function coworkMe_() {
  var me = currentEmailLower_();
  if (!me) throw new Error('誰か分かりません。作業雑談部屋には本人として開いた画面からだけ入れます');
  return me;
}

/** いまの時刻 (テストで差し替える) */
function coworkNow_() {
  return new Date();
}

/**
 * 部屋の id。組み直したリンクの指紋。
 *
 * @param {object} parts
 * @returns {string}
 */
function coworkRoomId_(parts) {
  return 'r' + sha256Hex(coworkLinkOf_(parts)).substring(0, 12);
}

/**
 * 部屋の一覧。読めない・形の崩れたものは外す (スクリプトプロパティは人がエディタで書き換えうる)。
 *
 * @returns {Array<{id: string, name: string, parts: object}>}
 */
function coworkRooms_() {
  var raw = PropertiesService.getScriptProperties().getProperty(COWORK_ROOMS_KEY());
  var list;
  try {
    list = raw ? JSON.parse(String(raw)) : [];
  } catch (e) {
    return [];
  }
  if (!Array.isArray(list)) return [];
  var seen = {};
  var out = [];
  list.forEach(function (r) {
    if (!r || typeof r !== 'object' || !coworkLinkPartsValid_(r.parts)) return;
    var name = coworkCleanName_(r.name);
    if (!name) return;
    var id = coworkRoomId_(r.parts);
    if (seen[id] || out.length >= COWORK_ROOMS_MAX()) return;
    seen[id] = true;
    out.push({ id: id, name: name, parts: r.parts });
  });
  return out;
}

/**
 * 部屋の名前をそろえる。前後の空白を落とし、制御文字を含むもの・長すぎるものは '' (使えない)。
 *
 * @param {*} v
 * @returns {string}
 */
function coworkCleanName_(v) {
  if (typeof v !== 'string') return '';
  var s = v.replace(/^\s+|\s+$/g, '');
  if (!s || s.length > COWORK_NAME_MAX()) return '';
  if (/[\u0000-\u001f\u007f]/.test(s)) return '';
  return s;
}

/**
 * 部屋の一覧を決める。**全部を確かめてから書く** (1つでも駄目なら何も変えない)。
 *
 * @param {Array<{name: string, link: string}>} list
 * @returns {Array<{id: string, name: string, parts: object}>}
 */
function coworkSetRooms_(list) {
  if (!Array.isArray(list)) throw new Error('部屋の一覧を渡してください');
  if (list.length > COWORK_ROOMS_MAX()) throw new Error('部屋は ' + COWORK_ROOMS_MAX() + ' までにしてください');
  var out = [];
  var seen = {};
  list.forEach(function (r, i) {
    var at = (i + 1) + ' 番目の部屋';
    if (!r || typeof r !== 'object') throw new Error(at + 'の名前とリンクを入れてください');
    var name = coworkCleanName_(r.name);
    if (!name) throw new Error(at + 'の名前を ' + COWORK_NAME_MAX() + ' 字までで入れてください');
    var got = coworkLinkParse_(r.link);
    if (!got.ok) throw new Error('リンクを直してください。' + at + ' (' + name + '): ' + got.error);
    var id = coworkRoomId_(got.parts);
    if (seen[id]) throw new Error('同じリンクの部屋は1つにしてください: ' + at + ' (' + name + ')');
    seen[id] = true;
    out.push({ id: id, name: name, parts: got.parts });
  });
  var before = coworkRooms_();
  PropertiesService.getScriptProperties().setProperty(COWORK_ROOMS_KEY(),
    JSON.stringify(out.map(function (r) { return { name: r.name, parts: r.parts }; })));
  // 外した部屋のいる印も消す (残しても誰も見られないが、置いたままにしない)。消せなくても一覧は戻さない
  var cache = coworkCache_();
  if (cache) {
    before.forEach(function (r) {
      if (seen[r.id]) return;
      try {
        cache.remove(coworkCacheKey_(r.id));
      } catch (e) {
        console.warn('外した部屋の印を消せませんでした: ' + (e && e.message));
      }
    });
  }
  return out;
}

/** スクリプトのキャッシュ。使えなければ null (いる印を出せないだけで、部屋は開ける) */
function coworkCache_() {
  try {
    return CacheService.getScriptCache();
  } catch (e) {
    return null;
  }
}

/** 1つの部屋の印の鍵 */
function coworkCacheKey_(roomId) {
  return 'COWORK:' + roomId;
}

/** 字の UTF-8 のバイト数 (キャッシュの上限はバイトで決まる。字数で数えると日本語で超える) */
function coworkBytes_(s) {
  return unescape(encodeURIComponent(String(s))).length;
}

/**
 * 印を読み、消える時刻を過ぎたものを落とす。
 *
 * @param {string|null} raw
 * @param {number} now ミリ秒
 * @returns {Object<string, {name: string, since: number, seen: number, focus: boolean}>}
 */
function coworkPresenceOf_(raw, now) {
  var map;
  try {
    map = raw ? JSON.parse(String(raw)) : {};
  } catch (e) {
    return {};
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  var out = {};
  Object.keys(map).forEach(function (who) {
    var e = map[who];
    if (!e || typeof e !== 'object') return;
    var seen = Number(e.seen);
    var since = Number(e.since);
    if (!isFinite(seen) || !isFinite(since)) return;
    if (now - seen > COWORK_PRESENCE_MS() || seen - now > COWORK_PRESENCE_MS()) return;
    out[who] = { name: String(e.name || ''), since: since, seen: seen, focus: e.focus === true };
  });
  return out;
}

/**
 * 上限に収まるまで、合図の古い人から落とす。
 *
 * @param {object} map
 * @returns {string} 書く JSON
 */
function coworkFit_(map) {
  var json = JSON.stringify(map);
  if (coworkBytes_(json) <= COWORK_CACHE_BYTES()) return json;
  var order = Object.keys(map).sort(function (a, b) { return map[a].seen - map[b].seen; });
  while (order.length && coworkBytes_(json) > COWORK_CACHE_BYTES()) {
    delete map[order.shift()];
    json = JSON.stringify(map);
  }
  return json;
}

/**
 * 全部の部屋の印を読む。
 *
 * @param {object} cache
 * @param {object[]} rooms
 * @param {number} now
 * @returns {Object<string, object>} 部屋の id → 印
 */
function coworkReadAll_(cache, rooms, now) {
  var keys = rooms.map(function (r) { return coworkCacheKey_(r.id); });
  var got = {};
  try {
    got = keys.length ? (cache.getAll(keys) || {}) : {};
  } catch (e) {
    got = {};
  }
  var out = {};
  rooms.forEach(function (r) { out[r.id] = coworkPresenceOf_(got[coworkCacheKey_(r.id)] || null, now); });
  return out;
}

/**
 * 本人のいる印を付ける・外す。
 *
 * - enter / beat: その部屋に付ける (ほかの部屋にいれば外す。いられるのは1つの部屋だけ)。since は入ったときのまま
 * - leave: その部屋から外す
 *
 * 鍵は短く待ち、取れなければ何もせず false (次の合図で付く・2分で消える)。
 *
 * @param {string} me 小文字のアドレス
 * @param {string} roomId
 * @param {string} mode 'enter' | 'beat' | 'leave'
 * @param {Date} now
 * @returns {boolean} 書けたか
 */
function coworkMark_(me, roomId, mode, now) {
  var rooms = coworkRooms_();
  var room = rooms.filter(function (r) { return r.id === String(roomId || ''); })[0];
  if (!room) throw new Error('その部屋は見つかりません。管理者が部屋を外したかもしれません。一覧を開き直してください');
  var cache = coworkCache_();
  if (!cache) return false;
  var t = now.getTime();
  // 名前と「集中中」は鍵の外で決める (台帳を読むので、鍵の中に相乗りさせない)
  var entry = null;
  if (mode !== 'leave') {
    var name = String(memberNames([me])[me] || me.split('@')[0]).substring(0, 40);
    entry = { name: name, since: t, seen: t, focus: coworkFocusOf_(me, now) };
  }
  return dbWithLock_(3000, function () {
    var all = coworkReadAll_(cache, rooms, t);
    var puts = {};
    rooms.forEach(function (r) {
      var map = all[r.id];
      var had = Object.prototype.hasOwnProperty.call(map, me);
      if (r.id === room.id && entry) {
        if (had) entry.since = map[me].since;
        map[me] = entry;
      } else if (had) {
        delete map[me];
      } else {
        return;
      }
      puts[coworkCacheKey_(r.id)] = coworkFit_(map);
    });
    try {
      if (Object.keys(puts).length) cache.putAll(puts, COWORK_CACHE_SECONDS());
    } catch (e) {
      console.warn('いる印を書けませんでした: ' + (e && e.message));
      return false;
    }
    return true;
  }, function () { return false; });
}

/**
 * 本人が「集中中」を添えるか。自分の設定 cowork.showFocus がオンで、集中のしかたで集中しているあいだだけ。
 *
 * @param {string} me
 * @param {Date} now
 * @returns {boolean}
 */
function coworkFocusOf_(me, now) {
  try {
    if (prefGet_('cowork.showFocus', me) !== true) return false;
    return !!focusActive_(focusRowsOf_(me), now);
  } catch (e) {
    return false;
  }
}

/**
 * 画面に渡す形。**アドレスは入れない** (名前と、入った時刻と、自分か)。
 *
 * @param {string} me
 * @param {Date} now
 * @returns {{rooms: object[], myRoomId: string, beatSeconds: number, expireSeconds: number, available: boolean}}
 */
function coworkView_(me, now) {
  var rooms = coworkRooms_();
  var cache = coworkCache_();
  var t = now.getTime();
  var all = cache ? coworkReadAll_(cache, rooms, t) : {};
  var mine = '';
  var out = rooms.map(function (r) {
    var map = all[r.id] || {};
    var people = Object.keys(map).sort(function (a, b) {
      return map[a].since - map[b].since || (map[a].name < map[b].name ? -1 : 1);
    }).map(function (who) {
      if (who === me) mine = r.id;
      return {
        name: plainText(map[who].name),
        since: plainDate(new Date(map[who].since)),
        mine: who === me,
        focus: map[who].focus === true,
      };
    });
    return {
      id: plainText(r.id),
      name: plainText(r.name),
      kind: plainText(coworkLinkKindLabel_(r.parts)),
      parts: coworkPlainParts_(r.parts),
      count: plainNumber(people.length),
      people: people,
    };
  });
  return {
    rooms: out,
    myRoomId: plainText(mine),
    beatSeconds: plainNumber(COWORK_BEAT_SECONDS()),
    expireSeconds: plainNumber(COWORK_PRESENCE_MS() / 1000),
    available: !!cache,
  };
}

/**
 * リンクの部品を画面に渡せる形にする (開くリンクは画面が coworkLinkOf_ で組む)。
 *
 * @param {object} p
 * @returns {object}
 */
function coworkPlainParts_(p) {
  var out = { kind: plainText(p.kind) };
  ['code', 'team', 'channel', 'workspace'].forEach(function (k) { if (p[k]) out[k] = plainText(p[k]); });
  return out;
}
