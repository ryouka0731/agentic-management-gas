import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/*
 * 組む元 (wiki.html / app.css.html / app.js.html) は 1 ファイルの中で 1 回だけ読む。
 *
 * 画面を組むテストは数百あり、そのたびに 1万6千行を読み直して組み直していた。
 * 覚えるのは**字と、まだ走らせていない関数だけ**。関数は呼ぶたびに中身を
 * 頭から走らせるので、app.js の変数や聞き手は組むたびに新しく作られ、前の
 * 画面の状態は引き継がれない (状態は window / document 側にあり、それは
 * mountApp が毎回組み直し、dropLeftovers が外す)。
 * vitest はテストのファイルごとにモジュールを読み直すので、覚え書きもファイルを
 * またがない。
 */
let source = null;

function compiled() {
  if (source) return source;
  const html = read('src/ui/wiki.html')
    .replace("<?!= include('ui/app.css') ?>", read('src/ui/app.css.html'))
    .replace("<?!= include('ui/app.js') ?>", '')
    .replace(/^[\s\S]*?<html[^>]*>/, '')
    .replace(/<\/html>[\s\S]*$/, '');

  // app.js は <script> で包まれている。中身だけを走らせる
  const js = read('src/ui/app.js.html')
    .replace(/^\s*<script>/, '')
    .replace(/<\/script>\s*$/, '');

  // eslint-disable-next-line no-new-func
  source = { html, run: new Function('window', 'document', 'google', js) };
  return source;
}

/*
 * 前に組んだ画面が window / document に付けた聞き手と時計、待ちの rAF、iframe の中の window を外す。
 *
 * 組み直しても window と document は同じものなので、外さないと前の画面
 * (古い DOM まるごと) が聞き手から辿れたまま残る。画面を組むテストは
 * 数百あり、ホームに草 (742 マス) を足した時点で積み上がりがヒープの上限を
 * 超えて落ちた。前の画面の聞き手が今の画面の操作に応えることも無くなる。
 */
const leftovers = { listeners: [], intervals: [], frames: [] };
let tracking = false;

function trackGlobals() {
  if (tracking) return;
  tracking = true;
  [window, document].forEach((target) => {
    const add = target.addEventListener.bind(target);
    target.addEventListener = function (type, fn, opts) {
      leftovers.listeners.push([target, type, fn, opts]);
      return add(type, fn, opts);
    };
  });
  const every = window.setInterval.bind(window);
  window.setInterval = function (...args) {
    const id = every(...args);
    leftovers.intervals.push(id);
    return id;
  };
  // jsdom は描画しないので、待ちの rAF は呼ばれないまま前の画面を抱え続ける
  if (window.requestAnimationFrame) {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (fn) {
      const id = frame(fn);
      leftovers.frames.push(id);
      return id;
    };
  }
}

function dropLeftovers() {
  leftovers.listeners.forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
  leftovers.intervals.forEach((id) => window.clearInterval(id));
  leftovers.frames.forEach((id) => window.cancelAnimationFrame(id));
  // iframe の中の window は jsdom が手放さず、frameElement から前の画面を辿れて
  // しまう。iframe だけを先に木から外し、辿る先を iframe 1つに留める
  document.querySelectorAll('iframe').forEach((f) => {
    if (f.contentWindow) f.contentWindow.close();
    f.remove();
  });
  leftovers.listeners = [];
  leftovers.intervals = [];
  leftovers.frames = [];
}

/**
 * 画面を組み立てて実際に動かす。
 *
 * ソースを文字列で検査するだけでは、描画も応答も確かめられない。
 * wiki.html に部分HTMLを差し込み、google.script.run を差し替えたうえで
 * app.js を本当に走らせる。
 *
 * @param {Object<string, *|function>} responses API名 → 返す値、または関数
 * @param {{location?: object}} [options] location は google.script.url.getLocation が
 *   返す形 ({parameter, parameters, hash})。既定はパラメータ無し
 * @returns {{calls: object[], respond: function, flush: function}}
 */
