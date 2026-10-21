import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { makeEnv, expectScreenSafe, expectRefused, asUser, OWNER, ADMIN, OTHER } from './api/setup.js';

/*
 * 推しのプロフィール (Lv で少しずつ分かる) と、実績を全部取ったときの「クリア」。
 * 検査は oshiProfileValid_ (OshiStore.gs) だけ。最初からいるキャラの中身はリポジトリに置かず、スクリプトプロパティ
 * OSHI_PROFILE:<key> にだけ置く (管理者だけが書ける)。見せるかはサーバが Lv で決め、クリアの動画はクリアまで渡さない。
 *
 * 中身はどれも作り話 (実在の人のことを書かない)。
 */

const pure = loadGas('src/core/Oshi.js');
const VIDEO = 'Tst0Vid_e-1';
const SAMPLE = {
  items: [
    { lv: 5, label: 'テストの好物', text: 'テスト用の焼きそば' },
    { lv: 2, label: 'テストの口ぐせ', text: 'まずは小さく試そう' },
    { lv: 30, label: 'テストのひみつ', text: 'じつは早起きが苦手' },
  ],
  clearLine: 'テストのお祝いの言葉',
  clearVideo: 'https://www.youtube.com/watch?v=' + VIDEO,
};

function env() {
  const e = makeEnv({ file: false });
  e.fake._setUser(OWNER);
  return e;
}

/** 取った印を直に置く (n 個。全部なら実績の表の全部) */
function grant(e, who, n) {
  const all = e.ctx.ACHIEVEMENTS().map((a) => a.key);
  const got = {};
  all.slice(0, n === undefined ? all.length : n).forEach((k) => { got[k] = '2026-10-21'; });
  e.fake.PropertiesService.getScriptProperties().setProperty('ACH:' + who, JSON.stringify({ days: { n: 1, last: '2026-10-21' }, got }));
}

describe('検査 (oshiProfileValid_)', () => {
  const e = env();
  const valid = (v) => e.ctx.oshiProfileValid_(v);

  it('JSON の字でも物でも読み、動画はリンクから id だけを残す。Lv の並びは書いた順のまま', () => {
    const got = valid(JSON.stringify(SAMPLE));
    expect(got.items.map((i) => i.lv)).toEqual([5, 2, 30]);
    expect(got.clearVideo).toBe(VIDEO);
    expect(valid({ items: [], clearVideo: 'https://youtu.be/' + VIDEO }).clearVideo).toBe(VIDEO);
    expect(valid({ clearVideo: VIDEO }).clearVideo).toBe(VIDEO);
    expect(valid('   ')).toEqual({ items: [], clearLine: '', clearVideo: '' });
  });

  it('YouTube 以外の場所・似た名前・再生リストの動画は断る', () => {
    expect(() => valid({ clearVideo: 'https://vimeo.com/123456' })).toThrow(/YouTube の動画のリンクだけ/);
    expect(() => valid({ clearVideo: 'https://www.youtube.com.evil.com/watch?v=' + VIDEO })).toThrow(/YouTube の動画のリンクだけ/);
    expect(() => valid({ clearVideo: 'http://www.youtube.com/watch?v=' + VIDEO })).toThrow(/YouTube の動画のリンクだけ/);
    expect(() => valid({ clearVideo: 'https://www.youtube.com/playlist?list=PL1234567890abc' })).toThrow(/再生リスト/);
    expect(() => valid({ clearVideo: 'https://soundcloud.com/a/b' })).toThrow(/YouTube の動画のリンクだけ/);
  });

  it('項目は40個まで。Lv は 2〜99 の整数。見出しは20字・中身は200字・お祝いは200字まで', () => {
    const one = (o) => Object.assign({ lv: 3, label: 'テスト', text: 'テストの中身' }, o);
    expect(valid({ items: Array.from({ length: 40 }, () => one()) }).items.length).toBe(40);
    expect(() => valid({ items: Array.from({ length: 41 }, () => one()) })).toThrow(/40個まで/);
    for (const lv of [1, 100, 2.5, '3', null]) expect(() => valid({ items: [one({ lv })] }), String(lv)).toThrow(/2 から 99 までの整数/);
    expect(valid({ items: [one({ lv: 2 }), one({ lv: 99 })] }).items.length).toBe(2);
    expect(() => valid({ items: [one({ label: 'あ'.repeat(21) })] })).toThrow(/label は20字まで/);
    expect(() => valid({ items: [one({ text: 'あ'.repeat(201) })] })).toThrow(/text は200字まで/);
    expect(valid({ items: [one({ text: 'あ'.repeat(200) })] }).items[0].text.length).toBe(200);
    expect(() => valid({ clearLine: 'あ'.repeat(201) })).toThrow(/200字まで/);
    expect(() => valid({ items: [one({ label: ' ' })] })).toThrow(/label/);
    expect(() => valid({ items: [one({ extra: 1 })] })).toThrow(/知らない欄/);
    expect(() => valid({ items: 'x' })).toThrow(/並び/);
    expect(() => valid('{x')).toThrow(/JSON として読めません/);
    expect(() => valid({ nope: 1 })).toThrow(/知らない欄/);
  });
});

