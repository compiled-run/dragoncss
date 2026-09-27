// Negative type cases (docs/api.md §2.2), checked by tsc -b: absent target keys are TypeScript errors.
import { createProject } from '../src/index.ts';
import type { FrontEndResult } from '../src/index.ts';

declare const input: FrontEndResult;
const compiled = createProject({ projectId: 'p', targets: { ios: { minimum: '15.0' } } }).compile(input);
export const iosOutput = compiled.outputs.ios;
// @ts-expect-error web is not configured
export const web = compiled.outputs.web;
// @ts-expect-error android is not a configured key
export const android = compiled.outputs.android;
// @ts-expect-error there is no public properties() reader
export const reader = compiled.properties;
