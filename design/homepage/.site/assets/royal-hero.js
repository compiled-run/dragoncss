/* Royal hero: builds the full-viewport Dragon CSS hero inside every <header class="royal-hero">.
   Markup: <header class="royal-hero" data-headline="Regular CSS, <em>proven</em> in every realm"
             data-sub="..." data-cue-href="#letter" data-cue-label="Read the letter"></header>
   Opening plays on every load; add ?once to the URL to play it once per visit. Any click, scroll or key skips it.
   Also exports RoyalHero.enableSnapAndFocus(selector). Works from file:// (no fetch or XHR). */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = (script && script.src ? script.src.replace(/[^/]*([?#].*)?$/, '') : 'assets/') + 'hero-layers/';
  var reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  var TAU = Math.PI * 2;
  var EASE = 'cubic-bezier(.25,.1,.25,1)';
  var SOAK = [
    { opacity: 0, transform: 'translateY(10px)', filter: 'blur(1.6px)' },
    { opacity: 1, transform: 'none', filter: 'blur(0)' },
  ];
  // Banner geometry inside the cropped 1080x570 emblem frame (hero frame x - 380).
  var FW = 1080, FH = 570;
  var BANNERS = [{ x0: 25, x1: 404, y0: 60, y1: 318, pole: 264 }, { x0: 670, x1: 1043, y0: 60, y1: 318, pole: 814 }];
  var STRIP = 3, BREEZE = 3.2;

  // Stars cropped from the hero, scattered near the edges: [sprite, left, top, width(px), inner?]
  var STARS = [
    [1, '5%', '31%', 24], [3, '13%', '22%', 20, 1], [2, '3.5%', '55%', 16],
    [2, '94%', '30%', 22], [1, '86%', '19%', 18, 1], [3, '96%', '52%', 17],
    [2, '22%', '8%', 14, 1], [1, '76%', '7%', 15, 1],
  ];

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function img(name, cls) {
    var i = el('img', cls, { src: BASE + name, alt: '', decoding: 'async', draggable: 'false' });
    return i;
  }
  function drift(cls, style, params) {
    var d = el('div', 'rh-drift ' + cls);
    if (style) d.setAttribute('style', style);
    d._drift = params;
    return d;
  }

  function build(host) {
    if (host._royalHero) return host._royalHero;
    var ds = host.dataset;
    var headline = ds.headline || 'Regular CSS, <em>proven</em> in every realm';
    var sub = ds.sub || '';
    var cueHref = ds.cueHref || '';
    var cueLabel = ds.cueLabel || 'Read the letter';
    host.textContent = '';

    // Edges: scenery, clouds, stars, vines.
    var edges = el('div', 'rh-edges', { 'aria-hidden': 'true' });
    var sceneL = drift('rh-scene rh-scene--left', '', { ax: 7, ay: 3, px: 23, py: 31, ph: 0 });
    sceneL.appendChild(img('scene-left.png', 'rh-scene-art'));
    var sceneR = drift('rh-scene rh-scene--right', '', { ax: 7, ay: 3, px: 23, py: 31, ph: Math.PI });
    sceneR.appendChild(img('scene-right.png', 'rh-scene-art'));
    var cL = drift('rh-cloud', 'left:48.3%;top:14.1%;width:24.3%', { ax: 16, ay: 1.5, px: 42, py: 13, ph: 0 });
    cL.appendChild(img('cloud-left.png'));
    sceneL.appendChild(cL);
    var cR = drift('rh-cloud', 'left:32.1%;top:13.8%;width:37.7%', { ax: 16, ay: 1.5, px: 42, py: 13, ph: 2 });
    cR.appendChild(img('cloud-right.png'));
    sceneR.appendChild(cR);
    var sky1 = drift('rh-cloud rh-cloud--sky', 'left:clamp(120px, 21vw, 420px);top:9%;width:clamp(70px, 8vw, 150px);opacity:.55', { ax: 40, ay: 2, px: 57, py: 17, ph: 1 });
    sky1.appendChild(img('cloud-left.png'));
    var sky2 = drift('rh-cloud rh-cloud--sky', 'right:clamp(120px, 20vw, 400px);top:13%;width:clamp(90px, 10vw, 200px);opacity:.5', { ax: 48, ay: 2, px: 64, py: 19, ph: 3 });
    sky2.appendChild(img('cloud-right.png'));
    var stars = el('div', 'rh-stars');
    STARS.forEach(function (s, i) {
      var st = drift('rh-star' + (s[4] ? ' rh-star--inner' : ''), 'left:' + s[1] + ';top:' + s[2] + ';width:' + s[3] + 'px', { ax: 3, ay: 2, px: 17 + i * 3, py: 21 + i * 2, ph: i });
      st.appendChild(img('star-' + s[0] + '.png'));
      stars.appendChild(st);
    });
    // Vines counter-drift against the scenery.
    var vL = drift('rh-vine rh-vine--left', '', { ax: -5, ay: -2.5, px: 23, py: 31, ph: 0 });
    vL.appendChild(img('vine-left.png'));
    var vR = drift('rh-vine rh-vine--right', '', { ax: -5, ay: -2.5, px: 23, py: 31, ph: Math.PI });
    vR.appendChild(img('vine-right.png'));
    var gScene = el('div', 'rh-wrap rh-g-scene');
    gScene.append(sceneL, sceneR, sky1, sky2, stars);
    var gVines = el('div', 'rh-wrap rh-g-vines');
    gVines.append(vL, vR);
    edges.append(gScene, gVines);

    // Centre: emblem layers.
    var center = el('div', 'rh-center');
    var emblem = el('div', 'rh-emblem', { role: 'img', 'aria-label': 'Dragon CSS: a crowned dragon crest between raised banners' });
    var wFlags = el('div', 'rh-wrap');
    var canvas = el('canvas', 'rh-layer rh-art rh-flags', { width: FW, height: FH });
    wFlags.appendChild(canvas);
    var wEmblem = el('div', 'rh-wrap');
    wEmblem.appendChild(img('royal-emblem.png', 'rh-layer rh-art'));
    var wCrown = el('div', 'rh-wrap');
    wCrown.appendChild(img('royal-crown.png', 'rh-layer rh-art'));
    var glint = el('div', 'rh-layer rh-glint');
    emblem.append(wFlags, wEmblem, wCrown, glint);

    var words = el('div', 'rh-words');
    var h1 = el('h1', 'rh-headline');
    h1.innerHTML = headline;
    words.appendChild(h1);
    if (sub) { var p = el('p', 'rh-sub'); p.innerHTML = sub; words.appendChild(p); }
    if (cueHref) {
      var cue = el('a', 'rh-cue', { href: cueHref });
      cue.innerHTML = '<span class="rh-cue-label"></span><svg class="rh-cue-arrow" viewBox="0 0 16 22" aria-hidden="true"><path d="M8 1v18M2 13l6 7 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      cue.firstChild.textContent = cueLabel;
      cue.addEventListener('click', function (e) {
        var t = document.querySelector(cueHref);
        if (!t) return;
        e.preventDefault();
        t.scrollIntoView({ behavior: reduceMQ.matches ? 'auto' : 'smooth', block: 'center' });
        if (history.replaceState) history.replaceState(null, '', cueHref);
      });
      words.appendChild(cue);
    }
    center.append(emblem, words);
    host.append(edges, center);

    var api = { host: host, play: null, finish: null };
    host._royalHero = api;
    animate(host, {
      gScene: gScene, gVines: gVines, wFlags: wFlags, wEmblem: wEmblem, wCrown: wCrown, glint: glint, words: words,
      canvas: canvas, drifters: [].slice.call(host.querySelectorAll('.rh-drift')),
    }, api);
    return api;
  }

  function animate(host, n, api) {
    var reduce = reduceMQ.matches;

    // Ambient life: slow drift on out-of-step periods, never with the mouse.
    var t0 = performance.now(), visible = true;
    if ('IntersectionObserver' in window)
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(host);
    function ambient(now) {
      if (visible) {
        var t = (now - t0) / 1000;
        for (var i = 0; i < n.drifters.length; i++) {
          var d = n.drifters[i], q = d._drift;
          var x = q.ax * (0.75 * Math.sin(TAU * t / q.px + q.ph) + 0.25 * Math.sin(TAU * t / 9.7 + 1.3 + q.ph));
          var y = q.ay * Math.sin(TAU * t / q.py + 0.8 + q.ph);
          d.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
        }
      }
      requestAnimationFrame(ambient);
    }
    if (!reduce) requestAnimationFrame(ambient);

    // Flags: unfurl outward from the pole, then wind. Drawn in vertical strips; displacement is zero at the pole.
    var ctx = n.canvas.getContext('2d');
    var src = new Image();
    src.src = BASE + 'royal-banners.png';
    var wind = !reduce, unfurlStart = null, unfurlDur = 1300, clock0 = performance.now(), drawn = false;
    function drawFlags(now) {
      var t = (now - clock0) / 1000;
      var since = unfurlStart === null ? Infinity : now - unfurlStart;
      var u = unfurlStart === null ? 1 : Math.min(1, Math.max(0, since / unfurlDur));
      var reachEased = 1 - Math.pow(1 - u, 3);
      var gust = unfurlStart === null || since < 0 ? 0 : 9 * Math.exp(-since / 900);
      if (visible || !drawn) {
        ctx.clearRect(0, 0, FW, FH);
        for (var bi = 0; bi < BANNERS.length; bi++) {
          var b = BANNERS[bi], reach = Math.max(b.pole - b.x0, b.x1 - b.pole);
          for (var x = b.x0; x < b.x1; x += STRIP) {
            var dist = Math.abs(x - b.pole);
            if (dist > reachEased * reach + 12) continue;
            var w = Math.min(1, Math.max(0, (dist - 10) / 220));
            var dir = x < b.pole ? -1 : 1;
            var amp = (wind ? BREEZE : 0) + gust;
            var dy = amp * w * (0.7 * Math.sin(dir * x * 0.045 - t * 1.4) + 0.3 * Math.sin(dir * x * 0.11 - t * 2.3 + 1.1));
            ctx.drawImage(src, x, b.y0, STRIP, b.y1 - b.y0, x, b.y0 + dy, STRIP, b.y1 - b.y0);
          }
        }
        drawn = true;
      }
      if (!reduce || unfurlStart !== null) requestAnimationFrame(drawFlags);
    }
    src.onload = function () { requestAnimationFrame(drawFlags); };

    // The coronation timeline (ms at normal pace).
    var running = [], unfurlTimer = 0;
    // The gold ring: flares fast, lingers near full while it spreads, then fades slowly. Same every time it plays.
    var GLINT = [
      { opacity: 0, '--rh-r': '0%' }, { opacity: 1, '--rh-r': '16%', offset: .1 },
      { opacity: .95, '--rh-r': '70%', offset: .45 }, { opacity: .8, '--rh-r': '110%', offset: .72 },
      { opacity: .4, '--rh-r': '135%', offset: .9 }, { opacity: 0, '--rh-r': '150%' },
    ];
    var GLINT_MS = 2600, GLINT_EASE = 'cubic-bezier(.3,.1,.3,1)';
    // Every so often after the opening, the crown shines again: exactly the same gold ring, only while the hero is on screen.
    var shineTimer = 0;
    function shineLater() {
      clearTimeout(shineTimer);
      shineTimer = setTimeout(function () {
        var busy = running.some(function (a) { return a.playState === 'running'; });
        if (visible && !busy && !document.hidden) {
          n.glint.animate(GLINT, { duration: GLINT_MS, easing: GLINT_EASE });
        }
        shineLater();
      }, 9000 + Math.random() * 5000);
    }
    function play(pace) {
      pace = pace || 1;
      running.forEach(function (a) { a.cancel(); });
      running = []; clearTimeout(unfurlTimer);
      unfurlStart = Infinity;
      function at(target, keyframes, delay, duration, easing) {
        running.push(target.animate(keyframes, { delay: delay * pace, duration: duration * pace, easing: easing || EASE, fill: 'both' }));
      }
      at(n.gScene, SOAK, 0, 1500);                                      // 1. the realm appears at the edges
      at(n.wFlags, [{ opacity: 0 }, { opacity: 1 }], 950, 350);         // 2. banners raised
      unfurlTimer = setTimeout(function () { unfurlStart = performance.now(); unfurlDur = 1300 * pace; }, 950 * pace);
      at(n.wEmblem, SOAK, 1600, 1400);                                  // 3. the name is inked
      at(n.wCrown, [                                                    // 4. the coronation
        { opacity: 0, transform: 'translateY(-38px)', easing: 'cubic-bezier(.45,0,.75,.6)' },
        { opacity: 1, transform: 'translateY(2px)', offset: .72, easing: 'ease-out' },
        { transform: 'translateY(-1px)', offset: .86, easing: 'ease-in-out' },
        { opacity: 1, transform: 'translateY(0)' },
      ], 2700, 1150, 'linear');
      at(n.glint, GLINT, 3750, GLINT_MS, GLINT_EASE);     // 5. gold fanfare ring from the crown
      at(n.gVines, SOAK, 4000, 1500);                                   // 6. the frame
      // 7. the proclamation: each line glides up in turn. No blur on text (it rasterises, then snaps sharp).
      [].forEach.call(n.words.children, function (line, i) {
        at(line, [{ opacity: 0, transform: 'translate3d(0, 18px, 0)' }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
          4200 + i * 260, 1500, 'cubic-bezier(.16, 1, .3, 1)');
      });
    }
    function finish() {
      running.forEach(function (a) { a.finish(); });
      clearTimeout(unfurlTimer);
      unfurlStart = null;
    }
    api.play = play;
    api.finish = finish;
    api.setWind = function (on) { wind = !!on && !reduce; };   // the banners' breeze (gusts while unfurling are unaffected)

    if (reduce) return;
    shineLater();
    var once = new URLSearchParams(location.search).has('once');
    var KEY = 'dragon-opening-played';
    var seen = false;
    try { seen = once && sessionStorage.getItem(KEY); sessionStorage.setItem(KEY, '1'); } catch (e) {}
    play(1);
    if (seen) { finish(); return; }
    // Skip only on a click or Escape. Scrolling, wheel, arrows and space step sections and let the opening keep playing.
    function skip(e) {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && e.target.closest && e.target.closest('[data-rh-keep]')) return;   // control bars do not end the ceremony
      finish();
      ['pointerdown', 'keydown'].forEach(function (ev) { removeEventListener(ev, skip, true); });
    }
    ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, skip, { capture: true, passive: true }); });
  }

  // Scroll snap and focus mode: the section nearest the viewport centre is fully opaque, the rest fade to .25.
  function enableSnapAndFocus(selector) {
    var root = document.documentElement;
    root.style.scrollSnapType = 'none';   // stepping is handled below: one gesture moves one section
    var sections = [].slice.call(document.querySelectorAll(selector || '.royal-hero'));
    sections.forEach(function (s) { s.classList.add('rh-snap', 'rh-focusable'); });
    var queued = false, current = null;
    function update() {
      queued = false;
      var mid = innerHeight / 2, best = null, bestD = Infinity;
      sections.forEach(function (s) {
        var r = s.getBoundingClientRect();
        var d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
        if (d === 0) d = Math.abs((r.top + r.bottom) / 2 - mid) / 1e4;   // among sections spanning the centre, prefer the most centred
        if (d < bestD) { bestD = d; best = s; }
      });
      if (best === current) return;
      current = best;
      sections.forEach(function (s) {
        s.classList.toggle('rh-dim', s !== best);
        if (s === best) s.removeAttribute('data-rh-dim'); else s.setAttribute('data-rh-dim', '');
      });
    }
    function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);

    // One gesture = one section. Tall sections page through first, then the next gesture steps on.
    var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var locked = false, acc = 0, accTimer = 0;
    function index() { return Math.max(0, sections.indexOf(current)); }
    function centreTop(s) {
      var r = s.getBoundingClientRect(), y = scrollY + r.top;
      return r.height >= innerHeight ? y : y - (innerHeight - r.height) / 2;   // tall: align top; short: centre
    }
    function go(i) {
      i = Math.max(0, Math.min(sections.length - 1, i));
      locked = true;
      scrollTo({ top: Math.max(0, centreTop(sections[i])), behavior: reduceMotion ? 'auto' : 'smooth' });
      setTimeout(function () { locked = false; }, reduceMotion ? 50 : 750);
    }
    // A section taller than the screen pages through in screen-sized steps before the next gesture leaves it,
    // so its bottom is always shown. Returns true when it handled the gesture.
    function pageInside(dir) {
      var s = current; if (!s) return false;
      var r = s.getBoundingClientRect(), room = dir > 0 ? r.bottom - innerHeight : -r.top;
      if (r.height <= innerHeight + 2 || room <= 2) return false;
      locked = true;
      scrollBy({ top: dir * Math.min(room, innerHeight * 0.85), behavior: reduceMotion ? 'auto' : 'smooth' });
      setTimeout(function () { locked = false; }, reduceMotion ? 50 : 750);
      return true;
    }
    function step(dir) {
      if (locked) return;
      if (pageInside(dir)) return;
      var i = index() + dir;
      if (i < 0 || i >= sections.length) return;   // past the first or last section: stay put, never snap back
      go(i);
    }
    addEventListener('wheel', function (e) {
      if (e.ctrlKey) return;
      e.preventDefault();
      if (locked) return;
      acc += e.deltaY; clearTimeout(accTimer); accTimer = setTimeout(function () { acc = 0; }, 180);
      if (Math.abs(acc) < 30) return;             // ignore tiny trackpad jitter
      var dir = acc > 0 ? 1 : -1; acc = 0; step(dir);
    }, { passive: false });
    addEventListener('keydown', function (e) {
      if (/input|textarea|select|button|summary/i.test((e.target.tagName || '')) || (e.target.closest && e.target.closest('a[href], [role=button], [contenteditable]'))) return;   // keys on controls belong to them
      var k = e.key, dir = (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) ? 1 : (k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) ? -1 : 0;
      if (!dir) return;
      e.preventDefault(); step(dir);
    });
    var ty = null;
    addEventListener('touchstart', function (e) { ty = e.touches[0].clientY; }, { passive: true });
    addEventListener('touchend', function (e) {
      if (ty === null) return; var dy = ty - e.changedTouches[0].clientY; ty = null;
      if (Math.abs(dy) < 40) return; var dir = dy > 0 ? 1 : -1;
      step(dir);
    }, { passive: true });

    update();
    return { update: update, sections: sections, go: go };
  }

  function init() {
    [].forEach.call(document.querySelectorAll('.royal-hero'), build);
  }
  window.RoyalHero = { init: init, build: build, enableSnapAndFocus: enableSnapAndFocus };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
