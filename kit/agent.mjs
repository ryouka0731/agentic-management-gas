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
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { bantoHome, trackedFolders } from './track/hook.mjs';
import * as track from './track/track.mjs';
import * as update from './track/update.mjs';
import * as local from './track/local.mjs';

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

  // 番頭に作業を載せる仕掛けを入れた人は、どこからでも ~/.banto/kit/agent.mjs を呼ぶ
  const banto = update.paths(bantoHome()).config;
  if (fs.existsSync(banto)) {
    try {
      const c = JSON.parse(fs.readFileSync(banto, 'utf8'));
      if (c && c.queueDir) return { ...c, from: banto };
    } catch (e) {
      // 壊れていれば見なかったことにする (案内で「見つかりません」と出す)
    }
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
 * 命令の id は手元で作る。設定から読んだ id で入れ先の外を指させない。
 * kitup- は1日1回の確認が置くもの (片付けでほかの命令を消さないよう分ける)
 */
const ID_RE = /^kit(up)?-[0-9]+-[a-z0-9]+$/;

function commandFiles(queueDir, id) {
  if (!ID_RE.test(String(id))) throw new Error('命令の id が読めません: ' + id);
  return { cmd: path.join(queueDir, id + '.cmd.json'), out: path.join(queueDir, id + '.result.json') };
}

/**
 * 命令を1つ置く。待たない。
 *
 * @returns {string} 命令の id (結果を拾うときに使う)
 */
function placeCommand(queueDir, op, args, prefix = 'kit') {
  if (!fs.existsSync(queueDir)) {
    throw new Error('キューのフォルダがありません: ' + queueDir);
  }
  const id = prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(commandFiles(queueDir, id).cmd, JSON.stringify({ op, args: args || {} }, null, 2));
  return id;
}

/**
 * 置いた命令を片付ける。
 *
 * **残すと、同じ命令が何度も実行される。** 向こう側は命令を処理済みの
 * フォルダへ移すが、こちらに実体が残っていると、同期の都合で queue に
 * 戻ってくることがある。実際に「やることを1つ作ったのに、同じものが
 * 番号違いで複数できた」という形で現れた。
 *
 * 消せなくても操作は成立しているので、投げない。
 *
 * @param {boolean} [withResult] 届いた結果も消す (読まずに捨てるとき)
 */
function forgetCommand(queueDir, id, withResult) {
  const { cmd, out } = commandFiles(queueDir, id);
  for (const file of withResult ? [cmd, out] : [cmd]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {
      process.stderr.write('命令のファイルを片付けられませんでした: ' + file + '\n');
    }
  }
}

/**
 * 置いた命令の結果を1回だけ見る。待たない。
 *
 * @returns {object|null} まだ無い (書き込みの途中を含む) なら null
 */
function collectResult(queueDir, id) {
  const { out } = commandFiles(queueDir, id);
  if (!fs.existsSync(out)) return null;
  // 書き込みの途中を読むことがある。読めなければ、まだ無いことにする
  try {
    const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
    fs.unlinkSync(out);
    forgetCommand(queueDir, id);
    return parsed;
  } catch (e) {
    return null;
  }
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
  const id = placeCommand(queueDir, op, args);

  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const got = collectResult(queueDir, id);
    if (got) return got;
    await new Promise((done) => setTimeout(done, POLL_MS));
  }

  // 返らなかったときも片付ける。残すと、あとで拾われて一度だけ走る
  forgetCommand(queueDir, id);

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
    args: (a) => ({ number: num(a[0]), path: a[1], text: gitDiff(a[1], a[2]) }),
  },
  'patch-rm': {
    op: 'patchRemove',
    args: (a) => ({ number: num(a[0]), id: num(a[1]) }),
  },
  'patches': { op: 'patches', args: (a) => ({ number: num(a[0]) }) },

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
    args: (a) => ({ id: num(a[0]), result: a[1] || '' }),
  },
  'work-fail': {
    op: 'workFail',
    args: (a) => ({ id: num(a[0]), reason: a[1] || '' }),
  },
  'branch': { op: 'branchCreate', args: (a) => ({ name: a[0], fileId: a[1] }) },
  'issues': { op: 'issueList', args: (a) => ({ state: a[0] || '' }) },
  'issue': {
    op: 'issueCreate',
    args: (a) => ({ title: a[0], body: a[1] || '', linkedFileIds: a[2] ? [a[2]] : [] }),
  },
  'issue-update': {
    op: 'issueUpdate',
    args: (a) => ({ number: num(a[0]), patch: JSON.parse(a[1] || '{}') }),
  },
  'issue-close': { op: 'issueClose', args: (a) => ({ number: num(a[0]) }) },
  'issue-say': {
    op: 'issueComment',
    args: (a) => ({ number: num(a[0]), body: readInput(a[1]) }),
  },
  // 進捗ボードの列を動かす (Backlog / In Progress / In Review / Done)
  'board': {
    op: 'boardMove',
    args: (a) => ({ number: num(a[0]), column: a[1] }),
  },
  'issue-branch': {
    op: 'issueCreateBranch',
    args: (a) => ({ number: num(a[0]), fileId: a[1] }),
  },
  'prs': { op: 'prList', args: () => ({}) },
  'pr': {
    op: 'prCreate',
    args: (a) => ({
      title: a[0], body: a[1] || '', sourceBranch: a[2], mainFileId: a[3],
      targetBranch: a[4] || 'main',
    }),
  },
  'pr-preview': { op: 'prPreview', args: (a) => ({ number: num(a[0]) }) },
  'pr-merge': {
    op: 'prMerge',
    args: (a) => ({ number: num(a[0]), choices: a[1] ? JSON.parse(a[1]) : [] }),
  },
  'history': { op: 'commitHistory', args: (a) => ({ fileId: a[0] }) },
  'diff': {
    op: 'commitDiff',
    args: (a) => ({ fromSha: a[0] || '', toSha: a[1] }),
  },

  /*
   * エージェンティックスクラム (既定はオフ)。読み替えは SCRUM.md にある。
   *
   * オフのあいだは `scrum` 以外を向こうが断る。切り替える命令は置かない
   * (持ち主が画面の「設定」で決める)。
   */
  'scrum': { op: 'scrumState', args: () => ({}) },
  'sprints': { op: 'sprintList', args: () => ({}) },
  'sprint-add': {
    op: 'sprintCreate',
    args: (a) => ({ fields: {
      name: a[0], goal: a[1] || '', startDate: a[2] || '', endDate: a[3] || '' } }),
  },
  'sprint-edit': {
    op: 'sprintUpdate',
    args: (a) => ({ name: a[0], patch: JSON.parse(a[1] || '{}') }),
  },
  'scrum-view': { op: 'scrumView', args: (a) => ({ sprint: a[0] || '' }) },
  'impediments': { op: 'impedimentList', args: () => ({}) },
  'impediment': {
    op: 'impedimentCreate',
    args: (a) => ({ fields: { title: a[0], body: readInput(a[1]) } }),
  },
  'impediment-edit': {
    op: 'impedimentUpdate',
    args: (a) => ({ number: num(a[0]), patch: JSON.parse(a[1] || '{}') }),
  },
  'impediment-resolve': {
    op: 'impedimentResolve',
    args: (a) => ({ number: num(a[0]), resolution: readInput(a[1]) }),
  },
  'impediment-say': {
    op: 'impedimentComment',
    args: (a) => ({ number: num(a[0]), body: readInput(a[1]) }),
  },
  // 文書の記録 (history) とは別。やることや障害物の欄がどう変わったか
  'changes': { op: 'history', args: (a) => ({ target: a[0] }) },
};

