'use strict';
/* Atrapavientos: equipos de dos. El servidor decide; acá se dibuja y se mandan comandos. */

const ROLES = {
  director: { ico: '🌀', name: 'Director del Molino', short: 'orienta las aspas', how: 'Manejás la dirección del molino con tus propias señas. No ves los colores del viento: dependés de lo que te diga tu Anunciador. Si los motores se queman, hacés las señas de la reparación.' },
  anunciador: { ico: '📣', name: 'Anunciador de Viento', short: 'lee los colores', how: 'Ves venir cada viento y su color antes que nadie. Activás el modo operativo correcto y le avisás al Director de dónde viene. Tres vientos rojos recibidos de seguido queman los motores.' }
};
const ORDER = ['director', 'anunciador'];
const COLORS = [
  { name: 'Verde', rgb: [111, 227, 150], css: '#6fe396', mode: 'Captar', hint: 'Para viento verde: rinde al máximo', glow: () => SP.gMint },
  { name: 'Amarillo', rgb: [255, 205, 70], css: '#ffcd46', mode: 'Refuerzo', hint: 'Para viento amarillo: aguanta y rinde más', glow: () => SP.gGold },
  { name: 'Rojo', rgb: [255, 80, 60], css: '#ff503c', mode: 'Protección', hint: 'Para viento rojo: cuida los motores, no genera', glow: () => SP.gCoral }
];
const SAYS = {
  director: [['ready', '¡Estoy listo!'], ['code', '¿Qué seña sigue?']],
  anunciador: [['red', '¡Viene rojo!'], ['turn', '¡Girá ya!']]
};
const SAY_TEXT = { ready: '¡Estoy listo!', code: '¿Qué seña sigue?', red: '¡Viene un viento rojo!', turn: '¡Girá ya!' };
const SIGN_LABEL = { left: ['⬅️', 'Izquierda'], right: ['➡️', 'Derecha'], open: ['🟢', 'Avanzar'], fist: ['🛑', 'Detener'] };

const S = { view: 'entry', code: null, name: '', me: null, lobby: null, snap: null, T: 0, role: null, known: new Map(), lastMill: 0, cdTimer: null, lastSeen: null };
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* almacenamiento bloqueado */ } } };

/* ---------- Red ---------- */
const Net = {
  ws: null, retry: 0, closed: false,
  connect() {
    const q = new URLSearchParams({ code: S.code, name: S.name });
    const tok = store.get('atrapa.tok.' + S.code); if (tok) q.set('token', tok);
    const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?' + q);
    ws.onopen = () => { this.retry = 0; $('netBanner').classList.add('hidden'); };
    ws.onmessage = e => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.closed) return;
      if (S.view === 'entry') { entryError('No se pudo entrar. Revisá el código o tu nombre.'); return; }
      $('netBanner').classList.remove('hidden'); this.retry++;
      setTimeout(() => this.connect(), Math.min(6000, 700 * this.retry));
    };
  },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
};
function onMessage(m) {
  if (m.t === 'hello') { S.me = m.id; S.name = m.name; store.set('atrapa.tok.' + S.code, m.token); store.set('molino.name', m.name); }
  if (m.t === 'lobby') onLobby(m);
  if (m.t === 's') onSnap(m);
  if (m.t === 'end') onEnd(m);
  if (m.t === 'kicked') { Net.closed = true; alert('Tu profe te sacó de la clase.'); location.href = '/atrapavientos'; }
  if (m.t === 'replaced') { Net.closed = true; $('netBanner').textContent = 'Abriste el juego en otra pestaña.'; $('netBanner').classList.remove('hidden'); }
}

