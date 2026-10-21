/**
 * 推し (自分だけのキャラクター)。既定はオン (自分の設定 oshi.on)。既定のキャラはタク。
 *
 * 利用者が ChatGPT や Gemini などの画像を作る道具で、自分の参考画像から表情ごとの絵を作り、
 * 番頭に上げる。上げたキャラクターが、済ませたときにほめ、あいさつし、活動に合わせて育つ。
 *
 * **ここが唯一の定義である。** 表情 (OSHI_STATES)・口調 (OSHI_TONES)・場面 (OSHI_EVENTS)・
 * せりふ (OSHI_LINES)・作り方の頼み文 (oshiPrompt / OSHI_PROMPT_BASE)・キャラ作成キットの頼み文 (oshiCharKitPrompt)・
 * 育ちの段 (OSHI_STAGES)・
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
    // Claude Code の考え中の字 (~/.claude/settings.json の spinnerVerbs)。画面の吹き出しには出さない (spinner)。
    // 手元の道具の oshi-spinner が命令 oshiSpinner で受け取って書く。短く出すので lineMax で字数を絞る
    { key: 'spinner', label: '考え中 (Claude Code の待ち時間)', state: 'work', spinner: true, lineMax: 24,
      kitHint: 'Claude Code が考えているあいだに出る短い言葉。いま考えている・作業している様子を、そのキャラの口調で。5〜10個。' +
        '{ } [ ] < > ` $ \\ は使わない' },
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
      spinner: ['考えをまとめています', '少々お待ちください', '丁寧に確かめています', '手順を整えています', 'よい形を探しています',
        '言葉を選んでいます', 'もう少しで整います'],
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
      spinner: ['いま考え中だよ！', 'うーん、ひらめき待ち！', 'がんばって調べてるよ！', 'もうちょっと待ってね！',
        'わくわくしながら考え中！', 'いい感じにまとめてる！'],
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
      spinner: ['考えている', '静かに組み立て中だ', '筋道を確かめている', '少し待て。すぐ済む', '要点を絞っている', '最短の道を探している'],
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
      spinner: ['いま考えとるで', 'ちょっと待っててな', 'ええ感じにまとめとるとこや', 'ぼちぼち調べとるで', 'もうちょいでできるで',
        'ひらめき待ちや'],
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
      spinner: ['只今、考えております', '少々お待ちくださいませ', '手筈を整えております', '念入りに確かめております',
        '最善の策を練っております', 'お茶を淹れる間に整えます'],
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
      spinner: ['祈りを込めて考えているのだ、、', '月光の下で考えているのだ、、', '考え中なのだ、、少し待つのだ、、',
        '言葉を選んでいるのだ、、', '静かに祈りを重ねているのだ、、', '古き書を読み解いているのだ、、'],
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
      spinner: ['考え中です。少々お待ちを', '面倒なところは道具に任せ中', 'まず小さく試しています', 'ひらめきを探しています',
        'コーヒー片手に考え中です', '余白を作る段取り中です'],
    },
  };
}

/**
 * 口調の、その場面のせりふ (写し)。知らない口調は丁寧に倒す。
 * **考え中 (spinner) のせりふを持たない口調は、既定の言葉 (OSHI_SPINNER_DEFAULT) に倒す** (口調を足すときに
 * 考え中を書き忘れても、手元の道具が空の並びを書かないように)。ほかの場面は空のまま。
 *
 * @param {string} tone
 * @param {string} event
 * @returns {string[]}
 */
function oshiToneLines(tone, event) {
  var all = OSHI_LINES();
  var t = all[String(tone)] || all.polite;
  var got = t[String(event)];
  if (Array.isArray(got) && got.length) return got.slice();
  return String(event) === 'spinner' ? OSHI_SPINNER_DEFAULT() : [];
}

/**
 * 考え中のせりふを持たない口調の言葉。どの口調にも寄せない、ふつうの言い方。
 *
 * @returns {string[]}
 */
