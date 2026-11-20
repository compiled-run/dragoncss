// The web column's device handling with the device stubbed: Chrome on the Mac plays the phone's browser, following the appearance
// the stubbed device commands set, so each assignment is measured under its band's preference and every device change is undone.
import { BAND_KEY } from 'dragon';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { marklessStyleExport, parseMarklessStyleInput, schemeOf } from '../src/markless-style-input.ts';
import type { MarklessStyleExport } from '../src/markless-style-input.ts';
import type { WebColumnDevice, WebColumnHost } from '../src/markless-web-column.ts';
import { withCleanup } from '../src/markless-style-compare.ts';
import { PREFERENCE_READS, webColumn } from '../src/markless-web-column.ts';

const TEXT = JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Page',
  nodes: [{ kind: 'element', id: 'h0', element: 'div', parent: null, attributes: { class: 'box' } }],
  css: ':root { color-scheme: light dark; } .box { height: 40px; } @media (prefers-color-scheme: dark) { .box { height: 60px; } }',
  states: [],
});
const input = parseMarklessStyleInput(TEXT);
const exported: MarklessStyleExport = { ...marklessStyleExport(TEXT, 'web-column.json').exported, fontMode: 'system' };
const ANDROID: WebColumnDevice = { target: 'android', serial: 'emulator-5554' };
const IOS: WebColumnDevice = { target: 'ios', udid: 'SIM-UDID' };

let browser: Browser;
beforeAll(async () => {
  browser = await launchChrome(1);
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

type Fake = { readonly host: WebColumnHost; readonly log: string[]; readonly contexts: BrowserContext[]; readonly appearance: () => string };

/**
 * A device whose browser takes `lag` page loads after an appearance change to prefer the new scheme (never, for Infinity), and
 * whose command `fail` names throws.
 */
function fakeDevice(device: WebColumnDevice, start: string, lag: number, fail: (args: string) => boolean = () => false): Fake {
  const log: string[] = [];
  const contexts: BrowserContext[] = [];
  let appearance = start;
  let previous = start;
  let loads = 0;
  const dark = (a: string): boolean => a === 'dark' || a === 'yes';
  const run = (cmd: string, args: readonly string[]): string => {
    const line = [cmd, ...args].join(' ');
    log.push(line);
    if (fail(line)) throw new Error(`${line} failed`);
    const set = (value: string): string => {
      previous = appearance;
      appearance = value;
      loads = 0;
      return '';
    };
    if (device.target === 'ios' && args[0] === 'simctl' && args[1] === 'ui') return args[4] === undefined ? `${appearance}\n` : set(args[4]);
    if (args.slice(2).join(' ') === 'shell cmd uimode night') return `Night mode: ${appearance}\n`;
    if (args.slice(2, 5).join(' ') === 'shell cmd uimode') return set(args[6] as string);
    if (args.slice(2).join(' ') === 'shell settings get global debug_app') return 'null\n';
    return '';
  };
  const t = exported.targets[device.target]!;
  const open = (_device: WebColumnDevice, url: string): void => {
    log.push(`open ${new URL(url).searchParams.get('i')}`);
    const prefers = loads++ < lag ? previous : appearance;
    void (async () => {
      const context = await browser.newContext({ viewport: t.viewport, deviceScaleFactor: t.dpr });
      contexts.push(context);
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: dark(prefers) ? 'dark' : 'light' });
      await page.goto(url);
    })();
  };
  return { host: { run, open, screenshot: () => {}, wait: async () => {} }, log, contexts, appearance: () => appearance };
}

const wants = (target: 'ios' | 'android'): ('light' | 'dark')[] => exported.targets[target]!.assignments.map((a) => schemeOf(exported.targets[target]!.bands, a.values[BAND_KEY] as number));