/* ---------- Sala ---------- */
const hideSheets = () => { $('entry').classList.add('hidden'); $('lobby').classList.add('hidden'); };
const isHost = () => S.lobby && S.lobby.kind === 'sala' && S.lobby.host === S.me;
function onLobby(m) {
  S.lobby = m;
  const me = m.players.find(p => p.id === S.me);
  if (me) { S.team = me.team; if (S.role !== me.role) { S.role = me.role; if (S.view === 'play') prepareRole(); } }
  if (m.phase !== 'lobby') $('entry').classList.add('hidden');
  if (m.phase === 'lobby') showLobby();
  if (m.phase === 'countdown') showCountdown();
  if (m.phase === 'play') enterPlay();
  $('pauseBanner').classList.toggle('hidden', m.phase !== 'paused');
  const host = isHost();
  $('btnPause').classList.toggle('hidden', !(host && (m.phase === 'play' || m.phase === 'paused')));
  $('btnPause').textContent = m.phase === 'paused' ? 'Seguir' : 'Pausar';
}
function showLobby() {
  S.view = 'lobby'; S.known.clear(); S.snap = null;
  G.gusts.length = 0; G.mode = 'attract'; G.dayTarget = .3; G.fwIn = 1e9; G.blackout = false; G.eff = 70;
  document.body.classList.remove('in-game', 'danger');
  $('entry').classList.add('hidden'); $('end').classList.add('hidden'); $('end').classList.remove('show'); $('repair').classList.add('hidden');
  $('lobby').classList.remove('hidden'); $('count').innerHTML = '';
  Rules.hideRing = true; Rules.netMill = true; Rules.noMillControl = true; camTarget();
  const m = S.lobby, cls = m.kind === 'clase';
  $('roomCode').textContent = m.code; $('lobbyKicker').textContent = cls ? 'Clase' : 'Partida';
  $('lobbyTitle').textContent = cls ? (S.role ? `Te toca ${ROLES[S.role].name}` : 'Esperando equipo') : 'Elegí tu rol';
  const mates = m.players.filter(p => p.team === S.team), grid = $('roleGrid'); grid.innerHTML = '';
  ORDER.forEach(r => {
    const who = mates.filter(p => p.role === r), el = document.createElement(cls ? 'div' : 'button');
    if (!cls) { el.type = 'button'; el.addEventListener('click', () => { Snd.init(); Net.send({ t: 'role', role: r }); }); }
    el.className = 'role-card' + (S.role === r ? ' mine' : '');
    const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = ROLES[r].ico;
    const b = document.createElement('b'); b.textContent = ROLES[r].name;
    const small = document.createElement('small');
    if (who.length) small.textContent = who.map(p => p.name).join(', '); else { small.textContent = 'Lo cubre un bot'; small.className = 'bot'; }
    el.append(ico, b, small); grid.append(el);
  });
  $('roleHow').textContent = S.role ? ROLES[S.role].how : '';
  const host = isHost(); $('hostControls').classList.toggle('hidden', !host);
  if (host) { $('selDur').value = String(m.dur); $('selDiff').value = m.diff; }
  const missing = ORDER.filter(r => !mates.some(p => p.role === r));
  $('lobbyWait').textContent = cls ? 'Tu profe inicia la partida.' : host ? (missing.length ? 'Pasale el código a tu compañero o compañera. Si no, un bot cubre el otro rol.' : '¡Equipo completo!') : 'Quien creó la partida la inicia.';
}
function showCountdown() {
  hideSheets(); $('end').classList.add('hidden'); document.body.classList.add('in-game');
  prepareRole(); G.mode = 'countdown'; G.gusts.length = 0; G.dayTarget = 0; camTarget();
  if (S.cdTimer) return;
  const box = $('count'), steps = ['3', '2', '1', S.role ? ROLES[S.role].name.split(' ')[0] : '¡Viento!']; let i = 0;
  const next = () => {
    if (i >= steps.length) { box.innerHTML = ''; S.cdTimer = null; return; }
    box.innerHTML = ''; const sp = document.createElement('span'); sp.textContent = steps[i]; if (i === 3) sp.className = 'go'; box.append(sp);
    Snd.count(i === 3); i++; S.cdTimer = setTimeout(next, i === 4 ? 950 : 880);
  };
  next();
}
function enterPlay() {
  if (S.view === 'play') return;
  S.view = 'play'; hideSheets(); $('end').classList.add('hidden'); document.body.classList.add('in-game');
  prepareRole(); G.mode = 'play'; camTarget();
}
function prepareRole() {
  const r = S.role, dir = r === 'director';
  Rules.netMill = !dir; Rules.noMillControl = !dir; Rules.hideRing = !dir; Rules.noClouds = !dir;
  $('pDirector').classList.toggle('hidden', !dir); $('pAnunciador').classList.toggle('hidden', r !== 'anunciador');
  if (r) { $('myRoleIco').textContent = ROLES[r].ico; $('myRoleName').textContent = ROLES[r].name; }
  $('btnSignsG').classList.toggle('hidden', !(Vision.ready && dir));
  if (Vision.ready) $('btnCamOn').textContent = 'Cámara encendida';
  const box = $('sayBox'); box.innerHTML = '';
  if (r) SAYS[r].forEach(([k, t]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
    b.addEventListener('click', () => { const n = performance.now(); if (n - (S.sayAt || 0) < 2000) return; S.sayAt = n; Net.send({ t: 'say', k }); });
    box.append(b);
  });
  camTarget();
}

