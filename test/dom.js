import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 画面を組み立てて実際に動かす。
 *
 * ソースを文字列で検査するだけでは、描画も応答も確かめられない。
 * wiki.html に部分HTMLを差し込み、google.script.run を差し替えたうえで
 * app.js を本当に走らせる。
 *
 * @param {Object<string, *|function>} responses API名 → 返す値、または関数
 * @returns {{calls: object[], respond: function, flush: function}}
 */
export function mountApp(responses) {
  const html = read('src/ui/wiki.html')
    .replace("<?!= include('ui/app.css') ?>", read('src/ui/app.css.html'))
    .replace("<?!= include('ui/app.js') ?>", '');

  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/, '')
    .replace(/<\/html>[\s\S]*$/, '');

  const calls = [];
  const table = Object.assign({}, responses);

  /**
   * google.script.run を模す。
   *
   * 実物と同じく、成功と失敗のハンドラを繋いでから API を呼ぶ形にする。
   */
  function makeRunner(onSuccess, onFailure) {
    const runner = {
      withSuccessHandler(fn) { return makeRunner(fn, onFailure); },
      withFailureHandler(fn) { return makeRunner(onSuccess, fn); },
    };

    const names = new Set([...Object.keys(table), ...API_NAMES]);
    names.forEach((name) => {
      runner[name] = function (...args) {
        calls.push({ name, args });

        let value = table[name];
        if (typeof value === 'function') value = value(...args);

        if (value instanceof Error) {
          if (onFailure) onFailure(value);
          return;
        }
        if (onSuccess) onSuccess(value === undefined ? null : value);
      };
    });
    return runner;
  }

  window.google = { script: { run: makeRunner(null, null) } };

  // app.js は <script> で包まれている。中身だけを走らせる
  const js = read('src/ui/app.js.html')
    .replace(/^\s*<script>/, '')
    .replace(/<\/script>\s*$/, '');

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'google', js)(window, document, window.google);

  return {
    calls,
    /** 応答を差し替える */
    respond(name, value) { table[name] = value; },
    /** ハンドラが同期で走るため、待つ必要はない */
    flush() {},
  };
}

/** 画面が呼びうる API。表に無くても呼べるようにしておく */
const API_NAMES = [
  'apiListFiles', 'apiGetFileHtml', 'apiFileStatus', 'apiCommit', 'apiCommitGraph',
  'apiCommitDiff', 'apiCommitHistory', 'apiBranchList', 'apiBranchCreate',
  'apiBranchDelete', 'apiPrList', 'apiPrCreate', 'apiPrPreview', 'apiPrReview',
  'apiPrMerge', 'apiPrReviews', 'apiPrCommits', 'apiIssueList', 'apiIssueCreate',
  'apiIssueUpdate', 'apiIssueClose', 'apiIssueCreateBranch', 'apiIssuesForFile',
  'apiProjectBoard', 'apiProjectMove', 'apiGetMarkdown', 'apiSaveMarkdown',
  'apiStashMainDrift', 'apiWhoAmI', 'apiOverview', 'apiDirtyFiles', 'apiCommitMany',
  'apiKnownPeople', 'apiIssueArchive', 'apiIssueRestore', 'apiIssuePurge',
  'apiIssueArchivedList', 'apiArchiveKeepDays', 'apiIssueReopen', 'apiReviewEdit', 'apiReviewDelete', 'apiPrSetReviewers', 'apiInquiryCreate', 'apiInquiryList', 'apiInquiryKinds', 'apiInquiryThread', 'apiInquiryReply',
  'apiInquiryReplyEdit', 'apiInquiryReplyDelete', 'apiInquiryClose', 'apiInquiryReopen', 'apiNotifications', 'apiNotificationsRead',
  'apiTagList', 'apiTagCreate', 'apiTagDelete', 'apiTagColors',
  'apiTasksState', 'apiTasksChooseList', 'apiTasksSync',
  'apiTallyEffort', 'apiTallyScope', 'apiMemberList', 'apiMemberSet',
  'apiPeopleNames', 'apiPeopleSetName',
];

