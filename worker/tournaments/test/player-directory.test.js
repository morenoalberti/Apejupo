import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredPlayerNicks, clubRanking } from '../src/player-directory.js';

test('el directorio excluye cuentas de prueba por su correo y conserva nicks reales', () => {
  const users = [
    { nick: 'Org_12345678', email: 'org.12345678@example.com' },
    { nick: 'Prueba123', email: 'prueba@EXAMPLE.ORG' },
    { nick: 'TestNet', email: 'prueba@example.net' },
    { nick: 'TestSub', email: 'prueba@qa.example.com' },
    { nick: 'TestLocal', email: 'prueba@club.test' },
    { nick: 'TestInvalid', email: 'prueba@club.invalid' },
    { nick: 'morenoalberti', email: 'moreno@correo.es' },
    { nick: 'Org_real', email: 'jugador@gmail.com' },
    { nick: 'MariaGM', email: 'maria@example.com.es' },
  ];
  assert.deepEqual(registeredPlayerNicks(users), ['morenoalberti', 'Org_real', 'MariaGM']);
});

test('la clasificación del club ordena por ELO, oculta el correo y quita las cuentas de prueba', () => {
  const users = [
    { id: 'a'.repeat(24), nick: 'zeta', email: 'z@gmail.com', elo: 1500, games: 0, photo_at: null },
    { id: 'b'.repeat(24), nick: 'Alfa', email: 'a@gmail.com', elo: 1500, games: 2, photo_at: 77 },
    { id: 'c'.repeat(24), nick: 'top', email: 't@gmail.com', elo: 1620, games: '5', photo_at: null },
    { id: 'd'.repeat(24), nick: 'prueba', email: 'p@example.com', elo: 2000, games: 9, photo_at: null }
  ];
  assert.deepEqual(clubRanking(users), [
    { nick: 'top', elo: 1620, games: 5, photo: null },
    { nick: 'Alfa', elo: 1500, games: 2, photo: 'b'.repeat(24) + '?v=77' },
    { nick: 'zeta', elo: 1500, games: 0, photo: null }
  ]);
  assert.ok(clubRanking(users).every(row => !('email' in row) && !('id' in row)));
});
