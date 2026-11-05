
'use strict';
/* =====================================================================
   Atrapavientos
   1. Utilidades        5. Generación del mundo    9. Render
   2. Audio             6. Sprites y pintura       10. Visión (MediaPipe)
   3. Señas             7. Estado y reglas         11. Interfaz
   4. Layout y cámara   8. Actualización
   ===================================================================== */

/* ---------- 1. Utilidades ---------- */
const TAU = Math.PI * 2, PI = Math.PI, DEG = PI / 180;
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
const easeBack = t => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

/* ---------- 2. Audio (todo sintetizado) ---------- */
const Snd = {
  ctx: null, on: true, master: null, windGain: null, noise: null, timer: null,
  scale: [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66],
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    const comp = c.createDynamicsCompressor();
    this.master = c.createGain(); this.master.gain.value = this.on ? .85 : 0;
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 420; lp.Q.value = .5;
    this.windGain = c.createGain(); this.windGain.gain.value = .022;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .13; lg.gain.value = 190;
    lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    src.connect(lp); lp.connect(this.windGain); this.windGain.connect(this.master); src.start();
    let step = 0; const chords = [[130.81, 196, 329.63], [110, 164.81, 261.63], [146.83, 220, 349.23], [98, 146.83, 293.66]];
    const tick = () => {
      if (!this.on || document.hidden) return;
      const ch = chords[step++ % chords.length];
      ch.forEach(f => this.tone(f, 0, 4.2, 'sine', .022, 0, 1.4));
      for (let i = 0; i < 3; i++) if (Math.random() < .6) this.tone(pick(this.scale), i * .8 + rand(.1), 1.3, 'triangle', .016, rand(-.5, .5), .01);
    };
    tick(); this.timer = setInterval(tick, 3200);
  },
  toggle() { this.on = !this.on; if (this.master) this.master.gain.setTargetAtTime(this.on ? .85 : 0, this.ctx.currentTime, .05); return this.on; },
  tone(f, delay = 0, dur = .4, type = 'sine', vol = .1, pan = 0, attack = .005) {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    let out = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    o.connect(g); out.connect(this.master); o.start(t); o.stop(t + dur + .03);
  },
  whoosh(pan = 0, dur = 1, vol = .1, from = 300, to = 1500) {
    if (!this.ctx || !this.on) return; const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * .55); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g);
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); } else g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + .03);
  },
  hit(combo, perfect, pan) {
    const i = Math.min(combo, this.scale.length - 3);
    this.tone(this.scale[i], 0, .55, 'sine', .15, pan); this.tone(this.scale[i] * 2, 0, .3, 'triangle', .05, pan);
    this.tone(this.scale[i + 2], .08, .6, 'sine', .11, pan);
    if (perfect) this.tone(this.scale[i + 2] * 2, .16, .85, 'sine', .08, pan);
    this.whoosh(pan, .4, .07, 2400, 600);
  },
  miss(pan) { if (!this.ctx) return; this.tone(150, 0, .5, 'sawtooth', .06, pan); this.tone(98, .06, .6, 'sine', .15, pan); this.whoosh(pan, .55, .09, 900, 180); },
  tick(g) { this.tone({ left: 660, right: 784, open: 988, fist: 247 }[g] || 500, 0, .1, 'triangle', .07); },
  count(go) { this.tone(go ? 880 : 523.25, 0, go ? .75 : .22, 'triangle', .14); if (go) this.tone(1318.5, .05, .75, 'sine', .07); },
  end(win) { (win ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [392, 329.63, 261.63, 196]).forEach((f, i) => this.tone(f, i * .17, 1.2, 'sine', .13)); },
  boom(pan) { this.tone(rand(70, 110), 0, .45, 'sine', .1, pan); this.whoosh(pan, .55, .025, 2600, 500); }
};

/* ---------- 3. Señas de cada jugador ---------- */
/* Cada comando es una seña que el jugador inventa y graba. Reconocer es buscar la grabación
   más parecida entre las hechas con esa misma mano; si nada se parece, no hay comando. */
