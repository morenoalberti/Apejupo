import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { organizerSession } from './organizador.js';

// Datos de la tarjeta de cada torneo en la lista: inscritos (con la foto de la cuenta si la tiene),
// «Estás inscrito» para la cuenta que mira, y nada de identificadores internos sueltos.
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
const lobby = async session => (await (await fetch(BASE + '/api/tournaments', { headers: { Origin: ORIGIN, ...(session ? { Authorization: 'Bearer ' + session } : {}) } })).json()).tournaments;

test('tarjeta del torneo: inscritos con foto, «Estás inscrito» y sin identificadores sueltos', { timeout: 60000 }, async () => {
  assert.ok(ADMIN, 'Falta CUENTAS_ADMIN en .dev.vars');
  const org = await organizerSession(BASE, ORIGIN), withPhoto = await organizerSession(BASE, ORIGIN), noPhoto = await organizerSession(BASE, ORIGIN);
  let id = null;
  try {
    // Una foto mínima: el servidor solo acepta JPEG (empieza por FF D8 FF).
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(200), 0xff, 0xd9]);
    const up = await fetch(BASE + '/api/cuentas/foto', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'image/jpeg', Authorization: 'Bearer ' + withPhoto.session }, body: jpeg });
    assert.equal(up.status, 200);
    const r = await call('/api/tournaments', { title: 'Tarjeta con fotos', minutes: 3, increment: 2, rounds: 3, capacity: 8, hostToken: token() }, org.session);
    assert.equal(r.status, 201); id = r.body.id;
    for (const p of [withPhoto, noPhoto]) assert.equal((await call(`/api/tournaments/${id}/join`, { token: token() }, p.session)).status, 201);

    const seen = (await lobby(withPhoto.session)).find(t => t.id === id);
    assert.equal(seen.faces.length, 2);
    const [a, b] = seen.faces;
    assert.equal(a.name, withPhoto.user.nick); assert.match(a.photo, new RegExp(`^${withPhoto.user.id}\\?v=\\d+$`));
    assert.equal(b.name, noPhoto.user.nick); assert.equal(b.photo, null);
    assert.ok(seen.faces.every(f => !('acc' in f)), 'El identificador de la cuenta no sale suelto');
    assert.ok(seen.faces.every(f => f.fid === null), 'Sin número FIDE no hay foto FIDE que buscar');
    assert.equal(seen.joined, true);
    assert.equal((await lobby(org.session)).find(t => t.id === id).joined, false, 'El organizador no está inscrito');
    assert.equal((await lobby('')).find(t => t.id === id).joined, false, 'Sin sesión no hay «Estás inscrito»');
    assert.deepEqual(seen.top, [], 'Sin partidas jugadas no hay líder');
  } finally {
    if (id) await call(`/api/tournaments/${id}/delete`, {}, ADMIN);
    for (const u of [org, withPhoto, noPhoto]) await call('/api/cuentas/admin/borrar', { id: u.user.id }, ADMIN);
  }
});
