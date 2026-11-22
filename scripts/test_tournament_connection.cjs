// Usa los archivos locales bajo el origen de la web para comprobar CORS real con Render.
// No crea cuentas, torneos ni jugadores y bloquea las escrituras durante la prueba.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const { chromium } = createRequire(path.join(root, 'worker/tournaments/package.json'))('playwright-core');
const origin = 'https://apejupo.com', api = 'https://apejupo-conexion.onrender.com';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      let listingRequests = 0, loginRequests = 0, oldServerRequests = 0, states = 0;
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === 'apejupo-torneos.chessrival-worker.workers.dev') { oldServerRequests++; return route.abort(); }
        if (url.origin === api) {
          if (request.method() === 'OPTIONS') return route.continue();
          if (url.pathname === '/api/tournaments' && request.method() === 'GET') {
            listingRequests++;
            if (listingRequests <= 2) return route.fulfill({ status: 503, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': origin }, body: '<h1>Starting service</h1>' });
            return route.continue();
          }
          if (url.pathname === '/api/cuentas/entrar') { loginRequests++; return route.fulfill({ status: 503, json: { error: 'Servicio arrancando' }, headers: { 'Access-Control-Allow-Origin': origin } }); }
          if (request.method() === 'POST') return route.abort();
          return route.continue();
        }
        if (url.origin !== origin) return route.fulfill({ json: {} });
        const file = path.resolve(root, '.' + url.pathname);
        if (!file.startsWith(root + path.sep)) return route.abort();
        if (url.pathname === '/js/analytics.js') return route.fulfill({ contentType: 'application/javascript', body: '' });
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => {
        assert.ok(socket.url().startsWith(api.replace('https:', 'wss:')));
        socket.on('framereceived', ({ payload }) => { try { if (JSON.parse(String(payload)).type === 'state') states++; } catch {} });
      });
      await page.goto(origin + '/jugar-torneo.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('to-events').textContent.includes('Conectando'));
      await page.locator('.to-event').first().waitFor({ state: 'visible', timeout: 30000 });
      assert.equal(await page.locator('.to-event').count(), 2);
      assert.equal(listingRequests, 3); assert.equal(oldServerRequests, 0);
      assert.match(await page.locator('#to-events').innerText(), /Abierto Apejupo/);
      assert.match(await page.locator('#to-events').innerText(), /Abierto Apejupillo/);
      // Las escrituras fallidas no se repiten, aunque el listado sí espere al arranque.
      const failure = await page.evaluate(async () => {
        const account = await import('./js/cuenta.js?v=20261122-conexion1');
        try { await account.api('entrar', { login: 'prueba-local', password: 'no-se-envia-al-servidor' }); } catch (error) { return { status: error.status, message: error.message }; }
      });
      assert.deepEqual(failure, { status: 503, message: 'Servicio arrancando' }); assert.equal(loginRequests, 1);
      fs.mkdirSync(path.join(root, 'build/torneos-conexion-qa'), { recursive: true });
      await page.screenshot({ path: path.join(root, `build/torneos-conexion-qa/listado-${width}.png`) });
      const room = await page.locator('.to-event-actions a').first().getAttribute('href');
      await page.goto(origin + '/' + room, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('to-title').textContent.includes('Abierto Apejupo'), { timeout: 30000 });
      assert.ok(states > 0, 'La sala debe recibir el estado por WebSocket');
      assert.equal(oldServerRequests, 0); assert.deepEqual(errors, []);
      await context.close();
      console.log(`OK ${width}px: arranque 503, listado conservado, CORS real, sala WebSocket y escrituras sin reintento`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
