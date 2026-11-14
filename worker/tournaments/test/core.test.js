import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { createTournament, editTournament, pairArena, selectedGame, joinTournament, startTournament, act, advance, standings, snapshot, sharedSnapshot, personalPart, moveMessage, canPossiblyMate, nextAlarm, exportPgn, BREAK_MS } from '../src/core.js';

const NOW = 1800000000000;
function tournament(count = 2, options = {}) {
  const t = createTournament({ title: 'Abierto de prueba', minutes: 5, increment: 3, rounds: 5, capacity: 32, ...options }, 'a'.repeat(24), 'host-secret', NOW);
  for (let i = 0; i < count; i++) joinTournament(t, 'Jugador ' + (i + 1), 'secret-' + i, NOW);
  return t;
}
function play(t, san, now) {
  const g = t.games.find(g => !g.result), c = new Chess();
  for (const move of g.moves) c.move(move);
  const move = c.move(san);
  act(t, g.turn === 'w' ? g.white : g.black, false, { type: 'move', game: g.id, from: move.from, to: move.to, promotion: move.promotion, ply: g.moves.length }, now);
  return g;
}

test('validación de torneos, inscripción, capacidad, duplicados e identidad', () => {
  assert.throws(() => tournament(0, { capacity: 129 }), /128/);
  assert.equal(tournament(0, { capacity: 128 }).capacity, 128);
  assert.throws(() => tournament(0, { minutes: 4 }), /ritmo/);
  assert.throws(() => tournament(0, { startsAt: NOW - 1 }), /fecha/);
  const t = tournament(1, { capacity: 2 });
  assert.equal(joinTournament(t, 'Otro nombre', 'secret-0').id, t.players[0].id);
  assert.throws(() => joinTournament(t, 'JUGADOR 1', 'other'), /ese nombre/);
  joinTournament(t, '<Jugador> 2\u202e', 'secret-2');
  assert.equal(t.players[1].name, 'Jugador 2');
  assert.throws(() => joinTournament(t, 'Tercero', 'secret-3'), /completo/);
});

test('solo el organizador inicia, el sorteo no cambia plazas y se ajustan rondas', () => {
  const t = tournament();
  assert.throws(() => act(t, t.players[0].id, false, { type: 'start' }, NOW), /organizador/);
  startTournament(t, NOW);
  assert.equal(t.status, 'playing'); assert.equal(t.rounds, 1); assert.equal(t.games.length, 1);
  assert.equal(new Set(t.players.map(p => p.seed)).size, 2);
  assert.throws(() => joinTournament(t, 'Tercero', 'secret-3'), /cerradas/);
});

test('validación en servidor: turnos, movimiento ilegal, espectador y repetición de un mensaje', () => {
  const t = tournament(); startTournament(t, NOW); const g = t.games[0];
  const action = { type: 'move', game: g.id, from: 'e2', to: 'e4', ply: 0 };
  assert.throws(() => act(t, null, false, action, NOW + 10), /inscribirte/);
  assert.throws(() => act(t, g.black, false, action, NOW + 10), /rival/);
  assert.throws(() => act(t, g.white, false, { ...action, to: 'e5' }, NOW + 10), /legal/);
  act(t, g.white, false, action, NOW + 2000);
  assert.equal(g.whiteMs, 301000); assert.equal(g.blackMs, 300000);
  assert.equal(g.moves[0], 'e4'); assert.equal(g.turn, 'b');
  assert.throws(() => act(t, g.black, false, { ...action, from: 'e7', to: 'e5' }, NOW + 3000), /posición/);
  act(t, g.black, false, { ...action, from: 'e7', to: 'e5', ply: 1 }, NOW + 4000);
  assert.equal(g.blackMs, 301000);
});

