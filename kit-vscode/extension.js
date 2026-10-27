'use strict';
/*
 * 番頭 (SoftBanto) の VS Code 拡張。vscode の API を触るのはこのファイルだけ (薄い層)。動きは lib/app.js、
 * vscode に依らない決まりは lib/logic.js、番頭への頼み方は lib/queue.js にある。
 *
 * 番頭とは、手元の道具 (kit) と同じく Drive の同期フォルダの命令の入れ先でやりとりする。鍵もトークンも
 * 公開の入口も使わない。
 */
const vscode = require('vscode');
const { createApp } = require('./lib/app');
const { findQueue, makeQueue } = require('./lib/queue');

const TICK_MS = 15 * 1000;

/** 番頭の「やること」の一覧 (サイドバー) */
class IssueTree {
  constructor() {
    this.items = [];
    this.hint = '';
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
  }

  set(items, hint) {
    this.items = items || [];
    this.hint = hint || '';
    this.changed.fire();
  }

  getTreeItem(el) {
    return el;
  }

  getChildren() {
    const rows = this.items.map((it) => {
      const row = new vscode.TreeItem('#' + it.number + ' ' + it.title, vscode.TreeItemCollapsibleState.None);
      row.description = it.due ? '期限 ' + it.due : '';
      row.tooltip = it.title;
      row.command = { command: 'banto.showIssue', title: '見る', arguments: [it] };
      return row;
    });
    if (this.hint) {
      const note = new vscode.TreeItem(this.hint, vscode.TreeItemCollapsibleState.None);
      note.iconPath = new vscode.ThemeIcon('info');
      rows.push(note);
    }
    return rows;
  }
}

function settings() {
  const c = vscode.workspace.getConfiguration('banto');
  return {
    kitDir: c.get('kitDir', ''),
    email: c.get('email', ''),
    pollMinutes: c.get('pollMinutes', 5),
    autoOpen: c.get('meetings.autoOpen', false),
    oshi: c.get('oshi.show', true),
  };
}

function activate(context) {
  const tree = new IssueTree();
  const out = vscode.window.createOutputChannel('番頭');
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  bar.tooltip = '番頭: いま使う推し';

  const ui = {
    info: (message, ...rest) => vscode.window.showInformationMessage(message, ...rest),
    warn: (message, ...rest) => vscode.window.showWarningMessage(message, ...rest),
    open: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
    status: (text) => {
      if (text) { bar.text = '$(heart) ' + text; bar.show(); } else { bar.hide(); }
    },
    issues: (items, hint) => tree.set(items, hint),
    log: (line) => out.appendLine(new Date().toLocaleTimeString() + ' ' + line),
    openSettings: () => vscode.commands.executeCommand('workbench.action.openSettings', 'banto'),
  };

  const app = createApp({
    ui,
    settings,
    connect: (c) => {
      const found = findQueue({ kitDir: c.kitDir, env: process.env });
      return { queue: found.queueDir ? makeQueue(found.queueDir) : null, reason: found.reason };
    },
  });

  context.subscriptions.push(
    out, bar,
    vscode.window.registerTreeDataProvider('banto.issues', tree),
    vscode.commands.registerCommand('banto.refresh', () => app.refreshIssues(true)),
    vscode.commands.registerCommand('banto.showIssue', (item) => app.showIssue(item)),
    vscode.commands.registerCommand('banto.meetingsRefresh', () => app.fetchMeetings()),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('banto')) app.reconfigure(); }),
    { dispose: () => app.dispose() },
  );

  const timer = setInterval(() => app.tick(), TICK_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  app.start();
}

function deactivate() {}

module.exports = { activate, deactivate };
