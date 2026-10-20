import { mountApp } from '../dom.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { FULL_SOURCES } from '../sources.js';

/*
 * 画面と本物のサーバをつないで通す (test/e2e/*.test.js の共通の口)。
 *
 * test/component/ の画面のテストは、google.script.run が test/dom.js の DEFAULTS
 * (仕込んだ返事) を返す。それでは「押したら台帳に何が残り、取り直した一覧に
 * 何が出るか」は確かめられない。仕込んだ返事とサーバの返す形がずれても落ちない。
 *
 * ここでは画面は test/dom.js の mountApp でそのまま組み、返事だけを差し替える。
 * 押す → 画面の call() → 本物の api* (疑似GAS の上で動く) → 台帳 → 返事 → 画面。
 *
 * 返事の運び方は実物に寄せる:
 * - 返事はあとから届く (setTimeout)。押した直後には何も描かれていない
 * - 引数も返事も写しを運ぶ (structuredClone)。サーバと画面で同じ物を共有しない
 * - 返事に Date が混ざると画面には null が届く (実物の google.script.run と同じ)
 * - サーバが投げたら withFailureHandler に Error が届く
 *
 * 押したあとは `await e2e.settle()` で、行き来が止むまで待つ。
 */

const DOC_MIME = 'application/vnd.google-apps.document';

/** 持ち主 (= 管理者)。疑似GAS の入れ物の持ち主と同じ */
export const OWNER = 'tester@example.com';

/**
 * サーバを用意する。何も仕込まない (リポジトリを作るだけ)。
 *
 * Docs の描画と書き戻しは他の結合テストと同じく、fileId → 正規化HTML の写像に置き換える。
 *
 * @returns {{ctx: object, fake: object, config: object}}
 */
export function createServer() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...FULL_SOURCES);
  ctx.liveHtml = (fileId) => fake._docs.get(fileId) || '';
  ctx.renderDoc = ctx.liveHtml;
  ctx.writeHtmlToDoc = (fileId, h) => { fake._docs.set(fileId, h); };
  ctx.liveCacheInvalidate = () => {};
  const config = ctx.repoInit('agentic-management');
  return { ctx, fake, config };
}

/** 画面へ運べない型が混ざっているか。実物はそのとき返事を null にする */
function unsendable(v, seen) {
  if (v === null || typeof v !== 'object') return typeof v === 'function';
  if (Object.prototype.toString.call(v) === '[object Date]') return true;
  if (seen.has(v)) return false;
  seen.add(v);
  return Object.keys(v).some((k) => unsendable(v[k], seen));
}

/** 返事を運ぶ形にする */
function wire(v) {
  if (v === undefined) return null;
  if (unsendable(v, new Set())) return null;
  return structuredClone(v);
}

/**
 * 画面を本物のサーバにつないで組む。
 *
 * @param {{server?: object, user?: string, location?: object}} [opts]
 *   server: createServer() の返り。省くと新しく作る (人を替えて組み直すときに渡す)
 *   user: 画面を開いている人。サーバはこの人として動く
 * @returns {{ctx, fake, config, user, calls, settle, as, rows, failures}}
 */
