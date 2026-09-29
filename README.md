<p align="center">
  <img src="https://raw.githubusercontent.com/compiled-run/dragoncss/master/docs/assets/readme/dragon-mark.png" alt="" width="160">
</p>

<h1 align="center">Dragon CSS</h1>

<p align="center"><b>Regular CSS for native apps, tested against the browser.</b></p>

You write the CSS you already know. Dragon compiles it into native view properties (UIKit first, Android Views next) and then makes Chrome the judge: every box and every value is compared, number by number.

No runtime CSS parser. No selector matching on the device. No style quietly dropped. If a platform can't do something, you get a build error with the file, the line and a fix.

## What the dragon does with your CSS

```css
.card {
  border-radius: 12px;                   /* layer.cornerRadius = 12 */
  color: light-dark(#222, #eee);         /* a dynamic UIColor */
  font-size: 1.125rem;                   /* scales with UIFontMetrics */
  padding-top: env(safe-area-inset-top); /* the real safe-area insets */
}
```

Where a platform already has the right tool, Dragon uses it instead of reinventing it. The only library that ships to the device is Dragon's layout engine, because positions depend on real content and real screens.

## Proven, not promised

Every feature carries one of three seals, and each seal is earned by a passing comparison against Chrome:

<table>
  <tr><td><img src="https://raw.githubusercontent.com/compiled-run/dragoncss/master/docs/assets/readme/seal-exact.png" alt="" width="40"></td><td><b>exact</b></td><td>Matches Chrome.</td></tr>
  <tr><td><img src="https://raw.githubusercontent.com/compiled-run/dragoncss/master/docs/assets/readme/seal-caveat.png" alt="" width="40"></td><td><b>caveat</b></td><td>Works, with a measured, documented difference.</td></tr>
  <tr><td><img src="https://raw.githubusercontent.com/compiled-run/dragoncss/master/docs/assets/readme/seal-unsupported.png" alt="" width="40"></td><td><b>unsupported</b></td><td>A build error that tells you what to do instead.</td></tr>
</table>

No test, no seal. Missing data means unsupported.

## Status

🥚 Still in the egg. Nothing is released yet. The npm package `dragon` will hatch as `1.0.0-alpha.x` (the old `0.x` versions are an unrelated drag-and-drop library).

[Markless](https://github.com/compiled-run/markless) is the first rider. Dragon takes plain CSS plus a description of the element tree, so any tool that compiles templates can saddle up.

## Read more

- [How Dragon compares](https://github.com/compiled-run/dragoncss/blob/master/docs/compared.md)
- [API design](https://github.com/compiled-run/dragoncss/blob/master/docs/api.md)
- [Research and evidence](https://github.com/compiled-run/dragoncss/blob/master/docs/research/README.md)

MIT licensed.
