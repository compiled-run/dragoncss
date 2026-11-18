// The top-layer UA rows (a <dialog> shown with showModal() and its ::backdrop) are Chrome's: a fresh capture, which itself fails
// unless dragon-unstyled given the declared values reproduces every captured longhand, equals the committed file.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

describe('the top-layer UA capture', () => {
  it('matches the committed packages/dragon/src/ua/chrome-145.darwin-arm64.top-layer.generated.ts', () => {
    const r = spawnSync('node', ['--conditions=dragon-internal', 'scripts/capture-top-layer-ua.ts', '--check'], { cwd: repoPath('.'), encoding: 'utf8' });
    expect(`${r.stdout}${r.stderr}`).toContain('matches a fresh capture');
    expect(r.status).toBe(0);
  });
});
