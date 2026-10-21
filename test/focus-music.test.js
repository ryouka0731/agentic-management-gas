import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 集中のしかたの「自分の曲」(src/core/FocusMusic.js)。貼られた URL は部品だけにして、埋め込みの URL は
 * 部品から組み直す。外から取ってくるただ1つの例外なので、通す形を狭く決めて、それ以外は断る。
 */

const core = loadGas('src/core/FocusMusic.js');
const parse = (u) => core.focusMusicParse_(u);
const parts = (u) => JSON.parse(JSON.stringify(parse(u).parts || null));

const VID = 'dQw4w9WgXcQ';
const LIST = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

describe('貼られた URL を読み解く', () => {
  it('YouTube の動画・ショート・再生リスト・YouTube Music・youtu.be を受ける', () => {
    expect(parts('https://www.youtube.com/watch?v=' + VID)).toEqual({ kind: 'youtube', video: VID });
    expect(parts('  https://youtube.com/watch?v=' + VID + '&t=42s  ')).toEqual({ kind: 'youtube', video: VID });
    expect(parts('https://m.youtube.com/watch?v=' + VID)).toEqual({ kind: 'youtube', video: VID });
    expect(parts('https://www.youtube.com/shorts/' + VID)).toEqual({ kind: 'youtube', video: VID });
    expect(parts('https://www.youtube.com/playlist?list=' + LIST)).toEqual({ kind: 'youtube', list: LIST });
    expect(parts('https://music.youtube.com/playlist?list=' + LIST + '&si=abc')).toEqual({ kind: 'youtube', list: LIST });
    expect(parts('https://youtu.be/' + VID + '?si=XyZ')).toEqual({ kind: 'youtube', video: VID });
    // 動画と再生リストの両方なら再生リストを流す。自動のミックス (RD…) は埋め込めないので動画
    expect(parts('https://www.youtube.com/watch?v=' + VID + '&list=' + LIST)).toEqual({ kind: 'youtube', list: LIST });
    expect(parts('https://www.youtube.com/watch?v=' + VID + '&list=RD' + VID)).toEqual({ kind: 'youtube', video: VID });
    expect(parts('HTTPS://WWW.YOUTUBE.COM/watch?v=' + VID)).toEqual({ kind: 'youtube', video: VID });
  });

  it('SoundCloud の曲とプレイリスト (sets) を受ける', () => {
    expect(parts('https://soundcloud.com/lofi-girl/snowman')).toEqual({ kind: 'soundcloud', path: 'lofi-girl/snowman' });
    expect(parts('https://soundcloud.com/lofi-girl/sets/sleep_2024/?si=1&utm_source=x'))
      .toEqual({ kind: 'soundcloud', path: 'lofi-girl/sets/sleep_2024' });
    expect(parts('https://m.soundcloud.com/a/b')).toEqual({ kind: 'soundcloud', path: 'a/b' });
  });

  it('http・ほかの場所・javascript: / data:・似た名前・番号付き・人を名乗る形は断る', () => {
    const bad = [
      'http://www.youtube.com/watch?v=' + VID,
      'https://vimeo.com/123456',
      'https://www.youtube.com.evil.com/watch?v=' + VID,
      'https://evilyoutube.com/watch?v=' + VID,
      'https://youtube.com@evil.com/watch?v=' + VID,
      'https://www.youtube.com:8443/watch?v=' + VID,
      'https://soundcloud.com.evil.com/a/b',
      'https://w.soundcloud.com/player/?url=x',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//www.youtube.com/watch?v=' + VID,
      'www.youtube.com/watch?v=' + VID,
      '',
      '   ',
      null,
      42,
      { kind: 'youtube', video: VID },
    ];
    bad.forEach((u) => {
      const got = parse(u);
      expect(got.ok, String(u)).toBe(false);
      expect(got.error, String(u)).toBeTruthy();
      expect(got.parts, String(u)).toBe(undefined);
    });
  });

  it('id に使えない字・長さ違い・混ぜ込みは断る', () => {
    const bad = [
      'https://www.youtube.com/watch?v=' + VID.slice(0, 10),
      'https://www.youtube.com/watch?v=' + VID + 'x',
      'https://www.youtube.com/watch?v=abc%26autoplay%3D1',
      'https://www.youtube.com/watch?v=dQw4w9WgX%22>',
      'https://www.youtube.com/watch?v=' + VID + '&v=aaaaaaaaaaa',
      'https://www.youtube.com/playlist?list=PL%3Cscript%3E',
      'https://www.youtube.com/playlist?list=short',
      'https://www.youtube.com/playlist',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/channel/UCabc',
      'https://youtu.be/',
      'https://youtu.be/' + VID + '/x',
      'https://www.youtube.com/watch?v=%E0%A4%A',
      'https://soundcloud.com/Lofi/Snowman',
      'https://soundcloud.com/a/b/c',
      'https://soundcloud.com/a',
      'https://soundcloud.com/a/sets',
      'https://soundcloud.com/a/likes',
      'https://soundcloud.com/discover/x',
      'https://soundcloud.com/a/..',
      'https://soundcloud.com/a/b%2Fc',
      'https://www.youtube.com/watch?v=' + VID + ' onload=x',
    ];
    bad.forEach((u) => expect(parse(u).ok, u).toBe(false));
  });

  it('ほかの欄 (autoplay など) は混ぜ込んでも捨てられ、組み直した URL に出ない', () => {
    const p = parse('https://www.youtube.com/watch?v=' + VID + '&autoplay=1&mute=1&origin=https://evil.com').parts;
    expect(core.focusMusicEmbedUrl_(p)).toBe('https://www.youtube-nocookie.com/embed/' + VID + '?rel=0&modestbranding=1');
  });

  it('断りの字に Git の言葉が混ざらない', () => {
    const urls = ['', 'http://x', 'https://vimeo.com/1', 'https://www.youtube.com/watch?v=bad',
      'https://www.youtube.com/playlist', 'https://soundcloud.com/a', 'https://soundcloud.com/A/b', 'x'.repeat(600)];
    urls.forEach((u) => {
      const e = parse(u).error;
      expect(e).toBeTruthy();
      expect(e).not.toMatch(/PR|マージ|コミット|ブランチ|プルリクエスト|Issue|commit|merge|branch/i);
    });
  });
});

