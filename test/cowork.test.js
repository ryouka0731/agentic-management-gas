import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';
import { installCoworkCache } from './cowork-cache.js';

/*
 * 作業雑談部屋の本体: リンクの読み解き (src/core/CoworkLink.js) と、いる印 (src/core/Cowork.gs)。
 * 画面からの入口は test/api/cowork.test.js、画面は test/component/cowork.test.js。
 */

const link = loadGas('src/core/CoworkLink.js');
const plain = (v) => JSON.parse(JSON.stringify(v));

describe('部屋のリンクを読み解く', () => {
  it('Meet の会議・lookup・Slack のハドル・チャンネルを部品にし、部品から組み直す', () => {
    const cases = [
      ['https://meet.google.com/abc-defg-hij', { kind: 'meet', code: 'abc-defg-hij' }, 'https://meet.google.com/abc-defg-hij'],
      ['  https://meet.google.com/abc-defg-hij/  ', { kind: 'meet', code: 'abc-defg-hij' }, 'https://meet.google.com/abc-defg-hij'],
      // 写すと付いてくる ? の後ろは捨てる (組み直すので残らない)
      ['https://meet.google.com/abc-defg-hij?authuser=0', { kind: 'meet', code: 'abc-defg-hij' }, 'https://meet.google.com/abc-defg-hij'],
      ['HTTPS://MEET.GOOGLE.COM/abc-defg-hij', { kind: 'meet', code: 'abc-defg-hij' }, 'https://meet.google.com/abc-defg-hij'],
      ['https://meet.google.com/lookup/team-zatsudan', { kind: 'meet-lookup', code: 'team-zatsudan' },
        'https://meet.google.com/lookup/team-zatsudan'],
      ['https://app.slack.com/huddle/T01ABCDEF/C02GHIJKL', { kind: 'slack-huddle', team: 'T01ABCDEF', channel: 'C02GHIJKL' },
        'https://app.slack.com/huddle/T01ABCDEF/C02GHIJKL'],
      ['https://Example-Team.slack.com/archives/C02GHIJKL', { kind: 'slack-channel', workspace: 'example-team', channel: 'C02GHIJKL' },
        'https://example-team.slack.com/archives/C02GHIJKL'],
    ];
    for (const [url, parts, rebuilt] of cases) {
      const got = link.coworkLinkParse_(url);
      expect(got.ok, url).toBe(true);
      expect(plain(got.parts)).toEqual(parts);
      expect(link.coworkLinkPartsValid_(got.parts)).toBe(true);
      expect(link.coworkLinkOf_(got.parts)).toBe(rebuilt);
    }
  });

  it('似た名前・http・番号・ユーザー名・javascript: などは断る (断りは平らな日本語)', () => {
    const bad = [
      'http://meet.google.com/abc-defg-hij',
      'javascript:alert(1)',
      'https://meet.google.com.evil.com/abc-defg-hij',
      'https://evilmeet.google.com/abc-defg-hij',
      'https://meet.google.co/abc-defg-hij',
      'https://meet.google.com:443/abc-defg-hij',
      'https://user@meet.google.com/abc-defg-hij',
      'https://meet.google.com@evil.com/abc-defg-hij',
      'https://meet.google.com/abc-defg-hi',
      'https://meet.google.com/ABC-DEFG-HIJ',
      'https://meet.google.com/abc-defg-hij/x',
      'https://meet.google.com/%61bc-defg-hij',
      'https://meet.google.com/lookup/a',
      'https://app.slack.com/huddle/T01ABCDEF',
      'https://app.slack.com/huddle/X01ABCDEF/C02GHIJKL',
      'https://app.slack.com/huddle/T01ABCDEF/C02GHIJKL/x',
      'https://app.slack.com/client/T01ABCDEF/C02GHIJKL',
      'https://app.slack.com.evil.com/huddle/T01ABCDEF/C02GHIJKL',
      'https://evil.com/.slack.com/archives/C02GHIJKL',
      'https://team.slack.com.evil.com/archives/C02GHIJKL',
      'https://a.b.slack.com/archives/C02GHIJKL',
      'https://www.slack.com/archives/C02GHIJKL',
      'https://-team.slack.com/archives/C02GHIJKL',
      'https://team.slack.com/archives/C02GHIJKL/p1700000000000',
      'https://team.slack.com/archives/c02ghijkl',
      'https://slack.com/archives/C02GHIJKL',
      'https://zoom.us/j/123',
      'https://meet.google.com/abc-defg-hij x',
      '', '   ', null, 42, {},
      'https://meet.google.com/' + 'a'.repeat(400),
    ];
    for (const url of bad) {
      const got = link.coworkLinkParse_(url);
      expect(got.ok, String(url)).toBe(false);
      expect(got.parts).toBeUndefined();
      expect(got.error).toMatch(/[぀-ヿ一-鿿]/);
    }
  });

  it('崩れた部品は使えない (手で書き換えられた値)', () => {
    const bad = [null, [], 'x', { kind: 'meet' }, { kind: 'meet', code: 'abc-defg-hij', extra: 1 },
      { kind: 'meet', code: 'ABC-DEFG-HIJ' }, { kind: 'slack-channel', workspace: 'www', channel: 'C02GHIJKL' },
      { kind: 'slack-huddle', team: 'T01ABCDEF', channel: 'x' }, { kind: 'other', code: 'abc-defg-hij' }];
    for (const p of bad) {
      expect(link.coworkLinkPartsValid_(p), JSON.stringify(p)).toBe(false);
      expect(link.coworkLinkOf_(p)).toBe('');
    }
  });
});

