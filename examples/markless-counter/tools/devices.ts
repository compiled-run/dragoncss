/** The proof devices: the iPhone 17 simulator's safe-area size in points at 3x, and the Pixel 7 emulator's in whole dp (Chrome viewports are integers; the device is 411.43 dp) at 420 dpi. */
export const DEVICES = {
  ios: { backend: 'uikit', viewport: { width: 402, height: 778 }, dpr: 3 },
  android: { backend: 'android-views', viewport: { width: 411, height: 818 }, dpr: 2.625 },
} as const;
