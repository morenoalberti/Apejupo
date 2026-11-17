import { Chess } from '../assets/chess/chess.js';
import { session, currentUser, openAuth } from './cuenta.js?v=20261116-registro2';
import { send as sendReto } from './retos.js?v=20261115-match1';
import { searchPlayers, findExact, warmUp } from './torneo-elo.js?v=20261116-presencial2';

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
let ptOptions = []; // resultados posibles de la mesa (según el formato), para el cuadro de resultados
let presencialFilter = 'all', presencialView = 'rounds'; // pestañas del organizador con el torneo en marcha // tabla de rondas presenciales: todas o una
let roundPickerKey = '';
let boardKey = '', lastRound = null, viewedRound = null, replay = null, replayPly = null, promotion = null;
let confirmResolve = null, dropped = null, lobby = new Map();
let lastArenaClosing = false;
let gameFitFrame = null;
let editingId = null, keyFieldRequired = false; // formulario de organizar: torneo que se edita y si se pide la clave de organización
let createModeChoices = {};
let tournamentAdmin = false;
// Jugada propia mostrada al instante, antes de que la confirme el servidor (como en Lichess).
let optimistic = null, rendered = { game: null, fen: null }, skipSlide = false, drag = null;
// Premovimiento (como en Lichess): jugada elegida mientras piensa el rival; se juega sola en cuanto te toca, si es legal.
let premove = null;

