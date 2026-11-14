// Página «Retar»: retar por su nick a un jugador que esté en línea. Al aceptar, los dos van al tablero
// automáticamente (lo hace js/retos.js, que está en todas las páginas).
import { currentUser, openAuth } from './cuenta.js?v=20261114-retos1';
import { send, isReady, outgoing, myNick } from './retos.js?v=20261114-retos1';

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
  $('rt-wait-detail').textContent = `Ritmo ${c.minutes}+${c.increment} · ${c.color === 'w' ? 'juegas con blancas' : c.color === 'b' ? 'juegas con negras' : 'color al azar'}`;
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
function renderOnline(nicks) {
  $('rt-online-count').textContent = nicks.length ? `(${nicks.length})` : '';
  $('rt-online').innerHTML = nicks.length
    ? nicks.map(n => `<li><span class="rt-dot" aria-hidden="true"></span><span class="rt-nick">${esc(n)}</span><button type="button" class="btn-ghost" data-nick="${esc(n)}">Retar</button></li>`).join('')
    : '<li class="muted">Ahora mismo no hay nadie más conectado.</li>';
  $('rt-nicks').innerHTML = nicks.map(n => `<option value="${esc(n)}">`).join('');
}

addEventListener('apejupo:retos', ({ detail: m }) => {
  switch (m.type) {
    case 'hola': render(); askOnline(); if (outgoing.size) startWaiting([...outgoing.values()][0]); break;
    case 'desconectado': render(); break;
    case 'conectados': renderOnline(m.nicks); break;
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
  if (send({ type: 'retar', nick, minutes, increment, color: document.querySelector('input[name="rt-color"]:checked').value })) $('rt-send').disabled = true;
  else note('Sin conexión con el servidor. Espera un momento y vuelve a probar.', true);
});
$('rt-online').addEventListener('click', e => {
  const b = e.target.closest('button[data-nick]'); if (!b) return;
  $('rt-nick').value = b.dataset.nick; $('rt-form').requestSubmit();
});
$('rt-cancel').addEventListener('click', () => { if (waiting) send({ type: 'cancelar', id: waiting.id }); stopWaiting('Reto cancelado.'); });
$('rt-enter').addEventListener('click', () => openAuth('entrar'));
$('rt-register').addEventListener('click', () => openAuth('registro'));

// Nick en la dirección (retar.html?nick=...): se rellena el campo.
const preset = new URL(location.href).searchParams.get('nick');
if (preset) $('rt-nick').value = preset.slice(0, 20);
render();
listTimer = setInterval(askOnline, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) askOnline(); });
