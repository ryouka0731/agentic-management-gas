/**
 * 1回の起動で処理する命令の上限。
 *
 * GAS の実行時間上限は6分である。1件あたりの重さが読めないため、
 * 上限を設けて次の起動に回す。
 *
 * @returns {number}
 */
function COMMAND_QUEUE_BATCH() {
  return 10;
}

/**
 * キューから実行できる操作の表。
 *
 * **ここに無い op は実行しない。** キューは Drive の共有相手なら誰でも
 * 書けるため、op を任意の関数名にすると事実上の RPC になってしまう。
 *
 * prReview を含めないのは意図的である。トリガーはオーナー権限で走るため、
 * キュー経由の承認は常に自己承認になる。承認は人が画面で行う操作として残す。
 *
 * @returns {Object<string, function>}
 */
function COMMAND_OPS() {
  return {
    listFiles: function () { return apiListFiles(); },
    status: function (a) { return apiFileStatus(a.fileId); },
    readMarkdown: function (a) { return apiGetMarkdown(a.fileId); },
    writeMarkdown: function (a) { return apiSaveMarkdown(a.fileId, a.markdown); },
    commit: function (a) {
      return apiCommit(a.fileId, a.message, a.expectedHeadSha || null);
    },
    stashMainDrift: function (a) { return apiStashMainDrift(a.fileId); },
    branchCreate: function (a) { return apiBranchCreate(a.name, a.fileId); },
    issueCreate: function (a) {
      return apiIssueCreate(a.title, a.body, a.linkedFileIds || []);
    },
    issueCreateBranch: function (a) {
      return apiIssueCreateBranch(a.number, a.fileId);
    },
    prCreate: function (a) {
      return apiPrCreate(a.title, a.body, a.sourceBranch, a.mainFileId,
        a.targetBranch || 'main');
    },
    prPreview: function (a) { return apiPrPreview(a.number); },
    prMerge: function (a) { return apiPrMerge(a.number, a.choices || []); },

    // 読むだけのものは足しても危なくない。手元から様子を見るために要る
    issueList: function (a) { return apiIssueList(a.state || ''); },
    prList: function () { return apiPrList(); },
    commitHistory: function (a) { return apiCommitHistory(a.fileId); },
    commitDiff: function (a) { return apiCommitDiff(a.fromSha || '', a.toSha); },

    // 書くものは issueCreate と同じ重さのものだけにする
    issueUpdate: function (a) { return apiIssueUpdate(a.number, a.patch || {}); },
    issueClose: function (a) { return apiIssueClose(a.number); },
    issueComment: function (a) { return apiIssueComment(a.number, a.body); },
  };
}

/**
 * キュー用のフォルダを返す。無ければ作って設定に書き戻す。
 *
 * 既存のリポジトリには queue が無いため、移行関数を人に実行させずに
 * 参照時へ寄せる。
 *
 * @param {string} key repoConfig 内のキー
 * @param {string} name フォルダ名
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function queueFolder_(key, name) {
  var config = repoConfig();

  if (config[key]) {
    try {
      return DriveApp.getFolderById(config[key]);
    } catch (e) {
      // 手で消された場合は作り直す
    }
  }

  var folder = DriveApp.getFolderById(config.gitId).createFolder(name);
  config[key] = folder.getId();
  PropertiesService.getScriptProperties()
    .setProperty(REPO_CONFIG_KEY(), JSON.stringify(config));
  return folder;
}

/**
 * 未処理の命令と結果を置くフォルダ。
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function commandQueueFolder_() {
  return queueFolder_('queueId', 'queue');
}

/**
 * 処理済みの命令を移すフォルダ。
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function commandDoneFolder_() {
  return queueFolder_('queueDoneId', 'queue-done');
}

/**
 * 命令を1つ実行する。
 *
 * @param {object} cmd {op, args}
 * @returns {*} op の戻り値
 */
function runCommand_(cmd) {
  var ops = COMMAND_OPS();
  var op = String(cmd && cmd.op ? cmd.op : '');

  if (!Object.prototype.hasOwnProperty.call(ops, op)) {
    throw new Error('実行できない操作です: ' + op);
  }
  return ops[op](cmd.args || {});
}

/**
 * 命令ファイルを1つ処理し、結果を書き出して queue-done に移す。
 *
 * 1件の失敗でキュー全体を止めないため、例外は握って ok:false にする。
 *
 * @param {GoogleAppsScript.Drive.File} file
 * @param {GoogleAppsScript.Drive.Folder} queue
 * @param {GoogleAppsScript.Drive.Folder} done
 */
function runCommandFile_(file, queue, done) {
  var id = file.getName().replace(/\.cmd\.json$/, '');
  var op = '';
  var result;

  try {
    var cmd = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    op = String(cmd && cmd.op ? cmd.op : '');
    result = { ok: true, op: op, result: runCommand_(cmd) };
  } catch (e) {
    result = { ok: false, op: op, error: e.message };
  }
  result.at = new Date().toISOString();

  queue.createFile(id + '.result.json', JSON.stringify(result), MimeType.PLAIN_TEXT);

  // 処理済みにする。移さないと次の起動で二度実行される
  done.addFile(file);
  queue.removeFile(file);
}

/**
 * キューを1回処理する。時間主導トリガーから呼ばれる。
 *
 * @returns {string} 処理件数の要約
 */
function processCommandQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return '他の処理が実行中です';

  try {
    var queue = commandQueueFolder_();
    var done = commandDoneFolder_();

    // イテレータを回しながらファイルを移動すると取りこぼす。
    // 先に対象を集めてから処理する
    var targets = [];
    var it = queue.getFiles();
    while (it.hasNext() && targets.length < COMMAND_QUEUE_BATCH()) {
      var f = it.next();
      if (/\.cmd\.json$/.test(f.getName())) targets.push(f);
    }

    for (var i = 0; i < targets.length; i++) {
      runCommandFile_(targets[i], queue, done);
    }

    // 置き場の片付けもここに相乗りさせる (1日1回で自分でせき止める)
    if (typeof housekeepArchiveDaily_ === 'function') housekeepArchiveDaily_();

    return targets.length + '件処理しました';
  } finally {
    lock.releaseLock();
  }
}
