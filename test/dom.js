import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { APP, PAGE_WITHOUT_APP, ROOT, appSourceMap } from './ui-source.js';

/*
 * 組む元 (wiki.html / app.css.html / 画面の JS) は 1 ファイルの中で 1 回だけ読む。
 *
 * 画面を組むテストは数百あり、そのたびに 1万6千行を読み直して組み直していた。
 * 覚えるのは**字と、まだ走らせていない関数だけ**。関数は呼ぶたびに中身を
 * 頭から走らせるので、画面の JS の変数や聞き手は組むたびに新しく作られ、前の
 * 画面の状態は引き継がれない (状態は window / document 側にあり、それは
 * mountApp が毎回組み直し、dropLeftovers が外す)。
 * vitest はテストのファイルごとにモジュールを読み直すので、覚え書きもファイルを
 * またがない。
 */
let source = null;

/** 画面の JS が投げて、誰も受け止めなかった例外 */
const uncaught = [];

/** 拾った例外を返して空にする */
export function takeUncaught() {
  return uncaught.splice(0, uncaught.length);
}

function compiled() {
  if (source) return source;
  // 本文は画面の JS を除いた wiki.html、JS は wiki.html の include の順につないだもの
  // (つなぎ方は ui-source.js だけが知っている)
  const html = PAGE_WITHOUT_APP
    .replace(/^[\s\S]*?<html[^>]*>/, '')
    .replace(/<\/html>[\s\S]*$/, '');
  const js = APP;

  // 名前の付いたファイルとして読み、行を元の部分ファイルへ戻す地図を添える。
  // new Function で読むと名前が無く、画面の JS がカバレッジに1行も数えられなかった
  // カバレッジはファイル名の中身をディスクから読み直すので、つないだものを実際に書いて置く
  const map = Buffer.from(JSON.stringify(appSourceMap())).toString('base64');
  const code = js + '\n//# sourceMappingURL=data:application/json;base64,' + map + '\n';
  const file = path.join(ROOT, 'coverage-ui', 'app.joined.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // テストのファイルは並んで走るので、途中まで書いたものを読まれないよう別名で書いてから置き換える
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== code) {
    const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2);
    fs.writeFileSync(tmp, code);
    fs.renameSync(tmp, file);
  }
  const run = vm.compileFunction(code, ['window', 'document', 'google'], { filename: file });
  source = { html, run };
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
 * 画面の JS を本当に走らせる。
 *
 * @param {Object<string, *|function>} responses API名 → 返す値、または関数
 * @param {{location?: object, transport?: function, names?: string[]}} [options] location は
 *   google.script.url.getLocation が返す形 ({parameter, parameters, hash})。既定はパラメータ無し。
 *   transport(name, args, onSuccess, onFailure) を渡すと、表の代わりにそれが返事を運ぶ
 *   (test/e2e/fullstack.js が本物のサーバへつなぐのに使う)。names は呼べる api の名前を足す
 * @returns {{calls: object[], respond: function, flush: function}}
 */
