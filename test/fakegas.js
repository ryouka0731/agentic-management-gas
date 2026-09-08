import crypto from 'node:crypto';

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
      getId: () => id,
      getName: () => f._name,
      setName: (n) => { f._name = n; return f; },
      getMimeType: () => f._mime,
      getUrl: () => 'https://example.invalid/d/' + id,
      getLastUpdated: () => new Date(),
      setTrashed: (v) => { f._trashed = v !== false; return f; },
      isTrashed: () => f._trashed,
      getBlob: () => ({
        getDataAsString: () => f._content,
        // GAS の Blob.getBytes() は符号付き byte を返す
        getBytes: () => Array.from(Buffer.from(String(f._content), 'utf8'))
          .map((b) => (b > 127 ? b - 256 : b)),
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
      getId: () => id,
      getName: () => fo._name,
      setTrashed: (v) => { fo._trashed = v !== false; return fo; },
      createFolder: (n) => makeFolder(n, id),
      createFile: (a, b, c) => makeFile(a, b, id, c),
      getFiles: () => {
        const hits = [];
        for (const f of files.values()) {
          if (f._parent === id && !f._trashed) hits.push(f);
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
      addFile: (f) => { f._parent = id; },
      removeFile: () => {},
    };
    folders.set(id, fo);
    return fo;
  }

  const rootFolder = makeFolder('マイドライブ', null);

  const DriveApp = {
    createFolder: (n) => makeFolder(n, rootFolder.getId()),
    getRootFolder: () => rootFolder,
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

  // --- スプレッドシート (メタDB) ---
  function makeSheet(name) {
    const rows = [];
    const sheet = {
      _rows: rows,
      getName: () => name,
      getLastRow: () => rows.length,
      setFrozenRows: () => sheet,
      appendRow: (vals) => { rows.push(vals.slice()); return sheet; },
      deleteRow: (r) => { rows.splice(r - 1, 1); return sheet; },
      getDataRange: () => ({
        getDisplayValues: () => rows.map((r) => r.map(
          (v) => (v === undefined || v === null ? '' : String(v))
        )),
        getFormulas: () => rows.map((r) => r.map(
          (v) => (String(v === undefined ? '' : v).indexOf('=') === 0 ? String(v) : '')
        )),
      }),
      clear: () => { rows.length = 0; return sheet; },
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
              rows[r][col - 1 + j] = vals[i][j];
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

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
    }),
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
    formatDate: (d, _tz, _fmt) => String(d.getTime()),
  };

  return {
    console,
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
          getShapes: () => (d.shapes || []).map((t) => ({
            getText: () => ({ asString: () => t }),
          })),
          getNotesPage: () => ({
            getSpeakerNotesShape: () => (d.notes
              ? { getText: () => ({ asString: () => d.notes }) }
              : null),
          }),
        })),
      });
      return file.getId();
    },
    _setUser: (email) => { activeUser = email; },
    _setEffectiveUser: (email) => { effectiveUser = email; },
    _getUser: () => activeUser,
  };
}
