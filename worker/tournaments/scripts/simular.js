// Simulación local: mete jugadores automáticos en un torneo y los hace jugar.
// Uso:  npm run simular -- <id del torneo> [número de jugadores, 9 por defecto]
// Sin id, usa el torneo más reciente con la inscripción abierta.
// Los jugadores se conectan como un navegador más, así que el arena los empareja igual que a ti.
// Juegan rápido y con poca cabeza: dan mate si pueden, si no capturan la pieza más valiosa,
// a veces dan jaque y si no mueven al azar. Rechazan las tablas. Ctrl+C para pararlos.
import { randomBytes } from 'node:crypto';
import { Chess } from 'chess.js';
import WebSocket from 'ws';

const BASE = process.env.TORNEOS_URL || 'http://127.0.0.1:8789';
const ORIGIN = 'http://localhost:8080';
const NAMES = ['Lucía', 'Pepe', 'Ana', 'Juanma', 'Carmen', 'Rafa', 'Marta', 'Sergio', 'Elena', 'Paco', 'Rocío', 'Álvaro', 'Inés', 'Manolo', 'Pilar'];
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const botIds = new Set();
const token = () => randomBytes(32).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString('es');

async function api(path, options = {}) {
  const res = await fetch(BASE + '/api/tournaments' + path, { ...options, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...options.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

function pickMove(fen) {
  const chess = new Chess(fen), moves = chess.moves({ verbose: true });
  const mate = moves.find(m => m.san.endsWith('#'));
  if (mate) return mate;
  const captures = moves.filter(m => m.captured).sort((a, b) => VALUE[b.captured] - VALUE[a.captured]);
  if (captures.length && Math.random() < 0.85) return captures[0];
  const checks = moves.filter(m => m.san.includes('+'));
  if (checks.length && Math.random() < 0.3) return checks[Math.floor(Math.random() * checks.length)];
  return moves[Math.floor(Math.random() * moves.length)];
}

function bot(id, name) {
  const me = { name, token: token(), state: null, timer: null, plannedPly: null, games: 0 };
  let ws;
  const send = action => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(action));
  function think() {
    const t = me.state, g = t?.game;
    if (!g || g.result || g.bye || !t.me) return;
    const color = g.white === t.me ? 'w' : g.black === t.me ? 'b' : null;
    if (!color) return;
    if (g.offer && g.offer !== t.me) send({ type: 'decline-draw', game: g.id });
    if (g.turn !== color || me.plannedPly === g.moves.length) return;
    me.plannedPly = g.moves.length; clearTimeout(me.timer); clearTimeout(me.retry);
    // Si en 8 segundos la jugada no ha llegado al tablero, se vuelve a intentar.
    me.retry = setTimeout(() => { if (me.state?.game?.id === g.id && me.state.game.moves.length === me.plannedPly) { me.plannedPly = null; think(); } }, 8000);
    // Entre 0,8 y 3 segundos por jugada; las primeras, más rápidas.
    const delay = g.moves.length < 10 ? 500 + Math.random() * 1200 : 800 + Math.random() * 2200;
    me.timer = setTimeout(() => {
      const now = me.state?.game;
      if (!now || now.id !== g.id || now.result || now.turn !== color || now.moves.length !== me.plannedPly) return;
      const m = pickMove(now.fen);
      send({ type: 'move', game: now.id, from: m.from, to: m.to, promotion: m.promotion || null, ply: now.moves.length });
    }, delay);
  }
  function connect() {
    ws = new WebSocket(BASE.replace('http', 'ws') + '/api/tournaments/' + id + '/socket', { origin: ORIGIN });
    // Al reconectar se olvida la jugada pendiente: puede haberse perdido con la conexión.
    ws.on('open', () => { me.plannedPly = null; send({ type: 'hello', token: me.token }); });
    ws.on('message', data => {
      if (String(data) === 'pong') return;
      const msg = JSON.parse(String(data));
      if (msg.type === 'error') { me.plannedPly = null; return; }
      if (msg.type === 'move') {
        const d = msg.game, g = me.state?.game;
        if (g && g.id === d.id && d.ply === g.moves.length + 1) { g.moves.push(d.san); Object.assign(g, { fen: d.fen, turn: d.turn, whiteMs: d.whiteMs, blackMs: d.blackMs, lastAt: d.lastAt, offer: d.offer, legal: d.legal }); }
      } else if (msg.type === 'state') {
        const before = me.state?.game;
        me.state = msg;
        const g = msg.game;
        // Cada partida se anuncia una sola vez: la cuenta quien lleva blancas (o el automático, si juega contra ti).
        const who = id => msg.standings.find(p => p.id === id)?.name || '?';
        if (msg.me) botIds.add(msg.me);
        const tells = g && (g.white === msg.me || (g.black === msg.me && !botIds.has(g.white)));
        if (g && tells && !g.result && g.id !== before?.id)
          console.log(`${hora()}  ▶ ${who(g.white)} (blancas) contra ${who(g.black)} (negras)`);
        if (g && tells && g.result && before?.id === g.id && !before.result)
          console.log(`${hora()}  ■ ${who(g.white)} ${g.result.replace('1/2-1/2', '½-½')} ${who(g.black)} · ${g.reason}`);
        if (['finished', 'cancelled'].includes(msg.status)) { ws.close(); return; }
      } else return;
      think();
    });
    ws.on('close', () => { if (!['finished', 'cancelled'].includes(me.state?.status)) setTimeout(connect, 1500); });
    ws.on('error', () => {});
    setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 20000).unref();
  }
  return { me, connect };
}

let [id, count] = process.argv.slice(2);
count = Math.min(Number(count) || 9, NAMES.length);
if (!id) {
  const { tournaments } = await api('');
  const open = tournaments.filter(t => t.status === 'waiting').sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!open) { console.error('No hay ningún torneo con la inscripción abierta. Crea uno y vuelve a lanzar la simulación.'); process.exit(1); }
  id = open.id;
}
const t = await api('/' + id);
console.log(`Torneo «${t.title}» (${t.status}) · ${t.minutes}+${t.increment} · inscritos ${t.count}/${t.capacity}`);
const bots = [];
for (const name of NAMES.filter(n => !t.standings.some(p => p.name === n)).slice(0, count)) {
  const b = bot(id, name);
  await api('/' + id + '/join', { method: 'POST', body: JSON.stringify({ name, token: b.me.token }) });
  b.connect(); bots.push(b);
  console.log(`  + ${name} inscrito y conectado`);
  await sleep(150);
}
console.log(`\n${bots.length} jugadores automáticos listos. Esperando a que el organizador empiece el torneo…\n`);
const done = setInterval(() => {
  if (bots.every(b => ['finished', 'cancelled'].includes(b.me.state?.status))) {
    clearInterval(done);
    const s = bots[0].me.state;
    console.log(`\nTorneo ${s.status === 'finished' ? 'terminado' : 'cancelado'}. Clasificación:`);
    s.standings.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p.name.padEnd(16)} ${String(p.points).padStart(4)} pts · ${p.played} partidas`));
    process.exit(0);
  }
}, 2000);
