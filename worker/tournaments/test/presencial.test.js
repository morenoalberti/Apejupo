import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, editTournament, joinTournament, act, advance, snapshot, standings, nextAlarm, exportPgn } from '../src/core.js';

const NOW = 1800000000000;
const input = { title: 'Presencial del club', mode: 'presencial', format: 'swiss', minutes: 4, increment: 3, rounds: 5, capacity: 32 };
function tournament(count = 4, options = {}) {
  const t = createTournament({ ...input, ...options }, 'a'.repeat(24), 'host-secret', NOW);
  for (let i = 0; i < count; i++) act(t, null, true, { type: 'presencial-player', name: 'Jugador ' + i, rating: 2200 - 100 * i }, NOW);
  return t;
}

test('modalidades, formatos y cuatro minutos: creación, edición y compatibilidad online', () => {
  for (const format of ['swiss', 'closed', 'double-closed']) {
    const t = tournament(0, { format });
    assert.equal(t.mode, 'presencial'); assert.equal(t.minutes, 4);
    editTournament(t, { ...input, format }, NOW);
    assert.equal(t.format, format);
  }
  assert.throws(() => tournament(0, { format: 'arena' }), /formato/);
  assert.throws(() => tournament(0, { mode: 'online', format: 'double-closed' }), /formato/);
  assert.throws(() => tournament(0, { mode: 'otro' }), /modalidad/);
  const old = tournament(0, { mode: undefined, format: 'arena', duration: 15 });
  assert.equal(old.mode, 'online'); assert.equal(old.minutes, 4);
  delete old.mode;
  assert.equal(snapshot(old).mode, 'online');
  assert.throws(() => editTournament(tournament(), { ...input, mode: 'online' }, NOW), /modalidad/);
});

test('inscripción presencial: nombres y Elo del organizador, sin autoinscripción ni cuentas inventadas', () => {
  const t = tournament(0);
  assert.throws(() => joinTournament(t, 'Intruso', 'token', NOW), /organizador/);
  assert.throws(() => act(t, null, false, { type: 'presencial-player', name: 'Intruso' }, NOW), /organizador/);
  for (const rating of [-1, 4001, 1200.5, 'abc']) assert.throws(() => act(t, null, true, { type: 'presencial-player', name: 'Mal Elo', rating }, NOW), /Elo/);
  assert.equal(t.players.length, 0);
  act(t, null, true, { type: 'presencial-player', name: 'Ana', rating: 1800 }, NOW);
  act(t, null, true, { type: 'presencial-player', name: 'Beatriz', rating: '' }, NOW);
  assert.equal(t.players[0].rating, 1800); assert.equal(t.players[1].rating, null);
  assert.equal(t.players[0].accountId, undefined);
  assert.throws(() => act(t, null, true, { type: 'presencial-player', name: 'ANA' }, NOW), /ese nombre/);
  const publicView = snapshot(t);
  assert.equal(publicView.standings[0].registered, false);
  assert.ok(!JSON.stringify(publicView).includes('host-secret'));
});

test('presencial: inicio y rondas manuales, sin banderas ni tablero virtual, incluso tras reiniciar', () => {
  let t = tournament(4, { startsAt: NOW + 120000 });
  assert.equal(advance(t, NOW + 180000), false); assert.equal(t.status, 'waiting');
  assert.equal(nextAlarm(t, NOW), t.expiresAt);
  act(t, null, true, { type: 'start' }, NOW + 180000);
  assert.equal(t.round, 1); assert.equal(t.games.length, 2);
  for (const g of t.games) { assert.equal(g.whiteMs, undefined); assert.equal(g.fen, undefined); }
  assert.equal(snapshot(t).game, null);
  assert.equal(snapshot(t).games[0].fen, undefined);
  assert.throws(() => exportPgn(t), /presenciales/);
  assert.equal(advance(t, NOW + 86400000), false);
  assert.equal(t.games[0].result, null);
  assert.throws(() => act(t, null, true, { type: 'presencial-next' }, NOW), /resultados/);
  for (const g of t.games) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW + 240000);
  assert.equal(t.status, 'between'); assert.equal(t.nextRoundAt, null);
  t = JSON.parse(JSON.stringify(t));
  assert.equal(advance(t, NOW + 86400000), false); assert.equal(t.round, 1);
  assert.equal(nextAlarm(t), t.expiresAt);
  act(t, null, true, { type: 'presencial-next' }, NOW + 86400000);
  assert.equal(t.round, 2); assert.equal(t.games.length, 4);
  assert.throws(() => act(t, null, true, { type: 'presencial-result', game: t.games[0].id, result: '0-1' }, NOW), /ronda actual/);
});

