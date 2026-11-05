'use strict';
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const D = { msgs: [], busy: false, state: null };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

try { D.msgs = JSON.parse(sessionStorage.getItem('molino.devchat') || '[]'); } catch (e) { D.msgs = []; }
const saveChat = () => { try { sessionStorage.setItem('molino.devchat', JSON.stringify(D.msgs.slice(-30))); } catch (e) { /* sin almacenamiento */ } };
// Los bloques de acción son para el servidor: en pantalla se ve solo lo que dice la IA
const clean = t => t.replace(/<accion>[\s\S]*?(<\/accion>|$)/g, '').replace(/<acc[a-z]*$/, '').replace(/\*\*/g, '').trim();

/* ---------- Entrada ---------- */
$('vLogin').addEventListener('submit', async e => {
  e.preventDefault(); $('loginErr').textContent = '';
  const r = await post('/api/dev/login', { clave: $('clave').value }).catch(() => null);
  if (!r) { $('loginErr').textContent = 'No hay conexión con el servidor.'; return; }
  if (!r.ok) { const d = await r.json().catch(() => ({})); $('loginErr').textContent = d.error || 'No se pudo entrar.'; return; }
  $('clave').value = ''; enter();
});
async function enter() {
  const ok = await loadState();
  $('vLogin').classList.toggle('hidden', ok); $('vDev').classList.toggle('hidden', !ok);
  if (ok) { renderLog(); $('chatInput').focus(); setInterval(loadState, 20000); }
}

/* ---------- Estado ---------- */
async function loadState() {
  const r = await fetch('/api/dev/state').catch(() => null);
  if (!r || !r.ok) return false;
  D.state = await r.json(); renderPanel(); return true;
}
function renderPanel() {
  const s = D.state;
  $('stats').textContent = `${s.stats.salas} salas · ${s.stats.jugando} jugando · ${s.stats.jugadores} personas`;
  // Parámetros (no se redibujan mientras alguien está escribiendo en ellos)
  if (!$('tabCfg').contains(document.activeElement)) {
    const box = $('tabCfg'); box.textContent = ''; let group = '';
    const names = { solo: 'Modo solo', grupal: 'Modo grupal', texto: 'Textos' };
    s.catalog.forEach(it => {
      const g = it.key.split('.')[0];
      if (g !== group) { group = g; box.append(el('div', 'cfg-group', names[g] || g)); }
      const row = el('label', 'cfg' + (it.kind === 'text' ? ' text' : '')), name = el('div', '', it.label.replace(/^(Modo solo|Grupal|Portada): /, ''));
      if (it.kind === 'number') name.append(el('small', '', `de ${it.min} a ${it.max}`));
      const input = el(it.kind === 'text' ? 'textarea' : 'input');
      if (it.kind === 'number') { input.type = 'number'; input.step = 'any'; input.min = it.min; input.max = it.max; }
      else input.maxLength = it.max;
      input.value = s.values[it.key];
      input.addEventListener('change', async () => {
        const value = it.kind === 'number' ? +input.value : input.value;
        const r = await post('/api/dev/config', { key: it.key, value }); const d = await r.json().catch(() => ({}));
        if (!r.ok) { addAct(d.error || 'No se guardó', 'bad'); input.value = D.state.values[it.key]; return; }
        addAct(`${it.key} → ${value}`, 'good'); input.blur(); loadState();
      });
      row.append(name, input); box.append(row);
    });
  }
  const hist = $('tabHist'); hist.textContent = '';
  if (!s.versions.length) hist.append(el('p', 'muted', 'Todavía no hubo cambios.'));
  s.versions.forEach(v => {
    const row = el('div', 'hist'), info = el('div'); info.append(el('b', '', `${v.key}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`));
    info.append(el('small', '', `${v.who === 'ia' ? 'IA' : 'Persona'} · ${new Date(v.when).toLocaleString('es-AR')}${v.why ? ' · ' + v.why : ''}`));
    const b = el('button', 'small-btn', 'Deshacer'); b.type = 'button';
    b.addEventListener('click', async () => { const r = await post('/api/dev/revert', { id: v.id }); addAct(r.ok ? `Deshecho: ${v.key} volvió a ${JSON.stringify(v.before)}` : 'No se pudo deshacer', r.ok ? 'good' : 'bad'); loadState(); });
    row.append(info, b); hist.append(row);
  });
  const req = $('tabReq'); req.textContent = '';
  req.append(el('p', 'muted', 'Lo que la IA no puede cambiar sola porque requiere tocar el código.'));
  if (!s.requests.length) req.append(el('p', 'muted', 'No hay pedidos.'));
  s.requests.forEach(q => {
    const row = el('div', 'req' + (q.done ? ' done' : '')); row.append(el('b', '', q.title), el('p', '', q.detail));
    const b = el('button', 'small-btn', q.done ? 'Reabrir' : 'Marcar resuelto'); b.type = 'button';
    b.addEventListener('click', async () => { await post('/api/dev/request', { id: q.id, done: !q.done }); loadState(); });
    row.append(b); req.append(row);
  });
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  ['cfg', 'hist', 'req'].forEach(t => $('tab' + t[0].toUpperCase() + t.slice(1)).classList.toggle('hidden', t !== b.dataset.tab));
}));

