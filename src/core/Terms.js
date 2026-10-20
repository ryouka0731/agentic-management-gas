/**
 * スクラムまわりの言葉。
 *
 * スクラムの言葉 (スプリント・ベロシティ…) はエンジニア以外には通じない。既定は一般の言葉で出し、
 * 自分の設定 `terms.style` で「スクラムの言葉」を選んだ人にだけスクラムの言葉で出す。
 *
 * **`TERMS()` が唯一の定義である。** 画面にも同じものを写してある (google.script.run の往復を
 * 待たずに描くため)。`test/ui-parity.test.js` が同じ答えを返すかを見ている。
 *
 * **サーバの断り文は一般の言葉に固定する** (term(key) を style 省略で呼ぶか、一般の言葉で書く)。
 * 人ごとに切り替えると、キューやトリガーから出る文の言葉がばらつく。
 *
 * 台帳の列名・API 名・データは変えない。変えるのは人に見せる字だけ。
 * ゲームのポイントはスクラムの見積もりとは別物なので、ここに入れない。
 *
 * 設計: docs/superpowers/specs/2026-10-20-guide-usage-settings-design.md の 4。
 */

/**
 * 言葉の対応。key → {plain: 一般の言葉, scrum: スクラムの言葉}。
 *
 * @returns {Object<string, {plain: string, scrum: string}>}
 */
function TERMS() {
  return {
    feature: { plain: '期間で進める', scrum: 'エージェンティックスクラム' },
    sprint: { plain: '作業期間', scrum: 'スプリント' },
    sprintGoal: { plain: 'この期間の目標', scrum: 'スプリントゴール' },
    points: { plain: '大きさ', scrum: 'ポイント' },
    velocity: { plain: '期間ごとに終えた量', scrum: 'ベロシティ' },
    burndown: { plain: '残りの量の推移', scrum: 'バーンダウン' },
    impediment: { plain: '困りごと', scrum: '障害物' },
    productGoal: { plain: '目指すところ', scrum: 'プロダクトゴール' },
    definitionOfDone: { plain: '終わったと言える条件', scrum: '完了の定義' },
    acceptance: { plain: 'できたと言える条件', scrum: '受け入れ条件' },
  };
}

/**
 * 言葉を1つ返す。知らない表し方は一般の言葉。知らない key はそのまま返す
 * (空にすると画面から字が消えて気づけない)。
 *
 * @param {string} key
 * @param {string} [style] 'plain' | 'scrum'。省略すると一般の言葉
 * @returns {string}
 */
function term(key, style) {
  var all = TERMS();
  var k = String(key == null ? '' : key);
  if (!Object.prototype.hasOwnProperty.call(all, k)) return k;
  return style === 'scrum' ? all[k].scrum : all[k].plain;
}

/**
 * 文の中の {key} を言葉に置き換える。文ごと両方の形を持たず、言葉だけを差し込むため。
 * 知らない {key} は触らない。
 *
 * @param {string} text
 * @param {string} [style]
 * @returns {string}
 */
function termFill(text, style) {
  var all = TERMS();
  return String(text == null ? '' : text).replace(/\{([A-Za-z]+)\}/g, function (whole, k) {
    return Object.prototype.hasOwnProperty.call(all, k) ? term(k, style) : whole;
  });
}