export function mountApp(responses, options) {
  trackGlobals();
  dropLeftovers();

  document.documentElement.innerHTML = compiled().html;

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
        // 返事を遅らせる。{ later: (ok, ng) => ... } を返すと、ハンドラを
        // 受け取って好きな時に返せる。返事が届く順を入れ替えるのに使う
        if (value && typeof value.later === 'function') {
          // 遅らせた返事も同じく写しを渡す (下の即時の返事と同じ理由)
          const ok = onSuccess ? (v) => onSuccess(v === undefined ? null : structuredClone(v)) : () => {};
          value.later(ok, onFailure || (() => {}));
          return;
        }
        // 実物は返事を運ぶときに写しを作る。同じ物を渡すと、画面が返事に書き込んだ
        // 分 (名前を決めたときの peopleNames など) が DEFAULTS に残り、後のテストに漏れる
        if (onSuccess) onSuccess(value === undefined ? null : structuredClone(value));
      };
    });
    return runner;
  }

  // 開いた URL の ?doc=…&full=1 を読む口。実物と同じく返事はハンドラで受ける
  const location = (options && options.location) || { parameter: {}, parameters: {}, hash: '' };
  const url = { getLocation(fn) { fn(location); } };

  window.google = { script: { run: makeRunner(null, null), url } };

  // 毎回呼び直すので、app.js の中の状態は組むたびに新しく作られる
  compiled().run(window, document, window.google);

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
  'apiBranchDelete', 'apiBranchAddFile', 'apiBranchAddable', 'apiPrList', 'apiPrClose', 'apiPrCreate', 'apiPrPreview', 'apiPrReview',
  'apiPrMerge', 'apiPrReviews', 'apiPrCommits', 'apiPrPatches', 'apiPrPatchAdd', 'apiOutboxList', 'apiOutboxVerbs', 'apiOutboxAdd', 'apiIssueList', 'apiIssueCreate',
  'apiIssueUpdate', 'apiIssueClose', 'apiIssueCreateBranch', 'apiIssuesForFile',
  'apiProjectBoard', 'apiProjectMove', 'apiGetMarkdown', 'apiSaveMarkdown',
  'apiSettings', 'apiPrefs', 'apiPrefSet', 'apiSetScrumEnabled', 'apiSetScrumText', 'apiSprintList', 'apiSprintCreate',
  'apiSprintUpdate', 'apiScrumView', 'apiImpedimentList', 'apiImpedimentCreate',
  'apiImpedimentUpdate', 'apiImpedimentResolve', 'apiImpedimentReopen',
  'apiImpedimentComments', 'apiImpedimentComment', 'apiHistory',
  'apiProgress', 'apiSetTeamGoal', 'apiMyMilestones', 'apiCloseFeedback', 'apiMyToday', 'apiHomeActivity', 'apiHomeSummary', 'apiReportParts', 'apiSetReportKind', 'apiSetReportCustom', 'apiSearchIndex',
  'apiGameState', 'apiGameTop', 'apiGameJoin', 'apiSetGameEnabled', 'apiGameLevelSeen',
  'apiStashMainDrift', 'apiWhoAmI', 'apiOverview', 'apiDirtyFiles', 'apiCommitMany',
  'apiKnownPeople', 'apiIssueArchive', 'apiIssueRestore', 'apiIssuePurge',
  'apiIssueArchivedList', 'apiArchiveKeepDays', 'apiIssuePriorities', 'apiIssueReopen', 'apiReviewEdit', 'apiReviewDelete', 'apiPrSetReviewers', 'apiInquiryCreate', 'apiInquiryList', 'apiInquiryKinds', 'apiInquiryThread', 'apiInquiryReply',
  'apiInquiryReplyEdit', 'apiInquiryReplyDelete', 'apiInquiryClose', 'apiInquiryReopen', 'apiNotifications', 'apiNotificationsRead',
  'apiTagList', 'apiTagCreate', 'apiTagDelete', 'apiTagColors',
  'apiTasksState', 'apiTasksChooseList', 'apiTasksSync',
  'apiTallyEffort', 'apiTallyScope', 'apiMemberList', 'apiMemberSet',
  'apiPeopleNames', 'apiPeopleSetName',
  'apiIssueComments', 'apiIssueComment', 'apiIssueCommentEdit', 'apiIssueCommentDelete',
  'apiTemplateList', 'apiTemplateSave', 'apiTemplateDelete',
  'apiUsageRecord', 'apiUsageSummary', 'apiUsageRows', 'apiAgentKit', 'apiKitStatus', 'apiWorkspace',
  'apiFoundFiles', 'apiRegisterFiles', 'apiMainFolderUrl', 'apiUnregisterFile',
  'apiAppUrl',
];

