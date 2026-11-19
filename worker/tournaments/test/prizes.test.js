import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createTournament } from '../src/core.js';
import { prizeResults, savedPrizes, validatePrizes } from '../src/prizes.js';

const now = Date.UTC(2026, 10, 18);
const entrants = [
  { name: 'Ana Rivera', rating: 2200, birth: 2009, sex: 'F', club: 'Apejupo' },
  { name: 'Bea Romero', rating: 1800, birth: 1970, sex: 'F', club: 'Otro club' },
  { name: 'Carlos Ruiz', rating: 1600, birth: 1976, sex: 'M', club: 'Apejupo' },
  { name: 'Daniel López', birth: 2008, sex: 'M' },
];

function tournament() {
  const room = createTournament({
    title: 'Prueba de premios', mode: 'presencial', format: 'closed', minutes: 4, increment: 3, capacity: 12,
  }, 'a'.repeat(24), 'local', now);
  for (const player of entrants) act(room, null, true, { type: 'presencial-player', ...player }, now);
  return room;
}

function category(type, name, cents, options = {}) {
  return { type, name, positions: [{ cents, item: cents ? '' : 'Trofeo' }], ...options };
}

function finish(room) {
  act(room, null, true, { type: 'start' }, now);
  while (room.status !== 'finished') {
    for (const game of room.games.filter(game => game.round === room.round && !game.result)) {
      const whiteWins = room.players.findIndex(player => player.id === game.white) < room.players.findIndex(player => player.id === game.black);
      act(room, null, true, { type: 'presencial-result', game: game.id, result: whiteWins ? '1-0' : '0-1' }, now);
    }
  }
}
const tiers = (...pairs) => pairs.map(([limit, cents]) => ({ limit, cents, item: '' }));

test('los premios siguen la clasificación, los tramos y el orden de los importes', () => {
  const room = tournament();
  const categories = [
    category('general', 'General', 10000),
    category('female', 'Mejor femenina', 20000),
    category('elo', 'Tramos por ELO', 0, { positions: tiers([1900, 4000], [1700, 5000]) }),
    category('senior', 'Veteranos', 0, { positions: tiers([50, 5000]) }),
    category('age', 'Tramos por edades', 0, { positions: tiers([18, 1000]) }),
    category('local', 'Jugadores locales', 0, { club: '  APEJUPO  ' }),
    category('custom', 'Juego limpio', 0, { positions: [{ cents: 0, item: 'Medalla', winnerId: room.players[3].id }] }),
  ];
  const config = validatePrizes({ categories }, room.players);
  // Los tramos se ordenan de menor a mayor: < 1.700 y después < 1.900.
  assert.deepEqual(config.categories[2].positions.map(position => position.limit), [1700, 1900]);
  const winners = () => prizeResults(room, config).map(row => row.winner);
  assert.deepEqual(winners(), ['', '', '', '', '', '', '', 'Daniel López']);

  finish(room);
  // Ana, Bea, Carlos y Daniel, por este orden. Sin acumular: cada uno cobra el de mayor importe.
  assert.deepEqual(winners(), ['Bea Romero', 'Ana Rivera', 'Carlos Ruiz', '', '', '', '', 'Daniel López']);
  // Acumulativos: cada categoría se reparte por su cuenta.
  const all = validatePrizes({ categories, accumulates: true }, room.players);
  assert.deepEqual(prizeResults(room, all).map(row => row.winner), ['Ana Rivera', 'Ana Rivera', 'Carlos Ruiz', 'Bea Romero', 'Bea Romero', 'Ana Rivera', 'Ana Rivera', 'Daniel López']);
});

test('tramos de ELO: rangos cerrados entre un límite y el anterior; sin ELO no se opta', () => {
  const room = tournament();
  finish(room);
  const elo = category('elo', 'Tramos por ELO', 0, { positions: tiers([1400, 3000], [1600, 2000], [1800, 1000]) });
  // Carlos (1.600) cae en «< 1.800» (1.600–1.799); Bea (1.800) y Daniel (sin ELO) en ninguno.
  assert.deepEqual(prizeResults(room, validatePrizes({ categories: [elo] }, room.players)).map(row => row.winner), ['', '', 'Carlos Ruiz']);
  // Varios premiados en un mismo tramo: 1.º y 2.º de «< 1.900» (Bea 1.800 y Carlos 1.600).
  const twice = category('elo', 'ELO', 0, { positions: tiers([1900, 100], [1900, 50]) });
  assert.deepEqual(prizeResults(room, validatePrizes({ categories: [twice] }, room.players)).map(row => row.winner), ['Bea Romero', 'Carlos Ruiz']);
  assert.throws(() => validatePrizes({ categories: [category('elo', 'ELO', 0, { positions: tiers([5000, 100]) })] }, []), /ELO entre 1 y 4000/);
  // Veteranos admite varios puestos con la misma edad (1.º y 2.º Supra 50).
  const senior = category('senior', 'Veteranos', 0, { positions: tiers([50, 3000], [50, 2000]) });
  assert.deepEqual(prizeResults(room, validatePrizes({ categories: [senior] }, room.players)).map(row => row.winner), ['Bea Romero', 'Carlos Ruiz']);
});

