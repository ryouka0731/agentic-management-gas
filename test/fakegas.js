import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** HtmlService の名前 ('ui/oshi-default/taku-chibi') → src の中の .html。src の外や無いファイルは null */
function srcHtmlPath(name) {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(String(name))) return null;
  const file = path.join(SRC_DIR, name + '.html');
  return fs.existsSync(file) ? file : null;
}

/**
 * GAS のサービスを最小限だけ再現した実行環境を作る。
 *
 * 目的は Commit / Branch / PullRequest といった「組み立ての層」を
 * ローカルで通しで実行することにある。Docs の描画と書き戻し
 * (DocumentApp) はここでは再現せず、fileId → 正規化HTML の
 * 素朴な写像に置き換える。描画そのものは Phase 1 で実機検証済みで、
 * ここで検証したいのは commit / merge / 書き戻しの順序と条件だから。
 *
 * @returns {object} vm コンテキストに流し込むグローバル
 */
export function createFakeGas() {
  var seq = 0;
  let trashDenied = false;
  let trashPredicate = null;
  let sharingDenied = false;
  const nextId = (prefix) => prefix + '-' + (++seq);

  const files = new Map();   // id -> file
  const folders = new Map(); // id -> folder
  const docs = new Map();    // fileId -> 正規化HTML

  const DOC_MIME = 'application/vnd.google-apps.document';

  function makeFile(name, content, parentId, mime) {
    const id = nextId('file');
    const f = {
      _id: id,
      _name: name,
      _content: content,
      _parent: parentId,
      _mime: mime || 'text/plain',
      _trashed: false,
      _createdBy: activeUser,
      _driveId: parentId && folders.has(parentId) ? folders.get(parentId)._driveId : '',
      moveTo: (folder) => { f._parent = folder.getId(); f._driveId = folder._driveId; return f; },
      _owner: (parentId && folders.has(parentId) && folders.get(parentId)._driveId) ? '' : activeUser,
      // 共有ドライブのファイルは持ち主が無い (実機は null を返す)
      getOwner: () => (f._owner ? { getEmail: () => f._owner } : null),
      _setOwner: (email) => { f._owner = email; return f; },
      getId: () => id,
      getName: () => f._name,
      setName: (n) => { f._name = n; return f; },
      // 中身を書き換える (実機の File.setContent と同じく字で)
      setContent: (c) => { f._content = String(c); f._updated = new Date(); return f; },
      getMimeType: () => f._mime,
      getUrl: () => 'https://example.invalid/d/' + id,
      // 実機と同じく、変わらない限り同じ時刻を返す。呼ぶたびに今を返すと、
      // これを鍵にするキャッシュが当たったり外れたりする
      _updated: new Date(),
      getLastUpdated: () => f._updated,
      setTrashed: (v) => {
        if (trashDenied || (trashPredicate && trashPredicate(f))) throw new Error('Insufficient permissions for this file');
        f._trashed = v !== false;
        return f;
      },
      isTrashed: () => f._trashed,
      setSharing: () => {
        if (sharingDenied) throw new Error('Sharing outside the shared drive is not allowed');
        return f;
      },
      getParents: () => {
        const hits = folders.has(f._parent) ? [folders.get(f._parent)] : [];
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
      getBlob: () => ({
        getDataAsString: () => f._content,
        // GAS の Blob.getBytes() は符号付き byte を返す。Blob から作ったファイル (画像) は
        // byte の並びをそのまま持つので、字に直さずに返す (直すと "137,80,…" の字になる)
        getBytes: () => (Array.isArray(f._content) ? f._content.slice()
          : Array.from(Buffer.from(String(f._content), 'utf8')))
          .map((b) => (b > 127 ? b - 256 : b)),
        getContentType: () => f._mime,
      }),
      makeCopy: (newName, folder) => {
        const copy = makeFile(newName, f._content, folder.getId(), f._mime);
        if (docs.has(id)) docs.set(copy.getId(), docs.get(id));
        return copy;
      },
    };
    files.set(id, f);
    return f;
  }

  function makeFolder(name, parentId) {
    const id = nextId('folder');
    const fo = {
      _name: name,
      _parent: parentId,
      _trashed: false,
      _owner: (parentId && folders.has(parentId) && folders.get(parentId)._driveId) ? '' : 'tester@example.com',
      _driveId: parentId && folders.has(parentId) ? folders.get(parentId)._driveId : '',
      _markShared: (driveId) => { fo._driveId = driveId; fo._owner = ''; return fo; },
      moveTo: (folder) => { fo._parent = folder.getId(); fo._driveId = folder._driveId; return fo; },
      getId: () => id,
      getName: () => fo._name,
      setTrashed: (v) => {
        if (trashDenied || (trashPredicate && trashPredicate(fo))) throw new Error('Insufficient permissions for this file');
        fo._trashed = v !== false;
        return fo;
      },
      isTrashed: () => fo._trashed,
      createFolder: (n) => makeFolder(n, id),
      createFile: (a, b, c) => (a && typeof a === 'object' && a.getBytes)
        ? makeFile(a.getName(), a.getBytes(), id, a.getContentType())
        : makeFile(a, b, id, c),
      getFiles: () => {
        const hits = [];
        for (const f of files.values()) {
          if (f._parent === id && !f._trashed) hits.push(f);
        }
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
      getFoldersByName: (n) => {
        const hits = [];
        for (const fo2 of folders.values()) {
          if (fo2._parent === id && fo2._name === n && !fo2._trashed) hits.push(fo2);
        }
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
      getFilesByName: (n) => {
        const hits = [];
        for (const f of files.values()) {
          if (f._parent === id && f._name === n && !f._trashed) hits.push(f);
        }
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
      // 実機の共有ドライブでは、ファイルは親を1つしか持てない。マイドライブの addFile は
      // 親を増やすが、この疑似GASは移す (removeFile は空実装)。片方だけ呼ぶ書き方は通ってしまう
      addFile: (f) => {
        if (fo._driveId) throw new Error('Cannot add a file to multiple parents in a shared drive');
        f._parent = id;
      },
      removeFile: () => {},
      getParents: () => {
        const hits = folders.has(fo._parent) ? [folders.get(fo._parent)] : [];
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
      getFoldersByName_unused: null,
      getOwner: () => (fo._owner ? { getEmail: () => fo._owner } : null),
      _setOwner: (email) => { fo._owner = email; return fo; },
      // 実機と同じく、編集権限の無い人が呼ぶと空を返す。持ち主は入れない
      _editors: [],
      getEditors: () => {
        if (activeUser !== fo._owner && fo._editors.indexOf(activeUser) < 0) return [];
        return fo._editors.map((e) => ({ getEmail: () => e }));
      },
      _addEditor: (email) => { fo._editors.push(email); return fo; },
    };
    folders.set(id, fo);
    return fo;
  }

  const rootFolder = makeFolder('マイドライブ', null);

  const DriveApp = {
    createFolder: (n) => makeFolder(n, rootFolder.getId()),
    getRootFolder: () => rootFolder,
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { VIEW: 'VIEW' },
    getFolderById: (id) => {
      const fo = folders.get(id);
      if (!fo) throw new Error('フォルダが見つかりません: ' + id);
      return fo;
    },
    getFileById: (id) => {
      const f = files.get(id);
      if (!f) throw new Error('ファイルが見つかりません: ' + id);
      return f;
    },
  };

  // --- スクリプト自身 ---
  let scriptId = '';

  const ScriptApp = {
    getScriptId: () => {
      if (!scriptId) throw new Error('スクリプトの場所が分かりません');
      return scriptId;
    },
    getProjectTriggers: () => [],
    // Web アプリの URL。全画面のリンク (apiAppUrl) が使う
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }),
    newTrigger: () => ({
      timeBased: () => ({ everyMinutes: () => ({ create: () => ({}) }) }),
    }),
    deleteTrigger: () => {},
  };

  /*
   * 実機の Sheets は、appendRow / setValues で書いた字を、人がセルに打ち込んだ
   * ときと同じように読む。'=' 始まりは数式に、'1/2' は日付に、'007' は 7 になる。
   * 先頭の ' はその解釈を止め、' 自体は残らない。
   *
   * 既定で実機と同じ読み方をする。字のまま持っていたころは、台帳の字が化ける
   * 類の不具合がテストに一度も現れなかった。`_parseLikeSheets(false)` で字の
   * まま持つ形に戻せる。先頭の ' はどちらでも外す
   */
  let parseLikeSheets = true;
  function asTyped(v) {
    if (typeof v !== 'string') return v;
    if (v.charAt(0) === "'") return v.substring(1);
    if (!parseLikeSheets) return v;
    if (v.charAt(0) === '=') return { formula: v };
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v)) return Number(v);
    const md = /^(\d{1,2})[\/-](\d{1,2})$/.exec(v);
    if (md) return new Date(2026, Number(md[1]) - 1, Number(md[2]));
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (/^(TRUE|FALSE)$/i.test(v)) return v.toUpperCase() === 'TRUE';
    return v;
  }

  // --- スプレッドシート (メタDB) ---
  function makeSheet(name) {
    const rows = [];
    const sheet = {
      _rows: rows,
      getName: () => name,
      getLastRow: () => rows.length,
      setFrozenRows: () => sheet,
      appendRow: (vals) => { rows.push(vals.map(asTyped)); return sheet; },
      deleteRow: (r) => { rows.splice(r - 1, 1); return sheet; },
      /*
       * 実機と同じく、中身のある範囲だけを返す。消したセルは範囲から外れる。
       *
       * 表示値は `_format` を通す。実機では表示の書式 (小数の桁・先頭の0
       * など) で表示値と生の値がずれる。既定はただの文字列で、ずれない
       */
      getDataRange: () => {
        const empty = (v) => v === undefined || v === null || v === '';
        let height = 0;
        let width = 0;
        rows.forEach((r, i) => r.forEach((v, j) => {
          if (empty(v)) return;
          height = Math.max(height, i + 1);
          width = Math.max(width, j + 1);
        }));
        const box = () => {
          const out = [];
          for (let i = 0; i < height; i++) {
            const line = [];
            for (let j = 0; j < width; j++) {
              const v = (rows[i] || [])[j];
              line.push(v === undefined || v === null ? '' : v);
            }
            out.push(line);
          }
          return out;
        };
        // 数式のセルは、実機では計算した値が返る。疑似GASは計算できないので空にする
        const isFormula = (v) => v && typeof v === 'object' && typeof v.formula === 'string';
        const formulaOf = (v) => (isFormula(v) ? v.formula
          : (typeof v === 'string' && v.indexOf('=') === 0 ? v : ''));
        return {
          getValues: () => box().map((r) => r.map((v) => (isFormula(v) ? '' : v))),
          getDisplayValues: () => box().map((r) => r.map((v) => (isFormula(v) ? ''
            : sheet._format ? sheet._format(v) : String(v)))),
          getFormulas: () => box().map((r) => r.map(formulaOf)),
        };
      },
      /** 表示の書式ごと消す。実機の clear() と同じく `_format` も落ちる */
      clear: () => { rows.length = 0; sheet._format = null; return sheet; },
      getRange: (row, col, numRows, numCols) => ({
        getValues: () => {
          const out = [];
          for (let i = 0; i < numRows; i++) {
            const src = rows[row - 1 + i] || [];
            const line = [];
            for (let j = 0; j < numCols; j++) {
              const v = src[col - 1 + j];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) {
            const r = row - 1 + i;
            while (rows.length <= r) rows.push([]);
            for (let j = 0; j < vals[i].length; j++) {
              rows[r][col - 1 + j] = asTyped(vals[i][j]);
            }
          }
        },
      }),
    };
    return sheet;
  }

  const spreadsheets = new Map();
  const sentMails = [];
  const presentations = new Map();

  const SpreadsheetApp = {
    create: (name) => {
      const file = makeFile(name, '', rootFolder.getId(), 'application/vnd.google-apps.spreadsheet');
      const sheets = new Map();
      const ss = {
        getId: () => file.getId(),
        getSheets: () => Array.from(sheets.values()),
        getSheetByName: (n) => sheets.get(n) || null,
        insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s; },
        deleteSheet: (s) => { sheets.delete(s.getName()); },
      };
      spreadsheets.set(file.getId(), ss);
      return ss;
    },
    openById: (id) => {
      const ss = spreadsheets.get(id);
      if (!ss) throw new Error('スプレッドシートが見つかりません: ' + id);
      return ss;
    },
  };

  // --- その他のサービス ---
  const props = new Map();

  // 利用者ごとの設定は別の入れ物にする。実機でも別々に持たれる
  const userProps = new Map();

  function propStore(map) {
    return {
      getProperty: (k) => (map.has(k) ? map.get(k) : null),
      setProperty: (k, v) => { map.set(k, String(v)); },
      deleteProperty: (k) => { map.delete(k); },
      // 実機と同じく、その時点の写しを返す (書き換えても返した値は変わらない)
      getProperties: () => Object.fromEntries(map),
    };
  }

  const PropertiesService = {
    getScriptProperties: () => propStore(props),
    getUserProperties: () => propStore(userProps),
  };

  let activeUser = 'tester@example.com';
  let effectiveUser = 'tester@example.com';

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_alg, content) => {
      // sha256HexBytes は符号付き byte の配列を渡してくる。
      // String() 化すると "104,101,..." を hash してしまい実機と食い違う
      var input;
      if (Buffer.isBuffer(content)) input = content;
      else if (Array.isArray(content)) input = Buffer.from(content.map((b) => b & 0xff));
      else input = Buffer.from(String(content), 'utf8');

      const buf = crypto.createHash('sha256').update(input).digest();
      // GAS は符号付き byte の配列を返す
      return Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
    },
    // 実機と同じく、時刻帯と書式に従って返す。以前はミリ秒の字を返していて、
    // 日の区切りを使うテストはそれぞれ差し替える必要があった
    formatDate: (d, tz, fmt) => {
      const parts = {};
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz || 'Asia/Tokyo', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(d).forEach((p) => { parts[p.type] = p.value; });
      return String(fmt || 'yyyy-MM-dd')
        .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
        .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
    },
    // 実機と同じく符号付き byte の配列を返す。秘密鍵は PKCS#8 の PEM
    computeRsaSha256Signature: (text, pem) => Array.from(
      crypto.sign('RSA-SHA256', Buffer.from(String(text), 'utf8'), pem))
      .map((b) => (b > 127 ? b - 256 : b)),
    base64EncodeWebSafe: (data) => Buffer.from(String(data), 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_'),
    base64Encode: (data) => (Array.isArray(data)
      ? Buffer.from(data.map((b) => b & 0xff))
      : Buffer.from(String(data), 'utf8')).toString('base64'),
    base64Decode: (text) => Array.from(Buffer.from(String(text), 'base64'))
      .map((b) => (b > 127 ? b - 256 : b)),
    zip: (blobs, name) => ({
      _zip: blobs,
      getName: () => name,
      getBytes: () => Array.from(Buffer.from(blobs.map((b) => b.getName()).join(','))),
      getContentType: () => 'application/zip',
    }),
    newBlob: function newBlob(bytes, mime, name) {
      return {
        _bytes: bytes,
        getBytes: () => bytes,
        getContentType: () => mime,
        getName: () => name,
        // 実機と同じく、写しを作って名前を付け替えられる (objectPutBlob が使う)
        copyBlob: () => newBlob(bytes, mime, name),
        setName: function (n) { name = n; return this; },
      };
    },
  };

  /**
   * Google ToDo の拡張サービスを模す。
   *
   * 既定では返さない。この機能は拡張サービスを足していない環境でも
   * 他に影響しないことを確かめる必要があるため。
   */
  function makeTasks() {
    const lists = [{ id: 'L1', title: 'マイタスク' }];
    const items = new Map();
    let seq = 0;

    return {
      _items: items,
      Tasklists: { list: () => ({ items: lists }) },
      Tasks: {
        insert: (body, listId) => {
          const id = 'task' + (++seq);
          const row = Object.assign({ id, listId }, body);
          items.set(id, row);
          return row;
        },
        patch: (body, listId, taskId) => {
          const row = Object.assign(items.get(taskId) || {}, body);
          items.set(taskId, row);
          return row;
        },
        get: (listId, taskId) => {
          const row = items.get(taskId);
          if (!row) throw new Error('not found');
          return row;
        },
      },
    };
  }

  /**
   * Drive の拡張サービス (v3) を模す。既定では返さない (足していない環境でも
   * マイドライブとして動くことを確かめるため)。
   */
  function makeDrive({ members = {}, pageSize = 100 } = {}) {
    const calls = { filesGet: 0, permissionsList: 0 };
    return {
      _calls: calls,
      Files: {
        get: (id, opts) => {
          calls.filesGet++;
          const item = files.get(id) || folders.get(id);
          if (!item) throw new Error('File not found: ' + id);
          const out = {};
          if (item._driveId) out.driveId = item._driveId;
          if (opts && /lastModifyingUser/.test(String(opts.fields || ''))) {
            out.lastModifyingUser = { emailAddress: item._createdBy || '' };
          }
          return out;
        },
      },
      Permissions: {
        list: (driveId, opts) => {
          calls.permissionsList++;
          if (!Object.prototype.hasOwnProperty.call(members, driveId)) throw new Error('File not found: ' + driveId);
          const all = members[driveId];
          const start = opts && opts.pageToken ? Number(opts.pageToken) : 0;
          const page = all.slice(start, start + pageSize);
          const res = { permissions: page };
          if (start + pageSize < all.length) res.nextPageToken = String(start + pageSize);
          return res;
        },
      },
    };
  }

  /*
   * スライドの要素。{shape: '字'} / {group: [要素]} / {table: [['a','b']]} /
   * {image: true}。elements を書かなければ shapes を図形として並べる
   */
  function slideElements_(d) {
    return d.elements || (d.shapes || []).map((t) => ({ shape: t }));
  }

  function slidePageElement_(e) {
    const text = (t) => ({ getText: () => ({ asString: () => t }) });
    const type = e.group ? 'GROUP' : e.table ? 'TABLE' : e.image ? 'IMAGE' : 'SHAPE';
    return {
      getPageElementType: () => type,
      asShape: () => text(e.shape),
      asGroup: () => ({ getChildren: () => e.group.map(slidePageElement_) }),
      asTable: () => ({
        getNumRows: () => e.table.length,
        getNumColumns: () => e.table[0].length,
        getCell: (r, c) => text(e.table[r][c]),
      }),
    };
  }

  /*
   * Google カレンダー (CalendarApp) を小さく模す。見るのは開いている人 (activeUser) で、実機と同じく:
   * - getCalendarById は、見られない・まだ登録していない (購読していない) カレンダーには null を返す
   *   (持ち主は作ったときに登録済み)。subscribeToCalendar は見られなければ投げる
   * - 予定を作る・印を付ける・消すのは「予定の変更」以上 (owner / writer) だけ。ほかは投げる
   * - getEvents(start, end) は少しでも重なる予定を、始まりの順に返す
   * 共有は _calShare(id, email, 'writer' | 'reader') で決める。既定のカレンダーは人ごとに1つ (id はアドレス)
   */
  const calendars = new Map();
  let calSeq = 0;
  const calCalls = { createEvent: 0, deleteEvent: 0, getEvents: 0 };
  // 予定を作るときに投げさせる (n 件目で)。{at, message} か null
  let calCreateFail = null;
  // 予定を消すときに投げさせる (predicate(ev) が true のもの)
  let calDeleteFail = null;

  function calRaw(id, name, owner) {
    const c = { _id: id, _name: name, _owner: owner, _access: new Map([[owner, 'owner']]),
      _subscribed: new Set([owner]), _events: [], _deleted: false };
    calendars.set(id, c);
    return c;
  }
  function calRole(c) { return c._access.get(activeUser) || ''; }
  function calCanWrite(c) { const r = calRole(c); return r === 'owner' || r === 'writer'; }
  function calDeny() { throw new Error('Action not allowed'); }
  function calEventView(c, ev) {
    const view = {
      _raw: ev,
      getId: () => ev.id,
      getTitle: () => ev.title,
      getDescription: () => ev.description,
      getStartTime: () => new Date(ev.start),
      getEndTime: () => new Date(ev.end),
      isAllDayEvent: () => !!ev.allDay,
      getMyStatus: () => (ev.status && ev.status[activeUser]) || 'OWNER',
      getDateCreated: () => new Date(ev.created),
      // 実機と同じく、印を付けても変わる (作った直後なので作った時刻とほぼ同じ)
      getLastUpdated: () => new Date(ev.updated),
      getGuestList: () => (ev.guests || []).map((g) => ({ getEmail: () => g })),
      getGuestByEmail: (e) => ((ev.guests || []).indexOf(e) >= 0 ? { getEmail: () => e } : null),
      getTransparency: () => ev.transparency || 'OPAQUE',
      getTag: (k) => (Object.prototype.hasOwnProperty.call(ev.tags, k) ? ev.tags[k] : null),
      setTag: (k, v) => { if (!calCanWrite(c)) calDeny(); ev.tags[k] = String(v); ev.updated = Date.now(); return view; },
      deleteEvent: () => {
        if (!calCanWrite(c)) calDeny();
        if (calDeleteFail && calDeleteFail(ev)) throw new Error('Service invoked too many times');
        calCalls.deleteEvent++;
        c._events = c._events.filter((x) => x !== ev);
      },
    };
    return view;
  }
  function calView(c) {
    return {
      getId: () => c._id,
      getName: () => c._name,
      isOwnedByMe: () => c._owner === activeUser,
      getEvents: (start, end) => {
        calCalls.getEvents++;
        const s = new Date(start).getTime();
        const e = new Date(end).getTime();
        return c._events.filter((ev) => ev.start < e && ev.end > s)
          .sort((a, b) => a.start - b.start).map((ev) => calEventView(c, ev));
      },
      createEvent: (title, start, end, opts) => {
        if (!calCanWrite(c)) calDeny();
        calCalls.createEvent++;
        if (calCreateFail && calCalls.createEvent >= calCreateFail.at) throw new Error(calCreateFail.message);
        const ev = { id: 'ev-' + (++calSeq), title: String(title), start: new Date(start).getTime(),
          end: new Date(end).getTime(), description: String((opts && opts.description) || ''), tags: {},
          createdBy: activeUser, created: Date.now(), updated: Date.now() };
        c._events.push(ev);
        return calEventView(c, ev);
      },
      deleteCalendar: () => {
        if (c._owner !== activeUser) calDeny();
        c._deleted = true;
        calendars.delete(c._id);
      },
    };
  }
  function calDefault(email) {
    return calendars.get(email) || calRaw(email, email, email);
  }
  const CalendarApp = {
    GuestStatus: { OWNER: 'OWNER', YES: 'YES', NO: 'NO', MAYBE: 'MAYBE', INVITED: 'INVITED' },
    EventTransparency: { OPAQUE: 'OPAQUE', TRANSPARENT: 'TRANSPARENT' },
    createCalendar: (name) => calView(calRaw('cal' + (++calSeq) + '@group.calendar.google.com', String(name), activeUser)),
    getCalendarById: (id) => {
      const c = calendars.get(String(id));
      if (!c || !calRole(c) || !c._subscribed.has(activeUser)) return null;
      return calView(c);
    },
    subscribeToCalendar: (id) => {
      const c = calendars.get(String(id));
      if (!c || !calRole(c)) throw new Error('Calendar not found or not accessible: ' + id);
      c._subscribed.add(activeUser);
      return calView(c);
    },
    getDefaultCalendar: () => calView(calDefault(activeUser)),
  };

  const kitFiles = new Map();

  const HtmlService = {
    createHtmlOutputFromFile: (name) => ({
      getContent: () => {
        if (!kitFiles.has(name)) throw new Error('ファイルがありません: ' + name);
        return kitFiles.get(name);
      },
    }),
    // include() と最初からいるキャラの絵 (oshiDefaultPictures_) が使う。そのままの字を返す (本物は HTML として読み直さない)。
    // _setKitFile で置いたものが先。無ければ src/<name>.html を実ファイルから読む
    createTemplateFromFile: (name) => ({
      getRawContent: () => {
        if (kitFiles.has(name)) return kitFiles.get(name);
        const file = srcHtmlPath(name);
        if (!file) throw new Error('ファイルがありません: ' + name);
        return fs.readFileSync(file, 'utf8');
      },
    }),
  };

  return {
    console,
    ScriptApp,
    HtmlService,
    /** スクリプトの置き場を決める。渡さなければ「分からない」状態 */
    _denyTrash: (on) => { trashDenied = !!on; },
    /** 品物ごとに断る。predicate(item) が true のものだけ。null で解除 */
    _denyTrashFor: (predicate) => { trashPredicate = predicate || null; },
    _denySharing: (on) => { sharingDenied = !!on; },
    _placeScript: (folder) => {
      const f = makeFile('スクリプト', '', folder.getId(), 'application/vnd.google-apps.script');
      scriptId = f.getId();
      return f;
    },
    _setKitFile: (name, text) => { kitFiles.set(name, text); },
    CalendarApp,
    /** カレンダーを人に共有する ('writer' = 予定の変更 / 'reader' = 見るだけ / '' = 外す) */
    _calShare: (id, email, role) => {
      const c = calendars.get(String(id));
      if (!c) throw new Error('カレンダーがありません: ' + id);
      if (role) c._access.set(email, role);
      else c._access.delete(email);
    },
    /** その人の既定のカレンダーに予定を足す (ほかの会議など)。{start, end, allDay, declined, title} */
    _calAddBusy: (email, ev) => {
      const c = calDefault(email);
      const raw = { id: 'ev-' + (++calSeq), title: ev.title || '会議', start: new Date(ev.start).getTime(),
        end: new Date(ev.end).getTime(), description: '', tags: {}, allDay: !!ev.allDay,
        status: ev.declined ? { [email]: 'NO' } : {}, createdBy: email, created: Date.now(), updated: Date.now(),
        transparency: ev.free ? 'TRANSPARENT' : 'OPAQUE' };
      c._events.push(raw);
      return raw;
    },
    /** カレンダーの予定の生の中身 (id を渡さなければ全部のカレンダー) */
    _calEvents: (id) => (id ? ((calendars.get(String(id)) || {})._events || [])
      : [...calendars.values()].flatMap((c) => c._events)),
    _calExists: (id) => calendars.has(String(id)),
    /** 共有カレンダーに、人の入れた予定を足す ({start, end, title, guests, tags, free, description}) */
    _calAddTo: (id, ev) => {
      const c = calendars.get(String(id));
      const raw = { id: 'ev-' + (++calSeq), title: ev.title || '会議', start: new Date(ev.start).getTime(),
        end: new Date(ev.end).getTime(), description: ev.description || '', tags: Object.assign({}, ev.tags || {}),
        guests: ev.guests || [], createdBy: '', created: Date.now(), updated: Date.now(),
        transparency: ev.free ? 'TRANSPARENT' : 'OPAQUE' };
      c._events.push(raw);
      return raw;
    },
    /** 人が予定を直したことにする (動かした・ゲストを足した) */
    _calEdit: (raw, { moved, guests } = {}) => {
      if (moved) raw.updated = raw.created + 5 * 60000;
      if (guests) raw.guests = guests;
    },
    _calFailCreate: (at, message) => { calCreateFail = at ? { at, message } : null; },
    _calFailDelete: (predicate) => { calDeleteFail = predicate || null; },
    _calCalls: calCalls,
    _makeTasks: makeTasks,
    _makeDrive: makeDrive,
    DriveApp,
    SpreadsheetApp,
    PropertiesService,
    Utilities,
    MimeType: {
      GOOGLE_DOCS: DOC_MIME,
      GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
      GOOGLE_SLIDES: 'application/vnd.google-apps.presentation',
      PLAIN_TEXT: 'text/plain',
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => activeUser }),
      getEffectiveUser: () => ({ getEmail: () => effectiveUser }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    Logger: { log: () => {} },
    SlidesApp: {
      PageElementType: { SHAPE: 'SHAPE', GROUP: 'GROUP', TABLE: 'TABLE', IMAGE: 'IMAGE' },
      openById: (id) => {
        const pres = presentations.get(id);
        if (!pres) throw new Error('プレゼンテーションが見つかりません: ' + id);
        return pres;
      },
    },
    GmailApp: {
      sendEmail: (to, subject, body) => { sentMails.push({ to, subject, body }); },
    },

    // テストから使う操作
    _docs: docs,
    _createDoc: (name, html, folderId) => {
      const f = makeFile(name, '', folderId, DOC_MIME);
      docs.set(f.getId(), html);
      return f.getId();
    },
    _sentMails: () => sentMails,
    _createSlides: (name, slideDefs) => {
      const file = makeFile(name, '', rootFolder.getId(),
        'application/vnd.google-apps.presentation');
      presentations.set(file.getId(), {
        getSlides: () => slideDefs.map((d) => ({
          // 実機と同じく、getShapes はいちばん上の図形だけを返す。グループの
          // 中と表は getPageElements からしか辿れない
          getShapes: () => slideElements_(d)
            .filter((e) => e.shape !== undefined)
            .map((e) => ({ getText: () => ({ asString: () => e.shape }) })),
          getPageElements: () => slideElements_(d).map(slidePageElement_),
          getNotesPage: () => ({
            getSpeakerNotesShape: () => (d.notes
              ? { getText: () => ({ asString: () => d.notes }) }
              : null),
          }),
        })),
      });
      return file.getId();
    },
    _parseLikeSheets: (on) => { parseLikeSheets = !!on; },
    /** Drive から完全に消す (ゴミ箱も空にした状態)。getFileById が投げる */
    _purgeFile: (id) => { files.delete(id); },
    _setUser: (email) => { activeUser = email; },
    _setEffectiveUser: (email) => { effectiveUser = email; },
    _getUser: () => activeUser,
  };
}
