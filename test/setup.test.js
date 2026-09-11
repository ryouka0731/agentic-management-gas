// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

/**
 * 覚え書きの置き場が、本物でも補ったものでも同じように振る舞うかを見る。
 *
 * Node 26 では起動時の指定が無いと window.localStorage が undefined に
 * なる。画面側は幅や見え方の覚え書きに使っているため、無いままだと
 * jsdom のテストが総崩れになる。
 */
describe('覚え書きの置き場', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('window から触れる', () => {
    expect(window.localStorage).toBeTruthy();
    expect(typeof window.localStorage.getItem).toBe('function');
  });

  it('入れたものが取れる', () => {
    window.localStorage.setItem('sidebarWidth', '320');
    expect(window.localStorage.getItem('sidebarWidth')).toBe('320');
  });

  it('入れていないものは null', () => {
    // undefined を返すと、画面側の `|| 既定値` が働かない場面が出る
    expect(window.localStorage.getItem('まだ無い')).toBe(null);
  });

  it('数でも文字として持つ', () => {
    window.localStorage.setItem('graphPaneWidth', 420);
    expect(window.localStorage.getItem('graphPaneWidth')).toBe('420');
  });

  it('1つだけ消せる', () => {
    window.localStorage.setItem('a', '1');
    window.localStorage.setItem('b', '2');
    window.localStorage.removeItem('a');

    expect(window.localStorage.getItem('a')).toBe(null);
    expect(window.localStorage.getItem('b')).toBe('2');
  });

  it('まとめて消せる', () => {
    window.localStorage.setItem('a', '1');
    window.localStorage.clear();

    expect(window.localStorage.getItem('a')).toBe(null);
  });

  it('件数と順番を数えられる', () => {
    window.localStorage.setItem('a', '1');
    window.localStorage.setItem('b', '2');

    expect(window.localStorage.length).toBe(2);
    expect(window.localStorage.key(0)).toBe('a');
    expect(window.localStorage.key(9)).toBe(null);
  });
});
