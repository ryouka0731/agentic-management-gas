/**
 * やることの種類を表すタグ。
 *
 * この道具は文書の改訂から始まったが、実際の仕事はそれだけではない。
 * 何の仕事かをタグで分けられるようにして、文書に紐づかないやることも
 * 同じ場所で扱えるようにする。
 *
 * 自由に書かせると「会議」「打合せ」「打ち合わせ」が並んで数えられない。
 * 決まったものから選べるようにしつつ、その場で足せるようにする。
 */

/**
 * 最初から用意しておくタグ。
 *
 * 空の一覧から作らせると、何をタグにすればよいのかが分からない。
 *
 * @returns {Array<{name:string, color:string}>}
 */
function TAG_TEMPLATES() {
  return [
    { name: '文書改訂', color: 'accent' },
    { name: '問い合わせ対応', color: 'warn' },
    { name: '定例業務', color: 'ink' },
    { name: '調査', color: 'merged' },
    { name: '会議', color: 'success' },
    { name: '提出物', color: 'danger' },
  ];
}

/**
 * 使える色。
 *
 * 好きな色を持たせると、明るい地と暗い地のどちらかで読めなくなる。
 * テーマが持っている色だけにする。
 *
 * @returns {string[]}
 */
function TAG_COLORS() {
  return ['accent', 'success', 'warn', 'danger', 'merged', 'ink'];
}

/**
 * タグの名前として使えるかを見る。
 *
 * カンマは区切りに使っているため入れられない。
 *
 * @param {string} name
 * @returns {boolean}
 */
function tagNameValid_(name) {
  return /^[^,\n\r\t]{1,30}$/.test(String(name || '').replace(/^\s+|\s+$/g, ''));
}

/**
 * タグ一覧を返す。用意したものが1つも無ければ先に入れる。
 *
 * @returns {object[]}
 */
function tagList() {
  var rows = dbReadAll('tags');
  if (!rows.length) {
    tagSeed_();
    rows = dbReadAll('tags');
  }

  // 用意したものを先に、決めた並びのまま。あとから足したものは名前順
  var order = {};
  var templates = TAG_TEMPLATES();
  for (var t = 0; t < templates.length; t++) order[templates[t].name] = t;

  rows.sort(function (a, b) {
    var ai = Object.prototype.hasOwnProperty.call(order, a.name)
      ? order[a.name] : 999;
    var bi = Object.prototype.hasOwnProperty.call(order, b.name)
      ? order[b.name] : 999;

    if (ai !== bi) return ai - bi;
    return String(a.name) < String(b.name) ? -1 : 1;
  });
  return rows;
}

/**
 * 用意したタグを入れる。
 */
function tagSeed_() {
  var templates = TAG_TEMPLATES();

  for (var i = 0; i < templates.length; i++) {
    if (dbFindOne('tags', 'name', templates[i].name)) continue;

    dbAppend('tags', {
      name: templates[i].name,
      color: templates[i].color,
      builtin: true,
      createdBy: '',
      createdAt: new Date(),
    });
  }
}

/**
 * タグを作る。既にあれば作らずにそれを返す。
 *
 * @param {string} name
 * @param {string} [color]
 * @returns {object} tags 行
 */
function tagCreate(name, color) {
  var clean = String(name || '').replace(/^\s+|\s+$/g, '');
  if (!tagNameValid_(clean)) {
    throw new Error('タグの名前が正しくありません: ' + name);
  }

  var found = dbFindOne('tags', 'name', clean);
  if (found) return found;

  var pick = String(color || 'ink');
  if (TAG_COLORS().indexOf(pick) < 0) pick = 'ink';

  var row = {
    name: clean,
    color: pick,
    builtin: false,
    createdBy: Session.getActiveUser().getEmail(),
    createdAt: new Date(),
  };
  dbAppend('tags', row);
  return row;
}

/**
 * タグを消す。用意したものは消せない。
 *
 * 既にやることに付いているタグは、そのまま文字として残る。行から
 * 消して回ると、いつ誰が何を消したのかが追えなくなる。
 *
 * @param {string} name
 */
function tagDelete(name) {
  var row = dbFindOne('tags', 'name', name);
  if (!row) throw new Error('タグが見つかりません: ' + name);
  if (row.builtin) throw new Error('用意されているタグは消せません: ' + name);

  dbDelete('tags', 'name', name);
}

/**
 * 文字列のタグを配列にする。
 *
 * @param {string} labels
 * @returns {string[]}
 */
function tagsOf(labels) {
  var parts = String(labels || '').split(',');
  var seen = {};
  var out = [];

  for (var i = 0; i < parts.length; i++) {
    var one = parts[i].replace(/^\s+|\s+$/g, '');
    if (!one || seen[one]) continue;

    seen[one] = true;
    out.push(one);
  }
  return out;
}

/**
 * 付けられたタグのうち、まだ一覧に無いものを足す。
 *
 * その場で書いたタグが次から選べないと、同じものを何度も書くことになる。
 *
 * @param {string} labels
 * @returns {string[]} 足したタグの名前
 */
function tagAdopt(labels) {
  var names = tagsOf(labels);
  var added = [];

  for (var i = 0; i < names.length; i++) {
    if (!tagNameValid_(names[i])) continue;
    if (dbFindOne('tags', 'name', names[i])) continue;

    tagCreate(names[i], 'ink');
    added.push(names[i]);
  }
  return added;
}
