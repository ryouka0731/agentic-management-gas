import { describe, it, expect } from 'vitest';
import { makeEnv, withPr, expectRefused, asUser, OWNER, OTHER } from './setup.js';

/*
 * 手元の道具が呼ぶ「API」: コマンドキューの命令 (COMMAND_OPS in src/core/CommandQueue.gs)。
 *
 * 表に無い op は実行しない (Drive を共有している人なら誰でも命令を置けるため)。承認
 * (prReview) は入れない (トリガーは持ち主の権限で走り、常に自己承認になる)。自分の様子を
 * 見る命令は、命令を置いた人 (by) から見た様子を返す。
 */

const DIFF = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';

function enqueue(ctx, id, cmd, owner) {
  const f = ctx.commandQueueFolder_().createFile(id + '.cmd.json', JSON.stringify(cmd), 'text/plain');
  if (owner !== undefined) f._setOwner(owner);
  return f;
}

function readResult(ctx, id) {
  const it = ctx.commandQueueFolder_().getFilesByName(id + '.result.json');
  return it.hasNext() ? JSON.parse(it.next().getBlob().getDataAsString('UTF-8')) : null;
}

/** 命令ファイルを置いてキューを1回回し、結果を返す */
function run(ctx, op, args, owner) {
  const id = 'c' + Math.random().toString(36).slice(2);
  enqueue(ctx, id, { op, args }, owner);
  ctx.processCommandQueue();
  return readResult(ctx, id);
}

