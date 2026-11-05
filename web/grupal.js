'use strict';
/* Modo grupal: el servidor es la fuente de verdad; este archivo dibuja y manda comandos. */

const ROLES = {
  vigia: { ico: '🔭', name: 'Vigía', short: 've venir el viento', how: 'Mirás el mar antes que nadie. Tocá cada ráfaga antes de que llegue a la costa: si no la marcás, el molino la ve recién a último momento. También avisás las tormentas a la red.', c: '#7fd8e8' },
  molino: { ico: '🌬️', name: 'Molino', short: 'atrapa la ráfaga', how: 'Girás el molino con tus propias señas: las inventás y las grabás con la cámara antes de jugar. Cada ráfaga atrapada carga la batería del equipo.', c: '#fff4d9' },
  red: { ico: '⚡', name: 'Red eléctrica', short: 'reparte la energía', how: 'Decidís cuánta energía sale de la batería. Si soltás poco, la ciudad se apaga; si soltás de más, se quema un fusible. Reparás las líneas rotas y blindás barrios si el vigía avisa una tormenta.', c: '#ffc857' },
  luces: { ico: '💡', name: 'Luces', short: 'enciende la ciudad', how: 'Prendés las casas cuando llega gente y las apagás cuando se va. Una casa encendida sin nadie gasta la energía que otros consiguieron. La ciudad con gente y luz es la que da más puntos.', c: '#ff8fab' }
};
const ORDER = ['vigia', 'molino', 'red', 'luces'];
const DIST_NAMES = ['Puerto', 'Colina', 'Tulipanes', 'Bosque'];
const SAYS = {
  vigia: [['storm', '¡Viene tormenta!'], ['wind', '¡Ráfaga dorada!']],
  molino: [['mark', '¡Marcá antes!'], ['thanks', '¡Gracias, vigía!']],
  red: [['wind', '¡Falta viento!'], ['off', '¡Apaguen casas!']],
  luces: [['more', '¡Más energía!'], ['less', 'Sobra energía']]
};
const SAY_TEXT = { storm: '¡Viene tormenta!', wind: '¡Falta viento!', mark: '¡Marcá antes las ráfagas!', thanks: '¡Gracias, vigía!', off: '¡Apaguen casas vacías!', more: '¡Necesitamos más energía!', less: 'Sobra energía, bajá el flujo' };

const S = {
  view: 'entry', code: null, name: '', me: null, lobby: null, snap: null, T: 0, watch: null, watchKey: null,
  role: null, team: 0, lastMill: 0, known: new Map(), results: null, ended: false, flowDrag: false, sayAt: 0, stats: { ok: 0, lost: 0 }
};

/* ---------- Red ---------- */
const Net = {
  ws: null, retry: 0, closed: false,
  connect() {
    const p = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const q = new URLSearchParams({ code: S.code });
    if (S.watch !== null) { q.set('as', 'ver'); q.set('team', S.watch); }
    else {
      q.set('name', S.name);
      const tok = readStore('molino.tok.' + S.code); if (tok) q.set('token', tok);
    }
    const ws = this.ws = new WebSocket(p + location.host + '/ws?' + q);
    ws.onopen = () => { this.retry = 0; $('netBanner').classList.add('hidden'); };
    ws.onmessage = e => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.closed) return;
      if (S.view === 'entry') { entryError('No se pudo entrar. Revisá el código o tu nombre.'); return; }
      $('netBanner').classList.remove('hidden');
      this.retry++;
      setTimeout(() => this.connect(), Math.min(6000, 700 * this.retry));
    };
  },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
};
function readStore(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function writeStore(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* almacenamiento bloqueado */ } }

function onMessage(m) {
  switch (m.t) {
    case 'hello': S.me = m.id; S.name = m.name; writeStore('molino.tok.' + S.code, m.token); writeStore('molino.name', m.name); break;
    case 'lobby': onLobby(m); break;
    case 's': onSnap(m); break;
    case 'end': onEnd(m); break;
    case 'kicked': Net.closed = true; alert('Tu profe te sacó de la clase.'); location.href = '/grupal'; break;
    case 'replaced': Net.closed = true; $('netBanner').textContent = 'Abriste el juego en otra pestaña.'; $('netBanner').classList.remove('hidden'); break;
  }
}

/* ---------- Sala de espera ---------- */
function onLobby(m) {
  S.lobby = m;
  if (m.phase !== 'lobby') $('entry').classList.add('hidden');
  const me = m.players.find(p => p.id === S.me);
  if (me) { S.team = me.team; setRole(me.role || null); }
  if (m.phase === 'lobby') showLobby();
  if (m.phase === 'countdown') showCountdown(m);
  if (m.phase === 'play') enterPlay();
  $('pauseBanner').classList.toggle('hidden', m.phase !== 'paused');
  const host = isHost();
  $('btnPause').classList.toggle('hidden', !(host && (m.phase === 'play' || m.phase === 'paused')));
  $('btnPause').textContent = m.phase === 'paused' ? 'Seguir' : 'Pausar';
  renderChain();
}
const isHost = () => S.lobby && S.lobby.kind === 'sala' && S.lobby.host === S.me;