test('jaque mate, clasificación, PGN y secretos excluidos de la vista pública', () => {
  const t = tournament(); startTournament(t, NOW);
  for (const [i, san] of ['f3', 'e5', 'g4', 'Qh4#'].entries()) play(t, san, NOW + (i + 1) * 1000);
  const g = t.games[0]; assert.equal(g.result, '0-1'); assert.equal(g.reason, 'Jaque mate');
  assert.equal(t.status, 'finished'); assert.equal(standings(t)[0].id, g.black);
  const view = snapshot(t, null, false, g.id, NOW + 5000);
  assert.deepEqual(view.game.legal, []);
  assert.ok(!JSON.stringify(view).includes('secret'));
  const pgn = exportPgn(t, g.id), chess = new Chess(); chess.loadPgn(pgn);
  assert.equal(chess.isCheckmate(), true); assert.match(pgn, /\[Result "0-1"\]/);
});

test('no se exporta una partida en juego', () => {
  const t = tournament(); startTournament(t, NOW);
  assert.throws(() => exportPgn(t), /terminado/);
});

test('el reloj vence sin navegador conectado y no se aplica dos veces', () => {
  const t = tournament(); startTournament(t, NOW); const g = t.games[0];
  assert.equal(nextAlarm(t), NOW + 300000);
  assert.equal(advance(t, NOW + 300000), true); assert.equal(g.result, '0-1');
  assert.equal(g.whiteMs, 0); assert.equal(t.status, 'finished');
  const before = JSON.stringify(t); assert.equal(advance(t, NOW + 300001), false); assert.equal(JSON.stringify(t), before);
});

test('un intento de mover fuera de tiempo no modifica la posición ni la caché del motor', () => {
  const t = tournament(); startTournament(t, NOW); const g = t.games[0];
  const before = snapshot(t, g.white, false, g.id, NOW).game;
  assert.throws(() => act(t, g.white, false, { type: 'move', game: g.id, from: 'e2', to: 'e4', ply: 0 }, NOW + 300001), /tiempo/);
  const after = snapshot(t, g.white, false, g.id, NOW).game;
  assert.equal(after.fen, before.fen); assert.deepEqual(after.legal, before.legal); assert.deepEqual(after.moves, []);
});

test('material posible para ganar por tiempo: rey solo, pieza menor y alfiles del mismo color', () => {
  const queen = new Chess('7k/8/8/8/8/8/1Q6/K7 w - - 0 1');
  assert.equal(canPossiblyMate(queen, 'b'), false); assert.equal(canPossiblyMate(queen, 'w'), true);
  const knight = new Chess('7k/8/8/8/8/8/1N6/K7 w - - 0 1');
  assert.equal(canPossiblyMate(knight, 'w'), false);
  const bishops = new Chess('7k/8/8/8/8/4b3/1B6/K7 w - - 0 1');
  assert.equal(canPossiblyMate(bishops, 'w'), false); assert.equal(canPossiblyMate(bishops, 'b'), false);
  const pawn = new Chess('7k/6p1/8/8/8/8/1N6/K7 w - - 0 1');
  assert.equal(canPossiblyMate(pawn, 'w'), true);
});

test('promoción a caballo, enroque y captura al paso validados desde partidas reales', () => {
  const cases = [
    ['a4', 'h5', 'a5', 'h4', 'a6', 'h3', 'axb7', 'hxg2', 'bxa8=N'],
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O'],
    ['e4', 'a6', 'e5', 'd5', 'exd6'],
  ];
  for (const line of cases) {
    const t = tournament(); startTournament(t, NOW);
    for (const [i, san] of line.entries()) play(t, san, NOW + (i + 1) * 1000);
    const expected = new Chess(); for (const san of line) expected.move(san);
    assert.equal(t.games[0].fen, expected.fen());
    if (line[0] === 'a4') assert.equal(expected.get('a8').type, 'n');
  }
});

test('tablas ofrecidas solo aceptables por el rival y reloj sigue corriendo', () => {
  const t = tournament(); startTournament(t, NOW); const g = t.games[0];
  act(t, g.white, false, { type: 'offer-draw', game: g.id }, NOW + 1000);
  assert.throws(() => act(t, g.white, false, { type: 'accept-draw', game: g.id }, NOW + 2000), /rival/);
  act(t, g.black, false, { type: 'accept-draw', game: g.id }, NOW + 2500);
  assert.equal(g.result, '1/2-1/2'); assert.equal(g.whiteMs, 297500);
  assert.equal(standings(t)[0].points, .5);
});

