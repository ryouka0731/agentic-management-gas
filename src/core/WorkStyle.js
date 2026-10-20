/**
 * 仕事のスタンス診断。
 *
 * 4つの軸 (始め方・進め方・力が出る時・惹かれるもの) を、20問の「そう思う〜そう思わない」で決め、
 * 16の型のどれかを返す。**遊びの診断であって、人の評価や配置には使わない。医学的・心理学的な検査でもない。**
 * 問いも型の名前もこの道具のために書いたもので、ほかの性格検査の型や記号は使っていない。
 *
 * **問い・軸・型は、ここの3つ (`STYLE_QUESTIONS` / `WORK_STYLE_AXES` / `WORK_STYLES`) が唯一の定義である。**
 * 画面は `apiWorkStyle` で受け取って描き、写しを持たない。手元の Claude への手伝い方 (`support`) も
 * ここから `workStyle` の命令で渡す (配るスキル `banto-style` は、その読み方だけを持つ)。
 *
 * 数え方 (`workStyleScore`):
 * - 答えは 1 (そう思わない) 〜 5 (そう思う)。3 が「どちらとも言えない」
 * - 1問ごとに (答え − 3) × 向き (`sign`) を、その問いの軸に足す。向きが +1 の問いは、そう思うほど
 *   軸の左の極 (`poles[0]`) に寄り、-1 の問いは右の極 (`poles[1]`) に寄る
 * - 軸ごとの合計が正なら左、負なら右。**ちょうど 0 なら左の極にする** (どの軸も同じ決まり。
 *   画面には「どちらとも言えない」と添える)。答えが同じなら、いつ数えても同じ型になる
 *
 * 軸ごとに5問。向きは各軸に両方を2問以上入れ、全体で +1 と -1 を10問ずつにしてある
 * (`test/workstyle.test.js` が固定している)。そう思うと答え続ける癖だけで型が決まらないように。
 *
 * おすすめの使い方 (`uses`) に挙げるのは、この道具に今ある機能だけ。設定は名前 (`pref`) で、画面は
 * 行き先 (`view`) で指す。**画面は設定を開くだけで、切り替えはしない** (オンにするかは本人が決める)。
 */

/**
 * 答えの5段。value は 1〜5。
 *
 * @returns {Array<{value: number, label: string}>}
 */
function WORK_STYLE_SCALE() {
  return [
    { value: 1, label: 'そう思わない' },
    { value: 2, label: 'あまり思わない' },
    { value: 3, label: 'どちらとも言えない' },
    { value: 4, label: 'ややそう思う' },
    { value: 5, label: 'そう思う' },
  ];
}

/**
 * 4つの軸。並びは型の code の並び。
 *
 * 極ごとに持つもの:
 * - label: 画面と札に出す名前
 * - tip: 画面に出す、その極の人へのひとこと
 * - support: 手元の Claude が手伝い方を合わせるときの言葉 (`banto-style` が読む)
 * - uses: おすすめの使い方。kind は 'pref' (設定の名前を key に) か 'view' (行き先を key に)
 *
 * @returns {Array<{key: string, label: string, poles: object[]}>}
 */
