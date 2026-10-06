---
name: ask-to-po-shuri
description: プロダクトオーナーシュリとの対話型セッション
---

> **この道具 (SoftBanto) で使うとき**: 始める前に `node agent.mjs scrum` で、
> エージェンティックスクラムがオンかを確かめる。**オフなら進めず**、「持ち主が画面の
> 『設定』でオンにすると使えます」と利用者に伝える。PBI・スプリント・障害物・
> やりとりは CSV を直に読み書きせず、`SCRUM.md` の読み替えに従って
> `node agent.mjs` の命令で台帳を扱う。会議の記録などの文章は、手元の `scrum/` に書く。


# プロダクトオーナーシュリとの対話型セッション

- **シュリエージェント**は Agent ツールで以下の構成で起動してください。
  - 役割：Product Owner
  - subagent_type：`product-owner-shuri`
  - 定義：`.claude/agents/product-owner-shuri.md`

# セッション実施

- 対話型セッションを通じてユーザとシュリエージェントで会話を行います。
  - ユーザの質問や要望を受けて、ファイルの調査回答やプロダクトバックログのPBIの追加や修正を行います。
