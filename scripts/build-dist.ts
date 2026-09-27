// Builds JavaScript and .d.ts for @dragon/layout and dragon into their gitignored build/ directories with the installed TypeScript
// (rewriteRelativeImportExtensions; no bundler). dragon's build leaves out internal.ts and every @internal declaration, and reads
// @dragon/layout's types from its build. Used by the browser-worker, packed-consumer and publish-shape checks.
// Run with: pnpm run build
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
for (const pkg of ['layout', 'dragon']) {
  rmSync(join(root, 'packages', pkg, 'build'), { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, '-p', join(root, 'packages', pkg, 'tsconfig.build.json')], { stdio: 'inherit' });
  console.log(`built packages/${pkg}/build`);
}