function WORK_STYLE_AXES() {
  return [
    { key: 'start', label: '始め方', poles: [
      { key: 'go', label: 'すぐ動く',
        tip: '最初の一歩が速いのが持ち味です。動いたあとに「どこまでやるか」を一度だけ確かめると、やり直しが減ります。',
        support: '最初の一歩をすぐに示す。前置きや長い計画は後回しにし、まず手を付けられる形で出す',
        uses: [
          { kind: 'pref', key: 'home.cards.turn', why: '開いてすぐ、あなたが動く番のものが並びます' },
          { kind: 'pref', key: 'fun.combo', why: '打ち始めた勢いが字になって見えます' },
        ] },
      { key: 'plan', label: '段取りから',
        tip: '先に道筋を描けるのが持ち味です。計画が固まりきる前でも、小さく1つ始めると見落としに早く気づけます。',
        support: '動く前に、短い段取り (3〜5手) を先に見せてから進める。順番と終わりの形を最初に揃える',
        uses: [
          { kind: 'view', key: 'gantt', why: '工程表で、やることを日の並びに置いて見渡せます' },
          { kind: 'pref', key: 'start.tab', why: '開いたときに最初に出す画面を、段取りを見る画面にできます' },
        ] },
    ] },
    { key: 'pace', label: '進め方', poles: [
      { key: 'solo', label: 'ひとりで集中',
        tip: 'まとまった時間に深く潜れるのが持ち味です。区切りのいいところで、途中の形を一度だけ人に見せると安心です。',
        support: '話しかける回数を減らす。尋ねたいことはまとめて1回にし、作業の途中で細かく割り込まない',
        uses: [
          { kind: 'pref', key: 'notify.comment', why: 'やりとりのメールを止めると、集中が途切れにくくなります (画面の中の知らせは残ります)' },
          { kind: 'pref', key: 'home.cards.recent', why: 'ホームの「最近の動き」を外すと、自分の番だけに目が向きます' },
        ] },
      { key: 'team', label: '声をかけ合う',
        tip: '人と話しながら進めると力が出るのが持ち味です。決めたことは、やることのやりとりに一言残すと後で迷いません。',
        support: '途中の様子をこまめに伝え、区切りごとに「この向きで合っていますか」と確かめる',
        uses: [
          { kind: 'view', key: 'board', why: '進捗ボードで、誰が何を進めているかを見せ合えます' },
          { kind: 'pref', key: 'notify.mention', why: '名指しされたときにメールで届きます' },
        ] },
    ] },
    { key: 'power', label: '力が出る時', poles: [
      { key: 'rush', label: '締切が近いと',
        tip: '締切の前の集中力が持ち味です。大きな締切の手前に、小さな締切をいくつか置くと、最後に慌てずに済みます。',
        support: '大きな締切の手前に、小さな区切りと期限を提案する。「今日中にここまで」のように近い目標で示す',
        uses: [
          { kind: 'pref', key: 'home.cards.turn', why: '期限が近いやることが、ホームの「あなたの番」に出ます' },
          { kind: 'pref', key: 'fun.cheer', why: '片づけたときにお祝いの字が出ます' },
        ] },
      { key: 'steady', label: 'コツコツ毎日',
        tip: '毎日少しずつ積み上げられるのが持ち味です。積み上げが目に見えると、続ける力がさらに出ます。',
        support: 'その日のうちに終わる小さな一歩に分けて示す。続けたことを、数で振り返れる形にする',
        uses: [
          { kind: 'pref', key: 'home.cards.activity', why: '日ごとに動いた数が、草の濃さで見えます' },
          { kind: 'pref', key: 'home.cards.game', why: '片づけた重さがポイントとレベルで積み上がります (管理者がオンにしたときだけ)' },
        ] },
    ] },
    { key: 'draw', label: '惹かれるもの', poles: [
      { key: 'new', label: '新しいこと',
        tip: '初めてのやり方を楽しめるのが持ち味です。試したやり方は、うまくいったものを1つだけ残しておくと次に効きます。',
        support: 'やり方を1つに決めつけず、別の進め方も添える。同じ手順の繰り返しは、変化を付けて示す',
        uses: [
          { kind: 'pref', key: 'fun.words', why: '「完成」「ありがとう」などの言葉に、小さな絵と字が応えます' },
          { kind: 'view', key: 'help', why: '使い方で、まだ使っていない機能を探せます' },
        ] },
      { key: 'craft', label: '決まった型を磨く',
        tip: '決まった手順をきっちり磨けるのが持ち味です。磨いた手順を下書きや一覧にして残すと、チームの型になります。',
        support: '確かめる項目を一覧 (チェックリスト) にして渡す。手順は毎回同じ形で示し、抜けが無いかを最後に確かめる',
        uses: [
          { kind: 'view', key: 'list', why: 'やることの一覧で、同じ形の仕事を並べて片づけられます' },
          { kind: 'pref', key: 'fun.cheer', why: '済ませたときにお祝いの字が出ます' },
        ] },
    ] },
  ];
}

/**
 * 問い。並びは画面に出す順 (軸が続かないように混ぜてある)。sign は「そう思う」がどちらの極に寄るか
 * (+1 = 左の極 poles[0]、-1 = 右の極 poles[1])。
 *
 * **id は変えない。** 答えは id で受ける。
 *
 * @returns {Array<{id: string, axis: string, sign: number, text: string}>}
 */
