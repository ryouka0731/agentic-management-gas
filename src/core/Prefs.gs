/**
 * 設定の画面で変えられる項目。
 *
 * **`PREFS_SCHEMA()` が唯一の定義である。** 画面は `apiPrefs()` で一覧と今の値を
 * 受け取り、それをもとに欄を組む。画面に写すと、足したときに「選べるのに保存
 * できない」項目が出る (ISSUE_PRIORITIES と同じ考え方)。
 *
 * - team: チームの設定。管理者だけが変える。スクリプトプロパティ `PREF:<key>`
 * - me: 自分の設定。本人だけが変える。スクリプトプロパティ `MYPREF:<小文字のアドレス>` に JSON
 *   **UserProperties には置かない。** 通知は送る側の権限で走り、キューは持ち主の権限で走る。
 *   どちらも受け取る人の UserProperties を読めない (KIT_PRINT: と同じ事情)
 *
 * 読むのは prefGet_ だけ、書くのは apiPrefSet だけ。**未設定・読めない・範囲の外なら
 * 既定値 (= 今の動き) を返す。** 既定値は今の定義 (ADVICE_RULES / STALE_STEPS など) から
 * 取り、ここに数を写さない。
 *
 * 設計: docs/superpowers/specs/2026-10-20-guide-usage-settings-design.md の 1。
 */

/**
 * 通知メールの種類。notify(to, subject, body, kind) の kind。
 *
 * @returns {Array<{key: string, label: string}>}
 */
function NOTIFY_KINDS() {
  return [
    { key: 'review', label: '確認を頼まれた・確認依頼が出た' },
    { key: 'result', label: '反映した・取り下げた' },
    { key: 'inquiry', label: '報告とその返事' },
    { key: 'mention', label: '名指しされた' },
    { key: 'comment', label: 'やることのやりとり' },
  ];
}

/**
 * 最初に出せる画面。左の行き先と同じ並び。スクラムの画面はオンのときだけ選べる。
 * スクラムの画面の名前は {key} で渡し、画面が言葉の表し方で埋める (人ごとに字が変わるため)。
 *
 * @returns {Array<{value: string, label: string, scrum?: boolean}>}
 */
function PREF_START_TABS_() {
  return [
    { value: 'home', label: 'ホーム' },
    { value: 'docs', label: '文書' },
    { value: 'issues', label: 'やること' },
    { value: 'branches', label: '改訂中の版' },
    { value: 'pulls', label: '確認依頼' },
    { value: 'sprint', label: '{sprint}', scrum: true },
    { value: 'impediments', label: '{impediment}', scrum: true },
    { value: 'help', label: '使い方' },
    { value: 'usage', label: '使われ方' },
    { value: 'report', label: '要望・不具合' },
    { value: 'settings', label: '設定' },
  ];
}

/**
 * ホームのカード。key は home.cards.<key>。
 *
 * @returns {Array<{key: string, label: string}>}
 */
function PREF_HOME_CARDS_() {
  return [
    { key: 'turn', label: 'あなたの番' },
    { key: 'advice', label: '改善のヒント' },
    { key: 'activity', label: '草 (アクティビティ)' },
    { key: 'game', label: 'ポイントとレベル' },
    { key: 'recent', label: '最近の動き' },
    { key: 'team', label: 'チームの前進' },
  ];
}

/**
 * 楽しい演出の種類。key は fun.<key>。どれも既定はオフ。
 *
 * @returns {Array<{key: string, label: string, help: string}>}
 */
function PREF_FUN_KINDS_() {
  return [
    { key: 'combo', label: '打つと盛り上がる',
      help: '字を打ち続けると、欄の近くに続けて打った数 (COMBO) が出て、10・30… で大きな字が出ます。消すと途切れます' },
    { key: 'words', label: '言葉に反応する',
      help: '「完成」「ありがとう」「締切」などを打つと、小さな絵と字が飛びます' },
    { key: 'cheer', label: '済ませたらお祝い',
      help: '反映した・やることを済ませた・承認したときなどに、お祝いの字が出ます' },
  ];
}

