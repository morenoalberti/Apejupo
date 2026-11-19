// Completa el diccionario de la web en inglés: data/i18n/en.json
//
// El JSON tiene pares «texto en español» → «texto en inglés». La web lo usa primero al pulsar la bandera
// inglesa (js/idioma.js); se puede corregir a mano cualquier traducción y este script nunca la pisa.
//
// Qué hace: abre cada página de la web en local con un navegador sin ventana (Edge), recoge sus textos
// (los mismos que traduce js/idioma.js), y los que aún no están en el JSON los traduce con el traductor
// del Worker de eventos y los añade. Las listas que cambian solas (noticias, torneos en directo, torneos de
// otras webs) no se recogen: para eso queda el traductor automático.
//
// Uso (con la web en local en el puerto 8080 y el Worker de eventos en el 8787):
//   node scripts/traducciones.mjs                      → todas las páginas
//   node scripts/traducciones.mjs index.html elo.html  → solo esas
//   node scripts/traducciones.mjs --codigo             → también los textos del JavaScript (ventanas, avisos…)
//   node scripts/traducciones.mjs --codigo --listar    → solo lista lo que falta en el JSON, sin traducir
//   node scripts/traducciones.mjs --codigo --limpiar   → además quita del JSON lo que ya no sale (con --codigo, para no perderlos)
//   --web http://localhost:8080   --traductor http://127.0.0.1:8787/traducir   (valores por defecto)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(raiz, 'worker', 'tournaments', 'package.json'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => { const i = args.indexOf(nombre); return i >= 0 ? args.splice(i, 2)[1] : porDefecto; };
const WEB = opcion('--web', 'http://localhost:8080').replace(/\/$/, '');
const TRADUCTOR = opcion('--traductor', 'http://127.0.0.1:8787/traducir');
const limpiar = args.includes('--limpiar');
const codigo = args.includes('--codigo');
const paginas = args.filter((a) => a.endsWith('.html'));
const lista = paginas.length ? paginas : readdirSync(raiz).filter((f) => f.endsWith('.html')).sort();

const RUTA = path.join(raiz, 'data', 'i18n', 'en.json');
mkdirSync(path.dirname(RUTA), { recursive: true });
const diccionario = existsSync(RUTA) ? JSON.parse(readFileSync(RUTA, 'utf8')) : {};

// Contenido que cambia solo: no se pide (y por tanto no entra en el JSON).
const DINAMICO = /\/data\/(news\.json|torneos-locales\.json|elo\/|tactica\/|bases\/)|\/api\/tournaments(\?|$)/;

const navegador = await chromium.launch({ channel: 'msedge', headless: true });
const contexto = await navegador.newContext({ locale: 'es-ES' });
await contexto.addInitScript(() => { try { localStorage.setItem('apejupo-idioma', 'es'); } catch {} });
const vistos = new Map(); // texto → páginas
for (const archivo of lista) {
  const pagina = await contexto.newPage();
  await pagina.route('**/*', (ruta) => {
    const url = ruta.request().url();
    const local = url.startsWith(WEB) || url.startsWith('data:');
    return local && !DINAMICO.test(url) ? ruta.continue() : ruta.abort();
  });
  try {
    await pagina.goto(`${WEB}/${archivo}`, { waitUntil: 'load', timeout: 45000 });
    await pagina.waitForTimeout(2500);
    await pagina.evaluate(() => window.ApejupoIdioma && window.ApejupoIdioma.listo());
    const textos = await pagina.evaluate(() => (window.ApejupoIdioma ? window.ApejupoIdioma.textos() : []));
    for (const t of textos) vistos.set(t, (vistos.get(t) || []).concat(archivo));
    console.log(`${archivo}: ${textos.length} textos`);
  } catch (e) {
    console.log(`${archivo}: no se pudo abrir (${e.message.split('\n')[0]})`);
  }
  await pagina.close();
}
await navegador.close();

