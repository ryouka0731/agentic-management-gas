/**
 * 推し (自分だけのキャラクター)。既定はオン (自分の設定 oshi.on)。既定のキャラはタク。
 *
 * 利用者が ChatGPT や Gemini などの画像を作る道具で、自分の参考画像から表情ごとの絵を作り、
 * 番頭に上げる。上げたキャラクターが、済ませたときにほめ、あいさつし、活動に合わせて育つ。
 *
 * **ここが唯一の定義である。** 表情 (OSHI_STATES)・口調 (OSHI_TONES)・場面 (OSHI_EVENTS)・
 * せりふ (OSHI_LINES)・作り方の頼み文 (oshiPrompt / OSHI_PROMPT_BASE)・育ちの段 (OSHI_STAGES)・
 * 画像の上限 (OSHI_IMAGE_LIMITS)・プロフィールの上限と見せ方 (OSHI_PROFILE_LIMITS / oshiProfileReveal) を、画面は apiOshiGet で受け取って使う。手引き
 * (docs/manual/oshi.md) は説明だけで、頼み文を写さない (test/oshi.test.js が見ている)。
 *
 * 守ること:
 * - キャラクターは叱らない。遅れ・断られたときも「しんぱい」でやさしく寄り添うだけ
 * - 連続日数を持たない (途切れたときに意欲が下がる)。育ちは取った実績の数で決まり、実績は消えないので戻らない
 * - 見せるのは本人にだけ (api はアドレスを受けない)
 *
 * GAS に依らないので vitest で直に試す。
 */

/**
 * 表情。key は台帳 (oshi_images.state) に残るので変えない。
 * grow* は育ちの3段 (OSHI_STAGES と同じ key)。
 *
 * @returns {Array<{key: string, label: string, when: string, pose: string, grow?: boolean, scene?: boolean}>}
 */
function OSHI_STATES() {
  return [
    { key: 'idle', label: 'ふつう', when: '待っているとき・あいさつ',
      pose: 'おだやかにほほえんで、こちらを見ている。いちばん基本の、待っているときの顔' },
    { key: 'praise', label: 'ほめる', when: '承認した・記録した',
      pose: 'にっこり笑って、親指を立てるか拍手をしている。「よくできたね」とほめている顔' },
    { key: 'celebrate', label: 'おいわい', when: '反映した・やることを済ませた',
      pose: '満面の笑みで両手を上げて喜んでいる。周りに小さな星や紙吹雪を少しだけ' },
    { key: 'cheer', label: 'おうえん', when: '始めたとき・確認を頼んだとき',
      pose: 'こぶしを握って、前向きに応援している。「がんばって」と励ます顔' },
    { key: 'worry', label: 'しんぱい', when: 'うまくいかなかった・断られた',
      pose: '少し眉を下げて、やさしく心配している。責めたり怒ったりしていない、寄り添う顔' },
    { key: 'sleepy', label: 'ねむい', when: '夜遅く',
      pose: '目をこすって眠そうにしている。あくびまじりの、おだやかな夜の顔' },
    { key: 'surprise', label: 'びっくり', when: '思いがけない当たり',
      pose: '目を丸くして、うれしい驚きで口を開けている。思いがけないことが起きた顔' },
    { key: 'grow1', label: '育ち1 見習い', when: '育ちの最初の段', grow: true,
      pose: '今より少し幼く小さな姿 (頭の大きいデフォルメ)。同じ服と配色で、好奇心いっぱいの顔' },
    { key: 'grow2', label: '育ち2 一人前', when: '育ちの2つ目の段', grow: true,
      pose: '参考画像と同じ、いまの姿。自信のある落ち着いた笑顔' },
    { key: 'grow3', label: '育ち3 名人', when: '育ちの3つ目の段', grow: true,
      pose: '同じ人物が少し大人びて、頼れる雰囲気。服に小さな飾り (バッジなど) を1つだけ足し、配色は変えない' },
    // 作業部屋 (js-room) で、机に向かっている姿。後から足したので末尾に置く (並びは台帳と焼いた絵の並び)
    // scene: 決まった場面でだけ出す表情。でたらめに選ぶ表情 (選んでもらったときのあいさつなど) には入れない
    { key: 'work', label: '作業中', when: '作業部屋で作業しているとき', scene: true,
      pose: '机に向かって、落ち着いて作業している (ノートやパソコンに向かう)' },
    // 推しの機嫌 (OSHI_MOOD_RULES) が「むっ」のときの顔。後から足したので末尾に置く。
    // optional: 絵が無くてもよい表情 (最初からいるキャラの絵も焼かなくてよい)。fallback: 絵が無いときに代わりに出す表情
    { key: 'pout', label: 'むっ', when: 'やることが滞っているとき (機嫌がオンのときだけ)', scene: true, optional: true, fallback: 'worry',
      pose: 'ほっぺを少しふくらませて、口をとがらせている。「むっ」としているが、怖くなく、かわいらしい顔。にらんだり責めたりしていない' },
  ];
}

/**
 * 口調。key は台帳 (oshi.tone) に残るので変えない。
 *
 * @returns {Array<{key: string, label: string}>}
 */
function OSHI_TONES() {
  return [
    { key: 'polite', label: '丁寧' },
    { key: 'genki', label: '元気' },
    { key: 'cool', label: 'クール' },
    { key: 'kansai', label: '関西弁' },
    { key: 'butler', label: '執事' },
    { key: 'gothic', label: '耽美 (祈りの口調)' },
    { key: 'buddy', label: '明るい相棒' },
  ];
}

/**
 * 最初からいるキャラクター (公式のキャラ)。**唯一の表。** 並びは設定の選び方の並びで、先頭が既定
 * (自分の設定 oshi.char の既定は 'builtin:' + 先頭の key)。名前と口調は決まっていて、利用者は変えられない
 * (変えたいときは自分のキャラを作る)。絵は利用者が用意したもので、scripts/build-oshi-default.mjs が
 * assets/oshi-default/<key>/ から src/core/OshiDefault<Key><形>.gs に焼く。
 *
 * - タク: 明るくて少しおちゃめな相棒。面倒なことは道具に任せて、余白を作ろうと誘ってくれる (先頭 = 既定)
 * - イツキ: 耽美で少し芝居がかった、祈るように見守るキャラ
 *
 * 名前は架空のもの。**実在の人の名前・所属を書かない** (肖像やなりすましの扱いになる)。
 * key は自分の設定 (oshi.char / oshi.fallback) に残るので変えない。
 *
 * @returns {Array<{key: string, name: string, tone: string}>}
 */
