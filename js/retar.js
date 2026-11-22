// Página «Retar»: retar por su nick a un jugador que esté en línea. Al aceptar, los dos van al tablero
// automáticamente (lo hace js/retos.js, que está en todas las páginas).
import { currentUser, openAuth } from './cuenta.js?v=20261122-conexion1';
import { send, isReady, outgoing, myNick } from './retos.js?v=20261115-match1';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = name => { for (const s of document.querySelectorAll('[data-view]')) s.hidden = s.dataset.view !== name; };
function note(text, error = false) { const el = $('rt-msg'); el.hidden = !text; el.textContent = text || ''; el.classList.toggle('error', error); }
let waiting = null, waitTimer = null, listTimer = null;

function render() {
  const user = currentUser();
  if (!user) { view('fuera'); return; }
  if (!user.verified) { view('sin-confirmar'); return; }
  if (waiting) { view('esperando'); return; }
  view('form');
  $('rt-send').disabled = !isReady();
  $('rt-conn').textContent = isReady() ? 'Conectado: los jugadores en línea pueden retarte.' : 'Conectando…';
  $('rt-conn').classList.toggle('online', isReady());
}
function startWaiting(c) {
  waiting = c; note(''); render();
  $('rt-wait-title').innerHTML = `Esperando a que <b>${esc(c.to)}</b> acepte…`;
  $('rt-wait-detail').textContent = `Ritmo ${c.minutes}' + ${c.increment}"${c.games > 1 ? ` · match a ${c.games} partidas` : ''} · ${c.color === 'w' ? 'juegas con blancas' : c.color === 'b' ? 'juegas con negras' : 'color al azar'}`;
  clearInterval(waitTimer);
  const tick = () => {
    const left = Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 1000));
    $('rt-wait-left').textContent = `Le quedan ${left} s para responder.`;
    $('rt-wait-bar').style.width = (left / 60 * 100) + '%';
  };
  tick(); waitTimer = setInterval(tick, 250);
}
function stopWaiting(message, error = false) { waiting = null; clearInterval(waitTimer); render(); note(message, error); }

function askOnline() { if (isReady() && !waiting) send({ type: 'conectados' }); }
// Lista de jugadores registrados: primero los que están en línea (punto verde), después el resto (punto rojo).
// Doble clic o Enter sobre un jugador lo pone en «Nick del rival».
const low = s => String(s).toLocaleLowerCase('es');
let online = [], players = [], picked = '';
function renderOnline(nicks, jugadores) {
  if (Array.isArray(jugadores)) players = jugadores;
  const registered = new Set(players.map(low));
  online = (nicks || []).filter(n => registered.has(low(n)));
  $('rt-nicks').innerHTML = online.map(n => `<option value="${esc(n)}">`).join('');
  renderPlayers();
}
function visiblePlayers() {
  const on = new Set(online.map(low)), q = low($('rt-search').value.trim());
  const all = [...new Map(players.map(n => [low(n), n])).values()];
  return all.filter(n => !q || low(n).includes(q)).map(n => ({ nick: n, on: on.has(low(n)) }))
    .sort((a, b) => (b.on - a.on) || a.nick.localeCompare(b.nick, 'es'));
}
function renderPlayers() {
  const list = visiblePlayers(), q = $('rt-search').value.trim();
  if (!list.some(p => p.nick === picked)) picked = '';
  $('rt-online-count').textContent = online.length ? `· ${online.length} en línea` : '';
  $('rt-online').innerHTML = list.length
    ? list.map(p => `<li role="option" data-nick="${esc(p.nick)}" aria-selected="${p.nick === picked}" class="${p.on ? 'on' : 'off'}" title="${p.on ? 'En línea' : 'Desconectado'}"><span class="rt-dot${p.on ? ' on' : ''}" aria-hidden="true"></span><span class="rt-nick">${esc(p.nick)}</span></li>`).join('')
    : `<li class="muted">${q ? 'Ningún jugador coincide con la búsqueda.' : 'Todavía no hay otros jugadores registrados.'}</li>`;
}
function pick(nick, scroll = false) {
  picked = nick;
  for (const li of $('rt-online').querySelectorAll('li[data-nick]')) {
    const sel = li.dataset.nick === nick; li.setAttribute('aria-selected', sel);
    if (sel && scroll) li.scrollIntoView({ block: 'nearest' });
  }
}
function choose(nick) {
  if (!nick) return;
  $('rt-nick').value = nick; note('');
  $('rt-nick').focus();
}

