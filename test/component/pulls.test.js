// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

describe('確認依頼', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('承認が無いうちは反映できない', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    const merge = [...document.querySelectorAll('#pr-detail .btn')]
      .find((b) => b.textContent.indexOf('反映') >= 0);

    expect(merge.disabled).toBe(true);
    expect(merge.title).toContain('承認');
  });

  it('自分が出した依頼は自分で承認できない', () => {
    mount({
      apiPrList: [{
        number: 1, title: '第2条の改訂', sourceBranch: '見直し', targetBranch: 'main',
        state: 'open', author: 'me@example.com', createdAt: '',
      }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    const approve = [...document.querySelectorAll('#pr-detail .btn')]
      .find((b) => b.textContent.indexOf('承認') >= 0);

    expect(approve.disabled).toBe(true);
  });
});

describe('押す前の補足', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('まとめて記録が何をまとめるのかを補足する', () => {
    mount();
    const btn = document.getElementById('bulk-commit-btn');

    expect(btn.dataset.hint).toContain('まだ記録していない変更');
    expect(btn.dataset.hint).toContain('まとめて記録');
  });

  it('補足は読み上げにも届く', () => {
    mount();
    const btn = document.getElementById('bulk-commit-btn');
    const note = document.getElementById(btn.getAttribute('aria-describedby'));

    expect(note).toBeTruthy();
    expect(note.className).toBe('sr-only');
    expect(note.textContent).toBe(btn.dataset.hint);
  });

  it('補足を持つボタンは名前も持ったまま', () => {
    mount();
    const btn = document.getElementById('bulk-commit-btn');

    // 補足はあくまで補足。ボタンの名前を置き換えない
    expect(btn.textContent).toBe('まとめて記録');
  });

  it('言葉の分かりにくいボタンに揃って付く', () => {
    mount();

    ['bulk-commit-btn', 'branch-create-btn', 'commit-btn', 'stash-btn']
      .forEach((id) => {
        const el = document.getElementById(id);
        expect(el.classList.contains('has-hint')).toBe(true);
        expect(el.dataset.hint.length).toBeGreaterThan(10);
      });
  });

  it('補足の宛先はひとつずつ別になっている', () => {
    mount();

    const ids = [...document.querySelectorAll('[aria-describedby]')]
      .map((el) => el.getAttribute('aria-describedby'));

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('確認依頼の一覧', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openPulls() {
    const app = mount();
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  it('題名と行き先が行に出る', () => {
    openPulls();
    const row = document.querySelector('#pr-list .row-item');

    expect(row.querySelector('.row-title').textContent).toBe('#1 第2条の改訂');
    expect(row.querySelector('.row-meta').textContent).toContain('→ 正式版');
    expect(row.querySelector('.state').textContent).toBe('確認待ち');
  });

  it('行はボタンでも左寄せ', () => {
    openPulls();
    const row = document.querySelector('#pr-list .row-item');

    // ボタンの既定は中央寄せ。明示しないとここだけ真ん中に寄る
    expect(row.tagName).toBe('BUTTON');
    expect(window.getComputedStyle(row).textAlign).toBe('left');
  });

  it('一覧の幅は掴んで変えられる', () => {
    openPulls();
    const handle = document.getElementById('pr-resizer');

    handle.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    const move = new window.Event('pointermove', { bubbles: true });
    move.clientX = 600;
    handle.dispatchEvent(move);

    expect(document.documentElement.style.getPropertyValue('--pr-pane-w'))
      .toMatch(/px$/);
  });

  it('履歴の幅とは別に覚える', () => {
    openPulls();
    const css = document.querySelector('style').textContent;

    // 同じ変数を使うと、片方を動かしたらもう片方も動く
    expect(css).toContain('--pr-pane-w');
    expect(css).toContain('#pr-pane { flex-basis: var(--pr-pane-w); }');
  });
});

describe('確認依頼の中身の切り替え', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('見方に分かれている', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    const tabs = [...document.querySelectorAll('#pr-detail .pr-tab')]
      .map((el) => el.textContent);

    // 「コードの変更」は証跡があるときだけ出る
    expect(tabs).toEqual(['やりとり', '変更の記録', '差分', '手元への頼みごと']);
  });
});

describe('確認依頼のやりとり', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  function comments() {
    return [...document.querySelectorAll('#pr-detail .comment')];
  }

  it('誰の発言かを顔と名前で示す', () => {
    openPulls();
    const head = comments()[0].querySelector('.comment-head');

    // アドレスは目で追いにくい。名前を主に、アドレスを従に出す
    expect(head.querySelector('.avatar').textContent).toBe('鈴');
    expect(head.querySelector('.person-name').textContent).toBe('鈴木 花子');
    expect(head.querySelector('.person-mail').textContent).toBe('other@example.com');
  });

  it('自分のコメントには直すと消すが付く', () => {
    openPulls();
    // 先頭は依頼そのもの。1件目のやりとりが自分のもの
    const mine = comments()[1];

    expect(mine.querySelector('.comment-tools')).toBeTruthy();
    expect(mine.querySelector('.comment-tools .btn-danger')).toBeTruthy();
  });

  it('他人のコメントには付かない', () => {
    openPulls();
    expect(comments()[2].querySelector('.comment-tools')).toBe(null);
  });

  it('直すと今の中身が入った状態で開く', () => {
    const app = openPulls();
    comments()[1].querySelector('.comment-tools .icon-btn').click();

    const field = document.querySelector('#side-body textarea, #side-body input');
    expect(field.value).toBe('ここを直して');

    field.value = 'やっぱりこう';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiReviewEdit').pop();
    expect(call.args).toEqual([1, 'やっぱりこう']);
  });

  it('消すのは確かめてから', () => {
    const app = openPulls();
    comments()[1].querySelector('.comment-tools .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiReviewDelete')).toBe(false);

    document.querySelector('#pr-detail .confirm-strip .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiReviewDelete').pop().args[0]).toBe(1);
  });

  it('直したものにはその印が出る', () => {
    openPulls({
      apiPrReviews: [{
        id: 1, reviewer: 'me@example.com', state: 'comment', body: 'なおした',
        at: '2026-09-05T00:00:00.000Z', editedAt: '2026-09-06T00:00:00.000Z',
        canEdit: true,
      }],
    });

    expect(comments()[1].textContent).toContain('直しました');
  });
});

