import { Chess } from '../assets/chess/chess.js';
import { session, currentUser, openAuth } from './cuenta.js?v=20261114-retos1';
import { send as sendReto } from './retos.js?v=20261114-retos1';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API = (window.APEJUPO_TORNEOS_API || '').replace(/\/$/, '');
const roomId = new URL(location.href).searchParams.get('id');
// «Ver tableros» se abre en otra pestaña: solo la cuadrícula en directo, entrando como espectador.
const boardsMode = new URL(location.href).searchParams.get('vista') === 'tableros';
// En la página de tableros, ?partida= abre esa partida ya ampliada.
let zoomed = new URL(location.href).searchParams.get('partida');
const statuses = { waiting: 'Inscripción abierta', playing: 'En juego', between: 'Entre rondas', finished: 'Finalizado', cancelled: 'Cancelado' };
const pieceNames = { k: 'rey', q: 'dama', r: 'torre', b: 'alfil', n: 'caballo', p: 'peón' };
const images = new Map();
let state = null, socket = null, reconnectTimer = null, heartbeat = null, retry = 0, lastReceived = 0;
let connected = false, pending = false, offset = 0, selected = null, flipped = false, manualFlip = false;
let boardKey = '', lastRound = null, viewedRound = null, replay = null, replayPly = null, promotion = null;
let confirmResolve = null, dropped = null, lobby = new Map();
let editingId = null, keyFieldRequired = false; // formulario de organizar: torneo que se edita y si se pide la clave de organización
// Jugada propia mostrada al instante, antes de que la confirme el servidor (como en Lichess).
let optimistic = null, rendered = { game: null, fen: null }, skipSlide = false, drag = null;