test('resultados: permisos, corrección y borrado de la ronda actual, clasificación final recalculada', () => {
  const t = tournament(2); act(t, null, true, { type: 'start' }, NOW);
  const g = t.games[0];
  for (const type of ['presencial-next', 'presencial-result']) assert.throws(() => act(t, null, false, { type, game: g.id, result: '1-0' }, NOW), /organizador/);
  assert.throws(() => act(t, g.white, false, { type: 'move', game: g.id }, NOW), /organizador/);
  assert.throws(() => act(t, null, true, { type: 'presencial-result', game: g.id, result: '2-0' }, NOW), /resultado/);
  act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW);
  assert.equal(t.status, 'finished'); assert.equal(standings(t)[0].id, g.white);
  act(t, null, true, { type: 'presencial-result', game: g.id, result: '0-1' }, NOW + 1);
  assert.equal(t.status, 'finished'); assert.equal(standings(t)[0].id, g.black);
  act(t, null, true, { type: 'presencial-result', game: g.id, result: null }, NOW + 2);
  assert.equal(t.status, 'playing'); assert.equal(t.finishedAt, null); assert.equal(standings(t)[0].points, 0);
  act(t, null, true, { type: 'cancel' }, NOW + 3);
  assert.throws(() => act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW + 4), /ahora/);
});