/**
 * apiPrefs の既定の返り。サーバの PREFS_SCHEMA から一部を写した形 (画面は届いた一覧から欄を組む)。
 * 値は全部既定のまま。
 */
export function prefsFixture(over) {
  const items = [
    { key: 'start.tab', scope: 'me', type: 'enum', section: '開いたとき', label: '最初に出す画面', help: '',
      options: [{ value: 'home', label: 'ホーム' }, { value: 'issues', label: 'やること' }, { value: 'pulls', label: '確認依頼' }],
      def: 'home' },
    { key: 'terms.style', scope: 'me', type: 'enum', section: '表示', label: '言葉の表し方', help: '',
      options: [{ value: 'plain', label: '一般の言葉' }, { value: 'scrum', label: 'スクラムの言葉 (エンジニア向け)' }],
      def: 'plain' },
    { key: 'home.cards.turn', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: 'あなたの番', help: '', def: true },
    { key: 'home.cards.advice', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '改善のヒント', help: '', def: true },
    { key: 'home.cards.activity', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '草 (アクティビティ)', help: '', def: true },
    { key: 'home.cards.game', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: 'ポイントとレベル', help: '', def: true },
    { key: 'home.cards.recent', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '最近の動き', help: '', def: true },
    { key: 'home.cards.team', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: 'チームの前進', help: '', def: true },
    { key: 'notify.review', scope: 'me', type: 'bool', section: '通知メール', label: '確認を頼まれた・確認依頼が出た', help: '', def: true },
    { key: 'usage.self', scope: 'me', type: 'bool', section: '使われ方', label: '自分の使われ方を記録する', help: '', def: true },
    { key: 'usage.enabled', scope: 'team', type: 'bool', section: '使われ方', label: '使われ方を記録する', help: '', def: true },
    { key: 'advice.wip.on', scope: 'team', type: 'bool', section: '改善のヒント', label: '抱えすぎています', help: '', def: true },
    { key: 'home.dueDays', scope: 'team', type: 'int', section: 'ホーム', label: '「期限が近い」とみなす日数', help: '',
      min: 1, max: 14, def: 3 },
    { key: 'stale.steps', scope: 'team', type: 'steps', section: 'やること', label: '「動きなし」の段階 (日)', help: '',
      min: 1, max: 180, def: [7, 14, 30] },
    { key: 'report.defaultKind', scope: 'team', type: 'enum', section: '日報', label: '日報の形の既定', help: '',
      options: [{ value: 'three', label: '3節' }, { value: 'today', label: '今日だけ' }], def: 'three' },
  ].map((p) => Object.assign({ min: '', max: '', options: [] }, p, { value: p.def, custom: false }));
  const values = (over && over.values) || {};
  items.forEach((p) => {
    if (Object.prototype.hasOwnProperty.call(values, p.key)) {
      p.value = values[p.key];
      p.custom = true;
    }
  });
  const v = (k) => items.filter((p) => p.key === k)[0].value;
  return {
    canEditTeam: over && 'canEditTeam' in over ? over.canEditTeam : true,
    items,
    teamGoal: (over && over.teamGoal) || 0,
    effective: {
      startTab: v('start.tab'),
      termStyle: v('terms.style'),
      homeCards: ['turn', 'advice', 'activity', 'game', 'recent', 'team']
        .reduce((o, k) => Object.assign(o, { [k]: v('home.cards.' + k) }), {}),
      usageOn: v('usage.enabled') !== false && v('usage.self') !== false,
      notifyOff: v('notify.review') === false ? ['review'] : [],
    },
  };
}