/**
 * 集中のしかた。どれも自分の設定で、既定はオフ (今から始めるの知らせは「終わったときだけ」)。
 * 「今から始める」がオフのあいだは、知らせの間隔と音は使わない (入口が出ない)。
 *
 * @returns {object[]}
 */
function PREF_FOCUS_ITEMS_() {
  return [
    { key: 'focus.start', scope: 'me', type: 'bool', section: '集中のしかた', label: '今から始める',
      help: 'やることに「今から始める」が出ます。長さを選ぶと残り時間の輪が減っていきます。' +
        '最初の一手を書くか、やりとり・記録・ボードの移動をすると「始めた」になります。記録はあなたにだけ見えます',
      def: false },
    { key: 'focus.remind', scope: 'me', type: 'enum', section: '集中のしかた', label: '時間の知らせ',
      help: '集中しているあいだ、画面の隅に経った時間を出します (音は鳴りません)。夢中になりすぎて会議や食事を飛ばさないために',
      options: [
        { value: 'end', label: '終わったときだけ' },
        { value: '30', label: '30分ごと' },
        { value: '45', label: '45分ごと' },
        { value: '60', label: '60分ごと' },
        { value: '90', label: '90分ごと' },
      ],
      def: 'end' },
    { key: 'focus.sound', scope: 'me', type: 'bool', section: '集中のしかた', label: '集中の音',
      help: '集中しているあいだに、画面の中で作った音 (ノイズ・4つ打ちの拍) を流せます。合う人も合わない人もいます。' +
        '合わなければ止めてください。押したときにだけ鳴り、イヤホンで聞く前提です',
      def: false },
  ];
}

/** 改善のヒントで変えられる数の範囲と名前 */
function PREF_ADVICE_TUNABLE_() {
  return {
    min: { min: 1, max: 50, label: '出す件数の下限' },
    days: { min: 1, max: 90, label: '数える日数' },
    limit: { min: 1, max: 20, label: '同時に進めてよい数' },
  };
}

/**
 * 項目を、key の先頭の語ごとに組む。prefGet_ は要る組だけを組む
 * (通知のたびに改善のヒントの規則まで組まない)。
 *
 * @returns {Object<string, function(): object[]>}
 */