describe('最初からいるキャラのプロフィール (スクリプトプロパティにだけ置く)', () => {
  it('管理者が設定の画面から入れると OSHI_PROFILE:<key> に置かれ、台帳には置かない', () => {
    const e = env();
    const got = asUser(e.fake, ADMIN, () => e.ctx.apiOshiBuiltinProfileSet('taku', JSON.stringify(SAMPLE)));
    expectScreenSafe(got);
    expect(got).toMatchObject({ key: 'taku', name: 'タク', items: 3 });
    const raw = e.fake.PropertiesService.getScriptProperties().getProperty('OSHI_PROFILE:taku');
    expect(JSON.parse(raw).items.length).toBe(3);
    expect(JSON.parse(raw).clearVideo).toBe(VIDEO);
    expect(JSON.stringify(e.ctx.dbReadAll('oshi'))).not.toContain('テストの好物');
    const list = asUser(e.fake, ADMIN, () => e.ctx.apiOshiBuiltinProfiles());
    expectScreenSafe(list);
    expect(list.chars.map((c) => [c.key, c.items])).toEqual([['taku', 3], ['itsuki', 0], ['tsujippi', 0], ['ikkun', 0], ['ryoka', 0], ['satomi', 0]]);
    // 直す欄には動画をリンクで出す
    expect(JSON.parse(list.chars[0].json).clearVideo).toBe('https://www.youtube.com/watch?v=' + VIDEO);
  });

  it('管理者でなければ読むのも書くのも断り、何も置かない', () => {
    const e = env();
    asUser(e.fake, OTHER, () => {
      expectRefused(() => e.ctx.apiOshiBuiltinProfileSet('taku', JSON.stringify(SAMPLE)), /管理者/);
      expectRefused(() => e.ctx.apiOshiBuiltinProfiles(), /管理者/);
    });
    expect(e.fake.PropertiesService.getScriptProperties().getProperty('OSHI_PROFILE:taku')).toBe(null);
  });

  it('検査に通らなければ前のものを残す。知らないキャラは断る。空で外す', () => {
    const e = env();
    e.ctx.apiOshiBuiltinProfileSet('itsuki', SAMPLE);
    expectRefused(() => e.ctx.apiOshiBuiltinProfileSet('itsuki', { items: [{ lv: 1, label: 'x', text: 'y' }] }), /整数/);
    expect(e.ctx.oshiBuiltinProfileRead_('itsuki').items.length).toBe(3);
    expectRefused(() => e.ctx.apiOshiBuiltinProfileSet('nobody', SAMPLE), /知らないキャラ/);
    e.ctx.apiOshiBuiltinProfileSet('itsuki', '');
    expect(e.fake.PropertiesService.getScriptProperties().getProperty('OSHI_PROFILE:itsuki')).toBe(null);
    expect(e.ctx.oshiBuiltinProfileRead_('itsuki')).toBe(null);
  });

  it('9KB に収まらない大きさは分けて置き、読み戻すと同じ。小さくし直すと余った続きを消す', () => {
    const e = env();
    const big = { items: Array.from({ length: 40 }, (_, i) => ({ lv: 2 + i, label: 'テストの見出し' + i, text: 'て'.repeat(200) })) };
    e.ctx.apiOshiBuiltinProfileSet('taku', big);
    const props = e.fake.PropertiesService.getScriptProperties();
    const head = JSON.parse(props.getProperty('OSHI_PROFILE:taku'));
    expect(head.parts).toBeGreaterThan(1);
    for (let i = 0; i < head.parts; i++) {
      const part = props.getProperty('OSHI_PROFILE:taku:' + head.v + ':' + i);
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(8000);
    }
    expect(e.ctx.oshiBuiltinProfileRead_('taku').items.map((i) => i.text)).toEqual(big.items.map((i) => i.text));
    e.ctx.apiOshiBuiltinProfileSet('taku', SAMPLE);
    expect(props.getProperty('OSHI_PROFILE:taku:' + head.v + ':0')).toBe(null);
    expect(e.ctx.oshiBuiltinProfileRead_('taku').items.length).toBe(3);
  });

  it('エディタで壊された値は、プロフィール無しとして読む (画面を止めない)', () => {
    const e = env();
    const props = e.fake.PropertiesService.getScriptProperties();
    for (const bad of ['{x', '{"items":[{"lv":1,"label":"a","text":"b"}]}', '{"parts":3}', '[1]']) {
      props.setProperty('OSHI_PROFILE:taku', bad);
      expect(e.ctx.oshiBuiltinProfileRead_('taku'), bad).toBe(null);
      expect(e.ctx.apiOshiGet().reveal.items, bad).toEqual([]);
    }
  });
});

