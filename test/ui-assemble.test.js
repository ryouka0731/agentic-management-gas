import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  ROOT, WIKI, APP, APP_PARTS, APP_TEMPLATE, PAGE_WITHOUT_APP, includesIn,
} from './ui-source.js';

/*
 * 画面の JS は1つの (function () { … })() を場所ごとのファイルに分けて置き、
 * wiki.html の <script> の中で include を並べてつないでいる。
 *
 * テストは ui-source.js がつないだもの (APP) を走らせる。それが本番の
 * テンプレートが出すものと違えば、テストは本番と別のものを見ていることになる。
 * ここでは ui-source.js とは別の道 (テンプレートを JS に組んで、Main.gs の
 * include() をそのまま呼ぶ) で wiki.html を評価し、同じ字になるかを見る。
 */

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * GAS の HtmlTemplate の評価を写す。<?!= 式 ?> は式の値をそのまま、
 * <?= 式 ?> は逃がして、<? 文 ?> は文として走らせ、それ以外の字はそのまま出す。
 */
function evaluateTemplate(html, globals) {
  const re = /<\?(!=|=)?([\s\S]*?)\?>/g;
  let code = 'var __out = "";\n';
  let last = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    code += '__out += ' + JSON.stringify(html.substring(last, m.index)) + ';\n';
    if (m[1] === '!=') code += '__out += String(' + m[2] + ');\n';
    else if (m[1] === '=') code += '__out += __escape(String(' + m[2] + '));\n';
    else code += m[2] + '\n';
    last = re.lastIndex;
  }
  code += '__out += ' + JSON.stringify(html.substring(last)) + ';\n__out;';
  const ctx = vm.createContext(Object.assign({
    __escape: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  }, globals));
  return vm.runInContext(code, ctx);
}

/** Main.gs の include() を、本物のファイルを返す HtmlService の上で動かす */
function realInclude() {
  const ctx = vm.createContext({
    HtmlService: {
      createHtmlOutputFromFile: (name) => ({
        getContent: () => read('src/' + name + '.html'),
      }),
    },
  });
  vm.runInContext(read('src/Main.gs'), ctx);
  return ctx.include;
}

describe('画面の JS のつなぎ方', () => {
  const page = evaluateTemplate(WIKI, { include: realInclude() });

  it('テストが走らせる JS は、本番のテンプレートが <script> の中に出すものと同じ', () => {
    const at = page.indexOf(APP);
    expect(at).toBeGreaterThan(0);
    expect(page.substring(at - '<script>'.length, at)).toBe('<script>');
    expect(page.substring(at + APP.length, at + APP.length + '</script>'.length))
      .toBe('</script>');
  });

  it('jsdom に組む本文は、本番のページから画面の JS を抜いたもの', () => {
    expect(page.replace('<script>' + APP + '</script>', '')).toBe(PAGE_WITHOUT_APP);
  });

  it('src/ui の js-*.html はすべて、ちょうど1回つながれている', () => {
    // 足したのに wiki.html に並べ忘れると、本番にもテストにも入らず黙って消える
    const files = fs.readdirSync(path.join(ROOT, 'src/ui'))
      .filter((f) => /^js-.*\.html$/.test(f))
      .map((f) => 'ui/' + f.replace(/\.html$/, ''));
    expect(files.length).toBeGreaterThan(0);
    files.forEach((name) => {
      expect(APP_PARTS.filter((p) => p === name), name).toHaveLength(1);
    });
    // つないでいるのは app.js と js-*.html だけ。同じものを2度つながない
    expect(new Set(APP_PARTS).size).toBe(APP_PARTS.length);
    expect(APP_PARTS.slice().sort()).toEqual(['ui/app.js', ...files].sort());
  });

  it('app.js が開き、js-start が閉じる', () => {
    expect(APP_PARTS[0]).toBe('ui/app.js');
    expect(APP_PARTS[APP_PARTS.length - 1]).toBe('ui/js-start');
    expect(read('src/ui/app.js.html')).toMatch(/^\(function \(\) \{\n {2}'use strict';/);
    expect(read('src/ui/js-start.html')).toMatch(/\n\}\)\(\);\n$/);
  });

  it('画面の JS の <script> の中には include のほかに何も書かない', () => {
    // ここに字を書くと、どの部分ファイルにも無い JS が本番だけに入る
    expect(APP_TEMPLATE.replace(/<\?!=\s*include\('[^']+'\)\s*\?>/g, '').trim()).toBe('');
  });

  it('つないだものが1つの関数として読める', () => {
    // 部分ファイルの切れ目で括弧が閉じていないと、ここで落ちる
    // eslint-disable-next-line no-new-func
    expect(() => new Function(APP)).not.toThrow();
  });

  it('画面の JS は wiki.html の1か所だけでつないでいる', () => {
    expect(includesIn(WIKI).filter((n) => n === 'ui/app.js' || /^ui\/js-/.test(n)))
      .toEqual(APP_PARTS);
  });
});
