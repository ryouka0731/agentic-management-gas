/**
 * CacheServiceの1キーあたりの安全なサイズ上限(バイト)。
 * 公称100KBだが、UTF-8マルチバイトとキー自体のオーバーヘッドを考慮して
 * 余裕を持たせる。
 *
 * @returns {number}
 */
function CACHE_CHUNK_SIZE() {
  return 80 * 1024;
}

/**
 * キャッシュのTTL(秒)。CacheServiceの上限は6時間。
 *
 * @returns {number}
 */
function CACHE_TTL_SEC() {
  return 6 * 60 * 60;
}

/**
 * ファイルの更新時刻を含むキャッシュキーのプレフィックスを作る。
 *
 * @param {string} fileId
 * @param {number} lastUpdatedMs
 * @returns {string}
 */
function liveCacheKey_(fileId, lastUpdatedMs) {
  return 'live:' + fileId + ':' + lastUpdatedMs;
}

/**
 * チャンク分割してキャッシュに保存する。
 *
 * @param {string} prefix
 * @param {string} html
 */
function liveCachePut_(prefix, html) {
  var cache = CacheService.getScriptCache();
  var size = CACHE_CHUNK_SIZE();
  var chunks = [];
  for (var i = 0; i < html.length; i += size) {
    chunks.push(html.substring(i, i + size));
  }

  var payload = {};
  payload[prefix + ':meta'] = String(chunks.length);
  for (var c = 0; c < chunks.length; c++) {
    payload[prefix + ':' + c] = chunks[c];
  }
  cache.putAll(payload, CACHE_TTL_SEC());
}

/**
 * チャンク分割されたキャッシュを復元する。1つでも欠けていれば null を返す。
 *
 * @param {string} prefix
 * @returns {string|null}
 */
function liveCacheGet_(prefix) {
  var cache = CacheService.getScriptCache();
  var meta = cache.get(prefix + ':meta');
  if (!meta) return null;

  var count = Number(meta);
  if (!(count >= 0)) return null;

  var keys = [];
  for (var c = 0; c < count; c++) keys.push(prefix + ':' + c);

  var got = cache.getAll(keys);
  var out = '';
  for (var i = 0; i < keys.length; i++) {
    var part = got[keys[i]];
    if (part === undefined || part === null) return null;  // 部分的な追い出し
    out += part;
  }
  return out;
}

/**
 * ファイル種別に応じたレンダラを呼ぶ。
 *
 * Phase 1 では doc のみ対応。Phase 3 で sheet / slide を追加する。
 *
 * @param {string} fileId
 * @param {string} type 'doc' | 'sheet' | 'slide'
 * @returns {string}
 */
function renderByType_(fileId, type) {
  if (type === 'doc') return renderDoc(fileId);
  if (type === 'sheet') return renderSheet(fileId);
  if (type === 'slide') return renderSlides(fileId);
  throw new Error('このファイル種別はまだ対応していません: ' + type);
}

/**
 * ファイルの現在の内容を正規化HTMLで返す (ライブ層)。
 *
 * キャッシュキーにファイルの更新時刻を含めるため、編集されると
 * 自動的に再レンダリングされる。ポーリングも同期ジョブも不要。
 *
 * @param {string} fileId
 * @returns {string}
 */
function liveHtml(fileId) {
  var row = dbFindOne('files', 'fileId', fileId);
  if (!row) throw new Error('管理対象に登録されていません: ' + fileId);

  var lastUpdatedMs = DriveApp.getFileById(fileId).getLastUpdated().getTime();
  var prefix = liveCacheKey_(fileId, lastUpdatedMs);

  var cached = liveCacheGet_(prefix);
  if (cached !== null) return cached;

  var html = renderByType_(fileId, row.type);
  liveCachePut_(prefix, html);
  return html;
}

/**
 * 指定ファイルのキャッシュを明示的に無効化する。
 *
 * 通常は更新時刻ベースで自動無効化されるため不要だが、
 * レンダラを変更した直後などに使う。
 *
 * @param {string} fileId
 */
function liveCacheInvalidate(fileId) {
  var lastUpdatedMs = DriveApp.getFileById(fileId).getLastUpdated().getTime();
  var prefix = liveCacheKey_(fileId, lastUpdatedMs);
  var cache = CacheService.getScriptCache();
  var meta = cache.get(prefix + ':meta');
  if (!meta) return;

  var keys = [prefix + ':meta'];
  for (var c = 0; c < Number(meta); c++) keys.push(prefix + ':' + c);
  cache.removeAll(keys);
}