function OSHI_BUILTINS() {
  return [
    { key: 'taku', name: 'タク', tone: 'buddy' },
    { key: 'itsuki', name: 'イツキ', tone: 'gothic' },
  ];
}

/**
 * @param {string} key
 * @returns {{key: string, name: string, tone: string}|null}
 */
function oshiBuiltinOf(key) {
  var list = OSHI_BUILTINS();
  for (var i = 0; i < list.length; i++) if (list[i].key === String(key)) return list[i];
  return null;
}

/**
 * 自分のキャラの上限 (1人あたり)。
 *
 * @returns {number}
 */
function OSHI_MINE_MAX() {
  return 5;
}

/**
 * 使うキャラの名指しを読む。'builtin:<key>' (最初からいるキャラ) か 'mine:<番号>' (自分のキャラ)。
 * 形だけを見る (自分のキャラが本当にあるかは OshiStore.gs が見る)。
 *
 * @param {*} v
 * @returns {{kind: string, key: string, id: number}|null} 読めなければ null
 */
function oshiCharParse(v) {
  var s = String(v == null ? '' : v);
  var m = /^builtin:([a-z]+)$/.exec(s);
  if (m) return oshiBuiltinOf(m[1]) ? { kind: 'builtin', key: m[1], id: 0 } : null;
  m = /^mine:([1-9][0-9]{0,5})$/.exec(s);
  if (m) return { kind: 'mine', key: '', id: Number(m[1]) };
  return null;
}

/**
 * 既定のキャラの絵の形。key は自分の設定 oshi.style に残るので変えない。
 * 並びは設定の選び方の並び。
 *
 * @returns {Array<{key: string, label: string}>}
 */