describe('確認してもらう人', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  it('頼んだ人が顔つきで並ぶ', () => {
    openPulls();
    const chip = document.querySelector('#pr-detail .reviewer-chip');

    expect(chip.querySelector('.person-name').textContent).toBe('山田 太郎');
    expect(chip.querySelector('.person-mail').textContent).toBe('me@example.com');
    expect(chip.querySelector('.avatar')).toBeTruthy();
  });

  it('誰にも頼んでいなければそう出る', () => {
    openPulls({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], reviewers: [] }],
    });

    expect(document.querySelector('#pr-detail .reviewer-row').textContent)
      .toContain('まだ誰にも頼んでいません');
  });

  it('カンマ区切りで決められる', () => {
    const app = openPulls();
    document.querySelector('#pr-detail .reviewer-row .icon-btn').click();

    const input = document.querySelector('#side-body input');
    expect(input.value).toBe('me@example.com');

    input.value = 'a@example.com, b@example.com';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiPrSetReviewers').pop();
    expect(call.args[0]).toBe(1);
    expect(call.args[1]).toEqual(['a@example.com', ' b@example.com']);
  });

  it('反映済みなら決め直せない', () => {
    openPulls({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], state: 'merged' }],
    });

    expect(document.querySelector('#pr-detail .reviewer-row .icon-btn')).toBe(null);
  });
});

