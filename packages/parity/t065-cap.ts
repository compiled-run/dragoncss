import { animCasesOf, animFixtures, frameScript, runFrameScript, trackedProperties } from './src/anim-cases.ts';
import { launchChrome } from './src/chrome.ts';
import { captureFrames } from './src/frame-capture.ts';
import { rtInterpolate } from '@dragon/layout';
const browser = await launchChrome(1);
for (const id of process.argv.slice(2)) {
  const c = animCasesOf(animFixtures().find((f) => f.id === id)!)[0]!;
  const steps = frameScript(c);
  const cap = await captureFrames(browser, c, steps, 1);
  const dumps = runFrameScript(c, steps);
  let bad = 0;
  cap.samples.forEach((s, i) => {
    const d = dumps[i]!;
    for (const n of s.nodes) {
      for (const [p, v] of Object.entries(n.computed ?? {})) {
        const mine = d.frame.get(`${n.id}|${p}`);
        if (mine === undefined) continue;
        const str = rtInterpolate.serializeValue(mine, 0, 0, { sin: Math.sin, cos: Math.cos });
        if (str !== v) { bad++; if (bad < 8) console.log(id, s.at, n.id, p, 'chrome', v, 'ts', str); }
      }
    }
  });
  console.log(id, 'samples', cap.samples.length, 'mismatches', bad, 'tracked', trackedProperties(c.ap).length);
}
await browser.close();