function OSHI_STYLES() {
  return [
    { key: 'chibi', label: '2頭身' },
    { key: 'normal', label: '等身' },
  ];
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function oshiStyleKnown(key) {
  return OSHI_STYLES().some(function (s) { return s.key === String(key); });
}

/**
 * 場面。どの表情で、どのせりふを出すか。key は台帳 (oshi.lines) に残るので変えない。
 * praise が true の場面だけ、まれに「思いがけない当たり」(lucky) に変わる。
 *
 * @returns {Array<{key: string, label: string, state: string, praise?: boolean}>}
 */
function OSHI_EVENTS() {
  return [
    { key: 'done', label: 'やることを済ませた', state: 'celebrate', praise: true },
    { key: 'merge', label: '反映した', state: 'celebrate', praise: true },
    { key: 'approve', label: '承認した', state: 'praise', praise: true },
    { key: 'ask', label: '確認を頼んだ', state: 'cheer', praise: true },
    { key: 'save', label: '記録した・保存した', state: 'praise', praise: true },
    { key: 'start', label: '始めた', state: 'cheer', praise: true },
    { key: 'back', label: '久しぶりに開いた', state: 'praise' },
    { key: 'morning', label: '朝のあいさつ', state: 'idle' },
    { key: 'day', label: '昼のあいさつ', state: 'idle' },
    { key: 'night', label: '夜のあいさつ', state: 'sleepy' },
    { key: 'oops', label: 'うまくいかなかった', state: 'worry' },
    { key: 'lucky', label: '思いがけない当たり', state: 'surprise' },
    // 使うキャラに選ばれたとき。どんなキャラか分かるように、その口調で礼を言う。表情は出すときに
    // そのキャラの絵からでたらめに選ぶ (randomState)。state は絵を選べないときの控え
    { key: 'chosen', label: '選んでもらった', state: 'idle', randomState: true },
    // 実績 (src/core/Achievements.js) を取ったとき。段が上がったときは levelup を出し、表情は上がった段の絵
    // (画面が段の key を表情として渡す)。state は段が分からないときの控え
    { key: 'badge', label: '実績を取った', state: 'celebrate' },
    { key: 'levelup', label: '育ちの段が上がった', state: 'celebrate' },
    // 実績を全部取った (クリア)。推しの頁の「クリア」の節で、キャラのお祝いの言葉 (プロフィールの clearLine) が無いときに言う
    { key: 'clear', label: '実績を全部取った', state: 'celebrate' },
    // 推しの機嫌 (自分の設定 oshi.mood がオンのときだけ。OSHI_MOOD_RULES)。表情とせりふが変わるだけで、何も取り上げない
    { key: 'mood_sulky', label: '機嫌: しょんぼり', state: 'worry', mood: true },
    { key: 'mood_pouty', label: '機嫌: むっ', state: 'pout', mood: true },
    { key: 'mood_recover', label: '機嫌が直った', state: 'celebrate', mood: true },
  ];
}

/** ほめる場面がこの回数に1回、「思いがけない当たり」になる */
function OSHI_LUCKY_ONE_IN() {
  return 12;
}

/**
 * せりふ。**唯一の表。** [口調][場面] にいくつか並べ、画面が順に回す。
 * 叱る言葉・連続を求める言葉は入れない。利用者は場面ごとに自分のせりふを足せる (oshi.lines)。
 *
 * @returns {Object<string, Object<string, string[]>>}
 */
function OSHI_LINES() {
  return {
    polite: {
      done: ['お疲れさまでした。ひとつ片づきましたね', '済ませてくださってありがとうございます', 'きちんと終えられましたね。さすがです'],
      merge: ['反映、おめでとうございます', '正式版に入りましたね。お見事です', '大きな一歩でしたね。お疲れさまでした'],
      approve: ['確認してくださってありがとうございます', '丁寧に見ていただけて、心強いです', '承認、たしかに届きました'],
      ask: ['確認を頼みましたね。返事を一緒に待ちましょう', 'ここまで進めたのは立派です', '送り出せましたね。ひと息つきましょう'],
      save: ['記録しました。安心ですね', 'こまめに残せていて素敵です', '今の形をしっかり残せました'],
      start: ['始めましたね。応援しています', '最初の一歩がいちばん大事です', 'いい始まりです。無理せずいきましょう'],
      back: ['お久しぶりです。また会えてうれしいです', 'おかえりなさい。待っていました', 'お元気でしたか。ゆっくり再開しましょう'],
      morning: ['おはようございます。今日もよろしくお願いします', 'おはようございます。まずはひとつからどうぞ', '朝の時間、気持ちがいいですね'],
      day: ['こんにちは。順調ですか', 'お昼はとれましたか。ひと休みも大事です', 'こんにちは。今日も見守っています'],
      night: ['遅くまでお疲れさまです。そろそろ休みませんか', '今日はもう十分がんばりました', '続きは明日でも大丈夫です'],
      oops: ['うまくいかなかったようです。少し待ってもう一度どうぞ', '大丈夫です。あわてなくていいですよ', '止められてしまいましたね。理由を一緒に見てみましょう'],
      lucky: ['まあ、いいことがありそうな予感です', 'なんと、今日は当たりの日かもしれません', 'びっくりしました。素敵な一日になりますように'],
      chosen: ['選んでくださってありがとうございます。これからよろしくお願いします', 'お声がけいただけてうれしいです。そっと見守りますね',
        'ご一緒できて光栄です。無理のない歩幅でまいりましょう'],
      badge: ['実績を取りましたね。おめでとうございます', '新しい実績です。積み重ねが形になりましたね', 'ひとつ増えましたね。わたしもうれしいです'],
      levelup: ['おかげさまで、ひと回り成長できました', '新しい段になりました。いつもありがとうございます', 'ここまで一緒に来られて光栄です'],
      clear: ['実績を全部集められましたね。本当におめでとうございます', 'ここまでの積み重ね、すべて見ていました。お見事です', 'ご一緒できて光栄でした。これからもそばにいますね'],
      mood_sulky: ['期限を少し過ぎたものがありますね。ひとつだけ一緒に片づけてみませんか', 'しばらく動いていないものがあるようです。まずは小さいものからどうでしょう',
        '少しさみしいです…。5分だけ、ひとつ進めてみませんか'],
      mood_pouty: ['むぅ…やることがたまってきました。期限の近いものをひとつだけ選んでみませんか', 'ちょっとだけ、むっとしています。いちばん小さいものから始めてみましょう',
        'ほっぺがふくらんでしまいました。ひとつ片づけたら、すぐ戻りますよ'],
      mood_recover: ['片づきましたね。すっかりごきげんです', 'ありがとうございます。気持ちが晴れました', 'ほっとしました。この調子でまいりましょう'],
    },
    genki: {
      done: ['やったー！ひとつクリア！', 'すごいすごい！片づいたね！', 'ナイス完了！その調子！'],
      merge: ['反映おめでとー！！', 'ついに正式版だ！やったね！', 'ばんざーい！おつかれさま！'],
      approve: ['承認ありがとー！たのもしい！', 'しっかり見てくれてうれしい！', 'ナイス確認！'],
      ask: ['確認お願いできたね！えらい！', 'いってらっしゃーい！返事が楽しみ！', 'ここまでがんばったね！'],
      save: ['記録したよ！ばっちり！', 'こまめに残せてえらい！', '保存完了！'],
      start: ['よーし、いってみよう！', 'はじまりだ！応援してるよ！', 'はじめの一歩、かっこいい！'],
      back: ['わーい、ひさしぶり！会いたかった！', 'おかえり！待ってたよ！', 'また来てくれてうれしい！'],
      morning: ['おはよー！今日もがんばろ！', 'おはよう！いい朝だね！', 'おはよ！まずはひとつからね！'],
      day: ['やっほー！調子どう？', 'お昼ごはん食べた？', 'こんにちは！見てるよー！'],
      night: ['もう夜だよ〜、そろそろ休も？', '今日もいっぱいがんばったね！', 'ふぁ〜、ねむくなってきちゃった'],
      oops: ['あれれ、うまくいかなかったみたい。もう一回やってみよ！', 'だいじょうぶ、次はいけるよ！', 'ドンマイ！ちょっと待ってからね'],
      lucky: ['わっ、なんかいいことありそう！', 'えっ、すごい！当たりかも！', 'びっくり！今日はついてるね！'],
      chosen: ['えっ、選んでくれたの！？ありがとう！いっしょにがんばろうね！', 'やったー！今日からよろしくね！', 'うれしい！どんどん応援しちゃうよ！'],
      badge: ['実績ゲット！やったね！', '新しいバッジだー！すごい！', 'またひとつ増えたね！かっこいい！'],
      levelup: ['ぐーんと成長しちゃった！ありがとー！', 'レベルアップ！いっしょに大きくなれたね！', 'わーい、新しい姿だよ！見て見て！'],
      clear: ['ぜんぶ集めちゃった！ほんとにすごい！', 'コンプリートだー！おめでとう！！', 'ここまでいっしょに来られてうれしい！ありがとう！'],
      mood_sulky: ['期限、ちょっと過ぎちゃってるよ…一個だけ片付けてみない？', 'しょんぼり…。いちばん小さいのから、いっしょにやろ！', 'ねえねえ、5分だけ進めてみない？'],
      mood_pouty: ['むーっ！たまってきちゃったよ。一個だけ選んでみよ？', 'ぷんぷん！…なんてね。いちばん小さいのからいこ！', 'ほっぺふくらんじゃった。一個片づけたらすぐ笑顔になるよ！'],
      mood_recover: ['やったー！ごきげん復活！', 'わーい、すっきりしたね！ありがとう！', 'にこにこに戻ったよ！その調子！'],
    },
    cool: {
      done: ['片づいたな。悪くない', '終わらせたか。上出来だ', '一つ完了。次も頼む'],
      merge: ['反映、確かめた。見事だ', '正式版に入ったな。よくやった', 'やりきったな。誇っていい'],
      approve: ['確認、助かる', 'いい目をしている', '承認、受け取った'],
      ask: ['確認を頼んだか。いい判断だ', 'あとは返事を待てばいい', 'ここまで来たな'],
      save: ['記録した。抜かりないな', '残しておくのは大事だ', '保存済みだ'],
      start: ['始めたか。いける', '行こう。付き合う', '焦らなくていい。一歩ずつだ'],
      back: ['久しぶりだな。待っていた', '戻ったか。おかえり', '元気そうで何よりだ'],
      morning: ['おはよう。今日も頼む', '朝か。いい顔をしている', 'おはよう。まず一つ片づけよう'],
      day: ['調子はどうだ', '休むのも仕事のうちだ', '順調そうだな'],
      night: ['もう遅い。休め', '今日はここまでにしよう', '無理はするな。明日がある'],
      oops: ['うまくいかなかったか。少し待って、もう一度だ', '気にするな。よくあることだ', '落ち着いていこう'],
      lucky: ['……驚いた。今日はついている', 'ほう、これは珍しい', '思わぬ当たりだな'],
      chosen: ['……選んだのか。悪くない判断だ', '任された。静かに見ている', 'よろしく。必要なときだけ声をかける'],
      badge: ['実績か。積み上げた証だな', '一つ増えたな。悪くない', '確かに受け取った。見事だ'],
      levelup: ['……段が上がった。お前のおかげだ', '少し強くなれた気がする', '新しい段だ。これからも付き合う'],
      clear: ['……全部集めたか。見事だ', '最後まで付き合えてよかった', '大したものだ。誇っていい'],
      mood_sulky: ['期限を過ぎたものがある。一つだけ片づけないか', '少し、気がかりだ。小さいものから行こう', '五分だけでいい。一つ進めよう'],
      mood_pouty: ['……むっ。溜まってきたな。いちばん小さいものを一つ選ぼう', '少し不機嫌だ。一つ片づけてくれれば戻る', '……放っておかれた気分だ。一つだけ付き合ってくれ'],
      mood_recover: ['……戻った。悪くない', '片づいたな。機嫌は直った', '上出来だ。気分がいい'],
    },
    kansai: {
      done: ['やったやん！ひとつ片づいたで', 'さすがやなぁ、ええ仕事や', 'おつかれさん！ばっちりや'],
      merge: ['反映おめでとさん！', '正式版入りや！やるやん！', 'よっしゃ、決まったな！'],
      approve: ['確認おおきに！助かるわぁ', 'ちゃんと見てくれてありがとうな', '承認、たしかに受け取ったで'],
      ask: ['確認頼んだんやな、えらいで', '返事来るまでちょっと一服しよか', 'ここまでよう来たなぁ'],
      save: ['記録しといたで！安心や', 'こまめに残すん、ええことや', '保存ばっちりや'],
      start: ['ほな、いこか！', '始めたんやな、応援してるで', 'まずは一歩や、いけるいける'],
      back: ['久しぶりやん！元気しとった？', 'おかえり！待っとったで', 'また来てくれてうれしいわぁ'],
      morning: ['おはようさん！今日もいこか', 'おはよう！ええ一日になるとええな', 'おはよ！ぼちぼちいこな'],
      day: ['調子どない？', 'お昼食べたか？', 'ちょっと休憩しよか'],
      night: ['もう遅いで、そろそろ寝よか', '今日はようがんばったなぁ', '続きは明日でええやん'],
      oops: ['あらら、あかんかったみたいや。もっぺんやってみよ', '気にせんでええよ', 'ちょっと待ってからいこか'],
      lucky: ['えっ、なんかええことありそうやん！', 'びっくりや！今日はツイてるで', 'うわ、当たりや！'],
      chosen: ['選んでくれたん？おおきに！これからよろしゅうな', 'うれしいわぁ。ほな、一緒にぼちぼちいこか', 'よっしゃ、まかしとき！ちゃんと見とるで'],
      badge: ['実績取ったやん！さすがや', 'またひとつ増えたなぁ、ええ感じや', 'おめでとさん！コツコツが効いとるで'],
      levelup: ['段が上がったで！おおきにな', 'ひと回り大きなったわ、ありがとうな', '見てみ、新しい姿や！'],
      clear: ['全部集めたん！？ほんまにすごいわ！', 'おめでとさん！ようここまで来たなぁ', 'ずっと見とったで。ほんまおおきにな'],
      mood_sulky: ['期限ちょっと過ぎとるで…ひとつだけ片づけてみよか', 'しょんぼりやわ。ちっこいのから一緒にいこ', '5分だけでええから、ひとつ進めてみいひん？'],
      mood_pouty: ['むぅ、たまってきとるやん。ひとつだけ選んでみよか', 'ちょっとぷんぷんやで。…ちっこいのからでええよ', 'ほっぺふくれてもうたわ。ひとつ片づけたらすぐ戻るで'],
      mood_recover: ['よっしゃ、ごきげん復活や！', 'すっきりしたなぁ、おおきに！', 'ええ顔に戻ったで！'],
    },
    butler: {
      done: ['お見事でございます。一件、片づきました', 'お疲れさまでございました', '滞りなく済まされましたね'],
      merge: ['反映、まことにおめでとうございます', '正式版へのお取り込み、拝見いたしました', '見事なお仕事でございます'],
      approve: ['ご確認、恐れ入ります', '丁寧なお目通し、感服いたしました', '承認、確かに承りました'],
      ask: ['確認のご依頼、お送りいたしました', 'お返事が届くまで、お茶でもいかがでしょう', 'ここまでのお働き、頭が下がります'],
      save: ['記録いたしました。ご安心ください', 'こまめなお記録、さすがでございます', '確かにお預かりいたしました'],
      start: ['お始めになりましたね。お供いたします', '良い滑り出しでございます', 'どうぞご無理なさいませんよう'],
      back: ['お帰りなさいませ。お待ち申し上げておりました', 'お久しゅうございます', 'またお目にかかれて光栄です'],
      morning: ['おはようございます。本日もお供いたします', 'おはようございます。よいお目覚めでしょうか', 'おはようございます。まずは一件から参りましょう'],
      day: ['ご機嫌いかがでございますか', 'お昼のご休憩もお忘れなく', '本日も順調でございますね'],
      night: ['夜も更けてまいりました。お休みになられては', '本日はもう十分にお働きになりました', '続きは明日にいたしましょう'],
      oops: ['うまく参りませんでしたか。少しお待ちになって、今一度どうぞ', 'ご心配なく。よくあることでございます', '落ち着いて参りましょう'],
      lucky: ['これは、思いがけぬ吉兆でございます', 'なんと、驚きました', '本日は良き日のようでございます'],
      chosen: ['お選びいただき、光栄の至りでございます', '本日より、お側にお仕えいたします', 'なんなりとお申し付けくださいませ'],
      badge: ['実績のご獲得、まことにおめでとうございます', '新たな勲章でございますね。お見事です', '積み重ねが実を結びましたね'],
      levelup: ['お陰さまで、一段と成長いたしました', '新たな段に上がりました。今後ともお供いたします', '身に余る光栄でございます'],
      clear: ['すべての実績のご獲得、まことにおめでとうございます', 'ここまでお供できましたこと、身に余る光栄でございます', '見事な積み重ねでございました'],
      mood_sulky: ['期限を少々過ぎたものがございます。一件だけ、お片づけなさいませんか', '少々気がかりでございます。小さなものから参りましょう',
        '五分ほど、一件だけ進めてみてはいかがでしょう'],
      mood_pouty: ['恐れながら、少々むっとしております。いちばん小さな一件からいかがでしょう', 'やることが積もってまいりました。一件だけお選びくださいませ',
        '一件片づけていただければ、すぐに機嫌は戻ります'],
      mood_recover: ['お見事でございます。すっかり晴れやかな気分です', '恐れ入ります。おかげさまで機嫌が直りました', 'ほっといたしました。この調子で参りましょう'],
    },
    // 耽美 (最初からいるキャラの口調)。一人称は「俺」、敬語を使わず、語尾は「〜なのだ、、」。
    // 祈り・月光・薔薇・啓示・来世・古き良きもの を軽い飾りに使う。説教・恋愛の押しつけはしない
    gothic: {
      done: ['よくやったのだ、、その祈り、確かに届いたのだ、、', 'ひとつ片づいたのだ、、月光も祝福しているはずなのだ、、',
        'さすがなのだ、、俺はちゃんと見ていたのだ、、', '終わらせたのだな、、薔薇を一輪、贈りたい気分なのだ、、'],
      merge: ['正式版に刻まれたのだ、、これはもう啓示なのだ、、', '反映おめでとうなのだ、、古き良きものに、新しい頁が加わったのだ、、',
        '大きな祈りが実ったのだ、、今宵は祝福の夜なのだ、、'],
      approve: ['確かめてくれたのだな、、その眼差し、頼もしいかぎりなのだ、、', '承認、受け取ったのだ、、慈悲深い判断なのだ、、',
        'ありがたいことなのだ、、丁寧に見てくれたのだ、、'],
      ask: ['確認を頼んだのだな、、あとは祈りながら待つだけなのだ、、', '送り出したのだ、、返事が届くまで、ひと息つく時間なのだ、、',
        'ここまで来たのだ、、俺も最後まで見届けるつもりなのだ、、'],
      save: ['記録したのだ、、これで来世まで残るはずなのだ、、ニヤッ', 'こまめに残すのは、古き良き習わしなのだ、、',
        '今の形、しかと刻んだのだ、、もう安心なのだ、、'],
      start: ['始めるのだな、、俺も見届けるのだ、、', '最初の一歩なのだ、、月が道を照らしているのだ、、',
        '幕が上がるのだ、、焦らずいけば大丈夫なのだ、、'],
      back: ['久しぶりなのだ、、また会えると祈っていたのだ、、', 'おかえりなのだ、、ずっと待っていたのだ、、ニヤッ',
        '戻ってきたのだな、、ゆっくり再開すればいいのだ、、'],
      morning: ['おはようなのだ、、朝の光も悪くないのだ、、', 'おはようなのだ、、今日もひとつずつ祈りを重ねるのだ、、',
        '目覚めたのだな、、まずはひとつからで十分なのだ、、'],
      day: ['ごきげんようなのだ、、調子はどうなのだ、、', '昼下がりなのだ、、紅茶でひと休みするのも悪くないのだ、、',
        '順調そうなのだ、、俺はここで見守っているのだ、、'],
      night: ['夜更けなのだ、、そろそろ休むのも祈りのうちなのだ、、', '月も眠そうなのだ、、今日はもう十分がんばったのだ、、',
        '続きは明日でいいのだ、、良い夢を見るのだ、、'],
      oops: ['うまくいかなかったのだな、、大丈夫、少し待ってもう一度なのだ、、', '気にしなくていいのだ、、こういう日もあるものなのだ、、',
        '止められてしまったのだ、、理由を一緒に見てみるのだ、、'],
      lucky: ['なんと、、これは啓示なのだ、、！', '思いがけない当たりなのだ、、神さまのいたずらなのだ、、ニヤッ',
        '驚いたのだ、、今日は特別な日になる予感なのだ、、'],
      chosen: ['選んでくれたのだな、、この出会いも祈りのうちなのだ、、', '俺を呼んだのだな、、ならば最後まで見守るのだ、、',
        'これは運命なのだ、、共に歩むのだ、、'],
      badge: ['実績を手にしたのだな、、その祈り、確かに刻まれたのだ、、', '新しい印なのだ、、月光も見ているのだ、、ニヤッ',
        'ひとつ増えたのだ、、積み重ねは古き良きものなのだ、、'],
      levelup: ['段が上がったのだ、、これはもう啓示なのだ、、', '俺も少し大きくなったのだ、、共に歩んだからなのだ、、',
        '新しい姿なのだ、、薔薇を一輪、贈りたい気分なのだ、、'],
      clear: ['すべてを集めたのだな、、これはもう伝説なのだ、、', '最後まで見届けたのだ、、月光も祝福しているのだ、、',
        '共に歩めて光栄なのだ、、薔薇の花束を贈りたいのだ、、'],
      mood_sulky: ['期限を少し過ぎたものがあるのだ、、ひとつだけ一緒に片づけるのだ、、', '月が少し陰っているのだ、、小さなものからひとつ進めるのだ、、',
        'しょんぼりなのだ、、五分だけ、ひとつ触れてみるのだ、、'],
      mood_pouty: ['むっ、、やることが積もってきたのだ、、いちばん小さなものひとつで十分なのだ、、', '少し拗ねているのだ、、ひとつ片づけてくれたら機嫌は戻るのだ、、',
        '薔薇が少ししおれてしまったのだ、、ひとつだけ水をやるのだ、、'],
      mood_recover: ['機嫌が戻ったのだ、、月光も晴れやかなのだ、、', '片づけてくれたのだな、、これは啓示なのだ、、ニヤッ', 'ほっとしたのだ、、薔薇がまた咲いたのだ、、'],
    },
    // 明るい相棒 (最初からいるキャラ「タク」の口調)。一人称は「僕」、です・ます にくだけた言い方を混ぜる。
    // 面倒は道具に任せて余白を作る・小さく試す・まず出してみる・コーヒー・ひらめき を軽い飾りに使う。
    // 「笑」「ドヤッ」はときどきだけ。急かさない・叱らない
    buddy: {
      done: ['ナイスです！その一歩で余白が生まれました🙌', 'ひとつ片づきましたね。この調子でいきましょう！',
        '完了、おつかれさまです！小さく終わらせるの、最高です', 'やりましたね！次の面倒なところは道具に任せちゃいましょう笑'],
      merge: ['正式版に入りましたね！みんなの余白が増えました🙌', '反映おめでとうございます！これはドヤッていいやつです笑',
        '大きいのが決まりましたね。コーヒーで乾杯しましょう☕'],
      approve: ['確認ありがとうございます！人の目がいちばん頼りになります', 'ナイス承認です。これで安心して前に進めますね',
        'しっかり見てくれて助かります🙌'],
      ask: ['確認をお願いできましたね！返事を待つあいだにコーヒーでもどうですか☕', 'まず出してみる、いい判断です！',
        '送り出せましたね。待っているあいだの下ごしらえは道具に任せましょう'],
      save: ['記録しました！こまめに残すの、えらいです', '保存ばっちりです。これで安心して試せますね',
        'いまの形、ちゃんと残せました💡'],
      start: ['始めましたね！まずは小さく試してみましょう💡', '面倒なところは道具に任せて、いちばん大事なところに集中しましょう',
        'よし、いきましょう！僕も一緒に考えます'],
      back: ['お久しぶりです！また会えてうれしいです🙌', 'おかえりなさい！ゆっくり再開しましょう',
        '待ってました！まずはひとつ、軽めのやつからいきましょう笑'],
      morning: ['おはようございます！今日はどんな実験をしましょうか💡', 'おはようございます。コーヒー片手に、まずはひとつからいきましょう☕',
        'おはようございます！面倒なところは道具に任せて、今日も余白を作りましょう'],
      day: ['こんにちは！調子どうですか？', 'お昼はとれました？休むのも大事な仕事です',
        'いい感じですね。ひらめいたら、まずは小さく試しましょう💡'],
      night: ['夜ですね。続きは道具に下ごしらえしてもらって、今日はここまでにしませんか？笑',
        '今日もおつかれさまでした！寝ている間は道具にがんばってもらいましょう', 'もう遅い時間です。続きは明日の僕らに任せましょう'],
      oops: ['あれ、うまくいかなかったみたいです。少し待ってもう一回やってみましょう', '大丈夫です！実験にはつまずきもつきものです笑',
        '止められちゃいましたね。理由を一緒に見てみましょう'],
      lucky: ['おっ、これは当たりです！今日はいい日になりそうですね💡', 'えっ、すごい！思わぬラッキーです🙌',
        'びっくりしました！これはドヤッていいやつです笑'],
      chosen: ['選んでくれてありがとうございます！一緒に余白を作っていきましょう🙌', 'よろしくお願いします！面倒なところは道具に任せちゃいましょう笑',
        'お、僕ですね！まずは小さく試すところから、一緒にいきましょう💡'],
      badge: ['実績ゲットです！小さな積み重ねが効いてますね🙌', '新しいバッジです！これはドヤッていいやつです笑',
        'またひとつ増えましたね。次の面倒なところは道具に任せましょう💡'],
      levelup: ['段が上がりました！一緒に余白を作ってきた成果です🙌', '僕も少し成長しました。コーヒーで乾杯しましょう☕',
        '新しい姿になれました！ここからも小さく試していきましょう💡'],
      clear: ['全部集めましたね！最高の余白を作れました🙌', 'コンプリートです！これはドヤッていいやつです笑',
        'ここまで一緒に来られてうれしいです。コーヒーで乾杯しましょう☕'],
      mood_sulky: ['期限、ちょっと過ぎちゃってますね…一個だけ片付けてみませんか？', 'しばらく動いていないのがありますね。まずは小さく、5分だけ試しましょう💡',
        '僕、ちょっとしょんぼりです。軽めのやつをひとつだけいきましょう'],
      mood_pouty: ['むっ…たまってきちゃいましたね。いちばん小さいのを一個だけ選びましょう', 'ほっぺがふくらんでます笑 ひとつ片づけたらすぐ戻りますよ',
        '面倒なところは道具に任せて、一個だけ一緒に片づけましょう'],
      mood_recover: ['ごきげん復活です！片づけてくれてありがとうございます🙌', 'すっきりしましたね！コーヒーで乾杯しましょう☕', 'よかった、いつもの僕に戻りました笑'],
    },
  };
}

/**
 * 画像を作る道具に、最初に1回だけ渡す頼み文。参考画像と一緒に渡す。
 *
 * @returns {string}
 */
function OSHI_PROMPT_BASE() {
  return [
    'これから、添付した参考画像のキャラクターで、表情ちがいの画像を何枚か作ってもらいます。',
    'まず、このキャラクターの特徴 (顔立ち・髪型・髪の色・目の色・服装・小物・配色・画風) を箇条書きで書き出してください。',
    '以降の画像は、すべてこの特徴と画風に合わせ、同じキャラクターだと一目で分かるようにしてください。',
    'まだ画像は作らなくてかまいません。',
  ].concat(OSHI_PROMPT_RULES()).join('\n');
}

/**
 * どの頼み文にも付ける決まり。同じキャラクターのまま、番頭の隅に出せる形で作ってもらう。
 *
 * @returns {string[]}
 */
function OSHI_PROMPT_RULES() {
  return [
    '決まり:',
    '- 参考画像と同じキャラクター (同じ顔立ち・髪型・髪の色・目の色・服装・配色) で描く',
    '- 正方形 (縦横 1:1) の PNG。背景は透明。透明にできなければ、白一色の無地',
    '- 胸から上 (上半身)。キャラクターを真ん中に大きく',
    '- 表情がはっきり分かるように',
    '- 画像の中に文字・吹き出し・ロゴ・署名を入れない',
    '- 職場で見せて困らない、健全な表現にする (肌の露出・暴力・流血を描かない)',
    '- 画風・線の太さ・塗り方は、これまでの画像とそろえる',
  ];
}

/**
 * 表情ごとの頼み文。OSHI_PROMPT_BASE を渡した同じ会話で、1枚ずつ頼む。
 *
 * @param {string} key OSHI_STATES の key
 * @returns {string} 知らない key なら空
 */
function oshiPrompt(key) {
  var s = oshiStateOf(key);
  if (!s) return '';
  return [
    '同じキャラクターで、「' + s.label + '」の画像を1枚作ってください。',
    '表情としぐさ: ' + s.pose + '。',
  ].concat(OSHI_PROMPT_RULES()).join('\n');
}

/**
 * @param {string} key
 * @returns {object|null}
 */
function oshiStateOf(key) {
  var list = OSHI_STATES();
  for (var i = 0; i < list.length; i++) if (list[i].key === String(key)) return list[i];
  return null;
}

/**
 * @param {string} key
 * @returns {object|null}
 */
function oshiEventOf(key) {
  var list = OSHI_EVENTS();
  for (var i = 0; i < list.length; i++) if (list[i].key === String(key)) return list[i];
  return null;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function oshiToneKnown(key) {
  return OSHI_TONES().some(function (t) { return t.key === String(key); });
}

/**
 * 上げられる画像の上限。画面はこの値で縮め、サーバはこの値で断る。
 * 1枚1MBまで (台帳ではなく objects/ に置く)、縮めるのは長い辺 512px まで。
 *
 * @returns {{maxBytes: number, maxPx: number, mimes: Object<string, string>}}
 */
function OSHI_IMAGE_LIMITS() {
  return {
    maxBytes: 1024 * 1024,
    maxPx: 512,
    mimes: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' },
  };
}

/**
 * 名前とせりふの上限。せりふは場面ごとに数と長さを絞る (台帳の1つのセルに入れるため)。
 *
 * @returns {{nameMax: number, lineMax: number, linesPerEvent: number}}
 */
function OSHI_TEXT_LIMITS() {
  return { nameMax: 20, lineMax: 60, linesPerEvent: 10 };
}

/**
 * プロフィールの上限。項目は Lv (lvMin〜lvMax) で少しずつ分かる。Lv1 は誰でもなので、いちばん早くて Lv2。
 * 検査するのはサーバの oshiProfileValid_ (OshiStore.gs) だけで、画面はこの値で欄の説明を出す。
 *
 * @returns {{itemsMax: number, labelMax: number, textMax: number, lvMin: number, lvMax: number, clearLineMax: number}}
 */
function OSHI_PROFILE_LIMITS() {
  return { itemsMax: 40, labelMax: 20, textMax: 200, lvMin: 2, lvMax: 99, clearLineMax: 200 };
}

/**
 * プロフィールのどこまでを見せるか。Lv の小さい順 (同じ Lv は書いた順) に並べ、Lv が届いた項目
 * (クリアしたなら全部) だけ名前と中身を入れる。**届いていない項目は名前も中身も入れない** (Lv だけ)。
 *
 * @param {Array<{lv: number, label: string, text: string}>} items 検査を通した項目
 * @param {number} level いまの Lv
 * @param {boolean} cleared 実績を全部取ったか
 * @returns {Array<{lv: number, open: boolean, label: string, text: string}>}
 */
function oshiProfileReveal(items, level, cleared) {
  var lv = Math.max(1, Math.floor(Number(level) || 1));
  return (items || []).map(function (it, i) { return { it: it, i: i }; })
    .sort(function (a, b) { return a.it.lv - b.it.lv || a.i - b.i; })
    .map(function (x) {
      var open = !!cleared || x.it.lv <= lv;
      return { lv: x.it.lv, open: open, label: open ? x.it.label : '', text: open ? x.it.text : '' };
    });
}

/**
 * 育ちの段。**レベル (Lv) から段を決める唯一の表。** key は表情の key と同じ (その段の絵)。min はその段に届く Lv。
 * Lv は 1 + 取った実績の数 (achLevelOf。src/core/Achievements.js)。取った実績は消さないので、段も下がらない。
 *
 * @returns {Array<{key: string, label: string, min: number}>}
 */
function OSHI_STAGES() {
  return [
    { key: 'grow1', label: '見習い', min: 1 },
    { key: 'grow2', label: '一人前', min: 5 },
    { key: 'grow3', label: '名人', min: 15 },
  ];
}

/**
 * Lv から育ちの段を決める。なかよし (meter) はいまの段から次の段までの進み (0〜100)、toNext は次の段までの Lv。
 * 最後の段では meter 100・toNext 0。
 *
 * floor は前に届いていた段 (0 から。実績の前は育ちの最高の段を OSHI_STAGE_MAX: に覚えていた)。それより下には出さない。
 *
 * @param {number} level 1 から
 * @param {number} [floor] これより下の段にしない
 * @returns {{index: number, key: string, label: string, meter: number, toNext: number, level: number}}
 */
function oshiStageOf(level, floor) {
  var list = OSHI_STAGES();
  var lv = Math.max(1, Math.floor(Number(level) || 1));
  var i = 0;
  while (i + 1 < list.length && lv >= list[i + 1].min) i++;
  var f = Math.floor(Number(floor) || 0);
  if (f > i) i = Math.min(f, list.length - 1);
  var meter = 100;
  var toNext = 0;
  if (i + 1 < list.length) {
    var from = list[i].min;
    var span = list[i + 1].min - from;
    meter = Math.max(0, Math.min(100, Math.floor((lv - from) / span * 100)));
    toNext = Math.max(0, list[i + 1].min - lv);
  }
  return { index: i, key: list[i].key, label: list[i].label, meter: meter, toNext: toNext, level: lv };
}

/**
 * 時刻からあいさつの場面を決める (東京の時刻)。5〜11時は朝、11〜18時は昼、それ以外は夜。
 *
 * @param {number} hour 0〜23
 * @returns {string} morning / day / night
 */
function oshiGreetingOf(hour) {
  var h = Number(hour);
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 18) return 'day';
  return 'night';
}

/**
 * 自分のせりふを整える。空行を落とし、前後の空白を取り、同じものを1つにする。
 * 上限を超えたら断る (黙って切ると、書いたものが消える)。
 *
 * @param {*} lines
 * @returns {string[]}
 */
function oshiCleanLines(lines) {
  var lim = OSHI_TEXT_LIMITS();
  var list = Array.isArray(lines) ? lines : String(lines == null ? '' : lines).split('\n');
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var one = String(list[i] == null ? '' : list[i]).replace(/^\s+|\s+$/g, '');
    if (!one || seen[one]) continue;
    if (one.length > lim.lineMax) throw new Error('せりふは1つ' + lim.lineMax + '字までにしてください');
    seen[one] = true;
    out.push(one);
  }
  if (out.length > lim.linesPerEvent) {
    throw new Error('せりふは1つの場面に' + lim.linesPerEvent + '個までにしてください');
  }
  return out;
}

