import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const script = fs.readFileSync('scripts/deploy.mjs', 'utf8');
const config = JSON.parse(fs.readFileSync('deployment.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

describe('版を差し替えても URL を変えない', () => {
  it('差し替える先がリポジトリに入っている', () => {
    // 手元の記憶だけに置くと、別の人が差し替えたときに URL が変わる
    expect(config.deploymentId).toMatch(/^AKfycb[\w-]{20,}$/);
  });

  it('npm run deploy は必ず ID を指す', () => {
    expect(pkg.scripts.deploy).toBe('node scripts/deploy.mjs');

    // -i を落とすと新しいデプロイが作られ、URL が変わる
    expect(script).toContain("'create-deployment', '-i', id");
  });

  it('送ってから差し替える', () => {
    const push = script.indexOf("clasp(['push'");
    const deploy = script.indexOf("clasp(['create-deployment'");

    // 送らずに差し替えると、前の中身のまま版だけが上がる
    expect(push).toBeGreaterThan(-1);
    expect(push).toBeLessThan(deploy);
  });

  it('読めない ID は断る', () => {
    expect(script).toContain('/^AKfycb[\\w-]{20,}$/');
  });

  it('何を変えたかを必ず書かせる', () => {
    expect(script).toContain('何を変えたかを渡してください');
  });
});