const SIGN_ORDER = ['left', 'right', 'open', 'fist'];
const GESTURES = {
  left: { e: '⬅️', t: 'IZQUIERDA', c: '#7fd8e8' },
  right: { e: '➡️', t: 'DERECHA', c: '#7fd8e8' },
  open: { e: '🟢', t: 'AVANZAR', c: '#6fe3b0' },
  fist: { e: '🛑', t: 'DETENER', c: '#ff6f59' }
};
const Signs = {
  KEY: 'molino.signs.v1', data: {},
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      for (const k of SIGN_ORDER) if (d[k] && Array.isArray(d[k].samples) && d[k].samples.length) this.data[k] = d[k];
    } catch (e) { /* almacenamiento bloqueado o dañado: se vuelven a grabar */ }
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* almacenamiento bloqueado: duran hasta cerrar la pestaña */ } },
  has(k) { return !!this.data[k]; },
  ready() { return SIGN_ORDER.every(k => this.has(k)); },
  // Forma de la mano: cada punto respecto de la muñeca, en unidades de palma. Conserva la orientación,
  // así apuntar a un lado o al otro pueden ser señas distintas.
  vec(world) {
    const w = world[0], palm = Math.hypot(w.x - world[9].x, w.y - world[9].y, (w.z || 0) - (world[9].z || 0)) || 1e-6, out = new Array(60);
    for (let i = 1; i <= 20; i++) { const p = world[i], o = (i - 1) * 3; out[o] = (p.x - w.x) / palm; out[o + 1] = (p.y - w.y) / palm; out[o + 2] = ((p.z || 0) - (w.z || 0)) / palm; }
    return out;
  },
  dist(u, v) {
    let sum = 0;
    for (let i = 0; i < 60; i += 3) sum += Math.hypot(u[i] - v[i], u[i + 1] - v[i + 1], u[i + 2] - v[i + 2]);
    return sum / 20;
  },
  nearest(v, sign) { let best = Infinity; for (const s of sign.samples) { const d = this.dist(v, s); if (d < best) best = d; } return best; },
  mean(list) { const m = new Array(60).fill(0); for (const v of list) for (let i = 0; i < 60; i++) m[i] += v[i] / list.length; return m; },
  match(world, label) {
    const v = this.vec(world); let best = null, bd = Infinity, second = Infinity;
    for (const k of SIGN_ORDER) {
      const s = this.data[k]; if (!s || s.hand !== label) continue;
      const d = this.nearest(v, s);
      if (d < bd) { second = bd; bd = d; best = k; } else if (d < second) second = d;
    }
    if (!best || bd > this.data[best].th || bd > second * .72) return null;
    return best;
  },
  // Guarda una seña salvo que se confunda con otra de la misma mano.
  record(k, hand, frames, lm) {
    const samples = frames.filter((_, i) => i % 2 === 0).map(v => v.map(n => Math.round(n * 1000) / 1000));
    const center = this.mean(samples);
    for (const other of SIGN_ORDER) {
      if (other === k || !this.data[other] || this.data[other].hand !== hand) continue;
      if (this.nearest(center, this.data[other]) < .3) return { ok: false, conflict: other };
    }
    const spread = samples.reduce((acc, s) => acc + this.dist(s, center), 0) / samples.length;
    const xs = lm.map(p => p.x), ys = lm.map(p => p.y), x0 = Math.min(...xs), y0 = Math.min(...ys), size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
    const pose = lm.map(p => [Math.round(((p.x - x0) / size) * 52 + 6), Math.round(((p.y - y0) / size) * 52 + 6)]);
    this.data[k] = { hand, samples, th: clamp(spread * 3.2, .24, .38), pose };
    this.save();
    return { ok: true };
  },
  // Dibujo de la seña tal como la hizo el jugador
  thumb(k) {
    const s = this.data[k];
    if (!s) return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="5 7" opacity=".55"/><text x="32" y="42" text-anchor="middle" font-size="28" font-weight="800" fill="currentColor" opacity=".7">?</text></svg>';
    const d = BONES.map(([a, b]) => `M${s.pose[a][0]} ${s.pose[a][1]}L${s.pose[b][0]} ${s.pose[b][1]}`).join('');
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>`;
  },
  refreshUI() {
    document.querySelectorAll('[data-sign]').forEach(e => { e.innerHTML = this.thumb(e.dataset.sign); });
  }
};

/* ---------- 4. Layout y cámara virtual ---------- */
const cv = $('world'), ctx = cv.getContext('2d', { alpha: false });
const V = { w: 1, h: 1, dpr: 1, base: 1, S: 1, wide: true, gx: 0, gy: 0, lx: 0, ly: 0, lz: 1, ex: 0, ey: 0, ez: 1 };
const Cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, shake: 0, sx: 0, sy: 0, pulse: 0 };
const Q = { dprMax: 2, ribbons: 11, tufts: 1, low: 0 };
const ISLAND = 530; // radio en unidades de mundo que debe entrar en pantalla

function layout() {
  V.w = innerWidth; V.h = innerHeight; V.dpr = Math.min(devicePixelRatio || 1, Q.dprMax);
  cv.width = Math.round(V.w * V.dpr); cv.height = Math.round(V.h * V.dpr);
  V.wide = V.w >= 1000 && V.w / V.h > 1.3;
  let R;
  if (V.wide) {
    const hudW = clamp(V.w * .21, 240, 300) + 28;
    R = Math.min((V.w - hudW * 2) / 2 + 26, V.h / 2 - 6);
    V.gx = V.w / 2; V.gy = V.h / 2;
    V.base = R / ISLAND;
    const lz = (V.h * .54) / R; V.lz = lz; V.lx = V.w * .73; V.ly = V.h * .52;
    V.ez = 1.04; V.ex = V.w * .515; V.ey = V.h * .5; // el molino queda entre los resultados y el ranking
  } else {
    const top = 112, bot = 128, avail = V.h - top - bot;
    R = Math.min(V.w / 2 - 2, avail / 2);
    V.gx = V.w / 2; V.gy = top + avail / 2;
    V.base = R / ISLAND;
    V.lz = 1; V.lx = V.w / 2; V.ly = R + 12;
    V.ez = 1; V.ex = V.w / 2; V.ey = R + 12;
  }
  camTarget(true);
}
function camTarget(snap) {
  if (Rules.cam) { const c = Rules.cam(); Cam.tx = c.x; Cam.ty = c.y; Cam.tz = c.z; if (snap) { Cam.x = c.x; Cam.y = c.y; Cam.z = c.z; } return; }
  if (G.mode === 'attract') { Cam.tx = V.lx; Cam.ty = V.ly; Cam.tz = V.lz; }
  else if (G.mode === 'end') { Cam.tx = V.ex; Cam.ty = V.ey; Cam.tz = V.ez; }
  else { Cam.tx = V.gx; Cam.ty = V.gy; Cam.tz = 1; }
  if (snap) { Cam.x = Cam.tx; Cam.y = Cam.ty; Cam.z = Cam.tz; }
}

/* ---------- 5. Generación del mundo ---------- */
const COAST = new Float32Array(361);
const coastR = a => 500 + 13 * Math.sin(3 * a + 1.2) + 8 * Math.sin(5 * a + .7) + 5 * Math.sin(11 * a + 2.1) + 2.6 * Math.sin(23 * a + .3);
for (let i = 0; i <= 360; i++) COAST[i] = coastR(i / 360 * TAU);
const coastAt = a => { const n = ((a % TAU) + TAU) % TAU; return COAST[Math.round(n / TAU * 360)]; };

const W = { paths: [], houses: [], lamps: [], fields: [], trees: [], tufts: [], sheep: [], boats: [], clouds: [], gulls: [], flies: [], glints: [], stars: [], currents: [], rocks: [], pond: { x: -46, y: -408, r: 44 }, light: null };

function genWorld() {
  const r = rng(2718);
  const near = (x, y, list, rad) => list.some(o => Math.hypot(o.x - x, o.y - y) < rad + (o.rad || 0));

  // Caminos y pueblos
  const pathAngles = [-2.55, -.85, .55, 2.25], counts = [5, 5, 4, 5];
  pathAngles.forEach((a, i) => {
    const rc = 325 + r() * 40, wob = r() * TAU, pts = [];
    for (let s = 0; s <= 44; s++) {
      const t = s / 44, rad = lerp(150, rc, t), aa = a + Math.sin(t * 3.2 + wob) * .1 * t;
      pts.push({ x: Math.cos(aa) * rad, y: Math.sin(aa) * rad });
    }
    W.paths.push({ pts, a });
  });
  const pathPoint = (p, t) => { const f = clamp(t) * (p.pts.length - 1), i = Math.min(p.pts.length - 2, Math.floor(f)), k = f - i; return { x: lerp(p.pts[i].x, p.pts[i + 1].x, k), y: lerp(p.pts[i].y, p.pts[i + 1].y, k) }; };
  W.pathPoint = pathPoint;
  W.paths.forEach((p, i) => {
    const end = p.pts[p.pts.length - 1]; let placed = 0, tries = 0;
    while (placed < counts[i] && tries++ < 400) {
      const a = r() * TAU, d = 36 + r() * 58, x = end.x + Math.cos(a) * d, y = end.y + Math.sin(a) * d;
      if (Math.hypot(x, y) > 448 || Math.hypot(x, y) < 245) continue;
      if (near(x, y, W.houses, 36)) continue;
      W.houses.push({ x, y, a: Math.round(Math.atan2(end.y - y, end.x - x) / (PI / 2)) * (PI / 2) + (r() - .5) * .35, roof: Math.floor(r() * 4), path: i, lit: 0, pop: 0, flick: r() * 10, smoke: r() * 3 });
      placed++;
    }
    [.18, .42, .66, .9].forEach((t, j) => {
      const q = pathPoint(p, t), n = pathPoint(p, t + .02), dx = n.x - q.x, dy = n.y - q.y, l = Math.hypot(dx, dy) || 1, side = j % 2 ? 13 : -13;
      W.lamps.push({ x: q.x - dy / l * side, y: q.y + dx / l * side, lit: 0, rank: r() });
    });
  });
  W.houses.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  // Campos de flores
  const crops = [['#e8483f', '#f1695f'], ['#f48fb1', '#f9b4cc'], ['#f7c948', '#fbdc7b'], ['#9a7fd1', '#b8a3e3'], ['#fff1e0', '#ffffff'], ['#ef8b3a', '#f5a763'], ['#e3bd5f', '#ecd083']];
  [-1.7, -.15, 1.4, 3.0].forEach((m, i) => {
    [[-.27, 252], [.27, 252], [0, i === 0 || i === 2 ? 0 : 356]].forEach(([da, rr], j) => {
      if (!rr) return;
      const a = m + da + (r() - .5) * .06;
      W.fields.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, w: 86 + r() * 30, h: 56 + r() * 20, rot: a + PI / 2 + (r() - .5) * .3, crop: crops[(i * 3 + j * 2) % crops.length], rad: 62 });
    });
  });

  W.light = { a: 1.38, x: Math.cos(1.38) * (coastR(1.38) - 20), y: Math.sin(1.38) * (coastR(1.38) - 20) };

  // Árboles
  const avoid = (x, y, pad) => {
    if (near(x, y, W.fields, pad) || near(x, y, W.houses, pad + 18)) return true;
    if (Math.hypot(x - W.pond.x, y - W.pond.y) < W.pond.r + pad + 8) return true;
    if (Math.hypot(x - W.light.x, y - W.light.y) < 48) return true;
    for (const p of W.paths) for (let k = 0; k < p.pts.length; k += 3) if (Math.hypot(p.pts[k].x - x, p.pts[k].y - y) < pad + 10) return true;
    return false;
  };
  const groves = []; for (let i = 0; i < 15; i++) { const a = r() * TAU, rr = 245 + r() * 205; groves.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr }); }
  let tries = 0;
  while (W.trees.length < 92 && tries++ < 5000) {
    const g = groves[Math.floor(r() * groves.length)], d = r() * r() * 88, a = r() * TAU;
    const x = g.x + Math.cos(a) * d, y = g.y + Math.sin(a) * d, rr = Math.hypot(x, y);
    if (rr < 212 || rr > coastAt(Math.atan2(y, x)) - 48) continue;
    if (avoid(x, y, 14) || W.trees.some(t => Math.hypot(t.x - x, t.y - y) < 21)) continue;
    const k = r();
    W.trees.push({ x, y, kind: k < .54 ? Math.floor(r() * 2) : k < .8 ? 2 : k < .92 ? 3 : 4, s: .62 + r() * .55, ph: r() * TAU, sx: 0, sy: 0, vx: 0, vy: 0 });
  }
  W.trees.sort((a, b) => a.y - b.y);

  // Pasto animado
  tries = 0;
  while (W.tufts.length < 360 && tries++ < 4000) {
    const a = r() * TAU, rr = 185 + r() * 290, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (rr > coastAt(a) - 42 || near(x, y, W.fields, 2) || near(x, y, W.houses, 18)) continue;
    W.tufts.push({ x, y, l: 7 + r() * 8, ph: r() * TAU, tone: r() < .5 ? 0 : 1, b: 0 });
  }

  // Ovejas
  for (let i = 0; i < 9; i++) {
    let x, y, k = 0; do { const a = r() * TAU, rr = 205 + r() * 250; x = Math.cos(a) * rr; y = Math.sin(a) * rr; } while (avoid(x, y, 4) && k++ < 50);
    W.sheep.push({ x, y, a: r() * TAU, wait: r() * 4, tx: x, ty: y, hop: 0 });
  }
  // Barquitos
  for (let i = 0; i < 4; i++) W.boats.push({ a: r() * TAU, r: 610 + r() * 300, sp: (.012 + r() * .014) * (r() < .5 ? 1 : -1), c: ['#ff6f59', '#ffc857', '#fff4d9', '#7fd8e8'][i] });
  // Nubes
  for (let i = 0; i < 9; i++) W.clouds.push({ x: -1500 + r() * 3000, y: -950 + r() * 1900, s: .85 + r() * 1.05, v: 9 + r() * 12, k: i % 3 });
  // Gaviotas
  for (let i = 0; i < 7; i++) W.gulls.push({ ox: (i - 3) * 34 + r() * 8, oy: Math.abs(i - 3) * 26 + r() * 8, ph: r() * TAU });
  W.gullT = { x: -1500, y: -350, a: .22, wait: 4 };
  // Luciérnagas
  for (let i = 0; i < 52; i++) { const a = r() * TAU, rr = 190 + r() * 280; W.flies.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, ph: r() * TAU, s: .5 + r() }); }
  // Mar: destellos, estrellas reflejadas y corrientes
  for (let i = 0; i < 130; i++) { const a = r() * TAU, rr = 560 + r() * 1050; W.glints.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, l: 7 + r() * 17, ph: r() * TAU, sp: .7 + r() * 1.8 }); }
  for (let i = 0; i < 190; i++) { const a = r() * TAU, rr = 560 + r() * 1100; W.stars.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, s: .7 + r() * r() * 2.4, ph: r() * TAU, sp: 1 + r() * 2.6 }); }
  for (let i = 0; i < 26; i++) { const a = r() * TAU, rr = 620 + r() * 800; W.currents.push({ a, r: rr, len: .1 + r() * .17, ph: r() * TAU, sp: .15 + r() * .3 }); }
  for (let i = 0; i < 22; i++) { const a = r() * TAU; W.rocks.push({ a, r: coastAt(a) - 3 + r() * 13, s: 6 + r() * 11, seed: Math.floor(r() * 1e6) }); }
}

/* ---------- 6. Sprites y pintura del terreno ---------- */
const SP = {};
function sprite(wu, hu, S, draw) {
  const c = mkCanvas(wu * S, hu * S), x = c.getContext('2d');
  x.scale(c.width / wu, c.height / hu); x.translate(wu / 2, hu / 2); draw(x);
  c.wu = wu; c.hu = hu; return c;
}
const softBlob = (c, x, y, r, rgb, a) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
function coastPath(c, off = 0, fn) {
  c.beginPath();
  for (let i = 0; i < 360; i += 1) { const a = i / 360 * TAU, rr = COAST[i] + off + (fn ? fn(a) : 0), x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.closePath();
}
const roundRect = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

function buildSprites() {
  const S = V.S;
  // Luces
  const glow = (rgb, core = '.95') => { const c = mkCanvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, `rgba(${rgb},${core})`); g.addColorStop(.25, `rgba(${rgb},.42)`); g.addColorStop(.6, `rgba(${rgb},.1)`); g.addColorStop(1, `rgba(${rgb},0)`); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c; };
  SP.gWarm = glow('255,190,105'); SP.gGold = glow('255,217,120'); SP.gCyan = glow('120,235,235'); SP.gWhite = glow('255,255,255'); SP.gCoral = glow('255,110,90'); SP.gMint = glow('120,240,180');
  SP.shadow = (() => { const c = mkCanvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 8, 64, 64, 64); g.addColorStop(0, 'rgba(8,38,34,.85)'); g.addColorStop(.62, 'rgba(8,38,34,.5)'); g.addColorStop(1, 'rgba(8,38,34,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c; })();

  // Árboles (0-1 frondosos, 2 oscuro, 3 cerezo, 4 pino)
  const PAL = [
    { d: '#2f7d4f', m: '#4aa05c', l: '#74c26c', h: '#a5dc82' }, { d: '#3a8a48', m: '#5cae58', l: '#89cc66', h: '#bfe283' },
    { d: '#1f6a55', m: '#2f8a62', l: '#4dab70', h: '#7bcc84' }, { d: '#d9628e', m: '#ef86a9', l: '#f9aec6', h: '#ffd8e4' }, { d: '#14564b', m: '#1f7560', l: '#2f9270', h: '#5cb88a' }
  ];
  const lobes = (c, cx, cy, R, n, col, r, jit = .22) => {
    c.fillStyle = col; c.beginPath(); c.arc(cx, cy, R * .72, 0, TAU); c.fill();
    for (let i = 0; i < n; i++) { const a = i / n * TAU + r() * .4, d = R * (.58 + r() * jit), rr = R * (.36 + r() * .16); c.beginPath(); c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, TAU); c.fill(); }
  };
  SP.treeB = []; SP.treeT = [];
  PAL.forEach((p, k) => {
    const r = rng(k * 77 + 5);
    if (k === 4) {
      const star = (c, R, col, n, inner) => { c.fillStyle = col; c.beginPath(); for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * TAU, d = i % 2 ? R * inner : R; c.lineTo(Math.cos(a) * d, Math.sin(a) * d); } c.closePath(); c.fill(); };
      SP.treeB[k] = sprite(64, 64, S, c => { star(c, 25, p.d, 11, .68); star(c, 19, p.m, 10, .66); });
      SP.treeT[k] = sprite(64, 64, S, c => { c.translate(-1.5, -2); star(c, 14, p.l, 9, .62); star(c, 7.5, p.h, 7, .56); });
    } else {
      SP.treeB[k] = sprite(64, 64, S, c => { lobes(c, 0, 0, 25, 9, p.d, r); });
      SP.treeT[k] = sprite(64, 64, S, c => {
        lobes(c, -1.5, -2, 19.5, 8, p.m, r); lobes(c, -4.5, -5.5, 12.5, 6, p.l, r); lobes(c, -7, -8.5, 5.8, 4, p.h, r);
        for (let i = 0; i < 24; i++) { const a = r() * TAU, d = r() * 19; c.fillStyle = r() < .5 ? p.h : p.d; c.globalAlpha = .5; c.beginPath(); c.arc(Math.cos(a) * d - 2, Math.sin(a) * d - 2, .75 + r() * 1.1, 0, TAU); c.fill(); }
      });
    }
  });

  // Casas
  const ROOFS = [['#c9502f', '#e36c44', '#f18a60'], ['#2d7f8a', '#39a0a8', '#5cc0c0'], ['#d6982c', '#eab64a', '#f6d074'], ['#8a4f76', '#a9688f', '#c889aa']];
  SP.house = ROOFS.map((p, k) => sprite(62, 50, S, c => {
    c.fillStyle = 'rgba(20,20,20,.28)'; roundRect(c, -22, -15, 44, 31, 3); c.fill();
    c.fillStyle = p[2]; c.fillRect(-21, -15, 42, 15); c.fillStyle = p[0]; c.fillRect(-21, 0, 42, 15);
    c.lineWidth = .7; c.strokeStyle = 'rgba(0,0,0,.13)';
    for (let y = -13; y < 15; y += 3.5) { c.beginPath(); c.moveTo(-21, y); c.lineTo(21, y); c.stroke(); }
    for (let i = 0; i < 90; i++) { const x = -21 + Math.random() * 42, y = -15 + Math.random() * 30; c.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.09)'; c.fillRect(x, y, 2.6, 2.3); }
    c.fillStyle = 'rgba(255,245,220,.82)'; c.fillRect(-22, -1, 44, 2);
    c.fillStyle = '#6d5a4c'; c.fillRect(8, -11, 7, 7); c.fillStyle = '#2d241f'; c.fillRect(9.6, -9.4, 3.8, 3.8);
  }));

  // Oveja
  SP.sheep = sprite(30, 24, S, c => {
    const r = rng(9); c.fillStyle = '#d9d3c6'; lobes(c, -1, .8, 8, 7, '#d9d3c6', r); lobes(c, -1.5, -.4, 6.6, 6, '#fffaf0', r);
    c.fillStyle = '#332a25'; c.beginPath(); c.ellipse(8.2, 0, 3.6, 2.8, 0, 0, TAU); c.fill();
    c.fillStyle = '#4b3f38'; c.beginPath(); c.ellipse(6.7, -3, 1.6, .9, -.5, 0, TAU); c.ellipse(6.7, 3, 1.6, .9, .5, 0, TAU); c.fill();
  });

  // Nubes
  const cloud = (seed, rgbTop, rgbLow) => sprite(460, 260, Math.min(S, .9), c => {
    const r = rng(seed); const puffs = [];
    for (let i = 0; i < 25; i++) { const t = r(), x = (t - .5) * 320, y = (r() - .5) * 92 * (1 - Math.abs(t - .5) * 1.1); puffs.push({ x, y, s: 30 + r() * 52 * (1 - Math.abs(t - .5)) + 14 }); }
    puffs.forEach(p => softBlob(c, p.x, p.y + 6, p.s * 1.32, rgbLow, .7));
    puffs.forEach(p => softBlob(c, p.x - 5, p.y - 7, p.s * 1.1, rgbTop, .82));
    puffs.slice(0, 14).forEach(p => softBlob(c, p.x - 11, p.y - 15, p.s * .65, '255,255,255', .72));
  });
  SP.cloud = [cloud(11, '255,255,255', '206,226,238'), cloud(23, '255,255,255', '214,226,240'), cloud(37, '255,253,248', '198,220,236')];
  SP.cloudSh = [0, 1, 2].map(i => { const c = mkCanvas(SP.cloud[i].width, SP.cloud[i].height), x = c.getContext('2d'); x.drawImage(SP.cloud[i], 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgb(8,42,58)'; x.fillRect(0, 0, c.width, c.height); c.wu = 460; c.hu = 260; return c; });

  // Torre del molino y plataforma
  SP.tower = sprite(160, 160, S, c => {
    softBlob(c, 0, 0, 76, '20,25,20', .32);
    c.fillStyle = '#7a4e30'; c.beginPath(); c.arc(0, 0, 64, 0, TAU); c.fill();
    for (let i = 0; i < 44; i++) { const a = i / 44 * TAU; c.save(); c.rotate(a); c.fillStyle = i % 2 ? '#a06b43' : '#94603a'; c.fillRect(44, -4.1, 19, 8.3); c.restore(); }
    c.strokeStyle = '#4f2f1c'; c.lineWidth = 2.2; c.beginPath(); c.arc(0, 0, 63.5, 0, TAU); c.stroke();
    for (let i = 0; i < 26; i++) { const a = i / 26 * TAU; c.fillStyle = '#fff1d6'; c.beginPath(); c.arc(Math.cos(a) * 62, Math.sin(a) * 62, 1.9, 0, TAU); c.fill(); }
    const g = c.createRadialGradient(-11, -13, 3, 0, 0, 46); g.addColorStop(0, '#fff8e8'); g.addColorStop(.72, '#ecdfc3'); g.addColorStop(1, '#b9a581');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 45, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(120,95,60,.34)'; c.lineWidth = 1;
    [28, 35, 41].forEach((r, j) => { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); for (let i = 0; i < 26; i++) { const a = (i + j * .5) / 26 * TAU; c.beginPath(); c.moveTo(Math.cos(a) * r, Math.sin(a) * r); c.lineTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6)); c.stroke(); } });
    c.strokeStyle = 'rgba(70,50,30,.55)'; c.lineWidth = 2.4; c.beginPath(); c.arc(0, 0, 45, 0, TAU); c.stroke();
  });

  // Capota (mira hacia +x)
  SP.cap = sprite(220, 130, S, c => {
    c.fillStyle = 'rgba(15,20,20,.32)'; c.beginPath(); c.ellipse(-2, 3, 49, 40, 0, 0, TAU); c.fill();
    // viga de cola
    c.strokeStyle = '#5a3a24'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-36, -18); c.lineTo(-92, 0); c.moveTo(-36, 18); c.lineTo(-92, 0); c.stroke();
    c.strokeStyle = '#8c5d3b'; c.lineWidth = 2; c.beginPath(); c.moveTo(-36, -18); c.lineTo(-92, 0); c.moveTo(-36, 18); c.lineTo(-92, 0); c.stroke();
    // eje
    c.fillStyle = '#3e2a1d'; roundRect(c, 30, -6.5, 31, 13, 4); c.fill(); c.fillStyle = '#6b4a30'; roundRect(c, 30, -6, 31, 5, 2); c.fill();
    // cubierta
    const body = () => { c.beginPath(); c.moveTo(45, -26); c.bezierCurveTo(58, -11, 58, 11, 45, 26); c.bezierCurveTo(22, 43, -28, 44, -46, 25); c.bezierCurveTo(-55, 9, -55, -9, -46, -25); c.bezierCurveTo(-28, -44, 22, -43, 45, -26); c.closePath(); };
    const g = c.createLinearGradient(0, -40, 0, 40); g.addColorStop(0, '#ef7251'); g.addColorStop(.47, '#d84b33'); g.addColorStop(.53, '#b93524'); g.addColorStop(1, '#8e2619');
    body(); c.fillStyle = g; c.fill();
    c.save(); body(); c.clip();
    c.strokeStyle = 'rgba(60,10,5,.28)'; c.lineWidth = 1;
    for (let x = -55; x < 60; x += 6.5) { c.beginPath(); c.moveTo(x, -45); c.quadraticCurveTo(x + (x > 0 ? 7 : -7), 0, x, 45); c.stroke(); }
    for (let i = 0; i < 140; i++) { c.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)'; c.fillRect(-55 + Math.random() * 110, -45 + Math.random() * 90, 5, 2); }
    c.restore();
    body(); c.strokeStyle = '#fff1d6'; c.lineWidth = 2.6; c.stroke();
    c.fillStyle = '#fff1d6'; roundRect(c, -46, -2.2, 92, 4.4, 2); c.fill();
    c.fillStyle = '#ffc857'; c.beginPath(); c.arc(0, 0, 5.2, 0, TAU); c.fill();
    c.fillStyle = '#b5791b'; c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fill();
  });

  // Aspa: raíz en (0,-66) del sprite, se extiende a +y
  SP.sail = sprite(48, 136, S, c => {
    c.translate(0, -66);
    c.fillStyle = '#fff2d8'; c.beginPath(); c.moveTo(2, 22); c.lineTo(21, 26); c.lineTo(22.5, 128); c.lineTo(2, 128); c.closePath(); c.fill();
    c.fillStyle = 'rgba(212,176,125,.42)'; c.beginPath(); c.moveTo(2, 22); c.lineTo(9, 23.5); c.lineTo(9, 128); c.lineTo(2, 128); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.moveTo(14, 25); c.lineTo(19, 26); c.lineTo(20, 127); c.lineTo(14, 127); c.closePath(); c.fill();
    c.strokeStyle = '#7a4e30'; c.lineWidth = 1.7;
    for (let y = 30; y <= 128; y += 12) { c.beginPath(); c.moveTo(-5, y); c.lineTo(22.5, y); c.stroke(); }
    c.beginPath(); c.moveTo(21, 26); c.lineTo(22.5, 128); c.moveTo(11.5, 25); c.lineTo(11.5, 128); c.lineWidth = 1.3; c.stroke();
    c.lineWidth = 1.7; c.beginPath(); c.moveTo(-5, 26); c.lineTo(-5, 128); c.stroke();
    c.fillStyle = '#5e3b24'; roundRect(c, -2.9, 0, 5.8, 132, 2.5); c.fill(); c.fillStyle = '#90613d'; c.fillRect(-1.8, 0, 1.6, 131);
    c.fillStyle = '#e8513f'; c.fillRect(-5.5, 124, 28.5, 5);
  });

  // Faro
  SP.lighthouse = sprite(90, 90, S, c => {
    softBlob(c, 0, 0, 42, '20,30,30', .4);
    const r = rng(77); lobes(c, 0, 0, 25, 9, '#6d6a67', r); lobes(c, -2, -2, 20, 7, '#8d8a85', r);
    [[19, '#ffffff'], [15, '#e8513f'], [11, '#ffffff'], [7, '#e8513f']].forEach(([rr, col]) => { c.fillStyle = col; c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.16)'; c.lineWidth = .8; c.stroke(); });
    c.fillStyle = '#ffe9a0'; c.beginPath(); c.arc(0, 0, 3.6, 0, TAU); c.fill();
  });
}

function paintGround() {
  const S = V.S, size = 1240, c0 = mkCanvas(size * S, size * S), c = c0.getContext('2d');
  c.scale(S, S); c.translate(size / 2, size / 2);
  const r = rng(4242);
  // Arena
  coastPath(c); c.fillStyle = '#f3deaa'; c.fill();
  c.save(); coastPath(c); c.clip();
  for (let i = 0; i < 2600; i++) { const a = r() * TAU, rr = 435 + r() * 95; c.fillStyle = r() < .5 ? 'rgba(180,140,80,.2)' : 'rgba(255,255,255,.28)'; c.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, 1.2 + r() * 1.3, 1.2 + r()); }
  c.lineWidth = 16; c.strokeStyle = 'rgba(160,125,75,.42)'; coastPath(c); c.stroke();
  c.lineWidth = 6; c.strokeStyle = 'rgba(120,100,70,.35)'; coastPath(c); c.stroke();
  c.restore();
  // Pasto
  const edge = a => -34 + Math.sin(a * 9 + 1) * 5 + Math.sin(a * 17) * 3 + Math.sin(a * 29 + 2) * 1.5;
  c.save(); coastPath(c, -3, edge); c.lineWidth = 7; c.strokeStyle = 'rgba(140,120,60,.45)'; c.stroke(); c.restore();
  coastPath(c, 0, edge); const gg = c.createRadialGradient(-120, -150, 40, 0, 0, 500); gg.addColorStop(0, '#9fd46d'); gg.addColorStop(.55, '#7ec45f'); gg.addColorStop(1, '#5fa956'); c.fillStyle = gg; c.fill();
  c.save(); coastPath(c, 0, edge); c.clip();
  // Manchas
  for (let i = 0; i < 300; i++) { const a = r() * TAU, rr = Math.sqrt(r()) * 480, t = r(); softBlob(c, Math.cos(a) * rr, Math.sin(a) * rr, 26 + r() * 74, t < .4 ? '195,232,120' : t < .75 ? '50,130,80' : '150,205,90', .13 + r() * .1); }
  // Briznas estáticas
  for (let i = 0; i < 7800; i++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * 482, x = Math.cos(a) * rr, y = Math.sin(a) * rr, t = r();
    c.strokeStyle = t < .4 ? 'rgba(46,120,70,.34)' : t < .75 ? 'rgba(180,225,110,.36)' : 'rgba(115,185,90,.42)';
    c.lineWidth = .8 + r() * .5; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - .5) * 4, y - 2 - r() * 4); c.stroke();
  }
  // Florcitas
  for (let i = 0; i < 620; i++) { const a = r() * TAU, rr = 165 + r() * 310; c.fillStyle = pickR(r, ['#fff8ee', '#ffe27a', '#ffb3c8', '#f7f1ff', '#ff8f7a']); c.beginPath(); c.arc(Math.cos(a) * rr, Math.sin(a) * rr, .9 + r() * 1.25, 0, TAU); c.fill(); }
  // Campos
  W.fields.forEach(f => {
    c.save(); c.translate(f.x, f.y); c.rotate(f.rot);
    c.fillStyle = 'rgba(40,80,40,.3)'; roundRect(c, -f.w / 2 - 1, -f.h / 2 + 3, f.w + 2, f.h + 2, 9); c.fill();
    roundRect(c, -f.w / 2, -f.h / 2, f.w, f.h, 9); c.fillStyle = '#6d8c49'; c.fill(); c.save(); c.clip();
    const row = 8.6; let k = 0;
    for (let y = -f.h / 2 + 2; y < f.h / 2; y += row, k++) {
      c.fillStyle = f.crop[0]; roundRect(c, -f.w / 2 + 2, y, f.w - 4, row - 2.8, 2.5); c.fill();
      for (let i = 0; i < f.w * .95; i++) { c.fillStyle = r() < .55 ? f.crop[1] : (r() < .5 ? 'rgba(60,110,50,.5)' : f.crop[0]); c.beginPath(); c.arc(-f.w / 2 + 3 + r() * (f.w - 6), y + r() * (row - 3.2), .85 + r() * .75, 0, TAU); c.fill(); }
    }
    c.restore(); c.strokeStyle = 'rgba(95,68,40,.5)'; c.lineWidth = 2; c.setLineDash([3.5, 5]); roundRect(c, -f.w / 2 - 1, -f.h / 2 - 1, f.w + 2, f.h + 2, 10); c.stroke(); c.setLineDash([]);
    c.restore();
  });
  // Laguna
  { const p = W.pond;
    const ponder = (grow) => { c.beginPath(); for (let i = 0; i <= 50; i++) { const a = i / 50 * TAU, rr = p.r + grow + Math.sin(a * 3 + 1) * 6 + Math.sin(a * 5) * 3; const x = p.x + Math.cos(a) * rr * 1.2, y = p.y + Math.sin(a) * rr * .8; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); };
    ponder(5); c.fillStyle = '#d8c690'; c.fill(); ponder(0);
    const g = c.createRadialGradient(p.x - 8, p.y - 7, 4, p.x, p.y, p.r * 1.25); g.addColorStop(0, '#9be8e4'); g.addColorStop(1, '#3faebf'); c.fillStyle = g; c.fill();
    for (let i = 0; i < 12; i++) { const a = r() * TAU, d = r() * p.r * .72, x = p.x + Math.cos(a) * d * 1.2, y = p.y + Math.sin(a) * d * .8, s = 3 + r() * 3.5; c.fillStyle = '#4e9f58'; c.beginPath(); c.arc(x, y, s, a, a + TAU * .9); c.lineTo(x, y); c.fill(); if (r() < .5) { c.fillStyle = '#ffd1dc'; c.beginPath(); c.arc(x + 1, y - 1, 1.4, 0, TAU); c.fill(); } }
  }
  // Caminos
  const strokePath = (p, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); p.pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.stroke(); };
  W.paths.forEach(p => { strokePath(p, 20, 'rgba(110,90,50,.25)'); strokePath(p, 16, '#d3bd86'); strokePath(p, 11.5, '#ecdba9'); });
  W.paths.forEach(p => p.pts.forEach(q => { for (let i = 0; i < 6; i++) { c.fillStyle = r() < .5 ? 'rgba(150,120,75,.45)' : 'rgba(255,250,225,.6)'; c.beginPath(); c.arc(q.x + (r() - .5) * 15, q.y + (r() - .5) * 15, .6 + r() * 1.1, 0, TAU); c.fill(); } }));
  W.houses.forEach(h => { softBlob(c, h.x, h.y, 36, '225,205,150', .7); });
  // Plaza
  softBlob(c, 0, 0, 200, '50,90,50', .3);
  c.fillStyle = '#c5b692'; c.beginPath(); c.arc(0, 0, 164, 0, TAU); c.fill();
  for (let ring = 68; ring < 160; ring += 11) {
    const n = Math.floor(ring * TAU / 15);
    for (let i = 0; i < n; i++) {
      const a = (i + (ring % 2 ? .5 : 0)) / n * TAU, t = r(); c.save(); c.rotate(a); c.translate(ring, 0);
      c.fillStyle = t < .3 ? '#e9dcbd' : t < .65 ? '#dccdaa' : t < .9 ? '#cfbf9a' : '#e3b48c'; roundRect(c, -4.5, -6, 9, 12, 2.5); c.fill(); c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(-3.7, -5.3, 7.4, 2.2); c.restore();
    }
  }
  c.lineWidth = 5; c.strokeStyle = '#8c7a5a'; c.beginPath(); c.arc(0, 0, 165, 0, TAU); c.stroke();
  c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,250,225,.65)'; c.beginPath(); c.arc(0, 0, 162, 0, TAU); c.stroke();
  // Volumen: luz arriba a la izquierda, sombra abajo a la derecha
  const vol = c.createRadialGradient(-180, -210, 60, -30, -30, 610); vol.addColorStop(0, 'rgba(255,250,200,.2)'); vol.addColorStop(.5, 'rgba(255,255,255,0)'); vol.addColorStop(1, 'rgba(10,50,60,.38)');
  c.fillStyle = vol; c.fillRect(-600, -600, 1200, 1200);
  c.restore();
  // Rocas
  W.rocks.forEach(k => { const q = rng(k.seed), x = Math.cos(k.a) * k.r, y = Math.sin(k.a) * k.r; softBlob(c, x + 2, y + 3, k.s * 1.5, '10,40,50', .4); c.fillStyle = '#7d7c78'; c.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, d = k.s * (.72 + q() * .32); c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } c.closePath(); c.fill(); c.fillStyle = '#a8a6a0'; c.beginPath(); c.arc(x - k.s * .22, y - k.s * .25, k.s * .46, 0, TAU); c.fill(); });
  SP.ground = c0;

  // Mar
  const seaS = Math.min(S * .55, 1.1), seaSize = 3400, sc = mkCanvas(seaSize * seaS, seaSize * seaS), s = sc.getContext('2d');
  s.scale(seaS, seaS); s.translate(seaSize / 2, seaSize / 2);
  const sg = s.createRadialGradient(0, 0, 460, 0, 0, 1650); sg.addColorStop(0, '#62dccb'); sg.addColorStop(.11, '#39bcc1'); sg.addColorStop(.26, '#1f95b0'); sg.addColorStop(.55, '#17769c'); sg.addColorStop(1, '#0f4f78');
  s.fillStyle = sg; s.fillRect(-seaSize / 2, -seaSize / 2, seaSize, seaSize);
  for (let i = 0; i < 240; i++) { const a = r() * TAU, rr = 540 + r() * 1100; softBlob(s, Math.cos(a) * rr, Math.sin(a) * rr, 60 + r() * 170, r() < .5 ? '10,70,110' : '90,215,215', .05 + r() * .06); }
  s.lineCap = 'round';
  for (let i = 0; i < 2300; i++) { const a = r() * TAU, rr = 540 + r() * 1100, x = Math.cos(a) * rr, y = Math.sin(a) * rr, l = 5 + r() * 15; s.strokeStyle = r() < .6 ? `rgba(190,245,245,${.04 + r() * .09})` : `rgba(8,55,90,${.05 + r() * .09})`; s.lineWidth = .8 + r() * 1.1; s.beginPath(); s.moveTo(x - l, y); s.quadraticCurveTo(x, y - 2.5, x + l, y); s.stroke(); }
  // Banco de arena sumergido junto a la costa
  for (let i = 0; i < 90; i++) { const a = r() * TAU, rr = coastAt(a) + 14 + r() * 56; softBlob(s, Math.cos(a) * rr, Math.sin(a) * rr, 26 + r() * 46, '180,240,210', .07 + r() * .09); }
  SP.sea = sc; SP.seaSize = seaSize;
}
const pickR = (r, a) => a[Math.floor(r() * a.length)];

function buildAll() {
  layout();
  const maxZ = Math.max(1, V.lz, V.ez);
  V.S = Math.min(V.base * V.dpr * maxZ, 2300 / 1240);
  buildSprites(); paintGround();
  const sk = $('skel'); if (sk) { sk.width = 640; sk.height = 480; }
}

/* ---------- 7. Estado y reglas ---------- */
/* Parámetros que el servidor permite ajustar en vivo desde /dev */
const CFG = {};
/* Cada modo de juego completa estos ganchos: el motor no conoce las reglas. */
const Rules = {
  day: null,          // (dt) avanza el tiempo y el cielo
  tick: null,         // (dt) lógica propia del modo, antes de mover las ráfagas
  resolve: null,      // (ráfaga) llegó al molino; en red se espera al servidor
  houseWant: null,    // (casa, índice) debe estar encendida
  ui: null,           // () actualiza el HUD en cada cuadro
  cam: null,          // () devuelve {x, y, z} para la cámara
  preGrade: null,     // () dibuja antes de aplicar el color del día
  overlay: null,      // () dibuja encima de todo, en coordenadas de mundo
  onHands: null,      // (lista de manos) recibe cada lectura de MediaPipe
  trainer: null,      // (lista de manos) mientras se graban señas; devuelve true si se ocupó
  netMill: false,     // el ángulo del molino viene de afuera
  noMillControl: false, // los gestos no mueven el molino
  hideRing: false,    // oculta el aro de puntería
  noClouds: false     // sin nubes altas: el vigía necesita ver el mar
};
const GAME_SECS = 90, TOL = 25 * DEG, PERFECT = 9 * DEG, IMPACT = 112, SPAWN_R = 545;
const G = {
  mode: 'attract', t: 0, score: 0, shown: 0, eff: 72, effAvgSum: 0, effAvgN: 0, combo: 0, best: 0, hits: 0, misses: 0, total: 0,
  gusts: [], parts: [], rings: [], pulses: [], pops: [], rockets: [], day: .13, dayTarget: .13, spawnIn: 1, lastA: 0, lastSign: 1, firstGust: true, blackout: false, keyboard: false, fwIn: 0, attractGust: null
};
const M = { a: -.75, vel: 0, dir: 1, moving: false, spin: 0, omega: 2, jolt: 0, fan: 0, glow: 0 };
const Hand = { seen: null, last: null, tried: new Set(), present: false, keyUntil: 0 };

const rotSpeed = () => { const base = CFG['solo.giro'] || 125; return lerp(base, base * 1.24, clamp(G.t / GAME_SECS)) * DEG; };

function makeGust(angle, travel, gold, demo) {
  const n = Q.ribbons + (gold ? 3 : 0), rbs = [], curls = [];
  for (let i = 0; i < n; i++) rbs.push({ off: lerp(-1, 1, (i + rand(.15, .85)) / n), lag: Math.random() * Math.random(), len: rand(125, 300), w: rand(1.5, 4.8), ph: rand(TAU), amp: rand(3, 13), f: rand(.012, .026), v: rand(2, 3.6) });
  for (let i = 0; i < 3; i++) curls.push({ off: rand(-.75, .75), lag: rand(.1, .95), s: rand(10, 20), ph: rand(TAU), d: Math.random() < .5 ? 1 : -1 });
  return { a: angle, dx: Math.cos(angle), dy: Math.sin(angle), nx: -Math.sin(angle), ny: Math.cos(angle), r: SPAWN_R, sp: (SPAWN_R - IMPACT) / travel, state: 'warn', warn: REDUCED ? .5 : .95, warnT: 0, t: 0, end: 0, rbs, curls, gold, demo, emit: 0 };
}
const addPart = o => { if (G.parts.length < 620) G.parts.push(o); };
function burst(x, y, n, opts) {
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), v = rand(opts.v0 || 40, opts.v1 || 220);
    addPart({ k: opts.k || 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, ttl: rand(opts.t0 || .4, opts.t1 || 1), s: rand(opts.s0 || 1.3, opts.s1 || 3.4), c: pick(opts.c || ['#fff4d9', '#ffd76a', '#ffffff']), rot: rand(TAU), vr: rand(-7, 7), drag: opts.drag || 2.4 });
  }
}
function popup(x, y, text, sub, color, big) { G.pops.push({ x, y, text, sub, color, big, life: 0, ttl: 1.25 }); }
function shake(v) { if (!REDUCED) Cam.shake = Math.max(Cam.shake, v); }

function flash(id, cls) { const e = $(id); if (!e) return; e.classList.remove('hit', 'miss'); void e.offsetWidth; e.classList.add(cls); }
function sendPulses(n) {
  const lit = W.houses.filter(h => h.lit > .3 || h.want);
  for (let i = 0; i < n; i++) {
    const h = lit.length ? pick(lit) : pick(W.houses);
    G.pulses.push({ h, t: -i * .06, sp: rand(1.05, 1.5), c: Math.random() < .25 ? SP.gCyan : SP.gGold });
  }
}

/* Efectos de una ráfaga al llegar. No toca puntajes: eso es de cada modo. */
function gustFx(g, hit, perfect, combo) {
  const pan = clamp(g.dx * .8, -1, 1), hx = g.dx * 96, hy = g.dy * 96;
  g.end = 0;
  if (hit) {
    g.state = 'hit';
    M.omega = Math.max(M.omega, 26 + Math.min(16, combo * 1.2)); M.glow = 1;
    G.rings.push({ x: hx * .4, y: hy * .4, r: 40, max: g.gold ? 330 : 240, life: 0, ttl: .8, c: g.gold ? '255,210,100' : '255,245,210', w: 6 });
    G.rings.push({ x: hx * .4, y: hy * .4, r: 20, max: 150, life: 0, ttl: .55, c: '255,255,255', w: 3 });
    burst(hx * .4, hy * .4, g.gold ? 56 : 30, { v0: 70, v1: 340, c: g.gold ? ['#ffd76a', '#fff4d9', '#ffb03a'] : ['#fff4d9', '#ffffff', '#ffd76a', '#9df2d4'] });
    Cam.pulse = 1; shake(g.gold ? 7 : 3);
    Snd.hit(combo, perfect, pan);
    sendPulses(g.gold ? 9 : 5);
  } else {
    g.state = 'miss';
    M.glow = 0;
    G.rings.push({ x: g.dx * 80, y: g.dy * 80, r: 30, max: 170, life: 0, ttl: .6, c: '255,120,95', w: 4 });
    burst(g.dx * 80, g.dy * 80, 15, { k: 'dust', v0: 30, v1: 150, t0: .4, t1: .9, s0: 4, s1: 9, c: ['#c8c2b0', '#a9a697'] });
    shake(6); Snd.miss(pan);
  }
}

/* ---------- 8. Actualización ---------- */
let T = 0;
const SKY = [
  { t: 0, mul: [255, 205, 182], wash: [255, 130, 95, .15], night: .22 },
  { t: .17, mul: [255, 241, 220], wash: [255, 205, 150, .06], night: 0 },
  { t: .48, mul: [255, 255, 250], wash: [255, 255, 255, 0], night: 0 },
  { t: .7, mul: [255, 224, 176], wash: [255, 160, 80, .09], night: .04 },
  { t: .85, mul: [205, 128, 150], wash: [235, 90, 120, .13], night: .56 },
  { t: 1, mul: [74, 88, 156], wash: [38, 58, 160, .1], night: 1 }
];
const Sky = { mul: 'rgb(255,255,255)', wash: 'rgba(255,255,255,0)', night: 0, sx: 1, sy: .4, sa: .25, sl: 1 };
function updateSky() {
  const t = clamp(G.day); let i = 0; while (i < SKY.length - 2 && SKY[i + 1].t < t) i++;
  const a = SKY[i], b = SKY[i + 1], k = smooth((t - a.t) / (b.t - a.t));
  const m = a.mul.map((v, j) => Math.round(lerp(v, b.mul[j], k))), w = a.wash.map((v, j) => lerp(v, b.wash[j], k));
  Sky.mul = `rgb(${m[0]},${m[1]},${m[2]})`; Sky.wash = `rgba(${w[0] | 0},${w[1] | 0},${w[2] | 0},${w[3].toFixed(3)})`;
  Sky.night = lerp(a.night, b.night, k);
  const el = Math.sin(PI * t);
  Sky.sx = Math.cos(PI * t); Sky.sy = .42; Sky.sl = lerp(1.9, .62, Math.pow(el, .7)); Sky.sa = .3 * (1 - Sky.night * .72);
}

function setGestureFromHands(g) {
  if (g === Hand.seen) return;
  Hand.seen = g; if (g) Hand.last = g;
  if (g) { Hand.tried.add(g); Snd.tick(g); }
  syncGestureUI();
}
function applyControl(flags) {
  // flags: comandos activos en este instante. Detener manda sobre todo.
  if (G.mode === 'attract' || G.mode === 'end' || Rules.noMillControl) return;
  if (flags.left) M.dir = -1;
  if (flags.right) M.dir = 1;
  if (flags.fist) {
    if (M.moving) { M.jolt = 1; G.rings.push({ x: 0, y: 0, r: 60, max: 158, life: 0, ttl: .42, c: '255,130,105', w: 3.5 }); burst(0, 0, 10, { k: 'dust', v0: 30, v1: 110, s0: 3, s1: 7, t1: .7, c: ['#e7d8ba', '#c8b895'] }); }
    M.moving = false; M.vel = 0;
  } else if (flags.open) M.moving = true;
}

function update(dt) {
  T += dt;
  // Cámara
  const ck = 1 - Math.exp(-dt * 2.2);
  Cam.x += (Cam.tx - Cam.x) * ck; Cam.y += (Cam.ty - Cam.y) * ck; Cam.z += (Cam.tz - Cam.z) * ck;
  Cam.shake *= Math.exp(-dt * 7); Cam.pulse *= Math.exp(-dt * 6);
  Cam.sx = Math.sin(T * 61) * Cam.shake; Cam.sy = Math.cos(T * 47) * Cam.shake;

  if (Rules.day) Rules.day(dt);
  updateSky();
  if (Rules.tick) Rules.tick(dt);

  // Molino
  if (G.mode !== 'attract' && !Rules.netMill) {
    if (M.moving) { const target = M.dir * rotSpeed(); M.vel += (target - M.vel) * (1 - Math.exp(-dt * 12)); M.a += M.vel * dt; }
    else M.vel = 0;
  }
  M.jolt *= Math.exp(-dt * 7); M.glow *= Math.exp(-dt * 1.2); M.fan += (2.5 + Math.abs(M.vel) * 16) * dt;
  const idle = G.blackout ? .12 : 1.1 + G.eff / 100 * 3.2;
  M.omega += (idle - M.omega) * (1 - Math.exp(-dt * .85));
  M.spin += M.omega * dt;

  // Ráfagas
  for (let i = G.gusts.length - 1; i >= 0; i--) {
    const g = G.gusts[i]; g.t += dt;
    if (g.state === 'warn') {
      g.warnT += dt;
      if (g.warnT >= g.warn) { g.state = 'fly'; Snd.whoosh(clamp(g.dx * .8, -1, 1), (SPAWN_R - IMPACT) / g.sp, g.demo ? .03 : .06, 280, 1200); }
    } else if (g.state === 'fly') {
      g.r -= g.sp * dt;
      g.emit -= dt;
      if (g.emit <= 0) {
        g.emit = g.gold ? .03 : .055;
        const lat = rand(-70, 70) * clamp(g.r / 520) + 0, along = g.r + rand(0, 110);
        const sc = g.gold ? ['#ffd76a', '#ffe9a8'] : ['#ffc1d4', '#fff4d9', '#ffd76a', '#ffffff', '#ff9eb5'];
        addPart({ k: 'petal', x: g.dx * along + g.nx * lat, y: g.dy * along + g.ny * lat, vx: -g.dx * g.sp * rand(.9, 1.25) + g.nx * rand(-22, 22), vy: -g.dy * g.sp * rand(.9, 1.25) + g.ny * rand(-22, 22), life: 0, ttl: rand(.7, 1.5), s: rand(1.5, 3.1), c: pick(sc), rot: rand(TAU), vr: rand(-9, 9), drag: 0 });
      }
      if (g.r <= IMPACT) { if (Rules.resolve) Rules.resolve(g); else g.r = IMPACT; }
    } else {
      g.end += dt;
      g.r -= g.sp * dt * (g.state === 'hit' ? 1.7 : 1.15);
      if (g.end > (g.state === 'hit' ? .42 : .95)) G.gusts.splice(i, 1);
    }
  }

  // Árboles y pasto reaccionan al viento
  const active = G.gusts.filter(g => g.state !== 'warn');
  for (const t of W.trees) {
    let fx = 0, fy = 0;
    for (const g of active) {
      const along = t.x * g.dx + t.y * g.dy, lat = t.x * g.nx + t.y * g.ny;
      if (Math.abs(lat) > 125 || along > g.r + 280 || along < g.r - 50) continue;
      const k = (1 - Math.abs(lat) / 125) * 180; fx -= g.dx * k; fy -= g.dy * k;
    }
    t.vx += (fx - t.sx * 26 - t.vx * 5) * dt; t.vy += (fy - t.sy * 26 - t.vy * 5) * dt;
    t.sx += t.vx * dt * 3; t.sy += t.vy * dt * 3;
    if (t.kind === 3 && (fx || fy) && Math.random() < dt * 4) addPart({ k: 'petal', x: t.x, y: t.y, vx: fx * .45 + rand(-14, 14), vy: fy * .45 + rand(-14, 14), life: 0, ttl: rand(.9, 2), s: rand(1.3, 2.4), c: pick(['#ffc1d4', '#ff9eb5', '#ffe4ec']), rot: rand(TAU), vr: rand(-8, 8), drag: .4 });
  }
  for (const f of W.tufts) {
    let b = 0;
    for (const g of active) {
      const along = f.x * g.dx + f.y * g.dy, lat = f.x * g.nx + f.y * g.ny;
      if (Math.abs(lat) < 96 && along < g.r + 210 && along > g.r - 34) b = 1;
    }
    f.b += (b - f.b) * Math.min(1, dt * 8);
  }

  // Casas: se encienden de la más cercana a la más lejana
  const wantN = Math.round(G.eff / 100 * W.houses.length);
  W.houses.forEach((h, i) => {
    h.want = Rules.houseWant ? Rules.houseWant(h, i) : !G.blackout && i < wantN;
    const was = h.lit; h.lit += ((h.want ? 1 : 0) - h.lit) * (1 - Math.exp(-dt * (h.want ? 3 : 6)));
    if (was < .4 && h.lit >= .4 && h.want) { h.pop = 1; burst(h.x, h.y, 7, { v0: 20, v1: 70, s0: 1, s1: 2.4, t1: .7 }); }
    h.pop *= Math.exp(-dt * 4);
    h.smoke -= dt;
    if (h.lit > .5 && h.smoke <= 0 && Sky.night > .08) { h.smoke = rand(.5, 1); addPart({ k: 'smoke', x: h.x + 7, y: h.y - 5, vx: rand(4, 12), vy: rand(-18, -9), life: 0, ttl: rand(1.6, 2.8), s: rand(2.4, 4), c: '#fff', rot: 0, vr: 0, drag: .1 }); }
  });
  W.lamps.forEach(l => { l.lit += ((!G.blackout && l.rank * 100 < G.eff ? 1 : 0) - l.lit) * (1 - Math.exp(-dt * 4)); });

  // Pulsos de energía
  for (let i = G.pulses.length - 1; i >= 0; i--) {
    const p = G.pulses[i]; p.t += dt * p.sp;
    if (p.t >= 1) { p.h.pop = Math.max(p.h.pop, .75); G.pulses.splice(i, 1); }
  }
  // Ovejas
  for (const s of W.sheep) {
    s.wait -= dt;
    const d = Math.hypot(s.tx - s.x, s.ty - s.y);
    if (d > 2 && s.wait <= 0) { const v = 15 * dt; s.x += (s.tx - s.x) / d * v; s.y += (s.ty - s.y) / d * v; s.a = Math.atan2(s.ty - s.y, s.tx - s.x); s.hop += dt * 11; }
    else if (s.wait <= 0) { s.wait = rand(2, 7); const a = rand(TAU), rr = rand(22, 60), nx = s.x + Math.cos(a) * rr, ny = s.y + Math.sin(a) * rr, q = Math.hypot(nx, ny); if (q > 195 && q < 450) { s.tx = nx; s.ty = ny; } }
  }
  for (const b of W.boats) b.a += b.sp * dt;
  for (const cl of W.clouds) { cl.x += cl.v * dt; if (cl.x > 1800) { cl.x = -1800; cl.y = rand(-950, 950); } }
  const gu = W.gullT; if (gu.wait > 0) gu.wait -= dt; else { gu.x += Math.cos(gu.a) * 95 * dt; gu.y += Math.sin(gu.a) * 95 * dt; if (gu.x > 1600) { gu.x = -1600; gu.y = rand(-620, 620); gu.a = rand(-.22, .22); gu.wait = rand(4, 11); } }

  // Partículas
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i]; p.life += dt;
    if (p.life >= p.ttl) { G.parts[i] = G.parts[G.parts.length - 1]; G.parts.pop(); continue; }
    const dr = Math.exp(-p.drag * dt); p.vx *= dr; p.vy *= dr; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  }
  for (let i = G.rings.length - 1; i >= 0; i--) { const q = G.rings[i]; q.life += dt; if (q.life >= q.ttl) G.rings.splice(i, 1); }
  for (let i = G.pops.length - 1; i >= 0; i--) { const q = G.pops[i]; q.life += dt; if (q.life >= q.ttl) G.pops.splice(i, 1); }

  // Fuegos artificiales al final
  if (G.mode === 'end') {
    G.fwIn -= dt;
    if (G.fwIn <= 0) {
      G.fwIn = rand(.35, .95);
      const a = rand(TAU), rr = rand(180, 620); const tx = Math.cos(a) * rr, ty = Math.sin(a) * rr;
      G.rockets.push({ x: tx * .25, y: ty * .25, tx, ty, t: 0, d: rand(.55, .9), c: pick([['#ffd76a', '#fff4d9'], ['#ff8fab', '#ffe4ec'], ['#7fd8e8', '#ffffff'], ['#6fe3b0', '#eafff5'], ['#ff6f59', '#ffd76a']]) });
    }
  }
  for (let i = G.rockets.length - 1; i >= 0; i--) {
    const r = G.rockets[i]; r.t += dt;
    if (r.t >= r.d) {
      burst(r.tx, r.ty, 62, { k: 'fw', v0: 100, v1: 345, t0: .9, t1: 1.8, s0: 1.5, s1: 3.2, c: r.c, drag: 2.1 });
      G.rings.push({ x: r.tx, y: r.ty, r: 8, max: 150, life: 0, ttl: .5, c: '255,250,225', w: 3 });
      Snd.boom(clamp(r.tx / 700, -1, 1)); G.rockets.splice(i, 1);
    }
  }
  if (Rules.ui) Rules.ui();
}

/* ---------- 9. Render ---------- */
function worldT(z = 1) {
  const s = V.base * Cam.z * (1 + Cam.pulse * .008) * V.dpr * z;
  ctx.setTransform(s, 0, 0, s, (Cam.x + Cam.sx) * V.dpr, (Cam.y + Cam.sy) * V.dpr);
}
const viewR = () => Math.hypot(V.w, V.h) / (2 * V.base * Cam.z) + 80;
const blit = (spr, x, y, s = 1, a = 0) => {
  if (a) { ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.drawImage(spr, -spr.wu * s / 2, -spr.hu * s / 2, spr.wu * s, spr.hu * s); ctx.restore(); }
  else ctx.drawImage(spr, x - spr.wu * s / 2, y - spr.hu * s / 2, spr.wu * s, spr.hu * s);
};
const glowAt = (spr, x, y, r, a = 1) => { ctx.globalAlpha = a; ctx.drawImage(spr, x - r, y - r, r * 2, r * 2); };
function shadowBlob(x, y, r, len) {
  const sx = Sky.sx * Sky.sl * len, sy = Sky.sy * Sky.sl * len, l = Math.hypot(sx, sy), a = Math.atan2(sy, sx);
  ctx.save(); ctx.translate(x + sx * .5, y + sy * .5); ctx.rotate(a); ctx.drawImage(SP.shadow, -r - l * .5, -r, r * 2 + l, r * 2); ctx.restore();
}

function drawSea() {
  ctx.fillStyle = '#0f4f78'; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillRect(0, 0, cv.width, cv.height);
  worldT();
  const hs = SP.seaSize / 2; ctx.drawImage(SP.sea, -hs, -hs, SP.seaSize, SP.seaSize);
  const vr = viewR(), cxW = (V.w / 2 - Cam.x) / (V.base * Cam.z), cyW = (V.h / 2 - Cam.y) / (V.base * Cam.z);
  const vis = (x, y) => Math.hypot(x - cxW, y - cyW) < vr;
  ctx.lineCap = 'round';
  // Corrientes
  ctx.strokeStyle = 'rgba(200,250,250,.13)'; ctx.lineWidth = 2;
  for (const q of W.currents) { const a0 = q.a + Math.sin(T * q.sp + q.ph) * .03; ctx.beginPath(); for (let i = 0; i <= 12; i++) { const a = a0 + q.len * i / 12, rr = q.r + Math.sin(a * 9 + T * .55 + q.ph) * 9; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  // Destellos
  ctx.lineWidth = 2;
  for (const g of W.glints) { if (!vis(g.x, g.y)) continue; const s = Math.sin(T * g.sp + g.ph); if (s < .35) continue; ctx.strokeStyle = `rgba(255,255,255,${(s - .35) * .7})`; const l = g.l * s; ctx.beginPath(); ctx.moveTo(g.x - l, g.y); ctx.quadraticCurveTo(g.x, g.y - 1.6, g.x + l, g.y); ctx.stroke(); }
  // Olas concéntricas
  for (let k = 0; k < 5; k++) {
    const ph = (T * .075 + k / 5) % 1, off = 12 + ph * 145, a = Math.pow(1 - ph, 1.6) * .55 * smooth(ph * 9);
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = lerp(5, 1.3, ph);
    ctx.beginPath(); for (let i = 0; i <= 120; i++) { const an = i / 120 * TAU, rr = COAST[i * 3] + off + Math.sin(an * 7 + T * .6 + k) * (3 + ph * 7) + Math.sin(an * 15 - T * .8) * 2; const x = Math.cos(an) * rr, y = Math.sin(an) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke();
  }
  // Barquitos
  for (const b of W.boats) {
    const x = Math.cos(b.a) * b.r, y = Math.sin(b.a) * b.r; if (!vis(x, y)) continue;
    const h = b.a + (b.sp > 0 ? PI / 2 : -PI / 2);
    ctx.save(); ctx.translate(x, y); ctx.rotate(h);
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-46, -13); ctx.moveTo(-12, 5); ctx.lineTo(-46, 13); ctx.stroke();
    ctx.fillStyle = 'rgba(5,35,55,.28)'; ctx.beginPath(); ctx.ellipse(1, 4, 17, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6d4630'; ctx.beginPath(); ctx.moveTo(19, 0); ctx.quadraticCurveTo(4, 8.5, -14, 6); ctx.lineTo(-14, -6); ctx.quadraticCurveTo(4, -8.5, 19, 0); ctx.fill();
    ctx.fillStyle = '#c99a6b'; ctx.beginPath(); ctx.moveTo(15, 0); ctx.quadraticCurveTo(3, 6, -12, 4); ctx.lineTo(-12, -4); ctx.quadraticCurveTo(3, -6, 15, 0); ctx.fill();
    ctx.rotate(Math.sin(T * .8 + b.r) * .08);
    ctx.fillStyle = b.c; ctx.beginPath(); ctx.moveTo(7, 0); ctx.quadraticCurveTo(-3, 17, -13, 15); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.quadraticCurveTo(-3, -11, -11, -9); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Espuma en la orilla
  const foam = (off, a, wob, ph) => { ctx.beginPath(); for (let i = 0; i <= 180; i++) { const an = i / 180 * TAU, rr = COAST[i * 2] + off + Math.sin(an * 6 + ph) * wob + Math.sin(an * 19 - ph * 1.4) * wob * .55; const x = Math.cos(an) * rr, y = Math.sin(an) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fill(); };
  foam(13 + Math.sin(T * .75) * 5, .24, 4, T * .5);
  foam(6 + Math.sin(T * .75 + .8) * 4, .55, 3, T * .6 + 1);
  foam(1 + Math.sin(T * .75 + 1.5) * 2, .85, 2, T * .7 + 2);
}

function drawGustWakes() {
  for (const g of G.gusts) {
    if (g.state === 'warn' || g.hidden) continue;
    const a = g.state === 'fly' ? .24 : .24 * (1 - g.end / .9); if (a <= 0) continue;
    const c = g.r + 110, l = 190, w = 92 * clamp(g.r / 520) + 34;
    ctx.save(); ctx.translate(g.dx * c, g.dy * c); ctx.rotate(g.a); ctx.globalAlpha = a; ctx.drawImage(SP.gWhite, -l, -w, l * 2, w * 2); ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function aimSector(alpha, from, lighter) {
  const a = M.a, g = ctx.createRadialGradient(0, 0, from, 0, 0, 530);
  const col = M.moving ? '150,240,225' : '255,226,150';
  g.addColorStop(0, `rgba(${col},${alpha})`); g.addColorStop(.75, `rgba(${col},${alpha * .3})`); g.addColorStop(1, `rgba(${col},0)`);
  if (lighter) ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 530, a - TOL, a + TOL); ctx.arc(0, 0, from, a + TOL, a - TOL, true); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function drawLand() {
  ctx.drawImage(SP.ground, -620, -620, 1240, 1240);
  blit(SP.lighthouse, W.light.x, W.light.y);
  if (G.mode !== 'attract' && !Rules.hideRing) aimSector(.3 * (1 - Sky.night * .5), 60);
  drawGustWakes();

  // Sombras
  ctx.globalAlpha = Sky.sa;
  for (const h of W.houses) shadowBlob(h.x, h.y, 25, 15);
  for (const t of W.trees) shadowBlob(t.x, t.y, 24 * t.s, 24 * t.s);
  for (const s of W.sheep) shadowBlob(s.x, s.y, 8, 2);
  shadowBlob(0, 0, 62, 70);
  ctx.globalAlpha = 1;

  // Cables de luz
  const wires = .12 + G.eff / 100 * .3;
  ctx.strokeStyle = `rgba(70,52,34,${wires})`; ctx.lineWidth = 1;
  ctx.beginPath(); for (const p of W.paths) { p.pts.forEach((q, i) => { if (i % 4 === 0) i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); } ctx.stroke();

  // Faroles
  for (const l of W.lamps) { ctx.fillStyle = '#4c3a2c'; ctx.beginPath(); ctx.arc(l.x, l.y, 2.6, 0, TAU); ctx.fill(); ctx.fillStyle = `rgba(255,225,150,${.3 + l.lit * .7})`; ctx.beginPath(); ctx.arc(l.x, l.y, 1.5, 0, TAU); ctx.fill(); }

  // Pasto animado
  const tone = ['#3f8d55', '#a6d970'];
  for (let k = 0; k < 2; k++) {
    ctx.strokeStyle = tone[k]; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath();
    for (const f of W.tufts) {
      if (f.tone !== k) continue;
      const sw = Math.sin(T * 1.7 + f.ph) * 1.6;
      let lx = sw, ly = -f.l;
      if (f.b > .02) { const ang = Math.atan2(f.y, f.x); lx = lerp(lx, -Math.cos(ang) * f.l * .95, f.b); ly = lerp(ly, -Math.sin(ang) * f.l * .95, f.b); }
      ctx.moveTo(f.x, f.y); ctx.quadraticCurveTo(f.x + lx * .25, f.y + ly * .6, f.x + lx, f.y + ly);
      ctx.moveTo(f.x + 3, f.y + 1); ctx.quadraticCurveTo(f.x + 3 + lx * .3, f.y + ly * .4, f.x + 3 + lx * .85, f.y + ly * .75);
    }
    ctx.stroke();
  }
  // Ovejas
  for (const s of W.sheep) blit(SP.sheep, s.x, s.y - Math.abs(Math.sin(s.hop)) * 1.7, 1, s.a);
  // Casas
  for (const h of W.houses) {
    const k = 1 + h.pop * .14; blit(SP.house[h.roof], h.x, h.y, k, h.a);
  }
  // Árboles
  for (const t of W.trees) {
    const ix = Math.sin(T * 1.05 + t.ph) * 1.1, iy = Math.cos(T * .87 + t.ph) * .8;
    const s = t.s * 64, b = SP.treeB[t.kind], a = SP.treeT[t.kind];
    ctx.drawImage(b, t.x + t.sx * .55 + ix * .5 - s / 2, t.y + t.sy * .55 + iy * .5 - s / 2, s, s);
    ctx.drawImage(a, t.x + t.sx + ix - s / 2, t.y + t.sy + iy - s / 2, s, s);
  }
}

function drawMill() {
  const a = M.a, fx = Math.cos(a), fy = Math.sin(a), px = -fy, py = fx;
  blit(SP.tower, 0, 0);
  // Capota con sacudida al frenar
  const wob = Math.sin(T * 34) * M.jolt * .022;
  ctx.save(); ctx.rotate(a + wob);
  ctx.drawImage(SP.cap, -110, -65, 220, 130);
  // Rueda de cola
  ctx.translate(-93, 0);
  ctx.fillStyle = '#5a3a24'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
  for (let i = 0; i < 6; i++) {
    const th = M.fan + i / 6 * TAU, y = Math.cos(th) * 19, xx = Math.sin(th) * 5.5;
    ctx.strokeStyle = i % 2 ? '#fff1d6' : '#e8513f'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(xx, y); ctx.stroke();
  }
  ctx.restore();

  // Rotor: disco inclinado proyectado desde arriba
  const hx = fx * 58, hy = fy * 58, tilt = .4;
  const sh = 40 * Sky.sl;
  ctx.save(); ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([px, py, fx * tilt, fy * tilt, hx + Sky.sx * sh, hy + Sky.sy * sh])));
  ctx.fillStyle = `rgba(8,38,34,${Sky.sa * .7})`;
  for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(M.spin + i * PI / 2); ctx.fillRect(-5, 22, 26, 106); ctx.restore(); }
  ctx.restore();

  const w = Math.abs(M.omega), blur = clamp((w - 5) / 24);
  const base = ctx.getTransform();
  const rotorM = base.multiply(new DOMMatrix([px, py, fx * tilt, fy * tilt, hx, hy]));
  // Disco de movimiento
  if (blur > .02) {
    ctx.setTransform(rotorM);
    const g = ctx.createRadialGradient(0, 0, 20, 0, 0, 131);
    g.addColorStop(0, 'rgba(255,245,220,0)'); g.addColorStop(.5, `rgba(255,245,220,${blur * .3})`); g.addColorStop(.96, `rgba(255,245,220,${blur * .4})`); g.addColorStop(1, 'rgba(255,245,220,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 131, 0, TAU); ctx.fill();
  }
  // Aspas ordenadas por altura (las más altas se dibujan al final)
  const order = [0, 1, 2, 3].map(i => { const th = M.spin + i * PI / 2; return { th, v: Math.cos(th) }; }).sort((p, q) => q.v - p.v);
  const ghosts = blur > .05 ? 3 : 0;
  for (const b of order) {
    const persp = 1 - .13 * b.v;
    for (let k = ghosts; k >= 0; k--) {
      ctx.setTransform(rotorM); ctx.rotate(b.th - k * M.omega * .0075); ctx.scale(persp, persp);
      ctx.globalAlpha = k === 0 ? 1 - blur * .25 : (.34 - k * .07) * blur + .03;
      ctx.drawImage(SP.sail, -24, -2, 48, 136);
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(rotorM);
  ctx.fillStyle = '#4c3020'; ctx.beginPath(); ctx.arc(0, 0, 13.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#8c5d3b'; ctx.beginPath(); ctx.arc(-1.8, -2.6, 10, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffc857'; ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, TAU); ctx.fill();
  ctx.setTransform(base);
}

function drawAtmosphere() {
  // Gaviotas
  const gu = W.gullT;
  if (gu.wait <= 0) {
    for (const b of W.gulls) {
      const c = Math.cos(gu.a), s = Math.sin(gu.a), x = gu.x - c * b.oy - s * b.ox, y = gu.y - s * b.oy + c * b.ox;
      const fl = Math.sin(T * 8 + b.ph) * 5;
      ctx.save(); ctx.translate(x + 28 * Sky.sl * Sky.sx, y + 38); ctx.rotate(gu.a); ctx.strokeStyle = `rgba(10,40,50,${Sky.sa * .65})`; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-3, -11 - fl * .3); ctx.quadraticCurveTo(0, -3, 2, 0); ctx.quadraticCurveTo(0, 3, -3, 11 + fl * .3); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.translate(x, y); ctx.rotate(gu.a); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-3 - fl * .3, -13); ctx.quadraticCurveTo(0, -5, 3, 0); ctx.quadraticCurveTo(0, 5, -3 - fl * .3, 13); ctx.stroke(); ctx.fillStyle = '#ffae3b'; ctx.beginPath(); ctx.arc(4, 0, 1.2, 0, TAU); ctx.fill(); ctx.restore();
    }
  }
  // Sombras de nubes y nubes
  for (const cl of W.clouds) {
    const sp = SP.cloudSh[cl.k], w = sp.wu * cl.s, h = sp.hu * cl.s;
    ctx.globalAlpha = Sky.sa * .46; ctx.drawImage(sp, cl.x + 45 * Sky.sx - w / 2, cl.y + 55 - h / 2, w, h);
  }
  if (!Rules.noClouds) for (const cl of W.clouds) {
    const d = Math.hypot(cl.x, cl.y), a = clamp((d - 470) / 300) * .92;
    if (a <= .01) continue;
    const sp = SP.cloud[cl.k], w = sp.wu * cl.s * 1.08, h = sp.hu * cl.s * 1.08;
    ctx.globalAlpha = a; ctx.drawImage(sp, cl.x * 1.05 - w / 2, cl.y * 1.05 - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
}

function grade() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = Sky.mul; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = Sky.wash; ctx.fillRect(0, 0, cv.width, cv.height);
}

function drawLights() {
  const n = Sky.night, L = smooth((n - .03) / .55);
  worldT();
  ctx.globalCompositeOperation = 'lighter';
  // Mar nocturno: estrellas reflejadas y olas bioluminiscentes
  if (n > .2) {
    const a = smooth((n - .2) / .7);
    ctx.fillStyle = '#fff';
    for (const s of W.stars) { const tw = .4 + .6 * Math.abs(Math.sin(T * s.sp + s.ph)); ctx.globalAlpha = a * tw * .85; ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, TAU); ctx.fill(); }
    for (let k = 0; k < 3; k++) {
      const ph = (T * .11 + k / 3) % 1, off = 4 + ph * 62;
      ctx.globalAlpha = a * (1 - ph) * .62; ctx.strokeStyle = 'rgb(90,235,225)'; ctx.lineWidth = lerp(4.5, 1, ph);
      ctx.beginPath(); for (let i = 0; i <= 120; i++) { const an = i / 120 * TAU, rr = COAST[i * 3] + off + Math.sin(an * 8 + T + k) * 4; const x = Math.cos(an) * rr, y = Math.sin(an) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke();
    }
  }
  // Reflejo del sol o de la luna en el mar
  { const t = G.day, sunA = PI + t * PI * .95, cx = Math.cos(sunA) * 860, cy = Math.sin(sunA) * 640 - 40;
    const warm = n < .6, base = warm ? '255,205,150' : '205,225,255', str = warm ? .28 + (1 - Math.sin(PI * t)) * .32 : .56;
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const u = (i * 37.3) % 1, v = (i * 91.7) % 1, x = cx + (u - .5) * 300, y = cy + (v - .5) * 240;
      if (Math.hypot(x, y) < 545) continue;
      const s = Math.sin(T * (1.4 + u * 2) + i); if (s < 0) continue;
      ctx.globalAlpha = s * str; ctx.strokeStyle = `rgb(${base})`; ctx.lineWidth = 2.6; const l = 8 + v * 22 * s; ctx.beginPath(); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); ctx.stroke();
    }
  }
  // Casas
  for (const h of W.houses) {
    const f = h.lit > .9 && G.blackout ? 1 : 1;
    const l = h.lit * f; if (l < .02) continue;
    const pulse = 1 + Math.sin(T * 2.2 + h.flick) * .04;
    glowAt(SP.gWarm, h.x, h.y, (42 + L * 26) * pulse + h.pop * 26, l * (.12 + L * .66) + h.pop * .5);
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.a); ctx.globalAlpha = l * (.25 + L * .75); ctx.fillStyle = 'rgb(255,214,120)';
    for (const [wx, wy] of [[-14, 16], [-3, 16], [8, 16], [-14, -17.5], [4, -17.5]]) ctx.fillRect(wx, wy, 6, 2);
    ctx.restore();
  }
  // Faroles
  for (const q of W.lamps) if (q.lit > .02) glowAt(SP.gWarm, q.x, q.y, 28, q.lit * L * .65);
  // Cables encendidos
  if (L > .02 && G.eff > 0) {
    ctx.globalAlpha = L * (.1 + G.eff / 100 * .3); ctx.strokeStyle = 'rgb(255,205,120)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath(); for (const p of W.paths) p.pts.forEach((q, i) => { if (i % 4 === 0) i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
  }
  // Faro
  if (L > .05) {
    const a = T * .5, l = W.light;
    glowAt(SP.gWhite, l.x, l.y, 46, L * .85);
    ctx.globalAlpha = 1;
    for (const off of [0, PI]) {
      const dir = a + off, g = ctx.createRadialGradient(l.x, l.y, 4, l.x, l.y, 760);
      g.addColorStop(0, `rgba(255,245,200,${.34 * L})`); g.addColorStop(1, 'rgba(255,245,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.arc(l.x, l.y, 760, dir - .09, dir + .09); ctx.closePath(); ctx.fill();
    }
  }
  // Luciérnagas
  if (L > .12) for (const f of W.flies) {
    const x = f.x + Math.sin(T * .6 * f.s + f.ph) * 22, y = f.y + Math.cos(T * .45 * f.s + f.ph * 2) * 18, tw = Math.pow(Math.max(0, Math.sin(T * 2.2 * f.s + f.ph)), 3);
    if (tw > .03) glowAt(SP.gGold, x, y, 8, tw * L);
  }
  // Brillo del molino según la energía
  const hub = .05 + G.eff / 100 * (.14 + L * .48) + M.glow * .75;
  if (!G.blackout) glowAt(SP.gGold, Math.cos(M.a) * 58, Math.sin(M.a) * 58, 58 + G.eff * .55 + M.glow * 90, hub);
  // Pulsos de energía
  for (const p of G.pulses) {
    if (p.t < 0) continue;
    const route = W.paths[p.h.path], q = p.t < .84 ? W.pathPoint(route, p.t / .84) : null;
    let x, y; if (q) { x = q.x; y = q.y; } else { const e = route.pts[route.pts.length - 1], k = (p.t - .84) / .16; x = lerp(e.x, p.h.x, k); y = lerp(e.y, p.h.y, k); }
    glowAt(p.c, x, y, 18 + L * 7, .95); glowAt(SP.gWhite, x, y, 6, 1);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

function drawRing() {
  const R = 178, a = M.a;
  if (G.mode === 'attract' || Rules.hideRing) return;
  if (Sky.night > .1) aimSector(.15 * Sky.night, 186, true);
  // Bordes del sector, animados
  ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash([3, 15]); ctx.lineDashOffset = T * (M.moving ? 42 : 18);
  ctx.strokeStyle = `rgba(255,245,215,${.32 + Sky.night * .22})`; ctx.lineWidth = 2.6;
  for (const e of [a - TOL, a + TOL]) { ctx.beginPath(); ctx.moveTo(Math.cos(e) * (R + 8), Math.sin(e) * (R + 8)); ctx.lineTo(Math.cos(e) * 505, Math.sin(e) * 505); ctx.stroke(); }
  ctx.restore();
  // Aro con marcas
  ctx.strokeStyle = 'rgba(255,248,225,.42)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,248,225,.5)'; ctx.lineWidth = 1.6; ctx.beginPath();
  for (let i = 0; i < 24; i++) { const an = i / 24 * TAU, r0 = i % 6 === 0 ? R - 8 : R - 4; ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0); ctx.lineTo(Math.cos(an) * R, Math.sin(an) * R); } ctx.stroke();

  // Próxima ráfaga: arco que guía hacia dónde girar
  let next = null; for (const g of G.gusts) if (!g.hidden && (g.state === 'fly' || g.state === 'warn') && (!next || g.r < next.r)) next = g;
  let aligned = false;
  if (next) {
    const d = angDiff(next.a, a); aligned = Math.abs(d) <= TOL;
    if (!aligned) {
      ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash([2, 11]); ctx.lineDashOffset = -T * 40 * Math.sign(d);
      ctx.strokeStyle = 'rgba(255,190,165,.9)'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(0, 0, R, a, a + d, d < 0); ctx.stroke(); ctx.restore();
    }
  }
  // Tolerancia ±25°
  const col = aligned ? '#7cf2bd' : M.moving ? '#9beee0' : '#ffd76a';
  ctx.lineCap = 'round'; ctx.strokeStyle = col; ctx.lineWidth = aligned ? 9 : 7;
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .34; ctx.lineWidth = aligned ? 18 : 13; ctx.beginPath(); ctx.arc(0, 0, R, a - TOL, a + TOL); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.lineWidth = aligned ? 8 : 6; ctx.beginPath(); ctx.arc(0, 0, R, a - TOL, a + TOL); ctx.stroke();
  // Puntero
  ctx.save(); ctx.rotate(a); ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(40,30,20,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(R + 15, 0); ctx.lineTo(R + 1, -8); ctx.lineTo(R - 4, 0); ctx.lineTo(R + 1, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  // Marcadores de ráfagas
  for (const g of G.gusts) {
    if ((g.state !== 'fly' && g.state !== 'warn') || g.hidden) continue;
    const inside = Math.abs(angDiff(g.a, a)) <= TOL;
    const prog = g.state === 'warn' ? 0 : clamp(1 - (g.r - IMPACT) / (SPAWN_R - IMPACT));
    ctx.save(); ctx.rotate(g.a);
    const c = inside ? '#7cf2bd' : g.gold ? '#ffd76a' : '#ff9c88', rr = R + 25;
    ctx.strokeStyle = 'rgba(10,30,36,.55)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, rr, -.075, .075); ctx.stroke();
    ctx.strokeStyle = c; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.arc(0, 0, rr, -.075, -.075 + .15 * prog + .001); ctx.stroke();
    const bob = Math.sin(T * 8) * 2;
    ctx.fillStyle = c; ctx.strokeStyle = 'rgba(10,30,36,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rr - 8 + bob, 0); ctx.lineTo(rr + 7 + bob, -9); ctx.lineTo(rr + 7 + bob, 9); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  }
}

function drawGust(g) {
  if (g.hidden) return;
  const night = Sky.night;
  if (g.state === 'warn') {
    const k = clamp(g.warnT / g.warn), x = g.dx * (coastAt(g.a) + 26), y = g.dy * (coastAt(g.a) + 26);
    const col = g.tint ? g.tint.join(',') : g.gold ? '255,214,107' : '255,255,255';
    ctx.save(); ctx.lineCap = 'round';
    ctx.setLineDash([3, 18]); ctx.lineDashOffset = T * 66; ctx.strokeStyle = `rgba(${col},${smooth(k) * .55})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(g.dx * 205, g.dy * 205); ctx.stroke(); ctx.setLineDash([]);
    for (let j = 0; j < 2; j++) {
      const q = (k * 1.6 + j * .5) % 1; ctx.strokeStyle = `rgba(${col},${(1 - q) * .85})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 10 + q * 44, 0, TAU); ctx.stroke();
    }
    ctx.translate(x, y); ctx.rotate(T * 7);
    ctx.strokeStyle = `rgba(${col},${smooth(k * 2)})`; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i <= 26; i++) { const t = i / 26, a = t * TAU * 2.2, r = 2 + t * 18 * easeBack(k); i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
    ctx.restore();
    return;
  }
  const capT = g.state === 'hit' ? clamp(g.end / .4) : 0, missT = g.state === 'miss' ? clamp(g.end / .95) : 0;
  const alphaG = (1 - capT * capT) * (1 - missT) * smooth(g.t > g.warn ? (g.t - g.warn) / .35 : 0);
  if (alphaG <= .01) return;
  const col = g.tint && missT === 0 ? g.tint : g.gold ? [255, 208, 96] : missT > 0 ? [lerp(255, 180, missT), lerp(255, 190, missT), lerp(255, 195, missT)] : [255, 255, 255];
  const cs = `${col[0] | 0},${col[1] | 0},${col[2] | 0}`;
  if ((night > .3 || g.gold) && !g.tint) ctx.globalCompositeOperation = 'lighter';
  const P = 14, Lx = new Float32Array(P + 1), Ly = new Float32Array(P + 1), Rx = new Float32Array(P + 1), Ry = new Float32Array(P + 1);
  for (const rb of g.rbs) {
    const head = g.r + rb.lag * 170;
    for (let j = 0; j <= P; j++) {
      const s = j / P, rr = head + s * rb.len;
      const fan = 16 + 86 * Math.pow(clamp(rr / 520), .85);
      let lat = rb.off * fan * (1 - capT) + Math.sin(rr * rb.f + T * rb.v + rb.ph) * rb.amp * (.3 + clamp(rr / 500)) * (1 - capT);
      if (missT > 0) lat += (rb.off >= 0 ? 1 : -1) * Math.pow(missT, 1.4) * 250 * clamp(1 - rr / 300, .1, 1);
      const w = rb.w * Math.sin(PI * Math.pow(s, .58)) + .12;
      const cx = g.dx * rr + g.nx * lat, cy = g.dy * rr + g.ny * lat;
      Lx[j] = cx + g.nx * w; Ly[j] = cy + g.ny * w; Rx[j] = cx - g.nx * w; Ry[j] = cy - g.ny * w;
    }
    const gr = ctx.createLinearGradient((Lx[0] + Rx[0]) / 2, (Ly[0] + Ry[0]) / 2, (Lx[P] + Rx[P]) / 2, (Ly[P] + Ry[P]) / 2);
    const am = alphaG * (g.gold ? .92 : .82);
    gr.addColorStop(0, `rgba(${cs},${am})`); gr.addColorStop(.42, `rgba(${cs},${am * .62})`); gr.addColorStop(1, `rgba(${cs},0)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(Lx[0], Ly[0]);
    for (let j = 1; j <= P; j++) ctx.lineTo(Lx[j], Ly[j]);
    for (let j = P; j >= 0; j--) ctx.lineTo(Rx[j], Ry[j]);
    ctx.closePath(); ctx.fill();
  }
  // Rulos de viento
  ctx.lineCap = 'round';
  for (const c of g.curls) {
    const rr = g.r + c.lag * 210, lat = c.off * (16 + 80 * clamp(rr / 520)) * (1 - capT) + (missT > 0 ? (c.off >= 0 ? 1 : -1) * missT * 180 : 0);
    const x = g.dx * rr + g.nx * lat, y = g.dy * rr + g.ny * lat;
    ctx.strokeStyle = `rgba(${cs},${alphaG * .85})`; ctx.lineWidth = 2.7;
    ctx.beginPath();
    for (let i = 0; i <= 22; i++) { const t = i / 22, a = g.a + c.ph + c.d * (t * TAU * 1.85 + T * 2.7), r = c.s * (1 - t * .84); const px = x + Math.cos(a) * r + g.dx * (1 - t) * 34, py = y + Math.sin(a) * r + g.dy * (1 - t) * 34; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawParticles() {
  // Normales
  for (const p of G.parts) {
    const k = p.life / p.ttl;
    if (p.k === 'petal') {
      ctx.globalAlpha = (1 - k) * .95; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.sin(p.rot * 1.4)) * .7 + .3); ctx.beginPath(); ctx.ellipse(0, 0, p.s * 1.25, p.s * .72, 0, 0, TAU); ctx.fill(); ctx.restore();
    } else if (p.k === 'dust') {
      ctx.globalAlpha = (1 - k) * .46; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 + k), 0, TAU); ctx.fill();
    } else if (p.k === 'smoke') {
      ctx.globalAlpha = Math.sin(k * PI) * .3 * (1 - Sky.night * .55); ctx.drawImage(SP.gWhite, p.x - p.s * (1 + k * 2.5), p.y - p.s * (1 + k * 2.5), p.s * 2 * (1 + k * 2.5), p.s * 2 * (1 + k * 2.5));
    }
  }
  // Aditivas
  ctx.globalCompositeOperation = 'lighter';
  for (const p of G.parts) {
    if (p.k !== 'spark' && p.k !== 'fw') continue;
    const k = p.life / p.ttl, a = p.k === 'fw' ? (k < .7 ? 1 : (1 - k) / .3) * (.6 + Math.sin(p.life * 28 + p.rot) * .4) : 1 - k;
    ctx.globalAlpha = a; ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - k * .55), 0, TAU); ctx.fill();
    if (p.k === 'fw') { ctx.globalAlpha = a * .32; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2.8, 0, TAU); ctx.fill(); }
  }
  for (const r of G.rockets) { const k = easeOut(r.t / r.d), x = lerp(r.x, r.tx, k), y = lerp(r.y, r.ty, k); glowAt(SP.gGold, x, y, 22, .95); glowAt(SP.gWhite, x, y, 7, 1); }
  ctx.globalAlpha = 1;
  for (const r of G.rings) { const k = r.life / r.ttl, e = easeOut(k); ctx.strokeStyle = `rgba(${r.c},${(1 - k) * .9})`; ctx.lineWidth = r.w * (1 - k) + .3; ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r, r.max, e), 0, TAU); ctx.stroke(); }
  ctx.globalCompositeOperation = 'source-over';
}