test('triple repetición se conserva al reconstruir el estado persistido', () => {
  let t = tournament(); startTournament(t, NOW);
  for (const [i, san] of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'].entries()) {
    t = structuredClone(t); play(t, san, NOW + (i + 1) * 1000);
  }
  assert.equal(t.games[0].result, '1/2-1/2'); assert.match(t.games[0].reason, /repetición/);
});

test('suizo de 32 jugadores durante 5 rondas: 16 tableros y sin rivales repetidos', () => {
  const t = tournament(32); startTournament(t, NOW); let now = NOW;
  const opponents = new Set();
  for (let round = 1; round <= 5; round++) {
    const games = t.games.filter(g => g.round === round);
    assert.equal(games.length, 16);
    const participants = games.flatMap(g => [g.white, g.black]); assert.equal(new Set(participants).size, 32);
    for (const [i, g] of games.entries()) {
      const key = [g.white, g.black].sort().join(':'); assert.ok(!opponents.has(key)); opponents.add(key);
      if (i % 3 === 0) {
        act(t, g.white, false, { type: 'offer-draw', game: g.id }, ++now);
        act(t, g.black, false, { type: 'accept-draw', game: g.id }, ++now);
      } else act(t, i % 2 ? g.white : g.black, false, { type: 'resign', game: g.id }, ++now);
    }
    if (round < 5) { assert.equal(t.status, 'between'); now += BREAK_MS; advance(t, now); assert.equal(t.round, round + 1); }
  }
  assert.equal(t.status, 'finished'); assert.equal(t.games.length, 80);
  assert.equal(standings(t).reduce((n, p) => n + p.points, 0), 80);
});

test('número impar: descansos repartidos y sin repetir rivales', () => {
  const t = tournament(5, { rounds: 5 }); startTournament(t, NOW); let now = NOW;
  const byes = new Set(), opponents = new Set();
  for (let round = 1; round <= 5; round++) {
    const games = t.games.filter(g => g.round === round), bye = games.find(g => g.bye);
    assert.ok(!byes.has(bye.white)); byes.add(bye.white);
    for (const g of games.filter(g => !g.bye)) {
      const key = [g.white, g.black].sort().join(':'); assert.ok(!opponents.has(key)); opponents.add(key);
      act(t, g.white, false, { type: 'resign', game: g.id }, ++now);
    }
    if (round < 5) { now += BREAK_MS; advance(t, now); }
  }
  assert.equal(t.status, 'finished'); assert.equal(byes.size, 5);
});

test('retirada pierde la partida actual y excluye de las siguientes rondas', () => {
  const t = tournament(4, { rounds: 3 }); startTournament(t, NOW); const id = t.games[0].white;
  act(t, id, false, { type: 'withdraw' }, NOW + 1000);
  for (const g of t.games.filter(g => !g.result)) act(t, g.white, false, { type: 'resign', game: g.id }, NOW + 2000);
  advance(t, NOW + 2000 + BREAK_MS);
  assert.ok(!t.games.filter(g => g.round === 2).some(g => g.white === id || g.black === id));
  assert.equal(t.players.find(p => p.id === id).active, false);
});

test('inicio programado y cancelación si no hay suficientes inscritos', () => {
  const t = tournament(2, { startsAt: NOW + 120000 });
  assert.equal(advance(t, NOW + 119999), false);
  advance(t, NOW + 120000); assert.equal(t.status, 'playing');
  const empty = tournament(1, { startsAt: NOW + 120000 }); advance(empty, NOW + 120000);
  assert.equal(empty.status, 'cancelled');
});

