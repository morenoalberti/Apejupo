import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const BASE = 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
const key = (await readFile(new URL('../.dev.vars', import.meta.url), 'utf8')).match(/^TORNEOS_CLAVE\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
assert.ok(key, 'Configura una clave local en .dev.vars antes de ejecutar la prueba.');
// Con TORNEOS_SIN_CLAVE="1" (solo pruebas locales) el servidor no comprueba la clave.
const keyOff = /^TORNEOS_SIN_CLAVE\s*=\s*"?1"?/m.test(await readFile(new URL('../.dev.vars', import.meta.url), 'utf8'));
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

test('32 jugadores, 16 partidas WebSocket, espectador, reconexión, autorización y PGN', { timeout: 180000 }, async () => {
  const hostToken = token();
  const created = await api('', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify({ title: 'Prueba de carga · 32 jugadores', minutes: 5, increment: 3, rounds: 1, capacity: 32, hostToken }) });
  assert.equal(created.status, 201);
  const { id } = await created.json(), clients = [];
  try {
    const credentials = Array.from({ length: 32 }, (_, i) => ({ token: token(), name: 'Prueba ' + (i + 1) }));
    const registered = await Promise.all(credentials.map(async data => {
      const r = await api('/' + id + '/join', { method: 'POST', body: JSON.stringify(data) });
      assert.equal(r.status, 201); return r.json();
    }));
    assert.equal((await api('/' + id + '/join', { method: 'POST', body: JSON.stringify({ token: token(), name: 'Jugador sobrante' }) })).status, 400);
    const host = await connect(id, { hostToken }); clients.push(host);
    const spectator = await connect(id); clients.push(spectator);
    const players = await Promise.all(credentials.map(c => connect(id, { token: c.token }))); clients.push(...players);
    assert.equal(host.state.count, 32);
    spectator.send({ type: 'start' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(spectator.errors[0], /organizador/);
    host.send({ type: 'start' });
    await Promise.all([host, ...players].map(p => p.wait(s => s.status === 'playing' && s.games.length === 16)));
    const games = host.state.games;
    assert.equal(games.length, 16);
    const byId = new Map(players.map(p => [p.state.me, p]));
    assert.equal(new Set(registered.map(p => p.playerId)).size, 32);
    assert.equal((await api('/' + id + '/pgn')).status, 403);
    const durations = [];
    for (const [ply, from, to] of [[0, 'e2', 'e4'], [1, 'e7', 'e5'], [2, 'g1', 'f3'], [3, 'b8', 'c6']]) {
      const start = performance.now();
      for (const g of games) byId.get(ply % 2 ? g.black : g.white).send({ type: 'move', game: g.id, from, to, ply });
      await Promise.all(players.map(p => p.wait(s => s.game.moves.length === ply + 1)));
      durations.push(Math.round(performance.now() - start));
    }
    const first = players[0], oldId = first.state.me;
    const reconnectToken = credentials[registered.findIndex(p => p.playerId === oldId)].token;
    first.ws.close();
    const resumed = await connect(id, { token: reconnectToken }); clients.push(resumed);
    assert.equal(resumed.state.me, oldId); assert.equal(resumed.state.game.moves.length, 4);
    byId.set(oldId, resumed);
    assert.ok(resumed.state.game.whiteMs <= 306000 && resumed.state.game.blackMs <= 306000);
    const g = games[0];
    spectator.send({ type: 'move', game: g.id, from: 'd2', to: 'd4', ply: 4 });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(spectator.errors.at(-1), /inscribirte/);
    for (const game of games) byId.get(game.white).send({ type: 'resign', game: game.id });
    await host.wait(s => s.status === 'finished');
    assert.equal(host.state.games.filter(g => g.result).length, 16);
    assert.equal(host.state.standings.reduce((n, p) => n + p.points, 0), 16);
    assert.ok(!JSON.stringify(spectator.state).includes(credentials[0].token));
    const pgn = await api('/' + id + '/pgn'); assert.equal(pgn.status, 200); assert.match(await pgn.text(), /\[Event "Prueba de carga/);
    const wrongOrigin = await fetch(BASE + '/api/tournaments', { headers: { Origin: 'https://untrusted.invalid' } }); assert.equal(wrongOrigin.status, 403);
    if (!keyOff) {
      assert.equal((await api('', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' })).status, 403);
      assert.equal((await api('/' + id + '/recover', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: JSON.stringify({ hostToken: token() }) })).status, 403);
    }
    assert.equal((await api('/' + id + '/join', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(5000) }) })).status, 413);
    const publicState = await (await api('/' + id)).json();
    await mkdir(new URL('../../../build/', import.meta.url), { recursive: true });
    await writeFile(new URL('../../../build/torneo-network-result.json', import.meta.url), JSON.stringify({ id, rounds: 1, players: 32, games: 16, moveBatchLatencyMs: durations, revision: publicState.revision, standings: publicState.standings }, null, 2));
    console.log('32 jugadores y 16 tableros; latencias por lote local (ms): ' + durations.join(', '));
  } finally { for (const c of clients) c.ws.close(); }
});
