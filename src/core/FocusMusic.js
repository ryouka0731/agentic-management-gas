/**
 * 集中のしかたの「自分の曲」。YouTube / SoundCloud の公式の埋め込みの再生機で、本人の曲 (再生リスト) を流す。
 *
 * **この画面が外から取ってくる、ただ1つの例外である** (CLAUDE.md の「制約」)。守ること:
 * - 貼られた URL はそのまま持たない。ここで読み解いて部品 (種類と id / 再生リストの id / パス) だけを残し、
 *   埋め込みの URL は部品から組み直す。字の種類と長さを決めて、それ以外は断る
 * - YouTube は youtube-nocookie.com で埋め込む
 * - 画面は、本人が「読み込む」を押すまで何も読み込まない (js-focus)
 *
 * 画面 (js-focus.html) にも同じ関数を写してある。片方だけ直すと、保存できるのに流れない (または逆の)
 * URL が出る。`test/ui-parity.test.js` が同じ答えを返すかを見ている。
 *
 * GAS には URL の型が無いので、字の形で読む。
 */

/**
 * 部品に使える字と長さ。動画の id は11字、再生リストの id は10〜64字、SoundCloud のパスは区切りごとに小文字・数・_ -。
 * (画面にも写すので、関数の中に置く)
 *
 * @returns {{video: RegExp, list: RegExp, segment: RegExp}}
 */
function focusMusicRe_() {
  return {
    video: /^[A-Za-z0-9_-]{11}$/,
    list: /^[A-Za-z0-9_-]{10,64}$/,
    segment: /^[a-z0-9_-]{1,100}$/,
  };
}

/**
 * 受け付ける場所。字は小文字で比べる。ほかは断る (youtube.com.evil.com のような似た名前も)。
 *
 * @returns {{youtube: string[], youtuBe: string[], soundcloud: string[], soundcloudShort: string[]}}
 */
function focusMusicHosts_() {
  return {
    youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'],
    youtuBe: ['youtu.be'],
    soundcloud: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'],
    // 共有のボタンが出す短いリンク。開くまで行き先が分からないので、読み解けない (断りを分ける)
    soundcloudShort: ['on.soundcloud.com'],
  };
}

/**
 * YouTube が自動で作る「ミックス」か (RD… で始まる)。埋め込みの再生リストとしては流せない。
 *
 * @param {string} list
 * @returns {boolean}
 */
function focusMusicIsMix_(list) {
  return /^RD/.test(String(list));
}

/**
 * SoundCloud で、人の名前の位置に来ても人ではないもの・曲の名前の位置に来ても曲ではないもの。
 *
 * @returns {{first: string[], second: string[]}}
 */
function focusMusicSoundcloudReserved_() {
  return {
    first: ['discover', 'search', 'stream', 'upload', 'you', 'settings', 'messages', 'notifications',
      'charts', 'tags', 'pages', 'mobile', 'popular', 'terms-of-use', 'imprint', 'feed', 'signin', 'logout'],
    second: ['sets', 'likes', 'tracks', 'albums', 'popular-tracks', 'reposts', 'followers', 'following',
      'comments', 'spotlight', 'toptracks'],
  };
}

/**
 * 貼られた URL を読み解く。**部品だけを返す** (URL そのものは返さない)。
 *
 * @param {*} url
 * @returns {{ok: boolean, parts?: {kind: string, video?: string, list?: string, path?: string}, error?: string}}
 */
