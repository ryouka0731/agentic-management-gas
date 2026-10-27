import { describe, it, expect } from 'vitest';
import { makeEnv, withPr, expectScreenSafe, expectRefused, asUser, OWNER, OTHER } from './api/setup.js';

/*
 * 改訂の理由と、文書の改訂履歴の表 (やること #111)。
 *
 * 反映のときに理由を残し (既定は確認依頼の本文の1行目)、文書ごとに並べ、
 * 文書の末尾 (Docs) か別シート (Sheets) に表として書き出す。書き出しはその場で
 * 正式版の記録として残す (docs/dev/changeset-and-merge.md の「改訂履歴の表の書き出し」)。
 */

function approve(env, n) {
  asUser(env.fake, OTHER, () => env.ctx.apiPrReview(n, 'approve', 'よいです'));
}

/** 正式版の文書に、改訂版 → 確認依頼 → 承認 → 反映 を1回通す */
function mergeOnce(env, { branch, html, title, body, reason }) {
  const { ctx, fake, fileId } = env;
  ctx.apiBranchCreate(branch, fileId);
  const work = ctx.branchWorkingFileId(branch, fileId);
  fake._docs.set(work, html);
  ctx.commitFile(work, branch, title + 'を直した', null);
  const pr = ctx.apiPrCreate(title, body === undefined ? '補足' : body, branch, fileId);
  approve(env, pr.number);
  ctx.apiPrMerge(pr.number, [], '', reason);
  return pr.number;
}

describe('反映の理由', () => {
  it('反映のときに渡した理由と、反映した人を残す', () => {
    const env = withPr(makeEnv());
    approve(env, 1);
    env.ctx.apiPrMerge(1, [], '', '労働時間の法改正に合わせるため');
    const row = env.ctx.dbFindOne('pulls', 'number', 1);
    expect(String(row.mergeReason)).toBe('労働時間の法改正に合わせるため');
    expect(String(row.mergedBy)).toBe(OWNER);
  });

  it('空なら確認依頼の本文の1行目を既定値にする (対象の控えは入れない)', () => {
    const env = makeEnv();
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '第2条', body: '\n  始業を30分遅らせる  \n2行目', reason: '' });
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).mergeReason)).toBe('始業を30分遅らせる');

    const env2 = makeEnv();
    mergeOnce(env2, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '第2条', body: '' });
    // 本文が空なら空のまま (控えの [target-file:...] を理由にしない)
    expect(String(env2.ctx.dbFindOne('pulls', 'number', 1).mergeReason)).toBe('');
  });

  it('下見の返事に既定値を添える', () => {
    const env = withPr(makeEnv());
    const out = expectScreenSafe(env.ctx.apiPrPreview(1));
    expect(out.defaultReason).toBe('補足');
  });

  it('200字を超える理由は断り、何も書き戻さない', () => {
    const env = withPr(makeEnv());
    approve(env, 1);
    const before = env.fake._docs.get(env.fileId);
    expectRefused(() => env.ctx.apiPrMerge(1, [], '', 'あ'.repeat(201)), /反映の理由は200字までにしてください/);
    expect(env.fake._docs.get(env.fileId)).toBe(before);
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).state)).not.toBe('merged');
    // ちょうど200字は通る
    env.ctx.apiPrMerge(1, [], '', 'い'.repeat(200));
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).mergeReason)).toHaveLength(200);
  });

  it('改行は空白にして1行で残す', () => {
    const env = withPr(makeEnv());
    approve(env, 1);
    env.ctx.apiPrMerge(1, [], '', '一つ目\n二つ目');
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).mergeReason)).toBe('一つ目 二つ目');
  });

  it('命令キューの prMerge も理由を渡せる', () => {
    const env = withPr(makeEnv());
    approve(env, 1);
    env.ctx.COMMAND_OPS().prMerge({ number: 1, reason: '手元から' });
    expect(String(env.ctx.dbFindOne('pulls', 'number', 1).mergeReason)).toBe('手元から');
  });
});

