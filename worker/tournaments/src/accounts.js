import { DurableObject } from 'cloudflare:workers';
import { Chess } from 'chess.js';
import { GameError, requireThat } from './core.js';
import { registeredPlayerNicks } from './player-directory.js';
import { ELO_START, eloAfter } from './elo.js';
const GAMES_PAGE = 50;

// Cuentas al estilo Lichess: nick + contraseña; el correo confirma la cuenta y sirve para recuperarla.
// Nunca se guarda la contraseña: solo su derivación PBKDF2 con sal. Sesiones y enlaces de correo se
// guardan como huella SHA-256, así que ni quien lea la base de datos puede usarlos.
export const PBKDF2_ITERATIONS = 100000;
const SESSION_MS = 90 * 24 * 3600 * 1000;
const VERIFY_MS = 24 * 3600 * 1000;
const RESET_MS = 3600 * 1000;
const RESERVED = new Set(['admin', 'administrador', 'apejupo', 'organizador', 'organizacion', 'moderador', 'arbitro', 'soporte', 'sistema', 'anonimo', 'invitado', 'lichess']);

const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
export const randomToken = (size = 32) => hex(crypto.getRandomValues(new Uint8Array(size)));
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(value))); }

export function cleanNick(value) {
  const nick = String(value || '').trim();
  requireThat(/^[A-Za-z0-9][A-Za-z0-9_-]{5,19}$/.test(nick), 'El nick debe tener de 6 a 20 caracteres, empezar por una letra o un número y usar solo letras sin acentos, números, guion o guion bajo.');
  requireThat(!/[_-]{2}/.test(nick) && !/[_-]$/.test(nick), 'El nick no puede terminar en guion ni tener dos guiones seguidos.');
  requireThat(!RESERVED.has(nick.toLowerCase()), 'Ese nick está reservado. Elige otro.');
  return nick;
}
export const nickKey = value => String(value || '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
export function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  requireThat(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email), 'Escribe un correo electrónico válido.');
  return email;
}
export function checkPassword(password, nick = '') {
  requireThat(typeof password === 'string' && password.length >= 8 && password.length <= 128, 'La contraseña debe tener entre 8 y 128 caracteres.');
  requireThat(!nick || password.toLowerCase() !== nick.toLowerCase(), 'La contraseña no puede ser igual que el nick.');
  return password;
}
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${hex(salt)}$${hex(bits)}`;
}
export async function verifyPassword(password, stored) {
  const [kind, iterations, salt, expected] = String(stored || '').split('$');
  if (kind !== 'pbkdf2') return false;
  const actual = (await hashPassword(password, fromHex(salt), Number(iterations))).split('$')[3];
  // Comparación en tiempo constante.
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function sendMail(env, to, subject, text) {
  // Sin clave, o con direcciones de prueba (@example.com, .test), el correo solo se escribe en la consola.
  if (!env.RESEND_API_KEY || /@(example\.(com|org|net)|[^@]+\.test)$/i.test(to)) { console.log(`[correo local] Para ${to} · ${subject}\n${text}`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CORREO_REMITENTE || 'Apejupo Chess Club <cuentas@apejupo.com>', to: [to], subject, text })
  });
  requireThat(res.ok, 'No se pudo enviar el correo. Inténtalo en unos minutos.', 503);
}
// Compara dos claves sin que el tiempo de respuesta delate cuántos caracteres coinciden.
async function sameSecret(a, b) {
  const [x, y] = [await sha256(a), await sha256(b)];
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const publicUser = u => ({ id: u.id, nick: u.nick, email: u.email, verified: !!u.verified, createdAt: u.created_at, photo: u.photo_at || null, elo: Number.isInteger(u.elo) ? u.elo : ELO_START });
// Foto de perfil: la web la reduce a 192×192 en JPEG antes de subirla; aquí solo se aceptan JPEG pequeños.
export const PHOTO_MAX = 64 * 1024;
const isJpeg = bytes => bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export class AccountStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nick TEXT NOT NULL, nick_key TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS photos (user_id TEXT PRIMARY KEY, data BLOB NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS duels (a TEXT NOT NULL, b TEXT NOT NULL, a_wins INTEGER NOT NULL DEFAULT 0, b_wins INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (a, b));
      CREATE TABLE IF NOT EXISTS duel_games (room TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS partidas (id TEXT PRIMARY KEY, room TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, white TEXT NOT NULL, black TEXT NOT NULL, white_elo INTEGER, black_elo INTEGER, result TEXT NOT NULL, reason TEXT NOT NULL, plies INTEGER NOT NULL, tc TEXT NOT NULL, pgn TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS partidas_at ON partidas (at);
      CREATE TABLE IF NOT EXISTS retos_archivados (room TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS elo_games (game TEXT PRIMARY KEY, white TEXT NOT NULL, black TEXT NOT NULL, result TEXT NOT NULL, white_before INTEGER NOT NULL, black_before INTEGER NOT NULL, white_after INTEGER NOT NULL, black_after INTEGER NOT NULL, at INTEGER NOT NULL);`);
    // Última actividad (para la página de administración). Las bases anteriores no tenían la columna.
    const columns = this.sql.exec('PRAGMA table_info(users)').toArray();
    if (!columns.some(c => c.name === 'last_seen')) this.sql.exec('ALTER TABLE users ADD COLUMN last_seen INTEGER');
    // ELO del club: toda cuenta empieza con 1500 (también las que ya existían).
    if (!columns.some(c => c.name === 'elo')) this.sql.exec(`ALTER TABLE users ADD COLUMN elo INTEGER NOT NULL DEFAULT ${ELO_START}`);
    // Posición final y última jugada de cada partida archivada (para el tablero pequeño de «Partidas jugadas»).
    const archive = this.sql.exec('PRAGMA table_info(partidas)').toArray();
    if (!archive.some(c => c.name === 'fen')) this.sql.exec('ALTER TABLE partidas ADD COLUMN fen TEXT');
    if (!archive.some(c => c.name === 'last_move')) this.sql.exec('ALTER TABLE partidas ADD COLUMN last_move TEXT');
  }
  // Marcador de los retos entre dos cuentas (victorias de cada una y tablas), guardado con el par ordenado.
  duel(x, y) {
    const [a, b] = x < y ? [x, y] : [y, x], row = this.one('SELECT * FROM duels WHERE a = ? AND b = ?', a, b) || { a_wins: 0, b_wins: 0, draws: 0 };
    return { wins: { [a]: row.a_wins, [b]: row.b_wins }, draws: row.draws };
  }
  // Partida de torneo entre dos cuentas: se aplica una sola vez (K = 20) y se devuelve el ELO nuevo de las dos.
  recordElo(game, white, black, result, now) {
    const done = this.one('SELECT white_after, black_after FROM elo_games WHERE game = ?', game);
    if (done) return { white: done.white_after, black: done.black_after };
    const w = this.one('SELECT elo FROM users WHERE id = ?', white), b = this.one('SELECT elo FROM users WHERE id = ?', black);
    requireThat(w && b, 'Cuenta no encontrada.', 404);
    const after = eloAfter(w.elo, b.elo, result);
    this.sql.exec('UPDATE users SET elo = ? WHERE id = ?', after.white, white);
    this.sql.exec('UPDATE users SET elo = ? WHERE id = ?', after.black, black);
    this.sql.exec('INSERT INTO elo_games (game, white, black, result, white_before, black_before, white_after, black_after, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', game, white, black, result, w.elo, b.elo, after.white, after.black, now);
    return after;
  }
  // Archivo de «Partidas jugadas»: partidas terminadas de torneos online y retos. No caducan ni se borran
  // al borrar el torneo; solo el administrador puede quitar una partida desde la lista.
  archiveGame(g, now) {
    this.sql.exec('INSERT OR IGNORE INTO partidas (id, room, kind, title, white, black, white_elo, black_elo, result, reason, plies, tc, pgn, at, fen, last_move) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      g.id, g.room, g.kind, g.title, g.white, g.black, g.whiteElo ?? null, g.blackElo ?? null, g.result, g.reason, g.plies, g.tc, g.pgn, g.at || now, g.fen || null, g.lastMove || null);
  }
  // Partidas archivadas antes de guardar la posición final: se calcula una vez desde su PGN.
  fillFen(row) {
    try {
      const c = new Chess(); c.loadPgn(this.one('SELECT pgn FROM partidas WHERE id = ?', row.id).pgn);
      const last = c.history({ verbose: true }).pop();
      row.fen = c.fen(); row.last_move = last ? last.from + last.to : '';
      this.sql.exec('UPDATE partidas SET fen = ?, last_move = ? WHERE id = ?', row.fen, row.last_move, row.id);
    } catch { row.fen = null; }
  }
  listGames(q, before, now) {
    // Búsqueda por nombre del jugador (blancas o negras), sin distinguir mayúsculas; «!» escapa % y _.
    const like = '%' + q.replace(/[!%_]/g, c => '!' + c) + '%';
    const rows = this.sql.exec(`SELECT id, kind, title, white, black, white_elo, black_elo, result, reason, plies, tc, at, fen, last_move FROM partidas
      WHERE at < ? ${q ? "AND (white LIKE ? ESCAPE '!' OR black LIKE ? ESCAPE '!')" : ''} ORDER BY at DESC LIMIT ?`,
      before, ...(q ? [like, like] : []), GAMES_PAGE + 1).toArray();
    for (const r of rows) if (!r.fen) this.fillFen(r);
    const games = rows.slice(0, GAMES_PAGE).map(r => ({ id: r.id, kind: r.kind, title: r.title, white: r.white, black: r.black, whiteElo: r.white_elo, blackElo: r.black_elo, result: r.result, reason: r.reason, plies: r.plies, tc: r.tc, at: r.at, fen: r.fen || null, lastMove: r.last_move || null }));
    return { games, next: rows.length > GAMES_PAGE ? games[games.length - 1].at : null };
  }
  recordDuel(room, white, black, result, now) {
    if (this.one('SELECT 1 AS x FROM duel_games WHERE room = ?', room)) return; // cada partida cuenta una sola vez
    const [a, b] = white < black ? [white, black] : [black, white];
    const winner = result === '1-0' ? white : result === '0-1' ? black : null;
    this.sql.exec('INSERT OR IGNORE INTO duels (a, b) VALUES (?, ?)', a, b);
    this.sql.exec(`UPDATE duels SET ${winner === null ? 'draws = draws + 1' : winner === a ? 'a_wins = a_wins + 1' : 'b_wins = b_wins + 1'} WHERE a = ? AND b = ?`, a, b);
    this.sql.exec('INSERT INTO duel_games (room, at) VALUES (?, ?)', room, now);
  }
  // Como mucho una escritura cada 5 minutos por cuenta: la hora de la última actividad es fiable (página de administración).
  seen(id, now) { this.sql.exec('UPDATE users SET last_seen = ? WHERE id = ? AND (last_seen IS NULL OR last_seen < ?)', now, id, now - 300000); }
  // Administración: lista de cuentas y acciones sobre ellas, con la clave CUENTAS_ADMIN (secreto del Worker).
  async admin(action, b, ip, now) {
    const secret = String(this.env.CUENTAS_ADMIN || '');
    requireThat(secret.length >= 12, 'La administración de cuentas no está configurada en el servidor (falta el secreto CUENTAS_ADMIN).', 503);
    const lock = 'admin:' + ip, max = this.env.CUENTAS_DESARROLLO === '1' ? 1000 : 10, tried = this.one('SELECT count, until FROM attempts WHERE key = ?', lock);
    requireThat(!(tried && tried.until > now && tried.count >= max), 'Demasiados intentos. Espera unos minutos y vuelve a probar.', 429);
    if (!(await sameSecret(String(b.key || ''), secret))) { this.limit(lock, 10, 900000, now); throw new GameError('La clave de administración no es correcta.', 401); }
    if (action === 'comprobar') return { ok: true };
    if (action === 'lista') {
      const users = this.sql.exec(`SELECT u.id, u.nick, u.email, u.verified, u.created_at, u.last_seen, p.updated_at AS photo_at,
          (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
        FROM users u LEFT JOIN photos p ON p.user_id = u.id ORDER BY u.created_at DESC`, now).toArray();
      return { now, users: users.map(u => ({ id: u.id, nick: u.nick, email: u.email, verified: !!u.verified, createdAt: u.created_at, lastSeen: u.last_seen || null, photo: u.photo_at || null, sessions: u.sessions })) };
    }
    requireThat(/^[a-f0-9]{24}$/.test(String(b.id || '')), 'Cuenta no válida.');
    const user = this.one('SELECT * FROM users WHERE id = ?', b.id);
    requireThat(user, 'Esa cuenta ya no existe.', 404);
    switch (action) {
      case 'confirmar': this.sql.exec('UPDATE users SET verified = 1 WHERE id = ?', user.id); return { ok: true };
      case 'reenviar': {
        requireThat(!user.verified, 'Esa cuenta ya está confirmada.', 409);
        const link = await this.sendVerification(user, now);
        return { ok: true, ...(this.env.CUENTAS_DESARROLLO === '1' ? { enlace: link } : {}) };
      }
      case 'borrar':
        for (const table of ['sessions', 'tokens', 'photos']) this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, user.id);
        this.sql.exec('DELETE FROM duels WHERE a = ? OR b = ?', user.id, user.id);
        this.sql.exec('DELETE FROM users WHERE id = ?', user.id);
        return { ok: true };
      default: throw new GameError('No encontrado.', 404);
    }
  }
  one(query, ...args) { return this.sql.exec(query, ...args).toArray()[0] || null; }
  // Freno a la fuerza bruta: como mucho «max» intentos por clave en la ventana indicada.
  limit(key, max, windowMs, now) {
    if (this.env.CUENTAS_DESARROLLO === '1') max *= 100; // en local, para poder repetir las pruebas
    let row = this.one('SELECT count, until FROM attempts WHERE key = ?', key);
    if (!row || row.until <= now) row = { count: 0, until: now + windowMs };
    requireThat(row.count < max, 'Demasiados intentos. Espera unos minutos y vuelve a probar.', 429);
    this.sql.exec('INSERT OR REPLACE INTO attempts (key, count, until) VALUES (?, ?, ?)', key, row.count + 1, row.until);
  }
  clearLimit(key) { this.sql.exec('DELETE FROM attempts WHERE key = ?', key); }
  async user(session, now) {
    if (!/^[a-f0-9]{64}$/.test(String(session || ''))) return null;
    return this.one('SELECT u.*, p.updated_at AS photo_at FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN photos p ON p.user_id = u.id WHERE s.hash = ? AND s.expires_at > ?', await sha256(session), now);
  }
  async mailToken(user, kind, ttl, now) {
    this.sql.exec('DELETE FROM tokens WHERE user_id = ? AND kind = ?', user.id, kind);
    const token = randomToken();
    this.sql.exec('INSERT INTO tokens (hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)', await sha256(token), user.id, kind, now + ttl);
    return token;
  }
  async useToken(token, kind, now) {
    requireThat(/^[a-f0-9]{64}$/.test(String(token || '')), 'El enlace no es válido.');
    const hash = await sha256(token), row = this.one('SELECT user_id, expires_at FROM tokens WHERE hash = ? AND kind = ?', hash, kind);
    requireThat(row && row.expires_at > now, 'El enlace no es válido o ha caducado. Pide otro.', 400);
    this.sql.exec('DELETE FROM tokens WHERE hash = ?', hash);
    return row.user_id;
  }
  async openSession(user, now) {
    const session = randomToken();
    this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.sql.exec('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)', await sha256(session), user.id, now + SESSION_MS);
    return session;
  }
  async sendVerification(user, now) {
    const token = await this.mailToken(user, 'verify', VERIFY_MS, now), link = `${this.env.SITE_URL || 'https://apejupo.com'}/cuenta.html?confirmar=${token}`;
    await sendMail(this.env, user.email, 'Confirma tu cuenta de Apejupo', `Hola, ${user.nick}:\n\nPara activar tu cuenta en Apejupo Chess Club, abre este enlace (caduca en 24 horas):\n\n${link}\n\nSi no has creado tú esta cuenta, ignora este correo.`);
    return link;
  }
  async fetch(request) {
    try {
      const url = new URL(request.url), now = Date.now();
      // Fotos: llegan como bytes (no JSON) y se sirven como imagen.
      const shown = /^\/foto\/([a-f0-9]{24})$/.exec(url.pathname);
      if (shown) {
        const row = this.one('SELECT data FROM photos WHERE user_id = ?', shown[1]);
        if (!row) return new Response('Sin foto', { status: 404 });
        return new Response(row.data, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (url.pathname === '/foto-subir') {
        const user = await this.user(request.headers.get('X-Sesion'), now);
        requireThat(user, 'Tu sesión ha caducado. Vuelve a entrar.', 401);
        this.limit('foto:' + user.id, 20, 3600000, now);
        const bytes = new Uint8Array(await request.arrayBuffer());
        requireThat(bytes.length <= PHOTO_MAX, 'La foto es demasiado grande.', 413);
        requireThat(isJpeg(bytes), 'La foto no es válida. Prueba con otra imagen.');
        this.sql.exec('INSERT OR REPLACE INTO photos (user_id, data, updated_at) VALUES (?, ?, ?)', user.id, bytes.buffer, now);
        return json({ user: publicUser({ ...user, photo_at: now }) });
      }
      const b = request.method === 'POST' ? await request.json() : {};
      const ip = String(b.ip || 'local').slice(0, 64), dev = this.env.CUENTAS_DESARROLLO === '1';
      const adminAction = /^\/admin\/(comprobar|lista|confirmar|reenviar|borrar)$/.exec(url.pathname);
      if (adminAction) return json(await this.admin(adminAction[1], b, ip, now));
      switch (url.pathname) {
        case '/registro': {
          const nick = cleanNick(b.nick), email = cleanEmail(b.email); checkPassword(b.password, nick);
          this.limit('registro:' + ip, 5, 3600000, now);
          requireThat(!this.one('SELECT 1 AS x FROM users WHERE nick_key = ?', nickKey(nick)), 'Este nick ya está registrado.', 409);
          requireThat(!this.one('SELECT 1 AS x FROM users WHERE email = ?', email), 'Ya hay una cuenta con ese correo. Entra o recupera tu contraseña.', 409);
          const user = { id: randomToken(12), nick, email, created_at: now };
          this.sql.exec('INSERT INTO users (id, nick, nick_key, email, pass, verified, created_at, last_seen) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', user.id, nick, nickKey(nick), email, await hashPassword(b.password), now, now);
          const link = await this.sendVerification(user, now);
          // Como en Lichess, al crear la cuenta ya se entra; para jugar con ella hay que confirmar el correo.
          const session = await this.openSession(user, now);
          return json({ ok: true, session, user: publicUser({ ...user, verified: 0 }), ...(dev ? { enlace: link } : {}) }, 201);
        }
        case '/entrar': {
          const login = String(b.login || '').trim(), key = login.includes('@') ? login.toLowerCase() : nickKey(login);
          this.limit('entrar:' + ip, 20, 900000, now); this.limit('entrar:' + key, 10, 900000, now);
          const user = this.one('SELECT u.*, p.updated_at AS photo_at FROM users u LEFT JOIN photos p ON p.user_id = u.id WHERE u.' + (login.includes('@') ? 'email' : 'nick_key') + ' = ?', key);
          // Mismo mensaje si el usuario no existe o la contraseña falla: no se desvela qué cuentas hay.
          const good = user ? await verifyPassword(String(b.password || ''), user.pass) : (await hashPassword('x'), false);
          requireThat(good, 'Nick o contraseña incorrectos.', 401);
          this.clearLimit('entrar:' + key); this.seen(user.id, now);
          return json({ session: await this.openSession(user, now), user: publicUser(user) });
        }
        case '/reenviar': {
          this.limit('reenviar:' + ip, 5, 3600000, now);
          const user = (await this.user(b.session, now)) || this.one('SELECT * FROM users WHERE email = ? OR nick_key = ?', String(b.login || '').trim().toLowerCase(), nickKey(b.login));
          let link = null;
          if (user && !user.verified) { this.limit('reenviar:' + user.id, 3, 3600000, now); link = await this.sendVerification(user, now); }
          return json({ ok: true, ...(dev && link ? { enlace: link } : {}) });
        }
        case '/confirmar': {
          const id = await this.useToken(b.token, 'verify', now);
          this.sql.exec('UPDATE users SET verified = 1 WHERE id = ?', id);
          return json({ ok: true, nick: this.one('SELECT nick FROM users WHERE id = ?', id)?.nick });
        }
        case '/recuperar': {
          this.limit('recuperar:' + ip, 5, 3600000, now);
          const email = cleanEmail(b.email), user = this.one('SELECT * FROM users WHERE email = ?', email);
          let link = null;
          if (user) {
            this.limit('recuperar:' + user.id, 3, 3600000, now);
            const token = await this.mailToken(user, 'reset', RESET_MS, now);
            link = `${this.env.SITE_URL || 'https://apejupo.com'}/cuenta.html?restablecer=${token}`;
            await sendMail(this.env, user.email, 'Recupera tu contraseña de Apejupo', `Hola, ${user.nick}:\n\nPara poner una contraseña nueva, abre este enlace (caduca en 1 hora):\n\n${link}\n\nSi no lo has pedido tú, ignora este correo: tu contraseña no cambia.`);
          }
          // Siempre la misma respuesta: no se desvela si el correo tiene cuenta.
          return json({ ok: true, ...(dev && link ? { enlace: link } : {}) });
        }
        case '/restablecer': {
          const id = await this.useToken(b.token, 'reset', now), user = this.one('SELECT * FROM users WHERE id = ?', id);
          checkPassword(b.password, user.nick);
          // Nueva contraseña: se cierran todas las sesiones abiertas y la cuenta queda confirmada (el correo es suyo).
          this.sql.exec('UPDATE users SET pass = ?, verified = 1 WHERE id = ?', await hashPassword(b.password), id);
          this.sql.exec('DELETE FROM sessions WHERE user_id = ?', id);
          return json({ ok: true, nick: user.nick });
        }
        case '/yo': {
          const user = await this.user(b.session, now);
          requireThat(user, 'Tu sesión ha caducado. Vuelve a entrar.', 401);
          this.seen(user.id, now);
          return json({ user: publicUser(user) });
        }
        case '/base-datos': {
          const user = await this.user(b.session, now);
          requireThat(user, 'Entra o crea una cuenta para bajar la base de datos.', 401);
          // Se exige estar registrado; la confirmación del correo sigue siendo requisito de los torneos.
          // Este enlace nunca se incluye en el HTML ni en el JavaScript público de la portada.
          return json({ url: 'https://mega.nz/folder/2EQH0BbZ#n8RjbMl7Dk-yAlf1RGgjCg' });
        }
        case '/foto-quitar': {
          const user = await this.user(b.session, now);
          requireThat(user, 'Tu sesión ha caducado. Vuelve a entrar.', 401);
          this.sql.exec('DELETE FROM photos WHERE user_id = ?', user.id);
          return json({ user: publicUser({ ...user, photo_at: null }) });
        }
        case '/salir': {
          if (/^[a-f0-9]{64}$/.test(String(b.session || ''))) this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256(b.session));
          return json({ ok: true });
        }
        case '/borrar': {
          const user = await this.user(b.session, now);
          requireThat(user, 'Tu sesión ha caducado. Vuelve a entrar.', 401);
          this.limit('borrar:' + user.id, 5, 900000, now);
          requireThat(await verifyPassword(String(b.password || ''), user.pass), 'La contraseña no es correcta.', 403);
          for (const table of ['sessions', 'tokens', 'photos']) this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, user.id);
          this.sql.exec('DELETE FROM duels WHERE a = ? OR b = ?', user.id, user.id);
          this.sql.exec('DELETE FROM users WHERE id = ?', user.id);
          return json({ ok: true });
        }
        // Uso interno de las salas de torneo: quién es esta sesión y si un nombre está reservado.
        case '/sesion': {
          const user = await this.user(b.session, now);
          // «elo»: ELO del club de la cuenta (1500 al darse de alta); con él se ordena la inscripción y se juega.
          return json({ user: user && user.verified ? { id: user.id, nick: user.nick, elo: Number.isInteger(user.elo) ? user.elo : ELO_START } : null, unverified: !!user && !user.verified });
        }
        // Uso interno de los retos: marcador entre dos cuentas y anotación de una partida terminada.
        case '/duelo-ver': requireThat(/^[a-f0-9]{24}$/.test(b.a) && /^[a-f0-9]{24}$/.test(b.b), 'Cuentas no válidas.'); return json(this.duel(b.a, b.b));
        case '/duelo-anotar': {
          requireThat(/^[a-f0-9]{24}$/.test(b.white) && /^[a-f0-9]{24}$/.test(b.black) && /^[a-f0-9]{24}(-\d{1,2})?$/.test(b.room), 'Datos no válidos.');
          requireThat(['1-0', '0-1', '1/2-1/2'].includes(b.result), 'Resultado no válido.');
          this.recordDuel(b.room, b.white, b.black, b.result, now);
          return json(this.duel(b.white, b.black));
        }
        // Uso interno de las salas de torneo: ELO tras una partida entre dos cuentas (cada partida cuenta una sola vez).
        case '/elo-anotar': {
          requireThat(/^[a-f0-9]{24}$/.test(b.white) && /^[a-f0-9]{24}$/.test(b.black) && b.white !== b.black, 'Cuentas no válidas.');
          requireThat(/^[a-f0-9]{24}:[0-9a-f-]{36}$/.test(String(b.game || '')), 'Partida no válida.');
          requireThat(['1-0', '0-1', '1/2-1/2'].includes(b.result), 'Resultado no válido.');
          return json(this.recordElo(b.game, b.white, b.black, b.result, now));
        }
        // Uso interno: archivo de «Partidas jugadas» (anotar, listar con buscador y PGN). Solo las borra el administrador.
        case '/partida-anotar': {
          const g = b.game || {};
          requireThat(/^[a-f0-9]{24}_[0-9a-f-]{36}$/.test(String(g.id || '')) && ['1-0', '0-1', '1/2-1/2'].includes(g.result) && typeof g.pgn === 'string' && g.pgn.length < 100000, 'Partida no válida.');
          this.archiveGame({ ...g, fen: typeof g.fen === 'string' ? g.fen.slice(0, 100) : null, lastMove: /^[a-h][1-8][a-h][1-8]$/.test(String(g.lastMove || '')) ? g.lastMove : null, title: String(g.title || '').slice(0, 80), white: String(g.white || '').slice(0, 40), black: String(g.black || '').slice(0, 40), reason: String(g.reason || '').slice(0, 60), tc: String(g.tc || '').slice(0, 12), plies: Number(g.plies) || 0, kind: g.kind === 'reto' ? 'reto' : 'torneo' }, now);
          return json({ ok: true });
        }
        case '/partidas-lista': {
          const q = String(b.q || '').trim().slice(0, 40), before = Number(b.before) > 0 ? Number(b.before) : now + 1;
          return json(this.listGames(q, before, now));
        }
        // Retos jugados antes de existir «Partidas jugadas»: salas aún no revisadas (cada una se devuelve una sola vez).
        case '/retos-sin-archivar': {
          const rooms = [...new Set(this.sql.exec('SELECT room FROM duel_games').toArray().map(r => String(r.room).slice(0, 24)))]
            .filter(id => /^[a-f0-9]{24}$/.test(id) && !this.one('SELECT 1 AS x FROM retos_archivados WHERE room = ?', id));
          for (const id of rooms) this.sql.exec('INSERT OR IGNORE INTO retos_archivados (room) VALUES (?)', id);
          return json({ rooms });
        }
        // Solo el administrador (el router ya comprobó su clave): quitar una partida del archivo.
        case '/partida-borrar': {
          requireThat(/^[a-f0-9]{24}_[0-9a-f-]{36}$/.test(String(b.id || '')), 'Partida no válida.');
          this.sql.exec('DELETE FROM partidas WHERE id = ?', b.id);
          return json({ ok: true });
        }
        case '/partida-pgn': {
          const row = this.one('SELECT pgn FROM partidas WHERE id = ?', String(b.id || ''));
          requireThat(row, 'Esta partida ya no está disponible.', 404);
          return json({ pgn: row.pgn });
        }
        // Uso interno de los retos: nicks de las cuentas confirmadas (la lista de jugadores de retar.html).
        case '/jugadores': return json({ nicks: registeredPlayerNicks(this.sql.exec('SELECT nick, email FROM users WHERE verified = 1 ORDER BY nick_key').toArray()) });
        case '/nick': return json({ taken: !!this.one('SELECT 1 AS x FROM users WHERE nick_key = ?', nickKey(b.name)) });
        default: throw new GameError('No encontrado.', 404);
      }
    } catch (error) {
      return json({ error: error instanceof GameError ? error.message : 'No se pudo completar la operación. Vuelve a intentarlo.' }, error.status || 500);
    }
  }
}
