# 実機検証の入口

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。

## 実機検証の入口

すべて GAS エディタから引数なしで実行でき、後片付けまでする。

| 関数 | 内容 |
|---|---|
| `debugVerifyPhase2()` | コンフリクト → 解決 → マージ → 書き戻し → 楽観的並行制御 |
| `debugVerifyPhase3b()` | Issue → ブランチ → PR → マージとカンバンの自動移動 |
| `debugVerifyCommandQueue()` | コマンドキューの実行経路 |
| `debugVerifySharedDrive()` | 共有ドライブに置いたとき: 役割が読めるか → 命令の移動 → 回った時刻 → 道具の zip。マイドライブなら何もせずにそう言う |
| `debugMarkdownRoundTrip()` | 実文書で HTML → Markdown → HTML がバイト一致するか |
| `debugWriteRoundTrip()` | 実文書で書き戻しが情報を落としていないか |
| `debugVerifyScrum()` | スプリント → ポイント → 完了 → ベロシティ・バーンダウン・障害物・履歴。成否にかかわらず片付け、オン・オフも戻す |
| `debugVerifyCalendar()` | 一時のカレンダーで、持ち主のやることを組む → 重ならない・既定のカレンダーの予定と重ならない・時間の中・印・組み直しで増えない・やめたら消える。一時のカレンダーとやることを片付け、設定を戻す |
| `debugCleanupLastVerify()` | 失敗して残った検証物の片付け |
| `debugCacheClear()` | 台帳の読み取りのキャッシュを捨てる。台帳を直にいじったあと、期限 (30分) を待たずに画面へ出したいとき (`docs/dev/ledger-schema.md`) |

検証ハーネスは `ALLOW_SELF_APPROVE` を自分で立てて元に戻すため、事前準備は要らない。