function focusMusicParse_(url) {
  var ng = function (text) { return { ok: false, error: text }; };
  if (typeof url !== 'string') return ng('URL を貼ってください');
  var s = url.replace(/^\s+|\s+$/g, '');
  if (!s) return ng('URL を貼ってください');
  if (s.length > 500) return ng('URL が長すぎます。共有のボタンで写したリンクを貼ってください');
  if (!/^https:\/\//i.test(s)) return ng('https:// で始まる YouTube か SoundCloud のリンクを貼ってください');
  // 場所の後ろは / ? # か終わりだけ。@ (ほかの場所を名乗る形) や :443 (番号) は通さない
  var m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i.exec(s);
  if (!m) return ng('読めない URL です。共有のボタンで写したリンクをそのまま貼ってください');
  var host = m[1].toLowerCase();
  var path = m[2] || '/';
  var query = focusMusicQuery_(m[3] || '');
  if (!query) return ng('読めない URL です。共有のボタンで写したリンクをそのまま貼ってください');
  var hosts = focusMusicHosts_();

  if (hosts.youtube.indexOf(host) >= 0 || hosts.youtuBe.indexOf(host) >= 0) {
    var video = '';
    var seg = path.split('/');
    if (hosts.youtuBe.indexOf(host) >= 0) {
      // 末尾の / は付いていても同じ動画 (youtu.be/ID/)
      seg = path.replace(/\/+$/, '').split('/');
      if (seg.length !== 2) return ng('YouTube の動画か再生リストのリンクを貼ってください');
      video = seg[1];
    } else if (path === '/watch') {
      video = query.v === undefined ? '' : query.v;
    } else if (path === '/playlist') {
      if (query.list === undefined) return ng('再生リストの id (list=) が入っていません');
    } else if (seg.length === 3 && (seg[1] === 'shorts' || seg[1] === 'live' || seg[1] === 'embed')) {
      video = seg[2];
    } else {
      return ng('YouTube の動画か再生リストのリンクを貼ってください');
    }
    if (query.v === null || query.list === null) return ng('同じ欄が2つ入っています。共有のボタンで写し直してください');
    // 'videoseries' は11字で id の形に合うが、再生リストを流す決まりの名前で、動画ではない
    if (video === 'videoseries') video = '';
    if (video && !focusMusicRe_().video.test(video)) return ng('動画の id に使えない字が入っています');
    var list = query.list === undefined ? '' : query.list;
    // 再生リストを優先する (並びで流したい)。ただし埋め込めない再生リストは使わない:
    // 形の合わないもの (高く評価した動画 LL・後で見る WL など) と、YouTube が自動で作る「ミックス」(RD…)
    var listOk = !!list && focusMusicRe_().list.test(list) && !focusMusicIsMix_(list);
    if (listOk) return { ok: true, parts: { kind: 'youtube', list: list } };
    // 動画があれば、使えない再生リストは捨てて動画を流す
    if (video) return { ok: true, parts: { kind: 'youtube', video: video } };
    if (list && focusMusicIsMix_(list) && focusMusicRe_().list.test(list)) {
      return ng('YouTube が自動で作る「ミックス」は埋め込めません。自分で作った再生リストのリンクを貼ってください');
    }
    if (list) return ng('この再生リストは使えません。自分で作った (公開か限定公開の) 再生リストのリンクを貼ってください');
    return ng('YouTube の動画か再生リストのリンクを貼ってください');
  }

  if (hosts.soundcloudShort.indexOf(host) >= 0) {
    return ng('短いリンクは使えません。ブラウザで開いて soundcloud.com のアドレスを写してください');
  }

  if (hosts.soundcloud.indexOf(host) >= 0) {
    var p = path.replace(/\/+$/, '').split('/').slice(1);
    var reserved = focusMusicSoundcloudReserved_();
    var okSegs = p.every(function (x) { return focusMusicRe_().segment.test(x); });
    if (!okSegs) return ng('SoundCloud の曲かプレイリスト (sets) のリンクを貼ってください (使えない字が入っています)');
    if (p.length >= 1 && reserved.first.indexOf(p[0]) >= 0) {
      return ng('SoundCloud の曲かプレイリスト (sets) のリンクを貼ってください');
    }
    if (p.length === 2 && reserved.second.indexOf(p[1]) < 0) {
      return { ok: true, parts: { kind: 'soundcloud', path: p[0] + '/' + p[1] } };
    }
    if (p.length === 3 && p[1] === 'sets') {
      return { ok: true, parts: { kind: 'soundcloud', path: p[0] + '/sets/' + p[2] } };
    }
    return ng('SoundCloud の曲かプレイリスト (sets) のリンクを貼ってください');
  }

  return ng('YouTube か SoundCloud のリンクだけ使えます');
}

/**
 * ? の後ろを読む。同じ名前が2つあれば null (どちらを使うか決まらない)。読めなければ全体を null。
 *
 * @param {string} q '?a=1&b=2' か ''
 * @returns {Object<string, string|null>|null}
 */
function focusMusicQuery_(q) {
  var out = {};
  var body = q.replace(/^\?/, '');
  if (!body) return out;
  var pairs = body.split('&');
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue;
    var at = pairs[i].indexOf('=');
    var k = at < 0 ? pairs[i] : pairs[i].substring(0, at);
    var v = at < 0 ? '' : pairs[i].substring(at + 1);
    try {
      k = decodeURIComponent(k.replace(/\+/g, ' '));
      v = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch (e) {
      return null;
    }
    // 使うのは v と list だけ。持ち物の名前 (__proto__ など) には書かない
    if (k !== 'v' && k !== 'list') continue;
    out[k] = Object.prototype.hasOwnProperty.call(out, k) ? null : v;
  }
  return out;
}

/**
 * 残した部品が正しい形か (台帳に人が手で書き換えうるので、読むたびに確かめる)。
 *
 * @param {*} p
 * @returns {boolean}
 */
function focusMusicPartsValid_(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  var keys = Object.keys(p).sort().join(',');
  if (p.kind === 'youtube') {
    if (keys === 'kind,video') {
      return typeof p.video === 'string' && focusMusicRe_().video.test(p.video) && p.video !== 'videoseries';
    }
    if (keys === 'kind,list') {
      return typeof p.list === 'string' && focusMusicRe_().list.test(p.list) && !focusMusicIsMix_(p.list);
    }
    return false;
  }
  if (p.kind === 'soundcloud') {
    if (keys !== 'kind,path' || typeof p.path !== 'string') return false;
    var seg = p.path.split('/');
    if (!seg.every(function (x) { return focusMusicRe_().segment.test(x); })) return false;
    return seg.length === 2 || (seg.length === 3 && seg[1] === 'sets');
  }
  return false;
}

/**
 * 埋め込みの再生機の URL を部品から組む。部品が正しくなければ ''。
 *
 * @param {*} p
 * @returns {string}
 */
function focusMusicEmbedUrl_(p) {
  if (!focusMusicPartsValid_(p)) return '';
  if (p.kind === 'youtube' && p.video) {
    return 'https://www.youtube-nocookie.com/embed/' + p.video + '?rel=0&modestbranding=1';
  }
  if (p.kind === 'youtube') {
    return 'https://www.youtube-nocookie.com/embed/videoseries?list=' + p.list + '&rel=0';
  }
  return 'https://w.soundcloud.com/player/?url=' + encodeURIComponent('https://soundcloud.com/' + p.path) +
    '&auto_play=false&visual=false&hide_related=true';
}

/**
 * 設定の画面に出すリンク (部品から組み直したもの)。部品が正しくなければ ''。
 *
 * @param {*} p
 * @returns {string}
 */
function focusMusicLinkOf_(p) {
  if (!focusMusicPartsValid_(p)) return '';
  if (p.kind === 'youtube' && p.video) return 'https://www.youtube.com/watch?v=' + p.video;
  if (p.kind === 'youtube') return 'https://www.youtube.com/playlist?list=' + p.list;
  return 'https://soundcloud.com/' + p.path;
}
