// Prueba local sin contactar a las plataformas ni generar visitas de analítica.
// Requiere playwright-core (worker/tournaments/node_modules o build/browser-check/node_modules) y Chrome/Edge.
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
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p => fs.existsSync(p));
const pgn = '[Event "Prueba local"]\n[Site "https://lichess.org/aaaa1111"]\n[White "Blancas"]\n[Black "Negras"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *';
let gamePgn = pgn;
const now = Date.now();
let name = 'Torneo de prueba', description = '', group = null, currentFeed = {};
const scheduled = (url = 'https://www.youtube.com/watch?v=abcdefghijk', title = 'Torneo de prueba', active = false) => ({ title, source: 'Chess.com', url, start: now + (active ? -60000 : 3600000), end: now + 7200000 });
const activeFeed = (url, title = 'Torneo de prueba') => ({ live: [scheduled(url, title, true)], upcoming: [] });
const players = Array.from({ length: 28 }, (_, i) => ({ name: 'Jugador con nombre completo de prueba ' + (i + 1), title: 'IM', fed: 'ESP', rank: i + 1, score: i === 0 ? 3.5 : 2, played: 4, rating: 2400 - i, performances: { standard: 2500 - i } }));
const server = http.createServer((req, res) => {
  if (req.url === '/mock-stream.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<body style="margin:0;background:#14233a;color:white;font:20px system-ui;display:grid;place-content:center;height:100vh">Vídeo de prueba local</body>'); return;
  }
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }[path.extname(file)];
  fs.readFile(file, (err, body) => { res.writeHead(err ? 404 : 200, { 'Content-Type': type || 'application/octet-stream' }); res.end(err ? '' : body); });
});
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const chessLibrary = path.join(root, 'build/browser-check/chess.min.js');
  if (!fs.existsSync(chessLibrary)) {
    const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js');
    if (!response.ok) throw Error('No se pudo descargar chess.js para la prueba.');
    fs.mkdirSync(path.dirname(chessLibrary), { recursive: true }); fs.writeFileSync(chessLibrary, await response.text());
  }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  try {
    for (const width of [1280, 390]) {
      name = 'Torneo de prueba'; description = ''; group = null;
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 500, colorScheme: 'dark', timezoneId: 'America/New_York' });
      const errors = [], embeds = [];
      await context.addInitScript(() => {
        localStorage.setItem('apejupoSf', 'off'); window.copiedTable = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedTable = text; } } });
      });
      await context.route('**/*', async route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (url.includes('/chess.min.js')) return route.fulfill({ path: chessLibrary, contentType: 'application/javascript' });
        if (/^https:\/\/(www\.youtube\.com\/embed\/|player\.twitch\.tv\/|player\.kick\.com\/)/.test(url)) {
          embeds.push(url); return route.fulfill({ status: 302, headers: { location: base + '/mock-stream.html' }, body: '' });
        }
        if (url.includes('chessrival-worker.workers.dev')) return route.fulfill({ json: url.includes('players=') ? players : currentFeed });
        if (url.includes('lichess.org')) {
          if (url.endsWith('.pgn')) return route.fulfill({ body: gamePgn, contentType: 'text/plain' });
          if (url.includes('/api/broadcast/search?')) return route.fulfill({ json: { currentPageResults: [
            { tour: { id: 'fin12345', name: 'Final con partidas anteriores' }, round: { id: 'next1234', name: 'Game 8', startsAt: now + 3600000 }, roundToLink: { id: 'hist1234', name: 'Game 7', finished: true } },
            { tour: { id: 'fut12345', name: 'Torneo sin rondas publicadas' }, round: { id: 'soon1234', name: 'Round 1', startsAt: now + 7200000 } }
          ], nextPage: null } });
          if (url.includes('/api/broadcast/-/-/')) {
            const id = url.split('/').pop();
            return route.fulfill({ json: { tour: { id: 'tour1234', name, description, dates: [now - 864e5, now + 864e5], info: { location: 'Quezon City, Philippines', format: '46 players 9 rounds Swiss', tc: '90 min / 40 moves + 30 min + 30 s' } }, group,
              round: { id, name: id === 'round005' ? 'Round 5' : id === 'game0007' ? 'Game 7' : 'Ronda 1', startsAt: id === 'unknown1' ? undefined : id === 'summer12' ? Date.UTC(2026, 6, 20, 8) : Date.UTC(2026, 10, 20, 8) } } });
          }
          if (url.includes('/api/broadcast/tour1234')) return route.fulfill({ json: { rounds: [] } });
          return route.fulfill({ json: { active: [], upcoming: [], rounds: [], players: [] } });
        }
        return route.fulfill({ body: '', status: 200 });
      });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.stack)); page.setDefaultTimeout(12000);
      const goto = async (file = 'torneo.html?r=test1234') => {
        embeds.length = 0; await page.goto(base + '/' + file);
        await page.waitForFunction(() => document.querySelector('#stream-status')?.textContent && !document.querySelector('#stream-status').textContent.includes('Consultando'));
      };
      currentFeed = { live: [scheduled('https://kick.com/chess', 'Otro torneo', true)], upcoming: [scheduled()] };
      await goto('torneos-live.html');
      assert.equal(await page.locator('#stream-open').count(), 1); assert.equal(await page.locator('#stream-open').isDisabled(), true);
      assert.equal(await page.locator('#streams .so-card, #stream-tabs, .stream-manual').count(), 0);
      await page.locator('#tsearch').fill('Total Chess'); await page.locator('#tsearch-go').click();
      await page.waitForFunction(() => document.querySelectorAll('#tsearch-res .card').length === 2);
      const cards = page.locator('#tsearch-res .card');
      assert.ok((await cards.first().locator('a.btn-view').getAttribute('href')).includes('r=hist1234'), 'La final anunciada abre una ronda ya publicada');
      assert.ok((await cards.first().locator('.badge').textContent()).includes('PRÓXIMAMENTE'));
      assert.equal(await cards.nth(1).locator('a.btn-view').count(), 0, 'Sin ronda publicada no ofrece tableros inexistentes');
      await goto();
      assert.equal(await page.locator('#stream-open').isDisabled(), true, 'Otro torneo en directo no activa el botón');
      const expectedTime = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now + 3600000);
      assert.ok((await page.locator('#stream-status').textContent()).includes(expectedTime));
      assert.ok((await page.locator('#stream-status').textContent()).includes('hora de Madrid'));
      if (width < 600) {
        assert.equal(await page.locator('#stream-launch').isVisible(),false);
        currentFeed=activeFeed('https://kick.com/gmhikaru'); await goto();
        assert.equal(await page.locator('#stream-open').isEnabled(),true);
        for (const [w,h] of [[390,900],[320,700],[844,390]]) {
          await page.setViewportSize({width:w,height:h});
          assert.equal(await page.locator('#stream-launch').isVisible(),false,'También oculta una emisión activa en móvil');
          assert.equal(await page.locator('#viewer-options').isVisible(),false);
          assert.equal(await page.locator('#board-size-control').isVisible(),false);
          assert.equal(await page.locator('#viewer-stand').isVisible(),true);
          assert.equal(await page.locator('#viewer-pair').isVisible(),true);
        }
        assert.equal(embeds.length,0);
        await page.locator('#viewer-stand').click(); await page.locator('table.stand').waitFor(); await page.locator('#lv-fclose').click();
        await page.locator('#viewer-pair').click(); await page.locator('table.pairs').waitFor(); await page.locator('#lv-fclose').click();
        assert.deepEqual(errors,[]);
        console.log('390px OK: bloque oculto en vertical y horizontal, ronda/clasificación/emparejamientos accesibles y ningún vídeo cargado.');
        await context.close(); continue;
      }
      assert.ok((await page.locator('#stream-status').boundingBox()).y >= (await page.locator('#stream-open').boundingBox()).y + (await page.locator('#stream-open').boundingBox()).height);
      assert.equal(embeds.length, 0); assert.equal(await page.locator('#viewer-start').isVisible(), true);
      assert.ok((await page.locator('#viewer-start').textContent()).includes('09:00'));
      await page.screenshot({ path: path.join(root, `build/browser-check/commentary-disabled-${width}.png`) });
      for (const [provider, url, expected] of [
        ['youtube', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/embed/abcdefghijk'],
        ['kick', 'https://kick.com/gmhikaru', 'https://player.kick.com/gmhikaru?'],
        ['twitch', 'https://www.twitch.tv/chess24', 'https://player.twitch.tv/?channel=chess24&']
      ]) {
        currentFeed = activeFeed(url); await goto();
        assert.equal(await page.locator('#stream-open').isEnabled(), true); assert.equal(embeds.length, 0, 'Sin reproducción automática');
        await page.locator('#stream-open').click(); await page.locator('#stream-window.sw-floating').waitFor({ state: 'visible' });
        if (await page.locator('#stream-box .t-btn').count()) { assert.equal(embeds.length, 0); await page.locator('#stream-box .t-btn').click(); }
        await page.waitForFunction(prefix => document.querySelector('#stream-frame').src.startsWith(prefix), expected);
        await page.frameLocator('#stream-frame').getByText('Vídeo de prueba local').waitFor();
        assert.equal(await page.locator('#stream-window').getAttribute('data-provider'), provider);
        if (provider === 'youtube') {
          await page.frameLocator('#stream-frame').locator('body').evaluate(() => { window.playerMarker = 'same-player'; });
          const count = embeds.length, before = await page.locator('#stream-window').boundingBox(), grip = await page.locator('#sw-drag').boundingBox();
          await page.mouse.move(grip.x + 20, grip.y + 18); await page.mouse.down(); await page.mouse.move(60, 100, { steps: 6 }); await page.mouse.up();
          assert.ok(Math.abs(before.y - (await page.locator('#stream-window').boundingBox()).y) > 50);
          if (width < 500) {
            const touch = await context.newCDPSession(page), handle = await page.locator('#sw-drag').boundingBox();
            await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle.x + 20, y: handle.y + 18 }] });
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: handle.x + 20, y: handle.y + 88 }] });
            await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach();
            assert.ok((await page.locator('#stream-window').boundingBox()).y > handle.y + 30);
          }
          await page.locator('#sw-drag').press('ArrowRight'); await page.locator('#sw-min').click();
          assert.equal(await page.locator('#sw-body').isVisible(), false); await page.locator('#sw-min').click();
          await page.locator('#sw-size').click(); await page.locator('#sw-dock').click();
          await page.locator('#stream-open').click();
          assert.equal(await page.frameLocator('#stream-frame').locator('body').evaluate(() => window.playerMarker), 'same-player');
          assert.equal(embeds.length, count, 'Minimizar y acoplar no reinicia el vídeo');
          await page.setViewportSize({ width: 320, height: 550 }); await wait(60);
          const small = await page.locator('#stream-window').boundingBox(); assert.ok(small.x >= 0 && small.x + small.width <= 320 && small.y + small.height <= 551);
          await page.setViewportSize({ width, height: 900 });
        }
        await page.locator('#sw-close').click(); assert.equal(await page.locator('#stream-frame').getAttribute('src'), null);
        if (provider === 'kick') {
          await page.locator('#stream-open').click(); await page.locator('#stream-window').waitFor({ state: 'visible' });
          await page.evaluate(() => window.apejupoOpenRound('unknown1', 'Otra ronda', true));
          await page.waitForFunction(() => document.querySelector('#stream-window').hidden);
          assert.equal(await page.locator('#stream-frame').getAttribute('src'), null, 'Cambiar de ronda detiene el reproductor anterior');
        }
      }
      name = 'Torneo distinto'; currentFeed = activeFeed('https://kick.com/gmhikaru'); await goto();
      assert.equal(await page.locator('#stream-open').isDisabled(), true); assert.ok((await page.locator('#stream-status').textContent()).includes('Inicio de ronda:'));
      await goto('torneo.html?r=unknown1'); assert.ok((await page.locator('#stream-status').textContent()).includes('por confirmar'));
      description = 'Canal general: https://kick.com/gmhikaru'; await goto(); assert.equal(await page.locator('#stream-open').isDisabled(), true, 'Un canal genérico no prueba que comente ese torneo');
      description = 'Emisión: https://www.youtube.com/watch?v=abcdefghijk'; currentFeed = activeFeed('https://youtu.be/abcdefghijk', 'Título distinto del vídeo'); await goto();
      assert.equal(await page.locator('#stream-open').isEnabled(), true, 'Vídeo concreto enlazado por el organizador');
      description = ''; name = 'Finals'; group = { id: 'uMS8kYeS', name: 'Total Chess World Championship Tour Pilot 2026' };
      currentFeed = activeFeed('https://www.twitch.tv/chess24', 'Total Chess World Championship Day 10'); await goto();
      assert.equal(await page.locator('#stream-open').isEnabled(), true, 'Asociación comprobada por ID de grupo');
      group = null; name = 'Torneo de prueba'; currentFeed = activeFeed('https://example.org/live'); await goto();
      assert.equal(await page.locator('#stream-open').isDisabled(), true, 'Fuente incompatible descartada');
      currentFeed = activeFeed('https://kick.com/gmhikaru'); await goto();
      if (!await page.locator('#viewer-stand').isVisible()) await page.locator('#viewer-options').click();
      await page.locator('#viewer-stand').click(); await page.locator('table.stand').waitFor();
      const copy = page.locator('#lv-fcopy'), close = page.locator('#lv-fclose');
      assert.equal(await close.locator('svg').count(), 1); assert.ok((await copy.boundingBox()).x < (await close.boundingBox()).x);
      await copy.click(); await page.waitForFunction(() => window.copiedTable.includes('Jugador con nombre completo de prueba 28'));
      assert.ok((await page.evaluate(() => window.copiedTable)).includes('3½')); await close.click();
      await page.locator('#viewer-pair').click(); await page.locator('table.pairs').waitFor();
      await copy.click(); await page.waitForFunction(() => window.copiedTable.includes('En juego')); await close.click();
      await page.evaluate(() => window.apejupoOpenRound('summer12', 'Verano', true));
      await page.waitForFunction(() => document.querySelector('#viewer-start').textContent.includes('10:00'));
      gamePgn = Array.from({ length: 16 }, (_, i) => {
        const white = players[i * 2]?.name || 'Ana', black = players[i * 2 + 1]?.name || 'Nombre largo de un jugador sin federación';
        const result = ['*', '1-0', '1/2-1/2'][i % 3];
        return `[Event "Columnas"]\n[Site "https://lichess.org/gm${String(i).padStart(6, '0')}"]\n[Round "1.${i + 1}"]\n[White "${white}"]\n[Black "${black}"]\n[WhiteTitle "${i % 2 ? 'GM' : 'IM'}"]\n[BlackTitle "${i % 3 ? 'WIM' : 'FM'}"]\n[Result "${result}"]\n\n1. e4 e5 2. Nf3 ${result}`;
      }).join('\n\n');
      await goto();
      if (!await page.locator('#viewer-pick-b').isVisible()) await page.locator('#viewer-options').click();
      await page.locator('#viewer-pick-b').click(); await page.locator('#viewer-pick-l').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#viewer-pick-l button').count(), 6);
      const columns = await page.locator('#viewer-pick-l button').evaluateAll(rows => rows.map(row => {
        const sides = row.querySelectorAll('.lv-pick-p');
        const white = sides[0].getBoundingClientRect(), black = sides[1].getBoundingClientRect(), result = row.querySelector('.lv-pick-r').getBoundingClientRect();
        if (!(white.right <= result.left && result.right <= black.left)) throw Error('El resultado debe quedar entre los dos jugadores');
        return { white: sides[0].getBoundingClientRect().left, black: sides[1].getBoundingClientRect().left, result: row.querySelector('.lv-pick-r').getBoundingClientRect().right };
      }));
      for (const col of ['white', 'black', 'result']) assert.ok(Math.max(...columns.map(c => c[col])) - Math.min(...columns.map(c => c[col])) < 1, 'Columna alineada: ' + col);
      assert.equal(await page.locator('#viewer-pick-l').evaluate(el => el.scrollWidth > el.clientWidth), false);
      await page.locator('#viewer-pick-l').screenshot({ path: path.join(root, `build/browser-check/pair-picker-columns-${width}.png`) });
      const second = await page.locator('#viewer-pick-l button').nth(1).getAttribute('data-id');
      await page.locator('#viewer-pick-l button').first().press('ArrowDown');
      await page.keyboard.press('Enter'); assert.equal(await page.locator('#viewer-more').inputValue(), second);
      await page.locator('#viewer-add').click();
      await page.waitForFunction(() => document.querySelectorAll('.th-board').length === 11);
      gamePgn = pgn;
      // La cabecera completa debe ser bilingüe sin depender de la IA ni de su caché.
      players[players.length - 1].fed = 'PHI';
      await page.evaluate(() => {
        localStorage.setItem('apejupo-idioma', 'en');
        localStorage.setItem('apejupo-traducciones-en-2', JSON.stringify({ 'Ronda 5': 'Ronda 5', 'Ronda {0}': 'Ronda {0}', '28 jugadores': '28 jugadores' }));
      });
      await goto('torneo.html?r=round005');
      await page.waitForFunction(() => document.querySelector('#viewer-np').textContent.includes('2 countries'));
      assert.equal(await page.locator('#viewer-title').textContent(), 'Tournament');
      assert.match(await page.locator('#viewer-info').textContent(), /^Round 5 · Quezon City, Philippines · from .* to .* · 9 rounds Swiss · 90 min \/ 40 moves/);
      assert.equal(await page.locator('#viewer-np').textContent(), '28 players - Average Elo 2387 - 2 countries');
      assert.doesNotMatch(await page.locator('#viewer-info').textContent(), /Ronda|rondas|jugadas|del | al /);
      assert.doesNotMatch(await page.locator('#viewer-np').textContent(), /jugadores|medio|país/);
      assert.equal(await page.evaluate(() => localStorage.getItem('apejupo-idioma')), 'en');
      await page.screenshot({ path: path.join(root, `build/browser-check/tournament-header-en-${width}.png`) });
      await goto('torneo.html?r=game0007');
      await page.waitForFunction(() => document.querySelector('#viewer-info').textContent.startsWith('Game 7'));
      // Cambiar a español en el selector real y volver al torneo conserva sus textos originales.
      await page.goto(base + '/index.html'); await page.locator('.lang-flags').waitFor({ state: 'attached' });
      if (width < 821) await page.locator('.nav-t').click();
      await page.locator('[data-lang="es"]').click();
      await goto('torneo.html?r=round005');
      await page.waitForFunction(() => document.querySelector('#viewer-np').textContent.includes('2 países'));
      assert.match(await page.locator('#viewer-info').textContent(), /^Ronda 5 · Quezon City, Philippines · del .* al .* · Swiss a 9 rondas · 90 min \/ 40 jugadas/);
      assert.equal(await page.locator('#viewer-np').textContent(), '28 jugadores - ELO medio 2387 - 2 países');
      assert.equal(await page.evaluate(() => localStorage.getItem('apejupo-idioma')), 'es');
      players[players.length - 1].fed = 'ESP';
      assert.deepEqual(errors, []);
      console.log(`${width}px OK: botón del torneo, gris con hora de Madrid, tres reproductores, controles, cambio de ronda, copia y lista de partidas en columnas con selección por teclado.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { server.closeAllConnections(); server.close(); });