function showLobby() {
  S.view = 'lobby'; S.ended = false; S.known.clear();
  G.gusts.length = 0; G.mode = 'attract'; G.dayTarget = .68; G.fwIn = 1e9; G.blackout = false;
  document.body.classList.remove('in-game');
  $('entry').classList.add('hidden'); $('end').classList.add('hidden'); $('end').classList.remove('show');
  $('lobby').classList.remove('hidden');
  $('count').innerHTML = '';
  Rules.hideRing = true; Rules.netMill = true; Rules.noMillControl = true;
  camTarget();
  const m = S.lobby, cls = m.kind === 'clase';
  $('roomCode').textContent = m.code;
  $('lobbyKicker').textContent = cls ? 'Clase' : 'Sala';
  $('lobbyTitle').textContent = cls ? (S.role ? `Te toca ${ROLES[S.role].name}` : 'Esperando equipo') : 'Elegí tu rol';
  const teamMates = m.players.filter(p => p.team === S.team);
  $('roleGrid').innerHTML = '';
  ORDER.forEach(r => {
    const holders = teamMates.filter(p => p.role === r);
    const el = document.createElement(cls ? 'div' : 'button');
    if (!cls) el.type = 'button';
    el.className = 'role-card' + (S.role === r ? ' mine' : '');
    const ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = ROLES[r].ico;
    const b = document.createElement('b'); b.textContent = ROLES[r].name;
    const small = document.createElement('small');
    if (holders.length) small.textContent = holders.map(p => p.name).join(', ');
    else { small.textContent = 'Lo cubre un bot'; small.className = 'bot'; }
    el.append(ico, b, small);
    if (!cls) el.addEventListener('click', () => { Snd.init(); Net.send({ t: 'role', role: r }); });
    $('roleGrid').append(el);
  });
  $('roleHow').textContent = S.role ? ROLES[S.role].how : 'Elegí un rol para ver qué hace.';
  const host = isHost();
  $('hostControls').classList.toggle('hidden', !host);
  if (host) { $('selDur').value = String(m.dur); $('selDiff').value = m.diff; }
  const bots = ORDER.filter(r => !teamMates.some(p => p.role === r)).length;
  $('lobbyWait').textContent = cls ? (m.teams.length > 1 ? `Estás en ${m.teams[S.team] ? m.teams[S.team].name : 'tu equipo'}. Tu profe inicia la partida.` : 'Tu profe arma los equipos e inicia la partida.')
    : host ? (bots ? `${bots === 1 ? 'Un rol vacío lo cubre un bot' : bots + ' roles vacíos los cubren bots'}: juega, pero no llega a la sintonía máxima.` : '¡Equipo completo! Pueden llegar a la sintonía máxima.')
    : 'Quien creó la sala inicia la partida.';
}

function showCountdown(m) {
  $('lobby').classList.add('hidden'); $('end').classList.add('hidden');
  document.body.classList.add('in-game');
  prepareRole();
  G.mode = 'countdown'; G.gusts.length = 0; G.dayTarget = .74;
  camTarget();
  if (!S.cdTimer) {
    const box = $('count');
    const steps = [['3', ''], ['2', ''], ['1', ''], [S.role ? ROLES[S.role].name : '¡Viento!', 'go']];
    let i = 0;
    const next = () => {
      if (i >= steps.length) { box.innerHTML = ''; S.cdTimer = null; return; }
      box.innerHTML = '';
      const sp = document.createElement('span'); sp.className = steps[i][1]; sp.textContent = steps[i][0]; box.append(sp);
      Snd.count(i === 3); i++;
      S.cdTimer = setTimeout(next, i === 4 ? 950 : 880);
    };
    next();
  }
}

function enterPlay() {
  if (S.view === 'play') return;
  S.view = 'play'; S.stats = { ok: 0, lost: 0 };
  $('lobby').classList.add('hidden'); $('entry').classList.add('hidden'); $('end').classList.add('hidden');
  document.body.classList.add('in-game');
  prepareRole();
  G.mode = 'play'; camTarget();
}

function setRole(r) {
  if (S.role === r) return;
  S.role = r;
  if (S.view !== 'lobby') prepareRole();
}

function prepareRole() {
  const r = S.role, spectator = S.watch !== null;
  Rules.netMill = r !== 'molino';
  Rules.noMillControl = r !== 'molino';
  Rules.hideRing = r !== 'molino';
  Rules.noClouds = r === 'vigia';
  document.querySelectorAll('.role-panel').forEach(p => p.classList.add('hidden'));
  const head = document.querySelector('.role-head');
  head.classList.toggle('hidden', spectator);
  $('sayBox').classList.toggle('hidden', spectator || !r);
  if (spectator || !r) { $('camWrap').classList.add('hidden'); return; }
  $('myRoleIco').textContent = ROLES[r].ico; $('myRoleName').textContent = ROLES[r].name;
  $({ vigia: 'pVigia', molino: 'pMolino', red: 'pRed', luces: 'pLuces' }[r]).classList.remove('hidden');
  $('camWrap').classList.remove('hidden');
  $('btnSignsG').classList.toggle('hidden', !(Vision.ready && r === 'molino'));
  $('btnCamOn').textContent = Vision.ready ? 'Cámara encendida' : r === 'molino' ? 'Encender cámara' : 'Usar la mano como puntero';
  if (r === 'molino') $('camMsg').textContent = 'Encendé la cámara o usá los botones y las flechas';
  else if (!Vision.ready) $('camMsg').textContent = 'Pellizcá con pulgar e índice para tocar';
  const box = $('sayBox'); box.innerHTML = '';
  SAYS[r].forEach(([k, t]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
    b.addEventListener('click', () => { const now = performance.now(); if (now - S.sayAt < 2500) return; S.sayAt = now; Net.send({ t: 'say', k }); });
    box.append(b);
  });
  if (r === 'red') buildDists();
}

/* ---------- Partida ---------- */
function onSnap(s) {
  S.snap = s;
  if (Math.abs(s.T - S.T) > .22 || s.T < S.T - .05) S.T = s.T;
  if (s.phase === 'play' && S.view !== 'play') enterPlay();
  const seen = new Set();
  for (const x of s.g) {
    seen.add(x.id);
    let g = S.known.get(x.id);
    if (!g) {
      g = makeGust(x.a, x.r - x.f, x.g, false);
      g.net = x; g.id = x.id; g.hidden = true; g.r = SPAWN_R;
      S.known.set(x.id, g); G.gusts.push(g);
    }
    g.net = x;
  }
  for (const ev of s.ev || []) onEvent(ev);
  renderChain();
  renderRole();
}