test('cancelación protege contra acciones posteriores', () => {
  const t = tournament(4); startTournament(t, NOW);
  assert.throws(() => act(t, t.players[0].id, false, { type: 'cancel' }, NOW + 1000), /organizador/);
  act(t, null, true, { type: 'cancel' }, NOW + 1000);
  assert.equal(t.status, 'cancelled'); assert.ok(t.games.every(g => g.result));
  assert.throws(() => act(t, t.games[0].white, false, { type: 'resign', game: t.games[0].id }, NOW + 1001), /terminado/);
});

test('arena: validación, emparejamiento continuo de libres y fin por tiempo', async () => {
  const { pairArena, ARENA_PAUSE_MS, arenaPairingsCloseAt } = await import('../src/core.js');
  assert.throws(() => tournament(0, { format: 'arena', duration: 7 }), /duración/);
  assert.throws(() => tournament(0, { format: 'arena', duration: 20, minutes: 10 }), /triple/);
  const t = tournament(5, { format: 'arena', duration: 60, rounds: undefined });
  assert.equal(t.rounds, 0);
  startTournament(t, NOW);
  assert.equal(t.status, 'playing'); assert.equal(t.endsAt, NOW + 3600000); assert.equal(t.games.length, 0);
  const ids = t.players.map(p => p.id);
  // Solo se empareja a los presentes: con uno conectado no hay partida.
  assert.equal(pairArena(t, NOW, new Set([ids[0]])), false);
  assert.equal(pairArena(t, NOW, new Set(ids)), true);
  assert.equal(t.games.length, 2);
  const waiting = ids.filter(id => !t.games.some(g => g.white === id || g.black === id));
  assert.equal(waiting.length, 1);
  // Quien termina descansa unos segundos y luego juega con el que esperaba, no con su último rival.
  const g = t.games[0];
  act(t, g.white, false, { type: 'resign', game: g.id }, NOW + 60000);
  assert.equal(pairArena(t, NOW + 60000, new Set(ids)), false);
  assert.equal(nextAlarm(t, NOW + 60000), NOW + 60000 + ARENA_PAUSE_MS);
  assert.equal(pairArena(t, NOW + 60000 + ARENA_PAUSE_MS, new Set(ids)), true);
  const second = t.games.slice(2);
  assert.equal(second.length, 1);
  assert.ok(second[0].white === waiting[0] || second[0].black === waiting[0]);
  // En pausa no se empareja.
  const loser = g.white, winner = g.black;
  const other = [second[0].white, second[0].black].find(id => id !== waiting[0]);
  const idle = [loser, winner].find(id => id !== other);
  act(t, idle, false, { type: 'pause' }, NOW + 70000);
  assert.equal(pairArena(t, NOW + 80000, new Set(ids)), false);
  act(t, idle, false, { type: 'resume' }, NOW + 80000);
  // Como en Lichess: con 10 minutos por jugador se deja de emparejar 2 minutos antes del final.
  const end = t.endsAt;
  assert.equal(arenaPairingsCloseAt(t), end - 120000);
  assert.equal(pairArena(t, end - 120000, new Set(ids)), false);
  // Al cumplirse el tiempo la clasificación se congela: lo que acaba después se juega, pero no cuenta.
  for (const x of t.games.filter(x => !x.result)) x.lastAt = end - 1000; // partida viva al acabar el tiempo
  const before = standings(t).map(p => [p.id, p.points, p.played]);
  advance(t, end);
  assert.equal(t.status, 'playing');
  for (const x of t.games.filter(x => !x.result)) act(t, x.black, false, { type: 'resign', game: x.id }, end + 1000);
  assert.equal(t.status, 'finished');
  assert.deepEqual(standings(t).map(p => [p.id, p.points, p.played]), before);
  assert.ok(snapshot(t, null, false, null, end + 2000).games.some(x => x.late));
  assert.ok(t.games.filter(x => !x.bye).every(x => x.result));
  assert.equal(snapshot(t, null, false, null, end + 2000).format, 'arena');
});

test('arena sin partidas en juego termina justo al cumplirse el tiempo', () => {
  const t = tournament(2, { format: 'arena', duration: 30 });
  startTournament(t, NOW);
  assert.equal(nextAlarm(t, NOW), t.endsAt);
  assert.equal(advance(t, t.endsAt), true);
  assert.equal(t.status, 'finished');
});

