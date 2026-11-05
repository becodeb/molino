'use strict';
const $ = id => document.getElementById(id);
const ROLES = { vigia: ['🔭', 'Vigía'], molino: ['🌬️', 'Molino'], red: ['⚡', 'Red'], luces: ['💡', 'Luces'], director: ['🌀', 'Director'], anunciador: ['📣', 'Anunciador'] };
const ORDERS = { isla: ['vigia', 'molino', 'red', 'luces'], atrapa: ['director', 'anunciador'] };
const PAGES = { isla: 'grupal', atrapa: 'atrapavientos' };
const game = () => (P.lobby && P.lobby.game) || 'isla';
const order = () => ORDERS[game()];
const P = { code: null, key: null, lobby: null, ws: null, results: null, closed: false, retry: 0 };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmt = n => Math.round(n).toLocaleString('es-AR');
const show = v => ['vSetup', 'vLobby', 'vLive', 'vEnd'].forEach(id => $(id).classList.toggle('hidden', id !== v));

function saved() { try { return JSON.parse(localStorage.getItem('molino.profe') || 'null'); } catch (e) { return null; } }
function store(v) { try { if (v) localStorage.setItem('molino.profe', JSON.stringify(v)); else localStorage.removeItem('molino.profe'); } catch (e) { /* almacenamiento bloqueado */ } }

$('setupForm').addEventListener('submit', async e => {
  e.preventDefault(); $('setupErr').textContent = '';
  const body = { game: $('fGame').value, kind: 'clase', dur: +$('fDur').value, diff: $('fDiff').value, teamSize: +$('fSize').value };
  try {
    const r = await fetch('/api/salas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { $('setupErr').textContent = d.error || 'No se pudo crear la clase.'; return; }
    P.code = d.code; P.key = d.key; store({ code: d.code, key: d.key }); connect();
  } catch (x) { $('setupErr').textContent = 'No hay conexión con el servidor.'; }
});

$('fGame').addEventListener('change', e => $('rowSize').classList.toggle('hidden', e.target.value === 'atrapa'));

function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const ws = P.ws = new WebSocket(`${proto}${location.host}/ws?${new URLSearchParams({ code: P.code, as: 'profe', k: P.key })}`);
  ws.onopen = () => { P.retry = 0; };
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = () => { if (P.closed) return; P.retry++; if (P.retry > 8) { store(null); location.reload(); return; } setTimeout(connect, Math.min(5000, 600 * P.retry)); };
  $('btnLeave').classList.remove('hidden');
}
const send = o => { if (P.ws && P.ws.readyState === 1) P.ws.send(JSON.stringify(o)); };

function onMessage(m) {
  if (m.t === 'lobby') onLobby(m);
  if (m.t === 'dash') onDash(m);
  if (m.t === 'end') onEnd(m);
}

function onLobby(m) {
  P.lobby = m;
  if (m.phase === 'lobby') { show('vLobby'); renderLobby(m); }
  if (m.phase === 'countdown' || m.phase === 'play' || m.phase === 'paused') {
    show('vLive');
    $('btnPause').textContent = m.phase === 'paused' ? 'Seguir' : 'Pausar a todos';
    $('liveTitle').textContent = m.phase === 'countdown' ? '¡Arranca!' : m.phase === 'paused' ? 'En pausa' : 'Ronda en curso';
  }
}

let qrDone = null;
function renderQr(url) {
  if (qrDone === url) return; qrDone = url;
  const draw = () => { try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { $('qr').textContent = 'Usá el código'; } };
  if (window.qrcode) return draw();
  const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = draw; s.onerror = () => { $('qr').textContent = 'Usá el código'; }; document.head.append(s);
}