describe('命令の表', () => {
  it('表に無い op・prReview・空の op は実行しない', () => {
    const { ctx } = makeEnv({ file: false });
    expect(Object.keys(ctx.COMMAND_OPS())).not.toContain('prReview');
    for (const op of ['prReview', 'eval', '', 'constructor', 'toString', '__proto__']) {
      expectRefused(() => ctx.runCommand_({ op, args: {} }, OWNER), /実行できない操作です/);
    }
    expectRefused(() => ctx.runCommand_(null, OWNER), /実行できない操作です/);
  });

  it('読むだけの命令は api と同じ答えを返す', () => {
    const env = withPr(makeEnv());
    const { ctx, fileId, work } = env;
    const op = (name, a) => ctx.runCommand_({ op: name, args: a }, OWNER);

    expect(op('listFiles')).toEqual(ctx.apiListFiles());
    expect(op('status', { fileId }).branch).toBe('main');
    expect(op('readMarkdown', { fileId }).markdown).toBe('第1条\n');
    expect(op('issueList', {})).toEqual(ctx.apiIssueList(''));
    expect(op('prList').map((p) => p.number)).toEqual([1]);
    expect(op('prPreview', { number: 1 }).clean).toBe(true);
    const hist = op('commitHistory', { fileId: work });
    expect(hist[0].message).toBe('第2条を足した');
    expect(op('commitDiff', { toSha: hist[0].sha }).length).toBeGreaterThan(0);
    expect(op('searchIndex').length).toBeGreaterThanOrEqual(0);
  });

  it('書く命令: 改訂版・記録・Markdown・やること・ボード', () => {
    const { ctx, fake, fileId } = makeEnv();
    const op = (name, a) => ctx.runCommand_({ op: name, args: a || {} }, OWNER);

    expect(op('branchCreate', { name: '手元', fileId }).name).toBe('手元');
    const work = ctx.branchWorkingFileId('手元', fileId);
    const opened = op('readMarkdown', { fileId: work });
    expect(op('writeMarkdown', { fileId: work, markdown: '# 手元\n', baseSha: opened.baseSha }).ok).toBe(true);
    expect(op('writeMarkdown', { fileId: work, markdown: '# 指紋なし\n' }).ok).toBe(true);
    expect(op('commit', { fileId: work, message: '手元から' }).message).toBe('手元から');

    const issue = op('issueCreate', { title: '手元のやること' });
    expect(issue.number).toBe(1);
    expect(op('issueUpdate', { number: 1, patch: { priority: 'high' } }).priority).toBe('high');
    expect(op('issueUpdate', { number: 1 }).priority).toBe('high');
    expect(op('issueComment', { number: 1, body: '進めます' }).body).toBe('進めます');
    op('boardMove', { number: 1, column: 'In Review' });
    expect(ctx.apiProjectBoard()['In Review'].map((c) => c.issueNumber)).toEqual([1]);
    op('boardMove', { number: 1, column: 'Backlog', order: 0 });
    expect(op('issueClose', { number: 1 }).state).toBe('closed');

    fake._docs.set(fileId, '<p>直接</p>\n');
    expect(op('stashMainDrift', { fileId }).branch).toBe('main');
  });

  it('やることから改訂版・確認依頼・証跡・反映まで通る (反映先の既定は正式版)', () => {
    const { ctx, fake, fileId } = makeEnv();
    const op = (name, a) => ctx.runCommand_({ op: name, args: a || {} }, OWNER);
    op('issueCreate', { title: '第2条', linkedFileIds: [fileId] });
    const br = op('issueCreateBranch', { number: 1, fileId });
    const work = ctx.branchWorkingFileId(br.name, fileId);
    fake._docs.set(work, '<p>第1条</p>\n<p>第2条</p>\n');
    op('commit', { fileId: work, message: '足した' });

    const pr = op('prCreate', { title: '第2条', body: 'closes #1', sourceBranch: br.name, mainFileId: fileId });
    expect(pr.targetBranch).toBe('main');
    expect(op('patchAdd', { number: pr.number, path: 'a.js', text: DIFF }).added).toBe(1);
    expect(op('patches', { number: pr.number })).toHaveLength(1);
    expect(op('patchRemove', { number: pr.number, id: 1 }).removed).toBe(1);

    // 承認は手元からはできない。人が画面で行う
    expectRefused(() => op('prMerge', { number: pr.number }), /1件以上の承認が必要です/);
    asUser(fake, OTHER, () => ctx.apiPrReview(pr.number, 'approve', ''));
    expect(op('prMerge', { number: pr.number }).sha).toMatch(/^[0-9a-f]{64}$/);
    expect(fake._docs.get(fileId)).toBe('<p>第1条</p>\n<p>第2条</p>\n');
  });

  it('正式版への記録は手元からも断る', () => {
    const { ctx, fake, fileId } = makeEnv();
    fake._docs.set(fileId, '<p>直接</p>\n');
    expectRefused(() => ctx.runCommand_({ op: 'commit', args: { fileId, message: 'x' } }, OWNER), /正式版は直接なおせません/);
    expectRefused(() => ctx.runCommand_({ op: 'writeMarkdown', args: { fileId, markdown: 'x' } }, OWNER), /正式版は直接なおせません/);
  });

  it('頼みごとを取りに来て、終わった・できなかったを返す (取るだけで実行しない)', () => {
    const { ctx } = makeEnv({ file: false });
    for (let i = 0; i < 7; i++) ctx.apiOutboxAdd('diff', { branch: '改訂' });
    const op = (name, a) => ctx.runCommand_({ op: name, args: a || {} }, OWNER);

    expect(op('work')).toHaveLength(5); // 既定は5件
    expect(op('work', { limit: 1 })).toHaveLength(1);
    expect(op('workDone', { id: 1 })).toMatchObject({ state: 'done', result: '' });
    expect(op('workFail', { id: 2, reason: '手元に無い' })).toMatchObject({ state: 'failed', result: '手元に無い' });
    expect(op('workFail', { id: 3 }).result).toBe('');
  });
});

