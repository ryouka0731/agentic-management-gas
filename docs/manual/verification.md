# 実機で確かめる

[手引きの目次](README.md)

疑似GAS (`test/fakegas.js`) は実機より甘いところがある (鍵が必ず取れる・権限で断られない・Docs の描画を写像で差し替える
など)。そこは GAS エディタから実機で確かめる。どれも**引数なしで実行でき、後片付けまでする**。持ち主だけが実行できる。

## 入口

| 関数 | 何を確かめるか | 前もって要るもの |
|---|---|---|
| `debugVerifyPhase2()` | 使い捨ての Doc で、食い違いの発生 → 解決 → 反映 → 正式版への書き戻し → 古い `headSha` での記録を断る (楽観的並行制御) | なし |
| `debugVerifyPhase3b()` | 使い捨ての Doc で、やること → ボード → 改訂版 → 確認依頼 → 承認 → 反映、やることが閉じてカードが動くか | なし |
| `debugVerifyCommandQueue()` | 命令を1件置いて `processCommandQueue()` を呼び、結果を判定して片付ける (トリガーの設置とは別に、実行の経路だけ) | なし |
| `debugVerifySharedDrive()` | 共有ドライブに置いたとき: 役割が読めるか → 命令の移動 → 回った時刻 → 道具の zip。マイドライブなら何もせずにそう言う | 共有ドライブに置いていること |
| `debugVerifyScrum()` | 作業期間 → 大きさ → 完了 → 期間ごとに終えた量・残りの量の推移・困りごと・履歴。成否にかかわらず片付け、オン・オフも戻す (やることの番号は2つ進む) | なし |
| `debugMarkdownRoundTrip()` | 実際の文書で HTML → Markdown → HTML がバイト単位で一致するか (開いて保存しただけで差分が出ないか) | `DEBUG_FILE_ID` |
| `debugWriteRoundTrip()` | 実際の文書で Doc → HTML → Doc → HTML と往復させ、書き戻しが情報を落としていないか。**書き換えるので、必ず改訂版の作業コピーに対して** | `DEBUG_WRITE_FILE_ID` (`debugListWorkingCopies()` で候補を出し、人が選ぶ) |
| `debugCleanupLastVerify()` | 検証が失敗して残ったものの片付け | — |

- 検証は自己承認を自分で許して、終わったら元に戻す (`ALLOW_SELF_APPROVE` の準備は要らない)
- 手でキューを回す入口は、回った時刻 (`QUEUE_LAST_RUN`) を元に戻す (止まったトリガーが「動いています」に見えないように)
- 疑似GASでは書き戻しのラウンドトリップの欠落を検出できない。そこは `debugWriteRoundTrip()` が担う。描画結果を保存した
  HTML があれば、手元でも `node test/roundtrip-check.js <html>` で `parse(serialize(x)) === x` を確かめられる

## これまでに実機で確かめたこと

| いつ | 入口 | 結果 |
|---|---|---|
| Phase 1 | 手で | 同じ Doc から常に同じ HTML / 実際の Doc で `parse(serialize(x)) === x` / Docs の編集が次の表示で反映 / キャッシュで 4,048ms → 294ms / 実体を取れない画像があっても本文は描ける / エスケープと iframe sandbox の二重の守り |
| 2026-09-04 | `debugVerifyPhase2()` | 15項目すべて通過 (食い違いの検出・解決して反映・fileId の維持・取れない画像を含む書き戻しを断る・楽観的並行制御) |
| 2026-09-08 | `debugVerifyPhase3b()` | 9項目すべて通過 (やること作成 → これから → 改訂版 → 作業中 → 確認依頼 → 確認中 → 反映 → 完了、やることが閉じる) |
| 2026-09-08 | `debugVerifyCommandQueue()` | 6項目すべて通過 |

同じシナリオは疑似GASの統合テスト (`test/phase2-integration.test.js` など) にも落としてあり、以後は `npx vitest run` で
後戻りを見つけられる。

実機で見つかって直したものの例は [CLAUDE.md](../../CLAUDE.md) の「落とし穴」にある (Docs に空の字を入れると断られる、
ゴミ箱の中のキューの置き場、など)。
