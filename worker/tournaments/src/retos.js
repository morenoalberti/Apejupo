import { DurableObject } from 'cloudflare:workers';
import { GameError, requireThat, createTournament, joinTournament } from './core.js';

// Retos entre cuentas: un único punto de encuentro con una conexión por pestaña de cada usuario con sesión.
// Sirve para saber quién está en línea, entregar el reto al momento y, si se acepta, crear la partida
// (una sala de torneo de dos jugadores y una ronda) y mandar a los dos al tablero.
export const RETO_MS = 60000;            // un reto sin respuesta caduca al minuto
const PRESENCE_MS = 75000;               // el navegador manda «ping» cada 30 s
const START_GRACE_MS = 30000;            // si alguno no llega al tablero, la partida empieza igual pasado este margen
const MINUTES = [1, 2, 3, 5, 10, 15], INCREMENTS = [0, 1, 2, 3, 5, 10], COLORS = ['w', 'b', 'azar'];

const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const key = nick => String(nick || '').trim().toLocaleLowerCase('es');
const pub = c => ({ id: c.id, from: c.from.nick, to: c.to.nick, minutes: c.minutes, increment: c.increment, color: c.color, revancha: !!c.revancha, expiresAt: c.expiresAt });

export class ChallengeHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  entries(now = Date.now()) {
    return this.ctx.getWebSockets().map(ws => ({ ws, a: ws.deserializeAttachment() || {} })).filter(({ ws, a }) => {
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0;
      return a.user && now - Math.max(ping, a.seenAt || 0) <= PRESENCE_MS;
    });
  }
  online(now) { const m = new Map(); for (const { a } of this.entries(now)) m.set(a.user.id, a.user); return m; }
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch {} }
  toUser(userId, msg, filter = () => true) { for (const { ws, a } of this.entries()) if (a.user.id === userId && filter(ws, a)) this.send(ws, msg); }
  async load(now = Date.now()) {
    const all = (await this.ctx.storage.get('retos')) || [];
    const live = all.filter(c => c.expiresAt > now);
    for (const c of all.filter(c => c.expiresAt <= now)) {
      this.toUser(c.from.id, { type: 'caducado', id: c.id, nick: c.to.nick });
      this.toUser(c.to.id, { type: 'cerrado', id: c.id });
    }
    if (live.length !== all.length) await this.save(live);
    return live;
  }
  async save(list) {
    await this.ctx.storage.put('retos', list);
    if (list.length) await this.ctx.storage.setAlarm(Math.min(...list.map(c => c.expiresAt)) + 50);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/socket') return new Response('No encontrado', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Se necesita WebSocket', { status: 426 });
    if (this.ctx.getWebSockets().length >= 2000) return new Response('Demasiadas conexiones', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ tag: hex(8), user: null, seenAt: Date.now(), window: Date.now(), count: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    return this.ctx.blockConcurrencyWhile(async () => {
      let b = null;
      try {
        requireThat(typeof message === 'string' && message.length <= 1024, 'Mensaje no válido.');
        try { b = JSON.parse(message); } catch { throw new GameError('Mensaje no válido.'); }
        requireThat(b && typeof b === 'object', 'Mensaje no válido.');
        const a = ws.deserializeAttachment() || {}, now = Date.now();
        a.seenAt = now;
        if (now - (a.window || 0) >= 10000) { a.window = now; a.count = 0; }
        a.count++; ws.serializeAttachment(a);
        requireThat(a.count <= 20, 'Demasiados mensajes seguidos. Espera unos segundos.', 429);

        if (b.type === 'hello') {
          const res = await this.env.ACCOUNTS.getByName('cuentas').fetch('https://cuentas/sesion', { method: 'POST', body: JSON.stringify({ session: String(b.session || '') }) });
          const { user, unverified } = await res.json();
          a.user = user ? { id: user.id, nick: user.nick } : null; ws.serializeAttachment(a);
          if (!user) { this.send(ws, { type: 'sin-sesion', unverified: !!unverified }); return; }
          const list = await this.load(now);
          this.send(ws, { type: 'hola', nick: user.nick,
            recibidos: list.filter(c => c.to.id === user.id).map(pub), enviados: list.filter(c => c.from.id === user.id).map(pub) });
          return;
        }
        requireThat(a.user, 'Entra con tu cuenta (y confirma el correo) para retar a otros jugadores.', 401);
        const me = a.user;
        if (b.type === 'conectados') {
          this.send(ws, { type: 'conectados', nicks: [...this.online(now).values()].filter(u => u.id !== me.id).map(u => u.nick).sort((x, y) => x.localeCompare(y, 'es')) });
          return;
        }
        let list = await this.load(now);
        if (b.type === 'retar') {
          const minutes = Number(b.minutes), increment = Number(b.increment), color = String(b.color || 'azar');
          requireThat(MINUTES.includes(minutes) && INCREMENTS.includes(increment), 'Elige un ritmo válido.');
          requireThat(COLORS.includes(color), 'Elige un color válido.');
          requireThat(key(b.nick), 'Escribe el nick del jugador al que quieres retar.');
          requireThat(key(b.nick) !== key(me.nick), 'No puedes retarte a ti mismo.');
          const target = [...this.online(now).values()].find(u => key(u.nick) === key(b.nick));
          requireThat(target, `${String(b.nick).trim().slice(0, 20)} no está conectado ahora mismo. Solo puedes retar a jugadores que estén en línea.`, 404);
          requireThat(list.filter(c => c.to.id === target.id).length < 5, `${target.nick} tiene demasiados retos pendientes. Prueba en un momento.`, 429);
          // Un reto pendiente por persona: uno nuevo sustituye al anterior.
          for (const old of list.filter(c => c.from.id === me.id)) this.toUser(old.to.id, { type: 'retirado', id: old.id, nick: me.nick });
          list = list.filter(c => c.from.id !== me.id);
          const c = { id: hex(8), from: me, fromTag: a.tag, to: target, minutes, increment, color, revancha: b.revancha === true, createdAt: now, expiresAt: now + RETO_MS };
          list.push(c); await this.save(list);
          this.toUser(target.id, { type: 'reto', reto: pub(c) });
          this.toUser(me.id, { type: 'enviado', reto: pub(c) });
          return;
        }
        const c = list.find(x => x.id === b.id);
        if (b.type === 'cancelar') {
          if (!c || c.from.id !== me.id) return;
          await this.save(list.filter(x => x !== c));
          this.toUser(c.to.id, { type: 'retirado', id: c.id, nick: me.nick });
          this.toUser(me.id, { type: 'cerrado', id: c.id });
          return;
        }
        if (b.type === 'rechazar') {
          if (!c || c.to.id !== me.id) return;
          await this.save(list.filter(x => x !== c));
          this.toUser(c.from.id, { type: 'rechazado', id: c.id, nick: me.nick });
          this.toUser(me.id, { type: 'cerrado', id: c.id });
          return;
        }
        if (b.type === 'aceptar') {
          requireThat(c && c.to.id === me.id, 'Ese reto ya no está disponible.', 410);
          list = list.filter(x => x !== c); await this.save(list);
          if (!this.online(now).has(c.from.id)) {
            this.toUser(me.id, { type: 'cerrado', id: c.id });
            throw new GameError(`${c.from.nick} ya no está conectado. El reto se ha anulado.`, 410);
          }
          const room = await this.createGame(c, now);
          // Cada uno recibe su credencial de jugador en la pestaña desde la que retó o aceptó; sus otras pestañas solo cierran el aviso.
          const senderTabs = this.entries(now).filter(({ a: x }) => x.user.id === c.from.id);
          const senderTab = senderTabs.find(({ a: x }) => x.tag === c.fromTag) || senderTabs[0];
          this.send(senderTab.ws, { type: 'empezar', id: room.id, token: room.tokens.from, rival: me.nick });
          this.send(ws, { type: 'empezar', id: room.id, token: room.tokens.to, rival: c.from.nick });
          for (const { ws: other, a: x } of this.entries(now)) {
            if (other !== ws && other !== senderTab.ws && (x.user.id === c.from.id || x.user.id === me.id)) this.send(other, { type: 'cerrado', id: c.id });
          }
          return;
        }
        throw new GameError('Acción no válida.');
      } catch (error) {
        this.send(ws, { type: 'error', id: b?.id || null, message: error instanceof GameError ? error.message : 'No se pudo completar la operación. Vuelve a intentarlo.' });
      }
    });
  }
  async createGame(c, now) {
    const id = hex(12), tokens = { from: hex(32), to: hex(32) };
    const t = createTournament({ title: `${c.revancha ? 'Revancha' : 'Reto'}: ${c.from.nick} – ${c.to.nick}`, format: 'swiss', minutes: c.minutes, increment: c.increment, rounds: 1, capacity: 2 }, id, await sha(hex(32)), now);
    const pf = joinTournament(t, '', await sha(tokens.from), now, '', c.from);
    const pt = joinTournament(t, '', await sha(tokens.to), now, '', c.to);
    const fromWhite = c.color === 'w' ? true : c.color === 'b' ? false : crypto.getRandomValues(new Uint8Array(1))[0] < 128;
    // Empieza en cuanto los dos tengan el tablero abierto; si alguno no llega, a los 30 segundos.
    t.challenge = { white: fromWhite ? pf.id : pt.id };
    // Marcador acumulado entre los dos, para verlo durante la partida; al terminar se actualiza.
    try { t.challenge.score = await (await this.env.ACCOUNTS.getByName('cuentas').fetch('https://cuentas/duelo-ver', { method: 'POST', body: JSON.stringify({ a: c.from.id, b: c.to.id }) })).json(); } catch {}
    t.startsAt = now + START_GRACE_MS;
    const res = await this.env.TOURNAMENTS.getByName(id).fetch('https://room/init', { method: 'POST', body: JSON.stringify(t) });
    requireThat(res.ok, 'No se pudo crear la partida. Vuelve a intentarlo.', 503);
    return { id, tokens };
  }
  async alarm() { return this.ctx.blockConcurrencyWhile(() => this.load()); }
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code); } catch {} }
  webSocketError(ws) { try { ws.close(1011, 'Conexión interrumpida.'); } catch {} }
}
