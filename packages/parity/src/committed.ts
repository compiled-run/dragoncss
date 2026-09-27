// Committed authored captures: packages/parity/expected/<case id>.web.json, written only by pnpm run parity:capture.
import { readFileSync } from 'node:fs';
import type { WebCapture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { repoPath } from './paths.ts';

export const expectedPath = (caseId: string): string => repoPath(`packages/parity/expected/${caseId}.web.json`);
export const emittedPath = (fixture: string): string => repoPath(`packages/parity/emitted/${fixture}.css`);
export const vectorPath = (caseId: string): string => repoPath(`packages/layout/vectors/${caseId}.json`);

export const committedAuthored = (c: ParityCase): Promise<WebCapture> => Promise.resolve(JSON.parse(readFileSync(expectedPath(c.id), 'utf8')) as WebCapture);