/* ---------- Partida ---------- */
function onSnap(s) {
  S.snap = s;
  if (Math.abs(s.T - S.T) > .22 || s.T < S.T - .05) S.T = s.T;
  if (s.phase === 'play' && S.view !== 'play') enterPlay();
  for (const x of s.w) {
    let g = S.known.get(x.id);
    if (!g) {
      g = makeGust(x.a, x.r - x.f, false, false); g.net = x; g.id = x.id; g.hidden = true; g.r = SPAWN_R;
      if (S.role !== 'director') g.tint = COLORS[x.c].rgb;
      S.known.set(x.id, g); G.gusts.push(g);
    }
    g.net = x;
  }
  for (const ev of s.ev || []) onEvent(ev);
  renderHud(s);
}
const toast = (t, c, from) => {
  const box = $('toasts'); if (box.children.length > 2) box.firstChild.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.style.setProperty('--tc', c || '#ffc857');
  if (from) { const sm = document.createElement('small'); sm.textContent = from; el.append(sm); }
  el.append(document.createTextNode(t)); box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2500);
};
function onEvent(e) {
  const g = e.id !== undefined ? S.known.get(e.id) : null;
  switch (e.k) {
    case 'wind': {
      if (!g) break;
      S.known.delete(e.id);
      const c = COLORS[e.c], px = g.dx * 215, py = g.dy * 215;
      const good = e.result === 'caught' || e.result === 'weak' || e.result === 'protected' || e.result === 'dodged';
      gustFx(g, e.facing && e.result !== 'burned' && e.result !== 'shielded' , !!e.perfect, e.combo || 0);
      if (e.result === 'burned') { g.state = 'miss'; Snd.miss(0); shake(9); G.rings.push({ x: 0, y: 0, r: 40, max: 210, life: 0, ttl: .6, c: '255,70,50', w: 8 }); }
      const text = { caught: ['+' + e.pts, e.c === 1 ? '¡Refuerzo justo!' : '¡Captado!', c.css], weak: ['+' + e.pts, 'Modo equivocado', '#ffcd46'], protected: ['+' + e.pts, 'Motores a salvo', '#7fd8e8'], dodged: ['+' + e.pts, 'Rojo esquivado', '#7fd8e8'], miss: ['Se escapó', 'No estaba de frente', '#ff9c88'], shielded: ['Sin energía', 'La protección no deja entrar nada', '#ffcd46'], burned: [`¡Rojo ${e.streak} de 3!`, 'Los motores sufren', '#ff503c'] }[e.result];
      if (text) popup(px, py, text[0], text[1], text[2], good && e.perfect);
      break;
    }
    case 'mode': if (S.role === 'director') { Snd.tick('open'); toast(`Modo ${COLORS[e.mode].mode}`, COLORS[e.mode].css); } break;
    case 'burn': Snd.end(false); shake(14); burst(0, 0, 70, { k: 'dust', v0: 40, v1: 240, t0: .6, t1: 1.6, s0: 5, s1: 13, c: ['#3a3a3a', '#6d5a50', '#ff6f3c'] }); break;
    case 'fixok': Snd.tone(660 + e.step * 120, 0, .25, 'sine', .12); renderHud(S.snap); break;
    case 'fixbad': Snd.miss(0); toast('Seña equivocada: hay que empezar de nuevo', '#ff503c'); break;
    case 'repaired': Snd.end(true); toast('¡Motores reparados!', '#6fe396'); for (const h of W.houses) burst(h.x, h.y, 5, { v0: 20, v1: 90 }); break;
    case 'say': toast(SAY_TEXT[e.m] || '', '#ffc857', e.from); Snd.tick('left'); break;
  }
}
const hudCache = {};
function renderHud(s) {
  if (!s) return;
  const c = COLORS[s.mode];
  if (hudCache.mode !== s.mode) {
    hudCache.mode = s.mode;
    $('modeName').textContent = c.mode; $('modeHint').textContent = c.hint; $('modeCard').style.setProperty('--m', c.css);
    document.querySelectorAll('.mode-btn').forEach((b, i) => { b.classList.toggle('on', i === s.mode); b.setAttribute('aria-pressed', i === s.mode); });
  }
  if (hudCache.streak !== s.streak || hudCache.burned !== s.burned) {
    hudCache.streak = s.streak; hudCache.burned = s.burned;
    [...$('lamps').children].forEach((l, i) => l.classList.toggle('on', s.burned || i < s.streak));
    $('motorText').textContent = s.burned ? 'Quemados: hay que repararlos' : s.streak === 0 ? 'Sin daños' : s.streak === 1 ? 'Un rojo recibido' : '¡Un rojo más y se queman!';
    $('motorText').classList.toggle('hot', s.burned || s.streak >= 2);
    document.body.classList.toggle('danger', s.burned || s.streak >= 2);
  }
  renderRepair(s);
  if (S.role === 'anunciador') {
    const box = $('nextWinds'), list = [...s.w].sort((a, b) => a.r - b.r).slice(0, 4), key = list.map(w => w.id).join();
    if (hudCache.nw !== key) { hudCache.nw = key; box.innerHTML = ''; if (!list.length) box.textContent = 'Por ahora, calma'; list.forEach(w => { const d = document.createElement('span'); d.className = 'wind-dot'; d.style.setProperty('--c', COLORS[w.c].css); d.textContent = COLORS[w.c].name; box.append(d); }); }
  }
}
function renderRepair(s) {
  const box = $('repair'); box.classList.toggle('hidden', !s.burned);
  if (!s.burned) { hudCache.rep = null; return; }
  const dir = S.role === 'director', botAnn = dir && !s.human.anunciador, seeCode = !dir || botAnn;
  const key = s.code.join() + s.step + dir; if (hudCache.rep === key) return; hudCache.rep = key;
  $('repairText').textContent = dir ? (botAnn ? 'Hacé estas señas en orden.' : 'Tu Anunciador ve la secuencia: pedile cada seña y hacela.') : 'Dictale estas señas al Director, en orden. Si se equivoca, vuelve a empezar.';
  const slots = $('slots'); slots.innerHTML = '';
  s.code.forEach((g, i) => {
    const d = document.createElement('div'); d.className = 'slot' + (i < s.step ? ' done' : i === s.step ? ' now' : '');
    if (seeCode || i < s.step) { const e = document.createElement('span'); e.textContent = SIGN_LABEL[g][0]; const t = document.createElement('small'); t.textContent = SIGN_LABEL[g][1]; d.append(e, t); }
    else { const e = document.createElement('span'); e.textContent = '?'; d.append(e); }
    slots.append(d);
  });
  $('repairChips').classList.toggle('hidden', !dir);
}
const fix = g => { if (S.snap && S.snap.burned && S.role === 'director') Net.send({ t: 'fix', g }); };

