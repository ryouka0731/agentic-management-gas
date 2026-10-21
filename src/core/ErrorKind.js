/**
 * 断りの型と、次にすること。
 *
 * 断られると人は止まる。もう一度押してよいのか分からず、押し直して同じものが2つできた
 * こともある。断りの字はそのまま (人が読む文で、test/naming.test.js が走査している)、
 * 字の決まった言い回しから型を引き、型ごとに「次にすること」と、もう一度押してよいかを返す。
 *
 * **画面にも同じ写しがある** (src/ui/app.js.html の errorKindOf / nextStepOf / errorTextOf)。
 * サーバと画面で同じ答えになるかは test/ui-parity.test.js が見ている。片方だけ直さない。
 * 今ある断り文 (new Error の字) が全部どれかの型に当たるかは test/errorkind.test.js が見ている。
 *
 * 型:
 * - busy:      鍵が取れずに、何も書かないうちに断った (dbWithLock_ の DB_BUSY_TEXT と**同じ字のときだけ**)。
 *              少し待って押し直してよい。**押し直してよいのはこれだけ**
 * - partial:   同じ実行の中で途中まで書いてから、鍵が取れずに断った (DB_PARTIAL_TEXT)。押し直すと二重になる
 * - quota:     英語の「混み合い・上限」(Lock timeout・Service invoked too many times など)。操作の途中で
 *              起きるので、どこまで済んだか分からない。しばらく時間をおいて、一覧で確かめてから
 * - timeout:   時間切れ・通信の途切れ。途中まで済んでいるかもしれないので、押し直す前に一覧で確かめる
 * - forbidden: 決まった人しかできない
 * - gone:      消えた・捨てられた・見つからない
 * - stale:     開いたあとにほかで直された
 * - invalid:   入れた内容や今の状態では受けられない
 * - unknown:   上のどれでもない (思いがけない失敗)。押し直しは勧めない
 *
 * 設計: docs/superpowers/specs/2026-10-21-motivation-review-2.md の D.1。
 */

/**
 * 英語の実行時エラー (Apps Script や通信が出すもの)。上から順に見る。
 *
 * 「見つからない」は権限より先に見る。Drive は見つからないときに「権限が無いかもしれない」と添える
 *
 * @returns {Array<{kind: string, re: RegExp}>}
 */
function ERROR_KIND_ENGLISH_() {
  return [
    { kind: 'quota', re: /Lock timeout|Lock wait|Service invoked too many times|too many (simultaneous )?(invocations|requests)|Address unavailable|temporarily unavailable|rate limit|try again later/i },
    { kind: 'timeout', re: /Exceeded maximum execution time|maximum execution time|execution timed? ?out|Script runtime exceeded|deadline exceeded|NetworkError|Connection failure|network error|Service (Spreadsheets|Documents|Drive|Slides) failed|Service error|server error|took too long/i },
    { kind: 'gone', re: /not found|No item with the given ID|does not exist|has been deleted|is missing|could not be found/i },
    { kind: 'forbidden', re: /Authorization is required|You do not have permission|do not have access|Access denied|PERMISSION_DENIED|not authorized|Insufficient permission/i },
  ];
}

/**
 * 日本語の断り文の言い回し。上から順に見る (先に当たったものが勝つ)。
 *
 * 見るのは errorHeadOf_ が名前や番号を外した字だけ。
 * busy はここに無い (DB_BUSY_TEXT と同じ字のときだけ。errorKindOf が先に見る)。
 *
 * @returns {Array<{kind: string, re: RegExp}>}
 */
function ERROR_KIND_PHRASES_() {
  return [
    { kind: 'partial', re: /途中まで済みました/ },
    { kind: 'quota', re: /混み合って/ },
    { kind: 'stale', re: /開いたあと|直されています|進みました|先に入りました|中身が変わっています|読み込み直して|再読み込み|開き直してください/ },
    { kind: 'gone', re: /見つかりません|消されて|捨てたもの|登録されていません|管理対象にない|作業コピーがありません/ },
    { kind: 'forbidden', re: /だけが(行え|取り下げ|閉じ)|だけです|だけ(書き換え|消せ|直せ)|見られません|扱えません|持ち主|管理者|権限|役割が要ります|承認できません/ },
    { kind: 'invalid', re: /ください|まで(です|に)|不正|正しくありません|知らない|分かりません|読めません|できません|使えません|作れません|足せません|直せません|消せません|変えられません|捨てられません|頼めません|対応していません|ありません|あります|います|オフです|空です|大きすぎ|超えました|輪になります|合いません|なっています|形になっていません|書き戻せません|整数です|使えます|決まっています|終わっています|ていません|られません|ない\S*です|必要です|未定義|」か「|既に|すでに/ },
  ];
}

/**
 * 前に付く「Error: 」「Exception: 」を外す。実行時エラーは画面に届くときこれが付くことがある。
 *
 * @param {*} message
 * @returns {string}
 */
function errorBareOf_(message) {
  return String(message == null ? '' : message).replace(/^\s*(?:(?:Script|Type|Reference|Range)?Error|Exception)\s*:\s*/, '');
}

