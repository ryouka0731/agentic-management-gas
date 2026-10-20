/**
 * いま画面を開いている (= この呼び出しを走らせている) 人のアドレス。
 *
 * `Session.getActiveUser().getEmail()` を直に書くのはここだけにする。以前は src の
 * 80か所近くに `|| ''` の有無・`String()` の有無・小文字化の有無が混ざって写されて
 * いて、取れなかったとき (null / undefined) に落ちる所と落ちない所があった。
 *
 * - 取れなければ '' を返す (null / undefined を返さない)
 * - 大文字・小文字はそのまま。小文字で比べる所は `currentEmailLower_()` を使う
 * - 毎回 Session を読む。覚えない (テストは人を差し替える。実機でも呼び出しごとに人が違う)
 * - 持ち主かどうかはこれでは分からない (`repoOwners_` を使う)
 *
 * @returns {string}
 */
function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '');
}

/** `currentEmail_()` を小文字にしたもの。大文字・小文字を区別せずに比べる所で使う */
function currentEmailLower_() {
  return currentEmail_().toLowerCase();
}