describe('スクラムの命令', () => {
  it('状態を見る命令だけはオフでも通り、オンにする道を案内する', () => {
    const { ctx } = makeEnv({ file: false });
    const off = ctx.runCommand_({ op: 'scrumState' }, OWNER);
    expect(off).toMatchObject({ scrumEnabled: false, productGoal: '', definitionOfDone: '' });
    expect(off.howToEnable).toMatch(/オフです/);
    expectRefused(() => ctx.runCommand_({ op: 'sprintList' }, OWNER), /オフです/);
    expect(Object.keys(ctx.COMMAND_OPS()).some((k) => /enable/i.test(k))).toBe(false);

    ctx.apiSetScrumEnabled(true);
    expect(ctx.runCommand_({ op: 'scrumState' }, OWNER)).toMatchObject({ scrumEnabled: true, howToEnable: '' });
  });

  it('オンなら作業期間と困りごとを手元から扱える', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetScrumEnabled(true);
    const op = (name, a) => ctx.runCommand_({ op: name, args: a || {} }, OWNER);
    expect(op('sprintCreate', { fields: { name: 'S1', startDate: '2026-10-01', endDate: '2026-10-14' } }).name).toBe('S1');
    expect(op('sprintUpdate', { name: 'S1', patch: { goal: 'g' } }).goal).toBe('g');
    expect(op('sprintList').map((s) => s.name)).toEqual(['S1']);
    expect(op('scrumView').sprint).toBe('S1');
    expect(op('scrumView', { sprint: 'S1' }).sprint).toBe('S1');
    expect(op('impedimentCreate', { fields: { title: '困った' } }).number).toBe(1);
    expect(op('impedimentUpdate', { number: 1, patch: { body: '詳しく' } }).body).toBe('詳しく');
    expect(op('impedimentComment', { number: 1, body: '一言' }).body).toBe('一言');
    expect(op('impedimentResolve', { number: 1, resolution: '直した' }).state).toBe('resolved');
    expect(op('impedimentList')).toHaveLength(1);
    expect(op('history', { target: 'impediment:1' }).length).toBeGreaterThan(0);
    // 渡し忘れても落ちない (既定の空で断られる)
    expectRefused(() => op('sprintCreate'), /作業期間の名前/);
    expectRefused(() => op('impedimentCreate'), /題名を入れてください/);
  });
});