function PREF_GROUPS_() {
  return {
    advice: function () {
      var range = PREF_ADVICE_TUNABLE_();
      var out = [];
      ADVICE_RULES().forEach(function (r) {
        out.push({ key: 'advice.' + r.id + '.on', scope: 'team', type: 'bool', section: '改善のヒント',
          label: r.title, help: '「' + r.title + '」のヒントを出す', def: true });
        (r.tunable || []).forEach(function (name) {
          var t = range[name];
          out.push({ key: 'advice.' + r.id + '.' + name, scope: 'team', type: 'int', section: '改善のヒント',
            label: r.title + ': ' + t.label, help: '', min: t.min, max: t.max, def: r[name] });
        });
      });
      return out;
    },
    stale: function () {
      return [{ key: 'stale.steps', scope: 'team', type: 'steps', section: 'やること',
        label: '「動きなし」の段階 (日)',
        help: '最後に動いてからこの日数がたつと、やることの見た目が段階ごとに傷みます。小さい順に3つ',
        min: 1, max: 180, def: STALE_STEPS() }];
    },
    home: function () {
      var out = [{ key: 'home.dueDays', scope: 'team', type: 'int', section: 'ホーム',
        label: '「期限が近い」とみなす日数', help: 'あなたの番に、今日からこの日数のうちに期限が来るものを出します',
        min: 1, max: 14, def: HOME_DUE_DAYS() }];
      PREF_HOME_CARDS_().forEach(function (c) {
        out.push({ key: 'home.cards.' + c.key, scope: 'me', type: 'bool', section: 'ホームに出すもの',
          label: c.label, help: '', def: true });
      });
      return out;
    },
    usage: function () {
      return [
        { key: 'usage.enabled', scope: 'team', type: 'bool', section: '使われ方',
          label: '使われ方を記録する', help: '止めると、誰のぶんも数えません', def: true },
        { key: 'usage.keepDays', scope: 'team', type: 'int', section: '使われ方',
          label: '使われ方を残す日数', help: '画面で直近90日まで見るので、90日より短くはできません',
          min: 90, max: 365, def: USAGE_KEEP_DAYS() },
        { key: 'usage.self', scope: 'me', type: 'bool', section: '使われ方',
          label: '自分の使われ方を記録する', help: '止めると、あなたが押したものは数えません', def: true },
      ];
    },
    report: function () {
      return [{ key: 'report.defaultKind', scope: 'team', type: 'enum', section: '日報',
        label: '日報の形の既定', help: '自分の形を選んでいない人の日報は、この形で写します',
        options: REPORT_TEMPLATES().map(function (t) { return { value: t.key, label: t.name }; }),
        def: REPORT_TEMPLATES()[0].key }];
    },
    start: function () {
      var scrum = scrumEnabled();
      return [{ key: 'start.tab', scope: 'me', type: 'enum', section: '開いたとき',
        label: '最初に出す画面', help: '文書のリンクから開いたときは、その文書を出します',
        options: PREF_START_TABS_().filter(function (t) { return scrum || !t.scrum; })
          .map(function (t) { return { value: t.value, label: t.label }; }),
        def: 'home' }];
    },
    terms: function () {
      // 言葉そのものは TERMS() (Terms.js) が唯一の定義。ここは表し方の選び方だけを持つ
      return [{ key: 'terms.style', scope: 'me', type: 'enum', section: '表示',
        label: '言葉の表し方',
        help: '作業期間・困りごとなどを、一般の言葉で出すか、スクラムの言葉 (スプリント・障害物など) で出すか',
        options: [
          { value: 'plain', label: '一般の言葉' },
          { value: 'scrum', label: 'スクラムの言葉 (エンジニア向け)' },
        ],
        def: 'plain' }];
    },
    fun: function () {
      // 楽しい演出。どれも既定はオフ (使う人が選ぶ)。演出そのものは画面の js-fun が持つ
      return PREF_FUN_KINDS_().map(function (f) {
        return { key: 'fun.' + f.key, scope: 'me', type: 'bool', section: '楽しい演出',
          label: f.label, help: f.help, def: false };
      });
    },
    focus: function () {
      return PREF_FOCUS_ITEMS_();
    },
    style: function () {
      // 仕事のスタンス診断の結果を、ほかの人の画面に出すか。既定はオフ (結果は本人にだけ見える)。
      // 見せるのは型の名前と絵だけで、点数は見せない (workStyleShared_)
      return [{ key: 'style.share', scope: 'me', type: 'bool', section: '仕事のスタンス診断',
        label: '診断の型の名前をチームに見せる',
        help: 'オンにすると、ほかの人の画面であなたの顔に型の名前が添えられます。点数や答えは誰にも見せません',
        def: false }];
    },
    oshi: function () {
      // 推し。既定はオフ。中身 (表情・せりふ・頼み文) は Oshi.js、画面は js-oshi が持つ
      return [
        { key: 'oshi.on', scope: 'me', type: 'bool', section: '推し',
          label: '推しに応援してもらう',
          help: '自分で作ったキャラクターの絵を上げると、済ませたときにほめてくれます。オンにすると、右上の自分の顔から開く欄に「推し」が出ます',
          def: false },
        { key: 'oshi.home', scope: 'me', type: 'bool', section: '推し',
          label: 'ホームであいさつする', help: '推しがオンのとき、ホームに推しのカードを出します', def: true },
        { key: 'oshi.char', scope: 'me', type: 'char', section: '推し',
          label: '使うキャラ',
          help: '最初からいるキャラ (' + OSHI_BUILTINS().map(function (c) { return c.name; }).join('・') +
            ') か、推しの頁で作った自分のキャラから選びます',
          // 選べるのは最初からいるキャラと、その人が作った自分のキャラ。人ごとに違うので、検査は oshiCharKnownFor_ が行う
          options: OSHI_BUILTINS().map(function (c) { return { value: 'builtin:' + c.key, label: c.name }; }),
          def: 'builtin:' + OSHI_BUILTINS()[0].key },
        { key: 'oshi.fallback', scope: 'me', type: 'enum', section: '推し',
          label: '自分のキャラの絵が無い表情',
          help: '自分のキャラを使っていて、その表情の絵をまだ入れていないときに出す絵です。「出さない」なら名前の頭文字になります',
          options: OSHI_BUILTINS().map(function (c) { return { value: 'builtin:' + c.key, label: c.name + 'の絵を出す' }; })
            .concat([{ value: 'none', label: '出さない' }]),
          def: 'builtin:' + OSHI_BUILTINS()[0].key },
        { key: 'oshi.style', scope: 'me', type: 'enum', section: '推し',
          label: '最初からいるキャラの絵', help: '2頭身か、等身か。自分のキャラに入れた絵は変わりません',
          options: OSHI_STYLES().map(function (s) { return { value: s.key, label: s.label }; }),
          def: OSHI_STYLES()[0].key },
      ];
    },
    notify: function () {
      return NOTIFY_KINDS().map(function (k) {
        return { key: 'notify.' + k.key, scope: 'me', type: 'bool', section: '通知メール',
          label: k.label, help: '', def: true };
      });
    },
  };
}

