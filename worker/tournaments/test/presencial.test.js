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

test('sin resultados se puede cambiar la lista presencial y se regeneran las rondas, incluso con descansos', () => {
  for (const format of ['swiss', 'closed', 'double-closed']) {
    let t = tournament(5, { format });
    act(t, null, true, { type: 'start' }, NOW);
    t = JSON.parse(JSON.stringify(t)); // al volver a entrar en un torneo ya emparejado
    assert.ok(t.games.some(g => g.bye && g.result));
    const oldGames = t.games.map(g => g.id), oldPlayers = t.players.map(p => p.id);
    const before = JSON.stringify(t);
    assert.throws(() => act(t, null, false, { type: 'presencial-player', name: 'Intruso' }, NOW), /organizador/);
    assert.throws(() => act(t, null, true, { type: 'presencial-player', name: t.players[0].name }, NOW), /ese nombre/);
    assert.equal(JSON.stringify(t), before, 'Un intento inválido no cambia el sorteo');
    act(t, null, true, { type: 'presencial-player', name: 'Olvidado', rating: 1800 }, NOW);
    assert.equal(t.players.length, 6); assert.equal(t.round, 1); assert.equal(t.status, 'playing');
    assert.ok(oldPlayers.every(id => t.players.some(p => p.id === id)));
    assert.ok(t.games.every(g => !oldGames.includes(g.id) && !g.result));
    assert.equal(t.games.length, 3);
    const added = t.players.at(-1).id;
    assert.ok(t.games.some(g => g.white === added || g.black === added));
    assert.throws(() => act(t, null, false, { type: 'remove', playerId: added }, NOW), /quitar inscritos/);
    act(t, null, true, { type: 'remove', playerId: added }, NOW);
    assert.equal(t.players.length, 5); assert.ok(!t.games.some(g => g.white === added || g.black === added));
    act(t, null, true, { type: 'presencial-players', players: [{ name: 'Nuevo uno' }, { name: 'Nuevo dos' }] }, NOW);
    assert.equal(t.players.length, 7); assert.equal(t.round, 1);
    assert.equal(t.rounds, format === 'swiss' ? 5 : 7);
    const played = t.games.find(g => !g.bye);
    act(t, null, true, { type: 'presencial-result', game: played.id, result: format === 'double-closed' ? '1-1' : '1/2-1/2' }, NOW);
    const withResults = JSON.stringify(t);
    assert.throws(() => act(t, null, true, { type: 'remove', playerId: t.players[0].id }, NOW), /antes de anotar resultados/);
    if (format !== 'swiss') assert.throws(() => act(t, null, true, { type: 'presencial-player', name: 'Demasiado tarde' }, NOW), /cerradas/);
    assert.equal(JSON.stringify(t), withResults, 'No borra resultados al cambiar inscritos fuera de plazo');
  }
  const small = tournament(2, { format: 'double-closed' });
  act(small, null, true, { type: 'start' }, NOW);
  act(small, null, true, { type: 'remove', playerId: small.players[0].id }, NOW);
  assert.equal(small.status, 'waiting'); assert.equal(small.games.length, 0); assert.equal(small.players.length, 1);
});

test('Round-Robin presencial avanza solo al completar cada ronda, sin botón ni pausa, y termina al completar la última', () => {
  for (const format of ['closed', 'double-closed']) for (const count of [4, 5]) {
    const t = tournament(count, { format });
    act(t, null, true, { type: 'start' }, NOW);
    const result = format === 'closed' ? '1/2-1/2' : '1-1';
    assert.throws(() => act(t, null, true, { type: 'presencial-next' }, NOW), /automáticamente/);
    while (t.status !== 'finished') {
      const round = t.round, pending = t.games.filter(g => g.round === round && !g.result);
      assert.ok(pending.length > 0);
      for (const [i, g] of pending.entries()) {
        act(t, null, true, { type: 'presencial-result', game: g.id, result }, NOW);
        if (i < pending.length - 1) assert.equal(t.round, round, 'Espera a todos los resultados de la ronda');
      }
      assert.equal(t.nextRoundAt, null);
      if (round < t.rounds) { assert.equal(t.round, round + 1); assert.equal(t.status, 'playing'); }
      else assert.equal(t.status, 'finished');
      assert.equal(advance(t, NOW + 60000), false, 'No duplica rondas al actualizar la sala');
    }
    assert.equal(t.round, t.rounds);
    assert.equal(t.games.filter(g => !g.bye).length, count * (count - 1) / 2);
    assert.ok(standings(t).every(p => p.points === (count - 1) * (format === 'closed' ? .5 : 1)));
  }
});

