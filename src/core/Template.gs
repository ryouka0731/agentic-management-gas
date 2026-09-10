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
 * 下書きの一覧を返す。1つも無ければ先に用意したものを入れる。
 *
 * @returns {object[]}
 */
function templateList() {
  var rows = dbReadAll('templates');
  if (!rows.length) {
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
 * 用意した下書きを入れる。
 */
function templateSeed_() {
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

  var found = dbFindOne('templates', 'name', clean);
  if (found && (found.builtin === true || String(found.builtin) === 'true')) {
    throw new Error('用意されている下書きは書き換えられません: ' + clean);
  }

  if (found) {
    dbUpdate('templates', 'name', clean, { body: body });
  } else {
    dbAppend('templates', {
      name: clean,
      body: body,
      builtin: false,
      createdBy: Session.getActiveUser().getEmail(),
      createdAt: new Date(),
    });
  }
  return dbFindOne('templates', 'name', clean);
}

/**
 * 下書きを消す。作った本人か、このアプリの持ち主だけ。
 *
 * @param {string} name
 */
function templateDelete(name) {
  var row = dbFindOne('templates', 'name', name);
  if (!row) throw new Error('下書きが見つかりません: ' + name);

  if (row.builtin === true || String(row.builtin) === 'true') {
    throw new Error('用意されている下書きは消せません: ' + name);
  }

  var me = Session.getActiveUser().getEmail();
  var owner = repoOwnerEmail();

  if (String(row.createdBy) !== String(me) && (!owner || owner !== me)) {
    throw new Error('自分が作った下書きだけ消せます');
  }
  dbDelete('templates', 'name', name);
}
