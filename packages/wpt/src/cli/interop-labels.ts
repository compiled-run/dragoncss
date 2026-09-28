// pnpm wpt:interop-labels --metadata <wpt-metadata checkout>: re-derives packages/wpt/interop-labels.json from the checkout,
// which must be at the wpt-metadata commit pinned in packages/wpt/wpt.lock (git clone https://github.com/web-platform-tests/wpt-metadata).
import { writeFileSync } from 'node:fs';
import { checkoutCommit, deriveInteropLabels, interopLabelsPath, serializeInteropLabels } from '../interop.ts';
import { lockedMetadataCommit } from '../paths.ts';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const at = argv.indexOf('--metadata');
const checkout = at >= 0 ? argv[at + 1] : process.env.DRAGON_WPT_METADATA_DIR;
if (checkout === undefined || checkout === '') throw new Error('pass --metadata <wpt-metadata checkout> or set DRAGON_WPT_METADATA_DIR');
const head = checkoutCommit(checkout);
const pinned = lockedMetadataCommit();
if (head !== pinned) throw new Error(`${checkout} is at ${head}, but packages/wpt/wpt.lock pins wpt-metadata ${pinned}`);
const labels = deriveInteropLabels(checkout, head);
writeFileSync(interopLabelsPath(), serializeInteropLabels(labels));
console.log(`wrote ${interopLabelsPath()}: ${Object.keys(labels.labels).length} CSS-bearing labels, ${Object.keys(labels.excluded).length} excluded`);
