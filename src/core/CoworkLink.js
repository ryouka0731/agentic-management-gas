/**
 * 作業雑談部屋のリンク。Google Meet の会議と Slack のハドル・チャンネルのリンクだけを受け付ける。
 *
 * **番頭は Meet / Slack の API を呼ばない。** 部屋の中 (話す・画面を見せる) は Meet / Slack の中で起き、
 * 番頭はリンクを開くだけ。守ること:
 * - 貼られた字はそのまま持たない。ここで読み解いて部品 (種類と会議のコード / チームとチャンネルの id など) だけを残し、
 *   開くリンクは部品から組み直す。字の種類と長さを決めて、それ以外は断る
 * - 場所は小文字にして、決めた名前と一字一句同じときだけ通す (meet.google.com.evil.com のような似た名前・
 *   ユーザー名付き (@)・番号付き (:443)・http は通さない)
 *
 * 画面 (js-cowork.html) にも同じ関数を写してある (入力しながら確かめるため)。片方だけ直すと、画面では通るのに
 * 保存で断られる (または逆の) リンクが出る。`test/ui-parity.test.js` が同じ答えを返すかを見ている。
 */

/**
 * 部品に使える字と長さ。
 *
 * - Meet の会議のコード: 小文字3-4-3 (abc-defg-hij)
 * - Meet の lookup (呼び名で引く形): 英数と _ - で 2〜64字
 * - Slack のチームの id: T か E で始まる大文字英数。チャンネルの id: C / G / D で始まる大文字英数
 * - Slack のワークスペース名 (<名前>.slack.com): 小文字英数と - (先頭と末尾は英数)
 *
 * @returns {{meet: RegExp, lookup: RegExp, team: RegExp, channel: RegExp, workspace: RegExp}}
 */
function coworkLinkRe_() {
  return {
    meet: /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/,
    lookup: /^[A-Za-z0-9_-]{2,64}$/,
    team: /^[TE][A-Z0-9]{6,20}$/,
    channel: /^[CGD][A-Z0-9]{6,20}$/,
    workspace: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  };
}

/**
 * <名前>.slack.com の名前の位置に来ても、ワークスペースではないもの。
 *
 * @returns {string[]}
 */
function coworkSlackReserved_() {
  return ['app', 'www', 'api', 'files', 'status', 'slack-files', 'hooks', 'edgeapi', 'wss', 'downloads', 'my', 'join'];
}

/**
 * 貼られたリンクを読み解く。**部品だけを返す** (貼られた字そのものは返さない)。
 *
 * @param {*} url
 * @returns {{ok: boolean, parts?: {kind: string, code?: string, team?: string, channel?: string, workspace?: string},
 *   error?: string}}
 */
function coworkLinkParse_(url) {
  var ng = function (text) { return { ok: false, error: text }; };
  if (typeof url !== 'string') return ng('部屋のリンクを貼ってください');
  var s = url.replace(/^\s+|\s+$/g, '');
  if (!s) return ng('部屋のリンクを貼ってください');
  if (s.length > 300) return ng('リンクが長すぎます。Meet か Slack で写したリンクを貼ってください');
  if (!/^https:\/\//i.test(s)) return ng('https:// で始まる Google Meet か Slack のリンクを貼ってください');
  // 場所の後ろは / ? # か終わりだけ。@ (ほかの場所を名乗る形) や :443 (番号) は通さない
  var m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i.exec(s);
  if (!m) return ng('読めないリンクです。Meet か Slack で写したリンクをそのまま貼ってください');
  var host = m[1].toLowerCase();
  // 末尾の / は付いていても同じ部屋
  var path = (m[2] || '/').replace(/\/+$/, '');
  var re = coworkLinkRe_();

  if (host === 'meet.google.com') {
    var meet = /^\/([^/]+)$/.exec(path);
    if (meet && re.meet.test(meet[1])) return { ok: true, parts: { kind: 'meet', code: meet[1] } };
    var look = /^\/lookup\/([^/]+)$/.exec(path);
    if (look && re.lookup.test(look[1])) return { ok: true, parts: { kind: 'meet-lookup', code: look[1] } };
    return ng('Meet の会議のリンク (meet.google.com/abc-defg-hij) を貼ってください');
  }

  if (host === 'app.slack.com') {
    var huddle = /^\/huddle\/([^/]+)\/([^/]+)$/.exec(path);
    if (huddle && re.team.test(huddle[1]) && re.channel.test(huddle[2])) {
      return { ok: true, parts: { kind: 'slack-huddle', team: huddle[1], channel: huddle[2] } };
    }
    return ng('Slack のハドルのリンク (app.slack.com/huddle/…) を貼ってください');
  }

  var ws = /^([^.]+)\.slack\.com$/.exec(host);
  if (ws) {
    if (!re.workspace.test(ws[1]) || coworkSlackReserved_().indexOf(ws[1]) >= 0) {
      return ng('Slack のチャンネルのリンク (<名前>.slack.com/archives/…) を貼ってください');
    }
    var arch = /^\/archives\/([^/]+)$/.exec(path);
    if (arch && re.channel.test(arch[1])) {
      return { ok: true, parts: { kind: 'slack-channel', workspace: ws[1], channel: arch[1] } };
    }
    return ng('Slack のチャンネルのリンク (<名前>.slack.com/archives/…) を貼ってください。発言へのリンクは使えません');
  }

  return ng('Google Meet か Slack のリンクだけ使えます');
}

/**
 * 残した部品が正しい形か (スクリプトプロパティは人がエディタで書き換えうるので、読むたびに確かめる)。
 *
 * @param {*} p
 * @returns {boolean}
 */
function coworkLinkPartsValid_(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  var keys = Object.keys(p).sort().join(',');
  var re = coworkLinkRe_();
  var str = function (v) { return typeof v === 'string'; };
  if (p.kind === 'meet') return keys === 'code,kind' && str(p.code) && re.meet.test(p.code);
  if (p.kind === 'meet-lookup') return keys === 'code,kind' && str(p.code) && re.lookup.test(p.code);
  if (p.kind === 'slack-huddle') {
    return keys === 'channel,kind,team' && str(p.team) && str(p.channel) && re.team.test(p.team) && re.channel.test(p.channel);
  }
  if (p.kind === 'slack-channel') {
    return keys === 'channel,kind,workspace' && str(p.workspace) && str(p.channel) &&
      re.workspace.test(p.workspace) && coworkSlackReserved_().indexOf(p.workspace) < 0 && re.channel.test(p.channel);
  }
  return false;
}

/**
 * 開くリンクを部品から組む。部品が正しくなければ ''。
 *
 * @param {*} p
 * @returns {string}
 */
function coworkLinkOf_(p) {
  if (!coworkLinkPartsValid_(p)) return '';
  if (p.kind === 'meet') return 'https://meet.google.com/' + p.code;
  if (p.kind === 'meet-lookup') return 'https://meet.google.com/lookup/' + p.code;
  if (p.kind === 'slack-huddle') return 'https://app.slack.com/huddle/' + p.team + '/' + p.channel;
  return 'https://' + p.workspace + '.slack.com/archives/' + p.channel;
}

/**
 * どこの部屋かの短い名前 (画面の札)。
 *
 * @param {*} p
 * @returns {string}
 */
function coworkLinkKindLabel_(p) {
  if (!coworkLinkPartsValid_(p)) return '';
  if (p.kind === 'meet' || p.kind === 'meet-lookup') return 'Google Meet';
  if (p.kind === 'slack-huddle') return 'Slack ハドル';
  return 'Slack チャンネル';
}
