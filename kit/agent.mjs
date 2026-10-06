#!/usr/bin/env node
/**
 * SoftBanto (通称 番頭) を、手元から動かすための道具。
 *
 * この道具が置かれている環境では Apps Script API が使えないため、
 * Drive 上のフォルダに命令のファイルを置き、向こう側の時間主導
 * トリガーが拾って実行し、結果のファイルを書き戻す形になっている。
 *
 *   手元 --(<id>.cmd.json)--> Drive の queue/ --(1分以内)--> 実行
 *   手元 <--(<id>.result.json)-- Drive の queue/ <-------------+
 *
 * したがって、この道具に要るのは Google Drive for desktop で
 * 同期されたローカルのパスだけである。鍵もトークンも要らない。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const CONFIG_NAMES = ['.agentkit.json', 'agentkit.json'];

/** 結果を待つ上限 (ミリ秒)。向こうのトリガーは1分間隔で回る */
const WAIT_MS = 180000;

/** 結果を見に行く間隔 */
const POLL_MS = 2000;

/**
 * 設定を読む。
 *
 * 探す順番は「引数 → 環境変数 → いまの場所から上へ → ホーム」。
 * 置き場所を1つに決めると、複数のリポジトリを行き来するときに困る。
 *
 * @returns {{queueDir: string}}
 */
function loadConfig() {
  const found = findConfig();
  if (found) return found;

  throw new Error(
    '設定が見つかりません。まず `node agent.mjs setup` を実行してください。\n' +
    '何が要るか、どこから取るかがその場に出ます'
  );
}

/**
 * 設定を探す。見つからなければ null を返す。
 *
 * 初回案内は「見つからない」を異常として扱わないため、投げずに返す。
 *
 * @returns {{queueDir: string, from: string}|null}
 */
function findConfig() {
  const fromArg = argValue('--queue');
  if (fromArg) return { queueDir: fromArg, from: '--queue' };

  if (process.env.AGENTKIT_QUEUE) {
    return { queueDir: process.env.AGENTKIT_QUEUE, from: 'AGENTKIT_QUEUE' };
  }

  let dir = process.cwd();
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const at = path.join(dir, name);
      if (fs.existsSync(at)) {
        return { ...JSON.parse(fs.readFileSync(at, 'utf8')), from: at };
      }
    }

    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }

  const home = path.join(os.homedir(), '.agentkit.json');
  if (fs.existsSync(home)) {
    return { ...JSON.parse(fs.readFileSync(home, 'utf8')), from: home };
  }
  return null;
}

/**
 * @param {string} name
 * @returns {string} 見つからなければ空文字
 */
function argValue(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? String(process.argv[at + 1] || '') : '';
}

/**
 * 命令を1つ送り、結果を待つ。
 *
 * @param {string} queueDir
 * @param {string} op
 * @param {object} args
 * @returns {Promise<object>}
 */
async function send(queueDir, op, args) {
  if (!fs.existsSync(queueDir)) {
    throw new Error('キューのフォルダがありません: ' + queueDir);
  }

  const id = 'kit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const cmd = path.join(queueDir, id + '.cmd.json');
  const out = path.join(queueDir, id + '.result.json');

  fs.writeFileSync(cmd, JSON.stringify({ op, args: args || {} }, null, 2));

  /**
   * 置いた命令を片付ける。
   *
   * **残すと、同じ命令が何度も実行される。** 向こう側は命令を処理済みの
   * フォルダへ移すが、こちらに実体が残っていると、同期の都合で queue に
   * 戻ってくることがある。実際に「やることを1つ作ったのに、同じものが
   * 番号違いで複数できた」という形で現れた。
   *
   * 消せなくても操作は成立しているので、投げない。
   */
  function forget() {
    try {
      if (fs.existsSync(cmd)) fs.unlinkSync(cmd);
    } catch (e) {
      process.stderr.write('命令のファイルを片付けられませんでした: ' + cmd + '\n');
    }
  }

  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    if (fs.existsSync(out)) {
      // 書き込みの途中を読むことがある。読めるまで少し待つ
      try {
        const text = fs.readFileSync(out, 'utf8');
        const parsed = JSON.parse(text);
        fs.unlinkSync(out);
        forget();
        return parsed;
      } catch (e) {
        // まだ書き終わっていない
      }
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }

  // 返らなかったときも片付ける。残すと、あとで拾われて一度だけ走る
  forget();

  throw new Error(
    '結果が返りませんでした。向こう側で setupCommandQueue() を実行しているか、' +
    'Drive の同期が動いているかを確かめてください'
  );
}

