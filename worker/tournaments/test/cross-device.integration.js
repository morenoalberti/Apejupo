import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

const BASE = 'http://127.0.0.1:8789', ORIGIN = 'http://127.0.0.1:8087';
const token = () => randomBytes(32).toString('hex');
const post = (path, body, session = '') => fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) }, body: JSON.stringify(body) });
async function connect(id, credentials = {}) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/tournaments/${id}/socket`, { headers: { Origin: ORIGIN } });
  const messages = [], waiters = [];
  ws.on('message', data => {
    const value = JSON.parse(String(data)); messages.push(value);
    for (const waiter of [...waiters]) if (waiter.predicate(value)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(value); }
  });
  const wait = (predicate, after = 0) => {
    const found = messages.slice(after).find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('No llegó el estado esperado de la sala')); }, 6000);
      const waiter = { predicate, resolve: value => { clearTimeout(timer); resolve(value); } }; waiters.push(waiter);
    });
  };
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await wait(m => m.type === 'state');
  const client = { ws, messages, wait, send: action => ws.send(JSON.stringify(action)), async hello(data = credentials) {
    const after = messages.length; ws.send(JSON.stringify({ type: 'hello', ...data }));
    return wait(m => m.type === 'state', after);
  } };
  client.state = await client.hello(); return client;
}

test('la sesión recupera la inscripción y permite jugar desde móvil sin token local, sin duplicar ni expulsar al PC', { timeout: 45000 }, async () => {
  const owner = await organizerSession(), alice = await organizerSession(), bob = await organizerSession(), stranger = await organizerSession();
  const hostToken = token(), desktopToken = token();
  const response = await post('/api/tournaments', { title: 'Inscripción desde varios dispositivos', format: 'arena', minutes: 4, increment: 2, duration: 15, capacity: 2, hostToken }, owner.session);
  assert.equal(response.status, 201);
  const { id } = await response.json(), clients = [];
  try {
    const a = await post(`/api/tournaments/${id}/join`, { token: desktopToken }, alice.session);
    assert.equal(a.status, 201); const aid = (await a.json()).playerId;
    const b = await post(`/api/tournaments/${id}/join`, { token: token() }, bob.session);
    assert.equal(b.status, 201); const bid = (await b.json()).playerId;
    const desktop = await connect(id, { token: desktopToken }); clients.push(desktop);
    const mobile = await connect(id, { session: alice.session }); clients.push(mobile);
    const tablet = await connect(id, { session: bob.session }); clients.push(tablet);
    const visitor = await connect(id, { session: stranger.session }); clients.push(visitor);
    const forged = await connect(id, { session: token(), accountId: alice.user.id, me: aid, nick: alice.user.nick }); clients.push(forged);
    const host = await connect(id, { hostToken }); clients.push(host);
    assert.equal(desktop.state.me, aid); assert.equal(mobile.state.me, aid); assert.equal(tablet.state.me, bid);
    assert.equal(visitor.state.me, null); assert.equal(forged.state.me, null);
    assert.equal(mobile.state.host, false); assert.equal(mobile.state.count, 2);
    const revision = mobile.state.revision;
    host.send({ type: 'join-key', key: 'clave-club' });
    const broadcast = await mobile.wait(m => m.type === 'state' && m.revision > revision);
    assert.equal(broadcast.me, aid, 'Los estados compartidos mantienen la identificación por cuenta');
    assert.equal(broadcast.count, 2);
    assert.equal((await desktop.hello()).me, aid, 'La credencial original sigue funcionando');
    assert.equal((await mobile.hello({})).me, null, 'Sin sesión ni token deja de identificarse');
    assert.equal((await mobile.hello({ session: bob.session })).me, bid, 'Cambiar de cuenta actualiza la inscripción');
    assert.equal((await mobile.hello({ session: alice.session })).me, aid);
    const otherDevice = await connect(id, { session: alice.session }); clients.push(otherDevice);
    assert.equal(otherDevice.state.me, aid); assert.equal(otherDevice.state.count, 2);
    desktop.ws.close();
    host.send({ type: 'start' });
    const playing = await mobile.wait(m => m.type === 'state' && m.games.some(g => !g.result));
    assert.equal(playing.me, aid); assert.equal(playing.count, 2);
    assert.equal(playing.game.white === aid || playing.game.black === aid, true);
    const rival = await tablet.wait(m => m.type === 'state' && m.status === 'playing' && !!m.game);
    assert.equal(rival.me, bid);
    const after = mobile.messages.length;
    mobile.send({ type: 'resign', game: playing.game.id });
    const ended = await mobile.wait(m => m.type === 'state' && m.game?.result, after);
    assert.equal(ended.me, aid); assert.equal(ended.game.reason, 'Abandono');
    assert.equal(ended.game.result, playing.game.white === aid ? '0-1' : '1-0');
    assert.equal((await otherDevice.hello()).me, aid);
  } finally {
    for (const client of clients) client.ws.close();
    await post(`/api/tournaments/${id}/delete`, { hostToken });
  }
});
