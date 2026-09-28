// P4 item 8 type cases: outputs.android exists only when android is configured, and android needs { minSdk: number }.
import { createProject } from '../src/index.ts';
import type { FrontEndResult } from '../src/index.ts';

declare const input: FrontEndResult;
const withAndroid = createProject({ projectId: 'p', targets: { android: { minSdk: 29 } } }).compile(input);
export const androidOutput = withAndroid.outputs.android;
export const androidTarget = withAndroid.targets.android;
export const androidExplain = withAndroid.explain({ target: 'android', at: { node: 'a', instance: 'doc' }, property: 'width' });
// @ts-expect-error ios is not configured beside android
export const noIos = withAndroid.outputs.ios;

const iosOnly = createProject({ projectId: 'p', targets: { ios: { minimum: '15.0' } } }).compile(input);
// @ts-expect-error android is not configured: no outputs.android
export const noAndroid = iosOnly.outputs.android;

// @ts-expect-error android needs a minSdk
export const emptyAndroid = createProject({ projectId: 'p', targets: { android: {} } });
// @ts-expect-error minSdk is a number
export const stringSdk = createProject({ projectId: 'p', targets: { android: { minSdk: '29' } } });
