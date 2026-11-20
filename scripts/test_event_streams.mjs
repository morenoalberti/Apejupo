import assert from 'node:assert/strict';
import { collect } from '../worker/src/index.js';

// Se comprueba el colector completo con respuestas públicas simuladas, sin red ni claves.
const originalFetch = globalThis.fetch;
const now = Date.now();
const base = { title: 'Mismo torneo', eventId: 1, startAt: new Date(now - 60000).toISOString(), endAt: new Date(now + 3600000).toISOString() };
const streams = [
  { ...base, type: 'unsupported', channel: 'chess' },
  { ...base, type: 'kick', channel: 'gmhikaru' },
  { ...base, type: 'kick', channel: 'gmhikaru' }, // se repite por sección del torneo
  { ...base, type: 'twitch', channel: 'gmhikaru' }, // mismo nombre de canal, plataforma diferente
  { ...base, type: 'youtube', channel: 'abcdefghijk' },
  { ...base, title: 'Sin canal', type: 'kick' },
  { ...base, title: 'Canal inválido', type: 'kick', channel: 'chess/extra' },
  { ...base, title: 'Vídeo inválido', type: 'youtube', channel: 'short' },
  { ...base, title: 'Próxima Kick', type: 'kick', channel: 'chess', startAt: new Date(now + 120000).toISOString() }
];
globalThis.fetch = async input => {
  const url = String(input);
  if (url === 'https://www.chess.com/callback/events/upcoming-streams') return Response.json({ streams });
  if (url === 'https://chessroster.com/tournaments' || url.startsWith('https://www.chessregister.com/events?')) return new Response('');
  throw Error('Petición inesperada: ' + url);
};
try {
  const result = await collect();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.live.map(e => e.url), ['https://kick.com/gmhikaru', 'https://www.twitch.tv/gmhikaru', 'https://www.youtube.com/watch?v=abcdefghijk']);
  assert.equal(new Set(result.live.map(e => e.id)).size, 3);
  assert.equal(result.upcoming.length, 1);
  assert.equal(result.upcoming[0].url, 'https://kick.com/chess');
  console.log('Colector OK: canal Kick, tres reproductores, duplicados por sección y fuentes inválidas descartadas.');
} finally { globalThis.fetch = originalFetch; }
