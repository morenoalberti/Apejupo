// Carga bbpPairings (compilado a WebAssembly con scripts/compilar-bbp.sh) y lo ejecuta como su programa
// de consola: «bbpPairings --dutch torneo.trf -p parejas.txt», sobre un sistema de archivos en memoria.
import createBbp from './bbp/bbp.mjs';

let engine = null, loading = null, errors = '';

// wasmModule: el WebAssembly.Module ya compilado (en Cloudflare, el import de bbp.wasm; en Node, leído del disco).
export function loadBbp(wasmModule) {
  if (engine) return Promise.resolve(engine);
  loading ||= createBbp({
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmModule, imports).then(instance => done(instance, wasmModule));
      return {};
    },
    print: () => {},
    printErr: line => { errors += line + '\n'; },
  }).then(m => (engine = m));
  return loading;
}

export function runDutch(trf) {
  if (!engine) throw new Error('El motor de emparejamientos no está cargado.');
  const { FS } = engine;
  FS.writeFile('/torneo.trf', trf);
  try { FS.unlink('/parejas.txt'); } catch {}
  errors = '';
  let code;
  try { code = engine.callMain(['--dutch', '/torneo.trf', '-p', '/parejas.txt']); }
  catch (error) { code = error?.status ?? 1; } // salida del programa con código distinto de 0
  if (code) throw new Error('bbpPairings: ' + (errors.trim() || 'código ' + code));
  return FS.readFile('/parejas.txt', { encoding: 'utf8' });
}
