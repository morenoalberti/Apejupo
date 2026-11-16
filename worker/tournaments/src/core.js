import { Chess } from 'chess.js';
import { toTrf, parsePairs, orderByRating } from './swiss-dutch.js';

// Comprobado con la prueba de carga: 128 jugadores y 32 espectadores sin retrasos apreciables.
export const MAX_PLAYERS = 128;
export const BREAK_MS = 30000;
// Match entre dos (reto a varias partidas): pausa corta entre una partida y la siguiente.
export const MATCH_BREAK_MS = 10000;
export const RETENTION_MS = 30 * 86400000;
const INITIAL_FEN = new Chess().fen();
const engines = new WeakMap();

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function requireThat(ok, message, status = 400) {
  if (!ok) throw new GameError(message, status);
}
export function cleanName(value, max = 28) {
  return String(value || '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
export const ARENA_PAUSE_MS = 10000;
// Clave de inscripción opcional: quien entra con el enlace la necesita para apuntarse (ver y seguir el torneo es libre).
export function cleanJoinKey(value) {
  const key = cleanName(value, 40);
  requireThat(!key || (key.length >= 4 && key.length <= 20), 'La clave del torneo debe tener entre 4 y 20 caracteres.');
  return key;
}
const sameKey = (a, b) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es');
export const ARENA_DURATIONS = [3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
export const isArena = t => t.format === 'arena';
export const isClosed = t => ['closed', 'double-closed'].includes(t.format);
export const isPresencial = t => t.mode === 'presencial';
// Motor FIDE del suizo (bbpPairings). Lo instala el servidor al arrancar; sin él se usa el emparejamiento de club.
let swissEngine = null;
export function setSwissEngine(run) { swissEngine = run; }
export const BERSERK_BONUS = 1;
// Se deja de emparejar cuando queda menos de la mitad del tiempo base de una partida
// (entre 30 s y 2 min). Las partidas en curso cuentan aunque terminen después del tiempo.
export const arenaPairingsCloseAt = t => t.endsAt - Math.max(30, Math.min(t.minutes * 30, 120)) * 1000;
export const BERSERK_MIN_PLIES = 14; // siete jugadas de cada bando para cobrar el extra
const berserkBonus = (g, color) => !!(color === 'w' ? g.berserkW : g.berserkB) && g.moves.length >= BERSERK_MIN_PLIES;

// Arena de Lichess: 2/1/0, puntuación doble tras dos victorias y Berserk aparte.
function arenaScore(score, plies, run) {
  const doubled = run.wins >= 2;
  let points = score * (doubled ? 4 : 2);
  if (score === .5 && (plies < 20 || (run.drawSinceWin && plies < 60))) points = 0;
  run.wins = score === 1 ? run.wins + 1 : 0;
  if (score === 1) run.drawSinceWin = false;
  else if (score === .5) run.drawSinceWin = true;
  return { points, doubled: doubled && points > 0 };
}
export function createTournament(input, id, hostHash, now = Date.now()) {
  const title = cleanName(input.title, 70);
  const mode = input.mode || 'online';
  requireThat(['online', 'presencial'].includes(mode), 'Elige la modalidad del torneo.');
  const formats = mode === 'presencial' ? ['swiss', 'closed', 'double-closed'] : ['arena', 'swiss', 'closed'];
  requireThat(!input.format || formats.includes(input.format), 'Elige un formato válido para esta modalidad.');
  const format = input.format || 'swiss';
  const minutes = Number(input.minutes), increment = Number(input.increment);
  const capacity = Number(input.capacity), joinKey = cleanJoinKey(input.joinKey);
  // Cerrado: las rondas salen del número de inscritos al empezar (todos contra todos).
  const rounds = format === 'swiss' ? Number(input.rounds) : 0;
  const duration = format === 'arena' ? Number(input.duration) : null;
  requireThat(title.length >= 4, 'El nombre del torneo debe tener al menos 4 caracteres.');
  requireThat([1, 2, 3, 4, 5, 10, 15, 20, 30, 60, 90].includes(minutes), 'Elige un ritmo válido.');
  requireThat([0, 1, 2, 3, 5, 10].includes(increment), 'Elige un incremento válido.');
  if (format === 'arena') {
    requireThat(ARENA_DURATIONS.includes(duration), 'Elige una duración válida.');
    requireThat(duration >= minutes * 3, 'La duración debe dar para varias partidas: al menos el triple de los minutos por jugador.');
  } else if (format === 'swiss' && input.match === true) { // reto personal a varias partidas: solo dos jugadores (lo crea el servidor de retos)
    requireThat(Number(input.capacity) === 2, 'Un match es entre dos jugadores.');
    requireThat(Number.isInteger(rounds) && rounds >= 2 && rounds <= 20, 'Un match puede ser de 2 a 20 partidas.');
  }
  else if (format === 'swiss') requireThat(Number.isInteger(rounds) && rounds >= 1 && rounds <= 9, 'Elige entre 1 y 9 rondas.');
  requireThat(Number.isInteger(capacity) && capacity >= 2 && capacity <= MAX_PLAYERS, `El límite es de 2 a ${MAX_PLAYERS} jugadores.`);
  let startsAt = input.startsAt ? Number(input.startsAt) : null;
  if (mode === 'presencial') requireThat(startsAt === null || (Number.isFinite(startsAt) && startsAt > now - 86400000 && startsAt < now + 14 * 86400000), 'Elige una fecha desde hoy y dentro de los próximos 14 días.');
  else requireThat(startsAt === null || (Number.isFinite(startsAt) && startsAt > now + 60000 && startsAt < now + 14 * 86400000), 'La fecha de inicio debe estar entre un minuto y 14 días en el futuro.');
  return { id, title, hostHash, mode, format, duration, endsAt: null, minutes, increment, rounds, capacity, startsAt, createdAt: now,
    expiresAt: now + RETENTION_MS, status: 'waiting', round: 0, nextRoundAt: null,
    players: [], games: [], revision: 0, finishedAt: null, notice: '', joinKey };
}

// Editar antes de empezar: se valida igual que al crear y se conservan inscritos y fechas internas.
export function editTournament(t, input, now = Date.now()) {
  requireThat(t.status === 'waiting', 'El torneo ya ha empezado: no se puede editar.', 409);
  const n = createTournament(input, t.id, t.hostHash, now);
  requireThat(n.mode === (t.mode || 'online') || !t.players.length, 'Para cambiar la modalidad, retira primero a los inscritos.');
  requireThat(n.capacity >= t.players.length, `Ya hay ${t.players.length} jugadores inscritos: el máximo no puede ser menor.`);
  // Sin «joinKey» en la petición, la clave de inscripción se queda como estaba.
  if (input.joinKey === undefined) n.joinKey = t.joinKey;
  for (const k of ['title', 'mode', 'format', 'duration', 'minutes', 'increment', 'rounds', 'capacity', 'startsAt', 'joinKey']) t[k] = n[k];
}

export function standings(t) {
  const rows = t.players.map(p => ({ id: p.id, name: p.name, seed: p.seed, rating: p.rating || null, active: p.active, registered: !!p.accountId,
    points: 0, wins: 0, buchholz: 0, sonneborn: 0, played: 0, byes: 0, opponents: [], colors: [], sheet: [] }));
  const map = new Map(rows.map(p => [p.id, p]));
  const arenaRuns = new Map(rows.map(p => [p.id, { wins: 0, drawSinceWin: false }]));
  function recordResult(row, g, score, color) {
    const bonus = isArena(t) && score === 1 && berserkBonus(g, color);
    const entry = { s: score, berserk: !!(color === 'w' ? g.berserkW : g.berserkB), bonus };
    if (isArena(t)) {
      const value = arenaScore(score, g.moves.length, arenaRuns.get(row.id));
      entry.points = value.points + (bonus ? BERSERK_BONUS : 0);
      entry.doubled = value.doubled;
      row.points += entry.points;
    } else row.points += score;
    row.sheet.push(entry);
  }
  for (const g of t.games) {
    const white = map.get(g.white), black = map.get(g.black);
    if (!white) continue;
    if (g.bye) { const s = g.rest ? 0 : 1; white.points += s; white.byes++; white.sheet.push({ s, bye: true }); continue; }
    white.colors.push('w'); black.colors.push('b');
    white.opponents.push(black.id); black.opponents.push(white.id);
    if (!g.result) continue;
    white.played++; black.played++;
    const a = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : .5;
    if (a === 1) white.wins++; if (a === 0) black.wins++;
    recordResult(white, g, a, 'w');
    recordResult(black, g, 1 - a, 'b');
  }
  for (const g of t.games) {
    if (!g.result || g.bye) continue;
    const a = map.get(g.white), b = map.get(g.black);
    const score = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : .5;
    a.buchholz += b.points; b.buchholz += a.points;
    a.sonneborn += b.points * score; b.sonneborn += a.points * (1 - score);
  }
  for (const p of t.players) { const row = map.get(p.id); row.paused = !!p.paused; row.playing = t.games.some(g => !g.result && (g.white === p.id || g.black === p.id)); }
  // Arena: con número de partidas desigual, Buchholz no es comparable; desempatan victorias y eficacia.
  if (isArena(t)) return rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played || a.seed - b.seed);
  // Cerrado: todos juegan contra todos, así que Buchholz no distingue; manda Sonneborn-Berger.
  if (isClosed(t)) return rows.sort((a, b) => b.points - a.points || b.sonneborn - a.sonneborn || b.wins - a.wins || a.seed - b.seed);
  return rows.sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || b.sonneborn - a.sonneborn || b.wins - a.wins || a.seed - b.seed);
}

// Arena: cada jugador libre (conectado, sin pausa y tras una breve pausa desde su última partida)
// se empareja con otro libre. El que más tiempo lleva esperando elige primero; se busca un rival
// de puntuación parecida y se evitan sus últimos rivales (primero el más reciente) si hay alternativa.
export const ARENA_RECENT_RIVALS = 3;
function recentRivals(t, id) {
  const out = [];
  for (let i = t.games.length - 1; i >= 0 && out.length < ARENA_RECENT_RIVALS; i--) {
    const g = t.games[i];
    if (g.bye || (g.white !== id && g.black !== id)) continue;
    out.push(g.white === id ? g.black : g.white);
  }
  return out;
}
function lastGame(t, id) { return [...t.games].reverse().find(g => g.white === id || g.black === id) || null; }
export function arenaReadyAt(t, id) {
  const g = lastGame(t, id);
  if (g && !g.result) return Infinity;
  return Math.max(t.endsAt - t.duration * 60000, g ? g.finishedAt + ARENA_PAUSE_MS : 0);
}
export function pairArena(t, now = Date.now(), online = null) {
  if (!isArena(t) || t.status !== 'playing' || now >= arenaPairingsCloseAt(t)) return false;
  const ranked = standings(t), free = ranked
    .filter(p => p.active && !p.paused && (!online || online.has(p.id)))
    .map(p => ({ p, ready: arenaReadyAt(t, p.id) }))
    .filter(x => x.ready <= now)
    .sort((a, b) => a.ready - b.ready || a.p.seed - b.p.seed)
    .map(x => x.p);
  if (free.length < 2) return false;
  t.round++;
  const pairs = [];
  while (free.length >= 2) {
    const a = free.shift(), recent = recentRivals(t, a.id);
    // Cuanto más reciente el rival, más se evita: el último solo si no queda nadie más.
    const recency = c => { const i = recent.indexOf(c.id); return i < 0 ? 0 : ARENA_RECENT_RIVALS - i; };
    const better = (c, best) => (recency(c) - recency(best) || Math.abs(c.points - a.points) - Math.abs(best.points - a.points)) < 0;
    const b = free.reduce((best, c) => better(c, best) ? c : best);
    free.splice(free.indexOf(b), 1);
    pairs.push(orient(a, b, t.round));
  }
  for (const [a, b] of pairs) t.games.push(newGame(t, a, b, now));
  return true;
}

function colorCost(p, color) {
  const balance = p.colors.reduce((n, c) => n + (c === 'w' ? 1 : -1), 0);
  const repeated = p.colors.slice(-2).length === 2 && p.colors.slice(-2).every(c => c === color);
  return Math.abs(balance + (color === 'w' ? 1 : -1)) * 3 + (repeated ? 20 : 0);
}
function orient(a, b, round) {
  const ab = colorCost(a, 'w') + colorCost(b, 'b');
  const ba = colorCost(a, 'b') + colorCost(b, 'w');
  return ab < ba || (ab === ba && (a.seed + round) % 2 === 0) ? [a, b] : [b, a];
}

// Cerrado: tabla Berger. Los números i y j (sin contar el último) se cruzan en la ronda
// (i + j − 2) mod (n − 1) + 1; el que queda libre juega con el último. Con número impar,
// el último es un hueco (descanso). Así nadie pasa de una partida de diferencia entre blancas y negras.
export function closedPairs(players, round) {
  const ids = [...players].sort((a, b) => a.seed - b.seed);
  if (ids.length % 2) ids.push(null);
  const n = ids.length, pairs = [], used = new Set();
  for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) {
    if ((i + j - 2) % (n - 1) + 1 !== round) continue;
    pairs.push((i + j) % 2 ? [ids[i - 1], ids[j - 1]] : [ids[j - 1], ids[i - 1]]);
    used.add(i); used.add(j);
  }
  const k = Array.from({ length: n - 1 }, (_, x) => x + 1).find(x => !used.has(x));
  pairs.unshift(k % 2 ? [ids[k - 1], ids[n - 1]] : [ids[n - 1], ids[k - 1]]);
  return pairs;
}
function beginClosedRound(t, now) {
  t.round++;
  t.nextRoundAt = null; t.status = 'playing'; t.notice = '';
  const legRounds = t.players.length % 2 ? t.players.length : t.players.length - 1;
  const pairs = closedPairs(t.players, (t.round - 1) % legRounds + 1);
  for (const pair of pairs) {
    const [a, b] = t.round > legRounds ? [...pair].reverse() : pair;
    const present = [a, b].filter(p => p && p.active);
    if (present.length === 2) { t.games.push(newGame(t, a, b, now)); continue; }
    if (!present.length) continue;
    const g = newGame(t, present[0], null, now);
    // Hueco de número impar: descansa sin punto. Rival retirado: el punto es para quien sigue.
    const rest = !a || !b;
    g.result = '1-0'; g.reason = rest ? 'Descanso' : 'Rival retirado: un punto'; g.finishedAt = now;
    if (rest) g.rest = true;
    t.games.push(g);
  }
}

