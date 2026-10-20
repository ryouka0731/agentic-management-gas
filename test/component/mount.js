import { afterEach } from 'vitest';
import { mountApp, DEFAULTS, takeUncaught } from '../dom.js';

// 画面が投げたまま誰も受け止めなかった例外があれば、そのテストを落とす
afterEach(() => {
  const errors = takeUncaught();
  if (errors.length) throw errors[0];
});

/**
 * 画面を実際に動かして確かめる (test/component/*.test.js の共通の口)。
 *
 * ui-structure.test.js はソースを文字列で検査するだけなので、描画も応答も
 * 確かめられない。null で落ちる、初期化が別の場所に紛れる、といった実際に
 * 起きた不具合はそこでは捕まらなかった。ここでは本当に走らせる。
 *
 * 以前は 1 ファイル (component.test.js) に全部入っていて、vitest が並べて
 * 走らせられなかった。画面の区画ごとにファイルを分け、組む口だけをここに置く。
 *
 * @param {Object<string, *>} [over] DEFAULTS に上書きする応答
 */
export function mount(over) {
  return mountApp(Object.assign({}, DEFAULTS, over || {}));
}