function OSHI_SPINNER_DEFAULT() {
  return ['考えています', '整理しています', '確かめています', '組み立てています', '仕上げています', 'もう少しお待ちください'];
}

/**
 * 考え中のせりふの数の上限 (settings.json の spinnerVerbs に書く数)。字数は場面 spinner の lineMax。
 * 手元の道具 (kit/track/spinner.mjs) も同じ数で絞る (test/kit-spinner.test.js が揃っているかを見ている)。
 *
 * @returns {number}
 */
function OSHI_SPINNER_MAX() {
  return 20;
}

/**
 * 考え中のせりふに使えない字 (コードや JSON に見える字)。保存のときに断り (oshiCleanEventLines)、返すときに捨てる (oshiSpinnerPick)。
 * **手元の道具の CODE_LIKE (kit/track/spinner.mjs) と同じ** (test/oshi-spinner.test.js が見ている)。
 *
 * @returns {RegExp}
 */
function OSHI_SPINNER_CODE_LIKE() {
  return /[{}[\]<>`$\\]/;
}

/**
 * 字の数 (コードポイント)。絵文字を2つと数えない。手元の道具も同じ数え方。
 *
 * @param {string} s
 * @returns {number}
 */
function oshiCharCount(s) {
  return Array.from(String(s)).length;
}

/**
 * 場面ごとの自分のせりふを整える (oshiCleanLines を場面の上限で)。考え中 (spinner) は、使えない字があれば断る
 * (返すときに黙って捨てると、書いたせりふが消えて見える)。
 *
 * @param {string} event
 * @param {*} lines
 * @returns {string[]}
 */
function oshiCleanEventLines(event, lines) {
  var clean = oshiCleanLines(lines, oshiLineMaxOf(event));
  if (String(event) === 'spinner') {
    clean.forEach(function (l) {
      if (OSHI_SPINNER_CODE_LIKE().test(l)) {
        throw new Error('考え中のせりふには { } [ ] < > ` $ \\ を使えません: ' + l);
      }
    });
  }
  return clean;
}

/**
 * 考え中のせりふを、手元に渡せる形にそろえる。字でないもの・空を捨て、制御文字と改行・字の向きを変える印・
 * 幅の無い空白を落とし、前後の空白を取り、字数の上限を超えるものと重なりを捨て、OSHI_SPINNER_MAX 個までにする。
 * 台帳は人が手で書き換えうるので、返す前に必ず通す。
 *
 * @param {*} list
 * @returns {string[]}
 */
function oshiSpinnerPick(list) {
  var max = oshiLineMaxOf('spinner');
  var seen = Object.create(null);
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (v) {
    if (typeof v !== 'string' || out.length >= OSHI_SPINNER_MAX()) return;
    var one = v.replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200B\u200E\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, '')
      .replace(/^\s+|\s+$/g, '');
    if (!one || oshiCharCount(one) > max || OSHI_SPINNER_CODE_LIKE().test(one) || seen[one]) return;
    seen[one] = true;
    out.push(one);
  });
  return out;
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
  ].concat(OSHI_PROMPT_LOOK_RULES());
}

/**
 * 絵の見せ方の決まり (背景と「誰を描くか」を除く)。表情ごとの頼み文 (OSHI_PROMPT_RULES) と
 * キャラ作成キット (oshiCharKitPrompt) の両方に付ける。
 *
 * @returns {string[]}
 */
function OSHI_PROMPT_LOOK_RULES() {
  return [
    '- 胸から上 (上半身)。キャラクターを真ん中に大きく',
    '- 表情がはっきり分かるように',
    '- 画像の中に文字・吹き出し・ロゴ・署名を入れない',
    '- 職場で見せて困らない、健全な表現にする (肌の露出・暴力・流血を描かない)',
    '- 画風・線の太さ・塗り方は、これまでの画像とそろえる',
  ];
}

