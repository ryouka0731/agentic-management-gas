/*
 * テストで読むソースの集合。**ファイルの並びはここにだけ置く。**
 *
 * GAS は全ファイルを同じグローバルに読むので、API を呼ぶテストは呼ばれる側の
 * ファイルも揃えて読む必要がある。以前は各テストが30〜40件の並びを手で写して
 * いて、ファイルを足すたびに写しの全部を直すことになった (直し漏れると
 * `xxx is not defined` で落ちるか、例外を握る所では黙って空になる)。
 *
 * - ISSUE_SOURCES: 台帳・やること・やりとり・通知まで。文書の記録は含まない
 * - CORE_SOURCES:  画面の API を除く本体すべて (配る道具の中身を除く)
 * - API_SOURCES:   画面から呼ぶ入口 (Main.gs と src/api/*.gs、エディタ用の Debug.gs)
 * - APP_SOURCES:   CORE + API。画面の API をまるごと動かすときはこれ。コマンドキュー (CommandQueue)・
 *                  ホーム (Home)・横断検索 (Search)・ポイント (Game) を動かすテストもこれで読む。
 *                  キューは api* と homeTurnPlain_ / reportPartsPlain_ を、ホーム・検索・ポイントは
 *                  画面の入口と同じ並びを前提にしているので、CORE だけでは足りない
 * - KIT_SOURCES:   配る道具。中身が大きいので、要るテストだけが足す
 * - FULL_SOURCES:  APP + 残りの全部 (ToDo 連携・配る道具など)。実物は src を全部同じグローバルに
 *                  読むので、画面とサーバを通しで動かす test/e2e/ はこれで読む (画面の起動で
 *                  apiTasksState / apiKitStatus も呼ばれる)
 */

export const ISSUE_SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs', 'src/core/CurrentUser.gs', 'src/core/Repo.gs',
  'src/core/Plain.js', 'src/core/Archive.js', 'src/core/Staleness.js', 'src/core/FocusMusic.js', 'src/core/Prefs.gs',
  'src/core/Tag.gs', 'src/core/Template.gs', 'src/core/Member.gs', 'src/core/Issue.gs',
  'src/core/IssueTree.js',
  'src/core/IssueComment.gs', 'src/core/Project.gs', 'src/core/Mention.js',
  'src/core/Inquiry.gs', 'src/core/Brand.js', 'src/core/Notifier.gs',
];

export const CORE_SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs', 'src/core/CurrentUser.gs', 'src/core/Repo.gs',
  'src/core/ObjectStore.gs', 'src/core/Normalize.js', 'src/core/Markdown.js',
  'src/core/Graph.js', 'src/core/Diff.js', 'src/core/DiffSummary.js', 'src/core/Merge.js', 'src/core/Commit.gs',
  'src/core/Branch.gs', 'src/render/HtmlWriter.gs', 'src/render/DocRenderer.gs',
  'src/render/LiveCache.gs', 'src/render/SheetRenderer.gs', 'src/render/SheetWriter.gs',
  'src/core/PullRequest.gs', 'src/core/PullPatch.gs', 'src/core/Outbox.gs',
  'src/core/Archive.js', 'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Template.gs',
  'src/core/Member.gs', 'src/core/Usage.gs', 'src/core/Issue.gs', 'src/core/IssueComment.gs',
  'src/core/IssueBranch.gs', 'src/core/Project.gs', 'src/core/Mention.js',
  'src/core/Inquiry.gs', 'src/core/Brand.js', 'src/core/Notifier.gs', 'src/core/Tally.js',
  'src/core/Plain.js', 'src/core/Settings.gs', 'src/core/FocusMusic.js', 'src/core/Prefs.gs', 'src/core/Scrum.gs',
  'src/core/ScrumView.js', 'src/core/Grouping.js', 'src/core/IssueTree.js',
  'src/core/CommandQueue.gs', 'src/core/CacheWarm.gs', 'src/core/Motivation.gs', 'src/core/Game.gs', 'src/core/Reward.gs', 'src/core/Focus.gs',
  'src/core/Gantt.js', 'src/core/Home.gs', 'src/core/Search.gs',
  'src/core/WorkStyleTypes.js', 'src/core/WorkStyle.gs', 'src/core/Outcomes.gs',
  'src/core/Oshi.js', 'src/core/OshiStore.gs', 'src/core/OshiShare.gs', 'src/core/OshiMood.gs', 'src/core/Achievements.js', 'src/core/AchievementsStore.gs', 'src/core/GoalScore.js', 'src/core/Goal.gs',
  'src/core/CalendarPlan.js', 'src/core/CalendarSync.gs', 'src/core/MeetingNotes.js', 'src/core/MeetingNotesImport.gs',
  'src/core/CoworkLink.js', 'src/core/Cowork.gs', 'src/core/Announcement.gs',
  'src/core/Revision.gs', 'src/render/RevisionWriter.gs',
  'src/core/RecurrenceRule.js', 'src/core/Recurrence.gs', 'src/core/FileReview.gs',
];

export const API_SOURCES = [
  'src/Main.gs', 'src/Debug.gs',
  'src/api/Files.gs', 'src/api/Commit.gs', 'src/api/Pr.gs', 'src/api/Outbox.gs',
  'src/api/Issue.gs', 'src/api/Inquiry.gs', 'src/api/People.gs', 'src/api/Home.gs',
  'src/api/Settings.gs', 'src/api/Scrum.gs', 'src/api/Focus.gs', 'src/api/WorkStyle.gs', 'src/api/Oshi.gs',
  'src/api/Calendar.gs', 'src/api/Achievements.gs', 'src/api/Boot.gs',
  'src/api/Outcomes.gs', 'src/api/Goals.gs', 'src/api/Reward.gs', 'src/api/Cowork.gs',
  'src/api/Announcement.gs', 'src/api/Revision.gs',
  'src/api/Announcement.gs', 'src/api/Recurrence.gs',
];

export const APP_SOURCES = CORE_SOURCES.concat(API_SOURCES);

export const KIT_SOURCES = ['src/core/AgentKit.gs'];

export const FULL_SOURCES = APP_SOURCES.concat([
  'src/core/GoogleTasks.gs', 'src/core/FileUrl.js', 'src/core/MarkdownView.js', 'src/core/Terms.js',
  'src/core/ErrorKind.js',
], KIT_SOURCES);