/* ---------- Ganchos del motor ---------- */
Rules.day = dt => {
  const s = S.snap;
  if (G.mode === 'play' && s && s.phase === 'play') { S.T = Math.min(S.T + dt, s.D); G.t = S.T; G.day = clamp(S.T / s.D); }
  else G.day += (G.dayTarget - G.day) * (1 - Math.exp(-dt * 1.4));
};
let demoIn = 2;
Rules.tick = dt => {
  if (G.mode === 'attract') {
    const target = G.gusts.find(g => g.state === 'fly' || g.state === 'warn');
    if (target) { const d = angDiff(target.a, M.a); M.vel = clamp(d * 3, -1.8, 1.8); M.a += M.vel * dt; } else M.vel = 0;
    demoIn -= dt;
    if (demoIn <= 0) { const g = makeGust(rand(TAU), 4.2, false, true), c = pick(COLORS); g.tint = c.rgb; G.gusts.push(g); demoIn = rand(3, 4.4); }
    return;
  }
  const s = S.snap; if (!s) return;
  G.blackout = s.burned;
  G.eff = s.burned ? 0 : clamp(58 + s.combo * 6 - s.streak * 18, 5, 100);
  Rules.noMillControl = S.role !== 'director' || s.burned;
  if (Rules.netMill) { const d = angDiff(s.mill, M.a); M.a += d * (1 - Math.exp(-dt * 9)); M.vel = d * 2; }
  else {
    if (s.burned) { M.moving = false; M.vel = 0; }
    if (performance.now() - S.lastMill > 80) { S.lastMill = performance.now(); Net.send({ t: 'mill', a: M.a }); }
  }
  // Una seña nueva cuenta como paso de la reparación
  if (s.burned && Hand.seen !== S.lastSeen && Hand.seen) fix(Hand.seen);
  S.lastSeen = Hand.seen;
  // Protección: las aspas se frenan
  if (s.mode === 2) M.omega = Math.min(M.omega, .6);
  if (s.burned) { M.omega = 0; if (Math.random() < dt * 14) addPart({ k: 'smoke', x: rand(-22, 22), y: rand(-22, 22), vx: rand(8, 26), vy: rand(-40, -18), life: 0, ttl: rand(1.4, 2.6), s: rand(9, 18), c: '#fff', rot: 0, vr: 0, drag: .1 }); }
  for (const g of G.gusts) {
    if (!g.net || (g.state !== 'warn' && g.state !== 'fly')) continue;
    const x = g.net, t = S.T;
    if (t < x.f) { g.state = 'warn'; g.warnT = clamp(g.warn - (x.f - t), 0, g.warn - .001); g.r = SPAWN_R; }
    else { if (g.state === 'warn' && !g.hidden) Snd.whoosh(clamp(g.dx * .8, -1, 1), x.r - x.f, .05, 280, 1200); g.state = 'fly'; g.r = Math.max(IMPACT, IMPACT + (x.r - t) * g.sp); }
    g.hidden = t < x.f - g.warn;
    if (g.state === 'fly' && t > x.r + 1.2) g.state = 'miss';
  }
  if (s.burned) for (const g of G.gusts) if (g.net) { g.state = 'miss'; g.end = .95; S.known.delete(g.id); }
};
Rules.resolve = g => { if (g.demo) gustFx(g, Math.abs(angDiff(M.a, g.a)) <= TOL, false, 3); else g.r = IMPACT; };
Rules.ui = () => {
  const s = S.snap; if (!s) return;
  if (hudCache.score !== s.score) { hudCache.score = s.score; $('score').textContent = Math.round(s.score).toLocaleString('es-AR'); }
  const left = Math.max(0, s.D - S.T), sec = Math.ceil(left), tt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  if (hudCache.tt !== tt) { hudCache.tt = tt; $('timeText').textContent = tt; }
  if (hudCache.combo !== s.combo) { hudCache.combo = s.combo; const el = $('sync'); el.textContent = '×' + s.combo; el.className = s.combo >= 6 ? 'top' : ''; }
};
Rules.cam = () => {
  if (S.view === 'entry' || S.view === 'lobby' || G.mode === 'attract') return { x: V.lx, y: V.ly, z: V.lz };
  if (G.mode === 'end') return { x: V.ex, y: V.ey, z: V.ez };
  if (S.role === 'anunciador') return { x: V.gx, y: V.gy, z: V.wide ? .68 : .58 };
  return { x: V.gx, y: V.gy, z: 1 };
};
Rules.overlay = () => {
  const s = S.snap; if (!s || G.mode !== 'play') return;
  // Aura del modo alrededor del molino
  const c = COLORS[s.mode].rgb, a = s.burned ? 0 : .5 + Math.sin(T * 4) * .12;
  ctx.lineCap = 'round';
  if (a) { ctx.strokeStyle = `rgba(${c},${a})`; ctx.lineWidth = s.mode === 2 ? 9 : 5; ctx.beginPath(); ctx.arc(0, 0, 150, 0, TAU); ctx.stroke(); }
  if (s.burned) { ctx.globalCompositeOperation = 'lighter'; glowAt(SP.gCoral, 0, 0, 170 + Math.sin(T * 9) * 16, .75); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  // El Anunciador ve los vientos en el mar, con su color y antes de que lleguen
  if (S.role !== 'anunciador') return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(140,245,230,.22)'; ctx.lineWidth = 2;
  for (const r of [545, 690, 840]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
  ctx.restore();
  for (const x of s.w) {
    const sp = (SPAWN_R - IMPACT) / (x.r - x.f), r = IMPACT + (x.r - S.T) * sp; if (r < IMPACT) continue;
    const col = COLORS[x.c], px = Math.cos(x.a) * r, py = Math.sin(x.a) * r, beat = 1 + Math.sin(T * 7 + x.id) * .12;
    ctx.save(); ctx.translate(px, py);
    ctx.globalCompositeOperation = 'lighter'; glowAt(col.glow(), 0, 0, 96 * beat, .75); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = col.css; ctx.strokeStyle = 'rgba(8,28,36,.85)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 40 * beat, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.rotate(x.a + PI); ctx.fillStyle = '#08242c'; ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-17, -20); ctx.lineTo(-8, 0); ctx.lineTo(-17, 20); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
};

/* ---------- Final ---------- */
function onEnd(m) {
  S.view = 'end'; G.mode = 'end'; G.dayTarget = 1; G.gusts.length = 0; S.known.clear(); G.blackout = false; G.eff = 90;
  hideSheets(); $('repair').classList.add('hidden');
  document.body.classList.remove('in-game', 'danger'); camTarget();
  const r = m.results.find(x => x.i === S.team) || m.results[0]; if (!r) return;
  const st = r.stats, rank = m.results.findIndex(x => x.i === r.i) + 1;
  const reds = st.redsHit + st.redsSafe + st.redsDodged, modeOk = st.rightMode + st.wrongMode ? st.rightMode / (st.rightMode + st.wrongMode) : 0;
  G.fwIn = st.burns === 0 ? 1.2 : 1e9;
  $('endKicker').textContent = m.results.length > 1 ? `Puesto ${rank} de ${m.results.length}` : 'Fin de la partida';
  $('endTitle').textContent = st.burns === 0 && modeOk >= .8 ? 'Dúo perfecto' : st.burns === 0 ? 'Motores intactos' : st.burns === 1 ? 'Se quemó una vez' : 'Mucho humo';
  $('endText').textContent = st.burns === 0 ? 'Ni un motor quemado: se escucharon.' : `Quemaron los motores ${st.burns === 1 ? 'una vez' : st.burns + ' veces'}. La próxima, avisen antes cuando venga un rojo.`;
  const el = $('endScore'), t0 = performance.now();
  (function roll(n) { const k = easeOut((n - t0) / 1500); el.textContent = Math.round(r.score * k).toLocaleString('es-AR'); if (k < 1 && S.view === 'end') requestAnimationFrame(roll); })(t0);
  const rows = [
    ['director', `${st.caught} vientos atrapados, ${st.missed} se escaparon`, `Mejor racha ${st.bestCombo} · ${st.redsDodged} rojos esquivados`],
    ['anunciador', `${Math.round(modeOk * 100)}% de modos correctos`, `${st.redsSafe} de ${reds} rojos protegidos · ${st.redsHit} recibidos · ${st.burns} quemados`]
  ], box = $('endLinks'); box.innerHTML = '';
  rows.forEach(([role, a, b], i) => {
    const v = Math.round(r.links[i] * 100), row = document.createElement('div'); row.className = 'final-row';
    const ic = document.createElement('span'); ic.className = 'i'; ic.textContent = ROLES[role].ico;
    const tx = document.createElement('div'), bb = document.createElement('b'), sm = document.createElement('small'); bb.textContent = a; sm.textContent = b; tx.append(bb, sm);
    const pc = document.createElement('em'); pc.textContent = v + '%'; pc.style.setProperty('--c', v >= 60 ? '#6fe3b0' : v >= 35 ? '#ffc857' : '#ff8d78');
    row.append(ic, tx, pc); box.append(row);
  });
  $('btnAgain').classList.toggle('hidden', !isHost());
  loadBoard(m);
  setTimeout(() => { if (S.view === 'end') { $('end').classList.remove('hidden'); $('end').classList.add('show'); } }, 900);
  Snd.end(st.burns === 0);
}
async function loadBoard(m) {
  const ol = $('boardList'); ol.textContent = '';
  const row = (n, name, pts, me) => {
    const li = document.createElement('li'); if (me) li.className = 'me';
    const a = document.createElement('span'); a.className = 'n'; a.textContent = n;
    const w = document.createElement('span'); w.className = 'who'; w.textContent = name;
    const p = document.createElement('span'); p.className = 'pts'; p.textContent = Math.round(pts).toLocaleString('es-AR');
    li.append(a, w, p); ol.append(li);
  };
  if (m.results.length > 1) { $('boardTitle').textContent = 'Equipos de la clase'; m.results.forEach((r, i) => row(i + 1, r.members.map(x => x.name).join(' y ') || r.name, r.score, r.i === S.team)); return; }
  $('boardTitle').textContent = 'Mejores equipos';
  try {
    await new Promise(r => setTimeout(r, 700));
    const d = await (await fetch('/api/equipos/top?game=atrapa')).json();
    if (!d.top.length) ol.textContent = 'Todavía no hay equipos.';
    d.top.forEach((t, i) => row(i + 1, t.members.map(x => x.name).join(' y ') || t.name, t.score, false));
  } catch (e) { $('boardTitle').textContent = 'El ranking no responde ahora'; }
}

/* ---------- Portada ---------- */
const entryError = t => { $('entryErr').textContent = t; S.view = 'entry'; };
function join(code, name) { S.code = code; S.name = name; $('entryErr').textContent = ''; history.replaceState(null, '', '/atrapavientos?sala=' + code); S.view = 'lobby'; Net.connect(); }
async function createGame() {
  const name = $('myName').value.trim(); if (!name) { $('myName').focus(); entryError('Poné tu nombre para crear la partida.'); return; }
  Snd.init();
  try {
    const r = await fetch('/api/salas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'atrapa', kind: 'sala', dur: 120 }) });
    const d = await r.json(); if (!r.ok) { entryError(d.error || 'No se pudo crear la partida.'); return; }
    join(d.code, name);
  } catch (e) { entryError('No hay conexión con el servidor.'); }
}
async function joinGame() {
  const name = $('myName').value.trim(), code = $('myCode').value.trim().toUpperCase();
  if (!name) { $('myName').focus(); entryError('Poné tu nombre.'); return; }
  if (code.length !== 4) { $('myCode').focus(); entryError('El código tiene 4 letras.'); return; }
  Snd.init();
  const r = await fetch('/api/salas/' + encodeURIComponent(code)).catch(() => null);
  if (!r) { entryError('No hay conexión con el servidor.'); return; }
  if (!r.ok) { entryError('No encontramos esa partida. Revisá el código.'); return; }
  const info = await r.json();
  if (info.game === 'isla') { location.href = '/grupal?sala=' + code; return; }
  join(code, name);
}

(function initUI() {
  let i = 0;
  const part = (w, cls) => `<span class="w ${cls}" aria-hidden="true">${[...w].map(ch => `<span class="l" style="--i:${i++}">${ch}</span>`).join('')}</span>`;
  $('title').innerHTML = part('Atrapa', '') + '<br>' + part('vientos', 'gold');
  $('chainIntro').innerHTML = ORDER.map(r => `<li><span class="i">${ROLES[r].ico}</span><b>${ROLES[r].name}</b><small>${ROLES[r].short}</small></li>`).join('');
  $('modes').innerHTML = COLORS.map((c, k) => `<button type="button" class="mode-btn" data-m="${k}" style="--m:${c.css}"><b>${c.mode}</b><small>viento ${c.name.toLowerCase()} · tecla ${k + 1}</small></button>`).join('');
  document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => Net.send({ t: 'mode', i: +b.dataset.m })));
  const chip = k => `<button type="button" class="chip" data-g="${k}" title="${GESTURES[k].t}"><span class="sign-thumb" data-sign="${k}"></span><span>${GESTURES[k].t}</span></button>`;
  $('chips').innerHTML = SIGN_ORDER.map(chip).join(''); $('repairChips').innerHTML = SIGN_ORDER.map(chip).join('');
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    const g = c.dataset.g; Snd.init();
    if (S.snap && S.snap.burned) { fix(g); return; }
    Hand.keyUntil = performance.now() + 700; setGestureFromHands(g); applyControl({ [g]: true });
  }));
  $('myName').value = store.get('molino.name') || '';
  $('btnCreate').addEventListener('click', createGame);
  $('joinForm').addEventListener('submit', e => { e.preventDefault(); joinGame(); });
  $('btnStart').addEventListener('click', () => { Snd.init(); Net.send({ t: 'start' }); });
  $('btnAgain').addEventListener('click', () => Net.send({ t: 'again' }));
  $('btnPause').addEventListener('click', () => Net.send({ t: S.lobby.phase === 'paused' ? 'resume' : 'pause' }));
  $('selDur').addEventListener('change', e => Net.send({ t: 'cfg', dur: +e.target.value }));
  $('selDiff').addEventListener('change', e => Net.send({ t: 'cfg', diff: e.target.value }));
  $('btnCopy').addEventListener('click', async () => {
    const url = `${location.origin}/atrapavientos?sala=${S.code}`;
    try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = '¡Copiado!'; } catch (e) { $('btnCopy').textContent = url; }
    setTimeout(() => { $('btnCopy').textContent = 'Copiar enlace'; }, 1800);
  });
  $('btnSound').addEventListener('click', () => { Snd.init(); const on = Snd.toggle(); $('btnSound').classList.toggle('off', !on); });
  $('btnSignsG').addEventListener('click', () => { if (Vision.ready) Trainer.open(); });
  $('btnCamOn').addEventListener('click', async () => {
    const b = $('btnCamOn'); if (Vision.ready) return; b.disabled = true; Snd.init();
    try { await startVision(msg => { b.textContent = msg; }); b.textContent = 'Cámara encendida'; if (!Signs.ready()) Trainer.open(); $('btnSignsG').classList.remove('hidden'); }
    catch (e) { console.error(e); b.disabled = false; b.textContent = 'No se pudo: probá de nuevo'; }
  });
  addEventListener('keydown', e => {
    if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || G.mode !== 'play') return;
    if (S.role === 'anunciador' && ['1', '2', '3'].includes(e.key)) { Net.send({ t: 'mode', i: +e.key - 1 }); return; }
    if (S.role !== 'director') return;
    const k = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'open', w: 'open', W: 'open', ArrowDown: 'fist', s: 'fist', S: 'fist', ' ': 'fist' }[e.key];
    if (!k) return;
    e.preventDefault();
    if (S.snap && S.snap.burned) { fix(k); return; }
    Hand.keyUntil = performance.now() + 700; setGestureFromHands(k); applyControl({ [k]: true });
    setTimeout(() => { if (performance.now() >= Hand.keyUntil && !Vision.ready) setGestureFromHands(null); }, 720);
  });
  fetch('/api/config').then(r => r.json()).then(c => Object.assign(CFG, c)).catch(() => {});
  const sala = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  if (sala) { $('myCode').value = sala; if (store.get('atrapa.tok.' + sala)) join(sala, store.get('molino.name') || ''); }
})();

G.mode = 'attract'; G.day = .3; G.dayTarget = .3; G.eff = 70;
Rules.hideRing = true; Rules.netMill = true; Rules.noMillControl = true;
bootIsla();
Signs.refreshUI();
syncGestureUI();