export function mountApp(responses, options) {
  trackGlobals();
  dropLeftovers();

  // 文書のリンク (?doc=…&full=1) で開かれたときに doGet が body に付けるもの (options.link = { doc })
  const link = (options && options.link) || null;
  document.documentElement.innerHTML = compiled().html
    .replace('<?= bodyClass ?>', link && link.doc ? 'doc-link doc-full' : '')
    .replace('<?= linkDoc ?>', link && link.doc ? String(link.doc) : '');

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

    const names = new Set([...Object.keys(table), ...API_NAMES, ...((options && options.names) || [])]);
    names.forEach((name) => {
      runner[name] = function (...args) {
        calls.push({ name, args });

        /*
         * 開いた直後の軽い api をまとめて取る口 (app.js の bootBatchSend → Boot.gs の apiBoot)。
         * 表の返事を1つずつ引いて、実物と同じ形 ({ok, value} / {ok, error}) で返す。中の1本ずつも calls に
         * 残す (batched: true) ので、名前で数えるテストはそのまま通る。遅らせた返事 (later) が混ざれば、
         * 全部そろってから返す
         */
        /*
         * 返事の扱いが投げたものは、実物と同じく呼んだ側には戻さず (実物は返事が非同期に届く)、受け止められなかった
         * 例外として控える (mount.js が afterEach で落とす)。画面の中の状態は投げる手前まで進んでいる
         */
        const deliver = (fn, v) => {
          if (!fn) return;
          try { fn(v); } catch (e) { uncaught.push(e); }
        };
        // 口そのものの返事を差し替えたとき (Error / 配列 / それを返す関数) は、下の表の扱いに任せる。関数は1回だけ呼ぶ
        const bootOverride = name === 'apiBoot' && typeof table.apiBoot === 'function' ? table.apiBoot(...args) : table.apiBoot;
        if (name === 'apiBoot' && !(options && options.transport) && !(bootOverride instanceof Error)
          && !Array.isArray(bootOverride)) {
          const list = args[0] || [];
          const results = new Array(list.length);
          let left = list.length;
          const settle = () => {
            left -= 1;
            if (left === 0) deliver(onSuccess, structuredClone(results));
          };
          list.forEach((n, i) => {
            calls.push({ name: n, args: [], batched: true });
            let v = table[n];
            if (typeof v === 'function') v = v();
            if (v instanceof Error) { results[i] = { ok: false, error: v.message }; settle(); return; }
            if (v && typeof v.later === 'function') {
              v.later((val) => { results[i] = { ok: true, value: val === undefined ? null : val }; settle(); },
                (err) => { results[i] = { ok: false, error: err && err.message }; settle(); });
              return;
            }
            results[i] = { ok: true, value: v === undefined ? null : v };
            settle();
          });
          if (!list.length) deliver(onSuccess, []);
          return;
        }
        if (name === 'apiBoot') {
          // 本物のサーバへつなぐとき・口そのものの返事を差し替えたときも、中の1本ずつを calls に残す
          (args[0] || []).forEach((n) => calls.push({ name: n, args: [], batched: true }));
        }

        if (options && options.transport) {
          options.transport(name, args, onSuccess, onFailure);
          return;
        }

        let value = name === 'apiBoot' ? bootOverride : table[name];
        if (typeof value === 'function') value = value(...args);

        if (value instanceof Error) {
          deliver(onFailure, value);
          return;
        }
        // 返事を遅らせる。{ later: (ok, ng) => ... } を返すと、ハンドラを
        // 受け取って好きな時に返せる。返事が届く順を入れ替えるのに使う
        if (value && typeof value.later === 'function') {
          // 遅らせた返事も同じく写しを渡す (下の即時の返事と同じ理由)
          const ok = (v) => deliver(onSuccess, v === undefined ? null : structuredClone(v));
          value.later(ok, (e) => deliver(onFailure, e));
          return;
        }
        // 実物は返事を運ぶときに写しを作る。同じ物を渡すと、画面が返事に書き込んだ
        // 分 (名前を決めたときの peopleNames など) が DEFAULTS に残り、後のテストに漏れる
        deliver(onSuccess, value === undefined ? null : structuredClone(value));
      };
    });
    return runner;
  }

  // 開いた URL の ?doc=…&full=1 を読む口。実物と同じく返事はハンドラで受ける
  const location = (options && options.location) || { parameter: {}, parameters: {}, hash: '' };
  const url = { getLocation(fn) { fn(location); } };

  window.google = { script: { run: makeRunner(null, null), url } };

  // 画面の聞き手や返事のハンドラが投げた例外は、jsdom が console に出すだけでテストは通って
  // しまう (集計の表が描けずに落ちていたのに、気づかれなかった)。拾っておき、mount.js が落とす
  window.addEventListener('error', (e) => { uncaught.push(e.error || new Error(e.message)); });

  // 毎回呼び直すので、画面の JS の中の状態は組むたびに新しく作られる
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
  'apiBoot', 'apiListFiles', 'apiGetFileHtml', 'apiFileStatus', 'apiCommit', 'apiCommitGraph',
  'apiCommitDiff', 'apiCommitHistory', 'apiBranchList', 'apiBranchCreate',
  'apiBranchDelete', 'apiBranchAddFile', 'apiBranchAddable', 'apiPrList', 'apiPrClose', 'apiPrCreate', 'apiPrPreview', 'apiPrReview',
  'apiPrMerge', 'apiRevisionHistory', 'apiRevisionExport', 'apiPrReviews', 'apiPrCommits', 'apiPrPatches', 'apiPrPatchAdd', 'apiOutboxList', 'apiOutboxVerbs', 'apiOutboxAdd', 'apiIssueList', 'apiIssueCreate',
  'apiIssueUpdate', 'apiIssueClose', 'apiIssueCreateBranch', 'apiIssuesForFile',
  'apiProjectBoard', 'apiProjectMove', 'apiGetMarkdown', 'apiSaveMarkdown',
  'apiSettings', 'apiPrefs', 'apiPrefSet', 'apiSetScrumEnabled', 'apiSetScrumText', 'apiSprintList', 'apiSprintCreate',
  'apiSprintUpdate', 'apiScrumView', 'apiImpedimentList', 'apiImpedimentCreate',
  'apiImpedimentUpdate', 'apiImpedimentResolve', 'apiImpedimentReopen',
  'apiImpedimentComments', 'apiImpedimentComment', 'apiHistory',
  'apiProgress', 'apiSetTeamGoal', 'apiMyMilestones', 'apiCloseFeedback', 'apiMyToday', 'apiHomeActivity', 'apiHomeSummary', 'apiReportParts', 'apiReportCopied', 'apiSetReportKind', 'apiSetReportCustom', 'apiSearchIndex',
  'apiGameState', 'apiGameTop', 'apiGameJoin', 'apiSetGameEnabled', 'apiGameLevelSeen',
  'apiFocusOpen', 'apiFocusStart', 'apiFocusProve', 'apiFocusExtend', 'apiFocusEnd', 'apiFocusMine',
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
  'apiAppUrl', 'apiWorkStyle', 'apiWorkStyleSave', 'apiWorkStyleForget', 'apiWorkStyleTeam',
  'apiOshiGet', 'apiOshiImage', 'apiOshiSetImage', 'apiOshiClearImage', 'apiOshiSetProfile', 'apiOshiSetLines',
  'apiOshiForget', 'apiOshiDefaultImage', 'apiOshiCharCreate', 'apiOshiCharDelete',
  'apiOshiSetCharProfile', 'apiOshiBuiltinProfiles', 'apiOshiBuiltinProfileSet', 'apiOshiCharKitPrompt', 'apiOshiCharImport', 'apiOshiMood',
  'apiOshiSetShared',
  'apiCalendarPlan', 'apiCalendarToday', 'apiCalendarStatus', 'apiCalendarCreateShared', 'apiCalendarSetShared', 'apiMeetingHours',
  'apiMeetingNotesImport',
  'apiOutcomes', 'apiCacheClear',
  'apiAnnouncementNext', 'apiAnnouncementReply', 'apiAnnouncementList', 'apiAnnouncementCreate', 'apiAnnouncementArchive',
  'apiGoalState', 'apiGoalMine', 'apiGoalSave', 'apiGoalDelete', 'apiGoalSubmit', 'apiGoalDecide', 'apiGoalLink',
  'apiGoalUnlink', 'apiGoalProgressInput', 'apiGoalReview', 'apiGoalGrade', 'apiGoalTeam', 'apiGoalReport',
  'apiGoalIssueLinks', 'apiGoalWithdraw',
  'apiAchievements', 'apiAchievementsCheck',
  'apiRecurrenceList', 'apiRecurrenceCreate', 'apiRecurrenceUpdate', 'apiRecurrenceDelete', 'apiFileReviewSet',
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
    { key: 'nav.logo', scope: 'me', type: 'enum', section: '表示', label: 'ロゴを押したときに開く画面', help: '',
      options: [{ value: 'home', label: 'ホーム' }, { value: 'issues', label: 'やること' }, { value: 'pulls', label: '確認依頼' }],
      def: 'home' },
    { key: 'home.cards.turn', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: 'あなたの番', help: '', def: true },
    { key: 'home.cards.advice', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '改善のヒント', help: '', def: true },
    { key: 'home.cards.activity', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '草 (アクティビティ)', help: '', def: true },
    { key: 'home.cards.game', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: 'ポイントとレベル', help: '', def: true },
    { key: 'home.cards.recent', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '最近の動き', help: '', def: true },
    { key: 'home.cards.team', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: 'チームの前進', help: '', def: true },
    { key: 'home.cards.ach', scope: 'me', type: 'bool', section: 'ホームに出すもの', label: '最近の実績', help: '', def: true },
    { key: 'fun.combo', scope: 'me', type: 'bool', section: '楽しい演出', label: '打つと盛り上がる', help: '', def: false },
    { key: 'fun.words', scope: 'me', type: 'bool', section: '楽しい演出', label: '言葉に反応する', help: '', def: false },
    { key: 'fun.cheer', scope: 'me', type: 'bool', section: '楽しい演出', label: '済ませたらお祝い', help: '', def: false },
    { key: 'luck.on', scope: 'me', type: 'bool', section: '思いがけない当たり', label: '思いがけない当たり', help: '', def: false },
    { key: 'luck.reward', scope: 'me', type: 'bool', section: '思いがけない当たり', label: 'ご褒美と交換する', help: '', def: false },
    { key: 'focus.start', scope: 'me', type: 'bool', section: '集中のしかた', label: '今から始める', help: '', def: false },
    { key: 'focus.remind', scope: 'me', type: 'enum', section: '集中のしかた', label: '時間の知らせ', help: '',
      options: [{ value: 'end', label: '終わったときだけ' }, { value: '30', label: '30分ごと' }, { value: '60', label: '60分ごと' }],
      def: 'end' },
    { key: 'focus.sound', scope: 'me', type: 'bool', section: '集中のしかた', label: '集中の音', help: '', def: false },
    { key: 'focus.music', scope: 'me', type: 'enum', section: '集中のしかた', label: '自分の曲', help: '',
      options: [{ value: 'off', label: '使わない' }, { value: 'own', label: '自分の再生リストを流す' }], def: 'off' },
    { key: 'focus.musicUrl', scope: 'me', type: 'music', section: '集中のしかた', label: '自分の曲のリンク', help: '', def: '' },
    { key: 'room.on', scope: 'me', type: 'bool', section: '作業部屋', label: '作業部屋を使う', help: '', def: false },
    { key: 'sound.effects', scope: 'me', type: 'bool', section: '音', label: '操作の効果音', help: '', def: false },
    { key: 'calendar.plan', scope: 'me', type: 'bool', section: '予定に入れる', label: 'やることを予定に入れる', help: '', def: false },
    { key: 'calendar.block', scope: 'me', type: 'enum', section: '予定に入れる', label: '1つの予定の長さ', help: '',
      options: [{ value: '25', label: '25分' }, { value: '45', label: '45分' }], def: '45' },
    { key: 'calendar.title', scope: 'me', type: 'enum', section: '予定に入れる', label: '予定の名前', help: '',
      options: [{ value: 'task', label: 'やることの名前 (#12 規程の改定)' }, { value: 'generic', label: '集中 (番頭) とだけ出す' }],
      def: 'task' },
    { key: 'calendar.meetingNotes', scope: 'me', type: 'bool', section: '予定に入れる', label: 'Gemini のメモを 1 日 1 回自動で取り込む', help: '', def: true },
    { key: 'calendar.meetings', scope: 'me', type: 'bool', section: '会議の時間', label: '会議の時間を出す', help: '', def: false },
    { key: 'style.share', scope: 'me', type: 'bool', section: '仕事のスタンス診断', label: '診断の型の名前をチームに見せる', help: '', def: false },
    { key: 'oshi.on', scope: 'me', type: 'bool', section: '推し', label: '推しに応援してもらう', help: '', def: true },
    { key: 'oshi.home', scope: 'me', type: 'bool', section: '推し', label: 'ホームであいさつする', help: '', def: true },
    { key: 'oshi.char', scope: 'me', type: 'char', section: '推し', label: '使うキャラ', help: '',
      options: [{ value: 'builtin:taku', label: 'タク' }, { value: 'builtin:itsuki', label: 'イツキ' }], def: 'builtin:taku' },
    { key: 'oshi.fallback', scope: 'me', type: 'enum', section: '推し', label: '自分のキャラの絵が無い表情', help: '',
      options: [{ value: 'builtin:taku', label: 'タクの絵を出す' }, { value: 'builtin:itsuki', label: 'イツキの絵を出す' },
        { value: 'none', label: '出さない' }], def: 'builtin:taku' },
    { key: 'oshi.style', scope: 'me', type: 'enum', section: '推し', label: '最初からいるキャラの絵', help: '',
      options: [{ value: 'chibi', label: '2頭身' }, { value: 'normal', label: '等身' }], def: 'chibi' },
    { key: 'oshi.mood', scope: 'me', type: 'bool', section: '推し', label: '推しの機嫌を見る', help: '', def: false },
    { key: 'oshi.peek', scope: 'me', type: 'bool', section: '推し', label: 'ときどき画面の端に顔を出す', help: '', def: true },
    { key: 'ach.on', scope: 'me', type: 'bool', section: '実績', label: '実績を集める', help: '', def: true },
    { key: 'ach.cheer', scope: 'me', type: 'bool', section: '実績', label: '実績を取ったら知らせる', help: '', def: true },
    { key: 'notify.review', scope: 'me', type: 'bool', section: '通知メール', label: '確認を頼まれた・確認依頼が出た', help: '', def: true },
    { key: 'usage.self', scope: 'me', type: 'bool', section: '使われ方', label: '自分の使われ方を記録する', help: '', def: true },
    { key: 'usage.enabled', scope: 'team', type: 'bool', section: '使われ方', label: '使われ方を記録する', help: '', def: true },
    { key: 'advice.wip.on', scope: 'team', type: 'bool', section: '改善のヒント', label: '抱えすぎています', help: '', def: true },
    { key: 'home.dueDays', scope: 'team', type: 'int', section: 'ホーム', label: '「期限が近い」とみなす日数', help: '',
      min: 1, max: 14, def: 3 },
    { key: 'stale.steps', scope: 'team', type: 'steps', section: 'やること', label: '「動きなし」の段階 (日)', help: '',
      min: 1, max: 180, def: [7, 14, 30] },
    { key: 'calendar.shared', scope: 'team', type: 'calendar', section: '予定に入れる', label: '予定を入れる共有カレンダー',
      help: '', def: '' },
    { key: 'report.defaultKind', scope: 'team', type: 'enum', section: '日報', label: '日報の形の既定', help: '',
      options: [{ value: 'three', label: '3節' }, { value: 'today', label: '今日だけ' }], def: 'three' },
    { key: 'goals.enabled', scope: 'team', type: 'bool', section: '目標', label: '目標 (OKR・MBO・KPI) を使う', help: '', def: false },
    { key: 'cowork.enabled', scope: 'team', type: 'bool', section: '作業雑談部屋', label: '作業雑談部屋を使う', help: '', def: false },
    { key: 'cowork.showFocus', scope: 'me', type: 'bool', section: '作業雑談部屋', label: '部屋にいるとき「集中中」を添える',
      help: '', def: false },
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
      logoTab: v('nav.logo'),
      homeCards: ['turn', 'advice', 'activity', 'game', 'recent', 'team', 'ach']
        .reduce((o, k) => Object.assign(o, { [k]: v('home.cards.' + k) }), {}),
      fun: ['combo', 'words', 'cheer'].reduce((o, k) => Object.assign(o, { [k]: v('fun.' + k) === true }), {}),
      luck: { on: v('luck.on') === true, reward: v('luck.reward') === true },
      // 自分の曲の部品はサーバが読み解いたもの。疑似では over.musicParts でそのまま渡す
      focus: { start: v('focus.start') === true, sound: v('focus.sound') === true, remind: v('focus.remind'),
        music: v('focus.music'), musicParts: (over && over.musicParts) || null },
      oshi: { on: v('oshi.on') === true, home: v('oshi.home') !== false,
        char: v('oshi.char'), fallback: v('oshi.fallback'), style: v('oshi.style'), mood: v('oshi.mood') === true,
        peek: v('oshi.peek') !== false },
      room: { on: v('room.on') === true },
      sound: { effects: v('sound.effects') === true },
      ach: { on: v('ach.on') !== false, cheer: v('ach.cheer') !== false },
      calendar: { plan: v('calendar.plan') === true, meetings: v('calendar.meetings') === true,
        meetingNotes: v('calendar.meetingNotes') !== false },
      usageOn: v('usage.enabled') !== false && v('usage.self') !== false,
      notifyOff: v('notify.review') === false ? ['review'] : [],
      goals: { enabled: v('goals.enabled') === true },
      cowork: { enabled: v('cowork.enabled') === true, showFocus: v('cowork.showFocus') === true },
    },
  };
}