/**
 * 自分の様子を見る命令 (#13)。番頭に頼み、返事を手元で読める形にして出す。
 *
 * 誰から見た様子かは、命令ファイルを置いた人で番頭が決める (分からなければ断る)。
 * 権限の仕組みではなく、結果は命令の入れ先を共有している人なら読める。
 * 探す語は送らない。一覧を取って手元で絞る (画面と同じ合わせ方)。
 */
const VIEWS = {
  'mine': {
    op: 'homeMine', args: () => ({}),
    show: (r) => local.formatMine(shaped(r, r && r.reviews && r.returned && r.due)),
  },
  'advice': { op: 'homeAdvice', args: () => ({}), show: (r) => local.formatAdvice(shaped(r, Array.isArray(r))) },
  'search': {
    op: 'searchIndex',
    args: (a) => {
      if (!a.join(' ').trim()) throw usageError('探す語を渡してください (例: node agent.mjs search 規程 第3条)');
      return {};
    },
    show: (r, a) => local.formatSearch(local.searchFilter(shaped(r, Array.isArray(r)), a.join(' '))),
  },
  // 'today' などの形を渡すとその形で。渡さなければ画面で選んでいる形
  'report': {
    op: 'reportDraft',
    args: (a) => {
      if (a[0] && !REPORT_KINDS.includes(a[0])) {
        throw usageError('日報の形は ' + REPORT_KINDS.join(' / ') + ' のどれかです: ' + a[0]);
      }
      return { kind: a[0] || '' };
    },
    show: (r) => local.reportFill(shaped(r, r && typeof r.template === 'string' && r.parts).template, r.parts),
  },
};

