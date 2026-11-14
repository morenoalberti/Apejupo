import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

const BASE = 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
// Organizar pide una cuenta confirmada: «key» es la sesión de un organizador de prueba.
const key = (await organizerSession()).session;
assert.ok(key, 'No se pudo crear la cuenta de organizador de prueba.');
const token = () => randomBytes(32).toString('hex');
async function api(path, options = {}) {
  return fetch(BASE + '/api/tournaments' + path, { ...options, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...options.headers } });
}
async function connect(id, credentials = {}) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/api/tournaments/' + id + '/socket', { origin: ORIGIN });
  const client = { ws, state: null, errors: [], waiters: [] };
  client.wait = (predicate, timeout = 20000) => {
    if (client.state && predicate(client.state)) return Promise.resolve(client.state);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: value => { clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => { client.waiters = client.waiters.filter(w => w !== waiter); reject(new Error('No llegó el estado esperado.')); }, timeout);
      client.waiters.push(waiter);
    });
  };
  client.send = action => ws.send(JSON.stringify(action));
  ws.on('message', data => {
    if (String(data) === 'pong') return;
    const message = JSON.parse(String(data));
    if (message.type === 'error') client.errors.push(message.message);
    if (message.type !== 'state') return;
    client.state = message;
    for (const waiter of [...client.waiters]) if (waiter.predicate(message)) { client.waiters.splice(client.waiters.indexOf(waiter), 1); waiter.resolve(message); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  client.send({ type: 'hello', ...credentials });
  await client.wait(s => credentials.hostToken ? s.host : credentials.token ? !!s.me : true);
  return client;
}


test('arena: empareja a los conectados y vuelve a emparejar al que queda libre', { timeout: 60000 }, async () => {
  const hostToken = token();
  const res = await api('', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify({ title: 'Arena de prueba', format: 'arena', duration: 20, minutes: 3, increment: 0, capacity: 8, hostToken }) });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const players = [];
  for (const name of ['Ana', 'Bea', 'Carlos']) {
    const t = token();
    assert.equal((await api('/' + id + '/join', { method: 'POST', body: JSON.stringify({ name, token: t }) })).status, 201);
    players.push(await connect(id, { token: t }));
  }
  const host = await connect(id, { hostToken });
  host.send({ type: 'start' });
  const started = await host.wait(s => s.status === 'playing' && s.games.length === 1);
  assert.equal(started.format, 'arena'); assert.ok(started.endsAt > Date.now());
  const game = started.games[0];
  const playing = players.find(p => p.state.me === game.white);
  const waiting = players.find(p => p.state.me !== game.white && p.state.me !== game.black);
  playing.send({ type: 'resign', game: game.id });
  // Tras la pausa de 10 s, el que esperaba juega con uno de los que acaban de terminar.
  const next = await waiting.wait(s => s.games.length === 2, 20000);
  const g2 = next.games.find(g => g.id !== game.id);
  assert.ok(g2.white === waiting.state.me || g2.black === waiting.state.me);
  host.send({ type: 'cancel' });
  await host.wait(s => s.status === 'cancelled');
  for (const c of [...players, host]) c.ws.close();
});