/**
 * 実績の返事 (apiAchievements / apiAchievementsCheck) の既定。何も取っていない人。
 * 中身を確かめるテストは test/component/achievements.test.js が本物のサーバの返事で上書きする。
 */
export const ACH_EMPTY = {
  on: true, level: 1, stage: { index: 0, key: 'grow1', label: 'よそよそしい', meter: 0, toNext: 4, floored: false }, crossed: false, days: 0,
  total: 0, got: 0, cleared: false, clearedNow: false, groups: [], items: [], unlocked: [], newly: [], next: [],
};

/** よく使う既定の応答 */
export const DEFAULTS = {
  apiAchievements: ACH_EMPTY,
  apiAchievementsCheck: ACH_EMPTY,
  // 作業雑談部屋 (既定はオフなので、ふだんは呼ばれない。設定の画面の管理者の欄は部屋の一覧を取る)
  apiCoworkRooms: { rooms: [], myRoomId: '', beatSeconds: 60, expireSeconds: 120, available: true },
  apiCoworkRoomSettings: { rooms: [], max: 10, nameMax: 30 },
  // 推しは既定でオン (既定のキャラはタク)。中身を確かめるテストは test/component/oshi.test.js が本物のサーバの返事で上書きする。
  // 空で返すと、設定が届くたびに取り直してしまう (本物は必ず返す)
  apiOshiGet: {
    char: 'builtin:taku', kind: 'builtin', builtinKey: 'taku', charId: 0, owner: '', fallback: '', name: 'タク', tone: 'buddy',
    events: [], images: [], builtins: [{ key: 'taku', name: 'タク', tone: 'buddy' }, { key: 'itsuki', name: 'イツキ', tone: 'gothic' }],
    // みんなのキャラ (ほかの人が公開したキャラ) は既定で無い
    mine: [], shared: [], mineMax: 5, styles: [], tones: [], states: [], basePrompt: '', luckyOneIn: 0,
    kitTools: [{ key: 'chatgpt', label: 'ChatGPT' }, { key: 'gemini', label: 'Gemini' }, { key: 'claude', label: 'Claude' },
      { key: 'codex', label: 'Codex' }],
    sheet: { rows: 4, cols: 4 },
    growth: { index: 0, key: 'grow1', label: 'よそよそしい', meter: 0, toNext: 4, level: 1, unlocked: 0, stages: [] },
    limits: { maxBytes: 1048576, maxPx: 512, mimes: [], nameMax: 20, lineMax: 60, linesPerEvent: 5 },
    reveal: { items: [], open: 0, total: 0,
      limits: { itemsMax: 40, labelMax: 20, textMax: 200, lvMin: 2, lvMax: 99, clearLineMax: 200 } },
    achOn: true, cleared: false, clear: null,
    // 推しの機嫌は既定でオフ (オフのあいだは null)
    mood: null,
  },
  apiOshiMood: null,
  // 最初からいるキャラのプロフィール (設定の画面の管理者の欄)。中身はサーバのスクリプトの設定にだけある
  apiOshiBuiltinProfiles: { chars: [{ key: 'taku', name: 'タク', json: '', items: 0 }, { key: 'itsuki', name: 'イツキ', json: '', items: 0 }] },
  apiOshiBuiltinProfileSet: { key: 'taku', name: 'タク', json: '', items: 0 },
  apiOshiSetCharProfile: { charId: 1, items: 0, profileJson: '' },
  apiOshiSetShared: { charId: 1, shared: true },
  // キャラ作成キット。頼み文の中身はサーバの Oshi.js にだけある (中身を確かめるのは test/oshi-charkit.test.js)
  apiOshiCharKitPrompt: { tool: 'chatgpt', label: 'ChatGPT', prompt: '' },
  apiOshiCharImport: { charId: 1, created: true, name: '', tone: 'polite', lines: 0, items: 0 },
  apiListFiles: [
    { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
    { fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' },
    { fileId: 'W2', path: 'branches/土台/就業規則.doc', type: 'doc' },
  ],
  apiOverview: { repo: 'SoftBanto', docs: 1, branches: 1, openIssues: 2, openPrs: 1, commits: 5 },
  apiWhoAmI: { activeUser: 'me@example.com', effectiveUser: 'me@example.com', sameUser: true },
  apiArchiveKeepDays: 30,
  apiIssueArchivedList: [],
  // 繰り返しのやること (js-recur)。既定は何も無い
  apiRecurrenceList: [],
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
    // 変わった箇所の箇条書き (src/core/DiffSummary.js)。既定は無し
    summary: [],
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
  // 文書の改訂履歴の表 (やること #111)
  apiRevisionHistory: {
    fileId: 'DOC1', path: '就業規則.doc', type: 'doc', canExport: true, exportBlocked: '', items: [],
  },
  apiIssuesForFile: [],
  apiKnownPeople: ['me@example.com', 'other@example.com'],
  // 決めたあとの帯は返事の name を読む。null だと TypeError が出ていた
  apiPeopleSetName: (email, name) => ({ email, name }),
  apiPeopleNames: { 'me@example.com': '山田 太郎', 'other@example.com': '鈴木 花子' },
  apiGetFileHtml: { html: '<p>第1条</p>\n', name: '就業規則', url: 'https://example.invalid/d/DOC1', path: '就業規則.doc' },
  apiFileStatus: { dirty: false, headSha: 'a', branch: 'main' },
  apiGetMarkdown: { markdown: '# 就業規則\n', branch: 'main', editable: false },
  // 成果の数 (管理者だけ)。まだ数えていない形。数のある形は test/component/outcomes.test.js が渡す
  apiOutcomes: { weeks: [], since: '', minPeople: 3 },
  apiCacheClear: { cleared: true },
  // お知らせ (js-announce)。既定は何も出さない
  apiAnnouncementNext: null,
  // Gemini のメモの取り込み (開いたときの自動)。既定は「その日はもう取り込んだ」
  apiMeetingNotesImport: { ok: true, reason: '', skipped: true, found: 0, notes: 0, created: 0, already: 0, unmatched: 0, items: [] },
  apiAnnouncementList: { items: [] },
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
    parts: { today: [], tomorrow: [], troubles: [], done: [], doneText: '', date: '10/14 (水)', name: '中井' },
    templates: [
      { key: 'three', name: '3節', body: '✅今日やったこと\n{今日}\n\n📅明日やること\n{明日}\n\n⛔️困っていること\n{困りごと}' },
      { key: 'today', name: '今日だけ', body: '✅今日\n{今日}' },
      { key: 'plain', name: '見出し無し', body: '{今日}' },
    ],
    kind: 'three',
    custom: '',
  },
  apiReportCopied: { at: 0 },
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
  // 仕事のスタンス診断。中身はテストがサーバの定義から作って差し替える (test/component/style.test.js)
  apiWorkStyle: { questions: [], scale: [], axes: [], mine: null, share: false },
  apiWorkStyleTeam: {},
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
