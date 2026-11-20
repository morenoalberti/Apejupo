// Navegación y textos dinámicos en ambos idiomas, incluso si falla el traductor.
// Todo el tráfico externo se sustituye: no genera visitas de analítica.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
let playwright;
for (const folder of ['worker/tournaments', 'build/browser-check']) {
  try { playwright = createRequire(path.join(root, folder, 'package.json'))('playwright-core'); break; } catch (_) {}
}
if (!playwright) throw Error('Instala playwright-core para ejecutar esta comprobación.');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)];
    res.writeHead(err ? 404 : 200, { 'Content-Type': type || 'application/octet-stream' }); res.end(err ? '' : data);
  });
});
(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      let mode = 'http', requests = 0;
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', async route => {
        const url = route.request().url();
        if (url.includes('/traducir')) {
          requests++;
          if (mode === 'network') return route.abort();
          if (mode === 'http') return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
          if (mode === 'invalid') return route.fulfill({ json: { error: 'Invalid response' } });
          return route.fulfill({ json: { translations: route.request().postDataJSON().texts.map(t => 'English: ' + t) } });
        }
        if (route.request().resourceType() === 'script' && !/\/(idioma|menu|board-size)\.js\?/.test(url)) return route.fulfill({ body: '', contentType: 'application/javascript' });
        if (url.startsWith(base)) return route.continue();
        return route.fulfill({ body: '' });
      });
      const settled = () => page.waitForFunction(() => window.ApejupoIdioma && window.ApejupoIdioma.pendientes() === 0);
      const menu = async () => { if (width < 821) await page.locator('.nav-t').click(); };
      const preference = async language => {
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.evaluate(() => localStorage.getItem('apejupo-idioma')), language);
      };
      await page.goto(base + '/index.html');
      await page.locator('.lang-flags').waitFor({ state: 'attached' }); await menu();
      await page.locator('[data-lang="en"]').click();
      await settled(); await preference('en');
      assert.equal(await page.locator('[data-lang="en"]').getAttribute('aria-pressed'), 'true');
      // Abrir el menú y añadir textos dinámicos no debe cambiar la bandera.
      await page.locator('.menu-b').first().click();
      await page.evaluate(() => {
        const panel = document.createElement('div'); panel.id = 'language-test';
        panel.innerHTML = '<button title="Copiar emparejamientos" aria-label="Cerrar">Restablecer</button><p>Próxima emisión con comentaristas: 20 Nov 2026, 14:45 · hora de Madrid</p><p>Sin emisión en directo confirmada para este torneo. Inicio de partida: 20 Nov 2026, 09:00 · Madrid</p><span>Texto desconocido para provocar un fallo remoto</span>';
        document.body.appendChild(panel);
      });
      await page.waitForFunction(() => document.querySelector('#language-test button').textContent === 'Reset');
      await settled(); await preference('en');
      assert.equal(await page.locator('#language-test button').getAttribute('title'), 'Copy pairings');
      assert.equal(await page.locator('#language-test button').getAttribute('aria-label'), 'Close');
      assert.equal(await page.locator('#language-test p').first().textContent(), 'Next commentary stream: 20 Nov 2026, 14:45 · Madrid time');
      assert.ok((await page.locator('#language-test p').nth(1).textContent()).startsWith('No live stream confirmed for this tournament. Game start:'));
      assert.ok(requests > 0, 'La prueba debe provocar un fallo real de traducción');
      assert.ok(await page.locator('.lang-aviso').count() <= 1);
      await page.locator('[data-lang="es"]').click(); await preference('es');
      assert.equal(await page.locator('#language-test button').textContent(), 'Restablecer');
      assert.equal(await page.locator('#language-test button').getAttribute('title'), 'Copiar emparejamientos');
      assert.equal(await page.locator('#language-test button').getAttribute('aria-label'), 'Cerrar');
      assert.equal(await page.locator('.lang-aviso').count(), 0);
      await page.locator('[data-lang="en"]').click(); await settled();
      for (const [file, failure] of [['torneo.html?r=test1234', 'network'], ['torneos-live.html', 'invalid'], ['elo.html', 'http'], ['quienes-somos.html', 'http']]) {
        mode = failure;
        await page.goto(base + '/' + file);
        await page.evaluate(() => {
          const el = document.createElement('p'); el.textContent = 'Otro texto desconocido para comprobar la navegación'; document.body.appendChild(el);
        });
        await settled(); await preference('en');
        assert.equal(await page.locator('.lang-flags').count(), 0);
        if (file.startsWith('torneo.html')) {
          assert.equal(await page.locator('.board-size-label').textContent(), 'Board size');
          assert.equal(await page.locator('#board-size-reset').textContent(), 'Reset');
          assert.equal(await page.locator('#viewer-stand').textContent(), ' Standings');
          assert.equal(await page.locator('#viewer-pair').textContent(), ' Pairings');
        }
      }
      mode = 'ok';
      await page.goto(base + '/index.html'); await page.locator('.lang-flags').waitFor({ state: 'attached' }); await menu();
      await settled(); await preference('en');
      assert.equal(await page.locator('[data-lang="en"]').getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => {
        const el = document.createElement('p'); el.id = 'recovered-translation'; el.textContent = 'Texto nuevo tras recuperarse el servicio'; document.body.appendChild(el);
      });
      await page.waitForFunction(() => document.querySelector('#recovered-translation').textContent === 'English: Texto nuevo tras recuperarse el servicio');
      await page.locator('[data-lang="es"]').click(); await preference('es');
      assert.equal(await page.locator('#recovered-translation').textContent(), 'Texto nuevo tras recuperarse el servicio');
      assert.deepEqual(errors, []);
      console.log(width + 'px OK: idioma conservado al abrir menús y navegar, fallos HTTP/red/respuesta, textos y atributos dinámicos ES/EN y recuperación.');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { server.closeAllConnections(); server.close(); });
