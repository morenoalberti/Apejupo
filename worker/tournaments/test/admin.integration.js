import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// Necesita el servidor local con CUENTAS_DESARROLLO="1" y CUENTAS_ADMIN en .dev.vars.
// BASE se puede cambiar con la variable de entorno CUENTAS_BASE (p. ej. otra instancia de prueba).
const BASE = process.env.CUENTAS_BASE || 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const ADMIN = vars.match(/^CUENTAS_ADMIN\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const tail = randomBytes(3).toString('hex');
async function call(path, data = {}, auth = '') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const list = async () => (await call('/api/cuentas/admin/lista', {}, ADMIN)).body.users;

test('administración de cuentas: lista, confirmar, reenviar y borrar con la clave', { timeout: 60000 }, async () => {
  assert.ok(ADMIN, 'Falta CUENTAS_ADMIN en .dev.vars');
  // Sin clave o con una mala no se ve nada.
  assert.equal((await call('/api/cuentas/admin/lista')).status, 401);
  assert.equal((await call('/api/cuentas/admin/lista', {}, ADMIN + 'x')).status, 401);
  assert.equal((await fetch(BASE + '/api/cuentas/admin/lista', { headers: { Origin: ORIGIN } })).status, 405);

  const nick = 'Admin_prueba_' + tail.slice(0, 4), email = `admin.${tail}@example.com`;
  const created = await call('/api/cuentas/registro', { nick, email, password: 'clave-segura-1' });
  assert.equal(created.status, 201);
  const id = created.body.user.id;

  let me = (await list()).find(u => u.id === id);
  assert.equal(me.nick, nick); assert.equal(me.email, email); assert.equal(me.verified, false);
  assert.ok(me.createdAt && me.lastSeen); assert.equal(me.sessions, 1);
  // Contador de días con visita: el alta cuenta como el primer día; volver el mismo día no suma otro.
  assert.equal(me.days, 1); assert.equal(me.days30, 1); assert.match(me.lastDay, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await call('/api/cuentas/yo', {}, created.body.session)).status, 200);
  assert.equal((await list()).find(u => u.id === id).days, 1);
  assert.ok(!('pass' in me));

  const resent = await call('/api/cuentas/admin/reenviar', { id }, ADMIN);
  assert.equal(resent.status, 200); assert.match(resent.body.enlace, /confirmar=[a-f0-9]{64}$/);
  assert.equal((await call('/api/cuentas/admin/confirmar', { id }, ADMIN)).status, 200);
  assert.equal((await list()).find(u => u.id === id).verified, true);
  assert.equal((await call('/api/cuentas/admin/reenviar', { id }, ADMIN)).status, 409);
  // Acciones sin clave o sobre cuentas inexistentes.
  assert.equal((await call('/api/cuentas/admin/borrar', { id }, 'mala-clave-123456')).status, 401);
  assert.equal((await call('/api/cuentas/admin/borrar', { id: 'nohex' }, ADMIN)).status, 400);
  assert.equal((await call('/api/cuentas/admin/borrar', { id: '0'.repeat(24) }, ADMIN)).status, 404);

  assert.equal((await call('/api/cuentas/admin/borrar', { id }, ADMIN)).status, 200);
  assert.equal((await list()).some(u => u.id === id), false);
  // La sesión del usuario borrado ya no sirve.
  assert.equal((await call('/api/cuentas/yo', {}, created.body.session)).status, 401);
});