// ----- キャラ作成キット (写真とリンクから、AI の道具にキャラを1人作ってもらう) -----

/**
 * キャラ作成キットの道具。**頼み文の唯一の定義** (画面の「コピー」と手元の道具の oshi-prompt は、どちらも
 * oshiCharKitPrompt を番頭から受け取る)。key は画面と手元の道具の引数に出るので変えない。
 *
 * - images: 絵の受け取り方。png = 表情ごとの透明な PNG、green = 表情ごとの緑一色の背景 (番頭で抜く)、
 *   text = 絵は作らず、画像を作る道具に貼る頼み文を書く、sheet = 1枚の表の画像を手元で切り分ける
 * - steps: その道具に頼む手順 (表情の並びと JSON の形は oshiCharKitPrompt が足す)
 *
 * @returns {Array<{key: string, label: string, images: string, steps: string[]}>}
 */
function OSHI_CHARKIT_TOOLS() {
  return [
    { key: 'chatgpt', label: 'ChatGPT', images: 'png', steps: [
      '絵は、下の表情ごとに1枚ずつ、別の画像として作ってください (1枚に1つの表情)。',
      '- 背景は透明にして、透明な PNG で書き出す (白や模様の背景を付けない)',
      '- 正方形 (縦横 1:1)',
      '- ファイルの名前は表情の key に合わせる (例: idle.png)',
      '1枚目 (idle) を作ったら、同じキャラクターのまま残りを順に作ってください。',
    ] },
    { key: 'gemini', label: 'Gemini', images: 'green', steps: [
      '絵は、下の表情ごとに1枚ずつ、別の画像として作ってください (1枚に1つの表情)。',
      '- 背景は透明にせず、#00FF00 (明るい緑) 一色の無地にする。緑の背景は、あとで番頭が抜いて透明にする',
      '- キャラクターの髪・目・服・小物には緑を使わない (背景と一緒に抜けてしまう)',
      '- 背景に影・ぼかし・光・模様を付けない。キャラクターの輪郭の外は、すべて同じ緑にする',
      '- 正方形 (縦横 1:1)',
      '1枚目 (idle) を作ったら、同じキャラクターのまま残りを順に作ってください。',
    ] },
    { key: 'claude', label: 'Claude', images: 'text', steps: [
      'あなたは絵を作らなくてかまいません。代わりに、画像を作る道具に貼れる頼み文を書いてください。',
      '- まず、キャラクターの見た目 (髪型・髪の色・目の色・服装・小物・配色・画風) を1つの段落にまとめる',
      '- 次に、下の表情ごとに1つずつ、その段落をそのまま入れた頼み文を書く (表情の key を見出しにする)',
      '- 頼み文には「正方形 (縦横 1:1)・背景は透明な PNG (できなければ #00FF00 一色の無地)・1枚に1つの表情」と、下の絵の決まりを入れる',
      '- 頼み文は1つずつ貼っても分かるように書く。「参考画像」とは書かず、見た目の段落で言い換える。先頭に「同じ会話の中で、idle から順に作る」と添える',
    ] },
    { key: 'codex', label: 'Codex', images: 'sheet', steps: [
      'このフォルダには、表情を1枚に並べた表の画像 (例: sheet.png) が1つあります。それを表情ごとの透明な PNG に切り分けてください。',
      '1. 表の画像を開き、縦横の大きさと、行と列の数を確かめる。ふつうは下の並びの順に、左上から右へ、行が終わったら次の行へ並んでいる',
      '2. マスごとに中身を見る。同じキャラクターか・表情が描き分けてあるか・空のマスはどれかを確かめ、違っていれば切る前に利用者に伝える',
      '3. 行と列の数・どのマスがどの表情か (並びの順でよいか) を利用者に確かめてから切る。分からないマスは使わない',
      '4. マスごとに切り出す。マスの幅は (画像の幅 ÷ 列の数)、高さは (画像の高さ ÷ 行の数) で、端数は四捨五入する',
      '5. 背景を透明にする。背景が一色 (#00FF00 の緑や白) なら、マスの縁からつながっていて四隅の色に近い画素 (色の差がおよそ 60 まで) だけを透明にする。' +
        'キャラクターの中の同じ色は消さない。境目の中間の色は少し透かす',
      '6. 正方形になるように透明な余白を足し、長い辺が 512px より大きければ 512px に縮める (小さければ大きくしない)',
      '7. oshi/<表情の key>.png の名前で保存する (例: oshi/idle.png・oshi/praise.png)。使わない表情のファイルは作らない',
      '8. 下の JSON を oshi/character.json に保存する',
      '切るのは手元にある道具 (Python の Pillow・ImageMagick・Node.js など) で行い、新しく入れるものがあれば、入れる前に利用者に確かめてください。',
      '表の画像が見つからないときは、作らずに、利用者に置き場所を尋ねてください。',
    ] },
  ];
}