export function mountFullstack(opts) {
  const o = opts || {};
  const server = o.server || createServer();
  const { ctx, fake } = server;
  const user = o.user || OWNER;
  const names = Object.keys(ctx).filter((k) => /^api/.test(k) && typeof ctx[k] === 'function');

  let pending = 0;
  // 画面の返事のハンドラで投げたもの。settle で表に出す (黙って握らない)
  const thrown = [];
  // サーバが断った呼び出し (名前と文)
  const failures = [];

  function deliver(fn, value) {
    if (!fn) return;
    try { fn(value); } catch (e) { thrown.push(e); }
  }

  function transport(name, args, onSuccess, onFailure) {
    pending++;
    // 引数は送った時点で写す (送ったあとに画面が書き換えても届いた物は変わらない)
    let sent;
    try { sent = structuredClone(args); } catch (e) { sent = null; }
    setTimeout(() => {
      try {
        if (sent === null) {
          deliver(onFailure, new Error('送れない値が引数に入っています: ' + name));
          return;
        }
        fake._setUser(user);
        let value;
        try {
          // 画面が呼ぶのにサーバに無い名前 (写し間違い・消し忘れ) は、実物でも失敗になる
          if (typeof ctx[name] !== 'function') throw new Error('サーバに無い関数です: ' + name);
          value = ctx[name].apply(ctx, sent);
        } catch (e) {
          failures.push({ name, message: String(e && e.message) });
          deliver(onFailure, new Error(String(e && e.message)));
          return;
        }
        deliver(onSuccess, wire(value));
      } finally {
        pending--;
      }
    }, 0);
  }

  const app = mountApp({}, { transport, names, location: o.location });

  // 帯 (#snackbar) は次の帯で置き換わり、数秒で消える。出た字を順に控えておく
  const snacks = [];
  const watch = new window.MutationObserver((records) => {
    records.forEach((r) => r.addedNodes.forEach((n) => {
      if (n.id === 'snackbar') snacks.push(n.textContent);
    }));
  });
  watch.observe(document.body, { childList: true });

  /**
   * 行き来が止むまで待つ。返事のハンドラがさらに頼んだぶんも待つ。
   * 画面のハンドラが投げていたら、ここで投げ直す。
   */
  async function settle() {
    for (let i = 0; i < 500; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (!pending) {
        // 返事のハンドラが同じ回の中で次を頼むことがあるので、もう一巡だけ見る
        await new Promise((r) => setTimeout(r, 0));
        if (!pending) break;
      }
    }
    if (pending) throw new Error('サーバとの行き来が止みません (' + pending + '件待ち)');
    if (thrown.length) throw thrown[0];
  }

  return {
    ctx,
    fake,
    config: server.config,
    server,
    user,
    calls: app.calls,
    failures,
    snacks,
    settle,
    /** 同じサーバのまま、別の人として画面を開き直す */
    as(other) { return mountFullstack({ server, user: other }); },
    /** 台帳の表をそのまま読む (サーバの側から確かめる) */
    rows(table) {
      fake._setUser(user);
      return ctx.dbReadAll(table);
    },
  };
}

/**
 * 入れ物 (正式版のフォルダ) に Docs を置く。登録はしない (画面から登録する)。
 *
 * @param {object} server createServer() の返り
 * @param {string} name
 * @param {string} html 正規化HTML
 * @returns {string} fileId
 */
export function placeDoc(server, name, html) {
  return server.fake._createDoc(name, html, server.config.mainId);
}

export { DOC_MIME };

// ===== 人の操作 =====

/** 字を打つ (input / change を送る) */
export function type(el, text) {
  if (!el) throw new Error('打つ欄がありません');
  el.focus && el.focus();
  el.value = text;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** 選ぶ (select) */
export function choose(el, value) {
  if (!el) throw new Error('選ぶ欄がありません');
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** 押す。押せないものを押そうとしたら、その場で落とす (押せたつもりで先へ進まない) */
export function click(el) {
  if (!el) throw new Error('押すものがありません');
  if (el.disabled) throw new Error('押せません: ' + (el.textContent || el.title || el.id));
  el.click();
}

/** 字で探す (見えている字が一致・含むもの) */
export function byText(selector, text, root) {
  const all = Array.from((root || document).querySelectorAll(selector));
  const hit = all.find((el) => el.textContent.trim() === text) ||
    all.find((el) => el.textContent.indexOf(text) > -1);
  if (!hit) {
    throw new Error('「' + text + '」が見つかりません (' + selector + '): ' +
      all.map((el) => el.textContent.trim()).filter(Boolean).slice(0, 12).join(' | '));
  }
  return hit;
}

/** 右のペインの入力欄に書いて送る。fields は name → 値 */
export function fillSideForm(values) {
  const form = document.querySelector('#side-panel form.inline-form');
  if (!form) throw new Error('入力欄が開いていません');
  Object.keys(values).forEach((name) => {
    const el = form.querySelector('[name="' + name + '"]');
    if (!el) throw new Error('欄がありません: ' + name);
    if (el.tagName === 'SELECT') choose(el, values[name]);
    else type(el, values[name]);
  });
  return form;
}

/** 入力欄を送る (送るボタンを押す) */
export function submitSideForm() {
  const form = document.querySelector('#side-panel form.inline-form');
  if (!form) throw new Error('入力欄が開いていません');
  click(form.querySelector('button[type="submit"]'));
}


/** 左の行き先を押す */
export function go(tab) {
  click(document.querySelector('.nav-item[data-tab="' + tab + '"]'));
}
