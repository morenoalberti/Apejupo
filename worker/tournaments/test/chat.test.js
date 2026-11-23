import test from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, joinTournament, sharedSnapshot, addChat, deleteChat, chatList, CHAT_MAX, CHAT_KEEP } from '../src/core.js';

const NOW = 1800000000000;
function tournament() {
  const t = createTournament({ title: 'Chat de prueba', minutes: 5, increment: 3, rounds: 3, capacity: 8 }, 'b'.repeat(24), 'host-secret', NOW);
  joinTournament(t, 'Ana', 'secret-a', NOW); joinTournament(t, 'Pepe', 'secret-b', NOW);
  return t;
}

test('chat: solo escriben los inscritos y el texto se limpia', () => {
  const t = tournament(), ana = t.players[0];
  assert.throws(() => addChat(t, null, 'hola'), /inscritos/);
  assert.throws(() => addChat(t, 'otro-id', 'hola'), /inscritos/);
  assert.throws(() => addChat(t, ana.id, '   '), /Escribe/);
  assert.throws(() => addChat(t, ana.id, 'x'.repeat(CHAT_MAX + 1)), /140/);
  const m = addChat(t, ana.id, '  hola\n\tqué  tal ', NOW);
  assert.equal(m.text, 'hola qué tal'); assert.equal(m.name, 'Ana'); assert.equal(m.by, ana.id);
  assert.deepEqual(chatList(t).map(x => x.text), ['hola qué tal']);
  // En pausa o retirado no se escribe.
  ana.paused = true; assert.throws(() => addChat(t, ana.id, 'hola'), /salido del torneo/);
  ana.paused = false; ana.active = false; assert.throws(() => addChat(t, ana.id, 'hola'), /salido del torneo/);
  ana.active = true;
  // El chat no viaja con el estado del torneo.
  assert.equal('chat' in sharedSnapshot(t, NOW), false);
});

test('chat: se guardan los últimos mensajes y solo el organizador borra', () => {
  const t = tournament(), pepe = t.players[1];
  for (let i = 0; i < CHAT_KEEP + 5; i++) addChat(t, pepe.id, 'm' + i, NOW + i);
  assert.equal(chatList(t).length, CHAT_KEEP); assert.equal(chatList(t)[0].text, 'm5');
  const id = chatList(t)[0].id;
  assert.throws(() => deleteChat(t, false, id), /organizador/);
  deleteChat(t, true, id);
  assert.equal(chatList(t).some(m => m.id === id), false);
  assert.throws(() => deleteChat(t, true, id), /ya no está/);
});