describe('改訂履歴の一覧 (apiRevisionHistory)', () => {
  it('反映ごとに日付・反映した人・題名・理由を新しい順に並べる', () => {
    const env = makeEnv();
    env.ctx.memberSetName(OWNER, '総務 太郎');
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '第2条を足す', reason: '一つ目の理由' });
    mergeOnce(env, { branch: 'b', html: '<p>第1条</p>\n<p>第2条</p>\n<p>第3条</p>\n', title: '第3条を足す', reason: '二つ目の理由' });

    const out = expectScreenSafe(env.ctx.apiRevisionHistory(env.fileId));
    expect(out.items.map((i) => i.number)).toEqual([2, 1]);
    expect(out.items[0]).toMatchObject({ title: '第3条を足す', reason: '二つ目の理由', mergedBy: OWNER, mergedByName: '総務 太郎' });
    expect(out.items[0].mergedAt).toMatch(/T/);
    expect(out).toMatchObject({ fileId: env.fileId, path: '就業規則.doc', type: 'doc', canExport: true, exportBlocked: '' });
  });

  it('作業コピーから開いても正式版の履歴を出し、ほかの文書・取り下げ・改訂版どうしの反映は入れない', () => {
    const env = makeEnv();
    const { ctx, fake, config } = env;
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '入る', reason: 'r' });

    const other = fake._createDoc('細則', '<p>細則</p>\n', config.mainId);
    ctx.repoRegisterFile(other, '細則.doc');
    ctx.commitFile(other, 'main', '細則', null);
    ctx.apiBranchCreate('細則改訂', other);
    const w = ctx.branchWorkingFileId('細則改訂', other);
    fake._docs.set(w, '<p>細則 改</p>\n');
    ctx.commitFile(w, '細則改訂', '直した', null);
    ctx.apiPrCreate('ほかの文書', '', '細則改訂', other);
    approve(env, 2);
    ctx.apiPrMerge(2, [], '');

    withPr(env, { branch: 'c', title: '取り下げる', html: '<p>第1条</p>\n<p>第2条</p>\n<p>x</p>\n' });
    ctx.apiPrClose(3);

    const work = ctx.branchWorkingFileId('c', env.fileId);
    expect(ctx.apiRevisionHistory(work).items.map((i) => i.title)).toEqual(['入る']);
  });

  it('反映した人の列を足す前の依頼は、反映の記録を書いた人で読み、理由は空のまま', () => {
    const env = makeEnv();
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '古い依頼', reason: 'x' });
    env.ctx.dbUpdate('pulls', 'number', 1, { mergedBy: '', mergeReason: '' });

    const item = env.ctx.apiRevisionHistory(env.fileId).items[0];
    expect(item.mergedBy).toBe(OWNER);
    expect(item.reason).toBe('');
  });

  it('管理者でなければ書き出せない理由を返す (押せないボタンにする)', () => {
    const env = makeEnv();
    const out = asUser(env.fake, OTHER, () => env.ctx.apiRevisionHistory(env.fileId));
    expect(out.canExport).toBe(false);
    expect(out.exportBlocked).toContain('管理者だけ');
  });

  it('登録されていない文書は断る', () => {
    const env = makeEnv();
    expectRefused(() => env.ctx.apiRevisionHistory('file-x'), /管理対象に登録されていません/);
  });
});

/*
 * Google ドキュメントの本文の疑似。段落・見出し・表の並びだけを持ち、保存すると
 * 正規化 HTML にして fake._docs に入れる (ほかのテストと同じく liveHtml はそこを読む)。
 * body.clear() は持たない (呼ばれたら落ちる)。
 */
