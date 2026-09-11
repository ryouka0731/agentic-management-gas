import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Node 26 で window.localStorage が無い環境を補う
    setupFiles: ['./test/setup.js'],
  },
});