test('arena: berserk (mitad de tiempo, sin incremento, medio punto extra) y entrada tardía', async () => {
  const { pairArena, BERSERK_BONUS } = await import('../src/core.js');
  const t = tournament(2, { format: 'arena', duration: 30, minutes: 5, increment: 3 });
  startTournament(t, NOW);
  const ids = t.players.map(p => p.id);
  pairArena(t, NOW, new Set(ids));
  const g = t.games[0];
  // Solo en arena, una vez y antes de la primera jugada propia.
  act(t, g.white, false, { type: 'berserk', game: g.id }, NOW + 1000);
  assert.equal(g.whiteMs, 150000);
  assert.throws(() => act(t, g.white, false, { type: 'berserk', game: g.id }, NOW + 1500), /Ya has/);
  // Mate rápido del pastor (7 jugadas de blancas): sin incremento para quien hizo berserk.
  const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'a6', 'a3', 'a5', 'a4', 'b6', 'b3', 'Ra7', 'Qxf7#'];
  for (const [i, san] of sans.entries()) play(t, san, NOW + 2000 + i * 1000);
  assert.ok(g.whiteMs < 150000);
  assert.equal(g.result, '1-0');
  const rows = standings(t), w = rows.find(r => r.id === g.white);
  assert.equal(w.points, 1 + BERSERK_BONUS);
  assert.deepEqual(w.sheet[0], { s: 1, berserk: true, bonus: true });
  // Con el arena en marcha se puede entrar; en suizo, no.
  joinTournament(t, 'Tardío', 'secret-late', NOW + 60000);
  assert.equal(t.players.length, 3);
  assert.throws(() => joinTournament(t, 'Muy tarde', 'secret-x', t.endsAt), /cerradas/);
  const swiss = tournament(2); startTournament(swiss, NOW);
  assert.throws(() => act(swiss, swiss.games[0].white, false, { type: 'berserk', game: swiss.games[0].id }, NOW), /arena/);
  assert.throws(() => joinTournament(swiss, 'Tardío', 'secret-late', NOW), /cerradas/);
  const view = snapshot(t, null, false, null, NOW + 70000);
  assert.ok(view.standings[0].sheet);
});

test('arena 1+0: se deja de emparejar 30 s antes y la bandera caída a tiempo cuenta', async () => {
  const { pairArena, arenaPairingsCloseAt } = await import('../src/core.js');
  const t = tournament(2, { format: 'arena', duration: 3, minutes: 1, increment: 0 });
  startTournament(t, NOW);
  const ids = t.players.map(p => p.id);
  assert.equal(arenaPairingsCloseAt(t), t.endsAt - 30000);
  assert.equal(pairArena(t, t.endsAt - 31000, new Set(ids)), true);
  const g = t.games[0];
  // Las blancas no mueven: su bandera cae 1 s antes del final, aunque el servidor lo detecte después.
  g.lastAt = t.endsAt - 61000;
  advance(t, t.endsAt + 5000);
  assert.equal(g.result, '0-1');
  assert.equal(t.status, 'finished');
  assert.equal(standings(t).find(p => p.id === g.black).points, 1);
});

test('clave de inscripción: se pide al apuntarse, solo la ve el organizador y se puede cambiar', () => {
  assert.throws(() => tournament(0, { joinKey: 'abc' }), /entre 4 y 20/);
  const t = tournament(0, { joinKey: 'Apejupo26' });
  assert.throws(() => joinTournament(t, 'Ana', 'secret-a', NOW), /tiene clave/);
  assert.throws(() => joinTournament(t, 'Ana', 'secret-a', NOW, 'otra'), /no es correcta/);
  const ana = joinTournament(t, 'Ana', 'secret-a', NOW, ' apejupo26 ');
  // Quien ya está inscrito vuelve a entrar sin clave.
  assert.equal(joinTournament(t, 'Ana', 'secret-a', NOW), ana);
  assert.equal(snapshot(t, ana.id, false, null, NOW).joinKey, undefined);
  assert.equal(snapshot(t, ana.id, false, null, NOW).locked, true);
  assert.equal(snapshot(t, null, true, null, NOW).joinKey, 'Apejupo26');
  assert.throws(() => act(t, ana.id, false, { type: 'join-key', key: 'nueva' }, NOW), /organizador/);
  act(t, null, true, { type: 'join-key', key: '' }, NOW);
  assert.equal(snapshot(t, null, false, null, NOW).locked, false);
  joinTournament(t, 'Bea', 'secret-b', NOW);
  assert.equal(t.players.length, 2);
});

