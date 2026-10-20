---
name: banto-patch
description: この道具 (SoftBanto / 番頭) の確認依頼にコードの差分を添えるとき (`node agent.mjs patch` / `patches` / `patch-rm`)、規程とコードを1つの確認依頼にまとめるときに読む。
---

# コードの変更を添える

**この道具はコードの版管理をしません。** そこは git がやります。ここでできるのは
「何が変わったのかを人が画面で読んで、進めてよいと決める」ところだけです。

```sh
node agent.mjs patch <確認依頼の番号> <ファイル>          # 未記録のぶん
node agent.mjs patch <確認依頼の番号> <ファイル> main      # main との差
node agent.mjs patches <確認依頼の番号>                   # 添えたものを見る
node agent.mjs patch-rm <確認依頼の番号> <id>             # 外す
```

差分を取るのは**手元**です。向こう側 (Apps Script) では git のオブジェクトを
読めません (loose object は raw deflate で raw inflate が無く、packfile はさらに
delta チェーン)。だから `git diff` をこちらで走らせて、その結果を送ります。

## 添えても反映はされません

承認されても、コードは向こうで書き換わりません。**入れるのは手元の git です。**
向こうに残るのは「読んで進めてよいと決めた」記録だけです。

## 規程とコードを1つの確認依頼にまとめる

これがこの道具でしかできないことです。git は Google ドキュメントを持てず、
この道具はコードを持ちません。

1. 規程 (Google ドキュメント) を改訂版で直し、`commit` する
2. 同じ確認依頼に `patch` でコードの差分を添える
3. 総務は規程側を、開発者はコード側を読んで承認する
4. 反映すると**規程だけ**が書き換わる。コードは手元で `git merge` する
