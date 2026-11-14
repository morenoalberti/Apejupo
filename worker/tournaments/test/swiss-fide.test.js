// Suizo con el motor FIDE (bbpPairings compilado a WebAssembly).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBbp, runDutch } from '../src/bbp-engine.js';
import { createTournament, joinTournament, startTournament, act, advance, setSwissEngine, BREAK_MS } from '../src/core.js';
import { toTrf } from '../src/swiss-dutch.js';

await loadBbp(new WebAssembly.Module(readFileSync(new URL('../src/bbp/bbp.wasm', import.meta.url))));
const NOW = 1800000000000;

function swiss(count, rounds, elo = i => 2400 - i * 37) {
  const t = createTournament({ title: 'Suizo FIDE de prueba', minutes: 5, increment: 3, rounds, capacity: 128 }, 'b'.repeat(24), 'host', NOW);
  for (let i = 0; i < count; i++) joinTournament(t, 'Jugador ' + String(i + 1).padStart(3, '0'), 'secret-' + i, NOW, '', elo(i) ? { id: 'cuenta' + i, nick: 'Jugador' + i, elo: elo(i) } : null);
  return t;
}
// Resultado al azar pero reproducible: gana el de más Elo dos de cada tres veces.
function playRound(t, now, rnd) {
  for (const g of t.games.filter(g => g.round === t.round && !g.result && !g.bye)) {
    const w = t.players.find(p => p.id === g.white), b = t.players.find(p => p.id === g.black);
    const r = rnd(), strong = (w.rating || 0) >= (b.rating || 0) ? 'w' : 'b';
    const loser = r < 0.15 ? null : (r < 0.72) === (strong === 'w') ? g.black : g.white;
    if (loser) act(t, loser, false, { type: 'resign', game: g.id }, ++now.v);
    else { act(t, g.white, false, { type: 'offer-draw', game: g.id }, ++now.v); act(t, g.black, false, { type: 'accept-draw', game: g.id }, ++now.v); }
  }
}
function rng(seed) { return () => (seed = (seed * 48271) % 2147483647) / 2147483647; }

for (const [count, rounds] of [[10, 5], [11, 5], [32, 7], [57, 7]]) {
  test(`suizo FIDE: ${count} jugadores, ${rounds} rondas, sin repetir rival y colores equilibrados`, () => {
    setSwissEngine(runDutch);
    const t = swiss(count, rounds), now = { v: NOW }, rnd = rng(count * 7 + rounds);
    startTournament(t, now.v);
    // Números iniciales por Elo, de mayor a menor.
    assert.deepEqual([...t.players].sort((a, b) => a.seed - b.seed).map(p => p.rating), [...t.players].map(p => p.rating).sort((a, b) => b - a));
    for (let r = 1; r <= rounds; r++) {
      assert.equal(t.pairing, 'fide', 'la ronda la ha emparejado el motor FIDE');
      playRound(t, now, rnd);
      if (r < rounds) { now.v += BREAK_MS; advance(t, now.v); }
    }
    assert.equal(t.status, 'finished');
    const played = t.games.filter(g => !g.bye), keys = played.map(g => [g.white, g.black].sort().join(':'));
    assert.equal(new Set(keys).size, keys.length, 'nadie repite rival');
    for (const p of t.players) {
      const colors = t.games.filter(g => !g.bye && (g.white === p.id || g.black === p.id)).sort((a, b) => a.round - b.round).map(g => g.white === p.id ? 'w' : 'b');
      const diff = colors.filter(c => c === 'w').length - colors.filter(c => c === 'b').length;
      assert.ok(Math.abs(diff) <= 2, `diferencia de colores de ${p.name}: ${diff}`);
      assert.ok(!/www|bbb/.test(colors.join('')), `tres seguidas del mismo color: ${p.name} ${colors.join('')}`);
      assert.ok(t.games.filter(g => g.bye && g.white === p.id).length <= 1, 'como mucho un descanso');
    }
    setSwissEngine(null);
  });
}

test('suizo FIDE: primera ronda como la FIDE (1 contra la mitad+1) y el retirado no se empareja', () => {
  setSwissEngine(runDutch);
  const t = swiss(8, 3); startTournament(t, NOW);
  const bySeed = s => t.players.find(p => p.seed === s).id;
  const firstRound = t.games.filter(g => g.round === 1).map(g => [g.white, g.black].sort().join(':')).sort();
  assert.deepEqual(firstRound, [[1, 5], [2, 6], [3, 7], [4, 8]].map(([a, b]) => [bySeed(a), bySeed(b)].sort().join(':')).sort());
  const quitter = bySeed(8);
  act(t, quitter, false, { type: 'withdraw' }, NOW + 1000);
  for (const g of t.games.filter(g => !g.result)) act(t, g.white, false, { type: 'resign', game: g.id }, NOW + 2000);
  advance(t, NOW + 2000 + BREAK_MS);
  assert.equal(t.pairing, 'fide');
  assert.ok(!t.games.some(g => g.round === 2 && (g.white === quitter || g.black === quitter)));
  assert.equal(t.games.filter(g => g.round === 2 && g.bye).length, 1, 'siete activos: uno descansa');
  setSwissEngine(null);
});

test('suizo: jugadores sin Elo van detrás, por orden alfabético; el TRF lleva su línea completa', () => {
  const t = swiss(4, 3, i => [1900, 0, 2100, 0][i]);
  t.players[1].name = 'Zoe'; t.players[3].name = 'Ana';
  startTournament(t, NOW);
  assert.deepEqual([...t.players].sort((a, b) => a.seed - b.seed).map(p => p.rating ?? p.name), [2100, 1900, 'Ana', 'Zoe']);
  assert.throws(() => toTrf(t), /sin terminar/);
  const top = t.players.find(p => p.seed === 1).id;
  for (const g of t.games.filter(g => !g.result)) act(t, g.white === top ? g.black : g.white, false, { type: 'resign', game: g.id }, NOW + 1000);
  // Columnas fijas del TRF: Elo en 49-52, puntos en 81-84 y la ronda 1 desde la 92.
  const line = toTrf(t).split('\n').find(l => l.startsWith('001    1'));
  assert.equal(line.slice(48, 52), '2100');
  assert.equal(line.slice(80, 84), ' 1.0');
  assert.match(line.slice(91, 99), /^ {3}\d [wb] 1$/);
});

test('suizo: sin motor (o si falla) se usa el emparejamiento de club', () => {
  setSwissEngine(() => { throw new Error('motor roto'); });
  const t = swiss(6, 3); startTournament(t, NOW);
  assert.equal(t.pairing, 'club'); assert.equal(t.games.filter(g => g.round === 1).length, 3);
  setSwissEngine(null);
});