describe('自分の様子を見る命令 (homeMine / homeAdvice / reportDraft)', () => {
  it('命令を置いた人から見た様子を返す (トリガーを動かす持ち主のぶんではない)', () => {
    const { ctx } = makeEnv({ file: false });
    const mine = ctx.apiIssueCreate('ほかの人の期限', '', [], '', { assignee: OTHER }).number;
    ctx.dbUpdate('issues', 'number', mine, { dueDate: new Date() });

    const asOther = ctx.runCommand_({ op: 'homeMine' }, OTHER);
    expect(asOther.due.items.map((x) => x.number)).toEqual([mine]);
    const asOwner = ctx.runCommand_({ op: 'homeMine' }, OWNER);
    expect(asOwner.due.items).toEqual([]);
    expect(Array.isArray(ctx.runCommand_({ op: 'homeAdvice' }, OTHER))).toBe(true);
  });

  it('置いた人が分からなければ断る', () => {
    const { ctx } = makeEnv({ file: false });
    for (const op of ['homeMine', 'homeAdvice', 'reportDraft']) {
      expectRefused(() => ctx.runCommand_({ op, args: {} }, ''), /命令を置いた人が分かりません/);
    }
  });

  it('日報の下書き: 形を渡さなければ本人の形、知らない形は断る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const n = ctx.apiIssueCreate('片づけた', '', [], '', { assignee: OTHER }).number;
    ctx.issueClose(n, null);

    const draft = ctx.runCommand_({ op: 'reportDraft', args: {} }, OTHER);
    expect(draft.kind).toBe('three');
    expect(draft.template).toContain('{今日}');
    expect(draft.parts.today.map((x) => x.title)).toEqual(['片づけた']);

    expect(ctx.runCommand_({ op: 'reportDraft', args: { kind: 'plain' } }, OTHER).template).toBe('{今日}');
    expectRefused(() => ctx.runCommand_({ op: 'reportDraft', args: { kind: 'weekly' } }, OTHER), /日報の形が分かりません/);

    asUser(fake, OTHER, () => ctx.apiSetReportCustom('【本日】{今日}'));
    const custom = ctx.runCommand_({ op: 'reportDraft', args: {} }, OTHER);
    expect(custom).toMatchObject({ kind: 'custom', template: '【本日】{今日}' });
    // 自分の形が空のまま custom を選んでも、先頭の形に倒す
    expect(ctx.runCommand_({ op: 'reportDraft', args: { kind: 'custom' } }, OWNER).template)
      .toBe(ctx.REPORT_TEMPLATES()[0].body);
  });

  it('日報の下書き: 前の営業日に片付けたものの節を形の前に付けて渡す (画面と同じ字)', () => {
    const { ctx } = makeEnv({ file: false });
    const n = ctx.apiIssueCreate('昨日片付けた', '', [], '', { assignee: OTHER }).number;
    ctx.issueClose(n, null);
    ctx.dbUpdate('issues', 'number', n, { closedAt: new Date(Date.now() - 24 * 3600 * 1000 * 1) });
    const parts = ctx.reportParts_(OTHER, new Date());
    const draft = ctx.runCommand_({ op: 'reportDraft', args: { kind: 'plain' } }, OTHER);
    // 前の営業日が昨日でない曜日 (月曜・日曜) でも、節の字と形の前に付く字は同じ
    expect(draft.template).toBe(parts.doneText + '{今日}');
    expect(draft.parts.doneText).toBe(parts.doneText);
  });

  it('キューを通すと、命令ファイルの持ち主が置いた人になる', () => {
    const { ctx } = makeEnv({ file: false });
    const n = ctx.apiIssueCreate('ほかの人の期限', '', [], '', { assignee: OTHER }).number;
    ctx.dbUpdate('issues', 'number', n, { dueDate: new Date() });
    const res = run(ctx, 'homeMine', {}, OTHER);
    expect(res.ok).toBe(true);
    expect(res.result.due.items.map((x) => x.number)).toEqual([n]);
  });

  it('持ち主と最後に書いた人が食い違う命令は、誰のぶんかを決めずに断る', () => {
    const { ctx } = makeEnv({ file: false, drive: true });
    // 書いたのは tester (OWNER)、持ち主だけ OTHER に移した
    const res = run(ctx, 'homeMine', {}, OTHER);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/命令を置いた人が分かりません/);
  });

  it('持ち主と最後に書いた人が同じなら通す', () => {
    const { ctx } = makeEnv({ file: false, drive: true });
    expect(run(ctx, 'homeMine', {}).ok).toBe(true);
  });

  it('最後に書いた人を読めなければ断る', () => {
    const { ctx, fake } = makeEnv({ file: false, drive: true });
    fake.Drive.Files.get = () => { throw new Error('boom'); };
    const res = run(ctx, 'homeMine', {});
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/命令を置いた人が分かりません/);
  });

  it('自分の様子でない命令は、持ち主が食い違っても通す', () => {
    const { ctx } = makeEnv({ file: false, drive: true });
    expect(run(ctx, 'listFiles', {}, OTHER).ok).toBe(true);
  });
});

describe('道具の版 (kitVersion / kitFiles)', () => {
  it('版と指紋を返し、置いた人の指紋を覚える。署名は中身を渡すときだけ', () => {
    const { ctx } = makeEnv({ file: false, kit: true });
    const v = ctx.runCommand_({ op: 'kitVersion', args: { mine: 'deadbeef' } }, OTHER);
    expect(v).toEqual({ version: ctx.AGENT_KIT_VERSION(), print: ctx.kitPrint_() });
    expect(ctx.kitStatus_(OTHER)).toMatchObject({ mine: 'deadbeef', outdated: true });

    const files = ctx.runCommand_({ op: 'kitFiles', args: {} }, OTHER);
    expect(files.version).toBe(ctx.AGENT_KIT_VERSION());
    expect(Object.keys(files.files).length).toBeGreaterThan(0);
    expect(files).toHaveProperty('signature');
    expect(ctx.kitStatus_(OTHER).outdated).toBe(false);
  });

  it('置いた人が分からないときや、指紋の形でない字は覚えない', () => {
    const { ctx } = makeEnv({ file: false, kit: true });
    ctx.runCommand_({ op: 'kitVersion', args: { mine: 'deadbeef' } }, '');
    ctx.runCommand_({ op: 'kitVersion', args: { mine: 'rm -rf /' } }, OTHER);
    expect(ctx.kitStatus_(OTHER).mine).toBe('');
  });
});