/**
 * 変えられる項目の一覧。**唯一の定義。**
 *
 * @returns {Array<{key: string, scope: string, type: string, section: string, label: string,
 *   help: string, min?: number, max?: number, options?: object[], def: *}>}
 */
function PREFS_SCHEMA() {
  var groups = PREF_GROUPS_();
  var out = [];
  ['start', 'terms', 'home', 'fun', 'oshi', 'focus', 'style', 'notify', 'usage', 'advice', 'stale', 'report'].forEach(function (g) {
    out = out.concat(groups[g]());
  });
  return out;
}

/**
 * key の項目。無ければ null。
 *
 * @param {string} key
 * @returns {object|null}
 */
function prefItem_(key) {
  var k = String(key || '');
  var groups = PREF_GROUPS_();
  var head = k.split('.')[0];
  // 自分の持ち物だけを見る。'__proto__.x' や 'toString.x' で Object の持ち物を組として呼ばない
  if (!Object.prototype.hasOwnProperty.call(groups, head)) return null;
  var build = groups[head];
  var list = build();
  for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
  return null;
}

/**
 * 値が項目の型と範囲に合うか。
 *
 * @param {object} item
 * @param {*} v
 * @param {string} [email] 誰の設定か。使うキャラ (type 'char') は人ごとに選べるものが違うので要る
 * @returns {boolean}
 */
function prefValid_(item, v, email) {
  if (!item) return false;
  function intIn(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= item.min && n <= item.max;
  }
  if (item.type === 'bool') return typeof v === 'boolean';
  if (item.type === 'int') return intIn(v);
  if (item.type === 'enum') {
    return typeof v === 'string' && (item.options || []).some(function (o) { return o.value === v; });
  }
  // 使うキャラ: 最初からいるキャラか、その人が作った自分のキャラ。自分のキャラのときだけ台帳を読む
  if (item.type === 'char') return typeof v === 'string' && oshiCharKnownFor_(email, v);
  if (item.type === 'steps') {
    if (!Array.isArray(v) || v.length !== 3) return false;
    for (var i = 0; i < v.length; i++) {
      if (!intIn(v[i])) return false;
      if (i > 0 && !(v[i] > v[i - 1])) return false;
    }
    return true;
  }
  return false;
}

/** 自分の設定の鍵。アドレスの大文字小文字で別の人にしない */
function prefMineKey_(email) {
  return 'MYPREF:' + String(email || '').toLowerCase();
}

/** チームの設定の鍵 */
function prefTeamKey_(key) {
  return 'PREF:' + key;
}

/**
 * JSON を読む。読めなければ undefined (人がエディタで書き換えうる)。
 *
 * @param {*} raw
 * @returns {*}
 */
function prefParse_(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    return undefined;
  }
}

/**
 * スクリプトプロパティを1つ読む口。一覧のように何度も読むところは、写しを1回取って渡す
 * (prefReader_)。
 *
 * @returns {function(string): *}
 */
function prefReaderLive_() {
  var props = PropertiesService.getScriptProperties();
  return function (k) { return props.getProperty(k); };
}

