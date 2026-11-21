// Requiere npm run dev en worker/tournaments. Solo usa el Worker local.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const { chromium } = createRequire(path.join(root, 'worker/tournaments/package.json'))('playwright-core');
const base = 'http://127.0.0.1:8087', api = 'http://127.0.0.1:8789';
const mega = 'https://mega.nz/folder/2EQH0BbZ#n8RjbMl7Dk-yAlf1RGgjCg';
const password = 'Descarga-prueba-2026';
const suffix = randomBytes(4).toString('hex');
const accounts = [];
async function call(action, data = {}, token = '') {
  const res = await fetch(`${api}/api/cuentas/${action}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(data) });
  return { status: res.status, headers: res.headers, body: await res.json() };
}
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, base).pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream' });
    res.end(err ? '' : data);
  });
});
(async () => {
  let browser;
  try {
    // El servidor rechaza peticiones sin sesión, falsas y con la sesión solo en el cuerpo.
    const rejected = await call('base-datos');
    assert.equal(rejected.status, 401); assert.ok(!JSON.stringify(rejected.body).includes('mega.nz'));
    assert.equal((await call('base-datos', {}, 'a'.repeat(64))).status, 401);
    const nick = 'Base_' + suffix, email = `base.${suffix}@example.com`;
    accounts.push({ nick, email });
    const created = await call('registro', { nick, email, password });
    assert.equal(created.status, 201); assert.equal(created.body.user.verified, false);
    const token = created.body.session;
    assert.equal((await call('base-datos', { session: token, user: created.body.user })).status, 401);
    const allowed = await call('base-datos', {}, token);
    assert.equal(allowed.status, 200); assert.equal(allowed.body.url, mega);
    assert.equal(allowed.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(api + '/api/cuentas/base-datos', { headers: { Origin: base } })).status, 405);
    await call('salir', {}, token);
    assert.equal((await call('base-datos', {}, token)).status, 401);
    // Ningún fichero público de la función contiene el enlace de MEGA.
    for (const file of ['index.html', 'js/base-datos.js', 'css/base-datos.css']) {
      assert.ok(!fs.readFileSync(path.join(root, file), 'utf8').includes('2EQH0BbZ'));
    }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8087, '127.0.0.1', resolve); });
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [1280, 768]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.includes('/analytics.js')) return route.fulfill({ body: '', contentType: 'application/javascript' });
        if (url.startsWith(base + '/') || url.startsWith(api + '/')) return route.continue();
        return route.fulfill({ json: url.includes('lichess.org') ? { active: [] } : {} });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/index.html');
      const button = page.locator('#base-datos-button');
      await button.waitFor({ state: 'visible' });
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      assert.equal(await button.evaluate(el => getComputedStyle(el).position), 'fixed');
      const box = await button.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.height >= 64);
      await button.click();
      await page.locator('[data-cu-form="registro"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('a[href*="mega.nz"]').count(), 0);
      // Un usuario que ya tiene cuenta elige Entrar; la descarga se retoma sola.
      await page.locator('.cu-tabs [data-cu-tab="entrar"]').click();
      await page.locator('#cu-login').fill(nick);
      await page.locator('#cu-pass').fill(password);
      await page.locator('[data-cu-form="entrar"] .cu-submit').click();
      const link = page.locator('.base-datos-mega');
      await link.waitFor({ state: 'visible' }); assert.equal(await link.getAttribute('href'), mega);
      const popupPromise = page.waitForEvent('popup');
      await link.click(); const popup = await popupPromise;
      await popup.waitForLoadState(); assert.equal(popup.url(), mega); await popup.close();
      await page.locator('[data-base-close]').click();
      await link.waitFor({ state: 'detached' });
      assert.equal(await page.locator('a[href*="mega.nz"]').count(), 0);
      // Sesión recordada al recargar y cierre desde otra pestaña.
      await page.reload(); await button.click(); await link.waitFor({ state: 'visible' });
      const other = await context.newPage(); await other.goto(base + '/index.html');
      await other.evaluate(() => { localStorage.removeItem('apejupoSesion'); localStorage.removeItem('apejupoCuenta'); });
      await page.waitForFunction(() => !document.getElementById('base-datos-dialog').open);
      assert.equal(await link.count(), 0); await other.close();
      // El alta nueva también vuelve a la descarga tras aceptar el aviso del correo.
      const newNick = `Alta${width}_${suffix}`, newEmail = `alta${width}.${suffix}@example.com`;
      accounts.push({ nick: newNick, email: newEmail });
      await button.click();
      await page.locator('#cu-nick').fill(newNick); await page.locator('#cu-email').fill(newEmail);
      await page.locator('#cu-newpass').fill(password); await page.locator('[name="privacy"]').check();
      await page.locator('[data-cu-form="registro"] .cu-submit').click();
      await page.locator('.cu-msg [data-cu-close]').click();
      await link.waitFor({ state: 'visible' }); assert.equal(await link.getAttribute('href'), mega);
      await page.locator('[data-base-close]').click();
      await link.waitFor({ state: 'detached' });
      // El cierre real invalida la sesión y vuelve a pedir el alta.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator('#cuenta-chip').click(); await page.locator('[data-cu-act="salir"]').click();
      await page.waitForFunction(() => !localStorage.getItem('apejupoSesion'));
      await button.click(); await page.locator('[data-cu-form="registro"]').waitFor({ state: 'visible' });
      assert.equal(await link.count(), 0); await page.locator('.cu-close[data-cu-close]').click();
      // Una sesión inventada en el navegador no descubre el enlace.
      await page.evaluate(() => localStorage.setItem('apejupoSesion', 'b'.repeat(64)));
      await button.click(); await page.locator('[data-cu-form="registro"]').waitFor({ state: 'visible' });
      assert.equal(await link.count(), 0); await page.locator('.cu-close[data-cu-close]').click();
      // La portada reserva espacio al pie y la función no se muestra en otras páginas.
      fs.mkdirSync(path.join(root, 'build/base-datos-qa'), { recursive: true });
      await page.screenshot({ path: path.join(root, `build/base-datos-qa/portada-${width}.png`) });
      // En móvil no aparece el botón ni se abre el enlace mediante el control oculto.
      for (const mobileWidth of [320, 390, 767]) {
        await page.setViewportSize({ width: mobileWidth, height: 900 });
        assert.equal(await button.isVisible(), false);
        await button.evaluate(el => el.click());
        assert.equal(await page.locator('#base-datos-dialog').evaluate(el => el.open), false);
      }
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await button.isVisible(), true);
      await page.goto(base + '/quienes-somos.html'); assert.equal(await button.count(), 0);
      assert.deepEqual(errors, []); await context.close();
      console.log(`OK navegador ${width}px: visitante, entrada, alta, MEGA, recarga, cierre, sesión falsa y oculto en móvil`);
    }
    console.log('OK servidor: sin sesión, sesión falsa, cuerpo manipulado, alta sin confirmar, sesión cerrada y no-store');
  } catch (error) {
    if (browser) {
      fs.mkdirSync(path.join(root, 'build/base-datos-qa'), { recursive: true });
      for (const [index, context] of browser.contexts().entries()) {
        const page = context.pages()[0];
        if (page) {
          await page.screenshot({ path: path.join(root, `build/base-datos-qa/fallo-${index}.png`) }).catch(() => {});
          console.error(await page.evaluate(() => ({ chip: document.getElementById('cuenta-chip')?.textContent, auth: document.getElementById('cu-dialog')?.open, download: document.getElementById('base-datos-dialog')?.open, menu: !!document.querySelector('.cu-menu'), session: !!localStorage.getItem('apejupoSesion') })).catch(() => ({})));
        }
      }
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      const login = await call('entrar', { login: account.nick, password }).catch(() => null);
      if (login?.status === 200) await call('borrar', { password }, login.body.session);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