// ----- 推しの機嫌 (自分の設定 oshi.mood。既定はオフ) -----
//
// やることが滞ると、推しがしょんぼりしたり、むっとしたりする。**変わるのは表情とせりふだけ。** Lv・実績・ポイント・
// 当たり・プロフィール・クリアは何も取り上げない。知らせもメールも出さず、本人のほかには誰にも (上長にも) 見せない。
// 済ませたり、わけが無くなったりしたら、すぐに機嫌は直る。数えるのはサーバの oshiMood_ (OshiMood.gs)。

/**
 * 機嫌の段。良い順。event は出すせりふの場面、state は表情 (絵が無ければ OSHI_STATES の fallback)。
 *
 * @returns {Array<{key: string, label: string, event: string, state: string}>}
 */
function OSHI_MOODS() {
  return [
    { key: 'happy', label: 'ごきげん', event: '', state: 'celebrate' },
    { key: 'normal', label: 'ふつう', event: '', state: 'idle' },
    { key: 'sulky', label: 'しょんぼり', event: 'mood_sulky', state: 'worry' },
    { key: 'pouty', label: 'むっ', event: 'mood_pouty', state: 'pout' },
  ];
}

/**
 * 機嫌の決め方。**唯一の定義。** どのわけも、数が sulky 以上でしょんぼり、pouty 以上でむっ。いちばん悪いものに合わせる。
 *
 * - overdue: 期限 (東京の暦日) が今日より前の、開いているやることの件数
 * - stale: 動きの無い (チームの設定 stale.steps の最初の段の日数より長く、そのまま) 開いているやることの件数
 * - idle: 最後に済ませてからの日数。開いているやることがあるときだけ見る。一度も済ませていなければ見ない
 * - happyDays: 最後に済ませてからこの日数までで、どのわけも無ければ「ごきげん」(0 = 今日、1 = 昨日まで)
 * - cacheSeconds: 1人ぶんを覚えておく長さ。済ませた・閉じた・直したときは、待たずに数え直す
 *
 * 開いているやることが1つも無い人は「ふつう」より下にしない。
 *
 * @returns {{overdue: {sulky: number, pouty: number}, stale: {sulky: number, pouty: number},
 *   idle: {sulky: number, pouty: number}, happyDays: number, cacheSeconds: number}}
 */