/**
 * 使える操作と、その引数。
 *
 * ここに無い操作は向こう側でも実行されない。命令のフォルダは Drive を
 * 共有している人なら誰でも書けるため、向こう側が受け付ける操作を
 * 絞ってある。
 */
const OPS = {
  'files': { op: 'listFiles', args: () => ({}) },
  'status': { op: 'status', args: (a) => ({ fileId: a[0] }) },
  'read': { op: 'readMarkdown', args: (a) => ({ fileId: a[0] }) },
  'write': {
    op: 'writeMarkdown',
    args: (a) => ({ fileId: a[0], markdown: readInput(a[1]) }),
  },
  'commit': {
    op: 'commit',
    args: (a) => ({ fileId: a[0], message: a[1] }),
  },
  'stash': { op: 'stashMainDrift', args: (a) => ({ fileId: a[0] }) },

  /*
   * コードの変更を確認依頼に添える。
   *
   * **差分を取るのは手元である。** 向こう側 (Apps Script) では git の
   * オブジェクトを読めない。loose object は raw deflate で、Apps Script には
   * raw inflate が無く、packfile はさらに delta チェーンになっている。
   *
   * 添えても反映はされない。この道具はコードの版管理をしない。入れるのは
   * 手元の git で、向こうに残るのは「読んで進めてよいと決めた」記録だけ。
   */
  'patch': {
    op: 'patchAdd',
    args: (a) => ({ number: Number(a[0]), path: a[1], text: gitDiff(a[1], a[2]) }),
  },
  'patch-rm': {
    op: 'patchRemove',
    args: (a) => ({ number: Number(a[0]), id: Number(a[1]) }),
  },
  'patches': { op: 'patches', args: (a) => ({ number: Number(a[0]) }) },

  /*
   * 向こうから頼まれたことを取りに来る。
   *
   * **取るだけで、この道具は何も実行しない。** 頼みごとの表は Drive を
   * 共有している人なら手で書き換えられるので、ここで実行する作りにすると、
   * Drive に書ける人が全員の手元マシンで好きなコマンドを走らせられる。
   *
   * 中身は Claude に見せるところまで。何をするかは人と Claude が決める。
   */
  'work': { op: 'work', args: (a) => ({ limit: Number(a[0]) || 5 }) },
  'work-done': {
    op: 'workDone',
    args: (a) => ({ id: Number(a[0]), result: a[1] || '' }),
  },
  'work-fail': {
    op: 'workFail',
    args: (a) => ({ id: Number(a[0]), reason: a[1] || '' }),
  },
  'branch': { op: 'branchCreate', args: (a) => ({ name: a[0], fileId: a[1] }) },
  'issues': { op: 'issueList', args: (a) => ({ state: a[0] || '' }) },
  'issue': {
    op: 'issueCreate',
    args: (a) => ({ title: a[0], body: a[1] || '', linkedFileIds: a[2] ? [a[2]] : [] }),
  },
  'issue-update': {
    op: 'issueUpdate',
    args: (a) => ({ number: Number(a[0]), patch: JSON.parse(a[1] || '{}') }),
  },
  'issue-close': { op: 'issueClose', args: (a) => ({ number: Number(a[0]) }) },
  'issue-say': {
    op: 'issueComment',
    args: (a) => ({ number: Number(a[0]), body: readInput(a[1]) }),
  },
  'issue-branch': {
    op: 'issueCreateBranch',
    args: (a) => ({ number: Number(a[0]), fileId: a[1] }),
  },
  'prs': { op: 'prList', args: () => ({}) },
  'pr': {
    op: 'prCreate',
    args: (a) => ({
      title: a[0], body: a[1] || '', sourceBranch: a[2], mainFileId: a[3],
      targetBranch: a[4] || 'main',
    }),
  },
  'pr-preview': { op: 'prPreview', args: (a) => ({ number: Number(a[0]) }) },
  'pr-merge': {
    op: 'prMerge',
    args: (a) => ({ number: Number(a[0]), choices: a[1] ? JSON.parse(a[1]) : [] }),
  },
  'history': { op: 'commitHistory', args: (a) => ({ fileId: a[0] }) },
  'diff': {
    op: 'commitDiff',
    args: (a) => ({ fromSha: a[0] || '', toSha: a[1] }),
  },
};