// Suizo de club: busca primero una ronda completa sin rivales repetidos y aproxima puntuaciones y colores.
// Es un sistema propio, no se presenta como emparejador homologado FIDE.
export function pairRound(t) {
  const ranked = standings(t).filter(p => p.active);
  if (ranked.length < 2) return { pairs: [], bye: null, repeated: false };
  const byeCandidates = ranked.length % 2 ? [...ranked].sort((a, b) => a.byes - b.byes || a.points - b.points || b.seed - a.seed) : [null];
  for (const allowRepeats of [false, true]) {
    for (const bye of byeCandidates) {
      let budget = 20000;
      function search(left) {
        if (!left.length) return [];
        if (--budget <= 0) return null;
        const a = left[0];
        const candidates = left.slice(1).filter(b => allowRepeats || !a.opponents.includes(b.id));
        candidates.sort((b, c) => {
          const cost = p => (a.opponents.includes(p.id) ? 10000 : 0) + Math.abs(a.points - p.points) * 100 + Math.min(colorCost(a, 'w') + colorCost(p, 'b'), colorCost(a, 'b') + colorCost(p, 'w'));
          return cost(b) - cost(c) || b.seed - c.seed;
        });
        for (const b of candidates) {
          const rest = search(left.filter(p => p !== a && p !== b));
          if (rest) return [orient(a, b, t.round + 1), ...rest];
        }
        return null;
      }
      const pairs = search(ranked.filter(p => p !== bye));
      if (pairs) return { pairs, bye, repeated: pairs.some(([a, b]) => a.opponents.includes(b.id)) };
    }
  }
  throw new GameError('No se pudieron generar los emparejamientos.');
}

