/**
 * 作業雑談部屋 (画面から呼ぶ入口)。本体は src/core/Cowork.gs、リンクの読み解きは src/core/CoworkLink.js。
 *
 * **どの入口もアドレスを受けない。** 入る・出る・合図は開いている本人のぶんだけを扱い、返すのは
 * 部屋と、いる人の名前だけ (アドレスは返さない)。オフ (cowork.enabled) のあいだは断る。
 * 部屋を決めるのは管理者だけ (apiCoworkRoomSettings / apiCoworkSetRooms)。
 */

/**
 * 部屋と、いまいる人 (Web App API)。
 *
 * @returns {{rooms: object[], myRoomId: string, beatSeconds: number, expireSeconds: number, available: boolean}}
 */
function apiCoworkRooms() {
  coworkAssertEnabled_();
  var me = coworkMe_();
  return coworkView_(me, coworkNow_());
}

/**
 * 部屋に入る (いる印を付ける)。部屋そのもの (Meet / Slack) は画面が新しいタブで開く。
 *
 * @param {string} roomId
 * @returns {object} apiCoworkRooms と同じ形に saved (印を付けられたか) を添えたもの
 */
function apiCoworkEnter(roomId) {
  return coworkApiMark_(roomId, 'enter');
}

/**
 * 部屋を出る (いる印を外す)。
 *
 * @param {string} roomId
 * @returns {object}
 */
function apiCoworkLeave(roomId) {
  return coworkApiMark_(roomId, 'leave');
}

/**
 * まだいる合図 (画面が1分ごとに送る)。最後の合図から2分で印が消える。
 *
 * @param {string} roomId
 * @returns {object}
 */
function apiCoworkBeat(roomId) {
  return coworkApiMark_(roomId, 'beat');
}

/**
 * 入る・出る・合図の共通の形。
 *
 * @param {string} roomId
 * @param {string} mode
 * @returns {object}
 */
function coworkApiMark_(roomId, mode) {
  coworkAssertEnabled_();
  var me = coworkMe_();
  var now = coworkNow_();
  var saved = coworkMark_(me, roomId, mode, now);
  var out = coworkView_(me, now);
  out.saved = !!saved;
  return out;
}

/**
 * 部屋の一覧を直すための今の値 (管理者だけ)。オフのあいだも読める (オンにする前に用意できるように)。
 *
 * @returns {{rooms: Array<{id: string, name: string, link: string, kind: string}>, max: number, nameMax: number}}
 */
function apiCoworkRoomSettings() {
  repoAssertAdmin_('作業雑談部屋の部屋を決めること');
  return coworkSettingsPlain_(coworkRooms_());
}

/**
 * 部屋の一覧を決める (管理者だけ)。[{name, link}] を丸ごと受け、全部を確かめてから書く。
 * リンクは Google Meet の会議・Slack のハドル・Slack のチャンネルだけ。貼られた字は残さず、部品から組み直す。
 *
 * @param {Array<{name: string, link: string}>} list
 * @returns {object} apiCoworkRoomSettings と同じ形
 */
function apiCoworkSetRooms(list) {
  repoAssertAdmin_('作業雑談部屋の部屋を決めること');
  return coworkSettingsPlain_(coworkSetRooms_(list));
}

/**
 * @param {object[]} rooms
 * @returns {object}
 */
function coworkSettingsPlain_(rooms) {
  return {
    rooms: rooms.map(function (r) {
      return { id: plainText(r.id), name: plainText(r.name), link: plainText(coworkLinkOf_(r.parts)),
        kind: plainText(coworkLinkKindLabel_(r.parts)) };
    }),
    max: plainNumber(COWORK_ROOMS_MAX()),
    nameMax: plainNumber(COWORK_NAME_MAX()),
  };
}