/** 返事が思っていた形か。違えば投げる (showView が JSON のまま出す) */
function shaped(r, ok) {
  if (!ok) throw new Error('返事の形が違います');
  return r;
}

/** 日報の形。番頭の REPORT_TEMPLATES() の key と custom (番頭も知らない形は断る) */
const REPORT_KINDS = ['three', 'today', 'plain', 'custom'];

/**
 * 返事を読める字にする。思っていた形と違えば (番頭が古い・新しいなど) 落とさずに JSON のまま出す。
 */
function showView(view, result, rest) {
  try {
    return view.show(result, rest);
  } catch (e) {
    return JSON.stringify(result, null, 2);
  }
}

/** 送る前に断る使い方の誤り (終わりの番号を 2 にする) */
function usageError(message) {
  const e = new Error(message);
  e.usage = true;
  return e;
}

/**
 * 番号の引数を数にする。読めなければ、送る前にここで断る。
 *
 * 数にできない字 ('abc') をそのまま Number にすると null として送られ、
 * 1分待ったあとに「#null が見つかりません」と返るだけになる。
 *
 * @param {string} value
 * @returns {number}
 */
function num(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('番号は 1 以上の整数で渡してください: ' + (value === undefined ? '(なし)' : value));
  }
  return n;
}

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
  lines.push('エージェンティックスクラム (使う人だけ):');
  lines.push('  AI のチームメンバーとスクラムで進める機能です。既定ではオフです。');
  lines.push('  使うなら、管理者 (持ち主かフォルダの編集者) が画面の「設定」でオンにしてください。');
  lines.push('  状態は node agent.mjs scrum で見られます。スキルとエージェントは');
  lines.push('  .claude/ に、読み替えは SCRUM.md にあります。');
  lines.push('');

  const linked = update.claudeLinked(track.claudeHome());
  lines.push('番頭に作業を載せる (Claude Code を使う人だけ):');
  lines.push('  node agent.mjs track install で、~/.claude にフック2つとスキル1つを足し、');
  lines.push('  道具を ~/.banto/kit に置きます。載せるフォルダは node agent.mjs track add で選びます。');
  lines.push('  道具は1日1回、新しい版を確かめて自動で入れ替わり、フックも次の依頼から新しいものが');
  lines.push('  自動で動きます (~/.banto/config.json に "autoUpdate": false と書くと知らせるだけになります)。');
  lines.push('  いま: ' + (linked ? '入っています' : '入っていません'));
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
 * この agent.mjs と一緒に置かれた公開鍵 (Web アプリから落とした zip の鍵)。無ければ ''。
 *
 * 入れるときは番頭から道具を受け取り直すので、その署名をこの鍵で確かめる。
 * 落とした zip が信頼の起点 (最初の1回)。
 */
function zipKey() {
  try {
    return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'track', 'kit-key.pem'), 'utf8');
  } catch (e) {
    return '';
  }
}

/** いま動いているのが ~/.banto/kit の道具か。自動の確認はそのときだけ */
function runningFromBanto() {
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };
  return real(path.dirname(fileURLToPath(import.meta.url))) === real(update.paths(bantoHome()).kit);
}

/** 命令の入れ先へ送る関数を、設定から作る */
function sender(config) {
  return (op, args) => send(config.queueDir, op, args);
}

/** 置いて・拾って・捨てる関数を、設定から作る (1日1回の確認は待たない) */
function queueHands(config) {
  return {
    place: (op, args) => placeCommand(config.queueDir, op, args, update.UPDATE_ID_PREFIX),
    collect: (id) => collectResult(config.queueDir, id),
    drop: (id) => forgetCommand(config.queueDir, id, true),
    // 捨てた待ちの結果は誰にも拾われずに残る。この確認が置いたものだけ片付ける
    sweep: (keepId, now) => {
      for (const name of update.staleUpdateFiles(fs.readdirSync(config.queueDir), now, keepId)) {
        try { fs.unlinkSync(path.join(config.queueDir, name)); } catch (e) { /* 次にまた試す */ }
      }
    },
  };
}