const A = 'a@example.com';
const B = 'b@example.com';
const MEET = 'https://meet.google.com/abc-defg-hij';
const HUDDLE = 'https://app.slack.com/huddle/T01ABCDEF/C02GHIJKL';

/** オンにして部屋を2つ置いたサーバ */
function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  const clock = installCoworkCache(fake);
  ctx.apiPrefSet('cowork.enabled', true);
  ctx.memberSet(A, '', '青木');
  ctx.memberSet(B, '', '別府');
  const rooms = ctx.coworkSetRooms_([{ name: '雑談', link: MEET }, { name: 'もくもく', link: HUDDLE }]);
  return { ctx, fake, clock, rooms };
}

const at = (clock) => new Date(clock.now());

describe('いる印', () => {
  it('入ると名前が出て、2分合図が無ければ消える。合図があれば残る', () => {
    const { ctx, clock, rooms } = server();
    expect(ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock))).toBe(true);
    let view = ctx.coworkView_(B, at(clock));
    expect(view.rooms[0].people.map((p) => p.name)).toEqual(['青木']);
    expect(view.rooms[0].count).toBe(1);

    clock.advance(90 * 1000);
    ctx.coworkMark_(A, rooms[0].id, 'beat', at(clock));
    clock.advance(90 * 1000);
    view = ctx.coworkView_(B, at(clock));
    expect(view.rooms[0].count).toBe(1);

    // 最後の合図から2分を過ぎると消える
    clock.advance(31 * 1000);
    view = ctx.coworkView_(B, at(clock));
    expect(view.rooms[0].count).toBe(0);
  });

  it('入った時刻は合図で変わらない。別の部屋に入ると前の部屋から外れる。出ると消える', () => {
    const { ctx, clock, rooms } = server();
    ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock));
    const since = ctx.coworkView_(A, at(clock)).rooms[0].people[0].since;
    clock.advance(60 * 1000);
    ctx.coworkMark_(A, rooms[0].id, 'beat', at(clock));
    expect(ctx.coworkView_(A, at(clock)).rooms[0].people[0].since).toBe(since);

    ctx.coworkMark_(A, rooms[1].id, 'enter', at(clock));
    let view = ctx.coworkView_(A, at(clock));
    expect(view.rooms[0].count).toBe(0);
    expect(view.rooms[1].count).toBe(1);
    expect(view.myRoomId).toBe(rooms[1].id);
    expect(view.rooms[1].people[0].mine).toBe(true);

    ctx.coworkMark_(A, rooms[1].id, 'leave', at(clock));
    view = ctx.coworkView_(A, at(clock));
    expect(view.rooms[1].count).toBe(0);
    expect(view.myRoomId).toBe('');
  });

  it('台帳にもスクリプトプロパティにも、誰が入ったかを書かない', () => {
    const { ctx, fake, clock, rooms } = server();
    const props = JSON.stringify(fake.PropertiesService.getScriptProperties().getProperties());
    const usage = JSON.stringify(ctx.dbReadAll('usage'));
    ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock));
    expect(JSON.stringify(fake.PropertiesService.getScriptProperties().getProperties())).toBe(props);
    expect(JSON.stringify(ctx.dbReadAll('usage'))).toBe(usage);
    expect(JSON.stringify(ctx.dbReadAll('change_log'))).not.toContain(A);
    // 置き場はキャッシュだけ
    expect([...clock.store.keys()]).toEqual(['COWORK:' + rooms[0].id]);
  });

  it('1つの部屋の印はキャッシュの上限 (100KB) を超えない。合図の古い人から落とす', () => {
    const { ctx, clock, rooms } = server();
    const key = 'COWORK:' + rooms[0].id;
    // 長い名前の人をたくさん入れる (名前は40字で切る)。表示名は台帳を引かずに返す
    ctx.memberNames = (emails) => Object.fromEntries(emails.map((e) => [e, '名前' + '長'.repeat(60) + e]));
    let first = null;
    for (let i = 0; i < 1500; i++) {
      clock.advance(10);
      expect(ctx.coworkMark_('p' + i + '@example.com', rooms[0].id, 'enter', at(clock))).toBe(true);
      if (i === 0) first = 'p0@example.com';
    }
    const raw = clock.store.get(key).value;
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(90 * 1024);
    const map = JSON.parse(raw);
    expect(Object.keys(map)).not.toContain(first);
    expect(Object.keys(map)).toContain('p1499@example.com');
  }, 60000);

  it('鍵が取れなければ書かずに false を返す (投げない)', () => {
    const { ctx, fake, clock, rooms } = server();
    fake.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
    expect(ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock))).toBe(false);
    expect(clock.store.size).toBe(0);
  });

  it('キャッシュが使えなければ印は出ないが、一覧は返す', () => {
    const { ctx, fake, clock, rooms } = server();
    fake.CacheService = { getScriptCache: () => { throw new Error('使えません'); } };
    expect(ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock))).toBe(false);
    const view = ctx.coworkView_(A, at(clock));
    expect(view.rooms).toHaveLength(2);
    expect(view.available).toBe(false);
  });

  it('自分の設定で「集中中」を選んだ人だけ、集中しているあいだ添える', () => {
    const { ctx, fake, clock, rooms } = server();
    fake._setUser(A);
    ctx.apiPrefSet('focus.start', true);
    const n = ctx.apiIssueCreate('規程の見直し', '', []).number;
    ctx.focusStart_(A, n, 25, '', '', at(clock));
    ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock));
    expect(ctx.coworkView_(B, at(clock)).rooms[0].people[0].focus).toBe(false);
    ctx.apiPrefSet('cowork.showFocus', true);
    ctx.coworkMark_(A, rooms[0].id, 'beat', at(clock));
    expect(ctx.coworkView_(B, at(clock)).rooms[0].people[0].focus).toBe(true);
  });
});

