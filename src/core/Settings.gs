/**
 * アプリ全体の設定。
 *
 * 個人の設定 (画面の明るさ・幅など) は画面の localStorage に持つ。ここに置くのは
 * 全員に効くもので、変えられるのは持ち主だけ (API 層で確かめる)。
 */

/**
 * エージェンティックスクラムを使うかどうかの鍵。
 *
 * **既定はオフ。** ai-scrum-gas から取り入れた機能だが、使わない人のほうが多い。
 * オフのあいだは画面にスクラムの行き先も欄も出さず、API も断る。
 *
 * @returns {string}
 */
function SCRUM_ENABLED_KEY() {
  return 'SCRUM_ENABLED';
}

/**
 * エージェンティックスクラムがオンか。
 *
 * @returns {boolean}
 */
function scrumEnabled() {
  return PropertiesService.getScriptProperties().getProperty(SCRUM_ENABLED_KEY()) === 'true';
}

/**
 * エージェンティックスクラムを切り替える。持ち主かどうかは呼ぶ側で確かめる。
 *
 * **オフにしても、書いたものは消さない。** スプリントや障害物は台帳に残り、
 * オンに戻せばそのまま使える。
 *
 * @param {boolean} on
 * @returns {boolean} 切り替えたあとの状態
 */
function scrumSetEnabled_(on) {
  var props = PropertiesService.getScriptProperties();
  if (on) props.setProperty(SCRUM_ENABLED_KEY(), 'true');
  else props.deleteProperty(SCRUM_ENABLED_KEY());
  return scrumEnabled();
}

/**
 * オフなら断る。スクラムの操作の入口で呼ぶ。
 */
function scrumAssertEnabled_() {
  if (!scrumEnabled()) {
    throw new Error(
      'エージェンティックスクラムはオフです。使うときは、画面の「設定」で持ち主がオンにしてください');
  }
}

/**
 * プロダクトゴールと完了の定義の置き場。
 *
 * ai-scrum-gas では scrum/product_goal.md と scrum/definition_of_done.md だった。
 * 画面で見て直すものなので、ここに置く。
 *
 * @returns {Object<string, string>} 種類 → スクリプトプロパティの鍵
 */
function SCRUM_TEXT_KEYS() {
  return { productGoal: 'SCRUM_PRODUCT_GOAL', definitionOfDone: 'SCRUM_DEFINITION_OF_DONE' };
}

/**
 * プロダクトゴールと完了の定義を返す。
 *
 * @returns {{productGoal: string, definitionOfDone: string}}
 */
function scrumTexts() {
  var props = PropertiesService.getScriptProperties();
  var keys = SCRUM_TEXT_KEYS();
  return {
    productGoal: String(props.getProperty(keys.productGoal) || ''),
    definitionOfDone: String(props.getProperty(keys.definitionOfDone) || ''),
  };
}

/**
 * プロダクトゴールか完了の定義を書く。
 *
 * スクリプトプロパティは1つにつき9KBまで。**字数ではなくバイトで見る。**
 * 字数で区切ると、日本語 (1字3バイト) で上限を超えて書けないまま「5000字まで」
 * と案内することになる。
 *
 * @param {string} kind 'productGoal' | 'definitionOfDone'
 * @param {string} text
 * @returns {Object} 書いたあとの scrumTexts()
 */
function scrumSetText_(kind, text) {
  scrumAssertEnabled_();
  var key = SCRUM_TEXT_KEYS()[kind];
  if (!key) throw new Error('知らない種類です: ' + kind);

  var value = String(text == null ? '' : text);
  if (scrumByteLength_(value) > SCRUM_TEXT_MAX_BYTES_()) {
    throw new Error('長すぎます。保存できるのは日本語でおよそ2600字 (英数字なら8000字) までです');
  }

  var props = PropertiesService.getScriptProperties();
  if (value) props.setProperty(key, value);
  else props.deleteProperty(key);
  return scrumTexts();
}

/**
 * プロダクトゴールと完了の定義の上限 (バイト)。スクリプトプロパティの9KBに
 * 余裕を持たせる。
 *
 * @returns {number}
 */
function SCRUM_TEXT_MAX_BYTES_() {
  return 8000;
}

/**
 * UTF-8 にしたときのバイト数。
 *
 * @param {string} text
 * @returns {number}
 */
function scrumByteLength_(text) {
  // encodeURIComponent は使わない。対になっていないサロゲートで投げ、理由の
  // 分からない「保存できませんでした」になる。そうした字は置き換え文字
  // (3バイト) として数える
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xDC00 && text.charCodeAt(i + 1) <= 0xDFFF) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