describe('確認依頼の反映先', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDrafts() {
    const app = mount();
    document.querySelector('[data-tab="branches"]').click();
    return app;
  }

  it('同じ文書の別の版を選べる', () => {
    openDrafts();
    [...document.querySelectorAll('#branch-list .btn-primary')][0].click();

    const sel = document.querySelector('#side-body select');
    expect([...sel.options].map((o) => o.textContent))
      .toEqual(['正式版', '土台']);
    expect(sel.value).toBe('main');
  });

  it('選んだ先を一緒に送る', () => {
    const app = openDrafts();
    [...document.querySelectorAll('#branch-list .btn-primary')][0].click();

    document.querySelector('#side-body select').value = '土台';
    document.querySelector('#side-body form input').value = '第4条を足した';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiPrCreate').pop().args[4])
      .toBe('土台');
  });

  it('選びようが無ければ選択肢を隠す', () => {
    mount({
      apiListFiles: [
        { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
        { fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' },
      ],
      apiBranchList: [
        { name: 'main', headSha: 'a', baseSha: '', state: 'open', createdBy: 'me@example.com', createdAt: '' },
        { name: '見直し', headSha: 'b', baseSha: 'a', state: 'open', createdBy: 'me@example.com', createdAt: '' },
      ],
    });
    document.querySelector('[data-tab="branches"]').click();
    document.querySelector('#branch-list .btn-primary').click();

    // 選びようが無いときに選択肢を見せても、迷わせるだけ
    expect(document.querySelector('#side-body select').parentNode.hidden)
      .toBe(true);
  });

  it('一覧に反映先を出す', () => {
    mount({
      apiPrList: [{
        ...DEFAULTS.apiPrList[0], targetBranch: '土台',
      }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    expect(document.querySelector('#pr-list .row-meta').textContent)
      .toContain('見直し → 土台');
  });

  it('反映のボタンにも行き先を出す', () => {
    mount({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], targetBranch: '土台' }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    expect([...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .map((b) => b.textContent).join(' ')).toContain('土台に反映する');
  });
});

describe('確認依頼を取り下げる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 自分が出した依頼にする */
  const MINE = {
    apiPrList: [{
      number: 1, title: '第2条の改訂', sourceBranch: '見直し', targetBranch: 'main',
      state: 'open', author: 'me@example.com', createdAt: '',
      body: '第2条を直しました', reviewers: ['other@example.com'],
      canClose: true,
    }],
  };

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  function offButton() {
    return [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => b.textContent === '取り下げる')[0];
  }

  it('確認依頼から取り下げられる', () => {
    // 出したあとに思い直せず、誰も見ない依頼が開いたまま残っていた
    openPulls(MINE);

    expect(offButton()).toBeTruthy();
    expect(offButton().disabled).toBe(false);
  });

  it('確かめてからでないと取り下げない', () => {
    const app = openPulls(MINE);
    offButton().click();

    expect(app.calls.some((c) => c.name === 'apiPrClose')).toBe(false);

    const strip = document.querySelector('#pr-detail .confirm-strip');
    expect(strip.textContent).toContain('改訂版そのものは残る');
    expect(strip.textContent).toContain('改めて依頼できます');

    strip.querySelector('.btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiPrClose').pop().args[0]).toBe(1);
  });

  it('取り下げたら一覧と数を取り直す', () => {
    const app = openPulls(MINE);
    offButton().click();
    document.querySelector('#pr-detail .confirm-strip .btn-primary').click();

    const names = app.calls.map((c) => c.name);
    const at = names.lastIndexOf('apiPrClose');

    expect(names.slice(at)).toContain('apiPrList');
    expect(names.slice(at)).toContain('apiOverview');
  });

  it('取り下げられない人には押させない', () => {
    // 確認を頼まれた側が取り下げられると、頼んだ人の知らないうちに消える
    openPulls();

    expect(offButton().disabled).toBe(true);
    expect(offButton().title).toContain('出した本人か、このアプリの管理者だけ');
  });

  it('反映済みと取り下げ済みには操作の欄を出さない', () => {
    ['merged', 'closed'].forEach((state) => {
      window.localStorage.clear();
      openPulls({
        apiPrList: [Object.assign({}, MINE.apiPrList[0], {
          state, canClose: false,
        })],
      });

      expect(document.querySelector('#pr-detail .pr-actions')).toBeNull();
    });
  });

  it('取り下げたものは「取り下げ」と出る', () => {
    openPulls({
      apiPrList: [Object.assign({}, MINE.apiPrList[0], {
        state: 'closed', canClose: false,
      })],
    });

    expect(document.querySelector('#pr-list .row-item .state').textContent)
      .toBe('取り下げ');
  });

  it('取り下げられなかったら理由を知らせ、押し直せる', () => {
    openPulls(Object.assign({}, MINE, {
      apiPrClose: new Error('これは既に反映済みです'),
    }));
    const off = offButton();
    off.click();
    document.querySelector('#pr-detail .confirm-strip .btn-primary').click();

    expect(document.getElementById('snackbar').textContent)
      .toContain('これは既に反映済みです');
    expect(off.disabled).toBe(false);
  });
});

describe('コードの変更を確認依頼で読む', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const PATCH = [
    '--- a/src/core/Usage.gs',
    '+++ b/src/core/Usage.gs',
    '@@ -1,3 +1,4 @@',
    ' function usageDay() {',
    '-  return old;',
    '+  return next;',
    ' }',
  ].join('\n');

  const WITH_PATCH = {
    apiPrPreview: {
      clean: true, problems: [], conflicts: [], approvals: 1, ops: [],
      patchCount: 1,
      files: [{
        fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
        clean: true, problems: [], conflicts: [], ops: [],
      }],
    },
    apiPrPatches: [{
      id: 1, path: 'src/core/Usage.gs', added: 1, removed: 1,
      by: 'me@example.com', at: '2026-09-30T00:00:00.000Z', text: PATCH,
    }],
  };

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  function tab(label) {
    return [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === label)[0];
  }

  it('証跡があるときだけ見出しを出す', () => {
    openPulls(WITH_PATCH);
    expect(tab('コードの変更')).toBeTruthy();

    // 空の頁を開かせない
    window.localStorage.clear();
    openPulls();
    expect(tab('コードの変更')).toBeUndefined();
  });

  it('書いたとおりの字で出す', () => {
    openPulls(WITH_PATCH);
    tab('コードの変更').click();

    // 1バイト違えば別物なのが前提。整形すると読み手が判断を誤る
    const lines = [...document.querySelectorAll('#pr-detail .patch-line')]
      .map((el) => el.textContent);

    expect(lines).toContain('-  return old;');
    expect(lines).toContain('+  return next;');
    expect(lines).toContain('@@ -1,3 +1,4 @@');
  });

  it('足した行と消した行を見分けられる', () => {
    openPulls(WITH_PATCH);
    tab('コードの変更').click();

    expect(document.querySelectorAll('#pr-detail .patch-add')).toHaveLength(1);
    expect(document.querySelectorAll('#pr-detail .patch-del')).toHaveLength(1);
    expect(document.querySelectorAll('#pr-detail .patch-hunk')).toHaveLength(1);
  });

  it('反映されないことを必ず断る', () => {
    openPulls(WITH_PATCH);
    tab('コードの変更').click();

    // 書いていないと「承認したのに入っていない」になる
    expect(document.querySelector('#pr-detail .side-note').textContent)
      .toContain('この道具では反映されません');
  });

  it('反映の確認でも、コードは書き換えないと言う', () => {
    openPulls(WITH_PATCH);
    [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => b.textContent.indexOf('反映') > -1)[0].click();

    expect(document.querySelector('#pr-detail .confirm-strip').textContent)
      .toContain('コードの変更は反映されません');
  });

  it('文書が無い依頼では「承認を記録する」になる', () => {
    openPulls({
      apiPrPreview: {
        clean: true, problems: [], conflicts: [], approvals: 1, ops: [],
        patchCount: 1, files: [],
      },
      apiPrPatches: WITH_PATCH.apiPrPatches,
    });

    // 書き戻すものが無いのに「反映する」と書くと、何が起きるか伝わらない
    const btn = [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => b.textContent === '承認を記録する')[0];

    expect(btn).toBeTruthy();
    btn.click();
    expect(document.querySelector('#pr-detail .confirm-strip').textContent)
      .toContain('書き換える文書はありません');
  });

  it('何も添えられていなければ、添え方を示す', () => {
    openPulls({
      apiPrPreview: Object.assign({}, WITH_PATCH.apiPrPreview),
      apiPrPatches: [],
    });
    tab('コードの変更').click();

    expect(document.querySelector('#pr-detail .blank-state').textContent)
      .toContain('agent patch');
  });
});

describe('手元への頼みごと', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const WORK = {
    apiPrPreview: {
      clean: true, problems: [], conflicts: [], approvals: 1, ops: [],
      patchCount: 1,
      files: [{
        fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
        clean: true, problems: [], conflicts: [], ops: [],
      }],
    },
    apiOutboxList: [{
      id: 5, verb: 'merge', label: '承認されたので取り込む',
      args: { branch: '見直し', into: 'main' },
      note: '確認依頼 #1「第2条の改訂」が承認されました。',
      state: 'open', prNumber: 1,
      createdAt: '2026-09-30T00:00:00.000Z', createdBy: 'me@example.com',
      takenAt: '', takenBy: '', doneAt: '', result: '',
    }],
  };

  function openWork(over) {
    mount(over);
    document.querySelector('[data-tab="pulls"]').click();

    const tab = [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === '手元への頼みごと')[0];
    if (tab) tab.click();
    return tab;
  }

  it('証跡が無くても頼める', () => {
    // 「差分を出して」は証跡を作る前に頼むもの。見出しが無いと頼めない
    expect(openWork(WORK)).toBeTruthy();

    window.localStorage.clear();
    expect(openWork()).toBeTruthy();
  });

  it('人からも頼める', () => {
    const app = mount(WORK);
    document.querySelector('[data-tab="pulls"]').click();
    [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === '手元への頼みごと')[0].click();

    [...document.querySelectorAll('#pr-detail .btn')]
      .filter((b) => b.textContent === '手元に頼む')[0].click();

    // 頼めることはサーバに出させる。写すと「選べるのに置けない」ものが出る
    expect(app.calls.some((c) => c.name === 'apiOutboxVerbs')).toBe(true);

    const select = document.querySelector('#side-body select');
    // 取り込みは承認したときに自動で置かれる。手で二重に頼ませない
    expect([...select.options].map((o) => o.value))
      .toEqual(['diff', 'review']);

    select.value = 'review';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiOutboxAdd').pop();
    expect(call.args[0]).toBe('review');
    expect(call.args[1]).toEqual({ branch: '見直し', against: 'main' });
    expect(call.args[2].prNumber).toBe(1);
  });

  it('頼みごとと今の様子を出す', () => {
    openWork(WORK);
    const row = document.querySelector('#pr-detail .row-item');

    expect(row.querySelector('.row-title').textContent)
      .toBe('承認されたので取り込む');
    expect(row.textContent).toContain('承認されました');
    expect(row.querySelector('.state').textContent).toBe('待っています');
  });

  it('「送りました」とは言わない', () => {
    openWork(WORK);

    // 押すのではなく取りに来る形である。すぐ動くと思われては困る
    const note = document.querySelector('#pr-detail .side-note').textContent;
    expect(note).toContain('取りに来る形');
    expect(note).toContain('agent work');
    expect(note).not.toContain('送りました');
  });

  it('手元からの返事も出す', () => {
    openWork({
      apiPrPreview: WORK.apiPrPreview,
      apiOutboxList: [Object.assign({}, WORK.apiOutboxList[0], {
        state: 'done', result: 'main に取り込んで push しました',
      })],
    });

    expect(document.querySelector('#pr-detail .row-item').textContent)
      .toContain('main に取り込んで push しました');
    expect(document.querySelector('#pr-detail .state').textContent)
      .toBe('終わりました');
  });

  it('できなかったことも残す', () => {
    openWork({
      apiPrPreview: WORK.apiPrPreview,
      apiOutboxList: [Object.assign({}, WORK.apiOutboxList[0], {
        state: 'failed', result: '食い違いがあります',
      })],
    });

    // 黙って消すと、頼んだ人は待ち続けることになる
    expect(document.querySelector('#pr-detail .state').textContent)
      .toBe('できませんでした');
  });

  it('他の依頼の頼みごとは混ぜない', () => {
    openWork({
      apiPrPreview: WORK.apiPrPreview,
      apiOutboxList: [Object.assign({}, WORK.apiOutboxList[0], { prNumber: 99 })],
    });

    expect(document.querySelector('#pr-detail .row-item')).toBeNull();
    expect(document.querySelector('#pr-detail .blank-state').textContent)
      .toContain('頼みごとはありません');
  });
});

describe('確認依頼の差分を文書ごとに出す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const TWO_FILES = {
    apiPrPreview: {
      clean: false, problems: [], conflicts: [], approvals: 1, ops: [],
      files: [
        {
          fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
          clean: true, problems: [], conflicts: [],
          ops: [{ type: 'insert', line: '<p>第3条</p>' }],
        },
        {
          fileId: 'DOC2', path: '賃金規程.doc', type: 'doc',
          clean: false, problems: [], conflicts: [{ ours: [], theirs: [] }],
          ops: [{ type: 'insert', line: '<p>第2条</p>' }],
        },
      ],
    },
  };

  function openDiff(over) {
    mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === '差分')[0].click();
  }

  it('どの文書の差分かを言う', () => {
    openDiff(TWO_FILES);

    // 言わずに並べると読めない
    expect([...document.querySelectorAll('#pr-detail .diff-file-name')]
      .map((el) => el.textContent)).toEqual(['就業規則.doc', '賃金規程.doc']);
  });

  it('食い違っている文書を先に分かるようにする', () => {
    openDiff(TWO_FILES);
    const heads = [...document.querySelectorAll('#pr-detail .diff-file-head')];

    expect(heads[0].querySelector('.chip')).toBeNull();
    expect(heads[1].querySelector('.chip').textContent)
      .toContain('同じ場所が両方で変わっています');
  });

  it('1件だけのときは見出しを出さない', () => {
    openDiff();

    // 自明なので邪魔になる
    expect(document.querySelector('#pr-detail .diff-file-head')).toBeNull();
  });
});