describe('部屋の一覧を決める', () => {
  it('10 まで。名前とリンクを全部確かめてから書き、1つでも駄目なら何も変えない', () => {
    const { ctx, rooms } = server();
    const before = JSON.stringify(ctx.coworkRooms_());
    expect(() => ctx.coworkSetRooms_([{ name: 'よい', link: MEET }, { name: '駄目', link: 'https://zoom.us/j/1' }]))
      .toThrow(/リンクを直してください。2 番目の部屋 \(駄目\): Google Meet か Slack のリンクだけ使えます/);
    expect(JSON.stringify(ctx.coworkRooms_())).toBe(before);
    expect(() => ctx.coworkSetRooms_([{ name: 'a', link: MEET }, { name: 'b', link: MEET + '/' }])).toThrow(/同じリンク/);
    expect(() => ctx.coworkSetRooms_([{ name: '', link: MEET }])).toThrow(/名前/);
    expect(() => ctx.coworkSetRooms_([{ name: 'x'.repeat(31), link: MEET }])).toThrow(/30 字/);
    const many = Array.from({ length: 11 }, (_, i) => ({ name: '部屋' + i, link: 'https://meet.google.com/lookup/room' + i }));
    expect(() => ctx.coworkSetRooms_(many)).toThrow(/10 までにしてください/);
    expect(rooms).toHaveLength(2);
  });

  it('名前を変えても同じリンクなら同じ部屋 (中にいる人は消えない)。外した部屋の印は消す', () => {
    const { ctx, clock, rooms } = server();
    ctx.coworkMark_(A, rooms[0].id, 'enter', at(clock));
    ctx.coworkMark_(B, rooms[1].id, 'enter', at(clock));
    const next = ctx.coworkSetRooms_([{ name: '雑談 (名前を変えた)', link: MEET }]);
    expect(next[0].id).toBe(rooms[0].id);
    const view = ctx.coworkView_(A, at(clock));
    expect(view.rooms).toHaveLength(1);
    expect(view.rooms[0].count).toBe(1);
    expect(clock.store.has('COWORK:' + rooms[1].id)).toBe(false);
  });

  it('スクリプトプロパティを手で崩しても、崩れた部屋は出ない', () => {
    const { ctx, fake } = server();
    const props = fake.PropertiesService.getScriptProperties();
    props.setProperty('COWORK_ROOMS', JSON.stringify([{ name: '良い', parts: { kind: 'meet', code: 'abc-defg-hij' } },
      { name: '悪い', parts: { kind: 'meet', code: 'javascript:x' } }, { name: '', parts: { kind: 'meet', code: 'abc-defg-hik' } }]));
    expect(ctx.coworkRooms_().map((r) => r.name)).toEqual(['良い']);
    props.setProperty('COWORK_ROOMS', '{壊れた');
    expect(ctx.coworkRooms_()).toEqual([]);
  });
});