describe('the web column sets the device\'s appearance per assignment', () => {
  it('the export has an assignment in each scheme', () => {
    expect(wants('android')).toEqual(['light', 'dark']);
    expect(wants('ios')).toEqual(['light', 'dark']);
  });

  for (const [device, start, setting] of [[ANDROID, 'no', (s: string) => `adb -s emulator-5554 shell cmd uimode night ${s === 'dark' ? 'yes' : 'no'}`], [IOS, 'light', (s: string) => `xcrun simctl ui SIM-UDID appearance ${s}`]] as const) {
    it(`${device.target}: switches before each assignment whose band reads the other scheme, waits for the browser, and restores the original`, async () => {
      const fake = fakeDevice(device, start, 2);
      try {
        const r = await webColumn(input, exported, device, [], undefined, fake.host);
        expect(r.compared).toBeGreaterThan(0);
        const expected: string[] = [];
        let current: 'light' | 'dark' = 'light';
        for (const [i, want] of wants(device.target).entries()) {
          if (want !== current) {
            expected.push(setting(want), `open ${i}`, `open ${i}`, `open ${i}`);
            current = want;
          } else expected.push(`open ${i}`);
        }
        if (current !== 'light') expected.push(setting('light'));
        expect(fake.log.filter((l) => l.startsWith('open') || / appearance (light|dark)$| night (yes|no)$/.test(l))).toEqual(expected);
        expect(fake.appearance()).toBe(start);
      } finally {
        for (const c of fake.contexts) await c.close();
      }
    }, 120_000);
  }

  it('fails by name when the browser never follows the appearance, and still restores the device and removes what it set up', async () => {
    const fake = fakeDevice(ANDROID, 'no', Infinity);
    try {
      const first = wants('android').indexOf('dark');
      await expect(webColumn(input, exported, ANDROID, [], undefined, fake.host)).rejects.toThrow(`android assignment ${first}: the browser still prefers light ${PREFERENCE_READS} reads after the device's appearance was set to dark`);
      expect(fake.appearance()).toBe('no');
      expect(fake.log.slice(-4)).toEqual(['adb -s emulator-5554 shell cmd uimode night no', expect.stringMatching(/^adb -s emulator-5554 reverse --remove tcp:\d+$/), 'adb -s emulator-5554 shell am clear-debug-app', 'adb -s emulator-5554 shell rm -f /data/local/tmp/chrome-command-line']);
    } finally {
      for (const c of fake.contexts) await c.close();
    }
  }, 120_000);

  it('runs every cleanup step when one throws, and keeps the original error with the cleanup failure attached', async () => {
    const fake = fakeDevice(ANDROID, 'no', Infinity, (l) => l.includes('reverse --remove'));
    try {
      const error = await webColumn(input, exported, ANDROID, [], undefined, fake.host).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).message).toMatch(/^android assignment \d+: the browser still prefers light .*; and cleanup \(remove the adb reverse\) failed: adb -s emulator-5554 reverse --remove tcp:\d+ failed$/);
      expect(((error as AggregateError).errors[0] as Error).message).toMatch(/the browser still prefers light/);
      expect(fake.log.slice(-3)).toEqual([expect.stringMatching(/reverse --remove/), 'adb -s emulator-5554 shell am clear-debug-app', 'adb -s emulator-5554 shell rm -f /data/local/tmp/chrome-command-line']);
      expect(fake.appearance()).toBe('no');
    } finally {
      for (const c of fake.contexts) await c.close();
    }
  }, 120_000);

  it('fails a run that succeeded when a cleanup step fails, after running every other step', async () => {
    const fake = fakeDevice(ANDROID, 'no', 0, (l) => l.endsWith('clear-debug-app'));
    try {
      await expect(webColumn(input, exported, ANDROID, [], undefined, fake.host)).rejects.toThrow('cleanup (restore the debug app) failed: adb -s emulator-5554 shell am clear-debug-app failed');
      expect(fake.log.at(-1)).toBe('adb -s emulator-5554 shell rm -f /data/local/tmp/chrome-command-line');
      expect(fake.appearance()).toBe('no');
    } finally {
      for (const c of fake.contexts) await c.close();
    }
  }, 120_000);

  it('fails by name when the browser posts a result that is not JSON, and serves nothing for a request that names no assignment', async () => {
    const fake = fakeDevice(ANDROID, 'no', 0);
    const statuses: number[] = [];
    const host: WebColumnHost = {
      ...fake.host,
      open: (_device, url) => {
        const u = new URL(url);
        void (async () => {
          statuses.push((await fetch(`${u.origin}/page`)).status, (await fetch(`${u.origin}/favicon.ico`)).status);
          await fetch(`${u.origin}/result?i=${u.searchParams.get('i')}`, { method: 'POST', body: '{"dpr":' });
        })();
      },
    };
    await expect(webColumn(input, exported, ANDROID, [], undefined, host)).rejects.toThrow('android: the browser posted assignment 0\'s result as no JSON');
    expect(statuses).toEqual([404, 404]);
    expect(fake.appearance()).toBe('no');
  });

  it('withCleanup rethrows the body\'s own error untouched when every step succeeds', async () => {
    const original = new Error('measuring failed');
    const ran: string[] = [];
    await expect(withCleanup(async (undo) => {
      undo('a', () => void ran.push('a'));
      undo('b', () => void ran.push('b'));
      throw original;
    })).rejects.toBe(original);
    expect(ran).toEqual(['b', 'a']);
  });
});