function STYLE_QUESTIONS() {
  return [
    { id: 'q1', axis: 'start', sign: 1, text: '新しい仕事を受けたら、まず手を付けてみてから考える' },
    { id: 'q2', axis: 'pace', sign: 1, text: 'まとまった時間ひとりで集中できると、仕事がはかどる' },
    { id: 'q3', axis: 'power', sign: 1, text: '締切が近づくと、ぐっと力が出る' },
    { id: 'q4', axis: 'draw', sign: 1, text: '初めてのやり方を試すのは楽しい' },
    { id: 'q5', axis: 'start', sign: -1, text: '段取りが決まらないうちは、動き出すのが落ち着かない' },
    { id: 'q6', axis: 'pace', sign: -1, text: '途中で人に見せて意見をもらうと安心する' },
    { id: 'q7', axis: 'power', sign: -1, text: '毎日少しずつ進めるほうが性に合っている' },
    { id: 'q8', axis: 'draw', sign: -1, text: '決まった手順をきっちり磨き上げるのが好きだ' },
    { id: 'q9', axis: 'start', sign: 1, text: '完璧な計画より、とりあえずの一歩を大事にしたい' },
    { id: 'q10', axis: 'pace', sign: 1, text: '話しかけられると、元の作業に戻るまで時間がかかるほうだ' },
    { id: 'q11', axis: 'power', sign: 1, text: '時間に余裕があるうちは、つい後回しにしてしまう' },
    { id: 'q12', axis: 'draw', sign: 1, text: '同じ作業が続くと、別のやり方を考えたくなる' },
    { id: 'q13', axis: 'start', sign: -1, text: '始める前に、終わりまでの手順をざっと書き出す' },
    { id: 'q14', axis: 'pace', sign: -1, text: '困ったら、すぐ誰かに声をかけて相談する' },
    { id: 'q15', axis: 'power', sign: -1, text: '決まった時間に決まった量を片づけると気持ちがいい' },
    { id: 'q16', axis: 'draw', sign: -1, text: 'うまくいっているやり方は、変えずに続けたい' },
    { id: 'q17', axis: 'start', sign: 1, text: '迷ったら、小さく試して確かめるほうだ' },
    { id: 'q18', axis: 'pace', sign: 1, text: '考えをまとめるのは、ひとりのほうが向いている' },
    { id: 'q19', axis: 'power', sign: -1, text: '締切の直前に慌てないよう、早めに手を付ける' },
    { id: 'q20', axis: 'draw', sign: -1, text: '前例のある仕事のほうが、安心して取り組める' },
  ];
}

/**
 * 16の型。key は軸の極を並べた code (start-pace-power-draw)。
 *
 * @returns {Object<string, {name: string, emoji: string, oneLine: string, strengths: string[], cautions: string[]}>}
 */
