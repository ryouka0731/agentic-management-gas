/**
 * 補足の下書き。
 *
 * 同じ形の書き出しを毎回作り直すと、書く人によって形が変わり、後から
 * 読み比べられなくなる。よく使う形を残して差し込めるようにする。
 */

/**
 * 最初から用意しておく下書き。
 *
 * 空の一覧から作らせると、何を下書きにすればよいのかが分からない。
 *
 * @returns {Array<{name:string, body:string}>}
 */
function TEMPLATE_BUILTIN() {
  return [
    {
      name: '作業の段取り',
      body: '## やること\n\n- [ ] \n- [ ] \n\n## 気をつけること\n\n- \n',
    },
    {
      name: '調べたこと',
      body: '## 調べたこと\n\n## 分かったこと\n\n## まだ分からないこと\n\n- \n',
    },
    {
      name: '打ち合わせの記録',
      body: '## いつ・誰と\n\n## 決めたこと\n\n- \n\n## 持ち帰り\n\n- [ ] \n',
    },
  ];
}

/**
 * 名前として使えるかを見る。
 *
 * @param {string} name
 * @returns {boolean}
 */
function templateNameValid_(name) {
  return /^[^\n\r\t]{1,40}$/.test(String(name || '').replace(/^\s+|\s+$/g, ''));
}

/**
 * 用意した下書きの名前か。
 *
 * 台帳の builtin の印だけで見ると、用意したものが入る前に同じ名前で
 * 保存された行が「自分の下書き」として通り、守りが外れる。
 *
 * @param {string} name
 * @returns {boolean}
 */
function templateIsBuiltinName_(name) {
  var builtin = TEMPLATE_BUILTIN();
  for (var i = 0; i < builtin.length; i++) {
    if (builtin[i].name === name) return true;
  }
  return false;
}

/**
 * 下書きの一覧を返す。用意したものが欠けていれば先に入れる。
 *
 * 表が空のときだけ入れていると、一覧を開く前に誰かが1つ保存した時点で
 * 用意したものが二度と入らない。
 *
 * @returns {object[]}
 */
function templateList() {
  var rows = dbReadAll('templates');
  var have = {};
  for (var h = 0; h < rows.length; h++) have[String(rows[h].name)] = true;

  var missing = TEMPLATE_BUILTIN().some(function (t) { return !have[t.name]; });
  if (missing) {
    templateSeed_();
    rows = dbReadAll('templates');
  }

  var order = {};
  var builtin = TEMPLATE_BUILTIN();
  for (var b = 0; b < builtin.length; b++) order[builtin[b].name] = b;

  rows.sort(function (x, y) {
    var xi = Object.prototype.hasOwnProperty.call(order, x.name) ? order[x.name] : 999;
    var yi = Object.prototype.hasOwnProperty.call(order, y.name) ? order[y.name] : 999;

    if (xi !== yi) return xi - yi;
    return String(x.name) < String(y.name) ? -1 : 1;
  });
  return rows;
}

/**
 * 用意した下書きを入れる。あるか見てから書くので、鍵の中で行う。
 */
function templateSeed_() {
  dbWithLock_(30000, templateSeedLocked_);
}

/**
 * templateSeed_ の本体。鍵を持った状態で呼ばれる。
 */
function templateSeedLocked_() {
  var builtin = TEMPLATE_BUILTIN();

  for (var i = 0; i < builtin.length; i++) {
    if (dbFindOne('templates', 'name', builtin[i].name)) continue;

    dbAppend('templates', {
      name: builtin[i].name,
      body: builtin[i].body,
      builtin: true,
      createdBy: '',
      createdAt: new Date(),
    });
  }
}

/**
 * 下書きを作る。同じ名前があれば中身を入れ替える。
 *
 * 用意したものは書き換えさせない。誰かが直すと、他の人の下書きが
 * 黙って変わることになる。
 *
 * @param {string} name
 * @param {string} body
 * @returns {object} templates 行
 */
function templateSave(name, body) {
  // あるか見てから書くので、鍵の中で行う。分けると、ほぼ同時の2件が
  // 「まだ無い」と読んで両方書き、先の1件しか引けない重なりができる
  return dbWithLock_(30000, function () {
    return templateSaveLocked_(name, body);
  });
}

/**
 * templateSave の本体。鍵を持った状態で呼ばれる。
 */
function templateSaveLocked_(name, body) {
  var clean = String(name || '').replace(/^\s+|\s+$/g, '');
  if (!templateNameValid_(clean)) {
    throw new Error('下書きの名前が正しくありません: ' + name);
  }
  if (!String(body || '').replace(/^\s+|\s+$/g, '')) {
    throw new Error('中身を入力してください');
  }
  if (String(body).length > 4000) {
    throw new Error('下書きは4000文字までにしてください');
  }

  if (templateIsBuiltinName_(clean)) {
    throw new Error('用意されている下書きは書き換えられません: ' + clean);
  }

  // 一覧を開く前に保存されても、用意したものが入るようにする
  templateSeedLocked_();

  var found = dbFindOne('templates', 'name', clean);
  if (found && (found.builtin === true || String(found.builtin) === 'true')) {
    throw new Error('用意されている下書きは書き換えられません: ' + clean);
  }

  // 消すのと同じく、作った本人か管理者だけ。同じ名前で保存すれば誰でも
  // 書き換えられると、消せない人が中身を差し替えられる
  if (found) {
    var me = currentEmail_();
    if (String(found.createdBy) !== String(me) && !repoIsAdmin_(me)) {
      throw new Error('自分が作った下書きだけ書き換えられます');
    }
  }

  if (found) {
    dbUpdate('templates', 'name', clean, { body: body });
  } else {
    dbAppend('templates', {
      name: clean,
      body: body,
      builtin: false,
      createdBy: currentEmail_(),
      createdAt: new Date(),
    });
  }
  return dbFindOne('templates', 'name', clean);
}

/**
 * 下書きを消す。作った本人か、このアプリの管理者だけ。
 *
 * @param {string} name
 */
function templateDelete(name) {
  var row = dbFindOne('templates', 'name', name);
  if (!row) throw new Error('下書きが見つかりません: ' + name);

  if (row.builtin === true || String(row.builtin) === 'true') {
    throw new Error('用意されている下書きは消せません: ' + name);
  }

  var me = currentEmail_();

  if (String(row.createdBy) !== String(me) && !repoIsAdmin_(me)) {
    throw new Error('自分が作った下書きだけ消せます');
  }
  dbDelete('templates', 'name', name);
}
