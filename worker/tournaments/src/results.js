// Resultados de una mesa y puntos de cada jugador.
// Partida normal: 1-0, ½-½, 0-1 y, por incomparecencia, +- (gana blancas) o -+ (gana negras).
// Round-Robin a doble vuelta presencial: cada emparejamiento es un mini-match de dos partidas (una con cada
// color) en la misma ronda, y se anota el marcador conjunto: 2-0, 1,5-0,5, 1-1, 0,5-1,5, 0-2, +- o -+.
export const SINGLE_RESULTS = ['1-0', '1/2-1/2', '0-1', '+-', '-+'];
export const MATCH_RESULTS = ['2-0', '1.5-0.5', '1-1', '0.5-1.5', '0-2', '+-', '-+'];
/** Partidas que vale cada mesa: 2 en la doble vuelta presencial, 1 en lo demás. */
export const gamesPerTable = t => t.mode === 'presencial' && t.format === 'double-closed' ? 2 : 1;
export const validResults = t => gamesPerTable(t) === 2 ? MATCH_RESULTS : SINGLE_RESULTS;
const WHITE = { '2-0': 2, '1.5-0.5': 1.5, '1-1': 1, '0.5-1.5': .5, '0-2': 0 };
/** Puntos de las blancas (las negras se llevan el resto hasta `gamesPerTable`). */
export function whiteScore(t, result) {
  const n = gamesPerTable(t);
  if (result in WHITE) return WHITE[result];
  if (result === '1-0' || result === '+-') return n;
  if (result === '0-1' || result === '-+') return 0;
  return n / 2; // tablas (también las que se ponen al cancelar un torneo)
}
export const isForfeit = result => result === '+-' || result === '-+';
