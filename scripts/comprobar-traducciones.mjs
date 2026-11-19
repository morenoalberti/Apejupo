// Comprueba qué textos siguen en español con la web en inglés.
//
// Abre cada página en local con la bandera inglesa puesta, espera a que termine de traducir (también lo
// que carga después: noticias, torneos…) y lista:
//   · «Sin traducir»: textos que js/idioma.js debía traducir y siguen en español.
//   · «Parecen español»: textos visibles con aspecto de español que las reglas no tocan (para revisar a ojo:
//     suelen ser nombres propios, direcciones o nombres de torneos, que se dejan así).
//
// Uso (web en local en el 8080 y Worker de eventos en el 8787):
//   node scripts/comprobar-traducciones.mjs            → todas las páginas
//   node scripts/comprobar-traducciones.mjs elo.html   → solo esa
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(raiz, 'worker', 'tournaments', 'package.json'));
const { chromium } = require('playwright-core');
const WEB = 'http://localhost:8080';
const elegidas = process.argv.slice(2).filter((a) => a.includes('.html'));
const lista = elegidas.length ? elegidas : readdirSync(raiz).filter((f) => f.endsWith('.html')).sort();

const navegador = await chromium.launch({ channel: 'msedge', headless: true });
const contexto = await navegador.newContext({ locale: 'es-ES', viewport: { width: 1300, height: 900 } });
await contexto.addInitScript(() => { try { localStorage.setItem('apejupo-idioma', 'en'); } catch {} });
let total = 0;
for (const archivo of lista) {
  const pagina = await contexto.newPage();
  try {
    await pagina.goto(`${WEB}/${archivo}`, { waitUntil: 'load', timeout: 45000 });
    await pagina.waitForTimeout(3000);
    // Espera a que no quede nada por traducir (como mucho 60 s).
    for (let i = 0; i < 120; i++) {
      const p = await pagina.evaluate(() => (window.ApejupoIdioma ? window.ApejupoIdioma.pendientes() : 0));
      if (!p) break;
      await pagina.waitForTimeout(500);
    }
    await pagina.waitForTimeout(1500);
    const r = await pagina.evaluate(() => {
      const sin = window.ApejupoIdioma ? window.ApejupoIdioma.sinTraducir() : ['(no carga js/idioma.js)'];
      const ES = /[áéíóúñ¿¡]|\b(de|del|los|las|el|la|y|con|para|por|una|un|que|sin|más|ver|torneo|torneos|partida|jugador|jugadores|ronda|noticias|buscar|cerrar|guardar|aquí|hoy|mañana|crear|entrar|plazas|inscritos|ejercicios|finales)\b/i;
      const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0; };
      const parecen = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim(); const el = n.parentElement;
        if (t.length < 3 || !ES.test(t) || !el || el.closest('script,style,.lang-flags') || !visible(el)) continue;
        if (!sin.includes(t)) parecen.add(t.slice(0, 100));
      }
      return { sin, parecen: [...parecen] };
    });
    total += r.sin.length;
    console.log(`\n■ ${archivo}: ${r.sin.length} sin traducir`);
    for (const t of r.sin) console.log('   ✗ ' + t.slice(0, 120));
    if (r.parecen.length) console.log('   (parecen español, revisar a ojo: ' + r.parecen.slice(0, 12).map((t) => JSON.stringify(t)).join(' · ') + (r.parecen.length > 12 ? ' …' : '') + ')');
  } catch (e) {
    console.log(`\n■ ${archivo}: no se pudo abrir (${e.message.split('\n')[0]})`);
  }
  await pagina.close();
}
await navegador.close();
console.log(`\nTotal sin traducir: ${total}`);
