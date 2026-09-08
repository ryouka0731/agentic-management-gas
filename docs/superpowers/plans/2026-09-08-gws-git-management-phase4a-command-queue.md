# Phase 4a (コマンドキュー / ローカル連携) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ローカルの Claude から、Drive 上のキューを介して版管理の操作を実行できるようにする。

**Architecture:** `.git/queue/` に命令 JSON を置くと、1分間隔の時間主導トリガーが
拾って実行し、結果を JSON で書き戻す。GCP も公開エンドポイントも要らない。
op はホワイトリストで縛り、既存の `api*` 関数に委譲するだけにする。

**Spec:** `docs/superpowers/specs/2026-09-04-gws-git-management-phase4-design.md` (§4)

## Global Constraints

- GAS 標準サービスのみ。**GCP プロジェクトは使用不可**（`clasp run` が使えない理由）
- **公開エンドポイントを作らない。** `doPost` は使わない
- 命令ファイルの内容は信頼しない。op はホワイトリスト照合、引数は既存 API の
  バリデーションに通す
- 1回の起動で処理するのは最大10件（GAS の実行時間上限 6分に当てない）
- ランタイムコードに `import` / `export` / `require` を書かない

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/core/CommandQueue.gs` (新規) | キューのフォルダ解決、命令の実行、結果の書き出し |
| `src/Main.gs` (変更) | `setupCommandQueue()` と検証ハーネス |
| `test/fakegas.js` (変更) | `folder.getFiles()` と `ScriptApp` のフェイク |
| `test/phase4-queue.test.js` (新規) | キューの統合テスト |

---

## Task 1: キューのフォルダと命令の実行

**Files:**
- Create: `src/core/CommandQueue.gs`
- Modify: `test/fakegas.js`
- Test: `test/phase4-queue.test.js`

**Interfaces:**
- Produces:
  - `COMMAND_OPS() -> Object<string, function>` — 実行できる op の表
  - `commandQueueFolder_()` / `commandDoneFolder_()` — 遅延作成
  - `processCommandQueue() -> string` — キューを1回処理する

**設計の要点:**

- **`prReview` は op に含めない。** トリガーはオーナー権限で走るため、キュー経由の
  承認は常に自己承認になる。承認は人が UI で行う操作として残す
- **イテレータを回しながらファイルを移動しない。** 先に対象を集めてから処理する。
  移動しながら回すとイテレータが壊れて取りこぼす
- 処理済みの命令は `queue-done/` に移す。結果ファイルは `queue/` に残す
- 1件の失敗でキュー全体を止めない。例外は握って `ok:false` の結果にする

- [ ] **Step 1: 疑似GAS に getFiles を足す**

`makeFolder` の戻り値に足す。

```javascript
      getFiles: () => {
        const hits = [];
        for (const f of files.values()) {
          if (f._parent === id && !f._trashed) hits.push(f);
        }
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
```

`getBlob().getDataAsString` は引数を無視して内容を返す実装が既にあるため、そのままでよい。

- [ ] **Step 2: 失敗するテストを書く**

```javascript
describe('コマンドキュー', () => {
  it('命令を実行して結果を書き出す', () => {
    const { ctx, fake, fileId } = setup();
    enqueue(ctx, 'cmd1', { op: 'status', args: { fileId: fileId } });

    ctx.processCommandQueue();

    const res = readResult(ctx, 'cmd1');
    expect(res.ok).toBe(true);
    expect(res.op).toBe('status');
    expect(res.result.branch).toBe('main');
  });

  it('処理済みの命令は queue-done に移り、二度実行されない', () => {
    const { ctx, fileId } = setup();
    enqueue(ctx, 'cmd1', { op: 'listFiles', args: {} });

    ctx.processCommandQueue();
    const first = readResult(ctx, 'cmd1');

    ctx.processCommandQueue();
    expect(readResult(ctx, 'cmd1').at).toBe(first.at);
  });

  it('ホワイトリストにない op は実行しない', () => {
    const { ctx } = setup();
    enqueue(ctx, 'cmd1', { op: 'repoInit', args: { rootFolderName: '乗っ取り' } });

    ctx.processCommandQueue();

    const res = readResult(ctx, 'cmd1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('実行できない操作です');
  });

  it('prReview は op に無い', () => {
    const { ctx } = setup();
    expect(ctx.COMMAND_OPS().prReview).toBeUndefined();
  });

  it('壊れたJSONでも他の命令を止めない', () => {
    const { ctx } = setup();
    ctx.commandQueueFolder_().createFile('bad.cmd.json', '{壊れている', 'text/plain');
    enqueue(ctx, 'good', { op: 'listFiles', args: {} });

    expect(() => ctx.processCommandQueue()).not.toThrow();
    expect(readResult(ctx, 'bad').ok).toBe(false);
    expect(readResult(ctx, 'good').ok).toBe(true);
  });

  it('失敗した命令はエラーを結果に書く', () => {
    const { ctx } = setup();
    enqueue(ctx, 'cmd1', { op: 'status', args: { fileId: '存在しない' } });

    ctx.processCommandQueue();
    const res = readResult(ctx, 'cmd1');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('管理対象に登録されていません');
  });

  it('1回の起動で処理するのは10件まで', () => {
    const { ctx } = setup();
    for (let i = 0; i < 12; i++) {
      enqueue(ctx, 'cmd' + i, { op: 'listFiles', args: {} });
    }

    ctx.processCommandQueue();
    let done = 0;
    for (let i = 0; i < 12; i++) if (readResult(ctx, 'cmd' + i)) done++;
    expect(done).toBe(10);
  });

  it('mainへのコミットはキュー経由でも拒否される', () => {
    const { ctx, fake, fileId } = setup();
    fake._docs.set(fileId, '<p>直接編集</p>\n');
    enqueue(ctx, 'cmd1', { op: 'commit', args: { fileId: fileId, message: 'x' } });

    ctx.processCommandQueue();
    expect(readResult(ctx, 'cmd1').error).toContain('mainは保護されています');
  });
});
```

補助関数:

```javascript
function enqueue(ctx, id, cmd) {
  ctx.commandQueueFolder_().createFile(
    id + '.cmd.json', JSON.stringify(cmd), 'text/plain');
}

function readResult(ctx, id) {
  const it = ctx.commandQueueFolder_().getFilesByName(id + '.result.json');
  return it.hasNext() ? JSON.parse(it.next().getBlob().getDataAsString('UTF-8')) : null;
}
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run test/phase4-queue.test.js`
Expected: FAIL

- [ ] **Step 4: 実装する**

`src/core/CommandQueue.gs` を作る（本文は Task 1 の実装ステップを参照）。

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`

- [ ] **Step 6: コミット**

---

## Task 2: トリガーの設置と検証ハーネス

**Files:**
- Modify: `src/Main.gs`

**Interfaces:**
- Produces: `setupCommandQueue()` / `debugVerifyCommandQueue()`

- [ ] **Step 1: setupCommandQueue を実装する**

同名トリガーを先に消してから作る。二度実行しても増えないようにする。

- [ ] **Step 2: debugVerifyCommandQueue を実装する**

命令を1件置いて `processCommandQueue()` を呼び、結果を判定して片付ける。
エディタから1回実行するだけで、キューが実際に動くか確かめられるようにする。

- [ ] **Step 3: push して確認**

- [ ] **Step 4: コミット**

---

## Task 3: ドキュメント更新

- [ ] **Step 1: 全テストを実行**
- [ ] **Step 2: README にローカル連携の使い方を書く**（命令の形式、op 一覧、遅延）
- [ ] **Step 3: 計画書に完了マークを付ける**
- [ ] **Step 4: コミット**

---

## Phase 4a 完了時に達成されていること

- [ ] `.git/queue/` に命令 JSON を置くと、1分以内に実行されて結果 JSON が出る
- [ ] ホワイトリストにない op は実行されない
- [ ] `prReview` は op に含まれない（キュー経由の自己承認を防ぐ）
- [ ] 壊れた JSON や失敗した命令が、他の命令の処理を止めない
- [ ] 処理済みの命令は二度実行されない
- [ ] main の保護など既存の安全機構はキュー経由でも効く
