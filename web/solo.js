'use strict';
/* Modo individual: reglas, interfaz y ranking. El mundo y el render viven en core.js. */

function resetRun() {
  Object.assign(G, { t: 0, score: 0, shown: 0, eff: 60, effAvgSum: 0, effAvgN: 0, combo: 0, best: 0, hits: 0, misses: 0, total: 0, spawnIn: 1.1, firstGust: true, blackout: false });
  G.gusts.length = 0; G.pulses.length = 0; G.pops.length = 0; G.rockets.length = 0;
  M.moving = false; M.vel = 0;
}

function spawnNext() {
  const p = clamp(G.t / GAME_SECS);
  // Un gesto tarda casi medio segundo entre que se hace y se lee: el ritmo final tiene que seguir siendo jugable
  const gap = lerp(CFG['solo.gap_inicio'] || 3.6, CFG['solo.gap_final'] || 1.7, Math.pow(p, 1.05));
  const travel = lerp(CFG['solo.viaje_inicio'] || 5.4, CFG['solo.viaje_final'] || 3, Math.pow(p, .85));
  const maxD = Math.min(170 * DEG, gap * rotSpeed() * .62);
  let angle;
  if (G.firstGust) { angle = M.a + rand(45, 80) * DEG * (Math.random() < .5 ? -1 : 1); G.firstGust = false; }
  else {
    // Dos de cada tres ráfagas siguen el mismo sentido: cambiar de mano es la jugada cara
    if (Math.random() > .66) G.lastSign = -G.lastSign;
    angle = G.lastA + rand(Math.min(38 * DEG, maxD * .5), maxD) * G.lastSign;
  }
  G.lastA = angle;
  G.gusts.push(makeGust(angle, travel, G.t > 14 && Math.random() < .13, false));
  G.total++;
  G.spawnIn = gap;
}


function resolveGust(g) {
  const off = Math.abs(angDiff(M.a, g.a)), scored = !g.demo && G.mode === 'play', hit = off <= TOL, perfect = hit && off <= PERFECT;
  gustFx(g, hit, perfect, scored ? G.combo : 3);
  if (!scored) return;
  if (hit) {
    G.hits++; G.combo++; G.best = Math.max(G.best, G.combo);
    const gain = (CFG['solo.gana_acierto'] || 7) + (perfect ? 3 : 0) + (g.gold ? 5 : 0);
    G.eff = clamp(G.eff + gain, 0, 100);
    const mult = 1 + Math.min(3, G.combo * .25);
    const pts = Math.round(100 * (perfect ? 1.5 : 1) * (g.gold ? 2 : 1) * mult * (.6 + G.eff / 100 * .8));
    G.score += pts;
    popup(g.dx * 215, g.dy * 215, '+' + pts.toLocaleString('es-AR'), g.gold ? '¡Ráfaga dorada!' : perfect ? '¡De frente!' : `+${gain}% eficiencia`, g.gold ? '#ffd76a' : perfect ? '#9df2d4' : '#fff4d9', perfect || g.gold);
    flash('effCard', 'hit');
    const sc = $('score'); sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
  } else {
    G.misses++; G.combo = 0;
    const lost = CFG['solo.pierde_fallo'] || 11;
    G.eff = clamp(G.eff - lost, 0, 100);
    popup(g.dx * 215, g.dy * 215, '−' + lost + '%', 'Se escapó el viento', '#ff9c88', false);
    flash('effCard', 'miss');
    if (G.eff <= 0 && G.mode === 'play') finish(true);
  }
}

