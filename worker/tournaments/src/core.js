import { Chess } from 'chess.js';

// Comprobado con la prueba de carga: 128 jugadores y 32 espectadores sin retrasos apreciables.
export const MAX_PLAYERS = 128;
export const BREAK_MS = 30000;
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
export const BERSERK_BONUS = .5;
// Como en Lichess: se deja de emparejar cuando queda menos de la mitad del tiempo base de una partida
// (entre 30 s y 2 min), y las partidas que acaban después del tiempo se juegan pero no cuentan.
export const arenaPairingsCloseAt = t => t.endsAt - Math.max(30, Math.min(t.minutes * 30, 120)) * 1000;
const countsForArena = (t, g) => !isArena(t) || !t.endsAt || g.bye || !g.result || g.finishedAt <= t.endsAt;
export const BERSERK_MIN_PLIES = 13; // al menos 7 jugadas de blancas para cobrar el extra
const berserkBonus = (g, color) => !!(color === 'w' ? g.berserkW : g.berserkB) && g.moves.length >= BERSERK_MIN_PLIES;
export function createTournament(input, id, hostHash, now = Date.now()) {
  const title = cleanName(input.title, 70);
  const format = input.format === 'arena' ? 'arena' : 'swiss';
  const minutes = Number(input.minutes), increment = Number(input.increment);
  const capacity = Number(input.capacity), joinKey = cleanJoinKey(input.joinKey);
  const rounds = format === 'arena' ? 0 : Number(input.rounds);
  const duration = format === 'arena' ? Number(input.duration) : null;
  requireThat(title.length >= 4, 'El nombre del torneo debe tener al menos 4 caracteres.');
  requireThat([1, 2, 3, 5, 10, 15].includes(minutes), 'Elige un ritmo válido.');
  requireThat([0, 2, 3, 5, 10].includes(increment), 'Elige un incremento válido.');
  if (format === 'arena') {
    requireThat(ARENA_DURATIONS.includes(duration), 'Elige una duración válida.');
    requireThat(duration >= minutes * 3, 'La duración debe dar para varias partidas: al menos el triple de los minutos por jugador.');
  } else requireThat(Number.isInteger(rounds) && rounds >= 1 && rounds <= 9, 'Elige entre 1 y 9 rondas.');
  requireThat(Number.isInteger(capacity) && capacity >= 2 && capacity <= MAX_PLAYERS, `El límite es de 2 a ${MAX_PLAYERS} jugadores.`);
  let startsAt = input.startsAt ? Number(input.startsAt) : null;
  requireThat(!startsAt || (Number.isFinite(startsAt) && startsAt > now + 60000 && startsAt < now + 14 * 86400000), 'La fecha de inicio debe estar entre un minuto y 14 días en el futuro.');
  return { id, title, hostHash, format, duration, endsAt: null, minutes, increment, rounds, capacity, startsAt, createdAt: now,
    expiresAt: now + RETENTION_MS, status: 'waiting', round: 0, nextRoundAt: null,
    players: [], games: [], revision: 0, finishedAt: null, notice: '', joinKey };
}