/**
 * スクリプトプロパティの写しを1回だけ取って読む口。
 *
 * @returns {function(string): *}
 */
function prefReader_() {
  var all = PropertiesService.getScriptProperties().getProperties() || {};
  return function (k) { return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : null; };
}

/**
 * 設定の値を返す。**読むのはここだけ。** 無い・読めない・範囲の外なら既定値。
 *
 * @param {string} key
 * @param {string} [email] 自分の設定のとき、誰の設定か。省略すると開いている本人
 * @param {function(string): *} [read] prefReader_()。省略すると1つずつ読む
 * @returns {*}
 */
function prefGet_(key, email, read) {
  var item = prefItem_(key);
  if (!item) throw new Error('知らない設定です: ' + key);
  return prefValueOf_(item, email, read || prefReaderLive_()).value;
}

/**
 * 値と、それが決めた値か (既定値でないか)。
 *
 * @param {object} item
 * @param {string} [email]
 * @param {function(string): *} read
 * @returns {{value: *, custom: boolean}}
 */
function prefValueOf_(item, email, read) {
  var v;
  var who = '';
  if (item.scope === 'me') {
    who = String(email || currentEmail_());
    var mine = who ? prefParse_(read(prefMineKey_(who))) : undefined;
    if (mine && typeof mine === 'object' && !Array.isArray(mine) &&
        Object.prototype.hasOwnProperty.call(mine, item.key)) v = mine[item.key];
  } else {
    v = prefParse_(read(prefTeamKey_(item.key)));
  }
  if (v !== undefined && prefValid_(item, v, who)) return { value: v, custom: true };
  return { value: item.def, custom: false };
}

/**
 * 「動きなし」の段階。stalenessOf に渡す。
 *
 * @returns {number[]}
 */
function staleSteps_() {
  return prefGet_('stale.steps');
}

/**
 * 設定を1つ書く (Web App API)。**書くのはここだけ。** null で既定に戻す (消す)。
 * チームの設定は管理者だけ。自分の設定は開いている本人のぶんだけ。
 * 変更の履歴 (change_log) には残さない。
 *
 * @param {string} key
 * @param {*} value
 * @returns {object} 書いたあとの apiPrefs()
 */
function apiPrefSet(key, value) {
  var item = prefItem_(key);
  if (!item) throw new Error('知らない設定です: ' + key);
  var reset = value === null || value === undefined;
  if (!reset && item.type === 'char' && !prefValid_(item, value, currentEmail_())) {
    throw new Error('そのキャラは選べません。最初からいるキャラか、推しの頁で作った自分のキャラを選んでください');
  }
  if (!reset && !prefValid_(item, value, currentEmail_())) {
    throw new Error('「' + item.label + '」に入れられない値です' +
      (item.type === 'int' ? ' (' + item.min + '〜' + item.max + ' の整数)' : '') +
      (item.type === 'steps' ? ' (' + item.min + '〜' + item.max + ' の整数を小さい順に3つ)' : ''));
  }
  // 既定値と同じなら消す。残すと、あとで既定値を変えたときにその人 (チーム) だけ古い値に留まる
  if (!reset && JSON.stringify(value) === JSON.stringify(item.def)) reset = true;

  var props = PropertiesService.getScriptProperties();
  if (item.scope === 'team') {
    repoAssertAdmin_('チームの設定を変えること');
    if (reset) props.deleteProperty(prefTeamKey_(item.key));
    else props.setProperty(prefTeamKey_(item.key), JSON.stringify(value));
    return apiPrefs({ team: true });
  }

  var me = currentEmail_();
  if (!me) throw new Error('誰の設定か分かりません');
  // 自分の設定は1つの JSON に全部入っている。続けて2つ切り替えたとき、読んで書くあいだに
  // もう一方が書くと片方が消えるので、鍵の中で読み書きする
  dbWithLock_(10000, function () {
    var mine = prefParse_(props.getProperty(prefMineKey_(me)));
    if (!mine || typeof mine !== 'object' || Array.isArray(mine)) mine = {};
    if (reset) delete mine[item.key];
    else mine[item.key] = value;
    if (Object.keys(mine).length) props.setProperty(prefMineKey_(me), JSON.stringify(mine));
    else props.deleteProperty(prefMineKey_(me));
  });
  // 書くのは設定の画面だけなので、管理者かも添えて返す
  return apiPrefs({ team: true });
}

