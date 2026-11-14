// Comprueba el motor compilado con los casos de prueba oficiales de bbpPairings.
// Uso: node test/bbp-oficial.mjs <carpeta test/tests del código de bbpPairings>
import { readFileSync, readdirSync } from 'node:fs';
import { loadBbp, runDutch } from '../src/bbp-engine.js';
await loadBbp(new WebAssembly.Module(readFileSync(new URL('../src/bbp/bbp.wasm', import.meta.url))));
const dir = process.argv[2];
let ok = 0, fail = 0;
// Solo los casos del sistema holandés (los de Burstein usan otra orden).
for (const f of readdirSync(dir).filter(f => f.endsWith('.input') && readFileSync(dir + '/' + f.replace('.input', '.cpp'), 'utf8').includes('--dutch'))) {
  const id = f.replace('.input', ''), expected = readFileSync(dir + '/' + id + '.output.expected', 'utf8').trim().split(/\s*\n\s*/).join('\n');
  try {
    const got = runDutch(readFileSync(dir + '/' + f, 'latin1')).trim().split(/\s*\n\s*/).join('\n');
    if (got === expected) ok++; else { fail++; console.log('DISTINTO', id); }
  } catch (e) { fail++; console.log('ERROR', id, e.message); }
}
console.log(`${ok} bien, ${fail} mal`);