export function standings(t) {
  const rows = t.players.map(p => ({ id: p.id, name: p.name, seed: p.seed, active: p.active, registered: !!p.accountId,
    points: 0, wins: 0, buchholz: 0, sonneborn: 0, played: 0, byes: 0, opponents: [], colors: [], sheet: [] }));
  const map = new Map(rows.map(p => [p.id, p]));
  const counted = t.games.filter(g => countsForArena(t, g));
  for (const g of counted) {
    const white = map.get(g.white), black = map.get(g.black);
    if (!white) continue;
    if (g.bye) { white.points += 1; white.byes++; white.sheet.push({ s: 1, bye: true }); continue; }
    white.colors.push('w'); black.colors.push('b');
    white.opponents.push(black.id); black.opponents.push(white.id);
    if (!g.result) continue;
    white.played++; black.played++;
    const a = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : .5;
    white.points += a; black.points += 1 - a;
    if (a === 1) white.wins++; if (a === 0) black.wins++;
    // Berserk: medio punto extra a quien gana tras jugar con la mitad del tiempo.
    const bonusW = a === 1 && berserkBonus(g, 'w'), bonusB = a === 0 && berserkBonus(g, 'b');
    if (bonusW) white.points += BERSERK_BONUS; if (bonusB) black.points += BERSERK_BONUS;
    white.sheet.push({ s: a, berserk: !!g.berserkW, bonus: bonusW });
    black.sheet.push({ s: 1 - a, berserk: !!g.berserkB, bonus: bonusB });
  }
  for (const g of counted) {
    if (!g.result || g.bye) continue;
    const a = map.get(g.white), b = map.get(g.black);
    const score = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : .5;
    a.buchholz += b.points; b.buchholz += a.points;
    a.sonneborn += b.points * score; b.sonneborn += a.points * (1 - score);
  }
  for (const p of t.players) { const row = map.get(p.id); row.paused = !!p.paused; row.playing = t.games.some(g => !g.result && (g.white === p.id || g.black === p.id)); }
  // Arena: con número de partidas desigual, Buchholz no es comparable; desempatan victorias y eficacia.
  if (isArena(t)) return rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played || a.seed - b.seed);
  return rows.sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || b.sonneborn - a.sonneborn || b.wins - a.wins || a.seed - b.seed);
}

// Arena: cada jugador libre (conectado, sin pausa y tras una breve pausa desde su última partida)
// se empareja con otro libre. El que más tiempo lleva esperando elige primero; se busca un rival
// de puntuación parecida y se evita repetir el último rival si hay alternativa.
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
    const a = free.shift(), last = lastGame(t, a.id), lastRival = last && (last.white === a.id ? last.black : last.white);
    const options = free.filter(b => b.id !== lastRival);
    const pool = options.length ? options : free;
    const b = pool.reduce((best, c) => Math.abs(c.points - a.points) < Math.abs(best.points - a.points) ? c : best);
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

// «account» solo lo pone el servidor tras comprobar la sesión: { id, nick } de una cuenta confirmada.
export function joinTournament(t, name, playerHash, now = Date.now(), key = '', account = null) {
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
  const p = { id: crypto.randomUUID(), hash: playerHash, name, active: true, seed: t.players.length + 1, joinedAt: now, ...(account ? { accountId: account.id } : {}) };
  t.players.push(p);
  return p;
}