function renderLobby(m) {
  const url = `${location.origin}/${PAGES[game()]}?sala=${m.code}`;
  $('classCode').textContent = m.code; $('classUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*/, ''); renderQr(url);
  $('countPlayers').textContent = m.players.length;
  $('lDur').value = String(m.dur); $('lDiff').value = m.diff;
  $('btnStart').disabled = m.players.length === 0;
  if (document.activeElement !== $('numTeams')) $('numTeams').value = Math.max(m.teams.length, Math.ceil(m.players.length / (m.teamSize || 4)) || 1);
  const box = $('teamsBox'); box.textContent = '';
  $('noPlayers').classList.toggle('hidden', m.players.length > 0);
  if (!m.players.length) return;
  m.teams.forEach(t => {
    const mates = m.players.filter(p => p.team === t.i);
    const card = el('section', 'card team-col'), h = el('h3', '', t.name);
    const missing = order().filter(r => !mates.some(p => p.role === r));
    h.append(el('small', '', missing.length ? `Bots: ${missing.map(r => ROLES[r][1]).join(', ')}` : 'Roles completos'));
    card.append(h);
    if (!mates.length) card.append(el('p', 'muted', 'Sin integrantes'));
    mates.forEach(p => {
      const row = el('div', 'prow');
      row.append(el('span', 'dot' + (p.online ? '' : ' off')), el('span', 'pname', p.name));
      const rs = el('select'); rs.setAttribute('aria-label', 'Rol de ' + p.name);
      order().forEach(r => { const o = el('option', '', `${ROLES[r][0]} ${ROLES[r][1]}`); o.value = r; rs.append(o); }); rs.value = p.role;
      rs.addEventListener('change', () => send({ t: 'assign', player: p.id, team: p.team, role: rs.value }));
      const ts = el('select'); ts.setAttribute('aria-label', 'Equipo de ' + p.name);
      m.teams.forEach(x => { const o = el('option', '', 'Eq. ' + (x.i + 1)); o.value = x.i; ts.append(o); }); ts.value = p.team;
      ts.addEventListener('change', () => send({ t: 'assign', player: p.id, team: +ts.value, role: p.role }));
      const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Sacar a ' + p.name);
      x.addEventListener('click', () => { if (confirm(`¿Sacar a ${p.name} de la clase?`)) send({ t: 'kick', player: p.id }); });
      row.append(rs, ts, x); card.append(row);
    });
    box.append(card);
  });
}

function onDash(m) {
  const box = $('liveBox'); box.textContent = '';
  const rank = [...m.teams].sort((a, b) => (b.score || 0) - (a.score || 0)).map(t => t.i);
  m.teams.forEach(t => {
    const card = el('section', 'card live-card');
    const top = el('div', 'live-top'), left = el('div');
    left.append(el('h3', '', t.name), el('div', 'live-score', fmt(t.score || 0)));
    top.append(left, el('div', 'live-sync', game() === 'atrapa' ? (t.burned ? '🔥' : '🔴'.repeat(t.streak || 0) || '✓') : '×' + (t.sync || 1).toFixed(1)));
    card.append(top);
    const links = t.links || order().map(() => .7);
    let worst = 0; links.forEach((v, i) => { if (v < links[worst]) worst = i; });
    order().forEach((r, i) => {
      const v = links[i], c = v >= .6 ? '#6fe3b0' : v >= .35 ? '#ffc857' : '#ff5d47', row = el('div', 'lrow');
      const bar = el('div', 'lbar'), f = el('i'); f.style.width = Math.round(v * 100) + '%'; f.style.background = c; bar.append(f);
      row.append(el('span', '', ROLES[r][0]), bar, el('span', '', Math.round(v * 100) + '%')); card.append(row);
    });
    const low = links[worst] < .45;
    card.append(el('p', 'hint' + (low ? '' : ' ok'), t.burned ? 'Motores quemados: están reparando' : low ? `Conviene mirar a ${ROLES[order()[worst]][1]}` : 'El equipo viene sostenido'));
    const foot = el('div', 'live-foot'), remain = Math.max(0, (t.D || 0) - (t.T || 0));
    foot.append(el('span', '', `Puesto ${rank.indexOf(t.i) + 1} · quedan ${Math.floor(remain / 60)}:${String(Math.floor(remain % 60)).padStart(2, '0')}`));
    if (game() === 'isla') { const a = el('a', 'small', 'Ver'); a.href = `/grupal?ver=${P.code}&team=${t.i}`; a.target = '_blank'; a.rel = 'noopener'; foot.append(a); }
    card.append(foot); box.append(card);
  });
}

function onEnd(m) {
  P.results = m.results; show('vEnd');
  const pod = $('podium'); pod.textContent = '';
  m.results.slice(0, 3).forEach((r, i) => {
    const c = el('div', 'pod' + (i === 0 ? ' first' : ''));
    c.append(el('small', '', `Puesto ${i + 1}`), el('h3', '', r.name), el('div', 'n', fmt(r.score)), el('p', '', r.members.map(x => x.name).join(', ') || 'Sin integrantes'));
    pod.append(c);
  });
  const tb = $('resultTable'); tb.textContent = '';
  const atrapa = game() === 'atrapa';
  const cols = atrapa ? ['Equipo', 'Puntaje', 'Vientos atrapados', 'Modos correctos', 'Rojos protegidos', 'Rojos recibidos', 'Motores quemados'] : ['Equipo', 'Puntaje', 'Sintonía', 'Ráfagas', 'Marcadas', 'Casas', 'Sin batería', 'Fusibles'];
  const head = el('tr'); cols.forEach(h => head.append(el('th', '', h))); tb.append(head);
  m.results.forEach(r => {
    const s = r.stats, tr = el('tr');
    const row = atrapa
      ? [r.name, fmt(r.score), `${s.caught} de ${s.caught + s.missed}`, `${s.rightMode} de ${s.rightMode + s.wrongMode}`, s.redsSafe + s.redsDodged, s.redsHit, s.burns]
      : [r.name, fmt(r.score), '×' + s.syncAvg.toFixed(2), `${s.hits}/${s.hits + s.misses}`, `${s.pings} a tiempo, ${s.pingsLost} perdidas`, `${s.served} atendidas, ${s.unserved} sin luz`, `${Math.round(s.darkSecs)} s`, s.trips];
    row.forEach(v => tr.append(el('td', '', v)));
    tb.append(tr);
  });
  const best = m.results[0], weakest = {};
  m.results.forEach(r => { let w = 0; r.links.forEach((v, i) => { if (v < r.links[w]) w = i; }); const k = order()[w]; weakest[k] = (weakest[k] || 0) + 1; });
  const common = Object.entries(weakest).sort((a, b) => b[1] - a[1])[0];
  const qs = atrapa ? [
    `${best ? best.name : 'El mejor equipo'} sacó el mejor puntaje: ¿cómo se avisaban los vientos? ¿Qué palabras usaban?`,
    '¿Qué pasaba cuando el Anunciador veía un viento rojo? ¿Convenía proteger o girar el molino?',
    '¿Por qué el Director no ve los colores? ¿Qué cambia cuando dependés de lo que te cuenta otra persona?',
    '¿Por qué algunas señas se confundían más que otras? ¿Qué necesita ver la compu para distinguirlas?'
  ] : [
    `${best ? best.name : 'El mejor equipo'} logró la mejor sintonía o el mejor puntaje: ¿cómo se organizaron y qué se decían durante la partida?`,
    common ? `El eslabón más frágil fue ${ROLES[common[0]][1]}. ¿Qué pasaba con el resto del equipo cuando ese rol se atrasaba?` : '',
    '¿Por qué soltar más energía de la que pide la ciudad también es un problema? ¿Dónde pasa algo parecido en una red eléctrica real?',
    'Cada molinero inventó sus señas. ¿Por qué algunas se confundían más que otras? ¿Qué necesita ver la compu para distinguirlas?'
  ].filter(Boolean);
  const talk = $('talk'); talk.textContent = ''; qs.forEach(q => talk.append(el('li', '', q)));
}

$('numTeams').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnTeams').click(); });
$('btnTeams').addEventListener('click', () => { const n = Math.max(1, Math.min(20, +$('numTeams').value || 1)); send({ t: 'teams', n }); });
$('btnStart').addEventListener('click', () => send({ t: 'start' }));
$('lDur').addEventListener('change', e => send({ t: 'cfg', dur: +e.target.value }));
$('lDiff').addEventListener('change', e => send({ t: 'cfg', diff: e.target.value }));
$('btnPause').addEventListener('click', () => send({ t: P.lobby && P.lobby.phase === 'paused' ? 'resume' : 'pause' }));
$('btnFinish').addEventListener('click', () => { if (confirm('¿Terminar la ronda ahora para todos los equipos?')) send({ t: 'finish' }); });
$('btnAgain').addEventListener('click', () => send({ t: 'again' }));
$('btnLeave').addEventListener('click', () => {
  if (!confirm('¿Cerrar esta clase en este dispositivo? Los equipos pueden seguir jugando la ronda en curso.')) return;
  P.closed = true; if (P.ws) P.ws.close(); store(null); location.href = '/profe';
});
$('btnCsv').addEventListener('click', () => {
  const q = v => `"${String(v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const atrapa = game() === 'atrapa';
  const rows = [(atrapa
    ? ['equipo', 'integrantes', 'puntaje', 'director', 'anunciador', 'vientos_atrapados', 'vientos_perdidos', 'modos_correctos', 'modos_equivocados', 'rojos_protegidos', 'rojos_esquivados', 'rojos_recibidos', 'motores_quemados', 'reparaciones', 'errores_reparacion']
    : ['equipo', 'integrantes', 'puntaje', 'sintonia_media', 'vigia', 'molino', 'red', 'luces', 'rafagas_atrapadas', 'rafagas_perdidas', 'marcadas_a_tiempo', 'marcas_perdidas', 'casas_atendidas', 'casas_sin_luz', 'errores_luces', 'segundos_sin_bateria', 'fusibles']).join(',')];
  P.results.forEach(r => {
    const s = r.stats, base = [q(r.name), q(r.members.map(x => `${x.name} (${x.role})`).join('; ')), r.score], links = r.links.map(v => Math.round(v * 100));
    rows.push((atrapa
      ? [...base, ...links, s.caught, s.missed, s.rightMode, s.wrongMode, s.redsSafe, s.redsDodged, s.redsHit, s.burns, s.repairs, s.repairErrors]
      : [...base, s.syncAvg.toFixed(2), ...links, s.hits, s.misses, s.pings, s.pingsLost, s.served, s.unserved, s.wrong, Math.round(s.darkSecs), s.trips]).join(','));
  });
  const a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = `atrapavientos-${P.code}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

(async function resume() {
  const s = saved(); if (!s) return;
  const r = await fetch('/api/salas/' + encodeURIComponent(s.code)).catch(() => null);
  if (!r || !r.ok) { store(null); return; }
  P.code = s.code; P.key = s.key; connect();
})();
