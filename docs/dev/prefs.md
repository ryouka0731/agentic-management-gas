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

「予定に入れる」(`calendar.*`、`PREF_CALENDAR_ITEMS_`) は `calendar.shared` だけがチームの設定 (型 `calendar` = カレンダーの ID。
`''` は決まっていない)。汎用の欄には出さず `js-calendar` が組む。ほかは自分の設定で `calendar.plan` は既定オフ。
**`calendar.plan` を true 以外に書くと、`apiPrefSet` がこれから先の番頭の予定を消す** (`calendarClearMine_`。失敗しても設定は戻さない)。
細部は `docs/dev/calendar.md`。

「自分の曲」(`focus.music` = `off` / `own`、`focus.musicUrl`) は自分の設定。`focus.musicUrl` は型 `music` で、
**`apiPrefSet` は URL の字で受け、`focusMusicParse_` (`src/core/FocusMusic.js`) で読み解いた部品
(`{kind:'youtube', video}` / `{kind:'youtube', list}` / `{kind:'soundcloud', path}`) だけを書く。** 貼った字は残さない。
読み解けなければ `focusMusicParse_` の断り (平らな日本語) をそのまま投げる。空の字は既定 (`''` = 無し) に戻す。
`prefValid_` は部品の形 (`focusMusicPartsValid_`) を見るので、台帳を手で書き換えた崩れた値は既定に倒れる。
画面へは `items` の value に部品から組み直したリンク、`effective.focus.musicParts` に部品を渡す (埋め込みの URL は画面が組む)。
`Prefs.gs` が `FocusMusic.js` を呼ぶので、`Prefs.gs` を読むテストの SOURCES には `src/core/FocusMusic.js` も要る。

「作業雑談部屋」は `cowork.enabled` (チームの設定、既定オフ) と `cowork.showFocus` (自分の設定、既定オフ) だけが `PREFS_SCHEMA()` に入る。
**部屋の一覧は項目にしない。** 名前とリンクの部品の並びで、汎用の欄では組めないので、スクリプトプロパティ `COWORK_ROOMS` に置き、
書くのは `apiCoworkSetRooms` (管理者だけ) だけにしてある。画面の欄は `js-cowork` の `makeCoworkRoomsEditor` が `cowork.enabled` の節に添える。
`Prefs.gs` は `CoworkLink.js` を呼ばない (`Prefs.gs` を読むテストの SOURCES を増やさないため)。
