// Every probe is a full HTML document (the harness injects only the Ahem face + html{font-family:Ahem}, like parity).
const doc = (style, body) => `<!DOCTYPE html><html><head><style>body{margin:0}${style}</style></head><body>${body}</body></html>`;
export const probes = [];
const add = (p) => probes.push(p);

// ---------------------------------------------------------------- Q1 lookup
add({ id: 'Q1-anchor-name-001-exact', q: 1, title: 'WPT anchor-name-001, verbatim markup (body margin 8px kept)',
  html: `<!DOCTYPE html><html><head><style>
.relpos { position: relative; }
.anchor1 { anchor-name: --a1; width: 10px; height: 10px; background: orange; }
.target { position: absolute; width: anchor-size(--a1 width); height: 10px; background: lime; }
</style></head><body>
  <div class="relpos" id="rel">
    <div class="target" id="t1"></div>
    <div class="anchor1" id="a10" style="width: 10px">
      <div class="anchor1" id="a20" style="width: 20px"></div>
      <div class="target" id="t2"></div>
    </div>
    <div class="anchor1" id="a30" style="width: 30px"></div>
    <div class="target" id="t3"></div>
  </div>
</body></html>` });

const L = `.relpos{position:relative}.a{anchor-name:--a1;width:10px;height:10px}.t{position:absolute;width:anchor-size(--a1 width, 7px);height:10px}.abs{position:absolute}`;
add({ id: 'Q1-ancestor-vs-earlier-descendant', q: 1, title: 'ancestor anchor (10) contains an earlier anchor (20) and the target; nothing later',
  html: doc(L, `<div class="relpos"><div class="a" id="a10" style="width:10px"><div class="a" id="a20" style="width:20px"></div><div class="t" id="t"></div></div></div>`) });
add({ id: 'Q1-ancestor-vs-later-descendant', q: 1, title: 'ancestor anchor (10) contains the target, then a later in-flow anchor (20)',
  html: doc(L, `<div class="relpos"><div class="a" id="a10" style="width:10px"><div class="t" id="t"></div><div class="a" id="a20" style="width:20px"></div></div></div>`) });
add({ id: 'Q1-ancestor-only', q: 1, title: 'only the ancestor anchor (10)',
  html: doc(L, `<div class="relpos"><div class="a" id="a10" style="width:10px"><div class="t" id="t"></div></div></div>`) });
add({ id: 'Q1-later-inflow-sibling', q: 1, title: 'in-flow anchor (30) after the target in tree order',
  html: doc(L, `<div class="relpos"><div class="t" id="t"></div><div class="a" id="a30" style="width:30px"></div></div>`) });
add({ id: 'Q1-later-abspos-sibling', q: 1, title: 'abspos anchor (40) after the target, same containing block',
  html: doc(L, `<div class="relpos"><div class="t" id="t"></div><div class="a abs" id="a40" style="width:40px"></div></div>`) });
add({ id: 'Q1-earlier-abspos-sibling', q: 1, title: 'abspos anchor (40) before the target, same containing block',
  html: doc(L, `<div class="relpos"><div class="a abs" id="a40" style="width:40px"></div><div class="t" id="t"></div></div>`) });
add({ id: 'Q1-anchor-in-later-abspos', q: 1, title: 'anchor (25) inside an abspos box that follows the target',
  html: doc(L, `<div class="relpos"><div class="t" id="t"></div><div class="abs" id="box"><div class="a" id="a25" style="width:25px"></div></div></div>`) });
add({ id: 'Q1-anchor-in-earlier-abspos', q: 1, title: 'anchor (25) inside an abspos box that precedes the target',
  html: doc(L, `<div class="relpos"><div class="abs" id="box"><div class="a" id="a25" style="width:25px"></div></div><div class="t" id="t"></div></div>`) });
add({ id: 'Q1-earlier-and-later-mixed', q: 1, title: 'in-flow 10, target, abspos 40 (unacceptable), in-flow 30 (last acceptable)',
  html: doc(L, `<div class="relpos"><div class="a" id="a10" style="width:10px"></div><div class="t" id="t"></div><div class="a abs" id="a40" style="width:40px"></div><div class="a" id="a30" style="width:30px"></div></div>`) });
add({ id: 'Q1-anchor-is-target-descendant', q: 1, title: 'anchor (20) inside the target itself, earlier in-flow anchor (10)',
  html: doc(L, `<div class="relpos"><div class="a" id="a10" style="width:10px"></div><div class="t" id="t"><div class="a" id="a20" style="width:20px"></div></div></div>`) });

// ---------------------------------------------------------------- Q2 position-visibility
add({ id: 'Q2-computed', q: 2, title: 'position-visibility initial/computed values and flag combination',
  html: doc('', `<div id="static"></div><div id="abs" style="position:absolute"></div><div id="probe" style="position:absolute"></div>`),
  script: `
    const out = { initialStatic: getComputedStyle(byId('static')).positionVisibility, initialAbs: getComputedStyle(byId('abs')).positionVisibility, set: {} };
    const vals = ['always','anchors-valid','anchors-visible','no-overflow','anchors-visible anchors-valid','no-overflow anchors-visible','no-overflow anchors-valid anchors-visible','always no-overflow','initial','inherit'];
    for (const v of vals) { const e = byId('probe'); e.style.positionVisibility = ''; e.style.positionVisibility = v; out.set[v] = { specified: e.style.positionVisibility, computed: getComputedStyle(e).positionVisibility, supports: CSS.supports('position-visibility', v) }; }
    return out;` });

const V = `#cb{position:relative;width:300px;height:300px}#t{position:absolute;width:50px;height:40px;background:green}#c{width:10px;height:10px;background:blue}`;
const vis = { script: `const t = byId('t'); return { checkVisibility: t.checkVisibility(), checkVisibilityVis: t.checkVisibility({visibilityProperty:true}), visibility: getComputedStyle(t).visibility, pv: getComputedStyle(t).positionVisibility, childVisibility: byId('c') ? getComputedStyle(byId('c')).visibility : null };` };
add({ id: 'Q2-anchors-valid-missing-default', q: 2, title: 'anchors-valid, position-anchor names a missing anchor, top: anchor(bottom) (IACVT)',
  html: doc(V, `<div id="cb"><div id="t" style="position-anchor:--missing;left:20px;top:anchor(bottom);position-visibility:anchors-valid"><div id="c"></div></div></div>`),
  points: { tCenter: [45, 20], child: [25, 5] }, ...vis });
add({ id: 'Q2-anchors-valid-missing-with-fallback', q: 2, title: 'anchors-valid, top: anchor(--missing bottom, 30px)',
  html: doc(V, `<div id="cb"><div id="t" style="left:20px;top:anchor(--missing bottom, 30px);position-visibility:anchors-valid"><div id="c"></div></div></div>`),
  points: { tCenter: [45, 50], child: [25, 35] }, ...vis });
add({ id: 'Q2-control-missing-no-flag', q: 2, title: 'control: missing anchor with fallback, position-visibility: always',
  html: doc(V, `<div id="cb"><div id="t" style="left:20px;top:anchor(--missing bottom, 30px);position-visibility:always"><div id="c"></div></div></div>`),
  points: { tCenter: [45, 50], child: [25, 35] }, ...vis });
add({ id: 'Q2-no-overflow-overflowing', q: 2, title: 'no-overflow, no anchor, box overflows 100x100 CB (left:80px width:50px)',
  html: doc(`#cb{position:relative;width:100px;height:100px}#t{position:absolute;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="t" style="left:80px;top:10px;position-visibility:no-overflow"><div id="c"></div></div></div>`),
  points: { tInside: [90, 30], tOutside: [120, 30], child: [85, 15] }, ...vis });