test('el ganador elegido a mano manda y ya no opta a otros premios no acumulativos', () => {
  const room = tournament();
  finish(room);
  const [ana, bea, carlos] = room.players;
  const general = category('general', 'General', 0, { positions: [{ cents: 10000, item: '' }, { cents: 5000, item: '', winnerId: carlos.id }] });
  const female = category('female', 'Mejor femenina', 3000);
  const winners = categories => prizeResults(room, validatePrizes({ categories }, room.players)).map(row => [row.winner, row.manual]);
  // 2.º a mano para Carlos; el 1.º sigue siendo automático (Ana) y la femenina pasa a Bea.
  assert.deepEqual(winners([general, female]), [['Ana Rivera', false], ['Carlos Ruiz', true], ['Bea Romero', false]]);
  // Si Bea gana a mano la general, la femenina automática va a Ana.
  const byHand = { ...general, positions: [{ cents: 10000, item: '', winnerId: bea.id }, { cents: 5000, item: '' }] };
  assert.deepEqual(winners([byHand, female]), [['Bea Romero', true], ['Ana Rivera', false], ['', false]]);
  assert.ok(ana);
  // Un nombre escrito a mano que no está inscrito se respeta y no quita premios a nadie.
  const outsider = { ...general, positions: [{ cents: 10000, item: '', winnerName: '  Invitado Especial  ' }, { cents: 5000, item: '' }] };
  assert.deepEqual(winners([outsider, female]), [['Invitado Especial', true], ['Ana Rivera', false], ['Bea Romero', false]]);
  // En blanco a propósito: nadie se lo lleva y el siguiente premio sigue su reparto normal.
  const blank = { ...general, positions: [{ cents: 10000, item: '', vacant: true }, { cents: 5000, item: '' }] };
  assert.deepEqual(winners([blank, female]), [['', true], ['Ana Rivera', false], ['Bea Romero', false]]);
});

test('las configuraciones del modelo anterior se adaptan a los tramos', () => {
  const old = { prizes: { notes: '', categories: [
    { type: 'elo', name: 'Sub-1800', accumulates: true, min: 0, max: 1799, positions: [{ cents: 100, item: '' }, { cents: 50, item: '' }] },
    { type: 'age', name: 'Sub 18', age: 18, positions: [{ cents: 100, item: '' }] },
  ] } };
  const saved = savedPrizes(old);
  assert.equal(saved.accumulates, true);
  assert.deepEqual(saved.categories.map(category => category.positions[0].limit), [1800, 18]);
  assert.ok(!('max' in saved.categories[0]) && !('min' in saved.categories[0]) && !('accumulates' in saved.categories[0]));
  // Los dos puestos del modelo anterior quedan como 1.º y 2.º del mismo tramo.
  assert.deepEqual(saved.categories[0].positions.map(position => position.limit), [1800, 1800]);
  assert.doesNotThrow(() => validatePrizes(saved, []));
});

test('valida importes y ganadores manuales y conserva las notas de la configuración anterior', () => {
  const room = tournament();
    const empty = category('general', 'General', 0, { positions: [{ cents: 0, item: '' }] });
  const winner = { cents: 0, item: 'Medalla', winnerId: room.players[0].id };
  const custom = category('custom', 'Especial', 0, { positions: [winner] });
  assert.throws(() => validatePrizes({ categories: [empty] }, room.players), /añade un importe/);
  assert.throws(() => validatePrizes({ categories: [custom, { ...custom, name: 'Juego limpio' }] }, room.players), /una categoría «Personalizado»/);
  assert.throws(() => validatePrizes({ categories: [custom] }, []), /ya no está en el torneo/);
  assert.deepEqual(savedPrizes({ prizes: 'Premio cedido por el club' }), {
    version: 0, notes: 'Premio cedido por el club', accumulates: false, categories: [],
  });
});

test('cada plantilla de categoría se usa una sola vez', () => {
  const general = category('general', 'Clasificación general', 10000);
  const tramos = [
    category('elo', 'Tramos por ELO', 0, { positions: tiers([1600, 2000]) }),
    category('elo', 'Más tramos', 0, { positions: tiers([1800, 2000]) }),
  ];
  assert.throws(() => validatePrizes({ categories: [general, { ...general, name: 'Otra general' }] }, []), /una categoría «Clasificación general»/);
  assert.throws(() => validatePrizes({ categories: [general, ...tramos] }, []), /una categoría «Tramos por ELO»/);
  assert.equal(validatePrizes({ categories: [general, tramos[1]] }, []).categories.length, 2);
});

test('con premios de igual importe se adjudica el de la categoría que va antes en la lista', () => {
  const room = tournament();
  finish(room);
  const female = category('female', 'Mejor femenina', 5000), general = category('general', 'General', 5000);
  const winners = categories => prizeResults(room, validatePrizes({ categories }, room.players)).map(row => row.winner);
  // Ana va primera en la clasificación y opta a las dos: se lleva la que esté antes en la lista.
  assert.deepEqual(winners([female, general]), ['Ana Rivera', 'Bea Romero']);
  assert.deepEqual(winners([general, female]), ['Ana Rivera', 'Bea Romero']);
  // Con más importe en la segunda, gana la de mayor cuantía aunque esté después.
  assert.deepEqual(winners([female, { ...general, positions: [{ cents: 6000, item: '' }] }]), ['Bea Romero', 'Ana Rivera']);
});
