// Capture platforms (docs/decisions.md, Linux lane scope): committed Chrome references are keyed by the platform they were
// captured on. Milestone 1's reference is darwin-arm64; the Linux lane is written but unavailable (not run).
// The modules that define them, not the package entries: a script that needs only the platform (ua:capture) keeps the whole
// compiler and engine out of its regen inputs.
import { REFERENCE_PLATFORM as ENGINE_REFERENCE } from '../../layout/src/platform.ts';
import { REFERENCE_PLATFORM as COMPILER_REFERENCE } from '../../dragon/src/ua/datasets.ts';

/** The platform the committed Chrome references, the UA dataset and the platform rules were captured on. */
export const REFERENCE_PLATFORM = 'darwin-arm64';

if (ENGINE_REFERENCE !== REFERENCE_PLATFORM || COMPILER_REFERENCE !== REFERENCE_PLATFORM) {
  throw new Error(`reference platforms disagree: parity ${REFERENCE_PLATFORM}, engine ${ENGINE_REFERENCE}, compiler ${COMPILER_REFERENCE}`);
}

/** Playwright 1.58.2 runs headless Chromium as the chromium-headless-shell build (chromium.js). */
export const BROWSER_FLAVOUR = 'chromium-headless-shell';

/** The platform of this process, as the capture key: process.platform-process.arch, for example darwin-arm64 or linux-x64. */
export function hostPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

export const REFERENCE_REQUIRED = `reference platform ${REFERENCE_PLATFORM} required; Linux lane unavailable`;

/**
 * The live parity suite compares live captures with the committed references, which exist only for the reference platform. On
 * any other platform it fails with this message, never passing silently; that platform's lane is parity:platform-check.
 */
export function requireReferencePlatform(platform: string): void {
  if (platform !== REFERENCE_PLATFORM) throw new Error(`${REFERENCE_REQUIRED} (this is ${platform}; run pnpm run parity:capture and pnpm run parity:platform-check ${platform} instead)`);
}

/** The Linux lane as the reports list it until a Linux run is recorded (docs/decisions.md). */
export const LINUX_LANE = { lane: 'linux-chrome', platform: 'linux-x64', status: 'unavailable (not run)', workflow: '.github/workflows/parity.yml (workflow_dispatch only, not pushed)' } as const;
