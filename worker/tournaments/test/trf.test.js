import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, act, closedPairs, standings } from '../src/core.js';
import { trfAvailability, trfDefaults, validateTrfReport, previewTrf } from '../src/trf.js';

const NOW = Date.UTC(2026, 10, 19, 10);
function fixture({ count = 5, format = 'swiss', scoring = '1', complete = true, withdraw = false } = {}) {
  const t = createTournament({ title: 'Abierto de Málaga', mode: 'presencial', format, minutes: 3, increment: 2, rounds: 3, capacity: 32, scoring }, 'a'.repeat(24), 'host', NOW);
  for (let i = 0; i < count; i++) act(t, null, true, { type: 'presencial-player', name: `García Pérez, Jugador ${i + 1}`, rating: 2100 - i * 100, source: 'FIDE', fide: 2100 - i * 100, fada: 1800 - i * 100, fideId: String(2200000 + i), fadaId: String(1000 + i), fed: 'ESP', sex: i % 2 ? 'F' : 'M', birth: 1990 + i, title: i ? '' : 'IM' }, NOW);
  act(t, null, true, { type: 'start' }, NOW);
  if (withdraw) act(t, null, true, { type: 'presencial-active', playerId: t.players[0].id, active: false }, NOW);
  if (complete) while (t.status !== 'finished') {
    const current = t.games.filter(g => g.round === t.round && !g.result);
    for (const [i, g] of current.entries()) act(t, null, true, { type: 'presencial-result', game: g.id, result: format === 'double-closed' ? '1-1' : i % 2 ? '1/2-1/2' : t.round === 1 ? '+-' : '1-0' }, NOW + t.round * 1000);
    if (t.status === 'between') act(t, null, true, { type: 'presencial-next' }, NOW + t.round * 1000 + 1);
  }
  const report = { ...trfDefaults(t), ratingList: 'standard', city: 'Málaga', chiefArbiter: 'Árbitro Principal', startDate: '2026-11-19', endDate: '2026-11-19' };
  return { t, report };
}