/**
 * 1日1回、道具の新しい版を確かめる。本来の命令の結果は変えない。
 *
 * **ここでは待たない。** 命令の返事は最大で数分かかり、Claude Code の Bash は
 * 2分で打ち切る。版を尋ねる命令を置いて帰り、返事は次に呼ばれたときに拾う
 * (update.tickUpdate)。
 *
 * 出すのは標準エラーだけ。標準出力は Claude が読む結果である。
 */
async function maybeUpdate() {
  if (!runningFromBanto()) return;
  const home = bantoHome();
  const config = update.readConfig(home);
  if (!config || !config.queueDir) return;
  try {
    const r = await update.tickUpdate({ home, claude: track.claudeHome(), ...queueHands(config) });
    if (r.updated) process.stderr.write('番頭の道具を新しくしました (' + r.version + ')。戻すときは node "' + fileURLToPath(import.meta.url) + '" update rollback\n');
  } catch (e) {
    process.stderr.write('道具の新しい版を確かめられませんでした: ' + (e.message || e) + '\n');
  }
}

/**
 * 入れる前に、入れるものと自動更新の危険・切り方を出す。
 *
 * **--yes でも必ず出す。** Claude が利用者に確かめずに --yes を付けたときも、
 * 何が入り、何が自動で動くのかが画面に残るようにする。出すのは標準エラー
 * (標準出力は Claude が読む結果)。
 */
