import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createGateway } from '../server.js';

const origin = 'https://apejupo.com';
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('acceso alternativo: permisos, sesiones, listado, errores y conexión del juego', async t => {
  const backend = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (req.url === '/api/tournaments') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ tournaments: [{ title: 'Torneo conservado' }] })); return; }
    if (req.url === '/api/cuentas/yo' && req.headers.authorization !== 'Bearer sesion-valida') { res.writeHead(401).end('{"error":"Sin sesión"}'); return; }
    res.end(JSON.stringify({ body, authorization: req.headers.authorization, origin: req.headers.origin, clientClaim: req.headers['cf-connecting-ip'] || null }));
  });
  const game = new WebSocketServer({ server: backend });
  game.on('connection', ws => { ws.send('{"type":"state"}'); ws.on('message', (data, binary) => ws.send(data, { binary })); });
  const target = await listen(backend), gateway = createGateway({ target });
  const base = await listen(gateway);
  t.after(async () => { game.close(); await close(gateway); await close(backend); });

  await t.test('el listado y las cabeceras de caché y CORS llegan intactos', async () => {
    const response = await fetch(base + '/api/tournaments', { headers: { Origin: origin } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal((await response.json()).tournaments[0].title, 'Torneo conservado');
  });
  await t.test('no concede sesiones ni elimina las comprobaciones del servidor', async () => {
    assert.equal((await fetch(base + '/api/cuentas/yo', { method: 'POST', body: '{}', headers: { Origin: origin } })).status, 401);
    const response = await fetch(base + '/api/cuentas/yo', { method: 'POST', body: '{"dato":1}', headers: { Origin: origin, Authorization: 'Bearer sesion-valida', 'Content-Type': 'application/json', 'CF-Connecting-IP': 'falsa' } });
    assert.deepEqual(await response.json(), { body: '{"dato":1}', authorization: 'Bearer sesion-valida', origin, clientClaim: null });
  });
  await t.test('no es un proxy abierto y rechaza otros sitios y métodos', async () => {
    assert.equal((await fetch(base + '/api/tournaments', { headers: { Origin: 'https://otro.example' } })).status, 403);
    assert.equal((await fetch(base + '/https://otro.example/')).status, 404);
    assert.equal((await fetch(base + '/api/tournaments', { method: 'DELETE' })).status, 405);
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/api/cuentas/yo', { method: 'OPTIONS', headers: { Origin: origin } })).status, 204);
    // Ni siquiera una petición HTTP con otra autoridad cambia el destino fijo.
    const response = await new Promise((resolve, reject) => {
      const request = http.request(new URL(base), { path: 'http://no-debe-contactarse.invalid/api/tournaments' }, res => {
        let body = ''; res.on('data', part => body += part); res.on('end', () => resolve({ status: res.statusCode, body }));
      }); request.on('error', reject); request.end();
    });
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).tournaments[0].title, 'Torneo conservado');
  });
  await t.test('las partidas conservan el estado inicial y los mensajes de texto', async () => {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/tournaments/' + 'a'.repeat(24) + '/socket', { origin });
    const initial = once(socket, 'message');
    await once(socket, 'open');
    const [state, binary] = await initial; assert.equal(binary, false); assert.equal(state.toString(), '{"type":"state"}');
    const echo = once(socket, 'message'); socket.send('{"type":"hello","session":"sesion-valida"}');
    const [message, asBinary] = await echo; assert.equal(asBinary, false); assert.match(message.toString(), /sesion-valida/);
    socket.close(1000); await once(socket, 'close');
  });
  await t.test('rechaza sockets de sitios ajenos antes de contactar con el juego', async () => {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/retos/socket', { origin: 'https://otro.example' });
    const status = await new Promise(resolve => { socket.on('unexpected-response', (_, response) => { response.resume(); resolve(response.statusCode); }); socket.on('error', () => {}); });
    assert.equal(status, 403); socket.terminate();
  });
  await t.test('un servidor inaccesible devuelve un error controlado sin credenciales', async () => {
    const stopped = http.createServer(); const unavailable = await listen(stopped); await close(stopped);
    const failed = createGateway({ target: unavailable }), failureBase = await listen(failed);
    try {
      const response = await fetch(failureBase + '/api/tournaments', { headers: { Origin: origin } });
      assert.equal(response.status, 502); assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.match((await response.json()).error, /servidor de torneos/);
    } finally { await close(failed); }
  });
});