// --codigo: además, los textos de interfaz que están en el JavaScript (ventanas, avisos, estados de la sala…)
// y que solo aparecen al usar la web. Los trozos ${…} pasan a comodín {*} y los números a {0}, {1}…
if (codigo) {
  const antes = vistos.size;
  const ES = /[áéíóúñ¿¡]|\b(de|del|los|las|el|la|con|para|por|una|un|que|sin|más|ver|torneo|torneos|partida|partidas|jugador|jugadores|ronda|rondas|buscar|cerrar|guardar|aquí|hoy|crear|entrar|plazas|inscritos|inscripción|ejercicios|tablas|resultado|clasificación|premios|cuenta|correo|contraseña|organizador|emparejar|mesa|blancas|negras|turno|tiempo|clave|nombre|borrar|editar|añadir|quitar|empezar|siguiente|anterior|cargando|conectado|conectando)\b/i;
  const out = vistos;
  for (const f of readdirSync(path.join(raiz, 'js')).filter((f) => f !== 'idioma.js').filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(path.join(raiz, 'js', f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const re = /'((?:[^'\\\n]|\\.){3,300})'|"((?:[^"\\\n]|\\.){3,300})"|`((?:[^`\\]|\\.){3,400})`/g;
    let m;
    while ((m = re.exec(src))) {
      let s = m[1] ?? m[2] ?? m[3];
      if (m[3] !== undefined) s = s.replace(/\$\{[^}]*\}/g, '{*}');
      if (/<|>|=>|function|\bvar\b|\bconst\b|querySelector|\.js|\.css|https?:|\\n/.test(s)) {
        // trozos de HTML: se toman los textos entre etiquetas
        for (const t of s.split(/<[^>]*>/)) consider(t, f);
        continue;
      }
      consider(s, f);
    }
  }
  function consider(raw, f) {
    let s = raw.replace(/\\u00a0/g, ' ').replace(/\\'/g, "'").replace(/\\"/g, '"').trim();
    if (s.length < 3 || !ES.test(s) || !/[a-záéíóúñ]{3}/i.test(s)) return;
    if (/^[\w.-]+$/.test(s) && !/[áéíóúñ]/.test(s) && !/\s/.test(s)) return; // identificadores
    if (/[{}]\s*$/.test(s) && !/\{\*\}|\{\d\}/.test(s)) return;
    if (/^[.#[]|^\w+\(/.test(s)) return; // selectores, llamadas
    if (/[;=&|]|\?\.|^[,:.)\]}'"]|[([{]\s*$|(admin|el|img|clave|t|r|e|n|x)\.\w|detail:|badge:|POR:/.test(s)) return; // trozos de código
    if (!/^[«¡¿"(\p{L}\d{]/u.test(s)) return;
    let n = 0; s = s.replace(/\d+(?:[.,:]\d+)*/g, () => '{' + n++ + '}');
    out.set(s, (out.get(s) || []).concat('js/' + f));
  }
  console.log(`Textos de interfaz en el código: ${vistos.size - antes} nuevos.`);
}

const faltan = [...vistos.keys()].filter((t) => !diccionario[t]);
console.log(`\nTextos en la web: ${vistos.size} · ya en el JSON: ${vistos.size - faltan.length} · por traducir: ${faltan.length}`);
if (args.includes('--listar')) { // solo enseña lo que falta, sin traducir ni guardar
  for (const t of faltan) console.log('  · ' + t.slice(0, 140));
  process.exit(0);
}

const fallidos = [];
for (let i = 0; i < faltan.length; i += 20) {
  const grupo = faltan.slice(i, i + 20);
  try {
    const r = await fetch(TRADUCTOR, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ to: 'en', texts: grupo }) });
    const j = await r.json();
    if (!Array.isArray(j.translations)) throw new Error(j.error || 'respuesta no válida');
    grupo.forEach((t, k) => { const tr = j.translations[k]; if (typeof tr === 'string' && tr.trim()) diccionario[t] = tr; else fallidos.push(t); });
    process.stdout.write(`\rTraducidos ${Math.min(i + 20, faltan.length)} de ${faltan.length}`);
  } catch (e) {
    fallidos.push(...grupo);
    console.log(`\nNo se pudo traducir un lote: ${e.message}`);
  }
}
if (faltan.length) console.log('');
// Si un lote falló (el modelo a veces se descuadra con textos largos), se reintenta texto a texto.
if (fallidos.length) {
  const otraVez = fallidos.splice(0);
  for (const t of otraVez) {
    try {
      const r = await fetch(TRADUCTOR, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ to: 'en', texts: [t] }) });
      const tr = (await r.json()).translations?.[0];
      if (typeof tr === 'string' && tr.trim()) diccionario[t] = tr; else fallidos.push(t);
    } catch { fallidos.push(t); }
  }
  console.log(`Reintentados uno a uno: ${otraVez.length - fallidos.length} de ${otraVez.length}`);
}

if (limpiar) {
  const antes = Object.keys(diccionario).length;
  for (const t of Object.keys(diccionario)) if (!vistos.has(t)) delete diccionario[t];
  console.log(`Quitados ${antes - Object.keys(diccionario).length} textos que ya no salen en la web.`);
}

// Ordenado alfabéticamente para que los cambios se vean bien en git.
const ordenado = Object.fromEntries(Object.keys(diccionario).sort((a, b) => a.localeCompare(b, 'es')).map((k) => [k, diccionario[k]]));
writeFileSync(RUTA, JSON.stringify(ordenado, null, 2) + '\n', 'utf8');
console.log(`Guardado ${path.relative(raiz, RUTA)} con ${Object.keys(ordenado).length} traducciones.`);
if (fallidos.length) console.log(`Sin traducir (${fallidos.length}): ${fallidos.slice(0, 10).map((t) => JSON.stringify(t)).join(', ')}${fallidos.length > 10 ? '…' : ''}`);
