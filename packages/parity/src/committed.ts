// Committed authored captures: packages/parity/expected/<platform>/<case id>.web.json, written only by pnpm run parity:capture on
// that platform. The reference platform's captures are the ones the live suite compares with.
import { readFileSync } from 'node:fs';
import type { WebCapture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

export const expectedDir = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected/${platform}`);
export const expectedPath = (caseId: string, platform: string = REFERENCE_PLATFORM): string => `${expectedDir(platform)}/${caseId}.web.json`;
/** Emitted web CSS of a fixture per environment direction: "<fixture>.css" (ltr) and "<fixture>-rtl.css". */
export const emittedPath = (fixture: string, direction: 'ltr' | 'rtl' = 'ltr'): string => repoPath(`packages/parity/emitted/${fixture}${direction === 'rtl' ? '-rtl' : ''}.css`);
export const vectorPath = (caseId: string): string => repoPath(`packages/layout/vectors/${caseId}.json`);

export const committedAuthored = (c: ParityCase): Promise<WebCapture> => Promise.resolve(JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture);
