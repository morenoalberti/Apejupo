import test from 'node:test';
import assert from 'node:assert/strict';
import { registeredPlayerNicks } from '../src/player-directory.js';

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
