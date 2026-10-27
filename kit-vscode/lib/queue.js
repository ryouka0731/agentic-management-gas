'use strict';
/*
 * 番頭への頼み方。手元の道具 (kit/agent.mjs) と同じ入れ先・同じファイルの形で、命令を置いて結果を拾う。
 *
 *   拡張 --(<id>.cmd.json)--> Drive の queue/ --(1分以内)--> 番頭が実行
 *   拡張 <--(<id>.result.json)-- Drive の queue/
 *
 * **agent.mjs を子プロセスで呼ばないのは**、agent.mjs が受け付ける操作が決まっていて (OPS / VIEWS)、
 * 予定 (calendarToday) を頼む口が無く、自分の番 (mine) も読める字に整えてから出すため。足すには配る道具の中身を
 * 変えて版を上げる必要がある。入れ先の決め方 (agentkit.json の queueDir) と置き方・片付け方は agent.mjs と揃える。
 *
 * - 結果を受け取ったら命令と結果の両方を消す。残すと、同期の都合で queue/ に戻って二度走る (docs/dev/command-queue.md)
 * - 返らなかったときも命令を消す (あとで拾われて一度だけ走るのを防ぐ)
 * - id の頭は vsc。手元の道具の片付け (kit / kitup) と混ざらない
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const logic = require('./logic');

const CONFIG_NAMES = ['.agentkit.json', 'agentkit.json'];
const ID_RE = /^vsc-[0-9]+-[a-z0-9]+$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * 入れ先を探す。見つからなければ {queueDir: '', reason} を返す (投げない。案内を出して何もしないため)。
 *
 * 探す順番: 設定 banto.kitDir のフォルダの agentkit.json → 環境変数 AGENTKIT_QUEUE → ~/.agentkit.json → ~/.banto/config.json
 * (agent.mjs の findConfig と同じ置き場。いまの場所から上へは探さない。VS Code の開いているフォルダで変わると困るため)
 *
 * @param {{kitDir?: string, env?: object, home?: string}} o
 * @returns {{queueDir: string, from: string, reason: string}}
 */
function findQueue(o) {
  const kitDir = String((o && o.kitDir) || '').trim();
  const env = (o && o.env) || {};
  const home = (o && o.home) || os.homedir();
  const tried = [];
  const candidates = [];
  if (kitDir) for (const name of CONFIG_NAMES) candidates.push(path.join(kitDir, name));
  for (const at of candidates) {
    tried.push(at);
    const c = readJson(at);
    if (c && c.queueDir) return check(String(c.queueDir), at);
  }
  if (env.AGENTKIT_QUEUE) return check(String(env.AGENTKIT_QUEUE), 'AGENTKIT_QUEUE');
  for (const at of [path.join(home, '.agentkit.json'), path.join(home, '.banto', 'config.json')]) {
    tried.push(at);
    const c = readJson(at);
    if (c && c.queueDir) return check(String(c.queueDir), at);
  }
  return {
    queueDir: '', from: '',
    reason: kitDir
      ? '手元の道具の設定が見つかりません (' + kitDir + ' に agentkit.json がありません)。道具のフォルダで node agent.mjs setup を実行してください'
      : '手元の道具のフォルダが決まっていません。設定の「番頭: 道具のフォルダ」(banto.kitDir) に、道具を解凍したフォルダを入れてください',
  };
}

function check(queueDir, from) {
  if (!fs.existsSync(queueDir)) {
    return { queueDir: '', from, reason: '命令の入れ先がありません: ' + queueDir + ' (Google Drive for desktop が同期しているか確かめてください)' };
  }
  return { queueDir, from, reason: '' };
}

/**
 * 命令の入れ先とのやりとり。
 *
 * @param {string} queueDir
 * @param {{waitMs?: number, pollMs?: number, sleep?: function(number): Promise<void>, now?: function(): number}} [opts]
 */
function makeQueue(queueDir, opts) {
  const o = opts || {};
  const waitMs = o.waitMs || 4 * 60 * 1000;
  const pollMs = o.pollMs || 3000;
  const sleep = o.sleep || ((ms) => new Promise((done) => setTimeout(done, ms)));
  const now = o.now || Date.now;
  const pending = new Set();

  function files(id) {
    if (!ID_RE.test(id)) throw new Error('命令の id が読めません: ' + id);
    return { cmd: path.join(queueDir, id + '.cmd.json'), out: path.join(queueDir, id + '.result.json') };
  }

  function forget(id) {
    const f = files(id);
    for (const file of [f.cmd, f.out]) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) {
        // 消せなくても頼んだことは成り立っている
      }
    }
    pending.delete(id);
  }

  function place(op, args) {
    if (!fs.existsSync(queueDir)) throw new Error('命令の入れ先がありません: ' + queueDir);
    const id = 'vsc-' + now() + '-' + Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, '0');
    // 書きかけを拾われないよう、別名で書いてから名前を変える (Drive の同期は書き終える前に送ることがある)
    const tmp = files(id).cmd + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ op, args: args || {} }, null, 2));
    fs.renameSync(tmp, files(id).cmd);
    pending.add(id);
    return id;
  }

  /** 結果を1回だけ見る。まだ無い (書きかけを含む) なら undefined */
  function collect(id) {
    const out = files(id).out;
    if (!fs.existsSync(out)) return undefined;
    let text;
    try {
      text = fs.readFileSync(out, 'utf8');
      JSON.parse(text);
    } catch (e) {
      return undefined; // 書きかけ。次に見る
    }
    forget(id);
    return text;
  }

  /**
   * 命令を1つ送り、結果 (result) を返す。断られたら投げる。
   *
   * @param {string} op
   * @param {object} [args]
   * @returns {Promise<*>}
   */
  async function send(op, args) {
    const id = place(op, args);
    const until = now() + waitMs;
    try {
      for (;;) {
        const text = collect(id);
        if (text !== undefined) return logic.readResult(text);
        if (now() >= until) break;
        await sleep(pollMs);
        // 止めたとき (dispose) は命令を片付けてある。待たずにやめる
        if (!pending.has(id)) throw new Error('頼むのをやめました');
      }
    } finally {
      if (pending.has(id)) forget(id);
    }
    throw new Error('番頭から返事が来ませんでした。命令の入れ先が動いているか (setupCommandQueue)・Drive の同期が動いているかを確かめてください');
  }

  /** 待っている命令を全部片付ける (拡張を止めるとき) */
  function dispose() {
    for (const id of Array.from(pending)) forget(id);
  }

  return { send, dispose, pending };
}

module.exports = { findQueue, makeQueue, ID_RE };