test('estado repartido: parte común + parte de cada uno, y jugadas como mensaje pequeño', () => {
  const t = tournament(8); startTournament(t, NOW);
  const g = play(t, 'e4', NOW + 1000);
  const me = g.black, joined = JSON.stringify(sharedSnapshot(t, NOW + 2000)).slice(0, -1) + ',' + JSON.stringify(personalPart(t, me, false, null)).slice(1);
  assert.deepEqual(JSON.parse(joined), snapshot(t, me, false, null, NOW + 2000));
  assert.equal(JSON.parse(joined).game.id, g.id);
  assert.equal(sharedSnapshot(t, NOW).games.find(x => x.id === g.id).ply, 1);
  const m = moveMessage(t, g, NOW + 2000);
  assert.equal(m.type, 'move'); assert.equal(m.game.ply, 1); assert.equal(m.game.san, 'e4'); assert.equal(m.game.turn, 'b');
  assert.ok(m.game.legal.some(x => x.from === 'e7' && x.to === 'e5'));
  assert.ok(JSON.stringify(m).length < JSON.stringify(snapshot(t, me, false, null)).length / 2);
  // El organizador recibe la clave; los demás, no.
  assert.ok('joinKey' in personalPart(t, null, true, null)); assert.ok(!('joinKey' in personalPart(t, me, false, null)));
});

test('suizo de 128 jugadores durante 7 rondas: 64 tableros y sin rivales repetidos', () => {
  const t = tournament(128, { capacity: 128, rounds: 7 }); startTournament(t, NOW); let now = NOW;
  const seen = new Set();
  for (let r = 1; r <= 7; r++) {
    const games = t.games.filter(g => g.round === r);
    assert.equal(games.length, 64);
    for (const g of games) {
      const pair = [g.white, g.black].sort().join('|'); assert.ok(!seen.has(pair), 'rival repetido'); seen.add(pair);
      act(t, g.white, false, { type: 'resign', game: g.id }, now += 10);
    }
    if (r < 7) { advance(t, now += BREAK_MS + 1); }
  }
  assert.equal(t.status, 'finished');
});

test('cerrado: todos contra todos una vez, descanso sin punto y colores equilibrados', () => {
  for (const n of [2, 5, 6, 9, 10]) {
    const t = tournament(n, { format: 'closed', capacity: 20 }); startTournament(t, NOW); let now = NOW;
    assert.equal(t.rounds, n % 2 ? n : n - 1);
    for (let round = 1; round <= t.rounds; round++) {
      const games = t.games.filter(g => g.round === round);
      assert.equal(games.filter(g => g.bye).length, n % 2);
      for (const g of games.filter(g => !g.bye)) act(t, g.white, false, { type: 'resign', game: g.id }, ++now);
      if (round < t.rounds) { now += BREAK_MS; advance(t, now); }
    }
    assert.equal(t.status, 'finished');
    const real = t.games.filter(g => !g.bye), keys = new Set(real.map(g => [g.white, g.black].sort().join(':')));
    assert.equal(real.length, n * (n - 1) / 2); assert.equal(keys.size, real.length);
    for (const p of t.players) {
      const whites = real.filter(g => g.white === p.id).length, blacks = real.filter(g => g.black === p.id).length;
      assert.ok(Math.abs(whites - blacks) <= 1, `colores de ${p.name}: ${whites}/${blacks}`);
    }
    // Todas las partidas las ganan las negras: el descanso no suma.
    for (const row of standings(t)) assert.equal(row.points, real.filter(g => g.black === row.id).length);
  }
});

