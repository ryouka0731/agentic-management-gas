/**
 * 文字列のSHA-256を小文字hexで返す。
 *
 * @param {string} content
 * @returns {string} 64文字のhex文字列
 */
function sha256Hex(content) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    content,
    Utilities.Charset.UTF_8
  );
  return bytesToHex(bytes);
}

/**
 * Blobの内容のSHA-256を小文字hexで返す。画像のコンテンツアドレッシングに使う。
 *
 * @param {GoogleAppsScript.Base.Blob} blob
 * @returns {string} 64文字のhex文字列
 */
function sha256HexBytes(blob) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    blob.getBytes()
  );
  return bytesToHex(bytes);
}
