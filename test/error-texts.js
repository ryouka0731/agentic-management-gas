import fs from 'node:fs';

/*
 * src の断り文 (new Error の字) と変更の記録の文 (commitFile の3つ目) を取り出す。
 * test/naming.test.js (Git の言葉を人に見せない) と test/errorkind.test.js (断りの型) が使う。
 */

/**
 * 人に届く字を取り出す。断り文 (new Error) は画面の帯と手元の結果にそのまま出る。
 * 変更の記録の文 (commitFile の3つ目) は履歴に残り、人が読む。
 *
 * コメントと、エディタで持ち主だけが動かす debug* / setup* の関数は除く。字どうしを
 * 足した形はつなげて1つにする。'main' だけの字は比べる相手 (版の名前) であって、
 * 人に見せる字ではない。
 *
 * **見られないもの:** 断り文を一度変数に入れてから new Error(変数) に渡す形は、
 * 変数の中身までは追わない。代わりに msg / message / reason という名前の変数に
 * 字を入れる形を拾う (今は1つも無い)。ほかの名前の変数で組むと、ここをすり抜ける。
 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

export function withoutEditorOnly(src) {
  return src.split(/\n(?=function )/)
    .filter((p) => !/^\n?function (debug|setup)/.test(p)).join('\n');
}

/** start の位置から、括弧が閉じるまでの字の部分をつなげて返す */
export function literalsUntilClose(s, start, stopAtComma) {
  let i = start;
  let depth = 1;
  const parts = [];
  while (i < s.length && depth) {
    const c = s[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      let lit = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\') { lit += s[j + 1]; j += 2; continue; }
        lit += s[j];
        j++;
      }
      if (lit !== 'main') parts.push(lit);
      i = j + 1;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (stopAtComma && depth === 1 && c === ',') { parts.push('\u0000'); }
    if (stopAtComma && depth === 1 && c === ';') break;
    i++;
  }
  return parts.join('');
}

export function errorTexts(src) {
  const s = withoutEditorOnly(stripComments(src));
  const out = [];
  for (const m of s.matchAll(/new Error\(/g)) {
    out.push(literalsUntilClose(s, m.index + m[0].length));
  }
  for (const m of s.matchAll(/\b(?:var|let|const)\s+(?:msg|message|reason)\s*=/g)) {
    out.push(literalsUntilClose(s, m.index + m[0].length, true).split('\u0000')[0]);
  }
  return out;
}

/** commitFile(id, 版, 文, ...) の「文」に当たる字 */
export function commitMessages(src) {
  const s = withoutEditorOnly(stripComments(src));
  const out = [];
  for (const m of s.matchAll(/(?<![\w.])commitFile\(/g)) {
    const args = literalsUntilClose(s, m.index + m[0].length, true).split('\u0000');
    if (args.length > 2) out.push(args[2]);
  }
  return out;
}

/** 人に届く字を持つファイル。署名の記録は字を持つだけ (配る道具の中身は src/ui/kit-files.html なので元から入らない) */
export function serverSources() {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = dir + '/' + ent.name;
      if (ent.isDirectory()) walk(p);
      else if (/\.gs$/.test(ent.name) || (/^src\/core\/[^/]+\.js$/.test(p))) out.push(p);
    }
  })('src');
  return out.filter((p) => !/\/KitSigning\.gs$/.test(p)).sort();
}