/**
 * 引数が「-」なら標準入力から読む。長い本文を渡すため。
 *
 * @param {string} value
 * @returns {string}
 */
function readInput(value) {
  if (value !== '-') return String(value === undefined ? '' : value);
  return fs.readFileSync(0, 'utf8');
}

/**
 * 初回の案内を組む。
 *
 * この道具は鍵もトークンも要らない代わりに、**人にしか取れない場所が
 * 3つある**。それを知らないまま `agent files` を叩くと「設定が
 * 見つかりません」で止まり、次に何をすればよいか分からない。
 *
 * 向こう側 (Drive / Apps Script) には手元から触れないため、ここで
 * 出せるのは「どこから取るか」までである。**当てずに人に聞くこと。**
 *
 * @returns {string}
 */
function setupGuide() {
  const config = findConfig();
  const queueDir = config ? String(config.queueDir || '') : '';
  const queueOk = queueDir !== '' && fs.existsSync(queueDir);
  const lines = [];

  lines.push('SoftBanto (番頭) を手元から動かすための下ごしらえ');
  lines.push('');
  lines.push('この道具に鍵やトークンは要りません。要るのは次の3つです。');
  lines.push('');
  lines.push('1. 画面 (Web アプリ) のリンク');
  lines.push('   例 https://script.google.com/macros/s/AKfycb.../exec');
  lines.push('   道具を配っている人から渡されています。反映の承認など、');
  lines.push('   人が決める操作はここでしか行えません。');
  lines.push('   .agentkit.json の webAppUrl に書いておくと、人に頼む');
  lines.push('   ときにそのまま渡せます。');
  lines.push('');
  lines.push('2. 命令の入れ先 (queue フォルダ) の、手元でのパス');
  lines.push('   画面の右上の自分の顔 →「手元から動かす道具を落とす」を');
  lines.push('   押すと、Drive の中での道のりが写せる形で出ます。');
  lines.push('   Google Drive for desktop で同期したフォルダの下に、');
  lines.push('   同じ道のりが出来ているので、そこを指してください。');
  lines.push('');
  lines.push('3. Apps Script のリンク (最初の一人だけ)');
  lines.push('   例 https://script.google.com/home/projects/<id>/edit');
  lines.push('   まだ誰も setupCommandQueue() を実行していないときだけ');
  lines.push('   要ります。実行済みなら触る必要はありません。');
  lines.push('');
  lines.push('いまの状態:');
  lines.push('  設定: ' + (config ? config.from : '見つかりません'));
  lines.push('  入れ先: ' + (queueDir || '未設定'));
  lines.push('  入れ先が手元にあるか: ' + (queueOk ? 'あります' : 'ありません'));
  lines.push('  画面: ' + (config && config.webAppUrl ? config.webAppUrl
    : '未設定 (人に決めてもらう操作を頼むときに要る)'));
  lines.push('  Apps Script: ' + (config && config.scriptUrl ? config.scriptUrl
    : '未設定 (最初の一人の下ごしらえが済んでいれば要らない)'));
  lines.push('');

  if (!config) {
    lines.push('次にすること: agentkit.example.json を .agentkit.json として');
    lines.push('写し、queueDir に 2 のパスを書いてください。');
  } else if (!queueOk) {
    lines.push('次にすること: queueDir の指す場所がありません。Drive for');
    lines.push('desktop が同期しているか、道のりの綴りを確かめてください。');
  } else {
    lines.push('次にすること: node agent.mjs files を実行してください。');
    lines.push('文書の一覧が返れば通っています。**返るまで最大1分**かかり、');
    lines.push('すぐ返らないのは異常ではありません。');
  }
  return lines.join('\n');
}

