// The planted runs for tmpdir-guard.test.ts: the repo's TMPDIR guard over two small files.
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: [process.env['DRAGON_TMP_GUARD_FILE'] ?? 'none'],
    globalSetup: [join(import.meta.dirname, '../../../../../scripts/vitest-tmpdir.ts')],
  },
});
