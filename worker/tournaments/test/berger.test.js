import test from 'node:test';
import assert from 'node:assert/strict';
import { closedPairs } from '../src/core.js';

// Tablas Berger oficiales de la FIDE (Manual FIDE C.05, anexo 1): blancas-negras de cada ronda.
const FIDE = {
  4: ['1-4 2-3', '4-3 1-2', '2-4 3-1'],
  6: ['1-6 2-5 3-4', '6-4 5-3 1-2', '2-6 3-1 4-5', '6-5 1-4 2-3', '3-6 4-2 5-1'],
  8: ['1-8 2-7 3-6 4-5', '8-5 6-4 7-3 1-2', '2-8 3-1 4-7 5-6', '8-6 7-5 1-4 2-3', '3-8 4-2 5-1 6-7', '8-7 1-6 2-5 3-4', '4-8 5-3 6-2 7-1'],
  10: ['1-10 2-9 3-8 4-7 5-6', '10-6 7-5 8-4 9-3 1-2', '2-10 3-1 4-9 5-8 6-7', '10-7 8-6 9-5 1-4 2-3', '3-10 4-2 5-1 6-9 7-8', '10-8 9-7 1-6 2-5 3-4', '4-10 5-3 6-2 7-1 8-9', '10-9 1-8 2-7 3-6 4-5', '5-10 6-4 7-3 8-2 9-1']
};

test('Round-Robin: emparejamientos y colores idénticos a las tablas Berger de la FIDE', () => {
  for (const [n, rounds] of Object.entries(FIDE)) {
    const players = Array.from({ length: +n }, (_, i) => ({ id: i + 1, seed: i + 1 }));
    rounds.forEach((official, r) => {
      const ours = closedPairs(players, r + 1).map(([w, b]) => `${w.id}-${b.id}`).sort();
      assert.deepEqual(ours, official.split(' ').sort(), `${n} jugadores, ronda ${r + 1}`);
    });
  }
});

test('Round-Robin con número impar: todos contra todos, un descanso cada uno y colores equilibrados', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, seed: i + 1 })), met = new Set(), rests = {}, whites = {};
  for (let r = 1; r <= 5; r++) for (const [w, b] of closedPairs(five, r)) {
    if (!w || !b) { const p = w || b; rests[p.id] = (rests[p.id] || 0) + 1; continue; }
    met.add([w.id, b.id].sort().join('-')); whites[w.id] = (whites[w.id] || 0) + 1;
  }
  assert.equal(met.size, 10);
  assert.deepEqual(Object.values(rests), [1, 1, 1, 1, 1]);
  assert.deepEqual(Object.values(whites), [2, 2, 2, 2, 2]);
});
