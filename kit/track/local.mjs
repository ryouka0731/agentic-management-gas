/**
 * 手元で済ませるところ (#13)。番頭から取った一覧を絞る・日報に当てはめる・返事を読める形にする・
 * 道具の具合を点検する。
 *
 * **searchNormalize / searchRank / searchFilter / reportLines / reportFill は画面
 * (src/ui/app.js.html) の写しである。** 片方だけ直すと、画面と手元で探した結果や下書きが
 * 食い違う。test/kit-commands.test.js の「画面と手元で同じ答えになる」が見ている。
 */

import fs from 'node:fs';
import path from 'node:path';
import { hookCommand } from './track.mjs';
import { readConfig, cleanVersion, compareVersions, paths } from './update.mjs';

/**
 * この道具の版。**番頭の AGENT_KIT_VERSION() と同じでなければならない**
 * (test/kit-commands.test.js が見ている)。doctor が入れた道具の版と比べる。
 */
export const KIT_VERSION = '1.9.0';

/** 画面の OFFICIAL と同じ言葉 */
const OFFICIAL = '正式版';

/* ---------- 横断検索 (画面の写し) ---------- */

/**
 * 比べるための形にそろえる。全角半角・大文字小文字・カタカナとひらがなの違いを消す。
 *
 * @param {string} s
 * @returns {string}
 */
export function searchNormalize(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
}

/**
 * 1件の段。0 番号がぴったり / 1 先頭が合う / 2 途中が合う / -1 合わない。
 *
 * @param {object} item
 * @param {string[]} words 正規化済みの語
 * @returns {number}
 */
