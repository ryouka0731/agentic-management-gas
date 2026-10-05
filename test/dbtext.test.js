import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs',
  'src/core/Repo.gs', 'src/core/Plain.js', 'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Issue.gs',
  'src/core/IssueComment.gs', 'src/core/Project.gs', 'src/core/Mention.js',
  'src/core/Member.gs', 'src/core/Brand.js', 'src/core/Inquiry.gs',
  'src/core/Notifier.gs', 'src/core/Usage.gs',
];

/*
 * 台帳は Sheets であり、appendRow / setValues で書いた字は、人がセルに打ち
 * 込んだときと同じように読まれる。題名ややりとりに '1/2' と書けば日付に、
 * '007' と書けば 7 になり、'=' で始めれば台帳の中で数式として動く。
 *
 * 疑似GASは字をそのまま持つので、これまで一度も現れなかった。
 */
function setup() {
  const fake = createFakeGas();
  fake._parseLikeSheets(true);
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

const TRICKY = ['1/2', '007', '=HYPERLINK("https://e.test","x")', "'引用", 'TRUE', '1e3'];

describe('書いた字は書いたとおりに残る', () => {
  for (const text of TRICKY) {
    it('題名 ' + text, () => {
      const { ctx } = setup();
      const made = ctx.issueCreate(text, text, []);

      const row = ctx.issueGet(made.number);
      expect(row.title).toBe(text);
      expect(row.body).toBe(text);
    });
  }

  it('直したあとも字のまま残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('はじめ', '', []);
    ctx.issueUpdate(made.number, { title: '1/2' });

    // 別の欄を直して行を書き戻しても、題名は字のまま
    ctx.issueUpdate(made.number, { body: '本文' });
    expect(ctx.issueGet(made.number).title).toBe('1/2');
  });

  it('やりとりも字のまま残る', () => {
    const { ctx } = setup();
    const made = ctx.issueCreate('x', '', []);
    const c = ctx.issueCommentAdd(made.number, '=1+1');

    expect(ctx.issueCommentGet(c.id).body).toBe('=1+1');
  });

  it('番号は数として読める', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('a', '', []);
    const b = ctx.issueCreate('b', '', []);

    expect(ctx.issueGet(b.number).number).toBe(a.number + 1);
  });

  it('使われ方の場所も字のまま残る', () => {
    const { ctx, fake } = setup();
    fake.Utilities.formatDate = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };
    ctx.usageRecord([{ kind: 'action', target: '1-2', count: 1 }]);
    ctx.usageRecord([{ kind: 'action', target: '1-2', count: 2 }]);

    const rows = ctx.dbReadAll('usage');
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('1-2');
    expect(Number(rows[0].count)).toBe(3);
  });
});
