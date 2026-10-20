import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Node 26 で window.localStorage が無い環境を補う
    setupFiles: ['./test/setup.js'],
    // npm run coverage が見る範囲。画面の JS は test/dom.js がつないで coverage-ui/ に置き、
    // source map で元の部分ファイル (src/ui/*.html) へ戻す。CSS と wiki.html は JS ではないので外す
    coverage: {
      provider: 'v8',
      include: ['src/**', 'coverage-ui/**'],
      extension: ['.js', '.gs', '.html'],
      exclude: ['src/KitFiles.gs', 'src/KitSigning.gs', 'src/ui/app.css.html', 'src/ui/wiki.html', 'src/appsscript.json'],
    },
  },
});
