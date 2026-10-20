# 設定の画面

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。

## 設定の画面で変えられる項目

**`PREFS_SCHEMA()` (`src/core/Prefs.gs`) が唯一の定義である。** 画面は `apiPrefs` の一覧から欄を組み、
写しを持たない。読むのは `prefGet_` だけ、書くのは `apiPrefSet` だけで、未設定・読めない・範囲の外は
既定値 (= 今の動き) に倒す。既定値は今の定義 (`ADVICE_RULES` / `STALE_STEPS` / `HOME_DUE_DAYS` /
`USAGE_KEEP_DAYS` / `REPORT_TEMPLATES`) から取り、数を写さない。上書きを重ねた改善のヒントは
`adviceRulesEffective_` が返す (`ADVICE_RULES` は既定のまま)。

チームの設定はスクリプトプロパティ `PREF:<key>` (管理者だけが書ける)。**自分の設定もスクリプトプロパティ
`MYPREF:<小文字のアドレス>` に置く。** 通知は送る側の権限で、キューは持ち主の権限で走るので、受け取る人の
UserProperties は読めない (`KIT_PRINT:` と同じ事情)。持ち主はエディタで他人の設定を見られる。
通知メールは `notify(to, subject, body, kind)` の kind で、止めた人を宛先から外す (画面の中の知らせは止めない)。
**知らせの関数を足したら kind を渡す。** 渡さないと、止めた人にも届く。

`notify` / `usageRecord` / 一覧の「動きなし」が `prefGet_` を呼ぶので、それらを読むテストの SOURCES には
`src/core/Prefs.gs` が要る。

`style.share` (仕事のスタンス診断の型の名前をチームに見せる) も自分の設定で、既定はオフ。読むのは `workStyleShared_` が
`prefValueOf_` で人ごとに読む (全員の `STYLE:` を1回の写しで読むので、`prefReader_` と同じ形の口を渡す)。結果の画面の切り替えも
`apiPrefSet` を呼ぶ (書くのはここだけ、のまま)。`apiWorkStyleForget` は `apiPrefSet('style.share', null)` で既定に戻す。
