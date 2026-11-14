import { DurableObject } from 'cloudflare:workers';
export { AccountStore } from './accounts.js';
import bbpWasm from './bbp/bbp.wasm';
import { loadBbp, runDutch } from './bbp-engine.js';
import { GameError, requireThat, isArena, setSwissEngine, createTournament, editTournament, joinTournament, act, advance, pairArena, nextAlarm, snapshot, sharedSnapshot, personalPart, moveMessage, summary, exportPgn, RETENTION_MS } from './core.js';

// El navegador manda "ping" cada 30 s; sin señal en este margen, el jugador no se considera presente.
const PRESENCE_MS = 75000;
// El estado completo se manda como mucho una vez por este intervalo: si hay varios cambios seguidos
// (resultados, inscripciones, emparejamientos) se agrupan en un solo envío, como hace Lichess.
const BROADCAST_MS = 300;
// Jugadores, espectadores y pestañas de tableros conectados a la vez a un mismo torneo.
const MAX_SOCKETS = 400;
const keyRequired = env => env.TORNEOS_SIN_CLAVE !== '1';

const TOKEN = /^[a-f0-9]{64}$/;
const ROOM_ID = /^[a-f0-9]{24}$/;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const failure = error => json({ error: error instanceof GameError ? error.message : 'No se pudo completar la operación. Vuelve a intentarlo.' }, error.status || 500);
export async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(size = 12) { return [...crypto.getRandomValues(new Uint8Array(size))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function bearer(request) { return (request.headers.get('Authorization') || '').replace(/^Bearer /, ''); }
async function body(request) {
  requireThat(Number(request.headers.get('Content-Length') || 0) <= 4096, 'La petición es demasiado grande.', 413);
  const text = await request.text();
  requireThat(new TextEncoder().encode(text).length <= 4096, 'La petición es demasiado grande.', 413);
  try { const b = JSON.parse(text); requireThat(b && typeof b === 'object' && !Array.isArray(b), 'Datos no válidos.'); return b; }
  catch { throw new GameError('Datos no válidos.'); }
}

export class TournamentDirectory extends DurableObject {
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const url = new URL(request.url), now = Date.now();
        let events = (await this.ctx.storage.get('events') || []).filter(e => now - e.createdAt < RETENTION_MS);
        if (url.pathname === '/authorize') {
          // Solo para pruebas locales (.dev.vars). Sin esa variable, la clave es obligatoria.
          if (!keyRequired(this.env)) return json({ ok: true });
          requireThat(this.env.TORNEOS_CLAVE, 'La organización de torneos aún no está configurada.', 503);
          const { key, ip } = await body(request), rateKey = 'attempts:' + (await hash(String(ip || 'unknown'))).slice(0, 24);
          let rate = await this.ctx.storage.get(rateKey) || { count: 0, until: now + 900000 };
          if (rate.until <= now) rate = { count: 0, until: now + 900000 };
          requireThat(rate.count < 8, 'Demasiados intentos. Espera 15 minutos.', 429);
          const good = (await hash(String(key || ''))) === (await hash(this.env.TORNEOS_CLAVE));
          if (!good) {
            rate.count++; await this.ctx.storage.put(rateKey, rate);
            await this.ctx.storage.setAlarm(now + 900000);
            throw new GameError('La clave de organización no es correcta.', 403);
          }
          await this.ctx.storage.delete(rateKey);
          return json({ ok: true });
        }
        if (request.method === 'GET') {
          const results = await Promise.all(events.map(async e => {
            try {
              const r = await this.env.TOURNAMENTS.getByName(e.id).fetch('https://room/summary');
              return r.ok ? await r.json() : null;
            } catch { return null; }
          }));
          return json({ tournaments: results.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt), keyRequired: keyRequired(this.env) });
        }
        if (request.method === 'POST') {
          const b = await body(request);
          // En pruebas locales se puede subir con TORNEOS_MAX_MES en .dev.vars; publicado son 30.
          requireThat(events.length < (Number(this.env.TORNEOS_MAX_MES) || 30), 'Se ha alcanzado el límite de torneos de este mes. Contacta con la organización.', 429);
          requireThat(TOKEN.test(b.hostToken), 'Identificación del organizador no válida.');
          const id = randomHex(), hostHash = await hash(b.hostToken);
          const t = createTournament(b, id, hostHash, now);
          const res = await this.env.TOURNAMENTS.getByName(id).fetch('https://room/init', { method: 'POST', body: JSON.stringify(t) });
          requireThat(res.ok, 'No se pudo crear el torneo.', 503);
          events.push({ id, createdAt: now });
          await this.ctx.storage.put('events', events);
          return json({ id }, 201);
        }
        throw new GameError('No encontrado.', 404);
      } catch (error) { return failure(error); }
    });
  }
  async alarm() {
    const now = Date.now(), entries = await this.ctx.storage.list({ prefix: 'attempts:' });
    const expired = [...entries].filter(([, r]) => r.until <= now).map(([key]) => key);
    if (expired.length) await this.ctx.storage.delete(expired);
    const next = [...entries.values()].filter(r => r.until > now).map(r => r.until);
    if (next.length) await this.ctx.storage.setAlarm(Math.min(...next));
  }
}

