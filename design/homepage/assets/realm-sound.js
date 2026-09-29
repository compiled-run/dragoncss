/* Realm sound: a small Web Audio engine shared by the 07a-07d quest-map variants. Everything is synthesised; no files.
   Sound is on by default (the choice is kept in localStorage 'dragon-sound'; '0' means off), but browsers only allow
   audio after a user gesture, so no AudioContext exists until the first pointer or key press anywhere on the page.
   That press only wakes the engine; nothing plays until an interaction sound is due. Nothing ever plays on load.
   Default sounds are short and quiet feedback for the reader's own actions (chime, rustle, seal, dice, crackle);
   music, drone, ambience beds and the drum are opt-in from the bar.

   Voices: pluck (Karplus-Strong lute/harp), strum, phrase (melodies), drone (open fifths), fanfare (brass),
   quill (scratch grains), seal (wax thud), chime (map-pin bell), sparkle (spell), clink, horn, dice, rustle, drum.
   Ambience beds: wind, birds (owls by night), torch crackle, silence.
   RealmSound.stats counts scheduled nodes per voice, for tests. */
(function () {
  'use strict';
  var ctx = null, master = null, bus = null, send = null, vol = 0.35 * 0.9, suspendTimer = 0;
  var KEY = 'dragon-sound', on = true;
  try { on = localStorage.getItem(KEY) !== '0'; } catch (e) {}
  var stats = { contextCreated: false, contextCreatedAt: null, scheduled: 0, voices: {} };
  function count(name, n) { stats.scheduled += n || 1; stats.voices[name] = (stats.voices[name] || 0) + 1; }

  var A4 = 440;
  function hz(midi) { return A4 * Math.pow(2, (midi - 69) / 12); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---- Context and master chain: voices -> bus (dry) + send (hall reverb) -> master -> gentle compressor -> out ----
  function impulse(seconds, decay) {
    var sr = ctx.sampleRate, len = Math.floor(sr * seconds), buf = ctx.createBuffer(2, len, sr);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) {
        lp += 0.35 * ((Math.random() * 2 - 1) - lp);            // darker tail: stone hall, not a tin can
        d[i] = lp * Math.pow(1 - i / len, decay) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return buf;
  }
  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    stats.contextCreated = true; stats.contextCreatedAt = performance.now();
    master = ctx.createGain(); master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    var tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 9000; tone.Q.value = 0.3;
    master.connect(tone); tone.connect(comp); comp.connect(ctx.destination);
    bus = ctx.createGain(); bus.connect(master);
    var verb = ctx.createConvolver(); verb.buffer = impulse(2.8, 3.2);
    var verbOut = ctx.createGain(); verbOut.gain.value = 0.55;
    send = ctx.createGain(); send.connect(verb); verb.connect(verbOut); verbOut.connect(master);
    document.addEventListener('visibilitychange', function () {
      if (!ctx || !on) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
    return ctx;
  }
  // Route a voice to the dry bus and (by `wet`) to the hall.
  function out(node, wet) {
    node.connect(bus);
    if (wet) { var g = ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(send); }
    return node;
  }
  function live() { return on && ctx && ctx.state !== 'closed'; }
  function now() { return ctx.currentTime + 0.01; }
  function env(g, t, a, peak, d, sus, r, end) {   // ADSR on a gain param
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.setTargetAtTime(sus, t + a, d / 3);
    if (end !== undefined) { g.setTargetAtTime(0.0001, end, r / 4); }
  }

  var noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    var len = ctx.sampleRate * 3; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0), b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < len; i++) {                           // soft pink-ish noise (Paul Kellet, economy)
      var w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    return noiseBuf;
  }
  function noiseSrc(loop) { var s = ctx.createBufferSource(); s.buffer = noise(); s.loop = !!loop; return s; }

  // ---- Karplus-Strong pluck, rendered once per pitch and cached ----
  var ksCache = {};
  function ksBuffer(freq, bright, seconds) {
    var key = freq.toFixed(2) + '|' + bright;
    if (ksCache[key]) return ksCache[key];
    var sr = ctx.sampleRate, len = Math.floor(sr * seconds), N = sr / freq - 0.5, n = Math.floor(N), frac = N - n;   // the averaging filter adds half a sample
    var buf = ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
    // Excitation: filtered noise, combed at the plucking point (1/7 of the string) for a round, woody tone.
    var ex = new Float32Array(n + 2), lp = 0;
    for (var i = 0; i < ex.length; i++) { lp += bright * ((Math.random() * 2 - 1) - lp); ex[i] = lp; }
    var pp = Math.max(1, Math.floor(n / 7));
    for (i = ex.length - 1; i >= pp; i--) ex[i] -= ex[i - pp];
    var decay = 0.4985 + Math.min(0.0013, freq / 700000);    // lower strings ring a touch longer
    for (i = 0; i < len; i++) {
      if (i < ex.length) { y[i] = ex[i]; continue; }
      var y2 = i - n - 2 >= 0 ? y[i - n - 2] : 0;             // fractional delay by linear interpolation, then the two-point average
      y[i] = decay * ((1 - frac) * y[i - n] + frac * y[i - n - 1] + (1 - frac) * y[i - n - 1] + frac * y2);
    }
    var peak = 0; for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
    if (peak) for (i = 0; i < len; i++) y[i] /= peak;
    ksCache[key] = buf;
    return buf;
  }
  function pluck(freq, t, gain, opts) {
    if (!live()) return;
    opts = opts || {};
    t = t || now();
    var src = ctx.createBufferSource(); src.buffer = ksBuffer(freq, opts.bright || 0.55, opts.seconds || 2.4);
    var body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = opts.body || 240; body.Q.value = 1.1; body.gain.value = 4;
    var soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = opts.cut || 3600; soft.Q.value = 0.4;
    var g = ctx.createGain(); g.gain.value = gain === undefined ? 0.28 : gain;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(body); body.connect(soft); soft.connect(g);
    if (pan) { pan.pan.value = opts.pan || 0; g.connect(pan); out(pan, opts.wet === undefined ? 0.35 : opts.wet); } else out(g, 0.35);
    src.start(t); src.stop(t + (opts.seconds || 2.4));
    count('pluck');
  }
  // A strum: the notes of a chord, low to high, a few ms apart.
  function strum(midis, t, spread, gain) {
    if (!live()) return;
    t = t || now();
    for (var i = 0; i < midis.length; i++) pluck(hz(midis[i]), t + i * (spread || 0.028), (gain || 0.22) * (1 - i * 0.06), { pan: (i / midis.length - 0.5) * 0.5 });
    count('strum');
  }

  // ---- Melodies (MIDI notes; 0 is a rest). Greensleeves is a 16th-century tune; the others are modal walks. ----
  var TUNES = {
    greensleeves: [57, 60, 62, 64, 66, 64, 62, 59, 55, 57, 59, 60, 57, 57, 56, 57, 59, 56, 52,
                   57, 60, 62, 64, 66, 64, 62, 59, 55, 57, 59, 60, 59, 57, 56, 54, 56, 57, 57],
    dorian: [62, 65, 69, 67, 65, 64, 62, 0, 60, 62, 64, 65, 67, 65, 64, 62, 57, 60, 62, 0,
             69, 71, 72, 71, 69, 67, 65, 64, 62, 64, 65, 62],
    pentatonic: [60, 62, 64, 67, 69, 67, 64, 62, 0, 64, 67, 69, 72, 69, 67, 64, 62, 60, 0,
                 67, 69, 72, 74, 72, 69, 67, 64, 67, 62, 60],
  };
  // Durations in beats, shaped so Greensleeves keeps its lilt (long-short in 6/8).
  var LILT = { greensleeves: [1, 2, 1, 1.5, .5, 1, 2, 1, 1.5, .5, 1, 2, 1, 1.5, .5, 1, 2, 1, 2,
                              1, 2, 1, 1.5, .5, 1, 2, 1, 1.5, .5, 1, 1.5, .5, 1, 1.5, .5, 1, 3, 1] };
  var tunePos = {};
  // Play the next `len` notes of a tune, with a soft bass on the first beat.
  function phrase(name, len, beat) {
    if (!live()) return 0;
    var tune = TUNES[name] || TUNES.greensleeves, lilt = LILT[name];
    var pos = tunePos[name] || 0, t = now() + 0.02, bt = beat || 0.26;
    len = len || 8;
    for (var i = 0; i < len; i++) {
      var k = (pos + i) % tune.length, m = tune[k], d = lilt ? lilt[k] : (i % 4 === 3 ? 2 : 1);
      if (m) pluck(hz(m), t, 0.24 + (i === 0 ? 0.05 : 0), { pan: 0.15 });
      if (i === 0 && m) pluck(hz(m - 12), t, 0.16, { pan: -0.2, cut: 2000 });
      t += d * bt;
    }
    tunePos[name] = (pos + len) % tune.length;
    count('phrase');
    return t - now();
  }

  // ---- Drone: open fifths (D-A-d) on soft reeds through a breathing low-pass ----
  var drone = null;
  function setDrone(enable, rootMidi) {
    if (!enable) {
      if (drone) { var d = drone; drone = null; d.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6); setTimeout(function () { d.stop(); }, 3000); }
      return;
    }
    if (!live() || drone) return;
    var root = rootMidi || 38, t = now(), oscs = [];
    var g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.085, t, 1.2);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; var lfoG = ctx.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(t);
    [[root, 0], [root + 7, -4], [root + 12, 3], [root + 19, -2]].forEach(function (n, i) {
      var o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = hz(n[0]); o.detune.value = n[1];
      var og = ctx.createGain(); og.gain.value = [0.5, 0.45, 0.3, 0.16][i];
      o.connect(og); og.connect(lp); o.start(t); oscs.push(o);
    });
    lp.connect(g); out(g, 0.5);
    drone = { g: g, stop: function () { oscs.concat([lfo]).forEach(function (o) { try { o.stop(); } catch (e) {} }); } };
    count('drone', oscs.length + 1);
  }

  // ---- Brass: two detuned saws, a filter that opens on the attack (the "blat"), and a late vibrato ----
  function brass(midi, t, dur, gain, pan) {
    var f = hz(midi), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(f * 7, t + 0.05);
    lp.frequency.setTargetAtTime(f * 4, t + 0.06, 0.12);
    env(g.gain, t, 0.035, gain, 0.12, gain * 0.72, 0.18, t + dur);
    var vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.2;
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(dur > 0.4 ? 7 : 0, t + Math.min(dur, 0.6));
    vib.connect(vg);
    [-5, 5].forEach(function (det) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      vg.connect(o.detune); o.connect(lp); o.start(t); o.stop(t + dur + 0.4);
    });
    vib.start(t); vib.stop(t + dur + 0.4);
    lp.connect(g);
    var p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan || 0; g.connect(p); out(p, 0.45); } else out(g, 0.45);
    count('brass', 4);
  }
  function timpani(t, midi, gain) {
    var o = ctx.createOscillator(), g = ctx.createGain(), f = hz(midi || 43);
    o.type = 'sine'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain || 0.5, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g); out(g, 0.3); o.start(t); o.stop(t + 1.3);
    var n = noiseSrc(), lp = ctx.createBiquadFilter(), ng = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    ng.gain.setValueAtTime(0.4 * (gain || 0.5), t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    n.connect(lp); lp.connect(ng); out(ng, 0.2); n.start(t, rand(0, 2)); n.stop(t + 0.2);
    count('timpani', 2);
  }
  // A royal fanfare in C: pickup triplet, the call, and a held chord with a timpani roll. `pace` stretches it.
  function fanfare(pace, delay) {
    if (!live()) return 0;
    pace = pace || 1;
    var t = now() + (delay || 0), s = 0.16 * pace;
    var lead = [[67, 1], [67, 1], [67, 1], [72, 3], [67, 1.5], [72, 1.5], [76, 6]];
    var harm = [[64, 1], [64, 1], [64, 1], [67, 3], [64, 1.5], [67, 1.5], [72, 6]];
    var x = t;
    for (var i = 0; i < lead.length; i++) {
      var d = lead[i][1] * s;
      brass(lead[i][0], x, d * 0.92, 0.16, 0.18);
      brass(harm[i][0], x, d * 0.92, 0.11, -0.22);
      if (i === lead.length - 1) brass(60, x, d * 0.95, 0.12, 0), brass(48, x, d * 0.95, 0.09, 0);
      x += d;
    }
    timpani(t, 43, 0.35); timpani(t + 3 * s, 36, 0.45);
    for (var r = 0; r < 8; r++) timpani(x - 6 * s + r * 0.07 * pace, 36, 0.12 + r * 0.03);
    count('fanfare');
    return x - t;
  }
  // A gentle call: the fanfare's last two notes and a soft held chord, under a second, no timpani.
  function flourish() {
    if (!live()) return 0;
    var t = now();
    brass(67, t, 0.14, 0.07, 0.15); brass(64, t, 0.14, 0.05, -0.2);
    brass(72, t + 0.18, 0.62, 0.075, 0.15); brass(67, t + 0.18, 0.62, 0.055, -0.2); brass(60, t + 0.18, 0.62, 0.05, 0);
    count('flourish');
    return 0.8;
  }
  // Two short notes on a herald's horn.
  function horn(midiA, midiB) {
    if (!live()) return;
    var t = now();
    brass(midiA || 67, t, 0.16, 0.12, 0.1); brass(midiB || 74, t + 0.2, 0.5, 0.12, 0.1);
    count('horn');
  }

  // ---- Quill: short scratch grains of band-passed noise, like a nib on paper ----
  function quill(t, len, gain) {
    if (!live()) return;
    t = t || now(); len = len || 0.08;
    var n = noiseSrc(), bp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.6; bp.frequency.setValueAtTime(rand(2600, 4200), t); bp.frequency.linearRampToValueAtTime(rand(2000, 5200), t + len);
    hp.type = 'highpass'; hp.frequency.value = 1200;
    var a = gain || 0.22;
    g.gain.setValueAtTime(0.0001, t);
    // A stroke is a few jittery pressure pulses.
    var steps = Math.max(2, Math.round(len / 0.018));
    for (var i = 1; i <= steps; i++) g.gain.linearRampToValueAtTime(a * rand(0.35, 1), t + (i / steps) * len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.02);
    n.connect(bp); bp.connect(hp); hp.connect(g); out(g, 0.08);
    n.start(t, rand(0, 2.5)); n.stop(t + len + 0.05);
    count('quill');
  }
  // A written line: strokes of varied length with small lifts of the pen.
  function quillLine(seconds) {
    if (!live()) return;
    var t = now(), end = t + (seconds || 1.2);
    while (t < end) { var l = rand(0.04, 0.14); quill(t, l, rand(0.12, 0.24)); t += l + rand(0.02, 0.09); }
  }

  // ---- Wax seal: a soft low thump, the wax squish, and a small click of the stamp ----
  function seal(level) {
    if (!live()) return;
    var t = now(), L = level === undefined ? 0.55 : level;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7 * L, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); out(g, 0.18); o.start(t); o.stop(t + 0.5);
    var n = noiseSrc(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.9;
    ng.gain.setValueAtTime(0.0001, t + 0.01); ng.gain.linearRampToValueAtTime(0.35 * L, t + 0.03); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(bp); bp.connect(ng); out(ng, 0.1); n.start(t, rand(0, 2)); n.stop(t + 0.3);
    var c = noiseSrc(), hp = ctx.createBiquadFilter(), cg = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    cg.gain.setValueAtTime(0.18 * L, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    c.connect(hp); hp.connect(cg); out(cg, 0.05); c.start(t, rand(0, 2)); c.stop(t + 0.05);
    count('seal', 3);
  }

  // ---- Bells: additive partials with inharmonic ratios, each decaying at its own rate ----
  function bell(freq, t, gain, opts) {
    if (!live()) return;
    opts = opts || {};
    t = t || now(); gain = gain || 0.16;
    var parts = opts.parts || [[0.5, 0.35, 3.2], [1, 1, 2.4], [2.0, 0.45, 1.6], [2.76, 0.4, 1.1], [4.07, 0.22, 0.7], [5.4, 0.12, 0.45]];
    var g = ctx.createGain(); g.gain.value = gain;
    var p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = opts.pan || 0; g.connect(p); out(p, opts.wet === undefined ? 0.6 : opts.wet); } else out(g, 0.6);
    parts.forEach(function (q) {
      var o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine';
      o.frequency.value = freq * q[0]; o.detune.value = rand(-3, 3);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(q[1], t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + q[2] * (opts.len || 1));
      o.connect(og); og.connect(g); o.start(t); o.stop(t + q[2] * (opts.len || 1) + 0.05);
    });
    count('bell', parts.length);
  }
  // Map-pin chime: a soft, low bell over a plucked octave, pitched per place.
  var PLACE = { web: 72, ios: 76, android: 74, tailwind: 79, keep: 81 };
  function chime(place) {
    if (!live()) return;
    var m = (PLACE[place] || 72) - 12, t = now();   // an octave down from a map-pin "ping": warmer, not beepy
    bell(hz(m), t, 0.07, { len: 0.8, wet: 0.45, parts: [[1, 1, 1.6], [2, 0.3, 0.9], [2.76, 0.14, 0.55], [4.07, 0.05, 0.3]] });
    pluck(hz(m - 12), t + 0.01, 0.1, { pan: -0.15, cut: 2200, seconds: 1.6 });
    count('chime');
  }
  // Spell: a rising cascade of small bells on a pentatonic scale, with a breathy swell under it.
  function sparkle(gentle) {
    if (!live()) return;
    var t = now(), scale = [0, 2, 4, 7, 9], base = gentle ? 67 : 74, count_ = gentle ? 5 : 14, lvl = gentle ? 0.035 : 0.06;
    for (var i = 0; i < count_; i++) {
      var m = base + scale[i % 5] + 12 * Math.floor(i / 5);
      bell(hz(m), t + i * 0.07 + rand(0, 0.02), lvl * (1 - i / 20), { pan: rand(-0.7, 0.7), len: 0.6, wet: 0.9,
        parts: [[1, 1, 1.2], [2.76, 0.35, 0.5], [5.4, 0.15, 0.25]] });
    }
    var n = noiseSrc(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.setValueAtTime(1200, t); bp.frequency.exponentialRampToValueAtTime(7000, t + 1.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gentle ? 0.03 : 0.08, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    n.connect(bp); bp.connect(g); out(g, 0.8); n.start(t, rand(0, 1)); n.stop(t + 1.7);
    count('sparkle');
  }
  // Tankards meeting: two bright, short metal partials.
  function clink(level) {
    if (!live()) return;
    var t = now(), L = level === undefined ? 1 : level;
    bell(1850, t, 0.07 * L, { parts: [[1, 1, 0.5], [1.52, 0.6, 0.35], [2.71, 0.4, 0.2]], wet: 0.4 });
    bell(2130, t + 0.035, 0.05 * L, { parts: [[1, 1, 0.45], [1.61, 0.5, 0.3]], wet: 0.4 });
    count('clink');
  }
  // Dice on an oak table: clicks that slow down, then settle.
  function dice() {
    if (!live()) return 0;
    var t = now(), gap = 0.05;
    for (var i = 0; i < 9; i++) {
      var n = noiseSrc(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = rand(1600, 3200); bp.Q.value = 4;
      var a = 0.36 * Math.pow(0.86, i);
      g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      n.connect(bp); bp.connect(g); out(g, 0.15); n.start(t, rand(0, 2.5)); n.stop(t + 0.05);
      var o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = rand(180, 260);
      og.gain.setValueAtTime(a * 0.4, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(og); out(og, 0.1); o.start(t); o.stop(t + 0.08);
      t += gap; gap *= rand(1.15, 1.35);
    }
    count('dice', 18);
    return t - now();
  }
  // Parchment rustle: a swell of soft noise that brightens as the sheet moves.
  function rustle(seconds, level) {
    if (!live()) return;
    var t = now(), d = seconds || 1, L = level === undefined ? 1 : level;
    var n = noiseSrc(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(2600, t + d * 0.7);
    g.gain.setValueAtTime(0.0001, t);
    for (var i = 1; i <= 10; i++) g.gain.linearRampToValueAtTime(L * rand(0.08, 0.2) * Math.sin(Math.PI * i / 11), t + d * i / 11);
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    n.connect(bp); bp.connect(g); out(g, 0.25); n.start(t, rand(0, 1.5)); n.stop(t + d + 0.05);
    count('rustle');
  }

  // ---- Frame drum: a deep "doum" (pitch-dropping sine plus skin) and a light "tek" on the rim ----
  function doum(t, a) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(62, t + 0.14);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); out(g, 0.2); o.start(t); o.stop(t + 0.55);
    var n = noiseSrc(), lp = ctx.createBiquadFilter(), ng = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.value = 900;
    ng.gain.setValueAtTime(a * 0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(lp); lp.connect(ng); out(ng, 0.15); n.start(t, rand(0, 2)); n.stop(t + 0.12);
    count('drum', 2);
  }
  function tek(t, a) {
    var n = noiseSrc(), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 1.5;
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(bp); bp.connect(g); out(g, 0.25); n.start(t, rand(0, 2)); n.stop(t + 0.1);
    var o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 340;
    og.gain.setValueAtTime(a * 0.3, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(og); out(og, 0.2); o.start(t); o.stop(t + 0.07);
    count('drum', 2);
  }
  var drum = { on: false, bpm: 96, next: 0, step: 0, timer: 0 };
  var PATTERN = ['D', '', 't', 't', 'D', '', 't', '', 'D', 'd', 't', 't', 'D', '', 't', 'g'];   // a tavern walk in eighths
  function drumTick() {
    if (!drum.on || !live()) return;
    var ahead = ctx.currentTime + 0.25, eighth = 30 / drum.bpm;
    if (drum.next < ctx.currentTime) drum.next = ctx.currentTime + 0.05;
    while (drum.next < ahead) {
      var s = PATTERN[drum.step % PATTERN.length], sw = drum.step % 2 ? eighth * 0.12 : 0;   // a little swing
      if (s === 'D') doum(drum.next + sw, 0.55); else if (s === 'd') doum(drum.next + sw, 0.3);
      else if (s === 't') tek(drum.next + sw, 0.16 * rand(0.8, 1.1)); else if (s === 'g') tek(drum.next + sw, 0.07);
      drum.next += eighth; drum.step++;
    }
  }
  function setDrum(enable, bpm) {
    if (bpm) drum.bpm = bpm;
    if (enable === undefined) return;
    drum.on = !!enable;
    clearInterval(drum.timer);
    if (drum.on && live()) { drum.next = 0; drum.step = 0; drum.timer = setInterval(drumTick, 60); drumTick(); }
  }

  // ---- Ambience beds ----
  var amb = { kind: 'silence', nodes: [], timer: 0, night: false };
  function stopAmb() {
    clearInterval(amb.timer); amb.timer = 0;
    var ns = amb.nodes; amb.nodes = [];
    ns.forEach(function (n) {
      if (n.gain) n.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      setTimeout(function () { try { n.src.stop(); } catch (e) {} }, 2500);
    });
  }
  function windBed(level) {
    var t = now(), made = [];
    // Body of the wind: pink noise through a wandering band-pass, its loudness breathing on slow gusts.
    [[0.05, 380, 0.7, 0], [0.031, 900, 5, 0.6]].forEach(function (L, i) {
      var n = noiseSrc(true), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = L[1]; bp.Q.value = L[2];
      var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = L[0]; lg.gain.value = L[1] * 0.55;
      lfo.connect(lg); lg.connect(bp.frequency);
      var gust = ctx.createOscillator(), gg = ctx.createGain(); gust.frequency.value = L[0] * 1.7 + 0.013; gg.gain.value = level * (i ? 0.25 : 0.4);
      gust.connect(gg); gg.connect(g.gain);
      g.gain.value = 0.0001; g.gain.setTargetAtTime(level * (i ? 0.35 : 0.8), t, 1.5);
      n.connect(bp); bp.connect(g); out(g, 0.3);
      n.start(t, rand(0, 2)); lfo.start(t); gust.start(t);
      made.push({ src: n, gain: g }, { src: lfo }, { src: gust });
    });
    count('wind', 6);
    return made;
  }
  function birdCall(t) {
    var calls = Math.floor(rand(2, 6)), base = rand(2600, 4200), pan = rand(-0.8, 0.8);
    for (var i = 0; i < calls; i++) {
      var o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      var s = t + i * rand(0.09, 0.16), d = rand(0.05, 0.11), f = base * rand(0.9, 1.1);
      o.frequency.setValueAtTime(f * 0.8, s); o.frequency.exponentialRampToValueAtTime(f * rand(1.1, 1.4), s + d * 0.6);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, s + d);
      g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.045, s + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
      o.connect(g);
      if (p) { p.pan.value = pan; g.connect(p); out(p, 0.5); } else out(g, 0.5);
      o.start(s); o.stop(s + d + 0.02);
    }
    count('bird', calls);
  }
  function owlCall(t) {
    [[0, 0.35], [0.55, 0.18], [0.8, 0.55]].forEach(function (h) {
      var o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), s = t + h[0];
      o.type = 'triangle'; o.frequency.setValueAtTime(390, s); o.frequency.linearRampToValueAtTime(350, s + h[1]);
      lp.type = 'lowpass'; lp.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.07, s + 0.06); g.gain.setTargetAtTime(0.0001, s + h[1] - 0.05, 0.06);
      o.connect(lp); lp.connect(g); out(g, 0.7); o.start(s); o.stop(s + h[1] + 0.4);
    });
    count('owl', 3);
  }
  function crackle(t, level) {
    var n = noiseSrc(), hp = ctx.createBiquadFilter(), g = ctx.createGain(), d = rand(0.002, 0.012);
    hp.type = 'highpass'; hp.frequency.value = rand(1200, 3500);
    g.gain.setValueAtTime(rand(0.08, 0.35) * (level || 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.01);
    n.connect(hp); hp.connect(g); out(g, 0.2); n.start(t, rand(0, 2.5)); n.stop(t + d + 0.02);
    count('crackle');
  }
  function torchBed(level) {
    var t = now(), n = noiseSrc(true), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 320;                  // the low roar of the flame
    g.gain.value = 0.0001; g.gain.setTargetAtTime(level * 0.55, t, 0.8);
    var flick = ctx.createOscillator(), fg = ctx.createGain(); flick.frequency.value = 0.9; fg.gain.value = level * 0.15;
    flick.connect(fg); fg.connect(g.gain);
    n.connect(lp); lp.connect(g); out(g, 0.15); n.start(t, rand(0, 2)); flick.start(t);
    count('torch', 2);
    return [{ src: n, gain: g }, { src: flick }];
  }
  function ambTick() {
    if (!live()) return;
    var t = ctx.currentTime;
    if (amb.kind === 'birds') {
      if (amb.night) { if (Math.random() < 0.028) owlCall(t + 0.1); }
      else if (Math.random() < 0.11) birdCall(t + 0.05);
    } else if (amb.kind === 'torch') {
      var k = Math.random() < 0.08 ? Math.floor(rand(3, 8)) : Math.random() < 0.5 ? 1 : 0;   // single pops, sometimes a burst
      for (var i = 0; i < k; i++) crackle(t + 0.05 + rand(0, 0.12));
    } else if (amb.kind === 'hearth') {                          // candlelight: now and then a small, far-off pop
      if (Math.random() < 0.09) crackle(t + 0.05 + rand(0, 0.1), 0.22);
      if (Math.random() < 0.012) for (var j = 0; j < 3; j++) crackle(t + 0.05 + rand(0, 0.2), 0.15);
    }
  }
  function setAmbience(kind, opts) {
    if (opts && 'night' in opts) amb.night = !!opts.night;
    if (kind === undefined) return;
    amb.kind = kind || 'silence';
    if (!ctx) return;
    stopAmb();
    if (!live() || amb.kind === 'silence') return;
    if (amb.kind === 'wind') amb.nodes = windBed(0.55);
    else if (amb.kind === 'birds') amb.nodes = windBed(0.16);        // a faint breeze under the birds
    else if (amb.kind === 'torch') amb.nodes = torchBed(0.6);
    // 'hearth' has no continuous bed: only the scattered crackles from ambTick.
    amb.timer = setInterval(ambTick, 120);
  }

  // ---- On / off / volume ----
  // The first real gesture (a press that grants user activation) creates or resumes the context, silently.
  function unlocked() { var ua = navigator.userActivation; return !ua || ua.isActive || ua.hasBeenActive; }
  function wake() {
    if (!on || !unlocked()) return;
    if (!ctx) {
      if (!ensure()) return;
      master.gain.value = vol;
      if (amb.kind !== 'silence') setAmbience(amb.kind);
      if (drum.on) setDrum(true);
    }
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
    if (ctx.state === 'running') ['pointerdown', 'pointerup', 'keydown', 'touchend'].forEach(function (e) { removeEventListener(e, wake, true); });
  }
  ['pointerdown', 'pointerup', 'keydown', 'touchend'].forEach(function (e) { addEventListener(e, wake, true); });
  function setEnabled(enable) {
    try { localStorage.setItem(KEY, enable ? '1' : '0'); } catch (e) {}
    if (enable) {
      on = true;
      if (!ensure()) return false;
      clearTimeout(suspendTimer);
      if (ctx.state === 'suspended') ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
      if (amb.kind !== 'silence') setAmbience(amb.kind);
      if (drum.on) setDrum(true);
    } else {
      on = false;
      if (!ctx) return true;
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      clearInterval(drum.timer); clearInterval(amb.timer);
      stopAmb(); if (drone) setDrone(false);
      suspendTimer = setTimeout(function () { if (!on) ctx.suspend(); }, 700);
    }
    return true;
  }
  function setVolume(v) {
    vol = Math.max(0, Math.min(1, +v)) * 0.9;
    if (ctx && on) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
  }

  window.RealmSound = {
    setEnabled: setEnabled, setVolume: setVolume, flourish: flourish,
    get enabled() { return on; }, get context() { return ctx; }, stats: stats, hz: hz,
    pluck: function (m, g, o) { pluck(hz(m), 0, g, o); }, strum: strum, phrase: phrase, setDrone: setDrone,
    fanfare: fanfare, horn: horn, quill: quill, quillLine: quillLine, seal: seal, bell: function (m, g, o) { bell(hz(m), 0, g, o); },
    chime: chime, sparkle: sparkle, clink: clink, dice: dice, rustle: rustle, setDrum: setDrum, setAmbience: setAmbience,
  };

  // Section stepping: call back with the section RoyalHero brings into focus (the one without data-rh-dim).
  window.RealmSound.onSection = function (selector, cb) {
    var secs = [].slice.call(document.querySelectorAll(selector)), last = null;
    var mo = new MutationObserver(function () {
      var cur = secs.filter(function (s) { return !s.hasAttribute('data-rh-dim'); })[0];
      if (cur && cur !== last && secs.every(function (s) { return s === cur || s.hasAttribute('data-rh-dim'); })) {
        var prev = last; last = cur; if (prev) cb(cur, secs.indexOf(cur), prev);
      }
    });
    secs.forEach(function (s) { mo.observe(s, { attributes: true, attributeFilter: ['data-rh-dim'] }); });
  };
})();