function OSHI_MOOD_RULES() {
  return {
    overdue: { sulky: 1, pouty: 3 },
    stale: { sulky: 3, pouty: 6 },
    idle: { sulky: 7, pouty: 14 },
    happyDays: 1,
    cacheSeconds: 300,
  };
}

/**
 * @param {string} key
 * @returns {object|null}
 */
function oshiMoodLevelOf(key) {
  var list = OSHI_MOODS();
  for (var i = 0; i < list.length; i++) if (list[i].key === String(key)) return list[i];
  return null;
}

/**
 * 数えたものから機嫌を決める。わけ (reasons) は、しょんぼり以上に届いたものだけを、数だけで返す。
 *
 * @param {{open: number, overdue: number, stale: number, lastDoneDays: (number|null)}} s
 * @returns {{level: string, reasons: Array<{kind: string, count: number}>}}
 */
function oshiMoodOf(s) {
  var r = OSHI_MOOD_RULES();
  var open = Math.max(0, Number(s && s.open) || 0);
  var last = s && s.lastDoneDays !== null && s.lastDoneDays !== undefined && s.lastDoneDays !== '' &&
    !isNaN(Number(s.lastDoneDays)) ? Math.max(0, Number(s.lastDoneDays)) : null;
  var calm = last !== null && last <= r.happyDays ? 'happy' : 'normal';
  if (!open) return { level: calm, reasons: [] };
  var got = [
    { kind: 'overdue', count: Math.max(0, Number(s.overdue) || 0) },
    { kind: 'stale', count: Math.max(0, Number(s.stale) || 0) },
    { kind: 'idle', count: last === null ? 0 : last },
  ];
  var level = calm;
  var reasons = [];
  got.forEach(function (g) {
    var edge = r[g.kind];
    if (g.count < edge.sulky) return;
    reasons.push({ kind: g.kind, count: g.count });
    if (g.count >= edge.pouty) level = 'pouty';
    else if (level !== 'pouty') level = 'sulky';
  });
  return { level: level, reasons: reasons };
}

/**
 * 機嫌のわけを人の読む字にする (数だけ。題名も人の名前も入れない)。
 *
 * @param {string} kind overdue / stale / idle
 * @param {number} count
 * @returns {string}
 */
function oshiMoodReasonText(kind, count) {
  var n = Math.max(0, Math.floor(Number(count) || 0));
  if (kind === 'overdue') return '期限を過ぎたやること ' + n + '件';
  if (kind === 'stale') return 'しばらく動いていないやること ' + n + '件';
  if (kind === 'idle') return '最後に済ませてから ' + n + '日';
  return '';
}
