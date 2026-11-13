import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

// Necesita el servidor local (npm run dev) con CUENTAS_DESARROLLO="1" en .dev.vars, que devuelve
// en la respuesta el enlace que en producción viajaría por correo.
const BASE = 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
const key = vars.match(/^TORNEOS_CLAVE\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const token = () => randomBytes(32).toString('hex');
const tail = randomBytes(3).toString('hex');
async function call(path, data = {}, session = '') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const linkToken = link => new URL(link).searchParams.values().next().value;

test('cuentas: registro, confirmación, entrada, torneo, recuperación y borrado', { timeout: 60000 }, async () => {
  const nick = 'Prueba_' + tail, email = `prueba.${tail}@example.com`, password = 'clave-segura-1';
  // Validaciones del registro.
  assert.equal((await call('/api/cuentas/registro', { nick: '1malo', email, password })).status, 400);
  assert.equal((await call('/api/cuentas/registro', { nick, email: 'no-es-correo', password })).status, 400);
  assert.equal((await call('/api/cuentas/registro', { nick, email, password: 'corta' })).status, 400);
  assert.equal((await call('/api/cuentas/registro', { nick: 'Admin', email, password })).status, 400);
  const created = await call('/api/cuentas/registro', { nick, email, password });
  assert.equal(created.status, 201); assert.match(created.body.enlace, /cuenta\.html\?confirmar=[a-f0-9]{64}$/);
  assert.equal((await call('/api/cuentas/registro', { nick: nick.toUpperCase(), email: 'otro' + email, password })).status, 409);
  assert.equal((await call('/api/cuentas/registro', { nick: nick + 'x', email: email.toUpperCase(), password })).status, 409);
  // Sin confirmar no se entra; un enlace falso no vale; el bueno, una sola vez.
  assert.equal((await call('/api/cuentas/entrar', { login: nick, password })).status, 403);
  assert.equal((await call('/api/cuentas/confirmar', { token: token() })).status, 400);
  const confirmToken = linkToken(created.body.enlace);
  assert.equal((await call('/api/cuentas/confirmar', { token: confirmToken })).body.nick, nick);
  assert.equal((await call('/api/cuentas/confirmar', { token: confirmToken })).status, 400);
  // Entrar: por nick (sin distinguir mayúsculas) o por correo; la contraseña mala no dice si la cuenta existe.
  const wrong = await call('/api/cuentas/entrar', { login: nick, password: 'otra-clave-123' });
  const ghost = await call('/api/cuentas/entrar', { login: 'NoExiste' + tail, password: 'otra-clave-123' });
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.body, ghost.body);
  const login = await call('/api/cuentas/entrar', { login: nick.toLowerCase(), password });
  assert.equal(login.status, 200); assert.equal(login.body.user.nick, nick); assert.ok(!('pass' in login.body.user));
  const session = login.body.session;
  assert.equal((await call('/api/cuentas/entrar', { login: email, password })).status, 200);
  assert.equal((await call('/api/cuentas/yo', {}, session)).body.user.email, email);
  assert.equal((await call('/api/cuentas/yo', {}, token())).status, 401);

  // Torneo: con sesión se inscribe con su nick; sin sesión nadie puede usar ese nick como alias.
  const hostToken = token();
  const t = await fetch(BASE + '/api/tournaments', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ title: 'Prueba de cuentas', minutes: 5, increment: 3, rounds: 3, capacity: 8, hostToken }) });
  const { id } = await t.json();
  try {
    assert.equal((await call(`/api/tournaments/${id}/join`, { name: nick.toLowerCase(), token: token() })).status, 409);
    const first = await call(`/api/tournaments/${id}/join`, { name: 'lo que sea', token: token() }, session);
    assert.equal(first.status, 201);
    // El mismo jugador desde otro dispositivo recupera su plaza, no ocupa otra.
    const again = await call(`/api/tournaments/${id}/join`, { name: 'otro', token: token() }, session);
    assert.equal(again.body.playerId, first.body.playerId);
    const room = await (await fetch(`${BASE}/api/tournaments/${id}`, { headers: { Origin: ORIGIN } })).json();
    const me = room.standings.find(p => p.id === first.body.playerId);
    assert.equal(me.name, nick); assert.equal(me.registered, true); assert.equal(room.count, 1);
    assert.equal((await call(`/api/tournaments/${id}/join`, { name: 'Invitado ' + tail, token: token() })).status, 201);
  } finally {
    await call(`/api/tournaments/${id}/delete`, { hostToken });
  }

  // Recuperar: misma respuesta exista o no el correo; la nueva contraseña cierra las sesiones.
  const unknown = await call('/api/cuentas/recuperar', { email: 'nadie.' + tail + '@example.com' });
  const known = await call('/api/cuentas/recuperar', { email });
  assert.equal(unknown.status, 200); assert.equal(known.status, 200); assert.ok(known.body.enlace);
  assert.equal((await call('/api/cuentas/restablecer', { token: linkToken(known.body.enlace), password: 'corta' })).status, 400);
  const fresh = await call('/api/cuentas/recuperar', { email });
  assert.equal((await call('/api/cuentas/restablecer', { token: linkToken(fresh.body.enlace), password: 'clave-nueva-22' })).status, 200);
  assert.equal((await call('/api/cuentas/yo', {}, session)).status, 401);
  assert.equal((await call('/api/cuentas/entrar', { login: nick, password })).status, 401);
  const second = (await call('/api/cuentas/entrar', { login: nick, password: 'clave-nueva-22' })).body.session;

  // Salir y borrar la cuenta (pide la contraseña).
  assert.equal((await call('/api/cuentas/borrar', { password: 'mala-clave-999' }, second)).status, 403);
  assert.equal((await call('/api/cuentas/borrar', { password: 'clave-nueva-22' }, second)).status, 200);
  assert.equal((await call('/api/cuentas/entrar', { login: nick, password: 'clave-nueva-22' })).status, 401);
  assert.equal((await call('/api/cuentas/registro', { nick, email, password })).status, 201);
  const relogin = await call('/api/cuentas/reenviar', { login: email });
  assert.ok(relogin.body.enlace);
  await call('/api/cuentas/confirmar', { token: linkToken(relogin.body.enlace) });
  const last = (await call('/api/cuentas/entrar', { login: nick, password })).body.session;
  assert.equal((await call('/api/cuentas/salir', {}, last)).status, 200);
  assert.equal((await call('/api/cuentas/yo', {}, last)).status, 401);
  const clean = (await call('/api/cuentas/entrar', { login: nick, password })).body.session;
  await call('/api/cuentas/borrar', { password }, clean);
});
