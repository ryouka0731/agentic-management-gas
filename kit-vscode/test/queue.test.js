'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findQueue, makeQueue, ID_RE } = require('../lib/queue');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'banto-vscode-'));
}

test('入れ先: 道具のフォルダの agentkit.json を先に見る。無ければホームの設定', () => {
  const home = tmp();
  const kit = tmp();
  const q1 = tmp();
  const q2 = tmp();
  fs.writeFileSync(path.join(home, '.agentkit.json'), JSON.stringify({ queueDir: q2 }));
  assert.equal(findQueue({ kitDir: '', env: {}, home }).queueDir, q2);
  fs.writeFileSync(path.join(kit, 'agentkit.json'), JSON.stringify({ queueDir: q1 }));
  const got = findQueue({ kitDir: kit, env: {}, home });
  assert.equal(got.queueDir, q1);
  assert.equal(got.from, path.join(kit, 'agentkit.json'));
});

test('入れ先: ~/.banto/config.json の queueDir も読む。環境変数がホームより先', () => {
  const home = tmp();
  const q = tmp();
  const e = tmp();
  fs.mkdirSync(path.join(home, '.banto'));
  fs.writeFileSync(path.join(home, '.banto', 'config.json'), JSON.stringify({ queueDir: q }));
  assert.equal(findQueue({ env: {}, home }).queueDir, q);
  assert.equal(findQueue({ env: { AGENTKIT_QUEUE: e }, home }).queueDir, e);
});

test('入れ先が無ければ投げずに理由を返す', () => {
  const home = tmp();
  const none = findQueue({ kitDir: '', env: {}, home });
  assert.equal(none.queueDir, '');
  assert.match(none.reason, /banto\.kitDir/);
  const kit = tmp();
  assert.match(findQueue({ kitDir: kit, env: {}, home }).reason, /agentkit\.json がありません/);
  fs.writeFileSync(path.join(kit, 'agentkit.json'), JSON.stringify({ queueDir: path.join(kit, 'nai') }));
  assert.match(findQueue({ kitDir: kit, env: {}, home }).reason, /入れ先がありません/);
  // 壊れた設定は見なかったことにする
  fs.writeFileSync(path.join(kit, 'agentkit.json'), '{');
  assert.equal(findQueue({ kitDir: kit, env: {}, home }).queueDir, '');
});

/** 番頭の代わり。置かれた命令を読み、結果を書く (src/core/CommandQueue.gs の形) */
function fakeBanto(dir, answer) {
  return () => {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.cmd.json')) continue;
      const id = name.replace(/\.cmd\.json$/, '');
      const cmd = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (fs.existsSync(path.join(dir, id + '.result.json'))) continue;
      fs.writeFileSync(path.join(dir, id + '.result.json'), JSON.stringify(answer(cmd)));
    }
  };
}

test('命令を置いて結果を拾い、命令と結果の両方を片付ける', async () => {
  const dir = tmp();
  const seen = [];
  const banto = fakeBanto(dir, (cmd) => { seen.push(cmd); return { ok: true, op: cmd.op, result: { day: '2026-10-28', events: [] } }; });
  const q = makeQueue(dir, { sleep: async () => banto(), pollMs: 1, waitMs: 60000 });
  const got = await q.send('calendarToday', {});
  assert.deepEqual(got, { day: '2026-10-28', events: [] });
  assert.deepEqual(seen, [{ op: 'calendarToday', args: {} }]);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(q.pending.size, 0);
});

test('id は vsc で始まる (手元の道具の片付けと混ざらない)', async () => {
  const dir = tmp();
  let name = '';
  const q = makeQueue(dir, { sleep: async () => {
    name = fs.readdirSync(dir)[0];
    fakeBanto(dir, () => ({ ok: true, result: 1 }))();
  }, pollMs: 1 });
  await q.send('issueList', { state: 'open' });
  assert.match(name.replace(/\.cmd\.json$/, ''), ID_RE);
  assert.match(name, /^vsc-/);
});

test('断られたら理由で投げ、片付ける', async () => {
  const dir = tmp();
  const banto = fakeBanto(dir, () => ({ ok: false, op: 'calendarToday', error: 'あなたの予定を読めません' }));
  const q = makeQueue(dir, { sleep: async () => banto(), pollMs: 1 });
  await assert.rejects(q.send('calendarToday'), /番頭が断りました: あなたの予定を読めません/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('書きかけの結果は読まずに待つ', async () => {
  const dir = tmp();
  let n = 0;
  const q = makeQueue(dir, { pollMs: 1, sleep: async () => {
    n++;
    const cmd = fs.readdirSync(dir).find((f) => f.endsWith('.cmd.json'));
    const out = path.join(dir, cmd.replace(/\.cmd\.json$/, '.result.json'));
    fs.writeFileSync(out, n === 1 ? '{"ok":tr' : JSON.stringify({ ok: true, result: 'done' }));
  } });
  assert.equal(await q.send('homeMine'), 'done');
  assert.equal(n, 2);
});

test('返らなければ命令を消してから投げる (あとで拾われて一度だけ走らないように)', async () => {
  const dir = tmp();
  let t = 0;
  const q = makeQueue(dir, { waitMs: 10, pollMs: 1, now: () => t, sleep: async () => { t += 5; } });
  await assert.rejects(q.send('homeMine'), /返事が来ませんでした/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('止めるときは待っている命令を全部片付ける', async () => {
  const dir = tmp();
  let release;
  const q = makeQueue(dir, { pollMs: 1, sleep: () => new Promise((done) => { release = done; }) });
  const waiting = q.send('homeMine');
  await new Promise((done) => setImmediate(done));
  assert.equal(fs.readdirSync(dir).length, 1);
  q.dispose();
  assert.deepEqual(fs.readdirSync(dir), []);
  release();
  await assert.rejects(waiting, /頼むのをやめました/);
});