function onEvent(e) {
  const me = S.role;
  const g = e.id !== undefined ? S.known.get(e.id) : null;
  switch (e.k) {
    case 'gust':
      if (g) {
        gustFx(g, e.hit, e.perfect, e.combo || 0);
        S.known.delete(e.id);
        if (e.hit) popup(g.dx * 215, g.dy * 215, '+' + e.pts, e.gold ? '¡Ráfaga dorada!' : e.perfect ? '¡De frente!' : 'Batería cargada', e.gold ? '#ffd76a' : '#fff4d9', e.perfect || e.gold);
        else popup(g.dx * 215, g.dy * 215, 'Se escapó', 'Sin energía de esta ráfaga', '#ff9c88', false);
      }
      break;
    case 'ping':
      if (me === 'molino') { Snd.tick('open'); toast('El vigía marcó una ráfaga', ROLES.vigia.c); }
      if (me === 'vigia') { S.stats.ok++; Snd.tick('open'); }
      if (g) burst(g.dx * 760, g.dy * 760, 12, { v0: 30, v1: 120, c: ['#7cf2bd', '#ffffff'] });
      break;
    case 'warn':
      if (me === 'red') { Snd.tick('fist'); toast(`Tormenta sobre ${DIST_NAMES[e.d]}: podés blindarlo`, ROLES.vigia.c); }
      break;
    case 'shield': if (me) toast(`${DIST_NAMES[e.d]} quedó blindado`, ROLES.red.c); break;
    case 'storm':
      strike(e.d, e.safe);
      toast(e.safe ? `La tormenta no pudo con ${DIST_NAMES[e.d]}` : `¡La tormenta cortó la línea de ${DIST_NAMES[e.d]}!`, e.safe ? '#6fe3b0' : '#ff6f59');
      break;
    case 'trip': shake(5); Snd.miss(0); toast(`¡Se quemó el fusible de ${DIST_NAMES[e.d]}!`, '#ff6f59'); break;
    case 'fixed': toast(`Línea de ${DIST_NAMES[e.d]} reparada`, '#6fe3b0'); break;
    case 'call': if (me === 'luces') Snd.tone(880, 0, .12, 'triangle', .05); break;
    case 'left': if (me === 'luces') Snd.tone(392, 0, .16, 'triangle', .05); break;
    case 'served': { const h = W.houses[e.i]; h.pop = 1; popup(h.x, h.y - 30, '+' + e.pts, '', '#ffd76a', false); if (me === 'luces') Snd.tone(1046, 0, .25, 'sine', .09); break; }
    case 'off': { const h = W.houses[e.i]; if (e.pts) popup(h.x, h.y - 30, '+' + e.pts, '', '#9df2d4', false); if (me === 'luces') Snd.tone(523, 0, .14, 'sine', .07); break; }
    case 'wrong': { const h = W.houses[e.i]; popup(h.x, h.y - 30, '¡Ups!', 'Esa casa no era', '#ff9c88', false); if (me === 'luces') Snd.miss(0); break; }
    case 'angry': { const h = W.houses[e.i]; burst(h.x, h.y, 8, { k: 'dust', v0: 20, v1: 60, s0: 2, s1: 5, c: ['#ff8d78'] }); if (me === 'luces') Snd.tone(196, 0, .3, 'sawtooth', .04); break; }
    case 'chain': bigToast('¡Cadena perfecta!', e.pts); Snd.end(true); for (const h of W.houses) if (h.lit > .5) burst(h.x, h.y, 6, { v0: 30, v1: 110, c: ['#ffd76a', '#fff4d9'] }); break;
    case 'say': toast(SAY_TEXT[e.m] || '', ROLES[e.r] ? ROLES[e.r].c : '#ffc857', e.from); Snd.tick('left'); break;
  }
}

function strike(d, safe) {
  const p = W.paths[d].pts, q = p[p.length - 1];
  G.rings.push({ x: q.x, y: q.y, r: 20, max: 190, life: 0, ttl: .7, c: safe ? '150,245,215' : '255,245,190', w: 7 });
  burst(q.x, q.y, 34, { v0: 60, v1: 260, c: safe ? ['#9df2d4', '#fff'] : ['#fff7c8', '#ffd76a', '#ffffff'] });
  S.bolt = { x: q.x, y: q.y, t: 0, safe };
  shake(safe ? 4 : 10);
  Snd.tone(70, 0, .6, 'sawtooth', .13); Snd.whoosh(0, .5, .14, 3200, 200);
}

function toast(text, color, from) {
  const box = $('toasts'); if (box.children.length > 2) box.firstChild.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.style.setProperty('--tc', color || '#ffc857');
  if (from) { const s = document.createElement('small'); s.textContent = from; el.append(s); }
  el.append(document.createTextNode(text)); box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600);
}
function bigToast(text, pts) { const box = $('toasts'); const el = document.createElement('div'); el.className = 'toast big'; el.textContent = `${text} +${pts}`; box.append(el); setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600); }

/* ---------- HUD ---------- */
const hudCache = {};
function renderChain() {
  const box = $('chain'), lob = S.lobby; if (!lob) return;
  const mates = lob.players.filter(p => p.team === (S.watch !== null ? S.watch : S.team));
  if (!box.children.length) {
    box.innerHTML = ORDER.map(r => `<div class="clink" data-r="${r}"><span class="node">${ROLES[r].ico}</span><div class="who"><b><span class="nm"></span><em class="pc"></em></b><span class="lbar"><i></i></span></div></div>`).join('');
  }
  const links = S.snap ? S.snap.links : [.7, .7, .7, .7];
  ORDER.forEach((r, i) => {
    const el = box.children[i], v = links[i], holder = mates.filter(p => p.role === r);
    const col = v >= .6 ? '#6fe3b0' : v >= .35 ? '#ffc857' : '#ff5d47';
    el.style.setProperty('--c', col); el.style.setProperty('--flow', col);
    el.querySelector('.nm').textContent = holder.length ? holder.map(p => p.name).join(', ') : `${ROLES[r].name} (bot)`;
    el.querySelector('.pc').textContent = Math.round(v * 100) + '%';
    el.querySelector('.lbar i').style.width = Math.round(v * 100) + '%';
    el.classList.toggle('weak', v < .35); el.classList.toggle('me', r === S.role);
  });
}

function renderRole() {
  const s = S.snap; if (!s) return;
  if (S.role === 'red') renderRed(s);
  if (S.role === 'luces') {
    let want = 0, off = 0; s.h.forEach(v => { if (v === 1) want++; if (v === 3 || v === 4) off++; });
    $('lzWant').textContent = want; $('lzOff').textContent = off; $('lzPow').textContent = Math.round(s.pow * 100) + '%';
    $('lzPow').style.color = s.pow < .7 ? '#ff8d78' : '';
  }
  if (S.role === 'vigia') {
    $('vgOk').textContent = S.stats.ok;
    $('vgLost').textContent = S.stats.lost;
  }
}