// «account» solo lo pone el servidor tras comprobar la sesión: { id, nick, elo? } de una cuenta confirmada.
// El Elo de la cuenta se guarda en la inscripción y ordena a los jugadores en el suizo.
export function joinTournament(t, name, playerHash, now = Date.now(), key = '', account = null, organizer = false) {
  requireThat(!isPresencial(t) || organizer, 'En un torneo presencial, el organizador inscribe a los jugadores.', 403);
  const existing = t.players.find(p => p.hash === playerHash);
  if (existing) return existing;
  // Con cuenta, el jugador recupera su plaza desde cualquier dispositivo: pasa a este navegador.
  const mine = account && t.players.find(p => p.accountId === account.id);
  if (mine) { mine.hash = playerHash; return mine; }
  if (t.joinKey) {
    requireThat(cleanName(key, 40), 'Este torneo tiene clave. Escríbela para inscribirte.', 403);
    requireThat(sameKey(cleanName(key, 40), t.joinKey), 'La clave del torneo no es correcta.', 403);
  }
  // Como en Lichess, en el arena se puede entrar con el torneo ya empezado mientras quede tiempo.
  requireThat(t.status === 'waiting' || (isArena(t) && t.status === 'playing' && now < t.endsAt), 'Las inscripciones están cerradas.');
  name = account ? account.nick : cleanName(name);
  requireThat(name.length >= 2, 'Escribe un nombre de al menos 2 caracteres.');
  requireThat(!t.players.some(p => p.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es')), 'Ya hay un jugador con ese nombre. Añade un apellido.');
  requireThat(t.players.length < t.capacity, 'El torneo está completo.');
  const rating = Number.isInteger(account?.elo) && account.elo > 0 ? account.elo : null;
  const p = { id: crypto.randomUUID(), hash: playerHash, name, active: true, seed: t.players.length + 1, joinedAt: now, rating, ...(account ? { accountId: account.id } : {}) };
  t.players.push(p);
  return p;
}

function newGame(t, a, b, now) {
  if (isPresencial(t)) return { id: crypto.randomUUID(), round: t.round, white: a.id, black: b?.id || null,
    moves: [], result: null, reason: '', bye: !b, finishedAt: null };
  return { id: crypto.randomUUID(), round: t.round, white: a.id, black: b?.id || null,
    fen: INITIAL_FEN, moves: [], turn: 'w', whiteMs: t.minutes * 60000, blackMs: t.minutes * 60000,
    lastAt: now, result: null, reason: '', offer: null, bye: !b, finishedAt: null };
}
// Suizo: sistema holandés de la FIDE con bbpPairings. Si el motor no está o no encuentra emparejamiento
// (por ejemplo, más rondas de las posibles sin repetir rival), se usa el emparejamiento de club.
function swissPairs(t) {
  if (swissEngine && t.players.filter(p => p.active).length >= 2) {
    try { return { ...parsePairs(t, swissEngine(toTrf(t))), repeated: false, fide: true }; }
    catch (error) { console.warn('Emparejamiento FIDE no disponible:', error.message); }
  }
  return { ...pairRound(t), fide: false };
}
// Reto entre dos cuentas: el color de la primera partida lo decide quien reta (o el azar), no el emparejador;
// en un match a varias partidas los colores se alternan en cada una.
function beginChallengeRound(t, now) {
  const [a, b] = t.players, first = t.players.find(p => p.id === t.challenge.white) || a, second = first === a ? b : a;
  t.round++;
  t.nextRoundAt = null; t.status = 'playing'; t.notice = ''; t.pairing = null;
  t.games.push(t.round % 2 ? newGame(t, first, second, now) : newGame(t, second, first, now));
}
export function beginRound(t, now) {
  if (t.challenge) return beginChallengeRound(t, now);
  if (isClosed(t)) return beginClosedRound(t, now);
  const { pairs, bye, repeated, fide } = swissPairs(t);
  if (!pairs.length) { finishTournament(t, now); return; }
  t.round++;
  t.nextRoundAt = null;
  t.status = 'playing';
  t.pairing = fide ? 'fide' : 'club';
  t.notice = repeated ? 'Con los participantes disponibles ha sido necesario repetir algún enfrentamiento.' : '';
  for (const [a, b] of pairs) t.games.push(newGame(t, a, b, now));
  if (bye) {
    const g = newGame(t, bye, null, now);
    g.result = '1-0'; g.reason = 'Descanso: un punto'; g.finishedAt = now;
    t.games.push(g);
  }
}
export function startTournament(t, now = Date.now()) {
  requireThat(t.status === 'waiting', 'El torneo ya ha comenzado.');
  requireThat(t.players.length >= 2, 'Se necesitan al menos dos jugadores.');
  const n = t.players.length;
  if (isClosed(t)) t.rounds = (n % 2 ? n : n - 1) * (t.format === 'double-closed' ? 2 : 1);
  // Un reto (también a varias partidas) enfrenta siempre a los mismos dos: no se limitan las rondas.
  else if (!isArena(t) && !t.challenge) t.rounds = Math.min(t.rounds, n % 2 ? n : n - 1);
  if (isArena(t) || isClosed(t)) {
    // Sorteo de los números iniciales, independiente del orden de inscripción.
    const random = new Uint32Array(n); crypto.getRandomValues(random);
    t.players.map((p, i) => ({ p, r: random[i] })).sort((a, b) => a.r - b.r).forEach(({ p }, i) => { p.seed = i + 1; });
  } else {
    // Suizo, como en la FIDE: números por Elo de mayor a menor; sin Elo, detrás y por orden alfabético.
    orderByRating(t.players).forEach((p, i) => { p.seed = i + 1; });
  }
  if (isArena(t)) {
    // Los emparejamientos los hace pairArena con los jugadores conectados en ese momento.
    t.status = 'playing'; t.notice = ''; t.endsAt = now + t.duration * 60000;
    return;
  }
  beginRound(t, now);
}
function finishTournament(t, now) {
  t.status = 'finished'; t.finishedAt = now; t.nextRoundAt = null;
  t.expiresAt = now + RETENTION_MS;
}
export function afterResults(t, now) {
  if (isArena(t)) {
    // Al cumplirse el tiempo se espera a las partidas en juego: todas cuentan para la clasificación final.
    if (t.status === 'playing' && (now >= t.endsAt || t.players.filter(p => p.active).length < 2) && !t.games.some(g => !g.result)) finishTournament(t, now);
    return;
  }
  if (t.status !== 'playing' || t.games.some(g => g.round === t.round && !g.result)) return;
  if (t.round >= t.rounds || t.players.filter(p => p.active).length < 2) finishTournament(t, now);
  else { t.status = 'between'; t.nextRoundAt = isPresencial(t) ? null : now + (t.challenge ? MATCH_BREAK_MS : BREAK_MS); }
}
function chessFor(g) {
  const cached = engines.get(g);
  if (cached && cached.length === g.moves.length) return cached.chess;
  const c = new Chess();
  for (const san of g.moves) c.move(san);
  engines.set(g, { length: g.moves.length, chess: c });
  return c;
}
function endGame(g, result, reason, now) {
  if (g.fen) {
    const key = g.turn === 'w' ? 'whiteMs' : 'blackMs';
    g[key] = Math.max(0, g[key] - Math.max(0, now - g.lastAt));
    g.lastAt = now;
  }
  g.result = result; g.reason = reason; g.offer = null; g.finishedAt = now;
}
export function canPossiblyMate(chess, color) {
  const pieces = chess.board().flat().filter(Boolean), own = pieces.filter(p => p.color === color && p.type !== 'k');
  if (!own.length) return false;
  if (own.some(p => 'pqr'.includes(p.type))) return true;
  if (own.length >= 2 && own.some(p => p.type === 'n')) return true;
  const bishopColors = own.filter(p => p.type === 'b').map(p => (p.square.charCodeAt(0) + Number(p.square[1])) % 2);
  if (new Set(bishopColors).size > 1) return true;
  const opposing = pieces.filter(p => p.color !== color && p.type !== 'k');
  if (!opposing.length) return false;
  if (own.every(p => p.type === 'b') && opposing.every(p => p.type === 'b') && opposing.every(p => (p.square.charCodeAt(0) + Number(p.square[1])) % 2 === bishopColors[0])) return false;
  return true;
}
export function expireGames(t, now = Date.now()) {
  if (isPresencial(t)) return false;
  let changed = false;
  for (const g of t.games) {
    if (g.result) continue;
    const key = g.turn === 'w' ? 'whiteMs' : 'blackMs';
    const flagAt = g.lastAt + g[key];
    if (now < flagAt) continue;
    const other = g.turn === 'w' ? 'b' : 'w';
    g[key] = 0;
    const possible = canPossiblyMate(chessFor(g), other);
    endGame(g, possible ? (g.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2', possible ? 'Tiempo agotado' : 'Tiempo agotado; rival sin material para dar mate', now);
    g.finishedAt = Math.min(now, flagAt); // la bandera cae cuando se agota el reloj, aunque se detecte un poco después
    changed = true;
  }
  if (changed) afterResults(t, now);
  return changed;
}
export function advance(t, now = Date.now()) {
  let changed = expireGames(t, now);
  if (!isPresencial(t) && t.status === 'waiting' && t.startsAt && now >= t.startsAt) {
    if (t.players.length >= 2) startTournament(t, now);
    else { t.status = 'cancelled'; t.notice = 'Cancelado: no se alcanzaron dos inscritos.'; t.finishedAt = now; }
    changed = true;
  }
  if (t.status === 'between' && t.nextRoundAt && now >= t.nextRoundAt) { beginRound(t, now); changed = true; }
  if (isArena(t) && t.status === 'playing' && now >= t.endsAt) { afterResults(t, now); changed ||= t.status !== 'playing'; }
  return changed;
}
export function nextAlarm(t, now = Date.now()) {
  const times = [t.expiresAt];
  if (!isPresencial(t) && t.status === 'waiting' && t.startsAt) times.push(t.startsAt);
  if (t.status === 'between' && t.nextRoundAt) times.push(t.nextRoundAt);
  if (isArena(t) && t.status === 'playing') {
    if (t.endsAt > now) times.push(t.endsAt);
    // Despertar cuando termine la pausa de quien acaba de jugar. Solo instantes futuros: si no, la alarma se repetiría sin parar.
    for (const p of t.players) { const ready = arenaReadyAt(t, p.id); if (p.active && ready > now && ready < arenaPairingsCloseAt(t)) times.push(ready); }
  }
  if (!isPresencial(t)) for (const g of t.games) if (!g.result) times.push(g.lastAt + (g.turn === 'w' ? g.whiteMs : g.blackMs));
  return Math.min(...times);
}

export function act(t, playerId, host, action, now = Date.now()) {
  const p = t.players.find(p => p.id === playerId);
  if (['presencial-player', 'presencial-result', 'presencial-next'].includes(action.type)) {
    requireThat(host && isPresencial(t), 'Solo el organizador del torneo presencial puede realizar esta acción.', 403);
    if (action.type === 'presencial-player') {
      requireThat(t.status === 'waiting', 'Las inscripciones están cerradas.');
      const rating = action.rating === '' || action.rating == null ? null : Number(action.rating);
      requireThat(rating === null || (Number.isInteger(rating) && rating >= 0 && rating <= 4000), 'El Elo debe estar entre 0 y 4000.');
      const added = joinTournament(t, action.name, crypto.randomUUID(), now, t.joinKey || '', null, true);
      added.rating = rating || null;
    } else if (action.type === 'presencial-next') {
      requireThat(t.status === 'between', 'Completa todos los resultados antes de la siguiente ronda.');
      beginRound(t, now);
    } else {
      const g = t.games.find(g => g.id === action.game);
      requireThat(g && !g.bye && g.round === t.round, 'Solo se puede corregir un resultado de la ronda actual.', 409);
      requireThat(['playing', 'between', 'finished'].includes(t.status), 'No puedes anotar resultados ahora.');
      requireThat(['1-0', '1/2-1/2', '0-1', null].includes(action.result), 'Elige un resultado válido.');
      g.result = action.result; g.reason = action.result ? 'Resultado anotado por la organización' : ''; g.finishedAt = action.result ? now : null;
      t.status = 'playing'; t.finishedAt = null; t.nextRoundAt = null;
      afterResults(t, now);
    }
    return;
  }
  if (action.type === 'start') { requireThat(host, 'Solo el organizador puede iniciar el torneo.', 403); startTournament(t, now); return; }
  if (action.type === 'cancel') {
    requireThat(host, 'Solo el organizador puede cancelar el torneo.', 403);
    requireThat(!['finished', 'cancelled'].includes(t.status), 'El torneo ya ha terminado.');
    for (const g of t.games) if (!g.result) endGame(g, '1/2-1/2', 'Torneo cancelado', now);
    t.status = 'cancelled'; t.finishedAt = now; t.nextRoundAt = null; t.notice = 'El organizador ha cancelado el torneo.'; return;
  }
  if (action.type === 'join-key') {
    requireThat(host, 'Solo el organizador puede cambiar la clave.', 403);
    requireThat(!['finished', 'cancelled'].includes(t.status), 'El torneo ya ha terminado.');
    t.joinKey = cleanJoinKey(action.key); return;
  }
  if (action.type === 'remove') {
    requireThat(host && t.status === 'waiting', 'Solo se pueden retirar inscritos antes del inicio.', 403);
    t.players = t.players.filter(p => p.id !== action.playerId); return;
  }
  requireThat(!isPresencial(t), 'Los resultados presenciales los anota el organizador.', 403);
  requireThat(p, 'Primero debes inscribirte en el torneo.', 403);
  if (action.type === 'pause' || action.type === 'resume') {
    requireThat(isArena(t) && ['waiting', 'playing'].includes(t.status) && p.active, 'Ahora no se puede pausar.');
    p.paused = action.type === 'pause'; return;
  }
  if (action.type === 'withdraw') {
    if (t.status === 'waiting') { t.players = t.players.filter(x => x !== p); return; }
    requireThat(['playing', 'between'].includes(t.status) && p.active, 'No puedes retirarte ahora.');
    p.active = false;
    for (const g of t.games) if (!g.result && (g.white === p.id || g.black === p.id)) endGame(g, g.white === p.id ? '0-1' : '1-0', 'Retirada del torneo', now);
    afterResults(t, now); return;
  }
  const g = t.games.find(g => g.id === action.game);
  requireThat(g && !g.bye, 'No se encuentra esa partida.', 404);
  requireThat(!g.result, 'La partida ya ha terminado.');
  requireThat(g.white === p.id || g.black === p.id, 'Solo pueden jugar los participantes de esta partida.', 403);
  const color = g.white === p.id ? 'w' : 'b';
  if (action.type === 'berserk') {
    // Como en Lichess: antes de tu primera jugada, juegas con la mitad del tiempo y sin incremento.
    const flag = color === 'w' ? 'berserkW' : 'berserkB', key = color === 'w' ? 'whiteMs' : 'blackMs';
    requireThat(isArena(t), 'Berserk solo existe en el modo arena.');
    requireThat(!g[flag], 'Ya has activado Berserk.');
    requireThat(g.moves.length < (color === 'w' ? 1 : 2), 'Berserk solo se puede activar antes de tu primera jugada.');
    g[flag] = true;
    // Excepción de Lichess: 1+2 se convierte en 1+0, sin reducir el minuto inicial.
    if (!(t.minutes === 1 && t.increment === 2)) g[key] = Math.max(1000, g[key] - t.minutes * 30000);
  } else if (action.type === 'resign') endGame(g, color === 'w' ? '0-1' : '1-0', 'Abandono', now);
  else if (action.type === 'offer-draw') { requireThat(g.offer !== p.id, 'Ya has ofrecido tablas.'); g.offer = p.id; }
  else if (action.type === 'decline-draw') { requireThat(g.offer && g.offer !== p.id, 'No hay una oferta de tablas del rival.'); g.offer = null; }
  else if (action.type === 'accept-draw') {
    requireThat(g.offer && g.offer !== p.id, 'No hay una oferta de tablas del rival.');
    endGame(g, '1/2-1/2', 'Tablas acordadas', now);
  } else if (action.type === 'move') {
    requireThat(color === g.turn, 'Es el turno de tu rival.');
    requireThat(Number.isInteger(action.ply) && action.ply === g.moves.length, 'La posición ha cambiado. Espera a que se actualice el tablero.', 409);
    requireThat(/^[a-h][1-8]$/.test(action.from) && /^[a-h][1-8]$/.test(action.to), 'Casilla no válida.');
    requireThat(!action.promotion || /^[qrbn]$/.test(action.promotion), 'Promoción no válida.');
    const key = color === 'w' ? 'whiteMs' : 'blackMs';
    const remaining = g[key] - Math.max(0, now - g.lastAt);
    requireThat(remaining > 0, 'Se ha agotado tu tiempo.');
    const chess = chessFor(g);
    let move; try { move = chess.move({ from: action.from, to: action.to, promotion: action.promotion || 'q' }); } catch { throw new GameError('Esa jugada no es legal.'); }
    g[key] = remaining + ((color === 'w' ? g.berserkW : g.berserkB) ? 0 : t.increment * 1000);
    g.lastAt = now; g.moves.push(move.san); g.turn = chess.turn(); g.fen = chess.fen();
    g.lastMove = { from: move.from, to: move.to };
    engines.set(g, { length: g.moves.length, chess });
    if (g.offer && g.offer !== p.id) g.offer = null;
    if (chess.isCheckmate()) endGame(g, color === 'w' ? '1-0' : '0-1', 'Jaque mate', now);
    else if (chess.isStalemate()) endGame(g, '1/2-1/2', 'Ahogado', now);
    else if (chess.isInsufficientMaterial()) endGame(g, '1/2-1/2', 'Material insuficiente', now);
    else if (chess.isThreefoldRepetition()) endGame(g, '1/2-1/2', 'Triple repetición automática', now);
    else if (chess.isDrawByFiftyMoves()) endGame(g, '1/2-1/2', 'Regla automática de los 50 movimientos', now);
  } else throw new GameError('Acción no válida.');
  afterResults(t, now);
}

// Marcador del reto con los identificadores de jugador de la sala (la web no conoce los de las cuentas).
function duelScore(t) {
  const s = t.challenge.score || { wins: {}, draws: 0 };
  return { draws: s.draws || 0, wins: Object.fromEntries(t.players.map(p => [p.id, s.wins?.[p.accountId] || 0])) };
}
export function summary(t) {
  return { id: t.id, title: t.title, status: t.status, mode: t.mode || 'online', format: t.format || 'swiss', duration: t.duration || null, endsAt: t.endsAt || null,
    pairingsCloseAt: isArena(t) && t.endsAt ? arenaPairingsCloseAt(t) : null,
    minutes: t.minutes, increment: t.increment,
    rounds: t.rounds, round: t.round, capacity: t.capacity, count: t.players.length,
    // Inscritos que se muestran: sin los que han salido del torneo (al terminar, todos).
    listed: t.status === 'finished' ? t.players.length : t.players.filter(p => !p.paused).length, startsAt: t.startsAt, createdAt: t.createdAt, locked: !!t.joinKey,
    pairing: t.pairing || null, challenge: !!t.challenge, duel: t.challenge ? duelScore(t) : null };
}
// Jugadas legales de una partida en curso, calculadas una sola vez por posición.
function legalFor(g) {
  if (!g || g.result || g.bye) return [];
  const chess = chessFor(g), cached = engines.get(g);
  if (!cached.legal) cached.legal = chess.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion || null }));
  return cached.legal;
}
// La partida que ve cada conexión: la elegida, si no la propia y si no la última del torneo.
export function selectedGame(t, playerId, gameId) {
  if (isPresencial(t)) return null;
  const own = playerId ? [...t.games].reverse().find(g => !g.bye && (isArena(t) || g.round === t.round) && (g.white === playerId || g.black === playerId)) : null;
  // Un jugador sin partida (esperando rival o descansando) no recibe la de otros: solo si la pide.
  // Al espectador se le enseña la última partida.
  const player = playerId && t.players.some(p => p.id === playerId);
  return t.games.find(g => g.id === gameId && !g.bye) || own || (player ? null : [...t.games].reverse().find(g => !g.bye)) || null;
}
export function gameDetail(g) { return g ? { ...g, legal: legalFor(g) } : null; }
// Parte común del estado: igual para todos, se calcula una vez por envío (como Lichess, que no
// recalcula la clasificación para cada espectador).
export function sharedSnapshot(t, now = Date.now()) {
  return { type: 'state', ...summary(t), revision: t.revision, serverNow: now, nextRoundAt: t.nextRoundAt,
    finishedAt: t.finishedAt, notice: t.notice,
    standings: standings(t).map(({ opponents, colors, seed, ...p }) => p),
    games: t.games.map(g => ({ id: g.id, round: g.round, white: g.white, black: g.black, result: g.result, reason: g.reason, bye: g.bye,
      berserkW: !!g.berserkW, berserkB: !!g.berserkB,
      // Suizo y cerrado: las terminadas de la ronda en curso llevan su posición final, para seguir
      // viéndolas en la página de tableros hasta que empiece la ronda siguiente.
      ...(g.result && !g.bye && !isArena(t) && !isPresencial(t) && g.round === t.round ? { fen: g.fen, lastMove: g.lastMove || null } : {}),
      ...(g.result || g.bye || isPresencial(t) ? {} : { fen: g.fen, lastMove: g.lastMove || null, turn: g.turn, whiteMs: g.whiteMs, blackMs: g.blackMs, lastAt: g.lastAt, ply: g.moves.length }) })) };
}
// Parte de cada conexión: quién es, si organiza y su tablero.
export function personalPart(t, playerId, host, gameId) {
  return { me: playerId || null, host: !!host, ...(host ? { joinKey: t.joinKey || '' } : {}), game: gameDetail(selectedGame(t, playerId, gameId)) };
}
export function snapshot(t, playerId, host, gameId, now = Date.now()) {
  return { ...sharedSnapshot(t, now), ...personalPart(t, playerId, host, gameId) };
}
// Una jugada sin final de partida viaja sola, en unos cientos de bytes, en lugar del torneo entero.
export function moveMessage(t, g, now = Date.now()) {
  return { type: 'move', revision: t.revision, serverNow: now, game: { id: g.id, ply: g.moves.length, san: g.moves[g.moves.length - 1],
    fen: g.fen, lastMove: g.lastMove || null, turn: g.turn, whiteMs: g.whiteMs, blackMs: g.blackMs, lastAt: g.lastAt, offer: g.offer || null, legal: legalFor(g) } };
}
export function exportPgn(t, gameId) {
  requireThat(!isPresencial(t), 'Los torneos presenciales no registran las jugadas.', 404);
  const games = t.games.filter(g => !g.bye && (!gameId || g.id === gameId));
  requireThat(games.length > 0, 'No hay partidas para descargar.', 404);
  requireThat(games.every(g => g.result), 'Las partidas se pueden descargar cuando hayan terminado.', 403);
  const name = id => t.players.find(p => p.id === id)?.name || 'Jugador';
  return games.map(g => {
    const c = chessFor(g), date = new Date(g.lastAt).toISOString().slice(0, 10).replaceAll('-', '.');
    c.header('Event', t.title, 'Site', 'Apejupo', 'Date', date, 'Round', String(g.round), 'White', name(g.white), 'Black', name(g.black), 'Result', g.result, 'TimeControl', `${t.minutes * 60}+${t.increment}`, 'Termination', g.reason);
    return c.pgn();
  }).join('\n\n');
}