describe('手元からの命令 oshiProfileSet', () => {
  it('置いた人が管理者なら入れ、返事に中身を入れない。管理者でない・分からない人は断る', () => {
    const e = env();
    const got = e.ctx.runCommand_({ op: 'oshiProfileSet', args: { key: 'taku', profile: SAMPLE } }, ADMIN);
    expect(got).toEqual({ key: 'taku', items: 3, clearLine: true, clearVideo: true });
    expect(JSON.stringify(got)).not.toContain('テスト');
    expectRefused(() => e.ctx.runCommand_({ op: 'oshiProfileSet', args: { key: 'itsuki', profile: SAMPLE } }, OTHER), /管理者/);
    expectRefused(() => e.ctx.runCommand_({ op: 'oshiProfileSet', args: { key: 'itsuki', profile: SAMPLE } }, ''), /命令を置いた人が分かりません/);
    expect(e.ctx.oshiBuiltinProfileRead_('itsuki')).toBe(null);
  });

  it('管理者だけの命令は、持ち主と最後に書いた人を見比べられないときは置いた人を決めない', () => {
    const e = env();
    expect(e.ctx.COMMAND_ADMIN_OPS()).toEqual(['oshiProfileSet']);
    expect(e.ctx.COMMAND_PERSONAL_OPS()).toContain('oshiProfileSet');
    // Drive の拡張サービスが無い番頭では、ほかの「自分の様子」は持ち主で決めるが、管理者だけの命令は決めない
    const file = { getId: () => 'F1' };
    expect(e.ctx.commandPersonOf_(file, ADMIN)).toBe(ADMIN);
    expect(e.ctx.commandPersonOf_(file, ADMIN, true)).toBe('');
  });
});

