/*
 * 入口。Web アプリの doGet と、エディタで最初の一人が一度だけ実行する setup*。
 *
 * 画面から呼ぶ api* は src/api/ に、エディタ用の確かめ (debug*) は Debug.gs にある。
 * GAS は全ファイルを同じグローバルに読むので、置き場所を分けても呼び方は変わらない。
 */

/**
 * Web Appのエントリポイント。
 *
 * @param {object} e イベントオブジェクト
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.p) || 'wiki';
  if (!/^[a-z]{1,20}$/.test(page)) page = 'wiki';

  var template = HtmlService.createTemplateFromFile('ui/wiki');
  return template.evaluate()
    .setTitle(APP_NAME())
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTMLテンプレートから別のHTMLファイルを取り込むためのヘルパー。
 * wiki.html 内で <?!= include('ui/app.css') ?> のように使う。
 *
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  // **そのままの字を返す (getRawContent)。** createHtmlOutputFromFile(...).getContent() は部分ファイルを HTML として
  // 読み直してから返し、2026-10-22 から JS の `<` を `&lt;` に、CSS のコメントを消すようになった。画面の JS 全体が
  // 文法エラーになり、ボタンもアイコンも動かなくなった。部分ファイルは <script> / <style> の中身なので、HTML として
  // 読ませない (docs/dev/ui.md)
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

/**
 * リポジトリの初期セットアップ。GASエディタから1回だけ手動実行する。
 *
 * @returns {object} 作成されたリポジトリ設定
 */
function setupRepo() {
  // 作り直すと、道具が空のリポジトリを指し、これまでの記録が見えなくなる。
  // 画面からも呼べる関数なので、初期化済みなら断る
  if (PropertiesService.getScriptProperties().getProperty(REPO_CONFIG_KEY())) {
    throw new Error('リポジトリは既に初期化されています');
  }
  return repoInit('agentic-management');
}

/**
 * このアプリの持ち主かを確かめる。違えば断る。
 *
 * **末尾が _ でない関数は、画面の google.script.run から直に呼べる。**
 * エディタで動かすつもりの関数 (debug* / setupCommandQueue) も例外ではない。
 * 今は持ち主しか開けない設定だが、executeAs: ME で共有すると、利用者の誰もが
 * 持ち主の権限で呼べる。自己承認の解禁などを塞ぐため、最初にこれを呼ぶ。
 *
 * 持ち主は repoOwners_ が決める (共有ドライブでは管理者 = organizer 全員)。
 * 大文字小文字は見ない (共有ドライブの役割は小文字で持っている)。
 */
function assertOwner_() {
  var me = currentEmailLower_();
  if (!me || !repoHasOwner_(me)) {
    throw new Error('この操作は、このアプリの持ち主だけが行えます (共有ドライブでは管理者)');
  }
}

/**
 * コマンドキューの時間主導トリガーを設置する。
 *
 * GASエディタから1回実行する。同名のトリガーを先に消してから作るため、
 * 二度実行しても増えない。
 *
 * @returns {string}
 */
function setupCommandQueue() {
  assertOwner_();
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() !== 'processCommandQueue') continue;
    ScriptApp.deleteTrigger(triggers[i]);
    removed++;
  }

  ScriptApp.newTrigger('processCommandQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  // 誰の権限で回っているかを残す。他人のトリガーは見えないので、抜けた人のぶんは消せない。
  // 引き継いだ人がもう一度実行すれば、その人のトリガーで回る (二重に回っても同じ命令は二度走らない)
  PropertiesService.getScriptProperties()
    .setProperty('QUEUE_RUNNER', currentEmail_());

  // 仕掛けた時刻も残す。最初の1分が来るまで回った時刻が無く、それだけで見ると
  // 入れたばかりのキューが「止まっています」と出る (queueStatus_)
  PropertiesService.getScriptProperties()
    .setProperty('QUEUE_RUNNER_AT', new Date().toISOString());

  var queueId = commandQueueFolder_().getId();
  Logger.log('キューのフォルダ: ' + queueId);

  return '1分間隔のトリガーを設置しました' +
    (removed ? ' (古いトリガーを' + removed + '件削除)' : '') +
    '。キューのフォルダID: ' + queueId;
}

/**
 * 1日1回だけ置き場を片付ける。
 *
 * 命令キューの分刻みトリガーに相乗りする。トリガーを増やすと
 * 導入時にもう一度 setup を回してもらう必要が出るため、
 * 既に動いているものに載せて、日付でせき止める。
 *
 * @returns {number[]} 片付けた番号
 */
function housekeepArchiveDaily_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  if (props.getProperty('ARCHIVE_HOUSEKEPT_ON') === today) return [];

  /*
   * **今日の分を受け持つ印を、短い鍵の中で付ける。** 片付けそのものは鍵の外で
   * 走らせる (Drive を何度も見に行くので長い)。印を付けずに走らせると、重なった
   * 2回の起動が両方走り、取り下げの知らせが2通届く。受け持ったまま落ちた起動が
   * あっても、30分たてば次の起動が受け持ち直す
   */
  var claimed = dbWithLock_(5000, function () {
    if (props.getProperty('ARCHIVE_HOUSEKEPT_ON') === today) return false;
    var running = String(props.getProperty('ARCHIVE_HOUSEKEPT_RUNNING') || '').split('|');
    if (running[0] === today && Date.now() - Number(running[1]) < 30 * 60 * 1000) return false;
    props.setProperty('ARCHIVE_HOUSEKEPT_RUNNING', today + '|' + Date.now());
    return true;
  }, function () { return false; });
  if (!claimed) return [];

  try {
    // 台帳に main の行が無い古いリポジトリなら入れる。人に実行させない
    try {
      repoEnsureMainBranch();
    } catch (e0) {
      Logger.log('main の行を入れられませんでした: ' + e0.message);
    }

    // 誰も一覧を開かなくても、元の文書が消えた確認依頼は取り下げる
    try {
      prWithdrawOrphans();
    } catch (e) {
      Logger.log('消えた文書の確認依頼を取り下げられませんでした: ' + e.message);
    }
    var gone = issueHousekeep(new Date());

    // 済みの印は、終わってから付ける。先に付けると、途中で落ちた日は
    // やり直されないまま次の日になる
    props.setProperty('ARCHIVE_HOUSEKEPT_ON', today);
    return gone;
  } finally {
    props.deleteProperty('ARCHIVE_HOUSEKEPT_RUNNING');
  }
}
