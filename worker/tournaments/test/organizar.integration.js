import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

// Como en Lichess: organiza cualquier cuenta confirmada, y su torneo queda unido a la cuenta.
const BASE = 'http://127.0.0.1:8789', ORIGIN = 'http://127.0.0.1:8087';
const token = () => randomBytes(32).toString('hex');
const create = (session, title = 'Torneo de una cuenta') => fetch(BASE + '/api/tournaments', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) },
  body: JSON.stringify({ title, minutes: 3, increment: 2, rounds: 1, capacity: 4, hostToken: token() }) });
function hello(id, message) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/tournaments/${id}/socket`, { headers: { Origin: ORIGIN } }), seen = [];
  return new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', ...message })));
    ws.on('message', d => { const m = JSON.parse(String(d)); seen.push(m); if (m.type === 'state' && seen.filter(x => x.type === 'state').length >= 2) { ws.close(); resolve(seen); } });
    ws.on('error', reject); setTimeout(() => { ws.close(); resolve(seen); }, 3000);
  });
}

test('organizar: con cuenta confirmada; el organizador recupera los controles en otro dispositivo', { timeout: 60000 }, async () => {
  assert.equal((await create('')).status, 401);
  const reg = await (await fetch(BASE + '/api/cuentas/registro', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ nick: 'SinConf_' + randomBytes(3).toString('hex'), email: `sc.${randomBytes(3).toString('hex')}@example.com`, password: 'clave-segura-1' }) })).json();
  assert.equal((await create(reg.session)).status, 403, 'sin confirmar el correo no se organiza');

  const owner = await organizerSession(), other = await organizerSession();
  const res = await create(owner.session); assert.equal(res.status, 201);
  const { id } = await res.json();
  // Otro dispositivo del organizador: sin credencial de organizador, pero con su sesión.
  const mine = await hello(id, { session: owner.session });
  const fresh = mine.find(m => m.type === 'host-token');
  assert.match(fresh?.token || '', /^[a-f0-9]{64}$/);
  assert.equal(mine.filter(m => m.type === 'state').at(-1).host, true);
  // Con esa credencial puede editar el torneo.
  const edit = await fetch(`${BASE}/api/tournaments/${id}/config`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ hostToken: fresh.token }) });
  assert.equal(edit.status, 200);
  // Otra cuenta no recibe nada.
  const theirs = await hello(id, { session: other.session });
  assert.equal(theirs.some(m => m.type === 'host-token'), false);
  assert.equal(theirs.filter(m => m.type === 'state').at(-1).host, false);
  // Límite: 5 torneos por cuenta cada 24 horas.
  for (let i = 0; i < 4; i++) assert.equal((await create(owner.session, 'Torneo extra ' + i)).status, 201);
  assert.equal((await create(owner.session, 'Uno de más')).status, 429);
});