describe('Lv で分かる (サーバが決める)', () => {
  it('Lv が届いた項目だけ名前と中身を返し、ほかは Lv だけ。Lv の小さい順', () => {
    const e = env();
    e.ctx.apiOshiBuiltinProfileSet('taku', SAMPLE);
    grant(e, OWNER, 3); // Lv 4
    const r = e.ctx.apiOshiGet().reveal;
    expectScreenSafe(r);
    expect(r.items).toEqual([
      { lv: 2, open: true, label: 'テストの口ぐせ', text: 'まずは小さく試そう' },
      { lv: 5, open: false, label: '', text: '' },
      { lv: 30, open: false, label: '', text: '' },
    ]);
    expect([r.open, r.total]).toEqual([1, 3]);
    grant(e, OWNER, 4); // Lv 5
    expect(e.ctx.apiOshiGet().reveal.items.filter((i) => i.open).map((i) => i.label)).toEqual(['テストの口ぐせ', 'テストの好物']);
    // ほかの人の Lv では分からない (本人の Lv で決まる)
    grant(e, OTHER, 0);
    const theirs = asUser(e.fake, OTHER, () => e.ctx.apiOshiGet().reveal);
    expect(theirs.items.every((i) => !i.open && !i.label && !i.text)).toBe(true);
  });

  it('クリアするまで、クリアの言葉と動画の id を返さない。全部取ると全部の項目と動画が出る', () => {
    const e = env();
    e.ctx.apiOshiBuiltinProfileSet('taku', SAMPLE);
    const total = e.ctx.ACHIEVEMENTS().length;
    grant(e, OWNER, total - 1);
    const before = e.ctx.apiOshiGet();
    expect(before.cleared).toBe(false);
    expect(before.clear).toBe(null);
    expect(JSON.stringify(before)).not.toContain(VIDEO);
    expect(JSON.stringify(before)).not.toContain('テストのお祝いの言葉');
    grant(e, OWNER);
    const after = e.ctx.apiOshiGet();
    expectScreenSafe(after);
    expect(after.cleared).toBe(true);
    expect(after.clear).toEqual({ line: 'テストのお祝いの言葉', video: VIDEO });
    expect(after.reveal.items.every((i) => i.open)).toBe(true);
  });

  it('実績を止めていても、取った分の Lv で分かる。止めていることは achOn で渡す', () => {
    const e = env();
    e.ctx.apiOshiBuiltinProfileSet('taku', SAMPLE);
    grant(e, OWNER, 1);
    e.ctx.apiPrefSet('ach.on', false);
    const d = e.ctx.apiOshiGet();
    expect(d.achOn).toBe(false);
    expect(d.reveal.open).toBe(1);
  });

  it('見せ方の関数 (oshiProfileReveal) は、届かない項目の名前と中身を入れない', () => {
    const items = [{ lv: 9, label: 'b', text: 'B' }, { lv: 3, label: 'a', text: 'A' }, { lv: 3, label: 'c', text: 'C' }];
    expect(pure.oshiProfileReveal(items, 3, false)).toEqual([
      { lv: 3, open: true, label: 'a', text: 'A' }, { lv: 3, open: true, label: 'c', text: 'C' },
      { lv: 9, open: false, label: '', text: '' }]);
    expect(pure.oshiProfileReveal(items, 1, true).every((i) => i.open)).toBe(true);
  });

  it('クリアのせりふは、どの口調にもある (お祝いの言葉が無いキャラが言う)', () => {
    expect(pure.oshiEventOf('clear')).toMatchObject({ state: 'celebrate' });
    for (const tone of pure.OSHI_TONES()) expect(pure.OSHI_LINES()[tone.key].clear.length, tone.key).toBeGreaterThanOrEqual(3);
  });
});

describe('自分のキャラのプロフィール (台帳 oshi の profile)', () => {
  it('本人が決めると台帳に置かれ、使うキャラなら Lv で分かる。名前と口調を直しても消えない', () => {
    const e = env();
    const c = e.ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    const got = e.ctx.apiOshiSetCharProfile(c, JSON.stringify(SAMPLE));
    expectScreenSafe(got);
    expect(got.items).toBe(3);
    e.ctx.apiOshiSetProfile(c, 'ルナ', 'cool');
    e.ctx.apiOshiSetLines(c, 'done', ['えらい']);
    e.ctx.apiPrefSet('oshi.char', 'mine:' + c);
    grant(e, OWNER, 1);
    const d = e.ctx.apiOshiGet();
    expect(d.reveal.items.filter((i) => i.open).map((i) => i.label)).toEqual(['テストの口ぐせ']);
    expect(JSON.parse(d.mine[0].profileJson).items.length).toBe(3);
    expect(d.mine[0].profile).toBe(undefined);
    expect(d.clear).toBe(null);
    // 検査に通らなければ前のまま
    expectRefused(() => e.ctx.apiOshiSetCharProfile(c, '{"items": 3}'), /並び/);
    expect(JSON.parse(e.ctx.apiOshiGet().mine[0].profileJson).items.length).toBe(3);
    // 空で外す
    expect(e.ctx.apiOshiSetCharProfile(c, '').items).toBe(0);
    expect(e.ctx.apiOshiGet().reveal.items).toEqual([]);
  });

  it('ほかの人のキャラの番号では、自分の中から探すだけ', () => {
    const e = env();
    e.ctx.apiOshiCharCreate('ルナ', 'genki');
    asUser(e.fake, OTHER, () => {
      expectRefused(() => e.ctx.apiOshiSetCharProfile(1, JSON.stringify(SAMPLE)), /見つかりません/);
    });
  });

  it('いちばん大きいプロフィールも台帳の1つのセル (5万字) に収まる', () => {
    const lim = pure.OSHI_PROFILE_LIMITS();
    const big = { items: Array.from({ length: lim.itemsMax }, () => ({ lv: 99, label: '"'.repeat(lim.labelMax), text: '"'.repeat(lim.textMax) })),
      clearLine: '"'.repeat(lim.clearLineMax), clearVideo: VIDEO };
    expect(JSON.stringify(big).length).toBeLessThan(50000);
  });
});

