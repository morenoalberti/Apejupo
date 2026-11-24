import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { organizerSession } from './organizador.js';

// «Borrar torneos finalizados» del administrador: solo desaparecen los terminados o cancelados;
// los que están por empezar o en juego se quedan, pase lo que pase en la página.
// Necesita el servidor local (npm run dev) con CUENTAS_ADMIN y CUENTAS_DESARROLLO="1" en .dev.vars.
const BASE = process.env.CUENTAS_BASE || 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const ADMIN = vars.match(/^CUENTAS_ADMIN\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const token = () => randomBytes(32).toString('hex');
async function call(path, data = {}, auth = '') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function room(id, hello) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/tournaments/${id}/socket`, { origin: ORIGIN });
  let state = null; const waiters = [];
  ws.on('message', raw => {
    const s = JSON.parse(String(raw)); if (s.type !== 'state') return; state = s;
    for (const w of [...waiters]) if (w.p(s)) { waiters.splice(waiters.indexOf(w), 1); w.r(s); }
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'hello', ...hello }));
  const wait = p => state && p(state) ? Promise.resolve(state) : new Promise((r, j) => { const t = setTimeout(() => j(new Error('No llegó el estado esperado.')), 8000); waiters.push({ p, r: s => { clearTimeout(t); r(s); } }); });
  return { ws, wait };
}

test('borrar torneos finalizados: solo terminados o cancelados, nunca los por empezar o en juego', { timeout: 90000 }, async () => {
  assert.ok(ADMIN, 'Falta CUENTAS_ADMIN en .dev.vars');
  const org = await organizerSession(BASE, ORIGIN), p1 = await organizerSession(BASE, ORIGIN), p2 = await organizerSession(BASE, ORIGIN);
  const made = {}, sockets = [];
  try {
    for (const kind of ['waiting', 'playing', 'cancelled']) {
      const hostToken = token();
      const r = await call('/api/tournaments', { title: `Borrar finalizados ${kind}`, minutes: 3, increment: 2, rounds: 1, capacity: 4, hostToken }, org.session);
      assert.equal(r.status, 201); made[kind] = { id: r.body.id, hostToken };
      const host = await room(r.body.id, { hostToken, session: org.session }); sockets.push(host.ws);
      await host.wait(s => s.host);
      if (kind === 'playing') {
        for (const p of [p1, p2]) assert.equal((await call(`/api/tournaments/${r.body.id}/join`, { token: token() }, p.session)).status, 201);
        host.ws.send(JSON.stringify({ type: 'start' }));
        await host.wait(s => s.status === 'playing');
      }
      if (kind === 'cancelled') { host.ws.send(JSON.stringify({ type: 'cancel' })); await host.wait(s => s.status === 'cancelled'); }
    }
    const path = '/api/tournaments/admin/borrar-finalizados';
    // Sin clave, con una mala o con la sesión de un jugador: nada.
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, {}, 'clave-incorrecta-de-prueba')).status, 401);
    assert.equal((await call(path, {}, p1.session)).status, 401);
    const done = await call(path, {}, ADMIN);
    assert.equal(done.status, 200); assert.ok(done.body.deleted >= 1); assert.ok(done.body.kept >= 2);
    assert.equal((await fetch(`${BASE}/api/tournaments/${made.cancelled.id}`)).status, 404, 'El cancelado se borra');
    for (const kind of ['waiting', 'playing']) assert.equal((await fetch(`${BASE}/api/tournaments/${made[kind].id}`)).status, 200, `El torneo ${kind} se queda`);
    const ids = (await (await fetch(BASE + '/api/tournaments')).json()).tournaments.map(t => t.id);
    assert.ok(ids.includes(made.waiting.id) && ids.includes(made.playing.id) && !ids.includes(made.cancelled.id));
    // El borrado de uno en uno (papelera) sigue funcionando para el administrador, también en juego.
    assert.equal((await call(`/api/tournaments/${made.playing.id}/delete`, {}, ADMIN)).status, 200);
  } finally {
    for (const ws of sockets) ws.close();
    for (const { id, hostToken } of Object.values(made)) await call(`/api/tournaments/${id}/delete`, { hostToken });
    for (const u of [org, p1, p2]) await call('/api/cuentas/admin/borrar', { id: u.user.id }, ADMIN);
  }
});