describe('命令ファイルの置いた人 (commandOwner_)', () => {
  it('持ち主の無いファイル (共有ドライブ) は、最後に書いた人を読む', () => {
    const { ctx } = makeEnv({ file: false, drive: true });
    const f = enqueue(ctx, 'x', { op: 'listFiles' }, '');
    expect(ctx.commandOwner_(f)).toBe(OWNER);
  });

  it('Drive の拡張サービスが無ければ空', () => {
    const { ctx } = makeEnv({ file: false });
    const f = enqueue(ctx, 'x', { op: 'listFiles' }, '');
    expect(ctx.commandOwner_(f)).toBe('');
  });

  it('持ち主を読むところで落ちても、最後に書いた人に倒す', () => {
    const { ctx } = makeEnv({ file: false, drive: true });
    const f = enqueue(ctx, 'x', { op: 'listFiles' });
    f.getOwner = () => { throw new Error('no owner'); };
    expect(ctx.commandOwner_(f)).toBe(OWNER);
    ctx.Drive.Files.get = () => { throw new Error('boom'); };
    expect(ctx.commandOwner_(f)).toBe('');
  });
});

describe('キューを通した結果の形', () => {
  it('結果は JSON で、ok・op・result・at を持つ。失敗は error に人の言葉で入る', () => {
    const { ctx } = makeEnv({ file: false });
    const ok = run(ctx, 'listFiles', {});
    expect(ok).toMatchObject({ ok: true, op: 'listFiles', result: [] });
    expect(ok.at).toMatch(/T/);

    const ng = run(ctx, 'issueClose', { number: 99 });
    expect(ng).toMatchObject({ ok: false, op: 'issueClose' });
    expect(ng.error).toMatch(/やることが見つかりません/);

    const bad = run(ctx, 'nope', {});
    expect(bad.error).toMatch(/実行できない操作です: nope/);
  });

  it('他の起動が鍵を持っていれば、残りは次の回に回す', () => {
    const { ctx } = makeEnv({ file: false });
    enqueue(ctx, 'a', { op: 'listFiles' });
    ctx.commandDoneFolder_(); // 置き場は先にある (作るときも鍵を取る)
    ctx.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock: () => {} });
    expect(ctx.processCommandQueue()).toMatch(/0件処理しました \(残りは他の処理が実行中のため次の回に\)/);
    expect(readResult(ctx, 'a')).toBeNull();
  });

  it('1日1回の片付けが落ちても、キューは止めない', () => {
    const { ctx } = makeEnv({ file: false });
    enqueue(ctx, 'a', { op: 'listFiles' });
    ctx.housekeepArchiveDaily_ = () => { throw new Error('boom'); };
    expect(ctx.processCommandQueue()).toBe('1件処理しました');
    expect(readResult(ctx, 'a').ok).toBe(true);
  });

  it('命令でないファイルは触らない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.commandQueueFolder_().createFile('memo.txt', 'x', 'text/plain');
    expect(ctx.processCommandQueue()).toBe('0件処理しました');
    expect(ctx.commandQueueFolder_().getFilesByName('memo.txt').hasNext()).toBe(true);
  });
});

describe('queueStatus_ と回った時刻の戻し (queueLastRunRestore_)', () => {
  it('何かあるのに時刻が1つも読めなければ止まった側に倒す', () => {
    const { ctx } = makeEnv({ file: false });
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('QUEUE_RUNNER', OWNER);
    props.setProperty('QUEUE_LAST_RUN', '読めない');
    expect(ctx.queueStatus_(new Date()).stale).toBe(true);
  });

  it('手で回したぶんを元に戻す (無かったものは消す)', () => {
    const { ctx } = makeEnv({ file: false });
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('QUEUE_LAST_RUN', 'now');
    ctx.queueLastRunRestore_(null);
    expect(props.getProperty('QUEUE_LAST_RUN')).toBeNull();
    ctx.queueLastRunRestore_('2026-10-01T00:00:00.000Z');
    expect(props.getProperty('QUEUE_LAST_RUN')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('戻すところで落ちても投げない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.PropertiesService.getScriptProperties = () => { throw new Error('boom'); };
    expect(() => ctx.queueLastRunRestore_('x')).not.toThrow();
  });
});