/**
 * @param {string} key
 * @returns {object|null}
 */
function oshiCharKitToolOf(key) {
  var list = OSHI_CHARKIT_TOOLS();
  for (var i = 0; i < list.length; i++) if (list[i].key === String(key)) return list[i];
  return null;
}

/**
 * 写真とリンクは手がかりにだけ使い、実在の人をそのまま描かない・名前を出さない、という決まり。どの道具の頼み文にも付ける。
 *
 * @returns {string[]}
 */
function OSHI_CHARKIT_ORIGINAL_RULES() {
  return [
    '大事な決まり:',
    '- 添付した写真とリンク先のページは、雰囲気 (色・服の感じ・好きなもの・話し方) の手がかりとして使うだけにする',
    '- 写っている人や紹介されている人をそのまま描かない。顔立ちを似せず、新しいオリジナルのキャラクターを考える',
    '- 答えの中に、実在の人の名前・所属 (グループ・会社・学校など)・肩書きを書かない。名前もオリジナルにする',
    '- リンク先が開けないとき・写真やリンクが無いときは、ある手がかり (写真・言葉で伝えられた雰囲気) だけで考える',
  ];
}

/**
 * プロフィールの項目に使う Lv。いちばん早い Lv (OSHI_PROFILE_LIMITS の lvMin) から、最高の Lv の1つ手前まで 2 ずつ
 * (実績を1つ取るごとに Lv が1つ上がるので、2つ取るごとに1つ分かる)。最高の Lv で全部分かる (クリア)。
 *
 * @param {number} maxLevel 最高の Lv (1 + 実績の数)
 * @returns {number[]}
 */
function oshiCharKitLevels(maxLevel) {
  var lim = OSHI_PROFILE_LIMITS();
  var top = Math.min(lim.lvMax, Math.floor(Number(maxLevel) || 0) - 1);
  var out = [];
  for (var lv = lim.lvMin; lv <= top && out.length < lim.itemsMax; lv += 2) out.push(lv);
  return out;
}

/**
 * 1枚の表に並べるときの行と列 (表情の数から決める)。11 の表情なら 4 列 × 3 行。
 *
 * @param {number} n
 * @returns {{rows: number, cols: number}}
 */
function oshiSheetGrid(n) {
  var count = Math.max(1, Math.floor(Number(n) || 1));
  var cols = Math.ceil(Math.sqrt(count));
  return { rows: Math.ceil(count / cols), cols: cols };
}

/**
 * キャラ作成キットの頼み文。写真とプロフィールのリンクを添えて、道具に1回で貼る。
 * 中身: 何を作るか → 実在の人を描かない決まり → 道具ごとの絵の作り方 → 表情の並び → 絵の決まり → JSON の形と長さ。
 *
 * @param {string} tool OSHI_CHARKIT_TOOLS の key
 * @param {number} maxLevel 最高の Lv (1 + 実績の数)
 * @returns {string} 知らない道具なら空
 */
