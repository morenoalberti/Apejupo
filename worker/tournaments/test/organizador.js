import { randomBytes } from 'node:crypto';

// Como en Lichess, organizar torneos pide una cuenta con el correo confirmado. Las pruebas crean una
// cuenta de organizador nueva (con CUENTAS_DESARROLLO="1" el enlace del correo llega en la respuesta).
export async function organizerSession(base = 'http://127.0.0.1:8789', origin = 'http://127.0.0.1:8087') {
  const post = (path, data) => fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
  const tail = randomBytes(4).toString('hex');
  const r = await post('/api/cuentas/registro', { nick: 'Org_' + tail, email: `org.${tail}@example.com`, password: 'clave-segura-1' });
  if (!r.enlace) throw new Error('No se pudo crear la cuenta de organizador: ' + JSON.stringify(r));
  await post('/api/cuentas/confirmar', { token: new URL(r.enlace).searchParams.get('confirmar') });
  return { session: r.session, user: { ...r.user, verified: true } };
}