describe('承認のあとに中身が変わった依頼', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function mergeButton() {
    return [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => /反映する/.test(b.textContent))[0];
  }

  it('押せない理由に、承認し直しが要ることを出す', () => {
    mount({
      apiPrPreview: { ...DEFAULTS.apiPrPreview, approvals: 0, staleApprovals: 1 },
    });
    document.querySelector('[data-tab="pulls"]').click();

    // 「承認が必要」とだけ出ると、承認したはずの人が首をかしげる
    expect(mergeButton().disabled).toBe(true);
    expect(mergeButton().title).toContain('承認のあとに中身が変わっています');
  });

  it('古い承認が無ければ今までどおりの理由を出す', () => {
    mount({ apiPrPreview: { ...DEFAULTS.apiPrPreview, approvals: 0 } });
    document.querySelector('[data-tab="pulls"]').click();

    expect(mergeButton().title).toBe('反映には1件以上の承認が必要です');
  });
});

describe('見比べたものを反映する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('見比べたときの指紋を添えて反映を頼む', () => {
    const app = mount({
      apiPrPreview: { ...DEFAULTS.apiPrPreview, approvals: 1, previewSha: 'P1' },
    });
    document.querySelector('[data-tab="pulls"]').click();

    const merge = [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => /反映する/.test(b.textContent))[0];
    merge.click();
    const confirm = [...document.querySelectorAll('#pr-detail button')]
      .filter((b) => b.textContent === '反映する')[0];
    confirm.click();

    // 添えないと、見比べたあとで正式版が進んでも気づけない
    const calls = app.calls.filter((c) => c.name === 'apiPrMerge');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[2]).toBe('P1');
  });
});
