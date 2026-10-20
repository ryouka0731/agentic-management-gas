import { expect, vi } from 'vitest';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES, KIT_SOURCES } from '../sources.js';

/*
 * 画面から呼ぶ api* と、手元の道具が呼ぶ命令 (COMMAND_OPS) のテストの共通の組み立て。
 *
 * 持ち主は入れ物のフォルダの持ち主 (疑似GASでは tester@example.com)。管理者は
 * 持ち主と、入れ物のフォルダを編集できる人。Session からは決めない (CLAUDE.md の
 * 「誰が持ち主かは Session からは分からない」)。
 */

// 1件ごとに本体をまるごと読み直すので、並べて走らせると既定の5秒を超えることがある
vi.setConfig({ testTimeout: 60000 });

export const OWNER = 'tester@example.com';
export const ADMIN = 'admin@example.com';
export const OTHER = 'other@example.com';

/**
 * @param {object} [opts]
 * @param {boolean} [opts.file] 正式版の文書を1つ登録して記録しておく (既定 true)
 * @param {boolean} [opts.kit] 配る道具の中身も読む
 * @param {boolean} [opts.tasks] Google ToDo の拡張サービスを足す
 * @param {boolean|object} [opts.drive] Drive の拡張サービスを足す (_makeDrive の引数)
 */
export function makeEnv(opts = {}) {
  const fake = createFakeGas();
  // 拡張サービスは既定で無い (足していない環境でも動くことを見る)
  if (opts.tasks) fake.Tasks = fake._makeTasks();
  if (opts.drive) fake.Drive = fake._makeDrive(opts.drive === true ? {} : opts.drive);
  // GoogleTasks.gs は APP_SOURCES に入っていない (test/googletasks.test.js と同じく足す)。
  // apiTasks* は本番ではこれを呼ぶので、無いと「関数が無い」で落ちる
  const sources = APP_SOURCES.concat(['src/core/GoogleTasks.gs'], opts.kit ? KIT_SOURCES : []);
  const ctx = loadGasWith(fake, ...sources);
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};

  const config = ctx.repoInit('agentic-management');
  // 入れ物のフォルダを編集できる人 = 管理者
  fake.DriveApp.getFolderById(config.rootId)._addEditor(ADMIN);

  const env = { ctx, fake, config, fileId: null };
  if (opts.file !== false) {
    env.fileId = fake._createDoc('就業規則', '<p>第1条</p>\n', config.mainId);
    ctx.repoRegisterFile(env.fileId, '就業規則.doc');
    ctx.commitFile(env.fileId, 'main', '初期状態', null);
  }
  return env;
}

/** 改訂版を作って1つ記録し、確認依頼まで出す */
export function withPr(env, opts = {}) {
  const { ctx, fake, fileId } = env;
  const name = opts.branch || '改訂';
  ctx.apiBranchCreate(name, fileId);
  const work = ctx.branchWorkingFileId(name, fileId);
  fake._docs.set(work, opts.html || '<p>第1条</p>\n<p>第2条</p>\n');
  ctx.commitFile(work, name, '第2条を足した', null);
  const pr = ctx.apiPrCreate(opts.title || '第2条の追加', '補足', name, fileId);
  return Object.assign(env, { work, pr, branch: name });
}

/** google.script.run が運べない値 (Date・関数・undefined の穴) を探す */
export function unserializable(value, path = '$', allowUndefined = []) {
  if (value === null) return [];
  if (value === undefined) {
    const key = path.replace(/^.*[.\]]/, '');
    return allowUndefined.indexOf(key) >= 0 ? [] : [path + ' が undefined'];
  }
  if (Object.prototype.toString.call(value) === '[object Date]') return [path + ' が Date のまま'];
  if (typeof value === 'function') return [path + ' が関数'];
  if (typeof value === 'number' && !Number.isFinite(value)) return [path + ' が ' + value];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => unserializable(v, path + '[' + i + ']', allowUndefined));
  }
  if (typeof value === 'object') {
    return Object.keys(value).flatMap((k) => unserializable(value[k], path + '.' + k, allowUndefined));
  }
  return [];
}

/**
 * 画面に渡せる形か: 運べない値 (Date・関数・undefined の穴) が無く、JSON を往復しても同じ。
 *
 * @param {*} value
 * @param {object} [opts]
 * @param {string[]} [opts.allowUndefined] undefined のままでよい欄の名前 (画面が読まない欄)
 */
export function expectScreenSafe(value, opts = {}) {
  const allow = opts.allowUndefined || [];
  expect(unserializable(value, '$', allow)).toEqual([]);
  // vm の中で作った値でも、JSON を往復した形と中身が同じ (Date や関数が混ざると崩れる)
  if (!allow.length) expect(roundTrip(value)).toEqual(normalize(value));
  return value;
}

function roundTrip(v) { return JSON.parse(JSON.stringify(v)); }

/** vm の中の物を、このテストの realm の素の値に写す (toEqual が realm で迷わないように) */
function normalize(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(normalize);
  const out = {};
  for (const k of Object.keys(v)) out[k] = normalize(v[k]);
  return out;
}

/* 人に見せる断りに Git の言葉を入れない (test/naming.test.js と同じ並び) */
const GIT_WORDS = [
  /(^|[^A-Z_])PR(?![A-Z_])/, /マージ/, /プルリクエスト/, /ブランチ/, /コミット/,
  /リベース/, /コンフリクト/, /クローズ/,
  /(^|[^A-Za-z_])Issue(?![A-Za-z_])/, /(^|[^A-Za-z_])HEAD(?![A-Za-z_])/,
  /(^|[^「A-Za-z_])main(?![A-Za-z_」])/,
];

/**
 * 断られることと、その断りが人の言葉 (日本語・Git の言葉なし) であることを確かめる。
 *
 * @param {function} fn
 * @param {RegExp} [pattern]
 * @returns {string} 断りの字
 */
export function expectRefused(fn, pattern) {
  let message = null;
  try {
    fn();
  } catch (e) {
    message = String(e && e.message);
  }
  expect(message, '断られなかった').not.toBeNull();
  if (pattern) expect(message).toMatch(pattern);
  expect(message).toMatch(/[぀-ヿ一-鿿]/);
  for (const w of GIT_WORDS) expect(message, '断りに Git の言葉: ' + message).not.toMatch(w);
  return message;
}

/** 台帳の表をまるごと写す (断ったときに途中まで書かれていないかを見る) */
export function snapshotDb(ctx, tables) {
  const out = {};
  for (const t of tables) out[t] = JSON.stringify(ctx.dbReadAll(t));
  return out;
}

export function asUser(fake, email, fn) {
  const before = fake._getUser();
  fake._setUser(email);
  try {
    return fn();
  } finally {
    fake._setUser(before);
  }
}