export function searchRank(item, words) {
  var title = searchNormalize(item.title);
  var num = words.length === 1 ? words[0].replace(/^#/, '') : '';
  if (num && /^\d+$/.test(num) && Number(num) === Number(item.number) && item.number) return 0;
  for (var i = 0; i < words.length; i++) {
    if (title.indexOf(words[i]) < 0) return -1;
  }
  return title.indexOf(words[0]) === 0 ? 1 : 2;
}

/**
 * 候補を種類ごとに並べる。種類ごとに5件・全体で20件まで。
 *
 * @param {object[]} index searchIndex の返事
 * @param {string} query
 * @returns {Array<{kind: string, items: object[]}>}
 */
export function searchFilter(index, query) {
  var words = searchNormalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  var stateOrder = {
    issue: { open: 0, closed: 1 },
    pull: { open: 0, approved: 0, merged: 1, closed: 2 },
    inquiry: { open: 0, done: 1 },
    impediment: { open: 0, resolved: 1 },
  };

  var groups = {};
  (index || []).forEach(function (item) {
    var rank = searchRank(item, words);
    if (rank < 0) return;
    var hit = null;
    var norm = searchNormalize(item.title);
    if (norm.length === String(item.title).length) {
      var at = norm.indexOf(words[0]);
      if (at >= 0) hit = [at, at + words[0].length];
    }
    (groups[item.kind] = groups[item.kind] || []).push(Object.assign({}, item, { rank: rank, hit: hit }));
  });

  var TOTAL = 20;
  var PER_KIND = 5;
  var kinds = ['doc', 'issue', 'pull', 'branch', 'inquiry', 'impediment'].filter(function (kind) {
    return groups[kind];
  });
  if (!kinds.length) return [];
  kinds.forEach(function (kind) {
    groups[kind].sort(function (a, b) {
      return a.rank - b.rank ||
        (a.archived ? 1 : 0) - (b.archived ? 1 : 0) ||
        ((stateOrder[kind] || {})[a.state] || 0) - ((stateOrder[kind] || {})[b.state] || 0) ||
        b.number - a.number;
    });
  });

  var share = Math.max(1, Math.floor(TOTAL / kinds.length));
  var left = TOTAL;
  var count = {};
  kinds.forEach(function (kind) {
    var n = Math.min(groups[kind].length, share, PER_KIND, left);
    count[kind] = n;
    left -= n;
  });
  kinds.forEach(function (kind) {
    var more = Math.min(groups[kind].length, PER_KIND, count[kind] + left) - count[kind];
    if (more > 0) { count[kind] += more; left -= more; }
  });

  var out = [];
  kinds.forEach(function (kind) {
    if (count[kind] > 0) out.push({ kind: kind, items: groups[kind].slice(0, count[kind]) });
  });
  return out;
}

/* ---------- 日報 (画面の写し) ---------- */

/**
 * 箇条を1行ずつ `- ` で並べる。無ければ `- 特になし`。
 */
export function reportLines(items, fmt) {
  return items && items.length ? items.map(fmt).join('\n') : '- 特になし';
}

/**
 * 日報の形に中身を当てはめる。**知らない差し込みはそのまま残す**。
 *
 * @param {string} template
 * @param {{today: object[], tomorrow: object[], troubles: object[], date: string, name: string}} parts
 * @returns {string}
 */
export function reportFill(template, parts) {
  var map = {
    '今日': reportLines(parts.today, function (x) {
      return x.kind === 'pull'
        ? '- 確認依頼 #' + x.number + ' ' + x.title + ' を' + OFFICIAL + 'に反映'
        : '- #' + x.number + ' ' + x.title;
    }),
    '明日': reportLines(parts.tomorrow, function (x) {
      return '- #' + x.number + ' ' + x.title +
        (x.due ? ' (期限 ' + Number(x.due.substring(5, 7)) + '/' + Number(x.due.substring(8, 10)) + ')' : '');
    }),
    '困りごと': reportLines(parts.troubles, function (x) { return '- ' + x.title; }),
    '日付': parts.date || '',
    '名前': parts.name || '',
  };
  return String(template).replace(/\{(今日|明日|困りごと|日付|名前)\}/g, function (m, k) { return map[k]; });
}

/* ---------- 返事を読める形にする ---------- */

const KIND_NAMES = {
  doc: '文書', issue: 'やること', pull: '確認依頼', branch: '改訂版', inquiry: '報告', impediment: '障害物',
};

const STATE_NAMES = {
  open: '開いている', closed: '閉じた', approved: '承認済み', merged: '反映済み', done: '済み', resolved: '解決済み',
};

/**
 * あなたの番 (homeMine の返事)。
 *
 * @param {{reviews: object, returned: object, due: object}} r
 * @returns {string}
 */
export function formatMine(r) {
  const lines = ['あなたの番'];
  function part(title, x, line) {
    const items = (x && x.items) || [];
    const total = (x && x.total) || items.length;
    lines.push('');
    lines.push(title + ' (' + total + '件)');
    if (!items.length) lines.push('  なし');
    for (const it of items) lines.push('  ' + line(it));
    if (total > items.length) lines.push('  ほか ' + (total - items.length) + '件 (画面のホームで見られます)');
  }
  const plain = (it) => '#' + it.number + ' ' + it.title;
  part('確かめてほしい確認依頼', r.reviews, plain);
  part('戻ってきた確認依頼', r.returned, plain);
  part('期限が近いやること', r.due, (it) => plain(it) + ' (期限 ' + it.due + (it.overdue ? '・期限切れ' : '') + ')');
  return lines.join('\n');
}

/**
 * 改善のヒント (homeAdvice の返事)。
 *
 * @param {object[]} list
 * @returns {string}
 */
export function formatAdvice(list) {
  if (!list || !list.length) return '改善のヒントはありません';
  const lines = ['改善のヒント'];
  for (const a of list) {
    lines.push('');
    lines.push('- ' + a.title);
    lines.push('  ' + a.why);
    lines.push('  ' + a.tip);
  }
  return lines.join('\n');
}

/**
 * 横断検索の結果 (searchFilter の返り値)。
 *
 * @param {Array<{kind: string, items: object[]}>} groups
 * @returns {string}
 */
export function formatSearch(groups) {
  if (!groups.length) return '見つかりませんでした';
  const lines = [];
  for (const g of groups) {
    if (lines.length) lines.push('');
    lines.push(KIND_NAMES[g.kind] || g.kind);
    for (const it of g.items) {
      const head = it.number ? '#' + it.number + ' ' : '';
      const state = STATE_NAMES[it.state] ? ' (' + STATE_NAMES[it.state] + ')' : '';
      const key = it.kind === 'doc' && it.key ? '  ' + it.key : '';
      lines.push('  ' + head + it.title + state + (it.archived ? ' (しまったもの)' : '') + key);
    }
  }
  return lines.join('\n');
}

/* ---------- 点検 (番頭に頼まない) ---------- */

/** 返事が無いまま、止まったと読むまでの時間。キューは1分ごとに回る */
const STALE_MS = 5 * 60 * 1000;

function minutes(ms) {
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * 設定・入れ先・最後の返事・道具の版・フックを点検して、直し方を出す。
 *
 * **番頭には何も頼まない。** 届かないときに使うものなので、届くことを前提にしない。
 *
 * @param {{config: ?{queueDir: string, from: string}, home: string, claude: string, now?: number,
 *   version?: string}} o
 * @returns {{ok: boolean, text: string}}
 */
export function doctor({ config, home, claude, now = Date.now(), version = KIT_VERSION }) {
  const lines = ['手元の道具の点検 (番頭には何も頼みません)', ''];
  const fixes = [];
  const good = (what, how) => lines.push('[よし] ' + what + ': ' + how);
  const bad = (what, how, fix) => { lines.push('[直す] ' + what + ': ' + how); fixes.push(fix); };
  const note = (what, how) => lines.push('[情報] ' + what + ': ' + how);

  // 1. 設定
  if (!config) {
    bad('設定', '見つかりません',
      'node agent.mjs setup を実行し、agentkit.example.json を .agentkit.json として写して queueDir を書く');
  } else {
    good('設定', config.from);
  }

  // 2. 命令の入れ先
  const queueDir = config ? String(config.queueDir || '') : '';
  let queueOk = false;
  if (config && !queueDir) {
    bad('入れ先', '設定に queueDir がありません', '設定 (' + config.from + ') に queueDir を書く');
  } else if (queueDir && !fs.existsSync(queueDir)) {
    bad('入れ先', queueDir + ' がありません',
      'Google Drive for desktop が動いて同期しているか、queueDir の道のりの綴りを確かめる (画面の右上の自分の顔 →「手元から動かす道具を落とす」に道のりが出ます)');
  } else if (queueDir) {
    try {
      fs.accessSync(queueDir, fs.constants.W_OK);
      queueOk = true;
      good('入れ先', queueDir);
    } catch (e) {
      bad('入れ先', queueDir + ' に書けません', 'そのフォルダに書けるか (Drive の共有で編集者になっているか) を確かめる');
    }
  }

  // 3. 最後の返事。返事は受け取ると消すので、残っているもので見当を付ける
  if (queueOk) {
    const names = fs.readdirSync(queueDir);
    const at = (n) => { try { return fs.statSync(path.join(queueDir, n)).mtimeMs; } catch (e) { return NaN; } };
    const results = names.filter((n) => n.endsWith('.result.json')).map(at).filter((t) => !isNaN(t));
    const answered = new Set(names.filter((n) => n.endsWith('.result.json')).map((n) => n.replace(/\.result\.json$/, '')));
    const waiting = names.filter((n) => n.endsWith('.cmd.json') && !answered.has(n.replace(/\.cmd\.json$/, '')))
      .map(at).filter((t) => !isNaN(t));
    const lastReply = results.length ? Math.max(...results) : NaN;
    const oldest = waiting.length ? Math.min(...waiting) : NaN;

    if (!isNaN(lastReply)) note('最後の返事', minutes(now - lastReply) + '分前');
    if (!isNaN(oldest) && now - oldest > STALE_MS) {
      bad('返事', '命令が ' + waiting.length + '件、いちばん古いもので ' + minutes(now - oldest) + '分返事がありません',
        'Drive for desktop が同期しているかを確かめる。同期していれば番頭の1分ごとの仕掛けが止まっています。管理者に画面の「設定」でキューの状態を見てもらい、止まっていれば持ち主に Apps Script で setupCommandQueue() をもう一度実行してもらう');
    } else if (waiting.length) {
      note('返事', '命令が ' + waiting.length + '件、返事を待っています (1分ほどで返ります)');
    } else if (isNaN(lastReply)) {
      note('返事', '手がかりがありません。node agent.mjs files で確かめられます (返るまで最大1分)');
    } else {
      good('返事', '待っている命令はありません');
    }
  }

  // 4. 道具の版。入れた道具 (~/.banto) とこの道具が違えば、どちらかが古い
  const banto = readConfig(home);
  const installed = banto ? cleanVersion(banto.kitVersion) : '';
  if (!banto) {
    note('道具の版', version + ' (番頭に作業を載せる仕掛けは入っていません)');
  } else if (installed && compareVersions(installed, version) > 0) {
    // 入れた道具は自分で新しくなっている。古いのは今動かしているほう (落とした zip) なので、update では直らない
    bad('道具の版', '入れた道具は ' + installed + '、いま動かしている道具は ' + version + ' (こちらが古い)',
      'node "' + path.join(paths(home).kit, 'agent.mjs') + '" を使う (または画面から道具の zip を落とし直す)');
  } else if (installed && installed !== version) {
    bad('道具の版', '入れた道具は ' + installed + '、この道具は ' + version,
      'node agent.mjs update で入れた道具を新しくする');
  } else {
    good('道具の版', version);
  }

  // 5. フックとスキル。入れた人だけ見る
  if (banto) {
    let commands = [];
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
      for (const groups of Object.values((settings && settings.hooks) || {})) {
        if (!Array.isArray(groups)) continue;
        for (const g of groups) for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) commands.push(h && h.command);
      }
    } catch (e) {
      commands = [];
    }
    const hooks = ['prompt', 'stop'].every((k) => commands.includes(hookCommand(home, k)));
    const skill = fs.existsSync(path.join(claude, 'skills', 'banto-track'));
    if (hooks && skill) good('フック', 'Claude Code に入っています');
    else bad('フック', (hooks ? '' : 'settings.json にフックがありません ') + (skill ? '' : 'スキルがありません'),
      'node agent.mjs track install でフックとスキルを入れ直す');
  }

  lines.push('');
  if (fixes.length) {
    lines.push('直すこと:');
    fixes.forEach((f, i) => lines.push('  ' + (i + 1) + '. ' + f));
  } else {
    lines.push('おかしなところは見つかりませんでした');
  }
  return { ok: fixes.length === 0, text: lines.join('\n') };
}