function WORK_STYLES() {
  return {
    'go-solo-rush-new': { name: '一番乗りの開拓者', emoji: '🚀',
      oneLine: '誰も手を付けていない所へ真っ先に飛び込み、締切の前に一気に形にする人。',
      strengths: ['初めての仕事でも臆せず始められる', '短い時間で集中して仕上げられる', '前例の無い問題に新しい手を思い付く'],
      cautions: ['飛び込んだあとに、どこまでやるかを決め忘れやすい', '締切の前に抱え込みすぎないよう、途中で一度見せる'] },
    'go-solo-rush-craft': { name: '追い込みの職人', emoji: '🔨',
      oneLine: '慣れた手順で素早く取りかかり、締切の前に精度を上げて仕上げる人。',
      strengths: ['いつもの仕事を速く確かに片づけられる', '締切が見えると集中が深まる', '仕上げの細かいところまで目が届く'],
      cautions: ['最後に詰め込むと、確かめる時間が削られやすい', 'ひとりで抱えた仕事は、早めに誰かと分け合う'] },
    'go-solo-steady-new': { name: '気ままな探検家', emoji: '🧭',
      oneLine: '気になったことからすぐ試し、毎日少しずつ新しい道を見つけていく人。',
      strengths: ['小さな試しを毎日続けられる', '新しいやり方を自分で見つけてくる', 'ひとりで黙々と進められる'],
      cautions: ['寄り道が増えると、本筋が遅れやすい', '見つけたやり方は、人に伝えないと自分だけのものになる'] },
    'go-solo-steady-craft': { name: '黙々の名工', emoji: '🪵',
      oneLine: 'すっと手を動かし始め、毎日同じ質で丁寧に積み上げる人。',
      strengths: ['毎日の仕事にむらが無い', '手順を少しずつ磨いて速くできる', '静かに確実に終わらせる'],
      cautions: ['困っていても声に出さず、ひとりで粘りすぎやすい', '磨いた手順は、書き残すとチームの財産になる'] },
    'go-team-rush-new': { name: 'お祭りの火付け役', emoji: '🎆',
      oneLine: '新しい話にまっ先に乗り、みんなを巻き込んで締切までに盛り上げる人。',
      strengths: ['場の空気を前向きにできる', '新しい取り組みの最初の一押しになる', '締切に向けて人を集められる'],
      cautions: ['始めた話が多すぎて、終わりが見えなくなりやすい', '決めたことを書き残さないと、後で食い違う'] },
    'go-team-rush-craft': { name: '現場の切り込み隊長', emoji: '⚡',
      oneLine: '慣れた段取りで真っ先に動き、声をかけ合いながら締切までに片づける人。',
      strengths: ['急ぎの仕事で頼りになる', '周りに声をかけて手を集められる', 'いつもの流れを速く回せる'],
      cautions: ['急ぎが続くと、周りも休めなくなる', '頼む前に、相手の手が空いているかを確かめる'] },
    'go-team-steady-new': { name: '好奇心の旗振り役', emoji: '🚩',
      oneLine: '面白そうなことをすぐ試し、毎日みんなと少しずつ広げていく人。',
      strengths: ['新しいやり方を人に勧めるのがうまい', '毎日の小さな改善を周りと続けられる', '話しやすい雰囲気をつくる'],
      cautions: ['試すものが増えると、どれを続けるか迷いやすい', 'やめるものも決めると、みんなが楽になる'] },
    'go-team-steady-craft': { name: '頼れる世話焼き番', emoji: '🤝',
      oneLine: '気づいたらすぐ手を貸し、決まった流れを毎日みんなと回す人。',
      strengths: ['困っている人にすぐ気づいて動ける', 'いつもの流れを安定して回せる', 'チームの調子を整えられる'],
      cautions: ['人の仕事を引き受けすぎて、自分の分が遅れやすい', '断ることも、チームを守る仕事のうち'] },
    'plan-solo-rush-new': { name: '計算ずくの発明家', emoji: '💡',
      oneLine: '新しい案の筋道をひとりで描き、締切に向けて一気に組み上げる人。',
      strengths: ['新しい仕組みを筋道立てて考えられる', '集中した時間に大きく進められる', '先の落とし穴を読める'],
      cautions: ['考えが固まるまで人に見せないと、向きのずれに遅れて気づく', '締切の前に休む時間も段取りに入れる'] },
    'plan-solo-rush-craft': { name: '土壇場の仕上げ人', emoji: '🎯',
      oneLine: '手順を決めておき、締切の前の集中で狂いなく仕上げる人。',
      strengths: ['決めた段取りどおりに仕上げられる', '最後の確かめが丁寧', '追い込みでも質を落とさない'],
      cautions: ['段取りに無い頼まれごとが来ると、急に苦しくなりやすい', '余白の時間を段取りに入れておく'] },
    'plan-solo-steady-new': { name: '静かな研究者', emoji: '🔬',
      oneLine: '調べて考えてから、新しいやり方を毎日少しずつ確かめていく人。',
      strengths: ['根拠を調べてから決められる', '新しいやり方を丁寧に確かめられる', '長い仕事をこつこつ続けられる'],
      cautions: ['調べるのに時間をかけすぎやすい', '分かったことは途中でも人に共有する'] },
    'plan-solo-steady-craft': { name: '段取りの匠', emoji: '📐',
      oneLine: '手順を整えてから始め、毎日決まった質で確実に進める人。',
      strengths: ['見落としの少ない段取りを組める', '毎日の仕事の質が揃っている', '手順書やひな形を作るのが得意'],
      cautions: ['手順が決まらないと動き出しにくい', '変わったことには、早めに声をかけてもらうよう頼んでおく'] },
    'plan-team-rush-new': { name: '作戦会議の軍師', emoji: '♟️',
      oneLine: 'みんなと作戦を練り、新しい手で締切までに勝ち筋をつくる人。',
      strengths: ['人の意見をまとめて案にできる', '新しい打ち手を筋道立てて出せる', '締切に向けて役割を分けられる'],
      cautions: ['話し合いが長引くと、手を動かす時間が減る', '決めたら、誰がいつまでに何をするかを残す'] },
    'plan-team-rush-craft': { name: '締切の司令塔', emoji: '🗓️',
      oneLine: '段取りを組んでみんなに渡し、決まった流れで締切に間に合わせる人。',
      strengths: ['全体の段取りを組んで人に渡せる', '締切から逆算して進められる', 'いつもの流れの抜けに気づける'],
      cautions: ['自分が止まると全体が止まりやすい', '段取りは人にも任せて、ひとりで持たない'] },
    'plan-team-steady-new': { name: '仕組みの設計士', emoji: '🧩',
      oneLine: 'みんなの困りごとを聞いて、新しい仕組みを毎日少しずつ整える人。',
      strengths: ['人の話から仕組みの改善を思い付く', '新しいやり方をチームに根付かせられる', '長い目で整えていける'],
      cautions: ['仕組みを変えすぎると、周りが付いてこられない', '変えたことと理由を、短く書いて伝える'] },
    'plan-team-steady-craft': { name: 'みんなの縁の下', emoji: '🌱',
      oneLine: '決まった段取りでみんなを支え、毎日の仕事を静かに回し続ける人。',
      strengths: ['いつもの仕事を毎日確実に回せる', '人が働きやすいように先回りできる', '手順をみんなと揃えられる'],
      cautions: ['目立たない仕事ほど、自分でも数えておく', '頼まれごとが重なったら、順番を上長と決める'] },
  };
}

