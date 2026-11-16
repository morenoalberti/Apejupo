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

test('Round-Robin doble vuelta: cada rival dos veces con colores opuestos y dos descansos si son impares', () => {
  for (const count of [2, 3, 4, 5, 8]) {
    const t = tournament(count, { format: 'double-closed' });
    act(t, null, true, { type: 'start' }, NOW);
    const leg = count % 2 ? count : count - 1;
    assert.equal(t.rounds, leg * 2);
    while (t.status !== 'finished') {
      for (const g of t.games.filter(g => !g.bye && !g.result)) act(t, null, true, { type: 'presencial-result', game: g.id, result: '1/2-1/2' }, NOW);
      if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW);
    }
    const games = t.games.filter(g => !g.bye);
    assert.equal(games.length, count * (count - 1));
    for (const g of games.filter(g => g.round <= leg)) {
      const back = games.find(b => b.round === g.round + leg && b.white === g.black && b.black === g.white);
      assert.ok(back, 'La vuelta invierte ambos colores');
    }
    for (const p of t.players) {
      assert.equal(standings(t).find(x => x.id === p.id).points, count - 1);
      assert.equal(t.games.filter(g => g.bye && g.white === p.id).length, count % 2 ? 2 : 0);
    }
  }
});
