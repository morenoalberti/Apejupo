import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

const BASE = process.env.CUENTAS_BASE || 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const ADMIN = vars.match(/^CUENTAS_ADMIN\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const token = () => randomBytes(32).toString('hex');
async function call(path, data = {}, auth = '') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json() };
}
async function host(id, credentials) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/tournaments/${id}/socket`, { origin: ORIGIN });
  const client = { ws, state: null, waiters: [] };
  client.wait = predicate => {
    if (client.state && predicate(client.state)) return Promise.resolve(client.state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No llegó el estado esperado.')), 5000);
      client.waiters.push({ predicate, resolve: state => { clearTimeout(timer); resolve(state); } });
    });
  };
  ws.on('message', raw => {
    const state = JSON.parse(String(raw));
    if (state.type !== 'state') return;
    client.state = state;
    for (const waiter of [...client.waiters]) if (waiter.predicate(state)) {
      client.waiters.splice(client.waiters.indexOf(waiter), 1); waiter.resolve(state);
    }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'hello', ...credentials }));
  await client.wait(state => state.host);
  return client;
}

test('el administrador borra torneos ajenos en cualquier estado; el navegador no puede fingir ese permiso', { timeout: 60000 }, async () => {
  assert.ok(ADMIN, 'Falta CUENTAS_ADMIN en .dev.vars');
  const verify = '/api/tournaments/admin/comprobar';
  assert.equal((await call(verify)).status, 401);
  assert.equal((await call(verify, {}, 'clave-incorrecta-de-prueba')).status, 401);
  assert.equal((await fetch(BASE + verify, { headers: { Origin: ORIGIN } })).status, 405);
  assert.equal((await call(verify, {}, ADMIN)).status, 200);
  const creator = await organizerSession(BASE, ORIGIN), other = await organizerSession(BASE, ORIGIN);
  assert.equal((await call(verify, {}, other.session)).status, 401, 'La sesión de un jugador no es una clave de administrador');
  const created = [];
  const sockets = [];
  try {
    for (const status of ['waiting', 'playing', 'finished', 'cancelled']) {
      const hostToken = token();
      const result = await call('/api/tournaments', { title: `Borrado admin ${status}`, minutes: 3, increment: 2, rounds: 1, capacity: 2, hostToken }, creator.session);
      assert.equal(result.status, 201);
      const id = result.body.id, path = `/api/tournaments/${id}`;
      created.push({ id, hostToken });
      const playerToken = token();
      if (status === 'playing' || status === 'finished') {
        for (const [i, secret] of [playerToken, token()].entries()) {
          assert.equal((await call(path + '/join', { name: `Prueba_${id.slice(0, 6)}_${i}`, token: secret })).status, 201);
        }
      }
      const client = await host(id, { hostToken, ...(status === 'playing' || status === 'finished' ? { token: playerToken } : {}) });
      sockets.push(client.ws);
      if (status === 'playing' || status === 'finished') {
        client.ws.send(JSON.stringify({ type: 'start' }));
        await client.wait(state => state.status === 'playing');
        if (status === 'finished') {
          client.ws.send(JSON.stringify({ type: 'resign', game: client.state.game.id }));
          await client.wait(state => state.status === 'finished');
        }
      } else if (status === 'cancelled') {
        client.ws.send(JSON.stringify({ type: 'cancel' }));
        await client.wait(state => state.status === 'cancelled');
      }
      for (const data of [{}, { admin: true }, { admin: true, hostToken: token() }, { key: ADMIN }]) {
        assert.equal((await call(path + '/delete', data)).status, 403, 'No se aceptan permisos declarados por el cliente');
      }
      assert.equal((await call(path + '/delete', {}, other.session)).status, 403);
      assert.equal((await call(path + '/delete', {}, 'clave-incorrecta-de-prueba')).status, 401);
      assert.equal((await call(path + '/config', {}, ADMIN)).status, 200, 'El administrador también puede consultar la configuración');
      assert.equal((await fetch(BASE + path)).status, 200, 'Los intentos no autorizados no borran el torneo');
      const closed = new Promise(resolve => client.ws.once('close', (code, reason) => resolve({ code, reason: String(reason) })));
      assert.equal((await call(path + '/delete', {}, ADMIN)).status, 200);
      assert.deepEqual(await closed, { code: 1000, reason: 'El administrador ha borrado el torneo.' });
      assert.equal((await fetch(BASE + path)).status, 404);
      const listing = await (await fetch(BASE + '/api/tournaments')).json();
      assert.equal(listing.tournaments.some(t => t.id === id), false);
    }
    // El organizador conserva su vía de borrado sin la clave de administrador.
    const hostToken = token();
    const own = await call('/api/tournaments', { title: 'Borrado del organizador', minutes: 3, increment: 2, rounds: 1, capacity: 2, hostToken }, creator.session);
    assert.equal(own.status, 201);
    created.push({ id: own.body.id, hostToken });
    assert.equal((await call(`/api/tournaments/${own.body.id}/delete`, { hostToken })).status, 200);
  } finally {
    for (const ws of sockets) ws.close();
    for (const { id, hostToken } of created) await call(`/api/tournaments/${id}/delete`, { hostToken });
    for (const user of [creator.user, other.user]) await call('/api/cuentas/admin/borrar', { id: user.id }, ADMIN);
  }
});