test('Round-Robin recupera una pausa guardada por la versión anterior y salta rondas de retirados sin bloquearse', () => {
  let t = tournament(4, { format: 'closed' });
  act(t, null, true, { type: 'start' }, NOW);
  for (const g of t.games) { g.result = '1/2-1/2'; g.finishedAt = NOW; }
  t.status = 'between'; t.nextRoundAt = null;
  t = JSON.parse(JSON.stringify(t));
  assert.equal(advance(t, NOW + 1000), true);
  assert.equal(t.round, 2); assert.equal(t.status, 'playing');
  assert.equal(advance(t, NOW + 2000), false);
  for (const p of t.players.slice(2)) act(t, null, true, { type: 'presencial-active', playerId: p.id, active: false }, NOW);
  while (t.status !== 'finished') {
    const pending = t.games.filter(g => !g.result);
    assert.ok(pending.length > 0, 'No queda esperando una ronda de resultados automáticos');
    for (const g of pending) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1/2-1/2' }, NOW);
  }
  assert.equal(t.round, t.rounds);
  // El cambio afecta solo al presencial: en el Round-Robin online se conserva la pausa entre rondas.
  const online = createTournament({ ...input, mode: 'online', format: 'closed' }, 'b'.repeat(24), 'host', NOW);
  for (let i = 0; i < 4; i++) joinTournament(online, 'Online ' + i, 'hash-' + i, NOW);
  act(online, null, true, { type: 'start' }, NOW);
  for (const g of online.games) act(online, g.white, false, { type: 'resign', game: g.id }, NOW);
  assert.equal(online.status, 'between'); assert.equal(online.round, 1); assert.ok(online.nextRoundAt > NOW);
});

test('borrar rondas reabre la inscripción, conserva jugadores y configuración y permite volver a emparejar', () => {
  for (const format of ['swiss', 'closed', 'double-closed']) for (const phase of (format === 'swiss' ? ['playing', 'between', 'finished'] : ['playing', 'finished'])) {
    let t = tournament(4, { format, joinKey: 'clave-club' });
    Object.assign(t.players[0], { source: 'FIDE', fideId: '123456', fed: 'ESP', title: 'IM', accountId: 'cuenta-1' });
    const roster = t.players.map(({ active, seed, ...p }) => p), settings = { title: t.title, minutes: t.minutes, increment: t.increment, joinKey: t.joinKey, tiebreaks: t.tiebreaks };
    act(t, null, true, { type: 'start' }, NOW);
    act(t, null, true, { type: 'presencial-active', playerId: t.players[3].id, active: false }, NOW);
    const result = format === 'double-closed' ? '1-1' : '1/2-1/2';
    if (phase !== 'playing') {
      do {
        for (const g of t.games.filter(g => !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result }, NOW);
        if (phase === 'finished' && t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW);
      } while (phase === 'finished' && t.status !== 'finished');
      // El suizo empareja solo la ronda siguiente: para quedar «entre rondas» se borra la nueva.
      if (phase === 'between') act(t, null, true, { type: 'presencial-drop-round', round: t.round }, NOW);
    }
    assert.equal(t.status, phase);
    const oldGame = t.games[0].id;
    t = JSON.parse(JSON.stringify(t)); // también funciona con el torneo recuperado del almacenamiento
    act(t, null, true, { type: 'presencial-reset' }, NOW + 10000);
    assert.equal(t.status, 'waiting'); assert.equal(t.round, 0); assert.equal(t.games.length, 0);
    assert.equal(t.finishedAt, null); assert.equal(t.nextRoundAt, null); assert.equal(t.pairing, null);
    assert.equal(t.rounds, format === 'swiss' ? 5 : 0);
    assert.deepEqual(t.players.map(({ active, seed, ...p }) => p), roster);
    assert.ok(t.players.every(p => p.active));
    assert.deepEqual({ title: t.title, minutes: t.minutes, increment: t.increment, joinKey: t.joinKey, tiebreaks: t.tiebreaks }, settings);
    assert.ok(standings(t).every(p => p.points === 0 && p.played === 0 && p.sheet.length === 0));
    assert.deepEqual(snapshot(t).schedule, []);
    assert.equal(advance(t, NOW + 20000), false);
    assert.throws(() => act(t, null, true, { type: 'presencial-result', game: oldGame, result }, NOW), /ronda actual/);
    act(t, null, true, { type: 'remove', playerId: t.players[3].id }, NOW);
    act(t, null, true, { type: 'presencial-player', name: 'Jugador olvidado', rating: 1700 }, NOW);
    act(t, null, true, { type: 'presencial-player', name: 'Otro jugador', rating: 1600 }, NOW);
    act(t, null, true, { type: 'start' }, NOW + 30000);
    assert.equal(t.players.length, 5); assert.equal(t.rounds, 5); assert.equal(t.round, 1);
    assert.ok(t.games.every(g => g.id !== oldGame));
  }
});