add({ id: 'Q2-no-overflow-fitting', q: 2, title: 'no-overflow, box fits',
  html: doc(`#cb{position:relative;width:100px;height:100px}#t{position:absolute;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="t" style="left:40px;top:10px;position-visibility:no-overflow"><div id="c"></div></div></div>`),
  points: { tCenter: [65, 30], child: [45, 15] }, ...vis });
add({ id: 'Q2-no-overflow-with-anchor', q: 2, title: 'no-overflow with default anchor, box overflows',
  html: doc(`#cb{position:relative;width:100px;height:100px}#a{anchor-name:--a;width:20px;height:20px;margin-left:70px}#t{position:absolute;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:--a;left:anchor(left);top:anchor(bottom);position-visibility:no-overflow"><div id="c"></div></div></div>`),
  points: { tInside: [80, 40], child: [75, 25] }, ...vis });

// anchors-visible: #clip is overflow:hidden and not positioned, so #t's CB is #cb.
const AV = (anchorStyle, pv) => doc(`#cb{position:relative;width:300px;height:300px}#clip{overflow:hidden;width:100px;height:100px;background:#eee}#a{anchor-name:--a;background:orange}#t{position:absolute;position-anchor:--a;left:150px;top:150px;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
  `<div id="cb"><div id="clip"><div id="a" style="${anchorStyle}"></div></div><div id="t" style="${pv}"><div id="c"></div></div></div>`);
const avPts = { points: { tCenter: 't', child: 'c' }, ...vis };
add({ id: 'Q2-av-initial-clipped', q: 2, title: 'no position-visibility declared; anchor fully clipped (margin-top:150px, 20x20)', html: AV('margin-top:150px;width:20px;height:20px', ''), ...avPts });
add({ id: 'Q2-av-always-clipped', q: 2, title: 'position-visibility:always; anchor fully clipped', html: AV('margin-top:150px;width:20px;height:20px', 'position-visibility:always'), ...avPts });
add({ id: 'Q2-av-explicit-clipped', q: 2, title: 'position-visibility:anchors-visible; anchor fully clipped', html: AV('margin-top:150px;width:20px;height:20px', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-partly-clipped', q: 2, title: 'anchors-visible; anchor 20x20 at y=90 (half clipped)', html: AV('margin-top:90px;width:20px;height:20px', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-edge-touching', q: 2, title: 'anchors-visible; anchor 20x20 at y=100 (touches clip edge from outside)', html: AV('margin-top:100px;width:20px;height:20px', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-zero-size-inside', q: 2, title: 'anchors-visible; 0x0 anchor at (0,50), inside clip', html: AV('margin-top:50px;width:0;height:0', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-zero-width-inside', q: 2, title: 'anchors-visible; 0x20 anchor at y=50 inside clip', html: AV('margin-top:50px;width:0;height:20px', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-zero-size-at-edge', q: 2, title: 'anchors-visible; 0x0 anchor at y=100 (on clip bottom edge)', html: AV('margin-top:100px;width:0;height:0', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-zero-size-at-edge-in', q: 2, title: 'anchors-visible; 0x0 anchor at y=99', html: AV('margin-top:99px;width:0;height:0', 'position-visibility:anchors-visible'), ...avPts });
add({ id: 'Q2-av-zero-size-outside', q: 2, title: 'anchors-visible; 0x0 anchor at y=150 (outside clip)', html: AV('margin-top:150px;width:0;height:0', 'position-visibility:anchors-visible'), ...avPts });
const AVA = (anchorStyle, pv) => AV(anchorStyle, pv).replace('#t{position:absolute;position-anchor:--a;left:150px;top:150px;', '#t{position:absolute;position-anchor:--a;left:calc(anchor(left) + 150px);top:anchor(top);');
for (const [n, a, pv] of [['initial-clipped', 'margin-top:150px;width:20px;height:20px', ''], ['always-clipped', 'margin-top:150px;width:20px;height:20px', 'position-visibility:always'], ['partly-clipped', 'margin-top:90px;width:20px;height:20px', ''], ['edge-touching', 'margin-top:100px;width:20px;height:20px', ''], ['edge-overlap-1px', 'margin-top:99px;width:20px;height:20px', ''], ['edge-overlap-1-64px', 'margin-top:99.984375px;width:20px;height:20px', ''],
  ['zero-size-inside', 'margin-top:50px;width:0;height:0', ''], ['zero-width-inside', 'margin-top:50px;width:0;height:20px', ''], ['zero-size-at-edge', 'margin-top:100px;width:0;height:0', ''], ['zero-size-at-top-left-corner', 'margin-top:0;width:0;height:0', ''], ['zero-size-outside', 'margin-top:150px;width:0;height:0', ''],
  ['visibility-hidden-anchor', 'margin-top:50px;width:20px;height:20px;visibility:hidden', ''], ['no-overflow+anchors-visible clipped', 'margin-top:150px;width:20px;height:20px', 'position-visibility:anchors-visible no-overflow']])
  add({ id: `Q2-ava-${n}`, q: 2, title: `ANCHORED target (left:calc(anchor(left)+150px);top:anchor(top)); anchor ${a}; ${pv || 'initial position-visibility'}`, html: AVA(a, pv), ...avPts });
add({ id: 'Q2-ava-child-visibility-visible', q: 2, title: 'anchored target hidden by anchors-visible; its child has visibility:visible explicitly',
  html: AVA('margin-top:150px;width:20px;height:20px', '').replace('<div id="c"></div>', '<div id="c" style="visibility:visible"></div>'), ...avPts });
add({ id: 'Q2-ava-area', q: 2, title: 'position-area:right target; anchor fully clipped', html: AV('margin-top:150px;width:20px;height:20px', 'left:auto;top:auto;position-area:right'), ...avPts });
for (const [n, st] of [['anchor-center only', 'left:auto;top:150px;justify-self:anchor-center'], ['anchor-size only', 'width:anchor-size(width)'], ['named anchor() not default', 'position-anchor:none;left:calc(anchor(--a left) + 150px);top:anchor(--a top)'], ['default + named anchor()', 'left:calc(anchor(--a left) + 150px);top:anchor(--a top)']])
  add({ id: `Q2-ava-kind ${n}`, q: 2, title: `anchor fully clipped (y=150); target uses ${n}: ${st}`, html: AV('margin-top:150px;width:20px;height:20px', st), ...avPts });
add({ id: 'Q2-ava-zero-size-no-clipper', q: 2, title: 'ANCHORED target; 0x0 anchor, no overflow ancestor',
  html: doc(`#cb{position:relative;width:300px;height:300px}#a{anchor-name:--a;width:0;height:0;margin-top:50px}#t{position:absolute;position-anchor:--a;left:calc(anchor(left) + 150px);top:anchor(top);width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t"><div id="c"></div></div></div>`), ...avPts });
add({ id: 'Q2-ava-offscreen-viewport', q: 2, title: 'ANCHORED target at top:10px via calc(anchor(top) - 590px); anchor at y=600 below 400px viewport',
  html: doc(`#cb{position:relative;width:300px;height:1000px}#a{anchor-name:--a;width:20px;height:20px;margin-top:600px}#t{position:absolute;position-anchor:--a;left:calc(anchor(left) + 150px);top:calc(anchor(top) - 590px);width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t"><div id="c"></div></div></div>`), ...avPts });
add({ id: 'Q2-ava-clip-is-cb', q: 2, title: 'ANCHORED; anchor clipped by overflow:hidden that is also the target CB',
  html: doc(`#cb{position:relative;overflow:hidden;width:100px;height:100px}#a{anchor-name:--a;width:20px;height:20px;margin-top:150px}#t{position:absolute;position-anchor:--a;left:calc(anchor(left) + 10px);top:calc(anchor(top) - 140px);width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t"><div id="c"></div></div></div>`), ...avPts });
add({ id: 'Q2-no-overflow-child-visible', q: 2, title: 'no-overflow hidden target, child has visibility:visible',
  html: doc(`#cb{position:relative;width:100px;height:100px}#t{position:absolute;width:50px;height:40px;background:green}#c{width:10px;height:10px;visibility:visible}`,
    `<div id="cb"><div id="t" style="left:80px;top:10px;position-visibility:no-overflow"><div id="c"></div></div></div>`), points: { tInside: [90, 30], child: [85, 15] }, ...vis });
add({ id: 'Q2-no-overflow-scrollable-overflow', q: 2, title: 'no-overflow hidden target: does it still contribute to parent scrollWidth?',
  html: doc(`#cb{position:relative;width:100px;height:100px;overflow:hidden}#t{position:absolute;width:50px;height:40px}`,
    `<div id="cb"><div id="t" style="left:80px;top:10px;position-visibility:no-overflow"></div></div>`), script: `return { scrollWidth: byId('cb').scrollWidth };` });
add({ id: 'Q2-av-zero-size-no-clipper', q: 2, title: 'anchors-visible; 0x0 anchor with no overflow ancestor',
  html: doc(`#cb{position:relative;width:300px;height:300px}#a{anchor-name:--a;width:0;height:0;margin-top:50px}#t{position:absolute;position-anchor:--a;left:150px;top:150px;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t" style="position-visibility:anchors-visible"><div id="c"></div></div></div>`), ...avPts });
add({ id: 'Q2-av-anchor-offscreen-viewport', q: 2, title: 'initial value; anchor below the 400px viewport (no overflow ancestor), target at top',
  html: doc(`#cb{position:relative;width:300px;height:1000px}#a{anchor-name:--a;width:20px;height:20px;margin-top:600px}#t{position:absolute;position-anchor:--a;left:150px;top:150px;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t"><div id="c"></div></div></div>`), ...avPts });
add({ id: 'Q2-av-clip-is-cb', q: 2, title: 'initial value; clipped anchor whose overflow:hidden ancestor is also the target CB (not intervening)',
  html: doc(`#cb{position:relative;overflow:hidden;width:100px;height:100px}#a{anchor-name:--a;width:20px;height:20px;margin-top:150px}#t{position:absolute;position-anchor:--a;left:10px;top:10px;width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t"><div id="c"></div></div></div>`), points: { tCenter: [35, 30], child: [15, 15] }, ...vis });
add({ id: 'Q2-av-no-default-anchor', q: 2, title: 'initial value; no position-anchor; top: anchor(--a bottom) with a clipped anchor',
  html: doc(`#cb{position:relative;width:300px;height:300px}#clip{overflow:hidden;width:100px;height:100px}#a{anchor-name:--a;width:20px;height:20px;margin-top:150px}#t{position:absolute;left:150px;top:calc(anchor(--a bottom) - 20px);width:50px;height:40px;background:green}#c{width:10px;height:10px}`,
    `<div id="cb"><div id="clip"><div id="a"></div></div><div id="t"><div id="c"></div></div></div>`), points: { tCenter: [175, 170], child: [155, 155] }, ...vis });

// ---------------------------------------------------------------- Q3 try order
const TO = (anchorTop, anchorH, targetStyle, extraRules = '') => doc(`#cb{position:relative;width:200px;height:200px}
#a{anchor-name:--a;position:absolute;left:0;top:${anchorTop}px;width:50px;height:${anchorH}px}
@position-try --below{top:anchor(bottom);bottom:auto}
@position-try --below10{top:calc(anchor(bottom) + 10px);bottom:auto}
#t{position:absolute;position-anchor:--a;left:60px;bottom:anchor(top);width:50px;height:50px;${targetStyle}}${extraRules}`,
  `<div id="cb"><div id="a"></div><div id="t"></div></div>`);
add({ id: 'Q3-normal', q: 3, title: 'base IMCB h=80 (fits), --below IMCB h=100; order normal', html: TO(80, 20, 'position-try-fallbacks:--below') });
add({ id: 'Q3-most-height-base-smaller', q: 3, title: 'base IMCB h=80, --below h=100; most-height', html: TO(80, 20, 'position-try-fallbacks:--below;position-try-order:most-height') });
add({ id: 'Q3-most-height-base-larger', q: 3, title: 'base IMCB h=110, --below h=70; most-height', html: TO(110, 20, 'position-try-fallbacks:--below;position-try-order:most-height') });
add({ id: 'Q3-most-height-tie', q: 3, title: 'base IMCB h=90, --below h=90 (tie); most-height', html: TO(90, 20, 'position-try-fallbacks:--below;position-try-order:most-height') });
add({ id: 'Q3-most-height-two-fallbacks', q: 3, title: 'base 80, --below10 90, --below 100 (listed below10 first); most-height', html: TO(80, 20, 'position-try-fallbacks:--below10, --below;position-try-order:most-height') });
add({ id: 'Q3-most-height-fallback-tie', q: 3, title: 'anchor 60..90: base IMCB 60, --below10 100, --below 110; most-height', html: TO(60, 30, 'position-try-fallbacks:--below10, --below;position-try-order:most-height') });
add({ id: 'Q3-most-height-fallbacks-tie', q: 3, title: 'base 80; --belowL (left:0) and --below (left:60) both IMCB 100 (tie), --belowL listed first; most-height',
  html: TO(80, 20, 'position-try-fallbacks:--belowL, --below;position-try-order:most-height', '@position-try --belowL{top:anchor(bottom);bottom:auto;left:0}') });
add({ id: 'Q3-most-height-base-not-fit', q: 3, title: 'base IMCB 80 but box h=90 (base fails), --below10 90 (fits), --below 100 (fits); most-height', html: TO(80, 20, 'height:90px;position-try-fallbacks:--below10, --below;position-try-order:most-height') });
add({ id: 'Q3-most-height-largest-not-fit', q: 3, title: 'box h=95: base 80 (fails), --below10 IMCB 90 (fails), --below 100 fits; order after sort below, below10, base', html: TO(80, 20, 'height:95px;position-try-fallbacks:--below10, --below;position-try-order:most-height') });
add({ id: 'Q3-shorthand', q: 3, title: 'position-try: most-height --below (shorthand); base 80, --below 100', html: TO(80, 20, 'position-try:most-height --below') });
add({ id: 'Q3-most-width-base-smaller', q: 3, title: 'horizontal: base IMCB w=80, --right w=100; most-width',
  html: doc(`#cb{position:relative;width:200px;height:200px}#a{anchor-name:--a;position:absolute;left:80px;top:0;width:20px;height:50px}
@position-try --right{left:anchor(right);right:auto}
#t{position:absolute;position-anchor:--a;top:60px;right:anchor(left);width:50px;height:50px;position-try-fallbacks:--right;position-try-order:most-width}`,
    `<div id="cb"><div id="a"></div><div id="t"></div></div>`) });
add({ id: 'Q3-most-width-normal', q: 3, title: 'horizontal control: same, order normal',
  html: doc(`#cb{position:relative;width:200px;height:200px}#a{anchor-name:--a;position:absolute;left:80px;top:0;width:20px;height:50px}
@position-try --right{left:anchor(right);right:auto}
#t{position:absolute;position-anchor:--a;top:60px;right:anchor(left);width:50px;height:50px;position-try-fallbacks:--right}`,
    `<div id="cb"><div id="a"></div><div id="t"></div></div>`) });
add({ id: 'Q3-computed', q: 3, title: 'position-try-order computed values',
  html: doc('', `<div id="e" style="position:absolute"></div>`),
  script: `const e = byId('e'); const r = { initial: getComputedStyle(e).positionTryOrder };
    for (const v of ['normal','most-width','most-height','most-block-size','most-inline-size']) { e.style.positionTryOrder = ''; e.style.positionTryOrder = v; r[v] = getComputedStyle(e).positionTryOrder; }
    return r;` });

// ---------------------------------------------------------------- Q4 fit predicate
const FIT = (targetStyle) => doc(`#cb{position:relative;width:100px;height:100px;margin:50px}
@position-try --f{top:50px;left:50px;right:auto;bottom:auto;margin:0}
#t{position:absolute;width:20px;height:20px;position-try-fallbacks:--f;${targetStyle}}`,
  `<div id="cb"><div id="t"></div></div>`);
add({ id: 'Q4-control-fits', q: 4, title: 'top:10px;left:10px (fits)', html: FIT('top:10px;left:10px') });
add({ id: 'Q4-imcb-above-cb-box-outside', q: 4, title: 'top:-10px;left:0 (IMCB -10..100, box -10..10)', html: FIT('top:-10px;left:0') });
add({ id: 'Q4-imcb-above-cb-box-inside', q: 4, title: 'top:-10px;margin-top:20px;left:0 (IMCB -10..100, box 10..30 inside CB)', html: FIT('top:-10px;margin-top:20px;left:0') });
add({ id: 'Q4-imcb-wider-box-inside', q: 4, title: 'left:-20px;right:-20px;margin:0 auto;top:10px (IMCB x -20..120, box 40..60)', html: FIT('left:-20px;right:-20px;margin:0 auto;top:10px') });
add({ id: 'Q4-neg-margin-border-outside', q: 4, title: 'top:0;margin-top:-10px;left:0 (border box -10..10, margin box 0..10)', html: FIT('top:0;margin-top:-10px;left:0') });
add({ id: 'Q4-margin-overflow', q: 4, title: 'top:0;left:0;height:90px;margin-bottom:20px (border box in, margin box 0..110)', html: FIT('top:0;left:0;height:90px;margin-bottom:20px') });
add({ id: 'Q4-margin-overflow-right', q: 4, title: 'left:70px;top:0;margin-right:20px (border 70..90, margin box to 110)', html: FIT('left:70px;top:0;margin-right:20px') });
add({ id: 'Q4-neg-imcb-zero-box', q: 4, title: 'top:70px;bottom:70px;height:0;left:0 (IMCB h=-40)', html: FIT('top:70px;bottom:70px;height:0;left:0') });
add({ id: 'Q4-neg-imcb-box', q: 4, title: 'top:70px;bottom:70px;left:0 (IMCB h=-40, box h=20)', html: FIT('top:70px;bottom:70px;left:0') });
add({ id: 'Q4-zero-imcb-zero-box', q: 4, title: 'top:50px;bottom:50px;height:0;left:0 (IMCB h=0, box h=0)', html: FIT('top:50px;bottom:50px;height:0;left:0') });
add({ id: 'Q4-touching-edge', q: 4, title: 'top:80px;left:80px (box 80..100 exactly)', html: FIT('top:80px;left:80px') });
add({ id: 'Q4-over-by-half', q: 4, title: 'top:80.5px;left:0', html: FIT('top:80.5px;left:0') });
add({ id: 'Q4-over-by-1-64', q: 4, title: 'top:80.015625px;left:0 (1/64 px)', html: FIT('top:80.015625px;left:0') });
add({ id: 'Q4-over-by-1-128', q: 4, title: 'top:80.0078125px;left:0 (1/128 px, below LU)', html: FIT('top:80.0078125px;left:0') });
add({ id: 'Q4-imcb-far-outside', q: 4, title: 'top:-50px;left:0 (box -50..-30 entirely above CB, inside IMCB)', html: FIT('top:-50px;left:0') });
add({ id: 'Q4-imcb-left-outside', q: 4, title: 'left:-20px;top:0 (box x -20..0)', html: FIT('left:-20px;top:0') });
add({ id: 'Q4-margin-overflow-bottom', q: 4, title: 'top:0;left:0;height:70px;margin-bottom:40px (margin box 0..110; fallback 50..120? no: fallback h70 -> 50..120 fails)', html: FIT('top:0;left:0;height:40px;margin-bottom:70px') });
add({ id: 'Q4-anchored-imcb-outside', q: 4, title: 'anchored: top:calc(anchor(top) - 30px) with anchor at y=20 (-> -10); left:anchor(left)',
  html: doc(`#cb{position:relative;width:100px;height:100px;margin:50px}#a{anchor-name:--a;position:absolute;left:10px;top:20px;width:10px;height:10px}
@position-try --f{top:50px;left:50px;right:auto;bottom:auto;margin:0}
#t{position:absolute;position-anchor:--a;width:20px;height:20px;position-try-fallbacks:--f;top:calc(anchor(top) - 30px);left:anchor(left)}`, `<div id="cb"><div id="a"></div><div id="t"></div></div>`) });
add({ id: 'Q4-area-overflows-cb', q: 4, title: 'position-area:top with anchor at y=5: area above anchor is -? (min(cbStart,aStart)=0 -> area 0..5), box h=20 overflows area; fallback bottom',
  html: doc(`#cb{position:relative;width:100px;height:100px;margin:50px}#a{anchor-name:--a;position:absolute;left:40px;top:5px;width:20px;height:10px}
#t{position:absolute;position-anchor:--a;width:20px;height:20px;position-area:top;position-try-fallbacks:bottom}`, `<div id="cb"><div id="a"></div><div id="t"></div></div>`) });
add({ id: 'Q4-area-anchor-outside-top', q: 4, title: 'position-area:top with anchor at y=-40 (above CB): area -?..-40; box 20 fits in area but is outside CB; fallback bottom',
  html: doc(`#cb{position:relative;width:100px;height:100px;margin:50px}#a{anchor-name:--a;position:absolute;left:40px;top:-10px;width:20px;height:10px}
#t{position:absolute;position-anchor:--a;width:20px;height:5px;position-area:top;position-try-fallbacks:bottom}`, `<div id="cb"><div id="a"></div><div id="t"></div></div>`) });
add({ id: 'Q4-none-fits', q: 4, title: 'height:150px;top:0;left:0 and fallback also too tall', html: FIT('top:0;left:0;height:150px') });
add({ id: 'Q4-fallback-also-fails', q: 4, title: 'top:-10px, fallback (top:50) overflows via height 60 -> which is used?',
  html: doc(`#cb{position:relative;width:100px;height:100px;margin:50px}
@position-try --f{top:50px;left:50px;right:auto;bottom:auto;margin:0}
#t{position:absolute;width:20px;height:60px;position-try-fallbacks:--f;top:-10px;left:0}`, `<div id="cb"><div id="t"></div></div>`) });

// ---------------------------------------------------------------- Q5 anchor-center clamp
const AC = (anchorLeft, targetStyle) => doc(`#cb{position:relative;width:100px;height:100px;margin:50px}
#a{anchor-name:--a;position:absolute;left:${anchorLeft}px;top:0;width:20px;height:20px}
#t{position:absolute;position-anchor:--a;justify-self:anchor-center;top:50px;width:40px;height:10px;${targetStyle}}`,
  `<div id="cb"><div id="a"></div><div id="t"></div></div>`);
add({ id: 'Q5-left-no-insets', q: 5, title: 'anchor center x=10, no insets (wants -10)', html: AC(0, '') });
add({ id: 'Q5-left-inset-20', q: 5, title: 'anchor center 10, left:20px (IMCB 20..100; IMCB clamp=20, CB clamp=0)', html: AC(0, 'left:20px') });
add({ id: 'Q5-left-inset-neg30', q: 5, title: 'anchor center 10, left:-30px (IMCB -30..100; IMCB clamp=-10, CB clamp=0)', html: AC(0, 'left:-30px') });
add({ id: 'Q5-right-no-insets', q: 5, title: 'anchor center 90, no insets (wants 70)', html: AC(80, '') });
add({ id: 'Q5-right-inset-20', q: 5, title: 'anchor center 90, right:20px (IMCB 0..80; IMCB clamp=40, CB clamp=60)', html: AC(80, 'right:20px') });
add({ id: 'Q5-right-inset-neg30', q: 5, title: 'anchor center 90, right:-30px (IMCB 0..130; IMCB clamp=70, CB clamp=60)', html: AC(80, 'right:-30px') });
add({ id: 'Q5-both-insets', q: 5, title: 'anchor center 10, left:30px;right:10px (IMCB 30..90)', html: AC(0, 'left:30px;right:10px') });
add({ id: 'Q5-too-wide', q: 5, title: 'anchor center 10, width:120px no insets', html: AC(0, 'width:120px') });
const ACW = (s) => doc(`.container{width:100px;height:100px;border:solid 3px;position:relative;margin:50px}
.anchor{anchor-name:--anchor;position:relative;width:50px;height:50px;left:40px;top:40px;background:lime}
.target{position-anchor:--anchor;position:absolute;background:cyan;justify-self:anchor-center;top:anchor(bottom);height:20px;font-size:16px;color:transparent}`,
  `<div class="container"><div class="anchor"></div><div class="target" id="t" style="${s}">a a a a a a a a a a a a a a a a a a</div></div>`);
for (const [s, w, x] of [['', 100, 0], ['max-width: 60px;', 60, 35], ['left: 20px;', 80, 20], ['right: 20px;', 80, 0], ['right: -20px;', 120, 0], ['max-width: 100px; right: -20px;', 100, 15], ['right: -50px;', 150, 0], ['left: 10px; right: 20px;', 70, 10], ['left: 10px; right: -20px;', 110, 10], ['left: -10px; right: -50px;', 160, -10]])
  add({ id: `Q5-wpt-htb-htb ${s || 'no-insets'}`, q: 5, title: `anchor-center-htb-htb (Ahem text child in place of ::after) ${s} WPT expects w=${w} x=${x}`, html: ACW(s), expect: { w, x } });

// ---------------------------------------------------------------- Q6 position-area overflow
const PA = (anchorBox, area, targetStyle, dir = 'ltr') => doc(`#cb{position:relative;width:200px;height:200px;margin:60px;direction:${dir}}
#a{anchor-name:--a;position:absolute;${anchorBox}}
#t{position:absolute;position-anchor:--a;position-area:${area};${targetStyle}}`,
  `<div id="cb"><div id="a"></div><div id="t"></div></div>`);
const areas = ['top left', 'top center', 'top right', 'top span-left', 'top span-right', 'top span-all', 'center left', 'center center', 'bottom span-all', 'left', 'right'];
const anchorsPA = { 'partly-out-left': 'left:-40px;top:80px;width:80px;height:40px', 'partly-out-right': 'left:160px;top:80px;width:80px;height:40px', 'fully-out-left': 'left:-100px;top:80px;width:40px;height:40px', 'partly-out-top': 'left:80px;top:-20px;width:40px;height:40px' };
for (const [an, ab] of Object.entries(anchorsPA))
  for (const area of areas) {
    add({ id: `Q6 ${an} | ${area} | stretch`, q: 6, title: `anchor ${an} (${ab}); position-area:${area}; place-self:stretch (reveals area)`, html: PA(ab, area, 'place-self:stretch') });
    add({ id: `Q6 ${an} | ${area} | 30x10`, q: 6, title: `anchor ${an}; position-area:${area}; 30x10 box, normal alignment`, html: PA(ab, area, 'width:30px;height:10px') });
  }
for (const area of ['top left', 'top span-left', 'top span-all', 'left'])
  add({ id: `Q6 rtl partly-out-left | ${area} | 30x10`, q: 6, title: `rtl CB; anchor partly-out-left; position-area:${area}; 30x10`, html: PA(anchorsPA['partly-out-left'], area, 'width:30px;height:10px', 'rtl') });
for (const [an, ab] of [['inside-near-right', 'left:150px;top:80px;width:30px;height:40px'], ['inside-near-left', 'left:20px;top:80px;width:30px;height:40px']])
  for (const area of ['left', 'right', 'top left', 'top right', 'top span-left', 'top span-right'])
    for (const w of [30, 250])
      add({ id: `Q6 ${an} | ${area} | ${w}x10`, q: 6, title: `anchor ${an} (${ab}); position-area:${area}; ${w}x10`, html: PA(ab, area, `width:${w}px;height:10px`) });
for (const area of ['block-start span-inline-start', 'block-start inline-start', 'block-start span-inline-end', 'span-all start', 'top span-inline-start (invalid mix)'])
  for (const dir of ['ltr', 'rtl'])
    add({ id: `Q6 logical ${dir} | ${area} | stretch`, q: 6, title: `${dir} CB; anchor left:40px..120px; position-area:${area}; stretch`, html: PA('left:40px;top:80px;width:80px;height:40px', area.replace(' (invalid mix)', ''), 'place-self:stretch', dir) });
for (const area of ['right', 'left', 'top span-all'])
  add({ id: `Q6 rtl inside-near-left | ${area} | 250x10`, q: 6, title: `rtl CB; anchor inside-near-left; position-area:${area}; 250x10 (wider than CB)`, html: PA('left:20px;top:80px;width:30px;height:40px', area, 'width:250px;height:10px', 'rtl') });
add({ id: 'Q6 partly-out-left | top span-all | auto-size', q: 6, title: 'auto width (fit-content, Ahem text 5 chars @10px) under span-all',
  html: doc(`#cb{position:relative;width:200px;height:200px;margin:60px}#a{anchor-name:--a;position:absolute;left:-40px;top:80px;width:80px;height:40px}#t{position:absolute;position-anchor:--a;position-area:top span-all;font-size:10px;height:10px}`,
    `<div id="cb"><div id="a"></div><div id="t">xxxxx</div></div>`) });

// ---------------------------------------------------------------- Q7 rounding
const RD = `#cb{position:relative;width:300px;height:300px}#a{anchor-name:--a;position:absolute;left:10.1px;top:5.3px;width:33.3px;height:17.7px}.t{position:absolute;position-anchor:--a;height:3px;width:3px}`;
const rdTargets = {
  r1: 'left:anchor(33.3%);top:40px', r2: 'left:anchor(50%);top:50px', r3: 'left:0;top:60px;width:calc(anchor-size(width) / 3)',
  r4: 'left:calc(anchor(right) / 3);top:70px', r5: 'left:0;top:calc((anchor(top) + anchor(bottom)) / 3)', r6: 'left:calc(anchor(left) * 0.7 + 1.1px);top:90px',
  r7: 'right:anchor(33.3%);top:100px', r8: 'left:0;top:110px;width:anchor-size(width);height:anchor-size(height)', r9: 'left:0;top:140px;width:calc(anchor-size(width) * 0.333)',
  r10: 'left:anchor(center);top:150px', r11: 'left:anchor(66.7%);top:160px', r12: 'left:calc(anchor(left) + anchor-size(width) / 7);top:170px',
  r13: 'left:calc(anchor(33.3%) / 3);top:180px', r14: 'top:anchor(33.3%);left:200px', r15: 'bottom:anchor(33.3%);left:220px',
};
for (const dpr of [1, 2, 2.625])
  add({ id: `Q7-rounding dpr${dpr}`, q: 7, dpr, title: `anchor at left 10.1 top 5.3 size 33.3x17.7; many anchor() / calc() targets; DPR ${dpr}`,
    html: doc(RD, `<div id="cb"><div id="a"></div>${Object.entries(rdTargets).map(([k, s]) => `<div class="t" id="${k}" style="${s}"></div>`).join('')}</div>`),
    script: `const o = {}; for (const id of ['a', ${Object.keys(rdTargets).map((k) => `'${k}'`).join(',')}]) { const cs = getComputedStyle(byId(id)); o[id] = { left: cs.left, top: cs.top, right: cs.right, bottom: cs.bottom, width: cs.width, height: cs.height }; } return o;` });
const RDN = `#cb{position:relative;width:300px;height:300px;margin-left:100px}#a{anchor-name:--a;position:absolute;left:-10.1px;top:5.3px;width:33.3px;height:17.7px}.t{position:absolute;position-anchor:--a;height:3px;width:3px}`;
const rdnTargets = { n1: 'left:anchor(33.3%);top:40px', n2: 'left:calc(0px - anchor-size(width) * 0.333);top:50px', n3: 'left:calc(anchor(left) * 0.7);top:60px', n4: 'left:anchor(left);top:70px', n5: 'left:calc(anchor(left) - 0.3px);top:80px', n6: 'left:anchor(10%);top:90px' };
for (const dpr of [1, 2, 2.625])
  add({ id: `Q7-negative dpr${dpr}`, q: 7, dpr, title: `anchor at left -10.1 (CB shifted by margin-left:100px) size 33.3x17.7; negative results; DPR ${dpr}`,
    html: doc(RDN, `<div id="cb"><div id="a"></div>${Object.entries(rdnTargets).map(([k, s]) => `<div class="t" id="${k}" style="${s}"></div>`).join('')}</div>`),
    script: `const o = {}; for (const id of ['a', ${Object.keys(rdnTargets).map((k) => `'${k}'`).join(',')}]) { const cs = getComputedStyle(byId(id)); o[id] = { left: cs.left }; } return o;` });
add({ id: 'Q7-inflow-fraction-anchor', q: 7, title: 'in-flow anchor with fractional width 33.3% of 100.5px parent',
  html: doc(`#cb{position:relative;width:100.5px;height:100px}#a{anchor-name:--a;width:33.3%;height:10px;margin-left:10.1px}.t{position:absolute;position-anchor:--a;height:3px;width:3px}`,
    `<div id="cb"><div id="a"></div><div class="t" id="r1" style="left:anchor(right);top:20px"></div><div class="t" id="r2" style="left:anchor(33.3%);top:30px"></div><div class="t" id="r3" style="left:0;top:40px;width:calc(anchor-size(width) / 3)"></div></div>`) });

// ---------------------------------------------------------------- Q8 scrollable containing block
const SC = `.scroller{overflow:hidden;position:relative;width:80px;height:80px;margin:10px;border:solid 3px;padding:10px}
.filler{background:orange;min-width:180px;min-height:180px}
.relative{position:relative;left:20px;top:40px}
.anchor{anchor-name:--a}
.target{position-anchor:--a;position:absolute;inset:0;place-self:stretch}`;
const scScript = { script: `const s = byId('s'); return { scrollWidth: s.scrollWidth, scrollHeight: s.scrollHeight };` };
for (const [name, sStyle, fClass, tExtra] of [
  ['block no shift', '', 'filler', ''], ['block relative', '', 'filler relative', ''], ['flex no shift', 'display:flex', 'filler', ''], ['flex relative', 'display:flex', 'filler relative', ''],
  ['block no shift, no position-anchor', '', 'filler', 'position-anchor:none'], ['block relative big (left:60px;top:90px)', '', 'filler', ''],
  ['column-reverse', 'display:flex;flex-direction:column-reverse', 'filler', ''], ['rtl', 'direction:rtl', 'filler', ''],
]) {
  const fStyle = name.includes('big') ? 'position:relative;left:60px;top:90px' : '';
  add({ id: `Q8 ${name}`, q: 8, title: `scrollable-containing-block-size mirror: ${name}`,
    html: doc(SC, `<div class="scroller" id="s" style="${sStyle}"><div class="${fClass}" id="f" style="${fStyle}"><div class="anchor" id="a"></div></div><div class="target" id="t" style="${tExtra}"></div></div>`), ...scScript });
}
add({ id: 'Q8 relative anchor only', q: 8, title: 'the anchor itself is relatively shifted beyond the filler (left:250px;top:250px)',
  html: doc(SC, `<div class="scroller" id="s"><div class="filler" id="f"><div class="anchor" id="a" style="position:relative;left:250px;top:250px;width:10px;height:10px"></div></div><div class="target" id="t"></div></div>`), ...scScript });

// ---------------------------------------------------------------- Q9 feature status
add({ id: 'Q9-supports', q: 9, title: 'CSS.supports and computed values for feature keywords',
  html: doc('', `<div id="e" style="position:absolute"></div>`),
  script: `
    const S = (p, v) => CSS.supports(p, v);
    const e = byId('e'); const cs = () => getComputedStyle(e);
    const set = (p, v) => { e.removeAttribute('style'); e.setAttribute('style', 'position:absolute;' + p + ':' + v); return { inline: e.style.getPropertyValue(p), computed: cs().getPropertyValue(p) }; };
    e.removeAttribute('style'); e.setAttribute('style','position:absolute');
    const initial = { positionAnchor: cs().positionAnchor, anchorName: cs().anchorName, anchorScope: cs().anchorScope, positionArea: cs().positionArea, positionTryFallbacks: cs().positionTryFallbacks, positionTryOrder: cs().positionTryOrder, justifySelf: cs().justifySelf, alignSelf: cs().alignSelf, positionVisibility: cs().positionVisibility };
    const sup = {};
    for (const [p, v] of [['position-anchor','normal'],['position-anchor','auto'],['position-anchor','none'],['position-anchor','match-parent'],['position-anchor','--a'],
      ['anchor-scope','all'],['anchor-scope','--a, --b'],['anchor-scope','none'],['position-try-fallbacks','flip-block'],['position-try-options','flip-block'],['position-try','most-height flip-block'],
      ['position-try-fallbacks','flip-x'],['position-try-fallbacks','flip-y'],['position-try-fallbacks','flip-start'],['position-try-fallbacks','flip-block flip-inline flip-start'],['position-try-fallbacks','bottom right'],['position-try-fallbacks','--x flip-block'],
      ['margin-left','anchor-size(width)'],['margin-top','anchor-size(--a height)'],['top','anchor-size(height)'],['left','anchor-size(--a width)'],['padding-left','anchor-size(width)'],['width','anchor(left)'],['width','anchor-size(width)'],['width','anchor-size(block)'],['width','anchor-size(self-inline)'],['width','anchor-size()'],
      ['top','anchor(inside)'],['top','anchor(outside)'],['left','anchor(--a inside)'],['top','anchor(start)'],['top','anchor(self-end)'],['top','anchor(center)'],['top','anchor(50%)'],['top','anchor(left)'],['top','calc(anchor(bottom) + 5px)'],['top','anchor(bottom, anchor(top, 5px))'],
      ['justify-self','anchor-center'],['align-self','anchor-center'],['place-self','anchor-center'],['position-area','span-all'],['position-area','x-start y-end'],['position-area','self-start'],['inset-area','top'],['position-visibility','anchors-valid anchors-visible']])
      sup[p + ': ' + v] = S(p, v);
    const computed = {};
    for (const [p, v] of [['position-anchor','normal'],['position-anchor','auto'],['position-anchor','match-parent'],['position-anchor','none'],['anchor-scope','--b, --a'],['position-try-fallbacks','flip-y'],['position-try-fallbacks','flip-x'],['position-try-fallbacks','flip-start flip-block'],['position-try-fallbacks','bottom right'],['position-area','span-all'],['position-area','left top'],['top','anchor(inside)'],['top','anchor(outside)'],['justify-self','anchor-center']])
      computed[p + ': ' + v] = set(p, v);
    return { initial, supports: sup, computed };` });

const PT_DESCRIPTORS = ['top: 1px', 'left: 1px', 'right: 1px', 'bottom: 1px', 'inset: 1px', 'inset-block: 1px', 'inset-inline-start: 1px', 'margin: 1px', 'margin-top: 1px', 'margin-inline: 1px', 'width: 1px', 'height: 1px', 'min-width: 1px', 'max-height: 1px', 'block-size: 1px', 'inline-size: 1px', 'justify-self: center', 'align-self: anchor-center', 'place-self: end', 'position-anchor: --x', 'position-area: top', 'position: static', 'color: red', 'padding: 1px', 'position-try-fallbacks: flip-block', 'top: 1px !important', 'top: anchor(bottom)'];
add({ id: 'Q9-position-try-descriptors', q: 9, title: '@position-try: which descriptors the parser keeps',
  html: doc('', `<div id="e"></div>`),
  script: `const out = {}; for (const d of ${JSON.stringify(PT_DESCRIPTORS)}) { const s = document.createElement('style'); s.textContent = '@position-try --x { ' + d + ' }'; document.head.appendChild(s); const r = s.sheet.cssRules[0]; out[d] = r ? (r.style ? r.style.cssText : r.cssText) : 'NO RULE'; s.remove(); } return out;` });

const PTB = (rule, base = 'top:90px;left:0;width:20px;height:20px') => doc(`#cb{position:relative;width:100px;height:100px;margin:50px}#a{anchor-name:--a;position:absolute;left:40px;top:40px;width:20px;height:20px}#b{anchor-name:--b;position:absolute;left:70px;top:70px;width:10px;height:10px}
@position-try --x{${rule}}
#t{position:absolute;position-anchor:--a;${base};position-try-fallbacks:--x}`, `<div id="cb"><div id="a"></div><div id="b"></div><div id="t"></div></div>`);
for (const rule of ['top:10px', 'inset:10px auto auto 30px', 'margin-top:40px;top:0', 'height:5px;top:0', 'max-height:5px;top:0', 'position-anchor:--b;top:anchor(bottom);left:anchor(left)', 'position-area:bottom;top:auto;left:auto', 'top:0;align-self:end;bottom:0', 'top:0;bottom:0;place-self:center', 'inset-block-start:15px', 'top:10px;position:static', 'top:10px;padding-top:30px', 'top:10px !important'])
  add({ id: `Q9-position-try-behavior ${rule}`, q: 9, title: `@position-try --x{${rule}} applied to base top:90px;height:20px (base overflows CB bottom 100)`, html: PTB(rule) });

const FEAT = `#cb{position:relative;width:200px;height:200px;margin:20px}#a{anchor-name:--a;position:absolute;left:40px;top:30px;width:50px;height:20px}#t{position:absolute;width:10px;height:10px}`;
add({ id: 'Q9-position-anchor-normal', q: 9, title: 'position-anchor:normal + position-area:bottom (no implicit anchor)', html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:normal;position-area:bottom"></div></div>`) });
add({ id: 'Q9-position-anchor-initial-area', q: 9, title: 'no position-anchor + position-area:bottom', html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-area:bottom"></div></div>`) });
add({ id: 'Q9-position-anchor-auto-area', q: 9, title: 'position-anchor:auto + position-area:bottom', html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:auto;position-area:bottom"></div></div>`) });
add({ id: 'Q9-position-anchor-normal-anchor-fn', q: 9, title: 'position-anchor:normal; top:anchor(bottom, 77px)', html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:normal;top:anchor(bottom, 77px);left:0"></div></div>`) });
add({ id: 'Q9-match-parent', q: 9, title: 'parent has position-anchor:--a; child abspos with position-anchor:match-parent; top:anchor(bottom);left:anchor(right)',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="p" style="position-anchor:--a"><div id="t" style="position-anchor:match-parent;top:anchor(bottom, 77px);left:anchor(right, 77px)"></div></div></div>`), computed: [['t', 'position-anchor']] });
add({ id: 'Q9-match-parent-parent-none', q: 9, title: 'match-parent where the parent has no position-anchor',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="p"><div id="t" style="position-anchor:match-parent;top:anchor(bottom, 77px);left:anchor(right, 77px)"></div></div></div>`), computed: [['t', 'position-anchor']] });
const SCOPE = `#cb{position:relative}.an{anchor-name:--a;height:10px}.t{position:absolute;height:5px;width:anchor-size(--a width, 7px)}`;
add({ id: 'Q9-anchor-scope-names', q: 9, title: 'two siblings with anchor-scope:--a; each target should see its own anchor (10 / 30); outer target sees neither',
  html: doc(SCOPE, `<div id="cb"><div id="s1" style="anchor-scope:--a"><div class="an" id="a10" style="width:10px"></div><div class="t" id="t1"></div></div><div id="s2" style="anchor-scope:--a"><div class="an" id="a30" style="width:30px"></div><div class="t" id="t2"></div></div><div class="t" id="tOut"></div></div>`) });
add({ id: 'Q9-anchor-scope-all', q: 9, title: 'same with anchor-scope:all',
  html: doc(SCOPE, `<div id="cb"><div id="s1" style="anchor-scope:all"><div class="an" id="a10" style="width:10px"></div><div class="t" id="t1"></div></div><div id="s2" style="anchor-scope:all"><div class="an" id="a30" style="width:30px"></div><div class="t" id="t2"></div></div><div class="t" id="tOut"></div></div>`) });
add({ id: 'Q9-anchor-scope-other-name', q: 9, title: 'anchor-scope:--b does not scope --a (targets see last = 30)',
  html: doc(SCOPE, `<div id="cb"><div id="s1" style="anchor-scope:--b"><div class="an" id="a10" style="width:10px"></div><div class="t" id="t1"></div></div><div id="s2" style="anchor-scope:--b"><div class="an" id="a30" style="width:30px"></div><div class="t" id="t2"></div></div><div class="t" id="tOut"></div></div>`) });
add({ id: 'Q9-anchor-scope-nested', q: 9, title: 'outer scope --a contains anchor 10 and inner scope --a (anchor 20 + tInner); tOuterScope sits in outer scope after inner',
  html: doc(SCOPE, `<div id="cb"><div id="outer" style="anchor-scope:--a"><div class="an" id="a10" style="width:10px"></div><div id="inner" style="anchor-scope:--a"><div class="an" id="a20" style="width:20px"></div><div class="t" id="tInner"></div></div><div class="t" id="tOuterScope"></div></div><div class="an" id="a30" style="width:30px"></div><div class="t" id="tOut"></div></div>`) });
add({ id: 'Q9-anchor-scope-on-anchor', q: 9, title: 'anchor-scope:--a on the anchor element itself; target outside vs inside it',
  html: doc(SCOPE, `<div id="cb"><div class="an" id="a10" style="width:10px;anchor-scope:--a"><div class="t" id="tInside"></div></div><div class="t" id="tOut"></div></div>`) });
add({ id: 'Q9-anchor-size-margin-inset', q: 9, title: 'anchor-size() in margin-left / margin-top / left / top',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:--a;left:anchor-size(width);top:anchor-size(height);margin-left:anchor-size(height);margin-top:anchor-size(--a width)"></div></div>`) });
add({ id: 'Q9-inside-outside', q: 9, title: 'top:anchor(outside) (-> bottom), left:anchor(inside) (-> left); t2 right:anchor(outside) bottom:anchor(inside)',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:--a;top:anchor(outside);left:anchor(inside)"></div><div id="t2" style="position:absolute;width:10px;height:10px;position-anchor:--a;right:anchor(outside);bottom:anchor(inside)"></div></div>`) });
add({ id: 'Q9-try-options-old-name', q: 9, title: 'position-try-options:flip-block (old name) on an overflowing box',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:--a;bottom:anchor(top);left:0;height:40px;position-try-options:flip-block"></div></div>`) });
add({ id: 'Q9-try-fallbacks-flip-block', q: 9, title: 'position-try-fallbacks:flip-block on the same box',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:--a;bottom:anchor(top);left:0;height:40px;position-try-fallbacks:flip-block"></div></div>`) });
add({ id: 'Q9-try-fallbacks-area', q: 9, title: 'position-try-fallbacks: bottom (position-area form), base position-area:top overflows',
  html: doc(FEAT, `<div id="cb"><div id="a"></div><div id="t" style="position-anchor:--a;position-area:top;height:40px;position-try-fallbacks:bottom"></div></div>`) });

// ---------------------------------------------------------------- Q10 tree scopes
// Every target: width: anchor-size(--a width, 7px) resolves the anchor it found; anchors carry distinct widths.
const host = (id, shadowHtml) => `<div id="${id}"></div><template data-host="${id}">${shadowHtml}</template>`;
const attach = `for (const t of document.querySelectorAll('template[data-host]')) { const h = document.getElementById(t.dataset.host); h.attachShadow({mode:'open'}).appendChild(t.content.cloneNode(true)); }`;
const TS = (docStyle, body) => `<!DOCTYPE html><html><head><style>body{margin:0}#cb{position:relative}${docStyle}</style></head><body><div id="cb">${body}</div><script>${attach}</script></body></html>`;
const tgt = (id) => `<div id="${id}" style="position:absolute;height:5px;width:anchor-size(--a width, 7px)"></div>`;
add({ id: 'Q10-light-anchor-shadow-target', q: 10, title: 'anchor in light tree (doc style); target inside shadow root (inline style)',
  html: TS(`#aL{anchor-name:--a;width:11px;height:5px}`, `<div id="aL"></div>${host('h', tgt('tS'))}`) });
add({ id: 'Q10-light-anchor-shadow-target-shadowstyle', q: 10, title: 'anchor in light tree; target in shadow, width set by a shadow <style> rule',
  html: TS(`#aL{anchor-name:--a;width:11px;height:5px}`, `<div id="aL"></div>${host('h', `<style>#tS{position:absolute;height:5px;width:anchor-size(--a width, 7px)}</style><div id="tS"></div>`)}`) });
add({ id: 'Q10-shadow-anchor-light-target', q: 10, title: 'anchor inside shadow root (shadow <style>); target in light tree (doc style)',
  html: TS(`#tL{position:absolute;height:5px;width:anchor-size(--a width, 7px)}`, `${host('h', `<style>#aS{anchor-name:--a;width:13px;height:5px}</style><div id="aS"></div>`)}<div id="tL"></div>`) });
add({ id: 'Q10-shadow-anchor-inline-light-target', q: 10, title: 'anchor inside shadow root with inline style anchor-name; target in light tree (inline style)',
  html: TS('', `${host('h', `<div id="aS" style="anchor-name:--a;width:13px;height:5px"></div>`)}${tgt('tL')}`) });
add({ id: 'Q10-part-anchor-light-target', q: 10, title: 'shadow element named via doc ::part() rule; target in light tree',
  html: TS(`#h::part(p){anchor-name:--a}`, `${host('h', `<div id="aS" part="p" style="width:17px;height:5px"></div>`)}${tgt('tL')}`) });
add({ id: 'Q10-host-anchor-from-shadow', q: 10, title: 'host named via :host{anchor-name} in shadow style; target in light tree',
  html: TS(`#h{width:19px;height:5px}`, `${host('h', `<style>:host{anchor-name:--a}</style>`)}${tgt('tL')}`) });
add({ id: 'Q10-host-anchor-from-shadow-shadow-target', q: 10, title: 'host (not positioned) named via :host{anchor-name}; target inside the same shadow root',
  html: TS(`#h{width:19px;height:5px}`, `${host('h', `<style>:host{anchor-name:--a}</style>${tgt('tS')}`)}`) });
add({ id: 'Q10-light-host-anchor-shadow-target', q: 10, title: 'host named by doc style (anchor-name:--a); target inside its shadow root (inline style)',
  html: TS(`#h{anchor-name:--a;width:19px;height:5px}`, `${host('h', tgt('tS'))}`) });
add({ id: 'Q10-light-ancestor-anchor-shadow-target', q: 10, title: 'light ancestor of the host named by doc style; target in shadow root',
  html: TS(`#anc{anchor-name:--a;width:21px}`, `<div id="anc">${host('h', tgt('tS'))}</div>`) });
add({ id: 'Q10-light-anchor-shadow-target-position-anchor', q: 10, title: 'light sibling anchor (doc style); shadow target uses position-anchor:--a; top:anchor(bottom, 99px)',
  html: TS(`#aL{anchor-name:--a;width:11px;height:5px;margin-top:20px}`, `<div id="aL"></div>${host('h', `<div id="tS" style="position:absolute;position-anchor:--a;top:anchor(bottom, 99px);left:0;width:5px;height:5px"></div>`)}`) });
add({ id: 'Q10-wpt-shadow-higher-tree', q: 10, title: 'WPT anchor-name-shadow-higher-tree structure (host named in doc; shadow target, no positioned CB); expects anchored.left == host.right',
  html: `<!DOCTYPE html><html><head><style>body{margin:0}#host{anchor-name:--higher-anchor;background:lightgray;block-size:100px;inline-size:200px;margin:50px}</style></head><body><div id="host"></div><template data-host="host"><style>#anchored{background:green;block-size:50px;inline-size:50px;inset-block-start:anchor(--higher-anchor start, 37px);inset-inline-start:anchor(--higher-anchor end, 37px);position:absolute}</style><div id="anchored"></div></template><script>${attach}</script></body></html>` });
add({ id: 'Q10-same-shadow', q: 10, title: 'anchor and target in the same shadow root',
  html: TS('', `${host('h', `<div id="aS" style="anchor-name:--a;width:13px;height:5px"></div>${tgt('tS')}`)}`) });
add({ id: 'Q10-two-shadows', q: 10, title: 'two shadow roots each with anchor --a (13 / 23) and a target; plus a light anchor 11 first',
  html: TS('', `<div id="aL" style="anchor-name:--a;width:11px;height:5px"></div>${host('h1', `<div id="aS1" style="anchor-name:--a;width:13px;height:5px"></div>${tgt('tS1')}`)}${host('h2', `<div id="aS2" style="anchor-name:--a;width:23px;height:5px"></div>${tgt('tS2')}`)}${tgt('tL')}`) });
add({ id: 'Q10-slotted-anchor', q: 10, title: 'light child (doc-style anchor-name) slotted into shadow; target in shadow root',
  html: TS(`#aL{anchor-name:--a;width:11px;height:5px}`, `<div id="h"><div id="aL"></div></div><template data-host="h"><slot></slot>${tgt('tS')}</template>`) });
add({ id: 'Q10-slotted-target', q: 10, title: 'light target slotted into shadow; anchor in shadow root (inline style)',
  html: TS('', `<div id="h">${tgt('tL')}</div><template data-host="h"><div id="aS" style="anchor-name:--a;width:13px;height:5px"></div><slot></slot></template>`) });
add({ id: 'Q10-shadow-anchor-light-position-anchor', q: 10, title: 'anchor in shadow (inline), light target uses position-anchor:--a with top:anchor(bottom, 99px)',
  html: TS('', `${host('h', `<div id="aS" style="anchor-name:--a;width:13px;height:5px;margin-top:20px"></div>`)}<div id="tL" style="position:absolute;position-anchor:--a;top:anchor(bottom, 99px);left:0;width:5px;height:5px"></div>`) });
