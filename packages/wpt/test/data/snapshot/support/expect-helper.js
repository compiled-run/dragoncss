// Synthetic helper written for packages/wpt (not a WPT file): sets data-expected-width from data-test-units.
function expectWidths() {
  for (const el of document.querySelectorAll('[data-test-units]')) el.setAttribute('data-expected-width', String(10 * Number(el.dataset.testUnits)));
}
