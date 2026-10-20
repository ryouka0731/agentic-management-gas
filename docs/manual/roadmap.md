# これまでとこれから

[手引きの目次](README.md)

段階ごとの経緯と、設計 (specs)・計画 (plans) の文書への索引。設計の文書は決めたときの記録で、あとで変わったところは
コードと [CLAUDE.md](../../CLAUDE.md) が正しい。

## 土台

| 段階 | 内容 | 状態 | 文書 |
|---|---|---|---|
| 設計 | 全体の設計 (PoC) | — | [設計仕様](../superpowers/specs/2026-09-02-gws-git-management-design.md) / [大規模版の構想](../superpowers/specs/2026-09-02-gws-git-management-scaling.md) |
| 1 | 基盤・Docs の描画・いまの層の閲覧 | 完了 (実機で確かめた) | [計画](../superpowers/plans/2026-09-02-gws-git-management-phase1.md) |
| 2 | 記録・改訂版・確認依頼・反映・書き戻し | 完了 (実機で確かめた) | [計画](../superpowers/plans/2026-09-02-gws-git-management-phase2.md) |
| 3a | Sheets / Slides の描画 | 実装済み | [計画](../superpowers/plans/2026-09-04-gws-git-management-phase3a-sheets-slides.md) |
| 3b | やること / 進捗ボード | 完了 (実機で確かめた) | [計画](../superpowers/plans/2026-09-04-gws-git-management-phase3b-issues-projects.md) |
| 4 | 4a〜4d の設計 | — | [設計](../superpowers/specs/2026-09-04-gws-git-management-phase4-design.md) |
| 4a | コマンドキュー (手元との連携) | 完了 (実機で確かめた) | [計画](../superpowers/plans/2026-09-08-gws-git-management-phase4a-command-queue.md) |
| 4b | Markdown で直す・正式版の保護 | 完了 (往復を実機で確かめた) | [計画](../superpowers/plans/2026-09-04-gws-git-management-phase4b-markdown-edit.md) |
| 4c | GitHub に近い画面 (版の切り替え・左右2列の差分・確認依頼のタブ) | 実装済み | [計画](../superpowers/plans/2026-09-04-gws-git-management-phase4c-github-ui.md) |
| 4d | 画面の中の使い方・身元の実測 | 実装済み | [計画](../superpowers/plans/2026-09-04-gws-git-management-phase4d-guide.md) |
| — | 概念モデル (画面の行き先の決め方) | — | [概念モデル](../superpowers/specs/2026-09-09-concept-model.md) |

## そのあとに入ったもの

| いつ | 内容 | 文書 |
|---|---|---|
| 2026-10-07 | 使う気・仕事の意欲を生む施策 (前進・チームの目標) | [計画](../superpowers/plans/2026-10-07-motivation.md) |
| 2026-10-07 | エージェンティックスクラム (既定オフ) | [計画](../superpowers/plans/2026-10-07-agentic-scrum.md) |
| 2026-10-14 | ホーム | [設計](../superpowers/specs/2026-10-14-home-design.md) / [計画](../superpowers/plans/2026-10-14-home.md) |
| 2026-10-14 | 横断検索 (Ctrl+K) | [設計](../superpowers/specs/2026-10-14-search-design.md) / [計画](../superpowers/plans/2026-10-14-search.md) |
| 2026-10-14 | やることを気持ちよく片づける (完了のときの一言・ポイント) | [設計](../superpowers/specs/2026-10-14-task-flow-motivation-design.md) / [計画](../superpowers/plans/2026-10-14-task-flow.md) |
| 2026-10-15 | 手元の道具: 作業をやることに載せる・自動更新 | [設計](../superpowers/specs/2026-10-15-kit-track-design.md) / [計画](../superpowers/plans/2026-10-15-kit-track.md) |
| 2026-10-19 | 共有ドライブ対応・署名の秘密鍵を番頭の外 (deploy する人の手元) へ移す | [設計](../superpowers/specs/2026-10-19-shared-drive-design.md) / [計画](../superpowers/plans/2026-10-19-shared-drive.md) |
| 2026-10-19 | 全画面とリンク (#17)・工程表の幅と細かさ (#16)・ゲームを広げる (#15)・改善のヒント (#14)・手元の道具の自分の様子 (#13) | [設計](../superpowers/specs/2026-10-19-five-asks-design.md) |
| 2026-10-20 | 設定の一覧 (#18)・使われ方を広げる (#19)・使い方を広げる (#20) | [設計](../superpowers/specs/2026-10-20-guide-usage-settings-design.md) の 1〜3 |
| 2026-10-20 | スクラムの言葉を一般の言葉に (#21) | 同じ設計の 4 |
| 2026-10-20 | README と手引きの書き直し (#22) | この手引き |

番号 (#13 など) は、番頭自身の開発を番頭のやることで管理したときの番号。

## 決めてやらないこと

- 外部 API・公開エンドポイント・GCP プロジェクトは使わない (手元との行き来は Drive の同期に乗せる)
- 色・フォント・文字サイズは版管理しない
- Slides は反映しない (図形の座標を HTML から戻せないため)。設計にあった「改訂版のコピーを正式版として採用する」案は、
  fileId が変わるので採らない
- コードの版管理はしない (git が持つ)
- 連続日数・人ごとの草・人の名前の入った最近の動きは出さない
- 使われ方に時刻と順番は残さない

大きく使われるようになったときに何が先に壊れるかは [大規模版の構想](../superpowers/specs/2026-09-02-gws-git-management-scaling.md) にある。