/* Red eléctrica */
function flowMax() { return CFG['grupal.flujo_max'] || 7; }
function renderRed(s) {
  const fmax = flowMax(), low = (s.dem) / fmax, high = (s.dem * 1.35 + .6) / fmax;
  $('tankFill').style.height = s.bat + '%'; $('tankText').textContent = Math.round(s.bat);
  document.querySelector('.tank').classList.toggle('low', s.bat < 20);
  const band = $('flowBand'); band.style.left = clamp(low) * 100 + '%'; band.style.width = clamp(high - low) * 100 + '%';
  const f = S.flowDrag ? S.localFlow : s.flow;
  $('flowFill').style.width = f * 100 + '%'; $('flowThumb').style.left = f * 100 + '%';
  $('flow').setAttribute('aria-valuenow', Math.round(f * 100));
  $('supText').textContent = s.sup.toFixed(1); $('demText').textContent = s.dem.toFixed(1);
  $('heatFill').style.width = s.heat + '%';
  const ht = $('heatText'); const hot = s.heat > 55;
  ht.textContent = hot ? '¡Se calienta! Bajá el flujo' : s.pow < .9 ? 'Falta energía: subí el flujo' : 'Temperatura normal';
  ht.classList.toggle('hot', hot || s.pow < .9);
  s.d.forEach((d, i) => {
    const el = $('dist' + i); if (!el) return;
    const st = s.st.find(x => x.d === i && x.w);
    let cls = 'ok', txt = 'En línea';
    if (d.x) { cls = 'alert'; txt = 'Línea cortada: mantené apretado'; }
    else if (d.t) { cls = 'alert'; txt = 'Fusible quemado: tocá para reiniciar'; }
    else if (st && st.s) { cls = 'safe'; txt = `Blindado · ${Math.max(0, Math.ceil(st.h - S.T))} s`; }
    else if (st) { cls = 'warn'; txt = `Tormenta en ${Math.max(0, Math.ceil(st.h - S.T))} s: tocá para blindar`; }
    el.className = 'dist ' + cls;
    el.dataset.action = d.x ? 'repair' : d.t ? 'reset' : st && !st.s ? 'protect' : '';
    el.dataset.storm = st ? st.id : '';
    el.querySelector('span').textContent = txt;
    el.querySelector('.prog').style.width = (d.p * 100) + '%';
  });
}
function buildDists() {
  const box = $('dists'); if ($('dist0')) return;
  DIST_NAMES.forEach((n, i) => {
    const el = document.createElement('button'); el.type = 'button'; el.id = 'dist' + i; el.className = 'dist ok';
    el.innerHTML = `<b>${n}</b><span>En línea</span><i class="prog"></i>`;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const a = el.dataset.action;
      if (a === 'repair') { Net.send({ t: 'repair', d: i, on: true }); S.holding = i; }
      else if (a === 'reset') Net.send({ t: 'reset', d: i });
      else if (a === 'protect') Net.send({ t: 'protect', id: +el.dataset.storm });
    });
    box.append(el);
  });
}
addEventListener('pointerup', () => { if (S.holding !== undefined && S.holding !== null) { Net.send({ t: 'repair', d: S.holding, on: false }); S.holding = null; } S.flowDrag = false; });
addEventListener('pointercancel', () => { if (S.holding !== undefined && S.holding !== null) { Net.send({ t: 'repair', d: S.holding, on: false }); S.holding = null; } S.flowDrag = false; });

function setFlowFromX(x) {
  const r = $('flow').getBoundingClientRect(), v = clamp((x - r.left) / r.width);
  S.localFlow = v; Net.send({ t: 'flow', v });
}
$('flow').addEventListener('pointerdown', e => { e.preventDefault(); S.flowDrag = true; setFlowFromX(e.clientX); });
addEventListener('pointermove', e => { if (S.flowDrag) setFlowFromX(e.clientX); });
$('flow').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); const v = clamp((S.snap ? S.snap.flow : 0) + (e.key === 'ArrowRight' ? .05 : -.05)); Net.send({ t: 'flow', v });
});

/* ---------- Toques sobre el mundo ---------- */
function screenToWorld(x, y) { const k = V.base * Cam.z; return { x: (x - Cam.x) / k, y: (y - Cam.y) / k }; }
function pressWorld(sx, sy) {
  const s = S.snap; if (!s || s.phase !== 'play') return;
  const p = screenToWorld(sx, sy);
  if (S.role === 'luces') {
    let best = -1, bd = Math.max(46, 26 / (V.base * Cam.z));
    W.houses.forEach((h, i) => { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) Net.send({ t: 'house', i: best });
  }
  if (S.role === 'vigia') {
    let best = null, bd = Math.max(95, 34 / (V.base * Cam.z)), kind = '';
    for (const x of s.g) {
      if (x.p) continue;
      const q = blipPos(x), d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = x; kind = 'ping'; }
    }
    for (const st of s.st) {
      if (st.w) continue;
      const q = stormPos(st), d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd * 1.4) { bd = d; best = st; kind = 'warn'; }
    }
    if (best) Net.send({ t: kind, id: best.id });
  }
}
$('world').addEventListener('pointerdown', e => { Snd.init(); pressWorld(e.clientX, e.clientY); });

const blipPos = x => { const sp = (SPAWN_R - IMPACT) / (x.r - x.f), r = IMPACT + (x.r - S.T) * sp; return { x: Math.cos(x.a) * r, y: Math.sin(x.a) * r, r }; };
const stormPos = st => {
  const q = W.paths[st.d].pts[W.paths[st.d].pts.length - 1], a = Math.atan2(q.y, q.x), k = clamp((S.T - st.b) / (st.h - st.b));
  const r = lerp(900, Math.hypot(q.x, q.y), k * k);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
};

