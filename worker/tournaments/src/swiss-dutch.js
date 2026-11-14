// Sistema suizo holandés (FIDE) con bbpPairings: se escribe el torneo en formato TRF de la FIDE,
// el motor calcula la ronda siguiente y aquí se traduce su respuesta a parejas de jugadores.
// bbpPairings (c) Jeremy Bierema, licencia Apache 2.0: https://github.com/BieremaBoyzProgramming/bbpPairings
//
// Número de emparejamiento = número inicial (seed), que en el suizo sale del Elo (ver orderByRating).

const pad = (value, width, left = false) => { const s = String(value ?? ''); return (left ? s.padEnd(width) : s.padStart(width)).slice(0, width); };
const points = n => (Math.round(n * 10) / 10).toFixed(1);

// Orden inicial al estilo FIDE: Elo de mayor a menor; sin Elo, detrás y por orden alfabético.
export function orderByRating(players) {
  return [...players].sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name, 'es') || a.joinedAt - b.joinedAt);
}

// Una línea por jugador: casillas fijas del formato TRF (columnas 1-89) y 10 caracteres por ronda desde la 90.
export function toTrf(t) {
  const players = [...t.players].sort((a, b) => a.seed - b.seed);
  const byId = new Map(players.map(p => [p.id, p]));
  const next = t.round + 1;
  const lines = ['012 Apejupo ' + pad(t.id, 24, true), `XXR ${String(t.rounds).padStart(3)}`, 'XXC white1'];
  for (const p of players) {
    let score = 0;
    const cells = [];
    for (let r = 1; r < next; r++) {
      const g = t.games.find(x => x.round === r && (x.white === p.id || x.black === p.id));
      if (!g) { cells.push('0000 - Z'); continue; } // no jugó esa ronda (retirado): cero puntos
      if (g.bye) { cells.push('0000 - U'); score += 1; continue; } // descanso por emparejamiento: un punto
      if (!g.result) throw new Error('Hay partidas sin terminar en la ronda ' + r + '.');
      const white = g.white === p.id, rival = byId.get(white ? g.black : g.white);
      const s = g.result === '1-0' ? (white ? 1 : 0) : g.result === '0-1' ? (white ? 0 : 1) : 0.5;
      score += s;
      cells.push(`${pad(rival.seed, 4)} ${white ? 'w' : 'b'} ${s === 1 ? '1' : s === 0 ? '0' : '='}`);
    }
    // Quien se ha retirado no entra en la ronda que se empareja.
    if (!p.active) cells.push('0000 - Z');
    const rating = Number.isInteger(p.rating) && p.rating > 0 ? p.rating : '';
    const head = '001 ' + pad(p.seed, 4) + '      ' + pad('P' + p.seed, 33, true) + ' ' + pad(rating, 4)
      + ' '.repeat(28) + pad(points(score), 4) + ' ' + pad(p.seed, 4); // puntos en 81-84, puesto en 86-89
    lines.push(head + cells.map(c => '  ' + c).join(''));
  }
  return lines.join('\n') + '\n';
}

// Respuesta del motor: primera línea, número de parejas; luego «blancas negras» (0 = descanso).
export function parsePairs(t, output) {
  const bySeed = new Map(t.players.map(p => [p.seed, p]));
  const rows = output.trim().split(/\s*\n\s*/);
  const count = Number(rows.shift());
  if (!Number.isInteger(count) || rows.length !== count) throw new Error('Respuesta del motor de emparejamientos no válida.');
  const pairs = [];
  let bye = null;
  for (const row of rows) {
    const [w, b] = row.split(/\s+/).map(Number);
    const white = bySeed.get(w);
    if (!white) throw new Error('El motor devolvió un jugador desconocido.');
    if (b === 0) bye = white; else { const black = bySeed.get(b); if (!black) throw new Error('El motor devolvió un jugador desconocido.'); pairs.push([white, black]); }
  }
  return { pairs, bye };
}
