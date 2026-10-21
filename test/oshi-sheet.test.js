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

describe('並んだ絵からの切り出し', () => {
  it('どの表情も切り出し表にある絵を指す (予備 spare_* は使わない)', () => {
    for (const char of ['tsujippi', 'ikkun', 'ryoka']) {
      const { map } = sheetMap(char);
      for (const [style, states] of Object.entries(map.states)) {
        for (const [state, name] of Object.entries(states)) {
          expect(map.cells[style][name], char + ' ' + style + ' ' + state).toBeTruthy();
          expect(name.startsWith('spare_'), char + ' ' + style + ' ' + state).toBe(false);
        }
      }
    }
  });

  it.skipIf(!HAVE_WEBP)('切り直すと、置いてある絵とバイト単位で同じになる (つじっぴの一部の表情)', () => {
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
  });
});