describe('見直しで直したところ', () => {
  it('制御文字は落とす (JSON にすると6字に膨らみ、台帳のセルの上限を超える)', () => {
    const e = env();
    const got = e.ctx.oshiProfileValid_({
      items: [{ lv: 2, label: 'テ\u0001スト', text: '中\u0000身\u007F\u001F' }], clearLine: 'お\u000Bいわい\u000C',
    });
    expect(got.items[0]).toEqual({ lv: 2, label: 'テスト', text: '中身' });
    expect(got.clearLine).toBe('おいわい');
    // 改行とタブは残す
    expect(e.ctx.oshiProfileValid_({ items: [{ lv: 2, label: 'a', text: '1行目\n2行目\tx' }] }).items[0].text).toBe('1行目\n2行目\tx');
  });

  it('JSON にして 45000 字を超えるものは、ふつうの言葉で断る (台帳に書いて英語で落ちない)', () => {
    const e = env();
    // 対の無いサロゲートは JSON で \\udXXX の6字になる
    const lone = '\ud800'.repeat(200);
    const big = { items: Array.from({ length: 40 }, () => ({ lv: 2, label: 'テスト', text: lone })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(45000);
    expect(() => e.ctx.oshiProfileValid_(big)).toThrow(/長すぎます/);
    const c = e.ctx.apiOshiCharCreate('ルナ', 'polite').charId;
    expectRefused(() => e.ctx.apiOshiSetCharProfile(c, big), /長すぎます/);
  });

  it('管理者だけの命令は、Drive が最後に書いた人を返さないときも置いた人を決めない', () => {
    const e = makeEnv({ file: false, drive: true });
    const file = e.ctx.commandQueueFolder_().createFile('x.cmd.json', '{}', 'text/plain');
    file._createdBy = '';
    expect(e.ctx.commandPersonOf_(file, ADMIN, true)).toBe('');
    // ほかの「自分の様子」の命令は今までどおり
    expect(e.ctx.commandPersonOf_(file, ADMIN)).toBe(ADMIN);
  });

  /** 管理者が命令ファイルを置いて、キューの1件として走らせる */
  function runQueued(e, who, args) {
    const queue = e.ctx.commandQueueFolder_();
    const done = e.ctx.commandDoneFolder_();
    const f = asUser(e.fake, who, () => queue.createFile('kit-9-a.cmd.json',
      JSON.stringify({ op: 'oshiProfileSet', args }), 'text/plain'));
    e.ctx.runCommandFileLocked_(f, queue, done);
    const result = JSON.parse(queue.getFilesByName('kit-9-a.result.json').next().getBlob().getDataAsString('UTF-8'));
    const left = done.getFilesByName('kit-9-a.cmd.json').next().getBlob().getDataAsString('UTF-8');
    return { result, left };
  }

  it('キューで走らせると、Drive の拡張サービスが無い番頭では置いた人を決めずに断る', () => {
    const e = makeEnv({ file: false });
    const { result } = runQueued(e, ADMIN, { key: 'taku', profile: SAMPLE });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('命令を置いた人が分かりません');
    expect(e.ctx.oshiBuiltinProfileRead_('taku')).toBe(null);
  });

  it('走らせたあと、処理済みに残る命令ファイルからプロフィールの中身を消す (成功しても断っても)', () => {
    const e = makeEnv({ file: false, drive: true });
    const ok = runQueued(e, ADMIN, { key: 'taku', profile: SAMPLE });
    expect(ok.result.ok).toBe(true);
    expect(e.ctx.oshiBuiltinProfileRead_('taku').items.length).toBe(3);
    expect(JSON.parse(ok.left)).toEqual({ id: 'kit-9-a', op: 'oshiProfileSet' });
    const e2 = makeEnv({ file: false, drive: true });
    const ng = runQueued(e2, OTHER, { key: 'taku', profile: SAMPLE });
    expect(ng.result.ok).toBe(false);
    expect(ng.left).not.toContain('テスト');
  });

  it('分けて置く途中で止まっても、前のプロフィールは読める (新しい続きを別の版に置いてから頭を替える)', () => {
    const e = env();
    const big = (t) => ({ items: Array.from({ length: 40 }, (_, i) => ({ lv: 2 + i, label: t + i, text: t.repeat(100) })) });
    e.ctx.apiOshiBuiltinProfileSet('taku', big('まえ'));
    const props = e.fake.PropertiesService.getScriptProperties();
    const real = e.fake.PropertiesService.getScriptProperties;
    // 頭を替えるところで実行が打ち切られた
    e.fake.PropertiesService.getScriptProperties = () => Object.assign(real(), {
      setProperty: (k, v) => {
        if (k === 'OSHI_PROFILE:taku') throw new Error('Exceeded maximum execution time');
        return real().setProperty(k, v);
      },
    });
    expect(() => e.ctx.apiOshiBuiltinProfileSet('taku', big('あと'))).toThrow();
    e.fake.PropertiesService.getScriptProperties = real;
    expect(e.ctx.oshiBuiltinProfileRead_('taku').items[0].label).toBe('まえ0');
    // 次にうまく書けば、前の版の続きは残さない
    e.ctx.apiOshiBuiltinProfileSet('taku', big('あと'));
    expect(e.ctx.oshiBuiltinProfileRead_('taku').items[0].label).toBe('あと0');
    const keys = Object.keys(props.getProperties()).filter((k) => k.indexOf('OSHI_PROFILE:taku:') === 0);
    const head = JSON.parse(props.getProperty('OSHI_PROFILE:taku'));
    expect(keys.sort()).toEqual(Array.from({ length: head.parts }, (_, i) => 'OSHI_PROFILE:taku:' + head.v + ':' + i).sort());
  });

  it('版の無い分け方 ({"parts": N} と :0〜) も読める', () => {
    const e = env();
    const json = JSON.stringify({ items: SAMPLE.items, clearLine: '', clearVideo: '' });
    const props = e.fake.PropertiesService.getScriptProperties();
    props.setProperty('OSHI_PROFILE:itsuki', JSON.stringify({ parts: 2 }));
    props.setProperty('OSHI_PROFILE:itsuki:0', json.slice(0, 50));
    props.setProperty('OSHI_PROFILE:itsuki:1', json.slice(50));
    expect(e.ctx.oshiBuiltinProfileRead_('itsuki').items.length).toBe(3);
  });

  it('一度クリアしたら、あとから実績が増えてもクリアのまま', () => {
    const e = env();
    e.ctx.apiOshiBuiltinProfileSet('taku', SAMPLE);
    grant(e, OWNER);
    expect(e.ctx.apiOshiGet().cleared).toBe(true);
    const before = e.ctx.ACHIEVEMENTS;
    e.ctx.ACHIEVEMENTS = () => before().concat([Object.assign({}, before()[0], { key: 'later-added' })]);
    const d = e.ctx.apiOshiGet();
    expect(d.cleared).toBe(true);
    expect(d.clear).toEqual({ line: 'テストのお祝いの言葉', video: VIDEO });
    // ほかの人はクリアしていない
    expect(asUser(e.fake, OTHER, () => e.ctx.apiOshiGet().cleared)).toBe(false);
  });
});
