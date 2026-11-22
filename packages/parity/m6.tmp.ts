import { launchChrome } from './src/chrome.ts';
for (const dpr of [1, 2, 2.625, 3]) {
  const browser = await launchChrome(dpr);
  const page = await browser.newPage({ viewport: { width: 400, height: 120 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  const cancel = async (style: string) => {
    await page.setContent(`<!DOCTYPE html><style>body{margin:0;font-family:Ahem}</style><input type=search value=XX style="${style}">`);
    const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let r = '';
    const walk = async (n: any) => { if ((n.attributes ?? []).includes('-webkit-search-cancel-button')) { const bm = await cdp.send('DOM.getBoxModel', { nodeId: n.nodeId }); const q = bm.model.border; r = `${q[0]},${q[1]} ${q[2] - q[0]}x${q[5] - q[1]}`; const vp = 0; } for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? [])]) await walk(c); };
    await walk(doc.root);
    const rects = await page.evaluate(() => { const e = document.querySelector('input')!; const b = e.getBoundingClientRect(); return `${b.width}x${b.height}`; });
    return `${r} input ${rects}`;
  };
  const line: string[] = [];
  for (const fs of [10, 13.333, 16, 17.5, 20]) line.push(`fs${fs}: ${await cancel(`font-size:${fs}px`)}`);
  console.log('dpr', dpr, line.join(' | '));
  if (dpr === 1) {
    for (const ap of ['textfield', 'auto', 'searchfield', 'none']) console.log(' appearance', ap, await cancel(`font-size:16px;appearance:${ap}`));
    for (const ap of ['textfield', 'auto', 'searchfield']) {
      await page.setContent(`<!DOCTYPE html><style>body{margin:0;font-family:Ahem}</style><input type=search value=XX style="font-size:16px;appearance:${ap};width:300px;padding:12px 16px;border:1px solid #ccc;border-radius:999px;background:#fff;box-sizing:border-box">`);
      const a = (await page.screenshot()).toString('base64');
      await page.setContent(`<!DOCTYPE html><style>body{margin:0;font-family:Ahem}</style><input type=search value=XX style="font-size:16px;width:300px;padding:12px 16px;border:1px solid #ccc;border-radius:999px;background:#fff;box-sizing:border-box">`);
      console.log(' pixels appearance', ap, 'vs default:', a === (await page.screenshot()).toString('base64') ? 'SAME' : 'DIFFERENT');
    }
    for (const z of [1.5, 2]) console.log(' zoom', z, await cancel(`font-size:16px;zoom:${z}`));
  }
  await browser.close();
}