/* ---------- Mano como puntero (para los roles que no mueven el molino) ---------- */
const Pointer = { x: 0, y: 0, down: false, seen: 0, target: null };
function pointerFromHands(list) {
  if (S.role === 'molino' || !list.length) return;
  const lm = list[0].lm, tip = lm[8];
  // La zona central de la cámara cubre toda la pantalla: no hace falta estirar el brazo
  Pointer.x = clamp((tip.x - .12) / .76) * V.w; Pointer.y = clamp((tip.y - .12) / .76) * V.h; Pointer.seen = performance.now();
  const palm = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || .001, pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / palm;
  const el = $('pointer'); el.classList.add('on'); el.style.transform = `translate(${Pointer.x}px,${Pointer.y}px)`;
  if (!Pointer.down && pinch < .28) {
    Pointer.down = true; el.classList.add('down');
    const under = document.elementFromPoint(Pointer.x, Pointer.y); Pointer.target = under;
    if (under) under.dispatchEvent(new PointerEvent('pointerdown', { clientX: Pointer.x, clientY: Pointer.y, bubbles: true }));
    if (under && under.tagName === 'BUTTON') under.click();
  } else if (Pointer.down && pinch > .42) {
    Pointer.down = false; el.classList.remove('down');
    dispatchEvent(new PointerEvent('pointerup', { clientX: Pointer.x, clientY: Pointer.y }));
  } else if (Pointer.down) {
    dispatchEvent(new PointerEvent('pointermove', { clientX: Pointer.x, clientY: Pointer.y }));
  }
}
setInterval(() => { if (performance.now() - Pointer.seen > 450) $('pointer').classList.remove('on'); }, 300);

/* ---------- Ganchos del motor ---------- */
Rules.day = dt => {
  const snap = S.snap;
  if (G.mode === 'play' && snap && snap.phase === 'play') {
    S.T = Math.min(S.T + dt, snap.D); G.t = S.T;
    G.day = lerp(.74, 1, clamp(S.T / snap.D));
  } else {
    G.day += (G.dayTarget - G.day) * (1 - Math.exp(-dt * 1.2));
  }
};

let demoIn = 2;
Rules.tick = dt => {
  const s = S.snap;
  if (G.mode === 'attract') {
    // La isla sigue viva mientras se espera
    const target = G.gusts.find(g => g.state === 'fly' || g.state === 'warn');
    if (target) { const d = angDiff(target.a, M.a); M.vel = clamp(d * 3, -1.8, 1.8); M.a += M.vel * dt; } else M.vel = 0;
    demoIn -= dt;
    if (demoIn <= 0) { G.gusts.push(makeGust(rand(TAU), 4.2, Math.random() < .18, true)); demoIn = rand(3.2, 4.6); }
    return;
  }
  if (!s) return;
  G.eff = clamp(s.pow * 72 + s.bat * .28, 0, 100);
  // Molino: lo mueve quien tiene el rol, los demás lo siguen suavemente
  if (Rules.netMill) {
    const d = angDiff(s.mill, M.a); M.a += d * (1 - Math.exp(-dt * 9)); M.vel = d * 2;
  } else if (performance.now() - S.lastMill > 80) {
    S.lastMill = performance.now(); Net.send({ t: 'mill', a: M.a });
  }
  // Ráfagas según el reloj del servidor
  const fog = S.role === 'molino' ? (CFG['grupal.niebla'] || 2.4) * ({ facil: 1.3, dificil: .8 }[S.lobby && S.lobby.diff] || 1) : 0;
  for (const g of G.gusts) {
    if (!g.net || (g.state !== 'warn' && g.state !== 'fly')) continue;
    const x = g.net, t = S.T;
    if (t < x.f) { g.state = 'warn'; g.warnT = clamp(g.warn - (x.f - t), 0, g.warn - .001); g.r = SPAWN_R; }
    else { if (g.state === 'warn' && !g.hidden) Snd.whoosh(clamp(g.dx * .8, -1, 1), x.r - x.f, .05, 280, 1200); g.state = 'fly'; g.r = Math.max(IMPACT, IMPACT + (x.r - t) * g.sp); }
    if (S.role === 'molino') {
      const wasHidden = g.hidden; g.hidden = !x.p && t < x.r - fog;
      if (wasHidden && !g.hidden && !x.p) Snd.whoosh(clamp(g.dx * .8, -1, 1), .6, .08, 800, 2200);
    } else g.hidden = t < x.f - g.warn;
    if (g.state === 'fly' && t > x.r + 1.2) g.state = 'miss';
  }
  // La energía que suelta la red viaja por los cables
  S.pulseAt = (S.pulseAt || 0) - dt;
  if (S.pulseAt <= 0 && s.sup > .1 && s.dem > 0) {
    S.pulseAt = clamp(1.2 / s.sup, .12, 1);
    const lit = W.houses.filter(h => h.lit > .4); if (lit.length) G.pulses.push({ h: pick(lit), t: 0, sp: 1.3, c: SP.gGold });
  }
  if (S.bolt) { S.bolt.t += dt; if (S.bolt.t > .5) S.bolt = null; }
};

Rules.resolve = g => {
  if (g.demo) gustFx(g, Math.abs(angDiff(M.a, g.a)) <= TOL, false, 3);
  else g.r = IMPACT;
};

Rules.houseWant = (h, i) => {
  const s = S.snap;
  if (G.mode === 'attract') return i < 11;
  if (!s) return false;
  const st = s.h[i]; if (st !== 2 && st !== 3 && st !== 4) return false;
  const d = s.d[h.path]; if (d && (d.x || d.t)) return false;
  if (s.pow < .05) return false;
  // Si falta energía, la casa titila
  return s.pow > .85 || Math.random() < s.pow * s.pow + .15;
};

Rules.ui = () => {
  const s = S.snap; if (!s) return;
  if (hudCache.score !== s.score) { hudCache.score = s.score; $('score').textContent = Math.round(s.score).toLocaleString('es-AR'); }
  const left = Math.max(0, s.D - S.T), sec = Math.ceil(left), tt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  if (hudCache.tt !== tt) { hudCache.tt = tt; $('timeText').textContent = tt; }
  if (hudCache.sync !== s.sync) {
    hudCache.sync = s.sync; const el = $('sync'); el.textContent = '×' + s.sync.toFixed(1);
    el.className = s.sync < .9 ? 'low' : s.sync >= 1.6 ? 'top' : '';
  }
  document.body.classList.toggle('danger', G.mode === 'play' && (s.pow < .35 || s.bat < 5));
};

Rules.cam = () => {
  if (S.view === 'entry' || S.view === 'lobby' || G.mode === 'attract') return { x: V.lx, y: V.ly, z: V.lz };
  if (G.mode === 'end') return { x: V.ex, y: V.ey, z: V.ez };
  if (S.role === 'vigia') return { x: V.gx, y: V.gy, z: V.wide ? .68 : .58 };
  if (S.role === 'red' && !V.wide) return { x: V.w / 2, y: 112 + (V.h - 112 - Math.min(V.h * .48, 330)) / 2, z: .78 };
  return { x: V.gx, y: V.gy, z: 1 };
};

