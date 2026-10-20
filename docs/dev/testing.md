# テストの測り方

`CLAUDE.md` から分けた。下に挙げた場所を触る前に読むこと (`CLAUDE.md` の「触る場所と、先に読むファイル」)。

## テストの測り方と、測れないもの

```bash
npm run coverage   # 範囲は vitest.config.js の coverage。結果は coverage/coverage-summary.json
npm run metrics    # 関数の長さ・分かれ道の数・入れ子・重なり (scripts/metrics.mjs)
```

**画面の JS は、つないだものを `coverage-ui/app.joined.js` に書いて読む** (`test/dom.js`)。カバレッジは
ファイル名の中身をディスクから読み直すので、`new Function` で読むと名前が無くて1行も数えられず、
`app.js.html` 単体を名乗ると (開いた関数だけなので) 読めずに外される。つないだものに source map
(`test/ui-source.js` の `appSourceMap`) を添え、行を元の部分ファイル (`src/ui/*.html`) へ戻している。
以前は画面の部分ファイルが全部 0% と出ていて、全体も 44% に見えていた (実際は 90%)。

**画面が投げたまま誰も受け止めなかった例外は、そのテストを落とす** (`test/component/mount.js` の `afterEach`)。
jsdom は聞き手や返事のハンドラの例外を console に出すだけなので、描けずに落ちている画面のテストが通っていた
(工数の集計の表を古い形の返事で描いていた)。疑似の返事はサーバが返す形に合わせること。

テスト回りの依存を入れ直すときは、**package-lock.json を消さない**。npm 10.9 には
vitest 4 の peer 解決で落ちる不具合があり (`Cannot read properties of null
(reading 'edgesOut')`)、ロックが無い状態からだと `npm install` が通らない。
`npm ci` はロックから入れるので問題ない。

どうしても作り直すときは `npm install --legacy-peer-deps` で入れるが、この形は
peer の検査そのものを止める。**入れたあと `npm ls vitest @vitest/coverage-v8` で
2つの版が揃っていることを確かめてから commit すること。**
`@vitest/coverage-v8` は vitest に「ちょうどこの版」を求めるため、片方だけ上がった
木でも黙って入り、`npm run coverage` を叩いたときに初めて落ちる。

そのため `devDependencies` では両方を **`^` 無しの厳密な版**で書いている。上げる
ときは2つ同時に上げる。

`node:vm` で評価するため、`test/harness.js` は **filename に絶対パスを渡す**。
相対パスだと実行された行が元ファイルに結び付かず、カバレッジが 0% と出る。

`test/setup.js` は、無いものを補うだけにしてある。Node 26 では起動時に
`--localstorage-file` を渡さないと `window.localStorage` が undefined になり、
幅や見え方の覚え書きを使う jsdom のテストが総崩れになる。**あるものは
置き換えない。** 置き換えると、本物との違いをテストが見なくなる。

カバレッジの数字は **vitest 4 から測り方が変わっている** (AST を見て戻す形に
なった)。3系で記録した値と直接は比べられないので、下がって見えても、それが
測り方の違いなのか実際の後退なのかを先に確かめること。

**行が覆えていても、状態が覆えているとは限らない。** 実際に次の2件を
高いカバレッジのまま見逃した。

- 「登録しただけで一度も記録していない文書」から分岐できなかった。
  どのテストも `setup()` で先に記録していたため、その状態が現れなかった
- 名前の検査が厳しすぎて空白入りの名前を弾いていた。その行は100%
  覆えていたが、テストが古い仕様のほうを固定していた

`test/e2e-journey.test.js` は**何も仕込まずに**人がたどる順序で通す。
仕込みで隠れる状態を見つけるためのものなので、`setup()` を使わないこと。

`test/component/*.test.js` は jsdom に画面を組んで**実際に押す**。ソースを
文字列で検査するだけでは、描画も応答も確かめられない。画面の区画ごとに
ファイルを分けてある (1ファイルだと vitest が並べて走らせられず、全体が6分
かかっていた)。組む口 `mount()` は `test/component/mount.js` にだけ置く。
`test/dom.js` は組む元の字と関数を1ファイルの中で1回だけ作り、組むたびに
走らせ直す (状態は持ち越さない)。
疑似の `google.script.run` は実物と同じく返事の写し (`structuredClone`) を渡す。同じ物を
渡すと、画面が返事に書き込んだ分が `DEFAULTS` に残り、後のテストに漏れる (名前を決める
テストのあとで別のテストの名前が変わった)。

`test/dom.js` の `DEFAULTS` に**同じキーを二度書かない**。後のものが勝つため、
足したはずの応答が空のまま届き、原因の分からない空表示になる（実際に踏んだ）。
