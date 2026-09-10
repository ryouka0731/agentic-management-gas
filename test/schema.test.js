import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';

const gas = loadGas('src/core/Db.gs');

/**
 * メタDBの列順を固定する。
 *
 * シートに書かれた行は列の位置でしか意味を持たない。途中に列を挿入すると、
 * 既存の行を新しい順序で読むことになり、値が1つずつずれる。
 * 実際に dueDate を createdAt の前に入れて壊したため、ここで留める。
 *
 * 列を増やすときは、この表の**末尾に足す**こと。
 */
const EXPECTED = {
  files: ['fileId', 'path', 'type', 'registeredAt', 'registeredBy'],
  commits: ['sha', 'parentSha', 'branch', 'fileId', 'blobSha', 'author', 'message', 'timestamp'],
  branches: ['name', 'headSha', 'baseSha', 'state', 'workingFolderId', 'createdBy', 'createdAt'],
  pulls: ['number', 'title', 'body', 'sourceBranch', 'targetBranch', 'state', 'author', 'createdAt', 'mergedAt', 'reviewers'],
  reviews: ['prNumber', 'reviewer', 'state', 'body', 'at', 'id', 'editedAt'],
  task_links: ['issueNumber', 'user', 'taskId', 'listId', 'syncedAt'],
  issue_comments: ['id', 'issueNumber', 'body', 'by', 'at', 'editedAt'],
  usage: ['day', 'kind', 'target', 'count', 'user'],
  templates: ['name', 'body', 'builtin', 'createdBy', 'createdAt'],
  members: ['email', 'manager', 'note', 'updatedAt', 'name'],
  tags: ['name', 'color', 'builtin', 'createdBy', 'createdAt'],
  notifications: ['id', 'to', 'kind', 'title', 'body', 'link', 'at', 'readAt'],
  inquiries: ['number', 'kind', 'body', 'by', 'at', 'state', 'context',
    'answer', 'answeredAt', 'title', 'closedBy', 'shots', 'issueNumber'],
  inquiry_replies: ['id', 'inquiryNumber', 'body', 'by', 'at', 'editedAt', 'shots'],
  issues: ['number', 'title', 'body', 'state', 'assignee', 'labels', 'linkedFileIds', 'linkedPr', 'createdAt', 'closedAt', 'dueDate', 'startDate', 'parent', 'estimate', 'plannedHours', 'actualHours',
    'archivedAt', 'updatedAt'],
  project_items: ['issueNumber', 'column', 'order'],
};

describe('メタDBの列順', () => {
  const schema = gas.DB_SCHEMA();

  Object.keys(EXPECTED).forEach((table) => {
    it(table + ' の列と順序が変わっていない', () => {
      expect(schema[table]).toEqual(EXPECTED[table]);
    });
  });

  it('定義されているテーブルが増減していない', () => {
    expect(Object.keys(schema).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});