test('borrar rondas: solo el organizador de un presencial con rondas generadas y sin reinicios repetidos', () => {
  const t = tournament();
  assert.throws(() => act(t, null, true, { type: 'presencial-reset' }, NOW), /No hay rondas/);
  act(t, null, true, { type: 'start' }, NOW);
  const before = JSON.stringify(t);
  assert.throws(() => act(t, t.players[0].id, false, { type: 'presencial-reset' }, NOW), /organizador/);
  assert.equal(JSON.stringify(t), before);
  const online = createTournament({ ...input, mode: 'online' }, 'b'.repeat(24), 'host', NOW);
  assert.throws(() => act(online, null, true, { type: 'presencial-reset' }, NOW), /organizador/);
  const cancelled = JSON.parse(before); act(cancelled, null, true, { type: 'cancel' }, NOW);
  assert.throws(() => act(cancelled, null, true, { type: 'presencial-reset' }, NOW), /No hay rondas/);
  act(t, null, true, { type: 'presencial-reset' }, NOW);
  assert.throws(() => act(t, null, true, { type: 'presencial-reset' }, NOW), /No hay rondas/);
  editTournament(t, { ...input, rounds: 2 }, NOW);
  act(t, null, true, { type: 'start' }, NOW);
  act(t, null, true, { type: 'presencial-reset' }, NOW);
  assert.equal(t.rounds, 2, 'Se usa la configuración editada al reabrir');
  act(t, null, true, { type: 'start' }, NOW);
  delete t.plannedRounds; // compatibilidad con los torneos existentes antes de esta función
  act(t, null, true, { type: 'presencial-reset' }, NOW);
  assert.equal(t.rounds, 2);
});

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
  const [g1, g2] = t.games;
  act(t, null, true, { type: 'presencial-result', game: g1.id, result: '1-0' }, NOW + 240000);
  assert.equal(t.status, 'playing'); assert.equal(t.round, 1);
  // Al anotar el último resultado de la ronda, la siguiente se empareja sola.
  act(t, null, true, { type: 'presencial-result', game: g2.id, result: '1-0' }, NOW + 240000);
  assert.equal(t.status, 'playing'); assert.equal(t.nextRoundAt, null);
  t = JSON.parse(JSON.stringify(t));
  assert.equal(advance(t, NOW + 86400000), false);
  assert.equal(nextAlarm(t), t.expiresAt);
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
  if (s.status === 'between') act(s, null, true, { type: 'presencial-next' }, NOW); // el suizo FIDE acepta la incomparecencia en el TRF
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
  if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW);
  const r2 = t.games.filter(g => g.round === 2);
  assert.ok(!r2.some(g => g.white === b.id || g.black === b.id), 'el retirado no se empareja');
  assert.ok(r2.some(g => g.white === t.players[4].id || g.black === t.players[4].id), 'el que llegó tarde juega la ronda 2');
  act(t, null, true, { type: 'presencial-active', playerId: b.id, active: true }, NOW);
  assert.equal(b.active, true);
  assert.throws(() => act(t, null, false, { type: 'presencial-active', playerId: b.id, active: false }, NOW), /organizador/);
  // Round-Robin: tras anotar un resultado, no hay inscripción tardía.
  const rr = tournament(4, { format: 'closed' });
  act(rr, null, true, { type: 'start' }, NOW);
  act(rr, null, true, { type: 'presencial-result', game: rr.games[0].id, result: '1-0' }, NOW);
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
      while (t.round < round) { for (const g of t.games.filter(g => !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: format === 'closed' ? '1-0' : '2-0' }, NOW); }
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
  if (s.status === 'between') act(s, null, true, { type: 'presencial-next' }, NOW);
  assert.throws(() => act(s, null, true, { type: 'presencial-result', game: s.games.find(g => g.round === 1 && !g.bye).id, result: '0-1' }, NOW), /ronda actual/);
});

test('presencial emparejado sin resultados: se edita nombre y ritmo; con resultados, ya no', () => {
  const t = tournament(4);
  act(t, null, true, { type: 'start' }, NOW);
  assert.equal(snapshot(t, null, true).editable, true);
  const games = t.games.map(g => g.id).join();
  editTournament(t, { ...input, title: 'Abierto renombrado' }, NOW);
  assert.equal(t.title, 'Abierto renombrado'); assert.equal(t.games.map(g => g.id).join(), games, 'Solo el nombre: mismo sorteo');
  editTournament(t, { ...input, title: 'Abierto renombrado', format: 'closed' }, NOW);
  assert.equal(t.format, 'closed'); assert.equal(t.status, 'playing'); assert.equal(t.round, 1);
  assert.ok(t.games.every(g => !games.split(',').includes(g.id)), 'Cambiar el sistema rehace el sorteo');
  assert.throws(() => editTournament(t, { ...input, mode: 'online' }, NOW), /online/);
  act(t, null, true, { type: 'presencial-result', game: t.games.find(g => !g.bye).id, result: '1-0' }, NOW);
  assert.equal(snapshot(t, null, true).editable, false);
  assert.throws(() => editTournament(t, { ...input, title: 'Otro' }, NOW), /ya ha empezado/);
});

