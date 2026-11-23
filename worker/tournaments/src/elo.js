// ELO del club: cada cuenta empieza con 1500 y cada partida de torneo entre dos cuentas lo actualiza con K = 20.
// Los invitados (jugadores con alias, sin cuenta) no tienen ELO y sus partidas no cuentan.
export const ELO_START = 1500;
export const ELO_K = 20;

// Puntuación esperada de A frente a B (fórmula de Elo).
export function expectedScore(a, b) { return 1 / (1 + 10 ** ((b - a) / 400)); }

// ELO de blancas y negras después de la partida. result: '1-0', '0-1' o '1/2-1/2'.
export function eloAfter(white, black, result) {
  const score = { '1-0': 1, '0-1': 0, '1/2-1/2': 0.5 }[result];
  if (score === undefined) throw new Error('Resultado no válido.');
  const delta = ELO_K * (score - expectedScore(white, black));
  return { white: Math.round(white + delta), black: Math.round(black - delta) };
}
