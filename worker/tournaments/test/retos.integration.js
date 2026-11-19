import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

// Necesita el servidor local (npm run dev) con CUENTAS_DESARROLLO="1".
const BASE = process.env.CUENTAS_BASE || 'http://127.0.0.1:8789';
const WS_BASE = BASE.replace(/^http/, 'ws');
const ORIGIN = 'http://127.0.0.1:8087';
const tail = randomBytes(3).toString('hex');

async function call(path, data = {}, session = '') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session } : {}) }, body: JSON.stringify(data) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function account(nick, confirm = true) {
  const r = await call('/api/cuentas/registro', { nick, email: `${nick.toLowerCase()}@example.com`, password: 'clave-segura-1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (confirm) assert.equal((await call('/api/cuentas/confirmar', { token: new URL(r.body.enlace).searchParams.get('confirmar') })).status, 200);
  return r.body;
}
// Cliente de prueba: guarda los mensajes y permite esperar uno de un tipo concreto.
function client(path, hello) {
  const ws = new WebSocket(WS_BASE + path, { headers: { Origin: ORIGIN } }), inbox = [], waiters = [];
  ws.on('message', data => {
    const m = JSON.parse(String(data)); inbox.push(m);
    for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const next = (test, ms = 8000) => {
    const found = inbox.find(test); if (found) { inbox.splice(inbox.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { test: m => { if (!test(m)) return false; inbox.splice(inbox.indexOf(m), 1); return true; }, resolve };
      waiters.push(w); setTimeout(() => reject(new Error('No llegó el mensaje esperado. Recibidos: ' + JSON.stringify(inbox))), ms);
    });
  };
  const opened = new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); }).then(() => { if (hello) ws.send(JSON.stringify(hello)); });
  return { ws, next, opened, send: m => ws.send(JSON.stringify(m)), close: () => ws.close() };
}

test('retos: solo a jugadores en línea; al aceptar, los dos reciben el tablero y la partida empieza', { timeout: 60000 }, async () => {
  const a = await account('RetaA' + tail), b = await account('RetaB' + tail), c = await account('RetaC' + tail, false);
  const A = client('/api/retos/socket', { type: 'hello', session: a.session }); await A.opened;
  assert.equal((await A.next(m => m.type === 'hola')).nick, a.user.nick);
  // Sin confirmar el correo no se entra en los retos.
  const C = client('/api/retos/socket', { type: 'hello', session: c.session }); await C.opened;
  assert.equal((await C.next(m => m.type === 'sin-sesion')).unverified, true); C.close();

  // B todavía no está conectado: no se le puede retar.
  A.send({ type: 'retar', nick: b.user.nick, minutes: 3, increment: 2, color: 'b' });
  assert.match((await A.next(m => m.type === 'error')).message, /no está conectado/);
  A.send({ type: 'retar', nick: a.user.nick, minutes: 3, increment: 2, color: 'b' });
  assert.match((await A.next(m => m.type === 'error')).message, /ti mismo/);

  const B = client('/api/retos/socket', { type: 'hello', session: b.session }); await B.opened;
  await B.next(m => m.type === 'hola');
  A.send({ type: 'conectados' });
  const directory = await A.next(m => m.type === 'conectados');
  assert.ok(!directory.nicks.includes(b.user.nick), 'Las cuentas de prueba no se muestran como rivales aunque estén conectadas.');
  assert.ok(!directory.jugadores.includes(b.user.nick));
  A.send({ type: 'retar', nick: b.user.nick, minutes: 7, increment: 2, color: 'b' });
  assert.match((await A.next(m => m.type === 'error')).message, /ritmo/);

  // Reto rechazado.
  A.send({ type: 'retar', nick: b.user.nick.toLowerCase(), minutes: 3, increment: 2, color: 'b' });
  const r1 = (await B.next(m => m.type === 'reto')).reto;
  assert.equal(r1.from, a.user.nick); assert.equal(r1.color, 'b');
  await A.next(m => m.type === 'enviado');
  B.send({ type: 'rechazar', id: r1.id });
  assert.equal((await A.next(m => m.type === 'rechazado')).nick, b.user.nick);

  // Reto aceptado: A juega con negras.
  A.send({ type: 'retar', nick: b.user.nick, minutes: 3, increment: 2, color: 'b' });
  const r2 = (await B.next(m => m.type === 'reto')).reto;
  B.send({ type: 'aceptar', id: r2.id });
  const [sa, sb] = await Promise.all([A.next(m => m.type === 'empezar'), B.next(m => m.type === 'empezar')]);
  assert.equal(sa.id, sb.id); assert.notEqual(sa.token, sb.token);
  assert.equal(sa.rival, b.user.nick); assert.equal(sb.rival, a.user.nick);
  A.close(); B.close();

  // Los dos abren el tablero con su credencial: la partida empieza sola y con los colores pedidos.
  const RA = client(`/api/tournaments/${sa.id}/socket`, { type: 'hello', token: sa.token });
  await RA.opened;
  const first = await RA.next(m => m.type === 'state' && !!m.me);
  assert.equal(first.status, 'waiting'); assert.equal(first.challenge, true);
  const RB = client(`/api/tournaments/${sb.id}/socket`, { type: 'hello', token: sb.token });
  await RB.opened;
  const playing = await RB.next(m => m.type === 'state' && m.status === 'playing');
  const game = playing.game;
  assert.equal(game.white, playing.me, 'B (retado) juega con blancas');
  assert.equal(playing.standings.find(p => p.id === game.black).name, a.user.nick);
  assert.equal(playing.minutes, 3); assert.equal(playing.increment, 2);
  // A abandona; la partida (y el reto) terminan.
  RA.send({ type: 'resign', game: game.id });
  const over = await RB.next(m => m.type === 'state' && m.status === 'finished');
  assert.equal(over.games[0].result, '1-0');
  // El marcador entre los dos queda guardado: 1 victoria de B (blancas), 0 de A.
  assert.equal(over.duel.wins[game.white], 1); assert.equal(over.duel.wins[game.black], 0); assert.equal(over.duel.draws, 0);
  RA.close(); RB.close();

  // Revancha: A la pide desde el tablero; B la recibe marcada como revancha y con los colores cambiados.
  const A2 = client('/api/retos/socket', { type: 'hello', session: a.session }); await A2.opened; await A2.next(m => m.type === 'hola');
  const B2 = client('/api/retos/socket', { type: 'hello', session: b.session }); await B2.opened; await B2.next(m => m.type === 'hola');
  A2.send({ type: 'retar', nick: b.user.nick, minutes: 3, increment: 2, color: 'w', revancha: true });
  const r3 = (await B2.next(m => m.type === 'reto')).reto;
  assert.equal(r3.revancha, true); assert.equal(r3.color, 'w');
  B2.send({ type: 'aceptar', id: r3.id });
  const [ra, rb] = await Promise.all([A2.next(m => m.type === 'empezar'), B2.next(m => m.type === 'empezar')]);
  assert.notEqual(ra.id, sa.id);
  A2.close(); B2.close();
  const QA = client(`/api/tournaments/${ra.id}/socket`, { type: 'hello', token: ra.token }); await QA.opened;
  const QB = client(`/api/tournaments/${rb.id}/socket`, { type: 'hello', token: rb.token }); await QB.opened;
  const second = await QA.next(m => m.type === 'state' && m.status === 'playing');
  assert.equal(second.game.white, second.me, 'en la revancha A juega con blancas');
  assert.match(second.title, /^Revancha:/);
  // La revancha arranca con el marcador acumulado: A (ahora blancas) 0, B 1.
  assert.equal(second.duel.wins[second.game.white], 0); assert.equal(second.duel.wins[second.game.black], 1);
  QA.close(); QB.close();

  for (const u of [a, b, c]) await call('/api/cuentas/borrar', { password: 'clave-segura-1' }, u.session);
});