test('TRF16: posiciones fijas, CRLF, datos identificativos y resultados recíprocos de todas las rondas', () => {
  const { t, report } = fixture();
  const result = previewTrf(t, validateTrfReport(t, report));
  assert.deepEqual(result.errors, []);
  assert.ok(!result.content.replaceAll('\r\n', '').includes('\n'));
  assert.ok(result.content.endsWith('\r\n'));
  assert.match(result.content, /^012 Abierto de Malaga\r\n/);
  const rows = result.content.split('\r\n').filter(line => line.startsWith('001'));
  assert.equal(rows.length, 5);
  const ids = new Map(t.players.map(p => [p.id, p.seed]));
  for (const p of t.players) {
    const row = rows.find(r => +r.slice(4, 8) === p.seed), final = standings(t).find(r => r.id === p.id);
    assert.equal(row.length, 89 + 10 * t.rounds);
    assert.equal(row.slice(57, 68).trim(), p.fideId);
    assert.equal(row.slice(48, 52).trim(), String(p.rating));
    assert.equal(row.slice(53, 56), 'ESP');
    assert.equal(row[9], p.sex === 'F' ? 'w' : 'm');
    assert.equal(+row.slice(80, 84), final.score);
    for (let round = 1; round <= t.rounds; round++) {
      const offset = (round - 1) * 10, g = t.games.find(g => g.round === round && (g.white === p.id || g.black === p.id));
      if (g?.bye) { assert.equal(row.slice(91 + offset, 99 + offset), '0000 - U'); continue; }
      if (!g) { assert.equal(row.slice(91 + offset, 99 + offset), '0000 - Z'); continue; }
      const white = g.white === p.id;
      assert.equal(+row.slice(91 + offset, 95 + offset), ids.get(white ? g.black : g.white));
      assert.equal(row[96 + offset], white ? 'w' : 'b');
      assert.equal(row[98 + offset], g.result === '1/2-1/2' ? '=' : g.result === '+-' ? white ? '+' : '-' : white ? '1' : '0');
    }
  }
  assert.doesNotMatch(result.content, /^(?:XXR|142|###)/m);
});

test('TRF26 declara el sistema real, rondas, ritmo en segundos y puntuación no estándar', () => {
  const { t, report } = fixture({ scoring: '3' }); report.format = 'trf26';
  const result = previewTrf(t, report);
  assert.deepEqual(result.errors, []);
  assert.match(result.content, /\r\n142 3\r\n/);
  assert.match(result.content, /\r\n192 CUSTOM_SWISS\r\n/);
  assert.match(result.content, /\r\n222 180\+2\r\n/);
  const scoring = result.content.split('\r\n').find(l => l.startsWith('162'));
  assert.equal(scoring[5], 'W'); assert.equal(+scoring.slice(6, 10), 3);
  assert.equal(scoring[14], 'D'); assert.equal(+scoring.slice(15, 19), 1);
});

test('TRF26 declara el sistema holandés solo si consta que se usó en todo el torneo', () => {
  const { t, report } = fixture(); report.format = 'trf26';
  for (const game of t.games) game.pairingCode = 'FIDE_DUTCH_2025';
  assert.match(previewTrf(t, report).content, /^192 FIDE_DUTCH_2025\r$/m);
  delete t.games[0].pairingCode;
  assert.match(previewTrf(t, report).content, /^192 CUSTOM_SWISS\r$/m);
});

test('las fechas de ronda empiezan en la columna 92 y no se inventa el día de nacimiento', () => {
  const { t, report } = fixture(); report.roundDates = ['2026-11-19', '', '2026-11-19'];
  report.players[1].birth = '1991-07-14';
  for (const format of ['trf16', 'trf26']) {
    report.format = format;
    const result = previewTrf(t, report), lines = result.content.split('\r\n');
    assert.equal(lines.find(l => l.startsWith('132')).slice(91, 99), '26/11/19');
    assert.equal(lines.find(l => l.startsWith('132')).slice(101, 109), '26/11/19');
    const players = lines.filter(l => l.startsWith('001'));
    for (const [i, birth] of [[0, ' '.repeat(10)], [1, '1991/07/14']]) {
      const row = players.find(l => +l.slice(4, 8) === t.players[i].seed);
      assert.equal(row.slice(69, 79), birth);
    }
    assert.ok(result.warnings.some(w => w.includes('solo consta el año')));
  }
});

test('FIDE y FADA conservan su Elo separado; un Elo FADA no se atribuye a la FIDE', () => {
  const { t, report } = fixture(); report.ratingList = 'fada';
  const result = previewTrf(t, report);
  for (const p of t.players) {
    const line = result.content.split('\r\n').find(l => l.startsWith('001') && +l.slice(4, 8) === p.seed);
    assert.equal(+line.slice(48, 52), p.fada);
    assert.equal(line.slice(57, 68).trim(), p.fideId);
  }
  t.players[0].source = 'FADA'; delete t.players[0].fide;
  assert.equal(trfDefaults(t).players.find(p => p.id === t.players[0].id).ratings.standard, 0);
  assert.equal(trfDefaults(t).players.find(p => p.id === t.players[0].id).ratings.fada, 1800);
});

test('Round-Robin a una vuelta incluye descansos sin punto; doble vuelta queda bloqueada', () => {
  const one = fixture({ format: 'closed', count: 3 });
  for (const format of ['trf16', 'trf26']) {
    one.report.format = format;
    const result = previewTrf(one.t, one.report);
    assert.deepEqual(result.errors, []);
    if (format === 'trf26') assert.match(result.content, /192 CUSTOM_ROUNDROBIN/);
    assert.match(result.content, /0000 - Z/);
    assert.doesNotMatch(result.content, /0000 - [U-]/);
  }
  const two = fixture({ format: 'double-closed', count: 4 });
  assert.equal(previewTrf(two.t, two.report).content, '');
  assert.ok(previewTrf(two.t, two.report).errors.some(e => e.includes('doble vuelta')));
});

test('la retirada en Round-Robin conserva el rival y el color, con incomparecencia recíproca', () => {
  const { t, report } = fixture({ format: 'closed', count: 4, withdraw: true });
  const retired = t.players[0];
  for (const format of ['trf16', 'trf26']) {
    report.format = format;
    const result = previewTrf(t, report);
    assert.deepEqual(result.errors, []);
    const rows = new Map(result.content.split('\r\n').filter(l => l.startsWith('001')).map(l => [+l.slice(4, 8), l]));
    for (let round = 2; round <= t.rounds; round++) {
      const [white, black] = closedPairs(t.players, round).find(pair => pair.includes(retired));
      const offset = 91 + 10 * (round - 1);
      assert.equal(rows.get(white.seed).slice(offset, offset + 8), `${String(black.seed).padStart(4)} w ${white === retired ? '-' : '+'}`);
      assert.equal(rows.get(black.seed).slice(offset, offset + 8), `${String(white.seed).padStart(4)} b ${black === retired ? '-' : '+'}`);
    }
    assert.doesNotMatch(result.content, /0000 - U/);
  }
});

test('TRF26 FADA usa el registro nacional para separar Elo e ID FADA del registro FIDE', () => {
  const { t, report } = fixture(); report.format = 'trf26'; report.ratingList = 'fada';
  report.players[0].ratings.standard = 0;
  const result = previewTrf(t, report), lines = result.content.split('\r\n');
  assert.match(result.content, /172 ESP OTHER/);
  assert.ok(lines.includes(`072 ${t.players.length - 1}`));
  for (const p of t.players) {
    const fide = lines.find(l => l.startsWith('001') && +l.slice(4, 8) === p.seed);
    const fada = lines.find(l => l.startsWith('ESP') && +l.slice(4, 8) === p.seed);
    assert.equal(+fide.slice(48, 52), report.players.find(player => player.id === p.id).ratings.standard);
    assert.equal(+fada.slice(48, 52), p.fada);
    assert.equal(fada.slice(57, 68).trim(), p.fadaId);
  }
});

test('el informe bloquea torneos incompletos, datos obligatorios ausentes, IDs duplicados y fechas incorrectas', () => {
  const active = fixture({ complete: false });
  assert.equal(previewTrf(active.t, active.report).content, '');
  const { t, report } = fixture();
  report.city = ''; report.chiefArbiter = ''; report.players[1].fideId = report.players[0].fideId;
  const errors = previewTrf(t, report).errors.join('\n');
  assert.match(errors, /ciudad/); assert.match(errors, /árbitro/); assert.match(errors, /repetido/);
  report.players[0].birth = '2026-02-31';
  assert.throws(() => validateTrfReport(t, report), /nacimiento/);
  report.players[0].birth = '1990'; report.players[0].fideId = '123456789012';
  assert.throws(() => validateTrfReport(t, report), /11 cifras/);
});

test('los datos guardados del informe sobreviven y se recuperan sin tokens de jugadores', () => {
  const { t, report } = fixture();
  t.trfReport = validateTrfReport(t, report);
  const saved = trfDefaults(JSON.parse(JSON.stringify(t)));
  assert.equal(saved.city, 'Málaga'); assert.equal(saved.players[0].fadaId, '1000');
  assert.ok(!JSON.stringify(saved).includes('"hash"'));
});

test('disponibilidad TRF distingue las rondas pendientes de los datos por completar', () => {
  const unfinished = fixture({ complete: false });
  assert.match(trfAvailability(unfinished.t).blocker, /todas las rondas/);
  assert.equal(trfAvailability(unfinished.t).needsData, false);

  const { t, report } = fixture();
  t.trfReport = validateTrfReport(t, { ...report, city: '' });
  assert.deepEqual(trfAvailability(t), { blocker: 'Falta la ciudad del torneo.', needsData: true });
  t.trfReport.city = report.city;
  t.trfReport.players[0].fideId = '';
  assert.match(trfAvailability(t).blocker, /falta el ID FIDE/);
  assert.equal(trfAvailability(t).needsData, true);
  t.trfReport.players[0].fideId = report.players[0].fideId;
  assert.deepEqual(trfAvailability(t), { blocker: '', needsData: false });
});