test('Round-Robin doble vuelta: un mini-match de dos partidas por emparejamiento y ronda', () => {
  for (const count of [2, 3, 4, 5, 8]) {
    const t = tournament(count, { format: 'double-closed' });
    act(t, null, true, { type: 'start' }, NOW);
    const leg = count % 2 ? count : count - 1;
    assert.equal(t.rounds, leg, 'una ronda por emparejamiento');
    assert.throws(() => act(t, null, true, { type: 'presencial-result', game: t.games.find(g => !g.bye).id, result: '1-0' }, NOW), /válido/);
    while (t.status !== 'finished') {
      for (const g of t.games.filter(g => !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-1' }, NOW);
      if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW);
    }
    const games = t.games.filter(g => !g.bye);
    assert.equal(games.length, count * (count - 1) / 2, 'cada pareja se enfrenta una vez (dos partidas)');
    for (const p of t.players) {
      assert.equal(standings(t).find(x => x.id === p.id).points, count - 1); // 1-1 en cada mini-match
      assert.equal(t.games.filter(g => g.bye && g.white === p.id).length, count % 2 ? 1 : 0);
    }
  }
});

test('marcadores de doble vuelta e incomparecencias: puntos, victorias y desempates', () => {
  const t = tournament(4, { format: 'double-closed' });
  act(t, null, true, { type: 'start' }, NOW);
  const [g1, g2] = t.games.filter(g => g.round === 1 && !g.bye);
  act(t, null, true, { type: 'presencial-result', game: g1.id, result: '1.5-0.5' }, NOW);
  act(t, null, true, { type: 'presencial-result', game: g2.id, result: '-+' }, NOW);
  const rows = standings(t), row = id => rows.find(r => r.id === id);
  assert.equal(row(g1.white).points, 1.5); assert.equal(row(g1.black).points, .5);
  assert.equal(row(g2.white).points, 0); assert.equal(row(g2.black).points, 2);
  assert.equal(row(g1.white).wins, 1); assert.equal(row(g2.black).wins, 1);
  assert.equal(row(g2.black).sheet[0].forfeit, true); assert.equal(row(g1.white).sheet[0].n, 2);
  // Partida normal: +- y -+ valen un punto; los marcadores de doble vuelta no se aceptan.
  const s = tournament(4);
  act(s, null, true, { type: 'start' }, NOW);
  const [h1, h2] = s.games.filter(g => !g.bye);
  act(s, null, true, { type: 'presencial-result', game: h1.id, result: '+-' }, NOW);
  assert.throws(() => act(s, null, true, { type: 'presencial-result', game: h2.id, result: '2-0' }, NOW), /válido/);
  act(s, null, true, { type: 'presencial-result', game: h2.id, result: '1/2-1/2' }, NOW);
  assert.equal(standings(s).find(r => r.id === h1.white).points, 1);
  act(s, null, true, { type: 'presencial-next' }, NOW); // el suizo FIDE acepta la incomparecencia en el TRF
  assert.equal(s.round, 2);
});

test('inscripción rápida: listas FIDE/FADA, lista pegada, edición y solicitudes por QR', async () => {
  const { requestPresencial } = await import('../src/core.js');
  const t = tournament(0, { capacity: 6 });
  act(t, null, true, { type: 'presencial-player', name: 'García Moreno, Antonio Jesús de la Torre', rating: 1984, source: 'FIDE', fideId: '2201234' }, NOW);
  assert.equal(t.players[0].name, 'García Moreno, Antonio Jesús de la Torre');
  assert.equal(t.players[0].source, 'FIDE'); assert.equal(t.players[0].fideId, '2201234');
  assert.equal(snapshot(t).standings[0].fideId, '2201234');
  // Lista pegada: todo o nada.
  assert.throws(() => act(t, null, true, { type: 'presencial-players', players: [{ name: 'Ana' }, { name: 'ana' }] }, NOW), /repetido/);
  assert.throws(() => act(t, null, true, { type: 'presencial-players', players: Array.from({ length: 6 }, (_, i) => ({ name: 'J' + i })) }, NOW), /plazas/);
  assert.equal(t.players.length, 1);
  act(t, null, true, { type: 'presencial-players', players: [{ name: 'Ana', rating: 1500, source: 'FADA' }, { name: 'Bea', rating: '' }] }, NOW);
  assert.equal(t.players.length, 3);
  // Editar
  const ana = t.players.find(p => p.name === 'Ana');
  act(t, null, true, { type: 'presencial-edit', playerId: ana.id, name: 'Ana Ruiz', rating: 1550 }, NOW);
  assert.equal(ana.name, 'Ana Ruiz'); assert.equal(ana.rating, 1550); assert.equal(ana.source, undefined);
  assert.throws(() => act(t, null, true, { type: 'presencial-edit', playerId: ana.id, name: 'bea' }, NOW), /Ya hay/);
  assert.throws(() => act(t, null, false, { type: 'presencial-edit', playerId: ana.id, name: 'X Y' }, NOW), /organizador/);
  // Solicitudes
  requestPresencial(t, { name: 'Carlos', rating: 1700, source: 'FADA' }, 'hash-c', NOW);
  requestPresencial(t, { name: 'Carlos Pérez', rating: 1700 }, 'hash-c', NOW); // la misma persona corrige su solicitud
  requestPresencial(t, { name: 'Dani' }, 'hash-d', NOW);
  assert.equal(t.requests.length, 2);
  assert.throws(() => requestPresencial(t, { name: 'ana ruiz' }, 'hash-e', NOW), /inscrito/);
  const hostView = snapshot(t, null, true), guest = snapshot(t, null, false, null, NOW, 'hash-c');
  assert.equal(hostView.requests.length, 2); assert.ok(!JSON.stringify(hostView.requests).includes('hash-'));
  assert.equal(guest.myRequest.name, 'Carlos Pérez'); assert.equal(guest.requests, undefined);
  const carlos = t.requests.find(r => r.name === 'Carlos Pérez');
  act(t, null, true, { type: 'presencial-approve', requestId: carlos.id }, NOW);
  act(t, null, true, { type: 'presencial-reject', requestId: t.requests[0].id }, NOW);
  assert.equal(t.requests.length, 0);
  const p = t.players.find(p => p.name === 'Carlos Pérez');
  assert.equal(p.hash, 'hash-c'); assert.equal(p.rating, 1700);
  assert.equal(requestPresencial(t, { name: 'Otro' }, 'hash-c', NOW).player, p);
  requestPresencial(t, { name: 'Tarde' }, 'hash-t', NOW);
  act(t, null, true, { type: 'start' }, NOW);
  assert.equal(t.requests, undefined);
  assert.throws(() => requestPresencial(t, { name: 'Más tarde' }, 'hash-x', NOW), /cerradas/);
});

test('torneo en marcha: corregir, retirar y volver a incluir; en el suizo, inscripción tardía', () => {
  const t = tournament(4);
  act(t, null, true, { type: 'start' }, NOW);
  const [a, b] = t.players;
  act(t, null, true, { type: 'presencial-edit', playerId: a.id, name: 'Jugador cero corregido', rating: 2250 }, NOW);
  assert.equal(a.name, 'Jugador cero corregido');
  act(t, null, true, { type: 'presencial-player', name: 'Llega tarde', rating: 1500 }, NOW);
  assert.equal(t.players.length, 5);
  act(t, null, true, { type: 'presencial-active', playerId: b.id, active: false }, NOW);
  assert.equal(b.active, false);
  for (const g of t.games.filter(g => !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW);
  act(t, null, true, { type: 'presencial-next' }, NOW);
  const r2 = t.games.filter(g => g.round === 2);
  assert.ok(!r2.some(g => g.white === b.id || g.black === b.id), 'el retirado no se empareja');
  assert.ok(r2.some(g => g.white === t.players[4].id || g.black === t.players[4].id), 'el que llegó tarde juega la ronda 2');
  act(t, null, true, { type: 'presencial-active', playerId: b.id, active: true }, NOW);
  assert.equal(b.active, true);
  assert.throws(() => act(t, null, false, { type: 'presencial-active', playerId: b.id, active: false }, NOW), /organizador/);
  // Round-Robin: el calendario queda fijado al empezar, no hay inscripción tardía.
  const rr = tournament(4, { format: 'closed' });
  act(rr, null, true, { type: 'start' }, NOW);
  assert.throws(() => act(rr, null, true, { type: 'presencial-player', name: 'Tarde' }, NOW), /cerradas/);
});

test('Round-Robin: el calendario de las rondas que faltan coincide con lo que se empareja después', async () => {
  const { closedSchedule } = await import('../src/core.js');
  for (const format of ['closed', 'double-closed']) {
    const t = tournament(5, { format });
    act(t, null, true, { type: 'start' }, NOW);
    const plan = closedSchedule(t);
    assert.equal(plan.length, t.rounds - 1);
    assert.equal(snapshot(t).schedule.length, t.rounds - 1);
    for (const { round, pairs } of plan) {
      while (t.round < round) { for (const g of t.games.filter(g => !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: format === 'closed' ? '1-0' : '2-0' }, NOW); act(t, null, true, { type: 'presencial-next' }, NOW); }
      const real = t.games.filter(g => g.round === round).map(g => [g.white, g.black].join('|')).sort();
      assert.deepEqual(pairs.map(([w, b]) => (w === null ? [b, null] : b === null ? [w, null] : [w, b]).join('|')).sort(), real, 'ronda ' + round);
    }
    assert.equal(closedSchedule(tournament(5)).length, 0, 'el suizo no tiene calendario fijo');
  }
});

test('Round-Robin: se corrige el resultado de cualquier ronda jugada, también con el torneo terminado; el suizo no', () => {
  const t = tournament(4, { format: 'closed' });
  act(t, null, true, { type: 'start' }, NOW);
  while (t.status !== 'finished') { for (const g of t.games.filter(g => !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW); if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW); }
  const first = t.games.find(g => g.round === 1 && !g.bye), before = standings(t).find(r => r.id === first.black).points;
  act(t, null, true, { type: 'presencial-result', game: first.id, result: '0-1' }, NOW);
  assert.equal(t.status, 'finished'); assert.equal(first.result, '0-1');
  assert.equal(standings(t).find(r => r.id === first.black).points, before + 1);
  assert.throws(() => act(t, null, true, { type: 'presencial-result', game: first.id, result: null }, NOW), /no se puede dejar/);
  const s = tournament(4);
  act(s, null, true, { type: 'start' }, NOW);
  for (const g of s.games.filter(g => !g.bye)) act(s, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW);
  act(s, null, true, { type: 'presencial-next' }, NOW);
  assert.throws(() => act(s, null, true, { type: 'presencial-result', game: s.games.find(g => g.round === 1 && !g.bye).id, result: '0-1' }, NOW), /ronda actual/);
});
