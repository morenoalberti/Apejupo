import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const TARGET = 'https://apejupo-torneos.chessrival-worker.workers.dev';
const ORIGINS = ['https://apejupo.com', 'https://www.apejupo.com'];
const allowedPath = path => /^\/api\/(?:tournaments|cuentas|retos)(?:\/|$)/.test(path) || /^\/t\/[a-f0-9]{24}$/.test(path);
const hopHeaders = new Set(['host', 'connection', 'upgrade', 'keep-alive', 'transfer-encoding', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']);
const reject = (socket, status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
const routeFor = raw => { try { return new URL(raw, 'http://gateway'); } catch { return null; } };

// La única autoridad de cuentas, permisos y torneos sigue siendo el Worker original.
// No se guardan datos ni credenciales y el visitante no puede elegir el destino.
export function createGateway({ target = TARGET, origins = ORIGINS, timeout = 15000 } = {}) {
  const upstream = new URL(target), allowedOrigins = new Set(origins);
  const transport = upstream.protocol === 'https:' ? https : http;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 24576, perMessageDeflate: false });
  const permitted = req => !req.headers.origin || allowedOrigins.has(req.headers.origin);
  const server = http.createServer((req, res) => {
    const route = routeFor(req.url);
    if (!route) { res.writeHead(400).end(); return; }
    const path = route.pathname;
    if (path === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"ok":true}'); return;
    }
    if (!permitted(req)) { res.writeHead(403).end(); return; }
    if (!allowedPath(path)) { res.writeHead(404).end(); return; }
    if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) { res.writeHead(405).end(); return; }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !hopHeaders.has(key) && !key.startsWith('cf-') && !key.startsWith('x-forwarded-')));
    const forwarded = transport.request(new URL(path + route.search, upstream), { method: req.method, headers, timeout }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
      response.on('error', () => res.destroy());
    });
    forwarded.on('timeout', () => forwarded.destroy(new Error('upstream timeout')));
    forwarded.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(req.headers.origin ? { 'Access-Control-Allow-Origin': req.headers.origin, Vary: 'Origin' } : {}) });
      res.end('{"error":"No se pudo conectar con el servidor de torneos. Vuelve a intentarlo en unos momentos."}');
    });
    req.on('aborted', () => forwarded.destroy());
    res.on('close', () => { if (!res.writableFinished) forwarded.destroy(); });
    req.pipe(forwarded);
  });

  server.on('upgrade', (req, socket, head) => {
    const route = routeFor(req.url);
    if (!route) { reject(socket, '400 Bad Request'); return; }
    const path = route.pathname;
    // Los sockets del juego y los retos se abren únicamente desde la web del club.
    if (!req.headers.origin || !permitted(req)) { reject(socket, '403 Forbidden'); return; }
    if (!/^\/api\/(?:retos\/socket|tournaments\/[a-f0-9]{24}\/socket)$/.test(path)) { reject(socket, '404 Not Found'); return; }
    const destination = new URL(path + route.search, upstream);
    destination.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
    const remote = new WebSocket(destination, { origin: req.headers.origin, handshakeTimeout: timeout, perMessageDeflate: false, maxPayload: 2 * 1024 * 1024 });
    let upgraded = false;
    const abort = () => { if ([WebSocket.CONNECTING, WebSocket.OPEN].includes(remote.readyState)) remote.terminate(); };
    socket.once('close', abort);
    remote.once('open', () => {
      if (socket.destroyed) { remote.close(); return; }
      sockets.handleUpgrade(req, socket, head, client => {
        upgraded = true;
        const send = (to, data, binary) => {
          if (to.readyState !== WebSocket.OPEN) return;
          if (to.bufferedAmount > 2 * 1024 * 1024) { to.close(1013, 'Reconecta para continuar.'); return; }
          to.send(data, { binary }, error => { if (error) to.terminate(); });
        };
        client.on('message', (data, binary) => send(remote, data, binary));
        remote.on('message', (data, binary) => send(client, data, binary));
        const close = (to, code, reason) => {
          if (to.readyState === WebSocket.OPEN) to.close(code >= 1000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011, reason);
        };
        client.on('close', (code, reason) => close(remote, code, reason));
        remote.on('close', (code, reason) => close(client, code, reason));
        client.on('error', () => remote.terminate());
        remote.on('error', () => client.terminate());
      });
    });
    remote.once('unexpected-response', (_, response) => { response.resume(); reject(socket, `${response.statusCode} Rejected`); });
    remote.on('error', () => { if (!upgraded && !socket.destroyed) reject(socket, '502 Bad Gateway'); });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGateway();
  server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('Conexión Apejupo preparada.'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); setTimeout(() => process.exit(0), 5000).unref(); });
}