export class TournamentRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.t = null;
    ctx.blockConcurrencyWhile(async () => {
      this.t = await ctx.storage.get('state') || null;
      // Motor FIDE del suizo: se carga una vez por sala; si falla, el suizo usa el emparejamiento de club.
      try { await loadBbp(bbpWasm); setSwissEngine(runDutch); } catch (error) { console.warn('bbpPairings no disponible:', error.message); }
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async save() {
    this.t.revision++;
    try {
      await this.ctx.storage.transaction(async storage => {
        await storage.put('state', this.t);
        await storage.setAlarm(Math.max(Date.now() + 1, nextAlarm(this.t)));
      });
    } catch (error) {
      // Nunca anunciar ni seguir usando una jugada que no se pudo guardar.
      try { this.t = await this.ctx.storage.get('state') || null; }
      catch { this.t = null; }
      if (!this.t) for (const ws of this.ctx.getWebSockets()) { try { ws.close(1011, 'No se pudo guardar la partida.'); } catch {} }
      throw error;
    }
  }
  capabilities(playerHash, hostHash) {
    return { playerId: this.t.players.find(p => p.hash === playerHash)?.id || null, host: !!hostHash && hostHash === this.t.hostHash };
  }
  send(ws) {
    const a = ws.deserializeAttachment() || {};
    const c = this.capabilities(a.playerHash, a.hostHash);
    ws.send(JSON.stringify(snapshot(this.t, c.playerId, c.host, a.game)));
  }
  broadcast() {
    if (this.flushTimer) return;
    const wait = (this.lastFlush || 0) + BROADCAST_MS - Date.now();
    if (wait <= 0) { this.flush(); return; }
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, wait);
  }
  // La parte común se calcula y se convierte a texto una sola vez; a cada conexión solo se le añade lo suyo.
  flush() {
    this.lastFlush = Date.now();
    if (!this.t) return;
    const shared = JSON.stringify(sharedSnapshot(this.t, this.lastFlush)).slice(0, -1), players = new Map(this.t.players.map(p => [p.hash, p.id])), details = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() || {};
        const host = !!a.hostHash && a.hostHash === this.t.hostHash, playerId = players.get(a.playerHash) || null;
        const key = `${playerId}|${host}|${a.game}`;
        let personal = details.get(key);
        if (!personal) { personal = JSON.stringify(personalPart(this.t, playerId, host, a.game)).slice(1); details.set(key, personal); }
        ws.send(shared + ',' + personal);
      } catch { try { ws.close(1011, 'Reconecta para recuperar la partida.'); } catch {} }
    }
  }
  sendMove(g) {
    const message = JSON.stringify(moveMessage(this.t, g));
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(message); } catch { try { ws.close(1011, 'Reconecta para recuperar la partida.'); } catch {} }
    }
  }
  // Jugadores con la página abierta: en el modo arena solo se empareja a quien está presente.
  online(now = Date.now()) {
    const ids = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() || {};
        if (!a.playerHash) continue;
        const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0;
        if (now - Math.max(ping, a.seenAt || 0) > PRESENCE_MS) continue;
        const id = this.t.players.find(p => p.hash === a.playerHash)?.id;
        if (id) ids.add(id);
      } catch {}
    }
    return ids;
  }
  // Solo el arena empareja sobre la marcha; en el suizo no hace falta repasar quién está conectado.
  pair(now = Date.now()) { return isArena(this.t) && this.t.status === 'playing' && pairArena(this.t, now, this.online(now)); }
  progress(now = Date.now()) {
    const advanced = advance(this.t, now);
    return this.pair(now) || advanced;
  }
  async checkTime() {
    requireThat(this.t, 'No se encuentra el torneo.', 404);
    requireThat(Date.now() < this.t.expiresAt, 'Este torneo ha caducado.', 410);
    if (this.progress()) { await this.save(); this.broadcast(); }
  }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const url = new URL(request.url);
        if (url.pathname === '/init' && request.method === 'POST') {
          requireThat(!this.t, 'Este torneo ya existe.', 409);
          this.t = await request.json(); await this.save(); return json({ ok: true });
        }
        await this.checkTime();
        if (url.pathname === '/summary') return json(summary(this.t));
        if (url.pathname === '/socket') {
          requireThat(request.headers.get('Upgrade')?.toLowerCase() === 'websocket', 'Se necesita una conexión WebSocket.', 426);
          requireThat(this.ctx.getWebSockets().length < MAX_SOCKETS, 'La sala está llena. Inténtalo más tarde.', 429);
          const pair = new WebSocketPair(), [client, server] = Object.values(pair);
          this.ctx.acceptWebSocket(server);
          server.serializeAttachment({ playerHash: null, hostHash: null, game: null, window: Date.now(), count: 0, seenAt: Date.now() });
          this.send(server);
          return new Response(null, { status: 101, webSocket: client });
        }
        if (url.pathname === '/pgn') {
          const text = exportPgn(this.t, url.searchParams.get('game'));
          return new Response(text, { headers: { 'Content-Type': 'application/x-chess-pgn; charset=utf-8', 'Content-Disposition': `attachment; filename="apejupo-${this.t.id}.pgn"`, 'Cache-Control': 'no-store' } });
        }
        if (request.method === 'GET') return json(snapshot(this.t, null, false, url.searchParams.get('game')));
        const b = await body(request);
        if (url.pathname === '/recover') {
          requireThat(TOKEN.test(b.hostToken), 'Identificación no válida.');
          this.t.hostHash = await hash(b.hostToken); await this.save(); this.broadcast(); return json({ ok: true });
        }
        if (url.pathname === '/config' || url.pathname === '/edit') {
          // Solo el organizador: /config devuelve los datos para rellenar el formulario; /edit los cambia.
          requireThat(TOKEN.test(b.hostToken) && (await hash(b.hostToken)) === this.t.hostHash, 'Solo el organizador puede editar el torneo.', 403);
          if (url.pathname === '/edit') { editTournament(this.t, b, Date.now()); await this.save(); this.broadcast(); }
          return json({ ...summary(this.t), joinKey: this.t.joinKey || '' });
        }
        if (url.pathname === '/delete') {
          // Solo el organizador. Se avisa a quien tenga la sala abierta y desaparece de la lista.
          requireThat(TOKEN.test(b.hostToken) && (await hash(b.hostToken)) === this.t.hostHash, 'Solo el organizador puede borrar el torneo.', 403);
          for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'El organizador ha borrado el torneo.'); } catch {} }
          await this.ctx.storage.deleteAll(); this.t = null;
          return json({ ok: true });
        }
        if (url.pathname === '/join') {
          requireThat(TOKEN.test(b.token), 'Identificación no válida.');
          const playerHash = await hash(b.token), now = Date.now();
          // Freno a quien prueba claves a ciegas: 10 fallos y espera 10 minutos.
          if (!this.keyFails || this.keyFails.until <= now) this.keyFails = { count: 0, until: now + 600000 };
          requireThat(this.keyFails.count < 10, 'Demasiados intentos con la clave. Espera unos minutos.', 429);
          let p;
          try { p = joinTournament(this.t, b.name, playerHash, now, b.joinKey, b.account || null); }
          catch (error) { if (/clave/.test(error.message)) this.keyFails.count++; throw error; }
          await this.save(); this.broadcast();
          return json({ playerId: p.id }, 201);
        }
        throw new GameError('No encontrado.', 404);
      } catch (error) { return failure(error); }
    });
  }
  async webSocketMessage(ws, message) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        requireThat(typeof message === 'string' && message.length <= 2048, 'Mensaje no válido.');
        let b; try { b = JSON.parse(message); } catch { throw new GameError('Mensaje no válido.'); }
        requireThat(b && typeof b === 'object', 'Mensaje no válido.');
        await this.checkTime();
        const a = ws.deserializeAttachment() || {}, now = Date.now();
        a.seenAt = now;
        if (!a.window || now - a.window >= 5000) { a.window = now; a.count = 0; }
        a.count++;
        ws.serializeAttachment(a);
        requireThat(a.count <= 24, 'Estás enviando demasiadas acciones. Espera unos segundos.', 429);
        if (b.type === 'hello') {
          a.playerHash = TOKEN.test(b.token) ? await hash(b.token) : null;
          a.hostHash = TOKEN.test(b.hostToken) ? await hash(b.hostToken) : null;
          ws.serializeAttachment(a);
          // Quien entra (o vuelve) puede completar una pareja en el modo arena.
          if (this.pair(now)) { await this.save(); this.broadcast(); }
          else this.send(ws);
          return;
        }
        if (b.type === 'watch') {
          requireThat(typeof b.game === 'string' && this.t.games.some(g => g.id === b.game && !g.bye), 'Partida no válida.');
          a.game = b.game; ws.serializeAttachment(a); this.send(ws); return;
        }
        const c = this.capabilities(a.playerHash, a.hostHash);
        const moved = b.type === 'move' ? this.t.games.find(g => g.id === b.game) : null;
        act(this.t, c.playerId, c.host, b, now);
        const paired = this.pair(now);
        await this.save();
        // Una jugada normal solo viaja como jugada; si cierra la partida o empareja a alguien, va el estado completo.
        if (moved && !moved.result && !paired) this.sendMove(moved); else this.broadcast();
      } catch (error) {
        try { ws.send(JSON.stringify({ type: 'error', message: error instanceof GameError ? error.message : 'No se pudo guardar la acción. Reconecta antes de continuar.' })); this.send(ws); } catch {}
      }
    });
  }
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code); } catch {} }
  webSocketError(ws) { try { ws.close(1011, 'Conexión interrumpida.'); } catch {} }
  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!this.t) return;
      if (Date.now() >= this.t.expiresAt) {
        for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'El torneo ha caducado.');
        await this.ctx.storage.deleteAll(); this.t = null; return;
      }
      if (this.progress()) { await this.save(); this.broadcast(); }
      else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, nextAlarm(this.t)));
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    const cors = { 'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0] || '', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' };
    const withCors = res => {
      if (res.status === 101) return res;
      const headers = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    };
    try {
      requireThat(!origin || allowed.includes(origin), 'Este origen no está autorizado.', 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      requireThat(['GET', 'POST'].includes(request.method), 'Método no permitido.', 405);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const directory = env.DIRECTORY.getByName('public');
      const accounts = env.ACCOUNTS.getByName('cuentas');
      const askAccounts = async (action, data) => accounts.fetch('https://cuentas/' + action, { method: 'POST', body: JSON.stringify(data) });
      // Fotos de perfil: se ven sin sesión (GET) y se suben como bytes JPEG con la sesión (POST).
      const photo = /^\/api\/cuentas\/foto\/([a-f0-9]{24})$/.exec(path);
      if (photo && request.method === 'GET') return withCors(await accounts.fetch('https://cuentas/foto/' + photo[1]));
      if (path === '/api/cuentas/foto' && request.method === 'POST') {
        requireThat(Number(request.headers.get('Content-Length') || 0) <= 64 * 1024, 'La foto es demasiado grande.', 413);
        const bytes = await request.arrayBuffer();
        requireThat(bytes.byteLength <= 64 * 1024, 'La foto es demasiado grande.', 413);
        return withCors(await accounts.fetch('https://cuentas/foto-subir', { method: 'POST', headers: { 'X-Sesion': bearer(request) }, body: bytes }));
      }
      const account = /^\/api\/cuentas\/(registro|entrar|reenviar|confirmar|recuperar|restablecer|yo|salir|borrar|foto-quitar)$/.exec(path);
      if (account) {
        requireThat(request.method === 'POST', 'Método no permitido.', 405);
        const b = await body(request);
        // La sesión viaja en la cabecera Authorization; la IP solo sirve para frenar intentos repetidos.
        return withCors(await askAccounts(account[1], { ...b, session: bearer(request), ip: request.headers.get('CF-Connecting-IP') || 'local' }));
      }
      const room = /^\/api\/tournaments\/([a-f0-9]{24})(?:\/(join|socket|pgn|recover|delete|config|edit))?$/.exec(path);
      if (path === '/api/tournaments' && request.method === 'GET') return withCors(await directory.fetch('https://directory/'));
      if ((path === '/api/tournaments' && request.method === 'POST') || (room?.[2] === 'recover' && request.method === 'POST')) {
        const authorization = await directory.fetch('https://directory/authorize', { method: 'POST', body: JSON.stringify({ key: bearer(request), ip: request.headers.get('CF-Connecting-IP') || 'local' }) });
        if (!authorization.ok) return withCors(authorization);
        const b = await body(request);
        if (!room) return withCors(await directory.fetch('https://directory/', { method: 'POST', body: JSON.stringify(b) }));
        return withCors(await env.TOURNAMENTS.getByName(room[1]).fetch('https://room/recover', { method: 'POST', body: JSON.stringify(b) }));
      }
      requireThat(room && ROOM_ID.test(room[1]), 'No encontrado.', 404);
      const suffix = room[2] || '';
      requireThat(!['join', 'recover', 'delete', 'config', 'edit'].includes(suffix) || request.method === 'POST', 'Método no permitido.', 405);
      requireThat(!['socket', 'pgn', ''].includes(suffix) || request.method === 'GET', 'Método no permitido.', 405);
      if (suffix === 'socket') requireThat(origin && allowed.includes(origin), 'Conexión no autorizada.', 403);
      if (suffix === 'join') {
        // Con sesión, el jugador se inscribe con el nick de su cuenta; sin ella, su alias no puede ser el nick de otra cuenta.
        const b = await body(request), session = bearer(request); delete b.account;
        if (session) {
          const { user, unverified } = await (await askAccounts('sesion', { session })).json();
          requireThat(!unverified, 'Confirma tu correo para jugar con tu cuenta: abre el enlace que te enviamos. Si no te llegó, pide otro desde «Mi cuenta».', 403);
          requireThat(user, 'Tu sesión ha caducado. Vuelve a entrar.', 401);
          b.account = user;
        } else {
          const { taken } = await (await askAccounts('nick', { name: b.name })).json();
          requireThat(!taken, 'Ese nombre es el nick de una cuenta registrada. Entra con tu cuenta o elige otro nombre.', 409);
        }
        return withCors(await env.TOURNAMENTS.getByName(room[1]).fetch('https://room/join', { method: 'POST', body: JSON.stringify(b) }));
      }
      const target = new URL('https://room/' + suffix); target.search = url.search;
      return withCors(await env.TOURNAMENTS.getByName(room[1]).fetch(new Request(target, request)));
    } catch (error) { return withCors(failure(error)); }
  }
};
