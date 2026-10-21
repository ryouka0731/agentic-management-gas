#!/usr/bin/env node
/**
 * Claude Code の PreToolUse フック。開発の約束 (CLAUDE.md) のうち、破ると取り返しが
 * つかないものを、走らせる前に止める。止めるときは exit 2 で、理由を stderr に書く。
 *
 *  (a) `git push origin <名前>` で、<名前> がいま居るブランチではない手元のブランチ
 *      (居る場所は入力の cwd で決める。並行する版のフォルダがあるため)
 *  (b) `clasp create-deployment` / `clasp deploy` を `-i` / `--deploymentId` 無しで
 *      (新しいデプロイが作られて URL が変わる)
 *  (c) `src/ui/kit-files.html` / `src/KitSigning.gs` を手で書く (scripts が作るもの)
 *  (d) 署名の秘密鍵を読む・書く (`~/.config/softbanto/kit-signing-key.pem` と
 *      `$BANTO_SIGNING_KEY`)
 *
 * 読み違えたときに止めすぎると使えなくなるので、(a)(b) は分からなければ通す。
 * (c)(d) は分からなくても止める側に倒す。依存は無い (node だけで動く)。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';

const GENERATED = ['src/ui/kit-files.html', 'src/KitSigning.gs'];

function homeDir() {
  return process.env.HOME || os.homedir();
}

function keyPaths() {
  const list = [path.join(homeDir(), '.config', 'softbanto', 'kit-signing-key.pem')];
  if (process.env.BANTO_SIGNING_KEY) list.push(path.resolve(process.env.BANTO_SIGNING_KEY));
  return list;
}

function expandHome(p) {
  if (p === '~') return homeDir();
  if (p.startsWith('~/')) return path.join(homeDir(), p.slice(2));
  return p.replace(/^\$\{?HOME\}?(?=\/|$)/, homeDir());
}

function resolveFrom(cwd, p) {
  return path.resolve(cwd || process.cwd(), expandHome(p));
}

/** 字を shell と同じ程度に区切る。区切りの記号は {op} として返す。 */
export function tokenize(cmd) {
  const out = [];
  let cur = null;
  let i = 0;
  // ヒアドキュメント (<<EOF) の本文は命令ではなく字なので、行ごと読み飛ばす
  // (読むと、本文に「> src/ui/kit-files.html」と書いた説明だけで止めてしまう)
  const docs = [];
  let wantDelim = null;
  const push = () => {
    if (cur === null) return;
    if (wantDelim) { docs.push({ word: cur, strip: wantDelim === '<<-' }); wantDelim = null; }
    out.push(cur); cur = null;
  };
  const skipDocs = () => {
    while (docs.length && i < cmd.length) {
      const { word, strip } = docs.shift();
      for (;;) {
        const end = cmd.indexOf('\n', i);
        const line = cmd.slice(i, end < 0 ? cmd.length : end);
        i = end < 0 ? cmd.length : end + 1;
        if ((strip ? line.replace(/^\t+/, '') : line) === word || end < 0) break;
      }
    }
  };
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === '\\' && i + 1 < cmd.length) {
      if (cmd[i + 1] === '\n') { i += 2; continue; }
      cur = (cur || '') + cmd[i + 1]; i += 2; continue;
    }
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      const stop = end < 0 ? cmd.length : end;
      cur = (cur || '') + cmd.slice(i + 1, stop); i = stop + 1; continue;
    }
    if (c === '"') {
      let j = i + 1; let s = '';
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\' && j + 1 < cmd.length && '"\\$`'.includes(cmd[j + 1])) { s += cmd[j + 1]; j += 2; continue; }
        s += cmd[j]; j++;
      }
      cur = (cur || '') + s; i = j + 1; continue;
    }
    if (c === ' ' || c === '\t') { push(); i++; continue; }
    if (c === '\n') { push(); out.push({ op: c }); i++; skipDocs(); continue; }
    if (c === ';' || c === '(' || c === ')') { push(); out.push({ op: c }); i++; continue; }
    if (c === '&' || c === '|') {
      push();
      const two = cmd.slice(i, i + 2);
      if (two === '&&' || two === '||') { out.push({ op: two }); i += 2; continue; }
      if (c === '&' && cmd[i + 1] === '>') { cur = '&>'; i += 2; push(); continue; }
      out.push({ op: c }); i++; continue;
    }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      push();
      const tok = cmd[i + 2] === '-' ? '<<-' : '<<';
      out.push(tok); i += tok.length; wantDelim = tok;
      continue;
    }
    if (c === '>' || c === '<') {
      // 2>&1 のような形はそのまま1語にする。 > / >> は単独の語にする
      if (cur !== null && /^\d+$/.test(cur)) { cur += c; } else { push(); cur = c; }
      i++;
      if (cmd[i] === '>' || cmd[i] === '&') { cur += cmd[i]; i++; if (/\d/.test(cmd[i] || '')) { cur += cmd[i]; i++; } }
      else if (c === '>' && cmd[i] === '|') { cur += '|'; i++; }
      push();
      continue;
    }
    cur = (cur || '') + c; i++;
  }
  push();
  return out;
}