/** よく使う既定の応答 */
export const DEFAULTS = {
  apiListFiles: [
    { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
    { fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' },
    { fileId: 'W2', path: 'branches/土台/就業規則.doc', type: 'doc' },
  ],
  apiOverview: { repo: 'SoftBanto', docs: 1, branches: 1, openIssues: 2, openPrs: 1, commits: 5 },
  apiWhoAmI: { activeUser: 'me@example.com', effectiveUser: 'me@example.com', sameUser: true },
  apiArchiveKeepDays: 30,
  apiIssueArchivedList: [],
  apiInquiryList: [],
  // 送ったあとの帯は返事の number を読む。null だと TypeError が出ていた
  apiInquiryCreate: { number: 1, kind: 'bug', body: '' },
  apiNotifications: { items: [], unread: 0 },
  apiTasksState: { available: false, listId: '', lists: [] },
  apiTallyScope: { me: 'me@example.com', canSee: ['me@example.com'], isManager: false, canEdit: false },
  apiTallyEffort: { periods: [], people: [], total: { planned: 0, actual: 0, diff: 0, count: 0 }, skipped: 0, hidden: 0 },
  apiIssueComments: [],
  apiFoundFiles: [
    { fileId: 'NEW1', name: '賃金規程', type: 'doc', ok: true, why: '' },
    { fileId: 'NEW2', name: 'めも.txt', type: '', ok: false, why: 'この形のファイルは扱えません' },
  ],
  apiRegisterFiles: { added: [{ fileId: 'NEW1', path: '賃金規程' }], failed: [] },
  apiMainFolderUrl: 'https://drive.google.com/drive/folders/MAIN1',
  apiAppUrl: 'https://script.google.com/macros/s/APP1/exec',
  apiWorkspace: {
    name: '総務共有', path: '総務共有/agentic-management',
    url: 'https://drive.google.com/drive/folders/PLACE',
  },
  apiKitStatus: { print: 'abcd1234', mine: 'abcd1234', outdated: false },
  apiAgentKit: {
    name: 'softbanto-agent-kit-1.2.0.zip',
    version: '1.2.0',
    url: 'https://drive.google.com/uc?export=download&id=KIT1',
    queuePath: 'マイドライブ/社内システム/agentic-management/.git/queue',
    queueUrl: 'https://drive.google.com/drive/folders/Q1',
  },
  apiUsageSummary: {
    from: '2026-08-12', to: '2026-09-10', total: 0,
    byTarget: [], byDay: [], byUser: [],
    byWeekday: [0, 0, 0, 0, 0, 0, 0], prev: { total: 0, byTarget: [] },
  },
  apiUsageRows: { from: '2026-08-12', to: '2026-09-10', who: '', rows: [] },
  apiTemplateList: [
    { name: '作業の段取り', body: '## やること\n\n- [ ] \n', builtin: true, mine: false },
    { name: '週報', body: '## 今週\n', builtin: false, mine: true },
  ],
  apiTagList: [
    { name: '文書改訂', color: 'accent', builtin: true },
    { name: '会議', color: 'success', builtin: true },
  ],
  apiIssueList: [
    {
      number: 2, title: '通勤手当の見直し', body: '', state: 'open',
      assignee: 'me@example.com', assignees: ['me@example.com'],
      labels: '規定改訂', linkedFileIds: 'DOC1',
      linkedPr: '', createdAt: '2026-09-01T00:00:00.000Z', closedAt: '',
      dueDate: '2026-09-30T00:00:00.000Z', startDate: '', parent: '',
      estimate: 3, plannedHours: 8, actualHours: 2,
    },
    {
      number: 1, title: '第2条の改訂', body: '', state: 'open',
      assignee: '', assignees: [], labels: '', linkedFileIds: 'DOC1', linkedPr: '',
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
      // 取り下げられるかはサーバが決める
      canClose: false,
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
  apiPrPreview: {
    clean: true, problems: [], conflicts: [], approvals: 0, ops: [],
    patchCount: 0,
    // 変更セットは文書ごとの中身も持つ
    files: [{
      fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
      clean: true, problems: [], conflicts: [], ops: [],
    }],
  },
  // 足したあとの帯は返事の path を読む。null だと TypeError が出ていた
  apiBranchAddFile: { path: 'branches/見直し/賃金規程.doc', fileId: 'DOC2' },
  apiOutboxList: [],
  apiOutboxVerbs: [['diff', '差分を出して添える'],
    ['merge', '承認されたので取り込む'], ['review', '中身を読んで意見をもらう']],
  apiPrCommits: [],
  apiIssuesForFile: [],
  apiKnownPeople: ['me@example.com', 'other@example.com'],
  // 決めたあとの帯は返事の name を読む。null だと TypeError が出ていた
  apiPeopleSetName: (email, name) => ({ email, name }),
  apiPeopleNames: { 'me@example.com': '山田 太郎', 'other@example.com': '鈴木 花子' },
  apiGetFileHtml: { html: '<p>第1条</p>\n', name: '就業規則', url: 'https://example.invalid/d/DOC1', path: '就業規則.doc' },
  apiFileStatus: { dirty: false, headSha: 'a', branch: 'main' },
  apiGetMarkdown: { markdown: '# 就業規則\n', branch: 'main', editable: false },
  apiSettings: { scrumEnabled: false, gameEnabled: false, canEdit: true, queue: null, productGoal: '', definitionOfDone: '', glossary: {} },
  apiPrefs: prefsFixture(),
  // 書いた値を返す (null で既定に戻す)
  apiPrefSet: (key, value) => prefsFixture({ values: value === null ? {} : { [key]: value } }),
  apiSprintList: [],
  apiImpedimentList: [],
  apiImpedimentComments: [],
  apiHistory: [],
  apiProgress: { weekClosed: 0, weekMerged: 0, monthClosed: 0, goal: 0, canEditGoal: false },
  apiMyMilestones: [],
  apiCloseFeedback: { kind: 'team', number: 1, title: 'x', weekClosed: 0, monthClosed: 0, goal: 0 },
  apiMyToday: [],
  apiHomeActivity: { weeks: Array.from({ length: 53 }, (_, w) => Array.from({ length: 7 }, (_, d) => ({
    day: '2026-' + String(1 + (w % 12)).padStart(2, '0') + '-' + String(1 + d).padStart(2, '0'),
    me: (w + d) % 3, team: (w + d) % 5, future: w === 52 && d > 2,
  }))), meTotal: 120 },
  apiHomeSummary: {
    myTurn: {
      reviews: { items: [{ number: 1, title: '就業規則 第3条の改定' }], total: 1 },
      returned: { items: [], total: 0 },
      due: { items: [{ number: 7, title: '附則の施行日を決める', due: '2026-10-13', overdue: true }], total: 1 },
    },
    recent: [
      { kind: 'merged', number: 1, fileId: '', title: '就業規則 第3条の改定', at: '2026-10-14T01:00:00.000Z' },
      { kind: 'closed', number: 3, fileId: '', title: '第7条に在宅勤務を足す', at: '2026-10-13T01:00:00.000Z' },
      { kind: 'file', number: 0, fileId: 'DOC1', title: '就業規則.doc', at: '2026-10-12T01:00:00.000Z' },
    ],
    // 既定は当たる規則なし (カードは出ない)
    advice: [],
  },
  apiReportParts: {
    parts: { today: [], tomorrow: [], troubles: [], date: '10/14 (水)', name: '中井' },
    templates: [
      { key: 'three', name: '3節', body: '✅今日やったこと\n{今日}\n\n📅明日やること\n{明日}\n\n⛔️困っていること\n{困りごと}' },
      { key: 'today', name: '今日だけ', body: '✅今日\n{今日}' },
      { key: 'plain', name: '見出し無し', body: '{今日}' },
    ],
    kind: 'three',
    custom: '',
  },
  apiSetReportKind: (kind) => ({ kind }),
  // 中身があれば、同じ1回で「自分の形」を選んだことにもなる
  apiSetReportCustom: (text) => ({ custom: text, kind: text ? 'custom' : 'three' }),
  apiSearchIndex: [
    { kind: 'doc', number: 0, key: 'DOC1', title: '就業規則.doc', state: '', archived: false },
    { kind: 'issue', number: 1, key: '', title: '就業規則の改定', state: 'open', archived: false },
    { kind: 'issue', number: 2, key: '', title: 'カタカナのタイトル', state: 'closed', archived: false },
    { kind: 'issue', number: 12, key: '', title: '賃金規程の見直し', state: 'open', archived: false },
    { kind: 'issue', number: 13, key: '', title: '就業規則 古い案', state: 'open', archived: true },
    { kind: 'pull', number: 1, key: '', title: '就業規則 第3条の改定', state: 'open', archived: false },
    { kind: 'branch', number: 0, key: '見直し', title: '見直し', state: 'open', archived: false },
    { kind: 'inquiry', number: 5, key: '', title: '棒が伸びない', state: 'open', archived: false },
  ],
  apiGameState: { enabled: false },
  apiGameTop: [],
  apiGameJoin: (on) => ({ enabled: true, total: 0, week: 0, level: 0, levelFrom: 0, nextAt: 5, playing: !!on }),
  apiGameLevelSeen: null,
  apiSetGameEnabled: (on) => ({ scrumEnabled: false, gameEnabled: !!on, canEdit: true, productGoal: '', definitionOfDone: '', glossary: {} }),
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
