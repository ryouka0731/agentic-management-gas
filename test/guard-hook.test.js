import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';

// 開発の約束を止めるフック (scripts/guard-hook.mjs)。本物と同じく、標準入力に JSON を渡して走らせる
const HOOK = path.resolve(__dirname, '../scripts/guard-hook.mjs');
const SETTINGS = path.resolve(__dirname, '../.claude/settings.json');

let repo; // main に居る手元の版
let tree; // 同じリポジトリの別のフォルダ (feat/x に居る)
let home; // 鍵の置き場を本物から離す

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-hook-'));
  repo = path.join(root, 'repo');
  tree = path.join(root, 'tree');
  home = path.join(root, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(path.join(home, '.config', 'softbanto'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, 'branch', 'feat/x');
  git(repo, 'worktree', 'add', '-q', tree, 'feat/x');
});

function run(input, env = {}) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, BANTO_SIGNING_KEY: '', ...env },
  });
  return { code: r.status, err: r.stderr };
}

function bash(command, cwd = repo, env) {
  return run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }, env);
}

function tool(tool_name, tool_input, cwd = repo, env) {
  return run({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd }, env);
}

describe('フックの仕掛け', () => {
  it('.claude/settings.json が PreToolUse でこのスクリプトを呼ぶ', () => {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    const entry = s.hooks.PreToolUse[0];
    for (const t of ['Bash', 'Read', 'Edit', 'Write']) expect(entry.matcher.split('|')).toContain(t);
    expect(entry.hooks[0].command).toContain('scripts/guard-hook.mjs');
  });

  it('読めない入力・知らない道具は通す', () => {
    const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(tool('WebFetch', { url: 'https://example.com' }).code).toBe(0);
  });
});