/** 区切りごとの語の並びにする (`&&` / `;` / `|` などで切る)。 */
export function segments(cmd) {
  const segs = [[]];
  for (const t of tokenize(cmd)) {
    if (typeof t === 'object') { if (segs[segs.length - 1].length) segs.push([]); continue; }
    segs[segs.length - 1].push(t);
  }
  return segs.filter(s => s.length);
}

const WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec', 'builtin']);

/** 先頭の `FOO=bar` や `rtk` / `npx` などの包みを外した語の並び。 */
function strip(words) {
  let w = words.slice();
  for (;;) {
    if (!w.length) return w;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w = w.slice(1); continue; }
    if (WRAPPERS.has(w[0])) { w = w.slice(1); continue; }
    if (w[0] === 'rtk') { w = w.slice(w[1] === 'proxy' ? 2 : 1); continue; }
    if (w[0] === 'npx' || w[0] === 'pnpx' || (w[0] === 'pnpm' && w[1] === 'exec') || (w[0] === 'bunx')) {
      w = w.slice(w[0] === 'pnpm' ? 2 : 1);
      while (w.length && w[0].startsWith('-')) w = w.slice(1);
      if (w[0] === '@google/clasp') w = ['clasp', ...w.slice(1)];
      continue;
    }
    return w;
  }
}

function base(cmd) {
  return cmd ? path.basename(cmd) : '';
}

function currentBranch(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    return null;
  }
}

/** いま居るブランチの記録のうち、どの送り先 (origin/…) にも無いものの数。分からなければ 0 */
function unpushedCount(dir) {
  try {
    return Number(execFileSync('git', ['rev-list', '--count', 'HEAD', '--not', '--remotes'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()) || 0;
  } catch (e) {
    return 0;
  }
}

function isLocalBranch(dir, name) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/' + name], {
      cwd: dir, stdio: 'ignore',
    });
    return true;
  } catch (e) {
    return false;
  }
}

// git push で値を取る選択肢 (`=` 無しで書かれたとき、次の語を食う)
const PUSH_VALUE_OPTS = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec', '--signed']);
const PUSH_ALL_OPTS = new Set(['--all', '--mirror', '--tags', '--branches', '--delete', '-d', '--prune']);

