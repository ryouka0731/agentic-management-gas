import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Tag.gs',
  'src/core/Template.gs',
  'src/core/Member.gs',
  'src/core/Archive.js',
  'src/core/Staleness.js',
  'src/core/Issue.gs',
  'src/core/IssueComment.gs',
  'src/core/Project.gs',
  'src/core/Mention.js',
  'src/core/Inquiry.gs',
  'src/core/Notifier.gs',
];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');

  const issue = ctx.issueCreate('話し合うやること', '', []);
  return { ctx, fake, issue };
}

describe('やることの中で話す', () => {
  it('古い順に並ぶ', () => {
    const { ctx, issue } = setup();
    ctx.issueCommentAdd(issue.number, 'ひとつめ');
    ctx.issueCommentAdd(issue.number, 'ふたつめ');

    expect(ctx.issueComments(issue.number).map((c) => c.body))
      .toEqual(['ひとつめ', 'ふたつめ']);
  });

  it('無いやることには書き込めない', () => {
    const { ctx } = setup();
    expect(() => ctx.issueCommentAdd(999, 'なにか')).toThrow(/見つかりません/);
  });

  it('空は受け付けない', () => {
    const { ctx, issue } = setup();
    expect(() => ctx.issueCommentAdd(issue.number, '  ')).toThrow(/内容を入力/);
  });

  it('長すぎるものは断る', () => {
    const { ctx, issue } = setup();
    expect(() => ctx.issueCommentAdd(issue.number, 'あ'.repeat(4001)))
      .toThrow(/4000文字/);
  });

  it('自分の書き込みは直せる', () => {
    const { ctx, issue } = setup();
    const row = ctx.issueCommentAdd(issue.number, 'まえ');

    const after = ctx.issueCommentEdit(row.id, 'あと');

    expect(after.body).toBe('あと');
    expect(after.editedAt).not.toBe('');
  });

  it('他人の書き込みは直せない', () => {
    const { ctx, issue } = setup();
    const row = ctx.issueCommentAdd(issue.number, 'ひとの');
    ctx.dbUpdate('issue_comments', 'id', row.id, { by: 'hoka@example.com' });

    expect(() => ctx.issueCommentEdit(row.id, 'x')).toThrow(/自分が書いたもの/);
    expect(() => ctx.issueCommentDelete(row.id)).toThrow(/自分が書いたもの/);
  });

  it('自分の書き込みは消せる', () => {
    const { ctx, issue } = setup();
    const row = ctx.issueCommentAdd(issue.number, '消す');

    ctx.issueCommentDelete(row.id);

    expect(ctx.issueComments(issue.number)).toEqual([]);
  });

  it('担当者に知らせる', () => {
    const { ctx, fake, issue } = setup();
    ctx.issueUpdate(issue.number, { assignee: 'tanto@example.com' });

    const before = fake._sentMails().length;
    ctx.issueCommentAdd(issue.number, 'どうでしょう');

    expect(fake._sentMails().slice(before).map((m) => m.to))
      .toEqual(['tanto@example.com']);
    expect(ctx.noticeList('tanto@example.com')[0].link)
      .toBe('issue:' + issue.number);
  });

  it('書いた本人には送らない', () => {
    const { ctx, fake, issue } = setup();
    ctx.issueUpdate(issue.number, { assignee: 'tester@example.com' });

    const before = fake._sentMails().length;
    ctx.issueCommentAdd(issue.number, 'ひとりごと');

    expect(fake._sentMails().length).toBe(before);
  });

  it('前に書き込んだ人にも知らせる', () => {
    const { ctx, fake, issue } = setup();
    const first = ctx.issueCommentAdd(issue.number, 'さきに');
    ctx.dbUpdate('issue_comments', 'id', first.id, { by: 'saki@example.com' });

    const before = fake._sentMails().length;
    ctx.issueCommentAdd(issue.number, 'あとから');

    expect(fake._sentMails().slice(before).map((m) => m.to))
      .toEqual(['saki@example.com']);
  });

  it('名前を呼べる', () => {
    const { ctx, fake, issue } = setup();
    ctx.dbAppend('members', {
      email: 'aoki@example.com', manager: '', note: '',
      updatedAt: new Date(), name: '',
    });
    ctx.issueUpdate(issue.number, { assignee: 'aoki@example.com' });
    ctx.issueUpdate(issue.number, { assignee: '' });

    const before = fake._sentMails().length;
    ctx.issueCommentAdd(issue.number, '@aoki 見てください');

    expect(fake._sentMails().slice(before).map((m) => m.to))
      .toContain('aoki@example.com');
  });

  it('既に知らせる人を二度呼ばない', () => {
    const { ctx, fake, issue } = setup();
    ctx.issueUpdate(issue.number, { assignee: 'tanto@example.com' });

    const before = fake._sentMails().length;
    ctx.issueCommentAdd(issue.number, '@tanto おねがい');

    expect(fake._sentMails().slice(before)
      .filter((m) => m.to === 'tanto@example.com')).toHaveLength(1);
  });
});

describe('補足の下書き', () => {
  it('用意されたものが入っている', () => {
    const { ctx } = setup();

    expect(ctx.templateList().map((t) => t.name))
      .toEqual(ctx.TEMPLATE_BUILTIN().map((t) => t.name));
  });

  it('自分で作れる', () => {
    const { ctx } = setup();
    const row = ctx.templateSave('週報', '## 今週やったこと\n');

    expect(row.name).toBe('週報');
    expect(row.builtin).toBe(false);
  });

  it('同じ名前なら中身を入れ替える', () => {
    const { ctx } = setup();
    ctx.templateSave('週報', 'まえ');
    ctx.templateSave('週報', 'あと');

    expect(ctx.templateList().filter((t) => t.name === '週報')).toHaveLength(1);
    expect(ctx.dbFindOne('templates', 'name', '週報').body).toBe('あと');
  });

  it('用意されたものは書き換えられない', () => {
    const { ctx } = setup();
    ctx.templateList();

    // 誰かが直すと、他の人の下書きが黙って変わる
    expect(() => ctx.templateSave('作業の段取り', 'x'))
      .toThrow(/書き換えられません/);
    expect(() => ctx.templateDelete('作業の段取り')).toThrow(/消せません/);
  });

  it('中身が空なら作れない', () => {
    const { ctx } = setup();
    expect(() => ctx.templateSave('から', '   ')).toThrow(/中身を入力/);
  });

  it('自分が作ったものは消せる', () => {
    const { ctx } = setup();
    ctx.templateSave('週報', 'x');
    ctx.templateDelete('週報');

    expect(ctx.dbFindOne('templates', 'name', '週報')).toBe(null);
  });

  it('他人が作ったものは消せない', () => {
    const { ctx } = setup();
    ctx.templateSave('週報', 'x');
    ctx.dbUpdate('templates', 'name', '週報', { createdBy: 'hoka@example.com' });
    ctx.DriveApp.getFolderById(ctx.repoConfig().rootId)._setOwner('owner@example.com');

    expect(() => ctx.templateDelete('週報')).toThrow(/自分が作った下書きだけ/);
  });
});
