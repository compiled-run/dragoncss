# WOFF and WOFF2 fixtures

Vendored Lato (`vendor/fonts/Lato`, SIL OFL 1.1, `OFL.txt`) re-encoded for `../woff.test.ts` and the parity web-font tests, with
fontTools 4.60.2 and brotli 1.2.1 in a Python 3.9 venv (`python3 -m venv venv && venv/bin/pip install fonttools brotli`):

```python
from fontTools.ttLib import TTFont, woff2
from fontTools import subset
for name in ['Lato-Regular', 'Lato-Bold']:
    f = TTFont(f'vendor/fonts/Lato/{name}.ttf'); f.flavor = 'woff2'; f.save(f'{name}.woff2')  # glyf and loca transformed
f = TTFont('vendor/fonts/Lato/Lato-Regular.ttf'); f.flavor = 'woff'; f.save('Lato-Regular.woff')
woff2.compress('vendor/fonts/Lato/Lato-Regular.ttf', 'Lato-Regular.hmtx.woff2', transform_tables={'glyf', 'loca', 'hmtx'})
opts = subset.Options(); opts.layout_features = []; opts.hinting = True; opts.notdef_outline = True
f = subset.load_font('vendor/fonts/Lato/Lato-Regular.ttf', opts); s = subset.Subsetter(opts); s.populate(text='Tide Å'); s.subset(f)
subset.save_font(f, 'Lato-Regular.subset.ttf', opts)
woff2.compress('Lato-Regular.subset.ttf', 'Lato-Regular.subset.untransformed.woff2', transform_tables=set())  # null transform
```
