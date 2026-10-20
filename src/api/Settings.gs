/*
 * 画面の API: 設定・ポイント (ゲーム)・手元の道具の置き場。
 */

/**
 * 手元から動かす道具の置き場を返す (Web App API)。
 *
 * @returns {{name:string, url:string, version:string}}
 */
function apiAgentKit() {
  var kit = agentKitFile();
  // 落とした時点でその人の道具は最新。画面の「更新あり」を消すため
  kitRemember_(String(Session.getActiveUser().getEmail() || ''), kitPrint_());
  return kit;
}

/**
 * 自分の手元の道具が古いか (Web App API)。
 *
 * @returns {{print:string, mine:string, outdated:boolean}}
 */
function apiKitStatus() {
  return kitStatus_(String(Session.getActiveUser().getEmail() || ''));
}

function plainQueueStatus_(st) {
  return { runner: plainText(st.runner), lastRun: plainText(st.lastRun), stale: !!st.stale };
}

/**
 * アプリ全体の設定を返す (Web App API)。
 *
 * 変えられるのは管理者だけ。画面は canEdit を見て、切り替えの入口を出すか決める。
 *
 * @returns {{scrumEnabled: boolean, canEdit: boolean, productGoal: string,
 *   definitionOfDone: string,
 *   queue: ({runner:string, lastRun:string, stale:boolean}|null)}}
 */
function apiSettings() {
  var me = String(Session.getActiveUser().getEmail() || '');
  var admin = repoIsAdmin_(me);
  var texts = scrumTexts();
  return {
    scrumEnabled: scrumEnabled(),
    gameEnabled: gameEnabled(),
    canEdit: admin,
    // 人のアドレスを含むので、管理者にだけ返す
    queue: admin ? plainQueueStatus_(queueStatus_()) : null,
    productGoal: plainText(texts.productGoal),
    definitionOfDone: plainText(texts.definitionOfDone),
    // 用語の説明は画面に写しを持たせず、ここから渡す (食い違わないように)
    glossary: SCRUM_GLOSSARY(),
  };
}

/**
 * エージェンティックスクラムを切り替える (Web App API)。管理者だけ。
 *
 * @param {boolean} on
 * @returns {object} 切り替えたあとの apiSettings()
 */
function apiSetScrumEnabled(on) {
  repoAssertAdmin_('「期間で進める」の切り替え');
  scrumSetEnabled_(!!on);
  return apiSettings();
}

/**
 * ポイント・レベル・週の上位を切り替える (Web App API)。管理者だけ。既定はオフ。
 *
 * @param {boolean} on
 * @returns {object} 切り替えたあとの apiSettings()
 */
function apiSetGameEnabled(on) {
  repoAssertAdmin_('ポイントとレベルの切り替え');
  gameSetEnabled_(!!on);
  return apiSettings();
}

/**
 * 本人のポイント・レベル・参加しているか・称号・先週のチーム (Web App API)。
 * オフなら {enabled: false}。**順位は返さない。** 称号は本人のぶんだけ、チームは合計だけ。
 *
 * @returns {object}
 */
function apiGameState() {
  if (!gameEnabled()) return { enabled: false };
  var me = String(Session.getActiveUser().getEmail() || '');
  var m = gameMine_(me, new Date());
  return { enabled: true, total: plainNumber(m.total), week: plainNumber(m.week),
    level: plainNumber(m.level), levelFrom: plainNumber(m.levelFrom), nextAt: plainNumber(m.nextAt),
    playing: !!m.playing,
    badges: m.badges.map(function (b) {
      return { key: plainText(b.key), label: plainText(b.label), done: !!b.done, at: plainDay(b.at),
        left: plainNumber(b.left) };
    }),
    // 終わった週だけ。名前もアドレスも入れない。見る人のほかに2人いない週は null
    // (引き算でその人の数が見える)。見る人が分からなければ丸ごと null
    team: m.team ? { lastWeek: m.team.lastWeek === null ? null : plainNumber(m.team.lastWeek),
      weekBefore: m.team.weekBefore === null ? null : plainNumber(m.team.weekBefore) } : null };
}

/**
 * 画面がレベル n を見せたことを覚える (Web App API)。本人のぶんだけ。オフなら何もしない。
 *
 * 実際に届いているレベルより上は覚えず、下げもしない (gameLevelSeenAck_)。
 *
 * @param {number} n
 * @returns {{level: number}|null} 覚えている最高のレベル
 */
function apiGameLevelSeen(n) {
  if (!gameEnabled()) return null;
  var me = String(Session.getActiveUser().getEmail() || '');
  return { level: plainNumber(gameLevelSeenAck_(me, Number(n))) };
}

/**
 * 今週の上位3位まで (Web App API)。オフなら空。**アドレスは返さない。**
 *
 * 「人に関わる数は本人と部下のぶんだけ見せる」(memberVisibleTo) の唯一の例外。
 * 本人が参加を選んだ人の、上位だけを出す。
 *
 * @returns {Array<{rank: number, name: string, points: number, me: boolean}>}
 */
function apiGameTop() {
  if (!gameEnabled()) return [];
  var me = String(Session.getActiveUser().getEmail() || '');
  return gameTop_(new Date()).map(function (r) {
    return { rank: plainNumber(r.rank), name: plainText(r.name), points: plainNumber(r.points),
      me: r.email === me };
  });
}

/**
 * 週の上位に参加する・やめる (Web App API)。本人のぶんだけ。
 *
 * @param {boolean} on
 * @returns {object} apiGameState()
 */
function apiGameJoin(on) {
  if (!gameEnabled()) throw new Error('ポイントとレベルはオフです');
  gameSetPlaying_(String(Session.getActiveUser().getEmail() || ''), !!on);
  return apiGameState();
}

/**
 * プロダクトゴールか完了の定義を書く (Web App API)。管理者だけ。
 *
 * @param {string} kind 'productGoal' | 'definitionOfDone'
 * @param {string} text
 * @returns {object} 書いたあとの apiSettings()
 */
function apiSetScrumText(kind, text) {
  repoAssertAdmin_('目指すところと終わったと言える条件を書くこと');
  scrumSetText_(kind, text);
  return apiSettings();
}
