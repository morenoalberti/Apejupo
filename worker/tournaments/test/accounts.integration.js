import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { organizerSession } from './organizador.js';

// Necesita el servidor local (npm run dev) con CUENTAS_DESARROLLO="1" en .dev.vars, que devuelve
// en la respuesta el enlace que en producción viajaría por correo.
const BASE = 'http://127.0.0.1:8789';
const ORIGIN = 'http://127.0.0.1:8087';
const vars = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8');
// Organizar pide una cuenta confirmada: «key» es la sesión de un organizador de prueba.
const key = (await organizerSession()).session;
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
  // Al crear la cuenta ya se entra, pero sin confirmar el correo no se juega con ella.
  assert.match(created.body.session, /^[a-f0-9]{64}$/); assert.equal(created.body.user.verified, false);
  assert.equal((await call('/api/cuentas/yo', {}, created.body.session)).body.user.nick, nick);
  assert.equal((await call('/api/cuentas/registro', { nick: nick.toUpperCase(), email: 'otro' + email, password })).status, 409);
  assert.equal((await call('/api/cuentas/registro', { nick: nick + 'x', email: email.toUpperCase(), password })).status, 409);
  // Sin confirmar se puede entrar (verified: false); un enlace falso no vale; el bueno, una sola vez.
  assert.equal((await call('/api/cuentas/entrar', { login: nick, password })).body.user.verified, false);
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

  // Foto de perfil: solo JPEG pequeños, con sesión; se ve sin sesión y se puede quitar.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const upload = (data, s2 = session) => fetch(BASE + '/api/cuentas/foto', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + s2 }, body: data });
  assert.equal((await upload(jpeg, token())).status, 401);
  assert.equal((await upload(new TextEncoder().encode('<svg onload=alert(1)>'))).status, 400);
  assert.equal((await upload(new Uint8Array(70 * 1024).fill(0xff))).status, 413);
  const up = await upload(jpeg); assert.equal(up.status, 200);
  const me1 = (await up.json()).user; assert.ok(me1.photo);
  const pic = await fetch(`${BASE}/api/cuentas/foto/${me1.id}?v=${me1.photo}`, { headers: { Origin: ORIGIN } });
  assert.equal(pic.status, 200); assert.equal(pic.headers.get('content-type'), 'image/jpeg'); assert.equal((await pic.arrayBuffer()).byteLength, jpeg.length);
  assert.equal((await call('/api/cuentas/yo', {}, session)).body.user.photo, me1.photo);
  assert.equal((await call('/api/cuentas/foto-quitar', {}, session)).body.user.photo, null);
  assert.equal((await fetch(`${BASE}/api/cuentas/foto/${me1.id}`, { headers: { Origin: ORIGIN } })).status, 404);

  // Torneo: con sesión se inscribe con su nick; sin sesión nadie puede usar ese nick como alias.
  const hostToken = token();
  const t = await fetch(BASE + '/api/tournaments', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ title: 'Prueba de cuentas', minutes: 5, increment: 3, rounds: 3, capacity: 8, hostToken }) });
  const { id } = await t.json();
  try {
    // Con la cuenta sin confirmar no se puede jugar con ella.
    const pending = await call('/api/cuentas/registro', { nick: 'Pend_' + tail, email: `pend.${tail}@example.com`, password });
    const blocked = await call(`/api/tournaments/${id}/join`, { name: 'x', token: token() }, pending.body.session);
    assert.equal(blocked.status, 403); assert.match(blocked.body.error, /Confirma tu correo/);
    await call('/api/cuentas/borrar', { password }, pending.body.session);
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