/** よく使う既定の応答 */
export const DEFAULTS = {
  apiListFiles: [
    { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
    { fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' },
    { fileId: 'W2', path: 'branches/土台/就業規則.doc', type: 'doc' },
  ],
  apiOverview: { repo: 'agentic-management', docs: 1, branches: 1, openIssues: 2, openPrs: 1, commits: 5 },
  apiWhoAmI: { activeUser: 'me@example.com', effectiveUser: 'me@example.com', sameUser: true },
  apiArchiveKeepDays: 30,
  apiIssueArchivedList: [],
  apiInquiryList: [],
  apiNotifications: { items: [], unread: 0 },
  apiTasksState: { available: false, listId: '', lists: [] },
  apiTallyScope: { me: 'me@example.com', canSee: ['me@example.com'], isManager: false, canEdit: false },
  apiTallyEffort: { periods: [], people: [], total: { planned: 0, actual: 0, diff: 0, count: 0 }, skipped: 0, hidden: 0 },
  apiTagList: [
    { name: '文書改訂', color: 'accent', builtin: true },
    { name: '会議', color: 'success', builtin: true },
  ],
  apiIssueList: [
    {
      number: 2, title: '通勤手当の見直し', body: '', state: 'open',
      assignee: 'me@example.com', labels: '規定改訂', linkedFileIds: 'DOC1',
      linkedPr: '', createdAt: '2026-09-01T00:00:00.000Z', closedAt: '',
      dueDate: '2026-09-30T00:00:00.000Z', startDate: '', parent: '',
      estimate: 3, plannedHours: 8, actualHours: 2,
    },
    {
      number: 1, title: '第2条の改訂', body: '', state: 'open',
      assignee: '', labels: '', linkedFileIds: 'DOC1', linkedPr: '',
      createdAt: '2026-09-02T00:00:00.000Z', closedAt: '',
      dueDate: '', startDate: '', parent: 2,
      estimate: '', plannedHours: 4, actualHours: '',
    },
  ],
  apiProjectBoard: {
    Backlog: [{ issueNumber: 2, order: 0, title: '通勤手当の見直し', state: 'open', assignee: 'me@example.com', labels: '規定改訂', dueDate: '' }],
    'In Progress': [], 'In Review': [], Done: [],
  },
  apiBranchList: [
    { name: 'main', headSha: 'a', baseSha: '', state: 'open', createdBy: 'me@example.com', createdAt: '' },
    { name: '見直し', headSha: 'b', baseSha: 'a', state: 'open', createdBy: 'me@example.com', createdAt: '' },
    { name: '土台', headSha: 'c', baseSha: 'a', state: 'open', createdBy: 'me@example.com', createdAt: '' },
  ],
  apiPrList: [
    {
      number: 1, title: '第2条の改訂', sourceBranch: '見直し', targetBranch: 'main',
      state: 'open', author: 'other@example.com', createdAt: '',
      body: '第2条を直しました', reviewers: ['me@example.com'],
    },
  ],
  apiPrReviews: [
    {
      id: 1, reviewer: 'me@example.com', state: 'comment', body: 'ここを直して',
      at: '2026-09-05T00:00:00.000Z', editedAt: '', canEdit: true,
    },
    {
      id: 2, reviewer: 'other@example.com', state: 'comment', body: '直しました',
      at: '2026-09-06T00:00:00.000Z', editedAt: '', canEdit: false,
    },
  ],
  apiPrPreview: { clean: true, problems: [], conflicts: [], approvals: 0, ops: [] },
  apiPrCommits: [],
  apiIssuesForFile: [],
  apiKnownPeople: ['me@example.com'],
  apiPeopleNames: { 'me@example.com': '山田 太郎', 'other@example.com': '鈴木 花子' },
  apiGetFileHtml: { html: '<p>第1条</p>\n', name: '就業規則', url: 'https://example.invalid/d/DOC1', path: '就業規則.doc' },
  apiFileStatus: { dirty: false, headSha: 'a', branch: 'main' },
  apiGetMarkdown: { markdown: '# 就業規則\n', branch: 'main', editable: false },
  apiCommitGraph: {
    rows: [
      {
        sha: 'aaaaaaa1111', branch: 'main', message: '第2条を直した', lane: 0,
        author: 'me@example.com', timestamp: '2026-09-09T07:53:00.000Z',
        parentSha: 'bbbbbbb2222', diffFrom: 'bbbbbbb2222', merge: false, activeLanes: [0], fork: false, forkLane: -1,
      },
      {
        sha: 'bbbbbbb2222', branch: 'main', message: '最初の記録', lane: 0,
        author: 'me@example.com', timestamp: '2026-09-04T01:39:00.000Z',
        parentSha: '', diffFrom: '', merge: false, activeLanes: [0], fork: false, forkLane: -1,
      },
    ],
    laneCount: 1,
    branches: ['main'],
  },
};
