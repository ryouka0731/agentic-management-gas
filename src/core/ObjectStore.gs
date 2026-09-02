/**
 * SHAからobjectsフォルダ内のファイル名を解決する。
 *
 * PoCではフラットに <sha>.<ext> とするが、この関数にパス解決を
 * 閉じ込めておくことで、将来 Git 同様の 2文字シャーディング
 * (objects/ab/cdef...) へ差し替えられる (scaling doc §2.1)。
 *
 * @param {string} sha
 * @param {string} [ext] 拡張子。省略時は 'html'
 * @returns {string} ファイル名
 */
function objectPath_(sha, ext) {
  if (!/^[0-9a-f]{64}$/.test(String(sha || ''))) {
    throw new Error('SHAの形式が不正です: ' + sha);
  }
  var e = ext || 'html';
  if (!/^[a-z0-9]{1,8}$/.test(e)) {
    throw new Error('拡張子が不正です: ' + ext);
  }
  return sha + '.' + e;
}

/**
 * objectsフォルダを返す。
 *
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function objectsFolder_() {
  return DriveApp.getFolderById(repoConfig().objectsId);
}

/**
 * テキストblobを保存する。すでに同じSHAが存在すれば何もしない。
 *
 * コンテンツアドレッシングにより、同一内容のblobは1つしか保存されない。
 *
 * @param {string} sha
 * @param {string} content
 */
function objectPut(sha, content) {
  var name = objectPath_(sha, 'html');
  var folder = objectsFolder_();
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(name, content, MimeType.PLAIN_TEXT);
}

/**
 * バイナリblob (画像など) を保存する。すでに同じSHAが存在すれば何もしない。
 *
 * 重要: 画像をテキストとして保存してはならない。getDataAsString() で
 * 文字列化するとUTF-8への再エンコードでバイト列が破壊される。
 * Blobのまま createFile に渡すこと。
 *
 * @param {string} sha
 * @param {GoogleAppsScript.Base.Blob} blob
 * @param {string} ext 拡張子 (例: 'png')
 */
function objectPutBlob(sha, blob, ext) {
  var name = objectPath_(sha, ext);
  var folder = objectsFolder_();
  if (folder.getFilesByName(name).hasNext()) return;
  folder.createFile(blob.copyBlob().setName(name));
}

/**
 * テキストblobを読む。存在しなければ null。
 *
 * @param {string} sha
 * @returns {string|null}
 */
function objectGet(sha) {
  var it = objectsFolder_().getFilesByName(objectPath_(sha, 'html'));
  return it.hasNext() ? it.next().getBlob().getDataAsString('UTF-8') : null;
}

/**
 * blobの存在を確認する。
 *
 * @param {string} sha
 * @param {string} [ext] 拡張子。省略時は 'html'
 * @returns {boolean}
 */
function objectExists(sha, ext) {
  return objectsFolder_().getFilesByName(objectPath_(sha, ext)).hasNext();
}
