import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

const BASE = 'http://127.0.0.1:8789', ORIGIN = 'http://127.0.0.1:8087';
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const ADMIN = vars.match(/^CUENTAS_ADMIN\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const token = () => randomBytes(32).toString('hex');
async function post(path, data = {}, auth = '') {
  return fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(data) });
}
async function connect(id, credentials = {}) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/tournaments/${id}/socket`, { origin: ORIGIN });
  const queue = [], waiting = [], messages = [];
  let state;
  ws.on('message', raw => {
    const value = JSON.parse(String(raw)); messages.push(value);
    if (value.type === 'state') state = value;
    const resolve = waiting.shift(); if (resolve) resolve(value); else queue.push(value);
  });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve));
  async function until(predicate) {
    let timer;
    try { return await Promise.race([(async () => { while (true) { const m = await next(); if (predicate(m)) return m; } })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sin respuesta de permisos')), 5000); })]); }
    finally { clearTimeout(timer); }
  }
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  await until(m => m.type === 'state');
  ws.send(JSON.stringify({ type: 'hello', ...credentials }));
  await until(m => m.type === 'state');
  return { ws, messages, get state() { return state; }, async action(value, error = false, accept = () => true) {
    // Otra conexión puede tener aún un broadcast pendiente. Solo vale un estado que incluya esta acción.
    const revision = (await (await fetch(BASE + '/api/tournaments/' + id)).json()).revision;
    queue.length = 0;
    ws.send(JSON.stringify(value));
    return until(m => error ? m.type === 'error' : m.type === 'state' && (value.type === 'hello' ? m.revision >= revision : m.revision > revision) && accept(m));
  } };
}

test('administrador y creador gestionan las rondas presenciales; otros usuarios no pueden atribuirse permisos', { timeout: 60000 }, async () => {
  assert.ok(ADMIN);
  const creator = await organizerSession(BASE, ORIGIN), other = await organizerSession(BASE, ORIGIN);
  const hostToken = token(), sockets = [];
  let id;
  try {
    const created = await post('/api/tournaments', { title: 'Permisos de emparejamientos', mode: 'presencial', format: 'double-closed', minutes: 3, increment: 2, capacity: 8, hostToken }, creator.session);
    assert.equal(created.status, 201); ({ id } = await created.json());
    const owner = await connect(id, { session: creator.session }); sockets.push(owner.ws);
    assert.equal(owner.state.host, true, 'El creador entra con su cuenta, sin el token del navegador original');
    const admin = await connect(id, { adminKey: ADMIN }); sockets.push(admin.ws);
    assert.equal(admin.state.host, true, 'El administrador puede gestionar un presencial ajeno');
    assert.equal(admin.messages.some(m => m.type === 'host-token'), false, 'No crea credenciales permanentes de organizador para el administrador');
    assert.equal(JSON.stringify(admin.messages).includes(ADMIN), false, 'La clave no se devuelve en el estado');
    const outsider = await connect(id, { session: other.session, admin: true, host: true, adminKey: 'clave-incorrecta-de-prueba' }); sockets.push(outsider.ws);
    assert.equal(outsider.state.host, false);
    for (const action of [{ type: 'presencial-player', name: 'Intruso' }, { type: 'presencial-reset' }]) {
      assert.match((await outsider.action({ ...action, host: true, admin: true }, true)).message, /organizador/);
    }
    for (let i = 0; i < 4; i++) await admin.action({ type: 'presencial-player', name: 'Jugador ' + i });
    await owner.action({ type: 'start' });
    const rounds = await admin.action({ type: 'hello', adminKey: ADMIN });
    assert.equal(rounds.host, true); assert.equal(rounds.round, 1); assert.equal(rounds.status, 'playing');
    await admin.action({ type: 'presencial-result', game: rounds.games[0].id, result: '2-0' });
    assert.match((await outsider.action({ type: 'presencial-reset', admin: true }, true)).message, /organizador/);
    const reset = await admin.action({ type: 'presencial-reset' });
    assert.equal(reset.status, 'waiting'); assert.equal(reset.count, 4); assert.deepEqual(reset.games, []);
    await owner.action({ type: 'start' });
    const ownerReset = await owner.action({ type: 'presencial-reset' });
    assert.equal(ownerReset.status, 'waiting'); assert.equal(ownerReset.count, 4);
    // Los controles de edición disponibles para ambos siguen protegidos por el servidor.
    assert.equal((await post(`/api/tournaments/${id}/config`, { admin: true })).status, 403);
    assert.equal((await post(`/api/tournaments/${id}/config`, {}, ADMIN)).status, 200);
    assert.equal((await post(`/api/tournaments/${id}/edit`, { title: 'Permisos revisados', mode: 'presencial', format: 'double-closed', minutes: 3, increment: 2, capacity: 8 }, ADMIN)).status, 200);
    const revoked = await admin.action({ type: 'hello' }, false, m => !m.host);
    assert.equal(revoked.host, false, 'Al retirar la acreditación deja de tener permiso en la conexión');
    assert.match((await admin.action({ type: 'presencial-reset', admin: true }, true)).message, /organizador/);
    const reconnect = await connect(id); sockets.push(reconnect.ws);
    assert.equal(reconnect.state.host, false, 'No hereda permisos de una conexión anterior');
  } finally {
    for (const ws of sockets) ws.close();
    if (id) await post(`/api/tournaments/${id}/delete`, { hostToken });
    for (const user of [creator.user, other.user]) await post('/api/cuentas/admin/borrar', { id: user.id }, ADMIN);
  }
});

test('solo el creador o el administrador editan y borran torneos online, también desde otro dispositivo', { timeout: 60000 }, async () => {
  const creator = await organizerSession(BASE, ORIGIN), other = await organizerSession(BASE, ORIGIN);
  const created = [], sockets = [];
  const fields = { title: 'Torneo online con permisos', format: 'swiss', minutes: 3, increment: 2, rounds: 3, capacity: 8 };
  try {
    const hostToken = token(), response = await post('/api/tournaments', { ...fields, hostToken }, creator.session);
    assert.equal(response.status, 201); const { id } = await response.json(); created.push({ id, hostToken });
    const path = `/api/tournaments/${id}`;
    const listing = async (auth = '', extra = {}) => (await (await fetch(BASE + '/api/tournaments', { headers: { Origin: ORIGIN, ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...extra } })).json()).tournaments.find(t => t.id === id);
    assert.equal((await listing(creator.session)).mine, true);
    assert.equal((await listing(other.session)).mine, false);
    assert.equal((await listing('', { 'X-Account-Id': creator.user.id })).mine, false, 'No se confía en una identidad enviada en cabeceras');
    for (const auth of ['', other.session]) {
      const forged = { ...fields, title: 'Cambio ajeno', admin: true, actorId: creator.user.id, hostAccountId: creator.user.id };
      assert.equal((await post(path + '/config', forged, auth)).status, 403);
      assert.equal((await post(path + '/edit', forged, auth)).status, 403);
      assert.equal((await post(path + '/delete', forged, auth)).status, 403);
    }
    assert.equal((await post(path + '/config', {}, creator.session)).status, 200);
    assert.equal((await post(path + '/edit', { ...fields, title: 'Modificado por el creador' }, creator.session)).status, 200);
    assert.equal((await post(path + '/config', {}, ADMIN)).status, 200);
    assert.equal((await post(path + '/edit', { ...fields, title: 'Modificado por el administrador' }, ADMIN)).status, 200);
    const owner = await connect(id, { session: creator.session }); sockets.push(owner.ws); assert.equal(owner.state.host, true);
    const admin = await connect(id, { adminKey: ADMIN }); sockets.push(admin.ws); assert.equal(admin.state.host, true);
    const outsider = await connect(id, { session: other.session, host: true, admin: true }); sockets.push(outsider.ws); assert.equal(outsider.state.host, false);
    assert.equal((await post(path + '/delete', {}, creator.session)).status, 200, 'El creador borra con su cuenta sin el token del dispositivo original');
    const hostToken2 = token(), another = await post('/api/tournaments', { ...fields, hostToken: hostToken2 }, creator.session);
    assert.equal(another.status, 201); const { id: id2 } = await another.json(); created.push({ id: id2, hostToken: hostToken2 });
    assert.equal((await post(`/api/tournaments/${id2}/delete`, {}, ADMIN)).status, 200);
  } finally {
    for (const ws of sockets) ws.close();
    for (const { id, hostToken } of created) await post(`/api/tournaments/${id}/delete`, { hostToken });
    for (const user of [creator.user, other.user]) await post('/api/cuentas/admin/borrar', { id: user.id }, ADMIN);
  }
});