Rules.onHands = pointerFromHands;

/* ---------- Dibujos propios del modo ---------- */
Rules.preGrade = () => {
  // Nubes de tormenta sobre el barrio amenazado
  const s = S.snap; if (!s || G.mode !== 'play') return;
  for (const st of s.st) {
    const vig = S.role === 'vigia';
    if (!vig && !st.w && S.T < st.h - 3) continue;
    const q = stormPos(st), sp = SP.cloudSh[st.d % 3], w = 300, h = 170;
    ctx.globalAlpha = .55; ctx.drawImage(sp, q.x + 12 - w / 2, q.y + 26 - h / 2, w, h);
    ctx.globalAlpha = .9; ctx.drawImage(sp, q.x - w * .4, q.y - h * .4, w * .8, h * .8);
    ctx.globalAlpha = 1;
  }
};

const iconHome = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y - r * .05); ctx.lineTo(x + r * .68, y - r * .05); ctx.lineTo(x + r * .68, y + r * .75); ctx.lineTo(x - r * .68, y + r * .75); ctx.lineTo(x - r * .68, y - r * .05); ctx.lineTo(x - r, y - r * .05); ctx.closePath(); ctx.fill(); };

Rules.overlay = () => {
  const s = S.snap;
  if (!s || G.mode !== 'play') return;
  // Rayo
  if (S.bolt) {
    const b = S.bolt, a = 1 - b.t / .5;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,250,210,${a})`; ctx.lineWidth = 7 * a + 1;
    ctx.beginPath(); let px = b.x + 40, py = b.y - 460; ctx.moveTo(px, py);
    for (let i = 0; i < 8; i++) { px = lerp(px, b.x, .32) + rand(-22, 22); py = lerp(py, b.y, .36); ctx.lineTo(px, py); } ctx.lineTo(b.x, b.y); ctx.stroke();
    glowAt(SP.gWhite, b.x, b.y, 170, a); ctx.restore(); ctx.globalAlpha = 1;
  }
  // Barrios sin luz
  s.d.forEach((d, i) => {
    if (!d.x && !d.t) return;
    const p = W.paths[i].pts, q = p[p.length - 1];
    if (Math.random() < .3) burst(q.x + rand(-30, 30), q.y + rand(-30, 30), 2, { v0: 20, v1: 90, s0: 1, s1: 2.2, t1: .4, c: d.x ? ['#ffd76a', '#fff'] : ['#ff8d78', '#ffd76a'] });
    ctx.font = '800 21px Figtree, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(8,28,36,.9)'; const t = d.x ? 'Línea cortada' : 'Fusible quemado'; ctx.strokeText(t, q.x, q.y - 52); ctx.fillStyle = '#ffb6a8'; ctx.fillText(t, q.x, q.y - 52);
  });
  if (S.role === 'luces') drawHouseBubbles(s);
  if (S.role === 'vigia') drawRadar(s);
  if (S.role === 'molino') drawFog();
};

function drawHouseBubbles(s) {
  s.h.forEach((st, i) => {
    const h = W.houses[i], d = s.d[h.path], dead = d && (d.x || d.t);
    if (st === 1) {
      const dl = s.dl[i], total = CFG['grupal.espera_pedido'] || 7, k = clamp(dl / total), pulse = 1 + Math.sin(T * 9) * .08, r = 25 * pulse;
      ctx.globalCompositeOperation = 'lighter'; glowAt(SP.gGold, h.x, h.y, 58, .55 + (1 - k) * .3); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(70,45,5,.88)'; ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = k < .3 ? '#ff6f59' : '#ffd76a'; ctx.lineWidth = 5.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(h.x, h.y, r, -PI / 2, -PI / 2 + TAU * k); ctx.stroke();
      iconHome(h.x, h.y - 1, 12, '#ffd76a');
    } else if (st === 3 || st === 4) {
      const blink = st === 4 ? (Math.sin(T * 12) > 0 ? 1 : .55) : 1, r = 23;
      ctx.globalAlpha = blink; ctx.fillStyle = 'rgba(80,15,8,.9)'; ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ff8d78'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      if (st === 3) { const k = clamp(s.dl[i] / (CFG['grupal.espera_apagar'] || 5)); ctx.beginPath(); ctx.arc(h.x, h.y, r, -PI / 2, -PI / 2 + TAU * k); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.stroke(); }
      // Símbolo de apagar
      ctx.strokeStyle = '#ffd3c9'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.arc(h.x, h.y + 1, 9, -PI * .28 - PI / 2 + PI, PI * .28 - PI / 2 + TAU - PI + PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(h.x, h.y - 11); ctx.lineTo(h.x, h.y - 1); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (st === 2) {
      ctx.fillStyle = dead ? '#ff8d78' : '#7cf2bd'; ctx.strokeStyle = 'rgba(8,28,36,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x + 17, h.y - 15, 5.5, 0, TAU); ctx.fill(); ctx.stroke();
    }
  });
}

function drawRadar(s) {
  // Barrido
  const sweep = T * 1.1;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) { const a = sweep - i * .045; ctx.fillStyle = `rgba(120,240,225,${.085 * (1 - i / 14)})`; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 930, a - .045, a); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = 'rgba(140,245,230,.28)'; ctx.lineWidth = 2;
  for (const r of [545, 690, 840]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
  ctx.restore();
  // Ráfagas
  for (const x of s.g) {
    const q = blipPos(x); if (q.r < IMPACT) continue;
    const late = S.T >= x.f, col = x.p ? '#7cf2bd' : x.g ? '#ffd76a' : late ? '#ff8d78' : '#ffffff', beat = 1 + Math.sin(T * 7 + x.id) * .12, big = x.p ? 26 : 50 * beat;
    ctx.save(); ctx.translate(q.x, q.y);
    ctx.globalCompositeOperation = 'lighter'; glowAt(x.p ? SP.gMint : x.g ? SP.gGold : SP.gWhite, 0, 0, big * 2.2, x.p ? .35 : .65); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, big, 0, TAU); ctx.stroke();
    ctx.rotate(x.a + PI); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(-17, -20); ctx.lineTo(-8, 0); ctx.lineTo(-17, 20); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Tormentas
  for (const st of s.st) {
    const q = stormPos(st), col = st.w ? '#7cf2bd' : '#ffd76a';
    ctx.lineWidth = 7; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y, 62 + Math.sin(T * 6) * 5, 0, TAU); ctx.stroke();
    ctx.font = '800 38px Figtree, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(8,28,36,.92)';
    const t = st.w ? 'Avisada' : 'Tocá: tormenta'; ctx.strokeText(t, q.x, q.y - 88); ctx.fillStyle = col; ctx.fillText(t, q.x, q.y - 88);
  }
}

function drawFog() {
  // Niebla: lo que el molino no ve hasta que el vigía lo marca
  const speed = (SPAWN_R - IMPACT) / lerp(CFG['grupal.viaje_inicio'] || 5, CFG['grupal.viaje_final'] || 3.2, clamp(S.T / (S.snap ? S.snap.D : 1)));
  const edge = IMPACT + (CFG['grupal.niebla'] || 2.4) * speed;
  const g = ctx.createRadialGradient(0, 0, edge, 0, 0, edge + 220);
  const n = Sky.night, c = n > .4 ? '165,190,225' : '235,240,240';
  g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(.7, `rgba(${c},.34)`); g.addColorStop(1, `rgba(${c},.46)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1500, 0, TAU); ctx.fill();
}