function fakeDocumentApp(env) {
  const { ctx, fake } = env;
  const ElementType = { PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE', LIST_ITEM: 'LIST_ITEM' };
  const ParagraphHeading = { NORMAL: 'NORMAL', HEADING1: 'HEADING1', HEADING2: 'HEADING2', HEADING3: 'HEADING3' };
  const bodies = new Map();
  const calls = [];

  function load(id) {
    if (bodies.has(id)) return bodies.get(id);
    const kids = ctx.parseBlocks(fake._docs.get(id) || '').map((b) => {
      if (b.type === 'table') return { type: 'TABLE', rows: b.rows.map((r) => r.map((c) => c.map((x) => x.text).join(''))) };
      const text = (b.runs || []).map((x) => x.text).join('');
      return { type: 'PARAGRAPH', text, heading: b.type === 'heading' ? 'HEADING' + b.level : 'NORMAL' };
    });
    kids.push({ type: 'PARAGRAPH', text: '', heading: 'NORMAL' });
    bodies.set(id, kids);
    return kids;
  }

  function el(node) {
    const e = {
      _node: node,
      getType: () => node.type,
      asParagraph: () => e,
      asTable: () => e,
      getText: () => node.text || '',
      getHeading: () => node.heading || 'NORMAL',
      setHeading: (h) => { node.heading = h; return e; },
      getNumRows: () => node.rows.length,
      getRow: (r) => ({
        getNumCells: () => node.rows[r].length,
        getCell: (c) => ({ getText: () => node.rows[r][c] }),
      }),
    };
    return e;
  }

  function save(id) {
    const blocks = [];
    for (const n of bodies.get(id)) {
      if (n.type === 'TABLE') blocks.push({ type: 'table', rows: n.rows.map((r) => r.map((t) => [{ text: t }])) });
      else if (n.heading && n.heading !== 'NORMAL') blocks.push({ type: 'heading', level: Number(n.heading.slice(-1)), runs: [{ text: n.text }] });
      else blocks.push({ type: 'paragraph', runs: [{ text: n.text }] });
    }
    fake._docs.set(id, ctx.serializeBlocks(blocks));
  }

  const app = {
    ElementType,
    ParagraphHeading,
    _calls: calls,
    openById: (id) => {
      const kids = load(id);
      const body = {
        getNumChildren: () => kids.length,
        getChild: (i) => el(kids[i]),
        removeChild: (e) => { calls.push('removeChild'); kids.splice(kids.indexOf(e._node), 1); },
        insertTable: (i, rows) => { calls.push('insertTable'); const n = { type: 'TABLE', rows }; kids.splice(i, 0, n); return el(n); },
        appendParagraph: (text) => {
          calls.push('appendParagraph');
          const n = { type: 'PARAGRAPH', text, heading: 'NORMAL' };
          kids.push(n);
          return el(n);
        },
        appendTable: (rows) => {
          calls.push('appendTable');
          const n = { type: 'TABLE', rows };
          kids.push(n);
          // 実機と同じく、表のあとに空の段落を置く
          kids.push({ type: 'PARAGRAPH', text: '', heading: 'NORMAL' });
          return el(n);
        },
      };
      return { getBody: () => body, saveAndClose: () => save(id) };
    },
  };
  return app;
}

describe('改訂履歴の表を書き出す (Docs)', () => {
  function docEnv() {
    const env = makeEnv();
    env.ctx.DocumentApp = fakeDocumentApp(env);
    return env;
  }

  it('本文の末尾に見出しと表を足し、正式版の記録として残す', () => {
    const env = docEnv();
    env.ctx.memberSetName(OWNER, '総務 太郎');
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '第2条を足す', reason: '法改正' });

    const out = expectScreenSafe(env.ctx.apiRevisionExport(env.fileId));
    expect(out).toMatchObject({ fileId: env.fileId, type: 'doc', rows: 1, changed: true });

    const html = env.fake._docs.get(env.fileId);
    // 前の本文はそのまま残り、末尾に足される
    expect(html.indexOf('<p>第1条</p>\n<p>第2条</p>\n<h2>改訂履歴</h2>\n<table>\n')).toBe(0);
    expect(html).toContain('<tr><td>日付</td><td>反映した人</td><td>確認依頼</td><td>理由</td></tr>');
    expect(html).toMatch(/<tr><td>\d{4}-\d{2}-\d{2}<\/td><td>総務 太郎<\/td><td>#1 第2条を足す<\/td><td>法改正<\/td><\/tr>/);

    // 書いた中身が記録になっていて、「記録していない変更あり」にならない
    const history = env.ctx.apiCommitHistory(env.fileId);
    expect(history[0].message).toBe('改訂履歴の表を書き出しました');
    expect(env.ctx.fileStatus(env.fileId, 'main').dirty).toBe(false);
    expect(env.ctx.DocumentApp._calls).not.toContain('clear');
  });

  it('二度目は前に書き出した表だけを置き換え、見出しを増やさない。反映が増えていなければ記録しない', () => {
    const env = docEnv();
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '一つ目', reason: 'r1' });
    env.ctx.apiRevisionExport(env.fileId);

    // 書き出した表の下に人が段落を書き足しても、そのまま残る
    mergeOnce(env, {
      branch: 'b', title: '二つ目', reason: 'r2',
      html: env.fake._docs.get(env.fileId) + '<p>附則</p>\n',
    });
    env.ctx.DocumentApp = fakeDocumentApp(env);
    const out = env.ctx.apiRevisionExport(env.fileId);
    expect(out).toMatchObject({ rows: 2, changed: true });

    const html = env.fake._docs.get(env.fileId);
    expect(html.match(/<h2>改訂履歴<\/h2>/g)).toHaveLength(1);
    expect(html).toContain('#1 一つ目');
    expect(html).toContain('#2 二つ目');
    expect(html.endsWith('</table>\n<p>附則</p>\n')).toBe(true);
    expect(env.ctx.DocumentApp._calls).toEqual(['removeChild', 'insertTable']);

    const again = env.ctx.apiRevisionExport(env.fileId);
    expect(again.changed).toBe(false);
    expect(env.ctx.apiCommitHistory(env.fileId)[0].message).toBe('改訂履歴の表を書き出しました');
  });

  it('同じ見出しで人が書いた表があれば、置き換えずに断る', () => {
    const env = docEnv();
    env.fake._docs.set(env.fileId, '<p>第1条</p>\n<h2>改訂履歴</h2>\n<table>\n<tr><td>版</td><td>日</td></tr>\n</table>\n');
    env.ctx.commitFile(env.fileId, 'main', '人が書いた表', null);
    const before = env.fake._docs.get(env.fileId);
    expectRefused(() => env.ctx.apiRevisionExport(env.fileId), /書き出したものではないため置き換えられません/);
    expect(env.fake._docs.get(env.fileId)).toBe(before);
  });

  it('記録していない変更があれば、書かずに断る', () => {
    const env = docEnv();
    env.fake._docs.set(env.fileId, '<p>第1条 直接なおした</p>\n');
    const commits = env.ctx.dbReadAll('commits').length;
    expectRefused(() => env.ctx.apiRevisionExport(env.fileId), /記録していない変更があります/);
    expect(env.fake._docs.get(env.fileId)).toBe('<p>第1条 直接なおした</p>\n');
    expect(env.ctx.dbReadAll('commits')).toHaveLength(commits);
  });

  it('書く前に表を確かめ、空のセル・列のずれがあれば何も書かない', () => {
    const env = docEnv();
    const { ctx } = env;
    expect([...ctx.revisionTableProblems_('改訂履歴', [['a', 'b'], ['c', ' ']])]).toEqual(['2行目 2列目: 空のセルは書けません']);
    expect([...ctx.revisionTableProblems_('改訂履歴', [['a', 'b'], ['c']])]).toEqual(['2行目: 列の数が見出しと違います']);
    expect(() => ctx.revisionWriteDoc_(env.fileId, '改訂履歴', [['a', 'b'], ['c', '']]))
      .toThrow(/改訂履歴の表として正しくありません/);
    expect(ctx.DocumentApp._calls).toEqual([]);
    // 理由の無い反映は「—」で埋めて書く (空のセルにしない)
    expect(ctx.revisionTableRows_([{ number: 1, title: '', mergedAt: '', mergedBy: '', reason: '' }])[1])
      .toEqual(['—', '—', '#1 ', '—']);
  });

  it('管理者でなければ断る', () => {
    const env = docEnv();
    asUser(env.fake, OTHER, () => {
      expectRefused(() => env.ctx.apiRevisionExport(env.fileId), /管理者/);
    });
    expect(env.fake._docs.get(env.fileId)).toBe('<p>第1条</p>\n');
  });

  it('改訂版の文書から押しても、正式版に書く', () => {
    const env = docEnv();
    mergeOnce(env, { branch: 'a', html: '<p>第1条</p>\n<p>第2条</p>\n', title: '一つ目', reason: 'r' });
    env.ctx.apiBranchCreate('b', env.fileId);
    const work = env.ctx.branchWorkingFileId('b', env.fileId);
    const out = env.ctx.apiRevisionExport(work);
    expect(out.fileId).toBe(env.fileId);
    expect(env.fake._docs.get(env.fileId)).toContain('<h2>改訂履歴</h2>');
    expect(env.fake._docs.get(work)).not.toContain('改訂履歴');
  });
});