function read(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function adminKey() {
  try { return sessionStorage.getItem('apejupoAdminCuentas') || read('apejupoAdminCuentas'); }
  catch { return read('apejupoAdminCuentas'); }
}
async function checkTournamentAdmin() {
  const key = adminKey();
  if (!key) return false;
  try { return (await (await request('/api/tournaments/admin/comprobar', { method: 'POST', key })).json()).ok === true; }
  catch { return false; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); }
  catch { throw new Error('Permite el almacenamiento de este sitio para conservar tu inscripción y recuperar tus partidas.'); }
}
function token() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const playerKey = () => 'apejupoTorneoJugador:' + roomId;
const hostKey = id => 'apejupoTorneoOrganizador:' + id;
const managementKey = id => read(hostKey(id)) ? '' : adminKey() || session();
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
const arenaClosing = (t, now = Date.now() + offset) => arena(t) && t.status === 'playing' && now >= t.endsAt;
const closed = t => ['closed', 'double-closed'].includes(t?.format);
const presencial = t => t?.mode === 'presencial';
function duration(minutes) { return minutes % 60 ? (minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`) : `${minutes / 60} h`; }
const isMatch = t => !!t.challenge && t.rounds > 1;
// Quien ha salido del torneo no aparece en las listas ni en los contadores hasta que vuelve a entrar
// (en la clasificación final sí, con sus puntos).
const listed = t => t.standings.filter(p => !p.paused || t.status === 'finished');
const fideRating = p => Number(p.fide) || (p.source === 'FIDE' ? Number(p.rating) || 0 : 0);
const canChangeInitialRoster = t => presencial(t) && ['playing', 'between'].includes(t.status) && !t.games.some(g => !g.bye && g.result);
function standingsView(t) {
  const initial = !t.games.some(g => !g.bye && g.result);
  const rows = listed(t);
  if (initial) rows.sort((a, b) => fideRating(b) - fideRating(a) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const title = initial ? 'Listado de participantes' : t.status === 'finished' ? 'Clasificación final'
    : arena(t) ? 'Clasificación provisional' : `Clasificación provisional ronda ${t.round}`;
  return { initial, rows, title };
}
// Tipo de torneo para las tarjetas: «Sistema suizo · 5 rondas», «Round-Robin doble vuelta», «Arena de 1 h»…
function systemLabel(t) {
  if (t.challenge || arena(t)) return formatLabel(t);
  if (t.format === 'double-closed') return 'Round-Robin doble vuelta';
  if (closed(t)) return 'Round-Robin' + (t.rounds ? ` · ${t.rounds} rondas` : ' (todos contra todos)');
  return `Sistema suizo · ${t.rounds} ${t.rounds === 1 ? 'ronda' : 'rondas'}`;
}
function formatLabel(t) { return t.challenge ? (isMatch(t) ? `Match a ${t.rounds} partidas` : 'Reto') : arena(t) ? `Arena de ${duration(t.duration)}` : t.format === 'double-closed' ? 'Round-Robin doble vuelta' : closed(t) ? (t.rounds ? `Round-Robin a ${t.rounds} rondas` : 'Round-Robin: todos contra todos') : `${t.rounds} rondas`; }
// «15 nov, 16:00 h.»
function date(value) { return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(value) + ' h.'; }
function name(id) { return state?.standings.find(p => p.id === id)?.name || 'Jugador'; }
function send(action) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !connected) { message('Espera a recuperar la conexión antes de continuar.', true); return false; }
  socket.send(JSON.stringify(action)); return true;
}
// La sesión recupera la inscripción y, si corresponde, los controles de organización en cualquier dispositivo.
function hello() { send(boardsMode ? { type: 'hello' } : { type: 'hello', token: read(playerKey()), hostToken: read(hostKey(roomId)), ...(currentUser() ? { session: session() } : {}), ...(adminKey() ? { adminKey: adminKey() } : {}) }); }

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
const emptyLobby = `<div class="to-empty"><div class="to-empty-art" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M32 5v10M27 10h10M22 27c0-6 4-11 10-11s10 5 10 11c0 5-3 8-4 12H26c-1-4-4-7-4-12zM24 39h16l3 9H21zM17 48h30v7H17z"/></svg></div><strong>El próximo torneo puede ser el nuestro</strong><p>Todavía no hay torneos. Cuando la organización abra uno, aparecerá aquí.</p><button class="btn to-icon-btn" type="button" data-create><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Crear torneo</span></button></div>`;
// Modalidad del torneo, siempre a la vista: en la tarjeta del lobby y en la cabecera de la sala.
const modeBadge = t => t.challenge ? '' : presencial(t)
  ? `<span class="to-mode-badge presencial" title="Se juega en los tableros del club">${svg('<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>')}Presencial</span>`
  : `<span class="to-mode-badge online" title="Se juega en esta web">${svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>')}Online</span>`;
function eventCard(t) {
  const organizer = t.mine === true || !!read(hostKey(t.id));
  const trash = organizer || tournamentAdmin ? `<button class="to-delete" type="button" data-delete="${t.id}" aria-label="Borrar el torneo ${esc(t.title)}" title="Borrar torneo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg></button>` : '';
  // Creador y administrador pueden editar la configuración antes del inicio.
  const pencil = (organizer || tournamentAdmin) && (t.status === 'waiting' || t.editable) ? `<button class="to-delete to-edit" type="button" data-edit="${t.id}" aria-label="Editar el torneo ${esc(t.title)}" title="Editar torneo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>` : '';
  const count = t.listed ?? t.count, full = Math.min(100, Math.round(count / t.capacity * 100));
  return `<article class="to-event ${t.status}"><div class="to-event-top"><span class="to-event-badges"><span class="to-status ${t.editable ? 'waiting' : t.status}">${esc(t.editable ? 'Por empezar' : statuses[t.status])}</span>${modeBadge(t)}</span><span class="to-event-clock">${icons.clock}${t.minutes} + ${t.increment}</span></div>`
    + `<h3>${esc(t.title)}</h3><ul class="to-event-meta"><li>${icons.format}${systemLabel(t)}</li>${t.locked ? `<li>${icons.lock}Inscripción con clave</li>` : ''}<li>${icons.calendar}${t.startsAt ? esc(date(t.startsAt)) : 'Inicio a cargo del organizador'}</li></ul>`
    + `<div class="to-event-fill"><span>${icons.people}${count}/${t.capacity} jugadores</span><i><b style="width:${full}%"></b></i></div>`
    + `<div class="to-event-actions"><a class="btn" href="jugar-torneo.html?id=${t.id}"><span>${t.status === 'waiting' ? 'Entrar e inscribirme' : 'Ver torneo'}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></a>${pencil || trash ? `<div class="to-event-tools">${pencil}${trash}</div>` : ''}</div></article>`;
}
async function loadLobby() {
  if (!API) {
    $('to-events').innerHTML = '<div class="to-empty"><strong>Estamos preparando los próximos torneos</strong>Las inscripciones estarán disponibles aquí cuando abramos esta sección.</div>';
    $('to-create-open').disabled = true; $('to-refresh').disabled = true; return;
  }
  $('to-refresh').disabled = true;
  try {
    const [data, admin] = await Promise.all([request('/api/tournaments', { key: session() }).then(res => res.json()), checkTournamentAdmin()]);
    const { tournaments, keyRequired } = data;
    tournamentAdmin = admin;
    $('to-admin-note').hidden = !admin;
    // Solo el administrador: borrar de una vez los torneos terminados (finalizados o cancelados).
    $('to-delete-ended').hidden = !admin || !tournaments.some(t => ['finished', 'cancelled'].includes(t.status));
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
      moveAlert(g, d.ply - 1);
      if (optimistic && optimistic.game === d.id && d.ply >= optimistic.ply) optimistic = null;
      if (!drag && !keepSelection(d.fen)) selected = null; boardKey = '';
    } else if (d.ply > g.moves.length + 1) { send({ type: 'watch', game: g.id }); return; } // se perdió algo: pedir el tablero completo
  }
  render();
  playPremove();
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
    if (next.type === 'host-token') { try { write(hostKey(roomId), next.token); } catch {} return; }
    if (next.type === 'error') { pending = false; optimistic = null; boardKey = ''; if (isDupError(next.message)) noticeBox('Jugador repetido', next.message); else message(next.message, true); if (state) renderGame(); return; }
    if (next.type === 'move') { if (state) applyMove(next); return; }
    if (next.type !== 'state') return;
    if (state && next.revision < state.revision) return;
    const oldGame = state?.game, oldMe = state?.me;
    const reopened = state && presencial(next) && state.status !== 'waiting' && next.status === 'waiting' && next.round === 0;
    if (reopened) { presencialFilter = 'all'; presencialView = 'rounds'; closeResultPop(); }
    offset = next.serverNow - Date.now(); pending = false; state = next;
    if (oldGame?.id === next.game?.id && oldGame && !oldGame.result) moveAlert(next.game, oldGame.moves.length);
    if (optimistic && (next.game?.id !== optimistic.game || next.game.moves.length >= optimistic.ply)) optimistic = null;
    if (oldGame?.id !== next.game?.id || oldGame?.fen !== next.game?.fen) { if (!drag && !(oldGame?.id === next.game?.id && keepSelection(next.game.fen))) selected = null; boardKey = ''; }
    if (premove && (premove.game !== next.game?.id || next.game?.result)) premove = null;
    if (oldGame?.id !== next.game?.id || oldGame?.result !== next.game?.result) { replay = null; replayPly = null; }
    if (!manualFlip && next.me && next.game && (oldGame?.id !== next.game.id || oldMe !== next.me)) flipped = next.game.black === next.me;
    const changedRound = lastRound !== next.round; lastRound = next.round;
    if (changedRound && next.round > 0) message('');
    if (changedRound || viewedRound === null) viewedRound = next.round || 1;
    render();
    if (reopened && next.host) requestAnimationFrame(() => $('to-presencial').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    playPremove();
    if (next.me && (changedRound || oldMe !== next.me)) {
      const mine = next.games.find(g => !g.bye && (arena(next) ? !g.result : g.round === next.round) && (g.white === next.me || g.black === next.me));
      if (mine && mine.id !== next.game?.id) { watch(mine.id); if (!mine.result) newGameAlert(); }
    }
  };
  ws.onclose = event => {
    if (socket !== ws) return;
    clearInterval(heartbeat); pending = false;
    setConnection('Reconectando…');
    if (['El organizador ha borrado el torneo.', 'El administrador ha borrado el torneo.'].includes(event.reason)) { setConnection('Torneo borrado'); message(event.reason, true); return; }
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
  $('to-subtitle').textContent = presencial(t) ? 'Consulta las mesas, los resultados y la clasificación. La organización gestiona las inscripciones y las rondas.' : canJoin(t) && arena(t) && t.status === 'playing' && !t.standings.some(p => p.id === t.me) ? 'El arena está en marcha: únete y empieza a jugar ya.' : t.challenge ? (t.status === 'waiting' ? 'La partida empieza en cuanto los dos tengáis el tablero abierto.' : '') : t.status === 'waiting' ? 'Las inscripciones están abiertas. Reserva tu sitio en el tablero.' : 'Sigue tus partidas, los tableros y la clasificación en directo.';
  $('to-subtitle').hidden = !$('to-subtitle').textContent;
  // Reto: solo el tablero (y el marcador entre los dos) bajo la cabecera de la web.
  document.body.classList.toggle('to-challenge', !!t.challenge);
  $('to-summary').innerHTML = `<span class="to-status ${t.status}">${esc(t.challenge && t.status === 'waiting' ? 'Esperando al rival' : statuses[t.status])}</span>${modeBadge(t)}<span>${icons.clock}${t.minutes} + ${t.increment}</span><span>${icons.format}${formatLabel(t)}</span>${t.challenge ? '' : `<span>${arena(t) ? 'Emparejamiento continuo' : closed(t) ? 'Todos contra todos' : t.pairing === 'club' ? 'Suizo de club' : 'Sistema Suizo'}</span>`}`
    + (t.status === 'waiting' ? `<span>${icons.people}Hasta ${t.capacity} jugadores</span><span>${icons.calendar}${t.startsAt ? esc(date(t.startsAt)) : 'Inicio a cargo del organizador'}</span>${t.locked ? `<span>${icons.lock}Con clave</span>` : ''}` : '');
  document.body.classList.toggle('to-presencial-room', presencial(t));
  placeWaiting(t.status === 'waiting' && !presencial(t));
  $('to-notice').hidden = !t.notice; $('to-notice').textContent = t.notice;
  const mine = t.standings.find(p => p.id === t.me), registering = t.status === 'waiting';
  const classification = standingsView(t);
  $('to-registration').hidden = !canJoin(t) || !!mine || t.count >= t.capacity;
  renderJoin();
  $('to-membership').hidden = !mine || !!t.challenge;
  renderDuel(t);
  $('to-membership-text').hidden = !mine || mine.active;
  $('to-membership-text').textContent = mine && !mine.active ? 'Retirado del torneo' : '';
  $('to-standings-title').textContent = classification.title;
  $('to-print-standings').disabled = !classification.rows.length;
  // Impresora también arriba, a la derecha, junto al contador de jugadores.
  $('to-print-top').hidden = registering || !classification.rows.length;
  $('to-standings-panel').classList.toggle('to-registration-panel', registering);
  $('to-player-count').textContent = `${listed(t).length}/${t.capacity}`;
  $('to-player-count').setAttribute('aria-label', `${listed(t).length} jugadores de ${t.capacity} plazas`);
  $('to-registration-progress').hidden = !registering;
  $('to-registration-progress').firstElementChild.style.width = `${Math.max(0, Math.min(100, listed(t).length / t.capacity * 100))}%`;
  // Columnas de desempate: los dos primeros que eligió el organizador (el arena muestra las partidas jugadas).
  const tbKeys = arena(t) || t.challenge ? [] : (t.tiebreaks?.length ? t.tiebreaks : (closed(t) ? ['sb'] : ['bh'])).filter(k => TB[k]);
  // Presencial: todos los desempates elegidos; online, los dos primeros.
  const tbCols = presencial(t) ? tbKeys : tbKeys.slice(0, 2);
  $('to-standings').closest('table').tHead.rows[0].innerHTML = '<th scope="col">#</th><th scope="col">Jugador</th>' + (presencial(t) ? '<th scope="col" class="to-st-elo-col">ELO</th>' : '') + '<th scope="col">Pts</th>'
    + (arena(t) ? '<th scope="col"><abbr title="Partidas jugadas">PJ</abbr></th>' : tbCols.map((k, i) => `<th scope="col"${i ? ' class="to-tb-col2"' : ''}><abbr title="${esc(TB[k][0])}">${TB[k][1]}</abbr></th>`).join(''));
  const tag = p => (p.registered ? ' <span class="to-registered" title="Cuenta registrada">✓</span>' : '') + (!p.active ? ' <small>retirado</small>' : '');
  // Arena en marcha: delante del nombre, punto verde parpadeante si está jugando y gris fijo si no (esperando o partida terminada).
  const dot = p => arena(t) && t.status === 'playing' && p.active ? `<span class="to-state ${p.playing ? 'on' : 'off'}" title="${p.playing ? 'Jugando' : 'Sin partida ahora'}" aria-label="${p.playing ? 'Jugando' : 'Sin partida ahora'}"></span>` : '';
  // Desempate con decimales (Sonneborn-Berger de la doble vuelta): «0,75», no «0.75».
  const tb = n => Number.isInteger(n) || n % 1 === .5 ? formatPoints(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  // Presencial: foto, bandera, título y puntos en relieve (sin podio).
  const rich = presencial(t), started = t.status !== 'waiting';
  const who = p => rich
    ? `<div class="to-st-id">${pzAvatar(p)}<div class="to-st-body"><div class="to-st-name">${pzFlag(p)}<span>${esc(p.name)}</span>${!classification.initial && p.id === t.me ? ' <small>(tú)</small>' : ''}${tag(p)}</div></div></div>`
    : `${dot(p)}${esc(p.name)}${p.rating ? ` <small class="to-elo" title="Elo">${p.rating}</small>` : ''}${!classification.initial && p.id === t.me ? ' <small>(tú)</small>' : ''}${tag(p)}${sheet(p)}`;
  $('to-standings').innerHTML = classification.rows.map((p, i) => `<tr class="${!classification.initial && p.id === t.me ? 'me ' : ''}${t.status === 'finished' && i === 0 ? 'winner' : ''}"><td>${rich && started ? `<span class="to-st-rank">${i + 1}</span>` : i + 1}</td><td>${who(p)}${registering && t.host ? `<button class="to-remove" type="button" data-remove="${p.id}" aria-label="Retirar a ${esc(p.name)}">×</button>` : ''}</td>${rich ? `<td class="to-st-elo-col">${p.rating || ''}</td>` : ''}<td>${rich ? `<span class="to-st-pts">${formatPoints(p.points)}</span>` : `<strong>${formatPoints(p.points)}</strong>`}</td>${arena(t) ? `<td>${p.played}</td>` : tbCols.map((k, i) => `<td${i ? ' class="to-tb-col2"' : ''}>${p.tb?.[k] == null ? '–' : k === 'aro' ? (p.tb[k] || '–') : tb(p.tb[k])}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5" class="muted">Aún no hay inscritos.</td></tr>';
  if (rich) pzPhotos($('to-standings'));
  $('to-tiebreak').hidden = registering;
  $('to-tiebreak').textContent = arena(t) ? 'Desempates: victorias, menos partidas jugadas y número de sorteo.' : tbKeys.length ? `Desempates: ${tbKeys.map(k => TB[k][0]).join(', ')} y número de sorteo.` : 'Desempate: número de sorteo.';
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
  // Arena: la fila con «Salir del torneo» también se ve mientras juegas tu partida (la terminas y ya no se te empareja).
  $('to-focus-next').hidden = !focus || (ownActive && !arena(t));
  $('to-focus-pause').hidden = !arena(t);
  $('to-focus-pause').textContent = mine?.paused ? 'Entrar en el torneo' : 'Salir del torneo';
  $('to-focus-pause').disabled = !connected;
  // Con el torneo en juego no se muestra «Compartir torneo».
  $('to-share').hidden = !!t.challenge || ['playing', 'between'].includes(t.status);
  // Los invitados que entran con el enlace no ven la lista de torneos: solo el organizador.
  $('to-back').hidden = !t.host;
  $('to-focus-title').textContent = t.title;
  $('to-focus-format').textContent = `${t.minutes} + ${t.increment} · ${formatLabel(t)}`;
  renderPodium(); renderMatches(); renderGame(); renderControls(); renderBoards(); renderPresencial(); updateClocks();
}
// Sala de espera (estilo Lichess): inscritos a la izquierda; en el centro la cuenta atrás,
// el botón de unirse y la organización. Se mueven los bloques existentes, sin duplicarlos,
// y vuelven a su sitio cuando empieza el torneo.
const waitBlocks = () => [[$('to-standings-title').closest('section'), 'to-wait-side'], ...['to-registration', 'to-membership'].map(id => [$(id), 'to-wait-main'])];
const waitHomes = new Map();
function placeWaiting(waiting) {
  $('to-wait').hidden = !waiting; $('to-room').classList.toggle('to-waiting', waiting);
  for (const [el, target] of waitBlocks()) {
    if (waiting && el.parentElement.id !== target) {
      if (!waitHomes.has(el)) { const mark = document.createComment('sitio'); el.before(mark); waitHomes.set(el, mark); }
      $(target).append(el);
    } else if (!waiting && waitHomes.has(el)) waitHomes.get(el).after(el);
  }
  // En presencial, los controles quedan justo encima de los emparejamientos, sin una franja independiente.
  const host = $('to-host'), physical = presencial(state);
  if (physical) { if (host.parentElement !== $('to-presencial-toolbar')) $('to-presencial-toolbar').append(host); }
  else if (waiting) { if (host.parentElement !== $('to-wait-main')) $('to-wait-main').append(host); }
  else if (host.nextElementSibling !== $('to-presencial')) $('to-presencial').before(host);
}
function canJoin(t) { return !presencial(t) && !t.challenge && (t.status === 'waiting' || (arena(t) && t.status === 'playing' && Date.now() + offset < t.endsAt)); }
// Hoja de resultados, como en Lichess: una cifra por partida; resaltadas las ganadas con Berserk.
function sheet(p) {
  if (!p.sheet?.length) return '';
  const half = r => (r.n || 1) / 2, kind = r => r.s > half(r) ? 'w' : r.s < half(r) ? 'l' : 'd';
  const label = r => (r.bye ? 'Descanso' : (kind(r) === 'w' ? 'Victoria' : kind(r) === 'l' ? 'Derrota' : 'Empate') + (r.forfeit ? ' por incomparecencia' : '') + (r.n > 1 ? ` (${formatPoints(r.s)} de ${r.n})` : '')) + (r.berserk ? ' con Berserk' : '') + (r.doubled ? ' · Puntuación doble por racha' : '') + (r.bonus ? ' (+1 por Berserk)' : '') + (r.points !== undefined ? ` · ${r.points} ${r.points === 1 ? 'punto' : 'puntos'}` : '');
  return `<span class="to-sheet">${p.sheet.map(r => `<i class="${kind(r)}${r.bonus ? ' b' : ''}" title="${label(r)}">${r.points ?? (r.forfeit ? (kind(r) === 'w' ? '+' : '-') : formatPoints(r.s) || '0')}</i>`).join('')}</span>`;
}
// Reto: en lugar de clasificación y podio, el marcador acumulado entre los dos jugadores (todas sus partidas).
function renderDuel(t) {
  $('to-duel').hidden = !t.challenge; $('to-standings-panel').hidden = !!t.challenge;
  if (!t.challenge || !t.duel) return;
  // Tú a la izquierda si juegas; si miras como espectador, por orden de la sala.
  const players = [...t.standings].sort((a, b) => (b.id === t.me) - (a.id === t.me));
  const [p, q] = players, wp = t.duel.wins[p?.id] || 0, wq = t.duel.wins[q?.id] || 0, d = t.duel.draws || 0;
  const pts = x => String(x).replace('.5', '½').replace(/^0½$/, '½');
  const row = (x, value) => `<li class="${x.id === t.me ? 'me' : ''}"><strong>${esc(x.name)}</strong><b>${pts(value)}</b></li>`;
  // Match: arriba el resultado de este match; debajo, el historial de todas las partidas entre los dos.
  const match = isMatch(t) && p && q ? `<p class="to-duel-h">${t.status === 'finished' ? 'Match terminado' : `Match · partida ${Math.max(1, t.round)} de ${t.rounds}`}</p><ul class="to-duel-score">${row(p, p.points)}${row(q, q.points)}</ul><p class="to-duel-h">Historial entre los dos</p>` : '';
  $('to-duel-body').innerHTML = !p || !q ? '' : `${match}<ul class="to-duel-score${match ? ' small' : ''}">${row(p, wp + d / 2)}${row(q, wq + d / 2)}</ul>`;
}
function renderPodium() {
  // Presencial: sin podio; la clasificación final ya ordena a todos.
  const t = state, show = !t.challenge && !presencial(t) && t.status === 'finished' && t.standings.length >= 2;
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
let audio = null, moveSound = false;
function prepareAudio() {
  audio ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
function beep(frequency, duration, volume, sustained = false) {
  try {
    const context = prepareAudio(), o = context.createOscillator(), v = context.createGain(), now = context.currentTime;
    o.frequency.value = frequency;
    o.type = sustained ? 'square' : 'sine';
    v.gain.setValueAtTime(.001, now); v.gain.linearRampToValueAtTime(volume, now + .005);
    // El aviso de jugada mantiene el volumen casi hasta el final, para que no se desvanezca enseguida.
    if (sustained) v.gain.setValueAtTime(volume, now + duration * .8);
    v.gain.exponentialRampToValueAtTime(.001, now + duration);
    o.connect(v).connect(context.destination); o.start(now); o.stop(now + duration);
    o.onended = () => { o.disconnect(); v.disconnect(); };
  } catch {}
}
// Solo las jugadas nuevas y confirmadas de tu partida: no suena al abrir un tablero ni al revisar.
function moveAlert(g, previousPly) {
  if (!moveSound || boardsMode || !state?.me || !g || (g.white !== state.me && g.black !== state.me) || g.moves.length <= previousPly) return;
  beep(880, .32, .65, true);
}
// Aviso de partida nueva: sonido corto y el tablero a la vista, como en Lichess.
function newGameAlert() {
  beep(660, .35, .12);
  requestAnimationFrame(() => {
    $('to-game-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('to-game-panel').classList.remove('to-flash'); void $('to-game-panel').offsetWidth; $('to-game-panel').classList.add('to-flash');
  });
  if (document.hidden) { const title = document.title; document.title = '♟ ¡Tu partida empieza!'; addEventListener('visibilitychange', () => { document.title = title; }, { once: true }); }
}
function formatPoints(n) { return Number.isInteger(n) ? String(n) : n % 1 === .5 ? (Math.floor(n) || '') + '½' : String(n); }
function closeRoundPicker(focus = false) {
  $('to-round-menu').hidden = true;
  $('to-round-trigger').setAttribute('aria-expanded', 'false');
  if (focus && !$('to-round-picker').hidden) $('to-round-trigger').focus({ preventScroll: true });
}
function positionRoundPicker() {
  const menu = $('to-round-menu'), rect = $('to-round-trigger').getBoundingClientRect();
  const width = Math.min(280, innerWidth - 24), below = innerHeight - rect.bottom - 18, above = rect.top - 18;
  menu.style.width = `${width}px`; menu.style.maxHeight = `${Math.max(80, Math.min(360, Math.max(below, above)))}px`;
  const height = menu.getBoundingClientRect().height, up = below < height && above > below;
  menu.style.left = `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`;
  menu.style.top = `${up ? Math.max(12, rect.top - height - 6) : rect.bottom + 6}px`;
}
function focusRoundOption(option) {
  if (!option) return;
  option.focus({ preventScroll: true });
  const list = $('to-round-options'), itemRect = option.getBoundingClientRect(), listRect = list.getBoundingClientRect();
  if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
  else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
}
function openRoundPicker(edge) {
  if ($('to-round-picker').hidden) return;
  $('to-round-menu').hidden = false; $('to-round-trigger').setAttribute('aria-expanded', 'true');
  positionRoundPicker();
  const options = [...$('to-round-options').querySelectorAll('[data-round-filter]')];
  const option = edge === 'first' ? options[0] : edge === 'last' ? options.at(-1) : options.find(el => el.getAttribute('aria-selected') === 'true');
  focusRoundOption(option);
}
// «Última ronda»: la ronda en curso o la última emparejada; se actualiza sola al emparejar otra.
const latestRound = (t, rounds) => t.round || rounds.at(-1);
function renderRoundPicker(t, rounds) {
  $('to-round-picker').hidden = $('to-presencial-round').hidden;
  if ($('to-round-picker').hidden) { closeRoundPicker(); return; }
  $('to-round-label').textContent = presencialFilter === 'all' ? 'Todas las rondas' : presencialFilter === 'last' ? 'Última ronda' : `Ronda ${presencialFilter}`;
  $('to-round-count').textContent = `${rounds.length} rondas`;
  const choices = [{ value: 'all', label: 'Todas las rondas', detail: 'Ver el torneo completo', badge: 'Σ' }, { value: 'last', label: 'Última ronda', detail: `Ronda ${latestRound(t, rounds)}`, badge: '↓' }, ...rounds.map(r => ({
    value: String(r), label: `Ronda ${r}`, detail: r < t.round || t.status === 'finished' ? 'Completada' : r === t.round ? 'En curso' : 'Por jugar', badge: String(r).padStart(2, '0')
  }))];
  const key = JSON.stringify([choices, presencialFilter]);
  if (key !== roundPickerKey) {
    roundPickerKey = key;
    const focused = document.activeElement?.dataset.roundFilter;
    $('to-round-options').innerHTML = choices.map(o => `<button type="button" role="option" tabindex="-1" data-round-filter="${o.value}" aria-selected="${String(o.value === String(presencialFilter))}"><span class="to-round-number" aria-hidden="true">${o.badge}</span><span class="to-round-text"><strong>${o.label}</strong><small${o.detail === 'En curso' ? ' class="is-current"' : ''}>${o.detail}</small></span><svg class="to-round-check" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>`).join('');
    if (focused && !$('to-round-menu').hidden) [...$('to-round-options').children].find(el => el.dataset.roundFilter === focused)?.focus({ preventScroll: true });
  }
  if (!$('to-round-menu').hidden) positionRoundPicker();
}
function renderPresencial() {
  const t = state, show = presencial(t), waiting = t.status === 'waiting';
  $('to-presencial').hidden = !show;
  if (!show) { closeRoundPicker(); return; }
  const running = ['playing', 'between', 'finished'].includes(t.status);
  $('to-presencial-reset').hidden = !t.host || !running || !t.round;
  // Con el torneo emparejado, el organizador vuelve a la lista de jugadores con la pestaña «Jugadores».
  $('to-pz-tabs').hidden = !t.host || !running;
  if (!t.host || !running) presencialView = 'rounds';
  for (const b of $('to-pz-tabs').querySelectorAll('[data-pz-view]')) b.setAttribute('aria-selected', String(b.dataset.pzView === presencialView));
  const playersView = t.host && running && presencialView === 'players';
  const managing = t.host && (waiting || playersView), mine = t.standings.some(p => p.id === t.me);
  const lateEntry = t.format === 'swiss' && ['playing', 'between'].includes(t.status);
  const initialRoster = canChangeInitialRoster(t);
  $('to-pz-host').querySelector('.to-pz-add').hidden = !waiting && !initialRoster && !lateEntry;
  $('to-pz-qr-open').hidden = !waiting;
  $('to-pz-host').querySelector('.to-pz-label').textContent = waiting || initialRoster ? 'Añadir jugador' : 'Inscripción tardía (entra en la ronda siguiente)';
  $('to-presencial-matches').hidden = playersView;
  document.body.classList.toggle('to-pz-managing', managing);
  $('to-pz-host').hidden = !managing;
  if (managing) renderRoster(t);
  $('to-start').textContent = 'Cerrar inscripción y emparejar';
  $('to-pz-ask').hidden = t.host || !waiting || mine || (t.count >= t.capacity && !t.myRequest);
  $('to-pz-ask-form').hidden = !!t.myRequest && !askChanging;
  $('to-pz-ask-sent').hidden = !t.myRequest || askChanging;
  if (t.myRequest) $('to-pz-ask-text').textContent = `Como ${t.myRequest.name}${t.myRequest.rating ? ` (Elo ${t.myRequest.rating})` : ''}. Cuando la organización la apruebe aparecerás en la lista de inscritos.`;
  $('to-presencial-next').hidden = !t.host || t.format !== 'swiss' || t.status !== 'between';
  $('to-presencial-next').disabled = !connected;
  // Round-Robin con número impar de jugadores: tantas rondas como jugadores, porque en cada una descansa uno.
  const oddRR = closed(t) && !waiting && t.standings.length % 2 === 1 ? ` Con ${t.standings.length} jugadores hay ${t.rounds} rondas: en cada una descansa un jugador.` : '';
  $('to-presencial-hint').textContent = (playersView ? (t.status === 'finished' ? 'Lista final de jugadores.' : initialRoster ? 'Puedes añadir o quitar jugadores. Como no hay resultados anotados, los emparejamientos se regeneran con cada cambio.' : lateEntry ? 'Corrige nombres y Elo, retira a quien se marche o inscribe a quien llegue tarde.' : 'Corrige nombres y Elo o retira a quien se marche. En el Round-Robin no hay inscripción tardía.') : waiting ? (t.host ? 'Cuando estén todos, pulsa «Cerrar inscripción y emparejar» para sortear la primera ronda.' : mine ? 'Ya tienes plaza. Las mesas aparecerán aquí al empezar.' : 'La organización está preparando la lista de jugadores.') : t.host ? '' : 'Los resultados se actualizan cuando los anota la organización.') + (playersView || waiting ? '' : oddRR);
  // Sin texto de ayuda (organizador anotando resultados), no se deja el hueco.
  $('to-presencial-hint').parentElement.hidden = !$('to-presencial-hint').textContent;
  // Todas las rondas en una tabla, como las hojas de emparejamientos: Mesa · Tít. · Blancas · ELO · Resultado · Tít. · Negras · ELO.
  // Round-Robin: también las rondas que faltan por jugar (el calendario sale entero del sorteo).
  const future = new Map((t.schedule || []).map(f => [f.round, f.pairs]));
  const rounds = [...new Set([...t.games.map(g => g.round), ...future.keys()])].sort((a, b) => a - b);
  if (!['all', 'last'].includes(presencialFilter) && !rounds.includes(Number(presencialFilter))) presencialFilter = 'all';
  $('to-presencial-round').hidden = rounds.length < 2;
  $('to-presencial-round').innerHTML = '<option value="all">Todas las rondas</option><option value="last">Última ronda</option>' + rounds.map(r => `<option value="${r}">Ronda ${r}</option>`).join('');
  $('to-presencial-round').value = String(presencialFilter);
  if (presencialView === 'players' && t.host) $('to-presencial-round').hidden = true;
  renderRoundPicker(t, rounds);
  $('to-presencial-toolbar').hidden = $('to-presencial-round').hidden && $('to-host').hidden;
  const shown = presencialFilter === 'all' ? rounds : presencialFilter === 'last' ? [latestRound(t, rounds)] : [Number(presencialFilter)];
  const info = id => t.standings.find(p => p.id === id) || { name: name(id) };
  const tit = p => p.title ? `<span class="to-pz-title${/^A[GIFC]M$/.test(p.title) ? ' arena' : ''}">${esc(p.title)}</span>` : '';
  const flag = p => p.fed && window.U?.flag ? window.U.flag(p.fed) : '';
  const cellName = (p, won) => `<td class="to-pt-name${won ? ' won' : ''}">${flag(p)}<span class="to-pt-inline">${tit(p)}</span>${esc(p.name)}</td>`;
  // Doble vuelta presencial: cada mesa es un mini-match de dos partidas (2-0, 1,5-0,5, 1-1…), como en RondaSwiss.
  const games2 = closed(t) && t.format === 'double-closed', perTable = games2 ? 2 : 1;
  const options = games2 ? [['2-0', '2-0'], ['1.5-0.5', '1,5-0,5'], ['1-1', '1-1'], ['0.5-1.5', '0,5-1,5'], ['0-2', '0-2'], ['+-', '+-'], ['-+', '-+']]
    : [['1-0', '1-0'], ['1/2-1/2', '½-½'], ['0-1', '0-1'], ['+-', '+-'], ['-+', '-+']];
  const score = r => r ? (options.find(([v]) => v === r)?.[1] || r.replace('1/2-1/2', '½-½')) : '';
  ptOptions = options;
  const whitePts = r => ({ '2-0': 2, '1.5-0.5': 1.5, '1-1': 1, '0.5-1.5': .5, '0-2': 0, '1-0': perTable, '+-': perTable, '0-1': 0, '-+': 0 })[r] ?? perTable / 2;
  // Puntos que lleva cada jugador al empezar la ronda r (rondas anteriores con resultado y descansos).
  const before = new Map();
  for (const r of rounds) {
    const acc = new Map();
    for (const g of t.games) {
      if (g.round >= r) continue;
      if (g.bye) { acc.set(g.white, (acc.get(g.white) || 0) + (g.rest ? 0 : perTable)); continue; }
      if (!g.result) continue;
      const wp = whitePts(g.result);
      acc.set(g.white, (acc.get(g.white) || 0) + wp); acc.set(g.black, (acc.get(g.black) || 0) + perTable - wp);
    }
    before.set(r, acc);
  }
  // Round-Robin: en las rondas por jugar más allá de la siguiente aún no se sabe con cuántos puntos llegará cada uno.
  const firstFuture = Math.min(...future.keys());
  const known = r => !future.has(r) || (r === firstFuture && !t.games.some(g => g.round === r - 1 && !g.bye && !g.result));
  const pts = (r, p) => `<td class="to-pt-pts">${known(r) && p.id ? formatPoints(before.get(r)?.get(p.id) || 0) : ''}</td>`;
  const body = shown.map(r => {
    if (future.has(r)) {
      const pairs = future.get(r), tables = pairs.filter(([w, b]) => w && b), rests = pairs.filter(([w, b]) => !w || !b).map(([w, b]) => w || b);
      return `<tr class="to-pt-round to-pt-future"><th colspan="10">Ronda ${r} <span class="to-pt-state">por jugar</span></th></tr>`
        + tables.map(([wid, bid], i) => { const w = info(wid), b = info(bid);
          return `<tr class="to-pt-later${wid === t.me || bid === t.me ? ' mine' : ''}"><td class="to-pt-num">${i + 1}</td><td class="to-pt-tit">${tit(w)}</td>${cellName(w, false)}<td class="to-pt-elo">${w.rating || ''}</td>${pts(r, w)}<td class="to-pt-res"><span class="to-pt-pending">—</span></td>${pts(r, b)}<td class="to-pt-tit">${tit(b)}</td>${cellName(b, false)}<td class="to-pt-elo">${b.rating || ''}</td></tr>`; }).join('')
        + rests.map(id => { const w = info(id);
          return `<tr class="to-pt-bye to-pt-later${id === t.me ? ' mine' : ''}"><td class="to-pt-num"></td><td class="to-pt-tit">${tit(w)}</td>${cellName(w, false)}<td class="to-pt-elo">${w.rating || ''}</td>${pts(r, w)}<td class="to-pt-res"><span class="to-pt-pending">—</span></td><td class="to-pt-pts"></td><td class="to-pt-tit"></td><td class="to-pt-name to-pt-rest" colspan="2">Descansa</td></tr>`; }).join('');
    }
    const games = t.games.filter(g => g.round === r), tables = games.filter(g => !g.bye), byes = games.filter(g => g.bye);
    // Ronda en curso: siempre. Round-Robin: también cualquier ronda anterior, para corregir errores (no cambia los emparejamientos).
    const earlier = closed(t) && r < t.round;
    const editable = t.host && ['playing', 'between', 'finished'].includes(t.status) && (r === t.round || earlier);
    const pending = tables.filter(g => !g.result).length;
    // Suizo: el organizador puede borrar la última ronda (p. ej. para corregir un resultado de la anterior).
    const drop = t.host && t.format === 'swiss' && r === t.round && ['playing', 'between', 'finished'].includes(t.status)
      ? `<button type="button" class="to-pt-drop" data-pt-drop="${r}" title="Borrar última ronda" aria-label="Borrar última ronda (ronda ${r})"${connected ? '' : ' disabled'}><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>` : '';
    const head = `<tr class="to-pt-round"><th colspan="10"><div class="to-pt-round-head"><span>Ronda ${r}${r === t.round && t.status !== 'finished' ? ` <span class="to-pt-state">${pending ? `${pending} ${pending === 1 ? 'resultado pendiente' : 'resultados pendientes'}` : 'completa'}</span>` : ''}</span>${drop}</div></th></tr>`;
    const rows = tables.map((g, i) => {
      const w = info(g.white), b = info(g.black);
      const result = g.result ? `<span class="to-pt-score">${score(g.result)}</span>` : `<span class="to-pt-pending">${editable ? 'Anotar' : '—'}</span>`;
      // El organizador pulsa la fila de la mesa (o Intro sobre ella) y sale el cuadro de resultados.
      return `<tr class="${g.white === t.me || g.black === t.me ? 'mine' : ''}${editable ? ' to-pt-edit' : ''}"${editable ? ` data-pt-game="${g.id}" data-pt-table="${i + 1}"${earlier ? ' data-pt-earlier="1"' : ''} tabindex="0" role="button" aria-haspopup="dialog" aria-label="Mesa ${i + 1}: ${esc(w.name)} contra ${esc(b.name)}. Anotar resultado"` : ''}><td class="to-pt-num">${i + 1}</td><td class="to-pt-tit">${tit(w)}</td>${cellName(w, g.result && whitePts(g.result) > perTable / 2)}<td class="to-pt-elo">${w.rating || ''}</td>${pts(r, w)}<td class="to-pt-res">${result}</td>${pts(r, b)}<td class="to-pt-tit">${tit(b)}</td>${cellName(b, g.result && whitePts(g.result) < perTable / 2)}<td class="to-pt-elo">${b.rating || ''}</td></tr>`;
    }).join('');
    const rests = byes.map(g => { const w = info(g.white);
      return `<tr class="to-pt-bye${g.white === t.me ? ' mine' : ''}"><td class="to-pt-num"></td><td class="to-pt-tit">${tit(w)}</td>${cellName(w, false)}<td class="to-pt-elo">${w.rating || ''}</td>${pts(r, w)}<td class="to-pt-res"><span class="to-pt-score">${g.rest ? '0' : perTable}</span></td><td class="to-pt-pts"></td><td class="to-pt-tit"></td><td class="to-pt-name to-pt-rest" colspan="2">${g.rest ? 'Descansa' : /retirad/i.test(g.reason || '') ? 'Rival retirado' : 'Descansa'}</td></tr>`; }).join('');
    return head + rows + rests;
  }).join('');
  $('to-presencial-matches').innerHTML = rounds.length ? `<div class="to-pt-wrap"><table class="to-pt"><thead><tr><th class="to-pt-num">Mesa</th><th class="to-pt-tit">Tít.</th><th>Blancas</th><th class="to-pt-elo">ELO</th><th class="to-pt-pts" title="Puntos antes de la ronda">Pts</th><th class="to-pt-res">Resultado</th><th class="to-pt-pts" title="Puntos antes de la ronda">Pts</th><th class="to-pt-tit">Tít.</th><th>Negras</th><th class="to-pt-elo">ELO</th></tr></thead><tbody>${body}</tbody></table></div>` : '';
}
function renderMatches() {
  // Arena: solo las partidas en juego, de la más reciente a la más antigua; al terminar, desaparecen de la lista.
  const list = arena(state) ? [...state.games].reverse().filter(g => !g.result && !g.bye && g.fen) : state.games.filter(g => g.round === viewedRound);
  $('to-matches').innerHTML = list.map(g => g.bye
    ? `<div class="to-match bye"><span>${esc(name(g.white))}</span><strong>Descanso · +1</strong></div>`
    : !g.result && g.fen
      ? `<button type="button" data-watch="${g.id}" class="to-live ${g.id === state.game?.id ? 'selected' : ''} ${g.white === state.me || g.black === state.me ? 'mine' : ''}" aria-label="Ver ${esc(name(g.white))} contra ${esc(name(g.black))}, en juego"><span class="to-live-name">${g.berserkB ? '<b class="to-bz" title="Berserk">⚡</b>' : ''}${esc(name(g.black))}</span>${miniBoard(g)}<span class="to-live-name">${g.berserkW ? '<b class="to-bz" title="Berserk">⚡</b>' : ''}${esc(name(g.white))}</span></button>`
      : `<button type="button" data-watch="${g.id}" class="to-match ${g.id === state.game?.id ? 'selected' : ''} ${g.white === state.me || g.black === state.me ? 'mine' : ''}"><span>♔ ${esc(name(g.white))}${g.berserkW ? ' ⚡' : ''}</span><strong>${g.result ? esc(g.result.replace('1/2-1/2', '½–½')) : 'en juego'}</strong><span>${g.berserkB ? '⚡ ' : ''}${esc(name(g.black))} ♚</span></button>`).join('') || `<p class="muted">${arena(state) && state.status === 'playing' ? 'Ahora mismo no hay partidas en juego.' : arena(state) && state.status === 'finished' ? 'El torneo ha terminado.' : 'Los tableros aparecerán al comenzar la primera ronda.'}</p>`;
  $('to-matches').classList.toggle('has-live', list.some(g => !g.result && g.fen));
}
function renderControls() {
  if (!state) return;
  const t = state, mine = t.standings.find(p => p.id === t.me), ended = ['finished', 'cancelled'].includes(t.status);
  $('to-host').hidden = !t.host || ended;
  $('to-sound').hidden = presencial(t);
  $('to-key-edit').hidden = presencial(t);
  $('to-host-key').hidden = presencial(t);
  $('to-host-edit').hidden = t.status !== 'waiting' && !t.editable;
  $('to-start').hidden = t.status !== 'waiting'; $('to-start').disabled = !connected || t.count < 2;
  $('to-cancel').disabled = !connected;
  $('to-presencial-reset').disabled = !connected;
  $('to-host-key').innerHTML = t.joinKey ? `<svg class="to-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>Clave: <strong>${esc(t.joinKey)}</strong>` : 'Sin clave: cualquiera con el enlace puede inscribirse';
  $('to-key-edit').textContent = t.joinKey ? 'Cambiar clave' : 'Poner clave'; $('to-key-edit').disabled = !connected;
  $('to-pause').hidden = !arena(t) || !mine?.active || ended;
  $('to-pause').textContent = mine?.paused ? 'Entrar en el torneo' : 'Salir del torneo'; $('to-pause').disabled = !connected;
  $('to-withdraw').hidden = !mine?.active || ended; $('to-withdraw-label').textContent = t.status === 'waiting' ? 'Cancelar inscripción' : 'Retirarme del torneo';
  $('to-withdraw').disabled = !connected;
  $('to-join-form').querySelector('button').disabled = !connected;
  const g = t.game, ownGame = g && (g.white === t.me || g.black === t.me);
  $('to-game-actions').hidden = !g || !ownGame || !!g.result;
  $('to-offer').disabled = !connected || g?.offer === t.me || pending;
  const offerLabel = g?.offer === t.me ? 'Tablas ofrecidas al rival' : 'Ofrecer tablas';
  $('to-offer').title = offerLabel; $('to-offer').setAttribute('aria-label', offerLabel);
  $('to-resign').disabled = !connected || pending;
  const color = g && (g.white === t.me ? 'w' : g.black === t.me ? 'b' : null), berserked = color && (color === 'w' ? g.berserkW : g.berserkB);
  $('to-berserk').hidden = !arena(t) || !color || !!g.result || !!berserked || g.moves.length >= (color === 'w' ? 1 : 2);
  $('to-berserk').disabled = !connected || pending;
  $('to-draw-offer').hidden = !g || !!g.result || !ownGame || !g.offer || g.offer === t.me;
  $('to-accept').disabled = !connected; $('to-decline').disabled = !connected;
  $('to-all-pgn').hidden = presencial(t) || !ended || !t.games.some(g => !g.bye);
  // Reto terminado: cualquiera de los dos puede pedir la revancha (mismo ritmo, colores cambiados).
  $('to-rematch-box').hidden = !t.challenge || !g || !ownGame || !g.result || t.status !== 'finished';
  if ($('to-rematch-box').hidden) { rematch = null; $('to-rematch-msg').textContent = ''; }
  $('to-rematch').textContent = rematch ? 'Cancelar revancha' : 'Revancha';
  scheduleGameFit();
}
// Revancha: se manda como un reto normal al rival, que tiene esta misma página abierta.
let rematch = null;
function rematchNote(text) { $('to-rematch-msg').textContent = text; }
$('to-rematch').addEventListener('click', () => {
  const g = state?.game; if (!g) return;
  if (rematch) { sendReto({ type: 'cancelar', id: rematch.id }); rematch = null; rematchNote('Revancha cancelada.'); renderControls(); return; }
  const mine = g.white === state.me ? 'w' : 'b', rival = name(mine === 'w' ? g.black : g.white);
  if (!sendReto({ type: 'retar', nick: rival, minutes: state.minutes, increment: state.increment, games: isMatch(state) ? state.rounds : 1, color: mine === 'w' ? 'b' : 'w', revancha: true })) { rematchNote('Sin conexión con el servidor. Espera un momento y vuelve a probar.'); return; }
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
// Se puede premover cuando juegas esta partida y no te toca (o tu jugada aún no la ha confirmado el servidor).
function canPremove() { const g = state?.game; return !!g && connected && !g.result && !replay && !!myColor() && !canMove(); }
function shownFen() { const g = state.game; return optimistic?.game === g.id ? optimistic.fen : g.fen; }
// Destinos de un premovimiento: todo lo que alcanza la pieza sin mirar qué hay en medio ni en la casilla (también las propias,
// para recapturar), porque el rival aún va a mover. Al llegar tu turno solo se juega si es legal.
function premoveDests(from) {
  const pieces = fenPieces(shownFen()), piece = pieces[from], me = myColor();
  if (!piece || piece[0] !== me) return [];
  const f = from.charCodeAt(0) - 97, r = Number(from[1]) - 1, out = [];
  const add = (df, dr) => {
    const x = f + df, y = r + dr;
    if (x < 0 || x > 7 || y < 0 || y > 7) return false;
    const sq = String.fromCharCode(97 + x) + (y + 1);
    out.push(sq);
    return true;
  };
  const ray = (df, dr) => { for (let k = 1; add(df * k, dr * k); k++); };
  const kind = piece[1], dir = me === 'w' ? 1 : -1;
  if (kind === 'P') { add(0, dir); if (r === (me === 'w' ? 1 : 6)) add(0, 2 * dir); add(-1, dir); add(1, dir); }
  if (kind === 'N') for (const [a, b] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(a, b);
  if (kind === 'B' || kind === 'Q') for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ray(a, b);
  if (kind === 'R' || kind === 'Q') for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ray(a, b);
  if (kind === 'K') {
    for (const [a, b] of [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]]) add(a, b);
    const home = me === 'w' ? '1' : '8';
    if (from === 'e' + home) for (const sq of ['g' + home, 'c' + home]) if (!out.includes(sq)) out.push(sq);
  }
  return out;
}
// Pieza elegida mientras se preparaba un premovimiento: sigue elegida al llegar la jugada (propia o del rival) si continúa en su casilla.
function keepSelection(fen) { return !!selected && !!myColor() && fenPieces(fen)[selected]?.[0] === myColor(); }
function setPremove(from, to) { premove = { game: state.game.id, from, to }; selected = null; boardKey = ''; renderBoard(); }
function cancelPremove() { if (!premove && !selected) return false; premove = null; selected = null; boardKey = ''; renderBoard(); return true; }
// Te toca: si el premovimiento es legal en la posición nueva, se juega al momento (coronando en dama); si no, se descarta.
function playPremove() {
  if (!premove || !canMove()) return;
  const g = state.game, p = premove; premove = null; boardKey = '';
  if (p.game !== g.id || !g.legal.some(m => m.from === p.from && m.to === p.to)) { renderBoard(); return; }
  skipSlide = true; move(p.from, p.to, 'q');
}
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
    ? arenaClosing(t) ? ['Esperando las últimas partidas', 'El tiempo ha terminado. Las partidas en juego cuentan para la clasificación final, que se decidirá cuando terminen todas.']
      : mine.paused ? ['Has salido del torneo', 'No se te empareja y conservas tus puntos. Pulsa «Entrar en el torneo» cuando quieras seguir.']
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
  const status = g.result ? `${g.result.replace('1/2-1/2', '½–½')} · ${g.reason}` : pending ? 'Turno de tu rival' : !connected ? 'Recuperando conexión. Tu reloj sigue corriendo.' : canMove() ? 'Tu turno' : own ? 'Turno de tu rival' : `Juegan ${g.turn === 'w' ? 'blancas' : 'negras'}`;
  // Con la partida terminada, el resultado se ve en grande sobre el tablero, como una marca de agua.
  if (g.result) $('to-board').dataset.result = g.result.replace('1/2-1/2', '½–½'); else delete $('to-board').dataset.result;
  $('to-game-status').textContent = status; $('to-game-status').classList.toggle('my-turn', canMove());
  // En tu partida no hace falta «Tu turno» / «Turno de tu rival»: lo indica el reloj en verde.
  // Con la partida terminada basta la marca de agua: fuera el texto del resultado y el repaso.
  $('to-game-status').hidden = !!g.result || (own && connected);
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
  scheduleGameFit();
}
// El tablero usa el menor espacio disponible entre ancho y alto. Se miden los
// relojes y controles reales, incluidos los botones que pasan a una segunda fila.
function scheduleGameFit() {
  if (gameFitFrame !== null) return;
  gameFitFrame = requestAnimationFrame(() => { gameFitFrame = null; fitGame(); });
}
function fitGame() {
  placeGameActions();
  const panel = $('to-game-panel'), room = $('to-room');
  if (boardsMode || panel.hidden || !document.body.classList.contains('to-focus')) {
    panel.style.removeProperty('--to-game-width');
    panel.style.removeProperty('--to-board-size');
    room.style.removeProperty('--to-play-height');
    room.style.removeProperty('--to-standings-height');
    return;
  }
  const column = panel.parentElement, board = $('to-board');
  if (!column.clientWidth) return;
  const viewportHeight = window.visualViewport?.height || innerHeight;
  const top = panel.getBoundingClientRect().top + scrollY;
  const availableHeight = Math.max(0, viewportHeight - top - 16);
  const style = getComputedStyle(panel);
  const edges = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const width = Math.min(640, column.clientWidth);
  panel.style.setProperty('--to-game-width', `${width}px`);
  let size = Math.min(width - edges, parseFloat(style.getPropertyValue('--to-board-max-size')));
  panel.style.setProperty('--to-board-size', `${size}px`);
  const actions = $('to-game-actions'), buttons = [...actions.children].filter(button => !button.hidden);
  const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
  const buttonsWidth = actions.hidden || !panel.contains(actions) ? 0 : buttons.reduce((sum, button) => sum + button.getBoundingClientRect().width, 0) + gap * Math.max(0, buttons.length - 1);
  const minimumPanelWidth = Math.min(width, Math.max(260, buttonsWidth + edges + 2));
  // Mantener espacio para los botones: reducir el tablero no debe apilarlos innecesariamente.
  for (let i = 0; i < 5; i++) {
    const overhead = panel.getBoundingClientRect().height - board.getBoundingClientRect().height;
    const next = Math.min(size, Math.floor(Math.max(160, availableHeight - overhead)));
    panel.style.setProperty('--to-game-width', `${Math.min(width, Math.max(minimumPanelWidth, next + edges))}px`);
    panel.style.setProperty('--to-board-size', `${next}px`);
    if (next >= size - .5 && panel.getBoundingClientRect().height <= availableHeight + .5) break;
    size = next;
  }
  const boardRect = board.getBoundingClientRect(), sidebar = room.querySelector('.to-sidebar');
  // En dos columnas, la clasificación nunca baja más allá del borde del tablero.
  const sidebarHeight = Math.max(0, boardRect.bottom - sidebar.getBoundingClientRect().top);
  room.style.setProperty('--to-play-height', `${Math.floor(Math.min(availableHeight, sidebarHeight))}px`);
  room.style.setProperty('--to-standings-height', `${Math.floor(boardRect.height)}px`);
}
function placeGameActions() {
  const actions = $('to-game-actions');
  // Con dos columnas, quedan entre la información y la clasificación. En móvil,
  // siguen junto al tablero para que los controles de la partida estén a mano.
  const before = matchMedia('(min-width: 761px)').matches ? $('to-duel') : $('to-rematch-box');
  if (actions.parentElement !== before.parentElement || actions.nextElementSibling !== before) before.before(actions);
}
function renderBoard() {
  const g = state?.game; if (!g) return;
  const shown = optimistic?.game === g.id ? optimistic : null;
  const fen = g.result && replay ? replay[replayPly] : shown ? shown.fen : g.fen;
  const lastMove = shown ? shown.lastMove : g.lastMove;
  const pre = premove?.game === g.id ? premove : null, premoving = canPremove();
  const key = [g.id, fen, flipped, selected, canMove(), premoving, pre?.from, pre?.to, lastMove?.from, lastMove?.to].join('|');
  if (boardKey === key) return; boardKey = key;
  // Deslizar la pieza que se acaba de mover, en lugar de que salte de casilla.
  const slideMove = !skipSlide && rendered.game === g.id && rendered.fen && rendered.fen !== fen && lastMove ? lastMove : null;
  const prevFen = rendered.fen; rendered = { game: g.id, fen }; skipSlide = false;
  const activeSquare = document.activeElement?.closest('#to-board [data-square]')?.dataset.square;
  const pieces = fenPieces(fen), order = Array.from({ length: 64 }, (_, i) => flipped ? 63 - i : i);
  const targets = !selected ? [] : premoving ? premoveDests(selected) : g.legal.filter(m => m.from === selected).map(m => m.to);
  const last = !g.result || replayPly === g.moves.length ? lastMove : null;
  $('to-board').innerHTML = order.map((index, i) => {
    const row = Math.floor(index / 8), col = index % 8, sq = 'abcdefgh'[col] + (8 - row), piece = pieces[sq];
    const desc = piece ? `${pieceNames[piece[1].toLowerCase()]} de ${piece[0] === 'w' ? 'blancas' : 'negras'}` : 'vacía';
    return `<button type="button" class="to-square ${(row + col) % 2 ? 'dark ' : ''}${sq === selected ? 'selected ' : ''}${targets.includes(sq) ? 'target ' : ''}${last && (sq === last.from || sq === last.to) ? 'last ' : ''}${pre && (sq === pre.from || sq === pre.to) ? 'premove' : ''}" data-square="${sq}" tabindex="${sq === (activeSquare || (flipped ? 'h8' : 'a1')) ? 0 : -1}" aria-label="${sq}: ${desc}${targets.includes(sq) ? ', destino posible' : ''}${pre && sq === pre.to ? ', premovimiento' : ''}" aria-pressed="${sq === selected}">${piece ? `<canvas data-piece="${piece}" aria-hidden="true" width="80" height="80"></canvas>` : ''}${i % 8 === 0 ? `<span class="to-coordinate rank">${8 - row}</span>` : ''}${i >= 56 ? `<span class="to-coordinate file">${'abcdefgh'[col]}</span>` : ''}</button>`;
  }).join('');
  for (const canvas of $('to-board').querySelectorAll('canvas')) paint(canvas, canvas.dataset.piece);
  if (activeSquare) $('to-board').querySelector(`[data-square="${activeSquare}"]`)?.focus({ preventScroll: true });
  $('to-board').classList.toggle('can-move', canMove() || premoving);
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
  if (canPremove()) { premoveClick(square); return; }
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
function premoveClick(square) {
  const mine = fenPieces(shownFen())[square]?.[0] === myColor();
  if (premove) {
    const p = premove; premove = null; boardKey = '';
    if (square === p.from || square === p.to || !mine) { selected = null; renderBoard(); return; }
  }
  if (selected && selected !== square && premoveDests(selected).includes(square)) { setPremove(selected, square); return; }
  selected = selected === square || !mine ? null : square;
  boardKey = ''; renderBoard();
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
  const closing = arenaClosing(t, now);
  if (closing !== lastArenaClosing) { lastArenaClosing = closing; renderWaiting(); }
  const me = t.standings.find(p => p.id === t.me);
  // En la sala de espera la cuenta atrás grande ya dice cuándo empieza.
  $('to-phase').textContent = isMatch(t) && t.status === 'between' ? `Siguiente partida en ${Math.max(0, Math.ceil((t.nextRoundAt - now) / 1000))} s`
    : isMatch(t) && t.status === 'playing' ? `Partida ${t.round} de ${t.rounds}`
    : isMatch(t) && t.status === 'finished' ? 'Match terminado'
    : t.status === 'waiting' || t.challenge ? ''
    : arena(t) && t.status === 'playing' ? (closing ? 'Tiempo cumplido: esperando las últimas partidas, que cuentan para la clasificación final' : t.pairingsCloseAt && now >= t.pairingsCloseAt ? (me?.active && !me.playing ? 'Ya no hay emparejamientos nuevos' : '') : me?.active && !me.playing && !me.paused ? 'Buscando rival…' : '')
    : t.status === 'between' ? (presencial(t) ? `Ronda ${t.round} completada · Esperando a la organización` : `Siguiente ronda en ${Math.max(0, Math.ceil((t.nextRoundAt - now) / 1000))} s`) : t.status === 'playing' ? `Ronda ${t.round} de ${t.rounds}` : t.status === 'finished' ? 'Clasificación final' : 'Torneo cancelado';
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
    $('to-wait-date').textContent = t.startsAt ? date(t.startsAt) : `${listed(t).length} de ${t.capacity} plazas ocupadas`;
  }
  if (!$('to-registration').hidden && !canJoin(t)) render();
  const playingNow = !!t.me && t.games.some(x => !x.result && !x.bye && (x.white === t.me || x.black === t.me));
  if (!$('to-focus-next').hidden) $('to-focus-status').textContent = closing ? (playingNow ? 'Tu partida cuenta para la clasificación final' : 'Esperando las últimas partidas') : me?.paused ? 'Has salido del torneo' : playingNow ? 'Partida en juego' : $('to-phase').textContent || 'Partida terminada';
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
  $('to-confirm-yes').textContent = label; $('to-confirm-no').textContent = cancel; $('to-confirm-no').hidden = false;
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

let clearStandingsPrint = null;
function printStandings() {
  if (!state) return;
  const t = state, view = standingsView(t);
  if (!view.rows.length) return;
  clearStandingsPrint?.();
  const keys = view.initial || arena(t) ? [] : (t.tiebreaks?.length ? t.tiebreaks : closed(t) ? ['sb'] : ['bh']).filter(k => TB[k]).slice(0, 2);
  const number = n => n == null ? '-' : Number.isInteger(n) || n % 1 === .5 ? formatPoints(n) : n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  const extraHeaders = view.initial ? '' : '<th>Pts</th>' + (arena(t) ? '<th>PJ</th>' : keys.map(k => `<th>${esc(TB[k][1])}</th>`).join(''));
  const rows = view.rows.map((p, i) => `<tr><td>${i + 1}</td><td class="to-print-name">${p.title ? esc(p.title) + ' ' : ''}${esc(p.name)}${p.fed ? `<small>${esc(p.fed)}</small>` : ''}</td><td>${fideRating(p) || '-'}</td>${view.initial ? '' : `<td><strong>${formatPoints(p.points)}</strong></td>${arena(t) ? `<td>${p.played}</td>` : keys.map(k => `<td>${esc(number(p.tb?.[k]))}</td>`).join('')}`}</tr>`).join('');
  const note = view.initial ? 'Ordenados por Elo FIDE, de mayor a menor. Los jugadores sin Elo FIDE figuran al final.' : $('to-tiebreak').textContent;
  const sheet = document.createElement('section'); sheet.id = 'to-print-sheet'; sheet.setAttribute('aria-hidden', 'true');
  sheet.innerHTML = `<header><p class="to-print-brand">APEJUPO · CHESS CLUB</p><h1>${esc(t.title)}</h1><h2>${esc(view.title)}</h2><p class="to-print-meta">${esc(formatLabel(t))} · ${t.minutes} + ${t.increment} · ${view.rows.length} participantes</p></header><table><thead><tr><th>N.º</th><th class="to-print-name">Jugador</th><th>Elo FIDE</th>${extraHeaders}</tr></thead><tbody>${rows}</tbody></table><p class="to-print-note">${esc(note)}</p>`;
  document.body.append(sheet); document.body.classList.add('to-printing-standings');
  const cleanup = () => {
    sheet.remove(); document.body.classList.remove('to-printing-standings');
    removeEventListener('afterprint', cleanup); clearStandingsPrint = null;
  };
  clearStandingsPrint = cleanup; addEventListener('afterprint', cleanup, { once: true });
  try { window.print(); }
  catch { cleanup(); message('No se pudo abrir la impresión en este navegador.', true); }
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
  closed: 'Todos contra todos, una vez cada uno. Las rondas salen del número de inscritos.',
  'double-closed': 'Todos contra todos a doble vuelta: una partida con blancas y otra con negras contra cada rival.'
};
const modeFormats = {
  online: [['arena', 'Arena (tiempo máximo)'], ['swiss', 'Sistema suizo'], ['closed', 'Round-Robin']],
  presencial: [['swiss', 'Sistema suizo'], ['closed', 'Round-Robin'], ['double-closed', 'Round-Robin doble vuelta']]
};
function syncMode(format = $('to-format').value) {
  const physical = $('to-mode').value === 'presencial', options = modeFormats[physical ? 'presencial' : 'online'];
  $('to-mode-switch').setAttribute('aria-checked', String(physical));
  $('to-format').innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  $('to-format').value = options.some(([value]) => value === format) ? format : options[0][0];
  $('to-create-hint').textContent = physical ? 'Se juega en el club. La organización inscribe a los jugadores, genera las rondas y anota los resultados.' : 'Las inscripciones serán públicas. Tú decides cuándo empieza.';
  $('to-start-help').textContent = physical ? 'Fecha y hora previstas. El organizador inicia el torneo y cada ronda.' : 'Hora local de tu dispositivo. Sin día: inicio manual por el organizador.';
  $('to-join-key-field').hidden = physical; $('to-join-key-new').disabled = physical;
  $('to-capacity-field').hidden = physical; $('to-capacity').disabled = physical;
  $('to-create-submit').textContent = editingId ? 'Guardar cambios' : physical ? 'Crear torneo presencial' : 'Crear y abrir inscripciones';
  syncFormat();
}
function syncFormat() {
  const format = $('to-format').value, isArena = format === 'arena', noRounds = format !== 'swiss';
  $('to-format-help').textContent = formatHelp[format];
  $('to-rounds-field').hidden = noRounds; $('to-rounds').disabled = noRounds;
  $('to-duration-field').hidden = !isArena; $('to-duration').disabled = !isArena;
  // Al cambiar de familia (suizo ↔ Round-Robin ↔ arena) se ponen los desempates habituales de la nueva.
  if (!tbState || tbState.family !== tbFamily(format)) tbReset(format);
}
// ——— Desempates del torneo (suizo y Round-Robin): los habituales o un orden propio ———
const TB = {
  bh1: ['Buchholz -1', 'BH-1', 'Suma de los puntos de los rivales, sin el peor'],
  bh: ['Buchholz', 'BH', 'Suma de los puntos de los rivales'],
  sb: ['Sonneborn-Berger', 'SB', 'Puntos de los rivales ganados y la mitad de los empatados'],
  prog: ['Progresivo', 'PROG', 'Suma de la puntuación acumulada tras cada ronda'],
  de: ['Encuentro directo', 'ED', 'Resultado entre los empatados, si todos jugaron entre sí'],
  win: ['Victorias', 'V', 'Número de victorias'],
  bwin: ['Victorias con negras', 'VN', 'Victorias jugando con las piezas negras'],
  koya: ['Koya', 'KS', 'Puntos contra los rivales con al menos la mitad de los puntos'],
  aro: ['Media de Elo de los rivales', 'ARO', 'Elo medio de los rivales']
};
const TB_MAX = 5;
const tbFamily = format => format === 'arena' ? 'arena' : format === 'swiss' ? 'swiss' : 'closed';
const TB_ALLOWED = { swiss: ['bh1', 'bh', 'sb', 'prog', 'de', 'win', 'bwin', 'aro'], closed: ['de', 'sb', 'win', 'bwin', 'koya', 'aro'], arena: [] };
const TB_DEFAULT = { swiss: ['bh1', 'bh', 'sb', 'prog'], closed: ['de', 'sb', 'win', 'koya'], arena: [] };
let tbState = null; // { family, order: todos los permitidos en su orden, on: Set de los elegidos }
function tbReset(format, chosen) {
  const family = tbFamily(format), allowed = TB_ALLOWED[family];
  const on = (chosen?.length ? chosen : TB_DEFAULT[family]).filter(k => allowed.includes(k)).slice(0, TB_MAX);
  tbState = { family, order: [...on, ...allowed.filter(k => !on.includes(k))], on: new Set(on) };
  drawTb();
}
const tbChosen = () => tbState ? tbState.order.filter(k => tbState.on.has(k)) : [];
function drawTb() {
  const show = tbState && tbState.family !== 'arena';
  $('to-tb-field').hidden = !show;
  if (!show) return;
  $('to-tb-summary').innerHTML = tbChosen().map(k => `<li data-tb="${k}" tabindex="0" title="${esc(TB[k][2])}. Arrástralo para cambiar el orden (o usa ← y →).">${esc(TB[k][0])}</li>`).join('');
  let n = 0;
  $('to-tb-items').innerHTML = tbState.order.map((k, i) => {
    const on = tbState.on.has(k);
    return `<li class="${on ? 'on' : ''}" data-tb="${k}"><span class="to-tb-grip" aria-hidden="true">⠿</span><label><input type="checkbox" data-tb-on="${k}"${on ? ' checked' : ''}><span class="to-tb-num">${on ? ++n : ''}</span><span><strong>${esc(TB[k][0])}</strong><small>${esc(TB[k][2])}</small></span></label><span class="to-tb-move"><button type="button" data-tb-move="${k}" data-dir="-1" aria-label="Subir ${esc(TB[k][0])}"${i ? '' : ' disabled'}>▲</button><button type="button" data-tb-move="${k}" data-dir="1" aria-label="Bajar ${esc(TB[k][0])}"${i < tbState.order.length - 1 ? '' : ' disabled'}>▼</button></span></li>`;
  }).join('');
}
$('to-tb-toggle').addEventListener('click', () => {
  const open = $('to-tb-list').hidden;
  $('to-tb-list').hidden = !open; $('to-tb-toggle').setAttribute('aria-expanded', String(open));
  $('to-tb-toggle').textContent = open ? 'Listo' : 'Personalizar';
});
$('to-tb-items').addEventListener('change', event => {
  const box = event.target.closest('[data-tb-on]'); if (!box) return;
  const k = box.dataset.tbOn;
  if (box.checked && tbState.on.size >= TB_MAX) { box.checked = false; noticeBox('Máximo 5 desempates', 'Quita alguno antes de añadir otro.'); return; }
  if (!box.checked && tbState.on.size === 1) { box.checked = true; noticeBox('Hace falta un desempate', 'Deja al menos uno marcado.'); return; }
  if (box.checked) tbState.on.add(k); else tbState.on.delete(k);
  drawTb();
});
// Arrastrar para ordenar (ratón o dedo): la etiqueta o la tarjeta sigue al puntero y al soltar queda el nuevo orden.
function sortable(list, onDrop) {
  list.addEventListener('pointerdown', event => {
    const item = event.target.closest('[data-tb]');
    if (!item || event.button !== 0 || event.target.closest('input, button')) return;
    event.preventDefault();
    const start = [...list.children].map(el => el.dataset.tb);
    let moved = false;
    // Se escucha en la ventana: al recolocar la tarjeta en la lista el navegador le quitaría la captura del puntero.
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      if (!moved) { moved = true; item.classList.add('to-tb-dragging'); list.classList.add('to-tb-sorting'); }
      // Delante de la primera que quede «después» del puntero, en orden de lectura.
      const target = [...list.children].find(el => {
        if (el === item) return false;
        const r = el.getBoundingClientRect();
        return e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2 && list.id === 'to-tb-summary') || (list.id !== 'to-tb-summary' && e.clientY < r.top + r.height / 2);
      });
      list.insertBefore(item, target || null);
    };
    const end = e => {
      if (e.pointerId !== event.pointerId) return;
      removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end);
      item.classList.remove('to-tb-dragging'); list.classList.remove('to-tb-sorting');
      const keys = [...list.children].map(el => el.dataset.tb);
      if (moved && keys.join() !== start.join()) onDrop(keys); else if (!moved && list.id === 'to-tb-items') item.querySelector('input')?.click();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  });
}
sortable($('to-tb-summary'), keys => { tbState.order = [...keys, ...tbState.order.filter(k => !tbState.on.has(k))]; drawTb(); });
sortable($('to-tb-items'), keys => { tbState.order = keys; drawTb(); });
$('to-tb-summary').addEventListener('keydown', event => {
  const item = event.target.closest('[data-tb]'); if (!item || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const keys = tbChosen(), i = keys.indexOf(item.dataset.tb), j = i + (event.key === 'ArrowRight' ? 1 : -1);
  if (j < 0 || j >= keys.length) return;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  tbState.order = [...keys, ...tbState.order.filter(k => !tbState.on.has(k))]; drawTb();
  $('to-tb-summary').querySelector(`[data-tb="${item.dataset.tb}"]`)?.focus();
});
$('to-tb-items').addEventListener('click', event => {
  const b = event.target.closest('[data-tb-move]'); if (!b) return;
  const i = tbState.order.indexOf(b.dataset.tbMove), j = i + Number(b.dataset.dir);
  if (j < 0 || j >= tbState.order.length) return;
  [tbState.order[i], tbState.order[j]] = [tbState.order[j], tbState.order[i]];
  drawTb();
  $('to-tb-items').querySelector(`[data-tb-move="${b.dataset.tbMove}"][data-dir="${b.dataset.dir}"]`)?.focus();
});
$('to-format').addEventListener('change', syncFormat);
$('to-mode-switch').addEventListener('click', () => {
  const previous = $('to-mode').value;
  createModeChoices[previous] = { format: $('to-format').value, minutes: $('to-minutes').value, increment: $('to-increment').value, day: $('to-start-day').value, time: $('to-start-time').value };
  const next = previous === 'presencial' ? 'online' : 'presencial';
  $('to-mode').value = next;
  const choice = createModeChoices[next] || (next === 'presencial' ? { format: 'double-closed', minutes: '3', increment: '2', day: localDay(new Date()), time: '17:00' } : { format: 'arena', minutes: '5', increment: '3', day: '', time: '' });
  syncMode(choice.format); $('to-minutes').value = choice.minutes; $('to-increment').value = choice.increment;
  $('to-start-day').value = choice.day; $('to-start-time').value = choice.time;
});
$('to-refresh').addEventListener('click', loadLobby);
// El mismo formulario sirve para crear y para editar (editingId = torneo que se edita).
function setCreateMode(id) {
  editingId = id;
  createModeChoices = {};
  $('to-create-heading').textContent = id ? 'Editar torneo' : 'Organizar un torneo';
  $('to-create-submit').textContent = id ? 'Guardar cambios' : 'Crear y abrir inscripciones';
  // Para editar basta con ser el organizador: no se pide la clave de organización.
  $('to-key-field').hidden = !!id || !keyFieldRequired; $('to-key').disabled = $('to-key').required = !id && keyFieldRequired;
  $('to-create-error').hidden = true; $('to-start-day').min = localDay(new Date());
}
$('to-create-open').addEventListener('click', () => {
  // Como en Lichess: organiza cualquiera con su cuenta (y el correo confirmado).
  const user = currentUser();
  if (!user) { message('Entra con tu cuenta para organizar un torneo.'); openAuth('entrar'); return; }
  if (!user.verified) { message('Confirma tu correo para organizar torneos: abre el enlace que te enviamos. Si no te llegó, pídelo de nuevo desde el menú de tu cuenta.', true); return; }
  $('to-create-form').reset(); $('to-mode').value = 'online'; setCreateMode(null); tbState = null; syncMode('arena');
  $('to-tb-list').hidden = true; $('to-tb-toggle').textContent = 'Personalizar'; $('to-tb-toggle').setAttribute('aria-expanded', 'false');
  $('to-create-dialog').showModal();
  // Al crear, la clave empieza en blanco aunque el navegador intente autorrellenarla.
  setTimeout(() => { if (!editingId) $('to-join-key-new').value = ''; }, 50);
});
async function openEdit(id) {
  const c = await (await request(`/api/tournaments/${id}/config`, { method: 'POST', key: managementKey(id), body: JSON.stringify({ hostToken: read(hostKey(id)) }) })).json();
  const form = $('to-create-form'); form.reset(); setCreateMode(id);
  $('to-mode').value = c.mode || 'online'; tbState = null; syncMode(c.format); tbReset(c.format, c.tiebreaks);
  $('to-tb-list').hidden = true; $('to-tb-toggle').textContent = 'Personalizar'; $('to-tb-toggle').setAttribute('aria-expanded', 'false');
  form.title.value = c.title; $('to-minutes').value = c.minutes; $('to-increment').value = c.increment;
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
    const fields = { title: data.get('title'), mode: data.get('mode'), format: data.get('format'), minutes: Number(data.get('minutes')), increment: Number(data.get('increment')), rounds: data.get('format') === 'swiss' ? Number(data.get('rounds')) : null, duration: isArena ? Number(data.get('duration')) : null, capacity: data.get('mode') === 'presencial' ? 128 : Number(data.get('capacity')), startsAt, joinKey: data.get('joinKey') || '' , ...(isArena ? {} : { tiebreaks: tbChosen() }) };
    if (editingId) {
      await request(`/api/tournaments/${editingId}/edit`, { method: 'POST', key: managementKey(editingId), body: JSON.stringify({ ...fields, hostToken: read(hostKey(editingId)) }) });
      $('to-create-dialog').close(); message('Cambios guardados.'); if (!roomId) await loadLobby(); return;
    }
    const res = await (await request('/api/tournaments', { method: 'POST', key: session(), body: JSON.stringify({ ...fields, hostToken }) })).json();
    write(hostKey(res.id), hostToken); $('to-key').value = ''; location.href = 'jugar-torneo.html?id=' + res.id;
  } catch (e) { $('to-create-error').hidden = false; $('to-create-error').textContent = e.message; }
  finally { button.disabled = false; }
});
$('to-join-account').addEventListener('click', () => openAuth('entrar'));
addEventListener('apejupo:cuenta', () => {
  if (state) render();
  // Si se entra en la cuenta con el torneo ya abierto, hay que volver a identificarse en la sala.
  if (roomId && connected && !boardsMode) hello();
  else if (!roomId) loadLobby();
});
addEventListener('storage', event => {
  if (event.key === 'apejupoAdminCuentas' && roomId && connected && !boardsMode) hello();
});
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
  if (await confirmAction('Empezar torneo', presencial(state) ? `Se cerrarán las inscripciones y se generará la primera ronda para ${state.count} jugadores. Las partidas se juegan en los tableros del club.` : arena(state) ? `Se cerrarán las inscripciones y empezará la cuenta atrás de ${duration(state.duration)}. Se emparejará a los jugadores que tengan la página abierta.` : `Se cerrarán las inscripciones y arrancarán los relojes de ${state.count} jugadores. Las rondas se ajustarán al número de inscritos.`, false)) { message(''); send({ type: 'start' }); }
});
// ——— Inscripción presencial: buscador FIDE/FADA, lista pegada, QR y solicitudes ———
const pzSvg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const pzIcons = {
  plus: pzSvg('<path d="M12 5v14M5 12h14"/>'),
  edit: pzSvg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: pzSvg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>'),
  check: pzSvg('<path d="m5 12 5 5 9-10"/>'),
  x: pzSvg('<path d="M6 6l12 12M18 6 6 18"/>'),
  out: pzSvg('<path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M16 8l4 4-4 4M9 12h11"/>')
};
let askChanging = false;
// Iniciales: en las listas va «Apellidos, Nombre».
function initials(n) {
  const [last, first] = n.includes(',') ? n.split(',').map(x => x.trim()) : [n.split(' ').slice(1).join(' '), n.split(' ')[0]];
  return (((first || '')[0] || '') + ((last || '')[0] || '')).toUpperCase() || n.slice(0, 2).toUpperCase();
}
const chip = (kind, value) => `<span class="to-pz-chip ${kind.toLowerCase()}">${kind} ${value}</span>`;
const ratingChips = p => p.fide || p.fada ? (p.fide ? chip('FIDE', p.fide) : '') + (p.fada ? chip('FADA', p.fada) : '') : p.rating ? chip(p.source || 'Elo', p.rating) : '<span class="to-pz-chip none">Sin Elo</span>';
// Foto (por número FIDE, como en la tabla de Elo) y bandera de la federación.
const pzAvatar = p => `<span class="to-pz-avatar" aria-hidden="true"${p.fideId ? ` data-fid="${esc(p.fideId)}"` : ''}>${esc(initials(p.name))}</span>`;
// Bandera y título FIDE (también los de Arena: AGM, AIM, AFM, ACM).
const pzFlag = p => (p.fed && window.U?.flag ? window.U.flag(p.fed) : '') + (p.title ? `<span class="to-pz-title${/^A[GIFC]M$/.test(p.title) ? ' arena' : ''}" title="${/^A[GIFC]M$/.test(p.title) ? 'Título Arena de la FIDE' : 'Título FIDE'}">${esc(p.title)}</span>` : '');
// Fotos de la lista: cada jugador se pide una sola vez (la lista se redibuja con cada cambio del torneo) a las
// mismas fuentes que la tabla de Elo, como mucho 4 a la vez; las que llegan se ponen en cuanto se dibuja la fila.
// Las mismas fuentes que js/util.js, por si el navegador conserva una copia antigua de util.js.
const PZ_FUENTES = ['https://chessrival-api.chessrival-worker.workers.dev/api/fide/foto?id=', 'https://chessrival.net/api/fide/foto?id=', 'https://apejupo-eventos.chessrival-worker.workers.dev/?foto='];
const pzFotoCache = new Map(), pzFotoCola = [];
let pzFotoActivas = 0;
function pzFotoSiguiente() {
  while (pzFotoActivas < 4 && pzFotoCola.length) {
    const [fid, resolve] = pzFotoCola.shift(), fuentes = window.U?.fotoFuentes || PZ_FUENTES;
    pzFotoActivas++;
    // Las fuentes se piden a la vez y vale la primera que responda: un jugador sin foto no frena a los demás.
    const intento = vuelta => {
      let pendientes = fuentes.length, hecho = false;
      const t = setTimeout(() => terminar(null), 8000);
      function terminar(src) {
        if (hecho) return; hecho = true; clearTimeout(t);
        if (!src && vuelta === 0) return intento(1); // una segunda vuelta por si fue un fallo puntual
        pzFotoActivas--; resolve(src); pzFotoSiguiente();
      }
      for (const f of fuentes) {
        const img = new Image();
        img.onload = () => terminar(img.src);
        img.onerror = () => { if (--pendientes === 0) terminar(null); };
        img.src = f + encodeURIComponent(fid);
      }
    };
    intento(0);
  }
}
// Si ninguna fuente la da (fallo puntual de red), se olvida al minuto y se vuelve a pedir en el siguiente redibujado.
const pzFoto = fid => {
  if (!pzFotoCache.has(fid)) pzFotoCache.set(fid, new Promise(resolve => { pzFotoCola.push([fid, resolve]); pzFotoSiguiente(); })
    .then(src => { if (!src) setTimeout(() => pzFotoCache.delete(fid), 60000); return src; }));
  return pzFotoCache.get(fid);
};
const pzPhotos = el => {
  if (window.U?.fotosActivas && !window.U.fotosActivas()) return;
  for (const fid of new Set([...el.querySelectorAll('.to-pz-avatar[data-fid]')].map(a => a.dataset.fid))) pzFoto(fid).then(src => {
    if (!src) return;
    for (const a of document.querySelectorAll(`.to-pz-avatar[data-fid="${CSS.escape(fid)}"]:not(.con-foto)`)) {
      const img = new Image(); img.alt = ''; img.src = src; a.textContent = ''; a.append(img); a.classList.add('con-foto');
    }
  });
};
const playerRow = (p, i, tools) => `<div class="to-pz-row">${i == null ? '' : `<span class="to-pz-num">${i + 1}</span>`}${pzAvatar(p)}<span class="to-pz-name"><strong>${pzFlag(p)}${esc(p.name)}</strong>${p.fideId ? `<small>FIDE ${esc(p.fideId)}</small>` : ''}</span><span class="to-pz-chips">${ratingChips(p)}</span><span class="to-pz-row-tools">${tools}</span></div>`;
const byRating = (a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'es');
function renderRoster(t) {
  const players = [...t.standings].sort(byRating), requests = t.requests || [];
  $('to-pz-count').textContent = `${players.length}/${t.capacity}`;
  const waiting = t.status === 'waiting' || canChangeInitialRoster(t), ended = ['finished', 'cancelled'].includes(t.status);
  const tools = p => ended ? '' : `<button type="button" class="to-pz-icon" data-pz-edit="${p.id}" aria-label="Editar a ${esc(p.name)}" title="Editar">${pzIcons.edit}</button>`
    + (waiting ? `<button type="button" class="to-pz-icon danger" data-pz-remove="${p.id}" aria-label="Quitar a ${esc(p.name)}" title="Quitar">${pzIcons.trash}</button>`
      : p.active ? `<button type="button" class="to-pz-icon danger" data-pz-active="${p.id}" data-active="false" aria-label="Retirar a ${esc(p.name)} de las próximas rondas" title="Retirar del torneo">${pzIcons.out}</button>`
        : `<button type="button" class="to-pz-tool small" data-pz-active="${p.id}" data-active="true" title="Volver a incluirlo en las próximas rondas">Reincluir</button>`);
  $('to-pz-roster').innerHTML = players.map((p, i) => playerRow(p, i, (p.active === false ? '<span class="to-pz-out">Retirado</span>' : '') + tools(p))).join('')
    || '<p class="to-pz-empty">Busca a los jugadores arriba, pega una lista o enseña el QR en la entrada.</p>';
  $('to-pz-requests').hidden = !requests.length;
  $('to-pz-req-count').textContent = requests.length || '';
  pzPhotos($('to-pz-roster'));
  $('to-pz-req-list').innerHTML = requests.map(r => playerRow(r, null, `<button type="button" class="to-pz-primary small" data-pz-approve="${r.id}">${pzIcons.check}<span>Aprobar</span></button><button type="button" class="to-pz-icon" data-pz-reject="${r.id}" aria-label="Rechazar a ${esc(r.name)}" title="Rechazar">${pzIcons.x}</button>`)).join('');
  pzPhotos($('to-pz-req-list'));
}
// Buscador con sugerencias (flechas, Intro y Esc). onPick recibe { name, rating, source, fideId }.
function attachSearch(inputId, listId, onPick, manualLabel) {
  const input = $(inputId), list = $(listId), spin = input.parentElement.querySelector('.to-pz-spin');
  let seq = 0, timer = 0, items = [], active = -1, loading = false;
  const options = () => [...list.querySelectorAll('[data-i]')];
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  function draw() {
    const text = input.value.trim();
    const manual = text.length >= 2 && !/^\d+$/.test(text) ? `<button type="button" class="to-pz-sug manual" role="option" data-i="-1"><span class="to-pz-avatar plain">${pzIcons.plus}</span><span class="to-pz-name"><strong>${manualLabel(esc(text))}</strong><small>Sin Elo; se puede editar después</small></span></button>` : '';
    list.innerHTML = items.map((p, i) => `<button type="button" class="to-pz-sug" role="option" data-i="${i}">${pzAvatar(p)}<span class="to-pz-name"><strong>${pzFlag(p)}${esc(p.name)}</strong><small>${[p.place, p.fideId ? 'FIDE ' + p.fideId : ''].filter(Boolean).map(esc).join(' · ')}</small></span><span class="to-pz-chips">${ratingChips(p)}</span></button>`).join('')
      + (loading ? '<div class="to-pz-sug-wait">Buscando en las listas FIDE y FADA…</div>' : !items.length && text.length >= 3 ? '<div class="to-pz-sug-wait">No aparece en las listas.</div>' : '') + manual;
    list.hidden = !list.innerHTML; input.setAttribute('aria-expanded', String(!list.hidden)); active = -1; pzPhotos(list);
  }
  function pick(i) {
    const p = i >= 0 ? items[i] : { name: input.value.trim(), rating: null, source: null, fideId: null };
    if (!p?.name) return;
    onPick(p); input.value = ''; items = []; close();
  }
  input.addEventListener('focus', warmUp, { once: true });
  input.addEventListener('input', () => {
    clearTimeout(timer); const mine = ++seq, text = input.value.trim(); items = [];
    loading = text.length >= 3; spin.hidden = !loading; draw();
    if (!loading) return;
    timer = setTimeout(async () => {
      let found = []; try { found = await searchPlayers(text); } catch {}
      if (mine !== seq) return;
      items = found; loading = false; spin.hidden = true; draw();
    }, 250);
  });
  input.addEventListener('keydown', event => {
    const opts = options();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!opts.length) return; event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('active', i === active)); opts[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0) pick(Number(opts[active].dataset.i)); else if (items.length === 1) pick(0); else if (input.value.trim().length >= 2 && !loading) pick(-1);
    } else if (event.key === 'Escape') close();
  });
  list.addEventListener('click', event => { const b = event.target.closest('[data-i]'); if (b) pick(Number(b.dataset.i)); });
  document.addEventListener('click', event => { if (!input.parentElement.contains(event.target) && !list.contains(event.target)) close(); });
}
// Mismo jugador: mismo número FIDE o mismo nombre, sin distinguir mayúsculas ni tildes.
const sameName = (a, b) => a.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim() === b.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();
const findDup = (p, list) => list.find(x => (p.fideId && x.fideId === p.fideId) || sameName(x.name, p.name));
const taken = n => !!findDup({ name: n }, state.standings);
// Aviso con un solo botón (el mismo recuadro que las confirmaciones).
function noticeBox(title, text) {
  $('to-confirm-icon').className = 'to-dialog-icon gold';
  $('to-confirm-icon').innerHTML = '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2"/><path d="M18 14v3M18 20h.01"/></svg>';
  $('to-confirm-dialog').dataset.tone = 'info';
  $('to-confirm-title').textContent = title; $('to-confirm-text').textContent = text; $('to-confirm-text').hidden = !text;
  $('to-confirm-no').hidden = true; $('to-confirm-yes').textContent = 'Entendido'; $('to-confirm-yes').classList.remove('danger');
  $('to-confirm-dialog').showModal(); $('to-confirm-yes').focus();
  return new Promise(resolve => { confirmResolve = resolve; });
}
const isDupError = text => /Ya hay un jugador|repetido o ya inscrito|ya está inscrito/i.test(text || '');
function warnDuplicate(p) {
  const inList = findDup(p, state.standings), asked = findDup(p, state.requests || []);
  if (inList) {
    const pos = [...state.standings].sort(byRating).indexOf(inList) + 1;
    noticeBox('Este jugador ya está inscrito', `${inList.name}${inList.rating ? ` (Elo ${inList.rating})` : ''} ya figura en la lista de inscritos, en el puesto ${pos}. No se ha añadido otra vez.`);
    return true;
  }
  if (asked) { noticeBox('Ya ha pedido plaza', `${asked.name} tiene una solicitud pendiente por QR. Apruébala en «Solicitudes por QR».`); return true; }
  return false;
}
attachSearch('to-pz-search', 'to-pz-sugs', p => {
  if (warnDuplicate(p)) return;
  if (send({ type: 'presencial-player', name: p.name, rating: p.rating ?? '', source: p.source, fideId: p.fideId, fed: p.fed, title: p.title })) message('');
  $('to-pz-search').focus();
}, text => `Añadir «${text}»`);
attachSearch('to-pz-ask-search', 'to-pz-ask-sugs', async p => {
  try {
    const id = read(playerKey()) || token(), user = currentUser(); write(playerKey(), id);
    await request(`/api/tournaments/${roomId}/join`, { method: 'POST', key: user ? session() : '', body: JSON.stringify({ name: p.name, rating: p.rating ?? '', source: p.source, fideId: p.fideId, fed: p.fed, title: p.title, token: id }) });
    askChanging = false; hello(); message('');
  } catch (e) { if (isDupError(e.message)) noticeBox('Ese nombre ya está inscrito', e.message); else message(e.message, true); }
}, text => `Pedir plaza como «${text}»`);
$('to-pz-ask-change').addEventListener('click', () => { askChanging = true; renderPresencial(); $('to-pz-ask-search').focus(); });

$('to-pz-host').addEventListener('click', async event => {
  const edit = event.target.closest('[data-pz-edit]')?.dataset.pzEdit, remove = event.target.closest('[data-pz-remove]')?.dataset.pzRemove;
  const approve = event.target.closest('[data-pz-approve]')?.dataset.pzApprove, reject = event.target.closest('[data-pz-reject]')?.dataset.pzReject;
  const toggle = event.target.closest('[data-pz-active]');
  if (toggle) {
    const back = toggle.dataset.active === 'true', who = name(toggle.dataset.pzActive);
    if (back || await confirmAction('Retirar jugador', `${who} no se emparejará en las próximas rondas. Si tiene una partida sin terminar, anota su resultado en la ronda. Podrás volver a incluirlo.`, true)) send({ type: 'presencial-active', playerId: toggle.dataset.pzActive, active: back });
    return;
  }
  if (approve) send({ type: 'presencial-approve', requestId: approve });
  else if (reject) { const r = state.requests?.find(r => r.id === reject); if (r && await confirmAction('Rechazar solicitud', `¿Rechazar la solicitud de ${r.name}?`, true)) send({ type: 'presencial-reject', requestId: reject }); }
  else if (remove) { if (await confirmAction('Quitar jugador', `¿Quitar a ${name(remove)} de la lista de inscritos?${canChangeInitialRoster(state) ? ' Se regenerarán los emparejamientos porque aún no hay resultados anotados.' : ''}`, true)) send({ type: 'remove', playerId: remove }); }
  else if (edit) {
    const p = state.standings.find(p => p.id === edit); if (!p) return;
    $('to-pz-edit-form').dataset.id = p.id;
    $('to-pz-edit-name').value = p.name; $('to-pz-edit-rating').value = p.rating ?? '';
    $('to-pz-edit-source').textContent = p.source ? `Elo de la lista ${p.source}${p.fideId ? ` · FIDE ${p.fideId}` : ''}. Si lo cambias, quedará como Elo manual.` : '';
    $('to-pz-edit-dialog').showModal(); $('to-pz-edit-name').select();
  }
});
$('to-pz-edit-form').addEventListener('submit', event => {
  event.preventDefault();
  const p = state.standings.find(p => p.id === event.currentTarget.dataset.id); if (!p) return;
  const rating = $('to-pz-edit-rating').value === '' ? null : Number($('to-pz-edit-rating').value);
  const sameRating = rating === (p.rating ?? null);
  if (send({ type: 'presencial-edit', playerId: p.id, name: $('to-pz-edit-name').value, rating: rating ?? '', source: sameRating ? p.source : null, fideId: p.fideId, fed: p.fed, title: p.title })) $('to-pz-edit-dialog').close();
});

// Lista pegada: «Nombre; Elo», «Nombre<Tab>Elo» o solo el nombre (el Elo se busca en las listas).
let pasted = [];
function parseList(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.*?)[\s;,]+(\d{3,4})\s*$/);
    const name = (m ? m[1] : line).replace(/^\d{1,3}\s*[.)\-]\s*/, '').replace(/[;,\s]+$/, '').trim();
    return { name, rating: m ? Number(m[2]) : null, source: null, fideId: null };
  }).filter(p => p.name.length >= 2);
}
function drawPaste(status = '') {
  const ok = pasted.filter(p => !p.problem), free = state.capacity - state.count;
  $('to-pz-paste-preview').hidden = false;
  $('to-pz-paste-preview').innerHTML = (status ? `<p class="to-pz-tip">${esc(status)}</p>` : '')
    + pasted.map(p => playerRow(p, null, p.problem ? `<span class="to-pz-problem">${esc(p.problem)}</span>` : p.found ? '<span class="to-pz-found">En la lista</span>' : '')).join('');
  pzPhotos($('to-pz-paste-preview'));
  $('to-pz-paste-add').disabled = !ok.length || !!status || ok.length > free;
  $('to-pz-paste-add').textContent = ok.length > free ? `Solo quedan ${free} plazas` : `Añadir ${ok.length} jugador${ok.length === 1 ? '' : 'es'}`;
}
$('to-pz-paste-open').addEventListener('click', () => {
  pasted = []; $('to-pz-paste-text').value = ''; $('to-pz-paste-preview').hidden = true;
  $('to-pz-paste-add').disabled = true; $('to-pz-paste-add').textContent = 'Añadir';
  $('to-pz-paste-dialog').showModal(); warmUp();
});
$('to-pz-paste-text').addEventListener('input', () => { $('to-pz-paste-add').disabled = true; });
$('to-pz-paste-check').addEventListener('click', async () => {
  pasted = parseList($('to-pz-paste-text').value);
  if (!pasted.length) { $('to-pz-paste-preview').hidden = false; $('to-pz-paste-preview').innerHTML = '<p class="to-pz-tip">Escribe o pega al menos un nombre.</p>'; return; }
  const seen = new Set();
  for (const p of pasted) {
    const key = p.name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
    p.problem = findDup(p, state.standings) ? 'Ya inscrito' : seen.has(key) ? 'Repetido' : p.name.length > 48 ? 'Nombre muy largo' : '';
    seen.add(key);
  }
  const missing = pasted.filter(p => !p.problem && !p.rating);
  $('to-pz-paste-check').disabled = true;
  for (let i = 0; i < missing.length; i++) {
    drawPaste(`Buscando el Elo en las listas… ${i + 1} de ${missing.length}`);
    const hit = await findExact(missing[i].name).catch(() => null);
    if (hit) Object.assign(missing[i], { rating: hit.rating, source: hit.source, fideId: hit.fideId, fed: hit.fed, title: hit.title, fide: hit.fide, fada: hit.fada, found: true });
  }
  $('to-pz-paste-check').disabled = false;
  drawPaste();
});
$('to-pz-paste-form').addEventListener('submit', event => {
  event.preventDefault();
  const players = pasted.filter(p => !p.problem).map(({ name, rating, source, fideId, fed, title }) => ({ name, rating: rating ?? '', source, fideId, fed, title }));
  if (players.length && send({ type: 'presencial-players', players })) $('to-pz-paste-dialog').close();
});