describe('埋め込みの URL を部品から組む', () => {
  it('決めた形のとおりの字になる', () => {
    expect(core.focusMusicEmbedUrl_({ kind: 'youtube', video: VID }))
      .toBe('https://www.youtube-nocookie.com/embed/' + VID + '?rel=0&modestbranding=1');
    expect(core.focusMusicEmbedUrl_({ kind: 'youtube', list: LIST }))
      .toBe('https://www.youtube-nocookie.com/embed/videoseries?list=' + LIST + '&rel=0');
    expect(core.focusMusicEmbedUrl_({ kind: 'soundcloud', path: 'lofi-girl/sets/sleep' }))
      .toBe('https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Flofi-girl%2Fsets%2Fsleep' +
        '&auto_play=false&visual=false&hide_related=true');
    expect(core.focusMusicLinkOf_({ kind: 'youtube', list: LIST })).toBe('https://www.youtube.com/playlist?list=' + LIST);
    expect(core.focusMusicLinkOf_({ kind: 'soundcloud', path: 'a/b' })).toBe('https://soundcloud.com/a/b');
  });

  it('部品が崩れていれば組まない (台帳は人が手で書き換えうる)', () => {
    const bad = [null, '', 'https://x', [], {}, { kind: 'youtube' }, { kind: 'youtube', video: 'x"><script>' },
      { kind: 'youtube', video: VID, list: LIST }, { kind: 'youtube', video: VID, extra: 1 },
      { kind: 'soundcloud', path: '../x' }, { kind: 'soundcloud', path: 'a/b/c' }, { kind: 'soundcloud', path: 'a' },
      { kind: 'vimeo', video: VID }, { kind: 'soundcloud', path: 'a/B' }];
    bad.forEach((p) => {
      expect(core.focusMusicPartsValid_(p), JSON.stringify(p)).toBe(false);
      expect(core.focusMusicEmbedUrl_(p)).toBe('');
      expect(core.focusMusicLinkOf_(p)).toBe('');
    });
  });
});

describe('設定 (focus.music / focus.musicUrl)', () => {
  function setup() {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    return { ctx, fake };
  }
  const mine = (fake) => JSON.parse(fake.PropertiesService.getScriptProperties().getProperty(
    'MYPREF:' + 'tester@example.com') || '{}');

  it('既定は使わない・リンク無し。画面に部品は渡らない', () => {
    const { ctx } = setup();
    const res = ctx.apiPrefs();
    expect(res.effective.focus.music).toBe('off');
    expect(res.effective.focus.musicParts).toBe(null);
    const item = res.items.filter((p) => p.key === 'focus.musicUrl')[0];
    expect(item.scope).toBe('me');
    expect(item.value).toBe('');
  });

  it('URL を受けて、覚えるのは部品だけ。見せるのは部品から組み直したリンク', () => {
    const { ctx, fake } = setup();
    ctx.apiPrefSet('focus.music', 'own');
    const res = ctx.apiPrefSet('focus.musicUrl', ' https://music.youtube.com/playlist?list=' + LIST + '&si=tracking ');
    expect(mine(fake)['focus.musicUrl']).toEqual({ kind: 'youtube', list: LIST });
    expect(JSON.stringify(mine(fake))).not.toContain('tracking');
    expect(res.effective.focus).toMatchObject({ music: 'own', musicParts: { kind: 'youtube', list: LIST } });
    expect(res.items.filter((p) => p.key === 'focus.musicUrl')[0].value)
      .toBe('https://www.youtube.com/playlist?list=' + LIST);
    // 空にすると既定 (無し) に戻る
    ctx.apiPrefSet('focus.musicUrl', '');
    expect(mine(fake)['focus.musicUrl']).toBe(undefined);
  });

  it('使えない URL は平らな日本語で断り、何も書かない', () => {
    const { ctx, fake } = setup();
    ['http://www.youtube.com/watch?v=' + VID, 'https://youtube.com.evil.com/watch?v=' + VID, 'javascript:alert(1)',
      'https://vimeo.com/1'].forEach((u) => {
      let msg = '';
      try { ctx.apiPrefSet('focus.musicUrl', u); } catch (e) { msg = e.message; }
      expect(msg, u).toMatch(/YouTube|SoundCloud|https/);
      expect(msg).not.toMatch(/PR|マージ|コミット|ブランチ|Issue/);
    });
    // 部品の形をそのまま送っても、崩れていれば断る
    expect(() => ctx.apiPrefSet('focus.musicUrl', { kind: 'youtube', video: 'x"><' })).toThrow(/入れられない値/);
    expect(mine(fake)['focus.musicUrl']).toBe(undefined);
  });

  it('台帳に手で書いた崩れた部品は、読むときに既定へ倒す', () => {
    const { ctx, fake } = setup();
    fake.PropertiesService.getScriptProperties().setProperty('MYPREF:tester@example.com',
      JSON.stringify({ 'focus.music': 'own', 'focus.musicUrl': 'https://evil.example/x' }));
    const res = ctx.apiPrefs();
    expect(res.effective.focus.musicParts).toBe(null);
    expect(res.items.filter((p) => p.key === 'focus.musicUrl')[0].value).toBe('');
  });
});
