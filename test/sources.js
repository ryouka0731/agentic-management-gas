/*
 * 画面の API をまるごと動かすときに読むソースの集合。
 *
 * GAS は全ファイルを同じグローバルに読むので、API を呼ぶテストは呼ばれる側の
 * ファイルも揃えて読む必要がある。scrum-api / prefs / docs の3つが同じ集合を
 * 使うため、ここに1つだけ置く (以前は他のテストのソースを正規表現で切り出して
 * eval していた)。
 */
export const APP_SOURCES = [
  'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Db.gs', 'src/core/Repo.gs',
  'src/core/ObjectStore.gs', 'src/core/Normalize.js', 'src/core/Markdown.js',
  'src/core/Graph.js', 'src/core/Diff.js', 'src/core/Merge.js', 'src/core/Commit.gs',
  'src/core/Branch.gs', 'src/render/HtmlWriter.gs', 'src/core/PullRequest.gs',
  'src/core/PullPatch.gs', 'src/core/Outbox.gs', 'src/core/Archive.js',
  'src/core/Staleness.js', 'src/core/Tag.gs', 'src/core/Template.gs', 'src/core/Member.gs',
  'src/core/Usage.gs', 'src/core/Issue.gs', 'src/core/IssueComment.gs',
  'src/core/Project.gs', 'src/core/Mention.js', 'src/core/Inquiry.gs', 'src/core/Brand.js',
  'src/core/Notifier.gs', 'src/core/Tally.js', 'src/core/Plain.js',
  'src/core/Settings.gs', 'src/core/Prefs.gs', 'src/core/Scrum.gs', 'src/core/ScrumView.js',
  'src/core/CommandQueue.gs', 'src/core/Motivation.gs', 'src/core/Game.gs', 'src/core/Gantt.js',
  'src/core/Home.gs', 'src/core/Search.gs', 'src/Main.gs',
];