test('editar antes de empezar: se valida como al crear y no después de empezar', () => {
  const t = tournament(3); t.joinKey = 'secreta';
  editTournament(t, { title: 'Abierto editado', format: 'closed', minutes: 3, increment: 2, capacity: 10, joinKey: '' }, NOW);
  assert.equal(t.title, 'Abierto editado'); assert.equal(t.format, 'closed'); assert.equal(t.minutes, 3); assert.equal(t.joinKey, '');
  assert.equal(t.players.length, 3);
  t.joinKey = 'otra';
  editTournament(t, { title: 'Abierto editado', format: 'closed', minutes: 3, increment: 2, capacity: 10 }, NOW);
  assert.equal(t.joinKey, 'otra');
  assert.throws(() => editTournament(t, { title: 'Abierto editado', format: 'swiss', rounds: 3, minutes: 3, increment: 2, capacity: 2 }, NOW), /3 jugadores/);
  assert.throws(() => editTournament(t, { title: 'x', format: 'swiss', rounds: 3, minutes: 3, increment: 2, capacity: 10 }, NOW), /nombre/);
  assert.equal(t.title, 'Abierto editado');
  startTournament(t, NOW);
  assert.throws(() => editTournament(t, { title: 'Otro nombre', format: 'swiss', rounds: 3, minutes: 3, increment: 2, capacity: 10 }, NOW), /empezado/);
});

test('arena con 3: quien espera rival no recibe la partida de otros; el espectador sí', () => {
  const t = tournament(3, { format: 'arena', duration: 60 }); startTournament(t, NOW); pairArena(t, NOW + 1);
  const game = t.games.find(g => !g.bye), waiting = t.players.find(p => p.id !== game.white && p.id !== game.black);
  assert.equal(selectedGame(t, waiting.id, null), null);
  assert.equal(selectedGame(t, waiting.id, game.id).id, game.id);
  assert.equal(selectedGame(t, game.white, null).id, game.id);
  assert.equal(selectedGame(t, null, null).id, game.id);
});

test('arena: evita a los últimos rivales mientras haya otro libre', () => {
  const t = tournament(4, { format: 'arena', duration: 60 }); startTournament(t, NOW);
  const [a, b, c, d] = t.players.map(p => p.id), game = (w, k, r) => ({ id: w + k + r, round: r, white: w, black: k, result: '1/2-1/2', bye: false, finishedAt: NOW, moves: [] });
  t.round = 3;
  // A ha jugado contra B (antes) y contra C (la última); D está en pausa. Libres: A, B y C.
  t.games.push(game(a, b, 1), game(a, c, 2));
  t.players.find(p => p.id === d).paused = true;
  pairArena(t, NOW + 60000, new Set([a, b, c, d]));
  // Elija quien elija primero (el orden depende del sorteo), nadie repite contra su último rival:
  // A y C acaban de jugar, así que la pareja nunca es A-C.
  const g = t.games.at(-1);
  assert.notDeepEqual([g.white, g.black].sort(), [a, c].sort());
});

test('arena: entre los libres prefiere a quien no ha sido rival reciente', () => {
  const t = tournament(4, { format: 'arena', duration: 60 }); startTournament(t, NOW);
  const [a, b, c, d] = t.players.map(p => p.id);
  t.players.forEach((p, i) => { p.seed = i + 1; }); // A elige primero
  const game = (w, k, r) => ({ id: w + k + r, round: r, white: w, black: k, result: '1/2-1/2', bye: false, finishedAt: NOW, moves: [] });
  t.round = 2; t.games.push(game(a, b, 1), game(a, c, 2));
  pairArena(t, NOW + 60000, new Set([a, b, c, d]));
  const mine = t.games.slice(-2).find(g => g.white === a || g.black === a);
  assert.ok([mine.white, mine.black].includes(d)); // ni C (la última) ni B (la anterior): D
});