describe('改訂履歴の表を書き出す (Sheets)', () => {
  function sheetEnv() {
    const env = makeEnv();
    const { ctx, fake } = env;
    const ss = ctx.SpreadsheetApp.create('手当表');
    ss.insertSheet('手当').getRange(1, 1, 2, 2).setValues([['名前', '額'], ['通勤', '1000']]);
    ctx.repoRegisterFile(ss.getId(), '手当表.sheet');
    // Sheets はシートを読んで正規化する (Docs だけ fake._docs を読む)
    ctx.liveHtml = (id) => (id === ss.getId() ? ctx.renderSheet(id) : fake._docs.get(id) || '');
    ctx.commitFile(ss.getId(), 'main', '初期', null);
    return Object.assign(env, { ss, sheetId: ss.getId() });
  }

  it('改訂履歴のシートを作り、ほかのシートには触れず、記録として残す', () => {
    const env = sheetEnv();
    const { ctx, ss, sheetId } = env;
    // 確認依頼は台帳に直に置く (Sheets の改訂版の道は別のテストで見ている)
    ctx.dbAppend('pulls', {
      number: 1, title: '通勤手当の見直し', body: '', sourceBranch: 'x', targetBranch: 'main', state: 'merged',
      author: OWNER, createdAt: new Date(), mergedAt: new Date('2026-10-01T03:00:00Z'), reviewers: '',
      targetFiles: sheetId, staleReviewId: '', mergedBy: OWNER, mergeReason: '1000-2000 に上げる',
    });

    const out = ctx.apiRevisionExport(sheetId);
    expect(out).toMatchObject({ type: 'sheet', rows: 1, changed: true });
    const values = ss.getSheetByName('改訂履歴').getDataRange().getDisplayValues();
    expect(values).toEqual([
      ['日付', '反映した人', '確認依頼', '理由'],
      ['2026-10-01', 'tester', '#1 通勤手当の見直し', '1000-2000 に上げる'],
    ]);
    // 日付も字のまま (Sheets に日付として読ませない)
    expect(typeof ss.getSheetByName('改訂履歴')._rows[1][0]).toBe('string');
    expect(ss.getSheetByName('手当').getDataRange().getDisplayValues()).toEqual([['名前', '額'], ['通勤', '1000']]);
    expect(ctx.apiCommitHistory(sheetId)[0].message).toBe('改訂履歴の表を書き出しました');
    expect(ctx.fileStatus(sheetId, 'main').dirty).toBe(false);
  });

  it('人が作った同じ名前のシートは置き換えずに断る', () => {
    const env = sheetEnv();
    const { ctx, ss, sheetId } = env;
    ss.insertSheet('改訂履歴').getRange(1, 1, 1, 2).setValues([['版', '日']]);
    ctx.commitFile(sheetId, 'main', '人が作った', null);
    expectRefused(() => ctx.apiRevisionExport(sheetId), /書き出したものではないため置き換えられません/);
    expect(ss.getSheetByName('改訂履歴').getDataRange().getDisplayValues()).toEqual([['版', '日']]);
  });
});

describe('Slides は書き出せない', () => {
  it('断り、一覧では押せない理由を返す', () => {
    const env = makeEnv();
    const { ctx, fake, config } = env;
    const deck = fake._createDoc('説明会', '<section data-slide="1">\n', config.mainId);
    ctx.repoRegisterFile(deck, '説明会.slide');
    ctx.dbUpdate('files', 'fileId', deck, { type: 'slide' });

    expectRefused(() => ctx.apiRevisionExport(deck), /Slides には改訂履歴の表を書き出せません/);
    const out = ctx.apiRevisionHistory(deck);
    expect(out.canExport).toBe(false);
    expect(out.exportBlocked).toContain('Slides');
  });
});