async function confirmInstall(rest) {
  const home = bantoHome();
  const plan = [
    '次のものを入れます:',
    '  ' + path.join(track.claudeHome(), 'settings.json') + ' の hooks に2つ (今の設定は控えを取って残します)',
    '  ' + path.join(track.claudeHome(), 'skills', 'banto-track', 'SKILL.md'),
    '  ' + home + ' (道具の本体と設定)',
    '入れたあと、道具は1日1回番頭に新しい版を尋ね、あれば自動で入れ替えます。そのとき',
    '  ' + path.join(home, 'hooks', 'track-hook.mjs') + ' とスキルも新しくなり、Claude Code は',
    '  そのフックを次の依頼から (どのフォルダでも) 自動で動かします。',
    '自動で入れるのは番頭の署名が合うものだけです。Drive フォルダに書ける人が偽の返事を置いても入れません。',
    '危険: 署名できるのは秘密鍵を持つ人 (deploy する人) です。その人を信頼することになります。',
    '  控えと戻し (update rollback) で1つ前に戻せます。',
    '切る: ' + path.join(home, 'config.json') + ' に "autoUpdate": false と書くと、知らせるだけになります。',
  ].join('\n');
  process.stderr.write(plan + '\n');
  if (rest.includes('--yes')) return true;
  if (!process.stdin.isTTY) {
    process.stderr.write('入れてよいか尋ねられませんでした。--yes を付けて実行してください' +
      ' (Claude に頼むときは、利用者に上の危険と切り方を伝えて確かめてから --yes を付ける)\n');
    process.exitCode = 2;
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('入れますか [y/N] ');
  rl.close();
  return /^y/i.test(answer.trim());
}

async function runTrack(rest) {
  const home = bantoHome();
  const claude = track.claudeHome();
  const [sub, ...a] = rest;

  if (sub === 'install') {
    if (!(await confirmInstall(a))) return;
    const config = loadConfig();
    const r = await track.trackInstall({ home, claude, config, send: sender(config), pinnedKey: zipKey() });
    process.stdout.write('入れました (道具 ' + r.kit.version + ')。' +
      '載せるフォルダは node agent.mjs track add <フォルダ> で選んでください\n');
    return;
  }
  if (sub === 'uninstall') {
    track.uninstallHooks({ home, claude });
    process.stdout.write('フックとスキルを外しました (' + home + ' は残してあります)\n');
    return;
  }
  if (sub === 'add') { process.stdout.write(track.addFolder(home, a[0]).join('\n') + '\n'); return; }
  if (sub === 'remove') { process.stdout.write(track.removeFolder(home, a[0]).join('\n') + '\n'); return; }
  if (sub === 'list') {
    const list = trackedFolders(home);
    process.stdout.write((list.length ? list.join('\n') : '(載せるフォルダはありません)') + '\n');
    return;
  }
  if (sub === 'set') { track.setIssue(home, a[0], a[1], a.slice(2).join(' ')); return; }
  if (sub === 'touch') { track.touch(home, a[0]); return; }
  if (sub === 'clear') { track.clearIssue(home, a[0]); return; }

  process.stderr.write('track の後には install / uninstall / add / remove / list / set / touch / clear のどれかを書いてください\n');
  process.exitCode = 2;
}

async function runUpdate(rest) {
  const home = bantoHome();
  const claude = track.claudeHome();
  if (rest[0] === 'rollback') {
    // 置いたままの確認も捨てる。残すと、あとで届いた中身で戻した先から入れ替わる
    const c = update.readConfig(home);
    const r = update.rollback({ home, claude, drop: c && c.queueDir ? queueHands(c).drop : undefined });
    process.stdout.write(r.restored + ' の控えに戻しました。この版は自動では入れ直しません\n');
    return;
  }
  const config = update.readConfig(home);
  if (!config || !config.queueDir) throw new Error('まだ入れていません。先に node agent.mjs track install を実行してください');
  // 手で頼んだときは待つ。置いたまま拾っていない確認は、二重にならないよう捨てる
  update.dropPending(home, queueHands(config).drop);
  // 置き場に鍵が無い (署名の前の道具) なら、落とした zip の鍵で確かめる
  const r = await update.checkForUpdate({ home, claude, send: sender(config), force: true, manual: true,
    pinnedKey: update.readPinnedKey(home) || zipKey() });
  process.stdout.write(r.updated
    ? '新しくしました (' + r.version + '): ' + (r.changed.join(', ') || '変わったファイルなし') + '\n'
    : 'いまの道具が最新です\n');
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
  lines.push('自分の様子を見る (本人のぶんだけ返る):');
  lines.push('  mine                   あなたの番 (確かめてほしい確認依頼・戻ってきたもの・期限)');
  lines.push('  advice                 改善のヒント');
  lines.push('  search <語…>           文書・やること・確認依頼などを題名で探す');
  lines.push('  report [today]         今日の日報の下書き (形を渡さなければ画面で選んでいる形)');
  lines.push('  doctor                 番頭に頼まずに、設定・入れ先・返事・道具の版・フックを点検する');

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
  lines.push('  agent board 5 "In Progress"             # 進捗ボードの列を動かす');
  lines.push('  agent scrum                            # スクラムがオンか (既定はオフ)');
  lines.push('  agent sprint-add sprint001 "申請の流れ" 2026-10-01 2026-10-14');
  lines.push('  agent impediment-resolve 3 "代理が承認"');
  lines.push('  agent track install                    # Claude Code の作業を番頭に載せる仕掛けを入れる');
  lines.push('  agent track add .                      # いまのフォルダを載せる');
  lines.push('  agent update                           # 道具の新しい版を今すぐ確かめて入れる');
  lines.push('  agent update rollback                  # 1つ前の道具に戻す');
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

  // 仕掛けと道具の更新は手元で済む (track install と update は中で命令を送る)
  if (name === 'track') { await runTrack(process.argv.slice(3)); return; }
  if (name === 'update') { await runUpdate(process.argv.slice(3)); return; }

  // 点検は番頭に頼まない。届かないときに使うものなので
  if (name === 'doctor') {
    const r = local.doctor({ config: findConfig(), home: bantoHome(), claude: track.claudeHome() });
    process.stdout.write(r.text + '\n');
    if (!r.ok) process.exitCode = 1;
    return;
  }

  const view = VIEWS[name];
  const entry = OPS[name] || view;
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
  let args;
  try {
    args = entry.args(rest);
  } catch (e) {
    if (!e.usage) throw e;
    process.stderr.write(e.message + '\n');
    process.exitCode = 2;
    return;
  }
  const config = loadConfig();
  const res = await send(config.queueDir, entry.op, args);

  if (view && res.ok) process.stdout.write(showView(view, res.result, rest) + '\n');
  else process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  if (!res.ok) process.exitCode = 1;
  await maybeUpdate();
}

main().catch((err) => {
  process.stderr.write(String(err.message || err) + '\n');
  process.exitCode = 1;
});