function drawPopups() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const p of G.pops) {
    const k = p.life / p.ttl, sc = easeBack(Math.min(1, p.life / .26)) * (p.big ? 1.2 : 1), y = p.y - easeOut(k) * 44, a = k > .68 ? 1 - (k - .68) / .32 : 1;
    ctx.globalAlpha = a; ctx.save(); ctx.translate(p.x, y); ctx.scale(sc, sc);
    ctx.font = `900 42px Fraunces, Georgia, serif`; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(7,32,40,.82)'; ctx.strokeText(p.text, 0, 0); ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
    ctx.font = `800 19px Figtree, system-ui, sans-serif`; ctx.lineWidth = 5; ctx.strokeText(p.sub, 0, 31); ctx.fillStyle = '#fff4d9'; ctx.fillText(p.sub, 0, 31);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawVignette() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const w = cv.width, h = cv.height, g = ctx.createRadialGradient((Cam.x) * V.dpr, Cam.y * V.dpr, Math.min(w, h) * .42, Cam.x * V.dpr, Cam.y * V.dpr, Math.hypot(w, h) * .68);
  g.addColorStop(0, 'rgba(4,20,40,0)'); g.addColorStop(1, `rgba(4,20,40,${.26 + Sky.night * .24})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // Apagón
  if (G.blackout) { ctx.fillStyle = `rgba(3,8,20,${clamp((G.day - .6) * 1.3) * .35})`; ctx.fillRect(0, 0, w, h); }
}

// Telón de nubes de entrada
const Intro = { t: REDUCED ? 9 : 0, dur: 2.5, puffs: [] };
for (let i = 0; i < 24; i++) { const a = i / 24 * TAU + (i % 3) * .1, d = (i % 4) * .17 + .1; Intro.puffs.push({ a, d, k: i % 3, s: 2 + (i % 5) * .32 }); }
function drawIntro(dt) {
  if (Intro.t >= Intro.dur) return;
  Intro.t += dt; const e = clamp(Intro.t / Intro.dur), k = Math.pow(smooth(e), 1.5);
  ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
  const cx = V.w / 2, cy = V.h / 2, reach = Math.hypot(V.w, V.h) * .78;
  ctx.fillStyle = `rgba(250,243,228,${clamp(1 - e * 3.2)})`; ctx.fillRect(0, 0, V.w, V.h);
  const scale = Math.max(V.w, V.h) / 950;
  ctx.globalAlpha = clamp((1 - e) * 2.4);
  for (const p of Intro.puffs) {
    const d = (p.d * .7 + k * 1.5) * reach, x = cx + Math.cos(p.a) * d, y = cy + Math.sin(p.a) * d * .85, sp = SP.cloud[p.k], w = sp.wu * p.s * scale, h = sp.hu * p.s * scale;
    ctx.drawImage(sp, x - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
}

function render(dt) {
  drawSea();
  worldT();
  drawLand();
  drawMill();
  drawAtmosphere();
  if (Rules.preGrade) Rules.preGrade();
  grade();
  drawLights();
  worldT();
  drawRing();
  G.gusts.forEach(drawGust);
  drawParticles();
  drawPopups();
  if (Rules.overlay) { worldT(); Rules.overlay(); }
  drawVignette();
  drawIntro(dt);
}

/* ---------- 10. Visión: MediaPipe Hands ---------- */
const MP_HANDS = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
const MP_CAM = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js';
const Vision = { ready: false, hands: null, camera: null, last: 0, slots: { Left: { h: [], g: null, seen: 0 }, Right: { h: [], g: null, seen: 0 } }, lastHandAt: 0, busy: false };
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('script')); document.head.appendChild(s); });

async function startVision(onStatus) {
  if (Vision.ready) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('nocam'), { kind: 'nocam' });
  onStatus('Pidiendo permiso de cámara…');
  // Primero el permiso: así un rechazo no obliga a descargar el modelo.
  let probe;
  try { probe = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }); }
  catch (e) { throw Object.assign(e, { kind: e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'nocam' : 'denied' }); }
  probe.getTracks().forEach(t => t.stop());

  onStatus('Cargando el modelo de manos…');
  try { await Promise.all([loadScript(MP_HANDS + 'hands.js'), loadScript(MP_CAM)]); }
  catch (e) { throw Object.assign(e, { kind: 'net' }); }
  const hands = new window.Hands({ locateFile: f => MP_HANDS + f });
  // selfieMode voltea la imagen de entrada: las etiquetas Left/Right pasan a coincidir con la mano real del jugador
  hands.setOptions({ selfieMode: true, maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: .6, minTrackingConfidence: .55 });
  hands.onResults(onHandResults);
  await hands.initialize();
  Vision.hands = hands;

  const vid = $('vid');
  Vision.camera = new window.Camera(vid, {
    width: 640, height: 480, facingMode: 'user',
    onFrame: async () => {
      const now = performance.now();
      if (now - Vision.last < 36 || Vision.busy) return; // ~25 lecturas por segundo: deja aire a la animación
      Vision.last = now; Vision.busy = true;
      const t0 = performance.now();
      try { await hands.send({ image: vid }); } finally { Vision.busy = false; }
      const took = performance.now() - t0;
      Vision.avg = Vision.avg ? lerp(Vision.avg, took, .05) : took;
      if (Vision.avg > 42 && !Vision.lite) { Vision.lite = true; hands.setOptions({ modelComplexity: 0 }); }
    }
  });
  onStatus('Encendiendo la cámara…');
  await Vision.camera.start();
  Vision.ready = true;
  if ($('camMsg')) $('camMsg').style.display = 'none';
}

function onHandResults(res) {
  const now = performance.now();
  const lms = res.multiHandLandmarks || [], world = res.multiHandWorldLandmarks || [], handed = res.multiHandedness || [];
  const seenThisFrame = {};
  const details = [];
  lms.forEach((lm, i) => {
    const label = handed[i] ? handed[i].label : 'Right';
    if (seenThisFrame[label]) return; seenThisFrame[label] = true;
    const src = world[i] && world[i].length === 21 ? world[i] : lm.map(p => ({ x: p.x * 4 / 3, y: p.y, z: p.z * 4 / 3 }));
    details.push({ lm, world: src, label, g: null });
    if (Rules.trainer) return; // mientras se graba no se reconoce nada
    const g = Signs.match(src, label);
    const slot = Vision.slots[label];
    slot.h.push(g); if (slot.h.length > 4) slot.h.shift();
    slot.seen = now;
    // Se acepta un gesto cuando aparece en 3 de las últimas 4 lecturas
    const count = {}; slot.h.forEach(g => { if (g) count[g] = (count[g] || 0) + 1; });
    let stable = null; for (const k in count) if (count[k] >= 3) stable = k;
    slot.g = stable; if (!stable && slot.h.filter(g => g === null).length >= 3) slot.g = null;
    details[details.length - 1].g = slot.g;
  });
  for (const k in Vision.slots) { const s = Vision.slots[k]; if (now - s.seen > 280) { s.h.length = 0; s.g = null; } }
  Hand.present = lms.length > 0;
  if (Rules.trainer && Rules.trainer(details)) { drawSkeleton(details); return; }
  const flags = {}; for (const k in Vision.slots) if (Vision.slots[k].g) flags[Vision.slots[k].g] = true;
  // Lo que se muestra: detener manda, después dirección, después avanzar
  const shown = flags.fist ? 'fist' : flags.left ? 'left' : flags.right ? 'right' : flags.open ? 'open' : null;
  if (performance.now() > Hand.keyUntil) { setGestureFromHands(shown); syncGestureUI(); }
  applyControl(flags);
  drawSkeleton(details);
  if (Rules.onHands) Rules.onHands(details);
}

function drawSkeleton(list) {
  const c = $('skel'); if (!c) return; const x = c.getContext('2d'), w = c.width, h = c.height;
  x.clearRect(0, 0, w, h);
  for (const d of list) {
    const col = d.g ? GESTURES[d.g].c : '#fff4d9', P = d.lm.map(p => ({ x: p.x * w, y: p.y * h }));
    x.lineCap = 'round'; x.strokeStyle = 'rgba(5,25,32,.72)'; x.lineWidth = 9; x.beginPath(); BONES.forEach(([a, b]) => { x.moveTo(P[a].x, P[a].y); x.lineTo(P[b].x, P[b].y); }); x.stroke();
    x.strokeStyle = col; x.lineWidth = 4.5; x.beginPath(); BONES.forEach(([a, b]) => { x.moveTo(P[a].x, P[a].y); x.lineTo(P[b].x, P[b].y); }); x.stroke();
    P.forEach((p, i) => { const tip = i % 4 === 0 && i > 0; x.fillStyle = tip ? col : '#fff'; x.strokeStyle = 'rgba(5,25,32,.8)'; x.lineWidth = 2; x.beginPath(); x.arc(p.x, p.y, tip ? 8 : 4.8, 0, TAU); x.fill(); x.stroke(); });
    const lbl = d.label === 'Left' ? 'Izquierda' : 'Derecha';
    x.font = '800 23px Figtree, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.lineWidth = 7; x.strokeStyle = 'rgba(5,25,32,.85)';
    const lx = clamp(P[0].x, 60, w - 60), ly = clamp(P[0].y + 30, 20, h - 18); x.strokeText(lbl, lx, ly); x.fillStyle = '#fff'; x.fillText(lbl, lx, ly);
  }
}

/* ---------- Lectura de gestos en pantalla ---------- */
const uiCache = {};
function setText(id, t) { if (uiCache[id] !== t) { uiCache[id] = t; $(id).textContent = t; } }
function syncGestureUI() {
  const g = Hand.seen, box = $('gestureNow'), camBox = $('cam');
  if (!box) return;
  const key = (g || (Hand.present ? '?' : '-'));
  if (uiCache.gest !== key) {
    uiCache.gest = key; camBox.dataset.g = g || '';
    if (g) { const d = GESTURES[g]; box.className = 'pop'; box.innerHTML = `<span class="e">${d.e}</span><span>${d.t}</span>`; box.style.color = d.c; }
    else { box.className = 'dim'; box.style.color = ''; box.innerHTML = `<span>${G.keyboard ? 'Teclado activo' : Hand.present ? 'Gesto sin reconocer' : 'Mostrá una mano'}</span>`; }
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.g === g));
  }
  Hand.tried.forEach(t => { const c = document.querySelector(`.chip[data-g=${t}]`); if (c && !c.classList.contains('done')) c.classList.add('done'); });
}

/* ---------- Bucle principal ---------- */
let lastNow = performance.now(), fpsT = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - lastNow) / 1000; lastNow = now;
  const dt = Math.min(.05, raw);
  update(dt); render(dt);
  // Si la compu no llega, baja la resolución antes que la fluidez del juego
  if (!document.hidden && raw < .5) {
    fpsT += raw; fpsN++;
    if (fpsT > 3) {
      const fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
      if (fps < 38 && Q.low < 2) { Q.low++; Q.dprMax = Q.low === 1 ? 1.25 : 1; Q.ribbons = Q.low === 1 ? 9 : 7; layout(); }
    }
  }
}

function bootIsla() {
  Signs.load();
  genWorld();
  buildAll();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(buildAll, 160); layout(); });
  requestAnimationFrame(t => { lastNow = t; frame(t); });
}