/**
 * 人の書いた名前や番号が入る場所 (ErrorKind の言い回しを当てない所)。上から順に空にする。
 *
 * - 最初の「: 」より後 (前置き + : + 名前の形)
 * - 「…」の中 (題名・版の名前)、# のあとの番号
 * - 文の頭に名前が来る形 (「<名前> さんの差し戻しが…」「<道のり> の反映結果を…」「の <道のり> に記録…」)
 *
 * @returns {Array<{re: RegExp, to: string}>}
 */
function ERROR_NAME_SLOTS_() {
  return [
    { re: /(: |：)[\s\S]*$/, to: '' },
    { re: /「[^」]*」/g, to: '「」' },
    { re: /#\S*/g, to: '#' },
    { re: /^[\s\S]* さん(の|が|に|は)/, to: 'さん$1' },
    { re: /^[\s\S]* の反映結果/, to: 'の反映結果' },
    { re: /の [\s\S]* に記録/, to: 'の に記録' },
  ];
}

/**
 * 日本語の断り文から、名前や番号を外した決まった部分。
 *
 * @param {string} bare
 * @returns {string}
 */
function errorHeadOf_(bare) {
  var head = String(bare);
  var slots = ERROR_NAME_SLOTS_();
  for (var i = 0; i < slots.length; i++) head = head.replace(slots[i].re, slots[i].to);
  return head;
}

/**
 * 断りの字から型を引く。
 *
 * @param {*} message 断りの字 (err.message)
 * @returns {string} busy | partial | quota | timeout | forbidden | gone | stale | invalid | unknown
 */
function errorKindOf(message) {
  var bare = errorBareOf_(message);
  if (!bare) return 'unknown';

  // 押し直してよいのは、鍵が取れずに何も書かないうちに断ったときだけ (Db.gs の DB_BUSY_TEXT と同じ字)
  if (bare.replace(/\s+$/, '') === '混み合っています。少し待ってからもう一度お試しください') return 'busy';

  // 日本語の文は、名前や番号を外した決まった部分だけを見る。英語の言い回しもそこだけに当てる
  // (英語の名前の人が「Lock timeout さんの…」と出ても、名前で型を変えない)
  var japanese = /[぀-ヿ㐀-鿿]/.test(bare);
  var text = japanese ? errorHeadOf_(bare) : bare;

  var en = ERROR_KIND_ENGLISH_();
  for (var i = 0; i < en.length; i++) {
    if (en[i].re.test(text)) return en[i].kind;
  }
  if (!japanese) return 'unknown';

  var ja = ERROR_KIND_PHRASES_();
  for (var j = 0; j < ja.length; j++) {
    if (ja[j].re.test(text)) return ja[j].kind;
  }
  return 'unknown';
}

/**
 * 型ごとの「次にすること」。retry は [もう一度] を出してよいか (busy だけ)。
 *
 * **busy のほかには出さない。** partial / quota / timeout は途中まで済んでいることがあり、押し直すと
 * 同じものが2つできる。思いがけない失敗 (unknown) も、同じ理由で出さない。
 *
 * @param {string} kind
 * @returns {{text: string, retry: boolean}}
 */
function nextStepOf(kind) {
  var steps = {
    busy: { text: '少し待ってから、もう一度押してください。混み合っていただけで、何も変わっていません', retry: true },
    partial: { text: '途中まで済んでいます。押し直す前に、一覧を開き直して何ができているかを確かめてください', retry: false },
    quota: { text: 'しばらく時間をおいてから、一覧を開き直して済んでいないかを確かめてください。すぐに押し直すと、また断られます', retry: false },
    timeout: { text: '途中まで済んでいるかもしれません。押し直す前に、一覧を開き直して確かめてください', retry: false },
    forbidden: { text: 'この操作ができる人 (管理者か、作った本人) に頼んでください', retry: false },
    gone: { text: '消されたか、捨てられたものです。文書なら Drive のゴミ箱から、やることなら置き場から戻せます', retry: false },
    stale: { text: 'ほかで先に直されています。開き直して、いまの中身を見てからもう一度してください', retry: false },
    invalid: { text: '断りに書いてあるとおりに入れ直すか、状態を整えてから、もう一度してください', retry: false },
    unknown: { text: '一覧を開き直して、済んでいないかを確かめてください。続くときは「要望・不具合」から知らせてください', retry: false },
  };
  return Object.prototype.hasOwnProperty.call(steps, kind) ? steps[kind] : steps.unknown;
}

/**
 * 画面に出す断りの字。日本語の文はそのまま、英語の実行時エラーは日本語に言い換える
 * (元の字は画面が console に残す)。
 *
 * @param {*} message
 * @returns {string}
 */
function errorTextOf(message) {
  var raw = String(message == null ? '' : message);
  if (/[぀-ヿ㐀-鿿]/.test(raw)) return raw;
  var said = {
    quota: '混み合っているか、使える回数の上限に当たって、途中で止まりました',
    timeout: '時間がかかりすぎて、途中で止まりました',
    forbidden: 'この操作をする権限がありません',
    gone: '対象が見つかりませんでした (消されたか、ゴミ箱に入っています)',
  };
  var kind = errorKindOf(raw);
  return Object.prototype.hasOwnProperty.call(said, kind) ? said[kind] : '思いがけない理由でできませんでした';
}