function startCountdown() {
  hideAll(); Snd.init();
  document.body.classList.add('in-game'); document.body.classList.remove('practice');
  resetRun(); G.mode = 'countdown'; G.dayTarget = 0; camTarget();
  syncHud(true);
  const steps = ['3', '2', '1', '¡Viento!']; let i = 0; const box = $('count');
  clearTimeout(G.cTimer);
  const next = () => {
    if (G.mode !== 'countdown') return;
    if (i >= steps.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<span class="${i === 3 ? 'go' : ''}">${steps[i]}</span>`;
    Snd.count(i === 3);
    if (i === 3) { G.mode = 'play'; G.cTimer = setTimeout(() => { box.innerHTML = ''; }, 900); return; }
    i++; G.cTimer = setTimeout(next, 880);
  };
  G.cTimer = setTimeout(next, 650);
}

function finish(blackout) {
  G.mode = 'end'; G.blackout = blackout; G.dayTarget = 1; camTarget();
  document.body.classList.remove('danger', 'in-game');
  const acc = G.hits + G.misses ? G.hits / (G.hits + G.misses) : 0;
  const avg = G.effAvgN ? G.effAvgSum / G.effAvgN : 0;
  const homes = Math.round(G.eff / 100 * W.houses.length);
  const final = Math.round(G.score);
  let best = 0; try { best = +localStorage.getItem('molino.best') || 0; if (final > best) localStorage.setItem('molino.best', final); } catch (e) { /* almacenamiento bloqueado */ }
  let title, text, kicker;
  if (blackout) { kicker = 'Sin energía'; title = 'Apagón en la isla'; text = 'La eficiencia llegó a cero y el pueblo quedó a oscuras. El viento vuelve a soplar cuando quieras.'; }
  else if (acc >= .85 && G.eff >= 70) { kicker = 'Fin del día'; title = 'Noche brillante'; text = `Atrapaste casi todo el viento y ${homes} de ${W.houses.length} casas brillan. Hasta el faro te saluda.`; }
  else if (acc >= .6) { kicker = 'Fin del día'; title = 'Pueblo encendido'; text = `Cayó la noche con ${homes} de ${W.houses.length} casas iluminadas. Buen pulso con las aspas.`; }
  else { kicker = 'Fin del día'; title = 'Luz tenue'; text = `Solo ${homes} de ${W.houses.length} casas llegaron encendidas a la noche. Probá frenar antes de que llegue cada ráfaga.`; }
  $('endKicker').textContent = kicker; $('endTitle').textContent = title; $('endText').textContent = text;
  $('stHits').textContent = `${G.hits}/${G.hits + G.misses}`; $('stAcc').textContent = Math.round(acc * 100) + '%';
  $('stCombo').textContent = G.best; $('stAvg').textContent = Math.round(avg) + '%';
  $('endRecord').textContent = final > best && final > 0 ? '¡Nuevo récord en esta compu!' : best ? `Récord: ${best.toLocaleString('es-AR')}` : '';
  const el = $('endScore'), t0 = performance.now(); el.textContent = '0';
  (function roll(now) { const k = easeOut((now - t0) / 1500); el.textContent = Math.round(final * k).toLocaleString('es-AR'); if (k < 1 && G.mode === 'end') requestAnimationFrame(roll); })(t0);
  Board.prepare({ score: final, hits: G.hits, misses: G.misses, bestCombo: G.best, efficiency: Math.round(G.eff), seconds: Math.floor(G.t) });
  setTimeout(() => { if (G.mode === 'end') { $('end').classList.remove('hidden'); $('end').classList.add('show'); } }, blackout ? 1500 : 1100);
  Snd.end(!blackout && acc >= .6);
  G.fwIn = blackout ? 1e9 : (acc >= .6 ? 1.1 : 1e9);
}


/* Ranking global: lo guarda el servidor en Postgres */
const Board = {
  run: null,
  render(list, myRank) {
    const ol = $('boardList'); ol.textContent = '';
    list.forEach(e => {
      const li = document.createElement('li'); if (e.rank === myRank) li.className = 'me';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = e.rank;
      const who = document.createElement('span'); who.className = 'who'; who.textContent = e.name;
      const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = e.score.toLocaleString('es-AR');
      li.append(n, who, pts); ol.append(li);
    });
  },
  async load() {
    try {
      const r = await fetch('/api/scores'); if (!r.ok) throw new Error(r.status);
      const d = await r.json(); this.render(d.top);
      if (!d.top.length) $('boardMsg').textContent = 'Todavía nadie entró al ranking. Puede ser tu lugar.';
    } catch (e) { this.offline(); }
  },
  offline() { $('boardMsg').textContent = 'El ranking no responde en este momento. Tu puntaje quedó guardado en esta compu.'; $('saveForm').hidden = true; },
  prepare(run) {
    this.run = run; $('boardMsg').textContent = ''; $('boardList').textContent = '';
    const form = $('saveForm'); form.hidden = run.score <= 0;
    try { $('playerName').value = localStorage.getItem('molino.name') || ''; } catch (e) { /* almacenamiento bloqueado */ }
    $('btnSave').disabled = false; this.load();
  },
  async save(name) {
    if (!this.run) return;
    const btn = $('btnSave'); btn.disabled = true; $('boardMsg').textContent = '';
    try {
      const r = await fetch('/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...this.run }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { $('boardMsg').textContent = d.error || 'No se pudo guardar tu partida.'; btn.disabled = false; return; }
      try { localStorage.setItem('molino.name', name); } catch (e) { /* almacenamiento bloqueado */ }
      this.run = null; $('saveForm').hidden = true;
      $('boardMsg').textContent = d.rank === 1 ? '¡Primer puesto de toda la isla!' : `Quedaste en el puesto ${d.rank}.`;
      this.render(d.top, d.rank);
      if (d.rank <= 3) burst(0, 0, 50, { k: 'fw', v0: 120, v1: 420, t0: .8, t1: 1.5, c: ['#ffd76a', '#fff4d9'], drag: 2 });
    } catch (e) { this.offline(); }
  }
};


/* ---------- Ganchos del motor ---------- */
Rules.day = dt => {
  if (G.mode === 'play') {
    G.t += dt; G.day = clamp(G.t / GAME_SECS);
    G.score += G.eff / 100 * 12 * dt;
    G.effAvgSum += G.eff * dt; G.effAvgN += dt;
    G.spawnIn -= dt; if (G.spawnIn <= 0 && G.t < GAME_SECS - 2) spawnNext();
    if (G.t >= GAME_SECS) finish(false);
  } else {
    const speed = G.mode === 'countdown' ? 2.2 : G.mode === 'end' ? (G.blackout ? 1.1 : .9) : 2;
    G.day += (G.dayTarget - G.day) * (1 - Math.exp(-dt * speed));
  }
};
Rules.tick = dt => {
  if (G.mode === 'attract') {
    // Modo demostración: el molino busca el viento solo
    const target = G.gusts.find(g => g.state === 'fly' || g.state === 'warn');
    if (target) { const d = angDiff(target.a, M.a); M.vel = clamp(d * 3, -1.8, 1.8); M.a += M.vel * dt; } else M.vel = 0;
    G.spawnIn -= dt;
    if (G.spawnIn <= 0) { const a = rand(TAU); G.gusts.push(makeGust(a, 4.2, Math.random() < .18, true)); G.spawnIn = rand(3.2, 4.6); }
  } else if (G.mode === 'practice') {
    G.spawnIn -= dt;
    if (G.spawnIn <= 0) { G.gusts.push(makeGust(rand(TAU), 5.4, false, true)); G.spawnIn = 5.5; }
  }
};
Rules.resolve = resolveGust;
Rules.ui = () => syncHud();

/* ---------- 11. Interfaz ---------- */
const dayArc = $('dayArc'); const arcLen = dayArc.getTotalLength(); dayArc.style.strokeDasharray = arcLen;
function syncHud(force) {
  G.shown += (G.score - G.shown) * Math.min(1, .16);
  setText('score', Math.round(G.shown).toLocaleString('es-AR'));
  const left = G.mode === 'play' || G.mode === 'end' ? Math.max(0, GAME_SECS - G.t) : GAME_SECS;
  const sec = Math.ceil(left); setText('timeText', `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  const urgent = G.mode === 'play' && left <= 10; if (uiCache.urg !== urgent) { uiCache.urg = urgent; $('timeCard').classList.toggle('urgent', urgent); }
  const day = clamp(G.mode === 'play' || G.mode === 'end' ? G.t / GAME_SECS : 0);
  if (force || uiCache.day !== day) {
    uiCache.day = day; dayArc.style.strokeDashoffset = arcLen * (1 - day);
    const a = PI * (1 - day), sx = 85 + Math.cos(a) * 73, sy = 86 - Math.sin(a) * 73, sun = $('sunDot'), halo = $('sunHalo');
    sun.setAttribute('cx', sx); sun.setAttribute('cy', sy); halo.setAttribute('cx', sx); halo.setAttribute('cy', sy);
    const c = day > .82 ? '#e7ecff' : day > .62 ? '#ff9a6b' : '#ffd76a'; sun.setAttribute('fill', c); halo.setAttribute('fill', c);
  }
  const e = Math.round(G.eff);
  if (force || uiCache.eff !== e) {
    uiCache.eff = e; $('effText').textContent = e + '%';
    $('effFill').style.width = e + '%'; $('effGhost').style.width = e + '%';
    document.documentElement.style.setProperty('--eff', e >= 60 ? '#6fe3b0' : e >= 30 ? '#ffc857' : '#ff5d47');
    const on = Math.round(e / 100 * W.houses.length);
    $('homesText').textContent = `${on} de ${W.houses.length} casas encendidas`;
  }
  const danger = G.mode === 'play' && e < 25; if (uiCache.dg !== danger) { uiCache.dg = danger; document.body.classList.toggle('danger', danger); }
  const combo = G.combo >= 2 ? '×' + G.combo : ''; if (uiCache.cb !== combo) { uiCache.cb = combo; const el = $('combo'); if (combo) el.textContent = combo; el.classList.toggle('show', !!combo); }
  const st = M.moving ? (M.dir < 0 ? 'Girando a la izquierda' : 'Girando a la derecha') : (M.dir < 0 ? 'Frenado · próximo giro a la izquierda' : 'Frenado · próximo giro a la derecha');
  if (uiCache.st !== st) {
    uiCache.st = st; $('millStateText').textContent = st;
    const arc = $('millArc');
    const big = 'M19 3A16 16 0 0 1 35 19'; const lft = 'M19 3A16 16 0 0 0 3 19';
    arc.setAttribute('d', M.dir < 0 ? lft : big); arc.setAttribute('stroke', M.moving ? '#6fe3b0' : '#ff8d78');
  }
  $('millBlades').setAttribute('transform', `rotate(${(M.a / DEG).toFixed(1)} 19 19)`);
}
function hideAll() { ['landing', 'practice', 'end'].forEach(id => { const e = $(id); e.classList.add('hidden'); e.classList.remove('show'); }); }
function goPractice() {
  hideAll(); Snd.init();
  document.body.classList.add('in-game', 'practice');
  G.gusts.length = 0; G.pops.length = 0;
  Object.assign(G, { mode: 'practice', dayTarget: .3, eff: 60, score: 0, shown: 0, combo: 0, spawnIn: 2.6 });
  M.moving = false; M.vel = 0; camTarget();
  $('pracTitle').textContent = G.keyboard ? 'Probá los controles' : 'Probá tus señas';
  $('btnSigns').classList.toggle('hidden', G.keyboard);
  $('pracText').textContent = G.keyboard ? 'Usá las flechas: izquierda, derecha, arriba para avanzar y abajo para frenar.' : 'Probá tus señas: el molino ya te obedece. Las ráfagas de práctica no cuentan.';
  $('practice').classList.remove('hidden');
  syncGestureUI(); syncHud(true);
}
function showError(kind) {
  const m = {
    denied: 'No hay permiso para usar la cámara. Habilitala desde el candado de la barra de direcciones y volvé a probar, o jugá con teclado.',
    nocam: 'No encontramos ninguna cámara en este equipo. Podés jugar con teclado.',
    net: 'No se pudo descargar el modelo de manos. Revisá la conexión y probá de nuevo, o jugá con teclado.',
    other: 'La cámara o el modelo no arrancaron. Cerrá otras apps que usen la cámara y volvé a probar, o jugá con teclado.'
  }[kind] || '';
  const e = $('err'); e.textContent = m; e.classList.add('show');
}

(function initUI() {
  // Título con letras animadas
  let i = 0;
  const part = (w, cls) => `<span class="w ${cls}" aria-hidden="true">${[...w].map(ch => `<span class="l" style="--i:${i++}">${ch}</span>`).join('')}</span>`;
  $('title').innerHTML = part('Atrapa', '') + '<br>' + part('vientos', 'gold');
  const guide = { left: 'gira a la izquierda', right: 'gira a la derecha', open: 'empieza a rotar', fist: 'frena en seco' };
  $('guide').innerHTML = SIGN_ORDER.map(k => `<div class="gcard"><span class="sign-thumb" data-sign="${k}"></span><b>${GESTURES[k].t}</b><small>${guide[k]}</small></div>`).join('');
  $('chips').innerHTML = SIGN_ORDER.map(k => `<div class="chip" data-g="${k}" title="${GESTURES[k].t}"><span class="sign-thumb" data-sign="${k}"></span><span>${GESTURES[k].t}</span><span class="ok">✓</span></div>`).join('');
  $('btnSigns').addEventListener('click', () => { if (Vision.ready) Trainer.open(); });

  $('btnCam').addEventListener('click', async () => {
    const b = $('btnCam'); $('err').classList.remove('show'); Snd.init();
    b.disabled = true;
    const spin = '<svg class="spinner" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M12 12 9.5 1h5z"/><path d="M12 12 9.5 23h5z"/><path d="M12 12 1 9.5v5z"/><path d="M12 12 23 9.5v5z"/></g></svg>';
    try {
      await startVision(msg => { b.innerHTML = spin + `<span>${msg}</span>`; });
      if (Signs.ready()) goPractice(); else Trainer.open(ok => { if (ok) goPractice(); });
    } catch (e) {
      console.error(e); showError(e.kind || 'other');
    }
    b.disabled = false; b.textContent = 'Encender cámara y jugar';
  });
  $('btnKeys').addEventListener('click', () => {
    G.keyboard = true; document.body.classList.add('keyboard');
    $('camMsg').textContent = 'Sin cámara: jugás con el teclado';
    goPractice();
  });
  $('saveForm').addEventListener('submit', e => { e.preventDefault(); const n = $('playerName').value.trim(); if (n) Board.save(n); });
  $('btnGo').addEventListener('click', startCountdown);
  $('btnAgain').addEventListener('click', startCountdown);
  $('btnRestart').addEventListener('click', startCountdown);
  $('btnSound').addEventListener('click', () => { Snd.init(); const on = Snd.toggle(); $('btnSound').classList.toggle('off', !on); });

  addEventListener('keydown', e => {
    if (e.repeat || G.mode === 'attract' || e.target.tagName === 'INPUT') return;
    const k = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'open', w: 'open', W: 'open', ArrowDown: 'fist', s: 'fist', S: 'fist', ' ': 'fist' }[e.key];
    if (!k) return;
    if (e.key === ' ' && e.target.tagName === 'BUTTON') e.target.blur();
    e.preventDefault();
    Hand.keyUntil = performance.now() + 700; setGestureFromHands(k); syncGestureUI(); applyControl({ [k]: true });
    setTimeout(() => { if (performance.now() >= Hand.keyUntil && !Vision.ready) { setGestureFromHands(null); syncGestureUI(); } }, 720);
  });
})();

G.spawnIn = 2.2;
bootIsla();
Signs.refreshUI();
G.gusts.push(makeGust(M.a + 1.5, 4.6, false, true));
syncGestureUI(); syncHud(true);
fetch('/api/config').then(r => r.json()).then(c => { Object.assign(CFG, c); if (c['texto.bajada']) document.querySelector('.lead').textContent = c['texto.bajada']; }).catch(() => {});