/**
 * 軸を key で引く。
 *
 * @param {string} key
 * @returns {object|null}
 */
function workStyleAxisOf_(key) {
  var list = WORK_STYLE_AXES();
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}

/**
 * code が16の型のどれかか。
 *
 * @param {*} code
 * @returns {boolean}
 */
function workStyleCodeValid(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(WORK_STYLES(), code);
}

/**
 * 答えから型を決める。**同じ答えなら必ず同じ型になる。**
 *
 * @param {Object<string, number>} answers 問いの id → 1〜5
 * @returns {{code: string, scores: Object<string, number>}}
 */
function workStyleScore(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new Error('答えが読めません');
  }
  var scores = {};
  WORK_STYLE_AXES().forEach(function (a) { scores[a.key] = 0; });
  STYLE_QUESTIONS().forEach(function (q) {
    var v = Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : undefined;
    if (typeof v !== 'number' || Math.floor(v) !== v || v < 1 || v > 5) {
      throw new Error('答えていない問いがあります (全部で' + STYLE_QUESTIONS().length + '問)');
    }
    scores[q.axis] += (v - 3) * q.sign;
  });
  var code = WORK_STYLE_AXES().map(function (a) {
    // ちょうど 0 は左の極 (決まりは上の説明)
    return scores[a.key] >= 0 ? a.poles[0].key : a.poles[1].key;
  }).join('-');
  return { code: code, scores: scores };
}

/**
 * 軸ごとの点の上限 (問いの数 × 2)。
 *
 * @param {string} axisKey
 * @returns {number}
 */
function workStyleAxisMax(axisKey) {
  return STYLE_QUESTIONS().filter(function (q) { return q.axis === axisKey; }).length * 2;
}

/**
 * 点の寄り方を言葉にする。
 *
 * @param {number} score
 * @param {number} max
 * @returns {string}
 */
function workStyleLean(score, max) {
  var r = max ? Math.abs(score) / max : 0;
  if (r === 0) return 'どちらとも言えない';
  if (r < 0.4) return 'やや';
  return 'はっきり';
}

/**
 * 型の説明を、軸ごとの極と合わせて返す。知らない code なら null。
 *
 * @param {string} code
 * @returns {object|null}
 */
function workStyleOf(code) {
  if (!workStyleCodeValid(code)) return null;
  var t = WORK_STYLES()[code];
  var keys = code.split('-');
  var axes = WORK_STYLE_AXES().map(function (a, i) {
    var pole = a.poles[0].key === keys[i] ? a.poles[0] : a.poles[1];
    var other = pole === a.poles[0] ? a.poles[1] : a.poles[0];
    return { key: a.key, label: a.label, pole: pole, other: other, left: a.poles[0], right: a.poles[1] };
  });
  // おすすめは軸の極から集める。同じものは1つにする (先に出た理由を使う)
  var seen = {};
  var uses = [];
  axes.forEach(function (x) {
    x.pole.uses.forEach(function (u) {
      var id = u.kind + ':' + u.key;
      if (seen[id]) return;
      seen[id] = true;
      uses.push({ kind: u.kind, key: u.key, why: u.why, from: x.pole.label });
    });
  });
  return {
    code: code, name: t.name, emoji: t.emoji, oneLine: t.oneLine,
    strengths: t.strengths.slice(), cautions: t.cautions.slice(), axes: axes, uses: uses,
  };
}

/**
 * 社内チャットに貼る札の字。点数は入れない (型の名前・ひとこと・強みだけ)。
 *
 * @param {string} code
 * @param {string} appName APP_NAME()
 * @returns {string} 知らない code なら空
 */
function workStyleCardText(code, appName) {
  var s = workStyleOf(code);
  if (!s) return '';
  return [
    s.emoji + ' わたしの仕事のスタンスは「' + s.name + '」',
    s.oneLine,
    '強み: ' + s.strengths.join(' / '),
    '軸: ' + s.axes.map(function (x) { return x.label + 'は' + x.pole.label; }).join('・'),
    '(' + appName + ' の仕事のスタンス診断より。遊びの診断です)',
  ].join('\n');
}
