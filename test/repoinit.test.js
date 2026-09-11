import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
];

describe('リポジトリを作る場所', () => {
  it('スクリプトと同じフォルダに作る', () => {
    const fake = createFakeGas();
    const home = fake.DriveApp.createFolder('社内システム');
    fake._placeScript(home);

    const ctx = loadGasWith(fake, ...SOURCES);
    const config = ctx.repoInit('agentic-management');

    // マイドライブの直下だと他の書類に紛れ、持ち出しにくい
    const root = fake.DriveApp.getFolderById(config.rootId);
    expect(root.getName()).toBe('agentic-management');
    expect(root._parent).toBe(home.getId());
  });

  it('スクリプトの場所が分からなければマイドライブの直下に落とす', () => {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...SOURCES);

    // 作れないより、場所が違うほうがまだよい
    const config = ctx.repoInit('agentic-management');
    const root = fake.DriveApp.getFolderById(config.rootId);

    expect(root._parent).toBe(fake.DriveApp.getRootFolder().getId());
  });

  it('中の入れ物はこれまでどおり作る', () => {
    const fake = createFakeGas();
    fake._placeScript(fake.DriveApp.createFolder('社内システム'));

    const ctx = loadGasWith(fake, ...SOURCES);
    const config = ctx.repoInit('agentic-management');

    ['mainId', 'branchesId', 'gitId', 'objectsId', 'dbId'].forEach((key) => {
      expect(config[key]).toBeTruthy();
    });
  });

  it('メタDBは .git の中に入る', () => {
    const fake = createFakeGas();
    fake._placeScript(fake.DriveApp.createFolder('社内システム'));

    const ctx = loadGasWith(fake, ...SOURCES);
    const config = ctx.repoInit('agentic-management');

    expect(fake.DriveApp.getFileById(config.dbId)._parent).toBe(config.gitId);
  });
});
