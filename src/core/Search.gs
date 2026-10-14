/**
 * 横断検索の一覧。設計: docs/superpowers/specs/2026-10-14-search-design.md
 *
 * **題名・番号・状態だけを返す。** 人の名前とアドレスは入れない (一覧で既に見えている題名だけを
 * 探せるようにする。人を探す道は作らない)。画面はこれを1回取り、手元で絞る。
 */

/**
 * @returns {Array<{kind: string, number: number, key: string, title: string, state: string, archived: boolean}>}
 */
function searchIndex_() {
  var out = [];
  function push(kind, number, key, title, state, archived) {
    var t = String(title || '');
    if (!t) return;
    out.push({ kind: kind, number: Number(number) || 0, key: String(key || ''), title: t,
      state: String(state || ''), archived: !!archived });
  }

  var files = filesVisibleInWiki();
  for (var f = 0; f < files.length; f++) {
    var path = String(files[f].path || '');
    if (branchOfPath_(path) !== 'main') continue;
    push('doc', 0, files[f].fileId, path, '', false);
  }

  var issues = dbReadAll('issues');
  for (var i = 0; i < issues.length; i++) {
    push('issue', issues[i].number, '', issues[i].title, issues[i].state, !!issues[i].archivedAt);
  }

  var pulls = dbReadAll('pulls');
  for (var p = 0; p < pulls.length; p++) {
    push('pull', pulls[p].number, '', pulls[p].title, pulls[p].state, false);
  }

  var branches = dbReadAll('branches');
  for (var b = 0; b < branches.length; b++) {
    var name = String(branches[b].name || '');
    if (name === 'main' || String(branches[b].state) !== 'open') continue;
    push('branch', 0, name, name, 'open', false);
  }

  var inquiries = dbReadAll('inquiries');
  for (var q = 0; q < inquiries.length; q++) {
    var title = String(inquiries[q].title || '') || inquiryTitleOf_(inquiries[q].body);
    push('inquiry', inquiries[q].number, '', title, inquiries[q].state, false);
  }

  if (scrumEnabled()) {
    var imps = dbReadAll('impediments');
    for (var m = 0; m < imps.length; m++) {
      push('impediment', imps[m].number, '', imps[m].title, imps[m].state, false);
    }
  }
  return out;
}
