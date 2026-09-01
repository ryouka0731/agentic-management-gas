/**
 * 符号付きバイト配列 (GASのUtilities.computeDigestが返す形式) を
 * 小文字hex文字列に変換する。
 *
 * GASは -128..127 の符号付き値を返すため、& 0xFF でマスクしてから
 * 変換する必要がある。
 *
 * @param {number[]} bytes
 * @returns {string} 小文字hex文字列
 */
function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i] & 0xFF;
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}