// QR con el enlace del torneo (biblioteca qrcode-generator, MIT, desde cdnjs; se carga solo al abrirlo).
let qrLib = null;
const loadQr = () => qrLib ||= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  s.onload = () => resolve(window.qrcode); s.onerror = () => { qrLib = null; reject(new Error('No se pudo generar el QR. Comprueba la conexión.')); };
  document.head.append(s);
});
const roomLink = () => new URL('jugar-torneo.html?id=' + roomId, location.href).href;
$('to-pz-qr-open').addEventListener('click', async () => {
  $('to-pz-qr-link').textContent = roomLink(); $('to-pz-qr').innerHTML = '<span class="to-pz-spin"></span>';
  $('to-pz-qr-dialog').showModal();
  try { const qr = (await loadQr())(0, 'M'); qr.addData(roomLink()); qr.make(); $('to-pz-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  catch (e) { $('to-pz-qr').innerHTML = `<p class="to-pz-tip">${esc(e.message)}</p>`; }
});
$('to-pz-qr-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomLink());
    $('to-pz-qr-copy').textContent = 'Enlace copiado'; setTimeout(() => { $('to-pz-qr-copy').textContent = 'Copiar enlace'; }, 1800);
  } catch { message('No se pudo copiar el enlace.', true); }
});
// Sin confirmación: si hace falta, la última ronda se borra con su papelera.
$('to-presencial-next').addEventListener('click', () => {
  if (closed(state)) return;
  send({ type: 'presencial-next' });
});
$('to-presencial-reset').addEventListener('click', async () => {
  if (await confirmAction('Borrar emparejamientos y reabrir inscripción', 'Se borrarán todos los emparejamientos y resultados. Los jugadores se conservarán y volverán a estar inscritos. Podrás añadir o quitar jugadores y generar las rondas de nuevo. Esta acción no se puede deshacer.', true)) {
    message(''); send({ type: 'presencial-reset' });
  }
});
$('to-pz-tabs').addEventListener('click', event => {
  const b = event.target.closest('[data-pz-view]'); if (!b) return;
  presencialView = b.dataset.pzView; renderPresencial();
});
$('to-presencial-round').addEventListener('change', event => { presencialFilter = event.target.value; renderPresencial(); });
$('to-round-trigger').addEventListener('click', () => {
  if ($('to-round-menu').hidden) openRoundPicker(); else closeRoundPicker(true);
});
$('to-round-trigger').addEventListener('keydown', event => {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); openRoundPicker(event.key === 'Home' ? 'first' : event.key === 'End' || event.key === 'ArrowUp' ? 'last' : undefined);
  }
});
$('to-round-options').addEventListener('click', event => {
  const option = event.target.closest('[data-round-filter]'); if (!option) return;
  presencialFilter = option.dataset.roundFilter; closeRoundPicker(true); renderPresencial();
});
$('to-round-options').addEventListener('keydown', event => {
  if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); closeRoundPicker(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const options = [...$('to-round-options').children], i = options.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  focusRoundOption(options[next]);
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#to-round-picker')) closeRoundPicker(); });
addEventListener('resize', () => closeRoundPicker());
document.addEventListener('scroll', event => {
  if ($('to-round-menu').hidden || $('to-round-menu').contains(event.target)) return;
  const rect = $('to-round-trigger').getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= innerHeight) closeRoundPicker(); else positionRoundPicker();
}, { capture: true, passive: true });
// Cuadro de resultados (como en RondaSwiss): sale junto a la mesa pulsada.
function closeResultPop() { $('to-pt-pop')?.remove(); document.querySelector('tr.to-pt-open')?.classList.remove('to-pt-open'); }
function openResultPop(row) {
  closeResultPop();
  const g = state.games.find(g => g.id === row.dataset.ptGame); if (!g) return;
  row.classList.add('to-pt-open');
  const pop = document.createElement('div');
  pop.id = 'to-pt-pop'; pop.className = 'to-pt-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', `Resultado de la mesa ${row.dataset.ptTable}`);
  pop.innerHTML = '<strong>Resultados</strong>'
    + [...ptOptions, ...(row.dataset.ptEarlier ? [] : [['', '-']])].map(([v, l]) => `<button type="button" data-pt-value="${v}" class="${(g.result || '') === v ? 'on' : ''}"${v ? '' : ' title="Sin resultado"'}>${l}</button>`).join('');
  document.body.append(pop);
  // Debajo de la casilla de resultado; si no cabe, encima.
  const cell = row.querySelector('.to-pt-res').getBoundingClientRect(), h = pop.offsetHeight, w = pop.offsetWidth;
  const top = cell.bottom + 6 + h > innerHeight ? Math.max(8, cell.top - 6 - h) : cell.bottom + 6;
  pop.style.top = top + 'px'; pop.style.left = Math.min(innerWidth - w - 8, Math.max(8, cell.left + cell.width / 2 - w / 2)) + 'px';
  (pop.querySelector('.on') || pop.querySelector('button')).focus();
  pop.addEventListener('click', event => {
    const b = event.target.closest('[data-pt-value]'); if (!b) return;
    send({ type: 'presencial-result', game: g.id, result: b.dataset.ptValue || null });
    closeResultPop(); row.focus();
  });
  pop.addEventListener('keydown', event => {
    const items = [...pop.querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { closeResultPop(); row.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
  });
}
$('to-presencial-matches').addEventListener('click', async event => {
  const drop = event.target.closest('[data-pt-drop]');
  if (!drop || !connected) return;
  const r = Number(drop.dataset.ptDrop);
  const text = r === 1 ? 'Se borrarán los emparejamientos de la ronda 1 y la inscripción volverá a abrirse. Los jugadores se conservan.'
    : `Se borrarán los emparejamientos y resultados de la ronda ${r}. Podrás corregir los resultados de la ronda ${r - 1} y volver a emparejar.`;
  if (await confirmAction('Borrar última ronda', text, true)) { closeResultPop(); send({ type: 'presencial-drop-round', round: r }); }
});
$('to-presencial-matches').addEventListener('click', event => { const row = event.target.closest('tr[data-pt-game]'); if (row && connected) openResultPop(row); });
$('to-presencial-matches').addEventListener('keydown', event => { const row = event.target.closest('tr[data-pt-game]'); if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (connected) openResultPop(row); } });
document.addEventListener('pointerdown', event => { if ($('to-pt-pop') && !event.target.closest('#to-pt-pop, tr[data-pt-game]')) closeResultPop(); });
addEventListener('scroll', () => closeResultPop(), { passive: true }); addEventListener('resize', () => closeResultPop());
$('to-cancel').addEventListener('click', async () => {
  if (await confirmAction('Cancelar torneo', 'El torneo se cerrará y las partidas en juego terminarán en tablas. Esta acción no se puede deshacer.', true)) send({ type: 'cancel' });
});
$('to-withdraw').addEventListener('click', async () => {
  if (await confirmAction(state.status === 'waiting' ? 'Cancelar inscripción' : 'Retirarte del torneo', state.status === 'waiting' ? 'Se liberará tu plaza. Podrás volver a inscribirte mientras haya sitio.' : arena(state) ? 'Perderás tu partida en curso y no se te emparejará más. Si solo quieres descansar, usa «Salir del torneo»: conservas tus puntos y puedes volver a entrar.' : 'Perderás tu partida en curso y no participarás en las siguientes rondas.', true)) send({ type: 'withdraw' });
});
$('to-focus-pause').addEventListener('click', () => $('to-pause').click());
$('to-pause').addEventListener('click', () => {
  const mine = state.standings.find(p => p.id === state.me);
  if (send({ type: mine?.paused ? 'resume' : 'pause' })) message(mine?.paused ? 'Has vuelto a entrar en el torneo: se te emparejará con el próximo jugador libre.' : 'Has salido del torneo: no se te emparejará hasta que vuelvas a entrar. Conservas tus puntos. Si estás jugando, termina tu partida.');
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
  if (event.button > 0) return;
  const square = event.target.closest('[data-square]')?.dataset.square, premoving = canPremove();
  if (!square || !(premoving || canMove())) return;
  if (premoving ? fenPieces(shownFen())[square]?.[0] !== myColor() : !state.game.legal.some(m => m.from === square)) return;
  if (premoving && selected && selected !== square && premoveDests(selected).includes(square)) return; // lo resuelve el clic: premovimiento
  if (premoving && premove) { premove = null; boardKey = ''; }
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
  if (to && to !== from && canPremove() && premoveDests(from).includes(to)) { setPremove(from, to); return; }
  if (to && to !== from && canMove() && state.game.legal.some(m => m.from === from && m.to === to)) { selected = from; skipSlide = true; squareClick(to); return; }
  // Soltar en la misma casilla sin mover: selecciona la pieza (o la deselecciona si ya lo estaba).
  selected = to === from && !(wasSelected && !moved) ? from : null;
  boardKey = ''; renderBoard();
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', () => endDrag(null));
$('to-board').addEventListener('contextmenu', event => { if (cancelPremove()) event.preventDefault(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]') && cancelPremove()) event.preventDefault(); });
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
$('to-print-standings').addEventListener('click', printStandings);
$('to-print-top').addEventListener('click', printStandings);
function review(ply) { if (!replay) return; replayPly = Math.max(0, Math.min(replay.length - 1, ply)); boardKey = ''; renderGame(); }
$('to-replay-range').addEventListener('input', event => review(Number(event.target.value)));
$('to-replay-prev').addEventListener('click', () => review(replayPly - 1));
$('to-replay-next').addEventListener('click', () => review(replayPly + 1));
window.addEventListener('online', () => { if (roomId && !connected) { socket?.close(); connect(); } });
window.addEventListener('pagehide', () => { clearTimeout(reconnectTimer); clearInterval(heartbeat); if (socket) { socket.onclose = null; socket.close(); } });
window.addEventListener('pageshow', event => { if (event.persisted && roomId && API) connect(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && roomId && socket?.readyState === WebSocket.OPEN) hello(); });
window.addEventListener('resize', scheduleGameFit);
window.addEventListener('pageshow', scheduleGameFit);
window.visualViewport?.addEventListener('resize', scheduleGameFit);
const gameSizeObserver = new ResizeObserver(scheduleGameFit);
for (const selector of ['.to-play-column', '.to-room-bar', '.site-header', '#to-game-actions', '#to-game-status', '#to-message']) {
  const element = document.querySelector(selector); if (element) gameSizeObserver.observe(element);
}

$('to-name').value = read('apejupoTorneoNombre');
if (roomId) {
  $('to-lobby').hidden = true; $('to-room').hidden = boardsMode; $('to-boards-page').hidden = !boardsMode;
  document.body.classList.toggle('to-boards-mode', boardsMode);
  if (!/^[a-f0-9]{24}$/.test(roomId)) message('El enlace del torneo no es válido.', true);
  else if (!API) { message('Los torneos todavía no están disponibles.'); setConnection('No disponible'); }
  else { connect(); checkKeyMode(); }
} else loadLobby();
setInterval(() => { updateClocks(); updateMiniClocks(); }, 100);
// Los navegadores solo permiten sonido tras un gesto del usuario: clic, toque o teclado.
function unlockAudio() { try { prepareAudio(); } catch {} }
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
$('to-sound').addEventListener('click', () => {
  moveSound = !moveSound;
  $('to-sound').setAttribute('aria-checked', String(moveSound));
  $('to-sound-state').textContent = moveSound ? 'ON' : 'OFF';
  $('to-sound').title = `${moveSound ? 'Desactivar' : 'Activar'} sonido de jugadas. El aviso de inicio de partida se mantiene.`;
  if (moveSound) unlockAudio();
});

$('to-delete-ended').addEventListener('click', async () => {
  const ended = [...lobby.values()].filter(t => ['finished', 'cancelled'].includes(t.status));
  if (!ended.length || !tournamentAdmin) return;
  const list = ended.length === 1 ? `el torneo «${ended[0].title}»` : `los ${ended.length} torneos terminados`;
  if (!await confirmAction('Borrar todos los torneos terminados', `Se borrarán ${list}. Desaparecerán para todos y no se puede deshacer.`, true)) return;
  const button = $('to-delete-ended'); button.disabled = true;
  let failed = 0;
  for (const t of ended) {
    try {
      await request(`/api/tournaments/${t.id}/delete`, { method: 'POST', key: adminKey(), body: JSON.stringify({}) });
      try { localStorage.removeItem(hostKey(t.id)); } catch {}
    } catch { failed++; }
  }
  button.disabled = false;
  message(failed ? `No se ${failed === 1 ? 'pudo borrar 1 torneo' : `pudieron borrar ${failed} torneos`}. Vuelve a intentarlo.` : '', !!failed);
  await loadLobby();
});
$('to-events').addEventListener('click', async event => {
  if (event.target.closest('[data-create]')) { $('to-create-open').click(); return; }
  const pencil = event.target.closest('[data-edit]');
  if (pencil) { try { await openEdit(pencil.dataset.edit); } catch (error) { message(error.message, true); } return; }
  const button = event.target.closest('[data-delete]'); if (!button) return;
  const id = button.dataset.delete, t = lobby.get(id); if (!t) return;
  const ended = ['finished', 'cancelled'].includes(t.status);
  const n = t.count, players = n === 1 ? 'Hay 1 jugador inscrito' : `Hay ${n} jugadores inscritos`;
  const text = ended ? '' : (n ? `${players} en «${t.title}». ` : `Vas a borrar «${t.title}». `)
    + (['playing', 'between'].includes(t.status) ? 'El torneo está en juego y se perderán las partidas. ' : '')
    + 'Desaparecerá para todos y no se puede deshacer.';
  if (!await confirmAction(ended ? `Se va a borrar el torneo «${t.title}»` : n ? 'Hay jugadores inscritos' : 'Borrar torneo', text, true)) return;
  button.disabled = true;
  try {
    await request(`/api/tournaments/${id}/delete`, { method: 'POST', key: managementKey(id), body: JSON.stringify({ hostToken: read(hostKey(id)) }) });
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