/** (a) を見る。止めるなら理由を返す。 */
function checkGitPush(words, cwd) {
  if (base(words[0]) !== 'git') return null;
  let dir = cwd;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    const o = words[i];
    if (o === '-C') { if (dir == null || words[i + 1] == null || words[i + 1].includes('$')) dir = null; else dir = resolveFrom(dir, words[i + 1]); i += 2; continue; }
    if (o === '-c' || o === '--git-dir' || o === '--work-tree' || o === '--namespace') { if (o !== '-c') dir = null; i += 2; continue; }
    if (o.startsWith('--git-dir=') || o.startsWith('--work-tree=')) dir = null;
    i++;
  }
  if (words[i] !== 'push') return null;
  const pos = [];
  for (let j = i + 1; j < words.length; j++) {
    const w = words[j];
    if (/^\d*[<>]/.test(w) || w === '&>') { j++; continue; }
    if (w === '--') { pos.push(...words.slice(j + 1)); break; }
    if (w.startsWith('-')) {
      if (PUSH_ALL_OPTS.has(w)) return null;
      if (PUSH_VALUE_OPTS.has(w) && w !== '--signed') j++;
      continue;
    }
    pos.push(w);
  }
  const refspecs = pos.slice(1);
  if (!refspecs.length || dir == null) return null;
  const current = currentBranch(dir);
  if (!current) return null;
  // 止めたいのは「居るブランチで作った記録を送ったつもりで、別の名前を送る」取り違えだけ。
  // 居るブランチに送っていない記録が無ければ、別のブランチを送るのは正しい使い方である
  const ahead = unpushedCount(dir);
  if (!ahead) return null;
  for (const spec of refspecs) {
    if (spec.includes('$') || spec.includes('*')) continue;
    // 送り先まで書いた形 (a:b) は、わざとそう書いたものとして通す
    if (spec.includes(':')) continue;
    const src = spec.replace(/^\+/, '');
    if (!src || src === 'HEAD' || src === '@') continue;
    const name = src.replace(/^refs\/heads\//, '');
    if (name === current) continue;
    if (!isLocalBranch(dir, name)) continue; // タグや知らない名前は通す (git が自分で断る)
    return 'git push で送ろうとしている「' + name + '」は、いま居るブランチ (' + current + ') ではありません。'
      + 'いまのブランチには、まだ送っていない記録が ' + ahead + ' 件あります。\n'
      + '`git push origin <名前>` はその名前のブランチを送るので、ここで作った変更は送られません。\n'
      + 'いまのブランチを送るなら `git push -u origin HEAD`。「' + name + '」をわざと送るなら `git push origin ' + name + ':' + name + '` と送り先まで書いてください。\n'
      + '(居る場所: ' + dir + ')';
  }
  return null;
}

/** (b) を見る。 */
function checkClasp(words) {
  if (base(words[0]) !== 'clasp') return null;
  const sub = words.slice(1).find(w => !w.startsWith('-'));
  if (sub !== 'create-deployment' && sub !== 'deploy') return null;
  const hasId = words.some(w => w === '-i' || w === '--deploymentId' || /^-i./.test(w) || w.startsWith('--deploymentId='));
  if (hasId) return null;
  return '`clasp ' + sub + '` を `-i` / `--deploymentId` 無しで走らせると、新しいデプロイができて URL が変わります\n'
    + '(利用者のブックマークも配ったリンクも切れます)。\n'
    + 'デプロイは `npm run deploy -- "何を変えたか"` で行ってください (deployment.json の ID へ差し替えます)。';
}

function isGenerated(abs) {
  const norm = abs.split(path.sep).join('/');
  return GENERATED.some(g => norm === g || norm.endsWith('/' + g));
}

function generatedReason(file) {
  return path.basename(file) + ' は scripts が作るファイルです。手で直さないでください。\n'
    + 'kit-files.html は kit/ を直して `node scripts/build-kit.mjs` で焼き直す (npm run deploy も走らせる)。\n'
    + 'KitSigning.gs は `npm run deploy` が送る直前に書きます。';
}

function isKeyPath(abs) {
  return keyPaths().some(k => abs === k);
}

const KEY_REASON = '署名の秘密鍵 (~/.config/softbanto/kit-signing-key.pem / $BANTO_SIGNING_KEY) には触れません。\n'
  + '鍵は `npm run deploy` (scripts/deploy.mjs) が自分で読みます。作り直しは `node scripts/kit-key.mjs --rotate`。\n'
  + '中身を表示・写す・送ることはしないでください。';