/* ---------- Final ---------- */
function onEnd(m) {
  S.results = m.results; S.ended = true; S.view = 'end';
  G.mode = 'end'; G.dayTarget = 1; G.fwIn = 1.2; G.gusts.length = 0; S.known.clear();
  $('entry').classList.add('hidden'); $('lobby').classList.add('hidden');
  document.body.classList.remove('in-game', 'danger');
  camTarget();
  const team = S.watch !== null ? S.watch : S.team;
  const r = m.results.find(x => x.i === team) || m.results[0]; if (!r) return;
  const st = r.stats, avg = st.syncAvg;
  const rank = m.results.findIndex(x => x.i === r.i) + 1;
  $('endKicker').textContent = m.results.length > 1 ? `Puesto ${rank} de ${m.results.length}` : 'Fin de la noche';
  const title = avg >= 1.5 ? 'Una sola máquina' : avg >= 1.1 ? 'Buena sintonía' : avg >= .8 ? 'Falta coordinar' : 'Cada cual por su lado';
  $('endTitle').textContent = title;
  const worst = r.links.indexOf(Math.min(...r.links));
  $('endText').textContent = avg >= 1.5 ? `Sintonía media de ×${avg.toFixed(1)}. Cada eslabón sostuvo al siguiente.` : `Sintonía media de ×${avg.toFixed(1)}. El eslabón que más frenó al equipo fue ${ROLES[ORDER[worst]].name}: la próxima, ayúdense ahí.`;
  const el = $('endScore'), final = r.score, t0 = performance.now();
  (function roll(now) { const k = easeOut((now - t0) / 1500); el.textContent = Math.round(final * k).toLocaleString('es-AR'); if (k < 1 && S.view === 'end') requestAnimationFrame(roll); })(t0);
  const rows = [
    ['vigia', `${st.pings} ráfagas marcadas a tiempo`, `${st.pingsLost} sin marcar · ${st.warned}/${st.storms} tormentas avisadas`],
    ['molino', `${st.hits} de ${st.hits + st.misses} ráfagas atrapadas`, `${st.perfects} de frente · mejor racha ${st.bestCombo}`],
    ['red', `${Math.round(st.darkSecs)} s sin batería · ${st.trips} fusibles quemados`, `${st.repairs} líneas reparadas · ${st.protected} barrios blindados`],
    ['luces', `${st.served} casas atendidas a tiempo`, `${st.unserved} se quedaron a oscuras · ${st.wrong} errores`]
  ];
  const box = $('endLinks'); box.innerHTML = '';
  rows.forEach(([role, a, b], i) => {
    const v = Math.round(r.links[i] * 100), row = document.createElement('div'); row.className = 'final-row';
    const ic = document.createElement('span'); ic.className = 'i'; ic.textContent = ROLES[role].ico;
    const tx = document.createElement('div'); const bb = document.createElement('b'); bb.textContent = a; const sm = document.createElement('small'); sm.textContent = b; tx.append(bb, sm);
    const pc = document.createElement('em'); pc.textContent = v + '%'; pc.style.setProperty('--c', v >= 60 ? '#6fe3b0' : v >= 35 ? '#ffc857' : '#ff8d78');
    row.append(ic, tx, pc); box.append(row);
  });
  $('btnAgain').classList.toggle('hidden', !isHost());
  loadBoard(m);
  setTimeout(() => { if (S.view === 'end') { $('end').classList.remove('hidden'); $('end').classList.add('show'); } }, 1000);
  Snd.end(avg >= 1.1);
}

async function loadBoard(m) {
  const ol = $('boardList'); ol.textContent = '';
  const row = (n, name, sub, pts, me) => {
    const li = document.createElement('li'); if (me) li.className = 'me';
    const a = document.createElement('span'); a.className = 'n'; a.textContent = n;
    const w = document.createElement('span'); w.className = 'who'; w.textContent = name;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; w.append(s); }
    const p = document.createElement('span'); p.className = 'pts'; p.textContent = Math.round(pts).toLocaleString('es-AR');
    li.append(a, w, p); ol.append(li);
  };
  if (m.results.length > 1) {
    $('boardTitle').textContent = 'Equipos de la clase';
    m.results.forEach((r, i) => row(i + 1, r.name, r.members.map(x => x.name).join(', '), r.score, r.i === S.team));
    return;
  }
  $('boardTitle').textContent = 'Ranking de equipos';
  try {
    await new Promise(r => setTimeout(r, 700)); // el servidor guarda la partida en paralelo
    const d = await (await fetch('/api/equipos/top')).json();
    d.top.forEach((t, i) => row(i + 1, t.members.map(x => x.name).join(', ') || t.name, `Sintonía ×${t.sync.toFixed(1)}`, t.score, false));
  } catch (e) { $('boardTitle').textContent = 'El ranking no responde ahora'; }
}