/**
 * 設定の一覧と今の値 (Web App API)。自分の設定は開いている本人のぶんだけ。
 *
 * effective は画面がすぐ使う形にまとめたもの (最初の画面・ホームのカード・使われ方を数えるか・
 * 止めた通知の種類)。
 *
 * **管理者か (canEditTeam) は opts.team のときだけ調べる。** 共有ドライブでは Drive に問い合わせる
 * ので、起動のたびに待たせない。起動のときは false のまま返す (使わない)。
 *
 * @param {{team?: boolean}} [opts] 設定の画面からは {team: true}
 * @returns {object}
 */
function apiPrefs(opts) {
  var me = currentEmail_();
  var read = prefReader_();
  var items = PREFS_SCHEMA().map(function (p) {
    var got = prefValueOf_(p, me, read);
    return {
      key: plainText(p.key),
      scope: plainText(p.scope),
      type: plainText(p.type),
      section: plainText(p.section),
      label: plainText(p.label),
      help: plainText(p.help),
      min: plainNumber(p.min),
      max: plainNumber(p.max),
      options: (p.options || []).map(function (o) {
        return { value: plainText(o.value), label: plainText(o.label) };
      }),
      def: prefPlainValue_(p, p.def),
      value: prefPlainValue_(p, got.value),
      custom: !!got.custom,
    };
  });
  var byKey = {};
  items.forEach(function (p) { byKey[p.key] = p.value; });

  var fun = {};
  PREF_FUN_KINDS_().forEach(function (f) { fun[f.key] = byKey['fun.' + f.key] === true; });

  var cards = {};
  PREF_HOME_CARDS_().forEach(function (c) { cards[c.key] = byKey['home.cards.' + c.key] !== false; });

  return {
    canEditTeam: !!(opts && opts.team) && repoIsAdmin_(me),
    items: items,
    teamGoal: plainNumber(teamGoal()),
    effective: {
      startTab: plainText(byKey['start.tab']),
      termStyle: plainText(byKey['terms.style']),
      homeCards: cards,
      fun: fun,
      focus: { start: byKey['focus.start'] === true, sound: byKey['focus.sound'] === true,
        remind: plainText(byKey['focus.remind']) },
      oshi: { on: byKey['oshi.on'] === true, home: byKey['oshi.home'] !== false,
        char: plainText(byKey['oshi.char']), fallback: plainText(byKey['oshi.fallback']),
        style: plainText(byKey['oshi.style']) },
      usageOn: byKey['usage.enabled'] !== false && byKey['usage.self'] !== false,
      notifyOff: NOTIFY_KINDS().filter(function (k) { return byKey['notify.' + k.key] === false; })
        .map(function (k) { return plainText(k.key); }),
    },
  };
}

/**
 * 値を画面に渡せる形にする。
 *
 * @param {object} item
 * @param {*} v
 * @returns {*}
 */
function prefPlainValue_(item, v) {
  if (item.type === 'bool') return !!v;
  if (item.type === 'int') return plainNumber(v);
  if (item.type === 'steps') return (v || []).map(function (n) { return plainNumber(n); });
  return plainText(v);
}

/**
 * 通知メールの宛先から、その種類を止めた人を外す。kind が無い・知らない種類なら
 * 外さない (今までどおり送る)。宛先はカンマで並べてもよい。
 *
 * @param {string} to
 * @param {string} [kind]
 * @returns {string} 残った宛先 (カンマ区切り)。全員止めていれば空
 */
function notifyRecipients_(to, kind) {
  var list = String(to || '').split(',').map(function (s) { return s.replace(/^\s+|\s+$/g, ''); })
    .filter(function (s) { return !!s; });
  var item = kind ? prefItem_('notify.' + kind) : null;
  if (!item) return list.join(',');
  var read = prefReaderLive_();
  return list.filter(function (who) {
    return prefValueOf_(item, who, read).value !== false;
  }).join(',');
}