function newGame(t, a, b, now) {
  return { id: crypto.randomUUID(), round: t.round, white: a.id, black: b?.id || null,
    fen: INITIAL_FEN, moves: [], turn: 'w', whiteMs: t.minutes * 60000, blackMs: t.minutes * 60000,
    lastAt: now, result: null, reason: '', offer: null, bye: !b, finishedAt: null };
}
export function beginRound(t, now) {
  const { pairs, bye, repeated } = pairRound(t);
  if (!pairs.length) { finishTournament(t, now); return; }
  t.round++;
  t.nextRoundAt = null;
  t.status = 'playing';
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
  if (!isArena(t)) t.rounds = Math.min(t.rounds, n % 2 ? n : n - 1);
  // Sorteo de los números iniciales, independiente del orden de inscripción.
  const random = new Uint32Array(n); crypto.getRandomValues(random);
  t.players.map((p, i) => ({ p, r: random[i] })).sort((a, b) => a.r - b.r).forEach(({ p }, i) => { p.seed = i + 1; });
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
    // Al cumplirse el tiempo la clasificación queda congelada; las partidas en juego se terminan, pero no cuentan.
    if (t.status === 'playing' && (now >= t.endsAt || t.players.filter(p => p.active).length < 2) && !t.games.some(g => !g.result)) finishTournament(t, now);
    return;
  }
  if (t.status !== 'playing' || t.games.some(g => g.round === t.round && !g.result)) return;
  if (t.round >= t.rounds || t.players.filter(p => p.active).length < 2) finishTournament(t, now);
  else { t.status = 'between'; t.nextRoundAt = now + BREAK_MS; }
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
  const key = g.turn === 'w' ? 'whiteMs' : 'blackMs';
  g[key] = Math.max(0, g[key] - Math.max(0, now - g.lastAt));
  g.lastAt = now;
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
  if (t.status === 'waiting' && t.startsAt && now >= t.startsAt) {
    if (t.players.length >= 2) startTournament(t, now);
    else { t.status = 'cancelled'; t.notice = 'Cancelado: no se alcanzaron dos inscritos.'; t.finishedAt = now; }
    changed = true;
  }
  if (t.status === 'between' && now >= t.nextRoundAt) { beginRound(t, now); changed = true; }
  if (isArena(t) && t.status === 'playing' && now >= t.endsAt) { afterResults(t, now); changed ||= t.status !== 'playing'; }
  return changed;
}
export function nextAlarm(t, now = Date.now()) {
  const times = [t.expiresAt];
  if (t.status === 'waiting' && t.startsAt) times.push(t.startsAt);
  if (t.status === 'between') times.push(t.nextRoundAt);
  if (isArena(t) && t.status === 'playing') {
    times.push(t.endsAt);
    // Despertar cuando termine la pausa de quien acaba de jugar. Solo instantes futuros: si no, la alarma se repetiría sin parar.
    for (const p of t.players) { const ready = arenaReadyAt(t, p.id); if (p.active && ready > now && ready < arenaPairingsCloseAt(t)) times.push(ready); }
  }
  for (const g of t.games) if (!g.result) times.push(g.lastAt + (g.turn === 'w' ? g.whiteMs : g.blackMs));
  return Math.min(...times);
}

export function act(t, playerId, host, action, now = Date.now()) {
  const p = t.players.find(p => p.id === playerId);
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
    g[flag] = true; g[key] = Math.max(1000, g[key] - t.minutes * 30000);
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

export function summary(t) {
  return { id: t.id, title: t.title, status: t.status, format: t.format || 'swiss', duration: t.duration || null, endsAt: t.endsAt || null,
    pairingsCloseAt: isArena(t) && t.endsAt ? arenaPairingsCloseAt(t) : null,
    minutes: t.minutes, increment: t.increment,
    rounds: t.rounds, round: t.round, capacity: t.capacity, count: t.players.length, startsAt: t.startsAt, createdAt: t.createdAt, locked: !!t.joinKey };
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
  const own = playerId ? [...t.games].reverse().find(g => !g.bye && (isArena(t) || g.round === t.round) && (g.white === playerId || g.black === playerId)) : null;
  return t.games.find(g => g.id === gameId && !g.bye) || own || [...t.games].reverse().find(g => !g.bye) || null;
}
export function gameDetail(g) { return g ? { ...g, legal: legalFor(g) } : null; }
// Parte común del estado: igual para todos, se calcula una vez por envío (como Lichess, que no
// recalcula la clasificación para cada espectador).
export function sharedSnapshot(t, now = Date.now()) {
  return { type: 'state', ...summary(t), revision: t.revision, serverNow: now, nextRoundAt: t.nextRoundAt,
    finishedAt: t.finishedAt, notice: t.notice,
    standings: standings(t).map(({ opponents, colors, seed, ...p }) => p),
    games: t.games.map(g => ({ id: g.id, round: g.round, white: g.white, black: g.black, result: g.result, reason: g.reason, bye: g.bye,
      late: !countsForArena(t, g),
      berserkW: !!g.berserkW, berserkB: !!g.berserkB, ...(g.result || g.bye ? {} : { fen: g.fen, lastMove: g.lastMove || null, turn: g.turn, whiteMs: g.whiteMs, blackMs: g.blackMs, lastAt: g.lastAt, ply: g.moves.length }) })) };
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
