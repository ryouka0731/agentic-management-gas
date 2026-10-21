/**
 * 並んだ絵からの切り出し (scripts/cut-oshi-sheet.mjs)。cells.json から切り直すと、いま置いてある
 * assets/oshi-default/<キャラ>/ の絵とバイト単位で同じになるか (切り出し表と絵が食い違っていないか) を見る。
 * dwebp / cwebp (libwebp) が無い環境では飛ばす。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cutSheets, sheetMap } from '../scripts/cut-oshi-sheet.mjs';

const HAVE_WEBP = !spawnSync('dwebp', ['-version']).error && !spawnSync('cwebp', ['-version']).error;
/** 切り出し表のあるキャラ (assets/oshi-sheets/<key>/cells.json) */
const CHARS = fs.readdirSync(path.join('assets', 'oshi-sheets'))
  .filter((d) => fs.existsSync(path.join('assets', 'oshi-sheets', d, 'cells.json')));
/**
 * 並んだ絵の元データはリポジトリに置かない (.gitignore。実在の人に結び付く字やロゴが予備の枠に残るため)。
 * 手元にあるときだけ、切り直して置いてある絵と同じになるかを見る
 */
const HAVE_SHEET = fs.existsSync(path.join('assets', 'oshi-sheets', 'tsujippi', 'chibi.webp'));

describe('並んだ絵からの切り出し', () => {
  it('切り出し表のあるキャラが4人いて、どの表情も切り出し表にある絵を指す (予備 spare_* は使わない)', () => {
    expect(CHARS.sort()).toEqual(['ikkun', 'ryoka', 'satomi', 'tsujippi']);
    for (const char of CHARS) {
      const { map } = sheetMap(char);
      for (const [style, states] of Object.entries(map.states)) {
        for (const [state, name] of Object.entries(states)) {
          expect(map.cells[style][name], char + ' ' + style + ' ' + state).toBeTruthy();
          expect(name.startsWith('spare_'), char + ' ' + style + ' ' + state).toBe(false);
        }
      }
    }
  });

  // 切り直しは libwebp を呼ぶので 10 秒ほどかかる (既定の 5 秒では打ち切られる)
  it.skipIf(!HAVE_WEBP || !HAVE_SHEET)('手元に元の絵があれば、切り直すと置いてある絵とバイト単位で同じになる (つじっぴの一部の表情)', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'oshi-sheet-test-'));
    try {
      const only = ['idle', 'praise', 'worry', 'pout'];
      const written = cutSheets('tsujippi', { out, only });
      expect(written.length).toBeGreaterThanOrEqual(only.length);
      for (const f of fs.readdirSync(out)) {
        const now = fs.readFileSync(path.join('assets', 'oshi-default', 'tsujippi', f));
        expect(fs.readFileSync(path.join(out, f)).equals(now), f).toBe(true);
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 60000);
});