function read(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function write(key, value) {
  try { localStorage.setItem(key, value); }
  catch { throw new Error('Permite el almacenamiento de este sitio para conservar tu inscripción y recuperar tus partidas.'); }
}
function token() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const playerKey = () => 'apejupoTorneoJugador:' + roomId;
const hostKey = id => 'apejupoTorneoOrganizador:' + id;
function message(text, error = false) { $('to-message').hidden = !text; $('to-message').textContent = text; $('to-message').classList.toggle('error', error); }
function setConnection(text, online = false) {
  connected = online;
  for (const id of ['to-connection', 'to-boards-conn']) { $(id).textContent = text; $(id).classList.toggle('online', online); }
  if (state) { boardKey = ''; renderGame(); renderControls(); }
}
async function request(path, { key, ...options } = {}) {
  const response = await fetch(API + path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: 'Bearer ' + key } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'No se pudo completar la operación.'); }
  return response;
}
const arena = t => t?.format === 'arena';
const closed = t => t?.format === 'closed';
function duration(minutes) { return minutes % 60 ? (minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`) : `${minutes / 60} h`; }
function formatLabel(t) { return t.challenge ? 'Reto' : arena(t) ? `Arena de ${duration(t.duration)}` : closed(t) ? (t.rounds ? `Cerrado a ${t.rounds} rondas` : 'Cerrado: todos contra todos') : `${t.rounds} rondas`; }
function date(value) { return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value); }
function name(id) { return state?.standings.find(p => p.id === id)?.name || 'Jugador'; }
function send(action) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !connected) { message('Espera a recuperar la conexión antes de continuar.', true); return false; }
  socket.send(JSON.stringify(action)); return true;
}
function hello() { send(boardsMode ? { type: 'hello' } : { type: 'hello', token: read(playerKey()), hostToken: read(hostKey(roomId)) }); }

// En pruebas locales el servidor puede no pedir clave de organización: entonces se ocultan sus campos.
function setKeyMode(required) {
  for (const [field, input] of [['to-key-field', 'to-key']]) {
    keyFieldRequired = required; $(field).hidden = !required; $(input).disabled = !required; $(input).required = required;
  }
}
async function checkKeyMode() {
  try { setKeyMode((await (await request('/api/tournaments')).json()).keyRequired !== false); } catch {}
}
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const icons = {
  clock: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
  format: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/>'),
  people: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>')
};
const emptyLobby = `<div class="to-empty"><div class="to-empty-art" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M32 5v10M27 10h10M22 27c0-6 4-11 10-11s10 5 10 11c0 5-3 8-4 12H26c-1-4-4-7-4-12zM24 39h16l3 9H21zM17 48h30v7H17z"/></svg></div><strong>El próximo torneo puede ser el nuestro</strong><p>Todavía no hay torneos. Cuando la organización abra uno, aparecerá aquí.</p><button class="btn" type="button" data-create>Organizar torneo</button></div>`;
function eventCard(t) {
  const trash = read(hostKey(t.id)) ? `<button class="to-delete" type="button" data-delete="${t.id}" aria-label="Borrar el torneo ${esc(t.title)}" title="Borrar torneo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg></button>` : '';
  // Lápiz para editar: solo el organizador y mientras no haya empezado.
  const pencil = trash && t.status === 'waiting' ? `<button class="to-delete to-edit" type="button" data-edit="${t.id}" aria-label="Editar el torneo ${esc(t.title)}" title="Editar torneo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>` : '';
  const full = Math.min(100, Math.round(t.count / t.capacity * 100));
  return `<article class="to-event ${t.status}">${pencil}${trash}<div class="to-event-top"><span class="to-status ${t.status}">${esc(statuses[t.status])}</span><span class="to-event-clock">${icons.clock}${t.minutes} + ${t.increment}</span></div>`
    + `<h3>${esc(t.title)}</h3><ul class="to-event-meta"><li>${icons.format}${formatLabel(t)}</li>${t.locked ? `<li>${icons.lock}Inscripción con clave</li>` : ''}<li>${icons.calendar}${t.startsAt ? esc(date(t.startsAt)) : 'Inicio a cargo del organizador'}</li></ul>`
    + `<div class="to-event-fill"><span>${icons.people}${t.count}/${t.capacity} jugadores</span><i><b style="width:${full}%"></b></i></div>`
    + `<a class="btn" href="jugar-torneo.html?id=${t.id}">${t.status === 'waiting' ? 'Entrar e inscribirme' : 'Ver torneo'}</a></article>`;
}
async function loadLobby() {
  if (!API) {
    $('to-events').innerHTML = '<div class="to-empty"><strong>Estamos preparando los próximos torneos</strong>Las inscripciones estarán disponibles aquí cuando abramos esta sección.</div>';
    $('to-create-open').disabled = true; $('to-refresh').disabled = true; return;
  }
  $('to-refresh').disabled = true;
  try {
    const { tournaments, keyRequired } = await (await request('/api/tournaments')).json();
    setKeyMode(keyRequired !== false);
    lobby = new Map(tournaments.map(t => [t.id, t]));
    $('to-events').innerHTML = tournaments.length ? tournaments.map(eventCard).join('') : emptyLobby;
    message('');
  } catch {
    $('to-events').innerHTML = '<div class="to-empty"><strong>No podemos consultar los torneos ahora</strong>Vuelve a pulsar Actualizar en unos momentos.</div>';
  } finally { $('to-refresh').disabled = false; }
}

// Jugada suelta: el servidor ya no manda el torneo entero con cada jugada, solo lo que cambia.
function applyMove(m) {
  const d = m.game, row = state.games.find(g => g.id === d.id), g = state.game;
  offset = m.serverNow - Date.now();
  if (m.revision > state.revision) state.revision = m.revision;
  const clock = { fen: d.fen, lastMove: d.lastMove, turn: d.turn, whiteMs: d.whiteMs, blackMs: d.blackMs, lastAt: d.lastAt };
  if (row && !row.result && !(row.ply >= d.ply)) Object.assign(row, clock, { ply: d.ply });
  if (g && g.id === d.id && !g.result) {
    pending = false;
    if (d.ply === g.moves.length + 1) {
      g.moves.push(d.san); Object.assign(g, clock, { offer: d.offer, legal: d.legal });
      if (optimistic && optimistic.game === d.id && d.ply >= optimistic.ply) optimistic = null;
      if (!drag) selected = null; boardKey = '';
    } else if (d.ply > g.moves.length + 1) { send({ type: 'watch', game: g.id }); return; } // se perdió algo: pedir el tablero completo
  }
  render();
}
function connect() {
  clearTimeout(reconnectTimer); clearInterval(heartbeat);
  setConnection(retry ? 'Reconectando…' : 'Conectando…');
  const url = new URL(API + '/api/tournaments/' + roomId + '/socket'); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url); socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    retry = 0; lastReceived = Date.now(); setConnection('Conectado', true); hello();
    heartbeat = setInterval(() => {
      if (Date.now() - lastReceived > 75000) ws.close();
      else if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 30000);
  };
  ws.onmessage = event => {
    if (socket !== ws) return;
    lastReceived = Date.now();
    if (event.data === 'pong') return;
    let next; try { next = JSON.parse(event.data); } catch { return; }
    if (next.type === 'error') { pending = false; optimistic = null; boardKey = ''; message(next.message, true); if (state) renderGame(); return; }
    if (next.type === 'move') { if (state) applyMove(next); return; }
    if (next.type !== 'state') return;
    if (state && next.revision < state.revision) return;
    const oldGame = state?.game, oldMe = state?.me;
    offset = next.serverNow - Date.now(); pending = false; state = next;
    if (optimistic && (next.game?.id !== optimistic.game || next.game.moves.length >= optimistic.ply)) optimistic = null;
    if (oldGame?.id !== next.game?.id || oldGame?.fen !== next.game?.fen) { if (!drag) selected = null; boardKey = ''; }
    if (oldGame?.id !== next.game?.id || oldGame?.result !== next.game?.result) { replay = null; replayPly = null; }
    if (!manualFlip && next.me && next.game && (oldGame?.id !== next.game.id || oldMe !== next.me)) flipped = next.game.black === next.me;
    const changedRound = lastRound !== next.round; lastRound = next.round;
    if (changedRound && next.round > 0) message('');
    if (changedRound || viewedRound === null) viewedRound = next.round || 1;
    render();
    if (next.me && (changedRound || oldMe !== next.me)) {
      const mine = next.games.find(g => !g.bye && (arena(next) ? !g.result : g.round === next.round) && (g.white === next.me || g.black === next.me));
      if (mine && mine.id !== next.game?.id) { watch(mine.id); if (!mine.result) newGameAlert(); }
    }
  };
  ws.onclose = event => {
    if (socket !== ws) return;
    clearInterval(heartbeat); pending = false;
    setConnection('Reconectando…');
    if (event.reason === 'El organizador ha borrado el torneo.') { setConnection('Torneo borrado'); message('El organizador ha borrado este torneo.', true); return; }
    if (event.reason === 'El torneo ha caducado.') { setConnection('Torneo archivado'); message('Este torneo ha caducado y ya no está disponible.'); return; }
    reconnectTimer = setTimeout(async () => {
      try {
        const res = await fetch(API + '/api/tournaments/' + roomId, { signal: AbortSignal.timeout(10000) });
        if (res.status === 404 || res.status === 410) { setConnection('Torneo no disponible'); message('Este torneo no existe o ya ha caducado.', true); return; }
      } catch {}
      connect();
    }, Math.min(15000, 1000 * 2 ** Math.min(retry++, 4)) + Math.random() * 500);
  };
  ws.onerror = () => { /* onclose gestiona la recuperación sin perder la inscripción. */ };
}

function render() {
  const t = state;
  $('to-title').textContent = t.title; document.title = t.title + ' · Torneo Apejupo';
  $('to-subtitle').textContent = canJoin(t) && arena(t) && t.status === 'playing' && !t.standings.some(p => p.id === t.me) ? 'El arena está en marcha: únete y empieza a jugar ya.' : t.challenge ? (t.status === 'waiting' ? 'La partida empieza en cuanto los dos tengáis el tablero abierto.' : '') : t.status === 'waiting' ? 'Las inscripciones están abiertas. Reserva tu sitio en el tablero.' : 'Sigue tus partidas, los tableros y la clasificación en directo.';
  $('to-subtitle').hidden = !$('to-subtitle').textContent;
  // Reto: solo el tablero (y el marcador entre los dos) bajo la cabecera de la web.
  document.body.classList.toggle('to-challenge', !!t.challenge);
  $('to-summary').innerHTML = `<span class="to-status ${t.status}">${esc(t.challenge && t.status === 'waiting' ? 'Esperando al rival' : statuses[t.status])}</span><span>${icons.clock}${t.minutes} + ${t.increment}</span><span>${icons.format}${formatLabel(t)}</span>${t.challenge ? '' : `<span>${arena(t) ? 'Emparejamiento continuo' : closed(t) ? 'Todos contra todos' : t.pairing === 'club' ? 'Suizo de club' : 'Suizo FIDE (sistema holandés)'}</span>`}`
    + (t.status === 'waiting' ? `<span>${icons.people}Hasta ${t.capacity} jugadores</span><span>${icons.calendar}${t.startsAt ? esc(date(t.startsAt)) : 'Inicio a cargo del organizador'}</span>${t.locked ? `<span>${icons.lock}Con clave</span>` : ''}` : '');
  placeWaiting(t.status === 'waiting');
  $('to-notice').hidden = !t.notice; $('to-notice').textContent = t.notice;
  const mine = t.standings.find(p => p.id === t.me), registering = t.status === 'waiting';
  $('to-registration').hidden = !canJoin(t) || !!mine || t.count >= t.capacity;
  renderJoin();
  $('to-membership').hidden = !mine || !!t.challenge;
  renderDuel(t);
  $('to-membership-text').textContent = mine ? `Juegas como ${mine.name}${mine.active ? mine.paused ? ' · En pausa: no se te empareja' : '' : ' · Retirado del torneo'}` : '';
  $('to-standings-title').textContent = registering ? 'Inscritos' : 'Clasificación';
  $('to-player-count').textContent = `${t.count}/${t.capacity}`;
  $('to-extra-col').innerHTML = arena(t) ? '<abbr title="Partidas jugadas">PJ</abbr>' : '<abbr title="Buchholz: suma de puntos de los rivales">BH</abbr>';
  const tag = p => (p.registered ? ' <span class="to-registered" title="Cuenta registrada">✓</span>' : '') + (!p.active ? ' <small>retirado</small>' : arena(t) && t.status === 'playing' ? p.playing ? ' <small>jugando</small>' : p.paused ? ' <small>en pausa</small>' : '' : '');
  $('to-standings').innerHTML = t.standings.map((p, i) => `<tr class="${p.id === t.me ? 'me ' : ''}${t.status === 'finished' && i === 0 ? 'winner' : ''}"><td>${i + 1}</td><td>${esc(p.name)}${p.rating ? ` <small class="to-elo" title="Elo">${p.rating}</small>` : ''}${p.id === t.me ? ' <small>(tú)</small>' : ''}${tag(p)}${sheet(p)}${registering && t.host ? `<button class="to-remove" type="button" data-remove="${p.id}" aria-label="Retirar a ${esc(p.name)}">×</button>` : ''}</td><td><strong>${formatPoints(p.points)}</strong></td><td>${arena(t) ? p.played : formatPoints(p.buchholz)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aún no hay inscritos.</td></tr>';
  $('to-tiebreak').hidden = registering;
  $('to-tiebreak').textContent = arena(t) ? 'Desempates: victorias, menos partidas jugadas y número de sorteo.' : 'Desempates: Buchholz, Sonneborn-Berger, victorias y número de sorteo.';
  const rounds = arena(t) ? [] : [...new Set(t.games.map(g => g.round))];
  $('to-round').innerHTML = rounds.map(r => `<option value="${r}">Ronda ${r}</option>`).join('');
  $('to-round').hidden = !rounds.length;
  if (rounds.includes(viewedRound)) $('to-round').value = viewedRound;
  // Como la página de partida de Lichess: mientras juegas, solo el tablero y lo de tu partida.
  // Cuenta tu partida en marcha aunque estés mirando otro tablero.
  // Al terminar tu partida no cambia la pantalla: sigues viendo tu tablero con el resultado
  // hasta que te emparejan otra vez y la nueva partida aparece sola, como en Lichess.
  const ownActive = !!t.me && t.games.some(x => !x.result && !x.bye && (x.white === t.me || x.black === t.me));
  const ownView = !!t.game && (t.game.white === t.me || t.game.black === t.me);
  const focus = ownActive || (!!mine?.active && ownView && ['playing', 'between'].includes(t.status));
  document.body.classList.toggle('to-focus', focus);
  $('to-focus-next').hidden = !focus || ownActive;
  $('to-focus-pause').hidden = !arena(t) || ownActive;
  $('to-focus-pause').textContent = mine?.paused ? 'Volver a jugar' : 'Pausa';
  $('to-focus-pause').disabled = !connected;
  // Con el torneo en juego no se muestra «Compartir torneo».
  $('to-share').hidden = !!t.challenge || ['playing', 'between'].includes(t.status);
  // Los invitados que entran con el enlace no ven la lista de torneos: solo el organizador.
  $('to-back').hidden = !t.host;
  $('to-focus-title').textContent = t.title;
  $('to-focus-format').textContent = `${t.minutes} + ${t.increment} · ${formatLabel(t)}`;
  renderPodium(); renderMatches(); renderGame(); renderControls(); renderBoards(); updateClocks();
}
// Sala de espera (estilo Lichess): inscritos a la izquierda; en el centro la cuenta atrás,
// el botón de unirse y la organización. Se mueven los bloques existentes, sin duplicarlos,
// y vuelven a su sitio cuando empieza el torneo.
const waitBlocks = () => [[$('to-standings-title').closest('section'), 'to-wait-side'], ...['to-registration', 'to-membership', 'to-host'].map(id => [$(id), 'to-wait-main'])];
const waitHomes = new Map();
function placeWaiting(waiting) {
  $('to-wait').hidden = !waiting; $('to-room').classList.toggle('to-waiting', waiting);
  for (const [el, target] of waitBlocks()) {
    if (waiting && el.parentElement.id !== target) {
      if (!waitHomes.has(el)) { const mark = document.createComment('sitio'); el.before(mark); waitHomes.set(el, mark); }
      $(target).append(el);
    } else if (!waiting && waitHomes.has(el)) waitHomes.get(el).after(el);
  }
}
function canJoin(t) { return !t.challenge && (t.status === 'waiting' || (arena(t) && t.status === 'playing' && Date.now() + offset < t.endsAt)); }
// Hoja de resultados, como en Lichess: una cifra por partida; resaltadas las ganadas con Berserk.
function sheet(p) {
  if (!p.sheet?.length) return '';
  const label = r => (r.bye ? 'Descanso' : r.s === 1 ? 'Victoria' : r.s === 0 ? 'Derrota' : 'Tablas') + (r.berserk ? ' con Berserk' : '') + (r.bonus ? ' (+½)' : '');
  return `<span class="to-sheet">${p.sheet.map(r => `<i class="${r.s === 1 ? 'w' : r.s === 0 ? 'l' : 'd'}${r.bonus ? ' b' : ''}" title="${label(r)}">${r.s === .5 ? '½' : r.s}</i>`).join('')}</span>`;
}
// Reto: en lugar de clasificación y podio, el marcador acumulado entre los dos jugadores (todas sus partidas).
function renderDuel(t) {
  $('to-duel').hidden = !t.challenge; $('to-standings-panel').hidden = !!t.challenge;
  if (!t.challenge || !t.duel) return;
  // Tú a la izquierda si juegas; si miras como espectador, por orden de la sala.
  const players = [...t.standings].sort((a, b) => (b.id === t.me) - (a.id === t.me));
  const [p, q] = players, wp = t.duel.wins[p?.id] || 0, wq = t.duel.wins[q?.id] || 0, d = t.duel.draws || 0, n = wp + wq + d;
  const pts = x => String(x).replace('.5', '½').replace(/^0½$/, '½');
  $('to-duel-body').innerHTML = !p || !q ? '' : `<div class="to-duel-score"><div class="${p.id === t.me ? 'me' : ''}"><strong>${esc(p.name)}</strong><b>${pts(wp + d / 2)}</b></div><span aria-hidden="true">–</span><div class="${q.id === t.me ? 'me' : ''}"><strong>${esc(q.name)}</strong><b>${pts(wq + d / 2)}</b></div></div>
    <p class="muted to-duel-detail">${n ? `${n} ${n === 1 ? 'partida' : 'partidas'} · ${wp} ${wp === 1 ? 'victoria' : 'victorias'} de ${esc(p.name)} · ${wq} de ${esc(q.name)} · ${d} tablas` : 'Es vuestra primera partida. El marcador se guarda para las próximas.'}</p>`;
}
function renderPodium() {
  const t = state, show = !t.challenge && t.status === 'finished' && t.standings.length >= 2;
  $('to-podium').hidden = !show;
  if (!show) return;
  const top = t.standings.slice(0, 3), order = [1, 0, 2].filter(i => top[i]);
  $('to-podium').innerHTML = order.map(i => { const p = top[i]; return `<div class="to-step p${i + 1}${p.id === t.me ? ' me' : ''}"><span class="to-medal">${i + 1}</span><strong>${esc(p.name)}</strong><span>${formatPoints(p.points) || '0'} ${p.points === 1 ? 'punto' : 'puntos'}</span><small>${p.played} ${p.played === 1 ? 'partida' : 'partidas'} · ${p.wins} ${p.wins === 1 ? 'victoria' : 'victorias'}</small><div class="to-plinth"></div></div>`; }).join('');
}
let editingName = false;
function renderJoin() {
  // Con la sesión abierta se juega con el nick de la cuenta; sin ella, con un alias como siempre.
  const user = currentUser(), remembered = read('apejupoTorneoNombre'), quick = !!user || (remembered.length >= 2 && !editingName);
  $('to-name-row').hidden = quick; $('to-name').required = !quick;
  if (quick) $('to-name').value = user ? user.nick : remembered;
  $('to-join-label').textContent = quick ? `Unirse como ${user ? user.nick : remembered}` : 'Unirse';
  $('to-change-name').hidden = !quick || !!user;
  $('to-join-account').hidden = !!user;
  $('to-joinkey-row').hidden = !state.locked; $('to-joinkey').required = !!state.locked;
  $('to-join-hint').textContent = state.locked ? 'Este torneo tiene clave: pídesela al organizador.' : user ? (user.verified ? 'Te inscribes con tu cuenta: podrás seguir desde cualquier dispositivo.' : 'Confirma tu correo (abre el enlace que te enviamos) para jugar con tu cuenta.') : 'Un clic y entras. Tu nombre se recuerda en este navegador.';
  $('to-join-title').textContent = arena(state) && state.status === 'playing' ? '¡El arena está en marcha!' : 'Juega este torneo';
}
function liveGames() { return (state?.games || []).filter(g => !g.result && !g.bye && g.fen); }
function renderBoards() {
  const live = liveGames();
  $('to-boards-open').hidden = !live.length || !!state.challenge;
  $('to-boards-label').textContent = `Ver tableros (${live.length})`;
  if (!boardsMode) return;
  document.title = `Tableros · ${state.title}`;
  const inPlay = `${live.length === 1 ? '1 partida' : `${live.length} partidas`} en juego`;
  const doneHere = arena(state) ? 0 : state.games.filter(g => g.round === state.round && !g.bye && g.result).length;
  $('to-boards-sub').textContent = arena(state) ? `${state.title} · ${inPlay}`
    : `${state.title} · Ronda ${state.round} de ${state.rounds} · ${state.status === 'finished' ? 'torneo terminado' : `${inPlay}${doneHere ? `, ${doneHere} terminada${doneHere === 1 ? '' : 's'}` : ''}`}`;
  // Arena: solo las partidas en juego. Suizo y cerrado: toda la ronda en curso; las terminadas se quedan
  // con su resultado hasta que empieza la ronda siguiente, que las sustituye.
  const shown = arena(state) ? live : state.games.filter(g => g.round === state.round && !g.bye && g.fen);
  if (!shown.some(g => g.id === zoomed)) zoomed = null;
  const grid = $('to-boards-grid');
  grid.classList.toggle('has-zoom', !!zoomed);
  // Cada tablero se crea una vez y en cada jugada solo cambian sus casillas: así no tiembla nada.
  for (const [id, c] of boardCards) if (!shown.some(g => g.id === id)) { c.el.remove(); boardCards.delete(id); }
  grid.querySelector('.to-boards-empty')?.remove();
  // Se reordena solo si cambia el orden (al empezar o terminar una partida); mover un tablero no lo repinta.
  const order = shown.map(g => g.id);
  if (order.join() !== boardOrder) {
    boardOrder = order.join();
    for (const g of shown) {
      let c = boardCards.get(g.id);
      if (!c) { c = boardCard(g); boardCards.set(g.id, c); }
      grid.append(c.el);
    }
  }
  for (const g of shown) {
    const c = boardCards.get(g.id);
    updateCard(c, g);
    c.el.classList.toggle('zoom', g.id === zoomed); c.el.setAttribute('aria-pressed', String(g.id === zoomed));
  }
  if (!shown.length) grid.insertAdjacentHTML('beforeend', `<p class="muted to-boards-empty">${['finished', 'cancelled'].includes(state.status) ? 'El torneo ha terminado.' : 'No hay partidas en juego ahora mismo. Los tableros aparecerán aquí en cuanto empiecen.'}</p>`);
  updateMiniClocks();
}
const boardCards = new Map();
let boardOrder = '';
function boardCard(g) {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'to-live big'; el.dataset.watch = g.id;
  const cells = Array.from({ length: 64 }, (_, i) => `<i class="${(Math.floor(i / 8) + i % 8) % 2 ? 'dk' : ''}"></i>`).join('');
  el.innerHTML = `<span class="to-live-name"><span class="to-nb"></span><strong data-clock="${g.id}:b"></strong></span>`
    + `<span class="to-live-board"><span class="to-evalbar" title="Evaluación de Stockfish"><span class="to-evalw"></span></span><span class="to-mini" aria-hidden="true">${cells}</span></span>`
    + `<span class="to-live-name"><span class="to-nw"></span><strong data-clock="${g.id}:w"></strong></span>`;
  return { el, cells: [...el.querySelectorAll('.to-mini i')], pieces: {}, fen: null, last: '', names: '' };
}
function updateCard(c, g) {
  const nb = (g.berserkB ? '<b class="to-bz">⚡</b>' : '') + esc(name(g.black)), nw = (g.berserkW ? '<b class="to-bz">⚡</b>' : '') + esc(name(g.white));
  if (c.names !== nb + '|' + nw) {
    c.names = nb + '|' + nw; c.el.querySelector('.to-nb').innerHTML = nb; c.el.querySelector('.to-nw').innerHTML = nw;
    c.el.setAttribute('aria-label', `Ver ${name(g.white)} contra ${name(g.black)}`);
  }
  if (c.fen !== g.fen) {
    const pieces = fenPieces(g.fen);
    c.cells.forEach((cell, i) => {
      const sq = 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8)), want = pieces[sq] || '';
      if ((c.pieces[sq] || '') !== want) { cell.innerHTML = want ? `<img src="assets/pieces/${want}.png" alt="">` : ''; c.pieces[sq] = want; }
    });
    c.fen = g.fen; queueEval(g.id, g.fen);
  }
  // Partida terminada: el resultado encima del tablero.
  const result = g.result ? g.result.replace('1/2-1/2', '½–½') : '';
  if ((c.el.dataset.result || '') !== result) {
    if (result) { c.el.dataset.result = result; c.el.classList.add('done'); c.el.title = g.reason || ''; }
    else { delete c.el.dataset.result; c.el.classList.remove('done'); c.el.removeAttribute('title'); }
  }
  const last = g.lastMove ? g.lastMove.from + g.lastMove.to : '';
  if (c.last !== last) {
    c.cells.forEach((cell, i) => { const sq = 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8)); cell.classList.toggle('lm', !!g.lastMove && (sq === g.lastMove.from || sq === g.lastMove.to)); });
    c.last = last;
  }
}
// Barra de evaluación: un solo Stockfish (el de Torneos Live) repasa los tableros por turnos, poco rato cada uno.
let sf = null, sfJob = null;
const sfQueue = new Map();
function queueEval(id, fen) { if (!boardsMode) return; sfQueue.set(id, fen); nextEval(); }
function nextEval() {
  if (sfJob || !sfQueue.size) return;
  if (sf === null) {
    sf = false;
    try {
      sf = new Worker('assets/stockfish/stockfish-19-lite-single.js');
      sf.onerror = () => { sf = false; document.body.classList.add('to-no-eval'); };
      sf.onmessage = e => {
        const line = String(e.data);
        if (!sfJob) return;
        const m = /score (cp|mate) (-?\d+)/.exec(line);
        if (line.startsWith('info') && m && !/bound/.test(line)) sfJob.score = { mate: m[1] === 'mate', v: Number(m[2]) };
        if (line.startsWith('bestmove')) { showEval(sfJob); sfJob = null; nextEval(); }
      };
      sf.postMessage('uci');
    } catch { sf = false; }
  }
  if (!sf) return;
  const [id, fen] = sfQueue.entries().next().value; sfQueue.delete(id);
  sfJob = { id, fen, score: null };
  sf.postMessage('position fen ' + fen); sf.postMessage('go movetime 300');
}
function showEval(job) {
  const c = boardCards.get(job.id); if (!c || c.fen !== job.fen || !job.score) return;
  const black = job.fen.split(' ')[1] === 'b', r = job.score;
  // Stockfish puntúa para el bando que mueve: se pasa a puntos de vista de las blancas.
  let v = black ? -r.v : r.v;
  if (r.mate && r.v === 0) v = black ? 1 : -1; // mate ya dado: gana quien no mueve
  const pct = r.mate ? (v > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.004 * v)) - 1);
  c.el.querySelector('.to-evalw').style.height = Math.max(3, Math.min(97, pct)) + '%';
  c.el.querySelector('.to-evalbar').title = 'Stockfish: ' + (r.mate ? (v > 0 ? '#' : '#-') + Math.abs(r.v) : (v > 0 ? '+' : '') + (v / 100).toFixed(1));
}
function updateMiniClocks() {
  if (!boardsMode) return;
  const now = Date.now() + offset;
  for (const el of $('to-boards-grid').querySelectorAll('[data-clock]')) {
    const [id, color] = el.dataset.clock.split(':'), g = state.games.find(x => x.id === id);
    if (!g || g.result) continue;
    const running = g.turn === color, ms = (color === 'w' ? g.whiteMs : g.blackMs) - (running ? Math.max(0, now - g.lastAt) : 0);
    el.textContent = clock(ms); el.classList.toggle('running', running);
  }
}
function miniBoard(g) {
  const pieces = fenPieces(g.fen), cells = [];
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8), col = i % 8, sq = 'abcdefgh'[col] + (8 - row), piece = pieces[sq];
    const last = g.lastMove && (sq === g.lastMove.from || sq === g.lastMove.to);
    cells.push(`<i class="${(row + col) % 2 ? 'dk' : ''}${last ? ' lm' : ''}">${piece ? `<img src="assets/pieces/${piece}.png" alt="">` : ''}</i>`);
  }
  return `<span class="to-mini" aria-hidden="true">${cells.join('')}</span>`;
}
let audio = null;
// Aviso de partida nueva: sonido corto y el tablero a la vista, como en Lichess.
function newGameAlert() {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), v = audio.createGain();
    o.frequency.value = 660; v.gain.setValueAtTime(.12, audio.currentTime); v.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .35);
    o.connect(v).connect(audio.destination); o.start(); o.stop(audio.currentTime + .35);
  } catch {}
  requestAnimationFrame(() => {
    $('to-game-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('to-game-panel').classList.remove('to-flash'); void $('to-game-panel').offsetWidth; $('to-game-panel').classList.add('to-flash');
  });
  if (document.hidden) { const title = document.title; document.title = '♟ ¡Tu partida empieza!'; addEventListener('visibilitychange', () => { document.title = title; }, { once: true }); }
}
function formatPoints(n) { return Number.isInteger(n) ? String(n) : n % 1 === .5 ? (Math.floor(n) || '') + '½' : String(n); }
function renderMatches() {
  // Arena: primero las partidas en juego y luego las terminadas, de la más reciente a la más antigua.
  const list = arena(state) ? [...state.games].reverse().sort((a, b) => !!a.result - !!b.result) : state.games.filter(g => g.round === viewedRound);
  $('to-matches').innerHTML = list.map(g => g.bye
    ? `<div class="to-match bye"><span>${esc(name(g.white))}</span><strong>Descanso · +1</strong></div>`
    : !g.result && g.fen
      ? `<button type="button" data-watch="${g.id}" class="to-live ${g.id === state.game?.id ? 'selected' : ''} ${g.white === state.me || g.black === state.me ? 'mine' : ''}" aria-label="Ver ${esc(name(g.white))} contra ${esc(name(g.black))}, en juego"><span class="to-live-name">${g.berserkB ? '<b class="to-bz" title="Berserk">⚡</b>' : ''}${esc(name(g.black))}</span>${miniBoard(g)}<span class="to-live-name">${g.berserkW ? '<b class="to-bz" title="Berserk">⚡</b>' : ''}${esc(name(g.white))}</span></button>`
      : `<button type="button" data-watch="${g.id}" class="to-match ${g.id === state.game?.id ? 'selected' : ''} ${g.white === state.me || g.black === state.me ? 'mine' : ''}"><span>♔ ${esc(name(g.white))}${g.berserkW ? ' ⚡' : ''}</span><strong>${g.result ? esc(g.result.replace('1/2-1/2', '½–½')) : 'en juego'}</strong><span>${g.berserkB ? '⚡ ' : ''}${esc(name(g.black))} ♚</span></button>`).join('') || '<p class="muted">Los tableros aparecerán al comenzar la primera ronda.</p>';
  $('to-matches').classList.toggle('has-live', list.some(g => !g.result && g.fen));
}
function renderControls() {
  if (!state) return;
  const t = state, mine = t.standings.find(p => p.id === t.me), ended = ['finished', 'cancelled'].includes(t.status);
  $('to-host').hidden = !t.host || ended;
  $('to-host-edit').hidden = t.status !== 'waiting';
  $('to-start').hidden = t.status !== 'waiting'; $('to-start').disabled = !connected || t.count < 2;
  $('to-cancel').disabled = !connected;
  $('to-host-key').innerHTML = t.joinKey ? `<svg class="to-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Clave: <strong>${esc(t.joinKey)}</strong>` : 'Sin clave: cualquiera con el enlace puede inscribirse';
  $('to-key-edit').textContent = t.joinKey ? 'Cambiar clave' : 'Poner clave'; $('to-key-edit').disabled = !connected;
  $('to-pause').hidden = !arena(t) || !mine?.active || ended;
  $('to-pause').textContent = mine?.paused ? 'Volver a jugar' : 'Pausa'; $('to-pause').disabled = !connected;
  $('to-withdraw').hidden = !mine?.active || ended; $('to-withdraw').textContent = t.status === 'waiting' ? 'Cancelar inscripción' : 'Retirarme del torneo';
  $('to-withdraw').disabled = !connected;
  $('to-join-form').querySelector('button').disabled = !connected;
  const g = t.game, ownGame = g && (g.white === t.me || g.black === t.me);
  $('to-game-actions').hidden = !g || !ownGame || !!g.result;
  $('to-offer').disabled = !connected || g?.offer === t.me || pending;
  $('to-offer-label').textContent = g?.offer === t.me ? 'Tablas ofrecidas' : 'Ofrecer tablas';
  $('to-resign').disabled = !connected || pending;
  const color = g && (g.white === t.me ? 'w' : g.black === t.me ? 'b' : null), berserked = color && (color === 'w' ? g.berserkW : g.berserkB);
  $('to-berserk').hidden = !arena(t) || !color || !!g.result || !!berserked || g.moves.length >= (color === 'w' ? 1 : 2);
  $('to-berserk').disabled = !connected || pending;
  $('to-draw-offer').hidden = !g || !!g.result || !ownGame || !g.offer || g.offer === t.me;
  $('to-accept').disabled = !connected; $('to-decline').disabled = !connected;
  $('to-all-pgn').hidden = !ended || !t.games.some(g => !g.bye);
  // Reto terminado: cualquiera de los dos puede pedir la revancha (mismo ritmo, colores cambiados).
  $('to-rematch-box').hidden = !t.challenge || !g || !ownGame || !g.result;
  if ($('to-rematch-box').hidden) { rematch = null; $('to-rematch-msg').textContent = ''; }
  $('to-rematch').textContent = rematch ? 'Cancelar revancha' : 'Revancha';
}
// Revancha: se manda como un reto normal al rival, que tiene esta misma página abierta.
let rematch = null;
function rematchNote(text) { $('to-rematch-msg').textContent = text; }
$('to-rematch').addEventListener('click', () => {
  const g = state?.game; if (!g) return;
  if (rematch) { sendReto({ type: 'cancelar', id: rematch.id }); rematch = null; rematchNote('Revancha cancelada.'); renderControls(); return; }
  const mine = g.white === state.me ? 'w' : 'b', rival = name(mine === 'w' ? g.black : g.white);
  if (!sendReto({ type: 'retar', nick: rival, minutes: state.minutes, increment: state.increment, color: mine === 'w' ? 'b' : 'w', revancha: true })) { rematchNote('Sin conexión con el servidor. Espera un momento y vuelve a probar.'); return; }
  $('to-rematch').disabled = true; rematchNote('Enviando…');
});
addEventListener('apejupo:retos', ({ detail: m }) => {
  if (!state?.challenge) return;
  const box = $('to-rematch');
  if (m.type === 'enviado' && m.reto.revancha) { rematch = m.reto; box.disabled = false; rematchNote(`Esperando a que ${m.reto.to} acepte…`); }
  else if (['rechazado', 'caducado', 'cerrado'].includes(m.type) && rematch?.id === m.id) {
    rematch = null; rematchNote(m.type === 'rechazado' ? `${m.nick} ha rechazado la revancha.` : m.type === 'caducado' ? `${m.nick} no ha respondido.` : '');
  } else if (m.type === 'error' && !m.id && box.disabled) { box.disabled = false; rematchNote(m.message); }
  else return;
  renderControls();
});
function watch(id) { selected = null; replay = null; replayPly = null; boardKey = ''; manualFlip = false; send({ type: 'watch', game: id }); }
function myColor() { const g = state?.game; return !g ? null : g.white === state.me ? 'w' : g.black === state.me ? 'b' : null; }
function canMove() { return !!state?.game && connected && !pending && !state.game.result && myColor() === state.game.turn; }
function fenPieces(fen) {
  const out = {};
  fen.split(' ')[0].split('/').forEach((rank, row) => { let col = 0; for (const c of rank) { if (/\d/.test(c)) col += Number(c); else { out['abcdefgh'[col++] + (8 - row)] = (c === c.toUpperCase() ? 'w' : 'b') + c.toUpperCase(); } } });
  return out;
}
function paint(canvas, piece) {
  let image = images.get(piece);
  if (!image) { image = new Image(); image.src = 'assets/pieces/' + piece + '.png'; images.set(piece, image); }
  const draw = () => { if (canvas.isConnected && image.naturalWidth) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); } };
  if (image.complete) draw(); else image.addEventListener('load', draw, { once: true });
}
function renderWaiting() {
  const t = state, mine = t.standings.find(p => p.id === t.me);
  const show = !t.game && !!mine?.active && ['playing', 'between'].includes(t.status);
  $('to-waiting-pair').hidden = !show;
  if (!show) return;
  const bye = !arena(t) && t.games.some(g => g.bye && g.round === t.round && g.white === t.me);
  const [title, text] = arena(t)
    ? mine.paused ? ['Estás en pausa', 'No se te empareja. Pulsa «Volver a jugar» cuando quieras seguir.']
      : ['Buscando rival…', 'Ahora mismo no queda nadie libre: sois un número impar o los demás están jugando. Jugarás en cuanto termine una partida.']
    : bye ? ['Descansas esta ronda', closed(t) ? 'Con un número impar de jugadores, a cada uno le toca descansar una ronda. No suma punto.' : 'Te toca descanso y sumas un punto. Jugarás en la siguiente ronda.']
      : ['Esperando la siguiente ronda', 'Tu partida de esta ronda ha terminado.'];
  $('to-waiting-title').textContent = title; $('to-waiting-text').textContent = text;
  $('to-waiting-boards').hidden = !t.games.some(g => !g.result && !g.bye);
}
function renderGame() {
  const g = state?.game;
  renderWaiting();
  $('to-game-panel').hidden = !g;
  if (!g) return;
  const own = !!myColor();
  // En tu propia partida sobra la franja del título (el tablero ya está orientado hacia ti),
  // y con la partida terminada también: solo el tablero con el resultado.
  $('to-game-heading').hidden = own || !!g.result;
  $('to-board-title').textContent = arena(state) ? (own ? 'Tu partida' : 'Viendo partida') : `${own ? 'Tu partida' : 'Viendo partida'} · Ronda ${g.round}`;
  const top = flipped ? 'w' : 'b', bottom = flipped ? 'b' : 'w';
  $('to-player-top').dataset.color = top; $('to-player-bottom').dataset.color = bottom;
  const bz = color => (color === 'w' ? g.berserkW : g.berserkB) ? ' ⚡ Berserk' : '';
  $('to-player-top').querySelector('span').textContent = `${top === 'w' ? '♔' : '♚'} ${name(top === 'w' ? g.white : g.black)}${bz(top)}`;
  $('to-player-bottom').querySelector('span').textContent = `${bottom === 'w' ? '♔' : '♚'} ${name(bottom === 'w' ? g.white : g.black)}${bz(bottom)}`;
  const late = arena(state) && state.endsAt && (g.result ? state.games.find(x => x.id === g.id)?.late : Date.now() + offset >= state.endsAt);
  let status = late ? (g.result ? `${g.result.replace('1/2-1/2', '½–½')} · ${g.reason} · No cuenta: terminó después del tiempo` : 'Tiempo del torneo cumplido: esta partida ya no cuenta') : g.result ? `${g.result.replace('1/2-1/2', '½–½')} · ${g.reason}` : pending ? 'Turno de tu rival' : !connected ? 'Recuperando conexión. Tu reloj sigue corriendo.' : canMove() ? 'Tu turno' : own ? 'Turno de tu rival' : `Juegan ${g.turn === 'w' ? 'blancas' : 'negras'}`;
  // Con la partida terminada, el resultado se ve en grande sobre el tablero, como una marca de agua.
  if (g.result) $('to-board').dataset.result = g.result.replace('1/2-1/2', '½–½'); else delete $('to-board').dataset.result;
  $('to-game-status').textContent = status; $('to-game-status').classList.toggle('my-turn', canMove());
  // En tu partida no hace falta «Tu turno» / «Turno de tu rival»: lo indica el reloj en verde.
  // Con la partida terminada basta la marca de agua: fuera el texto del resultado y el repaso.
  $('to-game-status').hidden = g.result ? !late : own && connected && !late;
  $('to-replay').hidden = true;
  if (g.result && !replay) {
    const c = new Chess(); replay = [c.fen()];
    for (const san of g.moves) { c.move(san); replay.push(c.fen()); }
    replayPly = g.moves.length;
  }
  if (g.result) {
    $('to-replay-range').max = g.moves.length; $('to-replay-range').value = replayPly;
    $('to-replay-number').textContent = `${replayPly}/${g.moves.length}`;
    $('to-replay-prev').disabled = replayPly === 0; $('to-replay-next').disabled = replayPly === g.moves.length;
  }
  renderBoard();
}
function renderBoard() {
  const g = state?.game; if (!g) return;
  const shown = optimistic?.game === g.id ? optimistic : null;
  const fen = g.result && replay ? replay[replayPly] : shown ? shown.fen : g.fen;
  const lastMove = shown ? shown.lastMove : g.lastMove;
  const key = [g.id, fen, flipped, selected, canMove(), lastMove?.from, lastMove?.to].join('|');
  if (boardKey === key) return; boardKey = key;
  // Deslizar la pieza que se acaba de mover, en lugar de que salte de casilla.
  const slideMove = !skipSlide && rendered.game === g.id && rendered.fen && rendered.fen !== fen && lastMove ? lastMove : null;
  const prevFen = rendered.fen; rendered = { game: g.id, fen }; skipSlide = false;
  const activeSquare = document.activeElement?.closest('#to-board [data-square]')?.dataset.square;
  const pieces = fenPieces(fen), order = Array.from({ length: 64 }, (_, i) => flipped ? 63 - i : i);
  const targets = selected ? g.legal.filter(m => m.from === selected).map(m => m.to) : [];
  const last = !g.result || replayPly === g.moves.length ? lastMove : null;
  $('to-board').innerHTML = order.map((index, i) => {
    const row = Math.floor(index / 8), col = index % 8, sq = 'abcdefgh'[col] + (8 - row), piece = pieces[sq];
    const desc = piece ? `${pieceNames[piece[1].toLowerCase()]} de ${piece[0] === 'w' ? 'blancas' : 'negras'}` : 'vacía';
    return `<button type="button" class="to-square ${(row + col) % 2 ? 'dark ' : ''}${sq === selected ? 'selected ' : ''}${targets.includes(sq) ? 'target ' : ''}${last && (sq === last.from || sq === last.to) ? 'last' : ''}" data-square="${sq}" tabindex="${sq === (activeSquare || (flipped ? 'h8' : 'a1')) ? 0 : -1}" aria-label="${sq}: ${desc}${targets.includes(sq) ? ', destino posible' : ''}" aria-pressed="${sq === selected}">${piece ? `<canvas data-piece="${piece}" aria-hidden="true" width="80" height="80"></canvas>` : ''}${i % 8 === 0 ? `<span class="to-coordinate rank">${8 - row}</span>` : ''}${i >= 56 ? `<span class="to-coordinate file">${'abcdefgh'[col]}</span>` : ''}</button>`;
  }).join('');
  for (const canvas of $('to-board').querySelectorAll('canvas')) paint(canvas, canvas.dataset.piece);
  if (activeSquare) $('to-board').querySelector(`[data-square="${activeSquare}"]`)?.focus({ preventScroll: true });
  $('to-board').classList.toggle('can-move', canMove());
  if (drag) $('to-board').querySelector(`[data-square="${drag.from}"] canvas`)?.classList.add('to-dragging');
  if (slideMove && !g.result) {
    const before = fenPieces(prevFen);
    // Solo si la pieza estaba en la casilla de origen: evita animar al cambiar de partida o revisar.
    if (before[slideMove.from]) {
      slide(slideMove.from, slideMove.to);
      const piece = before[slideMove.from];
      if (piece[1] === 'K' && Math.abs(slideMove.from.charCodeAt(0) - slideMove.to.charCodeAt(0)) === 2) {
        const rank = slideMove.from[1], short = slideMove.to[0] === 'g';
        slide((short ? 'h' : 'a') + rank, (short ? 'f' : 'd') + rank);
      }
    }
  }
}
function squareXY(sq) {
  let x = sq.charCodeAt(0) - 97, y = 8 - Number(sq[1]);
  if (flipped) { x = 7 - x; y = 7 - y; }
  return { x, y };
}
function slide(from, to) {
  const canvas = $('to-board').querySelector(`[data-square="${to}"] canvas`); if (!canvas) return;
  const a = squareXY(from), b = squareXY(to), size = $('to-board').clientWidth / 8, cell = canvas.parentElement;
  cell.style.zIndex = 3;
  canvas.style.transition = 'none';
  canvas.style.transform = `translate(${(a.x - b.x) * size}px, ${(a.y - b.y) * size}px)`;
  canvas.getBoundingClientRect();
  canvas.style.transition = 'transform 180ms cubic-bezier(.25,.8,.35,1)';
  canvas.style.transform = '';
  canvas.addEventListener('transitionend', () => { cell.style.zIndex = ''; }, { once: true });
}
function squareClick(square) {
  if (!canMove()) return;
  const g = state.game;
  if (selected === square) { selected = null; renderBoard(); return; }
  const candidates = g.legal.filter(m => m.from === selected && m.to === square);
  if (candidates.length) {
    const from = selected;
    if (candidates.some(m => m.promotion)) {
      promotion = { from, to: square, game: g.id, ply: g.moves.length };
      $('to-promotion-options').innerHTML = ['q', 'r', 'b', 'n'].map(p => `<button type="button" data-promote="${p}" aria-label="${pieceNames[p]}"><img src="assets/pieces/${myColor()}${p.toUpperCase()}.png" alt=""></button>`).join('');
      $('to-promotion-dialog').showModal(); return;
    }
    move(from, square); return;
  }
  selected = g.legal.some(m => m.from === square) ? square : null;
  renderBoard();
}
function move(from, to, promotion = 'q') {
  const g = state.game;
  if (!send({ type: 'move', game: g.id, from, to, promotion, ply: g.moves.length })) return;
  // Se dibuja la jugada ya; si el servidor la rechaza, vuelve la posición confirmada.
  try { const c = new Chess(g.fen); c.move({ from, to, promotion }); optimistic = { game: g.id, ply: g.moves.length + 1, fen: c.fen(), lastMove: { from, to } }; } catch { optimistic = null; }
  pending = true; selected = null; boardKey = ''; renderGame(); renderControls();
}
function clock(ms) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function updateClocks() {
  if (!state) return;
  const now = Date.now() + offset, t = state;
  const me = t.standings.find(p => p.id === t.me);
  // En la sala de espera la cuenta atrás grande ya dice cuándo empieza.
  $('to-phase').textContent = t.status === 'waiting' || t.challenge ? ''
    : arena(t) && t.status === 'playing' ? (now >= t.endsAt ? 'Tiempo cumplido: las partidas en juego se terminan, pero ya no cuentan' : t.pairingsCloseAt && now >= t.pairingsCloseAt ? (me?.active && !me.playing ? 'Ya no hay emparejamientos nuevos' : '') : me?.active && !me.playing && !me.paused ? 'Buscando rival…' : '')
    : t.status === 'between' ? `Siguiente ronda en ${Math.max(0, Math.ceil((t.nextRoundAt - now) / 1000))} s` : t.status === 'playing' ? `Ronda ${t.round} de ${t.rounds}` : t.status === 'finished' ? 'Clasificación final' : 'Torneo cancelado';
  // Cuenta atrás grande del arena, como en Lichess.
  const counting = arena(t) && t.status === 'playing' && now < t.endsAt;
  $('to-countdown').hidden = !counting;
  if (counting) {
    const left = t.endsAt - now, s = Math.ceil(left / 1000);
    $('to-countdown').querySelector('strong').textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : clock(left);
    $('to-countdown').classList.toggle('urgent', left < 60000);
    $('to-focus-clock').textContent = $('to-countdown').querySelector('strong').textContent;
  }
  $('to-focus-info').querySelector('.to-focus-clock').hidden = !counting;
  if (t.status === 'waiting') {
    const left = t.startsAt ? Math.max(0, t.startsAt - now) : null, s = left === null ? 0 : Math.ceil(left / 1000);
    const d = Math.floor(s / 86400), hms = `${String(Math.floor(s % 86400 / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('to-wait-label').textContent = t.startsAt ? 'El torneo empieza en' : 'El torneo empezará';
    $('to-wait-clock').textContent = t.startsAt ? (d ? `${d} d ${hms}` : hms) : 'cuando lo decida el organizador';
    $('to-wait-clock').classList.toggle('to-wait-manual', !t.startsAt);
    $('to-wait-date').textContent = t.startsAt ? date(t.startsAt) : `${t.count} de ${t.capacity} plazas ocupadas`;
  }
  if (!$('to-registration').hidden && !canJoin(t)) render();
  if (!$('to-focus-next').hidden) $('to-focus-status').textContent = me?.paused ? 'En pausa: no se te empareja' : $('to-phase').textContent || 'Partida terminada';
  const g = t.game; if (!g) return;
  for (const id of ['to-player-top', 'to-player-bottom']) {
    const el = $(id), color = el.dataset.color, running = !g.result && g.turn === color;
    const remaining = (color === 'w' ? g.whiteMs : g.blackMs) - (running ? Math.max(0, now - g.lastAt) : 0);
    el.querySelector('strong').textContent = clock(remaining);
    el.classList.toggle('running', running); el.classList.toggle('urgent', running && remaining < 20000);
  }
}
// Todas las ventanas de confirmación usan «Aceptar» y «Cancelar».
function confirmAction(title, text, danger = false) {
  const label = 'Aceptar', cancel = 'Cancelar';
  // Icono y color según la acción: rojo si se pierde algo; azul si es un paso normal.
  $('to-confirm-icon').className = 'to-dialog-icon ' + (danger ? 'danger' : 'info');
  $('to-confirm-icon').innerHTML = danger
    ? '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></svg>'
    : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
  $('to-confirm-dialog').dataset.tone = danger ? 'danger' : 'info';
  $('to-confirm-title').textContent = title; $('to-confirm-text').textContent = text; $('to-confirm-text').hidden = !text;
  $('to-confirm-yes').textContent = label; $('to-confirm-no').textContent = cancel;
  $('to-confirm-yes').classList.toggle('danger', danger);
  // El botón activo al abrir es siempre «Cancelar», el más seguro: con Intro no se acepta sin querer.
  $('to-confirm-dialog').showModal(); $('to-confirm-no').focus();
  return new Promise(resolve => { confirmResolve = resolve; });
}
function closeConfirm(answer) { $('to-confirm-dialog').close(); confirmResolve?.(answer); confirmResolve = null; }
async function download(game) {
  try {
    const res = await request(`/api/tournaments/${roomId}/pgn${game ? '?game=' + game : ''}`);
    const url = URL.createObjectURL(await res.blob()), a = document.createElement('a'); a.href = url; a.download = `apejupo-${roomId}${game ? '-' + game : ''}.pgn`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { message(e.message, true); }
}

// Fecha y hora por separado: el calendario solo elige el día; la hora va en su propia lista, cada 15 minutos.
$('to-start-time').insertAdjacentHTML('beforeend', Array.from({ length: 96 }, (_, i) => {
  const hh = String(Math.floor(i / 4)).padStart(2, '0'), mm = String(i % 4 * 15).padStart(2, '0');
  return `<option value="${hh}:${mm}">${hh}:${mm}</option>`;
}).join(''));
function localDay(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const formatHelp = {
  arena: 'Tiempo máximo de juego',
  swiss: 'Número fijo de rondas, con rivales de puntuación parecida y sin repetir enfrentamientos.',
  closed: 'Todos contra todos, una vez cada uno. Las rondas salen del número de inscritos.'
};
function syncFormat() {
  const format = $('to-format').value, isArena = format === 'arena', noRounds = format !== 'swiss';
  $('to-format-help').textContent = formatHelp[format];
  $('to-rounds-field').hidden = noRounds; $('to-rounds').disabled = noRounds;
  $('to-duration-field').hidden = !isArena; $('to-duration').disabled = !isArena;
}
$('to-format').addEventListener('change', syncFormat);
$('to-refresh').addEventListener('click', loadLobby);
// El mismo formulario sirve para crear y para editar (editingId = torneo que se edita).
function setCreateMode(id) {
  editingId = id;
  $('to-create-heading').textContent = id ? 'Editar torneo' : 'Organizar un torneo';
  $('to-create-submit').textContent = id ? 'Guardar cambios' : 'Crear y abrir inscripciones';
  // Para editar basta con ser el organizador: no se pide la clave de organización.
  $('to-key-field').hidden = !!id || !keyFieldRequired; $('to-key').disabled = $('to-key').required = !id && keyFieldRequired;
  $('to-create-error').hidden = true; $('to-start-day').min = localDay(new Date());
}
$('to-create-open').addEventListener('click', () => {
  $('to-create-form').reset(); setCreateMode(null); syncFormat();
  $('to-create-dialog').showModal();
  // Al crear, la clave empieza en blanco aunque el navegador intente autorrellenarla.
  setTimeout(() => { if (!editingId) $('to-join-key-new').value = ''; }, 50);
});
async function openEdit(id) {
  const c = await (await request(`/api/tournaments/${id}/config`, { method: 'POST', body: JSON.stringify({ hostToken: read(hostKey(id)) }) })).json();
  const form = $('to-create-form'); form.reset(); setCreateMode(id);
  form.title.value = c.title; $('to-format').value = c.format; $('to-minutes').value = c.minutes; $('to-increment').value = c.increment;
  if (c.format === 'swiss') $('to-rounds').value = c.rounds;
  if (c.format === 'arena') $('to-duration').value = c.duration;
  // Se muestra la clave actual para poder cambiarla; si se borra, el torneo queda sin clave.
  $('to-capacity').value = c.capacity; $('to-join-key-new').value = c.joinKey || '';
  if (c.startsAt) {
    const d = new Date(c.startsAt), hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, list = $('to-start-time');
    // Si la hora guardada no está en la lista (cada 15 minutos), se añade para no perderla.
    if (![...list.options].some(o => o.value === hhmm)) list.add(new Option(hhmm, hhmm));
    $('to-start-day').value = localDay(d); list.value = hhmm;
  }
  syncFormat(); $('to-create-dialog').showModal();
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
$('to-create-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const data = new FormData(form), hostToken = token();
    if (!editingId) write('apejupoTorneoOrganizacionPendiente', hostToken);
    const day = data.get('startDay'), time = data.get('startTime');
    if (day && !time) throw new Error('Elige también la hora de inicio.');
    if (time && !day) throw new Error('Elige también el día de inicio.');
    const startsAt = day ? new Date(`${day}T${time}`).getTime() : null;
    const isArena = data.get('format') === 'arena';
    if (editingId) {
      const fields = { title: data.get('title'), format: data.get('format'), minutes: Number(data.get('minutes')), increment: Number(data.get('increment')), rounds: data.get('format') === 'swiss' ? Number(data.get('rounds')) : null, duration: isArena ? Number(data.get('duration')) : null, capacity: Number(data.get('capacity')), startsAt, joinKey: data.get('joinKey') || '' };
      await request(`/api/tournaments/${editingId}/edit`, { method: 'POST', body: JSON.stringify({ ...fields, hostToken: read(hostKey(editingId)) }) });
      $('to-create-dialog').close(); message('Cambios guardados.'); if (!roomId) await loadLobby(); return;
    }
    const res = await (await request('/api/tournaments', { method: 'POST', key: data.get('key'), body: JSON.stringify({ title: data.get('title'), format: data.get('format'), minutes: Number(data.get('minutes')), increment: Number(data.get('increment')), rounds: data.get('format') === 'swiss' ? Number(data.get('rounds')) : null, duration: isArena ? Number(data.get('duration')) : null, capacity: Number(data.get('capacity')), startsAt, joinKey: data.get('joinKey') || '', hostToken }) })).json();
    write(hostKey(res.id), hostToken); $('to-key').value = ''; location.href = 'jugar-torneo.html?id=' + res.id;
  } catch (e) { $('to-create-error').hidden = false; $('to-create-error').textContent = e.message; }
  finally { button.disabled = false; }
});
$('to-join-account').addEventListener('click', () => openAuth('entrar'));
addEventListener('apejupo:cuenta', () => { if (state) render(); });
$('to-join-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    const id = read(playerKey()) || token(), user = currentUser(); write(playerKey(), id);
    if (!user) write('apejupoTorneoNombre', $('to-name').value.trim());
    await request(`/api/tournaments/${roomId}/join`, { method: 'POST', key: user ? session() : '', body: JSON.stringify({ name: $('to-name').value, token: id, joinKey: $('to-joinkey').value }) });
    $('to-joinkey').value = '';
    editingName = false; hello();
    message(arena(state) && state.status === 'playing' ? '¡Dentro! Te emparejamos con el próximo jugador libre.' : 'Inscripción completada. Mantén esta página abierta para el inicio.');
  } catch (e) {
    message(e.message, true);
    // Si el nombre recordado ya está cogido, se muestra el campo para escribir otro.
    if (/nombre/.test(e.message)) { editingName = true; renderJoin(); $('to-name').focus(); }
    else if (/clave/.test(e.message)) { $('to-joinkey').select(); $('to-joinkey').focus(); }
  }
  finally { button.disabled = !connected; }
});
$('to-start').addEventListener('click', async () => {
  if (await confirmAction('Empezar torneo', arena(state) ? `Se cerrarán las inscripciones y empezará la cuenta atrás de ${duration(state.duration)}. Se emparejará a los jugadores que tengan la página abierta.` : `Se cerrarán las inscripciones y arrancarán los relojes de ${state.count} jugadores. Las rondas se ajustarán al número de inscritos.`, false)) { message(''); send({ type: 'start' }); }
});
$('to-cancel').addEventListener('click', async () => {
  if (await confirmAction('Cancelar torneo', 'El torneo se cerrará y las partidas en juego terminarán en tablas. Esta acción no se puede deshacer.', true)) send({ type: 'cancel' });
});
$('to-withdraw').addEventListener('click', async () => {
  if (await confirmAction(state.status === 'waiting' ? 'Cancelar inscripción' : 'Retirarte del torneo', state.status === 'waiting' ? 'Se liberará tu plaza. Podrás volver a inscribirte mientras haya sitio.' : arena(state) ? 'Perderás tu partida en curso y no se te emparejará más. Si solo quieres descansar, usa «Pausa».' : 'Perderás tu partida en curso y no participarás en las siguientes rondas.', true)) send({ type: 'withdraw' });
});
$('to-focus-pause').addEventListener('click', () => $('to-pause').click());
$('to-pause').addEventListener('click', () => {
  const mine = state.standings.find(p => p.id === state.me);
  if (send({ type: mine?.paused ? 'resume' : 'pause' })) message(mine?.paused ? 'Vuelves a estar disponible: se te emparejará con el próximo jugador libre.' : 'En pausa: no se te emparejará hasta que vuelvas. Si estás jugando, termina tu partida.');
});
$('to-standings').addEventListener('click', async event => {
  const id = event.target.closest('[data-remove]')?.dataset.remove;
  if (id && await confirmAction('Retirar inscripción', `¿Retirar a ${name(id)} de este torneo?`, true)) send({ type: 'remove', playerId: id });
});
// Los tableros se ven SIEMPRE en una página aparte: si ya está abierta, se trae al frente
// (y se cambia a la partida pedida); si no, se abre una nueva.
let boardsWindow = null;
function openBoards(gameId = null) {
  const url = new URL(location.href); url.search = new URLSearchParams({ id: roomId, vista: 'tableros', ...(gameId ? { partida: gameId } : {}) });
  if (boardsWindow && !boardsWindow.closed) {
    if (gameId) boardsWindow.location.href = url.href;
    boardsWindow.focus(); return;
  }
  boardsWindow = window.open(url, '_blank');
  // Nunca se cambia esta página: si el navegador bloquea la ventana, solo se avisa.
  if (!boardsWindow) message('Tu navegador ha bloqueado la página de tableros. Permite las ventanas emergentes de esta web y vuelve a pulsar.', true);
}
$('to-boards-open').addEventListener('click', () => openBoards());
$('to-boards-grid').addEventListener('click', event => {
  const id = event.target.closest('[data-watch]')?.dataset.watch; if (!id) return;
  zoomed = zoomed === id ? null : id; renderBoards();
  if (zoomed) requestAnimationFrame(() => $('to-boards-grid').querySelector('.zoom')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
});
// Un jugador inscrito no cambia su tablero por el de otros: la partida se abre en la página de tableros.
$('to-matches').addEventListener('click', event => {
  const id = event.target.closest('[data-watch]')?.dataset.watch; if (!id) return;
  if (state?.standings.some(p => p.id === state.me)) openBoards(id); else watch(id);
});
$('to-round').addEventListener('change', () => { viewedRound = Number($('to-round').value); renderMatches(); });
$('to-flip').addEventListener('click', () => { flipped = !flipped; manualFlip = true; boardKey = ''; renderGame(); updateClocks(); });
$('to-board').addEventListener('click', event => {
  const sq = event.target.closest('[data-square]')?.dataset.square;
  // El navegador lanza un clic al soltar la pieza: ese ya se ha procesado al soltar.
  if (dropped && performance.now() - dropped.at < 500 && (!sq || sq === dropped.square)) { dropped = null; return; }
  if (sq) squareClick(sq);
});
// Arrastre como en Lichess: al pulsar una pieza propia, se pega al puntero en ese instante
// (ratón, lápiz o dedo); en su casilla queda una sombra y se marcan los destinos posibles.
$('to-board').addEventListener('pointerdown', event => {
  if (event.button > 0 || !canMove()) return;
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (!square || !state.game.legal.some(m => m.from === square)) return;
  const canvas = $('to-board').querySelector(`[data-square="${square}"] canvas`);
  if (!canvas) return;
  event.preventDefault(); // sin selección de texto ni arrastre nativo del navegador
  const size = $('to-board').getBoundingClientRect().width / 8, ghost = document.createElement('img');
  ghost.src = 'assets/pieces/' + canvas.dataset.piece + '.png'; ghost.className = 'to-ghost'; ghost.alt = '';
  ghost.style.width = ghost.style.height = size + 'px';
  document.body.append(ghost); document.body.classList.add('to-grabbing');
  drag = { from: square, ghost, size, wasSelected: selected === square, x: event.clientX, y: event.clientY, moved: false };
  moveGhost(event);
  selected = square; boardKey = ''; renderBoard();
});
function moveGhost(event) {
  drag.ghost.style.transform = `translate(${event.clientX - drag.size / 2}px, ${event.clientY - drag.size / 2}px)`;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3) drag.moved = true;
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('#to-board [data-square]')?.dataset.square;
  for (const el of $('to-board').querySelectorAll('.hover')) el.classList.remove('hover');
  if (over && over !== drag.from) $('to-board').querySelector(`[data-square="${over}"]`)?.classList.add('hover');
}
document.addEventListener('pointermove', event => { if (drag) { event.preventDefault(); moveGhost(event); } }, { passive: false });
function endDrag(event) {
  if (!drag) return;
  const { from, ghost, wasSelected, moved } = drag; drag = null; ghost.remove();
  document.body.classList.remove('to-grabbing');
  const to = event && document.elementFromPoint(event.clientX, event.clientY)?.closest('#to-board [data-square]')?.dataset.square;
  dropped = { square: to, at: performance.now() };
  if (to && to !== from && state.game.legal.some(m => m.from === from && m.to === to)) { selected = from; skipSlide = true; squareClick(to); return; }
  // Soltar en la misma casilla sin mover: selecciona la pieza (o la deselecciona si ya lo estaba).
  selected = to === from && !(wasSelected && !moved) ? from : null;
  boardKey = ''; renderBoard();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', () => endDrag(null));
$('to-board').addEventListener('keydown', event => {
  const buttons = [...$('to-board').querySelectorAll('button')], index = buttons.indexOf(event.target), delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[event.key];
  if (delta !== undefined && index >= 0) { event.preventDefault(); const next = buttons[Math.max(0, Math.min(63, index + delta))]; buttons.forEach(b => b.tabIndex = -1); next.tabIndex = 0; next.focus(); }
});
$('to-promotion-options').addEventListener('click', event => {
  const piece = event.target.closest('[data-promote]')?.dataset.promote;
  if (!piece || !promotion) return;
  $('to-promotion-dialog').close();
  if (state.game.id === promotion.game && state.game.moves.length === promotion.ply && canMove()) move(promotion.from, promotion.to, piece);
  promotion = null;
});
$('to-change-name').addEventListener('click', () => { editingName = true; renderJoin(); $('to-name').select(); $('to-name').focus(); });
$('to-berserk').addEventListener('click', () => send({ type: 'berserk', game: state.game.id }));
$('to-offer').addEventListener('click', () => send({ type: 'offer-draw', game: state.game.id }));
$('to-accept').addEventListener('click', () => send({ type: 'accept-draw', game: state.game.id }));
$('to-decline').addEventListener('click', () => send({ type: 'decline-draw', game: state.game.id }));
$('to-resign').addEventListener('click', async () => {
  const id = state.game.id;
  if (await confirmAction('¿Quieres abandonar la partida?', '', true)) send({ type: 'resign', game: id });
});
$('to-confirm-no').addEventListener('click', () => closeConfirm(false));
$('to-confirm-yes').addEventListener('click', () => closeConfirm(true));
$('to-confirm-dialog').addEventListener('cancel', () => { confirmResolve?.(false); confirmResolve = null; });
$('to-share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.origin + location.pathname + '?id=' + roomId); message('Enlace del torneo copiado. Ya puedes compartirlo.'); }
  catch { message('Comparte la dirección de esta página para invitar a otros jugadores.'); }
});
$('to-pgn').addEventListener('click', () => download(state.game.id));
$('to-all-pgn').addEventListener('click', () => download());
function review(ply) { if (!replay) return; replayPly = Math.max(0, Math.min(replay.length - 1, ply)); boardKey = ''; renderGame(); }
$('to-replay-range').addEventListener('input', event => review(Number(event.target.value)));
$('to-replay-prev').addEventListener('click', () => review(replayPly - 1));
$('to-replay-next').addEventListener('click', () => review(replayPly + 1));
window.addEventListener('online', () => { if (roomId && !connected) { socket?.close(); connect(); } });
window.addEventListener('pagehide', () => { clearTimeout(reconnectTimer); clearInterval(heartbeat); if (socket) { socket.onclose = null; socket.close(); } });
window.addEventListener('pageshow', event => { if (event.persisted && roomId && API) connect(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && roomId && socket?.readyState === WebSocket.OPEN) hello(); });

$('to-name').value = read('apejupoTorneoNombre');
if (roomId) {
  $('to-lobby').hidden = true; $('to-room').hidden = boardsMode; $('to-boards-page').hidden = !boardsMode;
  document.body.classList.toggle('to-boards-mode', boardsMode);
  if (!/^[a-f0-9]{24}$/.test(roomId)) message('El enlace del torneo no es válido.', true);
  else if (!API) { message('Los torneos todavía no están disponibles.'); setConnection('No disponible'); }
  else { connect(); checkKeyMode(); }
} else loadLobby();
setInterval(() => { updateClocks(); updateMiniClocks(); }, 100);
// Los navegadores solo permiten sonido tras un gesto del usuario: se prepara con el primer clic.
document.addEventListener('pointerdown', () => { try { audio ||= new AudioContext(); audio.resume(); } catch {} }, { once: true });

$('to-events').addEventListener('click', async event => {
  if (event.target.closest('[data-create]')) { $('to-create-open').click(); return; }
  const pencil = event.target.closest('[data-edit]');
  if (pencil) { try { await openEdit(pencil.dataset.edit); } catch (error) { message(error.message, true); } return; }
  const button = event.target.closest('[data-delete]'); if (!button) return;
  const id = button.dataset.delete, t = lobby.get(id); if (!t) return;
  const n = t.count, players = n === 1 ? 'Hay 1 jugador inscrito' : `Hay ${n} jugadores inscritos`;
  const text = (n ? `${players} en «${t.title}». ` : `Vas a borrar «${t.title}». `)
    + (['playing', 'between'].includes(t.status) ? 'El torneo está en juego y se perderán las partidas. ' : '')
    + 'Desaparecerá para todos y no se puede deshacer.';
  if (!await confirmAction(n ? 'Hay jugadores inscritos' : 'Borrar torneo', text, true)) return;
  button.disabled = true;
  try {
    await request(`/api/tournaments/${id}/delete`, { method: 'POST', body: JSON.stringify({ hostToken: read(hostKey(id)) }) });
    try { localStorage.removeItem(hostKey(id)); } catch {}
    message(''); await loadLobby();
  } catch (error) { button.disabled = false; message(error.message, true); }
});

$('to-waiting-boards').addEventListener('click', () => openBoards());
$('to-host-edit').addEventListener('click', async () => { try { await openEdit(roomId); } catch (error) { message(error.message, true); } });
$('to-key-edit').addEventListener('click', () => { $('to-joinkey-input').value = state?.joinKey || ''; $('to-joinkey-remove').hidden = !state?.joinKey; $('to-joinkey-dialog').showModal(); $('to-joinkey-input').focus(); });
$('to-joinkey-form').addEventListener('submit', event => {
  event.preventDefault();
  const key = $('to-joinkey-input').value.trim();
  if (key.length < 4) { $('to-joinkey-input').setCustomValidity('La clave debe tener al menos 4 caracteres.'); $('to-joinkey-input').reportValidity(); return; }
  if (send({ type: 'join-key', key })) { $('to-joinkey-dialog').close(); message('Clave guardada. Pásasela a quien quieras que se inscriba.'); }
});
$('to-joinkey-input').addEventListener('input', () => $('to-joinkey-input').setCustomValidity(''));
$('to-joinkey-remove').addEventListener('click', () => { if (send({ type: 'join-key', key: '' })) { $('to-joinkey-dialog').close(); message('Clave quitada: cualquiera con el enlace puede inscribirse.'); } });
