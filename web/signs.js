'use strict';
/* Pantalla donde cada jugador inventa y graba sus señas. El reconocimiento vive en core.js (Signs). */

const SIGN_STEPS = {
  left: { title: 'IZQUIERDA', ask: 'Inventá una seña para que el molino gire a la izquierda.', cls: 'ccw' },
  right: { title: 'DERECHA', ask: 'Ahora una seña distinta para que gire a la derecha.', cls: 'cw' },
  open: { title: 'AVANZAR', ask: 'Elegí la seña que lo pone a rotar.', cls: 'go' },
  fist: { title: 'DETENER', ask: 'Por último, la seña que lo frena en seco.', cls: 'stop' }
};
const SIGN_NEED = 24;   // lecturas estables (cerca de un segundo)
const SIGN_STILL = .085; // cuánto puede moverse la mano entre lecturas

const Trainer = {
  active: false, idx: 0, buf: [], prev: null, onDone: null, camHome: null, hold: 0, lastGood: null,
  build() {
    if ($('trainer')) return;
    const el = document.createElement('section');
    el.id = 'trainer'; el.className = 'trainer hidden'; el.setAttribute('aria-label', 'Grabar tus señas');
    el.innerHTML = `<div class="tr-box panel">
      <div class="tr-steps" id="trSteps"></div>
      <div class="tr-main">
        <div class="tr-cam"><div id="trSlot"></div><svg class="tr-ring" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden="true"><rect id="trRing" x="1.2" y="1.2" width="97.6" height="72.6" rx="6" pathLength="100"/></svg></div>
        <div class="tr-text">
          <p class="label" id="trCount"></p>
          <h2 id="trTitle"></h2>
          <p id="trAsk"></p>
          <div class="tr-demo" id="trDemo" aria-hidden="true"><svg viewBox="0 0 64 64"><g fill="#fff4d9"><path d="M32 32 26 6h12z"/><path d="M32 32 26 58h12z"/><path d="M32 32 6 26v12z"/><path d="M32 32 58 26v12z"/></g><circle cx="32" cy="32" r="6" fill="#ff6f59"/></svg></div>
          <p id="trStatus" role="status"></p>
          <div class="tr-actions"><button id="trRedo" class="btn ghost hidden" type="button">Grabar de nuevo</button><button id="trDone" class="btn primary hidden" type="button">¡Listo, a probarlas!</button><button id="trClose" class="btn ghost" type="button">Cerrar</button></div>
        </div>
      </div>
    </div>`;
    document.body.append(el);
    $('trDone').addEventListener('click', () => this.close());
    $('trClose').addEventListener('click', () => this.close());
    $('trRedo').addEventListener('click', () => this.goto(this.idx));
  },
  open(onDone, startAt) {
    this.build();
    this.onDone = onDone || null; this.active = true;
    const cam = $('cam'); this.camHome = cam.parentNode; this.camNext = cam.nextSibling; $('trSlot').append(cam);
    $('trainer').classList.remove('hidden');
    Rules.trainer = list => { this.frame(list); return true; };
    const first = startAt !== undefined ? startAt : Math.max(0, SIGN_ORDER.findIndex(k => !Signs.has(k)));
    this.goto(first);
  },
  close() {
    if (!Signs.ready()) { this.setStatus('Faltan señas: sin las cuatro no se puede jugar con la cámara.', 'bad'); if (this.closeAsked) this.exit(); this.closeAsked = true; return; }
    this.exit();
  },
  exit() {
    this.active = false; this.closeAsked = false; Rules.trainer = null;
    const cam = $('cam'); if (this.camHome) this.camHome.insertBefore(cam, this.camNext && this.camNext.parentNode === this.camHome ? this.camNext : null);
    $('trainer').classList.add('hidden');
    Signs.refreshUI();
    const cb = this.onDone; this.onDone = null; if (cb) cb(Signs.ready());
  },
  goto(i) {
    this.idx = i; this.buf.length = 0; this.prev = null; this.hold = performance.now() + 500; this.closeAsked = false;
    const k = SIGN_ORDER[i], st = SIGN_STEPS[k];
    $('trCount').textContent = `Seña ${i + 1} de ${SIGN_ORDER.length}`;
    $('trTitle').textContent = st.title;
    $('trAsk').textContent = st.ask;
    $('trDemo').className = 'tr-demo ' + st.cls;
    $('trRedo').classList.add('hidden'); $('trDone').classList.add('hidden');
    this.setStatus('Mostrá tu seña y mantenela quieta. Vale la mano con la que la hagas.');
    this.setProgress(0); this.renderSteps();
  },
  renderSteps() {
    const box = $('trSteps'); box.innerHTML = '';
    SIGN_ORDER.forEach((k, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tr-step' + (i === this.idx ? ' on' : '') + (Signs.has(k) ? ' ok' : '');
      b.innerHTML = `${Signs.thumb(k)}<span>${SIGN_STEPS[k].title}</span>`;
      const hand = Signs.has(k) ? Signs.data[k].hand : null;
      if (hand) { const s = document.createElement('small'); s.textContent = hand === 'Left' ? 'mano izquierda' : 'mano derecha'; b.append(s); }
      b.addEventListener('click', () => this.goto(i));
      box.append(b);
    });
  },
  setProgress(p) { $('trRing').style.strokeDashoffset = 100 - p * 100; },
  setStatus(t, cls) { const e = $('trStatus'); e.textContent = t; e.className = cls || ''; },
  frame(list) {
    const now = performance.now();
    if (now < this.hold || !this.active || this.idx < 0) return;
    if (!list.length) { this.buf.length = 0; this.prev = null; this.setProgress(0); return; }
    const d = list[0], v = Signs.vec(d.world);
    if (this.prev && Signs.dist(v, this.prev) < SIGN_STILL && (!this.bufHand || this.bufHand === d.label)) { this.buf.push({ v, lm: d.lm }); this.bufHand = d.label; }
    else { this.buf.length = Math.max(0, this.buf.length - 4); if (!this.buf.length) this.bufHand = d.label; }
    this.prev = v;
    this.setProgress(this.buf.length / SIGN_NEED);
    if (this.buf.length >= SIGN_NEED) this.commit();
  },
  commit() {
    const k = SIGN_ORDER[this.idx], frames = this.buf.slice(), hand = this.bufHand;
    this.buf.length = 0; this.prev = null; this.setProgress(0);
    const res = Signs.record(k, hand, frames.map(f => f.v), frames[frames.length >> 1].lm);
    if (!res.ok) {
      this.hold = performance.now() + 1100;
      this.setStatus(`Se parece demasiado a ${SIGN_STEPS[res.conflict].title}. Hacé una seña bien distinta.`, 'bad');
      Snd.miss(0); return;
    }
    Snd.hit(this.idx + 2, true, 0); burst(0, 0, 40, { v0: 80, v1: 380 });
    this.renderSteps(); Signs.refreshUI();
    const next = SIGN_ORDER.findIndex(x => !Signs.has(x));
    this.setStatus('¡Guardada!', 'good');
    $('trRedo').classList.remove('hidden');
    if (next < 0) {
      this.idx = -1; this.renderSteps();
      $('trCount').textContent = 'Las cuatro señas'; $('trTitle').textContent = '¡Quedaron guardadas!'; $('trAsk').textContent = 'Se guardan en este navegador: la próxima vez ya las tenés. Tocá cualquiera de arriba para cambiarla.';
      $('trDemo').className = 'tr-demo go'; $('trRedo').classList.add('hidden'); $('trDone').classList.remove('hidden');
      Snd.end(true); return;
    }
    const redoFrom = this.idx;
    this.hold = performance.now() + 1500;
    setTimeout(() => { if (this.active && this.idx === redoFrom) this.goto(next); }, 1250);
  }
};