addEventListener('apejupo:retos', ({ detail: m }) => {
  switch (m.type) {
    case 'hola': render(); askOnline(); if (outgoing.size) startWaiting([...outgoing.values()][0]); break;
    case 'desconectado': render(); break;
    case 'conectados': renderOnline(m.nicks, m.jugadores); break;
    case 'enviado': startWaiting(m.reto); break;
    case 'rechazado': if (waiting?.id === m.id) stopWaiting(`${m.nick} ha rechazado el reto.`, true); break;
    case 'caducado': if (waiting?.id === m.id) stopWaiting(`${m.nick} no ha respondido a tiempo.`, true); break;
    case 'cerrado': if (waiting?.id === m.id) stopWaiting(''); break;
    case 'empezar': view('empezando'); $('rt-start-rival').textContent = m.rival; break;
    case 'error': if (!waiting) { note(m.message, true); $('rt-send').disabled = !isReady(); } break;
  }
});
addEventListener('apejupo:cuenta', render);

$('rt-form').addEventListener('submit', e => {
  e.preventDefault();
  const nick = $('rt-nick').value.trim();
  if (!nick) { $('rt-nick').focus(); return; }
  if (myNick && nick.toLowerCase() === myNick.toLowerCase()) { note('No puedes retarte a ti mismo.', true); return; }
  const [minutes, increment] = $('rt-pace').value.split('+').map(Number);
  note('');
  const games = $('rt-match').checked ? Number($('rt-games').value) : 1;
  if (send({ type: 'retar', nick, minutes, increment, games, color: document.querySelector('input[name="rt-color"]:checked').value })) $('rt-send').disabled = true;
  else note('Sin conexión con el servidor. Espera un momento y vuelve a probar.', true);
});
$('rt-online').addEventListener('click', e => { const li = e.target.closest('li[data-nick]'); if (li) pick(li.dataset.nick); });
$('rt-online').addEventListener('dblclick', e => { const li = e.target.closest('li[data-nick]'); if (li) choose(li.dataset.nick); });
$('rt-search').addEventListener('input', () => { renderPlayers(); const first = visiblePlayers()[0]; if ($('rt-search').value.trim() && first) pick(first.nick, true); });
function listKeys(e) {
  const list = visiblePlayers(); if (!list.length) return;
  const i = list.findIndex(p => p.nick === picked);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    pick(list[next].nick, true);
  } else if (e.key === 'Enter') {
    e.preventDefault(); choose(picked || list[0].nick);
  }
}
$('rt-search').addEventListener('keydown', listKeys);
$('rt-online').addEventListener('keydown', listKeys);
// Match: el número de partidas solo se elige con el interruptor encendido.
function renderMatch() {
  const on = $('rt-match').checked;
  $('rt-games').disabled = !on;
}
$('rt-match').addEventListener('change', renderMatch);
$('rt-cancel').addEventListener('click', () => { if (waiting) send({ type: 'cancelar', id: waiting.id }); stopWaiting('Reto cancelado.'); });
$('rt-enter').addEventListener('click', () => openAuth('entrar'));
$('rt-register').addEventListener('click', () => openAuth('registro'));

// Nick en la dirección (retar.html?nick=...): se rellena el campo.
const preset = new URL(location.href).searchParams.get('nick');
if (preset) $('rt-nick').value = preset.slice(0, 20);
render();
listTimer = setInterval(askOnline, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) askOnline(); });
