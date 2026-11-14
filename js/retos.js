// Retos entre jugadores con cuenta. Se carga en todas las páginas (desde cuenta.js): mantiene una
// conexión en vivo para que el servidor sepa que estás en línea, muestra en el centro de la pantalla
// los retos que te llegan y, cuando uno se acepta, lleva a los dos jugadores al tablero.
const API = (window.APEJUPO_TORNEOS_API || '').replace(/\/$/, '');
const SOCKET_URL = API ? API.replace(/^http/, 'ws') + '/api/retos/socket' : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const session = () => { try { return localStorage.getItem('apejupoSesion') || ''; } catch { return ''; } };

let socket = null, retryTimer = null, pingTimer = null, retry = 0, ready = false;
export let myNick = '';
export const incoming = new Map(), outgoing = new Map();

const emit = detail => dispatchEvent(new CustomEvent('apejupo:retos', { detail }));
export const isReady = () => ready;
export function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !ready) return false;
  socket.send(JSON.stringify(message)); return true;
}

function connect() {
  clearTimeout(retryTimer);
  if (!SOCKET_URL || !session() || socket) return;
  socket = new WebSocket(SOCKET_URL);
  socket.addEventListener('open', () => {
    retry = 0;
    socket.send(JSON.stringify({ type: 'hello', session: session() }));
    pingTimer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send('ping'); }, 30000);
  });
  socket.addEventListener('message', event => {
    if (event.data === 'pong') return;
    let m; try { m = JSON.parse(event.data); } catch { return; }
    handle(m);
  });
  socket.addEventListener('close', () => {
    clearInterval(pingTimer); socket = null; ready = false; emit({ type: 'desconectado' });
    if (session()) retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
  });
}
function disconnect() { clearTimeout(retryTimer); ready = false; myNick = ''; incoming.clear(); outgoing.clear(); closeDialog(); if (socket) { const s = socket; socket = null; s.close(); } }

function handle(m) {
  switch (m.type) {
    case 'hola':
      ready = true; myNick = m.nick; incoming.clear(); outgoing.clear();
      for (const c of m.recibidos) incoming.set(c.id, c);
      for (const c of m.enviados) outgoing.set(c.id, c);
      if (incoming.size) showDialog([...incoming.values()][0]);
      break;
    case 'sin-sesion': ready = false; myNick = ''; break;
    case 'reto': incoming.set(m.reto.id, m.reto); showDialog(m.reto); break;
    case 'enviado': outgoing.clear(); outgoing.set(m.reto.id, m.reto); break;
    case 'retirado': incoming.delete(m.id); if (current?.id === m.id) dialogNote(`${m.nick} ha retirado el reto.`, true); break;
    case 'cerrado': case 'caducado': case 'rechazado':
      incoming.delete(m.id); outgoing.delete(m.id);
      if (current?.id === m.id) closeDialog();
      break;
    case 'empezar':
      // La credencial de jugador de esta partida se guarda donde la busca la página del torneo.
      try { localStorage.setItem('apejupoTorneoJugador:' + m.id, m.token); } catch {}
      location.href = 'jugar-torneo.html?id=' + encodeURIComponent(m.id);
      break;
    case 'error': if (current && m.id === current.id) dialogNote(m.message, true); break;
  }
  emit(m);
}

// Cuadro centrado: «X te reta». Si llegan varios, se enseña el siguiente al cerrar el actual.
let dialog = null, current = null, countdown = null;
const colorText = c => c.color === 'w' ? 'Juegas con <b>negras</b>' : c.color === 'b' ? 'Juegas con <b>blancas</b>' : 'Color <b>al azar</b>';
function showDialog(c) {
  if (current && dialog?.open) return; // ya hay uno a la vista; el resto espera en la cola
  if (!dialog) {
    document.body.insertAdjacentHTML('beforeend', `<dialog class="cu-dialog rt-dialog" id="rt-dialog" aria-labelledby="rt-title">
      <div class="cu-box"><div class="rt-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/></svg></div>
        <h2 id="rt-title" class="rt-title"></h2><p class="rt-detail" id="rt-detail"></p>
        <div class="rt-bar" aria-hidden="true"><span id="rt-bar"></span></div>
        <p class="cu-msg error" id="rt-note" role="alert" hidden></p>
        <div class="rt-actions"><button type="button" class="btn-ghost" id="rt-no">Rechazar</button><button type="button" class="btn cu-submit" id="rt-yes">Aceptar</button></div></div></dialog>`);
    dialog = document.getElementById('rt-dialog');
    dialog.addEventListener('cancel', e => { e.preventDefault(); reject(); }); // Esc = rechazar
    dialog.querySelector('#rt-no').addEventListener('click', reject);
    dialog.querySelector('#rt-yes').addEventListener('click', () => {
      if (!current) return;
      const yes = dialog.querySelector('#rt-yes');
      if (!send({ type: 'aceptar', id: current.id })) { dialogNote('Sin conexión con el servidor. Espera un momento y vuelve a probar.', true); return; }
      yes.disabled = true; dialog.querySelector('#rt-no').disabled = true; yes.textContent = 'Preparando el tablero…';
    });
  }
  current = c;
  dialog.querySelector('#rt-title').innerHTML = c.revancha ? `<b>${esc(c.from)}</b> te pide la revancha` : `<b>${esc(c.from)}</b> te reta a una partida`;
  dialog.querySelector('#rt-detail').innerHTML = `Ritmo <b>${c.minutes}+${c.increment}</b> · ${colorText(c)}`;
  const yes = dialog.querySelector('#rt-yes'), no = dialog.querySelector('#rt-no');
  yes.disabled = false; no.disabled = false; yes.textContent = 'Aceptar';
  dialogNote('');
  clearInterval(countdown);
  const tick = () => {
    const left = c.expiresAt - Date.now();
    dialog.querySelector('#rt-bar').style.width = Math.max(0, left / 60000 * 100) + '%';
    if (left <= 0) { incoming.delete(c.id); closeDialog(); }
  };
  tick(); countdown = setInterval(tick, 250);
  if (!dialog.open) dialog.showModal();
  yes.focus();
}
function dialogNote(text, error = false) {
  if (!dialog) return;
  const n = dialog.querySelector('#rt-note'); n.hidden = !text; n.textContent = text; n.classList.toggle('error', error);
  if (text && error) { dialog.querySelector('#rt-yes').disabled = true; dialog.querySelector('#rt-no').disabled = false; dialog.querySelector('#rt-no').textContent = 'Cerrar'; dialog.querySelector('#rt-yes').textContent = 'Aceptar'; }
}
function reject() {
  if (current && incoming.has(current.id)) send({ type: 'rechazar', id: current.id });
  if (current) incoming.delete(current.id);
  closeDialog();
}
function closeDialog() {
  clearInterval(countdown); current = null;
  if (dialog?.open) dialog.close();
  if (dialog) dialog.querySelector('#rt-no').textContent = 'Rechazar';
  const next = [...incoming.values()].find(c => c.expiresAt > Date.now());
  if (next) showDialog(next);
}

// La cuenta se comprueba al cargar cada página: solo se reconecta si se entra, se sale o se cambia de cuenta.
addEventListener('apejupo:cuenta', e => {
  if (!e.detail) { disconnect(); return; }
  if (!socket) connect();
  else if (ready && myNick && myNick !== e.detail.nick) { disconnect(); connect(); }
});
// Al volver a la pestaña tras un rato (móvil en segundo plano), se reconecta sin esperar al reintento.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !socket && session()) { retry = 0; connect(); } });
connect();
