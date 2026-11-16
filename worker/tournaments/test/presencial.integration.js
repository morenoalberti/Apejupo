import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

const BASE = 'http://127.0.0.1:8789', ORIGIN = 'http://127.0.0.1:8087';
const token = () => randomBytes(32).toString('hex');
const post = (path, data, session) => fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) }, body: JSON.stringify(data) });
async function connect(id, credentials = {}) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/tournaments/${id}/socket`, { headers: { Origin: ORIGIN } });
  const queue = [], waiting = [];
  ws.on('message', d => { const value = JSON.parse(String(d)); const resolve = waiting.shift(); if (resolve) resolve(value); else queue.push(value); });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve));
  async function until(predicate) {
    let timer;
    try { return await Promise.race([(async () => { while (true) { const value = await next(); if (predicate(value)) return value; } })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sin respuesta de la sala local')), 5000); })]); }
    finally { clearTimeout(timer); }
  }
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(m => m.type === 'state');
  ws.send(JSON.stringify({ type: 'hello', ...credentials }));
  let state = await until(m => m.type === 'state');
  return { ws, get state() { return state; }, async action(value, error = false) {
    ws.send(JSON.stringify(value));
    const reply = await until(m => error ? m.type === 'error' : m.type === 'state' && m.revision > state.revision);
    if (!error) state = reply;
    return reply;
  } };
}

test('presencial real: guardar modalidad, permisos, resultados manuales, doble vuelta y suizo', { timeout: 45000 }, async () => {
  const owner = await organizerSession();
  for (const format of ['double-closed', 'swiss']) {
    const hostToken = token(), fields = { title: 'Presencial de prueba ' + format, mode: 'presencial', format, minutes: 4, increment: 2, rounds: 3, capacity: 128, startsAt: Date.now() - 3600000 };
    const response = await post('/api/tournaments', { ...fields, hostToken }, owner.session);
    assert.equal(response.status, 201, await response.clone().text());
    const { id } = await response.json();
    let host, viewer;
    try {
      const config = await post(`/api/tournaments/${id}/config`, { hostToken });
      assert.equal((await config.json()).mode, 'presencial');
      // Quien escanea el QR no se inscribe: deja una solicitud que solo ve el organizador.
      const asker = token(), joined = await post(`/api/tournaments/${id}/join`, { token: asker, name: 'Intruso' });
      assert.equal(joined.status, 202);
      host = await connect(id, { hostToken }); viewer = await connect(id);
      assert.equal(host.state.host, true); assert.equal(viewer.state.host, false);
      assert.equal(host.state.count, 0); assert.equal(host.state.requests.length, 1); assert.equal(viewer.state.requests, undefined);
      await host.action({ type: 'presencial-reject', requestId: host.state.requests[0].id });
      assert.equal(host.state.requests.length, 0);
      const bad = await viewer.action({ type: 'presencial-player', name: 'Intruso', host: true }, true);
      assert.match(bad.message, /organizador/);
      for (let i = 0; i < 4; i++) await host.action({ type: 'presencial-player', name: 'Jugador ' + i, rating: 2000 - i * 100 });
      assert.equal(host.state.count, 4);
      await host.action({ type: 'start' });
      assert.equal(host.state.game, null); assert.equal(host.state.minutes, 4);
      assert.equal(host.state.rounds, 3); // doble vuelta: las dos partidas de cada pareja en la misma ronda
      for (const g of host.state.games) { assert.equal(g.fen, undefined); assert.equal(g.whiteMs, undefined); }
      const first = host.state.games[0];
      const forged = await viewer.action({ type: 'presencial-result', game: first.id, result: '1-0', host: true }, true);
      assert.match(forged.message, /organizador/);
      while (host.state.status !== 'finished') {
        for (const g of host.state.games.filter(g => !g.result)) await host.action({ type: 'presencial-result', game: g.id, result: format === 'double-closed' ? '1-1' : '1/2-1/2' });
        if (host.state.status === 'between') {
          assert.equal(host.state.nextRoundAt, null);
          await host.action({ type: 'presencial-next' });
        }
      }
      assert.equal(host.state.games.length, 6);
      const persisted = await (await fetch(`${BASE}/api/tournaments/${id}`, { headers: { Origin: ORIGIN } })).json();
      assert.equal(persisted.mode, 'presencial'); assert.equal(persisted.status, 'finished');
      assert.ok(persisted.standings.every(p => p.points === (format === 'double-closed' ? 3 : 1.5)));
    } finally {
      host?.ws.close(); viewer?.ws.close();
      await post(`/api/tournaments/${id}/delete`, { hostToken });
    }
  }
});