function oshiCharKitPrompt(tool, maxLevel) {
  var t = oshiCharKitToolOf(tool);
  if (!t) return '';
  var text = OSHI_TEXT_LIMITS();
  var prof = OSHI_PROFILE_LIMITS();
  var levels = oshiCharKitLevels(maxLevel);
  var top = Math.floor(Number(maxLevel) || 0);
  var states = OSHI_STATES();
  var grid = oshiSheetGrid(states.length);
  var out = [
    'これから、仕事の道具「番頭」の画面に出る、オリジナルのキャラクターを1人作ってもらいます。',
    '作るのは、キャラクターのプロフィール・キャラクターの口調のせりふ・表情ごとの絵の3つです。',
    '',
  ].concat(OSHI_CHARKIT_ORIGINAL_RULES(), [
    '',
    '絵の作り方:',
  ], t.steps, [
    '',
    '表情 (key と、表情としぐさ。「参考画像」と書いてあるところは、あなたが考えたキャラクターのいつもの姿のこと):',
  ]);
  states.forEach(function (s) { out.push('- ' + s.key + ' (' + s.label + '): ' + s.pose); });
  if (t.images === 'sheet') {
    out.push('表に並べるときは ' + grid.cols + ' 列 × ' + grid.rows + ' 行で、上の順に左上から並べる (余ったマスは空ける)。');
  }
  out.push('', '絵の決まり:', '- 上の表情を全部、同じキャラクター (同じ顔立ち・髪型・色・服装) で描く');
  out = out.concat(OSHI_PROMPT_LOOK_RULES());
  out.push(
    '',
    '最後に、次の形の JSON を1つだけ、```json の囲みに入れて出してください。ここに挙げた欄のほかは書かないでください。',
    '```json',
    '{',
    '  "name": "名前",',
    '  "tone": "口調の key",',
    '  "lines": { "' + OSHI_EVENTS()[0].key + '": ["せりふ", "せりふ"], "' + OSHI_EVENTS()[1].key + '": ["せりふ", "せりふ"] },',
    '  "profile": {',
    '    "items": [{ "lv": ' + (levels[0] || prof.lvMin) + ', "label": "見出し", "text": "中身" }],',
    '    "clearLine": "お祝いの言葉"',
    '  }',
    '}',
    '```',
    '- name: キャラクターの名前。' + text.nameMax + '字まで。実在の人の名前にしない',
    '- tone: 口調。次の key のどれか1つ: ' + OSHI_TONES().map(function (x) { return x.key + ' (' + x.label + ')'; }).join(' / '),
    '- lines: 場面ごとのせりふ。下の場面を全部、key のまま使う。1つの場面に2〜3個 (考え中 (spinner) だけは5〜10個。どれも' + text.linesPerEvent + '個まで)、1つ' +
      text.lineMax + '字まで。キャラクターの口調で書き、相手を責めない・急かさない (うまくいかなかったときも、やさしく寄り添う)'
  );
  OSHI_EVENTS().forEach(function (e) {
    out.push('  - ' + e.key + ': ' + e.label + (e.lineMax ? '。' + e.kitHint + '、1つ' + e.lineMax + '字まで' : ''));
  });
  out.push(
    '- profile.items: Lv が上がると少しずつ分かるプロフィール。lv は ' + levels.join(', ') + ' の ' + levels.length +
      ' 項目 (1つの lv に1項目)。label (見出し) は' + prof.labelMax + '字まで、text (中身) は' + prof.textMax +
      '字まで。好きなもの・苦手なもの・口ぐせ・小さな秘密など、Lv が上がるほど深い話にする',
    '- profile.clearLine: 全部分かったとき (Lv ' + top + '、実績を全部取ったとき) のお祝いの言葉。' + prof.clearLineMax + '字まで',
    '- どの字にも、実在の人の名前・所属・肩書きを書かない'
  );
  return out.join('\n');
}