/* ---------- Chat ---------- */
function addAct(text, cls) { const a = el('div', 'act ' + (cls || ''), text); $('log').append(a); $('log').scrollTop = 1e9; }
function renderLog() {
  const log = $('log'); log.textContent = '';
  if (!D.msgs.length) {
    const box = el('div', 'empty-chat');
    box.append(el('p', '', 'Pedile que corrija o ajuste el juego. Los cambios de parámetros valen desde la próxima partida y se pueden deshacer.'));
    const sug = el('div', 'sug');
    ['El modo grupal está muy difícil al final', 'Dale más tiempo al vigía', '¿Por qué se quema tan rápido un fusible?'].forEach(t => {
      const b = el('button', '', t); b.type = 'button'; b.addEventListener('click', () => { $('chatInput').value = t; $('chatInput').focus(); }); sug.append(b);
    });
    box.append(sug); log.append(box); return;
  }
  D.msgs.forEach(m => {
    const t = m.role === 'assistant' ? clean(m.content) : m.content;
    if (t) log.append(el('div', 'msg ' + (m.role === 'user' ? 'user' : 'ai'), t));
  });
  log.scrollTop = 1e9;
}
$('chatInput').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(130, e.target.scrollHeight) + 'px'; });
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('chatForm').requestSubmit(); } });
$('chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('chatInput').value.trim(); if (!text || D.busy) return;
  D.busy = true; $('btnSend').disabled = true; $('chatInput').value = ''; $('chatInput').style.height = 'auto';
  D.msgs.push({ role: 'user', content: text }); saveChat(); renderLog();
  const log = $('log'); let bubble = el('div', 'msg ai typing', 'Pensando…'), raw = '', all = ''; log.append(bubble); log.scrollTop = 1e9;
  try {
    const r = await post('/api/dev/chat', { messages: D.msgs });
    if (r.status === 401) { location.reload(); return; }
    if (!r.ok || !r.body) throw new Error(r.status);
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!line.startsWith('data: ')) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.t === 'tok') { raw += ev.v; all += ev.v; const c = clean(raw); bubble.textContent = c || 'Pensando…'; bubble.classList.toggle('typing', !c); log.scrollTop = 1e9; }
        else if (ev.t === 'accion') { addAct(ev.texto, ev.ok ? (ev.tipo === 'config' || ev.tipo === 'pedido' ? 'good' : '') : 'bad'); if (ev.tipo === 'config' || ev.tipo === 'pedido') loadState(); }
        else if (ev.t === 'turno') { if (!clean(raw)) bubble.remove(); raw = ''; all += '\n'; bubble = el('div', 'msg ai typing', 'Pensando…'); log.append(bubble); log.scrollTop = 1e9; }
        else if (ev.t === 'error') { addAct(ev.v, 'bad'); }
      }
    }
    if (!clean(raw)) bubble.remove();
    if (all.trim()) { D.msgs.push({ role: 'assistant', content: all }); saveChat(); }
  } catch (x) { bubble.remove(); addAct('Se cortó la conexión con el servidor. Probá de nuevo.', 'bad'); }
  D.busy = false; $('btnSend').disabled = false; $('chatInput').focus();
});

enter().then(() => { if ($('vDev').classList.contains('hidden')) { $('vLogin').classList.remove('hidden'); $('clave').focus(); } });
