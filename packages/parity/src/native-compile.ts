// The native generation compile, apart from native-host.ts so that shapedCaseIds (text-latin-run.ts) can share it
// without pulling the native host's toolchain, shim and lane modules into the import closure of every step that lists cases.
import type { Compiled, Environment } from 'dragon';
import { createProjectWith, NO_FAULTS } from 'dragon';
import { fixtureInput } from './cases.ts';
import { fontMapOf, withFontMapAssets } from './fixture-groups/fonts.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { ENVIRONMENT } from './fixtures.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

export const NATIVE_CONFIG = { ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;

/** The lane compile (item 9): ios and android together, derive mode, one per fixture and direction. */
/** nativeRealFaces: lower real bundled faces natively (TXT1a-2 phase C), off by default until phase R; tests of that lowering turn it on. */
export function nativeCompile(spec: FixtureSpec, direction: Environment['direction'], nativeRealFaces = false): Compiled<'ios' | 'android'> {
  if (spec.kind !== 'layout') throw new Error(`${spec.id} is not a layout fixture`);
  // MQ-a: every native case runs in the parity environment's viewport, so its @media band is the one holding it.
  // TXT1a-2: a real-font fixture compiles with its font map and the map's vendored faces as assets, as pipeline.ts compileFixture does.
  const fonts = fontMapOf(spec.id);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG }, ...(fonts === undefined ? {} : { fonts }) }, { faults: NO_FAULTS, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.rootFont, foldViewport: ENVIRONMENT.viewport, nativeRealFaces, interactionLanes: true });
  return project.compile(fonts === undefined ? fixtureInput(spec) : withFontMapAssets(fixtureInput(spec), fonts));
}

const compiles = new Map<string, Compiled<'ios' | 'android'>>();

/** nativeCompile without real faces, once per fixture and direction in a process: nativeCases, engineCases and shapedCaseIds share it. */
export function nativeCompileOnce(spec: FixtureSpec, direction: Environment['direction']): Compiled<'ios' | 'android'> {
  const key = `${spec.id}\0${direction}`;
  let c = compiles.get(key);
  if (c === undefined) {
    c = nativeCompile(spec, direction);
    compiles.set(key, c);
  }
  return c;
}
