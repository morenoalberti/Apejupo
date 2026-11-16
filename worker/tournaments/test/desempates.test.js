import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, editTournament, act, standings, summary } from '../src/core.js';
import { cleanTiebreaks, defaultTiebreaks } from '../src/tiebreaks.js';

const NOW = 1800000000000;
function presencial(names, options = {}) {
  const t = createTournament({ title: 'Desempates', mode: 'presencial', format: 'swiss', minutes: 15, increment: 5, rounds: 3, capacity: 32, ...options }, 'b'.repeat(24), 'host', NOW);
  for (const [name, rating] of names) act(t, null, true, { type: 'presencial-player', name, rating }, NOW);
  return t;
}
const play = (t, results) => { for (const g of t.games.filter(g => g.round === t.round && !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: results(g) }, NOW); };

test('elegir desempates: los habituales por formato, orden propio, filtrado y edición', () => {
  assert.deepEqual(defaultTiebreaks('swiss'), ['bh1', 'bh', 'sb', 'prog']);
  assert.deepEqual(defaultTiebreaks('closed'), ['de', 'sb', 'win', 'koya']);
  assert.deepEqual(defaultTiebreaks('arena'), []);
  assert.deepEqual(cleanTiebreaks('swiss', ['sb', 'koya', 'sb', 'x', 'win']), ['sb', 'win'], 'sin repetidos ni criterios de otro formato');
  assert.deepEqual(cleanTiebreaks('closed', []), ['de', 'sb', 'win', 'koya']);
  assert.equal(cleanTiebreaks('swiss', ['bh1', 'bh', 'sb', 'prog', 'win', 'bwin', 'aro']).length, 5);
  const t = presencial([], { tiebreaks: ['prog', 'bh'] });
  assert.deepEqual(t.tiebreaks, ['prog', 'bh']);
  assert.deepEqual(summary(t).tiebreaks, ['prog', 'bh']);
  editTournament(t, { title: 'Desempates', mode: 'presencial', format: 'swiss', minutes: 15, increment: 5, rounds: 3, capacity: 32 }, NOW);
  assert.deepEqual(t.tiebreaks, ['prog', 'bh'], 'editar sin tocarlos los conserva');
  editTournament(t, { title: 'Desempates', mode: 'presencial', format: 'closed', minutes: 15, increment: 5, capacity: 32 }, NOW);
  assert.deepEqual(t.tiebreaks, ['de', 'sb', 'win', 'koya'], 'al pasar a Round-Robin se usan los suyos');
});

test('Buchholz, Buchholz -1 con rival virtual en el descanso, progresivo y victorias', () => {
  const t = presencial([['Ana', 2000], ['Bea', 1900], ['Cris', 1800], ['Dani', 1700], ['Eva', 1600]]);
  act(t, null, true, { type: 'start' }, NOW);
  play(t, () => '1-0'); act(t, null, true, { type: 'presencial-next' }, NOW);
  play(t, () => '1/2-1/2');
  const rows = standings(t), byName = n => rows.find(r => r.name === n);
  for (const r of rows) {
    assert.ok(r.tb.bh >= r.tb.bh1, 'BH-1 nunca supera al BH');
    assert.equal(r.tb.prog >= r.points, true);
  }
  const rested = t.games.find(g => g.bye && g.round === 1);
  const p = rows.find(r => r.id === rested.white);
  assert.ok(p.tb.bh >= p.points, 'el descanso cuenta como un rival con los puntos del propio jugador');
  // Orden: puntos y después BH-1, BH, SB y progresivo.
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    assert.ok(a.points > b.points || (a.points === b.points && (a.tb.bh1 > b.tb.bh1 || (a.tb.bh1 === b.tb.bh1 && a.tb.bh >= b.tb.bh))));
  }
  assert.ok(byName('Ana').tb.win >= 1);
});

test('encuentro directo: decide entre empatados que se enfrentaron; si no, pasa al siguiente', () => {
  const t = presencial([['Uno', 1500], ['Dos', 1500], ['Tres', 1500], ['Cuatro', 1500]], { format: 'closed', tiebreaks: ['de', 'sb'] });
  act(t, null, true, { type: 'start' }, NOW);
  // Todos ganan con blancas: al final hay empates y el encuentro directo los ordena.
  while (t.status !== 'finished') { play(t, () => '1-0'); if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW); }
  const rows = standings(t);
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.points !== b.points) continue;
    const g = t.games.find(g => !g.bye && [g.white, g.black].includes(a.id) && [g.white, g.black].includes(b.id));
    if (rows.filter(r => r.points === a.points).length === 2) assert.equal(g.white, a.id, 'entre dos empatados, delante quien ganó la partida entre ellos');
  }
});
