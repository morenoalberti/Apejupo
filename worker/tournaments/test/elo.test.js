import test from 'node:test';
import assert from 'node:assert/strict';
import { ELO_START, ELO_K, expectedScore, eloAfter } from '../src/elo.js';

test('ELO del club: 1500 de inicio y K = 20', () => {
  assert.equal(ELO_START, 1500); assert.equal(ELO_K, 20);
  assert.equal(expectedScore(1500, 1500), 0.5);
  // Entre iguales: ±10 por victoria, nada por tablas.
  assert.deepEqual(eloAfter(1500, 1500, '1-0'), { white: 1510, black: 1490 });
  assert.deepEqual(eloAfter(1500, 1500, '0-1'), { white: 1490, black: 1510 });
  assert.deepEqual(eloAfter(1500, 1500, '1/2-1/2'), { white: 1500, black: 1500 });
  // Con 200 puntos de diferencia el favorito gana poco y pierde mucho (esperado ≈ 0,76).
  assert.deepEqual(eloAfter(1700, 1500, '1-0'), { white: 1705, black: 1495 });
  assert.deepEqual(eloAfter(1700, 1500, '0-1'), { white: 1685, black: 1515 });
  assert.deepEqual(eloAfter(1700, 1500, '1/2-1/2'), { white: 1695, black: 1505 });
  assert.throws(() => eloAfter(1500, 1500, '*'), /Resultado/);
});