/** 1語が秘密鍵を指していそうか。 */
function wordTouchesKey(w, cwd) {
  if (/\$\{?BANTO_SIGNING_KEY\b/.test(w)) return true;
  const plain = w.replace(/^[<>]+&?/, '').replace(/^--?[A-Za-z][\w-]*=/, '').replace(/^@/, '');
  if (!plain) return false;
  const norm = expandHome(plain);
  // ~/.config/softbanto の中を * でまとめて指すのも止める
  if (/(^|\/)\.config\/softbanto\/[^/]*[*?[][^/]*$/.test(norm)) return true;
  // 置き場の名前を * でぼかしても、鍵の名前を書いていれば止める (~/.config/soft*/kit-signing-key.pem)
  if (!/\s/.test(norm) && /(^|\/)\.config\/[^/]*\/[^/]*kit-signing-key/.test(norm)) return true;
  if (!norm.includes('/')) {
    // 名前だけ (grep の引数など) は、cwd がちょうど鍵の置き場のときだけ鍵を指す
    return cwd != null && isKeyPath(path.resolve(cwd, norm));
  }
  return isKeyPath(resolveFrom(cwd, plain));
}

/** (c) の Bash 版: リダイレクトや sed -i で生成物を書く。 */
function bashWritesGenerated(words, cwd) {
  for (let j = 0; j < words.length; j++) {
    const w = words[j];
    if (/^\d*>>?$|^&>$|^>\|$/.test(w) && words[j + 1] && isGenerated(resolveFrom(cwd, words[j + 1]))) return words[j + 1];
  }
  const cmd = base(words[0]);
  if ((cmd === 'sed' || cmd === 'perl') && words.some(w => /^-[A-Za-z]*i/.test(w) || w.startsWith('--in-place'))) {
    const hit = words.slice(1).find(w => !w.startsWith('-') && isGenerated(resolveFrom(cwd, w)));
    if (hit) return hit;
  }
  if (cmd === 'tee' || cmd === 'cp' || cmd === 'mv' || cmd === 'truncate') {
    const args = words.slice(1).filter(w => !w.startsWith('-'));
    const target = cmd === 'tee' || cmd === 'truncate' ? args : args.slice(-1);
    const hit = target.find(w => isGenerated(resolveFrom(cwd, w)));
    if (hit) return hit;
  }
  return null;
}

function cdTarget(words, cwd) {
  if (cwd == null) return null;
  const arg = words[1];
  if (!arg || arg === '~') return homeDir();
  if (arg === '-' || arg.includes('$') || arg.includes('`') || arg.includes('*')) return null;
  return resolveFrom(cwd, arg);
}

/** Bash の命令を見る。止めるなら理由を返す。 */
export function checkBash(command, cwd) {
  if (typeof command !== 'string' || !command) return null;
  let dir = cwd || null;
  for (const raw of segments(command)) {
    const words = strip(raw);
    if (!words.length) continue;
    if (raw.some(w => wordTouchesKey(w, dir))) return KEY_REASON;
    if (words[0] === 'cd' || words[0] === 'pushd') { dir = cdTarget(words, dir); continue; }
    const gen = bashWritesGenerated(words, dir);
    if (gen) return generatedReason(gen);
    const r = checkGitPush(words, dir) || checkClasp(words);
    if (r) return r;
  }
  return null;
}

/** フックの入力1つを見る。止めるなら理由を返す。 */
export function check(input) {
  const tool = input && input.tool_name;
  const ti = (input && input.tool_input) || {};
  const cwd = input && input.cwd;
  if (tool === 'Bash') return checkBash(ti.command, cwd);
  const file = ti.file_path || ti.notebook_path || (tool === 'Grep' || tool === 'Glob' ? ti.path : null);
  if (typeof file !== 'string' || !file) return null;
  const abs = resolveFrom(cwd, file);
  if (isKeyPath(abs)) return KEY_REASON;
  if ((tool === 'Grep' || tool === 'Glob') && /(^|\/)\.config(\/softbanto)?\/?$/.test(abs)) return KEY_REASON;
  if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') && isGenerated(abs)) {
    return generatedReason(abs);
  }
  return null;
}

async function main() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  let input;
  try { input = JSON.parse(text); } catch (e) { process.exit(0); }
  let reason = null;
  try { reason = check(input); } catch (e) { reason = null; }
  if (reason) {
    process.stderr.write('[guard-hook] ' + reason + '\n');
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