/* ---------- Portada ---------- */
function entryError(t) { $('entryErr').textContent = t; S.view = 'entry'; }
async function createRoom() {
  const name = $('myName').value.trim();
  if (!name) { $('myName').focus(); entryError('Poné tu nombre para crear la sala.'); return; }
  Snd.init();
  try {
    const r = await fetch('/api/salas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'sala' }) });
    const d = await r.json(); if (!r.ok) { entryError(d.error || 'No se pudo crear la sala.'); return; }
    join(d.code, name);
  } catch (e) { entryError('No hay conexión con el servidor.'); }
}
async function joinRoom() {
  const name = $('myName').value.trim(), code = $('myCode').value.trim().toUpperCase();
  if (!name) { $('myName').focus(); entryError('Poné tu nombre.'); return; }
  if (code.length !== 4) { $('myCode').focus(); entryError('El código tiene 4 letras.'); return; }
  Snd.init();
  const r = await fetch('/api/salas/' + encodeURIComponent(code)).catch(() => null);
  if (!r) { entryError('No hay conexión con el servidor.'); return; }
  if (!r.ok) { entryError('No encontramos esa sala. Revisá el código.'); return; }
  if ((await r.json()).game === 'atrapa') { location.href = '/atrapavientos?sala=' + code; return; }
  join(code, name);
}
function join(code, name) {
  S.code = code; S.name = name; $('entryErr').textContent = '';
  history.replaceState(null, '', '/grupal?sala=' + code);
  S.view = 'lobby'; Net.connect();
}

(function initUI() {
  const words = [['La', 0], ['Isla', 0], ['en', 1], ['Equipo', 0]]; let i = 0, html = '';
  words.forEach(([w, em], n) => {
    const letters = [...w].map(ch => `<span class="l" style="--i:${i++}">${ch}</span>`).join('');
    html += em ? `<em class="w" aria-hidden="true">${letters}</em> ` : `<span class="w" aria-hidden="true">${letters}</span> `;
    if (n === 1) html += '<br>';
  });
  $('title').innerHTML = html;
  $('chainIntro').innerHTML = ORDER.map(r => `<li><span class="i">${ROLES[r].ico}</span><b>${ROLES[r].name}</b><small>${ROLES[r].short}</small></li>`).join('');
  $('chips').innerHTML = ['left', 'right', 'open', 'fist'].map(k => `<button type="button" class="chip" data-g="${k}" title="${GESTURES[k].t}"><span class="sign-thumb" data-sign="${k}"></span><span>${GESTURES[k].t}</span></button>`).join('');
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { Hand.keyUntil = performance.now() + 700; setGestureFromHands(c.dataset.g); applyControl({ [c.dataset.g]: true }); }));
  $('myName').value = readStore('molino.name') || '';
  $('btnCreate').addEventListener('click', createRoom);
  $('joinForm').addEventListener('submit', e => { e.preventDefault(); joinRoom(); });
  $('btnStart').addEventListener('click', () => { Snd.init(); Net.send({ t: 'start' }); });
  $('btnAgain').addEventListener('click', () => Net.send({ t: 'again' }));
  $('btnPause').addEventListener('click', () => Net.send({ t: S.lobby.phase === 'paused' ? 'resume' : 'pause' }));
  $('selDur').addEventListener('change', e => Net.send({ t: 'cfg', dur: +e.target.value }));
  $('selDiff').addEventListener('change', e => Net.send({ t: 'cfg', diff: e.target.value }));
  $('btnCopy').addEventListener('click', async () => {
    const url = `${location.origin}/grupal?sala=${S.code}`;
    try { await navigator.clipboard.writeText(url); $('btnCopy').textContent = '¡Copiado!'; } catch (e) { $('btnCopy').textContent = url; }
    setTimeout(() => { $('btnCopy').textContent = 'Copiar enlace'; }, 1800);
  });
  $('btnSignsG').addEventListener('click', () => { if (Vision.ready) Trainer.open(); });
  $('btnSound').addEventListener('click', () => { Snd.init(); const on = Snd.toggle(); $('btnSound').classList.toggle('off', !on); });
  $('btnCamOn').addEventListener('click', async () => {
    const b = $('btnCamOn'); if (Vision.ready) return; b.disabled = true; Snd.init();
    try {
      await startVision(msg => { b.textContent = msg; }); b.textContent = 'Cámara encendida';
      if (S.role === 'molino' && !Signs.ready()) Trainer.open();
      $('btnSignsG').classList.toggle('hidden', S.role !== 'molino');
    }
    catch (e) { console.error(e); b.disabled = false; b.textContent = 'No se pudo: probá de nuevo'; }
  });
  addEventListener('keydown', e => {
    if (e.repeat || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || S.role !== 'molino' || G.mode !== 'play') return;
    const k = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'open', w: 'open', W: 'open', ArrowDown: 'fist', s: 'fist', S: 'fist', ' ': 'fist' }[e.key];
    if (!k) return;
    e.preventDefault(); Hand.keyUntil = performance.now() + 700; setGestureFromHands(k); applyControl({ [k]: true });
    setTimeout(() => { if (performance.now() >= Hand.keyUntil && !Vision.ready) setGestureFromHands(null); }, 720);
  });
  fetch('/api/config').then(r => r.json()).then(c => { Object.assign(CFG, c); if (c['texto.grupal']) $('entryLead').textContent = c['texto.grupal']; }).catch(() => {});
  const q = new URLSearchParams(location.search), sala = (q.get('sala') || '').toUpperCase();
  if (q.get('ver')) {
    // Pantalla de la clase: mira a un equipo sin jugar
    S.code = q.get('ver').toUpperCase(); S.watch = +(q.get('team') || 0); S.view = 'play';
    $('entry').classList.add('hidden'); document.body.classList.add('in-game'); prepareRole(); Rules.hideRing = false; G.mode = 'countdown'; Net.connect();
  } else if (sala) {
    $('myCode').value = sala;
    if (readStore('molino.tok.' + sala)) { S.name = readStore('molino.name') || ''; join(sala, S.name); }
  }
})();

G.mode = 'attract'; G.day = .68; G.dayTarget = .68; G.eff = 70;
Rules.hideRing = true; Rules.netMill = true; Rules.noMillControl = true;
bootIsla();
Signs.refreshUI();
syncGestureUI();
