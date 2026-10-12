// Fixture group env (ENV-SAFE): css-env-1 env(safe-area-inset-*). The rejects join the parity corpus. The layout fixtures are
// web-only (ENV_FIXTURES, env-run.ts): Chrome renders them under Emulation.setSafeAreaInsetsOverride, and native targets refuse
// env() until the native runtime reads the root view's insets, so they run the chrome-dual lane alone. Each names the insets it is
// captured with, in whole CSS px (the override takes integers only).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

/** The safe-area insets Chrome reports to a fixture, in CSS px. */
export type SafeAreaInsets = { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

/** A web-only env() fixture and the insets it is rendered with. */
export type EnvFixture = { readonly spec: FixtureSpec; readonly safeArea: SafeAreaInsets };

const envFixture = (id: string, safeArea: SafeAreaInsets): EnvFixture => ({ spec: layout(id, ['ltr', 'rtl']), safeArea });

export const ENV_FIXTURES: readonly EnvFixture[] = [
  // An iPhone in portrait: a status bar and a home indicator.
  envFixture('env-safe-area-portrait', { top: 47, right: 0, bottom: 34, left: 0 }),
  // The same phone in landscape: the notch and the rounded corners on both sides.
  envFixture('env-safe-area-landscape', { top: 0, right: 47, bottom: 21, left: 47 }),
  // Chrome's default: every inset is 0 and a fallback is never used.
  envFixture('env-safe-area-zero', { top: 0, right: 0, bottom: 0, left: 0 }),
  // Four different insets, so a side read from the wrong inset shows.
  envFixture('env-safe-area-math', { top: 13, right: 7, bottom: 29, left: 3 }),
];

export const ENV: readonly FixtureSpec[] = [
  reject('reject-env-unknown-fallback', 'DRAGON_UNSUPPORTED_VALUE', 'env(nope, 5px)', 'width: env(nope,5px) is unsupported: env(nope) is not a safe-area inset, so Chrome uses its fallback'),
  reject('reject-env-keyboard', 'DRAGON_UNSUPPORTED_VALUE', 'env(keyboard-inset-height, 0px)', 'padding-bottom: env(keyboard-inset-height,0px) is unsupported: env(keyboard-inset-height) reads the on-screen keyboard'),
];
