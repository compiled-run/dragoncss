// Committed authored captures: packages/parity/expected/<case id>.web.json, written only by pnpm run parity:capture.
import { readFileSync } from 'node:fs';
import type { WebCapture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { repoPath } from './paths.ts';

export const expectedPath = (caseId: string): string => repoPath(`packages/parity/expected/${caseId}.web.json`);
/** Emitted web CSS of a fixture per environment direction: "<fixture>.css" (ltr) and "<fixture>-rtl.css". */
export const emittedPath = (fixture: string, direction: 'ltr' | 'rtl' = 'ltr'): string => repoPath(`packages/parity/emitted/${fixture}${direction === 'rtl' ? '-rtl' : ''}.css`);
export const vectorPath = (caseId: string): string => repoPath(`packages/layout/vectors/${caseId}.json`);

export const committedAuthored = (c: ParityCase): Promise<WebCapture> => Promise.resolve(JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture);