test('suizo presencial: borrar la última ronda permite corregir la anterior y volver a emparejar', () => {
  const t = tournament(5);
  act(t, null, true, { type: 'start' }, NOW);
  for (const g of t.games.filter(g => !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1-0' }, NOW);
  if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW);
  assert.equal(t.round, 2);
  const first = t.games.find(g => g.round === 1 && !g.bye);
  assert.throws(() => act(t, null, true, { type: 'presencial-result', game: first.id, result: '0-1' }, NOW));
  assert.throws(() => act(t, t.players[0].id, false, { type: 'presencial-drop-round', round: 2 }, NOW), /organizador/);
  assert.throws(() => act(t, null, true, { type: 'presencial-drop-round', round: 1 }, NOW), /última ronda/);
  act(t, null, true, { type: 'presencial-drop-round', round: 2 }, NOW);
  assert.equal(t.round, 1); assert.equal(t.status, 'between'); assert.ok(t.games.every(g => g.round === 1));
  act(t, null, true, { type: 'presencial-result', game: first.id, result: '0-1' }, NOW);
  assert.equal(first.result, '0-1');
  assert.equal(t.status, 'between', 'Corregir una ronda ya completa no empareja sola la siguiente');
  act(t, null, true, { type: 'presencial-next' }, NOW);
  assert.equal(t.round, 2); assert.equal(t.status, 'playing');
  // Borrar la ronda 1 vuelve a abrir la inscripción con los mismos jugadores.
  act(t, null, true, { type: 'presencial-drop-round', round: 2 }, NOW);
  act(t, null, true, { type: 'presencial-drop-round', round: 1 }, NOW);
  assert.equal(t.status, 'waiting'); assert.equal(t.games.length, 0); assert.equal(t.players.length, 5);
  const rr = tournament(4, { format: 'closed' });
  act(rr, null, true, { type: 'start' }, NOW);
  assert.throws(() => act(rr, null, true, { type: 'presencial-drop-round', round: 1 }, NOW), /Round-Robin/);
});

test('presencial: año de nacimiento de las listas, guardado, editable y en la clasificación', () => {
  const t = createTournament({ ...input }, 'c'.repeat(24), 'host', NOW);
  act(t, null, true, { type: 'presencial-player', name: 'Joven, Pablo', rating: 1500, birth: 2014 }, NOW);
  act(t, null, true, { type: 'presencial-player', name: 'Sin Año, Ana', rating: 1400, birth: 'abc' }, NOW);
  act(t, null, true, { type: 'presencial-player', name: 'Futuro, Leo', birth: 3000 }, NOW);
  assert.equal(t.players[0].birth, 2014);
  assert.equal(t.players[1].birth, undefined, 'Un año no válido no se guarda');
  assert.equal(t.players[2].birth, undefined, 'Tampoco uno en el futuro');
  assert.equal(snapshot(t, null, true).standings.find(p => p.name === 'Joven, Pablo').birth, 2014);
  act(t, null, true, { type: 'presencial-edit', playerId: t.players[1].id, name: 'Sin Año, Ana', rating: 1400, birth: 1958 }, NOW);
  assert.equal(t.players[1].birth, 1958);
  act(t, null, true, { type: 'presencial-edit', playerId: t.players[1].id, name: 'Sin Año, Ana', rating: 1400 }, NOW);
  assert.equal(t.players[1].birth, undefined, 'Al editar sin año, se quita');
  act(t, null, true, { type: 'presencial-players', players: [{ name: 'Lista, Eva', birth: 1990 }] }, NOW);
  assert.equal(t.players.at(-1).birth, 1990);
  // Relleno de los inscritos antes de tener el año: solo a quien no lo tiene y con años válidos.
  act(t, null, true, { type: 'presencial-births', years: { [t.players[0].id]: 1999, [t.players[1].id]: 1960, [t.players[2].id]: 3000 } }, NOW);
  assert.equal(t.players[0].birth, 2014, 'No pisa un año ya guardado');
  assert.equal(t.players[1].birth, 1960);
  assert.equal(t.players[2].birth, undefined);
});
