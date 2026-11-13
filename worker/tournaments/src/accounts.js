import { DurableObject } from 'cloudflare:workers';
import { GameError, requireThat } from './core.js';

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
  requireThat(/^[A-Za-z][A-Za-z0-9_-]{1,19}$/.test(nick), 'El nick debe tener de 2 a 20 caracteres, empezar por una letra y usar solo letras sin acentos, números, guion o guion bajo.');
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
  if (!env.RESEND_API_KEY) { console.log(`[correo local] Para ${to} · ${subject}\n${text}`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.CORREO_REMITENTE || 'Apejupo Chess Club <cuentas@apejupo.com>', to: [to], subject, text })
  });
  requireThat(res.ok, 'No se pudo enviar el correo. Inténtalo en unos minutos.', 503);
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const publicUser = u => ({ id: u.id, nick: u.nick, email: u.email, verified: !!u.verified, createdAt: u.created_at });

export class AccountStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, nick TEXT NOT NULL, nick_key TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);`);
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
    const row = this.one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ?', await sha256(session), now);
    return row;
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
  async sendVerification(user, now) {
    const token = await this.mailToken(user, 'verify', VERIFY_MS, now), link = `${this.env.SITE_URL || 'https://apejupo.com'}/cuenta.html?confirmar=${token}`;
    await sendMail(this.env, user.email, 'Confirma tu cuenta de Apejupo', `Hola, ${user.nick}:\n\nPara activar tu cuenta en Apejupo Chess Club, abre este enlace (caduca en 24 horas):\n\n${link}\n\nSi no has creado tú esta cuenta, ignora este correo.`);
    return link;
  }
  async fetch(request) {
    try {
      const url = new URL(request.url), now = Date.now(), b = request.method === 'POST' ? await request.json() : {};
      const ip = String(b.ip || 'local').slice(0, 64), dev = this.env.CUENTAS_DESARROLLO === '1';
      switch (url.pathname) {
        case '/registro': {
          const nick = cleanNick(b.nick), email = cleanEmail(b.email); checkPassword(b.password, nick);
          this.limit('registro:' + ip, 5, 3600000, now);
          requireThat(!this.one('SELECT 1 AS x FROM users WHERE nick_key = ?', nickKey(nick)), 'Ese nick ya está cogido. Elige otro.', 409);
          requireThat(!this.one('SELECT 1 AS x FROM users WHERE email = ?', email), 'Ya hay una cuenta con ese correo. Entra o recupera tu contraseña.', 409);
          const user = { id: randomToken(12), nick, email, created_at: now };
          this.sql.exec('INSERT INTO users (id, nick, nick_key, email, pass, verified, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', user.id, nick, nickKey(nick), email, await hashPassword(b.password), now);
          const link = await this.sendVerification(user, now);
          return json({ ok: true, ...(dev ? { enlace: link } : {}) }, 201);
        }
        case '/entrar': {
          const login = String(b.login || '').trim(), key = login.includes('@') ? login.toLowerCase() : nickKey(login);
          this.limit('entrar:' + ip, 20, 900000, now); this.limit('entrar:' + key, 10, 900000, now);
          const user = this.one('SELECT * FROM users WHERE ' + (login.includes('@') ? 'email' : 'nick_key') + ' = ?', key);
          // Mismo mensaje si el usuario no existe o la contraseña falla: no se desvela qué cuentas hay.
          const good = user ? await verifyPassword(String(b.password || ''), user.pass) : (await hashPassword('x'), false);
          requireThat(good, 'Nick o contraseña incorrectos.', 401);
          requireThat(user.verified, 'Confirma tu cuenta con el enlace que te enviamos por correo. Si no te llegó, pide otro.', 403);
          this.clearLimit('entrar:' + key);
          const session = randomToken();
          this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now);
          this.sql.exec('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)', await sha256(session), user.id, now + SESSION_MS);
          return json({ session, user: publicUser(user) });
        }
        case '/reenviar': {
          this.limit('reenviar:' + ip, 5, 3600000, now);
          const user = this.one('SELECT * FROM users WHERE email = ? OR nick_key = ?', String(b.login || '').trim().toLowerCase(), nickKey(b.login));
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
          return json({ user: publicUser(user) });
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
          for (const table of ['sessions', 'tokens']) this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, user.id);
          this.sql.exec('DELETE FROM users WHERE id = ?', user.id);
          return json({ ok: true });
        }
        // Uso interno de las salas de torneo: quién es esta sesión y si un nombre está reservado.
        case '/sesion': {
          const user = await this.user(b.session, now);
          return json({ user: user && user.verified ? { id: user.id, nick: user.nick } : null });
        }
        case '/nick': return json({ taken: !!this.one('SELECT 1 AS x FROM users WHERE nick_key = ?', nickKey(b.name)) });
        default: throw new GameError('No encontrado.', 404);
      }
    } catch (error) {
      return json({ error: error instanceof GameError ? error.message : 'No se pudo completar la operación. Vuelve a intentarlo.' }, error.status || 500);
    }
  }
}