/**
 * AI の答えから、最初の JSON の物 ({...}) を取り出す。```json の囲みを先に、無ければほかの囲み、それも無ければ
 * 答え全体を見る。前後の説明の字は捨てる。字の中の { } は数えない。
 * **最初の物が読めなければ断る** (中や後ろの物に逃げると、壊れた答えの一部を答えとして取り込んでしまう)。
 * 1回なめるだけにしてある (閉じていない { がたくさんあっても、数え直さない)。
 *
 * @param {*} text
 * @returns {string|null} JSON の字。{ が1つも無ければ null
 */
function oshiExtractJson(text) {
  var s = String(text == null ? '' : text);
  var fence = oshiFenceBody_(s, /```json[ \t]*\r?\n/ig) || oshiFenceBody_(s, /```[a-zA-Z]*[ \t]*\r?\n/g);
  if (fence && fence.indexOf('{') >= 0) return oshiFirstObject_(fence);
  return oshiFirstObject_(s);
}

/**
 * 最初の囲みの中身 (開きの印 open に当たったところから、次の ``` まで)。閉じが無ければ null。
 * 正規表現で中身まで取ると、閉じていない囲みが多いときに何度もなめ直すので、閉じは indexOf で探す。
 *
 * @param {string} s
 * @param {RegExp} open g 付き
 * @returns {string|null}
 */
function oshiFenceBody_(s, open) {
  var m = open.exec(s);
  if (!m) return null;
  var from = m.index + m[0].length;
  var end = s.indexOf('```', from);
  return end < 0 ? null : s.slice(from, end);
}

/**
 * 字の中の、最初の釣り合った { … }。字 ("…") の中の括弧と \" は数えない。最初の { から1回だけなめる。
 *
 * @param {string} s
 * @returns {string|null}
 */
function oshiFirstObject_(s) {
  var start = s.indexOf('{');
  if (start < 0) return null;
  var depth = 0;
  var inStr = false;
  for (var i = start; i < s.length; i++) {
    var ch = s.charAt(i);
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      var got = s.slice(start, i + 1);
      try {
        JSON.parse(got);
      } catch (e) {
        break;
      }
      return got;
    }
  }
  throw new Error('AI の答えの JSON を読めませんでした。{ から } までが欠けずに入っているか、"" や , が抜けていないかを確かめてください');
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
 * その場面のせりふ1つの字数の上限。場面に lineMax があればそれ (考え中は短く出すので 24)、無ければ OSHI_TEXT_LIMITS。
 *
 * @param {string} event
 * @returns {number}
 */
function oshiLineMaxOf(event) {
  var e = oshiEventOf(event);
  return e && e.lineMax ? e.lineMax : OSHI_TEXT_LIMITS().lineMax;
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
 * @param {number} [max] 1つの字数の上限 (場面ごとの oshiLineMaxOf)。省くと OSHI_TEXT_LIMITS の lineMax
 * @returns {string[]}
 */
function oshiCleanLines(lines, max) {
  var lim = OSHI_TEXT_LIMITS();
  var lineMax = max || lim.lineMax;
  var list = Array.isArray(lines) ? lines : String(lines == null ? '' : lines).split('\n');
  var seen = Object.create(null);
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var one = String(list[i] == null ? '' : list[i]).replace(/^\s+|\s+$/g, '');
    if (!one || seen[one]) continue;
    if (oshiCharCount(one) > lineMax) throw new Error('せりふは1つ' + lineMax + '字までにしてください');
    seen[one] = true;
    out.push(one);
  }
  if (out.length > lim.linesPerEvent) {
    throw new Error('せりふは1つの場面に' + lim.linesPerEvent + '個までにしてください');
  }
  return out;
}