/**
 * 手元で差分を取る。
 *
 * 既定は「まだ記録していないぶん」(`git diff HEAD`)。第2引数を渡すと
 * `git diff <そこ>` になるので、`main` を渡せばブランチ全体の差分になる。
 *
 * git が無い / リポジトリでない場合は、何が足りないのかを言って止まる。
 * 黙って空の差分を送ると、読む人が「変更が無い」と誤解する。
 *
 * @param {string} path
 * @param {string} [against]
 * @returns {string} unified diff
 */
function gitDiff(path, against) {
  if (!path) throw new Error('どのファイルの差分か渡してください');

  // 比べる先は頼みごと (outbox の against) から渡りうる。'-' で始まると git の
  // オプションとして読まれ、--output=<ファイル> で手元のファイルに書き出せて
  // しまう。Drive に書ける人が、手元のファイルを書き換えられることになる
  if (against && String(against).charAt(0) === '-') {
    throw new Error("比べる先に '-' で始まるものは渡せません: " + against);
  }

  const args = ['diff', '--no-color'];
  if (against) args.push(against);
  args.push('--', path);

  let out;
  try {
    out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    throw new Error(
      'git で差分を取れませんでした。git が入っているか、いまいる場所が' +
      'リポジトリかを確かめてください: ' + (e.message || e)
    );
  }

  if (!out.trim()) {
    throw new Error(
      path + ' に差分がありません。記録していない変更が無いか、' +
      '道のりが違うかのどちらかです (比べる先は第3引数で渡せます)'
    );
  }
  return out;
}

function usage() {
  const lines = [
    'SoftBanto (番頭) を手元から動かす道具',
    '',
    '  agent <操作> [引数...]',
    '',
    '使える操作:',
  ];

  for (const name of Object.keys(OPS)) lines.push('  ' + name);

  lines.push('');
  lines.push('例:');
  lines.push('  agent files');
  lines.push('  agent issue "第3条を直す" "根拠は…"');
  lines.push('  agent read <fileId> > body.md');
  lines.push('  cat body.md | agent write <fileId> -');
  lines.push('  agent commit <fileId> "第3条を改訂"');
  lines.push('  agent patch 3 src/core/Usage.gs        # 未記録のぶんを添える');
  lines.push('  agent patch 3 src/core/Usage.gs main   # main との差を添える');
  lines.push('  agent patches 3                        # 添えたものを見る');
  lines.push('  agent work                             # 頼まれたことを取る');
  lines.push('  agent work-done 5 "取り込みました"      # 終わったと返す');
  lines.push('  agent pr "第3条の改訂" "" 見直し <mainFileId>');
  lines.push('  setup   (何が要るか、いまどこまで出来ているかを出す)');
  lines.push('');
  lines.push('はじめてなら、まず agent setup を実行する');
  lines.push('キューの場所は .agentkit.json か --queue か AGENTKIT_QUEUE で渡す');

  return lines.join('\n');
}

async function main() {
  const name = process.argv[2];
  if (!name || name === '--help' || name === '-h') {
    process.stdout.write(usage() + '\n');
    return;
  }

  // 下ごしらえは向こう側に命令を送らない。設定が無い状態でも読めなければ
  // 案内の意味がない
  if (name === 'setup') {
    process.stdout.write(setupGuide() + '\n');
    return;
  }

  const entry = OPS[name];
  if (!entry) {
    process.stderr.write('知らない操作です: ' + name + '\n\n' + usage() + '\n');
    process.exitCode = 2;
    return;
  }

  // --queue とその値を除く。値を残すと、ほかの引数に混ざって別のものを指す
  const rest = [];
  const given = process.argv.slice(3);
  for (let i = 0; i < given.length; i++) {
    if (given[i] === '--queue') { i++; continue; }
    rest.push(given[i]);
  }
  const config = loadConfig();
  const res = await send(config.queueDir, entry.op, entry.args(rest));

  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  if (!res.ok) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err.message || err) + '\n');
  process.exitCode = 1;
});
