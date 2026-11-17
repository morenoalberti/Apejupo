// Sistemas de desempate que elige el organizador (suizo y Round-Robin), en el orden en que se aplican.
// Siguen el planteamiento del reglamento de desempates de la FIDE (2023): las rondas no jugadas
// (descansos, incomparecencias, rondas en que el jugador no estaba) se tratan aparte.
import { gamesPerTable, whiteScore, isForfeit } from './results.js';

export const TIEBREAKS = {
  bh1: { label: 'Buchholz -1', short: 'BH-1' },
  bh: { label: 'Buchholz', short: 'BH' },
  sb: { label: 'Sonneborn-Berger', short: 'SB' },
  prog: { label: 'Progresivo', short: 'PROG' },
  de: { label: 'Encuentro directo', short: 'ED' },
  win: { label: 'Victorias', short: 'V' },
  bwin: { label: 'Victorias con negras', short: 'VN' },
  koya: { label: 'Koya', short: 'KS' },
  aro: { label: 'Media de Elo de los rivales', short: 'ARO' }
};
export const MAX_TIEBREAKS = 5;
const SWISS = ['bh1', 'bh', 'sb', 'prog', 'de', 'win', 'bwin', 'aro'];
const ROUND_ROBIN = ['de', 'sb', 'win', 'bwin', 'koya', 'aro'];
const closedFormat = format => format === 'closed' || format === 'double-closed';
export const allowedTiebreaks = format => format === 'arena' ? [] : closedFormat(format) ? ROUND_ROBIN : SWISS;
export const defaultTiebreaks = format => format === 'arena' ? [] : closedFormat(format) ? ['de', 'sb', 'win', 'koya'] : ['bh1', 'bh', 'sb', 'prog'];
/** Lista válida para el formato: sin repetidos ni códigos desconocidos; vacía o ausente = la habitual. */
export function cleanTiebreaks(format, list) {
  const allowed = allowedTiebreaks(format);
  const clean = Array.isArray(list) ? [...new Set(list.map(String))].filter(k => allowed.includes(k)).slice(0, MAX_TIEBREAKS) : [];
  return clean.length ? clean : defaultTiebreaks(format);
}
/** Los desempates del torneo (los antiguos, sin elegir, usan los habituales de su formato). */
export const tiebreaksOf = t => t.challenge ? [] : t.tiebreaks?.length ? t.tiebreaks : defaultTiebreaks(t.format);

// Ronda a ronda de cada jugador: rival, puntos y si la partida se jugó de verdad.
function history(t) {
  const n = gamesPerTable(t), byPlayer = new Map(t.players.map(p => [p.id, new Map()]));
  for (const g of t.games) {
    if (g.bye) { if (g.result) byPlayer.get(g.white)?.set(g.round, { opp: null, s: g.rest ? 0 : n, played: false }); continue; }
    if (!g.result) continue;
    const w = whiteScore(t, g.result), played = !isForfeit(g.result);
    byPlayer.get(g.white)?.set(g.round, { opp: g.black, s: w, played, black: false });
    byPlayer.get(g.black)?.set(g.round, { opp: g.white, s: n - w, played, black: true });
  }
  return byPlayer;
}
// Última ronda con todos sus resultados: las rondas a medias no cuentan para los desempates.
function roundsDone(t) {
  let done = 0;
  for (let r = 1; r <= t.round; r++) if (t.games.some(g => g.round === r) && t.games.filter(g => g.round === r && !g.bye).every(g => g.result)) done = r;
  return done;
}

/** Calcula row.tb = { bh1, bh, sb, prog, win, bwin, koya, aro } para cada fila de la clasificación. */
export function computeTiebreaks(t, rows) {
  const n = gamesPerTable(t), hist = history(t), done = roundsDone(t), byId = new Map(rows.map(r => [r.id, r]));
  const rating = new Map(t.players.map(p => [p.id, p.rating || 0]));
  const rounds = Array.from({ length: done }, (_, i) => i + 1);
  // Puntos «ajustados» del rival: cada ronda que no jugó cuenta como tablas.
  const adjusted = new Map(rows.map(r => [r.id, rounds.reduce((sum, k) => { const e = hist.get(r.id)?.get(k); return sum + (e?.played ? e.s : n / 2); }, 0)]));
  const half = n * Math.max(1, t.players.length - 1) / 2; // Koya: rivales con al menos la mitad de los puntos posibles
  for (const row of rows) {
    const mine = hist.get(row.id) || new Map(), parts = [];
    let sb = 0, prog = 0, run = 0, win = 0, bwin = 0, koya = 0, aroSum = 0, aroN = 0;
    for (const k of rounds) {
      const e = mine.get(k);
      run += e ? e.s : 0; prog += run;
      // Buchholz: rival real (sus puntos ajustados) o, en una ronda no jugada, un rival virtual con los puntos del propio jugador.
      parts.push(e?.played ? adjusted.get(e.opp) ?? 0 : row.points);
      if (!e || e.opp === null) continue;
      if (e.s > n / 2) { win++; if (e.played && e.black) bwin++; }
      if (!e.played) continue;
      sb += (adjusted.get(e.opp) ?? 0) * e.s;
      if ((byId.get(e.opp)?.points ?? 0) >= half) koya += e.s;
      if (rating.get(e.opp)) { aroSum += rating.get(e.opp); aroN++; }
    }
    const bh = parts.reduce((a, b) => a + b, 0);
    row.tb = { bh, bh1: parts.length > 1 ? bh - Math.min(...parts) : bh, sb, prog, win, bwin, koya, aro: aroN ? Math.round(aroSum / aroN) : 0, de: null };
  }
}

// Encuentro directo: solo cuenta si todos los empatados se han enfrentado entre sí.
function directEncounter(t, group) {
  const ids = new Set(group.map(r => r.id)), score = new Map(group.map(r => [r.id, 0])), met = new Set();
  for (const g of t.games) {
    if (g.bye || !g.result || !ids.has(g.white) || !ids.has(g.black)) continue;
    const w = whiteScore(t, g.result);
    score.set(g.white, score.get(g.white) + w); score.set(g.black, score.get(g.black) + gamesPerTable(t) - w);
    met.add([g.white, g.black].sort().join('|'));
  }
  return met.size === group.length * (group.length - 1) / 2 ? score : null;
}

/** Ordena por puntos y después por cada desempate; los que siguen empatados, por número de sorteo. */
export function orderByTiebreaks(t, rows, keys = ['points', ...tiebreaksOf(t)]) {
  if (rows.length < 2 || !keys.length) return rows.sort((a, b) => a.seed - b.seed);
  const [key, ...rest] = keys;
  if (key === 'de') { const s = directEncounter(t, rows); for (const r of rows) r.tb.de = s ? s.get(r.id) : null; }
  const value = r => key === 'points' ? r.score ?? r.points : r.tb[key] ?? 0; // «score»: puntos con la puntuación del torneo
  rows.sort((a, b) => value(b) - value(a));
  const out = [];
  for (let i = 0; i < rows.length;) {
    let j = i + 1;
    while (j < rows.length && Math.abs(value(rows[j]) - value(rows[i])) < 1e-9) j++;
    out.push(...orderByTiebreaks(t, rows.slice(i, j), rest));
    i = j;
  }
  return out;
}
