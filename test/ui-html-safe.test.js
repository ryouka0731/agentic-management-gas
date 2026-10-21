import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WIKI, includesIn } from './ui-source.js';

/*
 * 画面の JS (app.js / js-*.html) は、GAS の HtmlService が「HTML のファイル」として読んでから <script> の中に
 * つながれる。HtmlService は読むときに HTML として壊れていないかを検査し、壊れていると「形式が正しくない
 * HTML コンテンツ」で画面全体が開けなくなる。
 *
 * 2026-10-22 に Google 側の検査が厳しくなり、前日まで通っていた字で画面が開けなくなった (@188 → @189 で直した)。
 * 本番で1行ずつ確かめた結果、拒まれるのは次の2つ:
 * - タグに見える字 (`<` + 英字) の属性の値の中に `"` がある: `/<img data-sha="([^"]*)">/` の `[^"]`
 *   (属性の引用符の対応が崩れる)。`[^\x22]` と書けば同じ意味で通る
 * - タグに見える字の中に、もう1つ `<` や `?` がある: `Array<Array<string>>` / `Array<?HTMLElement>`
 *   (説明コメントの型)。`string[][]` / `(HTMLElement|null)[]` と書く
 * `Object<string, string>` や `<li>`、`/^<h([1-6])>/`、`'</' + open + '>'` は通る。
 *
 * ここでは、その2つの書き方を画面のファイルから探す。本番の検査そのものは写せないので、本番で NG / ok と
 * 分かった字で、探し方が合っていることも見る。
 */

/**
 * タグに見える字 (`<` から `>` の手前まで) の属性を HTML のとおりに読み、引用符 (`"` `'`) が囲んだ値の
 * 外に出ている (`data-sha="([^"]*)"` は値が `([^` で終わり、`]*)"` の `"` が属性の名前の位置に来る) か、
 * 引用符が閉じなければ、壊れていると見る。囲んだ値のすぐ後に空白が無い (`"...")?>`) のは本番で通るので見ない。
 *
 * @param {string} tag `<` で始まり `>` を含まない字
 * @returns {boolean}
 */
function tagAttrsBroken(tag) {
  let i = 1;
  while (i < tag.length && !/\s/.test(tag[i])) i++; // タグの名前
  while (i < tag.length) {
    while (i < tag.length && /\s/.test(tag[i])) i++;
    if (i >= tag.length) break;
    while (i < tag.length && !/[\s=]/.test(tag[i])) { // 属性の名前
      if (tag[i] === '"' || tag[i] === "'") return true;
      i++;
    }
    while (i < tag.length && /\s/.test(tag[i])) i++;
    if (tag[i] !== '=') continue;
    i++;
    while (i < tag.length && /\s/.test(tag[i])) i++;
    const q = tag[i];
    if (q === '"' || q === "'") {
      const j = tag.indexOf(q, i + 1);
      if (j < 0) return true;
      i = j + 1;
    } else {
      while (i < tag.length && !/\s/.test(tag[i])) { // 囲まない値
        if (tag[i] === '"' || tag[i] === "'") return true;
        i++;
      }
    }
  }
  return false;
}

/**
 * HtmlService に拒まれる書き方を探す。
 *
 * @param {string} text
 * @returns {Array<{line: number, text: string, why: string}>}
 */
function htmlUnsafeSpots(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const re = /<[a-zA-Z][^<>\n]*/g;
    let m;
    while ((m = re.exec(line))) {
      if (tagAttrsBroken(m[0])) out.push({ line: i + 1, text: line.trim(), why: '属性の引用符が対応しない' });
    }
    const nested = /<[a-zA-Z][^<>\n]*<[a-zA-Z?{]/.exec(line);
    if (nested) out.push({ line: i + 1, text: line.trim(), why: '山かっこの入れ子' });
    if (/<\?/.test(line)) out.push({ line: i + 1, text: line.trim(), why: '<? は雛形の印' });
  });
  return out;
}

describe('画面の JS に、HtmlService が拒む HTML の字が無い', () => {
  // 本番 (2026-10-22) で確かめた字。探し方が本番と同じ判断をすることを固定する
  it('本番で拒まれた字を見つける', () => {
    const bad = [
      'var mi = /^<img data-sha="([^"]*)" alt="([^"]*)">$/.exec(raw);',
      'var ms = /^<table data-sheet="([^"]*)">$/.exec(raw);',
      'var re = /<td(?: data-formula="[^"]*")?>([\\s\\S]*?)<\\/td>/g;',
      ' * @param {Array<Array<string>>} pairs',
      ' * @param {Array<Array<{day: string}>>} weeks',
      ' * @param {Array<?HTMLElement>} [right] 右に置くもの',
    ];
    bad.forEach((s) => expect(htmlUnsafeSpots(s).length, s).toBeGreaterThan(0));
  });

  it('本番で通った字は見つけない', () => {
    const ok = [
      ' * @param {function(Object<string,string>): void} onSubmit',
      ' * 連続する <li> を対応する ul/ol でラップする。',
      'var m = /^<li data-list="(ul|ol)" data-depth="(\\d+)">/.exec(line);',
      "if (open) { out.push('</' + open + '>'); open = null; }",
      '\'<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">\' +',
      'var mh = /^<h([1-6])>([\\s\\S]*)<\\/h\\1>$/.exec(raw);',
      'var mi = /^<img data-sha="([^\\x22]*)" alt="([^\\x22]*)">$/.exec(raw);',
      'var re = /<td(?: data-formula="[^\\x22]*")?>([\\s\\S]*?)<\\/td>/g;',
      ' * @param {string[][]} pairs',
      ' * @param {(HTMLElement|null)[]} [right]',
      'for (var i = 0; i < count && funParticles.length < FUN_MAX_PARTICLES; i++) {',
      "(m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);",
    ];
    ok.forEach((s) => expect(htmlUnsafeSpots(s), s).toEqual([]));
  });

  it('wiki.html がつなぐ全部のファイルに無い', () => {
    const files = includesIn(WIKI);
    expect(files.length).toBeGreaterThan(20);
    const found = [];
    files.forEach((rel) => {
      const text = fs.readFileSync(path.join(ROOT, 'src', rel + '.html'), 'utf8');
      htmlUnsafeSpots(text).forEach((s) => found.push(rel + ':' + s.line + ' (' + s.why + ') ' + s.text.slice(0, 80)));
    });
    expect(found).toEqual([]);
  });
});
