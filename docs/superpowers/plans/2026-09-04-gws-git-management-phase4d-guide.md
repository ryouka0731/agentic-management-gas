# Phase 4d (アプリ内ガイド + 身元の実測) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 初めて使う人が説明なしで理解できるガイドを画面に載せ、あわせて
社内展開の前提となる「アプリが利用者を誰として認識するか」を実測できるようにする。

**Architecture:** ガイドは状態を持たない静的パネル。身元だけは
`apiWhoAmI()` で取得して同じ画面に出す。`executeAs` を切り替える前に、
別アカウントでこの画面を開けば判定できる。

**Spec:** `docs/superpowers/specs/2026-09-04-gws-git-management-phase4-design.md` (§7)

## Global Constraints

- GAS 標準サービスのみ。GCP プロジェクトは使用不可
- ガイドの本文は開発者が書く静的な markup。利用者由来の文字列は出さない。
  身元だけは `textContent` で入れる
- CSS は既存トークン (`--ink` / `--ink-2` / `--line` / `--bg` / `--bg-2` /
  `--accent`) のみを使う

## なぜ身元の実測が要るか

社内展開では `webapp.executeAs` を `ME` にすることを検討している。
利用者に Drive の権限を渡さずに済み、main 保護が Drive の権限そのもので
効くようになるためである。

しかし `executeAs: ME` のとき `Session.getActiveUser().getEmail()` が
**空文字を返す環境がある**。空文字になると、コミットの作者・レビュアーが
すべて空になり、**自己承認の禁止が「全員が同一人物」として誤作動する**。

切り替える前に、実際に別アカウントで開いて確かめる必要がある。

---

## Task 1: apiWhoAmI — 身元の実測

**Files:**
- Modify: `src/Main.gs`
- Test: `test/phase4-edit.test.js`

**Interfaces:**
- Produces: `apiWhoAmI() -> {activeUser:string, effectiveUser:string, sameUser:boolean}`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
describe('身元の実測', () => {
  it('実行者と権限保持者を返す', () => {
    const { ctx } = setup();
    const who = ctx.apiWhoAmI();

    expect(who.activeUser).toBe('tester@example.com');
    expect(who.effectiveUser).toBe('tester@example.com');
    expect(who.sameUser).toBe(true);
  });

  it('実行者が取れない場合を区別できる', () => {
    const { ctx, fake } = setup();
    fake._setUser('');

    const who = ctx.apiWhoAmI();
    expect(who.activeUser).toBe('');
    expect(who.sameUser).toBe(false);
  });
});
```

疑似GAS の `Session` に `getEffectiveUser` を足す。

```javascript
    Session: {
      getActiveUser: () => ({ getEmail: () => activeUser }),
      getEffectiveUser: () => ({ getEmail: () => effectiveUser }),
    },
```

`createFakeGas` に `let effectiveUser = 'tester@example.com';` と
`_setEffectiveUser` を足す。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/phase4-edit.test.js`
Expected: FAIL

- [ ] **Step 3: 実装する**

```javascript
/**
 * アプリが利用者を誰として認識しているかを返す (Web App API)。
 *
 * webapp.executeAs を ME に切り替える前に、別アカウントでこの値を
 * 確かめる必要がある。activeUser が空になる環境では、コミットの作者と
 * レビュアーがすべて空になり、自己承認の禁止が誤作動する。
 *
 * @returns {{activeUser:string, effectiveUser:string, sameUser:boolean}}
 */
function apiWhoAmI() {
  var active = String(Session.getActiveUser().getEmail() || '');
  var effective = String(Session.getEffectiveUser().getEmail() || '');
  return {
    activeUser: active,
    effectiveUser: effective,
    sameUser: active !== '' && active === effective,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: コミット**

---

## Task 2: ガイド画面

**Files:**
- Modify: `src/ui/wiki.html` / `app.js.html` / `app.css.html`

- [ ] **Step 1: タブとパネルを足す**

タブ列の末尾に `<button class="tab" data-tab="help">ヘルプ</button>` を置き、
`panel-help` に次の3節を静的 markup で書く。

1. **用語の対応** — GitHub の概念とこのアプリの対応
2. **基本の流れ** — Issue → ブランチ → 編集 → コミット → PR → レビュー → マージ
3. **つまずきやすい点** — main が保護されている理由 / コンフリクトの解決 /
   「書き戻せません」の意味 / 色やフォントは版管理されないこと

末尾に身元を出す領域 `<div id="whoami" class="row-meta"></div>` を置く。

- [ ] **Step 2: 身元を表示する**

`switchTab` に `help` を足し、開いたときだけ `apiWhoAmI()` を呼ぶ。

```javascript
  function loadHelp() {
    google.script.run
      .withSuccessHandler(function (who) {
        whoamiEl.textContent = who.activeUser
          ? 'このアプリはあなたを ' + who.activeUser + ' として認識しています'
          : '警告: 利用者を特定できていません (activeUser が空)。'
            + 'この状態ではコミットの作者と承認者が記録されません';
      })
      .withFailureHandler(function () {
        whoamiEl.textContent = '';
      })
      .apiWhoAmI();
  }
```

- [ ] **Step 3: push して再デプロイ**

- [ ] **Step 4: 別アカウントで開いて身元を確認**

Expected: ヘルプの末尾に相手のメールアドレスが出る。空だと出た場合、
`executeAs: ME` への切り替えは**してはいけない**

- [ ] **Step 5: コミット**

---

## Task 3: ドキュメント更新

- [ ] **Step 1: 全テストを実行**
- [ ] **Step 2: README に社内展開の節を足す**
- [ ] **Step 3: 計画書に完了マークを付ける**
- [ ] **Step 4: コミット**

---

## Phase 4d 完了時に達成されていること

- [ ] ヘルプタブに用語の対応・基本の流れ・つまずきやすい点が載っている
- [ ] 自分が誰として認識されているかが画面で分かる
- [ ] 利用者を特定できない場合は警告が出る
- [ ] README に社内展開の手順と `executeAs` の判断材料が書かれている