describe('(a) いま居ないブランチを git push しない', () => {
  it('居ないブランチの名前を送ろうとすると止める', () => {
    const r = bash('git push origin feat/x');
    expect(r.code).toBe(2);
    expect(r.err).toContain('feat/x');
    expect(r.err).toContain('main');
  });

  it('居るブランチ・HEAD・名前なしは通す', () => {
    expect(bash('git push').code).toBe(0);
    expect(bash('git push -u origin HEAD').code).toBe(0);
    expect(bash('git push origin main').code).toBe(0);
    expect(bash('git push -u origin main').code).toBe(0);
    expect(bash('git push origin HEAD:refs/heads/main').code).toBe(0);
  });

  it('居る場所は入力の cwd で決める (別のフォルダ = worktree)', () => {
    expect(bash('git push -u origin feat/x', tree).code).toBe(0);
    expect(bash('git push origin main', tree).code).toBe(2);
  });

  it('つないだ命令も1つずつ見る', () => {
    expect(bash('npm test && git push origin feat/x').code).toBe(2);
    expect(bash('git status; git push origin feat/x 2>&1 | tail -1').code).toBe(2);
    expect(bash('git add -A && git commit -m x && git push -u origin main').code).toBe(0);
  });

  it('cd してから送るときは、移った先のブランチで見る', () => {
    expect(bash('cd ' + tree + ' && git push -u origin feat/x').code).toBe(0);
    expect(bash('cd ' + tree + ' && git push origin main').code).toBe(2);
    expect(bash('git -C ' + tree + ' push origin feat/x').code).toBe(0);
  });

  it('タグ・知らない名前・まとめて送る形・分からない形は通す', () => {
    expect(bash('git push origin v1.0').code).toBe(0);
    expect(bash('git push --tags origin').code).toBe(0);
    expect(bash('git push origin "$BRANCH"').code).toBe(0);
    expect(bash('cd "$DIR" && git push origin feat/x').code).toBe(0);
    expect(bash('echo git push origin feat/x').code).toBe(0);
  });

  it('rtk を通して書いても見る', () => {
    expect(bash('rtk git push origin feat/x').code).toBe(2);
  });

  it('送り先まで書いた形 (a:b) は、わざとそう書いたものとして通す', () => {
    expect(bash('git push origin feat/x:feat/x').code).toBe(0);
  });

  it('居るブランチを送り終えていれば、別のブランチを名指しで送るのは通す', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-hook-remote-'));
    const remote = path.join(root, 'remote.git');
    const local = path.join(root, 'local');
    git(root, 'init', '-q', '--bare', remote);
    git(root, 'clone', '-q', remote, local);
    const c = (m) => git(local, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', m);
    c('init');
    git(local, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
    git(local, 'branch', '-q', '--set-upstream-to=origin/main');
    git(local, 'branch', 'feat/y');
    expect(bash('git push origin feat/y', local).code).toBe(0);
    // 居るブランチに送っていない記録ができたら、取り違えとして止める
    c('work');
    const r = bash('git push origin feat/y', local);
    expect(r.code).toBe(2);
    expect(r.err).toContain('1 件');
  });
});

describe('(b) clasp で新しいデプロイを作らない', () => {
  it('-i / --deploymentId が無ければ止める', () => {
    expect(bash('clasp create-deployment -d "x"').code).toBe(2);
    expect(bash('clasp deploy').code).toBe(2);
    expect(bash('npx clasp create-deployment').code).toBe(2);
    expect(bash('npx @google/clasp deploy -d x').code).toBe(2);
    expect(bash('clasp push -f && clasp create-deployment').code).toBe(2);
  });

  it('ID を名指しすれば通す。push や npm run deploy も通す', () => {
    expect(bash('clasp create-deployment -i AKfy -d x').code).toBe(0);
    expect(bash('clasp deploy --deploymentId AKfy').code).toBe(0);
    expect(bash('clasp deploy --deploymentId=AKfy').code).toBe(0);
    expect(bash('clasp push -f').code).toBe(0);
    expect(bash('clasp deployments').code).toBe(0);
    expect(bash('npm run deploy -- "直した"').code).toBe(0);
  });
});

describe('(c) scripts が作るファイルを手で直さない', () => {
  it('Edit / Write / MultiEdit を止める (相対でも絶対でも)', () => {
    expect(tool('Edit', { file_path: path.join(repo, 'src/ui/kit-files.html'), old_string: 'a', new_string: 'b' }).code).toBe(2);
    expect(tool('Write', { file_path: 'src/KitSigning.gs', content: 'x' }).code).toBe(2);
    expect(tool('MultiEdit', { file_path: path.join(tree, 'src/ui/kit-files.html'), edits: [] }).code).toBe(2);
  });

  it('ほかのファイルと、読むことは通す', () => {
    expect(tool('Edit', { file_path: path.join(repo, 'src/core/AgentKit.gs'), old_string: 'a', new_string: 'b' }).code).toBe(0);
    expect(tool('Write', { file_path: path.join(repo, 'kit/agent.mjs'), content: 'x' }).code).toBe(0);
    expect(tool('Read', { file_path: path.join(repo, 'src/ui/kit-files.html') }).code).toBe(0);
  });

  it('焼き直しと deploy は通し、シェルで直に書くのは止める', () => {
    expect(bash('node scripts/build-kit.mjs').code).toBe(0);
    expect(bash('npm run deploy -- "x"').code).toBe(0);
    expect(bash('git diff src/ui/kit-files.html | head').code).toBe(0);
    expect(bash('echo x > src/ui/kit-files.html').code).toBe(2);
    expect(bash("sed -i '' 's/a/b/' src/KitSigning.gs").code).toBe(2);
    expect(bash('echo x >| src/ui/kit-files.html').code).toBe(2);
  });

  it('ヒアドキュメントの本文は命令として読まない', () => {
    expect(bash("git commit -F - <<'EOF'\n説明: echo x > src/ui/kit-files.html は止まる\nEOF").code).toBe(0);
    expect(bash("cat <<-EOF\n\t> src/ui/kit-files.html\n\tEOF\necho ok").code).toBe(0);
    // 本文が終わったあとの命令は読む
    expect(bash("cat <<EOF\nx\nEOF\necho x > src/ui/kit-files.html").code).toBe(2);
  });
});

describe('(d) 署名の秘密鍵に触れない', () => {
  const KEY = () => path.join(home, '.config', 'softbanto', 'kit-signing-key.pem');

  it('Read / Edit / Write / Grep で鍵を指すと止める', () => {
    expect(tool('Read', { file_path: KEY() }).code).toBe(2);
    expect(tool('Write', { file_path: KEY(), content: 'x' }).code).toBe(2);
    expect(tool('Grep', { pattern: 'BEGIN', path: path.join(home, '.config', 'softbanto') }).code).toBe(2);
  });

  it('シェルで鍵を読むと止める (~ / $HOME / 絶対 / * / つないだ形)', () => {
    expect(bash('cat ~/.config/softbanto/kit-signing-key.pem').code).toBe(2);
    expect(bash('cat "$HOME/.config/softbanto/kit-signing-key.pem"').code).toBe(2);
    expect(bash('base64 < ' + KEY()).code).toBe(2);
    expect(bash('cat ~/.config/softbanto/*').code).toBe(2);
    expect(bash('npm test && head -1 ~/.config/softbanto/kit-signing-key.pem | pbcopy').code).toBe(2);
    expect(bash('cd ~/.config/softbanto && cat kit-signing-key.pem').code).toBe(2);
    expect(bash('cat ~/.config/soft*/kit-signing-key.pem').code).toBe(2);
  });

  it('鍵の置き場の上から Grep / Glob で探すのも止める', () => {
    expect(tool('Grep', { pattern: 'PRIVATE', path: path.join(home, '.config') }).code).toBe(2);
    expect(tool('Glob', { pattern: '**/*.pem', path: path.join(home, '.config') }).code).toBe(2);
  });

  it('$BANTO_SIGNING_KEY を使っても、その指す先を書いても止める', () => {
    const custom = path.join(home, 'elsewhere.pem');
    expect(bash('cat "$BANTO_SIGNING_KEY"').code).toBe(2);
    expect(bash('cat ${BANTO_SIGNING_KEY}').code).toBe(2);
    expect(bash('cat ' + custom, repo, { BANTO_SIGNING_KEY: custom }).code).toBe(2);
    expect(tool('Read', { file_path: custom }, repo, { BANTO_SIGNING_KEY: custom }).code).toBe(2);
  });

  it('deploy・鍵を作るスクリプト・公開鍵・名前で探すのは通す', () => {
    expect(bash('npm run deploy -- "x"').code).toBe(0);
    expect(bash('node scripts/kit-key.mjs').code).toBe(0);
    expect(bash('cat kit/track/kit-key.pem').code).toBe(0);
    expect(tool('Read', { file_path: path.join(repo, 'kit/track/kit-key.pem') }).code).toBe(0);
    expect(bash('grep -rn kit-signing-key.pem scripts docs').code).toBe(0);
    expect(bash('grep -rn BANTO_SIGNING_KEY scripts').code).toBe(0);
    expect(bash('ls ~/.config/softbanto').code).toBe(0);
  });
});
