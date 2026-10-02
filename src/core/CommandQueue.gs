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

    /*
     * コードの変更を添える。
     *
     * 承認 (prReview) を入れないのと違って、これは足しても危なくない。
     * 証跡を置くだけで、反映も承認もしない。
     *
     * 手元で git diff を走らせて送る形にしてある。GAS 側では git の
     * オブジェクトを読めない
     */
    patchAdd: function (a) {
      return apiPrPatchAdd(a.number, a.path, a.text);
    },
    patchRemove: function (a) { return apiPrPatchRemove(a.number, a.id); },
    patches: function (a) { return apiPrPatches(a.number); },

    /*
     * 頼みごとを取りに来る / 結果を返す。
     *
     * **取るだけで、ここでは何も実行しない。** 中身は手元の Claude に
     * 見せるところまでで、何をするかは人と Claude が決める。
     */
    work: function (a) { return apiOutboxTake(a.limit || 5); },
    workDone: function (a) { return apiOutboxDone(a.id, a.result || ''); },
    workFail: function (a) { return apiOutboxFail(a.id, a.reason || ''); },
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

  /*
   * **一度実行した命令は二度実行しない。**
   *
   * 「処理済みへ移す」だけでは足りない。命令は手元が Drive の同期フォルダに
   * 置いたもので、手元にはその実体が残り続ける (道具が消していなかった)。
   * 同期の都合で `queue/` に戻ってくると、次の起動でもう一度実行される。
   *
   * 実際に「やることを1つ作ったのに、同じものが番号違いで複数できた」と
   * いう形で現れた。作る命令なので、走った回数だけ増える。
   *
   * 処理済みのフォルダに同じ名前があれば、それは既に走ったものである。
   * 実行せずに queue から外すだけにする。
   */
  if (commandAlreadyRan_(done, file.getName())) {
    Logger.log('既に実行済みの命令でした: ' + file.getName());
    commandRetire_(file, queue, done);
    return;
  }

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

  /*
   * **処理済みへ移してから結果を書く。**
   *
   * 逆にすると、結果を書いた直後に実行が打ち切られた場合 (6分の上限など)
   * 命令が queue に残り、次の起動でもう一度走る。
   */
  commandRetire_(file, queue, done);

  queue.createFile(id + '.result.json', JSON.stringify(result), MimeType.PLAIN_TEXT);
}

/**
 * 命令を queue から引き上げる。
 *
 * **2つ呼ぶ必要がある。** Drive のファイルは複数のフォルダに属せるため、
 * `addFile` だけでは queue に残り、`removeFile` だけでは行き先が無くなる。
 *
 * 実行した命令も、戻ってきた命令も、同じ道で片付ける。片方だけ別扱いに
 * すると、片方が queue に残って毎回の起動で見に来ることになる。
 *
 * @param {GoogleAppsScript.Drive.File} file
 * @param {GoogleAppsScript.Drive.Folder} queue
 * @param {GoogleAppsScript.Drive.Folder} done
 */
function commandRetire_(file, queue, done) {
  done.addFile(file);
  queue.removeFile(file);
}

/**
 * その名前の命令が既に走ったか。
 *
 * @param {GoogleAppsScript.Drive.Folder} done 処理済みのフォルダ
 * @param {string} name 命令のファイル名
 * @returns {boolean}
 */
function commandAlreadyRan_(done, name) {
  return done.getFilesByName(name).hasNext();
}

/**
 * キューを1回処理する。時間主導トリガーから呼ばれる。
 *
 * @returns {string} 処理件数の要約
 */
function processCommandQueue() {
  // 1分ごとに呼ばれるので、取れなければ次の回に回せばよい
  return dbWithLock_(10000, function () {
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
  }, function () { return '他の処理が実行中です'; });
}
